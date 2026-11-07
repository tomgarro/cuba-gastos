// Avisos de faltantes y aumentos, suscripciones, «¿me alcanza?» y ajuste por índice (src/avisos.js). Datos inventados.
const assert = require('assert');
const A = require('../src/avisos.js');
const S = require('../src/sheets.js');
let n = 0;
function t(name, fn) { try { fn(); n++; console.log('ok  ' + name); } catch (e) { console.error('FAIL ' + name + '\n  ' + (e.stack || e.message)); process.exitCode = 1; } }
let k = 0;
const g = (desc, date, cents, cat, o) => Object.assign({ id: 'x' + (k++), type: 'expense', desc, cents, cur: 'ARS', date, paidBy: 'a', sp: [['a', Math.ceil(cents / 2)], ['b', Math.floor(cents / 2)]], cat }, o || {});

t('aumentos: la luz subió 23 %, pero un cambio chico o viejo no avisa', () => {
  const e = [g('LUZ | AGOSTO', '2026-09-08', 1000000, 'luz'), g('LUZ | SEPTIEMBRE', '2026-10-08', 1000000, 'luz'), g('LUZ | OCTUBRE', '2026-11-05', 1230000, 'luz'),
    g('AGUA | SEPTIEMBRE', '2026-10-07', 400000, 'agua'), g('AGUA | OCTUBRE', '2026-11-06', 420000, 'agua'),            // +5 %: en agua no avisa
    g('NETFLIX', '2026-10-10', 800000, 'streaming'), g('NETFLIX', '2026-11-10', 860000, 'streaming'),                  // +8 %: en streaming sí
    g('GAS | JUNIO', '2026-06-08', 100000, 'gas'), g('GAS | JULIO', '2026-07-08', 200000, 'gas')];                    // viejo
  const r = A.aumentos(e, '2026-11-12');
  assert.deepStrictEqual(r.map(x => [x.cat, x.pct]), [['luz', 23], ['streaming', 8]]);
  assert.deepStrictEqual([r[0].prev, r[0].last], [1000000, 1230000]);
  assert.deepStrictEqual(A.aumentos(e.filter(x => x.cat === 'luz').slice(0, 2), '2026-11-12'), [], 'sin cambio no avisa');
  assert.deepStrictEqual(A.aumentos([g('LUZ', '2026-10-08', 1000, 'luz', { cur: 'USD' }), g('LUZ', '2026-11-08', 5000, 'luz')], '2026-11-12'), [], 'monedas distintas no se comparan');
  assert.deepStrictEqual(A.aumentos([g('LUZ | X', '2026-10-08', 1000, 'luz', { ev: 'ev1' }), g('LUZ | Y', '2026-11-08', 5000, 'luz', { ev: 'ev1' })], '2026-11-12'), [], 'lo de un evento no cuenta');
  assert.deepStrictEqual(A.aumentos([g('LUZ', '2026-10-08', 1000, 'luz', { del: true }), g('LUZ', '2026-11-08', 5000, 'luz')], '2026-11-12'), [], 'anulados no cuentan');
});

t('faltantes: el agua se cargó 2 de los últimos 3 meses, este no y ya pasó el día de siempre', () => {
  const e = [g('AGUA | AGOSTO', '2026-09-10', 400000, 'agua'), g('AGUA | SEPTIEMBRE', '2026-10-10', 410000, 'agua'), g('LUZ | AGOSTO', '2026-09-08', 1, 'luz'), g('LUZ | SEPT', '2026-10-08', 1, 'luz'), g('LUZ | OCT', '2026-11-04', 1, 'luz')];
  assert.deepStrictEqual(A.faltantes(e, [], '2026-11-16').map(x => x.cat), ['agua'], 'la luz ya está cargada este mes');
  assert.deepStrictEqual(A.faltantes(e, [], '2026-11-12'), [], 'todavía no pasó el día de siempre (+5)');
  assert.deepStrictEqual(A.faltantes(e, [], '2026-11-03'), [], 'a principios de mes no molesta');
  assert.deepStrictEqual(A.faltantes(e, [{ active: true, cat: 'agua' }], '2026-11-20'), [], 'si hay un recurrente de agua, ya avisa «Por pagar»');
  assert.deepStrictEqual(A.faltantes(e.slice(0, 1), [], '2026-11-20'), [], 'con un solo mes no hay patrón');
  assert.deepStrictEqual(A.faltantes([g('AGUA', '2026-07-10', 1, 'agua'), g('AGUA', '2026-06-10', 1, 'agua')], [], '2026-11-20'), [], 'si ya pasaron más de 3 meses sin cargarse, se dejó de usar');
});

t('suscripciones: lista, total mensual y anual por moneda, sin repetir y sin lo viejo', () => {
  const e = [g('NETFLIX', '2026-10-10', 800000, 'streaming'), g('NETFLIX', '2026-11-10', 860000, 'streaming'), g('SPOTIFY', '2026-11-02', 300000, 'streaming'), g('HBO', '2026-03-02', 500000, 'streaming'), g('YOUTUBE PREMIUM', '2026-11-03', 1000, 'streaming', { cur: 'USD' })];
  const r = A.suscripciones([{ active: true, cat: 'streaming', desc: 'Netflix', cents: 860000, cur: 'ARS' }], e, '2026-11-12');
  assert.deepStrictEqual(r.list.map(x => x.label + ':' + x.cents), ['Netflix:860000', 'SPOTIFY:300000', 'YOUTUBE PREMIUM:1000']);
  assert.deepStrictEqual([r.mensual.ARS, r.anual.ARS, r.anual.USD], [1160000, 13920000, 12000]);
  assert.deepStrictEqual(A.suscripciones([], [], '2026-11-12').list, []);
});

t('¿me alcanza?: sueldo menos mi parte de lo que va del mes y de lo que vence, por sueldo y sin mezclar monedas', () => {
  const sueldos = [{ id: 's1', persona: 'a', desde: '2026-01-01', cents: 200000000, cur: 'ARS' }, { id: 's2', persona: 'b', desde: '2026-01-01', cents: 100000000, cur: 'ARS' }];
  const entries = [g('Super', '2026-11-03', 3000000, 'super', { sp: [['a', 2000000], ['b', 1000000]] }), g('Super viejo', '2026-10-03', 9000000, 'super'), g('USD', '2026-11-04', 500, 'otros', { cur: 'USD' }),
    g('Viaje', '2026-11-05', 9999999, 'viaje', { ev: 'e', sp: [['a', 9999999]] }), g('Anulado', '2026-11-05', 1000000, 'super', { del: true }), g('Pago', '2026-11-06', 7000000, 'pago', { type: 'payment', sp: [['a', 7000000]] })];
  const recs = [{ active: true, cur: 'ARS', cents: 77000000, desc: 'Alquiler', next: '2026-11-05' }, { active: true, cur: 'ARS', cents: 3000000, desc: 'Luz', next: '2026-12-05' }, { active: false, cur: 'ARS', cents: 1000000, desc: 'Pausado', next: '2026-11-20' }, { active: true, cur: 'USD', cents: 500, desc: 'Dólares', next: '2026-11-20' }];
  const r = A.meAlcanza({ entries, recs, sueldos, me: 'a', ids: ['a', 'b'], today: '2026-11-07' });
  assert.deepStrictEqual([r.cur, r.sueldo, r.gastado, r.porPagar, r.queda], ['ARS', 200000000, 2000000, 51333333, 200000000 - 2000000 - 51333333]);
  assert.deepStrictEqual(r.items.map(x => x.desc), ['Alquiler']);
  assert.strictEqual(A.meAlcanza({ entries, recs, sueldos: [sueldos[1]], me: 'a', ids: ['a', 'b'], today: '2026-11-07' }), null, 'sin mi sueldo no hay cuenta');
  // sin sueldo del otro: parte iguales para lo que vence
  const r2 = A.meAlcanza({ entries: [], recs, sueldos: [sueldos[0]], me: 'a', ids: ['a', 'b'], today: '2026-11-07' });
  assert.strictEqual(r2.porPagar, 38500000);
});

t('ajuste por índice: sube el monto a pesos enteros y corre la fecha N meses', () => {
  const rec = { id: 'alq', desc: 'Alquiler', cents: 77000000, active: true, adj: 3, adjNext: '2027-02-01' };
  assert.strictEqual(A.ajusteToca(rec, '2027-01-31'), false);
  assert.strictEqual(A.ajusteToca(rec, '2027-02-01'), true);
  assert.strictEqual(A.ajusteToca(Object.assign({}, rec, { adj: 0 }), '2027-03-01'), false);
  assert.strictEqual(A.ajusteToca(Object.assign({}, rec, { active: false }), '2027-03-01'), false);
  const n1 = A.aplicarAjuste(rec, 10.5, S.addMonth);
  assert.deepStrictEqual([n1.cents, n1.adjNext], [85085000, '2027-05-01']);
  assert.strictEqual(rec.cents, 77000000, 'no toca el original');
  assert.strictEqual(A.aplicarAjuste(rec, 8, S.addMonth).cents, 83160000);
  assert.strictEqual(A.aplicarAjuste(Object.assign({}, rec, { cents: 33333333 }), 7.3, S.addMonth).cents % 100, 0, 'siempre pesos enteros');
  assert.strictEqual(A.aplicarAjuste(rec, 'abc', S.addMonth), null);
  assert.strictEqual(A.aplicarAjuste(rec, 500, S.addMonth), null);
  assert.strictEqual(A.aplicarAjuste(rec, -60, S.addMonth), null);
  assert.strictEqual(A.aplicarAjuste(Object.assign({}, rec, { adjNext: '2027-01-31' }), 5, S.addMonth).adjNext, '2027-04-30', 'fin de mes no se desfasa');
});
console.log(n + ' pruebas de avisos');
