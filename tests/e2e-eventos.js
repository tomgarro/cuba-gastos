// Viajes y eventos: cuentas propias, fuera del mes y de los saldos generales, de punta a punta con Code.gs real.
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

  // --- Crear el evento ---
  assert.ok(!(await A.txt()).includes('Quién le debe a quién'));
  await A.p.waitForSelector('[data-act=evnew]'); await A.p.click('[data-act=evnew]');
  await A.p.fill('[data-in=evname]', 'Bariloche'); await A.p.click('[data-act=evsave]');
  await A.p.waitForSelector('text=no entra en el resumen del mes'); await sinPend(A.p);
  assert.strictEqual(sheet.grids.Eventos.length, 2);
  assert.deepStrictEqual(J(sheet.grids.Eventos[1]).slice(1, 3).concat(J(sheet.grids.Eventos[1])[5]), ['Bariloche', 'ARS', 'abierto']);
  const evId = sheet.grids.Eventos[1][0];

  // --- Gasto del evento: moneda fija, reparto por partes iguales, no entra en el mes ---
  await A.p.click('[data-act=evadd]'); await A.p.waitForSelector('#fdesc');
  assert.ok((await A.p.locator('#sheet').innerText()).includes('Bariloche'));
  assert.strictEqual(await A.p.locator('[data-in=cur]').isDisabled(), true, 'la moneda la define el evento');
  assert.strictEqual(await A.p.locator('.seg button.on[data-act=mode]').getAttribute('data-v'), 'equal');
  await A.p.fill('#fdesc', 'Cabaña'); await A.p.fill('[data-in=amount]', '100.000'); await A.p.click('[data-act=save]');
  await A.p.waitForSelector('text=Pau le paga a'); await sinPend(A.p);
  const ult = () => sheet.grids.Movimientos[sheet.grids.Movimientos.length - 1];
  assert.strictEqual(ult()[col('evento_id')], evId);
  assert.deepStrictEqual([ult()[col('monto_centavos')], ult()[col('moneda')]], [10000000, 'ARS']);
  const t1 = await A.txt(); assert.ok(/puso \$100\.000/.test(t1) && /Pau le paga a Tomi/.test(t1) && /\$50\.000,00/.test(t1), t1);
  // un gasto común del mes, para comprobar que no se mezclan
  await A.p.click('.nav [data-v=inicio]'); await A.p.click('.fab'); await A.p.fill('#fdesc', 'Super'); await A.p.fill('[data-in=amount]', '20.000'); await A.p.click('[data-act=save]');
  await A.p.waitForSelector('text=Este mes'); await sinPend(A.p);
  const ini = await A.txt();
  assert.ok(/este mes[^$]*\$20\.000/i.test(ini), 'el mes solo tiene el súper: ' + ini);
  assert.ok(!/Cabaña/.test(ini), 'el gasto del viaje no aparece en los movimientos del mes');
  assert.ok(/Pau le debe \$10\.000/.test(ini) || /le debe \$10\.000/.test(ini), 'los saldos generales no incluyen el viaje: ' + ini);
  await A.p.click('.nav [data-v=gastos]'); assert.ok(!(await A.txt()).includes('Cabaña'), 'Gastos no lista el viaje');
  await A.p.click('.nav [data-v=cierre]'); assert.ok(!/Cabaña|100\.000/.test(await A.txt()), 'Cierre no incluye el viaje');

  // --- B lo ve y salda dentro del evento ---
  await B.p.reload(); await B.p.waitForSelector('text=Viajes y eventos');
  await B.p.click('[data-act=evopen]'); await B.p.waitForSelector('text=Pau le paga a');
  await B.p.click('[data-act=evpay]'); await B.p.waitForSelector('text=Están a mano en este evento'); await sinPend(B.p);
  const pay = ult();
  assert.deepStrictEqual([pay[col('tipo')], pay[col('evento_id')], pay[col('monto_centavos')]], ['pago', evId, 5000000]);
  await A.p.click('.nav [data-v=inicio]'); await A.p.waitForTimeout(100);

  // --- Editar un gasto del evento conserva el evento; cerrar y reabrir ---
  await A.p.reload(); await A.p.waitForSelector('[data-act=evopen]'); await A.p.click('[data-act=evopen]');
  await A.p.locator('.item', { hasText: 'Cabaña' }).first().click(); await A.p.click('[data-act=edit]'); await A.p.waitForSelector('#fdesc');
  await A.p.fill('[data-in=amount]', '120.000'); await A.p.click('[data-act=save]'); await sinPend(A.p);
  const nuevo = sheet.grids.Movimientos.filter(r => r[col('reemplaza_id')] !== '' && r[col('descripcion')].toUpperCase().includes('CABA'))[0];
  assert.strictEqual(nuevo[col('evento_id')], evId, 'la edición queda en el mismo evento');
  await A.p.click('[data-act=evtoggle]'); await A.p.waitForFunction(() => /Reabrir el evento/.test(document.querySelector('#app').innerText)); await sinPend(A.p);
  assert.strictEqual(sheet.grids.Eventos[1][5], 'cerrado');
  assert.ok(!(await A.p.locator('[data-act=evadd]').count()), 'cerrado: no se anotan más gastos');
  await A.p.click('[data-act=evtoggle]'); await A.p.waitForSelector('[data-act=evadd]'); await sinPend(A.p);
  assert.strictEqual(sheet.grids.Eventos[1][5], 'abierto');

  // --- Invariantes ---
  sheet.grids.Movimientos.slice(1).forEach(row => assert.strictEqual(JSON.parse(row[col('reparto_json')]).reduce((s, x) => s + x[1], 0), row[col('monto_centavos')]));
  const bad = errs.filter(Boolean); assert.deepStrictEqual(bad, [], bad.join('\n'));
  console.log('E2E EVENTOS OK');
  await browser.close();
})().catch(e => { console.error('E2E EVENTOS FAIL: ' + (e.stack || e)); process.exit(1); });
