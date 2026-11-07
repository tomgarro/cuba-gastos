// Sirve el repo por HTTP y verifica lo propio de la PWA: manifiesto, íconos, service worker y modo sin conexión.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
(async () => {
  await new Promise(r => srv.listen(0, r));
  const base = 'http://localhost:' + srv.address().port + '/';
  const b = await chromium.launch(); const ctx = await b.newContext(); const p = await ctx.newPage();
  const bad = []; p.on('response', r => { if (r.status() >= 400 && !/fonts\./.test(r.url())) bad.push(r.status() + ' ' + r.url()); });
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto(base);
  await p.waitForSelector('text=Soy Cuba');
  const man = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  for (const i of man.icons) assert.ok(fs.existsSync(path.join(root, i.src)), 'falta ' + i.src);
  assert.ok(await p.evaluate(() => !!document.querySelector('link[rel=manifest]')));
  const sw = await p.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
  assert.ok(sw, 'el service worker no se activó');
  await p.reload(); await p.waitForSelector('text=Soy Cuba');
  await ctx.setOffline(true);
  await p.reload(); await p.waitForSelector('text=Soy Cuba', { timeout: 5000 });
  // «Compartir» → Cuba: el manifiesto lo declara y el service worker guarda lo recibido y abre la app; la app lo lee una vez y lo borra
  assert.ok(man.share_target && man.share_target.method === 'POST' && man.share_target.params.files[0].name === 'media', 'falta share_target');
  await ctx.setOffline(false); await p.reload(); await p.waitForSelector('text=Soy Cuba');
  const sh = await p.evaluate(async () => {
    const fd = new FormData(); fd.append('title', 't'); fd.append('text', 'Compraste $1.500,00 en ZORBA');
    fd.append('media', new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }));
    const res = await fetch('share-target', { method: 'POST', body: fd });
    const c = await caches.open('cuba-share');
    return { redirected: res.redirected, url: res.url, keys: (await c.keys()).map(k => new URL(k.url).pathname.split('/').pop()).sort() };
  });
  assert.ok(/\?share=1$/.test(sh.url), 'redirige a la app: ' + sh.url);
  assert.deepStrictEqual(sh.keys, ['share-file', 'share-meta']);
  await p.goto(base + '?share=1'); await p.waitForSelector('text=Soy Cuba');
  await p.waitForFunction(async () => (await (await caches.open('cuba-share')).keys()).length === 0, null, { timeout: 5000 });
  assert.ok(!/share=1/.test(p.url()), 'se limpia la dirección');
  assert.deepStrictEqual(bad, [], 'respuestas con error: ' + bad.join(', '));
  console.log('PWA OK (manifiesto, íconos, service worker, sin conexión)');
  await b.close(); srv.close();
})().catch(e => { console.error('PWA FAIL:', e.message); process.exit(1); });
