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
`id | tipo | fecha | descripcion | monto_centavos | moneda | pagador_id | reparto_modo | reparto_json | excepcion | motivo_excepcion | categoria | confianza | nota | lote_id | origen | creado_por | creado_en | anulado | reemplaza_id`
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

## Categorias
`id | nombre | emoji | presupuesto_mensual_centavos | moneda`

## Recurrentes
`id | descripcion | monto_estimado_centavos | moneda | dia_mes | categoria | pagador_id | proximo_vencimiento | activo`

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

