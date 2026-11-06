// Acariciar a Cuba: al tocarlo alterna las poses «mimado», salen corazones y vuelve a su pose.
const { chromium } = require('playwright');
const assert = require('assert');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto(require('url').pathToFileURL(require('path').resolve(__dirname, '..', 'index.html')).href);
  await p.click('[data-act=ob][data-v="1"]'); await p.fill('[data-i="0"]', 'Tomi'); await p.fill('[data-i="1"]', 'Pau');
  await p.click('[data-act=ob][data-v="2"]'); await p.click('[data-act=obfinish][data-i="0"]');
  await p.waitForSelector('text=Todavía no hay gastos');
  const img = p.locator('.hero .cuba img');
  const before = await img.getAttribute('src');
  await p.click('.hero .cuba');
  assert.ok(await p.locator('.hero .cuba.petting').count() === 1, 'entra en modo mimo');
  const a = await img.getAttribute('src'); assert.notStrictEqual(a, before, 'cambia a la pose mimado');
  await p.waitForTimeout(450);
  const c = await img.getAttribute('src'); assert.notStrictEqual(c, a, 'alterna las dos poses');
  assert.ok(await p.locator('.hero .cuba .heart').count() >= 1, 'salen corazones');
  await p.waitForTimeout(2700);
  assert.strictEqual(await img.getAttribute('src'), before, 'vuelve a su pose');
  assert.strictEqual(await p.locator('.hero .cuba.petting').count(), 0);
  assert.strictEqual(await p.locator('.heart').count(), 0, 'no quedan corazones colgados');
  // la racha de 10 toques seguidos tiene premio escondido (ver docs/EASTER_EGGS.md)
  for (let i = 0; i < 10; i++) { await p.click('.hero .cuba'); await p.waitForTimeout(60); }
  assert.ok(await p.locator('.bone').count() >= 1, 'llueven huesos');
  assert.ok(/hueso/.test(await p.locator('#toast').innerText()));
  assert.deepStrictEqual(errs, []);
  await b.close();
  console.log('E2E CUBA OK (mimo, alternancia, corazones, vuelve a su pose)');
})().catch(e => { console.error('E2E CUBA FAIL:', e); process.exit(1); });
