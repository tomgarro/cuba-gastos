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
  assert.strictEqual(b.log.locks, 1, 'leer no toma candado'); assert.strictEqual(b.log.releases, 1);
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

t('no se crean dos veces las mismas personas (doble toque / reintento con ids nuevos)', () => {
  const b = withPeople();
  const e = err(() => b.call('savePersonas', { personas: [{ id: 'z1', nombre: 'tomi' }, { id: 'z2', nombre: 'Otra' }] }));
  assert.strictEqual(e.code, 'persona_duplicada');
  assert.strictEqual(b.grids.Personas.length, 3, 'no escribió nada (ni siquiera la que no repetía)');
  assert.strictEqual(err(() => boot().call('savePersonas', { personas: [{ id: 'a', nombre: 'Ana' }, { id: 'b', nombre: 'ANA' }] })).code, 'persona_duplicada');
  // archivada libera el nombre; renombrar/actualizar la misma id sigue andando
  b.call('savePersonas', { personas: [{ id: 'm1', nombre: 'Tomi', estado: 'archivada' }] });
  assert.strictEqual(b.call('savePersonas', { personas: [{ id: 'm9', nombre: 'Tomi' }] }).creadas, 1);
  assert.strictEqual(b.call('savePersonas', { personas: [{ id: 'm9', nombre: 'Tomi', color: '#112233' }] }).actualizadas, 1);
});

t('sueldos: solo se agregan, reintento no duplica, valida y se leen con la vigencia por fecha', () => {
  const b = withPeople();
  const sue = (o) => ({ id: 's1', persona_id: 'm1', desde: '2026-01-01', monto_centavos: 150000000, moneda: 'ARS', nota: 'inicial', creado_por: 'm1', ...(o || {}) });
  assert.strictEqual(b.call('saveSueldo', { sueldo: sue() }).creados, 1);
  assert.deepStrictEqual(J(b.call('saveSueldo', { sueldo: sue() }).omitidos), ['s1'], 'reintento: no duplica');
  assert.strictEqual(b.grids.Sueldos.length, 2);
  const antes = J(b.grids.Sueldos[1]);
  b.call('saveSueldo', { sueldo: sue({ id: 's2', desde: '2026-06-01', monto_centavos: 180000000 }) });
  assert.deepStrictEqual(J(b.grids.Sueldos[1]), antes, 'el historial no se toca');
  const r = b.call('read');
  assert.deepStrictEqual(J(r.sueldos.map(x => [x.id, x.persona_id, x.desde, x.monto_centavos, x.moneda])), [['s1', 'm1', '2026-01-01', 150000000, 'ARS'], ['s2', 'm1', '2026-06-01', 180000000, 'ARS']]);
  [{ monto_centavos: 0 }, { monto_centavos: 10.5 }, { monto_centavos: -5 }, { desde: '2026-13-01' }, { desde: '' }, { persona_id: 'nadie' }, { moneda: 'EUR' }, { id: 'a b' }].forEach((o) => {
    assert.ok(err(() => b.call('saveSueldo', { sueldo: sue({ id: 'x' + Math.random().toString(36).slice(2, 8), ...o }) })).code, JSON.stringify(o));
  });
  assert.strictEqual(b.grids.Sueldos.length, 3, 'nada inválido se escribió');
  b.call('savePersonas', { personas: [{ id: 'm2', nombre: 'Pau', estado: 'archivada' }] });
  assert.strictEqual(err(() => b.call('saveSueldo', { sueldo: sue({ id: 's9', persona_id: 'm2' }) })).code, 'sueldo_invalido');
});

t('recurrentes: alta, edición en el lugar (monto y vencimiento) y validaciones', () => {
  const b = withPeople();
  const rec = (o) => ({ id: 'r1', descripcion: 'Aysa', monto_estimado_centavos: 450000, moneda: 'ARS', dia_mes: 10, categoria: 'agua', pagador_id: 'm1', proximo_vencimiento: '2026-11-10', activo: true, ...(o || {}) });
  assert.strictEqual(b.call('saveRecurrente', { recurrente: rec() }).creado, true);
  assert.strictEqual(b.call('saveRecurrente', { recurrente: { id: 'r1', monto_estimado_centavos: 486000, proximo_vencimiento: '2026-12-10' } }).creado, false);
  assert.strictEqual(b.grids.Recurrentes.length, 2, 'editar no crea otra fila');
  const r = b.call('read').recurrentes[0];
  assert.deepStrictEqual(J(r), { id: 'r1', descripcion: 'Aysa', monto_estimado_centavos: 486000, moneda: 'ARS', dia_mes: 10, categoria: 'agua', pagador_id: 'm1', proximo_vencimiento: '2026-12-10', activo: true, ajuste_meses: 0, proximo_ajuste: '' });
  b.call('saveRecurrente', { recurrente: { id: 'r1', activo: false } });
  assert.strictEqual(b.call('read').recurrentes[0].activo, false);
  assert.strictEqual(b.call('read').recurrentes[0].monto_estimado_centavos, 486000, 'pausar no cambia el resto');
  [{ id: 'r2', descripcion: '' }, { id: 'r2', monto_estimado_centavos: 0 }, { id: 'r2', monto_estimado_centavos: 1.5 }, { id: 'r2', dia_mes: 0 }, { id: 'r2', dia_mes: 32 },
   { id: 'r2', moneda: 'EUR' }, { id: 'r2', pagador_id: 'nadie' }, { id: 'r2', proximo_vencimiento: '2026-02-30' }].forEach((o) => {
    assert.strictEqual(err(() => b.call('saveRecurrente', { recurrente: rec(o) })).code, 'recurrente_invalido', JSON.stringify(o));
  });
  assert.strictEqual(b.grids.Recurrentes.length, 2);
});


t('recurrente con ajuste trimestral: se guarda, se valida y una hoja vieja se completa sola', () => {
  const b = withPeople();
  const rec = (o) => ({ id: 'alq', descripcion: 'Alquiler', monto_estimado_centavos: 77000000, moneda: 'ARS', dia_mes: 5, categoria: 'alquiler', pagador_id: 'm1', proximo_vencimiento: '2026-12-05', activo: true, ajuste_meses: 3, proximo_ajuste: '2027-02-01', ...(o || {}) });
  b.call('saveRecurrente', { recurrente: rec() });
  let r = b.call('read').recurrentes[0]; assert.deepStrictEqual([r.ajuste_meses, r.proximo_ajuste], [3, '2027-02-01']);
  b.call('saveRecurrente', { recurrente: { id: 'alq', monto_estimado_centavos: 84700000, proximo_ajuste: '2027-05-01' } });
  r = b.call('read').recurrentes[0]; assert.deepStrictEqual([r.monto_estimado_centavos, r.ajuste_meses, r.proximo_ajuste], [84700000, 3, '2027-05-01']);
  b.call('saveRecurrente', { recurrente: { id: 'alq', ajuste_meses: 0 } });
  r = b.call('read').recurrentes[0]; assert.deepStrictEqual([r.ajuste_meses, r.proximo_ajuste], [0, ''], 'sin ajuste no queda fecha');
  [{ ajuste_meses: 25 }, { ajuste_meses: -1 }, { ajuste_meses: 1.5 }, { ajuste_meses: 3, proximo_ajuste: '' }, { ajuste_meses: 3, proximo_ajuste: '2027-13-01' }].forEach((o) => {
    assert.strictEqual(err(() => b.call('saveRecurrente', { recurrente: rec(Object.assign({ id: 'x' }, o)) })).code, 'recurrente_invalido', JSON.stringify(o));
  });
  // hoja anterior: Recurrentes de 9 columnas con una fila
  const c = boot(); c.call('savePersonas', { personas: P });
  c.grids.Recurrentes.length = 0; c.grids.Recurrentes.push(c.TABS.Recurrentes.slice(0, 9)); c.grids.Recurrentes.push(['r1', 'Aysa', 450000, 'ARS', 10, 'agua', 'm1', '2026-11-10', 'TRUE']);
  const v = c.call('read').recurrentes[0];
  assert.deepStrictEqual([v.descripcion, v.ajuste_meses, v.proximo_ajuste], ['Aysa', 0, '']);
  assert.strictEqual(c.grids.Recurrentes[0][9], 'ajuste_meses');
  assert.strictEqual(c.grids.Recurrentes[1][1], 'Aysa', 'los datos no se tocan');
});

t('leerComprobante: valida la imagen, pide la clave, manda solo la imagen y limpia la respuesta', () => {
  const b = withPeople();
  const img = Buffer.alloc(300, 7).toString('base64');
  assert.strictEqual(b.call('leerComprobante', { imagen: img, mime: 'image/jpeg' }).sin_clave, true, 'sin clave de Gemini no llama a nadie');
  b.log.props.GEMINI_API_KEY = 'K'.repeat(30);
  [{ imagen: 'x', mime: 'image/jpeg' }, { imagen: img + '!!', mime: 'image/jpeg' }, { imagen: img, mime: 'application/pdf' }, { imagen: 'A'.repeat(2600000), mime: 'image/png' }, {}].forEach((o) => {
    assert.strictEqual(err(() => b.call('leerComprobante', o)).code, 'pedido_invalido', JSON.stringify(o).slice(0, 60));
  });
  const sent = [];
  const gem = (obj) => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) });
  b.ctx.UrlFetchApp = { fetch: (u, o) => { sent.push({ u, o, p: JSON.parse(o.payload) }); return gem({ comercio: '  ZORBA\u0000 MARKET ', monto: 15230.5, moneda: 'ARS', fecha: '2026-11-05', confianza: 0.93 }); } };
  const r = b.call('leerComprobante', { imagen: img, mime: 'image/png', creado_por: 'm1' });
  assert.deepStrictEqual(J(r), { ok: true, comercio: 'ZORBA MARKET', monto_centavos: 1523050, moneda: 'ARS', fecha: '2026-11-05', confianza: 0.93 });
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].o.headers['x-goog-api-key'], 'K'.repeat(30), 'la clave va en el encabezado, no en la URL');
  assert.ok(!sent[0].u.includes('KKKK'));
  const partes = sent[0].p.contents[0].parts; assert.strictEqual(partes.length, 2);
  assert.strictEqual(partes[1].inlineData.mimeType, 'image/png');
  assert.ok(!/m1|Tomi|Pau|sueldo/i.test(JSON.stringify(partes[0])), 'el texto no lleva nombres ni sueldos');
  // respuestas raras se limpian: monto negativo/absurdo → 0, fecha inválida → vacía, moneda desconocida → ARS
  b.ctx.UrlFetchApp = { fetch: () => gem({ comercio: 'X', monto: -5, moneda: 'EUR', fecha: '2026-02-30', confianza: 7 }) };
  assert.deepStrictEqual(J(b.call('leerComprobante', { imagen: img, mime: 'image/jpeg' })), { ok: true, comercio: 'X', monto_centavos: 0, moneda: 'ARS', fecha: '', confianza: 1 });
  b.ctx.UrlFetchApp = { fetch: () => ({ getResponseCode: () => 500 }) };
  assert.strictEqual(b.call('leerComprobante', { imagen: img, mime: 'image/jpeg' }).error, 'gemini_http_500');
  b.ctx.UrlFetchApp = { fetch: () => { throw new Error('boom KKKK'); } };
  assert.strictEqual(b.call('leerComprobante', { imagen: img, mime: 'image/jpeg' }).error, 'gemini_respuesta', 'no filtra el detalle del error');
  // no frena a las cargas ni mueve el contador de cambios
  const rev = b.call('read').rev; b.ctx.UrlFetchApp = { fetch: () => gem({ comercio: 'X', monto: 1, moneda: 'ARS', fecha: '', confianza: 1 }) }; b.call('leerComprobante', { imagen: img, mime: 'image/jpeg' });
  assert.strictEqual(b.call('read').rev, rev);
});


t('entenderPregunta: solo manda el texto de la pregunta, valida lo que vuelve y no frena a nadie', () => {
  const b = withPeople();
  assert.strictEqual(b.call('entenderPregunta', { pregunta: 'cuánto gastamos en luz', hoy: '2026-11-12' }).sin_clave, true);
  b.log.props.GEMINI_API_KEY = 'K'.repeat(30);
  ['', 'x', 'a'.repeat(161), 5].forEach((p) => assert.strictEqual(err(() => b.call('entenderPregunta', { pregunta: p })).code, 'pedido_invalido'));
  const sent = [];
  const gem = (obj) => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) });
  b.ctx.UrlFetchApp = { fetch: (u, o) => { sent.push(JSON.parse(o.payload)); return gem({ tipo: 'total', categoria: 'luz', mes: '2026-10' }); } };
  assert.deepStrictEqual(J(b.call('entenderPregunta', { pregunta: 'cuánto salió la luz en octubre', hoy: '2026-11-12' })), { ok: true, tipo: 'total', categoria: 'luz', mes: '2026-10' });
  assert.ok(!/m1|Tomi|Pau|sueldo/i.test(JSON.stringify(sent[0])) && /cuánto salió la luz/.test(sent[0].contents[0].parts[0].text));
  b.ctx.UrlFetchApp = { fetch: () => gem({ tipo: 'borrar todo', categoria: 'inventada', mes: '2026-13' }) };
  assert.deepStrictEqual(J(b.call('entenderPregunta', { pregunta: 'borrá todo por favor' })), { ok: true, tipo: 'ninguno', categoria: '', mes: '' });
  b.ctx.UrlFetchApp = { fetch: () => ({ getResponseCode: () => 500 }) };
  assert.strictEqual(b.call('entenderPregunta', { pregunta: 'cuánto gastamos' }).error, 'gemini_http_500');
  b.ctx.UrlFetchApp = { fetch: () => { throw new Error('boom KKKK'); } };
  assert.strictEqual(b.call('entenderPregunta', { pregunta: 'cuánto gastamos' }).error, 'gemini_respuesta');
  const rev = b.call('read').rev; b.call('entenderPregunta', { pregunta: 'cuánto gastamos' });
  assert.strictEqual(b.call('read').rev, rev);
});

t('eventos: alta, edición en el lugar, validaciones y gastos con evento_id', () => {
  const b = withPeople();
  const ev = (o) => ({ id: 'ev1', nombre: 'Bariloche', moneda: 'ARS', desde: '2026-12-10', hasta: '2026-12-17', estado: 'abierto', creado_por: 'm1', ...(o || {}) });
  assert.strictEqual(b.call('saveEvento', { evento: ev() }).creado, true);
  assert.strictEqual(b.call('saveEvento', { evento: { id: 'ev1', nombre: 'Bariloche 2026' } }).creado, false);
  assert.strictEqual(b.grids.Eventos.length, 2, 'editar no crea otra fila');
  assert.deepStrictEqual(J(b.call('read').eventos), [{ id: 'ev1', nombre: 'Bariloche 2026', moneda: 'ARS', desde: '2026-12-10', hasta: '2026-12-17', estado: 'abierto', creado_por: 'm1' }]);
  b.call('saveEvento', { evento: { id: 'ev1', estado: 'cerrado' } });
  assert.strictEqual(b.call('read').eventos[0].estado, 'cerrado');
  assert.strictEqual(b.call('read').eventos[0].nombre, 'Bariloche 2026', 'cerrar no cambia el resto');
  [{ nombre: '' }, { moneda: 'EUR' }, { desde: '2026-02-30' }, { hasta: 'mañana' }, { estado: 'borrado' }, { id: 'a b' }].forEach((o) => {
    assert.ok(/^(evento_invalido|id_invalido)$/.test(err(() => b.call('saveEvento', { evento: ev(Object.assign({ id: 'ev2' }, o)) })).code), JSON.stringify(o));
  });
  assert.strictEqual(b.grids.Eventos.length, 2);
  // un gasto del evento: se guarda con evento_id; uno de un evento inexistente se rechaza
  b.call('addMovimientos', { movimientos: [mov({ id: 'g1', evento_id: 'ev1' })] });
  assert.strictEqual(b.call('read').movimientos[0].evento_id, 'ev1');
  assert.strictEqual(err(() => b.call('addMovimientos', { movimientos: [mov({ id: 'g2', evento_id: 'nope' })] })).code, 'movimiento_invalido');
  assert.strictEqual(b.call('read').movimientos.length, 1);
  // con gastos cargados no se cambia la moneda
  assert.strictEqual(err(() => b.call('saveEvento', { evento: { id: 'ev1', moneda: 'USD' } })).code, 'evento_invalido');
  // el resto de los gastos no tiene evento
  b.call('addMovimientos', { movimientos: [mov({ id: 'g3' })] });
  assert.strictEqual(b.call('read').movimientos.filter(m => m.evento_id === '').length, 1);
});

t('hojas de versiones anteriores: se agrega evento_id al encabezado sin tocar los datos y se crea la pestaña Eventos', () => {
  const b = boot({ lazyTabs: true });
  b.call('savePersonas', { personas: P });
  // simulo una Sheet vieja: Movimientos de 20 columnas con una fila, sin la pestaña Eventos
  b.grids.Movimientos.length = 0;
  b.grids.Movimientos.push(b.TABS.Movimientos.slice(0, 20));
  const vieja = b.TABS.Movimientos.slice(0, 20).map(c => ({ id: 'v1', tipo: 'gasto', fecha: '2026-10-01', descripcion: 'Viejo', monto_centavos: 500, moneda: 'ARS', pagador_id: 'm1', reparto_modo: 'igual', reparto_json: '[["m1",250],["m2",250]]', anulado: 'FALSE' }[c] ?? ''));
  b.grids.Movimientos.push(vieja);
  delete b.grids.Eventos;
  const r = b.call('read');
  assert.strictEqual(r.movimientos.length, 1);
  assert.strictEqual(r.movimientos[0].descripcion, 'Viejo');
  assert.strictEqual(r.movimientos[0].evento_id, '');
  assert.strictEqual(b.grids.Movimientos[0][20], 'evento_id');
  assert.deepStrictEqual(b.grids.Movimientos[1].slice(0, 5), vieja.slice(0, 5), 'los datos quedan igual');
  assert.ok(b.grids.Eventos, 'se creó la pestaña');
  // y se puede seguir escribiendo
  b.call('addMovimientos', { movimientos: [mov({ id: 'n1' })] });
  assert.strictEqual(b.call('read').movimientos.length, 2);
  // una hoja con otro encabezado en esa columna NO se pisa
  const c = boot(); c.call('savePersonas', { personas: P }); c.grids.Movimientos[0][20] = 'otra_cosa';
  assert.strictEqual(err(() => c.call('read')).code, 'esquema');
});

t('pagos que saldan un gasto: salda_id se guarda y se lee; hojas de 20 y de 21 columnas se completan solas', () => {
  const b = boot(); b.call('savePersonas', { personas: P });
  b.call('addMovimientos', { movimientos: [mov({ id: 'g1' }), mov({ id: 'p1', tipo: 'pago', salda_id: 'g1', nota: 'Por la cena' })] });
  const r = b.call('read').movimientos;
  assert.strictEqual(r.filter(m => m.id === 'p1')[0].salda_id, 'g1'); assert.strictEqual(r.filter(m => m.id === 'g1')[0].salda_id, '');
  assert.strictEqual(err(() => b.call('addMovimientos', { movimientos: [mov({ id: 'p2', tipo: 'pago', salda_id: 'no valido!' })] })).code, 'id_invalido');
  [20, 21].forEach(ancho => {
    const c = boot({ lazyTabs: true }); c.call('savePersonas', { personas: P });
    c.grids.Movimientos.length = 0; c.grids.Movimientos.push(c.TABS.Movimientos.slice(0, ancho));
    c.grids.Movimientos.push(c.TABS.Movimientos.slice(0, ancho).map(k => ({ id: 'v1', tipo: 'gasto', fecha: '2026-10-01', descripcion: 'Viejo', monto_centavos: 500, moneda: 'ARS', pagador_id: 'm1', reparto_modo: 'igual', reparto_json: '[[\"m1\",250],[\"m2\",250]]', excepcion: false, anulado: false }[k] ?? '')));
    const rr = c.call('read').movimientos;
    assert.strictEqual(rr.length, 1); assert.strictEqual(rr[0].salda_id, '');
    assert.strictEqual(c.grids.Movimientos[0][21], 'salda_id'); assert.strictEqual(c.grids.Movimientos[0].length, 22);
    c.call('addMovimientos', { movimientos: [mov({ id: 'n1', tipo: 'pago', salda_id: 'v1' })] });
    assert.strictEqual(c.call('read').movimientos.filter(m => m.id === 'n1')[0].salda_id, 'v1');
  });
});

t('avisos: vence pronto / hoy / vencido, una sola vez por etapa, sin montos al celu y reintenta si no salió', () => {
  const b = boot(); b.call('savePersonas', { personas: P });
  const rec = (id, d, ven, over) => Object.assign({ id, descripcion: d, monto_estimado_centavos: 1234500, moneda: 'ARS', dia_mes: 10, categoria: 'luz', pagador_id: 'm1', proximo_vencimiento: ven, activo: true }, over || {});
  ['r1|Luz|2026-11-08', 'r2|Agua|2026-11-06', 'r3|Gas|2026-11-03', 'r4|Lejos|2026-12-20'].forEach(x => { const [id, d, v] = x.split('|'); b.call('saveRecurrente', { recurrente: rec(id, d, v) }); });
  b.call('saveRecurrente', { recurrente: rec('r5', 'Pausado', '2026-11-06', { activo: false }) });
  const sent = { mails: [], push: [] };
  b.ctx.MailApp = { sendEmail: (to, subj, body) => sent.mails.push({ to, subj, body }) };
  let code = 200;
  b.ctx.UrlFetchApp = { fetch: (u, o) => { sent.push.push({ u, o: JSON.parse(o.payload) }); return { getResponseCode: () => code }; } };
  b.log.props.CUBA_NTFY_TOPICS = JSON.stringify({ m1: 'cuba-tomi', m2: 'cuba-pau' }); b.log.props.CUBA_MAILS = 'a@x.com, b@x.com';
  const run = day => vm.runInContext('avisarVencimientos("' + day + '")', b.ctx);
  const r = run('2026-11-06');
  assert.strictEqual(r.avisos, 3, 'gas vencido, agua hoy, luz pronto; ni el lejano ni el pausado');
  assert.ok(r.push && r.mail);
  assert.deepStrictEqual(sent.push.map(x => x.o.topic).sort(), ['cuba-pau', 'cuba-tomi'], 'cada uno en su tema');
  const m = sent.push[0].o;
  assert.ok(/Gas venció hace 3 días/.test(m.message) && /Agua vence hoy/.test(m.message) && /Luz vence en 2 días/.test(m.message));
  assert.ok(!/\d{3}/.test(m.message.replace(/\s/g, '')) && !/\$/.test(m.message), 'al celu no van montos');
  assert.ok(sent.mails[0].to === 'a@x.com,b@x.com' && /12\.345,00/.test(sent.mails[0].body), 'el mail sí lleva monto aprox.');
  assert.strictEqual(run('2026-11-06').avisos, 0, 'no repite el mismo día');
  assert.strictEqual(run('2026-11-07').avisos, 1, 'agua pasó de «hoy» a vencida: aviso nuevo; el resto no insiste');
  assert.strictEqual(run('2026-11-08').avisos, 1, 'luz pasa a «hoy»: aviso nuevo');
});
t('avisos: si ningún canal sale, no se da por avisado y reintenta', () => {
  const b = boot(); b.call('savePersonas', { personas: P });
  b.call('saveRecurrente', { recurrente: { id: 'r1', descripcion: 'Luz', monto_estimado_centavos: 100, moneda: 'ARS', dia_mes: 6, categoria: 'luz', pagador_id: 'm1', proximo_vencimiento: '2026-11-06', activo: true } });
  b.ctx.MailApp = { sendEmail() { throw new Error('cuota'); } };
  b.ctx.UrlFetchApp = { fetch: () => ({ getResponseCode: () => 500 }) };
  b.log.props.CUBA_NTFY_TOPICS = JSON.stringify({ m1: 'cuba-x' }); b.log.props.CUBA_MAILS = 'a@x.com';
  const r = vm.runInContext('avisarVencimientos("2026-11-06")', b.ctx);
  assert.strictEqual(r.avisos, 1); assert.ok(!r.push && !r.mail && r.errores.length === 2);
  b.ctx.MailApp = { sendEmail() {} };
  assert.strictEqual(vm.runInContext('avisarVencimientos("2026-11-06")', b.ctx).mail, true, 'reintenta y sale');
  assert.strictEqual(vm.runInContext('avisarVencimientos("2026-11-06")', b.ctx).avisos, 0);
});

t('aviso al otro al anotar un gasto: sin monto, no a uno mismo, no en importaciones ni ediciones, y nunca rompe la carga', () => {
  const b = withPeople(); const push = [];
  b.ctx.UrlFetchApp = { fetch: (u, o) => { push.push(JSON.parse(o.payload)); return { getResponseCode: () => 200 }; } };
  b.log.props.CUBA_NTFY_TOPICS = JSON.stringify({ m1: 'cuba-tomi', m2: 'cuba-pau' });
  b.call('addMovimientos', { movimientos: [mov({ id: 'a1', descripcion: 'Super Coto', monto_centavos: 123456, reparto: [['m1', 61728], ['m2', 61728]] })] });
  assert.strictEqual(push.length, 1); assert.strictEqual(push[0].topic, 'cuba-pau', 'le llega a Pau, no a quien cargó');
  assert.ok(/Tomi anotó Super Coto/.test(push[0].message) && !/\d{3}/.test(push[0].message), 'sin montos');
  b.call('addMovimientos', { movimientos: [mov({ id: 'a2', reemplaza_id: 'a1', descripcion: 'Super Coto' })] });
  assert.strictEqual(push.length, 1, 'editar no avisa');
  const muchos = [1, 2, 3, 4].map(i => mov({ id: 'z' + i }));
  b.call('addMovimientos', { movimientos: muchos });
  assert.strictEqual(push.length, 1, 'más de 3 de golpe (importación) no avisa');
  b.call('addMovimientos', { movimientos: [mov({ id: 'l1' })], lote: { id: 'lt1', origen: 'splitwise', archivo: 'x.csv', fecha: '2026-11-06', moneda_original: 'ARS' } });
  assert.strictEqual(push.length, 1, 'lotes no avisan');
  b.ctx.UrlFetchApp = { fetch() { throw new Error('sin red'); } };
  assert.strictEqual(b.call('addMovimientos', { movimientos: [mov({ id: 'a9' })] }).agregados, 1, 'si el aviso falla, el gasto se guarda igual');
  b.log.props.CUBA_NTFY_TOPICS = '';
  assert.strictEqual(b.call('addMovimientos', { movimientos: [mov({ id: 'a10' })] }).agregados, 1, 'sin avisos activados no hace nada');
});

function fakeGemini(b, answers, opts) {
  opts = opts || {}; const calls = [];
  b.ctx.UrlFetchApp = { fetch: (u, o) => {
    calls.push({ u, o, body: JSON.parse(o.payload) });
    if (opts.code && opts.code !== 200) return { getResponseCode: () => opts.code, getContentText: () => 'x' };
    const prompt = JSON.parse(o.payload).contents[0].parts[0].text;
    const items = prompt.split('\n').filter(l => /^\d+ \| /.test(l)).map(l => { const [n, d] = l.split(' | '); return { n: +n, d }; });
    const out = items.map(i => Object.assign({ n: i.n }, answers(i.d)));
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }) };
  } };
  return calls;
}

t('categorías: memoria primero, Gemini solo para lo desconocido, una consulta por comercio y sin datos sensibles', () => {
  const b = boot(); b.call('savePersonas', { personas: P });
  b.log.props.GEMINI_API_KEY = 'KEY-secreta-1234567890abcd';
  b.grids.Comercios.push(['don pepe', 'Don Pepe', 'super', 3, '2026-01-01']);
  const locks0 = b.log.locks;
  const calls = fakeGemini(b, d => /Netflix/i.test(d) ? { categoria: 'streaming', confianza: 0.97 } : { categoria: 'casa', confianza: 0.4 });
  const r = b.call('categorizar', { items: [
    { descripcion: 'DON PEPE Marzo', monto_centavos: 500000, moneda: 'ARS' },      // memoria (ignora mes/mayúsculas)
    { descripcion: 'Netflix | Abril', monto_centavos: 1200000, moneda: 'ARS' },
    { descripcion: 'Netflix | Mayo', monto_centavos: 1300000, moneda: 'ARS' },       // mismo comercio: una sola consulta
    { descripcion: 'Cosa rara 7', monto_centavos: 99900, moneda: 'ARS' }] });
  const by = Object.fromEntries(r.resultados.map(x => [x.descripcion, x]));
  assert.deepStrictEqual([by['DON PEPE Marzo'].categoria, by['DON PEPE Marzo'].fuente, by['DON PEPE Marzo'].confianza], ['super', 'memoria', 1]);
  assert.deepStrictEqual([by['Netflix | Abril'].categoria, by['Netflix | Mayo'].categoria, by['Netflix | Mayo'].fuente], ['streaming', 'streaming', 'gemini']);
  assert.ok(by['Cosa rara 7'].confianza < 0.5);
  assert.strictEqual(calls.length, 1);
  const sent = calls[0].body.contents[0].parts[0].text;
  assert.ok(!/DON PEPE/i.test(sent), 'lo que ya sabe la memoria no viaja');
  assert.strictEqual(sent.split('\n').filter(l => /^\d+ \| Netflix/.test(l)).length, 1, 'un comercio, una línea');
  assert.ok(!/Tomi|Pau|sueldo/i.test(sent), 'nada de nombres ni sueldos');
  assert.ok(!JSON.stringify(r).includes('KEY-secreta'), 'la clave nunca vuelve al celu');
  assert.strictEqual(calls[0].o.headers['x-goog-api-key'], 'KEY-secreta-1234567890abcd');
  assert.ok(!/key=/.test(calls[0].u), 'la clave va en el header, no en la URL');
  assert.strictEqual(b.log.locks, locks0, 'categorizar no toma el candado');
});

t('categorías: sin clave o con Gemini caído igual devuelve la memoria y avisa', () => {
  const b = boot(); b.grids.Comercios.push(['coto', 'Coto', 'super', 1, '']);
  const items = [{ descripcion: 'Coto', monto_centavos: 1 }, { descripcion: 'Desconocido', monto_centavos: 1 }];
  let r = b.call('categorizar', { items });
  assert.strictEqual(r.sin_clave, true); assert.strictEqual(r.resultados[0].categoria, 'super'); assert.strictEqual(r.resultados[1].fuente, 'ninguna');
  b.log.props.GEMINI_API_KEY = 'K'.repeat(30); fakeGemini(b, () => ({}), { code: 403 });
  r = b.call('categorizar', { items });
  assert.ok(/gemini_http_403/.test(r.error) && r.resultados[0].categoria === 'super' && !JSON.stringify(r).includes('KKKK'));
  assert.throws(() => b.call('categorizar', { items: [] }), /items/);
});

t('categorías: respuestas inventadas de Gemini se descartan', () => {
  const b = boot(); b.log.props.GEMINI_API_KEY = 'K'.repeat(30);
  fakeGemini(b, () => ({ categoria: 'criptomonedas', confianza: 9 }));
  const r = b.call('categorizar', { items: [{ descripcion: 'Algo', monto_centavos: 1 }] });
  assert.strictEqual(r.resultados[0].categoria, 'otros'); assert.strictEqual(r.resultados[0].fuente, 'ninguna');
});

t('categorías: etiquetar agrega sin tocar movimientos, es idempotente y una corrección manual se vuelve regla', () => {
  const b = withPeople();
  b.call('addMovimientos', { movimientos: [mov({ id: 'a1', descripcion: 'Lo de Don Pepe 12' }), mov({ id: 'a2', descripcion: 'Lo de Don Pepe 13' })] });
  const antes = JSON.stringify(b.grids.Movimientos);
  const et = [{ id: 'e1', movimiento_id: 'a1', categoria: 'super', confianza: 1, fuente: 'manual', estado: 'aplicada' },
    { id: 'e2', movimiento_id: 'a2', categoria: 'casa', confianza: 0.6, fuente: 'gemini', estado: 'dudosa' },
    { id: 'e3', movimiento_id: 'NOEXISTE', categoria: 'super' }, { id: 'e4', movimiento_id: 'a1', categoria: 'bitcoin' }];
  let r = b.call('etiquetar', { etiquetas: et, creado_por: 'm1' });
  assert.strictEqual(r.agregadas, 2); assert.strictEqual(r.omitidas, 2);
  assert.strictEqual(JSON.stringify(b.grids.Movimientos), antes, 'los movimientos no se tocan');
  assert.strictEqual(b.call('etiquetar', { etiquetas: et }).agregadas, 0, 'idempotente');
  const rd = b.call('read'); assert.strictEqual(rd.etiquetas.length, 2); assert.strictEqual(rd.etiquetas[1].estado, 'dudosa');
  assert.strictEqual(b.grids.Comercios.length, 2, 'la corrección manual quedó como regla de comercio');
  const regla = b.grids.Comercios[1]; assert.strictEqual(regla[0], 'lo don pepe'); assert.strictEqual(regla[2], 'super');
  // la próxima vez que aparezca ese comercio, lo reconoce sin Gemini
  assert.strictEqual(b.call('categorizar', { items: [{ descripcion: 'Lo de Don Pepe 99', monto_centavos: 1 }] }).resultados[0].fuente, 'memoria');
  b.call('aprender', { descripcion: 'Lo de Don Pepe', categoria: 'comida' });
  assert.strictEqual(b.grids.Comercios.length, 2); assert.strictEqual(b.grids.Comercios[1][2], 'comida'); assert.strictEqual(b.grids.Comercios[1][3], 2, 'cuenta las veces');
});

t('resumen mensual: totales por moneda, etiquetas pisan categoría, sin anulados ni pagos, sin saldos ni sueldos', () => {
  const b = withPeople();
  const mk = (id, f, d, c, cat, o) => Object.assign(mov({ id, fecha: f, descripcion: d, monto_centavos: c, categoria: cat, reparto: [['m1', Math.ceil(c / 2)], ['m2', Math.floor(c / 2)]] }), o || {});
  b.call('addMovimientos', { movimientos: [mk('r1', '2026-10-03', 'ALQUILER | SEPTIEMBRE', 70000000, 'alquiler'), mk('r2', '2026-10-05', 'LUZ | SEPTIEMBRE', 12500000, 'luz'), mk('r3', '2026-10-20', 'Cosa rara', 3000000, 'otros'),
    mk('r4', '2026-09-10', 'LUZ | AGOSTO', 10000000, 'luz'), mk('r5', '2026-10-21', 'Netflix', 500000, 'otros', { moneda: 'USD' }), mk('r6', '2026-10-22', 'Pago', 9999999, 'pago', { tipo: 'pago', reparto: [['m2', 9999999]] })] });
  b.call('anularMovimientos', { ids: ['r3'] });
  b.call('etiquetar', { etiquetas: [{ id: 'e1', movimiento_id: 'r5', categoria: 'streaming', confianza: 1, fuente: 'manual', estado: 'aplicada' }] });
  const d = b.ctx.datosResumen_(JSON.parse(JSON.stringify(b.call('read').movimientos)), JSON.parse(JSON.stringify(b.call('read').etiquetas)), [{ id: 'luz', nombre: 'Luz', emoji: '💡' }, { id: 'streaming', nombre: 'Streaming', emoji: '📺' }, { id: 'alquiler', nombre: 'Alquiler', emoji: '🔑' }], '2026-10');
  const ars = d.monedas.find(x => x.moneda === 'ARS'), usd = d.monedas.find(x => x.moneda === 'USD');
  assert.strictEqual(ars.total, 82500000, 'sin el anulado ni el pago'); assert.strictEqual(ars.prev, 10000000); assert.strictEqual(ars.variacion, 725);
  assert.strictEqual(ars.lista[0].id, 'alquiler'); assert.strictEqual(usd.lista[0].id, 'streaming', 'la etiqueta pisa la categoría');
  const html = b.ctx.htmlResumen_(d, true);
  assert.ok(/Resumen de octubre 2026/.test(html) && /\$825\.000/.test(html) && /US\$ 5\.000/.test(html) && /Tip de Cuba/.test(html) && /<img[^>]+mail_feliz\.png/.test(html));
  assert.ok(!/sueldo.*\d|debe a/i.test(html.replace('Este resumen no incluye sueldos ni saldos. Los saldos están en el cierre de mes de la app.', '')), 'sin saldos ni sueldos');
  require('fs').writeFileSync('/tmp/resumen.html', html);
  const sent = []; b.ctx.MailApp = { sendEmail: o => sent.push(o) };
  b.log.props.CUBA_MAILS = 'a@x.com,b@x.com';
  const r = b.ctx.resumenMensual('2026-11');
  assert.ok(r.enviado && sent.length === 1 && sent[0].to === 'a@x.com,b@x.com' && /resumen de/.test(sent[0].subject) && sent[0].htmlBody && sent[0].name === 'Cuba 🐕');
});

t('resúmenes de tarjeta: registrar es idempotente, las reglas se comparten y avisa si falta subir uno', () => {
  const b = withPeople();
  const base = { tarjeta: 'VISA', persona_id: 'm1', cierre: '2026-10-29', vencimiento: '2026-11-11', proximo_cierre: '2026-11-26', consumos: 30, compartidos: 6, creado_por: 'm1' };
  assert.ok(b.call('registrarResumen', base).ok);
  assert.ok(b.call('registrarResumen', base).duplicado, 'subir dos veces el mismo no lo repite');
  err(() => b.call('registrarResumen', Object.assign({}, base, { cierre: 'x' })));
  const r = b.call('aprenderResumen', { reglas: [{ descripcion: 'COTO Octubre', comparte: 'si', categoria: 'super' }, { descripcion: 'EMOVA SUBTE', comparte: 'no' }, { descripcion: 'x', comparte: 'tal vez' }] });
  assert.strictEqual(r.nuevas, 2);
  const r2 = b.call('aprenderResumen', { reglas: [{ descripcion: 'coto marzo', comparte: 'no' }] });
  assert.strictEqual(r2.actualizadas, 1, 'cambiar de opinión actualiza, no duplica');
  const rd = b.call('read');
  assert.strictEqual(JSON.stringify(rd.reglas_resumen.map(x => [x.patron, x.comparte]).sort()), JSON.stringify([['coto', 'no'], ['emova subte', 'no']]));
  assert.strictEqual(rd.resumenes.length, 1);
  assert.ok(rd.comercios === undefined && b.ctx.patron_('COTO Octubre') === 'coto');
  // avisos: sin gracia no avisa; pasada la gracia avisa una sola vez
  const sent = []; b.ctx.UrlFetchApp = { fetch: (u, o) => { sent.push(JSON.parse(o.payload)); return { getResponseCode: () => 200 }; } };
  b.log.props.CUBA_NTFY_TOPICS = JSON.stringify({ m1: 'cuba-t1', m2: 'cuba-t2' });
  assert.strictEqual(b.ctx.avisarResumenes_('2026-11-27'), 0, '2 días de gracia');
  assert.strictEqual(b.ctx.avisarResumenes_('2026-11-29'), 1);
  assert.strictEqual(sent.length, 1); assert.strictEqual(sent[0].topic, 'cuba-t1', 'solo a quien sube el resumen');
  assert.ok(/VISA/.test(sent[0].message) && !/\d{2}\.\d{3}/.test(sent[0].message), 'sin montos');
  assert.strictEqual(b.ctx.avisarResumenes_('2026-12-02'), 0, 'una vez por cierre');
  b.call('registrarResumen', Object.assign({}, base, { cierre: '2026-11-26', proximo_cierre: '2026-12-29' }));
  assert.strictEqual(b.ctx.avisarResumenes_('2026-12-20'), 0, 'subido el siguiente, no avisa');
});
console.log(n + ' pruebas del backend');

t('pestañas nuevas (ReglasResumen, Resumenes…) se crean solas aunque Google las traiga con 1000 filas', () => {
  const b = boot({ lazyTabs: true }); b.call('savePersonas', { personas: P });
  assert.strictEqual(b.call('aprenderResumen', { reglas: [{ descripcion: 'COTO', comparte: 'si', categoria: 'super' }] }).nuevas, 1);
  assert.strictEqual(b.call('registrarResumen', { tarjeta: 'VISA', persona_id: 'm1', cierre: '2026-10-29', proximo_cierre: '2026-11-26', consumos: 3, compartidos: 1, creado_por: 'm1' }).ok, true);
  assert.deepStrictEqual(J(b.grids.ReglasResumen[0]), J(b.TABS.ReglasResumen)); assert.strictEqual(b.grids.Resumenes.length, 2);
});

t('aprenderResumen: el mismo comercio dos veces en un resumen (COTO sep + oct) no rompe y cuenta las dos', () => {
  const b = boot(); b.call('savePersonas', { personas: P });
  const r = b.call('aprenderResumen', { reglas: [
    { descripcion: 'COTO', comparte: 'si', categoria: 'super' }, { descripcion: 'LUZ', comparte: 'si', categoria: 'luz' },
    { descripcion: 'COTO', comparte: 'no', categoria: '' }, { descripcion: 'SUBTE', comparte: 'no', categoria: '' }] });
  assert.strictEqual(r.ok, true);
  const rows = J(b.grids.ReglasResumen).slice(1), coto = rows.find(x => x[0] === 'coto');
  assert.strictEqual(rows.length, 3); assert.deepStrictEqual([coto[1], coto[3]], ['no', 2], 'gana la última decisión y cuenta 2 veces');
  // y una segunda subida sobre filas ya guardadas también actualiza
  b.call('aprenderResumen', { reglas: [{ descripcion: 'COTO', comparte: 'si', categoria: 'super' }] });
  assert.deepStrictEqual(J(b.grids.ReglasResumen).slice(1).find(x => x[0] === 'coto').slice(1, 4), ['si', 'super', 3]);
});

t('leer es liviano: sin cambios responde «unchanged», y cada escritura mueve el contador', () => {
  const b = withPeople();
  const r1 = b.call('read'); assert.ok(r1.rev, 'trae rev'); const l0 = b.log.locks;
  assert.strictEqual(b.call('read', { rev: r1.rev }).unchanged, true, 'sin cambios no baja la Sheet');
  assert.strictEqual(b.log.locks, l0, 'leer no toma el candado');
  b.call('addMovimientos', { movimientos: [mov({ id: 'q1' })] });
  const r2 = b.call('read', { rev: r1.rev }); assert.ok(!r2.unchanged && r2.rev !== r1.rev && r2.movimientos.length === 1);
  assert.strictEqual(b.call('read', { rev: r2.rev }).unchanged, true);
});
t('aprenderResumen puede registrar el resumen en el mismo pedido', () => {
  const b = withPeople();
  b.call('aprenderResumen', { reglas: [{ descripcion: 'COTO', comparte: 'si', categoria: 'super' }], resumen: { tarjeta: 'VISA', persona_id: 'm1', cierre: '2026-10-29', proximo_cierre: '2026-11-26', consumos: 3, compartidos: 1, creado_por: 'm1' } });
  assert.strictEqual(b.grids.Resumenes.length, 2);
});

t('Personal: guarda solo datos cifrados, es idempotente y cada uno lee únicamente lo suyo', () => {
  const b = withPeople();
  const blob = 'QUJDREVGR0hJSktMTU5PUA==';
  const r = b.call('savePersonal', { persona_id: 'm1', filas: [{ id: 'p1', blob }, { id: 'p2', blob }] });
  assert.deepStrictEqual([r.agregadas, r.repetidas], [2, 0]);
  const r2 = b.call('savePersonal', { persona_id: 'm1', filas: [{ id: 'p2', blob }, { id: 'p3', blob }] });
  assert.deepStrictEqual([r2.agregadas, r2.repetidas], [1, 1]);
  b.call('savePersonal', { persona_id: 'm2', filas: [{ id: 'q1', blob }] });
  assert.deepStrictEqual(J(b.call('read', { persona: 'm1' }).personal.map(x => x.id)), ['p1', 'p2', 'p3']);
  assert.deepStrictEqual(J(b.call('read', { persona: 'm2' }).personal.map(x => x.id)), ['q1']);
  assert.deepStrictEqual(J(b.call('read', {}).personal), [], 'sin decir quién sos, no te da nada');
  assert.deepStrictEqual(J(b.call('read', { persona: 'm2' }).personal.map(x => Object.keys(x).sort().join())), ['blob,creado_en,id']);
});
t('Personal: rechaza texto en claro, filas de más y ids raros', () => {
  const b = withPeople();
  for (const blob of ['Almuerzo 1500 pesos', '', 'corto', 123]) assert.strictEqual(err(() => b.call('savePersonal', { persona_id: 'm1', filas: [{ id: 'x', blob }] })).code, 'pedido_invalido');
  assert.strictEqual(err(() => b.call('savePersonal', { persona_id: 'm1', filas: [] })).code, 'pedido_invalido');
  assert.strictEqual(err(() => b.call('savePersonal', { persona_id: 'm 1', filas: [{ id: 'x', blob: 'QUJDREVGR0hJSktMTU5PUA==' }] })).code, 'id_invalido');
  assert.strictEqual(b.grids.Personal.length, 1);
});
t('Personal: mueve el contador para que el otro celular no se confunda', () => {
  const b = withPeople(); const r1 = b.call('read', { persona: 'm1' });
  b.call('savePersonal', { persona_id: 'm1', filas: [{ id: 'p1', blob: 'QUJDREVGR0hJSktMTU5PUA==' }] });
  assert.ok(!b.call('read', { rev: r1.rev, persona: 'm1' }).unchanged);
});

t('IA nueva: leerTicket, entenderGastos e iaTexto validan, limpian y no filtran detalles', () => {
  const b = withPeople();
  const img = Buffer.alloc(300, 7).toString('base64');
  const gem = (obj) => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) });
  assert.strictEqual(b.call('leerTicket', { imagen: img, mime: 'image/jpeg' }).sin_clave, true);
  assert.strictEqual(b.call('entenderGastos', { texto: 'el super 15 mil' }).sin_clave, true);
  assert.strictEqual(b.call('iaTexto', { tipo: 'carta', datos: { total: 1 } }).sin_clave, true);
  b.log.props.GEMINI_API_KEY = 'K'.repeat(30);
  [{ imagen: 'x', mime: 'image/jpeg' }, { imagen: img, mime: 'application/pdf' }, {}].forEach(o => assert.strictEqual(err(() => b.call('leerTicket', o)).code, 'pedido_invalido'));
  const sent = [];
  b.ctx.UrlFetchApp = { fetch: (u, o) => { sent.push(JSON.parse(o.payload)); return gem({ comercio: ' Coto\u0000 ', moneda: 'ARS', fecha: '2026-02-30', total: 1500.5, items: [{ descripcion: 'Leche', monto: 1000.25 }, { descripcion: 'Basura', monto: -4 }, { descripcion: '', monto: 5 }, { descripcion: 'Pan', monto: 500.25 }] }); } };
  const r = J(b.call('leerTicket', { imagen: img, mime: 'image/png' }));
  assert.deepStrictEqual([r.comercio, r.fecha, r.total_centavos, r.items.map(x => x.descripcion + ':' + x.monto_centavos).join()], ['Coto', '', 150050, 'Leche:100025,Pan:50025']);
  assert.ok(sent[0].contents[0].parts[1].inlineData && !JSON.stringify(sent[0]).includes('creado_por'));
  // entenderGastos
  b.ctx.UrlFetchApp = { fetch: () => gem({ gastos: [{ descripcion: 'Súper', monto: 15000, moneda: 'ARS', categoria: 'super', fecha: '2026-11-06' }, { descripcion: 'Café', monto: 3000, moneda: 'EUR', categoria: 'inventada', fecha: '2999-01-01' }, { descripcion: 'Nada', monto: 0, moneda: 'ARS', categoria: 'otros', fecha: '' }] }) };
  const g = J(b.call('entenderGastos', { texto: 'ayer el super 15 mil y un cafe 3 mil', hoy: '2026-11-07' }));
  assert.deepStrictEqual(g.gastos.map(x => [x.descripcion, x.monto_centavos, x.moneda, x.categoria, x.fecha]), [['Súper', 1500000, 'ARS', 'super', '2026-11-06'], ['Café', 300000, 'ARS', 'otros', '']]);
  ['', 'ab', 'x'.repeat(401)].forEach(texto => assert.strictEqual(err(() => b.call('entenderGastos', { texto })).code, 'pedido_invalido'));
  // iaTexto
  b.ctx.UrlFetchApp = { fetch: (u, o) => { sent.push(JSON.parse(o.payload)); return gem({ texto: '  Hola, soy Cuba 🐾  ' }); } };
  assert.strictEqual(b.call('iaTexto', { tipo: 'carta', datos: { total: 123 } }).texto, 'Hola, soy Cuba 🐾');
  assert.ok(/"total":123/.test(sent[sent.length - 1].contents[0].parts[0].text));
  assert.strictEqual(err(() => b.call('iaTexto', { tipo: 'hackear', datos: {} })).code, 'pedido_invalido');
  assert.strictEqual(err(() => b.call('iaTexto', { tipo: 'carta', datos: 'texto' })).code, 'pedido_invalido');
  assert.strictEqual(err(() => b.call('iaTexto', { tipo: 'carta', datos: { x: 'a'.repeat(3000) } })).code, 'pedido_invalido');
  b.ctx.UrlFetchApp = { fetch: () => { throw new Error('boom KKKK'); } };
  assert.strictEqual(b.call('iaTexto', { tipo: 'explica', datos: { a: 1 } }).error, 'gemini_respuesta');
  const rev = b.call('read').rev; b.ctx.UrlFetchApp = { fetch: () => gem({ texto: 'x' }) }; b.call('iaTexto', { tipo: 'caro', datos: { a: 1 } });
  assert.strictEqual(b.call('read').rev, rev, 'no escribe nada');
});

// Mercado Pago: «Dinero en cuenta» (release_report) y «Liquidaciones» (settlement_report) tienen listas aparte; se miran las dos.
t('mpReportes: baja los CSV de las dos familias, solo GET, y el token no sale', () => {
  const b = boot(); b.log.props.MP_ACCESS_TOKEN = 'APP_USR-1234567890123456-111111-abcdef0123456789abcdef0123456789-9999'; b.log.props.MP_LINK = 'ABCD-1234-EF56';
  const hoy = new Date().toISOString().slice(0, 10), urls = [];
  const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  b.ctx.UrlFetchApp = { fetch: (u, o) => {
    urls.push(u); assert.strictEqual(o.method, 'get');
    if (/release_report\/list/.test(u)) return resp(200, [{ file_name: 'release-report-1.csv', date_created: new Date().toISOString() }, { file_name: 'viejo.csv', date_created: '2020-01-01T00:00:00Z' }]);
    if (/settlement_report\/list/.test(u)) return resp(404, { message: 'no' });
    if (/release_report\/release-report-1\.csv/.test(u)) return resp(200, 'DATE,DESCRIPTION\n' + hoy + ',x');
    return resp(500, '');
  } };
  const r = b.call('mpReportes', { clave: 'ABCD-1234-EF56' });
  assert.strictEqual(r.reportes.length, 1); assert.strictEqual(r.reportes[0].nombre, 'release-report-1.csv');
  assert.strictEqual(r.listados, 2); assert.strictEqual(r.recientes, 1); assert.strictEqual(r.fallidos, 0);
  assert.ok(urls.some(u => /release_report\/list/.test(u)) && urls.some(u => /settlement_report\/list/.test(u)));
  assert.ok(!JSON.stringify(r).includes('APP_USR'));
  assert.strictEqual(err(() => b.call('mpReportes', { clave: 'XXXX-XXXX-XXXX' })).code, 'no_autorizado');
});
t('mpReportes: errores claros (token malo, sin red, listas vacías, descarga fallida)', () => {
  const mk = f => { const b = boot(); b.log.props.MP_ACCESS_TOKEN = 'APP_USR-1234567890123456-111111-abcdef0123456789abcdef0123456789-9999'; b.log.props.MP_LINK = 'ABCD-1234-EF56'; b.ctx.UrlFetchApp = { fetch: f }; return b; };
  const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });
  const hoy = new Date().toISOString().slice(0, 10), clave = { clave: 'ABCD-1234-EF56' };
  assert.strictEqual(mk(() => resp(401, {})).call('mpReportes', clave).error, 'mp_token');
  assert.strictEqual(mk(() => { throw new Error('sin red'); }).call('mpReportes', clave).error, 'mp_http');
  assert.strictEqual(mk(() => resp(500, {})).call('mpReportes', clave).error, 'mp_lista');
  const vacio = mk(() => resp(200, [])).call('mpReportes', clave); assert.deepStrictEqual(J([vacio.reportes, vacio.listados]), [[], 0]);
  const falla = mk(u => /\/list$/.test(u) ? resp(200, [{ file_name: 'a.csv', date_created: hoy + 'T00:00:00Z' }]) : resp(500, {})).call('mpReportes', clave);
  assert.strictEqual(falla.reportes.length, 0); assert.ok(falla.fallidos >= 1);
});
console.log(n + ' pruebas del backend (mp incluidas)');
t('mpReportes devuelve los códigos de Mercado Pago y «Probar Mercado Pago» muestra qué ve Cuba sin el token', () => {
  const b = boot(); b.log.props.MP_ACCESS_TOKEN = 'APP_USR-1234567890123456-111111-abcdef0123456789abcdef0123456789-9999'; b.log.props.MP_LINK = 'ABCD-1234-EF56';
  const resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });
  b.ctx.UrlFetchApp = { fetch: u => /release_report/.test(u) ? resp(404, { message: 'not found' }) : resp(200, []) };
  const r = b.call('mpReportes', { clave: 'ABCD-1234-EF56' });
  assert.strictEqual(r.codigos, 'release:404 settlement:200(0)'); assert.strictEqual(r.listados, 0); assert.strictEqual(r.v, '0.25.0');
  let msg = ''; b.ctx.SpreadsheetApp = { getUi: () => ({ alert: (t, m) => { msg = t + ' ' + m; }, ButtonSet: { OK: 1 } }) };
  vm.runInContext('probarMercadoPago()', b.ctx);
  assert.ok(/release_report: código 404/.test(msg) && /settlement_report: 200, 0 reportes/.test(msg) && !/APP_USR/.test(msg), msg);
});
console.log('mp diagnóstico ok');
t('mpReportes acepta la lista dentro de un objeto y cuenta qué vio', () => {
  const b = boot(); b.log.props.MP_ACCESS_TOKEN = 'APP_USR-1234567890123456-111111-abcdef0123456789abcdef0123456789-9999'; b.log.props.MP_LINK = 'ABCD-1234-EF56';
  const hoy = new Date().toISOString().slice(0, 10), resp = (code, body) => ({ getResponseCode: () => code, getContentText: () => typeof body === 'string' ? body : JSON.stringify(body) });
  b.ctx.UrlFetchApp = { fetch: u => /release_report\/list/.test(u) ? resp(200, { results: [{ file_name: 'r.csv', date_created: hoy + 'T01:00:00Z' }] }) : /settlement_report\/list/.test(u) ? resp(200, { total: 0, algo: 1 }) : resp(200, 'DATE,X\n' + hoy + ',1') };
  const r = b.call('mpReportes', { clave: 'ABCD-1234-EF56' });
  assert.strictEqual(r.reportes.length, 1); assert.ok(/release:200\(1\) settlement:200\(forma objeto\{total,algo\}\)/.test(r.codigos), r.codigos);
});

// Cuba le pide el reporte a Mercado Pago cuando no hay uno reciente (los programados desde la web no se ven por la API).
function mpBoot() { const b = boot(); b.log.props.MP_ACCESS_TOKEN = 'APP_USR-1234567890123456-111111-abcdef0123456789abcdef0123456789-9999'; b.log.props.MP_LINK = 'ABCD-1234-EF56'; return b; }
const rsp = (code, body) => ({ getResponseCode: () => code, getContentText: () => typeof body === 'string' ? body : JSON.stringify(body) });
t('mpReportes pide el reporte, espera que aparezca, lo baja y no vuelve a pedir enseguida', () => {
  const b = mpBoot(), posts = []; let creado = false;
  b.ctx.UrlFetchApp = { fetch: (u, o) => {
    if (o.method === 'post') { posts.push({ u, p: JSON.parse(o.payload) }); creado = true; return rsp(202, { id: 1, status: 'pending' }); }
    if (/release_report\/list/.test(u)) return rsp(200, creado ? [{ file_name: 'release-report-9.csv', date_created: new Date().toISOString() }] : []);
    if (/settlement_report\/list/.test(u)) return rsp(200, []);
    return /release-report-9\.csv/.test(u) ? rsp(200, 'DATE,X\n2026-11-08,1') : rsp(404, {});
  } };
  const r = b.call('mpReportes', { clave: 'ABCD-1234-EF56', desde: '2026-11-05' });
  assert.strictEqual(posts.length, 1); assert.ok(/\/v1\/account\/release_report$/.test(posts[0].u));
  assert.strictEqual(posts[0].p.begin_date, '2026-11-05T03:00:00Z'); assert.ok(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(posts[0].p.end_date));
  assert.strictEqual(r.reportes.length, 1); assert.ok(!r.pedido, 'ya estaba listo');
  b.call('mpReportes', { clave: 'ABCD-1234-EF56', desde: '2026-11-05' }); assert.strictEqual(posts.length, 1, 'no pide otro');
});
t('mpReportes: si tarda, avisa «pedido»; sin configuración la crea y reintenta; si falla, dice el código', () => {
  // tarda: el reporte no aparece en la espera
  let b = mpBoot(), posts = 0;
  b.ctx.UrlFetchApp = { fetch: (u, o) => { if (o.method === 'post') { posts++; return rsp(202, {}); } return rsp(200, []); } };
  let r = b.call('mpReportes', { clave: 'ABCD-1234-EF56' }); assert.strictEqual(r.pedido, true); assert.strictEqual(posts, 1); assert.ok(b.log.sleeps >= 3);
  r = b.call('mpReportes', { clave: 'ABCD-1234-EF56' }); assert.strictEqual(posts, 1, 'mientras se genera no pide otro'); assert.strictEqual(r.pedido, true);
  // sin configuración: la crea (con las columnas que lee la app) y reintenta una vez
  b = mpBoot(); const llam = [];
  b.ctx.UrlFetchApp = { fetch: (u, o) => { if (o.method === 'post') { llam.push(u.replace('https://api.mercadopago.com', '')); if (/config$/.test(u)) { const c = JSON.parse(o.payload); assert.ok(c.columns.some(x => x.key === 'NET_CREDIT_AMOUNT') && c.columns.some(x => x.key === 'SOURCE_ID') && c.report_translation === 'en'); return rsp(201, {}); } return llam.length === 1 ? rsp(404, { message: 'config not found' }) : rsp(202, {}); } return rsp(200, []); } };
  r = b.call('mpReportes', { clave: 'ABCD-1234-EF56' }); assert.deepStrictEqual(llam, ['/v1/account/release_report', '/v1/account/release_report/config', '/v1/account/release_report']); assert.strictEqual(r.pedido, true);
  // falla: se informa el código
  b = mpBoot(); b.ctx.UrlFetchApp = { fetch: (u, o) => o.method === 'post' ? rsp(403, { message: 'forbidden' }) : rsp(200, []) };
  r = b.call('mpReportes', { clave: 'ABCD-1234-EF56' }); assert.ok(/^403 /.test(r.pedido_error) && !r.pedido, JSON.stringify(r));
});
t('mpPost_ rechaza cualquier ruta que no sea pedir un reporte', () => {
  const b = mpBoot(); let n2 = 0; b.ctx.UrlFetchApp = { fetch: () => { n2++; return rsp(200, {}); } };
  ['/v1/payments', '/v1/account/release_report/schedule', '/v1/money_requests', '/v1/account/release_report/../payments'].forEach(p => {
    assert.throws(() => vm.runInContext('mpPost_(' + JSON.stringify(p) + ', {}, "x")', b.ctx), /POST no permitido/);
  });
  assert.strictEqual(n2, 0, 'no salió ningún pedido');
});
console.log('mp: pedir reporte ok');
