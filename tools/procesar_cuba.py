#!/usr/bin/env python3
"""Recorta las poses de Cuba de las hojas generadas con Gemini y arma assets/cuba/*.webp y los íconos.
Uso: python3 tools/procesar_cuba.py hoja_poses.jpg hoja_frente.jpg icono.jpg
     python3 tools/procesar_cuba.py --mimado hoja_mimado.jpg   (2 poses para "acariciar a Cuba")
     python3 tools/procesar_cuba.py --hoja hoja.jpg COLUMNAS nombre1 nombre2 ...   (hoja con grilla: nombres en orden de lectura, izquierda→derecha y arriba→abajo)
(Las hojas originales pesan mucho y no se suben al repo; salen WebP chicos con fondo transparente.)"""
import sys, pathlib
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

root = pathlib.Path(__file__).resolve().parent.parent
out = root / 'assets' / 'cuba'; out.mkdir(parents=True, exist_ok=True)
BG_TOL = 46

def cutout(img):
    """Fondo liso → transparente: lo conectado con el borde y los huecos grandes del mismo color (entre patas, bajo la cola).
    Los caracoles (crema parecida pero algo más oscura) y los brillos de los ojos se conservan."""
    a = np.asarray(img.convert('RGB')).astype(int)
    h, w, _ = a.shape
    corners = np.array([a[2, 2], a[2, w - 3], a[h - 3, 2], a[h - 3, w - 3]]).mean(axis=0)
    dist = np.abs(a - corners).sum(axis=2)
    near = dist < BG_TOL
    lab, k = ndi.label(near)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border))
    for i in range(1, k + 1):  # huecos encerrados que son fondo puro
        if i in border: continue
        m = lab == i
        if m.sum() > 1900 and dist[m].mean() < 13: bg |= m
    alpha = ~bg
    alpha = ndi.binary_opening(alpha, iterations=1)
    return alpha, a

def render(alpha, a, mask):
    al = Image.fromarray(((alpha & mask) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.9))
    rgba = Image.fromarray(a.astype(np.uint8)).convert('RGBA'); rgba.putalpha(al)
    return rgba

def pieces(img, n):
    alpha, a = cutout(img)
    big = ndi.binary_dilation(alpha, iterations=22)  # une las partes de un mismo dibujo
    lab, k = ndi.label(big)
    sizes = ndi.sum(alpha, lab, range(1, k + 1))
    keep = [i + 1 for i in np.argsort(sizes)[::-1][:n]]
    res = []
    for i in keep:
        m = lab == i
        ys, xs = np.where(m & alpha)
        box = (max(xs.min() - 6, 0), max(ys.min() - 6, 0), xs.max() + 7, ys.max() + 7)
        res.append((box, render(alpha, a, m).crop(box)))  # solo ESTE dibujo: no se cuelan pedazos del vecino
    return res

def save(im, name, side=420):
    im = im.copy(); im.thumbnail((side, side), Image.LANCZOS)
    p = out / (name + '.webp'); im.save(p, 'WEBP', quality=82, method=6)
    print(name, im.size, p.stat().st_size, 'bytes')

def mimado(hoja_path):
    """Hoja con 2 poses de 'mimado' (mismo encuadre): salen alineadas por los pies y el centro del cuerpo para poder alternarlas sin saltos."""
    hoja = Image.open(hoja_path)
    alpha, a = cutout(hoja)
    big = ndi.binary_dilation(alpha, iterations=22)
    lab, k = ndi.label(big)
    sizes = ndi.sum(alpha, lab, range(1, k + 1))
    keep = [i + 1 for i in np.argsort(sizes)[::-1][:2]]
    parts = []
    for i in keep:
        m = lab == i; ys, xs = np.where(m & alpha)
        low = (m & alpha)[int(ys.min() + (ys.max() - ys.min()) * .7):ys.max() + 1]  # el cuerpo de abajo: ancla horizontal estable (las orejas se mueven)
        cx = np.where(low)[1].mean()
        parts.append(dict(m=m, x0=xs.min(), x1=xs.max(), y0=ys.min(), y1=ys.max(), cx=cx))
    parts.sort(key=lambda d: d['cx'])
    L = int(max(d['cx'] - d['x0'] for d in parts)) + 8; R = int(max(d['x1'] - d['cx'] for d in parts)) + 8
    T = int(max(d['y1'] - d['y0'] for d in parts)) + 8
    for d, name in zip(parts, ['mimado_a', 'mimado_b']):
        full = render(alpha, a, d['m'])
        canvas = Image.new('RGBA', (L + R, T), (0, 0, 0, 0))
        crop = full.crop((int(d['x0']), int(d['y0']), int(d['x1']) + 1, int(d['y1']) + 1))
        canvas.paste(crop, (int(L - (d['cx'] - d['x0'])), T - 4 - crop.size[1]))  # pies abajo, cuerpo centrado
        save(canvas, name, 460)


def cutout_verde(img):
    """Para hojas con fondo verde puro #00FF00: transparencia por color (también los huecos entre patas) y se le quita el verde al borde suavizado."""
    a = np.asarray(img.convert('RGB')).astype(float)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    verde = g - np.maximum(r, b)            # ~255 en el fondo, ~0 o negativo en el dibujo
    alpha = np.clip(1 - (verde - 35) / 50, 0, 1)   # también borra la sombra verde oscura del piso
    spill = np.maximum(g - np.maximum(r, b), 0) * (alpha > 0)
    a[..., 1] = g - spill * 0.9             # el verde sobrante del borde se apaga
    a = np.clip(a, 0, 255)
    return alpha, a


def hoja(path, cols, nombres):
    """Hoja de sprites en grilla: corta cada dibujo y lo guarda con el nombre que le toca por orden de lectura (celdas vacías no cuentan)."""
    img = Image.open(path)
    alpha, a = cutout_verde(img)
    sol = alpha > .5
    lab, k = ndi.label(ndi.binary_dilation(sol, iterations=max(4, round(img.size[0] * 0.009))))  # une partes de un dibujo sin juntar vecinos (escala con la hoja)
    sizes = ndi.sum(sol, lab, range(1, k + 1))
    ps = []
    keep = [j + 1 for j in np.argsort(sizes)[::-1][:len(nombres)]]
    masks = {i: (lab == i) for i in keep}
    # Pedacitos sueltos (confeti, notas, monedas): van con el dibujo más cercano si están a menos del 6% del ancho de la hoja.
    resto = sol & ~np.isin(lab, keep)
    bl, nb = ndi.label(ndi.binary_dilation(resto, iterations=3))
    for j, sl in enumerate(ndi.find_objects(bl), 1):
        ys, xs = np.where((bl == j) & resto)
        if not len(xs): continue
        cx, cy = xs.mean(), ys.mean(); best, bd = None, img.size[0] * 0.06
        for i in keep:
            yy, xx = np.where(masks[i] & sol)
            d = np.sqrt((np.clip(cx, xx.min(), xx.max()) - cx) ** 2 + (np.clip(cy, yy.min(), yy.max()) - cy) ** 2)
            if d < bd: best, bd = i, d
        if best: masks[best] = masks[best] | ((bl == j) & resto)
    for i in keep:
        m = masks[i]
        ys, xs = np.where(m & sol)
        box = (max(xs.min() - 6, 0), max(ys.min() - 6, 0), xs.max() + 7, ys.max() + 7)
        al = Image.fromarray((alpha * m * 255).astype(np.uint8))
        rgba = Image.fromarray(a.astype(np.uint8)).convert('RGBA'); rgba.putalpha(al)
        ps.append((box, rgba.crop(box)))
    ps.sort(key=lambda p: (p[0][1] + p[0][3]) / 2)
    filas = [sorted(ps[i:i + cols], key=lambda p: p[0][0]) for i in range(0, len(ps), cols)]
    for (box, im), name in zip([p for f in filas for p in f], nombres):
        save(im, name)


def principal():
    hoja, frente, icono = [Image.open(x) for x in sys.argv[1:4]]
    W, H = hoja.size
    for box, im in pieces(hoja, 4):
        cx, cy = (box[0] + box[2]) / 2 / W, (box[1] + box[3]) / 2 / H
        name = {(0, 0): 'feliz', (1, 0): 'alerta', (0, 1): 'durmiendo', (1, 1): 'frente_alerta'}[(int(cx > .5), int(cy > .5))]
        save(im, name)
    fw = frente.size[0]
    fr = sorted(pieces(frente, 2), key=lambda p: p[0][0])  # izquierda: de frente (se usa); derecha: mira a la izquierda (descartada)
    save(fr[0][1], 'tranquilo')

    # Ícono: se usa el que armó Gemini; las esquinas redondeadas se rellenan con el color de fondo para que cada sistema aplique su máscara.
    ic = icono.convert('RGB'); a = np.asarray(ic).astype(int)
    bgc = np.array(a[512, 6]); near = np.abs(a - np.array([254, 254, 254])).sum(axis=2) < 60
    lab, _ = ndi.label(near)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    mask = ndi.binary_dilation(np.isin(lab, list(border)), iterations=3)
    a[mask] = bgc
    full = Image.fromarray(a.astype(np.uint8))
    (root / 'icons').mkdir(exist_ok=True)
    full.resize((512, 512), Image.LANCZOS).save(root / 'icons/icon-512.png', optimize=True)
    full.resize((192, 192), Image.LANCZOS).save(root / 'icons/icon-192.png', optimize=True)
    full.resize((180, 180), Image.LANCZOS).save(root / 'icons/apple-touch-icon.png', optimize=True)
    mk = Image.new('RGB', (512, 512), tuple(int(x) for x in bgc)); inner = full.resize((410, 410), Image.LANCZOS); mk.paste(inner, (51, 51))
    last = mk.crop((0, 460, 512, 461)).resize((512, 51)); mk.paste(last, (0, 461))  # el cuerpo sigue hacia abajo (la imagen original lo corta en el borde)
    mk.save(root / 'icons/icon-maskable-512.png', optimize=True)
    print('íconos listos')

if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--mimado':
        mimado(sys.argv[2])
    elif len(sys.argv) > 4 and sys.argv[1] == '--hoja':
        hoja(sys.argv[2], int(sys.argv[3]), sys.argv[4:])
    else:
        principal()
