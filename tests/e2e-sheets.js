// De punta a punta: dos «celulares» (dos navegadores) → app → protocolo → Code.gs real → Sheet simulada.
// No hay red real: el Web App de Apps Script se intercepta y lo atiende el mismo Code.gs que se publica.
const { chromium } = require('playwright');
const assert = require('assert');
const path = require('path');
const { boot } = require('./fake-sheet.js');

const EXEC = 'https://script.google.com/macros/s/TEST/exec';
const cfg = Buffer.from(JSON.stringify({ u: EXEC, t: 'TOK' })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
const URL_APP = require('url').pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href;
const J = x => JSON.parse(JSON.stringify(x));

(async () => {
  const sheet = boot();
  const col = n => sheet.TABS.Movimientos.indexOf(n);
  const wire = { posts: 0, options: 0, badType: 0, bodies: [] };
  const state = { down: false };
  const errs = [];
  const browser = await chromium.launch();

  async function phone(name) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
    await ctx.route('https://script.google.com/**', async route => {
      const req = route.request();
      if (state.down) return route.abort('failed');
      if (req.method() === 'OPTIONS') { wire.options++; return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }); }
      wire.posts++;
      if (!/^text\/plain/.test(req.headers()['content-type'] || '')) wire.badType++;
      wire.bodies.push(req.postData());
      const out = sheet.ctx.doPost({ postData: { contents: req.postData() } }).getContent();
      await new Promise(r => setTimeout(r, 15)); // latencia mínima para que haya estados intermedios
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: out });
    });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(name + ' pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_|net::|Failed to load resource|Error: red|ya fue modificado o eliminado/.test(m.text())) errs.push(name + ' console: ' + m.text()); });
    return { ctx, p, txt: async () => (await p.locator('#app').innerText()).replace(/\n/g, ' ') };
  }
  const refresh = p => p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

  // Invariante: lo escrito antes nunca cambia (salvo anulado) y los repartos suman exacto.
  let prev = [];
  function checkAppendOnly(where) {
    const g = sheet.grids.Movimientos, ia = col('anulado');
    prev.forEach((row, r) => row.forEach((v, c) => {
      if (c === ia) { if (v === 'TRUE') assert.strictEqual(g[r][c], 'TRUE', where + ': un anulado volvió'); }
      else assert.strictEqual(g[r][c], v, where + ': cambió fila ' + r + ' col ' + sheet.TABS.Movimientos[c]);
    }));
    g.slice(1).forEach(row => assert.strictEqual(JSON.parse(row[col('reparto_json')]).reduce((s, x) => s + x[1], 0), row[col('monto_centavos')], where + ': reparto no suma'));
    prev = J(g);
  }

  // ---- Celular A: primer emparejado, la Sheet está vacía → onboarding ----
  const A = await phone('A');
  await A.p.goto(URL_APP + '#cfg=' + cfg);
  await A.p.waitForSelector('text=Soy Cuba');
  assert.ok(!A.p.url().includes('cfg='), 'el token no se queda en la barra de direcciones');
  await A.p.click('[data-act=ob][data-v="1"]');
  await A.p.fill('[data-i="0"]', 'Tomi'); await A.p.fill('[data-i="1"]', 'Pau');
  await A.p.click('[data-act=ob][data-v="2"]'); await A.p.dblclick('[data-act=obfinish][data-i="0"]'); await A.p.evaluate(() => { var b = document.querySelector('[data-act=obfinish]'); if (b) { b.disabled = false; b.click(); b.click(); } }); // toques repetidos: no deben duplicar personas
  await A.p.waitForSelector('text=Todavía no hay gastos');
  assert.deepStrictEqual(J(sheet.grids.Personas.slice(1).map(r => [r[1], r[4]])), [['Tomi', 'activa'], ['Pau', 'activa']]);
  const [idTomi, idPau] = sheet.grids.Personas.slice(1).map(r => r[0]);

  // A anota un gasto rápido (15.200 / 2)
  await A.p.click('.fab'); await A.p.fill('#quick', 'super 15.200'); await A.p.click('[data-act=quick]'); await A.p.click('[data-act=save]');
  await A.p.waitForSelector('text=Pau le debe');
  assert.ok(/Pau\s+le debe\s+\$7\.600,00\s+a\s+Tomi/.test(await A.txt()));
  assert.strictEqual(sheet.grids.Movimientos.length, 2);
  const row1 = sheet.grids.Movimientos[1];
  assert.deepStrictEqual([row1[col('monto_centavos')], row1[col('moneda')], row1[col('pagador_id')], row1[col('reparto_modo')], row1[col('origen')]], [1520000, 'ARS', idTomi, 'igual', 'manual']);
  checkAppendOnly('alta');

  // ---- Celular B: abre el link, ya hay datos → elige quién es y ve lo de A ----
  const B = await phone('B');
  await B.p.goto(URL_APP + '#cfg=' + cfg);
  await B.p.waitForSelector('[data-act=who]');
  await B.p.click('[data-act=who][data-id="' + idPau + '"]');
  await B.p.waitForSelector('text=Super');
  assert.ok(/le debe/.test(await B.txt()) && /7\.600,00/.test(await B.txt()), 'B ve el gasto de A: ' + (await B.txt()).slice(0, 200));
  assert.ok((await B.p.locator('.chip').innerText()).startsWith('Pau'));

  // B edita (cena pagada por Pau, 70/30) → reemplaza, no pisa
  await B.p.click('.fab'); await B.p.fill('#fdesc', 'Cena'); await B.p.fill('[data-in=amount]', '10000');
  await B.p.selectOption('[data-in=paidBy]', { label: 'Pau' });
  await B.p.click('[data-act=mode][data-v=percent]');
  await B.p.locator('input[data-in=val]').nth(0).fill('70'); await B.p.locator('input[data-in=val]').nth(1).fill('30');
  await B.p.click('[data-act=save]'); await B.p.waitForFunction(() => /\$600,00/.test(document.querySelector('#app').innerText), null, { timeout: 5000 });
  assert.ok(/Pau\s+le debe\s+\$600,00\s+a\s+Tomi/.test(await B.txt()), await B.txt());
  assert.strictEqual(sheet.grids.Movimientos[2][col('reparto_modo')], 'exacto');
  checkAppendOnly('alta B');
  await B.p.click('.nav [data-v=gastos]');
  await B.p.locator('.item', { hasText: 'Super' }).click(); await B.p.click('[data-act=edit]');
  await B.p.fill('[data-in=amount]', '20000'); await B.p.click('[data-act=save]');
  await B.p.waitForSelector('.item >> text=$20.000'); await B.p.waitForTimeout(150);
  const mv = J(sheet.grids.Movimientos);
  assert.strictEqual(mv.length, 4, 'la edición agregó una fila, no pisó la vieja');
  assert.strictEqual(mv[1][col('anulado')], 'TRUE'); assert.strictEqual(mv[1][col('monto_centavos')], 1520000, 'el original quedó intacto');
  assert.strictEqual(mv[3][col('reemplaza_id')], mv[1][0]); assert.strictEqual(mv[3][col('monto_centavos')], 2000000);
  checkAppendOnly('edición');

  // A se entera (vuelve a abrir la app) sin recargar
  await refresh(A.p);
  await A.p.waitForSelector('#app.perk', { timeout: 3000 });
  await A.p.click('.nav [data-v=gastos]');
  await A.p.waitForSelector('.item >> text=$20.000');
  assert.ok(!(await A.p.locator('#list').innerText()).includes('15.200'), 'A ya no ve el monto viejo');

  // ---- Sin conexión: se ve lo último, no se puede anotar, no se rompe nada ----
  state.down = true;
  await B.p.click('.fab'); await B.p.fill('#fdesc', 'Fantasma'); await B.p.fill('[data-in=amount]', '500'); await B.p.click('[data-act=save]');
  await B.p.waitForFunction(() => /No hay conexión con la Sheet/.test((document.querySelector('#toast') || {}).innerText || ''), null, { timeout: 5000 });
  await B.p.click('[data-act=close]');
  await B.p.waitForSelector('.banner >> text=Sin conexión');
  assert.ok((await B.txt()).includes('Cena'), 'sigue mostrando lo último');
  assert.strictEqual(sheet.grids.Movimientos.length, 4, 'nada se escribió');
  await B.p.reload(); // abrir la app sin red: carga lo último que vio
  await B.p.waitForSelector('.banner >> text=Sin conexión');
  assert.ok((await B.txt()).includes('Cena'));
  state.down = false;
  await B.p.evaluate(() => window.dispatchEvent(new Event('online')));
  await B.p.waitForSelector('.banner', { state: 'detached', timeout: 5000 });

  // ---- Importar Splitwise = un lote que se puede deshacer en el backend ----
  await B.p.click('.nav [data-v=ajustes]');
  const csv = 'Date,Description,Category,Cost,Currency,Tomi,Pau\n2026-09-01,Alquiler,Rent,300000.00,ARS,150000.00,-150000.00\n2026-09-05,Payment,Payment,5000.00,ARS,5000.00,-5000.00\n';
  await B.p.fill('#paste', csv); await B.p.click('[data-act=impprev]'); await B.p.click('[data-act=impgo]');
  await B.p.waitForFunction(() => /2 movimientos importados|importados/.test(document.querySelector('#toast').textContent), null, { timeout: 5000 });
  await B.p.waitForTimeout(150);
  assert.strictEqual(sheet.grids.Lotes.length, 2);
  assert.deepStrictEqual(J(sheet.grids.Lotes[1]).slice(1, 3).concat(J(sheet.grids.Lotes[1])[4], J(sheet.grids.Lotes[1])[6]), ['splitwise', '', 2, 'activo']);
  const imp = J(sheet.grids.Movimientos).slice(1).filter(r => r[col('origen')] === 'splitwise');
  assert.strictEqual(imp.length, 2); imp.forEach(r => assert.strictEqual(r[col('lote_id')], sheet.grids.Lotes[1][0]));
  checkAppendOnly('importación');
  assert.strictEqual(sheet.call('undoLote', { lote_id: sheet.grids.Lotes[1][0] }).anulados, 2);
  checkAppendOnly('deshacer lote');
  await refresh(B.p); await B.p.waitForTimeout(250); await B.p.click('.nav [data-v=inicio]');
  assert.ok(!/Alquiler/.test(await B.txt()), 'el lote deshecho desaparece de la app');

  // ---- Borrar desde A ----
  await refresh(A.p); await A.p.click('.nav [data-v=gastos]');
  await A.p.locator('.item', { hasText: 'Cena' }).click(); await A.p.click('[data-act=askdel]'); await A.p.click('[data-act=del]');
  await A.p.waitForTimeout(300);
  const cena = J(sheet.grids.Movimientos).find(r => r[col('descripcion')] === 'Cena');
  assert.strictEqual(cena[col('anulado')], 'TRUE'); checkAppendOnly('borrar');

  // ---- Conflicto: A y B editan lo mismo; el segundo recibe aviso y no se pisa ----
  await refresh(A.p); await refresh(B.p); await B.p.click('.nav [data-v=gastos]'); await A.p.click('.nav [data-v=gastos]');
  await A.p.waitForTimeout(250);
  const live = J(sheet.grids.Movimientos).filter(r => r[col('anulado')] === 'FALSE' && r[col('origen')] === 'manual');
  assert.ok(live.length >= 1);
  const target = live[0][col('descripcion')];
  await A.p.locator('.item', { hasText: target }).first().click(); await B.p.locator('.item', { hasText: target }).first().click();
  await A.p.click('[data-act=edit]'); await B.p.click('[data-act=edit]');
  await A.p.fill('#fdesc', target + ' (A)'); await B.p.fill('#fdesc', target + ' (B)');
  await A.p.click('[data-act=save]'); await A.p.waitForTimeout(250);
  const before = sheet.grids.Movimientos.length;
  await B.p.click('[data-act=save]');
  await B.p.waitForSelector('#toast.show'); await B.p.waitForTimeout(100);
  assert.ok(/ya fue modificado o eliminado desde otro celular/.test(await B.p.locator('#toast').innerText()), await B.p.locator('#toast').innerText());
  assert.strictEqual(sheet.grids.Movimientos.length, before, 'el segundo no escribió nada');
  checkAppendOnly('conflicto');

  // ---- Token cambiado: este celular avisa qué pasó ----
  sheet.log.props.CUBA_TOKEN = 'OTRO';
  await refresh(A.p);
  await A.p.waitForSelector('.banner >> text=no reconoce este celular');

  // ---- Reglas del protocolo ----
  assert.strictEqual(wire.options, 0, 'sin preflight CORS (Content-Type text/plain)');
  assert.strictEqual(wire.badType, 0);
  assert.ok(wire.posts > 10);
  assert.ok(wire.bodies.every(b => !/localStorage|sueldo/i.test(b)));
  assert.deepStrictEqual(errs, [], errs.join('\n'));
  console.log('E2E SHEETS OK (' + wire.posts + ' pedidos al backend, ' + (sheet.grids.Movimientos.length - 1) + ' movimientos, historial intacto)');
  await browser.close();
})().catch(e => { console.error('E2E SHEETS FAIL:', e.stack || e.message); process.exit(1); });
