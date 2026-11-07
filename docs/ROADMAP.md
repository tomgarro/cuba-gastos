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
