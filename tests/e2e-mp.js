// Mercado Pago (simulado): cobros que se marcan solos, sugerencias, gastos nuevos en Personal; el token nunca sale del Apps Script.
const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');
const { boot } = require('./fake-sheet.js');
const EXEC = 'https://script.google.com/macros/s/TEST/exec';
const cfg = Buffer.from(JSON.stringify({ u: EXEC, t: 'TOK' })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
const URL_APP = require('url').pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const TOKEN = 'APP_USR-1234567890123456-111111-abcdef0123456789abcdef0123456789-9999', LINK = 'ABCD-1234-EF56';

(async () => {
  const sheet = boot(), errs = [], wire = [];
  sheet.log.props.MP_ACCESS_TOKEN = TOKEN; sheet.log.props.MP_LINK = LINK;
  const hoy = new Date().toISOString().slice(0, 10), llamadas = { n: 0 };
  const pago = (id, monto, extra) => Object.assign({ id, status: 'approved', transaction_amount: monto, currency_id: 'ARS', date_approved: hoy + 'T12:00:00.000-03:00', operation_type: 'regular_payment', payment_type_id: 'account_money', description: '', payer: { id: 5, email: 'x@example.com' } }, extra || {});
  sheet.ctx.UrlFetchApp = { fetch: (u, o) => {
    llamadas.n++; assert.strictEqual(o.headers.Authorization, 'Bearer ' + TOKEN);
    const res = /collector\.id=me/.test(u) ? [pago(1, 7500, { payer: { id: 6, first_name: 'Nacho', last_name: 'Pérez' } }), pago(2, 4000)] : [pago(3, 3200, { description: 'Farmacia Inventada' }), pago(4, 5000, { operation_type: 'money_transfer' })];
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ results: res }) };
  } };
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await ctx.route('https://script.google.com/**', async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    wire.push(req.postData());
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: sheet.ctx.doPost({ postData: { contents: req.postData() } }).getContent() });
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_|net::|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  const app = async () => (await p.locator('#app').innerText()).replace(/\n/g, ' ');

  await p.goto(URL_APP + '#cfg=' + cfg);
  await p.waitForSelector('text=Soy Cuba');
  await p.click('[data-act=ob][data-v="1"]'); await p.fill('[data-i="0"]', 'Tomi'); await p.fill('[data-i="1"]', 'Odi');
  await p.click('[data-act=ob][data-v="2"]'); await p.click('[data-act=obfinish][data-i="0"]');
  await p.waitForSelector('text=Todavía no hay gastos');
  await p.click('.nav button:has-text("Personal")'); await p.click('[data-act=persetup]'); await p.click('[data-act=persaved]'); await p.waitForSelector('#perq');

  // deudas: Nacho 7.500 y Fede 4.000
  await p.click('[data-act=cmmanual]'); await p.fill('[data-in=cmmname]', 'Coto'); await p.fill('[data-in=cmmtxt]', 'fernet 12000\ncoca 3500');
  await p.click('[data-act=cmarmar]'); await p.waitForSelector('text=Coca');
  for (const n of ['Nacho', 'Fede']) { await p.fill('#cmnew', n); await p.click('[data-act=cmadd]'); }
  await p.click('[data-act=cmtog][data-i="0"][data-k="nacho"]'); await p.click('[data-act=cmtog][data-i="0"][data-k="fede"]');
  await p.click('[data-act=cmtog][data-i="1"][data-k="nacho"]'); await p.click('[data-act=cmtog][data-i="1"][data-k="__yo"]');
  await p.click('[data-act=cmsave]'); await p.waitForSelector('text=Mensajes para tus amigos'); await p.click('#sheet [data-act=close]');
  assert.ok(/Nacho \$7\.500/.test(await app()) && /Fede \$4\.000/.test(await app()), await app());

  // conectar con el código de enlace
  assert.strictEqual(await p.locator('#mpclave').count(), 1);
  await p.fill('#mpclave', 'xxxx'); await p.click('[data-act=mpconectar]'); assert.ok(/3 grupos de 4/.test(await p.locator('#toast').innerText()));
  await p.fill('#mpclave', LINK.toLowerCase()); await p.click('[data-act=mpconectar]');
  await p.waitForSelector('text=¿Te pagó Fede?');
  let t = await app();
  assert.ok(/1 cobro marcado \(Nacho\)/.test(t) && /1 gasto nuevo/.test(t) && /2 para revisar/.test(t), t);
  assert.ok(!/Nacho \$7\.500/.test(t) && /Fede \$4\.000/.test(t), 'Nacho ya no debe nada');
  assert.ok(/Farmacia/i.test(t), 'el pago se sumó a Personal');
  await p.click('[data-act=mpsi]'); await p.waitForSelector('.card:has(h3:text-is("Me deben"))', { state: 'detached' });
  await p.click('[data-act=mpgasto]'); await p.waitForSelector('text=Transferencia');
  assert.ok(!/Transferiste/.test(await app()));

  // otra vez: no duplica nada
  await p.click('[data-act=mpsync]'); await p.waitForSelector('text=Todo al día');
  assert.strictEqual((await app()).match(/Farmacia/gi).length, 1, 'sin duplicar');

  // el token nunca viajó ni quedó en la Sheet; lo que se importó está cifrado
  assert.ok(wire.every(w => !w.includes(TOKEN) && !/APP_USR/.test(w)), 'el token no sale del Apps Script');
  assert.ok(wire.some(w => w.includes(LINK)), 'la app manda el código de enlace');
  await new Promise(r => setTimeout(r, 1200));
  assert.ok(!/Farmacia|Nacho|Fede|APP_USR/i.test(JSON.stringify(sheet.grids)), 'nada legible de Mercado Pago en la Sheet');
  assert.ok(await p.evaluate(() => !document.documentElement.outerHTML.includes('APP_USR')), 'la página no tiene el token');

  // desconectar este celu
  await p.click('[data-act=mpdesc]'); assert.strictEqual(await p.locator('#mpclave').count(), 1);
  await browser.close();
  assert.deepStrictEqual(errs, [], errs.join('\n'));
  console.log('ok  Mercado Pago: cobro marcado solo, sugerencia, gasto nuevo, sin duplicar y el token nunca sale del Apps Script');
})().catch(e => { console.error(e); process.exit(1); });
