# Assets de Cuba

Cuba es una **perra** doberman pinscher (hembra) negra y fuego (marcas canela). **No lleva collar rojo ni medalla:** lleva un collar de **caracoles cauri blancos** enhebrados, con su abertura central visible. Es un homenaje a la Cuba real: ilustración caricaturesca, cálida y respetuosa. Ficha completa en `context.md`.

## Cómo generarlos (Gemini)

1. Generar primero la **hoja de personaje** (frente, 3/4, perfil y espalda) y usarla como imagen de referencia en cada pedido siguiente, para que no cambie de cara ni de collar de caracoles.
2. Pedir **fondo liso de un solo color** (verde puro o blanco), sin sombras en el piso ni degradés, para recortarlo limpio.
3. Mismo estilo en todas las imágenes: vector plano, formas redondeadas, paleta de 6 colores como máximo.

## Lista (hecho ✅ = ya está en `assets/cuba/` y conectado)

| Archivo | Qué es | Dónde se usa en la app |
|---|---|---|
| `tranquilo`, `feliz`, `alerta`, `durmiendo`, `frente_alerta` ✅ | Poses base | Inicio, cargando, errores, vacíos |
| `mimado_a/b` ✅ | Dos poses al acariciarla | Tocar a Cuba |
| `escucha_a/b`, `olfatea_a/b`, `responde_a/b`, `no_encuentra` ✅ | Animación de «Preguntarle a Cuba» | Escucha → olfatea → responde |
| `festejando` ✅ | Confeti | Están a mano (Inicio y Saldar), «Preguntale»: a mano |
| `sorprendida` ✅ | Boquiabierta | Aventura |
| `triste` ✅ | Orejas caídas | «No llego a la Sheet» |
| `sobre` ✅ | Sobre en el hocico | Tarjeta «Por pagar» |
| `calculadora` ✅ | Lentes y calculadora | «Mi sueldo»; «Preguntale»: deudas |
| `regalo` ✅ | Regalo y «shh» | Aventura |
| `celular` ✅ | Celular con campanita | Aventura |
| `valija` ✅ | Valija de viaje | «Viajes y eventos»; aventura |
| `parrilla` ✅ | Parrilla | «Viajes y eventos» si hay un asado; aventura |
| `alcancia` ✅ | Chanchito con moneda | Aventura |
| `ticket` ✅ | Olfateando un ticket | «Resumen de tarjeta»; «Preguntale»: lo último |
| `lupa` ✅ | Detective con lupa | «Para revisar», sin resultados en Gastos; «Preguntale»: lo que más se va |

**Aventuras:** en Inicio, cada 20 a 45 segundos, Cuba se va a una aventura (valija, parrilla, lupa…), el globo lo cuenta y vuelve. Tocar el globo la manda a otra. No salen con «reducir movimiento», con una hoja abierta ni en navegadores automatizados. La lista está en `AVENTURAS` (`src/cuba.js`).

**Pendientes (ideas):** escenas de fondo (`escena_hogar`, `escena_super`…), viñetas de onboarding y ícono `cuba_cara`.

**Hojas de sprites:** se piden varias poses en una sola hoja (grilla) con fondo verde puro y se cortan con
`python3 tools/procesar_cuba.py --hoja hoja.png COLUMNAS nombre1 nombre2 …` (nombres en orden de lectura). Conviene subir la hoja con un upscaler: Gemini la entrega chica (~1000 px).

## Formato

PNG de 1024×1024 para poses. Se procesan (recorte de fondo, optimización a WebP) y se guardan en `assets/cuba/`.

## Mientras tanto

Sin imágenes embebidas (tests, versiones viejas) la app usa el dibujo vectorial de `src/cuba.js`; las poses nuevas sin imagen caen a un humor básico.
