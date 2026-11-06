const assert = require('assert');
const C = require('../src/core.js');
let n = 0;
function t(name, fn) { try { fn(); n++; console.log('ok  ' + name); } catch (e) { console.error('FAIL ' + name + '\n  ' + e.message); process.exitCode = 1; } }

t('parseAmount formatos', () => {
  const cases = [['1.234,56', 123456], ['1234.56', 123456], ['15.200', 1520000], ['15200', 1520000], ['$ 1,5', 150],
    ['1.234.567', 123456700], ['0,99', 99], ['2.5', 250], ['-300', -30000], ['abc', null], ['', null], ['1,234.50', 123450], ['12,34', 1234]];
  cases.forEach(([i, o]) => assert.strictEqual(C.parseAmount(i), o, i));
});
t('fmt', () => {
  assert.strictEqual(C.fmt(123456, 'ARS'), '$1.234,56');
  assert.strictEqual(C.fmt(-5, 'USD'), '-US$0,05');
  assert.strictEqual(C.fmt(100000000, 'ARS', { noDecimals: true }), '$1.000.000');
});
t('splitEqual reparte restos y suma exacto', () => {
  const r = C.splitEqual(100, ['a', 'b', 'c'], 0);
  assert.deepStrictEqual(r, [['a', 34], ['b', 33], ['c', 33]]);
  const r2 = C.splitEqual(100, ['a', 'b', 'c'], 1);
  assert.deepStrictEqual(r2, [['a', 33], ['b', 34], ['c', 33]]);
  for (let tot = 1; tot < 500; tot++) for (let n2 = 1; n2 < 8; n2++) {
    const ids = Array.from({ length: n2 }, (_, i) => 'm' + i);
    assert.strictEqual(C.splitEqual(tot, ids, tot).reduce((a, x) => a + x[1], 0), tot);
  }
});
t('computeSplits percent/shares/exact', () => {
  const p = C.computeSplits({ mode: 'percent', total: 1000, ids: ['a', 'b'], values: { a: 70, b: 30 } });
  assert.deepStrictEqual(p.sp, [['a', 700], ['b', 300]]);
  const bad = C.computeSplits({ mode: 'percent', total: 1000, ids: ['a', 'b'], values: { a: 70, b: 20 } });
  assert.ok(bad.error);
  const s = C.computeSplits({ mode: 'shares', total: 1001, ids: ['a', 'b', 'c'], values: { a: 1, b: 1, c: 1 } });
  assert.strictEqual(s.sp.reduce((a, x) => a + x[1], 0), 1001);
  const s2 = C.computeSplits({ mode: 'shares', total: 1000, ids: ['a', 'b'], values: { a: 2, b: 1 } });
  assert.deepStrictEqual(s2.sp, [['a', 667], ['b', 333]]);
  const e = C.computeSplits({ mode: 'exact', total: 1000, ids: ['a', 'b'], values: { a: 600, b: 300 } });
  assert.ok(e.error && e.diff === 100);
  const ok = C.computeSplits({ mode: 'exact', total: 1000, ids: ['a', 'b'], values: { a: 600, b: 400 } });
  assert.deepStrictEqual(ok.sp, [['a', 600], ['b', 400]]);
  assert.ok(C.computeSplits({ mode: 'equal', total: 0, ids: ['a'] }).error);
  assert.ok(C.computeSplits({ mode: 'equal', total: 10, ids: [] }).error);
});
const E = (o) => Object.assign({ id: 'x' + Math.random(), type: 'expense', cur: 'ARS', date: '2026-10-05', cat: 'otros' }, o);
t('balances: gasto + pago', () => {
  const entries = [
    E({ id: '1', cents: 10000, paidBy: 'a', sp: [['a', 5000], ['b', 5000]] }),
    E({ id: '2', cents: 3000, paidBy: 'b', sp: [['a', 1500], ['b', 1500]] }),
    E({ id: '3', type: 'payment', cents: 1000, paidBy: 'b', sp: [['a', 1000]] })
  ];
  const b = C.balances(entries, ['a', 'b']).ARS;
  // a: +10000-5000-1500 + (-1000 por recibir pago => a "debe" 1000 en sp) => 3500 - 1000 = 2500 ; b opuesto
  assert.strictEqual(b.a, 2500); assert.strictEqual(b.b, -2500);
  assert.strictEqual(b.a + b.b, 0);
});
t('balances ignora borrados y separa monedas', () => {
  const entries = [
    E({ id: '1', cents: 1000, paidBy: 'a', sp: [['a', 500], ['b', 500]] }),
    E({ id: '2', cents: 9999, paidBy: 'a', sp: [['b', 9999]], del: true }),
    E({ id: '3', cents: 200, cur: 'USD', paidBy: 'b', sp: [['a', 200]] })
  ];
  const b = C.balances(entries, ['a', 'b']);
  assert.strictEqual(b.ARS.a, 500); assert.strictEqual(b.USD.a, -200); assert.strictEqual(b.USD.b, 200);
});
t('simplify: 3 personas, mínimo de transferencias y suma cero', () => {
  const tr = C.simplify({ a: 5000, b: -3000, c: -2000 });
  assert.deepStrictEqual(tr, [{ from: 'b', to: 'a', cents: 3000 }, { from: 'c', to: 'a', cents: 2000 }]);
  const tr2 = C.simplify({ a: 100, b: 100, c: -150, d: -50 });
  const net = { a: 100, b: 100, c: -150, d: -50 };
  tr2.forEach(x => { net[x.from] += x.cents; net[x.to] -= x.cents; });
  Object.values(net).forEach(v => assert.strictEqual(v, 0));
  assert.ok(tr2.length <= 3);
  assert.deepStrictEqual(C.simplify({ a: 0, b: 0 }), []);
});
t('simplify aleatorio liquida todo', () => {
  for (let k = 0; k < 200; k++) {
    const n2 = 2 + (k % 5), net = {}; let s = 0;
    for (let i = 0; i < n2 - 1; i++) { const v = Math.round((Math.random() - 0.5) * 100000); net['m' + i] = v; s += v; }
    net['m' + (n2 - 1)] = -s;
    const tr = C.simplify(net), r = Object.assign({}, net);
    tr.forEach(x => { r[x.from] += x.cents; r[x.to] -= x.cents; assert.ok(x.cents > 0); });
    Object.values(r).forEach(v => assert.strictEqual(v, 0));
    assert.ok(tr.length <= n2 - 1);
  }
});
t('validate', () => {
  assert.ok(C.validate({ id: '1', cents: 100, paidBy: 'a', sp: [['a', 50]] }));
  assert.strictEqual(C.validate({ id: '1', cents: 100, paidBy: 'a', sp: [['a', 50], ['b', 50]] }), null);
});
t('monthStats', () => {
  const entries = [
    E({ id: '1', cents: 1000, paidBy: 'a', cat: 'super', sp: [['a', 500], ['b', 500]] }),
    E({ id: '2', cents: 400, paidBy: 'b', cat: 'ocio', sp: [['a', 200], ['b', 200]], date: '2026-11-01' }),
    E({ id: '3', type: 'payment', cents: 300, paidBy: 'b', sp: [['a', 300]] })
  ];
  const s = C.monthStats(entries, '2026-10', 'ARS');
  assert.strictEqual(s.total, 1000); assert.strictEqual(s.count, 1); assert.strictEqual(s.cats.super, 1000);
  assert.strictEqual(s.share.b, 500);
});
t('tidyDesc: prolijo, capitalizado, con siglas y palabras chicas', () => {
  assert.strictEqual(C.tidyDesc('  SUPER   coto  '), 'Super Coto');
  assert.strictEqual(C.tidyDesc('pago de la LUZ - edenor,'), 'Pago de la Luz - Edenor');
  assert.strictEqual(C.tidyDesc('iva y abl de noviembre'), 'IVA y ABL de Noviembre');
  assert.strictEqual(C.tidyDesc('cena en  la parrilla/ñandú'), 'Cena en la Parrilla/Ñandú');
  assert.strictEqual(C.tidyDesc(': .. '), '');
  assert.strictEqual(C.quickParse('cena CON amigos 12.000').desc, 'Cena con Amigos');
});
t('servicioDesc: formato Splitwise «SERVICIO | MES», corrige typos y deja lo demás en paz', () => {
  const f = (t, d) => { const r = C.servicioDesc(t, d); return r && [r.desc, r.cat]; };
  assert.deepStrictEqual(f('edfenor', '2026-11-06'), ['LUZ | OCTUBRE', 'luz'], 'typo + principio de mes = mes anterior');
  assert.deepStrictEqual(f('edenor julio', '2026-11-20'), ['LUZ | JULIO', 'luz'], 'el mes escrito manda');
  assert.deepStrictEqual(f('Luz', '2026-11-20'), ['LUZ | NOVIEMBRE', 'luz'], 'después del 10, el mes en curso');
  assert.deepStrictEqual(f('abl septiembre y octubre', '2026-11-05'), ['ABL | SEPTIEMBRE & OCTUBRE', 'impuestos']);
  assert.deepStrictEqual(f('carrefour', '2026-10-05'), ['CARREFOUR | SEPTIEMBRE', 'super']);
  assert.deepStrictEqual(f('seguro auto agosto', '2026-09-15'), ['SEGURO AUTO | AGOSTO', 'seguro']);
  assert.deepStrictEqual(f('aysa', '2026-01-03'), ['AGUA | DICIEMBRE', 'agua'], 'enero cruza el año');
  assert.deepStrictEqual(f('alquiller oct', '2026-11-06'), ['ALQUILER | OCTUBRE', 'alquiler']);
  assert.strictEqual(f('cena con amigos', '2026-11-06'), null, 'lo que no es servicio no se toca');
  assert.strictEqual(C.prolija('cena CON amigos', '2026-11-06'), 'Cena con Amigos');
  assert.strictEqual(C.quickParse('edfenor 80000').desc.slice(0, 3), 'LUZ');
});
t('quickParse', () => {
  let q = C.quickParse('super 15.200');
  assert.ok(/^SUPER \| [A-Z]+$/.test(q.desc)); assert.deepStrictEqual([q.cents, q.cur, q.cat], [1520000, 'ARS', 'super']);
  q = C.quickParse('15200,50 farmacia');
  assert.strictEqual(q.cents, 1520050); assert.strictEqual(q.cat, 'salud');
  q = C.quickParse('hotel 120 usd');
  assert.strictEqual(q.cur, 'USD'); assert.strictEqual(q.cents, 12000); assert.strictEqual(q.cat, 'viaje');
  assert.strictEqual(C.quickParse('hola'), null);
  assert.strictEqual(C.quickParse('2500').desc, 'Gasto');
});
t('parseCSV comillas, comas y saltos', () => {
  const r = C.parseCSV('a,b,c\n"x, y","he said ""hi""",3\r\n1,2,3\n');
  assert.deepStrictEqual(r, [['a', 'b', 'c'], ['x, y', 'he said "hi"', '3'], ['1', '2', '3']]);
  assert.strictEqual(C.parseCSV('a;b\n1;2')[1][1], '2');
});
const SW = `Date,Description,Category,Cost,Currency,Tomi,Pau
2026-10-01,Alquiler,Rent,300000.00,ARS,150000.00,-150000.00
2026-10-03,"Super, Coto",Groceries,20000.00,ARS,-10000.00,10000.00
2026-10-05,Payment,Payment,5000.00,ARS,5000.00,-5000.00
2026-10-07,Cena,Dining out,9000.00,ARS,6000.00,-6000.00
2026-10-09,Cero,General,0.00,ARS,0.00,0.00

2026-10-31,Total balance,,,ARS,151000.00,-151000.00
`;
let n0 = 0;
const mk = () => 'id' + (n0++);
t('parseSplitwise y saldos coinciden con el total balance', () => {
  const r = C.parseSplitwise(SW, [], mk);
  assert.ok(!r.error, r.error);
  assert.strictEqual(r.members.length, 2);
  assert.strictEqual(r.entries.length, 4);
  const [tomi, pau] = r.members.map(m => m.id);
  const b = C.balances(r.entries, [tomi, pau]).ARS;
  assert.strictEqual(b[tomi], 15100000);
  assert.strictEqual(b[pau], -15100000);
  const pay = r.entries.find(e => e.type === 'payment');
  assert.strictEqual(pay.paidBy, tomi); assert.deepStrictEqual(pay.sp, [[pau, 500000]]);
  assert.strictEqual(r.entries[1].desc, 'Super, Coto'); assert.strictEqual(r.entries[1].cat, 'super');
});
t('exportCSV -> parseSplitwise ida y vuelta conserva saldos', () => {
  const r = C.parseSplitwise(SW, [], mk);
  const csv = C.exportCSV(r.entries, r.members);
  n0 = 1000;
  const r2 = C.parseSplitwise(csv, r.members, mk);
  assert.strictEqual(r2.entries.length, r.entries.length);
  const ids = r.members.map(m => m.id);
  assert.deepStrictEqual(C.balances(r2.entries, ids), C.balances(r.entries, ids));
});
t('parseSplitwise omite filas que no cierran', () => {
  const bad = 'Date,Description,Category,Cost,Currency,A,B\n2026-01-01,Mal,General,90.00,ARS,60.00,-30.00\n';
  const r = C.parseSplitwise(bad, [], mk);
  assert.strictEqual(r.entries.length, 0); assert.strictEqual(r.warnings.length, 1);
});
t('parseSplitwise errores', () => {
  assert.ok(C.parseSplitwise('hola', [], mk).error);
  assert.ok(C.parseSplitwise('foo,bar\n1,2', [], mk).error);
});
t('parseSplitwise pago múltiple conserva saldos', () => {
  const csv = 'Date,Description,Category,Cost,Currency,A,B,C\n2026-01-01,Cena,Dining out,90.00,ARS,30.00,30.00,-60.00\n';
  const r = C.parseSplitwise(csv, [], mk);
  assert.strictEqual(r.entries.length, 1); assert.ok(r.entries[0].approx);
  const ids = r.members.map(m => m.id);
  const b = C.balances(r.entries, ids).ARS;
  assert.deepStrictEqual(ids.map(i => b[i]), [3000, 3000, -6000]);
});
t('categorías: servicios por comercio y palabras completas', () => {
  const g = d => C.guessCategory(d);
  const casos = { 'Aysa': 'agua', 'AYSA agosto': 'agua', 'Edenor': 'luz', 'Edesur': 'luz', 'Metrogas': 'gas', 'Personal Flow': 'internet',
    'Expensas octubre': 'expensas', 'Alquiler': 'alquiler', 'Seguro del auto': 'seguro', 'HBO Max': 'streaming', 'Amazon Prime': 'streaming',
    'Spotify': 'streaming', 'Netflix': 'streaming', 'Coto': 'super', 'ABL': 'impuestos', 'Cine con Pau': 'ocio' };
  Object.keys(casos).forEach(k => assert.strictEqual(g(k), casos[k], k));
  assert.strictEqual(g('Gastos varios'), 'otros', '«gastos» no es «gas»');
  assert.strictEqual(g('Gasto prueba'), 'otros');
  assert.strictEqual(g('Salida de luz'), 'luz');
  assert.strictEqual(C.catInfo('no-existe').k, 'otros');
  assert.strictEqual(C.CATS[C.CATS.length - 1].k, 'pago');
  assert.strictEqual(new Set(C.CATS.map(c => c.k)).size, C.CATS.length, 'claves únicas');
});
t('sueldos: reparto proporcional a la fecha del gasto, suma exacto', () => {
  const sue = [
    { persona: 'a', desde: '2026-01-01', cents: 100000000, cur: 'ARS' }, { persona: 'b', desde: '2026-01-01', cents: 50000000, cur: 'ARS' },
    { persona: 'a', desde: '2026-07-01', cents: 200000000, cur: 'ARS' }
  ];
  const sum = r => r.sp.reduce((x, y) => x + y[1], 0);
  let r = C.salarySplit(30000, ['a', 'b'], sue, '2026-03-15');
  assert.deepStrictEqual(r.sp, [['a', 20000], ['b', 10000]], '2/3 y 1/3 con el sueldo de marzo');
  r = C.salarySplit(30000, ['a', 'b'], sue, '2026-07-01');
  assert.deepStrictEqual(r.sp, [['a', 24000], ['b', 6000]], 'desde el 1/7 rige el aumento de a (4/5 y 1/5)');
  r = C.salarySplit(30000, ['a', 'b'], sue, '2026-06-30');
  assert.deepStrictEqual(r.sp, [['a', 20000], ['b', 10000]], 'el día anterior todavía no rige');
  // restos: siempre suma exacto, para cualquier monto
  for (let total = 1; total <= 400; total++) {
    const x = C.salarySplit(total, ['a', 'b'], [{ persona: 'a', desde: '2026-01-01', cents: 123457, cur: 'ARS' }, { persona: 'b', desde: '2026-01-01', cents: 98765, cur: 'ARS' }], '2026-02-01');
    assert.strictEqual(sum(x), total); x.sp.forEach(y => assert.ok(Number.isInteger(y[1]) && y[1] >= 0));
  }
  // montos grandes: total × sueldo supera 2^53 y sigue exacto
  r = C.salarySplit(10000000000000, ['a', 'b'], [{ persona: 'a', desde: '2026-01-01', cents: 3000000000000, cur: 'ARS' }, { persona: 'b', desde: '2026-01-01', cents: 1000000000000, cur: 'ARS' }], '2026-02-01');
  assert.deepStrictEqual(r.sp, [['a', 7500000000000], ['b', 2500000000000]]);
  // faltantes y monedas
  assert.deepStrictEqual(C.salarySplit(1000, ['a', 'c'], sue, '2026-03-01').missing, ['c']);
  assert.deepStrictEqual(C.salarySplit(1000, ['a', 'b'], sue, '2025-12-31').missing, ['a', 'b'], 'antes del primer sueldo no hay vigente');
  assert.strictEqual(C.salarySplit(1000, ['a', 'b'], [{ persona: 'a', desde: '2026-01-01', cents: 1, cur: 'ARS' }, { persona: 'b', desde: '2026-01-01', cents: 1, cur: 'USD' }], '2026-02-01').mixed, true);
  // empate de fecha: gana el último cargado
  assert.strictEqual(C.salaryAt([{ persona: 'a', desde: '2026-01-01', cents: 1, cur: 'ARS' }, { persona: 'a', desde: '2026-01-01', cents: 2, cur: 'ARS' }], 'a', '2026-02-01').cents, 2);
  // un solo participante paga todo
  assert.deepStrictEqual(C.salarySplit(777, ['a'], sue, '2026-03-01').sp, [['a', 777]]);
});

t('importar Splitwise: mapeo a personas existentes, moneda del lote y sin duplicar', () => {
  const csv = 'Date,Description,Category,Cost,Currency,Oda Peralta,Tomás Garro\n\n2026-01-05,Super,Groceries,1000.01,USD,-500.01,500.01\n2026-01-06,Oda P. paid Tomás G.,Payment,300.00,USD,300.00,-300.00\n\n2026-11-06,Total balance, , ,USD,-200.01,200.01\n';
  let n = 0; const imp = C.parseSplitwise(csv, [], () => 'c' + (n++));
  const existing = [{ id: 'm1', name: 'Tom' }, { id: 'm2', name: 'Odi' }];
  const map = C.guessImportMap(imp, existing);
  assert.deepStrictEqual(map, { c0: 'm2', c1: 'm1' }, 'Oda→Odi, Tomás→Tom');
  const r = C.resolveImport(imp, map, 'ARS', existing);
  assert.ok(r.ok); assert.strictEqual(r.members.length, 2, 'no crea personas nuevas');
  assert.ok(r.entries.every(e => e.cur === 'ARS'), 'la moneda del lote pisa la del CSV');
  r.entries.forEach(e => assert.strictEqual(e.sp.reduce((a, x) => a + x[1], 0), e.cents, 'suma exacta'));
  const bal = C.balances(r.entries, ['m1', 'm2']);
  assert.strictEqual(bal.ARS.m1, 20001, 'Tom: +500,01 − 300,00 = +200,01'); assert.strictEqual(bal.ARS.m2, -20001);
  assert.strictEqual(imp.entries[0].cur, 'USD', 'lo parseado no se toca');
  // sin elegir / duplicado / crear nueva
  assert.ok(!C.resolveImport(imp, { c0: '', c1: 'm1' }, 'ARS', existing).ok);
  assert.ok(!C.resolveImport(imp, { c0: 'm1', c1: 'm1' }, 'ARS', existing).ok);
  const nueva = C.resolveImport(imp, { c0: '+', c1: 'm1' }, 'ARS', existing);
  assert.ok(nueva.ok && nueva.members.length === 3 && nueva.members[2].name === 'Oda Peralta');
  // nombres ambiguos: no adivina
  const amb = C.guessImportMap(imp, [{ id: 'a', name: 'Tomi' }, { id: 'b', name: 'Tomás' }]);
  assert.strictEqual(amb.c1, '', 'dos candidatos para Tomás: que elija la persona');
});
console.log('\n' + n + ' tests ok');
