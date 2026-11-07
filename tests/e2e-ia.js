// Ideas con Gemini de punta a punta (Gemini simulado): varios gastos de una, ticket por ítems, suscripciones, ¿es caro?,
// antes de comprar, carta/explica, regalos y el aviso cuando el Apps Script es viejo. Nada de nombres ni sueldos sale a Gemini.
const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');
const { boot } = require('./fake-sheet.js');
const EXEC = 'https://script.google.com/macros/s/TEST/exec';
const cfg = Buffer.from(JSON.stringify({ u: EXEC, t: 'TOK' })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
const URL_APP = require('url').pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const sheet = boot(), errs = [], ia = [], modo = { viejo: false };
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await ctx.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  const J = (r, o) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
  await ctx.route('https://script.google.com/**', async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    const body = req.postData(), a = (/"action":"([A-Za-z]+)"/.exec(body) || [])[1];
    if (['leerTicket', 'entenderGastos', 'iaTexto'].includes(a)) {
      ia.push(body);
      if (modo.viejo) return J(route, { ok: false, error: 'accion_desconocida', message: 'Acción desconocida: ' + a });
      if (a === 'leerTicket') return J(route, { ok: true, comercio: 'Parrilla Don Julio Inventada', moneda: 'ARS', fecha: '', total_centavos: 3000000, items: [
        { descripcion: 'Asado de tira', monto_centavos: 1200000 }, { descripcion: 'Vino', monto_centavos: 800000 }, { descripcion: 'Flan', monto_centavos: 500000 }] });
      if (a === 'entenderGastos') return J(route, { ok: true, gastos: [{ descripcion: 'Kiosco', monto_centavos: 45000, moneda: 'ARS', categoria: 'super', fecha: '' }, { descripcion: 'Nafta', monto_centavos: 800000, moneda: 'ARS', categoria: 'transporte', fecha: '' }] });
      return J(route, { ok: true, texto: 'Texto de prueba de Cuba 🐾' });
    }
    return J(route, JSON.parse(sheet.ctx.doPost({ postData: { contents: body } }).getContent()));
  });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_|net::|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  const txt = async sel => (await p.locator(sel || '#app').innerText()).replace(/\n/g, ' ');
  const hoja = async () => (await p.locator('#sheet').innerText()).replace(/\n/g, ' ');
  const settle = () => p.waitForFunction(() => !document.querySelector('#pend') || document.querySelector('#pend').style.display === 'none', null, { timeout: 8000 });
  const nuevo = async () => { await p.click('.nav button:has-text("Inicio")'); await p.click('.fab'); await p.waitForSelector('#quick'); };

  const H = () => sheet.grids.Movimientos[0], movs = () => sheet.grids.Movimientos.slice(1).map(r => { const o = {}; H().forEach((h, i) => { o[h] = r[i]; }); return o; }).filter(o => String(o.anulado).toUpperCase() !== 'TRUE');
  const until = async (f, ms = 8000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) throw new Error('timeout esperando la Sheet'); await new Promise(r => setTimeout(r, 100)); } };
  const suma = o => JSON.parse(o.reparto_json).reduce((a, x) => a + x[1], 0);
  await p.goto(URL_APP + '#cfg=' + cfg);
  await p.waitForSelector('text=Soy Cuba');
  await p.click('[data-act=ob][data-v="1"]'); await p.fill('[data-i="0"]', 'Tomi'); await p.fill('[data-i="1"]', 'Pau');
  await p.click('[data-act=ob][data-v="2"]'); await p.click('[data-act=obfinish][data-i="0"]');
  await p.waitForSelector('text=Todavía no hay gastos');

  // ---- 1. varios gastos en una frase (compartido) ----
  await nuevo();
  await p.fill('#quick', 'café 3 mil, taxi 4500 y farmacia 12.000'); await p.press('#quick', 'Enter');
  await p.waitForSelector('text=Entendí 3 gastos', {timeout: 4000}).catch(async e => { console.log('ERRS', errs, await hoja()); throw e; });
  await p.click('[data-act=multick][data-i="1"]');                       // destilda el taxi
  assert.ok(/Anotar 2/.test(await hoja()), await hoja());
  await p.click('[data-act=multisave]'); await settle();
  await until(() => movs().length === 2).catch(async e => { console.log('DBG', JSON.stringify(sheet.grids.Movimientos).slice(0,600), await txt('#toast'), errs); throw e; });
  let all = movs();
  assert.strictEqual(all.length, 2, JSON.stringify(all.map(o => o.descripcion)));
  assert.ok(all.every(o => suma(o) === o.monto_centavos), 'los repartos suman exacto');
  assert.deepStrictEqual(all.map(o => o.monto_centavos).sort((a, b) => a - b), [300000, 1200000]);

  // ---- 2. ticket por ítems ----
  await nuevo();
  await p.setInputFiles('#tkfile', { name: 't.png', mimeType: 'image/png', buffer: PNG });
  await p.waitForSelector('text=Asado de tira');
  assert.ok(/Los dos/.test(await hoja()) && !/\bYo\b/.test(await hoja()), 'sin Personal creado no hay «Yo»');
  await p.click('[data-act=tkas][data-i="1"][data-v="otro"]');           // el vino es de Pau
  await p.click('[data-act=tksave]'); await settle();
  assert.ok(/detalle sorpresa/.test(await p.locator('#toast').innerText()), 'asado: detalle sorpresa');
  await until(() => movs().filter(o => /Parrilla/i.test(o.descripcion)).length === 2);
  all = movs().filter(o => /Parrilla/i.test(o.descripcion));
  assert.strictEqual(all.length, 2, JSON.stringify(all.map(o => o.descripcion)));
  const comun = all.find(o => !/\(de /.test(o.descripcion)), suyo = all.find(o => /\(de /.test(o.descripcion));
  assert.strictEqual(comun.monto_centavos, 2200000, 'asado + flan entre los dos'); assert.strictEqual(suyo.monto_centavos, 800000);
  assert.strictEqual(JSON.parse(suyo.reparto_json).length, 1, 'el vino es 100 % de Pau');

  // ---- 3. Personal: varios gastos, Gemini para lo que no se entiende, antes de comprar ----
  await p.click('.nav button:has-text("Personal")'); await p.click('[data-act=persetup]'); await p.click('[data-act=persaved]'); await p.waitForSelector('#perq');
  await p.fill('#perq', 'almuerzo 4500, helado 3000'); await p.press('#perq', 'Enter');
  await p.waitForSelector('text=Helado'); assert.ok(/Almuerzo/i.test(await txt()));
  await p.fill('#perq', 'el kiosquero me cobró cuatrocientos cincuenta pesos y la nafta ochocientos pesos'); await p.press('#perq', 'Enter');
  await p.waitForSelector('text=Entendí 2 gastos'); assert.ok(/Van a tu Personal/.test(await hoja()));
  await p.click('[data-act=multisave]'); await p.waitForSelector('text=Kiosco');
  await p.fill('#precomp', 'tele 600000 en 6 cuotas'); await p.press('#precomp', 'Enter');
  await p.waitForSelector('text=6 cuotas de'); assert.ok(/100\.000/.test(await hoja()), await hoja());
  await p.click('[data-act=compraia]'); await p.waitForSelector('text=Texto de prueba de Cuba'); await p.click('#sheet [data-act=close]');
  // regalos + recordatorio
  await p.click('[data-act=rgabrir]'); await p.fill('[data-in=rgq]', 'cumple de mamá'); await p.fill('[data-in=rgm]', '50000');
  await p.fill('[data-in=rgf]', '2030-05-20'); await p.click('[data-act=rgideas]'); await p.waitForSelector('text=Texto de prueba de Cuba');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act=rgics]')]);
  const ics = require('fs').readFileSync(await dl.path(), 'utf8');
  assert.ok(/BEGIN:VEVENT/.test(ics) && !/RRULE/.test(ics) && /DTSTART;VALUE=DATE:20300513/.test(ics), 'recordatorio único una semana antes\n' + ics);
  await p.click('#sheet [data-act=close]');

  // ---- 4. detective de suscripciones + ¿es caro? (con historia sembrada) ----
  {
    const SH = require('../src/sheets.js'), C = require('../src/core.js');
    const ids = sheet.grids.Personas.slice(1).map(r => r[0]);
    const hoy = new Date(); const m = k => { const d = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth() - k, 5)); return d.toISOString().slice(0, 10); };
    let n = 0; const mk = (d, desc, cents, cat) => ({ id: 'seed' + (n++), type: 'expense', desc, cents, cur: 'ARS', date: d, paidBy: ids[0], sp: C.splitEqual(cents, ids, 0), cat, note: '', by: ids[0], at: new Date().toISOString() });
    const es = [0, 1, 2, 3].map(k => mk(m(k), 'Spotify Duo', 650000, 'streaming')).concat([1, 2, 3, 4, 5].map(k => mk(m(k), 'Verduleria Lopez', 1000000 + k * 10000, 'super')));
    const plan = SH.planWrites(es, {}, () => 'x' + (n++), []);
    const r = JSON.parse(sheet.ctx.doPost({ postData: { contents: JSON.stringify({ token: 'TOK', action: 'addMovimientos', movimientos: plan.add }) } }).getContent());
    assert.ok(r.ok, JSON.stringify(r));
    await p.reload(); await p.waitForSelector('.nav');
  }
  await settle();
  await p.click('.nav button:has-text("Ajustes")');
  await p.click('[data-act=fold]:has-text("Recurrentes")');
  await p.waitForSelector('text=Cuba encontró pagos que se repiten');
  assert.ok(/Spotify/i.test(await txt()) && !/Verduler.*al año/i.test(await txt()), 'solo lo fijo');
  await p.click('[data-act=subadd][data-i="0"]'); await p.waitForSelector('[data-in=rdesc]');
  assert.ok(/Spotify/i.test(await p.inputValue('[data-in=rdesc]')) && (await p.inputValue('[data-in=ramount]')) === '6500,00', await p.inputValue('[data-in=ramount]'));
  await p.click('#sheet [data-act=close]');
  await nuevo(); await p.fill('#fdesc', 'Verduleria Lopez'); await p.fill('[data-in=amount]', '20000');
  await p.waitForSelector('text=que lo que sueles pagar'); assert.ok(/\+?\s?\d+ % más/.test(await txt('#preview')) || /más que/.test(await txt('#preview')));
  await p.click('[data-act=iacaro]'); await p.waitForSelector('text=Texto de prueba de Cuba'); await p.click('#sheet [data-act=close]');

  // ---- 5. carta y qué pasó ----
  await p.click('.nav button:has-text("Cierre")');
  await p.click('[data-act=iacarta]'); await p.waitForSelector('text=Texto de prueba de Cuba'); await p.click('#sheet [data-act=close]');
  await p.click('[data-act=iaexplica]'); await p.waitForSelector('text=Texto de prueba de Cuba'); await p.click('#sheet [data-act=close]');

  // ---- nada sensible salió a Gemini ----
  const todo = ia.join('\n');
  assert.ok(ia.length >= 7, 'llamadas a Gemini: ' + ia.length);
  assert.ok(!/Tomi|Pau\b|sueldo|salary/i.test(todo), 'ni nombres ni sueldos: ' + todo.match(/.{30}(Tomi|Pau\b|sueldo).{30}/i));

  // ---- Apps Script viejo: se avisa claro y no se rompe ----
  modo.viejo = true;
  await p.click('[data-act=iacarta]');
  await p.waitForFunction(() => /Code\.gs nuevo/.test(document.querySelector('#toast').textContent));
  assert.strictEqual(await p.locator('#sheet').innerText(), '', 'la hoja se cierra');

  await browser.close();
  const raras = errs.filter(e => !/Code\.gs nuevo/.test(e)); assert.deepStrictEqual(raras, [], raras.join('\n'));
  console.log('ok  ideas con Gemini: varios gastos, ticket, suscripciones, ¿es caro?, compra, regalos, carta y backend viejo');
})().catch(e => { console.error(e); process.exit(1); });
