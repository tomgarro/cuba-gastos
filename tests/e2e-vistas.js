// Vistas: Cuba grande, Inicio con los gastos de la quincena, Gastos con varios períodos a la vez.
const { chromium } = require('playwright');
const assert = require('assert');
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const y = +today.slice(0, 4), mo = +today.slice(5, 7);
  const ago = n => { const t = y * 12 + mo - 1 - n; return Math.floor(t / 12) + '-' + ('0' + (t % 12 + 1)).slice(-2) + '-10'; };
  const ledger = {};
  const mk = (i, date, d) => { const mkey = date.slice(0, 7); (ledger[mkey] = ledger[mkey] || {})['x' + i] = { id: 'x' + i, type: 'expense', desc: d, cents: 100000, cur: 'ARS', date, paidBy: 'm1', sp: [['m1', 50000], ['m2', 50000]], cat: 'otros', by: 'm1', at: new Date().toISOString() }; };
  for (let i = 0; i < 7; i++) mk(i, today, 'Hoy ' + i);
  mk(20, ago(1), 'Mes pasado'); mk(21, ago(2), 'Antepasado');
  await p.addInitScript(([l]) => {
    localStorage.setItem('cuba:v1', JSON.stringify({ group: { name: 'Casa', cur: 'ARS', members: [{ id: 'm1', name: 'Tomi', color: '#c47a35' }, { id: 'm2', name: 'Pau', color: '#4f7c6d' }] }, ledger: l, closings: [] }));
    localStorage.setItem('cuba:me', 'm1');
  }, [ledger]);
  await p.goto(require('url').pathToFileURL(require('path').resolve(__dirname, '..', 'index.html')).href);
  await p.waitForSelector('.hero');
  const hero = await p.locator('.hero .cuba').boundingBox();
  assert.ok(hero.height >= 140, 'Cuba en Inicio es grande: ' + hero.height);
  const logo = await p.locator('.brand .cuba').boundingBox();
  assert.ok(logo.height >= 55, 'y el de arriba no es una miniatura: ' + logo.height);
  const t = await p.locator('.card h3', { hasText: /quincena/ }).innerText();
  assert.ok(/esta quincena · 7 movimientos/i.test(t), t);
  assert.strictEqual(await p.locator('.card:has(h3:has-text("quincena")) .item').count(), 7, 'los 7 de la quincena, no solo 5');
  await p.click('.nav [data-v=gastos]');
  assert.ok(await p.locator('#list', { hasText: 'Hoy 0' }).count() === 1 && await p.locator('#list', { hasText: 'Mes pasado' }).count() === 0, 'por defecto: solo este mes');
  await p.click('[data-act=perOpen]');
  const chips = p.locator('.chip.on:not(:has(b))');
  assert.strictEqual(await chips.count(), 1, 'un mes marcado');
  await p.click('[data-act=perPreset][data-v="3m"]');
  const txt = await p.locator('#list').innerText();
  assert.ok(/Hoy 0/.test(txt) && /Mes pasado/.test(txt) && /Antepasado/.test(txt), 'tres meses a la vez');
  assert.ok(/9 movimientos/.test(txt));
  // sacar un mes con un toque
  await p.click('[data-act=perToggle][data-v="' + today.slice(0, 7) + '"]');
  const sin = await p.locator('#list').innerText();
  assert.ok(!/Hoy 0/.test(sin) && /Mes pasado/.test(sin) && /Antepasado/.test(sin), 'un mes menos');
  // no deja la selección vacía
  await p.click('[data-act=perPreset][data-v=mes]');
  await p.locator('[data-act=perToggle].on').first().click();
  assert.ok(await p.locator('[data-act=perToggle].on').count() === 1, 'siempre queda un período');
  assert.deepStrictEqual(errs, []);
  await b.close();
  console.log('E2E VISTAS OK (Cuba grande, quincena en Inicio, varios períodos)');
})().catch(e => { console.error('E2E VISTAS FAIL:', e); process.exit(1); });
