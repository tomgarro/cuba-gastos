// Aventuras de Cuba: en Inicio sale de aventura (pose + globo), vuelve sola, y tocar el globo la manda a otra. Pregunta con huevo escondido.
const { chromium } = require('playwright');
const assert = require('assert');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto(require('url').pathToFileURL(require('path').resolve(__dirname, '..', 'index.html')).href);
  await p.click('[data-act=ob][data-v="1"]'); await p.fill('[data-i="0"]', 'Tomi'); await p.fill('[data-i="1"]', 'Pau');
  await p.click('[data-act=ob][data-v="2"]'); await p.click('[data-act=obfinish][data-i="0"]');
  await p.waitForSelector('text=Todavía no hay gastos');
  const img = p.locator('.hero .cuba img'), bub = p.locator('.hero .bubble');
  const src0 = await img.getAttribute('src'), txt0 = await bub.innerHTML();
  assert.ok(!(await p.locator('.hero.adv').count()), 'al abrir no está de aventura');

  await p.waitForTimeout(1300); assert.ok(!(await p.locator('.hero.adv').count()), 'en un navegador automatizado no sale sola');
  await p.evaluate(() => { Aventura.auto = true; Aventura.next = 0; });
  await p.waitForSelector('.hero.adv', { timeout: 3000 });
  const AV = await p.evaluate(() => CubaArt.aventuras.map(a => a.texto));
  const txt1 = await bub.innerText(), src1 = await img.getAttribute('src');
  assert.ok(AV.includes(txt1), 'el globo cuenta la aventura: ' + txt1);
  assert.notStrictEqual(src1, src0, 'cambia de pose');
  assert.ok(/pose-(trip|bbq|detective|piggy|phone|gift|receipt|mail|calc|surprised)/.test(await p.locator('.hero .cuba').getAttribute('class')), 'la pose se anima con su clase');
  assert.ok(await p.locator('.hero .cuba .heart').count() === 0);

  // tocar el globo → otra aventura distinta
  await p.click('.hero .bubble');
  const txt2 = await bub.innerText(); assert.ok(AV.includes(txt2) && txt2 !== txt1, 'otra aventura: ' + txt2);

  // vuelve sola, con su pose y su mensaje de antes
  await p.evaluate(() => { document.querySelector('.hero')._av.fin = 0; });
  await p.waitForFunction(() => !document.querySelector('.hero.adv'), null, { timeout: 3000 });
  assert.strictEqual(await img.getAttribute('src'), src0, 'vuelve a su pose');
  assert.strictEqual(await bub.innerHTML(), txt0, 'vuelve su mensaje');

  // no sale de aventura con una hoja abierta
  await p.evaluate(() => { Aventura.next = 0; }); await p.click('[data-act=new]'); await p.waitForTimeout(1300);
  assert.strictEqual(await p.locator('.hero.adv').count(), 0, 'con la hoja abierta se queda quieta');
  await p.click('[data-act=close]');

  // «reducir movimiento»: nunca sale de aventura
  const q = await (await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })).newPage();
  await q.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await q.goto(require('url').pathToFileURL(require('path').resolve(__dirname, '..', 'index.html')).href);
  await q.click('[data-act=ob][data-v="1"]'); await q.fill('[data-i="0"]', 'Tomi'); await q.fill('[data-i="1"]', 'Pau');
  await q.click('[data-act=ob][data-v="2"]'); await q.click('[data-act=obfinish][data-i="0"]'); await q.waitForSelector('text=Todavía no hay gastos');
  await q.evaluate(() => { Aventura.auto = true; Aventura.next = 0; }); await q.waitForTimeout(1500);
  assert.strictEqual(await q.locator('.hero.adv').count(), 0, 'reducir movimiento: sin aventuras');
  assert.deepStrictEqual(errs, []);
  await b.close();
  console.log('E2E AVENTURAS OK (sale, cuenta, otra al tocar, vuelve, quieta con hoja abierta o sin movimiento)');
})().catch(e => { console.error('E2E AVENTURAS FAIL:', e); process.exit(1); });
