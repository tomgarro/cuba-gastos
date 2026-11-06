# Backend (Google Apps Script)

`Code.gs` es todo el backend: se pega tal cual en el editor de Apps Script ligado a la Google Sheet. Lo prueba `tests/backend.test.js` (el mismo archivo, sobre una Sheet simulada) y `tests/e2e-sheets.js` (dos celulares contra ese backend).

## Publicarlo (una sola vez)

1. En la Sheet: **Extensiones → Apps Script**. Borrá lo que haya, pegá el contenido de `Code.gs` y guardá.
2. **Implementar → Nueva implementación → Aplicación web.** *Ejecutar como:* **yo**. *Quién tiene acceso:* **Cualquier persona**. Autorizá los permisos que pide. (El acceso real lo controla el token; la otra persona no necesita acceso al script.)
3. Volvé a la Sheet y recargá la página: aparece el menú **🐕 Cuba → Link para emparejar celulares**. La primera vez pide pegar la URL de la app web (en Implementar → Administrar implementaciones → Copiar); se guarda sola. Apps Script no la puede averiguar: la que da es la de prueba y no sirve.
4. Abrí ese link **una vez en cada celular** (mandalo por un chat privado: lleva la clave). La app guarda la conexión y borra el link de la barra de direcciones.

Para desconectar celulares: **🐕 Cuba → Cambiar token** (los celulares tienen que abrir el link nuevo). Si cambiás `Code.gs`, hay que **Implementar → Administrar implementaciones → editar → Nueva versión**.

## Qué hace cumplir (no solo la app)

- Montos en centavos enteros, moneda `ARS`/`USD`, el reparto suma exacto al monto y nombra a personas que existen.
- `Movimientos` solo crece: lo único que se modifica de una fila es `anulado`. Editar = nuevo movimiento con `reemplaza_id` + el viejo anulado, en el mismo pedido; si el viejo ya cambió desde otro celular responde `conflicto`.
- Reintentar un pedido no duplica (idempotente por `id`). Un pedido inválido no escribe nada.
- Personas: se crean y se renombran, nunca se borran.
- `LockService` en cada pedido. El esquema de la Sheet se verifica antes de escribir.

## Protocolo

`POST` a la URL `/exec`, `Content-Type: text/plain` (así el navegador no hace preflight CORS), cuerpo JSON `{ token, action, ... }`. Respuesta `{ ok: true, ... }` o `{ ok: false, error, message }`.

| action | datos | hace |
|---|---|---|
| `ping` | | verifica token y esquema |
| `read` | | personas, sueldos, recurrentes, movimientos, lotes, categorías y config |
| `savePersonas` | `personas: [{id, nombre, color?, alias?, estado?}]` | alta o actualización |
| `saveSueldo` | `sueldo: {id, persona_id, desde, monto_centavos, moneda, nota?, creado_por?}` | agrega un sueldo (solo se agregan; vigente = mayor `desde` ≤ fecha) |
| `saveRecurrente` | `recurrente: {id, descripcion, monto_estimado_centavos, moneda, dia_mes, categoria, pagador_id, proximo_vencimiento, activo}` | alta o edición en el lugar (en edición alcanza con mandar `id` y lo que cambia) |
| `addMovimientos` | `movimientos: [...]`, `lote?` | agrega (máx. 500) |
| `anularMovimientos` | `ids: [...]` | marca `anulado` |
| `undoLote` | `lote_id` | anula todo el lote y lo marca `deshecho` |

El token vive solo en *Propiedades del script* (`CUBA_TOKEN`). Nunca en la Sheet ni en el repo. Lo mismo para la clave de Gemini y el token del bot cuando lleguen.

## Avisos de vencimientos (v0.6)

Menú **🐕 Cuba → Activar avisos de vencimientos**: pide los mails, crea un disparador diario (9 h, Buenos Aires), manda un mail de prueba y muestra un tema privado de **ntfy por persona** (app gratuita, notificación nativa en iPhone y Android, sin servidor). Avisa una vez por etapa de cada vencimiento (faltan ≤3 días / vence hoy / vencido). Al celu no van montos; el mail sí lleva el monto aproximado. Si ningún canal sale, reintenta al día siguiente. Los mails y el tema viven en Propiedades del script (`CUBA_MAILS`, `CUBA_NTFY_TOPIC`), nunca en el repo.

Además, cada vez que alguien anota un gasto o pago (hasta 3 por pedido; no importaciones ni ediciones) el otro recibe «Tomi anotó Super» en su celu, sin monto. Si el aviso falla, el gasto se guarda igual.

Pendiente: llamadas a Gemini y mail mensual con resumen.
