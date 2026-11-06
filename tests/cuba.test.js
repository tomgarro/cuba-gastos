// Cuba ilustrado: usa las poses embebidas, cae al vector sin ellas, y todo es local (anda sin internet).
const assert = require('assert');
const fs = require('fs'), path = require('path');
let n = 0;
function t(name, fn) { try { fn(); n++; console.log('ok  ' + name); } catch (e) { console.error('FAIL ' + name + '\n  ' + (e.stack || e.message)); process.exitCode = 1; } }
const load = () => { delete require.cache[require.resolve('../src/cuba.js')]; return require('../src/cuba.js'); };

t('sin poses embebidas se dibuja el vector (4 humores, nunca vacío)', () => {
  delete global.CUBA_IMG; const { cuba } = load();
  ['idle', 'happy', 'alert', 'sleepy', undefined, 'raro'].forEach(m => { const h = cuba(m, 100); assert.ok(h.includes('<svg') && !h.includes('<img'), String(m)); });
});
t('con poses embebidas usa la ilustración de cada humor, con alt y sin red', () => {
  global.CUBA_IMG = { tranquilo: 'data:image/webp;base64,AAA', feliz: 'data:image/webp;base64,BBB', alerta: 'data:image/webp;base64,CCC', durmiendo: 'data:image/webp;base64,DDD' };
  const { cuba } = load();
  [['idle', 'AAA'], ['happy', 'BBB'], ['alert', 'CCC'], ['sleepy', 'DDD'], [undefined, 'AAA'], ['raro', 'AAA']].forEach(([m, k]) => {
    const h = cuba(m, 120); assert.ok(h.includes('base64,' + k), String(m)); assert.ok(h.includes('alt="Cuba, el doberman"')); assert.ok(!/src="https?:/.test(h), 'nada de internet');
  });
  assert.ok(cuba('sleepy', 120).includes('class="zz"'), 'dormido tiene sus «z»');
  assert.ok(!cuba('happy', 120).includes('zz'));
  assert.ok(/width:120px;height:126px/.test(cuba('idle', 120)), 'caja estable entre poses');
  delete global.CUBA_IMG;
});
t('el index.html trae las 4 poses y pesa razonable', () => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  ['tranquilo', 'feliz', 'alerta', 'durmiendo', 'mimado_a', 'mimado_b'].forEach(k => assert.ok(new RegExp('"' + k + '": "data:image/webp;base64,').test(h), k));
  assert.ok(h.length < 600000, 'index.html: ' + h.length);
  assert.ok(!/https:\/\/[^"'\s)]*\.(webp|png|jpg)/.test(h.replace(/data:image[^"]+/g, '')), 'sin imágenes remotas');
});
console.log(n + ' pruebas de Cuba');
