// Devuelve la URL de una copia de index.html con FEATURES.personal = true (en la carpeta temporal), para los e2e que prueban Personal.
// Es exactamente el «único cambio» que reactiva la función; el index.html real no se toca.
const fs = require('fs'), os = require('os'), path = require('path');
module.exports = function conPersonal() {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  const on = html.replace('var FEATURES = { personal: false };', 'var FEATURES = { personal: true };');
  if (on === html) throw new Error('No encontré el interruptor FEATURES.personal en index.html');
  const f = path.join(os.tmpdir(), 'cuba-index-personal.html'); fs.writeFileSync(f, on);
  return require('url').pathToFileURL(f).href;
};
