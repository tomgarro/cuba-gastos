# Detalles sorpresa 🥚

Para leer cuando quieras. Cada uno: cómo se activa y cómo se apaga.

## v0.2 · Cuba olfatea novedades

- **Se activa:** con la app abierta, cuando llega un gasto cargado por la otra persona, Cuba mueve la cola mucho más rápido unos 3 segundos.
- **Se apaga:** borrar la regla `.perk .cuba svg` del CSS en `src/app.html` (y el bloque `a.classList.add('perk')` en `Store.refresh`). Respeta «reducir movimiento» del sistema.

## v0.4 · Cuba festeja los vencimientos al día

- **Se activa:** al anotar el último recurrente que estaba por vencer (se vacía «Por pagar»), Cuba mueve la cola a toda velocidad unos 3 segundos.
- **Se apaga:** borrar el bloque `pa.classList.add('perk')` en `A.save` (src/app.html). Reutiliza la misma regla de CSS que el detalle de v0.2 y respeta «reducir movimiento».


## v0.7 · Cuba pide un hueso

- **Se activa:** acariciar a Cuba (tocarla) 10 veces seguidas, con menos de 3 segundos entre toque y toque: llueven huesos y aparece un aviso.
- **Se apaga:** borrar la línea `if (PET.n === 10 && !calm) {…}` al final del bloque «acariciar a Cuba» en `src/app.html`. No aparece con «reducir movimiento».

## v0.11 · Cuba olfatea el resumen

- **Se activa:** al cargar un resumen de tarjeta con 25 consumos o más, el aviso de confirmación suma «Cuba olfateó N consumos y trajo solo lo compartido 🦴».
- **Se apaga:** borrar el `(R.items.length >= 25 ? … : '')` del `toast` al final de `A.rsgo` en `src/app.html`.

## v0.14 · Despedida de viaje

- **Se activa:** al saldar la última deuda de un viaje o evento («Pagado ✓» hasta quedar a mano), un avión cruza la pantalla y el aviso dice «¡Cuentas del viaje claras!».
- **Se apaga:** borrar el bloque `if (!quedan && …) {…}` en `A.evpay` y la regla `.plane` del CSS (`src/app.html`). No aparece con «reducir movimiento».

## v0.17 · ¿Quién es la mejor perra?

- **Se activa:** en «Preguntale a Cuba», preguntar «¿quién es la mejor perra?» (o «buena perra», «buena nena»…): contesta «¡Yo! 🐾» y salen corazones.
- **Se apaga:** borrar la línea `if (/\b(buena|la mejor|linda)…/.test(…)) { fin(…, true); return; }` en `Ask.go` (`src/app.html`). Sin corazones con «reducir movimiento».
