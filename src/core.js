(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CubaCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- categorías ----------
  var CATS = [
    { k: 'super', n: 'Supermercado', e: '🛒', w: ['super', 'supermercado', 'coto', 'carrefour', 'dia', 'jumbo', 'disco', 'chino', 'verdulería', 'verduleria', 'almacen', 'almacén', 'mercado'] },
    { k: 'comida', n: 'Salidas / comida', e: '🍽️', w: ['resto', 'restaurant', 'cena', 'almuerzo', 'cafe', 'café', 'bar', 'birra', 'cerveza', 'pizza', 'sushi', 'helado', 'delivery', 'rappi', 'pedidosya', 'mcdonald', 'burger'] },
    { k: 'alquiler', n: 'Alquiler', e: '🔑', w: ['alquiler', 'renta'] },
    { k: 'expensas', n: 'Expensas', e: '🏢', w: ['expensas', 'consorcio'] },
    { k: 'luz', n: 'Luz', e: '💡', w: ['luz', 'edenor', 'edesur', 'electricidad'] },
    { k: 'agua', n: 'Agua', e: '💧', w: ['agua', 'aysa'] },
    { k: 'gas', n: 'Gas', e: '🔥', w: ['gas', 'metrogas', 'naturgy'] },
    { k: 'internet', n: 'Internet y celular', e: '📶', w: ['internet', 'wifi', 'fibra', 'flow', 'personal flow', 'personal', 'fibertel', 'telecentro', 'movistar', 'claro', 'celular', 'telefono', 'teléfono'] },
    { k: 'streaming', n: 'Streaming', e: '📺', w: ['streaming', 'netflix', 'hbo', 'max', 'amazon prime', 'prime video', 'prime', 'disney', 'star+', 'paramount', 'apple tv', 'youtube premium', 'spotify', 'deezer', 'crunchyroll'] },
    { k: 'seguro', n: 'Seguros', e: '🛡️', w: ['seguro', 'seguros', 'póliza', 'poliza', 'sancor', 'mapfre'] },
    { k: 'impuestos', n: 'Impuestos', e: '🧾', w: ['abl', 'arba', 'patente', 'monotributo', 'afip', 'arca', 'impuesto', 'impuestos', 'rentas'] },
    { k: 'casa', n: 'Casa / varios', e: '🏠', w: ['limpieza', 'ferretería', 'ferreteria', 'muebles', 'plomero', 'electricista', 'bazar'] },
    { k: 'transporte', n: 'Transporte', e: '🚗', w: ['nafta', 'uber', 'cabify', 'sube', 'peaje', 'estacionamiento', 'taxi', 'tren', 'colectivo', 'subte', 'combustible', 'ypf', 'shell'] },
    { k: 'salud', n: 'Salud', e: '💊', w: ['farmacia', 'medico', 'médico', 'dentista', 'prepaga', 'remedio', 'kinesio', 'psicologo', 'psicólogo', 'analisis', 'análisis'] },
    { k: 'ocio', n: 'Ocio', e: '🎬', w: ['cine', 'teatro', 'recital', 'juego', 'steam', 'show', 'entrada', 'salida'] },
    { k: 'viaje', n: 'Viajes', e: '✈️', w: ['hotel', 'vuelo', 'aerolinea', 'aerolínea', 'airbnb', 'pasaje', 'hospedaje', 'viaje', 'excursion', 'excursión'] },
    { k: 'mascota', n: 'Mascota', e: '🐕', w: ['veterinaria', 'vete', 'alimento balanceado', 'perro', 'gato', 'cuba'] },
    { k: 'regalo', n: 'Regalos', e: '🎁', w: ['regalo', 'cumple', 'flores'] },
    { k: 'ropa', n: 'Ropa', e: '👕', w: ['ropa', 'zapatillas', 'remera', 'jean', 'campera', 'zara'] },
    { k: 'otros', n: 'Otros', e: '📦', w: [] },
    { k: 'pago', n: 'Pago entre nosotros', e: '🤝', w: [] }
  ];
  function catInfo(k) {
    for (var i = 0; i < CATS.length; i++) if (CATS[i].k === k) return CATS[i];
    return CATS[CATS.length - 2];
  }
  // Palabras completas (o frases): «gasto» no es «gas»; acepta plural simple («seguros», «expensas»).
  function guessCategory(desc) {
    var d = ' ' + String(desc || '').toLowerCase().replace(/[^a-z0-9áéíóúüñ+]+/g, ' ').trim() + ' ';
    for (var i = 0; i < CATS.length; i++) {
      for (var j = 0; j < CATS[i].w.length; j++) {
        var w = CATS[i].w[j];
        if (d.indexOf(' ' + w + ' ') >= 0 || d.indexOf(' ' + w + 's ') >= 0) return CATS[i].k;
      }
    }
    return 'otros';
  }

  // ---------- montos ----------
  // Interpreta "1.234,56", "1234.56", "15.200", "15200", "$ 1,5" -> centavos (entero)
  function parseAmount(input) {
    if (typeof input === 'number') return isFinite(input) ? Math.round(input * 100) : null;
    var s = String(input == null ? '' : input).trim();
    var neg = /^\s*-/.test(s) || /^\(.*\)$/.test(s);
    s = s.replace(/[^\d.,]/g, '');
    if (!s || !/\d/.test(s)) return null;
    var lastDot = s.lastIndexOf('.'), lastCom = s.lastIndexOf(',');
    var decSep = null;
    if (lastDot >= 0 && lastCom >= 0) {
      decSep = lastDot > lastCom ? '.' : ',';
    } else if (lastCom >= 0) {
      var nCom = (s.match(/,/g) || []).length;
      var afterCom = s.length - lastCom - 1;
      decSep = (nCom === 1 && afterCom >= 1 && afterCom <= 2) ? ',' : null;
    } else if (lastDot >= 0) {
      var nDot = (s.match(/\./g) || []).length;
      var afterDot = s.length - lastDot - 1;
      decSep = (nDot === 1 && afterDot >= 1 && afterDot <= 2) ? '.' : null;
    }
    var intPart = s, frac = '';
    if (decSep) {
      var idx = s.lastIndexOf(decSep);
      intPart = s.slice(0, idx);
      frac = s.slice(idx + 1);
    }
    intPart = intPart.replace(/[.,]/g, '');
    if (!intPart) intPart = '0';
    frac = (frac + '00').slice(0, 2);
    var cents = parseInt(intPart, 10) * 100 + parseInt(frac, 10);
    if (!isFinite(cents)) return null;
    return neg ? -cents : cents;
  }
  function strictCents(s) {
    var n = Number(String(s).trim());
    if (!isFinite(n)) return null;
    return Math.round(n * 100);
  }
  function group(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  function fmt(cents, cur, opts) {
    opts = opts || {};
    var neg = cents < 0, a = Math.abs(cents);
    var whole = Math.floor(a / 100), c = a % 100;
    var sym = cur === 'ARS' || !cur ? '$' : cur === 'USD' ? 'US$' : cur + ' ';
    var body = group(whole);
    if (!opts.noDecimals || c !== 0) body += ',' + (c < 10 ? '0' : '') + c;
    return (neg ? '-' : '') + sym + body;
  }

  // ---------- divisiones ----------
  function splitProportional(total, ids, weights) {
    var sum = 0, i;
    for (i = 0; i < ids.length; i++) sum += weights[i];
    if (!(sum > 0)) return null;
    var out = [], used = 0, rems = [];
    // Con enteros se calcula en BigInt: total × peso puede pasar de 2^53 (p. ej. 10^13 centavos × un sueldo en centavos).
    var big = typeof BigInt === 'function' && Number.isSafeInteger(total) && weights.every(function (w) { return Number.isSafeInteger(w) && w >= 0; });
    if (big) {
      var T = BigInt(total), W = weights.map(function (w) { return BigInt(w); }), SUM = BigInt(0);
      W.forEach(function (w) { SUM += w; });
      var ub = BigInt(0);
      for (i = 0; i < ids.length; i++) {
        var num = T * W[i], bs = num / SUM;
        out.push([ids[i], Number(bs)]); ub += bs; rems.push({ i: i, rem: num - bs * SUM });
      }
      used = Number(ub);
      var left0 = total - used;
      rems.sort(function (a, b) { return a.rem === b.rem ? a.i - b.i : (a.rem > b.rem ? -1 : 1); });
      for (var k0 = 0; k0 < left0; k0++) out[rems[k0 % rems.length].i][1] += 1;
      return out;
    }
    for (i = 0; i < ids.length; i++) {
      var exact = total * weights[i];
      var base = Math.floor(exact / sum);
      var rem = exact - base * sum;
      out.push([ids[i], base]);
      used += base;
      rems.push({ i: i, rem: rem });
    }
    var left = total - used;
    rems.sort(function (a, b) { return b.rem - a.rem || a.i - b.i; });
    for (var k = 0; k < left; k++) out[rems[k % rems.length].i][1] += 1;
    return out;
  }

  // ---------- sueldos ----------
  // sueldos: [{ persona, desde: 'AAAA-MM-DD', cents, cur }]. Vigente a una fecha = mayor `desde` <= fecha (si empatan, el último cargado).
  function salaryAt(sueldos, id, date) {
    var best = null;
    (sueldos || []).forEach(function (s, i) {
      if (s.persona !== id || String(s.desde) > String(date)) return;
      if (!best || s.desde > best.desde || (s.desde === best.desde && i > best.i)) best = { desde: s.desde, cents: s.cents, cur: s.cur, i: i };
    });
    return best;
  }
  // -> { weights: {id: cents}, cur } | { missing: [ids] } | { mixed: true }
  function salaryWeights(sueldos, ids, date) {
    var w = {}, miss = [], cur = null, mixed = false;
    ids.forEach(function (id) {
      var s = salaryAt(sueldos, id, date);
      if (!s || !(s.cents > 0)) { miss.push(id); return; }
      w[id] = s.cents;
      if (cur && cur !== s.cur) mixed = true;
      cur = cur || s.cur;
    });
    if (miss.length) return { missing: miss };
    if (mixed) return { mixed: true };
    return { weights: w, cur: cur };
  }
  // Reparto proporcional al sueldo vigente a la fecha del gasto. Suma exacto al total.
  function salarySplit(total, ids, sueldos, date) {
    var r = salaryWeights(sueldos, ids, date);
    if (!r.weights) return r;
    var sp = splitProportional(total, ids, ids.map(function (id) { return r.weights[id]; }));
    return sp ? { sp: sp } : { missing: ids };
  }
  function splitEqual(total, ids, seed) {
    var n = ids.length;
    if (!n) return null;
    var base = Math.floor(total / n), rem = total - base * n;
    var start = n ? (Math.abs(seed || 0) % n) : 0;
    var out = ids.map(function (id) { return [id, base]; });
    for (var k = 0; k < rem; k++) out[(start + k) % n][1] += 1;
    return out;
  }
  // mode: equal | exact | percent | shares ; values: {id: number}
  function computeSplits(p) {
    var ids = p.ids || [], total = p.total, v = p.values || {}, i;
    if (!(total > 0)) return { error: 'El monto tiene que ser mayor a cero.' };
    if (!ids.length) return { error: 'Elegí al menos una persona.' };
    if (p.mode === 'equal') return { sp: splitEqual(total, ids, p.seed) };
    if (p.mode === 'shares') {
      var w = ids.map(function (id) { return Number(v[id]) || 0; });
      for (i = 0; i < w.length; i++) if (w[i] < 0) return { error: 'Las partes no pueden ser negativas.' };
      var r = splitProportional(total, ids, w);
      return r ? { sp: r } : { error: 'Poné al menos una parte.' };
    }
    if (p.mode === 'percent') {
      var ps = ids.map(function (id) { return Math.round((Number(v[id]) || 0) * 100); });
      var sumP = ps.reduce(function (a, b) { return a + b; }, 0);
      if (sumP !== 10000) return { error: 'Los porcentajes suman ' + (sumP / 100) + '%, tienen que sumar 100%.' };
      return { sp: splitProportional(total, ids, ps) };
    }
    if (p.mode === 'exact') {
      var sp = ids.map(function (id) { return [id, Math.round(Number(v[id]) || 0)]; });
      var sumE = sp.reduce(function (a, x) { return a + x[1]; }, 0);
      if (sumE !== total) return { error: 'Los montos suman ' + fmt(sumE) + ' y el gasto es ' + fmt(total) + '.', diff: total - sumE };
      return { sp: sp };
    }
    return { error: 'Modo de división desconocido.' };
  }

  // ---------- saldos ----------
  function live(entries) {
    var m = {};
    entries.forEach(function (e) { if (!e.del) m[e.id] = e; });
    return Object.keys(m).map(function (k) { return m[k]; });
  }
  function validate(e) {
    if (!e || !e.id) return 'Falta id.';
    if (!(e.cents > 0)) return 'Monto inválido.';
    if (!e.paidBy) return 'Falta quién pagó.';
    if (!e.sp || !e.sp.length) return 'Falta la división.';
    var s = e.sp.reduce(function (a, x) { return a + x[1]; }, 0);
    if (s !== e.cents) return 'La división (' + s + ') no coincide con el monto (' + e.cents + ').';
    return null;
  }
  // -> { ARS: { memberId: netCents } }  (positivo = le deben, negativo = debe)
  function balances(entries, memberIds) {
    var res = {};
    live(entries).forEach(function (e) {
      var cur = e.cur || 'ARS';
      var b = res[cur] || (res[cur] = {});
      (memberIds || []).forEach(function (id) { if (b[id] == null) b[id] = 0; });
      b[e.paidBy] = (b[e.paidBy] || 0) + e.cents;
      e.sp.forEach(function (x) { b[x[0]] = (b[x[0]] || 0) - x[1]; });
    });
    return res;
  }
  // mínima cantidad de transferencias (greedy sobre netos)
  function simplify(net) {
    var cr = [], de = [];
    Object.keys(net).forEach(function (id) {
      if (net[id] > 0) cr.push({ id: id, v: net[id] });
      else if (net[id] < 0) de.push({ id: id, v: -net[id] });
    });
    var srt = function (a, b) { return b.v - a.v || (a.id < b.id ? -1 : 1); };
    cr.sort(srt); de.sort(srt);
    var out = [], i = 0, j = 0;
    while (i < de.length && j < cr.length) {
      var pay = Math.min(de[i].v, cr[j].v);
      if (pay > 0) out.push({ from: de[i].id, to: cr[j].id, cents: pay });
      de[i].v -= pay; cr[j].v -= pay;
      if (de[i].v === 0) i++;
      if (cr[j].v === 0) j++;
    }
    return out;
  }

  function monthKey(date) { return String(date || '').slice(0, 7); }
  function monthStats(entries, month, cur) {
    var r = { total: 0, count: 0, paid: {}, share: {}, cats: {} };
    live(entries).forEach(function (e) {
      if (e.type === 'payment' || monthKey(e.date) !== month || (e.cur || 'ARS') !== cur) return;
      r.total += e.cents; r.count++;
      r.paid[e.paidBy] = (r.paid[e.paidBy] || 0) + e.cents;
      e.sp.forEach(function (x) { r.share[x[0]] = (r.share[x[0]] || 0) + x[1]; });
      r.cats[e.cat || 'otros'] = (r.cats[e.cat || 'otros'] || 0) + e.cents;
    });
    return r;
  }

  // ---------- descripción prolija ----------
  var CHICAS = { lo: 1, de: 1, del: 1, la: 1, las: 1, el: 1, los: 1, y: 1, e: 1, o: 1, en: 1, a: 1, con: 1, por: 1, para: 1, un: 1, una: 1, al: 1 };
  var SIGLAS = { iva: 1, abl: 1, afip: 1, arba: 1, hbo: 1, usd: 1, ars: 1, tv: 1, dni: 1, cbu: 1, caba: 1, gba: 1, dj: 1, bbva: 1, icbc: 1, ypf: 1, mp: 1, pc: 1 };
  function tidyDesc(text) {
    var t = String(text || '').replace(/\s+/g, ' ').replace(/^[\s:;,.\-–—|]+|[\s:;,.\-–—|]+$/g, '');
    if (!t) return '';
    var n = 0;
    return t.split(' ').map(function (w) {
      var parts = w.split(/([\/\-])/);
      return parts.map(function (x) {
        if (x === '/' || x === '-' || !x) return x;
        var l = x.toLowerCase(), first = n === 0; n++;
        if (SIGLAS[l.replace(/[.,;:]+$/, '')]) return x.toUpperCase();
        if (!first && CHICAS[l]) return l;
        return l.charAt(0).toUpperCase() + l.slice(1);
      }).join('');
    }).join(' ');
  }

  // ---------- servicios con el formato de Splitwise: «LUZ | SEPTIEMBRE» ----------
  var MESES_N = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var MESES_ABR = { ene: 0, feb: 1, mar: 2, abr: 3, may: 4, jun: 5, jul: 6, ago: 7, sep: 8, set: 8, oct: 9, nov: 10, dic: 11, setiembre: 8 };
  var SERV_CATS = { alquiler: 'ALQUILER', expensas: 'EXPENSAS', luz: 'LUZ', agua: 'AGUA', gas: 'GAS', seguro: 'SEGURO' };
  var SERV_OTROS = { internet: 1, streaming: 1, impuestos: 1, super: 1 };
  function plano(w) { return String(w || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9+]/g, ''); }
  function lev(a, b) {
    var m = [], i, j;
    for (i = 0; i <= a.length; i++) m[i] = [i];
    for (j = 1; j <= b.length; j++) m[0][j] = j;
    for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++)
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return m[a.length][b.length];
  }
  function parecida(w, ref) {
    if (w === ref) return true;
    if (w.length < 5 || ref.length < 5) return false;
    return lev(w, ref) <= (ref.length >= 7 ? 2 : 1);
  }
  function mesDe(w) {
    var x = plano(w); if (!x) return -1;
    if (MESES_ABR.hasOwnProperty(x)) return MESES_ABR[x];
    var best = -1, bd = 9;
    for (var i = 0; i < 12; i++) { if (parecida(x, MESES_N[i])) { var dd = lev(x, MESES_N[i]); if (dd < bd) { bd = dd; best = i; } } }
    return best;
  }
  function buscarServicio(w) {
    var x = plano(w); if (x.length < 3) return null;
    for (var i = 0; i < CATS.length; i++) {
      var k = CATS[i].k; if (!SERV_CATS[k] && !SERV_OTROS[k]) continue;
      for (var j = 0; j < CATS[i].w.length; j++) {
        var ref = plano(CATS[i].w[j]); if (CATS[i].w[j].indexOf(' ') >= 0) continue;
        if (parecida(x, ref)) return { cat: k, word: ref };
      }
    }
    return null;
  }
  /** «edfenor julio» → { desc: 'LUZ | JULIO', cat: 'luz' }. Si no es un servicio o comercio conocido devuelve null. */
  function servicioDesc(text, dateISO) {
    var toks = String(text || '').replace(/[|]/g, ' ').split(/\s+/).filter(Boolean), serv = null, meses = [], extra = [];
    toks.forEach(function (w) {
      var pl = plano(w);
      if (!pl || pl === 'de' || pl === 'y' || w === '&' || pl === 'e') return;
      var m = mesDe(w);
      if (m >= 0) { if (meses.indexOf(m) < 0) meses.push(m); return; }
      var sv = serv ? null : buscarServicio(w);
      if (sv) { serv = sv; return; }
      extra.push(w.replace(/[,;:]+$/, ''));
    });
    if (!serv) return null;
    var name = SERV_CATS[serv.cat] || (serv.cat === 'internet' && /^(internet|wifi|fibra)$/.test(serv.word) ? 'INTERNET' : serv.word.toUpperCase());
    if (!meses.length) {
      var d = /^\d{4}-\d{2}-\d{2}/.test(dateISO || '') ? dateISO : new Date().toISOString().slice(0, 10);
      var mo = +d.slice(5, 7) - 1; if (+d.slice(8, 10) <= 10) mo = (mo + 11) % 12;   // se anota a principios de mes: es del mes anterior
      meses = [mo];
    }
    return { desc: [name].concat(extra.map(function (e) { return e.toUpperCase(); })).join(' ') + ' | ' + meses.map(function (i) { return MESES_N[i].toUpperCase(); }).join(' & '), cat: serv.cat };
  }
  function prolija(text, dateISO) { var s = servicioDesc(text, dateISO); return s ? s.desc : tidyDesc(text); }

  // ---------- entrada rápida ----------
  function quickParse(text) {
    var t = String(text || '').trim();
    if (!t) return null;
    var cur = 'ARS';
    if (/\b(usd|u\$s|us\$|dolares|dólares|dolar|dólar)\b/i.test(t)) {
      cur = 'USD';
      t = t.replace(/\b(usd|u\$s|us\$|dolares|dólares|dolar|dólar)\b/ig, ' ');
    }
    var re = /\$?\s*\d[\d.,]*/g, m, last = null;
    while ((m = re.exec(t))) last = m;
    if (!last) return null;
    var cents = parseAmount(last[0]);
    if (!(cents > 0)) return null;
    var desc = (t.slice(0, last.index) + ' ' + t.slice(last.index + last[0].length)).replace(/\s+/g, ' ').replace(/^[\s:,-]+|[\s:,-]+$/g, '');
    if (!desc) desc = 'Gasto';
    var sv = servicioDesc(desc, null);
    desc = sv ? sv.desc : (tidyDesc(desc) || 'Gasto');
    return { desc: desc, cents: cents, cur: cur, cat: sv ? sv.cat : guessCategory(desc) };
  }

  // ---------- CSV ----------
  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    var first = text.split(/\r?\n/)[0] || '';
    var delim = (first.split(';').length > first.split(',').length) ? ';' : ',';
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); if (row.length > 1 || row[0] !== '') rows.push(row); }
    return rows;
  }
  function csvCell(v) {
    v = String(v == null ? '' : v);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function centsDot(c) {
    var neg = c < 0, a = Math.abs(c);
    return (neg ? '-' : '') + Math.floor(a / 100) + '.' + ((a % 100) < 10 ? '0' : '') + (a % 100);
  }

  // Importa el CSV de exportación de Splitwise.
  // members: [{id,name}] existentes; devuelve { members, entries, warnings, skipped }
  function parseSplitwise(text, existingMembers, mkId) {
    var rows = parseCSV(text), warnings = [], entries = [], skipped = 0;
    if (rows.length < 2) return { error: 'El archivo está vacío o no se pudo leer.' };
    var head = rows[0].map(function (h) { return String(h).trim(); });
    var iDate = head.indexOf('Date'), iDesc = head.indexOf('Description'), iCat = head.indexOf('Category'),
      iCost = head.indexOf('Cost'), iCur = head.indexOf('Currency');
    if (iDate < 0 || iCost < 0 || iDesc < 0) return { error: 'No parece un CSV exportado de Splitwise (faltan columnas Date/Description/Cost).' };
    var firstMember = Math.max(iDate, iDesc, iCat, iCost, iCur) + 1;
    var names = head.slice(firstMember).filter(function (n) { return n; });
    if (names.length < 2) return { error: 'No encontré columnas de personas.' };
    var members = (existingMembers || []).slice();
    var idByName = {};
    members.forEach(function (m) { idByName[m.name.trim().toLowerCase()] = m.id; });
    names.forEach(function (n) {
      var key = n.trim().toLowerCase();
      if (!idByName[key]) { var id = mkId(); idByName[key] = id; members.push({ id: id, name: n.trim() }); }
    });
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      var desc = (row[iDesc] || '').trim();
      var date = (row[iDate] || '').trim();
      if (!date || /total balance/i.test(desc) || !/^\d{4}-\d{2}-\d{2}/.test(date)) { skipped++; continue; }
      var cost = strictCents(row[iCost]);
      if (!(cost > 0)) { skipped++; continue; }
      var nets = {}, anyNet = false;
      names.forEach(function (n, k) {
        var c = strictCents(row[firstMember + k]);
        nets[idByName[n.trim().toLowerCase()]] = c == null ? 0 : c;
        if (c) anyNet = true;
      });
      if (!anyNet) { skipped++; continue; }
      var ids = Object.keys(nets);
      var payer = ids.slice().sort(function (a, b) { return nets[b] - nets[a]; })[0];
      var pos = ids.filter(function (id) { return nets[id] > 0; }).length;
      var sp = [];
      ids.forEach(function (id) {
        var owed = (id === payer ? cost : 0) - nets[id];
        if (owed !== 0) sp.push([id, owed]);
      });
      var sum = sp.reduce(function (a, x) { return a + x[1]; }, 0);
      if (sum !== cost) { warnings.push('Fila ' + (r + 1) + ' (' + desc + '): la división no cierra, se omitió.'); skipped++; continue; }
      var isPay = /^payment$/i.test((row[iCat] || '').trim()) || /^(payment|pago|settle)/i.test(desc);
      var e = {
        id: mkId(), type: isPay ? 'payment' : 'expense', desc: isPay ? 'Pago' : desc, cents: cost,
        cur: (row[iCur] || 'ARS').trim() || 'ARS', date: date.slice(0, 10), paidBy: payer, sp: sp,
        cat: isPay ? 'pago' : guessCategory(desc), note: '', src: 'splitwise'
      };
      if (pos > 1) { e.approx = true; warnings.push('Fila ' + (r + 1) + ' (' + desc + '): lo pagaron varias personas; se importó con el saldo correcto pero atribuido a una sola.'); }
      entries.push(e);
    }
    return { members: members, entries: entries, warnings: warnings, skipped: skipped };
  }

  // Mapeo de nombres de un CSV de Splitwise a las personas que ya existen.
  // Adivina por el principio del primer nombre (Tomás→Tom, Oda→Odi) solo si no hay dudas; si no, queda sin elegir.
  function fold(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
  function guessImportMap(imp, existing) {
    var map = {}, taken = {};
    imp.members.forEach(function (m) {
      var key = fold(m.name).split(/\s+/)[0] || '';
      var hit = (existing || []).filter(function (x) {
        var n = fold(x.name).split(/\s+/)[0] || '', k = 0; while (k < n.length && k < key.length && n[k] === key[k]) k++;
        return n === key || k >= Math.min(2, n.length, key.length) && k >= 2;
      });
      if (hit.length === 1 && !taken[hit[0].id]) { map[m.id] = hit[0].id; taken[hit[0].id] = true; } else map[m.id] = '';
    });
    return map;
  }
  // Aplica el mapeo (y la moneda del lote) sin tocar lo parseado. map[idDelCSV] = idExistente | '+' (crear) | ''.
  // Devuelve { ok, problem, members, entries }.
  function resolveImport(imp, map, cur, existing) {
    var out = (existing || []).slice(), idMap = {}, used = {}, problem = '';
    imp.members.forEach(function (m) {
      var t = (map || {})[m.id];
      if (!t) { problem = problem || 'Elegí quién es «' + m.name + '».'; return; }
      if (t === '+') { idMap[m.id] = m.id; out.push({ id: m.id, name: m.name }); return; }
      if (used[t]) problem = problem || 'Dos personas del CSV apuntan a la misma.';
      used[t] = true; idMap[m.id] = t;
    });
    if (problem) return { ok: false, problem: problem, members: out, entries: [] };
    var entries = imp.entries.map(function (e) {
      var sp = {}; e.sp.forEach(function (x) { var id = idMap[x[0]]; sp[id] = (sp[id] || 0) + x[1]; });
      return Object.assign({}, e, { paidBy: idMap[e.paidBy], cur: cur || e.cur, sp: Object.keys(sp).map(function (k) { return [k, sp[k]]; }) });
    });
    return { ok: true, problem: '', members: out, entries: entries };
  }

  // Exporta en el mismo formato que Splitwise (se puede volver a importar).
  function exportCSV(entries, members) {
    var head = ['Date', 'Description', 'Category', 'Cost', 'Currency'].concat(members.map(function (m) { return m.name; }));
    var lines = [head.map(csvCell).join(',')];
    live(entries).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; }).forEach(function (e) {
      var net = {};
      members.forEach(function (m) { net[m.id] = 0; });
      net[e.paidBy] = (net[e.paidBy] || 0) + e.cents;
      e.sp.forEach(function (x) { net[x[0]] = (net[x[0]] || 0) - x[1]; });
      var cat = e.type === 'payment' ? 'Payment' : catInfo(e.cat).n;
      lines.push([e.date, e.desc, cat, centsDot(e.cents), e.cur || 'ARS'].concat(members.map(function (m) { return centsDot(net[m.id] || 0); })).map(csvCell).join(','));
    });
    return lines.join('\n') + '\n';
  }

  return {
    CATS: CATS, catInfo: catInfo, guessCategory: guessCategory, parseAmount: parseAmount, fmt: fmt,
    splitEqual: splitEqual, splitProportional: splitProportional, computeSplits: computeSplits, salaryAt: salaryAt, salaryWeights: salaryWeights, salarySplit: salarySplit,
    live: live, validate: validate, balances: balances, simplify: simplify, monthKey: monthKey,
    monthStats: monthStats, tidyDesc: tidyDesc, servicioDesc: servicioDesc, prolija: prolija, quickParse: quickParse, parseCSV: parseCSV, parseSplitwise: parseSplitwise, guessImportMap: guessImportMap, resolveImport: resolveImport,
    exportCSV: exportCSV, centsDot: centsDot
  };
});
