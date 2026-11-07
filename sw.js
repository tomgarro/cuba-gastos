/* Service worker de Cuba: guarda la cáscara de la app para abrirla rápido y sin conexión.
   Navegación: red primero (así las actualizaciones llegan), caché como respaldo. */
const CACHE = 'cuba-shell-v1';   // el caché 'cuba-share' (lo compartido) es aparte y la app lo vacía al leerlo
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== 'cuba-share').map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // «Compartir» → Cuba (Android y escritorio): se guarda lo recibido en un caché aparte, que la app lee una vez y borra, y se abre la app.
  if (req.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const fd = await req.formData(), c = await caches.open('cuba-share'), base = self.registration.scope;
        await Promise.all((await c.keys()).map((k) => c.delete(k)));
        const f = fd.get('media'), meta = { title: String(fd.get('title') || '').slice(0, 500), text: String(fd.get('text') || '').slice(0, 4000), url: String(fd.get('url') || '').slice(0, 500), file: null };
        if (f && typeof f === 'object' && f.size && f.size <= 15 * 1024 * 1024) { meta.file = { name: f.name || 'comprobante', type: f.type || '' }; await c.put(base + 'share-file', new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream' } })); }
        await c.put(base + 'share-meta', new Response(JSON.stringify(meta), { headers: { 'content-type': 'application/json' } }));
      } catch (err) { /* si algo falla, la app abre igual vacía */ }
      return Response.redirect(self.registration.scope + '?share=1', 303);
    })());
    return;
  }
  if (req.method !== 'GET') return;
  if (url.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('index.html', copy)).catch(() => {}); return res; })
        .catch(() => caches.match('index.html'))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); return res; }))
  );
});
