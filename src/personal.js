(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'), require('crypto').webcrypto);
  else root.CubaPersonal = factory(root.CubaCore, root.crypto);
})(typeof self !== 'undefined' ? self : this, function (C, wc) {
  'use strict';

  // Pestaña «Personal»: la economía propia de cada uno. Todo se guarda CIFRADO (AES-GCM) con una clave que vive
  // solo en el dispositivo; a la Sheet llegan bloques ilegibles (ni la otra persona ni Google ni el repo ven nada).
  // Los movimientos son eventos que solo se agregan: g = gasto, x = anula, p = tope del mes por categoría,
  // m = meta de ahorro, a = aporte a una meta.

  var ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // base32 sin O/I/0/1: se dicta y se tipea sin confusión

  /* ---------------- clave y cifrado ---------------- */
  function b64(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); }
  function unb64(t) { var s = atob(t), o = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; }

  function codigoDe(bytes) {   // 32 bytes -> 52 letras + 1 de control, en grupos de 4
    var bits = '', out = '', i;
    for (i = 0; i < bytes.length; i++) bits += ('00000000' + bytes[i].toString(2)).slice(-8);
    while (bits.length % 5) bits += '0';
    var suma = 0;
    for (i = 0; i < bits.length; i += 5) { var v = parseInt(bits.substr(i, 5), 2); suma = (suma + v * (i / 5 + 1)) % 32; out += ABC[v]; }
    out += ABC[suma];
    return out.replace(/(.{4})/g, '$1-').replace(/-$/, '');
  }
  function claveDeCodigo(codigo) {   // devuelve los 32 bytes o null si no es un código válido
    var t = String(codigo || '').toUpperCase().replace(/[^A-Z2-9]/g, '').replace(/[O]/g, '').replace(/[I]/g, '');
    if (t.length !== 53) return null;
    var bits = '', suma = 0, i;
    for (i = 0; i < 52; i++) { var v = ABC.indexOf(t[i]); if (v < 0) return null; suma = (suma + v * (i + 1)) % 32; bits += ('00000' + v.toString(2)).slice(-5); }
    if (ABC.indexOf(t[52]) !== suma) return null;
    var bytes = new Uint8Array(32);
    for (i = 0; i < 32; i++) bytes[i] = parseInt(bits.substr(i * 8, 8), 2);
    return bytes;
  }
  function nuevaClave() { var k = new Uint8Array(32); wc.getRandomValues(k); return k; }
  function importar(bytes) { return wc.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']); }

  function cifrar(bytes, obj) {
    var iv = new Uint8Array(12); wc.getRandomValues(iv);
    return importar(bytes).then(function (k) {
      return wc.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, new TextEncoder().encode(JSON.stringify(obj)));
    }).then(function (ct) {
      var ctb = new Uint8Array(ct), all = new Uint8Array(12 + ctb.length); all.set(iv, 0); all.set(ctb, 12);
      return b64(all);
    });
  }
  function descifrar(bytes, blob) {   // null si la clave no corresponde o el bloque fue tocado
    return importar(bytes).then(function (k) {
      var all = unb64(blob);
      return wc.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, k, all.slice(12));
    }).then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); }, function () { return null; });
  }

  /* ---------------- fechas ---------------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function diasDelMes(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function addMes(fecha, n) {
    var y = +fecha.slice(0, 4), m = +fecha.slice(5, 7) - 1 + n, d = +fecha.slice(8, 10);
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + pad(m + 1) + '-' + pad(Math.min(d, diasDelMes(y, m + 1)));
  }
  function addDias(fecha, n) { return new Date(Date.parse(fecha + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }

  /* ---------------- carga rápida ---------------- */
  // «almuerzo 4500», «uber 3.200 ayer», «netflix u$s 10», «tele 120000 en 6 cuotas»
  function leer(texto, hoy) {
    var t = String(texto || ''), fecha = hoy, cuotas = 0, m;
    if ((m = /\b(?:en\s+)?(\d{1,2})\s*(?:cuotas?|c)\b/i.exec(t))) { cuotas = +m[1]; t = t.replace(m[0], ' '); }
    if (/\banteayer\b/i.test(t)) { fecha = addDias(hoy, -2); t = t.replace(/\banteayer\b/i, ' '); }
    else if (/\bayer\b/i.test(t)) { fecha = addDias(hoy, -1); t = t.replace(/\bayer\b/i, ' '); }
    else if (/\bhoy\b/i.test(t)) t = t.replace(/\bhoy\b/i, ' ');
    var q = C.quickParse(t);
    if (!q) return null;
    if (cuotas < 2 || cuotas > 36) cuotas = 0;
    return { desc: q.desc, cents: q.cents, cur: q.cur, cat: q.cat, fecha: fecha, cuotas: cuotas };
  }

  function nuevoId() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // Un gasto (o varios si es en cuotas) listo para guardar: las cuotas suman exacto el total y caen un mes después de la otra.
  function armarGasto(l, id) {
    var base = id || nuevoId();
    if (!l.cuotas) return [{ id: base, t: 'g', f: l.fecha, d: l.desc, c: l.cents, m: l.cur, k: l.cat }];
    var n = l.cuotas, parte = Math.floor(l.cents / n), resto = l.cents - parte * n, out = [];
    for (var i = 0; i < n; i++) {
      out.push({ id: base + '-' + (i + 1), t: 'g', f: addMes(l.fecha, i), d: l.desc + ' (' + (i + 1) + '/' + n + ')', c: parte + (i < resto ? 1 : 0), m: l.cur, k: l.cat, q: [i + 1, n], gr: base });
    }
    return out;
  }

  /* ---------------- estado a partir de los eventos ---------------- */
  function armar(eventos) {
    var gastos = {}, anula = {}, presup = {}, metas = {}, aportes = [], vistos = {}, deu = {}, cobros = [], alias = null;
    (eventos || []).forEach(function (e) {
      if (!e || !e.id) return;
      if (e.t === 'g') gastos[e.id] = e;
      else if (e.t === 'x') anula[e.ref] = true;
      else if (e.t === 'p') { if (!presup[e.k] || presup[e.k].ts <= (e.ts || 0)) presup[e.k] = { c: e.c, m: e.m || 'ARS', ts: e.ts || 0 }; }
      else if (e.t === 'm') metas[e.id] = e;
      else if (e.t === 'a') aportes.push(e);
      else if (e.t === 'd') deu[e.id] = e;
      else if (e.t === 'r') cobros.push(e);
      else if (e.t === 'h') { if (!alias || alias.ts <= (e.ts || 0)) alias = { v: String(e.v || ''), ts: e.ts || 0 }; }
      else if (e.t === 'o') vistos[e.ref] = true;   // «está bien»: no vuelve a aparecer en Para revisar
    });
    var lista = Object.keys(gastos).filter(function (k) { return !anula[k]; }).map(function (k) { return gastos[k]; })
      .sort(function (a, b) { return a.f < b.f ? 1 : a.f > b.f ? -1 : a.id < b.id ? 1 : -1; });
    Object.keys(presup).forEach(function (k) { if (!(presup[k].c > 0)) delete presup[k]; });
    var ms = Object.keys(metas).filter(function (k) { return !anula[k]; }).map(function (k) {
      var m = metas[k], hechos = aportes.filter(function (a) { return a.meta === k && !anula[a.id]; });
      return { id: k, n: m.n, c: m.c, m: m.m || 'ARS', aportado: hechos.reduce(function (s, a) { return s + a.c; }, 0), aportes: hechos };
    });
    var amigos = [], vistoN = {};
    var deudas = Object.keys(deu).filter(function (k) { return !anula[k]; }).map(function (k) {
      var d = deu[k], pag = cobros.filter(function (r) { return r.ref === k && !anula[r.id]; }).reduce(function (a, r) { return a + r.c; }, 0);
      return { id: k, f: d.f, d: d.d, w: d.w, c: d.c, m: d.m || 'ARS', cp: d.cp, det: d.det || [], pagado: Math.min(pag, d.c), pend: Math.max(0, d.c - pag) };
    }).sort(function (a, b) { return a.f < b.f ? 1 : a.f > b.f ? -1 : a.id < b.id ? 1 : -1; });
    deudas.forEach(function (d) { var k = String(d.w).toLowerCase(); if (!vistoN[k]) { vistoN[k] = 1; amigos.push(d.w); } });
    return { gastos: lista, presup: presup, metas: ms, vistos: vistos, deudas: deudas, amigos: amigos, alias: alias ? alias.v : '' };
  }

  // Une lo que hay en el celular con lo que bajó de la Sheet (mismo id = mismo evento).
  function unir(locales, remotos) {
    var m = {};
    (locales || []).concat(remotos || []).forEach(function (e) { if (e && e.id && !m[e.id]) m[e.id] = e; });
    return Object.keys(m).map(function (k) { return m[k]; });
  }

  /* ---------------- números del mes ---------------- */
  function statsMes(st, mes, cur, sueldo, hoy) {
    var r = { total: 0, count: 0, cats: {}, tope: {}, alertas: [], proyeccion: null, libre: null, porDia: null, cuotasFuturas: 0 };
    st.gastos.forEach(function (g) {
      if ((g.m || 'ARS') !== cur) return;
      if (g.f.slice(0, 7) === mes) { r.total += g.c; r.count++; r.cats[g.k || 'otros'] = (r.cats[g.k || 'otros'] || 0) + g.c; }
      else if (g.f.slice(0, 7) > mes && g.q) r.cuotasFuturas += g.c;
    });
    Object.keys(st.presup).forEach(function (k) {
      var p = st.presup[k]; if (p.m !== cur) return;
      var gastado = r.cats[k] || 0, pct = Math.round(gastado * 100 / p.c);
      var estado = gastado > p.c ? 'pasado' : pct >= 80 ? 'cerca' : 'ok';
      r.tope[k] = { tope: p.c, gastado: gastado, pct: pct, estado: estado };
      if (estado !== 'ok') r.alertas.push({ k: k, estado: estado, pct: pct });
    });
    var y = +mes.slice(0, 4), mm = +mes.slice(5, 7), dim = diasDelMes(y, mm);
    if (hoy && hoy.slice(0, 7) === mes) {
      var d = +hoy.slice(8, 10);
      r.proyeccion = d >= 5 ? Math.round(r.total / d * dim) : null;   // antes del día 5 el ritmo no dice nada
      r.diasRestantes = dim - d + 1;
    }
    if (sueldo > 0) {
      r.libre = sueldo - r.total;
      if (r.diasRestantes) r.porDia = r.libre > 0 ? Math.floor(r.libre / r.diasRestantes) : 0;
    }
    return r;
  }

  /* ---------------- cosas raras ---------------- */
  var fold = function (s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); };
  var gapDias = function (a, b) { return Math.abs(Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000)); };

  // Mismo monto y moneda, fechas pegadas y descripción parecida: probablemente cargado dos veces. Las cuotas de una misma compra no cuentan.
  function duplicados(gastos) {
    var out = [], l = gastos.slice();
    for (var i = 0; i < l.length; i++) for (var j = i + 1; j < l.length; j++) {
      var a = l[i], b = l[j];
      if (a.c !== b.c || (a.m || 'ARS') !== (b.m || 'ARS') || gapDias(a.f, b.f) > 1) continue;
      if (a.gr && a.gr === b.gr) continue;
      var fa = fold(a.d).split(' ')[0], fb = fold(b.d).split(' ')[0];
      if (fa && fa === fb) out.push([a, b]);
    }
    return out;
  }
  // Un gasto mucho más grande que lo habitual de su categoría (solo con historia suficiente).
  function rarezas(gastos, hoy) {
    var por = {}, out = [];
    gastos.forEach(function (g) { if (!g.q) (por[g.k + g.m] = por[g.k + g.m] || []).push(g); });
    Object.keys(por).forEach(function (k) {
      var l = por[k]; if (l.length < 6) return;
      var cs = l.map(function (g) { return g.c; }).sort(function (a, b) { return a - b; }), med = cs[Math.floor(cs.length / 2)];
      l.forEach(function (g) { if (g.c >= med * 3 && g.f >= addDias(hoy, -35)) out.push({ g: g, mediana: med }); });
    });
    return out;
  }

  /* ---------------- compras con amigos ---------------- */
  var YO = '__yo';
  // items: [{ d, cents, w: [claves] }]. Cada ítem se reparte parejo entre quienes lo comparten y siempre suma exacto.
  function repartirCompra(items) {
    var tot = {}, det = {};
    items.forEach(function (it, i) {
      var w = it.w && it.w.length ? it.w : [YO], n = w.length, base = Math.floor(it.cents / n), rem = it.cents - base * n, start = i % n;
      w.forEach(function (k, j) {
        var c = base + (((j - start + n) % n) < rem ? 1 : 0);
        tot[k] = (tot[k] || 0) + c; (det[k] = det[k] || []).push({ d: it.d, c: c, n: n });
      });
    });
    return { tot: tot, det: det };
  }
  // c: { id, comercio, fecha, cur, cat, items, nombres:{clave:nombre}, pagados:{clave:true} } -> eventos para Personal
  function armarCompra(c) {
    var r = repartirCompra(c.items), ev = [], total = c.items.reduce(function (a, i) { return a + i.cents; }, 0), n = 0;
    if (r.tot[YO] > 0) ev.push({ id: c.id + '-g', t: 'g', f: c.fecha, d: c.comercio, c: r.tot[YO], m: c.cur, k: c.cat || 'otros', tot: total, cp: c.id });
    Object.keys(r.tot).forEach(function (k) {
      if (k === YO || !(r.tot[k] > 0)) return; n++;
      var id = c.id + '-d-' + n;
      ev.push({ id: id, t: 'd', f: c.fecha, d: c.comercio, w: c.nombres[k], c: r.tot[k], m: c.cur, cp: c.id, det: r.det[k].map(function (x) { return { d: x.d, c: x.c, n: x.n }; }) });
      if (c.pagados && c.pagados[k]) ev.push({ id: c.id + '-r-' + n, t: 'r', ref: id, c: r.tot[k], f: c.fecha });
    });
    return { eventos: ev, tot: r.tot, total: total };
  }
  function dm(f) { var p = String(f).split('-'); return +p[2] + '/' + +p[1]; }
  function plata(c, cur) { return C.fmt(c, cur, { noDecimals: cur === 'ARS' }); }
  // Mensaje para WhatsApp. lineas: [{ d, c, n?, comercio?, f? }]
  function textoWA(o) {
    var L = ['Hola ' + o.nombre + '! 👋 ' + (o.comercio ? 'Lo de ' + o.comercio + (o.fecha ? ' del ' + dm(o.fecha) : '') + ':' : 'Lo que me debés:')];
    o.lineas.forEach(function (x) { L.push('• ' + (x.comercio ? x.comercio + ' ' + dm(x.f) + ': ' : x.d + (x.n > 1 ? ' (entre ' + x.n + ')' : '') + ': ') + plata(x.c, o.cur)); });
    var tot = o.lineas.reduce(function (a, x) { return a + x.c; }, 0);
    L.push('Total: ' + plata(tot, o.cur));
    L.push(o.alias ? 'Pasámelo por Mercado Pago al alias ' + o.alias + ' 🙏' : 'Cuando puedas me lo pasás 🙏');
    return L.join('\n');
  }
  function textoGrupo(o) {
    var L = [o.comercio + (o.fecha ? ' ' + dm(o.fecha) : '') + ' 🧾 Cuentas:'];
    o.personas.forEach(function (p) { L.push('• ' + p.nombre + ': ' + plata(p.c, o.cur)); });
    if (o.alias) L.push('Alias de Mercado Pago: ' + o.alias);
    return L.join('\n');
  }

  /* ---------------- calendario ---------------- */
  function icsTxt(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); }
  function plegar(l) { var o = []; while (l.length > 74) { o.push(l.slice(0, 74)); l = ' ' + l.slice(74); } o.push(l); return o.join('\r\n'); }
  // items: [{ id, titulo, fecha:'AAAA-MM-DD', nota? }]  -> evento mensual con aviso el día anterior
  function ics(items, ahora) {
    var stamp = String(ahora || new Date().toISOString()).replace(/[-:]/g, '').replace(/\.\d+/, '').slice(0, 15) + 'Z';
    var L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cuba gastos//ES', 'CALSCALE:GREGORIAN'];
    items.forEach(function (it) {
      var d = it.fecha.replace(/-/g, '');
      L.push('BEGIN:VEVENT', 'UID:' + it.id + '@cuba-gastos', 'DTSTAMP:' + stamp, 'DTSTART;VALUE=DATE:' + d, 'DTEND;VALUE=DATE:' + addDias(it.fecha, 1).replace(/-/g, ''),
        'SUMMARY:' + icsTxt((it.icono || '💸') + ' ' + it.titulo));
      if (!it.unico) L.splice(L.length - 1, 0, 'RRULE:FREQ=MONTHLY');
      if (it.nota) L.push('DESCRIPTION:' + icsTxt(it.nota));
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsTxt(it.titulo), 'TRIGGER:' + (it.aviso || '-P1D'), 'END:VALARM', 'END:VEVENT');
    });
    L.push('END:VCALENDAR');
    return L.map(plegar).join('\r\n') + '\r\n';
  }

  return {
    nuevaClave: nuevaClave, codigoDe: codigoDe, claveDeCodigo: claveDeCodigo, cifrar: cifrar, descifrar: descifrar,
    leer: leer, armarGasto: armarGasto, nuevoId: nuevoId, armar: armar, unir: unir, statsMes: statsMes,
    duplicados: duplicados, rarezas: rarezas, ics: ics, YO: YO, repartirCompra: repartirCompra, armarCompra: armarCompra, textoWA: textoWA, textoGrupo: textoGrupo, addMes: addMes, addDias: addDias
  };
});
