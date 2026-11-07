(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'), require('./personal.js'));
  else root.CubaIA = factory(root.CubaCore, root.CubaPersonal);
})(typeof self !== 'undefined' ? self : this, function (C, P) {
  'use strict';

  // Lo que Cuba hace con los números antes (y después) de hablar con Gemini. Todo lo de acá es local y se prueba solo:
  // a Gemini solo viajan descripciones y montos agregados, nunca nombres ni sueldos.

  var fold = function (s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); };
  var MESES = { enero: 1, febrero: 1, marzo: 1, abril: 1, mayo: 1, junio: 1, julio: 1, agosto: 1, septiembre: 1, setiembre: 1, octubre: 1, noviembre: 1, diciembre: 1, ene: 1, feb: 1, mar: 1, abr: 1, may: 1, jun: 1, jul: 1, ago: 1, sep: 1, set: 1, oct: 1, nov: 1, dic: 1, de: 1, del: 1, y: 1 };
  var NUM = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
    veinte: 20, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
    cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900 };
  var UNIDAD = { mil: 1000, luca: 1000, lucas: 1000, palo: 1e6, palos: 1e6, millon: 1e6, millones: 1e6 };

  /* ------- voz libre: «el súper 15 mil, un café 3 lucas y ayer la farmacia 8000» ------- */
  // «15 mil», «quince mil», «3 lucas», «un palo», «1,5 palos» → números; el resto queda igual.
  function numerosHablados(texto) {
    var tk = String(texto).toLowerCase().replace(/(\d)k\b/g, '$1 mil').replace(/([,;+])(?!\d)/g, ' $1 ').split(/\s+/).filter(Boolean), out = [], i = 0;
    var ft = tk.map(function (w) { return w.normalize('NFD').replace(/[̀-ͯ]/g, ''); });   // para buscar sin tildes; se devuelve el texto original
    while (i < tk.length) {
      var j = i, suma = 0, hubo = false;
      var dig = /^\d+(?:[.,]\d+)?$/.test(ft[i]) && !/^\d{1,3}(?:\.\d{3})+$/.test(ft[i]);   // «15.200» ya es un monto escrito: no se toca
      if (dig) { suma = parseFloat(ft[i].replace(',', '.')); hubo = true; j = i + 1; }
      else {
        while (j < tk.length && (NUM[ft[j]] != null || (ft[j] === 'y' && hubo && NUM[ft[j + 1]] != null))) { if (ft[j] !== 'y') { suma += NUM[ft[j]]; hubo = true; } j++; }
      }
      var u = UNIDAD[ft[j]];
      if (u && (hubo || !dig)) { out.push(String(Math.round((hubo ? suma : 1) * u))); i = j + 1; continue; }
      if (!hubo && UNIDAD[ft[i]]) { out.push(String(UNIDAD[ft[i]])); i++; continue; }   // «mil pesos»
      out.push(tk[i]); i++;
    }
    return out.filter(function (w) { return w !== 'pesos' && w !== 'peso'; }).join(' ');
  }
  function trozos(texto, hoy) {
    var t = numerosHablados(String(texto || '')), fecha = hoy, ft = function (x) { return x.normalize('NFD').replace(/[̀-ͯ]/g, ''); };
    if (/\banteayer\b/.test(t)) { fecha = P.addDias(hoy, -2); t = t.replace(/\banteayer\b/g, ' '); }
    else if (/\bayer\b/.test(t)) { fecha = P.addDias(hoy, -1); t = t.replace(/\bayer\b/g, ' '); }
    t = t.replace(/\bhoy\b/g, ' ');
    var partes = ft(t).length ? t.split(/\s+(?:[,;+]|y|mas|más|despues|después|luego)\s+/) : [], chunks = [], pend = '';
    partes.forEach(function (p) {
      p = p.trim(); if (!p) return;
      if (!/\d/.test(p)) { pend += (pend ? ' ' : '') + p; return; }   // «pizza y birra 8000»: lo que no trae monto se pega al siguiente
      chunks.push((pend ? pend + ' ' : '') + p); pend = '';
    });
    var rel = /^(?:(?:fue|fueron|gasté|gaste|pagué|pague|compré|compre|puse|pagamos|gastamos|compramos|despues|y)\s+)*(?:(?:el|la|los|las|un|una|unos|unas)\s+)?/;
    return chunks.map(function (c) { return P.leer(c.replace(rel, ''), fecha); }).filter(Boolean);
  }

  /* ------- detective de suscripciones ------- */
  var NO_FIJOS = { super: 1, comida: 1, transporte: 1, ocio: 1, ropa: 1, regalo: 1, viaje: 1, mascota: 1, salud: 1 };
  function clave(desc) { return fold(desc).split(' ').filter(function (w) { return w.length > 1 && !MESES[w] && !/^\d/.test(w); }).slice(0, 2).join(' '); }
  function mediana(l) { var s = l.slice().sort(function (a, b) { return a - b; }); return s[Math.floor(s.length / 2)]; }
  // Gastos que se repiten todos los meses con un monto parecido y que todavía no están como recurrentes.
  function suscripciones(entries, recs, hoy) {
    var desde = P.addMes(hoy.slice(0, 7) + '-01', -6).slice(0, 7), ult2 = [hoy.slice(0, 7), P.addMes(hoy.slice(0, 7) + '-01', -1).slice(0, 7)], g = {};
    C.live(entries || []).forEach(function (e) {
      if (e.type !== 'expense' || e.ev || NO_FIJOS[e.cat]) return;
      var k = clave(e.desc), m = C.monthKey(e.date); if (!k || m < desde || m > hoy.slice(0, 7)) return;
      var x = g[k + '|' + (e.cur || 'ARS')] = g[k + '|' + (e.cur || 'ARS')] || { k: k, cur: e.cur || 'ARS', meses: {}, n: 0, montos: [], ult: null, cat: e.cat };
      x.meses[m] = 1; x.n++; x.montos.push(e.cents); if (!x.ult || e.date > x.ult.date) x.ult = e;
    });
    var yaRec = (recs || []).map(function (r) { return clave(r.desc || r.descripcion || ''); }).filter(Boolean);
    return Object.keys(g).map(function (k) { return g[k]; }).filter(function (x) {
      var nm = Object.keys(x.meses).length, med = mediana(x.montos);
      if (nm < 3 || x.n > nm * 1.5 || !ult2.some(function (m) { return x.meses[m]; })) return false;
      if (!x.montos.every(function (c) { return c >= med * 0.7 && c <= med * 1.35; })) return false;
      return !yaRec.some(function (r) { return r === x.k || r.indexOf(x.k) >= 0 || x.k.indexOf(r) >= 0; });
    }).map(function (x) {
      return { clave: x.k, desc: x.ult.desc, cents: x.ult.cents, cur: x.cur, cat: x.cat || 'otros', meses: Object.keys(x.meses).length, anual: x.ult.cents * 12, fecha: x.ult.date, paga: x.ult.paidBy };
    }).sort(function (a, b) { return b.anual - a.anual; });
  }

  /* ------- ¿es caro? contra tu propia historia ------- */
  function esCaro(entries, q) {
    var vivos = C.live(entries || []).filter(function (e) { return e.type === 'expense' && !e.ev && (e.cur || 'ARS') === q.cur && e.id !== q.id; }), k = clave(q.desc);
    var propios = k ? vivos.filter(function (e) { return clave(e.desc) === k; }) : [], base = 'comercio';
    if (propios.length < 3) { propios = q.cat && q.cat !== 'otros' ? vivos.filter(function (e) { return e.cat === q.cat; }) : []; base = 'categoria'; if (propios.length < 5) return null; }
    var med = mediana(propios.map(function (e) { return e.cents; })), pct = Math.round((q.cents / med - 1) * 100);
    return { pct: pct, n: propios.length, base: base, mediana: med, nivel: pct >= 15 ? 'caro' : pct <= -15 ? 'barato' : 'normal' };
  }

  /* ------- antes de comprar ------- */
  // gastoMensual: lo que suele gastar al mes; libre y diasRestantes: de los números del mes (pueden ser null)
  function compra(cents, cuotas, gastoMensual, libre, diasRestantes) {
    var n = Math.max(1, cuotas || 1), cuota = Math.ceil(cents / n);
    var r = { cuota: cuota, cuotas: n, pctMes: gastoMensual > 0 ? Math.round(cuota * 100 / gastoMensual) : null, libreDespues: libre == null ? null : libre - cuota, porDiaDespues: null };
    if (r.libreDespues != null && diasRestantes) r.porDiaDespues = Math.max(0, Math.floor(r.libreDespues / diasRestantes));
    r.nivel = r.pctMes == null ? 'sin datos' : r.pctMes >= 40 ? 'pesada' : r.pctMes >= 15 ? 'mediana' : 'liviana';
    return r;
  }

  /* ------- datos agregados del mes para Gemini (sin nombres, sin sueldos) ------- */
  function datosMes(entries, mes, prevMes, cur) {
    var agg = function (m) {
      var r = { total: 0, n: 0, cats: {}, dias: {} };
      C.live(entries || []).forEach(function (e) {
        if (e.type !== 'expense' || e.ev || C.monthKey(e.date) !== m || (e.cur || 'ARS') !== cur) return;
        r.total += e.cents; r.n++; r.cats[e.cat || 'otros'] = (r.cats[e.cat || 'otros'] || 0) + e.cents;
        var d = new Date(Date.parse(e.date + 'T00:00:00Z')).getUTCDay(); r.dias[d] = (r.dias[d] || 0) + e.cents;
      });
      return r;
    };
    var a = agg(mes), b = agg(prevMes), DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    var top = Object.keys(a.cats).sort(function (x, y) { return a.cats[y] - a.cats[x]; }).slice(0, 6);
    var fuerte = Object.keys(a.dias).sort(function (x, y) { return a.dias[y] - a.dias[x]; })[0];
    return {
      mes: mes, moneda: cur, gastado: Math.round(a.total / 100), gastos: a.n, mes_anterior: Math.round(b.total / 100),
      variacion_pct: b.total ? Math.round((a.total / b.total - 1) * 100) : null,
      categorias: top.map(function (k) { var c = C.catInfo(k); return { categoria: c.n, monto: Math.round(a.cats[k] / 100), antes: Math.round((b.cats[k] || 0) / 100) }; }),
      dia_de_mas_gasto: fuerte != null ? DIAS[+fuerte] : ''
    };
  }

  /* ------- ticket por ítems ------- */
  // asign[i]: 'ambos' | 'yo' | 'otro'. Lo que se reparte suma exacto el ticket.
  function repartirTicket(items, asign) {
    var r = { ambos: 0, yo: 0, otro: 0, items: { ambos: [], yo: [], otro: [] } };
    items.forEach(function (it, i) { var k = asign[i] === 'yo' || asign[i] === 'otro' ? asign[i] : 'ambos'; r[k] += it.cents; r.items[k].push(it); });
    r.total = r.ambos + r.yo + r.otro;
    return r;
  }

  return { numerosHablados: numerosHablados, trozos: trozos, suscripciones: suscripciones, esCaro: esCaro, compra: compra, datosMes: datosMes, repartirTicket: repartirTicket, clave: clave };
});
