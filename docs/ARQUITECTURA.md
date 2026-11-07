# Arquitectura

```
Celular (PWA en GitHub Pages)
   │  POST JSON (texto plano, sin preflight CORS)
   ▼
Google Apps Script  ──►  Google Sheet (única base de datos)
   │   │                    pestañas: ver ESQUEMA_SHEET.md
   │   ├──► Gemini Flash-Lite   (clave en Script Properties)
   │   ├──► Telegram Bot        (avisos al subir o saldar un gasto)
   │   └──► MailApp             (resumen mensual con tips)
   └──► Drive                   (PDF de cierres, comprobantes)
```

## Decisiones y por qué

- **Sheet como base:** la pareja puede ver y editar datos desde ahí. Costo: no valida datos por sí sola. Se mitiga con validación de datos, rangos protegidos y una pestaña de movimientos que solo se agrega.
- **Apps Script como backend:** vive dentro de la Sheet, guarda la clave de Gemini lejos del frontend y manda mails y avisos sin servidor aparte.
- **Límites de Sheets API:** 60 lecturas y 60 escrituras por minuto por usuario por proyecto. Sobra para una pareja; igual se escribe en lotes y se reintenta con espera creciente.
- **Concurrencia:** `LockService` en Apps Script para que dos cargas simultáneas no se pisen.

## Autenticación (riesgo abierto)

Un Web App de Apps Script publicado como «cualquiera con el link» es público. Propuesta: **token por dispositivo** guardado en Script Properties y en el almacenamiento local del celular (emparejado una vez). Si el token se filtra, se rota. Alternativa más fuerte si hiciera falta: función intermedia con login de Google.

## Personas y alias

- Cada persona tiene ID fijo, nombre visible, lista de alias, color y estado (activa/archivada). Los movimientos apuntan al ID, nunca al nombre.
- Importar pasa por una pantalla de mapeo: cada nombre del CSV se asigna a una persona existente o nueva. Sugerencias por normalización (sin tildes ni mayúsculas) y parecido; nunca se fusiona sola. Los alias confirmados se guardan.
- **Fusionar:** reasigna quién pagó y a quién le toca en todos los movimientos, junta partes repetidas y archiva la sobrante. Antes de aplicar muestra saldos antes y después.
- **Quitar:** archivar si hay movimientos; eliminar solo si no hay ninguno.

## Reparto proporcional a sueldos

- Los sueldos se cargan con fecha de vigencia (aumentos, ajustes por inflación).
- El porcentaje de cada persona = su sueldo vigente a la fecha del gasto ÷ suma de los sueldos vigentes. El resto de centavos se asigna por mayor resto, así el reparto suma exacto.
- Un gasto nuevo no reescribe los viejos: cada movimiento guarda su reparto calculado.
- Excepciones (igual, porcentaje elegido, montos): se marcan explícitamente en el gasto, con motivo opcional.

## Categorización

1. Memoria de comercios (patrón → categoría): instantánea y gratis.
2. Gemini Flash-Lite para lo desconocido, con salida estructurada: categoría de la lista, comercio normalizado y confianza.
3. Cola de dudosos: lo de baja confianza espera confirmación; cada corrección actualiza la memoria.

Privacidad: la plataforma gratuita de Gemini puede usar los datos para mejorar sus productos; la paga no. Por eso plan pago y envío mínimo (descripción y monto).

## Notificaciones

- **Telegram:** canal principal; funciona igual en iPhone y Android.
- **Web push:** extra. En Android funciona desde Chrome. En iPhone solo con la app agregada a la pantalla de inicio, iOS 16.4 o superior, y con el permiso pedido tras un toque del usuario. Necesita una función aparte que guarde las suscripciones y envíe los avisos.

## Mercado Pago (futuro)

Dos caminos: consultar sus reportes cada cierto tiempo desde Apps Script, o recibir avisos instantáneos (webhooks). Apps Script no permite leer los encabezados de una petición entrante, lo que complica validar la firma de los webhooks: para ese camino conviene una función aparte. Pendiente confirmar que la API de reportes sirva con una cuenta personal.

## Cola de envíos (v0.13)

Todo lo que se anota (gastos, borrados, sueldos, recurrentes, categorías, deshacer, resúmenes) se aplica al instante en el celular y se manda a la Sheet por una cola (`Outbox`) guardada en `localStorage` (`cuba:outbox`). Sale en orden; si no hay señal o el backend está ocupado reintenta solo (cada 6 s y al volver la conexión); si el backend rechaza un pedido avisa y vuelve a leer la Sheet. Los pedidos son idempotentes (mismo id = no se duplica). Mientras hay envíos pendientes no se relee la Sheet (para no pisar lo recién anotado). La lectura usa `rev` (contador de cambios + largo de pestañas): si no cambió nada responde `unchanged` sin bajar la Sheet; cada 10 min se hace una lectura completa.

## Avisos y proyecciones (v0.15)
`src/avisos.js` (puro, con tests) calcula en el celular, sin mandar nada afuera: aumentos («la luz subió 23 %»), faltantes («no cargaste el agua»), suscripciones con costo anual, «¿me alcanza?» (tu sueldo menos tu parte de lo compartido y de lo que vence) y el ajuste por índice de recurrentes. Cada persona ve solo su sueldo. La calculadora de reparto usa los sueldos vigentes y no anota nada.

## Compartir comprobantes (v0.16)
- **Android y escritorio (app instalada):** «Compartir → Cuba». El manifiesto declara `share_target` (POST multipart); el service worker guarda lo recibido en el caché `cuba-share`, redirige a `?share=1` y la app lo lee una sola vez y lo borra.
- **iPhone:** iOS no tiene Web Share Target. Se usa **+ → 📎 Leer un comprobante** (elige la captura o foto de la galería).
- **Texto y PDF** se leen en el celular (`src/compartir.js`), sin mandar nada afuera.
- **Imágenes:** solo con un OK explícito cada vez («Sí, leerla»). Se achican a 1280 px y se mandan al backend (`leerComprobante`), que le pide a Gemini únicamente comercio, monto, moneda y fecha. La imagen se descarta al responder: no se guarda en la Sheet, el repo ni el caché. Lo leído abre el formulario de gasto para revisar; nunca se guarda solo.

## Preguntarle a Cuba (v0.17)
- **Inicio → 💬 Preguntale a Cuba** abre una hoja con Cuba animada: *escucha* (`escucha_a/b`), *olfatea* (`olfatea_a/b`) y *responde* (`responde_a/b`) o *no encuentra* (`no_encuentra`). Cada pose usa su sprite si existe y, si falta, uno de repuesto (`tranquilo`, `feliz`, `alerta`), así que funciona hoy y mejora solo cuando se sumen los `.webp` a `assets/cuba/`.
- `src/preguntas.js` (puro, con tests) entiende la pregunta en el celular (total por categoría y período, lo último de una categoría, quién le debe a quién, en qué se gasta más) y la contesta con las cuentas locales: sin eventos, sin anulados y sin mezclar monedas.
- Si no la entiende, el backend (`entenderPregunta`) le pide a Gemini que la traduzca a una consulta `{tipo, categoria, mes}`. A Gemini va **solo el texto de la pregunta**, con nombres y alias reemplazados por «PERSONA» y sin números largos; nunca ve movimientos ni montos. Lo que vuelve se valida de nuevo en la app. Solo lee: no mueve el contador de cambios ni frena las cargas.

## Personal (v0.19)
- Decisión: la privacidad frente a la otra persona se logra con **cifrado en el cliente**, no con permisos (la Sheet es una sola y el token es compartido). Clave de 256 bits por persona, generada en el celular, guardada solo en `localStorage` y respaldada con un código de recuperación (base32, 13 grupos, con dígito de control).
- La Sheet guarda eventos cifrados en la pestaña `Personal`; el modo local no sincroniza. Si se pierde la clave, los datos de la Sheet no se pueden recuperar: es a propósito.
- `src/personal.js` (cifrado, carga rápida, cuotas exactas, estadísticas, duplicados, rarezas, `.ics`) tiene `tests/personal.test.js`; el flujo completo con dos celulares está en `tests/e2e-personal.js`.
- Lo que Gemini ve no cambia: nada de Personal se manda afuera.

## Ideas con Gemini (v0.20)

`src/ia.js` (CubaIA) hace lo local: separar gastos dictados, suscripciones, ¿es caro?, cuota de una compra, agregados del mes y reparto de un ticket. Gemini solo entra por tres acciones del Apps Script: `leerTicket` (foto → ítems), `entenderGastos` (frase → gastos) e `iaTexto` (carta, explica, regalos, compra, caro). A `iaTexto` solo viajan números agregados y conceptos: nunca nombres, sueldos ni movimientos sueltos de Personal.

## Compra con amigos (v0.21)

Todo vive en Personal, cifrado: eventos nuevos `d` (deuda de un amigo, con el detalle de sus ítems), `r` (cobro, total o parcial) y `h` (alias de Mercado Pago). El gasto `g` lleva solo tu parte (`tot` guarda el total del ticket). Los ids se derivan de la compra, así que reintentar no duplica. Nada de esto toca la Sheet compartida ni a Gemini más allá de leer el ticket.
