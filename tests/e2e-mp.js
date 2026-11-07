// Mercado Pago: importación del reporte CSV (reportes que se pisan no duplican, deshacer) y la conexión por API sigue sin sacar el token del Apps Script.
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
  const hoy = new Date().toISOString().slice(0, 10), llamadas = [];
  const CSV_API = 'SOURCE_ID,TRANSACTION_TYPE,TRANSACTION_AMOUNT,TRANSACTION_DATE,SALE_DETAIL\n5001,SETTLEMENT,-3200.00,' + hoy + 'T10:00:00.000-03:00,"""Producto de Farmacia Inventada"""\n5010,SETTLEMENT,-1800.00,' + hoy + 'T11:00:00.000-03:00,"""Producto de Cafe Inventado"""\n5011,SETTLEMENT,2500.00,' + hoy + 'T11:30:00.000-03:00,"""Varios"""\n';
  sheet.ctx.UrlFetchApp = { fetch: (u, o) => {
    llamadas.push(u); assert.strictEqual(o.headers.Authorization, 'Bearer ' + TOKEN); assert.strictEqual(o.method, 'get');
    if (/settlement_report\/list$/.test(u)) return { getResponseCode: () => 200, getContentText: () => JSON.stringify([{ file_name: 'settlement-1-daily.csv', date_created: hoy + 'T21:00:00.000-03:00' }]) };
    return { getResponseCode: () => 200, getContentText: () => CSV_API };
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

  assert.strictEqual(await p.locator('text=Compra con amigos').count(), 0, 'ya no existe Compra con amigos');
  assert.strictEqual(await p.locator('text=Me deben').count(), 0);
  const csv = (filas) => Buffer.from('RELEASE_DATE;TRANSACTION_TYPE;REFERENCE_ID;TRANSACTION_AMOUNT;PARTIAL_BALANCE\n' + filas.join('\n') + '\n');
  const F1 = ['03-11-2026;Pago Farmacia Inventada;5001;-3.200,00;1', '03-11-2026;Pago Kiosco Inventado;5002;-1.500,50;1', '04-11-2026;Transferencia enviada Persona Inventada;5003;-5.000,00;1', '04-11-2026;Ingreso de dinero;5004;9.000,00;1'];
  await p.setInputFiles('#mpfile', { name: 'mp1.csv', mimeType: 'text/csv', buffer: csv(F1) });
  await p.waitForSelector('text=gastos nuevos');
  let t = await p.locator('#sheet').innerText();
  assert.ok(/2 gastos nuevos/.test(t) && /1 para revisar/.test(t) && /1 ingresos/.test(t) && /Farmacia/i.test(t), t);
  await p.click('[data-act=mpimp]'); await p.waitForSelector('text=2 gastos sumados');
  t = await app(); assert.ok(/Farmacia/i.test(t) && /Kiosco/i.test(t) && /Transferiste \$5\.000/.test(t) && !/Ingreso de dinero/i.test(t), t);

  // un segundo reporte que se pisa con el primero: solo entra lo nuevo
  await p.setInputFiles('#mpfile', { name: 'mp2.csv', mimeType: 'text/csv', buffer: csv(F1.concat(['05-11-2026;Pago Panadería Inventada;5006;-2.000,00;1'])) });
  await p.waitForSelector('text=1 gasto nuevo');
  t = await p.locator('#sheet').innerText(); assert.ok(/2 ya estaban/.test(t) && /Panader/i.test(t), t);
  await p.click('[data-act=mpimp]'); await p.waitForSelector('text=1 gasto sumado');
  t = await app(); assert.strictEqual((t.match(/Farmacia/gi) || []).length, 1, 'sin duplicar'); assert.ok(/Panader/i.test(t));
  // el mismo archivo otra vez: nada nuevo
  await p.setInputFiles('#mpfile', { name: 'mp2.csv', mimeType: 'text/csv', buffer: csv(F1.concat(['05-11-2026;Pago Panadería Inventada;5006;-2.000,00;1'])) });
  await p.waitForSelector('text=Todo al día: no hay nada nuevo'); await p.click('#sheet [data-act=close]');

  // deshacer la última importación
  p.once('dialog', d => d.accept());
  await p.click('[data-act=mpundo]'); await p.waitForFunction(() => !/Panader/i.test(document.querySelector('#app').innerText));
  assert.ok(/Farmacia/i.test(await app()), 'la importación anterior sigue');
  // un archivo que no es de Mercado Pago no rompe nada
  await p.setInputFiles('#mpfile', { name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from('a;b\n1;2\n') });
  await p.waitForSelector('text=No reconocí las columnas'); await p.click('#sheet [data-act=close]');

  // conexión automática: Cuba baja sola el reporte programado en Mercado Pago (la app solo conoce el código de enlace)
  await p.fill('#mpclave', 'xxxx'); await p.click('[data-act=mpconectar]'); assert.ok(/3 grupos de 4/.test(await p.locator('#toast').innerText()));
  await p.fill('#mpclave', LINK.toLowerCase()); await p.click('[data-act=mpconectar]');
  await p.waitForSelector('text=1 gasto nuevo en Personal');
  t = await app(); assert.ok(/Cafe Inventado/i.test(t), t); assert.strictEqual((t.match(/Farmacia/gi) || []).length, 1, 'el pago que ya estaba no se duplica');
  assert.ok(llamadas.length === 2 && llamadas[0].endsWith('/v1/account/settlement_report/list'), 'solo listar y bajar el reporte');
  await p.click('[data-act=mpsync]'); await p.waitForSelector('text=Todo al día'); 
  assert.ok(wire.every(w => !w.includes(TOKEN) && !/APP_USR/.test(w)), 'el token no sale del Apps Script');
  assert.ok(wire.some(w => w.includes(LINK)), 'la app manda el código de enlace');
  await new Promise(r => setTimeout(r, 1200));
  assert.ok(!/Farmacia|Kiosco|Panader|APP_USR/i.test(JSON.stringify(sheet.grids)), 'nada legible de Mercado Pago en la Sheet');
  assert.ok(await p.evaluate(() => !document.documentElement.outerHTML.includes('APP_USR')), 'la página no tiene el token');
  await browser.close();
  assert.deepStrictEqual(errs, [], errs.join('\n'));
  console.log('ok  Mercado Pago: CSV a mano y reporte automático, sin duplicar entre reportes que se pisan, deshacer, y el token nunca sale del Apps Script');
})().catch(e => { console.error(e); process.exit(1); });
