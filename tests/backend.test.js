// Pruebas del backend (apps-script/Code.gs) corriendo el archivo real en un sandbox,
// con una Sheet simulada en memoria (mismo contrato que SpreadsheetApp).
const assert = require('assert');
const vm = require('vm');
const { boot } = require('./fake-sheet.js');

let n = 0;
function t(name, fn) { try { fn(); n++; console.log('ok  ' + name); } catch (e) { console.error('FAIL ' + name + '\n  ' + (e.stack || e.message)); process.exitCode = 1; } }

const P = [{ id: 'm1', nombre: 'Tomi', color: '#c47a35' }, { id: 'm2', nombre: 'Pau', color: '#4f7c6d' }];
function mov(over) {
  return Object.assign({ id: 'e1', tipo: 'gasto', fecha: '2026-11-06', descripcion: 'Super', monto_centavos: 1000, moneda: 'ARS', pagador_id: 'm1',
    reparto_modo: 'igual', reparto: [['m1', 500], ['m2', 500]], categoria: 'super', nota: '', origen: 'manual', creado_por: 'm1' }, over || {});
}
function withPeople() { const b = boot(); b.call('savePersonas', { personas: P }); return b; }
const J = x => JSON.parse(JSON.stringify(x));
function err(fn) { try { fn(); } catch (e) { return e; } assert.fail('tenía que fallar'); }
const col = (b, name) => b.TABS.Movimientos.indexOf(name);

t('sin token configurado no deja pasar nada', () => {
  const b = boot(); delete b.log.props.CUBA_TOKEN;
  assert.strictEqual(err(() => b.call('read')).code, 'sin_token');
});
t('token incorrecto: rechaza y frena la fuerza bruta', () => {
  const b = boot();
  assert.strictEqual(err(() => b.call('read', {}, 'otro')).code, 'no_autorizado');
  assert.strictEqual(err(() => b.call('read', {}, '')).code, 'no_autorizado');
  assert.strictEqual(err(() => b.call('read', {}, 'TOKX')).code, 'no_autorizado');
  assert.ok(b.log.sleeps >= 3);
  assert.strictEqual(b.log.locks, 0, 'ni siquiera toma el lock');
});
t('acción desconocida', () => { assert.strictEqual(err(() => boot().call('borrarTodo')).code, 'accion_desconocida'); });
t('ping y read sobre Sheet vacía', () => {
  const b = boot();
  assert.strictEqual(b.call('ping').ok, true);
  const r = b.call('read');
  assert.deepStrictEqual(J([r.personas, r.movimientos, r.lotes, r.categorias]), [[], [], [], []]);
});
t('usa el lock y lo libera aunque la acción falle', () => {
  const b = boot();
  b.call('read'); err(() => b.call('addMovimientos', { movimientos: [] }));
  assert.strictEqual(b.log.locks, 2); assert.strictEqual(b.log.releases, 2);
});
t('si el lock no se consigue, responde ocupado y no escribe', () => {
  const b = withPeople(); b.lockFails.v = true;
  assert.strictEqual(err(() => b.call('addMovimientos', { movimientos: [mov()] })).code, 'ocupado');
  assert.strictEqual(b.grids.Movimientos.length, 1);
});
t('esquema alterado: avisa en vez de escribir en la columna equivocada', () => {
  const b = withPeople(); b.grids.Movimientos[0][3] = 'detalle';
  const e = err(() => b.call('addMovimientos', { movimientos: [mov()] }));
  assert.strictEqual(e.code, 'esquema'); assert.ok(/descripcion/.test(e.message));
  const b2 = boot(); delete b2.grids.Cierres; // pestañas que el backend no usa todavía no importan
  assert.strictEqual(b2.call('ping').ok, true);
});

t('personas: crea, renombra sin perder fecha de alta y nunca borra', () => {
  const b = boot();
  assert.deepStrictEqual([b.call('savePersonas', { personas: P }).creadas, b.grids.Personas.length], [2, 3]);
  const creada = b.grids.Personas[1][5];
  const r = b.call('savePersonas', { personas: [{ id: 'm1', nombre: 'Tomás', estado: 'archivada' }] });
  assert.deepStrictEqual([r.creadas, r.actualizadas], [0, 1]);
  const row = b.grids.Personas[1];
  assert.deepStrictEqual([row[1], row[3], row[4], row[5]], ['Tomás', '#c47a35', 'archivada', creada]);
  assert.strictEqual(b.grids.Personas.length, 3, 'm2 sigue ahí');
});
t('personas: validaciones', () => {
  const b = boot();
  assert.strictEqual(err(() => b.call('savePersonas', { personas: [{ id: 'a', nombre: 'X', color: 'rojo' }] })).code, 'personas_invalidas');
  assert.strictEqual(err(() => b.call('savePersonas', { personas: [{ id: 'a', nombre: '  ' }] })).code, 'personas_invalidas');
  assert.strictEqual(err(() => b.call('savePersonas', { personas: [{ id: 'a b', nombre: 'X' }] })).code, 'id_invalido');
  assert.strictEqual(err(() => b.call('savePersonas', { personas: [{ id: 'a', nombre: 'X', estado: 'borrada' }] })).code, 'personas_invalidas');
  assert.strictEqual(err(() => b.call('savePersonas', { personas: [{ id: 'a', nombre: 'X' }, { id: 'a', nombre: 'Y' }] })).code, 'personas_invalidas');
  assert.strictEqual(b.grids.Personas.length, 1);
});

t('agrega un movimiento y lo lee de vuelta con tipos correctos', () => {
  const b = withPeople();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(b.call('addMovimientos', { movimientos: [mov()] }))), { ok: true, agregados: 1, omitidos: [], reemplazados: 0 });
  const row = b.grids.Movimientos[1];
  assert.strictEqual(row[col(b, 'monto_centavos')], 1000);
  assert.strictEqual(row[col(b, 'reparto_json')], '[["m1",500],["m2",500]]');
  assert.strictEqual(row[col(b, 'anulado')], 'FALSE'); assert.strictEqual(row[col(b, 'excepcion')], 'FALSE');
  assert.ok(/^\d{4}-\d\d-\d\dT/.test(row[col(b, 'creado_en')]), 'sello del servidor');
  const m = b.call('read').movimientos[0];
  assert.strictEqual(m.monto_centavos, 1000); assert.strictEqual(m.anulado, false); assert.strictEqual(m.confianza, null);
  assert.deepStrictEqual(JSON.parse(m.reparto_json), [['m1', 500], ['m2', 500]]);
});
t('rechaza montos que no son centavos enteros positivos', () => {
  const b = withPeople();
  [12.5, 0, -100, '1000', NaN, Infinity, 1e14, null].forEach(v => {
    const e = err(() => b.call('addMovimientos', { movimientos: [mov({ monto_centavos: v, reparto: [['m1', 1]] })] }));
    assert.strictEqual(e.code, 'movimiento_invalido', String(v));
  });
  assert.strictEqual(err(() => b.call('addMovimientos', { movimientos: [mov({ reparto: [['m1', 500.5], ['m2', 499.5]] })] })).code, 'movimiento_invalido');
  assert.strictEqual(b.grids.Movimientos.length, 1);
});
t('el reparto tiene que sumar exacto y nombrar personas reales', () => {
  const b = withPeople();
  const bads = [
    mov({ reparto: [['m1', 500], ['m2', 499]] }), mov({ reparto: [['m1', 500], ['m3', 500]] }), mov({ reparto: [['m1', 500], ['m1', 500]] }),
    mov({ reparto: [] }), mov({ reparto: undefined }), mov({ pagador_id: 'fantasma' }), mov({ reparto_modo: 'aleatorio' })
  ];
  bads.forEach((m, i) => assert.strictEqual(err(() => b.call('addMovimientos', { movimientos: [m] })).code, 'movimiento_invalido', 'caso ' + i));
  b.call('addMovimientos', { movimientos: [mov({ reparto: [['m1', 1500], ['m2', -500]] })] }); // saldos a favor (import) sí suman
});
t('moneda, tipo y fecha', () => {
  const b = withPeople();
  [mov({ moneda: 'EUR' }), mov({ tipo: 'regalo' }), mov({ fecha: '2026-02-30' }), mov({ fecha: '06/11/2026' }), mov({ fecha: undefined }), mov({ confianza: 2 })]
    .forEach((m, i) => assert.strictEqual(err(() => b.call('addMovimientos', { movimientos: [m] })).code, 'movimiento_invalido', 'caso ' + i));
  b.call('addMovimientos', { movimientos: [mov({ moneda: 'USD', fecha: '2024-02-29', confianza: 0.8, tipo: 'pago' })] });
  assert.strictEqual(b.grids.Movimientos[1][col(b, 'moneda')], 'USD');
});
t('es atómico: si un movimiento del lote es inválido no se escribe ninguno', () => {
  const b = withPeople();
  const e = err(() => b.call('addMovimientos', { movimientos: [mov({ id: 'a' }), mov({ id: 'b', monto_centavos: -1 }), mov({ id: 'c' })] }));
  assert.ok(/#2/.test(e.message));
  assert.strictEqual(b.grids.Movimientos.length, 1);
});
t('reintentar el mismo pedido no duplica (idempotente por id)', () => {
  const b = withPeople();
  b.call('addMovimientos', { movimientos: [mov({ id: 'a' }), mov({ id: 'b' })] });
  const r = b.call('addMovimientos', { movimientos: [mov({ id: 'b' }), mov({ id: 'c' })] });
  assert.deepStrictEqual([r.agregados, JSON.parse(JSON.stringify(r.omitidos)), b.grids.Movimientos.length], [1, ['b'], 4]);
  assert.strictEqual(err(() => b.call('addMovimientos', { movimientos: [mov({ id: 'z' }), mov({ id: 'z' })] })).code, 'movimiento_invalido');
});
t('ids con caracteres raros y topes', () => {
  const b = withPeople();
  ['', 'a b', 'a/b', '=cmd', 'x'.repeat(65), 7].forEach(id => assert.strictEqual(err(() => b.call('addMovimientos', { movimientos: [mov({ id })] })).code, 'id_invalido'));
  const many = Array.from({ length: 501 }, (_, i) => mov({ id: 'x' + i }));
  assert.strictEqual(err(() => b.call('addMovimientos', { movimientos: many })).code, 'movimientos_invalidos');
  const ok = Array.from({ length: 500 }, (_, i) => mov({ id: 'x' + i }));
  assert.strictEqual(b.call('addMovimientos', { movimientos: ok }).agregados, 500);
});
t('textos: se limpian y se cortan, pero se guardan tal cual (la columna es texto)', () => {
  const b = withPeople();
  b.call('addMovimientos', { movimientos: [mov({ descripcion: '=SUMA(A1)\n\tcafé', nota: 'n'.repeat(900), categoria: 'c'.repeat(100) })] });
  const row = b.grids.Movimientos[1];
  assert.strictEqual(row[col(b, 'descripcion')], '=SUMA(A1)  café');
  assert.strictEqual(row[col(b, 'nota')].length, 500); assert.strictEqual(row[col(b, 'categoria')].length, 40);
});

t('anular marca solo la columna anulado, es idempotente e informa los que no existen', () => {
  const b = withPeople();
  b.call('addMovimientos', { movimientos: [mov({ id: 'a' }), mov({ id: 'b' })] });
  const before = JSON.stringify(b.grids.Movimientos);
  const r = b.call('anularMovimientos', { ids: ['a', 'zzz'] });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), { ok: true, anulados: 1, yaAnulados: 0, noEncontrados: ['zzz'] });
  const after = b.grids.Movimientos, ia = col(b, 'anulado');
  assert.strictEqual(after[1][ia], 'TRUE'); assert.strictEqual(after[2][ia], 'FALSE');
  const strip = g => JSON.stringify(g.map(r => r.filter((_, i) => i !== ia)));
  assert.strictEqual(strip(after), strip(JSON.parse(before)), 'nada más cambió');
  assert.deepStrictEqual([b.call('anularMovimientos', { ids: ['a'] }).anulados, b.call('anularMovimientos', { ids: ['a'] }).yaAnulados], [0, 1]);
  assert.strictEqual(b.call('read').movimientos[0].anulado, true);
});
t('editar = agregar el nuevo con reemplaza_id; el viejo se anula en el mismo pedido y el historial queda', () => {
  const b = withPeople();
  b.call('addMovimientos', { movimientos: [mov({ id: 'v1' })] });
  const r = b.call('addMovimientos', { movimientos: [mov({ id: 'v2', monto_centavos: 2000, reparto: [['m1', 1000], ['m2', 1000]], reemplaza_id: 'v1' })] });
  assert.strictEqual(r.reemplazados, 1);
  assert.deepStrictEqual(J(b.call('read').movimientos.map(m => [m.id, m.monto_centavos, m.anulado, m.reemplaza_id])), [['v1', 1000, true, ''], ['v2', 2000, false, 'v1']]);
});
t('editar algo que otro celular ya cambió o borró da conflicto y no escribe nada', () => {
  const b = withPeople();
  b.call('addMovimientos', { movimientos: [mov({ id: 'v1' })] });
  b.call('addMovimientos', { movimientos: [mov({ id: 'v2', reemplaza_id: 'v1' })] }); // el otro celular ya lo editó
  const e = err(() => b.call('addMovimientos', { movimientos: [mov({ id: 'v3', reemplaza_id: 'v1' })] }));
  assert.strictEqual(e.code, 'conflicto');
  assert.strictEqual(b.grids.Movimientos.length, 3);
  assert.strictEqual(err(() => b.call('addMovimientos', { movimientos: [mov({ id: 'v4', reemplaza_id: 'inexistente' })] })).code, 'movimiento_invalido');
  assert.strictEqual(err(() => b.call('addMovimientos', { movimientos: [mov({ id: 'a1' }), mov({ id: 'a2', reemplaza_id: 'v2' }), mov({ id: 'a3', reemplaza_id: 'v2' })] })).code, 'conflicto');
  assert.strictEqual(b.grids.Movimientos.length, 3, 'el pedido es atómico');
});
t('reintentar una edición que sí llegó no duplica ni da conflicto', () => {
  const b = withPeople();
  b.call('addMovimientos', { movimientos: [mov({ id: 'v1' })] });
  const body = { movimientos: [mov({ id: 'v2', reemplaza_id: 'v1' })] };
  b.call('addMovimientos', body);
  const r = b.call('addMovimientos', body);
  assert.deepStrictEqual([r.agregados, J(r.omitidos), b.grids.Movimientos.length], [0, ['v2'], 3]);
});
t('lotes: se crean con el pedido y «Deshacer» anula solo ese lote', () => {
  const b = withPeople();
  b.call('addMovimientos', { movimientos: [mov({ id: 'solo' })] });
  const r = b.call('addMovimientos', {
    lote: { id: 'L1', origen: 'splitwise', archivo: 'grupo.csv', fecha: '2026-11-06', moneda_original: 'ARS' },
    movimientos: [mov({ id: 'i1', lote_id: 'L1', origen: 'splitwise' }), mov({ id: 'i2', lote_id: 'L1', origen: 'splitwise' })]
  });
  assert.strictEqual(r.agregados, 2);
  assert.deepStrictEqual(J(b.grids.Lotes[1].slice(0, 7)), ['L1', 'splitwise', 'grupo.csv', '2026-11-06', 2, 'ARS', 'activo']);
  assert.strictEqual(b.call('undoLote', { lote_id: 'L1' }).anulados, 2);
  const m = b.call('read');
  assert.deepStrictEqual(J(m.movimientos.map(x => [x.id, x.anulado])), [['solo', false], ['i1', true], ['i2', true]]);
  assert.strictEqual(m.lotes[0].estado, 'deshecho');
  assert.strictEqual(b.call('undoLote', { lote_id: 'L1' }).anulados, 0, 'deshacer dos veces no hace nada');
  assert.strictEqual(err(() => b.call('undoLote', { lote_id: 'nope' })).code, 'lote_inexistente');
});
t('un movimiento no puede apuntar a un lote que no existe', () => {
  const b = withPeople();
  assert.strictEqual(err(() => b.call('addMovimientos', { movimientos: [mov({ lote_id: 'fantasma' })] })).code, 'movimiento_invalido');
});
t('reintentar un lote completo no duplica ni rompe el lote', () => {
  const b = withPeople();
  const body = { lote: { id: 'L2', origen: 'splitwise' }, movimientos: [mov({ id: 'q1', lote_id: 'L2' })] };
  b.call('addMovimientos', body); b.call('addMovimientos', body);
  assert.deepStrictEqual([b.grids.Lotes.length, b.grids.Movimientos.length], [2, 2]);
});

t('propiedad: nada de lo ya escrito cambia salvo la columna anulado (500 operaciones al azar)', () => {
  const b = withPeople(); const ia = col(b, 'anulado');
  let seed = 7; const rnd = k => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % k; };
  const ids = []; let snap = [];
  for (let i = 0; i < 500; i++) {
    const op = rnd(4);
    try {
      if (op < 2) { const id = 'r' + i; const monto = 1 + rnd(100000); const a = rnd(monto + 1); b.call('addMovimientos', { movimientos: [mov({ id, monto_centavos: monto, reparto: [['m1', a], ['m2', monto - a]] })] }); ids.push(id); }
      else if (op === 2 && ids.length) b.call('anularMovimientos', { ids: [ids[rnd(ids.length)]] });
      else if (ids.length) b.call('addMovimientos', { movimientos: [mov({ id: ids[rnd(ids.length)] })] });
    } catch (e) { assert.fail(e.message); }
    snap.forEach((row, ri) => row.forEach((v, ci) => { if (ci !== ia) assert.strictEqual(b.grids.Movimientos[ri][ci], v, `fila ${ri} col ${ci} cambió`); else if (v === 'TRUE') assert.strictEqual(b.grids.Movimientos[ri][ci], 'TRUE', 'un anulado no vuelve'); }));
    snap = JSON.parse(JSON.stringify(b.grids.Movimientos));
  }
  const sum = b.call('read').movimientos.every(m => JSON.parse(m.reparto_json).reduce((s, x) => s + x[1], 0) === m.monto_centavos);
  assert.ok(sum, 'todos los repartos suman exacto');
});

t('lectura: fechas que Sheets convirtió solas vuelven a texto, booleanos manuales se entienden', () => {
  const b = withPeople();
  b.call('addMovimientos', { movimientos: [mov({ id: 'a' })] });
  b.grids.Movimientos[1][col(b, 'fecha')] = vm.runInContext('new Date(Date.UTC(2026, 10, 6))', b.ctx);
  b.grids.Movimientos[1][col(b, 'anulado')] = true;
  const m = b.call('read').movimientos[0];
  assert.deepStrictEqual([m.fecha, m.anulado], ['2026-11-06', true]);
});
t('read devuelve config y categorías', () => {
  const b = boot();
  b.grids.Config.push(['moneda_base', 'ARS'], ['schema_version', '1']);
  b.grids.Categorias.push(['super', 'Supermercado', '🛒', '', 'ARS']);
  const r = b.call('read');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.config)), { moneda_base: 'ARS', schema_version: '1' });
  assert.strictEqual(r.categorias[0].emoji, '🛒');
});

t('doPost: JSON roto, error controlado y error interno sin filtrar detalles', () => {
  const b = boot();
  const out = s => JSON.parse(b.ctx.doPost({ postData: { contents: s } }).getContent());
  assert.strictEqual(out('{no json').error, 'json_invalido');
  assert.deepStrictEqual([out(JSON.stringify({ token: 'mal', action: 'read' })).ok, out(JSON.stringify({ token: 'mal', action: 'read' })).error], [false, 'no_autorizado']);
  assert.strictEqual(out(JSON.stringify({ token: 'TOK', action: 'ping' })).ok, true);
  delete b.grids.Personas; // falla inesperada
  const r = out(JSON.stringify({ token: 'TOK', action: 'read' }));
  assert.strictEqual(r.error, 'esquema');
  b.sandbox.SpreadsheetApp.getActiveSpreadsheet = () => { throw new TypeError('secreto interno'); };
  const r2 = out(JSON.stringify({ token: 'TOK', action: 'read' }));
  assert.strictEqual(r2.error, 'interno'); assert.ok(!/secreto/.test(r2.message));
  assert.deepStrictEqual(JSON.parse(b.ctx.doGet().getContent()), { ok: true, app: 'cuba', version: 1 });
});

t('link de emparejado: usa la URL /exec guardada y el token, y se puede decodificar', () => {
  const b = boot(); delete b.log.props.CUBA_TOKEN;
  assert.strictEqual(b.ctx.pairingLink_(), null, 'sin URL guardada no hay link');
  b.log.props.CUBA_URL = 'https://script.google.com/macros/s/AKfy_cb-1/exec';
  const link = b.ctx.pairingLink_();
  assert.ok(link.startsWith('https://tomgarro.github.io/cuba-gastos/#cfg='));
  const cfg = JSON.parse(Buffer.from(link.split('#cfg=')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  assert.strictEqual(cfg.u, 'https://script.google.com/macros/s/AKfy_cb-1/exec');
  assert.strictEqual(cfg.t, b.log.props.CUBA_TOKEN); assert.ok(/^[0-9a-f]{64}$/.test(cfg.t));
  assert.strictEqual(b.ctx.pairingLink_(), link, 'no cambia el token en cada llamada');
});

t('URL de la app web: solo se acepta …/macros/s/<id>/exec (no /dev ni otras)', () => {
  const b = boot();
  ['https://script.google.com/macros/s/ABC/dev', 'http://script.google.com/macros/s/ABC/exec', 'https://evil.com/macros/s/ABC/exec', '', 'https://script.google.com/macros/s/ABC/exec?x=1'].forEach((u) => {
    assert.strictEqual(b.ctx.isExecUrl_(u), false, u);
    b.log.props.CUBA_URL = u; assert.strictEqual(b.ctx.pairingLink_(), null, u);
  });
  assert.strictEqual(b.ctx.isExecUrl_('https://script.google.com/macros/s/ABC_d-1/exec'), true);
});

console.log(n + ' pruebas del backend');
