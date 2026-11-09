// De punta a punta: dos «celulares» (dos navegadores) → app → protocolo → Code.gs real → Sheet simulada.
// No hay red real: el Web App de Apps Script se intercepta y lo atiende el mismo Code.gs que se publica.
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
  const wire = { posts: 0, options: 0, badType: 0, bodies: [] };
  const state = { down: false, busy: 0, falla: null, lat: 15 };
  const errs = [];
  const browser = await chromium.launch();

  async function phone(name) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
    await ctx.route('https://script.google.com/**', async route => {
      const req = route.request();
      if (state.down) return route.abort('failed');
      if (req.method() === 'OPTIONS') { wire.options++; return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } }); }
      if (state.busy > 0) { state.busy--; return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: false, error: 'ocupado', message: 'El backend está ocupado. Probá de nuevo en unos segundos.' }) }); }
      if (state.falla && new RegExp('"action":"' + state.falla + '"').test(req.postData() || '')) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: false, error: 'interno', message: 'Error interno del backend.' }) });
      wire.posts++;
      if (!/^text\/plain/.test(req.headers()['content-type'] || '')) wire.badType++;
      wire.bodies.push(req.postData());
      const out = sheet.ctx.doPost({ postData: { contents: req.postData() } }).getContent();
      await new Promise(r => setTimeout(r, state.lat)); // latencia mínima para que haya estados intermedios
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: out });
    });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(name + ' pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_|net::|Failed to load resource|Error: red|ya fue modificado o eliminado|Error interno del backend/.test(m.text())) errs.push(name + ' console: ' + m.text()); });
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

  // Celular C: la app agregada a la pantalla de inicio (almacenamiento vacío, sin #cfg) → pega el link y conecta
  const Cc = await phone('C');
  await Cc.p.goto(URL_APP);
  await Cc.p.waitForSelector('text=Soy Cuba');
  await Cc.p.click('summary >> text=Conectar con la Sheet');
  await Cc.p.fill('[data-in=pairlink]', 'texto basura'); await Cc.p.click('[data-act=pair]');
  await Cc.p.waitForSelector('#toast.show'); assert.ok(/no sirve/.test(await Cc.p.locator('#toast').innerText()));
  await Cc.p.fill('[data-in=pairlink]', 'https://tomgarro.github.io/cuba-gastos/#cfg=' + cfg); await Cc.p.click('[data-act=pair]');
  await Cc.p.waitForSelector('[data-act=who]'); // ya ve a las personas de la Sheet, no pide «poné dos nombres»
  assert.ok(!(await Cc.txt()).includes('Soy Cuba'));
  await Cc.ctx.close();

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

  // ---- Sin conexión: lo anotado queda en una cola guardada en el celular y sale solo cuando vuelve la señal ----
  const sinPend = p => p.waitForFunction(() => { const e = document.getElementById('pend'); return !e || e.style.display === 'none'; }, null, { timeout: 8000 });
  state.down = true;
  await B.p.click('.fab'); await B.p.fill('#fdesc', 'Fantasma'); await B.p.fill('[data-in=amount]', '500'); await B.p.click('[data-act=save]');
  await B.p.waitForSelector('.item >> text=Fantasma', { timeout: 3000 });                       // se ve al instante
  await B.p.waitForFunction(() => /Sin señal: 1 cambio espera/.test((document.getElementById('pend') || {}).textContent || ''), null, { timeout: 15000 });
  assert.strictEqual(sheet.grids.Movimientos.length, 4, 'sin señal no se escribió todavía');
  await B.p.reload();                                                                            // aunque se cierre la app, la cola sigue ahí
  await B.p.waitForSelector('.item >> text=Fantasma', { timeout: 5000 });
  assert.ok((await B.txt()).includes('Cena'), 'sigue mostrando lo último');
  state.down = false;
  await B.p.evaluate(() => window.dispatchEvent(new Event('online')));
  await sinPend(B.p);
  assert.strictEqual(sheet.grids.Movimientos.length, 5, 'al volver la señal se envió, una sola vez');
  assert.ok(J(sheet.grids.Movimientos).some(r => r[col('descripcion')] === 'Fantasma'));
  await B.p.locator('.item', { hasText: 'Fantasma' }).first().click(); await B.p.click('[data-act=askdel]'); await B.p.click('[data-act=del]'); await sinPend(B.p);
  checkAppendOnly('cola sin conexión');

  // ---- Aunque el backend tarde 4 segundos, la pantalla responde al instante ----
  {
    state.lat = 4000;
    const t0 = Date.now();
    await B.p.click('.fab'); await B.p.fill('#fdesc', 'Lento'); await B.p.fill('[data-in=amount]', '700'); await B.p.click('[data-act=save]');
    await B.p.waitForSelector('.item >> text=Lento', { timeout: 3000 });
    const ms = Date.now() - t0; assert.ok(ms < 1500, 'se ve al instante, tardó ' + ms + ' ms');
    await B.p.locator('.item', { hasText: 'Lento' }).first().click(); await B.p.click('[data-act=askdel]');
    const t1 = Date.now(); await B.p.click('[data-act=del]'); await B.p.waitForFunction(() => !document.querySelector('.item') || ![...document.querySelectorAll('.item')].some(x => /Lento/.test(x.innerText)), null, { timeout: 3000 });
    assert.ok(Date.now() - t1 < 1500, 'borrar también es instantáneo');
    state.lat = 15; await sinPend(B.p);
  }

  // ---- Importar Splitwise = un lote que se puede deshacer en el backend ----
  await B.p.click('.nav [data-v=ajustes]'); await openAll(B.p);
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

  // ---- Importación real: nombres distintos a los de la app y moneda mal puesta (Splitwise dice USD) ----
  await B.p.click('.nav [data-v=ajustes]'); await openAll(B.p);
  const csv2 = 'Date,Description,Category,Cost,Currency,Oda Peralta,Tomás Garro\n2021-12-02,Verdulería,General,630.00,USD,315.00,-315.00\n2021-12-03,Coto,Groceries,8128.00,USD,-4064.00,4064.00\n2021-12-07,Oda P. paid Tomás G.,Payment,1000.00,USD,1000.00,-1000.00\n\n2026-11-06,Total balance, , ,USD,0,0\n';
  await B.p.fill('#paste', csv2); await B.p.click('[data-act=impprev]');
  assert.ok(/Elegí quién es «Oda Peralta»/.test(await B.p.locator('.preview.neg').first().innerText()), 'sin elegir no se puede importar');
  assert.strictEqual(await B.p.locator('[data-act=impgo]').count(), 0, 'sin botón hasta mapear');
  const nPers = sheet.grids.Personas.length;
  await B.p.selectOption('[data-in=impmap][data-id]:nth-of-type(1) >> nth=0', { label: 'Pau' }).catch(() => {});
  const sel = B.p.locator('select[data-in=impmap]');
  const firstVal = await sel.nth(0).inputValue(); if (!firstVal) await sel.nth(0).selectOption({ label: 'Pau' });
  assert.ok(/USD/.test(await B.p.locator('.card:has-text("Moneda de este lote")').first().innerText()));
  await B.p.selectOption('select[data-in=impcur]', 'ARS');
  const prev2 = await B.p.locator('.preview:not(.neg)', { hasText: 'movimientos' }).first().innerText();
  assert.ok(/3 movimientos/.test(prev2) && !/US\$/.test(prev2) && /\$/.test(prev2), prev2);
  await B.p.click('[data-act=impgo]');
  await B.p.waitForFunction(() => /3 movimientos importados/.test(document.querySelector('#toast').textContent), null, { timeout: 5000 });
  await B.p.waitForTimeout(200);
  assert.strictEqual(sheet.grids.Personas.length, nPers, 'no se crearon personas duplicadas');
  const imp2 = J(sheet.grids.Movimientos).slice(1).filter(r => r[col('origen')] === 'splitwise' && r[col('anulado')] === 'FALSE');
  assert.strictEqual(imp2.length, 3); imp2.forEach(r => assert.strictEqual(r[col('moneda')], 'ARS'));
  checkAppendOnly('importación real');
  await B.p.click('.nav [data-v=ajustes]'); await openAll(B.p);
  B.p.once('dialog', d => d.accept());
  await B.p.locator('[data-act=undolote]').first().click();
  await B.p.waitForFunction(() => /Importación deshecha/.test(document.querySelector('#toast').textContent), null, { timeout: 5000 });
  assert.strictEqual(J(sheet.grids.Movimientos).slice(1).filter(r => r[col('origen')] === 'splitwise' && r[col('anulado')] === 'FALSE').length, 0, 'Deshacer desde la app anula el lote');
  checkAppendOnly('deshacer desde la app');

  // ---- Categorías con Gemini (falso): memoria → Gemini → dudosos → corrección que se aprende ----
  {
    const pid = sheet.grids.Personas.slice(1).map(r => r[0]);
    const m = (id, d, c) => ({ id, tipo: 'gasto', fecha: '2026-11-03', descripcion: d, monto_centavos: c, moneda: 'ARS', pagador_id: pid[0],
      reparto_modo: 'igual', reparto: [[pid[0], Math.ceil(c / 2)], [pid[1], Math.floor(c / 2)]], categoria: 'otros', nota: '', origen: 'manual', creado_por: pid[0] });
    sheet.call('addMovimientos', { movimientos: [m('cat1', 'Zorbaflix Noviembre', 150000), m('cat2', 'Zorbaflix Octubre', 150000), m('cat3', 'Local Raro Sur', 80000), m('cat4', 'Cosa Incierta', 50000)] });
    sheet.log.props.GEMINI_API_KEY = 'K'.repeat(30);
    const sent = [];
    sheet.ctx.UrlFetchApp = { fetch: (u, o) => {
      const prompt = JSON.parse(o.payload).contents[0].parts[0].text; sent.push(prompt);
      const out = prompt.split('\n').filter(l => /^\d+ \| /.test(l)).map(l => { const [n, d] = l.split(' | ');
        return /zorbaflix/i.test(d) ? { n: +n, categoria: 'streaming', confianza: 0.95 } : /local raro/i.test(d) ? { n: +n, categoria: 'casa', confianza: 0.6 } : { n: +n, categoria: 'otros', confianza: 0.2 }; });
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }) };
    } };
    await refresh(B.p); await B.p.waitForTimeout(250); await B.p.click('.nav [data-v=ajustes]'); await openAll(B.p);
    await B.p.click('[data-act=catrun]');
    await B.p.waitForFunction(() => /Para confirmar/i.test(document.querySelector('#app').innerText), null, { timeout: 8000 });
    await sinPend(B.p);
    assert.strictEqual(sent.length, 1, 'una sola consulta a Gemini para todo el lote');
    assert.ok(!/Tomi|Pau|sueldo/i.test(sent[0]), 'a Gemini no viajan nombres ni sueldos');
    const eti = () => J(sheet.grids.Etiquetas).slice(1);
    assert.strictEqual(eti().filter(r => r[2] === 'streaming' && r[5] === 'aplicada').length, 2, 'lo seguro se aplica solo');
    assert.strictEqual(eti().filter(r => r[5] === 'dudosa').length, 1, 'lo dudoso queda para confirmar');
    assert.ok(/Local Raro Sur/.test(await B.txt()), 'el dudoso se muestra');
    await B.p.selectOption('[data-in=catfix]', 'super');
    await B.p.waitForFunction(() => !/Local Raro Sur/i.test(document.querySelector('#app').innerText), null, { timeout: 5000 });
    await sinPend(B.p);
    assert.ok(eti().some(r => r[1] === 'cat3' && r[2] === 'super' && r[4] === 'manual' && r[5] === 'aplicada'), 'la corrección queda como etiqueta manual');
    assert.ok(J(sheet.grids.Comercios).slice(1).some(r => /local raro/.test(r[0]) && r[2] === 'super'), 'la corrección se vuelve regla');
    checkAppendOnly('categorías');
    // gasto nuevo: la descripción queda prolija y la categoría la sugiere el motor (Gemini falso) sin tocar nada
    await B.p.click('.nav [data-v=inicio]'); await B.p.click('.fab');
    await B.p.fill('#fdesc', '  zorbaflix   DICIEMBRE '); await B.p.click('[data-in=amount]');
    await B.p.waitForFunction(() => document.querySelector('.cats button.on') && document.querySelector('.cats button.on').dataset.v === 'streaming', null, { timeout: 5000 });
    assert.strictEqual(await B.p.inputValue('#fdesc'), 'Zorbaflix Diciembre', 'descripción prolija');
    await B.p.click('[data-act=close]').catch(() => {}); await B.p.keyboard.press('Escape');
    // si el backend está ocupado, la app reintenta sola en vez de mostrar el error
    await B.p.click('.nav [data-v=ajustes]'); await openAll(B.p);
    state.busy = 2; const antes = sent.length;
    await B.p.click('[data-act=catrun]');
    await B.p.waitForFunction(() => /No pude categorizar|Categoricé/i.test(document.querySelector('#app').innerText), null, { timeout: 15000 });
    assert.ok(sent.length > antes && state.busy === 0, 'reintentó y llegó a Gemini');
    assert.ok(!/ocupado/i.test(await B.p.locator('#toast').innerText()), 'sin error de ocupado');
    await refresh(A.p); await A.p.waitForTimeout(250); await A.p.click('.nav [data-v=gastos]');
    assert.ok(/Zorbaflix/.test(await A.txt()), 'el otro celular ve los gastos');
  }

  // ---- Resumen de tarjeta (PDF inventado): lo compartido entra, lo personal no, y Cuba aprende ----
  {
    const pdf = path.resolve(__dirname, 'fixtures', 'resumen_demo.pdf');
    const antes = J(sheet.grids.Movimientos).length;
    await B.p.click('.nav [data-v=ajustes]'); await openAll(B.p);
    await B.p.setInputFiles('#rsfile', pdf);
    await B.p.waitForSelector('.rsrow', { timeout: 10000 });
    assert.strictEqual(await B.p.locator('.rsrow').count(), 7, 'siete consumos (el impuesto no cuenta)');
    const fila = re => B.p.locator('.rsrow', { hasText: re });
    assert.ok(/Compartido/.test(await fila(/LUZ/).innerText()), 'la luz parece del hogar');
    assert.ok(/No compartido/.test(await fila(/Subte/).innerText()), 'lo que Cuba no conoce arranca personal');
    await fila(/Farmacia/).locator('.chip').click();                       // lo decido yo
    await fila(/AGUA/).locator('.chip').click();                           // y el agua la saco
    await B.p.click('[data-act=rsgo]');
    await B.p.waitForFunction(() => /gastos compartidos cargados/.test(document.querySelector('#toast').textContent), null, { timeout: 10000 });
    await sinPend(B.p);
    const movs = J(sheet.grids.Movimientos).slice(antes - 1).filter(r => r[col('origen')] === 'resumen');
    assert.strictEqual(movs.length, 3, 'luz, coto y farmacia: solo lo marcado compartido');
    assert.ok(movs.every(r => !/subte|agua/i.test(r[col('descripcion')])), 'lo personal no se guarda');
    assert.ok(movs.some(r => /^LUZ \| [A-Z]+$/.test(r[col('descripcion')])), 'servicio con formato Splitwise');
    assert.ok(movs.every(r => r[col('lote_id')]), 'van en un lote que se puede deshacer');
    const reglas = Object.fromEntries(J(sheet.grids.ReglasResumen).slice(1).map(r => [r[0], r[1]]));
    assert.strictEqual(reglas['subte'], 'no'); assert.strictEqual(reglas['farmacia demo'], 'si'); assert.strictEqual(reglas.agua, 'no', 'cambiar de opinión también se aprende');
    assert.strictEqual(J(sheet.grids.Resumenes).length, 2, 'queda registrado el resumen de octubre');
    checkAppendOnly('resumen de tarjeta');
    // el mismo PDF otra vez: lo ya cargado se reconoce y no se duplica
    await B.p.click('.nav [data-v=ajustes]'); await openAll(B.p);
    await B.p.setInputFiles('#rsfile', pdf);
    await B.p.waitForSelector('.rsrow', { timeout: 10000 });
    assert.ok(/3 ya estaban cargados/.test(await B.txt()), 'reconoce lo que ya está');
    assert.ok(await B.p.locator('[data-act=rsgo]').isDisabled(), 'nada nuevo que cargar');
    await B.p.click('[data-act=rsclear]');
    // la otra persona ve lo mismo y lo que Cuba aprendió
    await refresh(A.p); await A.p.waitForTimeout(250); await A.p.click('.nav [data-v=ajustes]'); await openAll(A.p);
    await A.p.setInputFiles('#rsfile', pdf); await A.p.waitForSelector('.rsrow', { timeout: 10000 });
    assert.ok(/Ya sabía/i.test(await A.txt()) && /3 ya estaban cargados/.test(await A.txt()), 'Odi ve las mismas reglas y lo ya cargado');
    await A.p.click('[data-act=rsclear]');
  }

  // ---- Resumen con dólares y sueldos cargados después de la fecha del gasto ----
  {
    const [pT, pP] = sheet.grids.Personas.slice(1).map(r => r[0]);
    sheet.grids.Sueldos.push(['s1', pT, '2026-11-06', '300000000', 'ARS', '', pT, '2026-11-06T10:00:00Z'], ['s2', pP, '2026-11-06', '100000000', 'ARS', '', pP, '2026-11-06T10:00:00Z']);
    const txt = require('fs').readFileSync(path.resolve(__dirname, 'fixtures', 'resumen_dolar.txt'), 'utf8');
    await refresh(B.p); await B.p.waitForTimeout(250);
    await B.p.click('.nav [data-v=ajustes]'); await openAll(B.p);
    await B.p.fill('#rspaste', txt); await B.p.click('[data-act=rsread]');
    await B.p.waitForSelector('.rsrow', { timeout: 10000 });
    assert.strictEqual(await B.p.inputValue('#rstc'), '500', 'lee la cotización del propio resumen');
    assert.strictEqual(await B.p.inputValue('#rspct'), '30', 'RG 5617 para todos; IVA e IIBB solo al que corresponde');
    await B.p.locator('.rsrow', { hasText: /Zorbaflix/i }).locator('.chip').click();
    await B.p.locator('.rsrow', { hasText: /Luz/i }).locator('.chip:not(.on)').click().catch(() => {});
    await B.p.click('[data-act=rsgo]');
    await B.p.waitForFunction(() => /gastos? compartidos? cargados?/.test(document.querySelector('#toast').textContent), null, { timeout: 10000 });
    await sinPend(B.p);
    await sinPend(B.p);
    const mv = J(sheet.grids.Movimientos).filter(r => /ZORBAFLIX/i.test(r[col('descripcion')]) && r[col('origen')] === 'resumen')[0];
    assert.strictEqual(mv[col('moneda')], 'ARS'); assert.strictEqual(+mv[col('monto_centavos')], 1000 * 500 * 153 / 100 * 1, 'USD 10 × 500 × 1,53 = $7.650');
    const rep = JSON.parse(mv[col('reparto_json')]); const vals = Array.isArray(rep) ? rep.map(x => x[1]) : Object.values(rep);
    assert.deepStrictEqual(vals.slice().sort((a, b) => a - b), [191250, 573750], 'reparto 25/75 por sueldo, no mitad y mitad');
    assert.ok(/USD 10,00 × 500/.test(mv[col('nota')]), 'la nota guarda cómo se convirtió');
    // deshacer el lote y volver a subir el mismo resumen: tiene que cargar de nuevo (mismo id determinístico ≠ ignorado)
    B.p.once('dialog', d => d.accept());
    await B.p.click('.nav [data-v=ajustes]'); await openAll(B.p);
    await B.p.locator('[data-act=undolote][data-id="' + mv[col('lote_id')] + '"]').click(); await B.p.waitForTimeout(400);
    await B.p.fill('#rspaste', txt); await B.p.click('[data-act=rsread]');
    await B.p.waitForSelector('.rsrow', { timeout: 10000 });
    assert.ok(!/ya estaban cargados/.test(await B.txt()), 'lo deshecho no cuenta como cargado');
    const sel2 = await B.p.locator('.rsrow .chip.on').count(); assert.ok(sel2 >= 1, 'Cuba recuerda lo que marcaste');
    await B.p.click('[data-act=rsgo]');
    await B.p.waitForFunction(() => /gastos? compartidos? cargados?/.test(document.querySelector('#toast').textContent), null, { timeout: 10000 });
    await sinPend(B.p);
    await sinPend(B.p);
    const zs = J(sheet.grids.Movimientos).filter(r => /ZORBAFLIX/i.test(r[col('descripcion')]) && r[col('origen')] === 'resumen');
    assert.strictEqual(zs.length, 2, 'queda el anulado y el nuevo'); assert.deepStrictEqual(zs.map(r => r[col('anulado')]), ['TRUE', 'FALSE']);
    checkAppendOnly('reimportar tras deshacer');
    // blindaje: si falla guardar lo aprendido, los gastos ya quedaron y reintentar NO los duplica
    const n0 = J(sheet.grids.Movimientos).filter(r => r[col('origen')] === 'resumen').length;
    const txt2 = txt.replace('ZORBAFLIX', 'NUEVOCOMERCIO').replace('OTROSERVICIO', 'OTROCOMERCIO');
    state.falla = 'aprenderResumen';
    await B.p.click('.nav [data-v=ajustes]'); await openAll(B.p);
    await B.p.fill('#rspaste', txt2); await B.p.click('[data-act=rsread]'); await B.p.waitForSelector('.rsrow', { timeout: 10000 });
    await B.p.locator('.rsrow', { hasText: /Nuevocomercio/i }).locator('.chip:not(.on)').click();
    await B.p.click('[data-act=rsgo]');
    await B.p.waitForFunction(() => /Error interno del backend/i.test(document.querySelector('#toast').textContent), null, { timeout: 10000 });
    state.falla = null; await sinPend(B.p); await B.p.waitForTimeout(400);
    const n1 = J(sheet.grids.Movimientos).filter(r => r[col('origen')] === 'resumen').length;
    assert.ok(n1 > n0, 'los gastos quedaron cargados');
    await B.p.click('.nav [data-v=ajustes]'); await openAll(B.p);
    await B.p.fill('#rspaste', txt2); await B.p.click('[data-act=rsread]'); await B.p.waitForSelector('.rsrow', { timeout: 10000 });
    assert.ok(await B.p.locator('[data-act=rsgo]').isDisabled() || /ya estaban/.test(await B.txt()), 'lo cargado figura como ya estaba');
    if (!(await B.p.locator('[data-act=rsgo]').isDisabled())) await B.p.click('[data-act=rsgo]');
    await B.p.waitForTimeout(500);
    assert.strictEqual(J(sheet.grids.Movimientos).filter(r => r[col('origen')] === 'resumen').length, n1, 'reintentar no duplica nada');
    await B.p.click('[data-act=rsclear]').catch(() => {});
  }

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
