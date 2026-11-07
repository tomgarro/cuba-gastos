// Ninguna clave real en el repo: ni en el código, ni en la app generada, ni en los tests.
const fs = require('fs'), path = require('path'), assert = require('assert');
const raiz = path.resolve(__dirname, '..'), FALSO = 'APP_USR-1234567890123456-111111-abcdef0123456789abcdef0123456789-9999';
function lista(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
    if (['node_modules', '.git', 'test-results'].includes(e.name)) return [];
    const p = path.join(d, e.name);
    return e.isDirectory() ? lista(p) : [p];
  });
}
const patrones = [[/APP_USR-[A-Za-z0-9_\-]{20,}/g, 'token de Mercado Pago'], [/AIza[0-9A-Za-z_\-]{35}/g, 'clave de Google/Gemini'], [/\bTEST-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, 'token de prueba de Mercado Pago']];
let revisados = 0;
lista(raiz).filter(f => /\.(js|html|gs|md|json|py|css|svg|txt|webmanifest)$/.test(f)).forEach(f => {
  const txt = fs.readFileSync(f, 'utf8').split(FALSO).join(''); revisados++;
  patrones.forEach(([re, que]) => { const m = txt.match(re); assert.ok(!m, 'Hay un ' + que + ' en ' + path.relative(raiz, f)); });
});
// la app (celular) nunca conoce el token ni cómo se guarda
['index.html', 'src/app.html'].forEach(f => { const t = fs.readFileSync(path.join(raiz, f), 'utf8'); assert.ok(!/MP_ACCESS_TOKEN|Bearer /.test(t), f + ' no debe tocar el token de Mercado Pago'); });
// el Apps Script solo lee: ningún pedido a Mercado Pago que no sea GET
const gs = fs.readFileSync(path.join(raiz, 'apps-script/Code.gs'), 'utf8');
assert.ok(!/mercadopago[^\n]*method:\s*'(post|put|delete|patch)'/i.test(gs) && (gs.match(/MP\.BASE/g) || []).length === 1, 'un solo punto de salida a Mercado Pago, solo GET');
console.log('ok  secretos: ' + revisados + ' archivos sin claves; la app no conoce el token; Mercado Pago solo en lectura');
