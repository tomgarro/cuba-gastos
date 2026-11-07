# Sprites de Cuba pendientes (para cuando se renueve el límite de Gemini)

Animación «Preguntarle a Cuba»: escucha → olfatea → responde. Ya están `escucha_a` y `escucha_b`.
Faltan 5 imágenes. Mientras tanto la app usa poses existentes (feliz, alerta, tranquilo, mimado_a/b).

## Cómo pedirlas
1. Adjuntar **siempre**: `assets/cuba/feliz.webp` + `assets/cuba/escucha_a.webp` (referencia de cara, proporciones y collar).
2. Pegar el **bloque base** y después el bloque de la pose.
3. Las B se piden **editando la A aprobada** (adjuntarla), cambiando solo lo que dice el prompt.
4. Si sale con collar rojo, medalla o letra «C»: descartar y repetir.

## Bloque base (pegar en todos)
```
Same character as the attached reference images: a black-and-tan Doberman dog named Cuba, flat vector cartoon style, soft rounded shapes, uniform dark-grey outline.
Fixed features, identical in every image: big erect pointed ears with tan inside, small tan dot eyebrows, tan muzzle sides, two tan patches on the chest, tan legs, short tail.
He wears ONLY a necklace of white cowrie shells strung on a thin thread, hanging in a curve at the base of the neck (cream oval shells with the central slit visible).
NO red collar, NO tag, NO medal, NO letters.
Palette only: fur #242528, tan #BE6C35, shells #F2F0E7, outline #4A4A4D, ink #141416, eye #3A2418.
Background: flat solid pure green #00FF00, no shadows, no gradients, no floor. Square 1024x1024, whole body visible, 10% margin, nothing cropped.
```

## 1. `olfatea_a` — nariz abajo, siguiendo un rastro
```
[bloque base] Pose: front 3/4 view, head lowered, nose close to the ground sniffing, ears relaxed slightly forward, eyes looking down, front legs in a small walking step, tail low. Three tiny curved scent lines near the nose (tan, flat).
```

## 2. `olfatea_b` — edición de olfatea_a
```
Edit the attached image: same dog, same pose, only change: nose a little further to the right and the other front paw forward, scent lines slightly different. Keep everything else identical.
```

## 3. `responde_a` — contento, listo para contestar
```
[bloque base] Pose: sitting, facing front, head up and slightly tilted, mouth open in a small happy smile, tongue slightly visible, eyes bright, ears fully erect, tail wagging to the left side.
```

## 4. `responde_b` — edición de responde_a
```
Edit the attached image: same dog, same pose, only change: mouth open wider as if barking once, tail wagging to the right side. Keep everything else identical.
```

## 5. `no_encuentra` — no halló la respuesta
```
[bloque base] Pose: sitting, front view, head tilted strongly to one side, one ear dropped sideways and the other erect, eyebrows raised, small closed mouth with a puzzled look, one front paw lifted a little. Keep the cowrie necklace clearly visible.
```

## Procesado (lo hago yo)
Recorte del verde, componente más grande, 512×512 WebP en `assets/cuba/`.
