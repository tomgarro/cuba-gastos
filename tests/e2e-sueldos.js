// Sueldos (reparto por defecto proporcional, excepciones marcadas) y recurrentes, de punta a punta con Code.gs real.
const { chromium } = require('playwright');
const assert = require('assert');
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
  const errs = [];
  const browser = await chromium.launch();
  async function phone(name) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
    await ctx.route('https://script.google.com/**', async route => {
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

  // --- Sin sueldos: se divide a mitades y el formulario avisa dónde cargarlos ---
  await A.p.click('.fab'); await A.p.waitForSelector('#fdesc');
  assert.ok((await A.p.locator('.sheet, #sheet').first().innerText()).includes('Mi sueldo'), 'avisa dónde cargar el sueldo');
  assert.strictEqual(await A.p.locator('.seg button.on[data-act=mode]').getAttribute('data-v'), 'equal');
  await A.p.click('[data-act=close]');

  // --- Cada uno carga el suyo (A: 2.000.000, B: 1.000.000) ---
  const cargar = async (P, monto) => {
    await P.p.click('.nav [data-v=ajustes]'); await openAll(P.p);
    await P.p.fill('[data-in=sueldoamt]', monto); await P.p.click('[data-act=salsave]');
    assert.ok(/Sueldo guardado/.test(await toastText(P.p)));
  };
  await cargar(A, '2.000.000');
  await A.p.waitForFunction(() => /Falta que Pau cargue su sueldo/.test(document.querySelector('#app').innerText));
  await cargar(B, '1.000.000');
  await B.p.waitForFunction(() => /Tomi\s+66,7 %\s*·\s*Pau\s+33,3 %/.test(document.querySelector('#app').innerText), null, { timeout: 5000 });
  assert.strictEqual(sheet.grids.Sueldos.length, 3);
  assert.deepStrictEqual(J(sheet.grids.Sueldos.slice(1).map(r => [r[1], r[3], r[4]])), [[idTomi, 200000000, 'ARS'], [idPau, 100000000, 'ARS']]);
  // el sueldo del otro no se muestra como monto en mi pantalla
  assert.ok(!/2\.000\.000/.test(await B.txt()), 'B no ve el monto del sueldo de A');

  // --- A anota un gasto: por defecto proporcional al sueldo (30.000 → 20.000 / 10.000) ---
  await A.p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // A se entera del sueldo de B
  await A.p.click('.nav [data-v=inicio]');
  await A.p.click('.fab'); await A.p.fill('#fdesc', 'Edenor'); await A.p.fill('[data-in=amount]', '30000');
  assert.strictEqual(await A.p.locator('.seg button.on[data-act=mode]').getAttribute('data-v'), 'salary');
  await A.p.waitForFunction(() => /Tomi: \$20\.000,00 \(67 %\)/.test(document.querySelector('#preview').innerText));
  assert.strictEqual(await A.p.locator('[data-in=catf], .cats button.on').first().innerText().catch(() => ''), await A.p.locator('.cats button.on').innerText(), 'hay una categoría marcada');
  assert.ok((await A.p.locator('.cats button.on').innerText()).includes('Luz'), 'Edenor → Luz');
  await A.p.click('[data-act=save]'); await A.p.waitForSelector('text=Pau le debe');
  let g = sheet.grids.Movimientos, r1 = g[1];
  assert.deepStrictEqual([r1[col('reparto_modo')], r1[col('excepcion')], r1[col('categoria')]], ['sueldo', 'FALSE', 'luz']);
  assert.deepStrictEqual(J(JSON.parse(r1[col('reparto_json')])), [[idTomi, 2000000], [idPau, 1000000]]);

  // --- Excepción explícita: a mitades, con motivo ---
  await A.p.click('.fab'); await A.p.fill('#fdesc', 'Regalo para la suegra'); await A.p.fill('[data-in=amount]', '10000');
  await A.p.click('[data-act=mode][data-v=equal]'); await A.p.fill('[data-in=why]', 'lo pagamos a medias');
  await A.p.click('[data-act=save]'); await A.p.waitForFunction(() => /suegra/i.test(document.querySelector('#app').innerText));
  g = sheet.grids.Movimientos; const r2 = g[2];
  assert.deepStrictEqual([r2[col('reparto_modo')], r2[col('excepcion')], r2[col('motivo_excepcion')]], ['igual', 'TRUE', 'lo pagamos a medias']);

  // --- B edita ese gasto: se reabre en la forma en que se guardó y la excepción sigue marcada ---
  await B.p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await B.p.click('.nav [data-v=gastos]'); await B.p.click('.item >> text=suegra');
  await B.p.waitForSelector('text=Excepción: no se repartió por sueldo');
  assert.ok((await B.p.locator('#sheet').innerText()).includes('lo pagamos a medias'));
  await B.p.click('[data-act=close]');

  // --- Aumento: el sueldo de A sube desde el 1/1/2027; el gasto de 2026 no cambia, uno de 2027 sí ---
  await A.p.click('.nav [data-v=ajustes]'); await openAll(A.p);
  await A.p.fill('[data-in=sueldoamt]', '4.000.000'); await A.p.fill('[data-in=sueldodesde]', '2027-01-01'); await A.p.click('[data-act=salsave]');
  await A.p.waitForFunction(() => /Sueldo guardado/.test((document.querySelector('#toast') || {}).innerText || ''));
  await A.p.waitForTimeout(2800);
  await A.p.click('.nav [data-v=inicio]'); await A.p.click('.fab'); await A.p.fill('#fdesc', 'Enero'); await A.p.fill('[data-in=amount]', '50000');
  await A.p.fill('[data-in=date]', '2027-01-15'); await A.p.dispatchEvent('[data-in=date]', 'change');
  await A.p.waitForFunction(() => /Tomi: \$40\.000,00 \(80 %\)/.test(document.querySelector('#preview').innerText));
  await A.p.fill('[data-in=date]', '2026-12-31'); await A.p.dispatchEvent('[data-in=date]', 'change');
  await A.p.waitForFunction(() => /Tomi: \$33\.333,33 \(67 %\)/.test(document.querySelector('#preview').innerText));
  await A.p.click('[data-act=close]');

  // --- Recurrentes: alta, aparece en «Por pagar», se anota con monto real y avisa la suba ---
  const hoy = new Date(); const dia = hoy.getDate();
  await A.p.click('.nav [data-v=ajustes]'); await openAll(A.p); await A.p.click('[data-act=recnew]');
  await A.p.fill('[data-in=rdesc]', 'Aysa'); await A.p.fill('[data-in=ramount]', '4.500'); await A.p.fill('[data-in=rday]', String(dia));
  assert.strictEqual(await A.p.locator('[data-in=rcat]').inputValue(), 'agua', 'Aysa → Agua');
  await A.p.click('[data-act=recsave]'); await A.p.waitForSelector('text=día ' + dia);
  assert.strictEqual(sheet.grids.Recurrentes.length, 2);
  await A.p.click('.nav [data-v=inicio]'); await A.p.waitForSelector('text=Por pagar'); await A.p.waitForSelector('text=vence hoy');
  await A.p.click('[data-act=recpay]');
  assert.strictEqual(await A.p.locator('#fdesc').inputValue(), 'Aysa');
  await A.p.fill('[data-in=amount]', '4.860'); await A.p.click('[data-act=save]');
  await A.p.waitForFunction(() => /Subió 8 %/.test((document.querySelector('#toast') || {}).innerText || ''), null, { timeout: 5000 });
  await A.p.waitForFunction(() => !/vence hoy/.test(document.querySelector('#app').innerText));
  assert.ok(await A.p.evaluate(() => document.querySelector('#app').classList.contains('perk')), 'al saldar lo último que vencía, Cuba festeja');
  const rec = sheet.grids.Recurrentes[1];
  assert.strictEqual(rec[2], 486000, 'el monto del mes pasa a ser la referencia');
  assert.ok(rec[7] > hoy.toISOString().slice(0, 10), 'próximo vencimiento: el mes que viene');
  const aysa = sheet.grids.Movimientos[sheet.grids.Movimientos.length - 1];
  assert.deepStrictEqual([aysa[col('descripcion')], aysa[col('monto_centavos')], aysa[col('categoria')], aysa[col('origen')], aysa[col('reparto_modo')]], ['Aysa', 486000, 'agua', 'recurrente', 'sueldo']);
  // pausar
  await A.p.click('.nav [data-v=ajustes]'); await openAll(A.p); await A.p.click('[data-act=recedit]'); await A.p.click('[data-act=rectoggle]'); await A.p.waitForFunction(() => /En pausa/.test((document.querySelector('#toast') || {}).innerText || ''));
  assert.strictEqual(sheet.grids.Recurrentes[1][8], 'FALSE');

  // --- Invariantes: todo reparto suma exacto y los gastos anteriores no se tocaron ---
  sheet.grids.Movimientos.slice(1).forEach(row => assert.strictEqual(JSON.parse(row[col('reparto_json')]).reduce((s, x) => s + x[1], 0), row[col('monto_centavos')]));
  assert.deepStrictEqual(J(sheet.grids.Movimientos[1]), J(r1), 'el primer gasto sigue igual');

  const bad = errs.filter(Boolean); assert.deepStrictEqual(bad, [], bad.join('\n'));
  console.log('E2E SUELDOS OK (' + (sheet.grids.Movimientos.length - 1) + ' movimientos, ' + (sheet.grids.Sueldos.length - 1) + ' sueldos, recurrente anotado y pausado)');
  await browser.close();
})().catch(e => { console.error('E2E SUELDOS FAIL: ' + (e.stack || e)); process.exit(1); });
