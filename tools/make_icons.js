// Genera los íconos de la app a partir de la ilustración de Cuba (src/cuba.js).
// Uso: npm run icons   (requiere playwright)
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { cuba } = require('../src/cuba.js');

(async () => {
  const out = path.join(__dirname, '..', 'icons');
  fs.mkdirSync(out, { recursive: true });
  const jobs = [
    ['icon-192.png', 192, 0.78],
    ['icon-512.png', 512, 0.78],
    ['icon-maskable-512.png', 512, 0.6], // zona segura para íconos adaptativos
    ['apple-touch-icon.png', 180, 0.78],
  ];
  const b = await chromium.launch();
  for (const [name, size, scale] of jobs) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    const w = Math.round(size * scale);
    await p.setContent(`<body style="margin:0;background:#f7f1e8;display:grid;place-items:center;height:${size}px;overflow:hidden"><div style="margin-top:${Math.round(size * 0.03)}px">${cuba('happy', w)}</div></body>`);
    await p.addStyleTag({ content: '.cuba svg{animation:none!important}' });
    await p.screenshot({ path: path.join(out, name) });
    await p.close();
  }
  await b.close();
  console.log('íconos generados en', out);
})();
