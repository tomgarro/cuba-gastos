// Lector de resúmenes de tarjeta. El PDF de ejemplo es inventado (tests/fixtures/resumen_demo.pdf).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const R = require('../src/resumen.js');
let n = 0;
function t(name, fn) { Promise.resolve().then(fn).then(() => { n++; console.log('ok  ' + name); }, e => { console.error('FAIL ' + name + '\n  ' + (e.stack || e.message)); process.exitCode = 1; }); }

const TXT = fs.readFileSync(path.join(__dirname, 'fixtures', 'resumen_demo.txt'), 'utf8');

t('parseResumen: fechas de cierre, consumos, USD, cuotas y cargos del banco aparte', () => {
  const r = R.parseResumen(TXT);
  assert.deepStrictEqual([r.tarjeta, r.cierre, r.vencimiento, r.proximoCierre], ['VISA', '2026-10-29', '2026-11-11', '2026-11-26']);
  assert.strictEqual(r.lineas.length, 7); assert.strictEqual(r.cargos, 1, 'el impuesto de sellos no es un consumo');
  const g = r.lineas.find(l => /GOOGLE/.test(l.bruto)), c = r.lineas.find(l => /TIENDADEMO/.test(l.bruto));
  assert.deepStrictEqual([g.cur, g.cents], ['USD', 499]); assert.deepStrictEqual([c.cuota, c.cents], ['3/6', 1999833]);
  assert.ok(new Set(r.lineas.map(l => l.id)).size === 7, 'ids únicos y estables');
  assert.deepStrictEqual(R.parseResumen(TXT).lineas.map(l => l.id), r.lineas.map(l => l.id));
});

t('nombres prolijos: servicios como «LUZ | MES», comercios conocidos y sin códigos', () => {
  const by = Object.fromEntries(R.parseResumen(TXT).lineas.map(l => [l.bruto.match(/^[A-Za-z]+/)[0], R.nombreGasto(l)]));
  assert.ok(/^LUZ \| [A-Z]+$/.test(by.EDENOR) && /^AGUA \| [A-Z]+$/.test(by.AGUA) && /^COTO \| [A-Z]+$/.test(by.COTO));
  assert.strictEqual(by.EMOVA, 'Subte'); assert.strictEqual(by.MERPAGO, 'Tiendademo (cuota 3/6)');
});

t('clasificar: reglas aprendidas, ya cargados, coincidencia con vencimientos y pistas del hogar', () => {
  const res = R.parseResumen(TXT);
  const reglas = { subte: { comparte: 'no', categoria: '' }, coto: { comparte: 'si', categoria: 'super' } };
  const entries = [{ id: 'manual1', cents: 2630195, cur: 'ARS', date: '2026-10-08' }];   // el agua ya estaba cargada a mano
  const cl = Object.fromEntries(R.clasificar(res, reglas, entries, []).map(x => [x.bruto.match(/^[A-Za-z]+/)[0], x]));
  assert.strictEqual(cl.AGUA.estado, 'ya'); assert.strictEqual(cl.COTO.estado, 'regla'); assert.strictEqual(cl.COTO.comparte, true);
  assert.strictEqual(cl.EMOVA.estado, 'regla'); assert.strictEqual(cl.EMOVA.comparte, false);
  assert.strictEqual(cl.EDENOR.estado, 'nuevo'); assert.strictEqual(cl.EDENOR.comparte, true, 'luz parece del hogar');
  assert.strictEqual(cl.FARMACIA.comparte, false, 'lo que no se sabe arranca personal');
  assert.strictEqual(cl.MERPAGO.comparte, false);
});

t('clasificar: contrasta con lo ya subido (mismo comercio = ya; solo el monto = posible; lejos en el tiempo = nuevo; también contra Personal)', () => {
  const res = R.parseResumen(TXT), coto = res.lineas.find(l => /^COTO/.test(l.bruto)), farm = res.lineas.find(l => /^FARMACIA/.test(l.bruto));
  const by = (entries, pers) => Object.fromEntries(R.clasificar(res, {}, entries, [], pers).map(x => [x.bruto.match(/^[A-Za-z]+/)[0], x]));
  const mk = (l, desc, date) => ({ id: 'm' + desc, desc, cents: l.cents, cur: l.cur, date: date || l.fecha });
  assert.strictEqual(by([mk(coto, 'Coto | octubre')]).COTO.estado, 'ya', 'mismo comercio y monto');
  const pos = by([mk(coto, 'Verdulería de la esquina')]).COTO;
  assert.strictEqual(pos.estado, 'posible'); assert.strictEqual(pos.parecido.desc, 'Verdulería de la esquina'); assert.strictEqual(pos.parecido.donde, 'Cuba');
  assert.strictEqual(by([mk(coto, 'Coto', '2026-05-01')]).COTO.estado, 'nuevo', 'mismo monto pero meses antes: otro gasto');
  assert.strictEqual(by([{ id: 'x', desc: 'Coto', cents: coto.cents + 1, cur: coto.cur, date: coto.fecha }]).COTO.estado, 'nuevo', 'otro monto');
  assert.strictEqual(by([mk(coto, 'Coto'), mk(coto, 'Coto 2')]).COTO.estado, 'ya');
  const g = (l, d) => ({ id: 'p' + d, c: l.cents, m: l.cur, f: l.fecha, d });
  assert.strictEqual(by([], [g(farm, 'Farmacia del barrio')]).FARMACIA.estado, 'ya', 'ya estaba en Personal');
  const pp = by([], [g(farm, 'Cosa rara')]).FARMACIA; assert.strictEqual(pp.estado, 'posible'); assert.strictEqual(pp.parecido.donde, 'tu Personal');
});

t('pdfTexto: lee un PDF comprimido sin librerías y da lo mismo que el texto', async () => {
  const txt = await R.pdfTexto(fs.readFileSync(path.join(__dirname, 'fixtures', 'resumen_demo.pdf')));
  const a = R.parseResumen(txt), b = R.parseResumen(TXT);
  assert.deepStrictEqual(a.lineas.map(l => [l.fecha, l.cents, l.cur]), b.lineas.map(l => [l.fecha, l.cents, l.cur]));
  assert.deepStrictEqual([a.cierre, a.proximoCierre], [b.cierre, b.proximoCierre]);
  await assert.rejects(() => R.pdfTexto(Buffer.from('no soy un pdf')));
});
setTimeout(() => console.log(n + ' pruebas de resúmenes'), 500);

t('dólar tarjeta: cotización leída de las percepciones del resumen y conversión a pesos con impuestos', () => {
  const r = R.parseResumen(fs.readFileSync(path.join(__dirname, 'fixtures', 'resumen_dolar.txt'), 'utf8'));
  assert.deepStrictEqual([r.dolar.tc, r.dolar.pct, r.dolar.extra, r.dolar.ids.length], [500, 30, 23, 1], 'IVA e IIBB solo en el consumo que suma esa base');
  assert.strictEqual(R.aPesos(1000, 500, 53), 765000, 'USD 10 → $7.650,00 en centavos');
  assert.strictEqual(R.parseResumen(TXT).dolar, null, 'sin percepciones no inventa cotización');
});
