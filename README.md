# Cuba · gastos de a dos

App web (PWA) para llevar gastos compartidos entre dos personas, con seguimiento personal, reparto justo según sueldos y una mascota: **Cuba**, un doberman que cuida la plata.

Reemplaza a Splitwise sin el límite diario de cargas.

**App en vivo:** se completa al publicar en GitHub Pages.

## Estado actual (v0.1)

Funciona hoy, sin servidor:

- Onboarding con Cuba y alta de personas.
- Gastos y pagos, con división igual, por montos, por porcentaje o por partes.
- Saldos por moneda (ARS y USD por separado) y deudas simplificadas.
- Cierre mensual con resumen por categoría y texto para compartir.
- Importación y exportación en formato CSV de Splitwise.
- Instalable en el celular.

> **Importante:** en esta versión los datos viven **solo en el navegador de cada dispositivo**. Todavía no se comparten entre dos celulares. Eso llega con el backend (Google Sheet + Apps Script), ver `docs/ROADMAP.md`.

## Instalar en el celular

- **Android (Chrome):** menú ⋮ → *Instalar app* o *Agregar a pantalla principal*.
- **iPhone (Safari):** botón Compartir → *Agregar a pantalla de inicio*. Tiene que ser Safari; las notificaciones web en iPhone solo funcionan con la app agregada a la pantalla de inicio.

## Desarrollo

```bash
python3 build.py        # genera index.html a partir de src/
npm test                # tests de la lógica (saldos, reparto, importación)
npm install && npx playwright install chromium
npm run test:e2e        # flujo completo en navegador (modo local y modo base simulada)
npm run icons           # regenera los íconos desde la ilustración de Cuba
```

`index.html` se **genera**: se edita `src/` y se vuelve a correr `build.py`.

## Estructura

```
src/core.js        lógica pura: montos, repartos, saldos, simplificación de deudas, CSV
src/cuba.js        ilustración vectorial de Cuba (humores: idle, happy, alert, sleepy)
src/app.html       interfaz y almacenamiento (plantilla)
index.html         resultado del build (lo que se publica)
manifest.webmanifest, sw.js, icons/   PWA
tests/             unitarios y de navegador
docs/              arquitectura, esquema de la Sheet, roadmap, assets de Cuba
apps-script/       backend (próximo paso)
```

## Reglas del dominio

Dinero en centavos enteros, moneda por movimiento, movimientos que solo se agregan, personas con ID fijo y alias. Detalle en `docs/ARQUITECTURA.md`.
