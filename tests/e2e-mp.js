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
  const csv = [
    'DATE,SOURCE_ID,EXTERNAL_REFERENCE,RECORD_TYPE,DESCRIPTION,NET_CREDIT_AMOUNT,NET_DEBIT_AMOUNT,GROSS_AMOUNT,CURRENCY',
    hoy + 'T12:00:00.000-03:00,7001,,release,SETTLEMENT,0.00,3200.00,3200.00,ARS',
    hoy + 'T13:00:00.000-03:00,7002,,release,PAYOUTS,0.00,5000.00,5000.00,ARS',
    hoy + 'T14:00:00.000-03:00,7003,,release,SETTLEMENT,9000.00,0.00,9000.00,ARS'
  ].join('\n');
  const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  let listas = { release_report: [{ file_name: 'release-report-1.csv', date_created: hoy + 'T09:00:00.000-03:00' }], settlement_report: [] };
  sheet.ctx.UrlFetchApp = { fetch: (u, o) => {
    llamadas.n++; assert.strictEqual(o.method, 'get'); assert.strictEqual(o.headers.Authorization, 'Bearer ' + TOKEN);
    const m = /account\/(release_report|settlement_report)\/(.+)$/.exec(u); if (!m) return resp(404, {});
    if (m[2] === 'list') return resp(200, listas[m[1]]);
    return m[1] === 'release_report' && m[2] === 'release-report-1.csv' ? resp(200, csv) : resp(404, {});
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

  // código mal escrito y bien escrito
  assert.strictEqual(await p.locator('#mpclave').count(), 1);
  await p.fill('#mpclave', 'xxxx'); await p.click('[data-act=mpconectar]'); assert.ok(/3 grupos de 4/.test(await p.locator('#toast').innerText()));
  await p.fill('#mpclave', LINK.toLowerCase()); await p.click('[data-act=mpconectar]');
  await p.waitForSelector('text=gasto nuevo');
  let t = await app();
  assert.ok(/1 gasto nuevo/.test(t) && /1 para revisar/.test(t), t);   // el pago sale de «Dinero en cuenta»; el retiro queda para revisar; el ingreso se ignora
  assert.ok(/Transferiste/.test(t), 'el retiro queda para revisar');
  await p.click('[data-act=mpgasto]'); await p.waitForFunction(() => !/Transferiste/.test(document.querySelector('#app').innerText));

  // otra vez: no duplica nada
  await p.click('[data-act=mpsync]'); await p.waitForSelector('text=Todo al día');

  // mensajes claros cuando no hay nada para traer
  listas = { release_report: [], settlement_report: [] };
  await p.click('[data-act=mpsync]'); await p.waitForSelector('text=Todavía no hay reportes generados');
  listas = { release_report: [{ file_name: 'viejo.csv', date_created: '2020-01-01T00:00:00.000-03:00' }], settlement_report: [] };
  await p.click('[data-act=mpsync]'); await p.waitForSelector('text=ninguno reciente');

  // el token nunca viajó ni quedó en la Sheet; lo que se importó está cifrado
  assert.ok(wire.every(w => !w.includes(TOKEN) && !/APP_USR/.test(w)), 'el token no sale del Apps Script');
  assert.ok(wire.some(w => w.includes(LINK)), 'la app manda el código de enlace');
  await new Promise(r => setTimeout(r, 1200));
  assert.ok(!/transferencia|APP_USR/i.test(JSON.stringify(sheet.grids)), 'nada legible de Mercado Pago en la Sheet');
  assert.ok(await p.evaluate(() => !document.documentElement.outerHTML.includes('APP_USR')), 'la página no tiene el token');

  // desconectar este celu
  await p.click('[data-act=mpdesc]'); assert.strictEqual(await p.locator('#mpclave').count(), 1);
  await browser.close();
  assert.deepStrictEqual(errs, [], errs.join('\n'));
  console.log('ok  Mercado Pago: baja el reporte de «Dinero en cuenta», sin duplicar, mensajes claros y el token nunca sale del Apps Script');
})().catch(e => { console.error(e); process.exit(1); });
