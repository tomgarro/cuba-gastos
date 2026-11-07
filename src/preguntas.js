(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.CubaPreguntas = factory(root.CubaCore);
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  // «Preguntarle a Cuba»: entiende una pregunta corta sobre los gastos y la contesta con las cuentas de la app.
  // Todo se calcula acá, con los datos locales. Gemini (si hace falta) solo traduce la pregunta a una consulta
  // y nunca recibe nombres, montos ni movimientos.
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var TIPOS = ['total', 'ultimo', 'deuda', 'top'];

  function sinTildes(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[¿?¡!.,;:]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function mesKey(y, m) { return y + '-' + (m < 10 ? '0' : '') + m; }
  function mesAtras(hoy, n) { var y = +hoy.slice(0, 4), m = +hoy.slice(5, 7) - n; while (m < 1) { m += 12; y--; } return mesKey(y, m); }

  // Período: {desde, hasta, etiqueta} con claves de mes AAAA-MM inclusivas.
  function periodo(q, hoy) {
    var cur = hoy.slice(0, 7), y = +hoy.slice(0, 4), i;
    var ym = q.match(/\b(20\d\d)\b/);   // año explícito: «en 2026», «octubre de 2025»
    if (ym && +ym[1] <= y) {
      var yr = +ym[1], mi = -1;
      for (i = 0; i < 12; i++) if (new RegExp('\\b' + MESES[i].normalize('NFD').replace(/[̀-ͯ]/g, '') + '\\b').test(q) || (i === 8 && /\bsetiembre\b/.test(q))) { mi = i; break; }
      if (mi >= 0) { var mk = mesKey(yr, mi + 1); if (mk <= cur) return { desde: mk, hasta: mk, etiqueta: MESES[mi] + (yr !== y ? ' de ' + yr : '') }; }
      else return { desde: yr + '-01', hasta: yr === y ? cur : yr + '-12', etiqueta: yr === y ? 'lo que va de ' + yr : yr + '' };
    }
    if (/\bmes (pasado|anterior)\b|\bel mes que paso\b/.test(q)) { var p = mesAtras(hoy, 1); return { desde: p, hasta: p, etiqueta: 'el mes pasado' }; }
    if (/\best(e|a) ano\b|\ben el ano\b/.test(q) && !/ano pasado/.test(q)) return { desde: y + '-01', hasta: cur, etiqueta: 'este año' };
    if (/\bano pasado\b/.test(q)) return { desde: (y - 1) + '-01', hasta: (y - 1) + '-12', etiqueta: 'el año pasado' };
    if (/\bultimos? 3 meses\b|\btres meses\b/.test(q)) return { desde: mesAtras(hoy, 2), hasta: cur, etiqueta: 'los últimos 3 meses' };
    if (/\bultimos? 6 meses\b|\bseis meses\b/.test(q)) return { desde: mesAtras(hoy, 5), hasta: cur, etiqueta: 'los últimos 6 meses' };
    for (i = 0; i < 12; i++) {
      if (new RegExp('\\b' + MESES[i].normalize('NFD').replace(/[̀-ͯ]/g, '') + '\\b').test(q) || (i === 8 && /\bsetiembre\b/.test(q))) {
        var yy = i + 1 > +hoy.slice(5, 7) ? y - 1 : y, k = mesKey(yy, i + 1);   // un mes que todavía no llegó es del año pasado
        return { desde: k, hasta: k, etiqueta: MESES[i] + (yy !== y ? ' de ' + yy : '') };
      }
    }
    return { desde: cur, hasta: cur, etiqueta: 'este mes', porDefecto: true };
  }

  function categoria(q) {
    var best = null;
    C.CATS.forEach(function (c) {
      if (c.k === 'pago' || c.k === 'otros') return;
      var ws = [c.k, c.n].concat(c.w || []);
      for (var i = 0; i < ws.length; i++) {
        var w = sinTildes(ws[i]); if (!w || w.length < 3) continue;
        var re = new RegExp('(^| )' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '( |$)');
        if (re.test(q) && (!best || w.length > best.len)) best = { cat: c.k, len: w.length };
      }
    });
    return best ? best.cat : null;
  }

  // personas: [{id, name, alias?}]. Devuelve el id de la persona nombrada o null.
  function persona(q, personas) {
    for (var i = 0; i < personas.length; i++) {
      var p = personas[i], ns = [String(p.name || '').split(' ')[0]].concat(p.alias ? String(p.alias).split(/[,;]/) : []);
      for (var j = 0; j < ns.length; j++) {
        var n = sinTildes(ns[j]); if (n.length < 2) continue;
        if (new RegExp('(^| )' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '( |$)').test(q)) return p.id;
      }
    }
    return null;
  }

  // Pregunta -> consulta {tipo, cat, desde, hasta, etiqueta, quien} o null si no la entiende.
  function entender(texto, ctx) {
    var q = sinTildes(texto), hoy = ctx.hoy;
    if (!q || q.length < 4) return null;
    var per = periodo(q, hoy), cat = categoria(q), quien = persona(q, ctx.personas || []);
    var base = { cat: cat, desde: per.desde, hasta: per.hasta, etiqueta: per.etiqueta, quien: quien, porDefecto: !!per.porDefecto };
    var tipo = null;
    if (/\b(debo|debe|deben|deuda|adeuda|saldo|saldos|a mano|estamos a mano)\b/.test(q)) tipo = 'deuda';
    else if (/\b(ultim[oa]s?|cuando fue|cuando pague|cuando pagamos|cuando cargamos)\b/.test(q)) tipo = 'ultimo';
    else if (/\b(mas|mayor|mayores)\b/.test(q) && /\b(gastamos|gaste|gasto|gastos|plata|se va|se nos va)\b/.test(q) && !cat) tipo = 'top';
    else if (/\b(cuanto|cuantos|total|gastamos|gaste|gastaron|gasto|gastos|pagamos|pague|salio|salieron|va de)\b/.test(q)) tipo = 'total';
    if (!tipo) return null;
    if (tipo === 'ultimo' && !cat) return null;
    base.tipo = tipo;
    return base;
  }

  function validarConsulta(c, ctx) {
    if (!c || TIPOS.indexOf(c.tipo) < 0) return null;
    var cat = c.categoria || c.cat || null;
    if (cat && !C.CATS.some(function (x) { return x.k === cat; })) cat = null;
    if (c.tipo === 'ultimo' && !cat) return null;
    var hoy = ctx.hoy, desde = null, hasta = null, etiqueta;
    if (c.mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(c.mes) && c.mes <= hoy.slice(0, 7)) {
      desde = hasta = c.mes; etiqueta = MESES[+c.mes.slice(5) - 1] + (c.mes.slice(0, 4) !== hoy.slice(0, 4) ? ' de ' + c.mes.slice(0, 4) : '');
    } else { desde = hasta = hoy.slice(0, 7); etiqueta = 'este mes'; }
    return { tipo: c.tipo, cat: cat, desde: desde, hasta: hasta, etiqueta: etiqueta, quien: null, porDefecto: etiqueta === 'este mes' };
  }

  // Quita nombres y alias de las personas antes de mandar nada afuera.
  function anonimizar(texto, personas) {
    var t = String(texto || '').slice(0, 160);
    (personas || []).forEach(function (p) {
      [String(p.name || '').split(' ')[0]].concat(p.alias ? String(p.alias).split(/[,;]/) : []).forEach(function (n) {
        n = String(n).trim(); if (n.length < 2) return;
        t = t.replace(new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), 'PERSONA');
      });
    });
    return t.replace(/\d[\d.,]{3,}/g, 'N');   // sin números largos (montos, cuentas)
  }

  function catNombre(k) { var c = C.CATS.filter(function (x) { return x.k === k; })[0]; return c ? c.n.toLowerCase() : k; }
  function enRango(e, c) { var m = C.monthKey(e.date); return m >= c.desde && m <= c.hasta; }

  // Respuesta: { texto, sprite: 'responde' | 'no_encuentra' | 'ticket' | 'lupa' | 'calculadora' | 'festejando', filas?: [[etiqueta, monto]] }
  function responder(c, entries, ctx) {
    var live = C.live(entries).filter(function (e) { return !e.ev && e.type !== 'payment'; });
    var nombre = function (id) { var p = (ctx.personas || []).filter(function (x) { return x.id === id; })[0]; return p ? String(p.name).split(' ')[0] : 'alguien'; };
    var fmt = function (cents, cur) { return C.fmt(cents, cur, { noDecimals: true }); };
    var i, out;

    if (c.tipo === 'deuda') {
      var ids = (ctx.personas || []).map(function (p) { return p.id; }), bal = C.balances(C.live(entries).filter(function (e) { return !e.ev; }), ids), curs = Object.keys(bal), lineas = [];
      curs.forEach(function (cur) {
        C.simplify(bal[cur]).forEach(function (t) {
          if (c.quien && t.from !== c.quien && t.to !== c.quien) return;
          lineas.push(nombre(t.from) + ' le debe ' + fmt(t.cents, cur) + ' a ' + nombre(t.to));
        });
      });
      if (!lineas.length) return { texto: c.quien ? 'Con ' + nombre(c.quien) + ' están a mano: no se debe nada.' : 'Están a mano: no se debe nada.', sprite: 'festejando' };
      return { texto: lineas.join('. ') + '.', sprite: 'calculadora' };
    }

    var rows = live.filter(function (e) { return enRango(e, c) && (!c.cat || e.cat === c.cat); });
    var quien = c.cat ? ' en ' + catNombre(c.cat) : '';

    if (c.tipo === 'ultimo') {
      var todos = live.filter(function (e) { return e.cat === c.cat; }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
      if (!todos.length) return { texto: 'No encuentro ningún gasto de ' + catNombre(c.cat) + '.', sprite: 'no_encuentra' };
      var u = todos[0];
      return { texto: 'Lo último en ' + catNombre(c.cat) + ': ' + u.desc + ', ' + fmt(u.cents, u.cur || 'ARS') + ' el ' + u.date.slice(8, 10) + '/' + u.date.slice(5, 7) + '/' + u.date.slice(0, 4) + '.', sprite: 'ticket' };
    }

    if (!rows.length) return { texto: 'No encuentro gastos' + quien + ' en ' + c.etiqueta + '.', sprite: 'no_encuentra' };

    var porMoneda = {};
    rows.forEach(function (e) { var cur = e.cur || 'ARS'; (porMoneda[cur] = porMoneda[cur] || { total: 0, cats: {}, n: 0 }); porMoneda[cur].total += e.cents; porMoneda[cur].n++; porMoneda[cur].cats[e.cat || 'otros'] = (porMoneda[cur].cats[e.cat || 'otros'] || 0) + e.cents; });
    var monedas = Object.keys(porMoneda).sort(function (a, b) { return a === 'ARS' ? -1 : b === 'ARS' ? 1 : a < b ? -1 : 1; });

    if (c.tipo === 'top') {
      var m0 = monedas[0], cats = porMoneda[m0].cats, orden = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; }).slice(0, 3);
      return { texto: 'En ' + c.etiqueta + ' lo que más se va es ' + orden.map(function (k) { return catNombre(k) + ' (' + fmt(cats[k], m0) + ')'; }).join(', ') + '.', sprite: 'lupa' };
    }

    out = monedas.map(function (cur) { return fmt(porMoneda[cur].total, cur) + ' (' + porMoneda[cur].n + (porMoneda[cur].n === 1 ? ' gasto' : ' gastos') + ')'; }).join(' y ');
    return { texto: 'En ' + c.etiqueta + ' gastaron ' + out + quien + '.', sprite: 'responde' };
  }

  return { entender: entender, validarConsulta: validarConsulta, responder: responder, anonimizar: anonimizar, sinTildes: sinTildes };
});
