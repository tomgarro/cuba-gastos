/**
 * Cuba · backend (Google Apps Script ligado a la Google Sheet).
 *
 * Una sola función pública: doPost recibe JSON en texto plano (sin preflight CORS)
 *   { token, action, ...datos }
 * y responde { ok: true, ... } o { ok: false, error, message }.
 *
 * Reglas de dominio que este archivo hace cumplir (no solo la app):
 *  - Dinero en centavos enteros, moneda por movimiento, sin conversión.
 *  - Movimientos SOLO se agregan. Borrar = marcar `anulado`. Nunca se reescribe una fila.
 *  - Editar = anular el viejo y agregar uno nuevo con `reemplaza_id` (lo arma el cliente).
 *  - El reparto siempre suma exacto al monto.
 *  - Personas: se crean y se modifican, nunca se borran (se archivan).
 *  - Todo con LockService: dos cargas simultáneas no se pisan.
 *
 * Secretos: el token vive solo en Propiedades del script (CUBA_TOKEN). Nunca en la Sheet ni en el repo.
 * Más adelante la clave de Gemini y el token del bot van en el mismo lugar.
 */

var CUBA = {
  VERSION: 1,
  APP_URL: 'https://tomgarro.github.io/cuba-gastos/',
  MAX_BATCH: 500,
  LOCK_MS: 20000,
  TOKEN_PROP: 'CUBA_TOKEN',
  URL_PROP: 'CUBA_URL'
};

var TABS = {
  Personas: ['id', 'nombre', 'alias', 'color', 'estado', 'creada'],
  Movimientos: ['id', 'tipo', 'fecha', 'descripcion', 'monto_centavos', 'moneda', 'pagador_id', 'reparto_modo', 'reparto_json',
    'excepcion', 'motivo_excepcion', 'categoria', 'confianza', 'nota', 'lote_id', 'origen', 'creado_por', 'creado_en', 'anulado', 'reemplaza_id'],
  Lotes: ['id', 'origen', 'archivo', 'fecha', 'cantidad', 'moneda_original', 'estado'],
  Categorias: ['id', 'nombre', 'emoji', 'presupuesto_mensual_centavos', 'moneda'],
  Config: ['clave', 'valor']
};

var ENUM = {
  tipo: ['gasto', 'pago'],
  moneda: ['ARS', 'USD'],
  reparto_modo: ['sueldo', 'igual', 'porcentaje', 'exacto'],
  estado_persona: ['activa', 'archivada']
};

/* ------------------------------------------------------------------ */
/* Puntos de entrada                                                   */
/* ------------------------------------------------------------------ */

function doGet() {
  // Sin datos y sin token: solo sirve para ver que el despliegue está vivo.
  return json_({ ok: true, app: 'cuba', version: CUBA.VERSION });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '');
  } catch (err) {
    return json_({ ok: false, error: 'json_invalido', message: 'El pedido no es JSON válido.' });
  }
  try {
    return json_(handle_(req));
  } catch (err) {
    if (!err || !err.cuba) console.error(err && err.stack || err);
    return json_({
      ok: false,
      error: (err && err.cuba) ? err.code : 'interno',
      message: (err && err.cuba) ? err.message : 'Error interno del backend. Mirá Ejecuciones en Apps Script.'
    });
  }
}

/** Núcleo sin ContentService: es lo que prueban los tests. */
function handle_(req) {
  if (!req || typeof req !== 'object') fail_('pedido_invalido', 'Pedido vacío.');
  checkToken_(req.token);
  var action = String(req.action || '');
  var fn = ACTIONS[action];
  if (!fn) fail_('accion_desconocida', 'Acción desconocida: ' + action);
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(CUBA.LOCK_MS);
  } catch (err) {
    fail_('ocupado', 'El backend está ocupado. Probá de nuevo en unos segundos.');
  }
  try {
    return fn(req);
  } finally {
    lock.releaseLock();
  }
}

var ACTIONS = {
  ping: actionPing_,
  read: actionRead_,
  savePersonas: actionSavePersonas_,
  addMovimientos: actionAddMovimientos_,
  anularMovimientos: actionAnularMovimientos_,
  undoLote: actionUndoLote_
};

/* ------------------------------------------------------------------ */
/* Acciones                                                            */
/* ------------------------------------------------------------------ */

function actionPing_() {
  checkSchema_();
  return { ok: true, version: CUBA.VERSION, serverTime: new Date().toISOString() };
}

function actionRead_() {
  checkSchema_();
  var config = {};
  readTab_('Config').forEach(function (r) { if (r.clave) config[r.clave] = r.valor; });
  return {
    ok: true,
    version: CUBA.VERSION,
    serverTime: new Date().toISOString(),
    personas: readTab_('Personas'),
    movimientos: readTab_('Movimientos').map(movOut_),
    lotes: readTab_('Lotes'),
    categorias: readTab_('Categorias'),
    config: config
  };
}

function actionSavePersonas_(req) {
  checkSchema_();
  var list = req.personas;
  if (!Array.isArray(list) || !list.length || list.length > 50) fail_('personas_invalidas', 'Mandá entre 1 y 50 personas.');
  var sheet = sheet_('Personas');
  var existing = readTab_('Personas');
  var rowById = {};
  existing.forEach(function (p) { rowById[p.id] = p; });
  var now = new Date().toISOString();
  var seen = {};
  var clean = list.map(function (p, i) {
    var id = idOf_(p && p.id, 'Persona #' + (i + 1));
    if (seen[id]) fail_('personas_invalidas', 'Persona repetida: ' + id);
    seen[id] = true;
    var nombre = text_(p.nombre, 40);
    if (!nombre) fail_('personas_invalidas', 'La persona ' + id + ' necesita nombre.');
    var color = p.color == null ? null : String(p.color);
    if (color !== null && color !== '' && !/^#[0-9a-fA-F]{6}$/.test(color)) fail_('personas_invalidas', 'Color inválido en ' + id + ' (usá #rrggbb).');
    var estado = p.estado == null ? null : String(p.estado);
    if (estado !== null && ENUM.estado_persona.indexOf(estado) < 0) fail_('personas_invalidas', 'Estado inválido en ' + id + '.');
    var alias = p.alias == null ? null : text_(Array.isArray(p.alias) ? p.alias.join(', ') : p.alias, 120);
    return { id: id, nombre: nombre, color: color, estado: estado, alias: alias };
  });
  var cols = TABS.Personas;
  var updates = [], news = [];
  clean.forEach(function (p) {
    var old = rowById[p.id];
    if (old) {
      updates.push([p.id, [
        p.id, p.nombre,
        p.alias == null ? old.alias : p.alias,
        p.color == null ? old.color : p.color,
        p.estado == null ? old.estado : p.estado,
        old.creada
      ]]);
    } else {
      news.push([p.id, p.nombre, p.alias || '', p.color || '', p.estado || 'activa', now]);
    }
  });
  if (updates.length) {
    var ids = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues() : [];
    updates.forEach(function (u) {
      for (var r = 0; r < ids.length; r++) {
        if (String(ids[r][0]) === u[0]) { sheet.getRange(r + 2, 1, 1, cols.length).setValues([u[1]]); break; }
      }
    });
  }
  if (news.length) appendRows_(sheet, news, cols.length);
  return { ok: true, creadas: news.length, actualizadas: updates.length };
}

function actionAddMovimientos_(req) {
  checkSchema_();
  var list = req.movimientos;
  if (!Array.isArray(list) || !list.length) fail_('movimientos_invalidos', 'No hay movimientos para agregar.');
  if (list.length > CUBA.MAX_BATCH) fail_('movimientos_invalidos', 'Máximo ' + CUBA.MAX_BATCH + ' movimientos por pedido.');

  var personas = {};
  readTab_('Personas').forEach(function (p) { personas[p.id] = true; });
  var sheet = sheet_('Movimientos');
  var known = idMap_(sheet); // id -> anulado
  var lotes = {};
  readTab_('Lotes').forEach(function (l) { lotes[l.id] = l; });

  var lote = null;
  if (req.lote != null) lote = normLote_(req.lote);

  var batchIds = {}, rows = [], omitidos = [], reemplazados = [];
  var now = new Date().toISOString();
  list.forEach(function (m, i) {
    var n = normMov_(m, i, personas);
    if (batchIds[n.id]) fail_('movimiento_invalido', 'Movimiento #' + (i + 1) + ': id repetido en el pedido (' + n.id + ').');
    batchIds[n.id] = true;
    if (n.lote_id && !(lote && lote.id === n.lote_id) && !lotes[n.lote_id]) {
      fail_('movimiento_invalido', 'Movimiento #' + (i + 1) + ': el lote ' + n.lote_id + ' no existe.');
    }
    if (n.id in known) { omitidos.push(n.id); return; } // reintento: ya estaba, no se duplica
    if (n.reemplaza_id) {
      if (!(n.reemplaza_id in known)) fail_('movimiento_invalido', 'Movimiento #' + (i + 1) + ': reemplaza algo que no existe.');
      if (known[n.reemplaza_id] || reemplazados.indexOf(n.reemplaza_id) >= 0) {
        fail_('conflicto', 'Ese movimiento ya fue modificado o eliminado desde otro celular.');
      }
      reemplazados.push(n.reemplaza_id);
    }
    rows.push(TABS.Movimientos.map(function (c) { return rowValue_(n, c, now); }));
  });

  if (lote && !lotes[lote.id]) {
    appendRows_(sheet_('Lotes'), [[lote.id, lote.origen, lote.archivo, lote.fecha, lote.cantidad == null ? rows.length : lote.cantidad, lote.moneda_original, 'activo']], TABS.Lotes.length);
  }
  if (rows.length) appendRows_(sheet, rows, TABS.Movimientos.length);
  // Editar = agregar el nuevo y anular el viejo, en el mismo pedido y bajo el mismo lock.
  if (reemplazados.length) anular_(function (row) { return reemplazados.indexOf(row.id) >= 0; });
  return { ok: true, agregados: rows.length, omitidos: omitidos, reemplazados: reemplazados.length };
}

function actionAnularMovimientos_(req) {
  checkSchema_();
  var ids = req.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > CUBA.MAX_BATCH) fail_('ids_invalidos', 'Mandá entre 1 y ' + CUBA.MAX_BATCH + ' ids.');
  ids.forEach(function (id) { idOf_(id, 'id'); });
  var res = anular_(function (row) { return ids.indexOf(row.id) >= 0; });
  var found = {};
  res.matched.forEach(function (id) { found[id] = true; });
  return {
    ok: true,
    anulados: res.changed,
    yaAnulados: res.matched.length - res.changed,
    noEncontrados: ids.filter(function (id) { return !found[id]; })
  };
}

function actionUndoLote_(req) {
  checkSchema_();
  var id = idOf_(req.lote_id, 'lote_id');
  var lSheet = sheet_('Lotes');
  var last = lSheet.getLastRow();
  var ids = last > 1 ? lSheet.getRange(2, 1, last - 1, 1).getValues() : [];
  var row = -1;
  for (var r = 0; r < ids.length; r++) if (String(ids[r][0]) === id) { row = r + 2; break; }
  if (row < 0) fail_('lote_inexistente', 'No existe el lote ' + id + '.');
  var res = anular_(function (m) { return m.lote_id === id; });
  lSheet.getRange(row, TABS.Lotes.indexOf('estado') + 1).setValue('deshecho');
  return { ok: true, anulados: res.changed };
}

/* ------------------------------------------------------------------ */
/* Validación                                                          */
/* ------------------------------------------------------------------ */

function normMov_(m, i, personas) {
  var tag = 'Movimiento #' + (i + 1);
  var bad = function (why) { fail_('movimiento_invalido', tag + ': ' + why); };
  if (!m || typeof m !== 'object') bad('no es un objeto.');
  var id = idOf_(m.id, tag);
  tag += ' (' + id + ')';
  if (ENUM.tipo.indexOf(m.tipo) < 0) bad('tipo debe ser gasto o pago.');
  if (!isDate_(m.fecha)) bad('fecha inválida (usá AAAA-MM-DD).');
  if (!isInt_(m.monto_centavos) || m.monto_centavos <= 0 || m.monto_centavos > 1e13) bad('el monto tiene que ser un entero de centavos mayor a cero.');
  if (ENUM.moneda.indexOf(m.moneda) < 0) bad('moneda debe ser ARS o USD.');
  if (typeof m.pagador_id !== 'string' || !personas[m.pagador_id]) bad('el pagador no existe en Personas.');
  var modo = m.reparto_modo == null ? 'exacto' : m.reparto_modo;
  if (ENUM.reparto_modo.indexOf(modo) < 0) bad('reparto_modo inválido.');
  var rep = m.reparto;
  if (!Array.isArray(rep) || !rep.length || rep.length > 50) bad('falta el reparto.');
  var sum = 0, seen = {};
  rep.forEach(function (x) {
    if (!Array.isArray(x) || x.length !== 2 || typeof x[0] !== 'string' || !personas[x[0]]) bad('el reparto nombra a alguien que no existe.');
    if (!isInt_(x[1])) bad('el reparto tiene montos que no son enteros.');
    if (seen[x[0]]) bad('el reparto repite a una persona.');
    seen[x[0]] = true;
    sum += x[1];
  });
  if (sum !== m.monto_centavos) bad('el reparto suma ' + sum + ' y el monto es ' + m.monto_centavos + '.');
  var conf = m.confianza;
  if (conf != null && conf !== '' && !(typeof conf === 'number' && conf >= 0 && conf <= 1)) bad('confianza debe estar entre 0 y 1.');
  var lote = m.lote_id == null || m.lote_id === '' ? '' : idOf_(m.lote_id, tag);
  var reemplaza = m.reemplaza_id == null || m.reemplaza_id === '' ? '' : idOf_(m.reemplaza_id, tag);
  var creadoPor = m.creado_por == null || m.creado_por === '' ? '' : idOf_(m.creado_por, tag);
  return {
    id: id, tipo: m.tipo, fecha: m.fecha,
    descripcion: text_(m.descripcion, 200),
    monto_centavos: m.monto_centavos, moneda: m.moneda, pagador_id: m.pagador_id,
    reparto_modo: modo, reparto_json: JSON.stringify(rep),
    excepcion: m.excepcion === true, motivo_excepcion: text_(m.motivo_excepcion, 200),
    categoria: text_(m.categoria, 40), confianza: conf == null ? '' : conf,
    nota: text_(m.nota, 500), lote_id: lote, origen: text_(m.origen || 'manual', 30) || 'manual',
    creado_por: creadoPor, reemplaza_id: reemplaza
  };
}

function normLote_(l) {
  if (!l || typeof l !== 'object') fail_('lote_invalido', 'El lote no es válido.');
  var id = idOf_(l.id, 'lote');
  var moneda = l.moneda_original == null || l.moneda_original === '' ? 'ARS' : l.moneda_original;
  if (ENUM.moneda.indexOf(moneda) < 0) fail_('lote_invalido', 'moneda_original inválida.');
  var fecha = l.fecha || new Date().toISOString().slice(0, 10);
  if (!isDate_(fecha)) fail_('lote_invalido', 'fecha del lote inválida.');
  return { id: id, origen: text_(l.origen || 'manual', 30) || 'manual', archivo: text_(l.archivo, 120), fecha: fecha,
    cantidad: isInt_(l.cantidad) && l.cantidad >= 0 ? l.cantidad : null, moneda_original: moneda };
}

function rowValue_(n, col, now) {
  switch (col) {
    case 'excepcion': return n.excepcion ? 'TRUE' : 'FALSE';
    case 'anulado': return 'FALSE';
    case 'creado_en': return now;
    default: return n[col] == null ? '' : n[col];
  }
}

function idOf_(v, tag) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(v)) fail_('id_invalido', tag + ': id inválido (letras, números, _ y -; hasta 64).');
  return v;
}
function text_(v, max) {
  if (v == null) return '';
  return String(v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}
function isInt_(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && Math.abs(n) <= 9007199254740991; }
function isDate_(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var p = s.split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  return d.getUTCFullYear() === +p[0] && d.getUTCMonth() === +p[1] - 1 && d.getUTCDate() === +p[2];
}

/* ------------------------------------------------------------------ */
/* Hoja                                                                */
/* ------------------------------------------------------------------ */

function sheet_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) fail_('esquema', 'Falta la pestaña ' + name + '.');
  return sh;
}

function checkSchema_() {
  Object.keys(TABS).forEach(function (name) {
    var cols = TABS[name];
    var head = sheet_(name).getRange(1, 1, 1, cols.length).getValues()[0];
    for (var i = 0; i < cols.length; i++) {
      if (String(head[i]) !== cols[i]) fail_('esquema', 'La pestaña ' + name + ' no coincide con el esquema (columna ' + (i + 1) + ': esperaba ' + cols[i] + ').');
    }
  });
}

function readTab_(name) {
  var cols = TABS[name], sh = sheet_(name), last = sh.getLastRow();
  if (last < 2) return [];
  var out = [];
  sh.getRange(2, 1, last - 1, cols.length).getValues().forEach(function (row) {
    if (row[0] === '' || row[0] == null) return;
    var o = {};
    cols.forEach(function (c, i) { o[c] = cell_(row[i]); });
    out.push(o);
  });
  return out;
}

/** Fechas que Sheets convirtió solas vuelven a texto ISO. */
function cell_(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v == null ? '' : v;
}

function movOut_(r) {
  return {
    id: String(r.id), tipo: String(r.tipo), fecha: String(r.fecha), descripcion: String(r.descripcion),
    monto_centavos: Number(r.monto_centavos), moneda: String(r.moneda), pagador_id: String(r.pagador_id),
    reparto_modo: String(r.reparto_modo), reparto_json: String(r.reparto_json),
    excepcion: bool_(r.excepcion), motivo_excepcion: String(r.motivo_excepcion), categoria: String(r.categoria),
    confianza: r.confianza === '' ? null : Number(r.confianza), nota: String(r.nota), lote_id: String(r.lote_id),
    origen: String(r.origen), creado_por: String(r.creado_por), creado_en: String(r.creado_en),
    anulado: bool_(r.anulado), reemplaza_id: String(r.reemplaza_id)
  };
}
function bool_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

/** id -> anulado (bool) de todos los movimientos. */
function idMap_(sheet) {
  var last = sheet.getLastRow(), map = {};
  if (last < 2) return map;
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  var an = sheet.getRange(2, TABS.Movimientos.indexOf('anulado') + 1, last - 1, 1).getValues();
  ids.forEach(function (r, i) { if (r[0] !== '') map[String(r[0])] = bool_(an[i][0]); });
  return map;
}

function appendRows_(sheet, rows, width) {
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, width).setValues(rows);
}

/** Marca `anulado` en las filas que cumplan; es lo único que se toca de una fila de Movimientos. */
function anular_(pred) {
  var sh = sheet_('Movimientos'), cols = TABS.Movimientos, last = sh.getLastRow();
  var res = { matched: [], changed: 0 };
  if (last < 2) return res;
  var data = sh.getRange(2, 1, last - 1, cols.length).getValues();
  var iAn = cols.indexOf('anulado');
  var flags = [], dirty = false;
  data.forEach(function (row) {
    var o = {};
    cols.forEach(function (c, i) { o[c] = row[i]; });
    var hit = o.id !== '' && pred({ id: String(o.id), lote_id: String(o.lote_id) });
    var already = bool_(o.anulado);
    if (hit) res.matched.push(String(o.id));
    if (hit && !already) { flags.push(['TRUE']); res.changed++; dirty = true; }
    else flags.push([already ? 'TRUE' : (row[iAn] === '' ? 'FALSE' : String(row[iAn]))]);
  });
  if (dirty) sh.getRange(2, iAn + 1, flags.length, 1).setValues(flags);
  return res;
}

/* ------------------------------------------------------------------ */
/* Token                                                               */
/* ------------------------------------------------------------------ */

function checkToken_(sent) {
  var real = PropertiesService.getScriptProperties().getProperty(CUBA.TOKEN_PROP);
  if (!real) fail_('sin_token', 'Todavía no hay token. En la Sheet: menú Cuba → Link para emparejar.');
  var a = String(sent || ''), diff = a.length === real.length ? 0 : 1;
  for (var i = 0; i < real.length; i++) diff |= (a.charCodeAt(i) || 0) ^ real.charCodeAt(i);
  if (diff !== 0) {
    Utilities.sleep(1000); // frena fuerza bruta
    fail_('no_autorizado', 'Token incorrecto.');
  }
}

function newToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function tokenOrCreate_() {
  var props = PropertiesService.getScriptProperties();
  var t = props.getProperty(CUBA.TOKEN_PROP);
  if (!t) { t = newToken_(); props.setProperty(CUBA.TOKEN_PROP, t); }
  return t;
}

/** Solo la URL de la implementación (…/macros/s/<id>/exec). Ojo: getUrl() devuelve la de prueba (/dev), que no sirve. */
function isExecUrl_(u) {
  return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(String(u || '').trim());
}

function pairingLink_() {
  var url = PropertiesService.getScriptProperties().getProperty(CUBA.URL_PROP);
  if (!isExecUrl_(url)) return null;
  var cfg = Utilities.base64EncodeWebSafe(JSON.stringify({ u: url, t: tokenOrCreate_() }));
  return CUBA.APP_URL + '#cfg=' + cfg;
}

/** Pide pegar la URL de la app web (Implementar → Administrar implementaciones → Copiar) y la guarda. */
function pedirUrl_() {
  var ui = SpreadsheetApp.getUi();
  for (;;) {
    var r = ui.prompt('URL de la app web', 'Pegá la URL que termina en /exec (Implementar → Administrar implementaciones → Copiar).', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return false;
    var u = String(r.getResponseText() || '').trim();
    if (isExecUrl_(u)) { PropertiesService.getScriptProperties().setProperty(CUBA.URL_PROP, u); return true; }
    ui.alert('Esa URL no sirve', 'Tiene que empezar con https://script.google.com/macros/s/ y terminar en /exec.', ui.ButtonSet.OK);
  }
}

function cambiarUrl() {
  if (pedirUrl_()) mostrarEmparejado();
}

/* ------------------------------------------------------------------ */
/* Menú de la Sheet                                                    */
/* ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🐕 Cuba')
    .addItem('Link para emparejar celulares', 'mostrarEmparejado')
    .addItem('Cambiar URL de la app web', 'cambiarUrl')
    .addItem('Cambiar token (desconecta los celulares)', 'rotarToken')
    .addToUi();
}

function mostrarEmparejado() {
  var ui = SpreadsheetApp.getUi();
  var link = pairingLink_();
  if (!link) { if (!pedirUrl_()) return; link = pairingLink_(); }
  var safe = link.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:sans-serif;font-size:14px">' +
    '<p>Abrí este link <b>una vez en cada celular</b> (mandalo por un chat privado). Lleva la clave de acceso: no lo compartas.</p>' +
    '<textarea id="l" readonly style="width:100%;height:120px">' + safe + '</textarea>' +
    '<p><button onclick="var t=document.getElementById(\'l\');t.select();document.execCommand(\'copy\');this.textContent=\'Copiado ✓\'">Copiar</button></p></div>'
  ).setWidth(460).setHeight(280);
  ui.showModalDialog(html, 'Emparejar celulares');
}

function rotarToken() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.alert('Cambiar token', 'Los celulares ya emparejados dejan de funcionar hasta que abran el link nuevo. ¿Seguro?', ui.ButtonSet.YES_NO);
  if (r !== ui.Button.YES) return;
  PropertiesService.getScriptProperties().setProperty(CUBA.TOKEN_PROP, newToken_());
  mostrarEmparejado();
}

/* ------------------------------------------------------------------ */

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(code, message) {
  var err = new Error(message);
  err.cuba = true;
  err.code = code;
  throw err;
}
