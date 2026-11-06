# Detalles sorpresa 🥚

Para leer cuando quieras. Cada uno: cómo se activa y cómo se apaga.

## v0.2 · Cuba olfatea novedades

- **Se activa:** con la app abierta, cuando llega un gasto cargado por la otra persona, Cuba mueve la cola mucho más rápido unos 3 segundos.
- **Se apaga:** borrar la regla `.perk .cuba svg` del CSS en `src/app.html` (y el bloque `a.classList.add('perk')` en `Store.refresh`). Respeta «reducir movimiento» del sistema.
