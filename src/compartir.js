(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.CubaCompartir = factory(root.CubaCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  // Lee, sin salir del celular, el texto de un comprobante, una notificación del banco o un mensaje compartido a Cuba.
  // Solo propone: el gasto se revisa y se guarda a mano.
  var AMT = /(?:\$|ARS|AR\$|U\$S|USD|US\$)\s*(-?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|-?\d+(?:,\d{1,2})?)/gi;
  var AMT_COMA = /(-?\d{1,3}(?:\.\d{3})*,\d{2})(?!\d)/g;
  var CLAVES = /(?:^|[^a-záéíóúñ])(?:total|importe|monto)[^\d$\n]{0,24}$/i;
  var DEBIL = /(?:^|[^a-záéíóúñ])(?:pagaste|pag[oó]|compraste|compra|transferiste|transferencia|abonaste|d[eé]bito|consumo)[^\d$\n]{0,24}$/i;

  function aCentavos(s) { return C.parseAmount(String(s).replace(/^-/, '')); }

  function candidatos(text) {
    var out = [], m, re;
    re = new RegExp(AMT.source, 'gi');
    while ((m = re.exec(text))) { var c = aCentavos(m[1]); if (c > 0) out.push({ cents: c, at: m.index, pref: text.slice(Math.max(0, m.index - 30), m.index), raw: m[0] }); }
    if (!out.length) { re = new RegExp(AMT_COMA.source, 'g'); while ((m = re.exec(text))) { var d = aCentavos(m[1]); if (d > 0) out.push({ cents: d, at: m.index, pref: text.slice(Math.max(0, m.index - 30), m.index), raw: m[0] }); } }
    return out;
  }

  function fecha(text, hoy) {
    var m = /(\d{4})-(\d{2})-(\d{2})/.exec(text), y, mo, d;
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(text))) { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
    else if ((m = /(\d{1,2})\/(\d{1,2})(?![\d\/])/.exec(text))) { d = +m[1]; mo = +m[2]; y = +String(hoy).slice(0, 4); }
    else return hoy;
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return hoy;
    var iso = dt.toISOString().slice(0, 10);
    return iso > hoy ? hoy : iso;   // un comprobante no es del futuro
  }

  function comercio(text) {
    var m = /(?:comercio|establecimiento|destinatario|beneficiario|raz[oó]n social)\s*[:\-]\s*([^\n]{2,40})/i.exec(text) ||
      /(?:[Cc]ompraste|[Pp]agaste|[Aa]bonaste|[Cc]onsumo|[Cc]ompra)[^\n]{0,30}?\b(?:en|a)\s+([A-ZÁÉÍÓÚÑ0-9][^\n,.$]{1,40})/.exec(text) ||
      /(?:[Tt]ransferiste|[Ee]nviaste)[^\n]{0,40}?\ba\s+([A-ZÁÉÍÓÚÑ][^\n,.$]{1,40})/.exec(text);
    if (m) return m[1].replace(/\s+(el|con|por|desde|del)\s+.*$/i, '').replace(/\s+/g, ' ').trim();
    var l = String(text).split(/\n/).map(function (x) { return x.trim(); }).filter(function (x) { return x && !/\d{3,}|\$/.test(x) && x.length <= 40; });
    return l[0] || '';
  }

  function leerTexto(text, hoy) {
    text = String(text || '').slice(0, 4000);
    var cs = candidatos(text); if (!cs.length) return null;
    var fuertes = cs.filter(function (c) { return CLAVES.test(c.pref); }), debiles = cs.filter(function (c) { return DEBIL.test(c.pref); });
    var elegido = fuertes[fuertes.length - 1] || debiles[0] || cs.slice().sort(function (a, b) { return b.cents - a.cents; })[0];
    var usd = /u\$s|usd|us\$|d[oó]lares/i.test(elegido.raw + ' ' + elegido.pref);
    var desc = C.tidyDesc(comercio(text)) || 'Comprobante';
    return { desc: desc, cents: elegido.cents, cur: usd ? 'USD' : 'ARS', date: fecha(text, hoy), cat: C.guessCategory(desc) };
  }

  // La respuesta de Gemini (ya limpiada por el backend) → lo mismo que arriba.
  function deRespuesta(r, hoy) {
    if (!r || !(r.monto_centavos > 0)) return null;
    var desc = C.tidyDesc(r.comercio || '') || 'Comprobante';
    return { desc: desc, cents: r.monto_centavos, cur: r.moneda === 'USD' ? 'USD' : 'ARS', date: r.fecha && r.fecha <= hoy ? r.fecha : hoy, cat: C.guessCategory(desc) };
  }

  return { leerTexto: leerTexto, deRespuesta: deRespuesta, candidatos: candidatos, fecha: fecha };
});
