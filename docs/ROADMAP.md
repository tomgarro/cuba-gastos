# Roadmap

Orden por dependencia. Marcar a medida que se completa.

## Fase 0 · Base (en curso)
- [x] Prototipo: gastos, pagos, saldos, cierre, importar y exportar Splitwise, mascota
- [x] PWA instalable (manifest, service worker, íconos)
- [ ] Repo en GitHub y publicación en GitHub Pages
- [ ] Google Sheet con el esquema de `ESQUEMA_SHEET.md`
- [ ] Apps Script: leer y escribir movimientos, token por dispositivo, bloqueo de concurrencia
- [ ] Adaptador de almacenamiento «Sheets» en la app (datos compartidos entre celulares)

## Fase 1 · Personas, importaciones y justicia
- [ ] Personas con ID fijo, alias, archivar, fusionar con vista previa
- [ ] Importar Splitwise con pantalla de mapeo de nombres
- [ ] Importaciones por lote: deshacer y cambiar moneda del lote
- [ ] Sueldos con fecha y reparto proporcional por defecto (igual, porcentaje o excepción marcada)
- [ ] Notificaciones por Telegram al subir o saldar un gasto

## Fase 2 · Inteligencia
- [ ] Categorización: memoria de comercios, Gemini Flash-Lite, cola de dudosos
- [ ] Presupuestos por categoría con semáforo
- [ ] Gastos recurrentes, vencimientos y calendario `.ics`
- [ ] Detector de anomalías y duplicados
- [ ] Notificaciones web (Android y iPhone con la app instalada)

## Fase 3 · Todo lo demás
- [ ] Compartir comprobantes a Cuba (Android) y subir capturas
- [ ] Importar resúmenes de tarjeta (PDF o CSV)
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
