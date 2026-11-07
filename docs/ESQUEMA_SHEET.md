# Esquema de la Google Sheet

Una fila de encabezados por pestaña. IDs generados por la app (texto corto único). Montos en **centavos enteros**. Fechas en ISO (`2026-11-06`). **Los secretos nunca van en la Sheet.**

La Sheet contiene datos financieros: compartirla solo con las dos cuentas de la pareja.

## Personas
`id | nombre | alias | color | estado | creada`
- `alias`: lista separada por comas (ej. `Ana, Ana María, Ana M.`).
- `estado`: `activa` o `archivada`.

## Sueldos
`id | persona_id | desde | monto_centavos | moneda | nota | creado_por | creado_en`
- El sueldo vigente a una fecha es el de mayor `desde` menor o igual a esa fecha.

## Movimientos (solo se agrega)
`id | tipo | fecha | descripcion | monto_centavos | moneda | pagador_id | reparto_modo | reparto_json | excepcion | motivo_excepcion | categoria | confianza | nota | lote_id | origen | creado_por | creado_en | anulado | reemplaza_id | evento_id`
- `tipo`: `gasto` o `pago`.
- `reparto_modo`: `sueldo` (por defecto), `igual`, `porcentaje` o `exacto`.
- `reparto_json`: `[["persona_id", centavos], ...]`; la suma es exactamente `monto_centavos`.
- `excepcion`: `TRUE` si no usó el reparto por sueldo.
- `origen`: `manual`, `splitwise`, `telegram`, `mercadopago`, `tarjeta`…
- `anulado`: `TRUE` marca como borrado. Editar = anular el viejo y agregar uno nuevo con `reemplaza_id`.

## Lotes (importaciones)
`id | origen | archivo | fecha | cantidad | moneda_original | estado`
- `estado`: `activo` o `deshecho`. Deshacer un lote anula todos sus movimientos.

## Comercios (memoria de categorías)
`patron | comercio | categoria | veces | actualizado`
- `patron`: descripción normalizada (minúsculas, sin tildes, sin números/meses/palabras vacías, primeros 5 términos). Cada corrección manual crea o actualiza una regla (`veces` cuenta los usos).

## Etiquetas (categorías de movimientos existentes)
`id | movimiento_id | categoria | confianza | fuente | estado | creado_por | creado_en`
- Solo se agrega; la última etiqueta de cada movimiento gana. Así los movimientos nunca se reescriben.
- `fuente`: `memoria`, `gemini` o `manual`. `estado`: `aplicada` (confianza ≥ 0,85 o manual) o `dudosa` (0,5–0,85, espera confirmación). Se crea sola al primer uso.

## ReglasResumen (qué es compartido)
`patron | comparte | categoria | veces | actualizado`
- Una fila por comercio de tarjeta: `comparte` = `si` o `no`. Cada vez que se carga un resumen, lo que decidís se aprende; cambiar de opinión actualiza la fila. La ven las dos personas (la Sheet es una sola).

## Resumenes (cuáles ya se subieron)
`id | tarjeta | persona_id | cierre | vencimiento | proximo_cierre | consumos | compartidos | creado_por | creado_en`
- Solo el registro de que se subió (sin consumos ni números de tarjeta ni nombres). Con `proximo_cierre` Cuba avisa si falta subir el siguiente. Los consumos compartidos son movimientos (`origen = resumen`, en un lote que se puede deshacer); los personales no se guardan.

## Categorias
`id | nombre | emoji | presupuesto_mensual_centavos | moneda`

## Recurrentes
`id | descripcion | monto_estimado_centavos | moneda | dia_mes | categoria | pagador_id | proximo_vencimiento | activo | ajuste_meses | proximo_ajuste`
- `ajuste_meses` (0 = sin ajuste) y `proximo_ajuste` (fecha): para el alquiler u otro monto que se actualiza por índice. Ese día la app avisa, se carga el % y se recalcula `monto_estimado_centavos` a pesos enteros. Desde v0.15; una hoja anterior se completa sola.

## Eventos
`id | nombre | moneda | desde | hasta | estado | creado_por | creado_en`
- Viajes y eventos (v0.14). `estado` = `abierto` o `cerrado`. Es configuración: se edita en el lugar. La moneda no se cambia si ya tiene gastos.
- Sus gastos y pagos son movimientos normales con `evento_id` completo (última columna de `Movimientos`). La app los deja afuera del mes, de «Quién le debe a quién», del Cierre y del mail mensual; el evento tiene sus propios saldos.

## Personal (cifrada, v0.19)
`id | persona_id | blob | creado_en`
- Solo se agrega. `blob` = evento cifrado en el celular (AES-GCM, IV de 12 bytes + texto cifrado, en base64). El backend rechaza todo lo que no parezca base64 y a cada persona le devuelve únicamente sus filas (`read` con `persona`). La clave nunca llega a la Sheet ni a Google: sin el código de recuperación nadie puede leerla.
- Eventos (ya descifrados): `g` gasto, `x` anula, `p` tope por categoría, `m` meta, `a` aporte, `o` «está bien». Una cuota en N pagos son N gastos con `gr` en común.

## Cierres
`id | mes | transferencias_json | confirmado_a | confirmado_b | pdf_drive_id | creado_en`
- Cierre con doble confirmación: cada persona confirma y queda registrada la fecha.

## Config
`clave | valor`
- Ej.: `moneda_base`, `nombre_grupo`, `zona_horaria`.

## Notas de implementación (backend v1)

- La Sheet está en configuración regional **en_US** (las fórmulas de validación se guardan con coma como separador); no afecta a los datos, que son texto ISO y enteros.
- Las columnas de IDs, fechas, JSON y flags son de **formato texto**; los booleanos se guardan como `TRUE` / `FALSE`.
- `confianza` va de 0 a 1.
- `excepcion` queda en `FALSE` hasta que exista el reparto por sueldo; ahí pasa a `TRUE` cuando un gasto no lo use.
- Editar un movimiento = el backend agrega el nuevo (con `reemplaza_id`) y anula el viejo en el mismo pedido. Si el viejo ya estaba anulado (otro celular lo cambió) responde `conflicto` y no escribe nada.
- Los cierres que hoy registra la app son pagos («Cierre …») dentro de `Movimientos`; la pestaña `Cierres` queda para el cierre con doble confirmación.
- `Sueldos` solo se agrega (cada aumento es una fila nueva con su `desde`). Cada persona carga el suyo desde la app; los sueldos viven únicamente en la Sheet (nunca en el repo ni se envían a Gemini).
- `reparto_modo = sueldo` cuando el reparto es exactamente el proporcional al sueldo vigente a `fecha` entre los que participan. Si había sueldos de todos y no se usó, `excepcion = TRUE` (y `motivo_excepcion` si se escribió uno).
- `Recurrentes` es configuración y se edita en el lugar. `monto_estimado_centavos` pasa a ser lo último que se pagó de verdad; `proximo_vencimiento` avanza un mes al anotarlo. Lo pagado vive en `Movimientos` con `origen = recurrente`.

- `evento_id` (columna 21 de `Movimientos`) se agregó en v0.14: una Sheet anterior se completa sola (el backend escribe el encabezado si la columna está vacía; no toca ningún dato). La pestaña `Eventos` también se crea sola.
