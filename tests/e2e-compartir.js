// Compartir comprobantes: la imagen solo va a Gemini si se confirma, cada vez; el resultado es un gasto para revisar. Code.gs real, Gemini simulado.
const { chromium } = require('playwright');
const assert = require('assert');
const sinPend = p => p.waitForFunction(() => { const e = document.getElementById('pend'); return !e || e.style.display === 'none'; }, null, { timeout: 8000 });
const openAll = async p => { for (let i = 0; i < 12; i++) { const more = await p.evaluate(() => { const h = document.querySelector('.fold:not(.open)>h3'); if (h) h.click(); return !!h; }); if (!more) break; } };
const path = require('path');
const { boot } = require('./fake-sheet.js');

const EXEC = 'https://script.google.com/macros/s/TEST/exec';
const cfg = Buffer.from(JSON.stringify({ u: EXEC, t: 'TOK' })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
const URL_APP = require('url').pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const J = x => JSON.parse(JSON.stringify(x));

(async () => {
  const sheet = boot();
  const col = n => sheet.TABS.Movimientos.indexOf(n);
  const errs = []; const calls = {};
  const browser = await chromium.launch();
  async function phone(name) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
    await ctx.route('https://script.google.com/**', async route => {
      try { const j = JSON.parse(route.request().postData()); calls[j.action] = (calls[j.action] || 0) + 1; } catch (e) {}
      const out = sheet.ctx.doPost({ postData: { contents: route.request().postData() } }).getContent();
      await new Promise(r => setTimeout(r, 10));
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: out });
    });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(name + ' pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_|net::|Failed to load resource/.test(m.text())) errs.push(name + ' console: ' + m.text()); });
    return { ctx, p, txt: async () => (await p.locator('#app').innerText()).replace(/\n/g, ' ') };
  }
  const toastText = async p => { await p.waitForSelector('#toast.show'); return p.locator('#toast').innerText(); };

  // --- A y B se emparejan y arman el grupo ---
  const A = await phone('A');
  await A.p.goto(URL_APP + '#cfg=' + cfg);
  await A.p.waitForSelector('text=Soy Cuba');
  await A.p.click('[data-act=ob][data-v="1"]');
  await A.p.fill('[data-i="0"]', 'Tomi'); await A.p.fill('[data-i="1"]', 'Pau');
  await A.p.click('[data-act=ob][data-v="2"]'); await A.p.click('[data-act=obfinish][data-i="0"]');
  await A.p.waitForSelector('text=Todavía no hay gastos');
  const [idTomi, idPau] = sheet.grids.Personas.slice(1).map(r => r[0]);
  const B = await phone('B');
  await B.p.goto(URL_APP + '#cfg=' + cfg);
  await B.p.waitForSelector('[data-act=who]'); await B.p.click('[data-act=who][data-id="' + idPau + '"]');
  await B.p.waitForSelector('text=Todavía no hay gastos');

  sheet.log.props.GEMINI_API_KEY = 'K'.repeat(30);
  let gemini = 'ok', lastBody = null;
  sheet.ctx.UrlFetchApp = { fetch: (u, o) => {
    lastBody = o.payload;
    if (gemini === 'caido') return { getResponseCode: () => 500 };
    const txt = JSON.stringify(gemini === 'sinmonto' ? { comercio: 'Kiosco Zorba', monto: 0, moneda: 'ARS', fecha: '', confianza: 0.4 } : { comercio: 'ZORBA MARKET', monto: 15230.5, moneda: 'ARS', fecha: '2026-11-05', confianza: 0.95 });
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: txt }] } }] }) };
  } };
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const subir = async () => { await A.p.click('.nav [data-v=inicio]'); await A.p.click('.fab'); await A.p.waitForSelector('#shfile', { state: 'attached' }); await A.p.setInputFiles('#shfile', { name: 'captura.png', mimeType: 'image/png', buffer: PNG }); await A.p.waitForSelector('text=¿Dale?'); };

  // --- Sin tocar «Sí», la imagen no sale del celular ---
  await subir();
  assert.ok((await A.p.locator('#sheet').innerText()).includes('manda esta imagen a Gemini'), 'explica qué se manda');
  assert.ok(!calls.leerComprobante, 'todavía no se mandó nada');
  await A.p.click('[data-act=shmanual]'); await A.p.waitForSelector('#fdesc');
  assert.strictEqual(await A.p.locator('#fdesc').inputValue(), '');
  assert.ok(!calls.leerComprobante, 'cargar a mano no llama a nadie');
  await A.p.click('[data-act=close]');

  // --- Con el OK: lee, propone y NO guarda solo ---
  await subir(); await A.p.click('[data-act=shread]'); await A.p.waitForSelector('#fdesc');
  assert.strictEqual(calls.leerComprobante, 1);
  assert.strictEqual(await A.p.locator('#fdesc').inputValue(), 'Zorba Market');
  assert.strictEqual(await A.p.locator('[data-in=amount]').inputValue(), '15230,50');
  assert.strictEqual(await A.p.locator('[data-in=date]').inputValue(), '2026-11-05');
  const filasAntes = sheet.grids.Movimientos.length;
  assert.ok(lastBody && !/Tomi|Pau/.test(lastBody), 'a Gemini solo va la imagen y la consigna, sin nombres');
  assert.strictEqual(sheet.grids.Movimientos.length, filasAntes, 'leer no guarda nada');
  await A.p.click('[data-act=save]'); await sinPend(A.p);
  const fila = sheet.grids.Movimientos[sheet.grids.Movimientos.length - 1];
  assert.deepStrictEqual([fila[col('monto_centavos')], fila[col('fecha')]], [1523050, '2026-11-05']);
  assert.ok(!JSON.stringify(sheet.grids).includes('iVBOR') && !JSON.stringify(sheet.grids).includes('/9j/'), 'la imagen no queda en la Sheet');

  // --- Otra imagen: vuelve a pedir el OK ---
  await subir(); assert.strictEqual(calls.leerComprobante, 1, 'no reutiliza el permiso anterior');
  gemini = 'sinmonto'; await A.p.click('[data-act=shread]'); await A.p.waitForSelector('#fdesc');
  assert.strictEqual(await A.p.locator('#fdesc').inputValue(), 'Kiosco Zorba'); assert.strictEqual(await A.p.locator('[data-in=amount]').inputValue(), '');
  assert.ok(/No pude leer el monto/.test(await toastText(A.p)));
  await A.p.click('[data-act=close]');

  // --- Gemini caído: avisa y deja cargar a mano ---
  gemini = 'caido'; await subir(); await A.p.click('[data-act=shread]'); await A.p.waitForSelector('#fdesc');
  assert.ok(/Gemini no respondió/.test(await toastText(A.p)));
  await A.p.click('[data-act=close]');

  sheet.grids.Movimientos.slice(1).forEach(row => assert.strictEqual(JSON.parse(row[col('reparto_json')]).reduce((s, x) => s + x[1], 0), row[col('monto_centavos')]));
  const bad = errs.filter(Boolean); assert.deepStrictEqual(bad, [], bad.join('\n'));
  console.log('E2E COMPARTIR OK');
  await browser.close();
})().catch(e => { console.error('E2E COMPARTIR FAIL: ' + (e.stack || e)); process.exit(1); });
