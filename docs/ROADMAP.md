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
- [ ] Personas con ID fijo, alias, archivar, fusionar con vista previa
- [ ] Importar Splitwise con pantalla de mapeo de nombres
- [ ] Importaciones por lote: deshacer y cambiar moneda del lote
- [x] Sueldos con fecha y reparto proporcional por defecto (igual, porcentaje o excepción marcada)
- [ ] Notificaciones por Telegram al subir o saldar un gasto

## Fase 2 · Inteligencia
- [x] Categorización: memoria de comercios, Gemini Flash-Lite, cola de dudosos
- [ ] Presupuestos por categoría con semáforo
- [x] Gastos recurrentes y vencimientos («Por pagar» en Inicio, monto que se actualiza y aviso de suba)
- [ ] Calendario `.ics` de vencimientos y aviso por Telegram
- [ ] Detector de anomalías y duplicados
- [ ] Notificaciones web (Android y iPhone con la app instalada)

## Fase 3 · Todo lo demás
- [ ] Compartir comprobantes a Cuba (Android) y subir capturas
- [x] Importar resúmenes de tarjeta (PDF o texto): solo lo compartido, con reglas que Cuba aprende y aviso si falta subir uno
- [ ] Resumen semanal y mail mensual con tips basados en hábitos propios
- [ ] Metas compartidas con aporte proporcional
- [ ] Cierre con doble confirmación y PDF mensual a Drive
- [ ] Gastos sorpresa y gastos privados por persona
- [ ] Modo asado o viaje: grupos temporales, link de pago, cotización al día del gasto
- [ ] Guardar recibos de sueldo y datos en Drive
- [ ] Animaciones de Cuba con los assets de `ASSETS_CUBA.md`

## Fase 4 · Integraciones
- [ ] Mercado Pago
- [ ] Bancos: solo importación de resúmenes

- v0.6: avisos de vencimientos por mail + notificación nativa (ntfy). Telegram descartado por decisión del usuario.
- v0.6.2: importación de Splitwise con mapeo de nombres, moneda del lote y Deshacer desde Ajustes.
