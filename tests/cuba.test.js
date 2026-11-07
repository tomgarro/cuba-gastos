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
    const h = cuba(m, 120); assert.ok(h.includes('base64,' + k), String(m)); assert.ok(h.includes('alt="Cuba, la doberman"')); assert.ok(!/src="https?:/.test(h), 'nada de internet');
  });
  assert.ok(cuba('sleepy', 120).includes('class="zz"'), 'dormido tiene sus «z»');
  assert.ok(!cuba('happy', 120).includes('zz'));
  assert.ok(/width:120px;height:126px/.test(cuba('idle', 120)), 'caja estable entre poses');
  delete global.CUBA_IMG;
});
t('las poses nuevas: con imagen usan la suya; sin ella, la de un humor básico; sin nada, el vector', () => {
  global.CUBA_IMG = { tranquilo: 'data:image/webp;base64,AAA', feliz: 'data:image/webp;base64,BBB', festejando: 'data:image/webp;base64,PPP' };
  let C = load();
  assert.ok(C.cuba('party', 100).includes('base64,PPP') && C.cuba('party', 100).includes('pose-party'));
  assert.ok(C.cuba('trip', 100).includes('base64,BBB'), 'valija sin imagen → feliz');
  assert.ok(C.cuba('mail', 100).includes('base64,AAA'), 'sobre sin imagen → tranquilo');
  delete global.CUBA_IMG; C = load();
  C.moods.forEach(m => assert.ok(C.cuba(m, 90).includes('<svg') && !C.cuba(m, 90).includes('<img'), m));
});
t('aventuras: cada una tiene pose, texto cálido y nunca se repite la anterior', () => {
  const C = load();
  assert.ok(C.aventuras.length >= 8);
  C.aventuras.forEach(a => { assert.ok(C.moods.includes(a.mood), a.mood); assert.ok(a.texto.length > 10 && a.texto.length < 70, a.texto); });
  for (let ult = -1; ult < C.aventuras.length; ult++) for (let r = 0; r < 1; r += 0.07) { const e = C.elegir(ult, r, {}); assert.notStrictEqual(e.i, ult); assert.ok(!C.aventuras[e.i].solo, 'sin condición no salen las de «solo»'); }
  const conAmano = new Set(); for (let r = 0; r < 1; r += 0.02) conAmano.add(C.elegir(-1, r, { amano: true }).mood);
  assert.ok(conAmano.has('party'), 'a mano sí puede festejar');
  assert.ok(C.elegir(-1, 0.999, {}).i >= 0 && C.elegir(-1, 0, {}).i >= 0, 'bordes del azar');
});
t('el index.html trae todas las poses y pesa razonable', () => {
  const h = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  ['tranquilo', 'feliz', 'alerta', 'durmiendo', 'mimado_a', 'mimado_b', 'escucha_a', 'escucha_b', 'olfatea_a', 'olfatea_b', 'responde_a', 'responde_b', 'no_encuentra',
    'sorprendida', 'triste', 'festejando', 'sobre', 'calculadora', 'regalo', 'celular', 'valija', 'parrilla', 'alcancia', 'ticket', 'lupa'].forEach(k => assert.ok(new RegExp('"' + k + '": "data:image/webp;base64,').test(h), k));
  assert.ok(h.length < 1500000, 'index.html: ' + h.length);
  assert.ok(!/https:\/\/[^"'\s)]*\.(webp|png|jpg)/.test(h.replace(/data:image[^"]+/g, '')), 'sin imágenes remotas');
});
console.log(n + ' pruebas de Cuba');
