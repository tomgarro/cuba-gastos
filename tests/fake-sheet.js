// Sheet simulada en memoria + Code.gs real corriendo en un sandbox. La usan los tests del backend y el e2e de la app.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const CODE = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

function boot(opts) {
  opts = opts || {};
  const log = { sleeps: 0, locks: 0, releases: 0, props: {}, ui: [] };
  const grids = {};
  const lockFails = { v: false };
  const sandbox = {
    console: { error() {}, log() {} },
    Utilities: {
      sleep() { log.sleeps++; },
      getUuid: () => crypto.randomUUID(),
      base64EncodeWebSafe: s => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in log.props ? log.props[k] : null), setProperty: (k, v) => { log.props[k] = v; } }) },
    LockService: { getScriptLock: () => ({
      waitLock() { if (lockFails.v) throw new Error('timeout'); log.locks++; },
      releaseLock() { log.releases++; }
    }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ s, setMimeType() { return this; }, getContent() { return this.s; } }) },
    ScriptApp: { getService: () => ({ getUrl: () => opts.url === undefined ? 'https://script.google.com/macros/s/ABC/dev' : opts.url }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: name => grids[name] ? sheetOf(grids[name]) : null }) }
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(CODE, ctx);
  const TABS = JSON.parse(JSON.stringify(ctx.TABS));
  Object.keys(TABS).forEach(k => { grids[k] = [TABS[k].slice()]; });

  function sheetOf(grid) {
    const lastRow = () => { let l = grid.length; while (l > 0 && grid[l - 1].every(c => c === '' || c == null)) l--; return l; };
    return {
      getLastRow: lastRow,
      getRange(r, c, nr, nc) {
        nr = nr || 1; nc = nc || 1;
        return {
          getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = (grid[r - 1 + i] || [])[c - 1 + j]; row.push(v === undefined ? '' : v); } out.push(row); } return out; },
          setValues(vals) {
            assert.strictEqual(vals.length, nr, 'filas'); vals.forEach(v => assert.strictEqual(v.length, nc, 'columnas'));
            vals.forEach((v, i) => { const gi = r - 1 + i; grid[gi] = grid[gi] || []; v.forEach((x, j) => { grid[gi][c - 1 + j] = x; }); });
          },
          setValue(v) { grid[r - 1] = grid[r - 1] || []; grid[r - 1][c - 1] = v; }
        };
      }
    };
  }
  const call = (action, body, token) => ctx.handle_(Object.assign({ token: token === undefined ? 'TOK' : token, action }, body || {}));
  log.props.CUBA_TOKEN = 'TOK';
  return { ctx, grids, log, call, lockFails, TABS, sandbox };
}

module.exports = { boot };
