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
