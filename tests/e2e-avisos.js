// Avisos (aumentos), suscripciones, ¿me alcanza?, ajuste del alquiler y calculadora, de punta a punta con Code.gs real.
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

  // --- Aumentos: la luz subió 23 % y se descarta con ✓ ---
  await gasto('Luz', '10.000', iso(mesAnt)); await gasto('Luz', '12.300', iso(hoy));
  await A.p.click('.nav [data-v=inicio]'); await A.p.waitForSelector('text=Para revisar');
  assert.ok(/subió 23 %/.test(await A.txt()), await A.txt());
  await A.p.click('[data-act=avok]'); await A.p.waitForFunction(() => !/Para revisar/.test(document.querySelector('#app').innerText));

  // --- Suscripciones ---
  await gasto('Netflix', '8.600', iso(hoy));
  await A.p.click('.nav [data-v=ajustes]'); await openAll(A.p);
  const aj = await A.txt(); assert.ok(/suscripciones/i.test(aj) && /Netflix/i.test(aj) && /103\.200 al año/.test(aj), aj.slice(aj.indexOf('SUSCRIP') - 20, aj.indexOf('SUSCRIP') + 500));

  // --- Calculadora de reparto (2.000.000 y 1.000.000 → 2/3 y 1/3) ---
  await A.p.click('.nav [data-v=calculadora]');
  await A.p.fill('[data-in=calcamt]', '300.000');
  const calc = await A.p.locator('#calcout').innerText();
  assert.ok(/Tomi[\s\S]*67 %[\s\S]*\$200\.000,00/.test(calc) && /Pau[\s\S]*33 %[\s\S]*\$100\.000,00/.test(calc), calc);
  await A.p.fill('[data-in=calcamt]', '');
  assert.ok(/Poné un monto/.test(await A.p.locator('#calcout').innerText()));
  await A.p.click('.nav [data-v=ajustes]'); await openAll(A.p);

  // --- Alquiler con ajuste por índice: hoy toca; 10 % → 847.000; el próximo ajuste corre 3 meses ---
  await A.p.click('[data-act=recnew]');
  await A.p.fill('[data-in=rdesc]', 'Alquiler'); await A.p.fill('[data-in=ramount]', '770.000'); await A.p.fill('[data-in=rday]', '5');
  await A.p.fill('[data-in=radj]', '3'); await A.p.fill('[data-in=radjn]', iso(hoy)); await A.p.click('[data-act=recsave]'); await A.p.waitForSelector('text=ajusta cada 3 meses'); await sinPend(A.p);
  assert.deepStrictEqual([sheet.grids.Recurrentes[1][9], sheet.grids.Recurrentes[1][10]], [3, iso(hoy)]);
  await A.p.click('.nav [data-v=inicio]'); await A.p.waitForSelector('text=Toca ajustar: Alquiler');
  await A.p.click('[data-act=ajaplicar]'); assert.ok(/Poné el porcentaje/.test(await toastText(A.p)), 'sin porcentaje no aplica');
  await A.p.fill('[data-in=ajpct]', '10,5'); await A.p.waitForFunction(() => /847\.000|850\.850/.test(document.querySelector('#ajprev').innerText));
  assert.ok(/850\.850/.test(await A.p.locator('#ajprev').innerText()), '770.000 + 10,5 % = 850.850');
  await A.p.fill('[data-in=ajpct]', '10'); await A.p.waitForFunction(() => /847\.000/.test(document.querySelector('#ajprev').innerText));
  await A.p.click('[data-act=ajaplicar]'); await A.p.waitForFunction(() => !/Toca ajustar/.test(document.querySelector('#app').innerText)); await sinPend(A.p);
  const r = sheet.grids.Recurrentes[1]; const prox = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 3, 1));
  assert.strictEqual(r[2], 84700000);
  assert.strictEqual(r[10].slice(0, 7), iso(prox).slice(0, 7), 'el próximo ajuste cae 3 meses después');

  // --- ¿Me alcanza? ---
  await A.p.click('.nav [data-v=cierre]'); await A.p.waitForSelector('text=¿Me alcanza este mes?');
  const mi = await A.txt(); assert.ok(/Tu sueldo[\s\S]*\$2\.000\.000/.test(mi) && /Te queda para lo tuyo/.test(mi), mi.slice(0, 500));
  // B no ve el sueldo de A: ve el suyo
  await B.p.reload(); await B.p.waitForSelector('.nav'); await B.p.click('.nav [data-v=cierre]'); await B.p.waitForSelector('text=¿Me alcanza este mes?');
  const mb = await B.txt(); assert.ok(/Tu sueldo[\s\S]*\$1\.000\.000/.test(mb) && !/\$2\.000\.000/.test(mb), 'cada uno ve solo su sueldo');

  sheet.grids.Movimientos.slice(1).forEach(row => assert.strictEqual(JSON.parse(row[col('reparto_json')]).reduce((s, x) => s + x[1], 0), row[col('monto_centavos')]));
  const bad = errs.filter(Boolean); assert.deepStrictEqual(bad, [], bad.join('\n'));
  console.log('E2E AVISOS OK');
  await browser.close();
})().catch(e => { console.error('E2E AVISOS FAIL: ' + (e.stack || e)); process.exit(1); });
