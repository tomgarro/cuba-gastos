// Traducción app <-> Sheet (src/sheets.js): puro, sin red.
const assert = require('assert');
const C = require('../src/core.js');
const S = require('../src/sheets.js');
let n = 0;
function t(name, fn) { try { fn(); n++; console.log('ok  ' + name); } catch (e) { console.error('FAIL ' + name + '\n  ' + (e.stack || e.message)); process.exitCode = 1; } }

const e1 = { id: 'e1', type: 'expense', desc: 'Super', cents: 1001, cur: 'ARS', date: '2026-11-06', paidBy: 'm1', sp: [['m1', 501], ['m2', 500]], cat: 'super', note: 'x', by: 'm1', at: '2026-11-06T10:00:00.000Z' };

t('decodeCfg acepta solo links de Apps Script', () => {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  const ok = { u: 'https://script.google.com/macros/s/AKfy/exec', t: 'abc123' };
  assert.deepStrictEqual(S.decodeCfg('#cfg=' + enc(ok)), ok);
  assert.strictEqual(S.decodeCfg('#cfg=' + enc({ u: 'https://malo.com/exec', t: 'abc' })), null, 'no manda el token a cualquier sitio');
  assert.strictEqual(S.decodeCfg('#cfg=' + enc({ u: 'http://script.google.com/x', t: 'abc' })), null);
  assert.strictEqual(S.decodeCfg('#cfg=' + enc({ u: ok.u })), null);
  assert.strictEqual(S.decodeCfg('#cfg=@@@'), null);
  assert.strictEqual(S.decodeCfg('#otra=cosa'), null);
  assert.strictEqual(S.decodeCfg(''), null);
});
t('entrada -> movimiento -> entrada conserva todo', () => {
  const m = S.entryToMov(e1);
  assert.deepStrictEqual([m.tipo, m.monto_centavos, m.moneda, m.reparto_modo, m.creado_por], ['gasto', 1001, 'ARS', 'igual', 'm1']);
  const back = S.rowToEntry(Object.assign({}, m, { reparto_json: JSON.stringify(m.reparto), anulado: false, creado_en: e1.at, lote_id: '', reemplaza_id: '', confianza: null }));
  assert.deepStrictEqual(back, Object.assign({}, e1, { src: 'manual' }));
});
t('pago: mantiene tipo y nota', () => {
  const p = { id: 'p1', type: 'payment', desc: 'Pago', cents: 5000, cur: 'USD', date: '2026-11-06', paidBy: 'm2', sp: [['m1', 5000]], cat: 'pago', note: 'Cierre noviembre 2026', by: 'm2', at: 'a' };
  const m = S.entryToMov(p);
  assert.deepStrictEqual([m.tipo, m.moneda, m.categoria, m.nota], ['pago', 'USD', 'pago', 'Cierre noviembre 2026']);
});
t('reparto_modo: igual solo si es el reparto parejo', () => {
  assert.strictEqual(S.repartoModo({ cents: 100, sp: [['a', 50], ['b', 50]] }), 'igual');
  assert.strictEqual(S.repartoModo({ cents: 101, sp: [['a', 51], ['b', 50]] }), 'igual');
  assert.strictEqual(S.repartoModo({ cents: 100, sp: [['a', 70], ['b', 30]] }), 'exacto');
  assert.strictEqual(S.repartoModo({ cents: 100, sp: [['a', 100]] }), 'igual');
});
t('el reparto que sale de la app siempre suma el monto (lo que exige el backend)', () => {
  for (let tot = 1; tot < 300; tot++) for (const k of [1, 2, 3, 5]) {
    const ids = Array.from({ length: k }, (_, i) => 'm' + i);
    const m = S.entryToMov({ id: 'x', type: 'expense', desc: 'd', cents: tot, cur: 'ARS', date: '2026-01-01', paidBy: 'm0', sp: C.splitEqual(tot, ids, tot), cat: 'otros' });
    assert.strictEqual(m.reparto.reduce((a, x) => a + x[1], 0), m.monto_centavos);
  }
});
t('snapshot: personas, anulados y meses', () => {
  const row = (o) => Object.assign({ id: 'a', tipo: 'gasto', fecha: '2026-11-06', descripcion: 'd', monto_centavos: 100, moneda: 'ARS', pagador_id: 'm1', reparto_modo: 'igual', reparto_json: '[["m1",50],["m2",50]]', categoria: 'otros', nota: '', lote_id: '', origen: 'manual', creado_por: 'm1', creado_en: 't', anulado: false, reemplaza_id: '' }, o);
  const st = S.snapshotToState({
    personas: [{ id: 'm1', nombre: 'Tomi', color: '#c47a35', alias: '', estado: 'activa' }, { id: 'm2', nombre: 'Pau', color: '', alias: 'Paula', estado: 'archivada' }],
    movimientos: [row({ id: 'a' }), row({ id: 'b', fecha: '2026-12-01', anulado: true }), row({ id: 'c', reparto_json: 'roto' })],
    config: { nombre_grupo: 'Casa de a dos', moneda_base: 'ARS' }
  });
  assert.deepStrictEqual(st.group.members.map(m => [m.id, m.name, !!m.archived]), [['m1', 'Tomi', false], ['m2', 'Pau', true]]);
  assert.strictEqual(st.group.name, 'Casa de a dos');
  assert.deepStrictEqual(Object.keys(st.ledger).sort(), ['2026-11', '2026-12']);
  assert.strictEqual(st.ledger['2026-12'].b.del, true);
  assert.deepStrictEqual(st.ledger['2026-11'].c.sp, [], 'un reparto ilegible no rompe la app');
  assert.strictEqual(S.snapshotToState({ personas: [], movimientos: [] }).group, null, 'sin personas = onboarding');
});
t('plan de escritura: nuevo, edición, borrado, mes distinto', () => {
  let k = 0; const nid = () => 'n' + (++k);
  const known = { e1, old: { id: 'old', del: false, date: '2026-10-01' }, gone: { id: 'gone', del: true } };
  let p = S.planWrites([Object.assign({}, e1, { id: 'fresh' })], known, nid);
  assert.deepStrictEqual([p.add.length, p.anular.length, p.add[0].id], [1, 0, 'fresh']);
  p = S.planWrites([Object.assign({}, e1, { cents: 2000, sp: [['m1', 1000], ['m2', 1000]] })], known, nid);
  assert.deepStrictEqual([p.add[0].id, p.add[0].reemplaza_id, p.anular.length], ['n1', 'e1', 0], 'la edición reemplaza, no pisa');
  assert.deepStrictEqual(p.applied.map(a => a.del || a.add.id), ['n1', 'e1']);
  p = S.planWrites([Object.assign({}, e1, { del: true })], known, nid);
  assert.deepStrictEqual([p.add.length, p.anular], [0, ['e1']]);
  p = S.planWrites([Object.assign({}, e1, { del: true, id: 'nada' })], known, nid);
  assert.deepStrictEqual([p.add.length, p.anular.length], [0, 0], 'borrar algo desconocido no hace nada');
  p = S.planWrites([Object.assign({}, e1, { id: 'gone' })], known, nid);
  assert.deepStrictEqual([p.add.length, p.anular.length], [0, 0], 'un anulado no se resucita');
  // cambio de mes: la app manda entrada nueva (con replaces) + tumba del viejo
  p = S.planWrites([Object.assign({}, e1, { id: 'zz', replaces: 'e1', date: '2026-12-01' }), Object.assign({}, e1, { del: true })], known, nid);
  assert.deepStrictEqual([p.add.length, p.add[0].reemplaza_id, p.anular.length], [1, 'e1', 0], 'no anula dos veces');
});
t('applyPlan refleja altas y bajas en el ledger sin tocar el original', () => {
  const ledger = { '2026-11': { e1: e1 } };
  const L2 = S.applyPlan(ledger, [{ add: Object.assign({}, e1, { id: 'n1', replaces: 'e1' }) }, { del: 'e1' }]);
  assert.strictEqual(L2['2026-11'].e1.del, true); assert.ok(L2['2026-11'].n1);
  assert.strictEqual(ledger['2026-11'].e1.del, undefined);
  assert.deepStrictEqual(C.live(Object.values(L2['2026-11'])).map(e => e.id), ['n1']);
});
t('cierres salen de los pagos «Cierre …» vigentes', () => {
  const pay = (id, note, del) => ({ id, type: 'payment', desc: 'Pago', cents: 100, cur: 'ARS', date: '2026-11-06', paidBy: 'm1', sp: [['m2', 100]], note, at: id, del });
  const r = S.deriveClosings([pay('a', 'Cierre noviembre 2026'), pay('b', 'Cierre noviembre 2026', true), pay('c', 'a mano'), e1]);
  assert.deepStrictEqual(r.map(c => [c.id, c.from, c.to, c.month]), [['a', 'm1', 'm2', '2026-11']]);
});
const SUE = [{ persona: 'm1', desde: '2026-01-01', cents: 200000000, cur: 'ARS' }, { persona: 'm2', desde: '2026-01-01', cents: 100000000, cur: 'ARS' }];
t('reparto: sueldo / igual / exacto y excepción explícita', () => {
  const base = { id: 'g', type: 'expense', desc: 'x', cents: 30000, cur: 'ARS', date: '2026-11-06', paidBy: 'm1', cat: 'otros' };
  let i = S.repartoInfo(Object.assign({}, base, { sp: [['m1', 20000], ['m2', 10000]] }), SUE);
  assert.deepStrictEqual(i, { modo: 'sueldo', exc: false });
  i = S.repartoInfo(Object.assign({}, base, { sp: [['m1', 15000], ['m2', 15000]] }), SUE);
  assert.deepStrictEqual(i, { modo: 'igual', exc: true }, 'a mitades con sueldos cargados = excepción');
  i = S.repartoInfo(Object.assign({}, base, { sp: [['m1', 25000], ['m2', 5000]] }), SUE);
  assert.deepStrictEqual(i, { modo: 'exacto', exc: true });
  i = S.repartoInfo(Object.assign({}, base, { sp: [['m1', 15000], ['m2', 15000]] }), []);
  assert.deepStrictEqual(i, { modo: 'igual', exc: false }, 'sin sueldos no hay excepción');
  i = S.repartoInfo(Object.assign({}, base, { sp: [['m1', 30000]] }), SUE);
  assert.deepStrictEqual(i, { modo: 'sueldo', exc: false }, 'un solo participante');
  i = S.repartoInfo(Object.assign({}, base, { date: '2025-06-01', sp: [['m1', 15000], ['m2', 15000]] }), SUE);
  assert.deepStrictEqual(i, { modo: 'igual', exc: false }, 'antes de los sueldos no hay excepción');
  const pay = { id: 'p', type: 'payment', desc: 'Pago', cents: 500, cur: 'ARS', date: '2026-11-06', paidBy: 'm1', sp: [['m2', 500]], cat: 'pago' };
  assert.strictEqual(S.entryToMov(pay, SUE).excepcion, false, 'un pago no es excepción');
  const m = S.entryToMov(Object.assign({}, base, { sp: [['m1', 15000], ['m2', 15000]], why: 'Invitó Tom' }), SUE);
  assert.deepStrictEqual([m.reparto_modo, m.excepcion, m.motivo_excepcion], ['igual', true, 'Invitó Tom']);
  const m2 = S.entryToMov(Object.assign({}, base, { sp: [['m1', 20000], ['m2', 10000]], why: 'no va' }), SUE);
  assert.deepStrictEqual([m2.reparto_modo, m2.excepcion, m2.motivo_excepcion], ['sueldo', false, undefined], 'sin excepción no se guarda motivo');
  const back = S.rowToEntry({ id: 'z', tipo: 'gasto', descripcion: 'x', monto_centavos: 30000, moneda: 'ARS', fecha: '2026-11-06', pagador_id: 'm1', reparto_json: '[["m1",15000],["m2",15000]]', categoria: 'otros', excepcion: true, motivo_excepcion: 'Invitó Tom', anulado: false });
  assert.deepStrictEqual([back.exc, back.why], [true, 'Invitó Tom']);
});

t('recurrentes: fechas (fin de mes, año nuevo) y próximos vencimientos', () => {
  assert.strictEqual(S.addMonth('2026-01-31', 31), '2026-02-28');
  assert.strictEqual(S.addMonth('2026-02-28', 31), '2026-03-31');
  assert.strictEqual(S.addMonth('2028-01-31', 31), '2028-02-29', 'bisiesto');
  assert.strictEqual(S.addMonth('2026-12-10', 10), '2027-01-10');
  assert.strictEqual(S.firstDue('2026-11-06', 10), '2026-11-10');
  assert.strictEqual(S.firstDue('2026-11-10', 10), '2026-11-10', 'hoy cuenta');
  assert.strictEqual(S.firstDue('2026-11-11', 10), '2026-12-10');
  assert.strictEqual(S.firstDue('2026-02-15', 31), '2026-02-28');
  assert.strictEqual(S.firstDue('2026-12-20', 5), '2027-01-05');
  const recs = [{ id: 'a', active: true, next: '2026-11-10' }, { id: 'b', active: true, next: '2026-11-30' }, { id: 'c', active: false, next: '2026-11-08' }, { id: 'd', active: true, next: '2026-11-01' }];
  assert.deepStrictEqual(S.dueSoon(recs, '2026-11-06', 7).map(r => r.id), ['d', 'a'], 'atrasados y próximos 7 días, en orden; los pausados no');
  const r = { id: 'r', desc: 'Aysa', cents: 450000, cur: 'ARS', day: 10, cat: 'agua', paidBy: 'm1', next: '2026-11-10', active: true };
  assert.deepStrictEqual(S.rowToRec({ id: 'r', descripcion: 'Aysa', monto_estimado_centavos: 450000, moneda: 'ARS', dia_mes: 10, categoria: 'agua', pagador_id: 'm1', proximo_vencimiento: '2026-11-10', activo: true }), r);
  assert.strictEqual(S.recToPayload(r).monto_estimado_centavos, 450000);
});

t('snapshot trae sueldos y recurrentes', () => {
  const st = S.snapshotToState({ personas: [{ id: 'm1', nombre: 'Tomi' }], movimientos: [], sueldos: [{ id: 's', persona_id: 'm1', desde: '2026-01-01', monto_centavos: 5, moneda: 'ARS' }], recurrentes: [] });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(st.sueldos)), [{ id: 's', persona: 'm1', desde: '2026-01-01', cents: 5, cur: 'ARS', note: '', by: null }]);
  assert.deepStrictEqual(st.recs, []);
  assert.deepStrictEqual(S.snapshotToState({ personas: [], movimientos: [] }).sueldos, [], 'backend viejo sin sueldos: no rompe');
});
t('etiquetas: la última gana, aplicada cambia la categoría, dudosa no y queda en la cola', () => {
  const mv = (id, d) => ({ id, tipo: 'gasto', fecha: '2026-11-03', descripcion: d, monto_centavos: 1000, moneda: 'ARS', pagador_id: 'm1', reparto_modo: 'igual', reparto_json: '[["m1",500],["m2",500]]', categoria: 'otros', anulado: false });
  const st = S.snapshotToState({ personas: [{ id: 'm1', nombre: 'Tomi' }, { id: 'm2', nombre: 'Pau' }], movimientos: [mv('a', 'Uno'), mv('b', 'Dos'), mv('c', 'Tres')],
    etiquetas: [{ movimiento_id: 'a', categoria: 'casa', confianza: 0.6, estado: 'dudosa' }, { movimiento_id: 'a', categoria: 'super', confianza: 1, estado: 'aplicada', fuente: 'manual' },
      { movimiento_id: 'b', categoria: 'luz', confianza: 0.6, estado: 'dudosa' }] });
  const all = Object.values(st.ledger).reduce((x, m) => x.concat(Object.values(m)), []), by = Object.fromEntries(all.map(e => [e.id, e]));
  assert.strictEqual(by.a.cat, 'super'); assert.strictEqual(by.c.cat, 'otros'); assert.notStrictEqual(by.b.cat, 'luz');
  assert.deepStrictEqual(st.dudosas.map(d => d.id), ['b']);
});
console.log(n + ' pruebas de traducción');
