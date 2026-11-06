# Backend (Google Apps Script)

**Pendiente: es el próximo paso del roadmap.** Esta carpeta guardará el código del backend ligado a la Google Sheet.

Responsabilidades previstas:

- Leer y agregar movimientos, personas, sueldos y cierres según `docs/ESQUEMA_SHEET.md`.
- `LockService` para evitar escrituras simultáneas.
- Token por dispositivo (Script Properties) para autenticar a la PWA.
- Llamadas a Gemini con la clave en Script Properties.
- Avisos por Telegram y mail mensual con disparadores por tiempo.

Los secretos (clave de Gemini, token del bot) se cargan a mano en *Propiedades del script*. Nunca se escriben en archivos del repo.
