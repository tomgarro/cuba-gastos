(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.CubaAvisos = factory(root.CubaCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  // Todo calculado en el celular con lo que ya está en la Sheet: no se manda nada afuera.
  // Series = gastos de servicios que se repiten (luz, agua, alquiler, streaming…), agrupados por nombre sin el mes.
  var SERIE_CATS = { alquiler: 1, expensas: 1, luz: 1, agua: 1, gas: 1, internet: 1, streaming: 1, seguro: 1, impuestos: 1 };
  var UMBRAL = { streaming: 5, internet: 5, seguro: 5 };   // lo que sube de a poco avisa antes; el resto desde 10 %
  var mk = function (d) { return String(d).slice(0, 7); };
  var dayOf = function (d) { return +String(d).slice(8, 10); };
  var monthIdx = function (m) { return +m.slice(0, 4) * 12 + +m.slice(5, 7) - 1; };
  var daysBetween = function (a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); };

  function claveSerie(e) {
    var base = String(e.desc || '').split('|')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9+ ]/g, ' ').replace(/\s+/g, ' ').trim();
    return (e.cat || 'otros') + ':' + base + ':' + (e.cur || 'ARS');
  }
  function series(entries) {
    var out = {};
    (entries || []).forEach(function (e) {
      if (e.del || e.type === 'payment' || !SERIE_CATS[e.cat] || e.ev) return;
      var k = claveSerie(e), s = out[k] || (out[k] = { key: k, label: String(e.desc).split('|')[0].trim(), cat: e.cat, cur: e.cur || 'ARS', items: [] });
      s.items.push({ date: e.date, cents: e.cents });
    });
    Object.keys(out).forEach(function (k) {
      // un valor por mes (el último cargado): si se anotó dos veces en el mes manda la más nueva
      var byM = {}; out[k].items.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }).forEach(function (it) { byM[mk(it.date)] = it; });
      out[k].items = Object.keys(byM).sort().map(function (m) { return byM[m]; });
    });
    return out;
  }

  // «La luz subió 23 %»: el último valor contra el anterior (mes inmediato o el anterior al anterior), si es reciente.
  function aumentos(entries, today) {
    var res = [], S = series(entries);
    Object.keys(S).forEach(function (k) {
      var s = S[k], n = s.items.length; if (n < 2) return;
      var last = s.items[n - 1], prev = s.items[n - 2];
      if (daysBetween(last.date, today) > 45 || monthIdx(mk(last.date)) - monthIdx(mk(prev.date)) > 2 || prev.cents <= 0) return;
      var pct = Math.round((last.cents - prev.cents) * 100 / prev.cents);
      if (pct >= (UMBRAL[s.cat] || 10)) res.push({ key: k + '@' + mk(last.date), cat: s.cat, label: s.label, pct: pct, prev: prev.cents, last: last.cents, cur: s.cur });
    });
    return res.sort(function (a, b) { return b.pct - a.pct; });
  }

  // «No cargaste el agua»: se cargó en al menos 2 de los últimos 3 meses, este todavía no y ya pasó el día de siempre (+5).
  function faltantes(entries, recs, today) {
    var res = [], S = series(entries), cur = mk(today), ci = monthIdx(cur);
    var cubiertas = {}; (recs || []).forEach(function (r) { if (r.active) cubiertas[r.cat] = 1; });   // los recurrentes ya avisan solos en «Por pagar»
    Object.keys(S).forEach(function (k) {
      var s = S[k]; if (cubiertas[s.cat]) return;
      var meses = {}, dias = [];
      s.items.forEach(function (it) { var d = ci - monthIdx(mk(it.date)); if (d >= 1 && d <= 3) { meses[d] = 1; dias.push(dayOf(it.date)); } });
      if (Object.keys(meses).length < 2) return;
      if (s.items.some(function (it) { return mk(it.date) === cur; })) return;
      dias.sort(function (a, b) { return a - b; });
      var tipico = dias[Math.floor(dias.length / 2)], desde = Math.max(8, tipico + 5);
      if (dayOf(today) >= desde) res.push({ key: k + '@' + cur, cat: s.cat, label: s.label, day: tipico });
    });
    return res;
  }

  // Suscripciones: recurrentes de streaming + lo que se viene cargando de streaming. Anual = 12 meses del valor actual.
  function suscripciones(recs, entries, today) {
    var out = {}, S = series(entries);
    (recs || []).forEach(function (r) { if (r.active && r.cat === 'streaming') out['r:' + String(r.desc).toLowerCase()] = { label: r.desc, cents: r.cents, cur: r.cur }; });
    Object.keys(S).forEach(function (k) {
      var s = S[k]; if (s.cat !== 'streaming') return;
      var last = s.items[s.items.length - 1]; if (daysBetween(last.date, today) > 75) return;
      var dup = Object.keys(out).some(function (o) { return out[o].label.toLowerCase().indexOf(s.label.toLowerCase()) >= 0 || s.label.toLowerCase().indexOf(out[o].label.toLowerCase()) >= 0; });
      if (!dup) out[k] = { label: s.label, cents: last.cents, cur: s.cur };
    });
    var list = Object.keys(out).map(function (k) { return out[k]; }).sort(function (a, b) { return b.cents - a.cents; });
    var tot = {}; list.forEach(function (x) { tot[x.cur] = (tot[x.cur] || 0) + x.cents; });
    return { list: list, mensual: tot, anual: Object.keys(tot).reduce(function (m, c) { m[c] = tot[c] * 12; return m; }, {}) };
  }

  // «¿Me alcanza?»: tu sueldo, tu parte de lo compartido que ya va del mes y lo que vence antes de fin de mes (tu parte, estimada).
  function meAlcanza(o) {
    var ids = o.ids, me = o.me, today = o.today, cur = mk(today);
    var sal = C.salaryAt(o.sueldos, me, today); if (!sal || !(sal.cents > 0)) return null;
    var w = C.salaryWeights(o.sueldos, ids, today), share = function (cents) {
      if (w.weights) { var tot = ids.reduce(function (s, i) { return s + w.weights[i]; }, 0); return Math.round(cents * w.weights[me] / tot); }
      return Math.round(cents / ids.length);
    };
    var gastado = 0;
    (o.entries || []).forEach(function (e) {
      if (e.del || e.type === 'payment' || e.ev || (e.cur || 'ARS') !== sal.cur || mk(e.date) !== cur) return;
      e.sp.forEach(function (x) { if (x[0] === me) gastado += x[1]; });
    });
    var fin = cur + '-' + ('0' + new Date(Date.UTC(+cur.slice(0, 4), +cur.slice(5, 7), 0)).getUTCDate()).slice(-2), porPagar = 0, items = [];
    (o.recs || []).forEach(function (r) {
      if (!r.active || r.cur !== sal.cur || !r.next || r.next > fin) return;
      var mine = share(r.cents); porPagar += mine; items.push({ desc: r.desc, cents: mine, next: r.next });
    });
    return { cur: sal.cur, sueldo: sal.cents, gastado: gastado, porPagar: porPagar, items: items, queda: sal.cents - gastado - porPagar };
  }

  // Alquiler (u otro recurrente) con ajuste cada N meses por índice: cuando llega la fecha se carga el % y se recalcula el monto, a pesos enteros.
  function ajusteToca(rec, today) { return !!(rec && rec.active && rec.adj > 0 && rec.adjNext && rec.adjNext <= today); }
  function aplicarAjuste(rec, pct, addMonth) {
    var p = Number(pct);
    if (!isFinite(p) || p <= -50 || p > 300) return null;
    var cents = Math.round(rec.cents * (1 + p / 100) / 100) * 100;
    if (!(cents > 0)) return null;
    var dd = +String(rec.adjNext).slice(8, 10), nx = rec.adjNext; for (var i = 0; i < rec.adj; i++) nx = addMonth(nx, dd);
    return Object.assign({}, rec, { cents: cents, adjNext: nx });
  }

  return { series: series, aumentos: aumentos, faltantes: faltantes, suscripciones: suscripciones, meAlcanza: meAlcanza, ajusteToca: ajusteToca, aplicarAjuste: aplicarAjuste };
});
