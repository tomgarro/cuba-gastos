// Preguntarle a Cuba: responde con las cuentas locales; Gemini (simulado) solo ve el texto sin nombres. Code.gs real.
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

  const hoy = new Date(); const iso = d => d.toISOString().slice(0, 10);
  const gasto = async (desc, monto, fecha) => {
    await A.p.click('.nav [data-v=inicio]'); await A.p.click('.fab'); await A.p.fill('#fdesc', desc); await A.p.fill('[data-in=amount]', monto);
    await A.p.fill('[data-in=date]', fecha); await A.p.dispatchEvent('[data-in=date]', 'change'); await A.p.click('[data-act=save]'); await sinPend(A.p);
  };
  await gasto('Luz', '12.300', iso(hoy)); await gasto('Coto', '5.000', iso(hoy)); await gasto('Coto', '3.000', iso(hoy));
  await A.p.click('.nav [data-v=inicio]');

  let enviado = [];
  sheet.log.props.GEMINI_API_KEY = 'K'.repeat(30);
  sheet.ctx.UrlFetchApp = { fetch: (u, o) => { enviado.push(o.payload); return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ tipo: 'total', categoria: 'super', mes: '' }) }] } }] }) }; } };
  const src = () => A.p.locator('#askc img').getAttribute('src');
  const preguntar = async txt => { await A.p.fill('#askq', txt); await A.p.press('#askq', 'Enter'); };
  const respuesta = async re => { await A.p.waitForFunction(r => new RegExp(r).test(document.getElementById('askans').innerText) && !document.querySelector('#askc.sniff'), re.source, { timeout: 8000 }); return A.p.locator('#askans').innerText(); };

  // --- Abre con Cuba tranquila; una pregunta conocida se contesta en el celular, sin llamar a nadie ---
  await A.p.click('[data-act=ask]'); await A.p.waitForSelector('#askq');
  const reposo = await src();
  await preguntar('¿Cuánto gastamos en el súper este mes?');
  assert.notStrictEqual(await src(), reposo, 'se pone a escuchar');
  await A.p.waitForSelector('#askc.sniff', { timeout: 3000 });   // y después olfatea (con el sprite de repuesto hasta que existan los nuevos)
  const r1 = await respuesta(/gastaron/); assert.ok(/8\.000/.test(r1) && /2 gastos/.test(r1), r1);
  assert.deepStrictEqual([calls.entenderPregunta, enviado.length], [undefined, 0], 'lo que entiende sola no sale del celular');

  // --- Chips: deuda ---
  await A.p.click('[data-act=askchip]:has-text("Quién le debe")'); const r2 = await respuesta(/Pau le debe .* a Tomi|no se debe nada/); assert.ok(/Pau le debe/.test(r2), r2);

  // --- Sin resultados: «no encuentro» ---
  await preguntar('cuánto gastamos en mascota este mes'); assert.ok(/No encuentro/.test(await respuesta(/No encuentro/)));

  // --- Lo que no entiende va a Gemini SOLO como texto, sin nombres ni montos ---
  await preguntar('che Pau, ¿cuánta guita se fue en la verdulería 15230,50?');
  const r3 = await respuesta(/gastaron/); assert.strictEqual(calls.entenderPregunta, 1);
  assert.ok(/8\.000/.test(r3), r3);
  assert.ok(!/Pau|Tomi|15230/.test(enviado[0]) && /PERSONA/.test(enviado[0]), 'sin nombres ni números largos');

  // --- Una pregunta que ni Gemini entiende: lo dice y no inventa ---
  sheet.ctx.UrlFetchApp = { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ tipo: 'ninguno', categoria: '', mes: '' }) }] } }] }) }) };
  await preguntar('contame un chiste largo'); assert.ok(/no lo entendí/.test(await respuesta(/no lo entendí/)));

  // --- Detalle escondido ---
  await preguntar('¿quién es la mejor perra?'); assert.ok(/¡Yo!/.test(await respuesta(/¡Yo!/)));
  await A.p.waitForSelector('.heart');
  const llamadas = calls.entenderPregunta;
  await preguntar('¿adónde vamos de vacaciones?'); assert.ok(/valija lista/.test(await respuesta(/valija lista/)));
  await preguntar('¿hacemos un asado?'); assert.ok(/parrilla/.test(await respuesta(/parrilla/)));
  assert.strictEqual(calls.entenderPregunta, llamadas, 'el detalle no le pregunta nada a Gemini');

  // --- No guardó ni cambió nada en la Sheet; cerrar frena todo ---
  assert.strictEqual(sheet.grids.Movimientos.length, 4);
  await A.p.click('[data-act=close]'); await A.p.waitForSelector('#askq', { state: 'detached' });

  const bad = errs.filter(Boolean); assert.deepStrictEqual(bad, [], bad.join('\n'));
  console.log('E2E PREGUNTAS OK');
  await browser.close();
})().catch(e => { console.error('E2E PREGUNTAS FAIL: ' + (e.stack || e)); process.exit(1); });
