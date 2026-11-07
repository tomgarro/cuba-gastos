// Lo local de las ideas con Gemini: voz libre, suscripciones, ¿es caro?, antes de comprar, datos del mes y ticket.
const assert = require('assert');
const IA = require('../src/ia.js');
let n = 0;
function t(name, fn) { try { fn(); n++; console.log('ok  ' + name); } catch (e) { console.error('FAIL ' + name + '\n  ' + (e.stack || e.message)); process.exitCode = 1; } }
const HOY = '2026-11-07';
const sum = l => l.map(x => x.desc + ':' + x.cents + ':' + x.fecha).join(' | ');

t('números hablados: mil, lucas, palos, k y palabras', () => {
  const f = IA.numerosHablados;
  assert.strictEqual(f('super 15 mil'), 'super 15000');
  assert.strictEqual(f('cafe quince mil'), 'cafe 15000');
  assert.strictEqual(f('taxi 3 lucas'), 'taxi 3000');
  assert.strictEqual(f('una luca de nafta'), '1000 de nafta');
  assert.strictEqual(f('alquiler 1,5 palos'), 'alquiler 1500000');
  assert.strictEqual(f('un palo'), '1000000');
  assert.strictEqual(f('cena treinta y cinco mil'), 'cena 35000');
  assert.strictEqual(f('ropa ciento veinte mil pesos'), 'ropa 120000');
  assert.strictEqual(f('mate 15k'), 'mate 15000');
  assert.strictEqual(f('mil pesos de pan'), '1000 de pan');
  assert.strictEqual(f('un cafe 3.200'), 'un cafe 3.200', 'un monto escrito no se toca y «un» sigue siendo artículo');
});
const cc = l => l.map(x => [x.cents, x.fecha, x.cat]);
t('voz libre: varios gastos en una frase', () => {
  const l = IA.trozos('hoy fue el súper 15 mil, un café 3 lucas y la farmacia 8000', HOY);
  assert.deepStrictEqual(cc(l), [[1500000, HOY, 'super'], [300000, HOY, 'comida'], [800000, HOY, 'salud']]);
  assert.ok(/^SUPER|^Súper/i.test(l[0].desc) && /Café/.test(l[1].desc) && /Farmacia/.test(l[2].desc), sum(l));
});
t('voz libre: lo que no trae monto se pega al siguiente, «ayer» vale para todos y no se come el dinero', () => {
  const l = IA.trozos('ayer pizza y birra 8000, uber 4.500 y nafta quince mil', HOY);
  assert.deepStrictEqual(cc(l).map(x => x[0]), [800000, 450000, 1500000]);
  assert.ok(l.every(x => x.fecha === '2026-11-06'));
  assert.ok(/pizza/i.test(l[0].desc) && /birra/i.test(l[0].desc));
  assert.strictEqual(IA.trozos('hola qué tal', HOY).length, 0);
  const dec = IA.trozos('uber 3.200,50', HOY); assert.deepStrictEqual(dec.map(x => x.cents), [320050], 'la coma decimal no separa gastos');
  assert.deepStrictEqual(IA.trozos('cafe 3000,taxi 500', HOY).map(x => x.cents), [300000, 50000]);
  assert.strictEqual(IA.trozos('u$s 20 netflix y dos palos de la tele', HOY).map(x => x.cur + x.cents).join(), 'USD2000,ARS200000000');
});

const E = (id, desc, cents, date, cat, extra) => Object.assign({ id, type: 'expense', desc, cents, cur: 'ARS', date, cat: cat || 'otros' }, extra || {});
t('suscripciones: lo que se repite todos los meses y no es recurrente; ignora súper, eventos y variables', () => {
  const es = [];
  ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].forEach((m, i) => {
    es.push(E('n' + i, 'NETFLIX | ' + m, 650000 + i * 20000, m + '-12', 'streaming'));
    es.push(E('s' + i, 'Carrefour', 1500000 + i * 900000, m + '-05', 'super'));
    es.push(E('g' + i, 'Gimnasio Fuerte', 4000000, m + '-03', 'otros'));
    es.push(E('v' + i, 'Edenor ' + m, 1000000 + i * 3000000, m + '-20', 'luz'));
  });
  es.push(E('x', 'Netflix', 650000, '2026-10-12', 'streaming', { ev: 'viaje1' }));
  const r = IA.suscripciones(es, [], HOY);
  assert.deepStrictEqual(r.map(x => x.clave), ['gimnasio fuerte', 'netflix']);
  assert.strictEqual(r[0].anual, 48000000);
  assert.deepStrictEqual(IA.suscripciones(es, [{ desc: 'Netflix' }, { desc: 'Gimnasio' }], HOY), [], 'las que ya son recurrentes no se sugieren');
  assert.deepStrictEqual(IA.suscripciones(es.filter(e => e.date < '2026-09'), [], HOY), [], 'si dejó de repetirse, no');
  assert.strictEqual(IA.suscripciones(es.slice(0, 3), [], HOY).length, 0, 'con poca historia no opina');
});
t('¿es caro?: mediana propia del comercio o de la categoría; sin historia no opina', () => {
  const h = [1, 2, 3, 4].map(i => E('c' + i, 'Coto', 1000000, '2026-0' + (5 + i) + '-10', 'super'));
  const caro = IA.esCaro(h, { desc: 'Coto', cents: 1500000, cur: 'ARS', cat: 'super' });
  assert.deepStrictEqual([caro.pct, caro.n, caro.base, caro.nivel], [50, 4, 'comercio', 'caro']);
  assert.strictEqual(IA.esCaro(h, { desc: 'Coto', cents: 1050000, cur: 'ARS', cat: 'super' }).nivel, 'normal');
  assert.strictEqual(IA.esCaro(h, { desc: 'Coto', cents: 700000, cur: 'ARS', cat: 'super' }).nivel, 'barato');
  assert.strictEqual(IA.esCaro(h, { desc: 'Dia', cents: 1500000, cur: 'ARS', cat: 'super' }), null, 'otro comercio con 4 compras de la categoría: poca historia');
  const cat = h.concat([E('c5', 'Dia', 1000000, '2026-10-01', 'super')]);
  assert.strictEqual(IA.esCaro(cat, { desc: 'Dia', cents: 2000000, cur: 'ARS', cat: 'super' }).base, 'categoria');
  assert.strictEqual(IA.esCaro(h, { desc: 'Coto', cents: 1500000, cur: 'USD', cat: 'super' }), null, 'cada moneda aparte');
});
t('antes de comprar: cuota, peso sobre el mes y qué queda por día', () => {
  const c = IA.compra(12000000, 6, 8000000, 3000000, 20);
  assert.deepStrictEqual([c.cuota, c.pctMes, c.libreDespues, c.porDiaDespues, c.nivel], [2000000, 25, 1000000, 50000, 'mediana']);
  assert.strictEqual(IA.compra(10000001, 3, 0, null, 10).cuota, 3333334, 'redondea para arriba: nunca queda corto');
  assert.strictEqual(IA.compra(100, 1, 1000, 50, 5).porDiaDespues, 0, 'si no alcanza, 0 por día');
  assert.strictEqual(IA.compra(30000000, 1, 50000000, null, 0).nivel, 'pesada');
});
t('datos del mes para Gemini: agregados, sin descripciones, sin personas, sin eventos', () => {
  const es = [E('a', 'Cena con Pablo', 500000, '2026-10-02', 'comida'), E('b', 'Coto', 2000000, '2026-10-09', 'super'), E('c', 'Coto', 1000000, '2026-09-09', 'super'), E('d', 'Vuelo', 9000000, '2026-10-05', 'viaje', { ev: 'v1' }), E('p', 'Pago', 1000, '2026-10-05', 'pago', { type: 'payment' })];
  const d = IA.datosMes(es, '2026-10', '2026-09', 'ARS');
  assert.deepStrictEqual([d.gastado, d.gastos, d.mes_anterior, d.variacion_pct], [25000, 2, 10000, 150]);
  assert.deepStrictEqual(d.categorias.map(x => [x.categoria, x.monto, x.antes]), [['Supermercado', 20000, 10000], ['Salidas / comida', 5000, 0]]);
  assert.ok(!/Pablo|Coto|Vuelo/.test(JSON.stringify(d)), 'ni una descripción');
  assert.ok(JSON.stringify(d).length < 1000);
});
t('ticket por ítems: lo repartido suma exacto el ticket', () => {
  const items = [{ cents: 100001 }, { cents: 250050 }, { cents: 33 }, { cents: 999 }];
  const r = IA.repartirTicket(items, ['ambos', 'yo', 'otro']);
  assert.deepStrictEqual([r.ambos, r.yo, r.otro, r.total], [100001 + 999, 250050, 33, 351083]);
  assert.strictEqual(r.total, items.reduce((s, x) => s + x.cents, 0));
});
console.log(n + ' pruebas de ideas con Gemini');
