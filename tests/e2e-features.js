// Interruptores: con FEATURES.personal apagado (por defecto) no se ve nada de Personal; con el override de pruebas, vuelve entero.
const { chromium } = require('playwright');
const assert = require('assert');
(async () => {
  const b = await chromium.launch();
  const url = require('url').pathToFileURL(require('path').resolve(__dirname, '..', 'index.html')).href;
  const seed = () => { localStorage.setItem('cuba:v1', JSON.stringify({ group: { name: 'Casa', cur: 'ARS', members: [{ id: 'm1', name: 'Tomi', color: '#c47a35' }, { id: 'm2', name: 'Pau', color: '#4f7c6d' }] }, ledger: {}, closings: [] })); localStorage.setItem('cuba:me', 'm1'); };
  async function abrir(on) {
    const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
    await p.addInitScript(seed);
    await p.goto(on ? require('./con-personal.js')() : url); await p.waitForSelector('.nav');
    return { p, errs };
  }
  let { p, errs } = await abrir(false);
  assert.strictEqual(await p.locator('.nav [data-v=personal]').count(), 0, 'apagado: no hay pestaña Personal');
  assert.strictEqual(await p.locator('.nav button').count(), 4, 'apagado: quedan 4 pestañas');
  await p.click('.nav [data-v=ajustes]');
  assert.ok(!/Personal|🔒|Mercado Pago/.test(await p.locator('#app').innerText()), 'apagado: Ajustes no nombra Personal ni Mercado Pago');
  assert.deepStrictEqual(errs, [], 'sin errores: ' + errs);
  ({ p, errs } = await abrir(true));
  assert.strictEqual(await p.locator('.nav [data-v=personal]').count(), 1, 'encendido: vuelve la pestaña Personal');
  await p.click('.nav [data-v=personal]');
  assert.ok(/Personal/.test(await p.locator('#app').innerText()), 'encendido: se ve Personal');
  assert.deepStrictEqual(errs, [], 'sin errores: ' + errs);
  await b.close(); console.log('ok  interruptor Personal: apagado lo oculta todo, encendido lo devuelve');
})().catch(e => { console.error(e); process.exit(1); });
