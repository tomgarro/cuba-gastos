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
  LOCK_MS: 30000,
  TOKEN_PROP: 'CUBA_TOKEN',
  URL_PROP: 'CUBA_URL'
};

var TABS = {
  Personas: ['id', 'nombre', 'alias', 'color', 'estado', 'creada'],
  Movimientos: ['id', 'tipo', 'fecha', 'descripcion', 'monto_centavos', 'moneda', 'pagador_id', 'reparto_modo', 'reparto_json',
    'excepcion', 'motivo_excepcion', 'categoria', 'confianza', 'nota', 'lote_id', 'origen', 'creado_por', 'creado_en', 'anulado', 'reemplaza_id', 'evento_id'],
  Sueldos: ['id', 'persona_id', 'desde', 'monto_centavos', 'moneda', 'nota', 'creado_por', 'creado_en'],
  Lotes: ['id', 'origen', 'archivo', 'fecha', 'cantidad', 'moneda_original', 'estado'],
  Recurrentes: ['id', 'descripcion', 'monto_estimado_centavos', 'moneda', 'dia_mes', 'categoria', 'pagador_id', 'proximo_vencimiento', 'activo', 'ajuste_meses', 'proximo_ajuste'],
  Categorias: ['id', 'nombre', 'emoji', 'presupuesto_mensual_centavos', 'moneda'],
  Comercios: ['patron', 'comercio', 'categoria', 'veces', 'actualizado'],
  Etiquetas: ['id', 'movimiento_id', 'categoria', 'confianza', 'fuente', 'estado', 'creado_por', 'creado_en'],
  ReglasResumen: ['patron', 'comparte', 'categoria', 'veces', 'actualizado'],
  Resumenes: ['id', 'tarjeta', 'persona_id', 'cierre', 'vencimiento', 'proximo_cierre', 'consumos', 'compartidos', 'creado_por', 'creado_en'],
  Eventos: ['id', 'nombre', 'moneda', 'desde', 'hasta', 'estado', 'creado_por', 'creado_en'],
  Config: ['clave', 'valor']
};

/** Pestañas que se crean solas si faltan, y columnas agregadas al final de pestañas viejas (se completan en el encabezado sin tocar los datos). */
var TABS_NUEVAS = ['Etiquetas', 'Comercios', 'ReglasResumen', 'Resumenes', 'Eventos'];
var COLS_VIEJAS = { Movimientos: 20, Recurrentes: 9 };

var ENUM = {
  tipo: ['gasto', 'pago'],
  moneda: ['ARS', 'USD'],
  reparto_modo: ['sueldo', 'igual', 'porcentaje', 'exacto'],
  estado_persona: ['activa', 'archivada'],
  estado_evento: ['abierto', 'cerrado']
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
  if (SIN_CANDADO[action]) return fn(req);
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(CUBA.LOCK_MS);
  } catch (err) {
    fail_('ocupado', 'El backend está ocupado. Probá de nuevo en unos segundos.');
  }
  try {
    var res = fn(req);
    bumpRev_();                       // algo pudo cambiar: los celulares sabrán que tienen que releer
    return res;
  } finally {
    lock.releaseLock();
  }
}

/** Contador de cambios en Script Properties: permite que el celular pregunte «¿cambió algo?» sin bajar toda la Sheet. */
function rev_() {   // contador de cambios + largo de las pestañas principales: también se nota si alguien agrega filas a mano en la Sheet
  var n = PropertiesService.getScriptProperties().getProperty('CUBA_REV') || '0';
  return n + '.' + ['Movimientos', 'Sueldos', 'Personas'].map(function (t) { return sheet_(t).getLastRow(); }).join('.');
}
function bumpRev_() {
  var pr = PropertiesService.getScriptProperties();
  pr.setProperty('CUBA_REV', String((Number(pr.getProperty('CUBA_REV')) || 0) + 1));
}

var ACTIONS = {
  ping: actionPing_,
  read: actionRead_,
  savePersonas: actionSavePersonas_,
  saveSueldo: actionSaveSueldo_,
  saveRecurrente: actionSaveRecurrente_,
  saveEvento: actionSaveEvento_,
  addMovimientos: actionAddMovimientos_,
  anularMovimientos: actionAnularMovimientos_,
  undoLote: actionUndoLote_,
  categorizar: actionCategorizar_,
  leerComprobante: actionLeerComprobante_,
  entenderPregunta: actionEntenderPregunta_,
  aprender: actionAprender_,
  etiquetar: actionEtiquetar_,
  registrarResumen: actionRegistrarResumen_,
  aprenderResumen: actionAprenderResumen_
};

/** Acciones que solo leen o llaman afuera: no toman el candado (Gemini tarda y no debe frenar las cargas). */
var SIN_CANDADO = { categorizar: true, leerComprobante: true, entenderPregunta: true, read: true, ping: true };   // leer no frena a quien está escribiendo
var SOLO_LEE = { read: true, ping: true, categorizar: true, leerComprobante: true, entenderPregunta: true };

/* ------------------------------------------------------------------ */
/* Acciones                                                            */
/* ------------------------------------------------------------------ */

function actionPing_() {
  checkSchema_();
  return { ok: true, version: CUBA.VERSION, serverTime: new Date().toISOString() };
}

function actionRead_(req) {
  var rev = rev_();
  if (req && req.rev && String(req.rev) === rev) return { ok: true, unchanged: true, rev: rev };   // nada nuevo: respuesta casi instantánea
  checkSchema_();
  var config = {};
  readTab_('Config').forEach(function (r) { if (r.clave) config[r.clave] = r.valor; });
  return {
    ok: true,
    version: CUBA.VERSION,
    rev: rev,
    serverTime: new Date().toISOString(),
    personas: readTab_('Personas'),
    sueldos: readTab_('Sueldos').map(sueldoOut_),
    recurrentes: readTab_('Recurrentes').map(recOut_),
    eventos: readTab_('Eventos').map(eventoOut_),
    movimientos: readTab_('Movimientos').map(movOut_),
    lotes: readTab_('Lotes'),
    etiquetas: readTab_('Etiquetas').map(etiquetaOut_),
    categorias: readTab_('Categorias'),
    reglas_resumen: readTab_('ReglasResumen').map(function (r) { return { patron: String(r.patron), comparte: String(r.comparte), categoria: String(r.categoria) }; }),
    resumenes: readTab_('Resumenes').map(resumenOut_),
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
  // Una persona nueva no puede repetir el nombre de una activa (doble toque, reintento, otro celular).
  var activos = {};
  existing.forEach(function (p) { if (String(p.estado) !== 'archivada') activos[String(p.nombre).toLowerCase()] = true; });
  clean.forEach(function (p) {
    if (rowById[p.id]) return;
    var k = p.nombre.toLowerCase();
    if (activos[k]) fail_('persona_duplicada', 'Ya hay una persona activa que se llama ' + p.nombre + '. Si es otra, usá otro nombre o un alias.');
    activos[k] = true;
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

/** Sueldos: solo se agregan (el historial de aumentos queda). Vigente a una fecha = el de mayor `desde` <= fecha. */
function actionSaveSueldo_(req) {
  checkSchema_();
  var x = req.sueldo, bad = function (why) { fail_('sueldo_invalido', why); };
  if (!x || typeof x !== 'object') bad('Falta el sueldo.');
  var id = idOf_(x.id, 'Sueldo'), pid = idOf_(x.persona_id, 'Persona');
  var persona = readTab_('Personas').filter(function (p) { return String(p.id) === pid; })[0];
  if (!persona) bad('La persona no existe.');
  if (String(persona.estado) === 'archivada') bad('La persona está archivada.');
  if (!isDate_(x.desde)) bad('La fecha «desde» es inválida (usá AAAA-MM-DD).');
  if (!isInt_(x.monto_centavos) || x.monto_centavos <= 0 || x.monto_centavos > 1e13) bad('El sueldo tiene que ser un entero de centavos mayor a cero.');
  if (ENUM.moneda.indexOf(x.moneda) < 0) bad('moneda debe ser ARS o USD.');
  var sheet = sheet_('Sueldos'), last = sheet.getLastRow();
  var ids = last > 1 ? sheet.getRange(2, 1, last - 1, 1).getValues() : [];
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return { ok: true, creados: 0, omitidos: [id] }; // reintento: no duplica
  var by = x.creado_por == null || x.creado_por === '' ? '' : idOf_(x.creado_por, 'creado_por');
  appendRows_(sheet, [[id, pid, x.desde, x.monto_centavos, x.moneda, text_(x.nota, 200), by, new Date().toISOString()]], TABS.Sueldos.length);
  return { ok: true, creados: 1, omitidos: [] };
}

/** Recurrentes (servicios, débitos): es configuración, se edita en el lugar. Lo que se pagó de verdad vive en Movimientos. */
function actionSaveRecurrente_(req) {
  checkSchema_();
  var x = req.recurrente, bad = function (why) { fail_('recurrente_invalido', why); };
  if (!x || typeof x !== 'object') bad('Falta el recurrente.');
  var id = idOf_(x.id, 'Recurrente');
  var sheet = sheet_('Recurrentes'), cols = TABS.Recurrentes, last = sheet.getLastRow();
  var rows = last > 1 ? sheet.getRange(2, 1, last - 1, cols.length).getValues() : [], at = -1, old = null;
  for (var i = 0; i < rows.length; i++) if (String(rows[i][0]) === id) { at = i; old = {}; cols.forEach(function (c, k) { old[c] = rows[i][k]; }); break; }
  var has = function (k) { return x[k] !== undefined && x[k] !== null; };
  var v = {
    id: id,
    descripcion: has('descripcion') ? text_(x.descripcion, 80) : (old ? String(old.descripcion) : ''),
    monto_estimado_centavos: has('monto_estimado_centavos') ? x.monto_estimado_centavos : (old ? Number(old.monto_estimado_centavos) : null),
    moneda: has('moneda') ? x.moneda : (old ? String(old.moneda) : 'ARS'),
    dia_mes: has('dia_mes') ? x.dia_mes : (old ? Number(old.dia_mes) : null),
    categoria: has('categoria') ? text_(x.categoria, 40) : (old ? String(old.categoria) : 'otros'),
    pagador_id: has('pagador_id') ? x.pagador_id : (old ? String(old.pagador_id) : ''),
    proximo_vencimiento: has('proximo_vencimiento') ? x.proximo_vencimiento : (old ? String(old.proximo_vencimiento) : ''),
    activo: has('activo') ? x.activo === true : (old ? bool_(old.activo) : true),
    ajuste_meses: has('ajuste_meses') ? x.ajuste_meses : (old ? Number(old.ajuste_meses) || 0 : 0),
    proximo_ajuste: has('proximo_ajuste') ? x.proximo_ajuste : (old ? String(old.proximo_ajuste) : '')
  };
  if (!v.descripcion) bad('Poné una descripción.');
  if (!isInt_(v.monto_estimado_centavos) || v.monto_estimado_centavos <= 0 || v.monto_estimado_centavos > 1e13) bad('El monto tiene que ser un entero de centavos mayor a cero.');
  if (ENUM.moneda.indexOf(v.moneda) < 0) bad('moneda debe ser ARS o USD.');
  if (!isInt_(v.dia_mes) || v.dia_mes < 1 || v.dia_mes > 31) bad('El día del mes tiene que ir de 1 a 31.');
  if (!isDate_(v.proximo_vencimiento)) bad('El próximo vencimiento es inválido (usá AAAA-MM-DD).');
  if (!isInt_(v.ajuste_meses) || v.ajuste_meses < 0 || v.ajuste_meses > 24) bad('El ajuste va de 0 (sin ajuste) a 24 meses.');
  if (v.ajuste_meses > 0 && !isDate_(v.proximo_ajuste)) bad('Poné la fecha del próximo ajuste (AAAA-MM-DD).');
  if (v.ajuste_meses === 0) v.proximo_ajuste = '';
  var persona = readTab_('Personas').filter(function (p) { return String(p.id) === v.pagador_id; })[0];
  if (!persona) bad('El pagador no existe en Personas.');
  var row = [v.id, v.descripcion, v.monto_estimado_centavos, v.moneda, v.dia_mes, v.categoria, v.pagador_id, v.proximo_vencimiento, v.activo ? 'TRUE' : 'FALSE', v.ajuste_meses, v.proximo_ajuste];
  if (at >= 0) sheet.getRange(at + 2, 1, 1, cols.length).setValues([row]);
  else appendRows_(sheet, [row], cols.length);
  return { ok: true, creado: at < 0 };
}

/** Eventos y viajes: configuración que se edita en el lugar (nombre, fechas, cerrado/abierto). Sus gastos viven en Movimientos con evento_id. */
function actionSaveEvento_(req) {
  checkSchema_(['Eventos']);
  var x = req.evento, bad = function (why) { fail_('evento_invalido', why); };
  if (!x || typeof x !== 'object') bad('Falta el evento.');
  var id = idOf_(x.id, 'Evento');
  var sheet = sheet_('Eventos'), cols = TABS.Eventos, last = sheet.getLastRow();
  var rows = last > 1 ? sheet.getRange(2, 1, last - 1, cols.length).getValues() : [], at = -1, old = null;
  for (var i = 0; i < rows.length; i++) if (String(rows[i][0]) === id) { at = i; old = {}; cols.forEach(function (c, k) { old[c] = cell_(rows[i][k]); }); break; }
  var has = function (k) { return x[k] !== undefined && x[k] !== null; };
  var v = {
    id: id,
    nombre: has('nombre') ? text_(x.nombre, 60) : (old ? String(old.nombre) : ''),
    moneda: has('moneda') ? x.moneda : (old ? String(old.moneda) : 'ARS'),
    desde: has('desde') ? x.desde : (old ? String(old.desde) : ''),
    hasta: has('hasta') ? x.hasta : (old ? String(old.hasta) : ''),
    estado: has('estado') ? x.estado : (old ? String(old.estado) : 'abierto')
  };
  if (!v.nombre) bad('Ponele un nombre al evento.');
  if (ENUM.moneda.indexOf(v.moneda) < 0) bad('moneda debe ser ARS o USD.');
  if (v.desde !== '' && !isDate_(v.desde)) bad('La fecha de inicio es inválida (usá AAAA-MM-DD).');
  if (v.hasta !== '' && !isDate_(v.hasta)) bad('La fecha de fin es inválida (usá AAAA-MM-DD).');
  if (ENUM.estado_evento.indexOf(v.estado) < 0) bad('estado debe ser abierto o cerrado.');
  if (old && v.moneda !== String(old.moneda)) {   // cambiar la moneda con gastos cargados dejaría números mezclados
    var usado = readTab_('Movimientos').some(function (m) { return String(m.evento_id) === id; });
    if (usado) bad('Ya tiene gastos: no se puede cambiar la moneda del evento.');
  }
  var por = x.creado_por == null || x.creado_por === '' ? '' : idOf_(x.creado_por, 'creado_por');
  var row = [v.id, v.nombre, v.moneda, v.desde, v.hasta, v.estado, old ? String(old.creado_por) : por, old ? String(old.creado_en) : new Date().toISOString()];
  if (at >= 0) sheet.getRange(at + 2, 1, 1, cols.length).setValues([row]);
  else appendRows_(sheet, [row], cols.length);
  return { ok: true, creado: at < 0 };
}
function eventoOut_(r) {
  return { id: String(r.id), nombre: String(r.nombre), moneda: String(r.moneda), desde: String(r.desde), hasta: String(r.hasta), estado: String(r.estado) || 'abierto', creado_por: String(r.creado_por) };
}

function actionAddMovimientos_(req) {
  checkSchema_(['Personas', 'Movimientos', 'Lotes']);
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

  var eventos = null, batchIds = {}, rows = [], omitidos = [], reemplazados = [], nuevos = [];
  var now = new Date().toISOString();
  list.forEach(function (m, i) {
    var n = normMov_(m, i, personas);
    if (batchIds[n.id]) fail_('movimiento_invalido', 'Movimiento #' + (i + 1) + ': id repetido en el pedido (' + n.id + ').');
    batchIds[n.id] = true;
    if (n.lote_id && !(lote && lote.id === n.lote_id) && !lotes[n.lote_id]) {
      fail_('movimiento_invalido', 'Movimiento #' + (i + 1) + ': el lote ' + n.lote_id + ' no existe.');
    }
    if (n.evento_id) {
      if (!eventos) { eventos = {}; readTab_('Eventos').forEach(function (v) { eventos[String(v.id)] = true; }); }
      if (!eventos[n.evento_id]) fail_('movimiento_invalido', 'Movimiento #' + (i + 1) + ': el evento ' + n.evento_id + ' no existe.');
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
    if (!n.reemplaza_id) nuevos.push(n);
  });

  if (lote && !lotes[lote.id]) {
    appendRows_(sheet_('Lotes'), [[lote.id, lote.origen, lote.archivo, lote.fecha, lote.cantidad == null ? rows.length : lote.cantidad, lote.moneda_original, 'activo']], TABS.Lotes.length);
  }
  if (rows.length) appendRows_(sheet, rows, TABS.Movimientos.length);
  // Editar = agregar el nuevo y anular el viejo, en el mismo pedido y bajo el mismo lock.
  if (reemplazados.length) anular_(function (row) { return reemplazados.indexOf(row.id) >= 0; });
  // Aviso al otro celular. Nunca puede romper la carga: si falla, se ignora.
  if (!lote && nuevos.length && nuevos.length <= 3) { try { avisarMovimientos_(nuevos); } catch (e) { console.error('aviso: ' + e.message); } }
  return { ok: true, agregados: rows.length, omitidos: omitidos, reemplazados: reemplazados.length };
}

function actionAnularMovimientos_(req) {
  checkSchema_(['Movimientos']);
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
  checkSchema_(['Movimientos', 'Lotes']);
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
  var evento = m.evento_id == null || m.evento_id === '' ? '' : idOf_(m.evento_id, tag);
  return {
    id: id, tipo: m.tipo, fecha: m.fecha,
    descripcion: text_(m.descripcion, 200),
    monto_centavos: m.monto_centavos, moneda: m.moneda, pagador_id: m.pagador_id,
    reparto_modo: modo, reparto_json: JSON.stringify(rep),
    excepcion: m.excepcion === true, motivo_excepcion: text_(m.motivo_excepcion, 200),
    categoria: text_(m.categoria, 40), confianza: conf == null ? '' : conf,
    nota: text_(m.nota, 500), lote_id: lote, origen: text_(m.origen || 'manual', 30) || 'manual',
    creado_por: creadoPor, reemplaza_id: reemplaza, evento_id: evento
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
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(name);
  if (!sh && TABS_NUEVAS.indexOf(name) >= 0) {  // pestañas agregadas después de v0.2: se crean solas con sus encabezados
    sh = ss.insertSheet(name); sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight('bold'); sh.setFrozenRows(1);
    if (sh.getMaxRows() < 2000) sh.insertRowsAfter(sh.getMaxRows(), 2000 - sh.getMaxRows());   // una pestaña nueva trae 1000 filas
    sh.getRange(2, 1, 1999, TABS[name].length).setNumberFormat('@');
  }
  if (!sh) fail_('esquema', 'Falta la pestaña ' + name + '.');
  return sh;
}

/** Verifica que las pestañas tengan las columnas esperadas. Sin argumento: todas; con lista: solo esas (los pedidos frecuentes no necesitan revisar las 13). */
function checkSchema_(names) {
  (names || Object.keys(TABS)).forEach(function (name) {
    var cols = TABS[name];
    var sh = sheet_(name), head = sh.getRange(1, 1, 1, cols.length).getValues()[0];
    var vieja = COLS_VIEJAS[name];
    if (vieja && cols.length > vieja) {   // hoja de una versión anterior: si las columnas viejas coinciden y las nuevas están vacías, se completa el encabezado
      var ok = true, vacias = true;
      for (var j = 0; j < vieja; j++) if (String(head[j]) !== cols[j]) ok = false;
      for (var k = vieja; k < cols.length; k++) if (String(head[k]) !== '') vacias = false;
      if (ok && vacias) {
        sh.getRange(1, vieja + 1, 1, cols.length - vieja).setValues([cols.slice(vieja)]);
        if (sh.getMaxRows() < 2000) sh.insertRowsAfter(sh.getMaxRows(), 2000 - sh.getMaxRows());
        sh.getRange(2, vieja + 1, 1999, cols.length - vieja).setNumberFormat('@');
        head = cols.slice();
      }
    }
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
    anulado: bool_(r.anulado), reemplaza_id: String(r.reemplaza_id), evento_id: String(r.evento_id)
  };
}
function sueldoOut_(r) {
  return { id: String(r.id), persona_id: String(r.persona_id), desde: String(r.desde), monto_centavos: Number(r.monto_centavos),
    moneda: String(r.moneda), nota: String(r.nota), creado_por: String(r.creado_por), creado_en: String(r.creado_en) };
}
function recOut_(r) {
  return { id: String(r.id), descripcion: String(r.descripcion), monto_estimado_centavos: Number(r.monto_estimado_centavos), moneda: String(r.moneda),
    dia_mes: Number(r.dia_mes), categoria: String(r.categoria), pagador_id: String(r.pagador_id), proximo_vencimiento: String(r.proximo_vencimiento), activo: bool_(r.activo), ajuste_meses: Number(r.ajuste_meses) || 0, proximo_ajuste: String(r.proximo_ajuste || '') };
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
    .addItem('Guardar clave de Gemini', 'guardarClaveGemini')
    .addItem('Activar avisos de vencimientos', 'activarAvisos')
    .addItem('Mandarme un resumen de ejemplo', 'resumenDeEjemplo')
    .addItem('Activar resumen mensual', 'activarResumenMensual')
    .addItem('Desactivar avisos', 'desactivarAvisos')
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
/* Categorías: memoria de comercios → Gemini → cola de dudosos          */
/* A Gemini solo viaja la descripción y el monto. Nunca nombres ni sueldos.*/
/* La clave vive en Propiedades del script (GEMINI_API_KEY).            */
/* ------------------------------------------------------------------ */

var IA = {
  KEY_PROP: 'GEMINI_API_KEY', MODEL_PROP: 'GEMINI_MODEL', MODEL: 'gemini-3.5-flash-lite',
  URL: 'https://generativelanguage.googleapis.com/v1beta/models/', CHUNK: 40, MAX_ITEMS: 150, AUTO: 0.85
};
var CATEGORIAS_IA = {
  super: 'Supermercado, verdulería, carnicería, almacén, chino, panadería, fiambrería',
  comida: 'Restaurantes, cafés, delivery, helado, salidas a comer',
  alquiler: 'Alquiler (incluye ajustes del alquiler)', expensas: 'Expensas del consorcio', luz: 'Luz (Edenor, Edesur)',
  agua: 'Agua (AySA)', gas: 'Gas (Metrogas, Naturgy)', internet: 'Internet y celular (Personal Flow, Fibertel, Telecentro)',
  streaming: 'Streaming y suscripciones (HBO Max, Netflix, Spotify, Prime, Google One)', seguro: 'Seguros',
  impuestos: 'Impuestos y tasas (ABL, ARBA, patente, monotributo)', casa: 'Casa y mantenimiento (ferretería, plomero, pintura, muebles, mudanza, limpieza)',
  transporte: 'Transporte (Uber, nafta, SUBE, peajes)', salud: 'Salud (farmacia, médico, prepaga)', ocio: 'Ocio (cine, juegos, salidas)',
  viaje: 'Viajes (hoteles, vuelos, traslados al aeropuerto)', mascota: 'Mascota (veterinaria, alimento)', regalo: 'Regalos',
  ropa: 'Ropa y calzado', otros: 'Solo si no hay forma razonable de saber'
};
var MESES_ = { enero: 1, febrero: 1, marzo: 1, abril: 1, mayo: 1, junio: 1, julio: 1, agosto: 1, septiembre: 1, setiembre: 1, octubre: 1, noviembre: 1, diciembre: 1,
  ene: 1, feb: 1, mar: 1, abr: 1, jun: 1, jul: 1, ago: 1, sep: 1, set: 1, oct: 1, nov: 1, dic: 1, y: 1, de: 1, del: 1, la: 1, el: 1, los: 1, las: 1 };

/** «COTO Abril 3/12» y «Coto marzo» → «coto»: misma regla para el mismo comercio. */
function patron_(desc) {
  var t = String(desc || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/);
  return t.filter(function (w) { return w.length > 1 && !MESES_[w]; }).slice(0, 5).join(' ');
}

function categoriaValida_(c) { return typeof c === 'string' && Object.prototype.hasOwnProperty.call(CATEGORIAS_IA, c); }

function memoriaComercios_() {
  var m = [];
  readTab_('Comercios').forEach(function (r) { if (r.patron && categoriaValida_(String(r.categoria))) m.push({ patron: String(r.patron), categoria: String(r.categoria) }); });
  return m;
}

function buscarMemoria_(mem, patron) {
  var best = null, hay = ' ' + patron + ' ';
  mem.forEach(function (x) {
    if (x.patron === patron) { best = { categoria: x.categoria, confianza: 1 }; return; }
    if ((!best || best.confianza < 1) && hay.indexOf(' ' + x.patron + ' ') >= 0 && (!best || x.patron.length > best.len)) best = { categoria: x.categoria, confianza: 0.95, len: x.patron.length };
  });
  return best;
}

function actionCategorizar_(req) {
  var items = req.items;
  if (!Array.isArray(items) || !items.length || items.length > IA.MAX_ITEMS) fail_('pedido_invalido', 'items: de 1 a ' + IA.MAX_ITEMS + '.');
  var mem = memoriaComercios_(), out = {}, porPatron = {}, orden = [];
  items.forEach(function (it) {
    var d = text_(it && it.descripcion, 80), p = patron_(d);
    if (!d || out[d]) return;
    out[d] = { descripcion: d, categoria: 'otros', confianza: 0, fuente: 'ninguna' };
    if (!p) return;
    var h = buscarMemoria_(mem, p);
    if (h) { out[d].categoria = h.categoria; out[d].confianza = h.confianza; out[d].fuente = 'memoria'; return; }
    if (!porPatron[p]) { porPatron[p] = { patron: p, descripcion: d, monto: Math.round(Math.abs(Number(it.monto_centavos) || 0) / 100), moneda: it.moneda === 'USD' ? 'USD' : 'ARS', descs: [] }; orden.push(p); }
    porPatron[p].descs.push(d);
  });
  var key = PropertiesService.getScriptProperties().getProperty(IA.KEY_PROP), error = '', usadas = 0;
  if (orden.length && key) {
    for (var i = 0; i < orden.length; i += IA.CHUNK) {
      var grupo = orden.slice(i, i + IA.CHUNK).map(function (p) { return porPatron[p]; });
      var res = gemini_(grupo, key);
      if (res.error) { error = res.error; break; }
      usadas++;
      res.items.forEach(function (r) {
        var g = grupo[r.n]; if (!g || !categoriaValida_(r.categoria)) return;
        var conf = Math.max(0, Math.min(1, Number(r.confianza) || 0));
        g.descs.forEach(function (d) { out[d].categoria = r.categoria; out[d].confianza = conf; out[d].fuente = 'gemini'; });
      });
    }
  }
  return { ok: true, resultados: Object.keys(out).map(function (k) { return out[k]; }), sin_clave: !key && orden.length > 0, gemini_llamadas: usadas, error: error };
}

/** Lee la foto o captura de un comprobante (solo comercio, monto, moneda y fecha). La imagen se manda a Gemini, se descarta al responder y nunca se guarda. */
function actionLeerComprobante_(req) {
  var img = req.imagen, mime = String(req.mime || '');
  if (typeof img !== 'string' || img.length < 100 || img.length > 2500000 || !/^[A-Za-z0-9+\/]+={0,2}$/.test(img)) fail_('pedido_invalido', 'La imagen no es válida o es muy grande.');
  if (['image/jpeg', 'image/png', 'image/webp'].indexOf(mime) < 0) fail_('pedido_invalido', 'Solo leo fotos JPG, PNG o WebP.');
  var key = PropertiesService.getScriptProperties().getProperty(IA.KEY_PROP);
  if (!key) return { ok: true, sin_clave: true };
  var model = PropertiesService.getScriptProperties().getProperty(IA.MODEL_PROP) || IA.MODEL;
  var prompt = 'Leé este comprobante o captura de un pago en Argentina. Devolvé solo: comercio (nombre corto de quien cobra o recibe), monto (el total pagado, número con decimales, sin símbolos), moneda (ARS o USD), fecha (AAAA-MM-DD, vacío si no se ve) y confianza de 0 a 1. ' +
    'Ignorá números de cuenta, CBU, tarjeta, DNI y datos personales: no los devuelvas. Si no ves un monto claro, poné monto 0. No inventes nada.';
  var body = { contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: mime, data: img } }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { comercio: { type: 'STRING' }, monto: { type: 'NUMBER' }, moneda: { type: 'STRING', enum: ['ARS', 'USD'] }, fecha: { type: 'STRING' }, confianza: { type: 'NUMBER' } }, required: ['comercio', 'monto', 'moneda', 'fecha', 'confianza'] } } };
  var r;
  try {
    var resp = UrlFetchApp.fetch(IA.URL + encodeURIComponent(model) + ':generateContent', { method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': key }, payload: JSON.stringify(body) });
    var code = resp.getResponseCode();
    if (code !== 200) return { ok: true, error: 'gemini_http_' + code };
    r = JSON.parse(JSON.parse(resp.getContentText()).candidates[0].content.parts[0].text);
  } catch (e) { return { ok: true, error: 'gemini_respuesta' }; }
  var monto = Number(r && r.monto), cents = isFinite(monto) && monto > 0 && monto < 1e11 ? Math.round(monto * 100) : 0;
  return { ok: true, comercio: text_(r && r.comercio, 60).replace(/\s+/g, ' '), monto_centavos: cents, moneda: r && r.moneda === 'USD' ? 'USD' : 'ARS',
    fecha: r && isDate_(String(r.fecha)) ? String(r.fecha) : '', confianza: Math.max(0, Math.min(1, Number(r && r.confianza) || 0)) };
}

/** Traduce una pregunta corta a una consulta ({tipo, categoria, mes}). Solo recibe el texto de la pregunta (la app ya le sacó nombres y números largos); no ve movimientos ni montos. */
function actionEntenderPregunta_(req) {
  var q = typeof req.pregunta === 'string' ? req.pregunta.replace(/[\u0000-\u001f]/g, ' ').trim() : '';
  if (q.length < 4 || q.length > 160) fail_('pedido_invalido', 'La pregunta tiene que tener entre 4 y 160 letras.');
  var hoy = /^\d{4}-\d{2}-\d{2}$/.test(String(req.hoy)) ? String(req.hoy) : new Date().toISOString().slice(0, 10);
  var key = PropertiesService.getScriptProperties().getProperty(IA.KEY_PROP);
  if (!key) return { ok: true, sin_clave: true };
  var model = PropertiesService.getScriptProperties().getProperty(IA.MODEL_PROP) || IA.MODEL, cats = Object.keys(CATEGORIAS_IA);
  var prompt = 'Un hogar en Argentina le pregunta a su app de gastos. Traducí la pregunta a una consulta. Tipos: "total" (cuánto se gastó, en un mes y quizá una categoría), "ultimo" (cuándo y cuánto fue el último gasto de una categoría), ' +
    '"deuda" (quién le debe a quién), "top" (en qué categorías se gasta más). Categorías: ' + cats.join(', ') + '. Mes en formato AAAA-MM; hoy es ' + hoy + ' ("este mes" = el mes de hoy, "el mes pasado" = el anterior). ' +
    'Si no corresponde categoría o mes, dejalos vacíos. Si la pregunta no es sobre gastos del hogar, poné tipo "ninguno". No inventes.\n\nPregunta: ' + q;
  var body = { contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { tipo: { type: 'STRING', enum: ['total', 'ultimo', 'deuda', 'top', 'ninguno'] }, categoria: { type: 'STRING' }, mes: { type: 'STRING' } }, required: ['tipo', 'categoria', 'mes'] } } };
  var r;
  try {
    var resp = UrlFetchApp.fetch(IA.URL + encodeURIComponent(model) + ':generateContent', { method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { 'x-goog-api-key': key }, payload: JSON.stringify(body) });
    var code = resp.getResponseCode();
    if (code !== 200) return { ok: true, error: 'gemini_http_' + code };
    r = JSON.parse(JSON.parse(resp.getContentText()).candidates[0].content.parts[0].text);
  } catch (e) { return { ok: true, error: 'gemini_respuesta' }; }
  var tipo = r && ['total', 'ultimo', 'deuda', 'top'].indexOf(r.tipo) >= 0 ? r.tipo : 'ninguno';
  var cat = r && categoriaValida_(String(r.categoria)) ? String(r.categoria) : '';
  var mes = r && /^\d{4}-(0[1-9]|1[0-2])$/.test(String(r.mes)) ? String(r.mes) : '';
  return { ok: true, tipo: tipo, categoria: cat, mes: mes };
}

function gemini_(grupo, key) {
  var cats = Object.keys(CATEGORIAS_IA);
  var prompt = 'Clasificá gastos de un hogar en Argentina (mayoría en pesos argentinos). Elegí UNA categoría por gasto.\n\nCategorías:\n' +
    cats.map(function (c) { return '- ' + c + ': ' + CATEGORIAS_IA[c]; }).join('\n') +
    '\n\nUsá "otros" solo si no hay forma razonable de saberlo. La confianza va de 0 a 1 (1 = seguro; menos de 0,6 = dudoso).\n\nGastos (n, descripción, monto):\n' +
    grupo.map(function (g, n) { return n + ' | ' + g.descripcion + ' | ' + g.monto + ' ' + g.moneda; }).join('\n');
  var model = PropertiesService.getScriptProperties().getProperty(IA.MODEL_PROP) || IA.MODEL;
  var body = { contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json',
      responseSchema: { type: 'ARRAY', items: { type: 'OBJECT', properties: { n: { type: 'INTEGER' }, categoria: { type: 'STRING', enum: cats }, confianza: { type: 'NUMBER' } }, required: ['n', 'categoria', 'confianza'] } } } };
  try {
    var resp = UrlFetchApp.fetch(IA.URL + encodeURIComponent(model) + ':generateContent', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-goog-api-key': key }, payload: JSON.stringify(body) });
    var code = resp.getResponseCode();
    if (code !== 200) return { error: 'gemini_http_' + code + (code === 400 || code === 403 ? ' (¿clave o modelo?)' : '') };
    var txt = JSON.parse(resp.getContentText()).candidates[0].content.parts[0].text;
    var arr = JSON.parse(txt);
    return Array.isArray(arr) ? { items: arr } : { error: 'gemini_respuesta' };
  } catch (e) { return { error: 'gemini: ' + String(e.message).slice(0, 100).replace(key, '***') }; }
}

/** Una corrección del usuario se vuelve regla de comercio. */
function aprenderComercio_(descripcion, categoria, now) {
  var p = patron_(descripcion); if (!p || !categoriaValida_(categoria) || categoria === 'otros') return false;
  var sh = sheet_('Comercios'), last = sh.getLastRow(), cols = TABS.Comercios;
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, cols.length).getValues();
    for (var i = 0; i < vals.length; i++) if (String(vals[i][0]) === p) {
      sh.getRange(i + 2, 3, 1, 3).setValues([[categoria, (Number(vals[i][3]) || 0) + 1, now]]); return true;
    }
  }
  appendRows_(sh, [[p, text_(descripcion, 60), categoria, 1, now]], cols.length);
  return true;
}

function actionAprender_(req) {
  checkSchema_();
  var ok = aprenderComercio_(text_(req.descripcion, 80), String(req.categoria), new Date().toISOString());
  return { ok: true, aprendida: ok };
}

function etiquetaOut_(r) {
  return { id: String(r.id), movimiento_id: String(r.movimiento_id), categoria: String(r.categoria), confianza: Number(r.confianza) || 0, fuente: String(r.fuente), estado: String(r.estado) };
}

/** Las categorías de movimientos que ya existen no los tocan: se agregan como etiquetas (la última gana). */
function actionEtiquetar_(req) {
  checkSchema_();
  var list = req.etiquetas;
  if (!Array.isArray(list) || !list.length || list.length > CUBA.MAX_BATCH) fail_('pedido_invalido', 'etiquetas: de 1 a ' + CUBA.MAX_BATCH + '.');
  var movs = {}; readTab_('Movimientos').forEach(function (m) { movs[String(m.id)] = String(m.descripcion); });
  var vistas = {}; readTab_('Etiquetas').forEach(function (e) { vistas[String(e.id)] = true; });
  var now = new Date().toISOString(), rows = [], aprendidas = {}, por = text_(req.creado_por, 40);
  list.forEach(function (x) {
    var id = text_(x && x.id, 40), mid = text_(x && x.movimiento_id, 40);
    if (!id || vistas[id] || !movs.hasOwnProperty(mid) || !categoriaValida_(x.categoria)) return;
    var fuente = ['memoria', 'gemini', 'manual'].indexOf(x.fuente) >= 0 ? x.fuente : 'manual';
    var estado = x.estado === 'dudosa' ? 'dudosa' : 'aplicada';
    var conf = Math.max(0, Math.min(1, Number(x.confianza) || 0));
    vistas[id] = true;
    rows.push([id, mid, x.categoria, conf, fuente, estado, por, now]);
    if (fuente === 'manual' && estado === 'aplicada' && !aprendidas[patron_(movs[mid])]) { aprendidas[patron_(movs[mid])] = true; aprenderComercio_(movs[mid], x.categoria, now); }
  });
  if (rows.length) appendRows_(sheet_('Etiquetas'), rows, TABS.Etiquetas.length);
  return { ok: true, agregadas: rows.length, omitidas: list.length - rows.length };
}

function guardarClaveGemini() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Clave de Gemini', 'Pegá la clave de la API de Gemini (queda solo en las Propiedades del script, no en la Sheet):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var k = r.getResponseText().replace(/[\s"']/g, '');
  if (!/^[A-Za-z0-9_.\-]{20,}$/.test(k)) { ui.alert('Esa clave no parece válida. No se guardó nada.'); return; }
  PropertiesService.getScriptProperties().setProperty(IA.KEY_PROP, k);
  var res = gemini_([{ descripcion: 'Coto', monto: 20000, moneda: 'ARS' }], k);
  ui.alert(res.error ? 'Guardada, pero la prueba falló: ' + res.error : 'Listo: Gemini responde (' + (res.items[0] ? res.items[0].categoria : '?') + ' para «Coto»).');
}

/* ------------------------------------------------------------------ */
/* Avisos de vencimientos: mail + notificación nativa en el celu        */
/* (ntfy: app gratuita, push real en iPhone y Android, sin servidor).   */
/* El tema de ntfy es un texto al azar guardado solo en Propiedades.    */
/* Al celu NUNCA van montos ni nombres: solo "vence Luz en 2 días".     */
/* ------------------------------------------------------------------ */

var AVISO = { DIAS: 3, TZ: 'America/Argentina/Buenos_Aires', HORA: 9, NTFY: 'https://ntfy.sh/',
  TOPIC_PROP: 'CUBA_NTFY_TOPICS', MAILS_PROP: 'CUBA_MAILS', SENT_PROP: 'CUBA_AVISADOS', FN: 'avisarVencimientos' };

function dayNum_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : NaN;
}

/** Qué hay que avisar hoy. Una vez por etapa (pronto / hoy / vencido) y vencimiento. Pura: no manda nada. */
function avisosPendientes_(recs, hoy, yaAvisados) {
  var out = [], h = dayNum_(hoy);
  recs.forEach(function (r) {
    if (!bool_(r.activo)) return;
    var d = dayNum_(r.proximo_vencimiento) - h;
    if (isNaN(d) || d > AVISO.DIAS) return;
    var etapa = d < 0 ? 'vencido' : d === 0 ? 'hoy' : 'pronto';
    var key = r.id + '|' + String(r.proximo_vencimiento).slice(0, 10) + '|' + etapa;
    if (yaAvisados.indexOf(key) >= 0) return;
    out.push({ key: key, id: String(r.id), descripcion: String(r.descripcion), monto: Number(r.monto_estimado_centavos),
      moneda: String(r.moneda), dias: d, etapa: etapa });
  });
  out.sort(function (a, b) { return a.dias - b.dias; });
  return out;
}

function cuandoTxt_(d) {
  return d < 0 ? 'venció hace ' + (-d) + (d === -1 ? ' día' : ' días') : d === 0 ? 'vence hoy' : d === 1 ? 'vence mañana' : 'vence en ' + d + ' días';
}
function plata_(c, mon) {
  var n = Math.round(Math.abs(c)) / 100;
  return (mon === 'USD' ? 'US$ ' : '$ ') + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, '.').replace(/\.(\d\d)$/, ',$1');
}

/** Disparador diario. `hoy` solo se pasa en las pruebas. */
function avisarVencimientos(hoy) {
  hoy = typeof hoy === 'string' ? hoy : Utilities.formatDate(new Date(), AVISO.TZ, 'yyyy-MM-dd');
  try { avisarResumenes_(hoy); } catch (e) { console.error('resúmenes: ' + e.message); }
  var props = PropertiesService.getScriptProperties();
  var sent = []; try { sent = JSON.parse(props.getProperty(AVISO.SENT_PROP) || '[]'); } catch (e) { sent = []; }
  var list = avisosPendientes_(readTab_('Recurrentes'), hoy, sent);
  if (!list.length) return { avisos: 0 };
  var mails = String(props.getProperty(AVISO.MAILS_PROP) || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  var ok = { push: false, mail: false }, errores = [];
  var corto = list.map(function (a) { return a.descripcion + ' ' + cuandoTxt_(a.dias); }).join(' · ');
  var titulo = '🐕 Cuba: ' + (list.length === 1 ? 'un vencimiento' : list.length + ' vencimientos');
  var prio = list.some(function (a) { return a.dias <= 0; }) ? 4 : 3;
  var topics = topicsOf_(); 
  Object.keys(topics).forEach(function (pid) {
    var r = ntfy_(topics[pid], titulo, corto, prio);
    if (r === true) ok.push = true; else errores.push(r);
  });
  if (mails.length) {
    try {
      var cuerpo = '¡Guau! Esto se viene:\n\n' + list.map(function (a) {
        return '• ' + a.descripcion + ' (' + plata_(a.monto, a.moneda) + ' aprox.): ' + cuandoTxt_(a.dias);
      }).join('\n') + '\n\nCuando lo pagues, anotalo en Cuba y el próximo vencimiento se corre solo:\n' + CUBA.APP_URL + '\n\n— Cuba';
      MailApp.sendEmail(mails.join(','), '🐕 Cuba: ' + corto, cuerpo, { name: 'Cuba 🐕' });
      ok.mail = true;
    } catch (e) { errores.push('mail: ' + e.message); }
  }
  // Solo se da por avisado si salió por algún canal; si no, mañana reintenta.
  if (ok.push || ok.mail) {
    list.forEach(function (a) { sent.push(a.key); });
    props.setProperty(AVISO.SENT_PROP, JSON.stringify(sent.slice(-80)));
  }
  return { avisos: list.length, push: ok.push, mail: ok.mail, errores: errores };
}

function topicsOf_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(AVISO.TOPIC_PROP) || '{}') || {}; } catch (e) { return {}; }
}

/** Manda una notificación nativa por ntfy (JSON: soporta acentos y emojis). Devuelve true o el motivo del fallo. */
function ntfy_(topic, title, message, priority) {
  try {
    var resp = UrlFetchApp.fetch(AVISO.NTFY, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ topic: topic, title: title, message: message, tags: ['dog'], click: CUBA.APP_URL, priority: priority || 3 }) });
    return resp.getResponseCode() === 200 ? true : 'ntfy ' + resp.getResponseCode();
  } catch (e) { return 'ntfy: ' + e.message; }
}

/** «Tomi anotó Super» al celu del otro. Sin montos. Solo cargas chicas (no importaciones). */
function avisarMovimientos_(nuevos) {
  var topics = topicsOf_();
  if (!Object.keys(topics).length) return;
  var personas = {}; readTab_('Personas').forEach(function (p) { personas[p.id] = p; });
  var quien = personas[nuevos[0].creado_por];
  if (!quien) return;
  var que = nuevos.length === 1
    ? (nuevos[0].tipo === 'pago' ? 'anotó un pago: ' : 'anotó ') + String(nuevos[0].descripcion).slice(0, 60)
    : 'anotó ' + nuevos.length + ' movimientos';
  Object.keys(topics).forEach(function (pid) {
    if (pid === String(quien.id) || !personas[pid] || String(personas[pid].estado) === 'archivada') return;
    ntfy_(topics[pid], '🐕 ' + quien.nombre, quien.nombre + ' ' + que, 3);
  });
}

function activarAvisos() {
  var ui = SpreadsheetApp.getUi(), props = PropertiesService.getScriptProperties();
  var yo = ''; try { yo = Session.getEffectiveUser().getEmail(); } catch (e) { yo = ''; }
  var r = ui.prompt('Avisos por mail', 'Mails que reciben los avisos, separados por coma (el tuyo y el de tu pareja):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var mails = r.getResponseText().split(',').map(function (x) { return x.trim(); }).filter(function (x) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); });
  if (!mails.length && yo) mails = [yo];
  props.setProperty(AVISO.MAILS_PROP, mails.join(','));
  var topics = topicsOf_(), lineas = [];
  readTab_('Personas').forEach(function (p) {
    if (String(p.estado) === 'archivada') return;
    if (!topics[p.id]) topics[p.id] = 'cuba-' + newToken_().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
    lineas.push(p.nombre + ': ' + topics[p.id]);
  });
  props.setProperty(AVISO.TOPIC_PROP, JSON.stringify(topics));
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === AVISO.FN || t.getHandlerFunction() === 'resumenMensual') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger(AVISO.FN).timeBased().everyDays(1).atHour(AVISO.HORA).inTimezone(AVISO.TZ).create();
  var res = enviarPrueba_(topics, mails);
  ui.alert('Avisos activados',
    'Todos los días a las ' + AVISO.HORA + ' revisa los vencimientos.\n\nMail a: ' + mails.join(', ') + (res.mail ? ' ✓ (te mandé uno de prueba)' : ' ✗ ' + res.err) +
    '\n\nNotificación en el celu: cada uno instala la app gratuita «ntfy», toca "+" y se suscribe a SU tema:\n\n' + lineas.join('\n') +
    '\n\n(Son temas privados: no los compartas. Al celu nunca van montos.)', ui.ButtonSet.OK);
}

function enviarPrueba_(topics, mails) {
  var res = { mail: false, push: false, err: '' };
  try { MailApp.sendEmail(mails.join(','), '🐕 Cuba: avisos activados', 'Listo, a partir de ahora te aviso cuando se acerque un vencimiento.\n' + CUBA.APP_URL, { name: 'Cuba 🐕' }); res.mail = true; } catch (e) { res.err = e.message; }
  Object.keys(topics).forEach(function (pid) { if (ntfy_(topics[pid], '🐕 Cuba', 'Avisos activados. ¡Guau!') === true) res.push = true; });
  return res;
}

function desactivarAvisos() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === AVISO.FN) ScriptApp.deleteTrigger(t); });
  SpreadsheetApp.getUi().alert('Avisos desactivados.');
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


/* ------------------------------------------------------------------ */
/* Resumen mensual por mail (sin saldos ni sueldos)                    */
/* ------------------------------------------------------------------ */

var MESES_MAIL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
var MAIL_IMG = CUBA.APP_URL + 'assets/cuba/mail_feliz.png';

function mesAnterior_(mk) { var y = +mk.slice(0, 4), m = +mk.slice(5, 7) - 1; m--; if (m < 0) { m = 11; y--; } return y + '-' + ('0' + (m + 1)).slice(-2); }
function mesLabel_(mk) { return MESES_MAIL[+mk.slice(5, 7) - 1] + ' ' + mk.slice(0, 4); }

/** Números del mes por moneda. Puro: lo prueban los tests. Las etiquetas aplicadas pisan la categoría del movimiento. */
function datosResumen_(movs, etiquetas, categorias, mk) {
  var etq = {}; (etiquetas || []).forEach(function (t) { if (t.estado === 'aplicada') etq[t.movimiento_id] = t.categoria; });
  var nombres = {}; (categorias || []).forEach(function (c) { nombres[c.id] = { n: c.nombre, e: c.emoji }; });
  var prev = mesAnterior_(mk), por = {};
  movs.forEach(function (m) {
    if (m.anulado || m.tipo === 'pago') return;
    var k = String(m.fecha).slice(0, 7); if (k !== mk && k !== prev) return;
    var cur = m.moneda, d = por[cur] = por[cur] || { moneda: cur, total: 0, prev: 0, cuenta: 0, cats: {}, catsPrev: {}, mayor: null };
    var cat = etq[m.id] || m.categoria || 'otros';
    if (k === prev) { d.prev += m.monto_centavos; d.catsPrev[cat] = (d.catsPrev[cat] || 0) + m.monto_centavos; return; }
    d.total += m.monto_centavos; d.cuenta++; d.cats[cat] = (d.cats[cat] || 0) + m.monto_centavos;
    if (!d.mayor || m.monto_centavos > d.mayor.monto) d.mayor = { descripcion: m.descripcion, monto: m.monto_centavos };
  });
  var out = Object.keys(por).map(function (c) { return por[c]; }).filter(function (d) { return d.cuenta > 0; });
  out.forEach(function (d) {
    d.lista = Object.keys(d.cats).map(function (k) {
      var info = nombres[k] || { n: k, e: '📦' };
      return { id: k, nombre: info.n, emoji: info.e, monto: d.cats[k], pct: d.total ? Math.round(d.cats[k] * 100 / d.total) : 0, antes: d.catsPrev[k] || 0 };
    }).sort(function (a, b) { return b.monto - a.monto; });
    d.variacion = d.prev ? Math.round((d.total - d.prev) * 100 / d.prev) : null;
  });
  out.sort(function (a, b) { return b.total - a.total; });
  return { mes: mk, monedas: out };
}

/** Un tip simple a partir de los números (sin IA). */
function tipResumen_(d) {
  if (!d) return 'Todavía no hay gastos este mes. ¡Anotá el primero y yo me encargo del resto!';
  var top = d.lista[0], sube = d.lista.filter(function (c) { return c.antes > 0 && c.monto > c.antes * 1.25 && c.monto - c.antes > d.total * 0.03; })[0];
  if (sube) return 'Ojo con ' + sube.emoji + ' ' + sube.nombre + ': subió ' + Math.round((sube.monto - sube.antes) * 100 / sube.antes) + '% contra el mes anterior. Vale la pena mirarlo.';
  if (d.variacion !== null && d.variacion <= -5) return '¡Buen mes! Gastaron ' + Math.abs(d.variacion) + '% menos que el anterior. Cuba mueve la cola.';
  if (top && top.pct >= 50) return top.emoji + ' ' + top.nombre + ' se lleva más de la mitad del mes. Si algo se puede ajustar, empezaría por ahí.';
  return 'Revisá los gastos en «Otros»: si los categorizás, el resumen del mes que viene es más preciso.';
}

function fmtMail_(c, mon) { var n = Math.round(Math.abs(c) / 100); return (mon === 'USD' ? 'US$ ' : '$') + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function escMail_(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/** HTML de mail: tablas e estilos en línea, que es lo único que respetan Gmail y Outlook. Colores de la app. */
function htmlResumen_(datos, ejemplo) {
  var INK = '#1b1a1f', MUT = '#7b7468', ACC = '#c47a35', LINE = '#e7dccb', CARD = '#fffaf2', BG = '#f7f1e8', POS = '#2f7d5b', NEG = '#b3402f';
  var h = '<!DOCTYPE html><html lang="es"><body style="margin:0;padding:0;background:' + BG + ';">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + BG + ';"><tr><td align="center" style="padding:24px 12px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:' + INK + ';">' +
    '<tr><td align="center" style="padding:4px 0 6px;"><img src="' + MAIL_IMG + '" width="132" alt="Cuba" style="display:block;border:0;height:auto;"></td></tr>' +
    '<tr><td align="center" style="padding:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:' + MUT + ';">' + (ejemplo ? 'Ejemplo · ' : '') + 'Resumen de ' + escMail_(mesLabel_(datos.mes)) + '</td></tr>' +
    '<tr><td align="center" style="padding:0 0 18px;font-size:22px;font-weight:700;">¡Guau! Así les fue este mes</td></tr>';
  if (!datos.monedas.length) {
    h += '<tr><td style="background:' + CARD + ';border:1px solid ' + LINE + ';border-radius:20px;padding:22px;text-align:center;color:' + MUT + ';">No hubo gastos anotados en ' + escMail_(mesLabel_(datos.mes)) + '.</td></tr>';
  }
  datos.monedas.forEach(function (d, i) {
    var v = d.variacion === null ? '' : '<div style="font-size:14px;color:' + (d.variacion > 0 ? NEG : POS) + ';margin-top:4px;">' + (d.variacion > 0 ? '▲ ' : '▼ ') + Math.abs(d.variacion) + '% vs. mes anterior (' + fmtMail_(d.prev, d.moneda) + ')</div>';
    h += '<tr><td style="padding:0 0 14px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + CARD + ';border:1px solid ' + LINE + ';border-radius:20px;"><tr><td style="padding:20px 20px 8px;">' +
      '<div style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:' + MUT + ';">Total del mes' + (datos.monedas.length > 1 ? ' · ' + escMail_(d.moneda) : '') + '</div>' +
      '<div style="font-size:36px;font-weight:800;line-height:1.15;margin-top:4px;">' + fmtMail_(d.total, d.moneda) + '</div>' +
      '<div style="font-size:14px;color:' + MUT + ';margin-top:2px;">' + d.cuenta + (d.cuenta === 1 ? ' gasto' : ' gastos') + (d.mayor ? ' · el más grande: ' + escMail_(d.mayor.descripcion) + ' (' + fmtMail_(d.mayor.monto, d.moneda) + ')' : '') + '</div>' + v +
      '</td></tr><tr><td style="padding:8px 20px 18px;">';
    d.lista.slice(0, 6).forEach(function (c) {
      h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 0;"><tr><td style="font-size:15px;">' + c.emoji + ' ' + escMail_(c.nombre) + '</td>' +
        '<td align="right" style="font-size:15px;font-weight:700;">' + fmtMail_(c.monto, d.moneda) + ' <span style="font-weight:400;color:' + MUT + ';font-size:13px;">&nbsp;' + c.pct + '%</span></td></tr>' +
        '<tr><td colspan="2" style="padding-top:5px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + LINE + ';border-radius:99px;"><tr><td width="' + Math.max(c.pct, 2) + '%" style="background:' + ACC + ';border-radius:99px;font-size:1px;line-height:7px;height:7px;">&nbsp;</td><td style="font-size:1px;line-height:7px;">&nbsp;</td></tr></table></td></tr></table>';
    });
    h += '</td></tr></table></td></tr>';
    if (i === 0) h += '<tr><td style="padding:0 0 14px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3e2cc;border-radius:16px;"><tr><td style="padding:14px 18px;font-size:15px;line-height:1.45;">🐕 <b>Tip de Cuba:</b> ' + escMail_(tipResumen_(d)) + '</td></tr></table></td></tr>';
  });
  h += '<tr><td align="center" style="padding:6px 0 4px;"><a href="' + CUBA.APP_URL + '" style="display:inline-block;background:' + ACC + ';color:#ffffff;text-decoration:none;font-weight:700;border-radius:14px;padding:13px 26px;font-size:16px;">Abrir Cuba</a></td></tr>' +
    '<tr><td align="center" style="padding:14px 0 0;font-size:12px;color:' + MUT + ';">Este resumen no incluye sueldos ni saldos. Los saldos están en el cierre de mes de la app.</td></tr>' +
    '</table></td></tr></table></body></html>';
  return h;
}

function textoResumen_(datos) {
  var t = '🐕 Cuba · resumen de ' + mesLabel_(datos.mes) + '\n\n';
  if (!datos.monedas.length) return t + 'No hubo gastos anotados.\n' + CUBA.APP_URL;
  datos.monedas.forEach(function (d) {
    t += 'Total ' + d.moneda + ': ' + fmtMail_(d.total, d.moneda) + ' (' + d.cuenta + ' gastos)\n' + d.lista.slice(0, 6).map(function (c) { return ' · ' + c.nombre + ': ' + fmtMail_(c.monto, d.moneda) + ' (' + c.pct + '%)'; }).join('\n') + '\n\n';
  });
  return t + tipResumen_(datos.monedas[0]) + '\n' + CUBA.APP_URL;
}

function armarResumen_(mk, ejemplo) {
  var datos = datosResumen_(readTab_('Movimientos').map(movOut_).filter(function (m) { return !m.evento_id; }), readTab_('Etiquetas').map(etiquetaOut_), readTab_('Categorias'), mk);
  return { asunto: '🐕 Cuba · ' + (ejemplo ? 'ejemplo de resumen de ' : 'resumen de ') + mesLabel_(mk), html: htmlResumen_(datos, ejemplo), texto: textoResumen_(datos), datos: datos };
}

/** Disparador mensual (día 1): resume el mes que terminó. */
function resumenMensual(hoy) {
  hoy = typeof hoy === 'string' ? hoy : Utilities.formatDate(new Date(), AVISO.TZ, 'yyyy-MM');
  var r = armarResumen_(mesAnterior_(hoy), false);
  var mails = String(PropertiesService.getScriptProperties().getProperty(AVISO.MAILS_PROP) || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  if (!mails.length) return { enviado: false, motivo: 'sin_mails' };
  MailApp.sendEmail({ to: mails.join(','), subject: r.asunto, htmlBody: r.html, body: r.texto, name: 'Cuba 🐕' });
  return { enviado: true, a: mails.length };
}

/** Menú: se lo manda solo a quien lo pide, con el último mes que tenga gastos. */
function resumenDeEjemplo() {
  var ui = SpreadsheetApp.getUi(), yo = Session.getEffectiveUser().getEmail();
  var hoy = Utilities.formatDate(new Date(), AVISO.TZ, 'yyyy-MM'), mk = hoy, r = armarResumen_(hoy, true);
  if (!r.datos.monedas.length) { mk = mesAnterior_(hoy); r = armarResumen_(mk, true); }
  MailApp.sendEmail({ to: yo, subject: r.asunto, htmlBody: r.html, body: r.texto, name: 'Cuba 🐕' });
  ui.alert('Te mandé un resumen de ejemplo (' + mesLabel_(mk) + ') a ' + yo + '. Si no lo ves, mirá spam.');
}

function activarResumenMensual() {
  var ui = SpreadsheetApp.getUi();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'resumenMensual') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('resumenMensual').timeBased().onMonthDay(1).atHour(9).inTimezone(AVISO.TZ).create();
  ui.alert('Listo: el día 1 de cada mes (9 h) les llega el resumen del mes anterior a los mails de los avisos. Para ver cómo queda, usá «Mandarme un resumen de ejemplo».');
}


/* ------------------------------------------------------------------ */
/* Resúmenes de tarjeta: qué es compartido y cuándo falta subir uno    */
/* ------------------------------------------------------------------ */

function resumenOut_(r) {
  return { id: String(r.id), tarjeta: String(r.tarjeta), persona_id: String(r.persona_id), cierre: String(r.cierre), vencimiento: String(r.vencimiento),
    proximo_cierre: String(r.proximo_cierre), consumos: Number(r.consumos) || 0, compartidos: Number(r.compartidos) || 0 };
}

/** Anota que un resumen ya se subió (no guarda los consumos: los compartidos son movimientos y lo demás no se guarda). Idempotente. */
function actionRegistrarResumen_(req) {
  checkSchema_(['Resumenes']);
  var persona = idOf_(req.persona_id, 'persona_id'), tarjeta = text_(req.tarjeta, 40);
  if (!tarjeta) fail_('pedido_invalido', 'Falta la tarjeta.');
  var cierre = req.cierre, venc = req.vencimiento || '', prox = req.proximo_cierre || '';
  if (!isDate_(cierre)) fail_('pedido_invalido', 'cierre: fecha inválida.');
  if (venc && !isDate_(venc)) fail_('pedido_invalido', 'vencimiento: fecha inválida.');
  if (prox && !isDate_(prox)) fail_('pedido_invalido', 'proximo_cierre: fecha inválida.');
  var id = (tarjeta + '_' + persona + '_' + cierre).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  var hay = readTab_('Resumenes').some(function (r) { return String(r.id) === id; });
  if (hay) return { ok: true, duplicado: true };
  appendRows_(sheet_('Resumenes'), [[id, tarjeta, persona, cierre, venc, prox, Math.max(0, Number(req.consumos) || 0), Math.max(0, Number(req.compartidos) || 0), text_(req.creado_por, 40), new Date().toISOString()]], TABS.Resumenes.length);
  return { ok: true, id: id };
}

/** «Este comercio es compartido / personal»: lo ven los dos, porque la Sheet es una sola. */
function actionAprenderResumen_(req) {
  checkSchema_(['ReglasResumen', 'Comercios', 'Resumenes']);
  var list = req.reglas;
  if (!Array.isArray(list) || !list.length || list.length > 300) fail_('pedido_invalido', 'reglas: de 1 a 300.');
  var sh = sheet_('ReglasResumen'), cols = TABS.ReglasResumen, last = sh.getLastRow(), now = new Date().toISOString();
  var vals = last >= 2 ? sh.getRange(2, 1, last - 1, cols.length).getValues() : [], pos = {};
  vals.forEach(function (r, i) { pos[String(r[0])] = i; });
  var nuevas = [], cambios = 0;
  list.forEach(function (x) {
    var p = patron_(text_(x && x.descripcion, 80)); if (!p) return;
    var comparte = x.comparte === 'si' ? 'si' : x.comparte === 'no' ? 'no' : ''; if (!comparte) return;
    var cat = categoriaValida_(x.categoria) ? x.categoria : '';
    if (pos.hasOwnProperty(p)) {
      var i = pos[p];
      if (i >= vals.length) {                                     // ya la agregué en este mismo pedido (el mismo comercio dos veces en el resumen)
        var nu = nuevas[i - vals.length]; nu[1] = comparte; nu[2] = cat || nu[2]; nu[3] = Number(nu[3]) + 1; nu[4] = now;
      } else {
        var row = vals[i], nv = [comparte, cat || row[2], (Number(row[3]) || 0) + 1, now];
        vals[i] = [row[0]].concat(nv); cambios++;                 // varias veces en el pedido: se suma sobre lo ya acumulado
        sh.getRange(i + 2, 2, 1, 4).setValues([nv]);
      }
    } else { pos[p] = vals.length + nuevas.length; nuevas.push([p, comparte, cat, 1, now]); }
    if (comparte === 'si' && cat && cat !== 'otros') aprenderComercio_(text_(x.descripcion, 80), cat, now);
  });
  if (nuevas.length) appendRows_(sh, nuevas, cols.length);
  if (req.resumen) actionRegistrarResumen_(req.resumen);       // un solo viaje: aprender + dejar registrado el resumen
  return { ok: true, nuevas: nuevas.length, actualizadas: cambios };
}

/** Diario: si ya pasó el cierre de la tarjeta y no se subió el resumen siguiente, avisa a quien lo sube (una vez por cierre). */
function avisarResumenes_(hoy) {
  var props = PropertiesService.getScriptProperties(), sent = [];
  try { sent = JSON.parse(props.getProperty(AVISO.SENT_PROP) || '[]'); } catch (e) { sent = []; }
  var ultimo = {};
  readTab_('Resumenes').forEach(function (r) {
    var k = r.tarjeta + '|' + r.persona_id;
    if (!ultimo[k] || String(r.cierre) > String(ultimo[k].cierre)) ultimo[k] = r;
  });
  var topics = topicsOf_(), avisos = [];
  Object.keys(ultimo).forEach(function (k) {
    var r = ultimo[k], prox = String(r.proximo_cierre || ''); if (!prox) return;
    var limite = new Date(Date.parse(prox + 'T00:00:00Z') + 2 * 86400000).toISOString().slice(0, 10);   // 2 días de gracia
    if (hoy < limite) return;
    var key = 'resumen:' + k + ':' + prox; if (sent.indexOf(key) >= 0) return;
    avisos.push({ key: key, persona: String(r.persona_id), tarjeta: String(r.tarjeta), prox: prox });
  });
  var enviados = 0;
  avisos.forEach(function (a) {
    var mensaje = 'Ya cerró el resumen de la ' + a.tarjeta + ' (' + a.prox + '). Subilo en Cuba así sumo lo compartido.';
    var ok = topics[a.persona] ? ntfy_(topics[a.persona], '🐕 Cuba: falta un resumen', mensaje, 3) === true : false;
    if (!ok) {
      var mails = String(props.getProperty(AVISO.MAILS_PROP) || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      if (mails.length) { try { MailApp.sendEmail(mails.join(','), '🐕 Cuba: falta subir un resumen', mensaje + '\n' + CUBA.APP_URL, { name: 'Cuba 🐕' }); ok = true; } catch (e) { ok = false; } }
    }
    if (ok) { sent.push(a.key); enviados++; }
  });
  if (enviados) props.setProperty(AVISO.SENT_PROP, JSON.stringify(sent.slice(-80)));
  return enviados;
}
