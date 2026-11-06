const { chromium } = require('playwright');
const assert = require('assert');
const openAll = async p => { for (let i = 0; i < 12; i++) { const more = await p.evaluate(() => { const h = document.querySelector('.fold:not(.open)>h3'); if (h) h.click(); return !!h; }); if (!more) break; } };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_|net::/.test(m.text())) errs.push('console: ' + m.text()); });
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto(require('url').pathToFileURL(require('path').resolve(__dirname, '..', 'index.html')).href);
  const txt = async () => (await p.locator('#app').innerText());
  // onboarding
  await p.waitForSelector('text=Soy Cuba');
  await p.screenshot({ path: 'shots/01-welcome.png' });
  await p.click('[data-act=ob][data-v="1"]');
  await p.fill('[data-i="0"]', 'Tomi'); await p.fill('[data-i="1"]', 'Pau');
  await p.click('[data-act=ob][data-v="2"]');
  await p.click('[data-act=obfinish][data-i="0"]');
  await p.waitForSelector('text=Todavía no hay gastos');
  // gasto rápido
  await p.click('.fab');
  await p.fill('#quick', 'super 15.200');
  await p.click('[data-act=quick]');
  assert.strictEqual(await p.inputValue('[data-in=amount]'), '15200,00');
  assert.ok((await p.locator('#preview').innerText()).includes('$7.600,00'));
  await p.screenshot({ path: 'shots/02-form.png' });
  await p.click('[data-act=save]');
  await p.waitForSelector('text=Pau le debe', { timeout: 3000 }).catch(() => {});
  let t = await txt();
  assert.ok(/Pau\s+le debe\s+\$7\.600,00\s+a\s+Tomi/.test(t.replace(/\n/g, ' ')), 'inicio: ' + t.slice(0, 200));
  // gasto pagado por Pau con porcentaje 70/30 (Tomi 70%)
  await p.click('.fab');
  await p.fill('#fdesc', 'Cena');
  await p.fill('[data-in=amount]', '10000');
  await p.selectOption('[data-in=paidBy]', { label: 'Pau' });
  await p.click('[data-act=mode][data-v=percent]');
  await p.fill('[data-in=val][data-id]:nth-of-type(1)', '').catch(() => {});
  const vals = p.locator('input[data-in=val]');
  await vals.nth(0).fill('70'); await vals.nth(1).fill('30');
  assert.ok((await p.locator('#preview').innerText()).includes('$7.000,00'));
  await p.click('[data-act=save]');
  await p.waitForTimeout(300);
  // saldo: Tomi puso 15200 (le toca 7600) -> +7600 ; Pau puso 10000, le toca 3000 -> +7000 pero Tomi debe 7000: Tomi neto = 7600-7000 = 600
  t = (await txt()).replace(/\n/g, ' ');
  assert.ok(/Pau\s+le debe\s+\$600,00\s+a\s+Tomi/.test(t), 'saldo tras cena: ' + t.slice(0, 250));
  // porcentajes inválidos
  await p.click('.fab');
  await p.fill('[data-in=amount]', '100');
  await p.click('[data-act=mode][data-v=percent]');
  await p.locator('input[data-in=val]').nth(0).fill('60'); await p.locator('input[data-in=val]').nth(1).fill('30');
  assert.ok((await p.locator('#preview').innerText()).includes('suman 90%'));
  await p.click('[data-act=close]');
  // cierre: pagar
  await p.click('.nav [data-v=cierre]');
  await p.screenshot({ path: 'shots/03-cierre.png', fullPage: true });
  await p.click('[data-act=pay]');
  await p.waitForSelector('text=Están a mano', { timeout: 3000 }).catch(() => {});
  t = (await txt());
  assert.ok(/Nada para saldar/.test(t), 'cierre tras pagar: ' + t.slice(0, 300));
  // gastos lista
  await p.click('.nav [data-v=gastos]');
  t = await txt();
  assert.ok(t.includes('Cena') && t.includes('Super'));
  await p.fill('[data-in=search]', 'cen');
  assert.ok(!(await p.locator('#list').innerText()).includes('Super'));
  await p.fill('[data-in=search]', '');
  // editar + eliminar
  await p.locator('.item', { hasText: 'Cena' }).click();
  await p.click('[data-act=edit]');
  assert.strictEqual(await p.inputValue('#fdesc'), 'Cena');
  await p.fill('#fdesc', 'Cena en lo de Juan');
  await p.click('[data-act=save]'); await p.waitForTimeout(300);
  assert.ok((await txt()).includes('Cena en lo de Juan'));
  await p.locator('.item', { hasText: 'Cena en lo de Juan' }).click();
  await p.click('[data-act=askdel]'); await p.click('[data-act=del]'); await p.waitForTimeout(300);
  assert.ok(!(await txt()).includes('Cena en lo de Juan'));
  // importar splitwise
  await p.click('.nav [data-v=ajustes]'); await openAll(p);
  const csv = 'Date,Description,Category,Cost,Currency,Tomi,Pau\n2026-09-01,Alquiler,Rent,300000.00,ARS,150000.00,-150000.00\n2026-09-05,Payment,Payment,5000.00,ARS,5000.00,-5000.00\n\n2026-09-30,Total balance,,,ARS,155000.00,-155000.00\n';
  await p.fill('#paste', csv);
  await p.click('[data-act=impprev]');
  const prev = await p.locator('.preview').first().innerText();
  assert.ok(prev.includes('2 movimientos'), prev);
  await p.screenshot({ path: 'shots/04-import.png', fullPage: true });
  await p.click('[data-act=impgo]'); await p.waitForTimeout(300);
  await p.click('.nav [data-v=inicio]');
  t = (await txt()).replace(/\n/g, ' ');
  assert.ok(/Pau\s+le debe\s+\$162\.000,00\s+a\s+Tomi/.test(t), 'tras importar: ' + t.slice(0, 250));
  await p.screenshot({ path: 'shots/05-inicio.png', fullPage: true });
  // exportar
  await p.click('.nav [data-v=ajustes]'); await openAll(p); await p.click('[data-act=export]');
  const exp = await p.inputValue('#exp');
  assert.ok(exp.startsWith('Date,Description,Category,Cost,Currency,Tomi,Pau'));
  // persistencia local
  await p.reload(); await p.waitForSelector('.nav');
  assert.ok(/162\.000,00/.test(await txt()));
  assert.deepStrictEqual(errs, [], errs.join('\n'));
  console.log('E2E OK');
  await b.close();
})().catch(async e => { console.error('E2E FAIL:', e.message); process.exit(1); });
