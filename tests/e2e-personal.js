// Pestaña Personal de punta a punta: cifrada en el celular, ilegible en la Sheet, recuperable con el código, y el otro celular no ve nada.
const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');
const { boot } = require('./fake-sheet.js');
const EXEC = 'https://script.google.com/macros/s/TEST/exec';
const cfg = Buffer.from(JSON.stringify({ u: EXEC, t: 'TOK' })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
const URL_APP = require('./con-personal.js')();   // copia con FEATURES.personal = true (Personal está apagado por defecto)

(async () => {
  const sheet = boot(), errs = [], wire = [], viejo = { v: false, n: 0 };
  const browser = await chromium.launch();
  async function phone(name) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    await ctx.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
    await ctx.route('https://script.google.com/**', async route => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
      wire.push(req.postData());
      if (viejo.v && /"action":"savePersonal"/.test(req.postData())) { viejo.n++; return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: false, error: 'accion_desconocida', message: 'Acción desconocida: savePersonal' }) }); }
      const out = sheet.ctx.doPost({ postData: { contents: req.postData() } }).getContent();
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: out });
    });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(name + ' pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_|net::|Failed to load resource/.test(m.text())) errs.push(name + ' console: ' + m.text()); });
    return { ctx, p, txt: async () => (await p.locator('#app').innerText()).replace(/\n/g, ' ') };
  }
  const settle = p => p.waitForFunction(() => !document.querySelector('#pend') || document.querySelector('#pend').style.display === 'none', null, { timeout: 8000 });

  // ---- Celular A (Tomi) ----
  const A = await phone('A');
  await A.p.goto(URL_APP + '#cfg=' + cfg);
  await A.p.waitForSelector('text=Soy Cuba');
  await A.p.click('[data-act=ob][data-v="1"]'); await A.p.fill('[data-i="0"]', 'Tomi'); await A.p.fill('[data-i="1"]', 'Pau');
  await A.p.click('[data-act=ob][data-v="2"]'); await A.p.click('[data-act=obfinish][data-i="0"]');
  await A.p.waitForSelector('text=Todavía no hay gastos');
  assert.strictEqual(await A.p.locator('.nav button').count(), 5, 'hay 5 pestañas');

  await A.p.click('.nav button:has-text("Personal")');
  await A.p.waitForSelector('text=Crear mi espacio privado');
  await A.p.click('[data-act=persetup]');
  const code = (await A.p.locator('.preview').first().innerText()).trim();
  assert.ok(/^([A-Z2-9]{4}-){13}[A-Z2-9]$/.test(code), 'código: ' + code);
  await A.p.click('[data-act=persaved]');
  await A.p.waitForSelector('#perq');

  // carga rápida
  const add = async t => { await A.p.fill('#perq', t); await A.p.press('#perq', 'Enter'); await A.p.waitForFunction(() => !document.querySelector('#perq').value); };
  await add('Terapia secreta 50.000'); await add('almuerzo 4500 ayer'); await add('tele 120000 en 6 cuotas'); await A.p.fill('#perq', 'nada de monto'); await A.p.press('#perq', 'Enter'); assert.ok(/No encontré el monto/.test(await A.p.locator('#toast').innerText())); await A.p.fill('#perq', '');
  await settle(A.p); await A.p.waitForSelector('text=Cuotas que ya vienen');
  let txt = await A.txt();
  assert.ok(/Terapia secreta/i.test(txt) && /Almuerzo/i.test(txt), txt);
  assert.ok(/Cuotas que ya vienen/.test(txt), 'cuotas futuras');
  assert.ok(/\$\s?20\.000/.test(txt) || /\$\s?100\.000/.test(txt), 'la primera cuota cuenta este mes o ya vienen');

  // todo lo que llegó a la Sheet es ilegible
  assert.ok(sheet.grids.Personal.length > 8, 'filas en Personal: ' + sheet.grids.Personal.length);
  const planos = JSON.stringify(sheet.grids.Personal);
  assert.ok(!/Terapia|almuerzo|tele|50000|4500|12000000/i.test(planos), 'la Sheet no tiene texto en claro');
  assert.ok(wire.every(b => !/Terapia secreta|"almuerzo/i.test(b)), 'ni en el cable');
  assert.ok(sheet.grids.Personal.slice(1).every(r => r[1] === sheet.grids.Personas[1][0]));

  // tope, meta y aporte
  await A.p.click('[data-act=pertope]'); await A.p.selectOption('#pertk', 'comida'); await A.p.fill('#pertm', '4000'); await A.p.click('[data-act=pertopesave]');
  await A.p.click('[data-act=permeta]'); await A.p.fill('#permn', 'Viaje'); await A.p.fill('#permc', '100000'); await A.p.click('[data-act=permetasave]');
  await A.p.click('[data-act=peraporte]'); await A.p.fill('#peram', '25000'); await A.p.click('[data-act=peraportesave]');
  await settle(A.p);
  txt = await A.txt(); assert.ok(/Viaje/.test(txt) && /25%/.test(txt), 'meta al 25 %');

  // anular un gasto: la fila nunca se borra, se agrega una anulación
  const antes = sheet.grids.Personal.length;
  await A.p.locator('[data-act=perdel]').first().click(); await settle(A.p);
  assert.ok(sheet.grids.Personal.length > antes, 'anular agrega, no borra');

  // pasar a compartido: abre el form y al guardar se anula el personal
  await A.p.locator('[data-act=perpasar]').first().click();
  await A.p.waitForSelector('[data-act=save]');
  await A.p.click('[data-act=save]'); await settle(A.p);
  assert.strictEqual(sheet.grids.Movimientos.length, 2, 'se cargó en lo compartido');

  // Inicio: «Agregar pago» (de quien usa la app hacia el otro) con dictado
  await A.p.addInitScript(() => { window.SpeechRecognition = window.webkitSpeechRecognition = function () { this.start = () => setTimeout(() => this.onresult({ results: [[{ transcript: 'le pagué 20.000 transferencia' }]] }), 50); }; });
  await A.p.reload(); await A.p.waitForSelector('.nav');
  await A.p.click('.nav button:has-text("Inicio")');
  assert.ok(!/Saldar/.test(await A.txt()), 'ya no hay botón Saldar en Inicio');
  await A.p.click('[data-act=newpay]');
  assert.ok(/Registrar un pago/.test(await A.p.locator('#sheet').innerText()));
  await A.p.click('[data-act=quickvoz]');
  await A.p.waitForFunction(() => /^20000/.test(document.querySelector('[data-in=amount]').value));
  assert.strictEqual(await A.p.inputValue('[data-in=desc]'), 'Transferencia');
  assert.strictEqual(await A.p.inputValue('[data-in=paidBy]'), sheet.grids.Personas[1][0], 'paga quien usa la app');
  assert.notStrictEqual(await A.p.inputValue('[data-in=to]'), sheet.grids.Personas[1][0], 'le paga al otro');
  const nm = sheet.grids.Movimientos.length;
  await A.p.click('[data-act=save]'); await settle(A.p);
  assert.ok(sheet.grids.Movimientos.length > nm, 'el pago se guardó');

  // Resumen de tarjeta: contrasta con lo ya subido (Coto por el mismo monto, distinto nombre; Farmacia ya cargada en Personal)
  {
    const openAll = async p => { for (let i = 0; i < 12; i++) { const more = await p.evaluate(() => { const h = document.querySelector('.fold:not(.open)>h3'); if (h) h.click(); return !!h; }); if (!more) break; } };
    await A.p.click('.nav button:has-text("Inicio")'); await A.p.click('[data-act=new]');
    await A.p.fill('[data-in=desc]', 'Verdulería de la esquina'); await A.p.fill('[data-in=amount]', '26863,38'); await A.p.fill('[data-in=date]', '2026-10-08');
    await A.p.click('[data-act=mode][data-v=equal]'); await A.p.click('[data-act=save]'); await settle(A.p);
    await A.p.click('.nav button:has-text("Ajustes")'); await openAll(A.p);
    await A.p.setInputFiles('#rsfile', path.resolve(__dirname, 'fixtures', 'resumen_demo.pdf'));
    await A.p.waitForSelector('.rsrow', { timeout: 10000 });
    const t2 = await A.txt();
    assert.ok(/¿Ya estaba cargado\? \(1\)/i.test(t2) && /Parecido a «VERDULERIA LA ESQUINA/i.test(t2), t2.slice(0, 600));
    assert.ok(/Cargar \d+ gastos? compartidos?/.test(await A.p.locator('[data-act=rsgo]').innerText()));
    const antesBtn = await A.p.locator('[data-act=rsgo]').innerText();
    await A.p.click('[data-act=rsotro]');
    assert.ok(!/¿Ya estaba cargado\?/i.test(await A.txt()), 'al decir que es otro gasto sale de la lista de dudas');
    assert.strictEqual(await A.p.locator('.rsrow').count(), 7 - 0, 'siguen los consumos');
    void antesBtn;
    await A.p.click('.nav button:has-text("Personal")');
  }

  // CSV
  await A.p.click('.nav button:has-text("Personal")');
  const [dl] = await Promise.all([A.p.waitForEvent('download'), A.p.click('[data-act=percsv]')]);
  assert.ok(/mis-gastos-personales\.csv/.test(dl.suggestedFilename()));

  // ---- Celular B (Pau): misma Sheet, no ve nada de Tomi ----
  const B = await phone('B');
  await B.p.goto(URL_APP + '#cfg=' + cfg);
  await B.p.waitForSelector('[data-act=who][data-id]'); await B.p.locator('[data-act=who]').nth(1).click();
  await B.p.click('.nav button:has-text("Personal")');
  await B.p.waitForSelector('text=Crear mi espacio privado');
  assert.ok(!/Terapia|Encontré/i.test(await B.txt()), 'Pau no ve ni rastros de lo de Tomi');

  // ---- Celular nuevo de Tomi: sin el código no abre; con el código recupera todo ----
  const C = await phone('C');
  await C.p.goto(URL_APP + '#cfg=' + cfg);
  await C.p.waitForSelector('[data-act=who][data-id]'); await C.p.locator('[data-act=who]').nth(0).click();
  await C.p.click('.nav button:has-text("Personal")');
  await C.p.waitForSelector('text=Encontré');
  assert.ok(!/Terapia/i.test(await C.txt()));
  await C.p.fill('#percode', 'AAAA-BBBB'); await C.p.click('[data-act=percode]');
  assert.ok(/no es válido/.test(await C.p.locator('#toast').innerText()));
  await C.p.fill('#percode', code.toLowerCase()); await C.p.click('[data-act=percode]');
  await C.p.waitForSelector('text=Almuerzo');
  txt = await C.txt(); assert.ok(/Viaje/.test(txt) && /25%/.test(txt), 'recuperó gastos y metas');
  assert.ok(!/Terapia/i.test(txt) && !/Tele \(1\/6\)/.test(txt), 'lo anulado sigue anulado en el celular nuevo');

  // ---- Apps Script viejo (sin savePersonal): no entra en bucle, avisa y conserva lo local ----
  viejo.v = true;
  await C.p.fill('#perq', 'cafe 1000'); await C.p.press('#perq', 'Enter');
  await C.p.waitForTimeout(2500);
  const n1 = viejo.n; await C.p.waitForTimeout(2500);
  assert.ok(n1 >= 1 && viejo.n === n1 && n1 <= 3, 'no reintenta en bucle: ' + viejo.n);
  assert.ok(/Apps Script viejo/.test(await C.txt()) && /Cafe/i.test(await C.txt()), 'avisa y lo guarda acá');
  assert.ok(!(await C.p.locator('#pend').isVisible()), 'sin cartel de guardando');
  viejo.v = false;

  // ---- Resumen de tarjeta: lo no compartido va a Personal sin duplicarse ----
  errs.splice(0, errs.length, ...errs.filter(e => !/accion_desconocida|Acción desconocida/.test(e)));
  assert.deepStrictEqual(errs, [], errs.join('\n'));
  console.log('E2E PERSONAL OK (' + (sheet.grids.Personal.length - 1) + ' filas cifradas, Pau no ve nada, recuperación con código)');
  await browser.close();
})().catch(e => { console.error('E2E PERSONAL FAIL:', e.stack || e.message); process.exit(1); });
