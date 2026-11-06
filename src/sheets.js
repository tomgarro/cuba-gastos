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
    if (r.anulado) e.del = true;
    return e;
  }

  // 'igual' solo si el reparto es exactamente el que daría dividir en partes iguales; si no, 'exacto'.
  function repartoModo(e) {
    var ids = e.sp.map(function (x) { return x[0]; });
    var eq = C.splitEqual(e.cents, ids, 0);
    var a = eq.map(function (x) { return x[1]; }).sort(function (x, y) { return x - y; }).join();
    var b = e.sp.map(function (x) { return x[1]; }).sort(function (x, y) { return x - y; }).join();
    return a === b ? 'igual' : 'exacto';
  }

  function entryToMov(e) {
    var m = {
      id: e.id, tipo: e.type === 'payment' ? 'pago' : 'gasto', fecha: e.date, descripcion: e.desc, monto_centavos: e.cents, moneda: e.cur || 'ARS',
      pagador_id: e.paidBy, reparto_modo: repartoModo(e), reparto: e.sp, categoria: e.cat || '', nota: e.note || '',
      origen: e.src || 'manual', creado_por: e.by || ''
    };
    if (e.lote) m.lote_id = e.lote;
    if (e.replaces) m.reemplaza_id = e.replaces;
    return m;
  }

  // Los movimientos solo se agregan: una edición es «agregar uno nuevo que reemplaza al viejo»
  // (el backend anula el viejo en el mismo pedido). Borrar = anular.
  // list: entradas como las arma la app (con `del` para borrar). known: { id: entrada vigente }.
  function planWrites(list, known, newId) {
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
      add.push(entryToMov(n)); applied.push({ add: n });
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

  function snapshotToState(d) {
    var members = personasToMembers(d.personas);
    var ledger = {};
    (d.movimientos || []).forEach(function (r) {
      var e = rowToEntry(r), mk = C.monthKey(e.date);
      (ledger[mk] = ledger[mk] || {})[e.id] = e;
    });
    var cfg = d.config || {};
    return {
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
    snapshotToState: snapshotToState, applyPlan: applyPlan
  };
});
