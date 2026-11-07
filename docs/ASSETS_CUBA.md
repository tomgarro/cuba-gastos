# Assets de Cuba

Cuba es un doberman negro y fuego (marcas canela). **No lleva collar rojo ni medalla:** lleva un collar de **caracoles cauri blancos** enhebrados, con su abertura central visible. Es un homenaje al Cuba real: ilustración caricaturesca, cálida y respetuosa. Ficha completa en `context.md`.

## Cómo generarlos (Gemini)

1. Generar primero la **hoja de personaje** (frente, 3/4, perfil y espalda) y usarla como imagen de referencia en cada pedido siguiente, para que no cambie de cara ni de collar de caracoles.
2. Pedir **fondo liso de un solo color** (verde puro o blanco), sin sombras en el piso ni degradés, para recortarlo limpio.
3. Mismo estilo en todas las imágenes: vector plano, formas redondeadas, paleta de 6 colores como máximo.

## Lista

| Archivo | Qué es | Dónde se usa |
|---|---|---|
| `cuba_hoja.png` | Frente, 3/4, perfil, espalda | Referencia |
| `cuba_feliz.png` | Contento | Saldos a mano |
| `cuba_tranquilo.png` | Sentado | Inicio |
| `cuba_alerta.png` | Ladrando | Cierre cerca, vencimientos |
| `cuba_durmiendo.png` | Durmiendo | Cargando, modo noche |
| `cuba_olfateando.png` | Con un ticket | Leyendo comprobantes, categorizando |
| `cuba_pensando.png` | Cabeza ladeada | Gasto dudoso |
| `cuba_sorprendido.png` | Sorprendido | Gasto raro |
| `cuba_triste.png` | Orejas caídas | Deuda o presupuesto pasado |
| `cuba_festejando.png` | Confeti | Meta cumplida, mes saldado |
| `cuba_sobre.png` | Sobre en el hocico | Vencimientos |
| `cuba_calculadora.png` | Lentes y calculadora | Sueldos y reparto |
| `cuba_regalo.png` | Regalo y gesto de «shh» | Gasto sorpresa |
| `cuba_celular.png` | Con celular | Notificaciones |
| `cuba_valija.png` | Con valija | Modo viaje |
| `cuba_parrilla.png` | Con parrilla | Modo asado |
| `cuba_alcancia.png` | Con alcancía | Metas |
| `cuba_cara.png` | Cara sola, de frente, con margen | Ícono de la app |

**Escenas de fondo** (sin personajes ni marcas reales), en 9:16 y 16:9: `escena_hogar`, `escena_super`, `escena_calle`, `escena_noche`, `escena_viaje`, `escena_parrilla`.

**Onboarding:** 4 viñetas: `onb_1_llega`, `onb_2_saluda`, `onb_3_senala`, `onb_4_listo`.

**Para animar:** de las poses principales, 2 o 3 variantes mínimas de la misma imagen: ojos cerrados, boca abierta y cola en dos posiciones. Se combinan para parpadeo, ladrido y cola.

## Formato

PNG de 1024×1024 para poses. Se procesan (recorte de fondo, optimización a WebP) y se guardan en `assets/cuba/`.

## Mientras tanto

La app usa la ilustración vectorial de `src/cuba.js` con cuatro humores. Los assets definitivos la reemplazan pose por pose.
