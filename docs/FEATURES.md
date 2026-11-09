# Funciones ocultas (interruptores)

Las funciones apagadas siguen en el código y en el backend: solo se esconden. Se prenden con **un solo cambio**.

## Personal — apagado desde v0.24.1

**Para reactivarlo:** en `src/app.html`, cambiar `var FEATURES = { personal: false };` por `true`, correr `python3 build.py` y publicar. Nada más.

*Tests:* los e2e que cubren Personal (`e2e-personal`, `e2e-ia`, `e2e-mp`) usan `tests/con-personal.js`, que arma una copia temporal de `index.html` con el interruptor en `true`. Cuando se reactive Personal para siempre, se puede borrar ese helper y volver a apuntar a `index.html`; `e2e-features.js` y la aserción «No compartido» de `e2e-sheets.js` hay que invertirlas.

### Qué se oculta cuando está apagado
| Dónde | Qué desaparece |
|---|---|
| Barra de abajo | Pestaña 🔒 Personal (quedan 4; la grilla pasa de 5 a 4 columnas) |
| Pestaña Personal | Carga rápida, topes por categoría, metas de ahorro, «Con Cuba» (¿me conviene?), movimientos, «Mi llave y mis copias», código de recuperación, CSV, **Mercado Pago** (sincronización y reporte) |
| Botón + | Ya no hay modo «anotar gasto personal» |
| Resumen de tarjeta | Opción «🔒 Guardar los no compartidos en mi Personal», y el cruce con tus gastos personales para detectar duplicados; el chip «Personal» pasa a decir «No compartido»; el texto «ya estaban cargados en Cuba o en tu Personal» pasa a «…en Cuba» |
| Ticket por ítems | Opción «Yo» para repartir (queda Los dos / la otra persona) |
| Anotar varios gastos con Gemini | Ya no hay destino «Personal» |
| Gasto compartido «pasado desde Personal» | No se anula nada allá |
| Estimado del mes | Se saca la aclaración «Tus gastos personales no están» |
| Segundo plano | No se descarga ni descifra Personal al sincronizar, no se manda nada a la hoja `Personal` y no corre `mpAuto` |

### Qué NO se toca (sigue como estaba)
- Apps Script: acciones `savePersonal`, `mpReportes`, lectura de `personal` en `read`.
- Hoja `Personal` de la Sheet: los registros cifrados quedan guardados.
- Lo ya guardado cifrado en cada celular (`cuba:pk:*`, `cuba:pe:*`) y las claves de Mercado Pago: quedan en `localStorage`, ocultos. La llave de recuperación sigue valiendo cuando se reactive.
- `src/personal.js`, `src/ia.js` y sus tests (`personal.test.js`, `ia.test.js`).

### Cómo está implementado
- `FEATURES.personal` se define al principio del script de `src/app.html`.
- `Per.ready()` devuelve `false`, `Per.add()` no hace nada y `Per.remoto()` sale temprano: con eso se apaga todo lo que depende de Personal sin tocar cada pantalla.
- `render()` filtra la pestaña, y si por algún motivo `S.tab === 'personal'` vuelve a Inicio. La acción `tab` también la ignora.
- Tests: `tests/e2e-features.js` verifica apagado/encendido.
