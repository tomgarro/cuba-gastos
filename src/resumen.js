(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.CubaResumen = factory(root.CubaCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  // ---------------------------------------------------------------- lectura del texto del resumen
  var MES3 = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12 };
  var AMT = /-?\d{1,3}(?:\.\d{3})*,\d{2}/g;
  var CARGOS = /SU PAGO|SALDO ANTERIOR|SALDO ACTUAL|IMPUESTO|IMP\.|IIBB|IVA RG|DB\.RG|CR\.RG|PERCEP|INTERES|COMISION|MANTENIMIENTO|BONIF|RG \d{4}/i;

  function yyyy(yy) { return '20' + yy; }
  function fechaCorta(d, m, y) { return yyyy(y) + '-' + m + '-' + d; }
  function importe(txt) { // «1.283.167,86» → 128316786
    var neg = /^-/.test(txt), n = txt.replace(/[-.]/g, '').replace(',', '');
    return (neg ? -1 : 1) * parseInt(n, 10);
  }
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); }

  /** Texto del resumen → { tarjeta, cierre, vencimiento, proximoCierre, lineas, cargos }. No guarda ni manda nada. */
  function parseResumen(text) {
    var t = String(text || '').replace(/\r/g, '');
    var out = { tarjeta: '', cierre: '', vencimiento: '', proximoCierre: '', lineas: [], cargos: 0 };
    var b = /Tarjeta\s+Cr[eé]dito\s+([A-Za-z]+)/i.exec(t) || /\b(VISA|MASTERCARD|AMEX|AMERICAN EXPRESS)\b/i.exec(t);
    out.tarjeta = b ? b[1].toUpperCase() : 'Tarjeta';
    var ds = [], m, re = /\b(\d{2})-([A-Za-z]{3})-(\d{2})\b/g;
    while ((m = re.exec(t)) && ds.length < 6) { var mm = MES3[m[2].toLowerCase()]; if (mm) ds.push(fechaCorta(m[1], ('0' + mm).slice(-2), m[3])); }
    if (ds.length >= 5) { out.cierre = ds[2]; out.vencimiento = ds[3]; out.proximoCierre = ds[4]; }
    var seen = {};
    t.split('\n').forEach(function (raw) {
      var line = raw.replace(/\s+/g, ' ').trim();
      var h = /^(\d{2})-(\d{2})-(\d{2}) (.*)$/.exec(line); if (!h) return;
      var fecha = fechaCorta(h[1], h[2], h[3]), rest = h[4];
      if (CARGOS.test(rest)) { out.cargos++; return; }
      var amts = rest.match(AMT); if (!amts) return;
      var cur = /\bP?USD\b/.test(rest) ? 'USD' : 'ARS', cents = importe(amts[amts.length - 1]);
      if (!(cents > 0)) return;
      var d = rest.replace(/^[*KF]\s+(?=\S)/, '').replace(/^[*KF]$/, '');
      var cuota = /\b(\d{2})\/(\d{2})\b/.exec(d); cuota = cuota ? +cuota[1] + '/' + +cuota[2] : '';
      var comp = /\b(\d{6})\b(?=[\s\d.,-]*$)/.exec(d.replace(AMT, ' ').trim()); comp = comp ? comp[1] : '';
      d = d.replace(/([A-Za-z]{3,})\d{5,}/g, '$1 ').replace(AMT, ' ').replace(/\bP?USD\b/g, ' ').replace(/\b\d{2}\/\d{2}\b/, ' ').replace(/\b\d{5,}\b/g, ' ')
        .replace(/\b(?=[A-Za-z]*\d)(?=[A-Za-z\d]*[A-Za-z])[A-Za-z\d]{6,}\b/g, ' ').replace(/\s+/g, ' ').trim();
      if (!d) return;
      var key = hash([fecha, comp, cents, cur, d].join('|'));
      var n = (seen[key] = (seen[key] || 0) + 1); if (n > 1) key += '-' + n;     // dos compras iguales el mismo día siguen siendo dos
      out.lineas.push({ id: 'rs' + key, fecha: fecha, bruto: d, cuota: cuota, cents: cents, cur: cur });
    });
    if (!out.cierre && out.lineas.length) out.cierre = out.lineas.reduce(function (a, l) { return l.fecha > a ? l.fecha : a; }, '');
    out.dolar = dolarTarjeta(t, out.lineas);
    if (!out.lineas.length) out.error = 'No encontré consumos. Si es un PDF, abrilo, copiá todo el texto y pegalo acá.';
    return out;
  }

  /** Dólar tarjeta que sale del propio resumen: TC vendedor (base de la percepción IVA ÷ USD) y percepciones que se suman. null si no se puede. */
  function dolarTarjeta(t, lineas) {
    var usd = lineas.filter(function (l) { return l.cur === 'USD'; }).reduce(function (a, l) { return a + l.cents; }, 0);
    if (!usd) return null;
    var pcts = [], tc = 0, re = /(IVA RG|IIBB PERCEP|DB\.RG)[^\n(]*?(\d+(?:,\d+)?)\s*%\s*\(\s*(\d[\d.]*,\d{2})\s*\)/gi, m;
    while ((m = re.exec(t))) {
      var pct = parseFloat(m[2].replace(',', '.')), base = importe(m[3]);
      if (/IVA/i.test(m[1])) tc = base / usd;                                  // centavos de peso por centavo de USD = pesos por dólar
      pcts.push({ nombre: m[1].toUpperCase().replace(/\.$/, ''), pct: pct, base: base });
    }
    if (!(tc > 0)) return null;
    var usdPesos = usd * tc, suma = 0, usados = [];
    pcts.forEach(function (x) {
      if (/DB\./i.test(x.nombre) || Math.abs(x.base - usdPesos) <= usdPesos * 0.02) { suma += x.pct; usados.push(x.nombre + ' ' + x.pct + '%'); }
    });
    return { tc: Math.round(tc * 100) / 100, pct: suma, detalle: usados.join(' + ') };
  }
  /** USD en centavos → pesos en centavos, con tipo de cambio y % de impuestos. */
  function aPesos(usdCents, tc, pct) { return Math.round(usdCents * tc * (1 + (pct || 0) / 100)); }

  // ---------------------------------------------------------------- nombres prolijos
  var ALIAS = [[/hbo ?max|hbomax/i, 'HBO'], [/prime ?video/i, 'PRIME VIDEO'], [/spotify/i, 'SPOTIFY'], [/netflix/i, 'NETFLIX'], [/disney/i, 'DISNEY'],
    [/anthropic|claude/i, 'CLAUDE'], [/google/i, 'GOOGLE'], [/agua y saneamien|aysa/i, 'AGUA'], [/edenor|edesur/i, 'LUZ'], [/metrogas/i, 'GAS'],
    [/emova|subte/i, 'SUBTE'], [/sube viajes|^sube/i, 'SUBE'], [/movistar/i, 'MOVISTAR'], [/pack claro|^claro|\bclaro\b/i, 'CLARO'],
    [/galicia seguro/i, 'SEGURO'], [/\bpersonal\b/i, 'PERSONAL'], [/coto/i, 'COTO'], [/carrefour/i, 'CARREFOUR'], [/jumbo/i, 'JUMBO'], [/\bdia\b/i, 'DIA']];
  function limpiar(bruto) {
    var d = String(bruto || '').replace(/^[A-Z]{2,5}\*\s*/, '').replace(/^(MERPAGO|MERCADOPAGO|PEDIDOSYA|DSA-)\*?-?/i, '').replace(/\*+/g, ' ').replace(/\s+/g, ' ').trim();
    for (var i = 0; i < ALIAS.length; i++) if (ALIAS[i][0].test(bruto) || ALIAS[i][0].test(d)) return ALIAS[i][1] + (/^(FARMACIA|FCIA)/i.test(d) ? '' : '');
    return d;
  }
  /** Descripción para el gasto: servicios con el formato «LUZ | OCTUBRE», el resto capitalizado. */
  function nombreGasto(l) {
    var base = limpiar(l.bruto), sv = C.servicioDesc(base, l.fecha), n = sv ? sv.desc : C.tidyDesc(base);
    return n + (l.cuota ? ' (cuota ' + l.cuota + ')' : '');
  }
  /** Misma regla que el backend (patron_): un comercio, una sola clave. */
  var STOP = { enero: 1, febrero: 1, marzo: 1, abril: 1, mayo: 1, junio: 1, julio: 1, agosto: 1, septiembre: 1, setiembre: 1, octubre: 1, noviembre: 1, diciembre: 1,
    ene: 1, feb: 1, mar: 1, abr: 1, jun: 1, jul: 1, ago: 1, sep: 1, set: 1, oct: 1, nov: 1, dic: 1, y: 1, de: 1, del: 1, la: 1, el: 1, los: 1, las: 1 };
  function patron(desc) {
    var t = String(desc || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/);
    return t.filter(function (w) { return w.length > 1 && !STOP[w]; }).slice(0, 5).join(' ');
  }

  // ---------------------------------------------------------------- qué parece compartido
  var HOGAR = { super: 1, alquiler: 1, expensas: 1, luz: 1, agua: 1, gas: 1, internet: 1, streaming: 1, seguro: 1, impuestos: 1, casa: 1 };
  /**
   * Para cada línea: ya está en Cuba / lo sabe por una regla / sugerencia por pistas / no sabe.
   * reglas: { patron: {comparte:'si'|'no', categoria} } · entries: movimientos vivos · recs: recurrentes
   */
  function clasificar(res, reglas, entries, recs) {
    var usados = {};
    return res.lineas.map(function (l) {
      var nombre = nombreGasto(l), p = patron(limpiar(l.bruto)), sv = C.servicioDesc(limpiar(l.bruto), l.fecha);
      var cat = (sv && sv.cat) || C.guessCategory(limpiar(l.bruto));
      var o = { id: l.id, fecha: l.fecha, bruto: l.bruto, cuota: l.cuota, cents: l.cents, cur: l.cur, nombre: nombre, patron: p, cat: cat, estado: 'nuevo', comparte: false, why: '' };
      var ex = (entries || []).filter(function (e) { return e.id === l.id || (!usados[e.id] && e.cents === l.cents && e.cur === l.cur && Math.abs(Date.parse(e.date) - Date.parse(l.fecha)) <= 7 * 86400000); })[0];
      if (ex) { usados[ex.id] = true; o.estado = 'ya'; return o; }
      var r = reglas && reglas[p];
      if (r) { o.estado = 'regla'; o.comparte = r.comparte === 'si'; if (r.categoria) o.cat = r.categoria; o.why = o.comparte ? 'lo marcaste compartido' : 'lo marcaste personal'; return o; }
      var rec = (recs || []).filter(function (x) { var q = patron(x.desc || x.descripcion || ''); return q && (p.indexOf(q) >= 0 || q.indexOf(p) >= 0); })[0];
      if (rec) { o.comparte = true; o.why = 'coincide con un vencimiento tuyo'; return o; }
      if (HOGAR[cat]) { o.comparte = true; o.why = 'parece del hogar'; return o; }
      return o;
    });
  }

  // ---------------------------------------------------------------- PDF → texto (sin librerías; si no puede, se pega el texto)
  var GLYPH = { space: ' ', period: '.', comma: ',', hyphen: '-', minus: '-', slash: '/', dollar: '$', asterisk: '*', parenleft: '(', parenright: ')', percent: '%', colon: ':', semicolon: ';',
    plus: '+', underscore: '_', question: '?', quotedbl: '"', quotesingle: "'", ampersand: '&', at: '@', numbersign: '#', equal: '=', bracketleft: '[', bracketright: ']', exclam: '!',
    zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ',
    Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', udieresis: 'ü', degree: '°', ordmasculine: 'º', ordfeminine: 'ª', bullet: '•', endash: '–', emdash: '—' };
  function glyphChar(n) { return GLYPH[n] !== undefined ? GLYPH[n] : (n.length === 1 ? n : ''); }

  function latin1(bytes) { var s = '', i; for (i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return s; }
  function toBytes(s) { var b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; }
  async function inflate(bytes) {
    var ds = new DecompressionStream('deflate'), w = ds.writable.getWriter(); w.write(bytes).catch(function () {}); w.close().catch(function () {});
    var r = ds.readable.getReader(), parts = [], n = 0, x;
    while (!(x = await r.read()).done) { parts.push(x.value); n += x.value.length; }
    var out = new Uint8Array(n), o = 0; parts.forEach(function (p) { out.set(p, o); o += p.length; });
    return out;
  }
  function balanced(s, i) { // «<< … >>» con anidados, desde la posición i (que apunta a «<<»)
    var d = 0, j;
    for (j = i; j < s.length - 1; j++) {
      if (s[j] === '<' && s[j + 1] === '<') { d++; j++; } else if (s[j] === '>' && s[j + 1] === '>') { d--; j++; if (!d) return s.slice(i, j + 1); }
    }
    return '';
  }
  function parsePdf(s) {
    var objs = {}, re = /(\d+) 0 obj/g, m;
    while ((m = re.exec(s))) {
      var start = m.index + m[0].length, end = s.indexOf('endobj', start); if (end < 0) break;
      var body = s.slice(start, end), si = body.indexOf('stream');
      var dict = si >= 0 ? body.slice(0, si) : body, data = null;
      if (si >= 0) { var a = si + 6; if (body[a] === '\r') a++; if (body[a] === '\n') a++; var e = body.lastIndexOf('endstream'); data = body.slice(a, e < 0 ? undefined : e); }
      objs[m[1]] = { dict: dict, data: data }; re.lastIndex = end;
    }
    return objs;
  }
  function valueOf(objs, dict, key) { // «/Key 12 0 R» o «/Key <<…>>»
    var i = dict.indexOf(key); if (i < 0) return '';
    var rest = dict.slice(i + key.length).replace(/^\s+/, '');
    var r = /^(\d+) 0 R/.exec(rest); if (r) return objs[r[1]] ? objs[r[1]].dict : '';
    if (rest.slice(0, 2) === '<<') return balanced(rest, 0);
    return rest;
  }
  function fontInfo(objs, fdict, cache, key) {
    if (cache[key]) return cache[key];
    var info = { map: {}, two: false, toUni: null };
    var enc = valueOf(objs, fdict, '/Encoding'), diff = /\/Differences\s*\[([\s\S]*?)\]/.exec(enc);
    if (diff) {
      var code = 0, tk = diff[1].match(/\/[A-Za-z0-9_.]+|\d+/g) || [];
      tk.forEach(function (x) { if (x[0] === '/') { info.map[code] = glyphChar(x.slice(1)); code++; } else code = +x; });
    }
    var tu = /\/ToUnicode\s+(\d+) 0 R/.exec(fdict);
    if (tu && objs[tu[1]] && objs[tu[1]].cmap) {
      info.toUni = objs[tu[1]].cmap;
      info.two = /\/Identity-H|\/Type0/.test(fdict);
    }
    cache[key] = info; return info;
  }
  function parseCmap(txt) {
    var map = {}, u = function (h) { var o = ''; for (var i = 0; i < h.length; i += 4) o += String.fromCharCode(parseInt(h.substr(i, 4), 16)); return o; };
    (txt.match(/beginbfchar([\s\S]*?)endbfchar/g) || []).forEach(function (b) { var r = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g, x; while ((x = r.exec(b))) map[parseInt(x[1], 16)] = u(x[2]); });
    (txt.match(/beginbfrange([\s\S]*?)endbfrange/g) || []).forEach(function (b) {
      var r = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g, x;
      while ((x = r.exec(b))) { var a = parseInt(x[1], 16), z = parseInt(x[2], 16), d = parseInt(x[3], 16); for (var c = a; c <= z; c++) map[c] = String.fromCharCode(d + c - a); }
    });
    return map;
  }
  function decodeStr(raw, f) {
    var bytes = raw, out = '', i;
    if (f && f.two) { for (i = 0; i + 1 < bytes.length; i += 2) { var c2 = bytes[i] * 256 + bytes[i + 1]; out += (f.toUni && f.toUni[c2] !== undefined) ? f.toUni[c2] : ''; } return out; }
    for (i = 0; i < bytes.length; i++) {
      var c = bytes[i];
      if (f && f.map[c] !== undefined) out += f.map[c]; else if (f && f.toUni && f.toUni[c] !== undefined) out += f.toUni[c]; else out += String.fromCharCode(c);
    }
    return out;
  }
  function tokens(cs) { // tokenizador mínimo de contenido de página
    var t = [], i = 0, n = cs.length;
    while (i < n) {
      var ch = cs[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '(') {
        var d = 1, j = i + 1, bytes = [];
        while (j < n && d) {
          var c = cs[j];
          if (c === '\\') { var nx = cs[j + 1]; if (/[0-7]/.test(nx)) { var o = /^[0-7]{1,3}/.exec(cs.slice(j + 1))[0]; bytes.push(parseInt(o, 8) & 255); j += 1 + o.length; continue; }
            bytes.push({ n: 10, r: 13, t: 9, b: 8, f: 12 }[nx] || nx.charCodeAt(0)); j += 2; continue; }
          if (c === '(') d++; else if (c === ')') { d--; if (!d) break; }
          bytes.push(c.charCodeAt(0) & 255); j++;
        }
        t.push({ s: bytes }); i = j + 1; continue;
      }
      if (ch === '<' && cs[i + 1] !== '<') { var k = cs.indexOf('>', i), hx = cs.slice(i + 1, k).replace(/\s/g, ''); if (hx.length % 2) hx += '0'; var bs = []; for (var q = 0; q < hx.length; q += 2) bs.push(parseInt(hx.substr(q, 2), 16)); t.push({ s: bs }); i = k + 1; continue; }
      if (ch === '[') { t.push('['); i++; continue; }
      if (ch === ']') { t.push(']'); i++; continue; }
      if (ch === '<' || ch === '>') { i += 2; continue; }
      if (ch === '/') { var mm = /^\/[^\s/<>\[\]()]*/.exec(cs.slice(i)); t.push({ name: mm[0] }); i += mm[0].length; continue; }
      var w = /^[^\s/<>\[\]()]+/.exec(cs.slice(i)); if (!w) { i++; continue; }
      t.push(/^[-+.\d]/.test(w[0]) && !isNaN(+w[0]) ? +w[0] : { op: w[0] }); i += w[0].length;
    }
    return t;
  }
  function pageItems(cs, fonts) {
    var tk = tokens(cs), st = [], items = [], x = 0, y = 0, lx = 0, ly = 0, f = null, lead = 0;
    var show = function (parts) { var s = ''; parts.forEach(function (p) { if (p && p.s) s += decodeStr(p.s, f); else if (typeof p === 'number' && p < -250) s += ' '; }); if (s) items.push({ x: x, y: y, s: s }); };
    for (var i = 0; i < tk.length; i++) {
      var o = tk[i]; if (!(o && o.op)) { st.push(o); continue; }
      var a = st;
      switch (o.op) {
        case 'BT': x = y = lx = ly = 0; break;
        case 'Tf': var nm = a.filter(function (z) { return z && z.name; }).pop(); f = nm ? fonts[nm.name] || null : null; break;
        case 'Tm': lx = x = a[a.length - 2]; ly = y = a[a.length - 1]; break;
        case 'Td': lx = x = lx + a[a.length - 2]; ly = y = ly + a[a.length - 1]; break;
        case 'TD': lead = -a[a.length - 1]; lx = x = lx + a[a.length - 2]; ly = y = ly + a[a.length - 1]; break;
        case 'TL': lead = a[a.length - 1]; break;
        case 'T*': ly = y = ly - lead; x = lx; break;
        case 'Tj': show([a[a.length - 1]]); break;
        case "'": ly = y = ly - lead; x = lx; show([a[a.length - 1]]); break;
        case 'TJ': var from = a.lastIndexOf('['); show(a.slice(from + 1).filter(function (z) { return z !== ']'; })); break;
      }
      st = [];
    }
    return items;
  }
  /** ArrayBuffer de un PDF → texto con una línea por renglón. Lanza si no puede (el que llama pide pegar el texto). */
  async function pdfTexto(buf) {
    var s = latin1(new Uint8Array(buf)); if (s.indexOf('%PDF') !== 0) throw new Error('no es un PDF');
    if (/\/Encrypt\b/.test(s)) throw new Error('PDF protegido');
    var objs = parsePdf(s), k;
    for (k in objs) {
      var o = objs[k];
      if (o.data != null && /FlateDecode/.test(o.dict)) {
        var raw = toBytes(o.data); o.bytes = null;
        for (var cut = 0; cut < 3 && !o.bytes; cut++) { try { o.bytes = await inflate(raw.subarray(0, raw.length - cut)); } catch (e) { o.bytes = null; } }
      }
      else if (o.data != null) o.bytes = toBytes(o.data);
      if (o.bytes && /beginbfchar|beginbfrange/.test(latin1(o.bytes.subarray(0, 4000)))) o.cmap = parseCmap(latin1(o.bytes));
    }
    var lines = [], pages = Object.keys(objs).filter(function (n) { return /\/Type\s*\/Page\b(?!s)/.test(objs[n].dict); });
    pages.sort(function (a, b) { return a - b; });
    var cache = {};
    pages.forEach(function (pn) {
      var pd = objs[pn].dict, res = valueOf(objs, pd, '/Resources'), fdict = valueOf(objs, res, '/Font'), fonts = {};
      var fr = /\/([A-Za-z0-9_.+-]+)\s+(\d+) 0 R/g, m;
      while ((m = fr.exec(fdict))) if (objs[m[2]]) fonts['/' + m[1]] = fontInfo(objs, objs[m[2]].dict, cache, m[2]);
      var cm = /\/Contents\s*(\[[^\]]*\]|\d+ 0 R)/.exec(pd); if (!cm) return;
      var ids = (cm[1].match(/\d+(?= 0 R)/g) || []), cs = '';
      ids.forEach(function (id) { if (objs[id] && objs[id].bytes) cs += latin1(objs[id].bytes) + '\n'; });
      var items = pageItems(cs, fonts), rows = [];
      items.sort(function (p, q) { return q.y - p.y || p.x - q.x; });
      items.forEach(function (it) { var r = rows[rows.length - 1]; if (r && Math.abs(r.y - it.y) < 2.5) r.p.push(it); else rows.push({ y: it.y, p: [it] }); });
      rows.forEach(function (r) { r.p.sort(function (p, q) { return p.x - q.x; }); lines.push(r.p.map(function (p) { return p.s; }).join('  ')); });
    });
    var txt = lines.join('\n');
    if (!/\d{2}-\d{2}-\d{2}/.test(txt)) throw new Error('sin texto');
    return txt;
  }

  return { parseResumen: parseResumen, limpiar: limpiar, nombreGasto: nombreGasto, patron: patron, clasificar: clasificar, pdfTexto: pdfTexto, aPesos: aPesos, dolarTarjeta: dolarTarjeta, importe: importe };
});
