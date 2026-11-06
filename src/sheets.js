(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.CubaSheets = factory(root.CubaCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  // Traduce entre el modelo de la app (entradas, miembros) y las pestañas de la Sheet
  // (docs/ESQUEMA_SHEET.md). Todo puro: sin red ni DOM, así se prueba en Node.

  // El link de emparejado trae { u: url del Web App, t: token } en base64 web-safe dentro del #fragmento.
  function decodeCfg(hash) {
    var m = /(?:^#|&)cfg=([A-Za-z0-9_\-=]+)/.exec(String(hash || ''));
    if (!m) return null;
    try {
      var b = m[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      var txt = typeof atob === 'function' ? decodeURIComponent(escape(atob(b))) : Buffer.from(b, 'base64').toString('utf8');
      var o = JSON.parse(txt);
      if (!o || typeof o.u !== 'string' || typeof o.t !== 'string' || !/^https:\/\/script\.google(usercontent)?\.com\//.test(o.u) || !o.t) return null;
      return { u: o.u, t: o.t };
    } catch (e) { return null; }
  }

  function personasToMembers(personas) {
    return (personas || []).map(function (p) {
      var m = { id: p.id, name: p.nombre, color: p.color || undefined };
      if (p.alias) m.alias = p.alias;
      if (p.estado === 'archivada') m.archived = true;
      return m;
    });
  }
  // Solo manda lo que la app edita; alias y estado se conservan en la Sheet.
  function membersToPersonas(members) {
    return (members || []).map(function (m) { return { id: m.id, nombre: m.name, color: m.color || undefined }; });
  }

  function parseSp(s) {
    try { var a = JSON.parse(s); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }

  function rowToEntry(r) {
    var e = {
      id: r.id, type: r.tipo === 'pago' ? 'payment' : 'expense', desc: r.descripcion, cents: r.monto_centavos, cur: r.moneda,
      date: r.fecha, paidBy: r.pagador_id, sp: parseSp(r.reparto_json), cat: r.categoria || (r.tipo === 'pago' ? 'pago' : 'otros'),
      note: r.nota || '', by: r.creado_por || null, at: r.creado_en || '', src: r.origen || 'manual'
    };
    if (r.lote_id) e.lote = r.lote_id;
    if (r.reemplaza_id) e.replaces = r.reemplaza_id;
    if (r.excepcion) e.exc = true;
    if (r.motivo_excepcion) e.why = r.motivo_excepcion;
    if (r.anulado) e.del = true;
    return e;
  }

  // 'sueldo' si es el reparto proporcional al sueldo vigente a la fecha; 'igual' si es exactamente en partes iguales; si no, 'exacto'.
  // Excepción = había reparto por sueldo posible (sueldos de todos los que participan) y no se usó.
  function repartoInfo(e, sueldos) {
    var ids = e.sp.map(function (x) { return x[0]; });
    var key = function (sp) { return sp.map(function (x) { return x[0] + ':' + x[1]; }).sort().join(); };
    var sal = e.type === 'payment' || !sueldos || !sueldos.length ? null : C.salarySplit(e.cents, ids, sueldos, e.date);
    if (sal && sal.sp && key(sal.sp) === key(e.sp)) return { modo: 'sueldo', exc: false };
    var eq = C.splitEqual(e.cents, ids, 0);
    var a = eq.map(function (x) { return x[1]; }).sort(function (x, y) { return x - y; }).join();
    var b = e.sp.map(function (x) { return x[1]; }).sort(function (x, y) { return x - y; }).join();
    return { modo: a === b ? 'igual' : 'exacto', exc: !!(sal && sal.sp) };
  }
  function repartoModo(e, sueldos) { return repartoInfo(e, sueldos).modo; }

  function entryToMov(e, sueldos) {
    var info = repartoInfo(e, sueldos);
    var m = {
      id: e.id, tipo: e.type === 'payment' ? 'pago' : 'gasto', fecha: e.date, descripcion: e.desc, monto_centavos: e.cents, moneda: e.cur || 'ARS',
      pagador_id: e.paidBy, reparto_modo: info.modo, excepcion: info.exc, reparto: e.sp, categoria: e.cat || '', nota: e.note || '',
      origen: e.src || 'manual', creado_por: e.by || ''
    };
    if (info.exc && e.why) m.motivo_excepcion = String(e.why).slice(0, 200);
    if (e.lote) m.lote_id = e.lote;
    if (e.replaces) m.reemplaza_id = e.replaces;
    return m;
  }

  // Los movimientos solo se agregan: una edición es «agregar uno nuevo que reemplaza al viejo»
  // (el backend anula el viejo en el mismo pedido). Borrar = anular.
  // list: entradas como las arma la app (con `del` para borrar). known: { id: entrada vigente }.
  function planWrites(list, known, newId, sueldos) {
    var add = [], anular = [], applied = [], replaced = {};
    list.forEach(function (e) { if (!e.del && e.replaces) replaced[e.replaces] = true; });
    list.forEach(function (e) {
      var old = known[e.id];
      if (e.del) {
        if (old && !old.del && !replaced[e.id] && anular.indexOf(e.id) < 0) { anular.push(e.id); applied.push({ del: e.id }); }
        return;
      }
      var n = e;
      if (old && !old.del) { n = JSON.parse(JSON.stringify(e)); n.id = newId(); n.replaces = e.id; }
      else if (old) return; // ya existe (anulado): no se resucita
      add.push(entryToMov(n, sueldos)); applied.push({ add: n });
      if (n.replaces && known[n.replaces] && !known[n.replaces].del) applied.push({ del: n.replaces });
    });
    return { add: add, anular: anular, applied: applied };
  }

  // Los pagos del cierre ya son movimientos: la lista de «pagos registrados» sale de ahí.
  function deriveClosings(entries) {
    return C.live(entries).filter(function (e) { return e.type === 'payment' && /^Cierre /.test(e.note || '') && e.sp.length === 1; })
      .map(function (e) { return { id: e.id, month: C.monthKey(e.date), from: e.paidBy, to: e.sp[0][0], cents: e.cents, cur: e.cur, date: e.date, at: e.at, by: e.by }; })
      .sort(function (a, b) { return (b.at || '') < (a.at || '') ? -1 : (b.at || '') > (a.at || '') ? 1 : 0; });
  }

  function rowToRec(r) {
    return { id: r.id, desc: r.descripcion, cents: r.monto_estimado_centavos, cur: r.moneda, day: r.dia_mes, cat: r.categoria || 'otros', paidBy: r.pagador_id, next: r.proximo_vencimiento, active: !!r.activo };
  }
  function recToPayload(r) {
    return { id: r.id, descripcion: r.desc, monto_estimado_centavos: r.cents, moneda: r.cur, dia_mes: r.day, categoria: r.cat, pagador_id: r.paidBy, proximo_vencimiento: r.next, activo: !!r.active };
  }
  // Mismo día del mes siguiente (el 31 en un mes de 30 días cae el 30).
  function addMonth(iso, day) {
    var p = String(iso).split('-'), y = +p[0], m = +p[1] + 1;
    if (m > 12) { m = 1; y++; }
    var last = new Date(Date.UTC(y, m, 0)).getUTCDate(), d = Math.min(day || +p[2], last);
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
  }
  // Primer vencimiento a partir de una fecha (inclusive) para «día N de cada mes».
  function firstDue(fromIso, day) {
    var p = String(fromIso).split('-'), y = +p[0], m = +p[1];
    var last = new Date(Date.UTC(y, m, 0)).getUTCDate(), d = Math.min(day, last);
    var cand = y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
    return cand >= fromIso ? cand : addMonth(cand, day);
  }
  // Los vencimientos de hoy más lo atrasado, y lo que cae en los próximos `days` días.
  function dueSoon(recs, today, days) {
    var lim = new Date(Date.parse(today + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
    return (recs || []).filter(function (r) { return r.active && r.next && r.next <= lim; }).sort(function (a, b) { return a.next < b.next ? -1 : a.next > b.next ? 1 : 0; });
  }

  function snapshotToState(d) {
    var members = personasToMembers(d.personas);
    var ledger = {};
    (d.movimientos || []).forEach(function (r) {
      var e = rowToEntry(r), mk = C.monthKey(e.date);
      (ledger[mk] = ledger[mk] || {})[e.id] = e;
    });
    var cfg = d.config || {};
    return {
      sueldos: (d.sueldos || []).map(function (r) { return { id: r.id, persona: r.persona_id, desde: r.desde, cents: r.monto_centavos, cur: r.moneda, note: r.nota || '', by: r.creado_por || null }; }),
      recs: (d.recurrentes || []).map(rowToRec),
      lotes: (d.lotes || []).filter(function (l) { return String(l.estado) === 'activo'; }).map(function (l) { return { id: String(l.id), origen: String(l.origen), fecha: String(l.fecha), cantidad: Number(l.cantidad) || 0 }; }),
      group: members.length ? { name: cfg.nombre_grupo || 'Casa', cur: cfg.moneda_base || 'ARS', members: members } : null,
      ledger: ledger
    };
  }

  function applyPlan(ledger, applied) {
    var out = Object.assign({}, ledger);
    applied.forEach(function (a) {
      if (a.add) { var mk = C.monthKey(a.add.date); out[mk] = Object.assign({}, out[mk]); out[mk][a.add.id] = a.add; }
      else Object.keys(out).forEach(function (mk) {
        if (out[mk][a.del]) { out[mk] = Object.assign({}, out[mk]); out[mk][a.del] = Object.assign({}, out[mk][a.del], { del: true }); }
      });
    });
    return out;
  }

  return {
    decodeCfg: decodeCfg, personasToMembers: personasToMembers, membersToPersonas: membersToPersonas, rowToEntry: rowToEntry,
    entryToMov: entryToMov, repartoModo: repartoModo, planWrites: planWrites, deriveClosings: deriveClosings,
    snapshotToState: snapshotToState, applyPlan: applyPlan, repartoInfo: repartoInfo,
    rowToRec: rowToRec, recToPayload: recToPayload, addMonth: addMonth, firstDue: firstDue, dueSoon: dueSoon
  };
});
