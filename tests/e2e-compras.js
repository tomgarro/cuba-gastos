// Compra con amigos: en Personal queda solo mi parte, lo demás es «me deben» con mensaje de WhatsApp; Odi paga en el momento.
const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');
const { boot } = require('./fake-sheet.js');
const EXEC = 'https://script.google.com/macros/s/TEST/exec';
const cfg = Buffer.from(JSON.stringify({ u: EXEC, t: 'TOK' })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
const URL_APP = require('url').pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const sheet = boot(), errs = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await ctx.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  const J = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: typeof o === 'string' ? o : JSON.stringify(o) });
  await ctx.route('https://script.google.com/**', async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    const body = req.postData();
    if (/"action":"leerTicket"/.test(body)) return J(route, { ok: true, comercio: 'Coto Inventado', moneda: 'ARS', fecha: '', total_centavos: 1000000, items: [{ descripcion: 'Fernet', monto_centavos: 700000 }, { descripcion: 'Papel higiénico', monto_centavos: 300000 }] });
    return J(route, sheet.ctx.doPost({ postData: { contents: body } }).getContent());
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_|net::|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  const app = async () => (await p.locator('#app').innerText()).replace(/\n/g, ' ');
  const eventos = () => p.evaluate(() => { const k = Object.keys(localStorage).find(x => x.startsWith('cuba:pe:')); return JSON.parse(localStorage.getItem(k) || '[]'); });

  await p.goto(URL_APP + '#cfg=' + cfg);
  await p.waitForSelector('text=Soy Cuba');
  await p.click('[data-act=ob][data-v="1"]'); await p.fill('[data-i="0"]', 'Tomi'); await p.fill('[data-i="1"]', 'Odi');
  await p.click('[data-act=ob][data-v="2"]'); await p.click('[data-act=obfinish][data-i="0"]');
  await p.waitForSelector('text=Todavía no hay gastos');
  await p.click('.nav button:has-text("Personal")'); await p.click('[data-act=persetup]'); await p.click('[data-act=persaved]'); await p.waitForSelector('#perq');

  // ---- a mano: fernet entre tres, coca entre todos, detergente de Odi y mío ----
  await p.click('[data-act=cmmanual]');
  await p.fill('[data-in=cmmname]', 'Coto'); await p.fill('[data-in=cmmtxt]', 'fernet 12000\ncoca 3500\ndetergente 2800\nnada sin monto');
  await p.click('[data-act=cmarmar]'); await p.waitForSelector('text=Detergente');
  await p.fill('#cmnew', 'Nacho'); await p.click('[data-act=cmadd]');
  await p.click('[data-act=cmtog][data-i="0"][data-k="odi"]'); await p.click('[data-act=cmtog][data-i="0"][data-k="nacho"]');
  await p.click('[data-act=cmall][data-i="1"]');
  await p.click('[data-act=cmtog][data-i="2"][data-k="odi"]');
  const prev = await p.locator('#sheet .preview').innerText();
  assert.ok(/Tu parte/.test(prev) && /Nacho te debe/.test(prev) && /Odi te debe/.test(prev) && /Ya pagó ✓/.test(prev), prev);
  await p.fill('[data-in=cmalias]', 'tom.mp');
  await p.click('[data-act=cmsave]');
  await p.waitForSelector('text=Mensajes para tus amigos');
  const hoja = await p.locator('#sheet').innerText();
  assert.ok(/Hola Nacho/.test(hoja) && /Fernet/.test(hoja) && /alias tom\.mp/.test(hoja) && !/Hola Odi/.test(hoja), 'solo Nacho tiene mensaje:\n' + hoja);
  assert.ok(/wa\.me\/\?text=/.test(await p.locator('#sheet a').first().getAttribute('href')));
  await p.click('#sheet [data-act=close]');

  // ---- cuentas: mi parte + Nacho + Odi = ticket; Personal cuenta solo mi parte ----
  const ev = await eventos(), g = ev.find(e => e.t === 'g'), ds = ev.filter(e => e.t === 'd');
  assert.strictEqual(g.c + ds.reduce((a, d) => a + d.c, 0), 1830000, 'suma exacta del ticket');
  assert.strictEqual(ev.filter(e => e.t === 'r').length, 1, 'Odi ya pagó');
  assert.ok(/me deben/i.test(await app()) && /Nacho/.test(await app()), await app());
  assert.ok(!/Odi/.test(await p.locator('.card:has(h3:text-is("Me deben"))').innerText()), 'Odi no figura como deuda');
  // ---- me paga ----
  await p.click('[data-act=cobro]'); await p.waitForSelector('.card:has(h3:text-is("Me deben"))', { state: 'detached' });
  // ---- nada legible en la Sheet ----
  await new Promise(r => setTimeout(r, 1500));
  assert.ok(!/Nacho|Coto|tom\.mp|Fernet/i.test(JSON.stringify(sheet.grids.Personal)), 'la Sheet solo ve texto cifrado');

  // ---- escanear ticket ----
  await p.setInputFiles('#cmfile', { name: 't.png', mimeType: 'image/png', buffer: PNG });
  await p.waitForSelector('text=Papel higiénico');
  assert.ok(/Coto/i.test(await p.inputValue('[data-in=cmname]')));
  assert.ok(/tom\.mp/.test(await p.inputValue('[data-in=cmalias]')), 'recuerda mi alias');
  await p.click('[data-act=cmtog][data-i="1"][data-k="nacho"]'); await p.click('[data-act=cmsave]');
  await p.waitForSelector('text=Mensajes para tus amigos');
  await p.click('#sheet [data-act=close]');
  await p.click('[data-act=cmrecordar]'); await p.waitForSelector('text=Recordatorio para Nacho');
  assert.ok(/Hola Nacho/.test(await p.locator('#sheet').innerText()));

  await browser.close();
  assert.deepStrictEqual(errs, [], errs.join('\n'));
  console.log('ok  compra con amigos: solo mi parte en Personal, me deben, WhatsApp, Odi paga en el momento, alias recordado');
})().catch(e => { console.error(e); process.exit(1); });
