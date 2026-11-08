# Roadmap

Orden por dependencia. Marcar a medida que se completa.

## Fase 0 · Base (en curso)
- [x] Prototipo: gastos, pagos, saldos, cierre, importar y exportar Splitwise, mascota
- [x] PWA instalable (manifest, service worker, íconos)
- [x] Repo en GitHub y publicación en GitHub Pages
- [x] Google Sheet con el esquema de `ESQUEMA_SHEET.md`
- [x] Apps Script: leer y escribir movimientos, token, bloqueo de concurrencia (`apps-script/Code.gs`; falta publicarlo, ver su README)
- [x] Adaptador de almacenamiento «Sheets» en la app (datos compartidos entre celulares; solo online)

## Fase 1 · Personas, importaciones y justicia
- [x] Personas con ID fijo, alias, archivar, fusionar con vista previa
- [x] Importar Splitwise con pantalla de mapeo de nombres
- [x] Importaciones por lote: deshacer y cambiar moneda del lote
- [x] Sueldos con fecha y reparto proporcional por defecto (igual, porcentaje o excepción marcada)
- [ ] Notificaciones por Telegram al subir o saldar un gasto

## Fase 2 · Inteligencia
- [x] Categorización: memoria de comercios, Gemini Flash-Lite, cola de dudosos
- [x] Presupuestos por categoría con semáforo (en Personal, v0.19; falta el tope de los gastos compartidos)
- [x] Gastos recurrentes y vencimientos («Por pagar» en Inicio, monto que se actualiza y aviso de suba)
- [x] Calendario `.ics` de vencimientos (botón en Recurrentes, v0.19; Telegram descartado)
- [x] Detector de anomalías y duplicados (en Personal, v0.19; falta aplicarlo a lo compartido)
- [ ] Notificaciones web (Android y iPhone con la app instalada)

## Fase 3 · Todo lo demás
- [ ] Compartir comprobantes a Cuba (Android) y subir capturas
- [x] Importar resúmenes de tarjeta (PDF o texto): solo lo compartido, con reglas que Cuba aprende y aviso si falta subir uno
- [ ] Resumen semanal y mail mensual con tips basados en hábitos propios
- [x] Metas de ahorro personales con aportes (v0.19); falta la versión compartida con aporte proporcional
- [ ] Cierre con doble confirmación y PDF mensual a Drive
- [x] Gastos privados por persona: pestaña Personal cifrada (v0.19); falta «gasto sorpresa» compartido
- [ ] Modo asado o viaje: grupos temporales, link de pago, cotización al día del gasto
- [ ] Guardar recibos de sueldo y datos en Drive
- [x] Animaciones de Cuba con los assets de `ASSETS_CUBA.md` (poses por pantalla y aventuras en Inicio, v0.18)

## Fase 4 · Integraciones
- [ ] Mercado Pago
- [ ] Bancos: solo importación de resúmenes

- v0.6: avisos de vencimientos por mail + notificación nativa (ntfy). Telegram descartado por decisión del usuario.
- v0.6.2: importación de Splitwise con mapeo de nombres, moneda del lote y Deshacer desde Ajustes.

- v0.19: pestaña Personal. Cada uno lleva su economía propia, cifrada con AES-GCM en el celular (la clave nunca sale; código de recuperación de 13 grupos). A la Sheet llegan bloques ilegibles en la pestaña `Personal`. Incluye carga rápida (voz, «ayer», «u$s», cuotas), topes con semáforo, «¿me alcanza?» con el sueldo vigente, metas, duplicados y rarezas, pasar a compartido, CSV y los consumos no compartidos de un resumen de tarjeta.
- Pendiente por depender de datos o permisos tuyos: Mercado Pago (reportes/credenciales), PDF del cierre a Drive con doble confirmación y recibos de sueldo en Drive (piden permisos de Drive en el Apps Script), notificaciones web (las cubre ntfy), resumen semanal.

## v0.20 · Ideas con Gemini (hecho)

- Voz libre con varios gastos en una frase («café 3 mil, taxi 4500»): primero lo entiende la app sola; si no puede, Gemini (sin nombres). Hoja de confirmación; en Personal entra directo.
- Ticket por ítems (🧾): cada ítem va a «los dos», «yo» (a Personal) o «el otro» (gasto 100 % suyo). Sirve también dentro de un evento (modo asado/viaje). Con 2 personas es esto; los grupos y el link de pago no aplican.
- Detective de suscripciones en Recurrentes, ¿es caro? (contra tu historial + opinión de Cuba), antes de comprar (Personal), carta del mes y «¿qué pasó?» (Cierre), regalos con presupuesto y recordatorio .ics.
- Descartada a pedido: «Cuba negocia».
- Necesita republicar `Code.gs` (acciones `leerTicket`, `entenderGastos`, `iaTexto`). Con el Apps Script viejo la app avisa y sigue a mano.

## v0.21 · Compra con amigos (hecho)

- En Personal: escanear el ticket (o cargarlo a mano), marcar quién comparte cada ítem (yo, Odi, amigos con nombre libre) y guardar. Personal registra solo **tu parte**; lo demás queda en «Me deben», sin tocar los gastos compartidos con Odi.
- Odi aparece como una persona más pero viene marcada «Ya pagó» (te paga en el momento): no queda deuda. Los amigos se recuerdan para la próxima.
- Mensaje de WhatsApp por persona (con tu alias de Mercado Pago, que se recuerda) y uno para el grupo; recordatorios y «Me pagó» total o parcial.

## v0.22 · Mercado Pago (hecho)

- Solo lectura, vía API. El Access Token vive únicamente en las Propiedades del script (menú 🐕 Cuba → Conectar Mercado Pago); la app solo guarda un «código de enlace» que no sirve fuera de tu Apps Script y que Odi no tiene.
- Al abrir Personal (cada 2 h como máximo) o con «Traer ahora»: los cobros de amigos se marcan solos como «me pagó» (por nombre y monto), si solo coincide el monto se pregunta; tus pagos entran a Personal sin duplicar lo ya cargado; las transferencias se revisan una por una.
- Lo que se trae se guarda cifrado en Personal; la Sheet no ve nada legible. Tests: `secretos.test.js` verifica que no haya claves en el repo ni en la app y que Mercado Pago solo se llame con GET.
- Pendiente de comprobar con tu cuenta real: qué devuelve la API para una cuenta personal (la API está pensada para vendedores). La primera sincronización muestra cuántos movimientos trajo.

## v0.22.1
- Mercado Pago: la sincronización informa cuántos cobros/pagos vio la API y muestra el saldo si la cuenta lo permite.
- Avisos: el menú «Probar avisos» manda una prueba a cada celu y muestra el resultado del último aviso real (`AVISO_ULTIMO`).

## v0.23.0
- Se retira «Compra con amigos» (no queda nada que limpiar en el backend; ver ARQUITECTURA).
- Mercado Pago: importación del reporte CSV con vista previa, sin duplicar entre reportes que se pisan y con «Deshacer». + detalle sorpresa 🥚
- Mercado Pago automático: Cuba baja sola el reporte diario programado (lista + descarga, solo lectura) y lo importa; el CSV a mano queda de respaldo.

## v0.23.1
- Mercado Pago: «Traer ahora» no encontraba el reporte programado porque se miraba solo la lista de «Liquidaciones» (`settlement_report`); el reporte de «Dinero en cuenta» (`release_report`) tiene su lista aparte. Ahora se miran las dos y los mensajes distinguen «no hay reportes», «hay pero ninguno reciente» y «no pude bajarlos».
- Tests: `e2e-mp.js` reescrito para el flujo actual (estaba pegado a «Compra con amigos», retirada en v0.23); se saca el bloque viejo de `personal.test.js`.

## v0.23.2
- Mercado Pago: la respuesta de la app muestra los códigos que devolvió Mercado Pago y el menú 🐕 Cuba → «Probar Mercado Pago (qué ve Cuba)» lista lo que ve cada familia de reportes, para diagnosticar cuando no aparece el reporte programado.
