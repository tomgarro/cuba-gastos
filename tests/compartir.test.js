// Lectura local de comprobantes y mensajes compartidos (src/compartir.js). Todo inventado.
const assert = require('assert');
const K = require('../src/compartir.js');
let n = 0;
function t(name, fn) { try { fn(); n++; console.log('ok  ' + name); } catch (e) { console.error('FAIL ' + name + '\n  ' + (e.stack || e.message)); process.exitCode = 1; } }
const HOY = '2026-11-07';

t('notificación de compra: comercio, monto y fecha', () => {
  const r = K.leerTexto('Compraste $15.230,50 en ZORBA MARKET el 05/11/2026 con tu tarjeta Visa terminada en 1234', HOY);
  assert.deepStrictEqual([r.cents, r.cur, r.date], [1523050, 'ARS', '2026-11-05']);
  assert.ok(/zorba market/i.test(r.desc), r.desc);
});
t('comprobante de transferencia: toma el importe y no los números de cuenta ni de operación', () => {
  const r = K.leerTexto('Transferencia realizada\nImporte: $ 48.000,00\nDestinatario: Juana Pérez\nCuenta 0170012340000012345678\nNro de operación 99887766\nFecha 2026-11-03', HOY);
  assert.deepStrictEqual([r.cents, r.date], [4800000, '2026-11-03']);
  assert.ok(/juana/i.test(r.desc), r.desc);
});
t('dólares y montos sin centavos', () => {
  assert.deepStrictEqual(K.leerTexto('Pagaste USD 12,99 a Zorbaflix', HOY).cents, 1299);
  assert.strictEqual(K.leerTexto('Pagaste USD 12,99 a Zorbaflix', HOY).cur, 'USD');
  assert.strictEqual(K.leerTexto('Total $ 3500', HOY).cents, 350000);
});
t('varios montos: gana el que sigue a «total/importe/pagaste», si no el mayor', () => {
  assert.strictEqual(K.leerTexto('Subtotal $1.000,00\nPropina $100,00\nTotal $1.100,00', HOY).cents, 110000);
  assert.strictEqual(K.leerTexto('Hola $10 y $2.500,00 y $30', HOY).cents, 250000);
});
t('sin monto no inventa nada; fechas inválidas o futuras caen en hoy', () => {
  assert.strictEqual(K.leerTexto('Hola, ¿cómo andás?', HOY), null);
  assert.strictEqual(K.leerTexto('', HOY), null);
  assert.strictEqual(K.leerTexto(null, HOY), null);
  assert.strictEqual(K.leerTexto('Total $100 el 31/02/2026', HOY).date, HOY);
  assert.strictEqual(K.leerTexto('Total $100 el 05/12/2026', HOY).date, HOY, 'del futuro no');
  assert.strictEqual(K.leerTexto('Total $100 el 5/11', HOY).date, '2026-11-05');
});
t('respuesta de Gemini ya limpiada', () => {
  assert.deepStrictEqual(K.deRespuesta({ comercio: 'DIA %', monto_centavos: 123400, moneda: 'ARS', fecha: '2026-11-02' }, HOY).cents, 123400);
  assert.strictEqual(K.deRespuesta({ comercio: 'X', monto_centavos: 0 }, HOY), null);
  assert.strictEqual(K.deRespuesta({ comercio: 'X', monto_centavos: 5, fecha: '2027-01-01' }, HOY).date, HOY);
  assert.strictEqual(K.deRespuesta({ comercio: '', monto_centavos: 5 }, HOY).desc, 'Comprobante');
});
console.log(n + ' pruebas de compartir');
