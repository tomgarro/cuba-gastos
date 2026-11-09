// Calculadora en su pestaña y pagos que saldan gastos (concepto, vínculo, «Saldar este gasto»), de punta a punta con Code.gs real.
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

  const cargar = async (P, monto) => {
    await P.p.click('.nav [data-v=ajustes]'); await openAll(P.p);
    await P.p.fill('[data-in=sueldoamt]', monto); await P.p.click('[data-act=salsave]');
    assert.ok(/Sueldo guardado/.test(await toastText(P.p)));
  };
  await cargar(A, '2.000.000'); await A.p.waitForTimeout(2800);
  await B.p.reload(); await B.p.waitForSelector('.nav'); await cargar(B, '1.000.000'); await sinPend(B.p);
  await A.p.reload(); await A.p.waitForSelector('.nav');

  const hoy = new Date(); const iso = d => d.toISOString().slice(0, 10);
  const mesAnt = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 5));
  const gasto = async (desc, monto, fecha) => {
    await A.p.click('.nav [data-v=inicio]'); await A.p.click('.fab'); await A.p.fill('#fdesc', desc); await A.p.fill('[data-in=amount]', monto);
    await A.p.fill('[data-in=date]', fecha); await A.p.dispatchEvent('[data-in=date]', 'change'); await A.p.click('[data-act=save]'); await sinPend(A.p);
  };

  // --- Calculadora: pestaña propia, usa el último sueldo cargado de cada uno (2.000.000 y 1.000.000 → 2/3 y 1/3) ---
  await A.p.click('.nav [data-v=calculadora]');
  assert.strictEqual(await A.p.evaluate(() => document.activeElement && document.activeElement.id), 'calcin', 'el cursor queda en el monto');
  await A.p.fill('[data-in=calcamt]', '300.000');
  const calc = await A.p.locator('#calcout').innerText();
  assert.ok(/Tomi[\s\S]*67 %[\s\S]*\$200\.000,00/.test(calc) && /Pau[\s\S]*33 %[\s\S]*\$100\.000,00/.test(calc), calc);
  await A.p.click('.nav [data-v=ajustes]'); await openAll(A.p);
  assert.ok(!(await A.txt()).includes('Calculadora de reparto'), 'ya no está repetida en Ajustes');

  // --- Tomi paga una cena de 90.000: a Pau le toca 30.000 (1/3) ---
  await A.p.click('.nav [data-v=inicio]'); await A.p.click('.fab'); await A.p.fill('#fdesc', 'Cena'); await A.p.fill('[data-in=amount]', '90.000');
  await A.p.click('[data-act=save]'); await sinPend(A.p);
  await A.p.click('.nav [data-v=gastos]');
  assert.ok(!/saldado|falta/.test(await A.p.locator('#list').innerText()), 'sin pagos vinculados no hay chip');
  await A.p.locator('.item:not(.pay)', { hasText: 'Cena' }).click();
  assert.ok(/Pau le debe a Tomi\s+\$30\.000,00/.test(await A.p.locator('#sheet').innerText()), await A.p.locator('#sheet').innerText());

  // --- «Saldar este gasto»: abre el pago con todo cargado; Pau paga la mitad con un concepto ---
  await A.p.click('[data-act=saldar]');
  assert.strictEqual(await A.p.inputValue('[data-in=amount]'), '30000,00');
  assert.strictEqual(await A.p.inputValue('[data-in=paidBy]') === idPau, true); assert.strictEqual(await A.p.inputValue('[data-in=to]') === idTomi, true);
  assert.ok(/Cena/.test(await A.p.locator('[data-in=salda] option:checked').innerText()));
  await A.p.fill('[data-in=amount]', '10.000'); await A.p.fill('#fdesc', 'Transferencia, primera parte');
  await A.p.click('[data-act=save]'); await sinPend(A.p);
  let mov = sheet.grids.Movimientos.slice(1).filter(r => r[col('tipo')] === 'pago');
  assert.strictEqual(mov.length, 1); assert.strictEqual(mov[0][col('salda_id')], sheet.grids.Movimientos.slice(1).filter(r => r[col('descripcion')] === 'CENA' || r[col('descripcion')] === 'Cena')[0][col('id')]);
  assert.strictEqual(mov[0][col('nota')], 'Transferencia, primera parte');
  await A.p.click('.nav [data-v=gastos]');
  const lista = await A.p.locator('#list').innerText();
  assert.ok(/falta \$20\.000/.test(lista), lista); assert.ok(/por Cena/.test(lista) && /Transferencia, primera parte/.test(lista), lista);

  // --- Pago nuevo desde «Pago entre nosotros»: ofrece la cena con lo que falta y deja saldado ---
  await A.p.click('.nav [data-v=inicio]'); await A.p.click('.fab'); await A.p.click('[data-act=kind][data-v=payment]');
  await A.p.selectOption('[data-in=paidBy]', idPau); await A.p.selectOption('[data-in=to]', idTomi);
  assert.ok(/falta \$20\.000/.test(await A.p.locator('[data-in=salda]').innerText()));
  await A.p.selectOption('[data-in=salda]', { index: 1 });
  assert.strictEqual(await A.p.inputValue('[data-in=amount]'), '20000,00', 'el monto se completa con lo que falta');
  await A.p.click('[data-act=save]');
  assert.ok(/gasto saldado/.test(await toastText(A.p)));
  await sinPend(A.p);
  await A.p.click('.nav [data-v=gastos]');
  assert.ok(/✓ saldado/.test(await A.p.locator('#list').innerText()));
  await A.p.locator('.item:not(.pay)', { hasText: 'Cena' }).click();
  const det = await A.p.locator('#sheet').innerText();
  assert.ok(/saldado entre ustedes/i.test(det) && /ya pagó\s+\$30\.000,00/.test(det) && !/Saldar este gasto/.test(det), det);
  await A.p.click('#sheet .chip >> nth=0');   // el pago: muestra a qué gasto corresponde
  assert.ok(/Pago por: Cena/.test(await A.p.locator('#sheet').innerText()));

  // --- Las cuentas no cambian por el vínculo: Pau ya no debe nada ---
  await A.p.keyboard.press('Escape'); await A.p.click('[data-act=close]').catch(() => {});
  await A.p.click('.nav [data-v=cierre]');
  assert.ok(!/le debe/.test(await A.txt()) || /Todo en orden|al día/i.test(await A.txt()), await A.txt());

  // --- Si el gasto se edita, el vínculo lo sigue (queda saldado) ---
  await A.p.click('.nav [data-v=gastos]'); await A.p.locator('.item:not(.pay)', { hasText: 'Cena' }).click(); await A.p.click('[data-act=edit]');
  await A.p.fill('#fdesc', 'Cena con postre'); await A.p.click('[data-act=save]'); await sinPend(A.p);
  await A.p.click('.nav [data-v=gastos]');
  assert.ok(/Cena con Postre[\s\S]*✓ saldado/.test(await A.p.locator('#list').innerText()), await A.p.locator('#list').innerText());

  // --- Pau ve lo mismo desde su celular ---
  await B.p.reload(); await B.p.waitForSelector('.nav'); await B.p.click('.nav [data-v=gastos]');
  assert.ok(/✓ saldado/.test(await B.p.locator('#list').innerText()));

  assert.deepStrictEqual(errs, [], errs.join('\n'));
  await browser.close();
  console.log('E2E SALDAR OK (calculadora en su pestaña, pagos con concepto, saldar este gasto, vínculo que sobrevive a la edición)');
})().catch(e => { console.error('E2E SALDAR FAIL:', e); process.exit(1); });
