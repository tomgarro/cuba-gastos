// «Preguntarle a Cuba»: entiende la pregunta y la contesta con las cuentas locales (src/preguntas.js). Datos inventados.
const assert = require('assert');
const P = require('../src/preguntas.js');
let n = 0;
function t(name, fn) { try { fn(); n++; console.log('ok  ' + name); } catch (e) { console.error('FAIL ' + name + '\n  ' + (e.stack || e.message)); process.exitCode = 1; } }
let k = 0;
const g = (desc, date, cents, cat, o) => Object.assign({ id: 'q' + (k++), type: 'expense', desc, cents, cur: 'ARS', date, cat, paidBy: 'a', sp: [['a', Math.ceil(cents / 2)], ['b', Math.floor(cents / 2)]] }, o || {});
const personas = [{ id: 'a', name: 'Tomi Prueba' }, { id: 'b', name: 'Paula Ejemplo', alias: 'Pau' }];
const ctx = { hoy: '2026-11-12', personas };
const E = [g('LUZ | OCTUBRE', '2026-11-05', 1230000, 'luz'), g('LUZ | SEPTIEMBRE', '2026-10-05', 1000000, 'luz'), g('COTO', '2026-11-08', 500000, 'super'), g('COTO', '2026-11-09', 300000, 'super'),
  g('COTO', '2026-10-09', 700000, 'super'), g('VIAJE', '2026-11-02', 9999999, 'viaje', { ev: 'ev1' }), g('ANULADO', '2026-11-03', 123456, 'super', { del: true }),
  g('NETFLIX', '2026-11-10', 1000, 'streaming', { cur: 'USD' })];
const q = (txt) => P.entender(txt, ctx);

t('entiende período y categoría: «cuánto gastamos en el súper este mes»', () => {
  const c = q('¿Cuánto gastamos en el súper este mes?');
  assert.deepStrictEqual([c.tipo, c.cat, c.desde, c.hasta], ['total', 'super', '2026-11', '2026-11']);
  assert.strictEqual(q('cuanto gastamos en luz el mes pasado').desde, '2026-10');
  assert.deepStrictEqual([q('cuánto fue la luz en octubre').desde, q('gastos de luz en diciembre').desde], ['2026-10', '2025-12']);
});

t('responde con el total del período, sin eventos ni anulados, y sin mezclar monedas', () => {
  const r = P.responder(q('cuánto gastamos en el super este mes'), E, ctx);
  assert.ok(/\$\s?8\.000/.test(r.texto) && /2 gastos/.test(r.texto), r.texto);
  assert.strictEqual(r.sprite, 'responde');
  const todo = P.responder(q('cuánto gastamos este mes'), E, ctx).texto;
  assert.ok(!/9\.999/.test(todo) && /USD|US\$|U\$S/.test(todo) && / y /.test(todo), todo);
});

t('lo último de una categoría, y «no encuentro» cuando no hay', () => {
  const r = P.responder(q('cuándo fue el último gasto de luz'), E, ctx);
  assert.ok(/LUZ \| OCTUBRE/.test(r.texto) && /05\/11\/2026/.test(r.texto), r.texto);
  const n0 = P.responder(q('cuánto gastamos en mascota este mes'), E, ctx);
  assert.strictEqual(n0.sprite, 'no_encuentra');
  assert.strictEqual(P.responder(q('cuándo fue el último gasto de gas'), E, ctx).sprite, 'no_encuentra');
});

t('deudas: quién le debe a quién, por persona nombrada o alias, y a mano', () => {
  const r = P.responder(q('cuánto me debe Pau'), E, ctx);
  assert.ok(/Paula le debe .* a Tomi/.test(r.texto), r.texto);
  assert.ok(/a mano/.test(P.responder(q('estamos a mano'), [g('X', '2026-11-01', 1000, 'super', { sp: [['a', 1000]] })], ctx).texto));
});

t('entiende el año explícito: «de agua en 2026», «en 2025», «octubre de 2025»', () => {
  const c = q('cuanto gastamos de agua en 2026?');
  assert.deepStrictEqual([c.cat, c.desde, c.hasta, c.porDefecto], ['agua', '2026-01', '2026-11', false]);
  assert.deepStrictEqual([q('cuánto gastamos en 2025').desde, q('cuánto gastamos en 2025').hasta], ['2025-01', '2025-12']);
  assert.strictEqual(q('cuánto fue la luz en octubre de 2025').desde, '2025-10');
  const r = P.responder(q('cuánto gastamos de luz en 2026'), E, ctx);
  assert.ok(/\$\s?22\.300/.test(r.texto) && /lo que va de 2026/.test(r.texto), r.texto);
});

t('lo que más se va', () => {
  const r = P.responder(q('en qué gastamos más este mes'), E, ctx);
  assert.ok(/^En este mes lo que más se va es luz/.test(r.texto), r.texto);
});

t('cada respuesta trae la pose de Cuba que le toca', () => {
  assert.strictEqual(P.responder(q('cuándo fue el último gasto de luz'), E, ctx).sprite, 'ticket');
  assert.strictEqual(P.responder(q('cuánto me debe Pau'), E, ctx).sprite, 'calculadora');
  assert.strictEqual(P.responder(q('en qué gastamos más este mes'), E, ctx).sprite, 'lupa');
  assert.strictEqual(P.responder(q('estamos a mano'), [g('X', '2026-11-01', 1000, 'super', { sp: [['a', 1000]] })], ctx).sprite, 'festejando');
});

t('lo que no entiende devuelve null; la consulta de Gemini se valida sola', () => {
  assert.strictEqual(q('hola cuba'), null);
  assert.strictEqual(q('cuándo fue el último'), null, 'sin categoría no hay "último"');
  assert.strictEqual(P.validarConsulta({ tipo: 'borrar' }, ctx), null);
  const v = P.validarConsulta({ tipo: 'total', categoria: 'inventada', mes: '2099-01' }, ctx);
  assert.deepStrictEqual([v.cat, v.desde], [null, '2026-11'], 'categoría o mes inválidos caen a lo seguro');
  assert.strictEqual(P.validarConsulta({ tipo: 'total', categoria: 'luz', mes: '2026-09' }, ctx).desde, '2026-09');
});

t('lo que sale hacia Gemini va sin nombres, alias ni números largos', () => {
  const s = P.anonimizar('¿Cuánto le debo a Pau? Tomi pagó 15230,50 a la cuenta 12345678', personas);
  assert.ok(!/Pau|Tomi|15230|12345678/.test(s) && /PERSONA/.test(s), s);
});

console.log(n + ' pruebas de preguntas');
