# Cuba · guía para trabajar en este repo

App de gastos compartidos de una pareja (PWA). Respondé en español rioplatense, directo y sin relleno. Proponé antes de hacer cambios grandes y mostrá cómo verificaste lo que construís.

## Arquitectura decidida

- Frontend estático (HTML/JS, PWA) en GitHub Pages. `index.html` se genera con `python3 build.py` desde `src/`: nunca editarlo a mano.
- Base de datos única: una Google Sheet. Backend: Google Apps Script ligado a esa Sheet (`apps-script/`).
- IA: Gemini Flash-Lite con plan pago. La clave vive solo en Script Properties: nunca en el frontend, el repo ni la Sheet. A Gemini solo se le manda descripción y monto, nunca sueldos ni nombres.
- Avisos: bot de Telegram como canal principal y notificaciones web como extra. Mail mensual.
- Mercado Pago más adelante. Bancos: solo importar resúmenes, sin scraping ni credenciales.

## Reglas del dominio (no negociables)

- Dinero en **centavos enteros**. Moneda por movimiento (ARS/USD), sin conversión implícita.
- Los movimientos **solo se agregan**; borrar es marcar como anulado. Nunca reescribir historia.
- Personas: ID fijo, nombre visible, alias, color, estado. **Archivar, no borrar.** Fusionar duplicados con vista previa de saldos; nunca fusionar sola.
- Reparto por defecto proporcional al sueldo vigente **a la fecha del gasto**. Alternativas: igual o porcentaje elegido. Las excepciones se marcan explícitamente en cada gasto.
- Importación de Splitwise: pantalla de mapeo de nombres, importación por lote con «Deshacer» y cambio de moneda del lote.
- Categorías en capas: memoria de comercios, luego Gemini para lo desconocido, y cola de dudosos con confianza. Cada corrección se vuelve regla.

## Calidad

- Antes de publicar: `python3 build.py && npm test && npm run test:e2e`.
- Toda aritmética de dinero tiene test. Los repartos siempre suman exacto al monto.
- Antes de tocar la Sheet real, hacer copia de respaldo.
- Commits claros. **No subir secretos ni datos reales** (CSV, recibos, nombres completos, montos reales). El repo es público: ejemplos con nombres inventados.

## Cuba (la mascota)

Cuba es **hembra** (una perra): siempre en femenino («la doberman», «ella», «guardiana», «contenta»). Nunca «él». En prompts de imagen: *female Doberman Pinscher, a girl*.

Lleva un **collar de caracoles cauri blancos**, no collar rojo ni medalla. Antes de pedir o dibujar cualquier imagen, leer `context.md`.

## Dónde mirar

`docs/ARQUITECTURA.md`, `docs/ESQUEMA_SHEET.md`, `docs/ROADMAP.md`, `docs/ASSETS_CUBA.md`.
