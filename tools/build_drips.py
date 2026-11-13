#!/usr/bin/env python3
"""
Banco de GOTEOS reales: extrae, clasifica y empaqueta las gotas de la carpeta GOTAS/.

Entrada:  GOTAS/*.png        fotos de goteos de pintura gris/blanca sobre fondo negro (941x1672 o 1254x1254)
Salida:
  BIBLIOTECA/goteos/<clase>/goteo_NNN.png   cada gota suelta, recortada, RGBA:
                                             RGB = sombreado original (gris), A = máscara suave de la pintura
  BIBLIOTECA/goteos/catalogo.json           una entrada por gota con su clase y medidas
  BIBLIOTECA/goteos/CATALOGO.md             resumen legible
  BIBLIOTECA/goteos/hojas/<clase>.png       hoja de contactos de cada clase (para revisar a ojo)
  plugin/drips/drips.bin + drips.json       versión ligera para el plugin (máscara + sombreado, 8 bits,
                                             alto máximo 320 px)

Clases (por forma, medidas automáticamente; ver clasificar()):
  lagrima       cuelga de arriba y acaba en un bulbo/lágrima claro (pintura espesa)
  fina          cuelga de arriba, recta y estrecha, sin bulbo marcado (pintura líquida)
  serpenteante  cuelga de arriba y ondula de lado a lado
  seca          pintura seca/agrietada: superficie con grietas o grumos
  impacto       gota que cae: cabeza ancha arriba (donde golpea) y cola que chorrea hacia abajo
  suelta        gota desprendida y corta, que no toca el borde de arriba (gotitas que caen)

Notas:
  - "Cuelga de arriba" = la gota toca el borde superior de la foto: ese extremo es la RAÍZ, la que se
    une a la letra/forma de la que gotea.
  - Los trozos de una misma gota que la foto parte (gotas finas discontinuas) se agrupan con una
    dilatación vertical antes de etiquetar.
  - Determinista: mismo GOTAS/ -> mismo resultado.
Uso:  python3 tools/build_drips.py
"""
import json, os, struct, sys
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "GOTAS"
LIB = ROOT / "BIBLIOTECA" / "goteos"
PLUG = ROOT / "plugin" / "drips"
CLASSES = ["lagrima", "fina", "serpenteante", "seca", "impacto", "suelta"]
PLUGIN_MAX_H = 320


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def box_blur(a, r):
    if r < 1:
        return a.copy()
    k = 2 * r + 1
    p = np.pad(a, r, mode="edge")
    c = p.cumsum(0)
    c = np.vstack([np.zeros((1, c.shape[1])), c])
    v = (c[k:] - c[:-k]) / k
    c2 = v.cumsum(1)
    c2 = np.hstack([np.zeros((c2.shape[0], 1)), c2])
    return (c2[:, k:] - c2[:, :-k]) / k


def dilate(m, rx, ry):
    o = m.copy()
    for dy in range(-ry, ry + 1):
        for dx in range(-rx, rx + 1):
            if dx == 0 and dy == 0:
                continue
            s = np.roll(np.roll(m, dy, 0), dx, 1)
            if dy > 0: s[:dy] = False
            if dy < 0: s[dy:] = False
            if dx > 0: s[:, :dx] = False
            if dx < 0: s[:, dx:] = False
            o |= s
    return o


def label(m):
    """Componentes 8-conexas de una máscara booleana (pila, sin scipy)."""
    h, w = m.shape
    lab = np.zeros((h, w), np.int32)
    n = 0
    ys, xs = np.nonzero(m)
    for y0, x0 in zip(ys, xs):
        if lab[y0, x0]:
            continue
        n += 1
        st = [(y0, x0)]
        lab[y0, x0] = n
        while st:
            y, x = st.pop()
            for dy in (-1, 0, 1):
                yy = y + dy
                if yy < 0 or yy >= h:
                    continue
                for dx in (-1, 0, 1):
                    xx = x + dx
                    if 0 <= xx < w and m[yy, xx] and not lab[yy, xx]:
                        lab[yy, xx] = n
                        st.append((yy, xx))
    return lab, n


def medidas(alpha, lum, anchored):
    """Medidas de forma de una gota recortada (alpha 0..1, lum 0..1)."""
    H, W = alpha.shape
    rows = alpha > 0.5
    width = rows.sum(1).astype(float)
    filled = width > 0
    if filled.sum() < 3:
        return None
    xs = np.arange(W)
    cen = np.where(filled, (rows * xs).sum(1) / np.maximum(width, 1), np.nan)
    idx = np.nonzero(filled)[0]
    wm = float(np.median(width[filled]))
    n10 = max(1, len(idx) // 10)
    root = float(np.median(width[idx[:n10]]))
    mid = width[idx[int(len(idx) * 0.15):int(len(idx) * 0.7)]]
    wmid = float(np.median(mid)) if len(mid) else wm
    tail = np.sort(width[idx[int(len(idx) * 0.72):]])
    bulb = float(tail[-3:].mean()) if len(tail) >= 3 else wm
    head = np.sort(width[idx[:max(3, len(idx) // 6)]])
    headw = float(head[-3:].mean())
    # ondulación: desviación del eje respecto a una recta, relativa al alto
    yy = idx.astype(float)
    cc = cen[idx]
    A = np.vstack([yy, np.ones_like(yy)]).T
    coef, *_ = np.linalg.lstsq(A, cc, rcond=None)
    dev = cc - A @ coef
    wav = float((dev.max() - dev.min()) / max(1.0, len(idx)))
    wav_px = float(dev.max() - dev.min())
    # grietas / grumos: contraste fino del sombreado dentro de la pintura
    inside = alpha > 0.9
    for _ in range(3):   # erosión: solo el interior, lejos del borde
        inside = inside & np.roll(inside, 1, 0) & np.roll(inside, -1, 0) & np.roll(inside, 1, 1) & np.roll(inside, -1, 1)
    # grietas = líneas finas MÁS OSCURAS que su entorno (los brillos de la pintura brillante son claros)
    dk = lum < 0.72 * box_blur(lum, 4)
    crack = float(dk[inside].mean()) if (inside.sum() > 200 and wm >= 12) else 0.0
    gaps = int(((~filled[idx[0]:idx[-1] + 1])).sum())
    return dict(h=int(H), w=int(W), largo=int(len(idx)), ancho_medio=round(wm, 2), ancho_raiz=round(root, 2),
                ancho_bulbo=round(bulb, 2), bulbo=round(bulb / max(1.0, wmid), 3), cabeza=round(headw / max(1.0, wmid), 3), ondulacion=round(wav, 4),
                ondulacion_px=round(wav_px, 1), grietas=round(crack, 4), huecos=gaps, cuelga=bool(anchored))


def clasificar(m, nombre):
    """Por forma (no por el nombre del archivo). Umbrales calibrados mirando las hojas de contactos."""
    cab_ancha = m["cabeza"] >= 2.4 and m["ancho_medio"] * m["cabeza"] >= 40
    if not m["cuelga"]:
        if cab_ancha:
            return "impacto"
        if m["largo"] < 10 * max(4.0, m["ancho_medio"]):
            return "suelta"
    if m["grietas"] >= 0.014:
        return "seca"
    if m["ondulacion"] > 0.03 and m["ondulacion_px"] > 2.5 * m["ancho_medio"]:
        return "serpenteante"
    if m["bulbo"] >= 1.5 and m["ancho_bulbo"] >= 14 and m["ancho_medio"] >= 9:
        return "lagrima"
    return "fina"


def main():
    files = sorted(p for p in SRC.iterdir() if p.suffix.lower() == ".png")
    if not files:
        sys.exit("No hay imágenes en GOTAS/")
    for c in CLASSES:
        (LIB / c).mkdir(parents=True, exist_ok=True)
        for old in (LIB / c).glob("goteo_*.png"):
            old.unlink()
    (LIB / "hojas").mkdir(parents=True, exist_ok=True)
    PLUG.mkdir(parents=True, exist_ok=True)
    cat, packed, blob, num = [], [], bytearray(), 0
    for f in files:
        L = np.asarray(Image.open(f).convert("L")).astype(np.float32) / 255.0
        Hs, Ws = L.shape
        alpha_full = smooth(0.025, 0.11, L)                 # el fondo es negro puro; la pintura, gris
        core = L > 0.06
        grp, n = label(dilate(core, 2, 9))                  # agrupa trozos de una misma gota
        for k in range(1, n + 1):
            comp = (grp == k) & (alpha_full > 0.02)
            ys, xs = np.nonzero(comp)
            if len(ys) < 60:
                continue                                    # motas sueltas de ruido
            y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
            if (y1 - y0) < 12 and (x1 - x0) < 12:
                continue
            pad = 3
            Y0, Y1, X0, X1 = max(0, y0 - pad), min(Hs, y1 + pad + 1), max(0, x0 - pad), min(Ws, x1 + pad + 1)
            a = np.where(comp[Y0:Y1, X0:X1] | dilate(comp[Y0:Y1, X0:X1], 1, 1), alpha_full[Y0:Y1, X0:X1], 0)
            lum = L[Y0:Y1, X0:X1]
            anchored = y0 <= 0.06 * Hs
            m = medidas(a, lum, anchored)
            if m is None or m["largo"] < 15:
                continue
            # trozos de ruido de las gotas finas: fuera (las gotas sueltas de verdad son gordas)
            if not anchored and m["largo"] < 10 * max(4.0, m["ancho_medio"]) and (m["ancho_medio"] < 6 or m["largo"] < 20):
                continue
            if m["largo"] < 40 and m["ancho_medio"] < 8:
                continue
            cls = clasificar(m, f.name)
            num += 1
            gid = f"goteo_{num:03d}"
            shade = np.clip(lum / max(0.05, np.percentile(lum[a > 0.6], 95) if (a > 0.6).any() else 1), 0, 1)
            rgba = np.dstack([shade * 255] * 3 + [a * 255]).round().astype(np.uint8)
            Image.fromarray(rgba, "RGBA").save(LIB / cls / f"{gid}.png", optimize=True)
            entry = dict(id=gid, clase=cls, archivo=f"{cls}/{gid}.png", origen=f.name,
                         origen_caja=[int(X0), int(Y0), int(X1 - X0), int(Y1 - Y0)], **m)
            cat.append(entry)
            # versión ligera para el plugin
            sc = min(1.0, PLUGIN_MAX_H / a.shape[0])
            pw, ph = max(1, round(a.shape[1] * sc)), max(1, round(a.shape[0] * sc))
            ai = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).resize((pw, ph), Image.LANCZOS))
            si = np.asarray(Image.fromarray((shade * 255).astype(np.uint8)).resize((pw, ph), Image.LANCZOS))
            packed.append(dict(id=gid, c=cls, w=pw, h=ph, o=len(blob), s=round(sc, 4),
                               rw=round(m["ancho_raiz"] * sc, 2), mw=round(m["ancho_medio"] * sc, 2),
                               bw=round(m["ancho_bulbo"] * sc, 2), L=round(m["largo"] * sc, 1),
                               cg=1 if m["cuelga"] else 0, ox=round(m["ondulacion_px"] * sc, 1),
                               gp=round(m["huecos"] / max(1, m["largo"]), 4)))
            blob += ai.tobytes() + si.tobytes()
    (LIB / "catalogo.json").write_text(json.dumps(cat, ensure_ascii=False, indent=1))
    (PLUG / "drips.bin").write_bytes(bytes(blob))
    (PLUG / "drips.json").write_text(json.dumps({"version": 1, "formato": "por gota: w*h bytes de máscara y luego w*h de sombreado, desde 'o'", "items": packed}, ensure_ascii=False))
    # hojas de contactos y catálogo legible
    lines = ["# Banco de goteos reales", "", f"Extraídos de `GOTAS/` ({len(files)} fotos) con `tools/build_drips.py`. {len(cat)} gotas.", "",
             "Cada PNG: RGB = sombreado original en gris, A = máscara suave. La raíz (unión con la letra) es el borde de ARRIBA, salvo en `suelta` e `impacto`. Guía de uso: `README.md`.", ""]
    for c in CLASSES:
        items = [e for e in cat if e["clase"] == c]
        lines += [f"## {c}  ({len(items)})", ""]
        desc = {"lagrima": "cuelga y acaba en un bulbo/lágrima (pintura espesa)", "fina": "cuelga recta y estrecha, sin bulbo marcado",
                "serpenteante": "cuelga y ondula de lado a lado", "seca": "pintura seca/agrietada, con grietas o grumos",
                "impacto": "gota que cae: cabeza arriba donde golpea y cola que chorrea",
                "suelta": "gota desprendida y corta, no toca el borde de arriba"}[c]
        lines += [f"Uso: {desc}.", ""]
        if not items:
            continue
        th = 150
        tiles = []
        for e in items:
            im = Image.open(LIB / e["archivo"])
            bg = Image.new("RGBA", im.size, (20, 20, 20, 255)); bg.alpha_composite(im)
            bg = bg.convert("RGB"); bg.thumbnail((60, th))
            tiles.append(bg)
        cols = 20
        sheet = Image.new("RGB", (cols * 64, ((len(tiles) + cols - 1) // cols) * (th + 4)), (60, 0, 0))
        for i, t in enumerate(tiles):
            sheet.paste(t, ((i % cols) * 64 + 2, (i // cols) * (th + 4) + 2))
        sheet.save(LIB / "hojas" / f"{c}.png")
        lines += [f"Hoja: `hojas/{c}.png`", ""]
    (LIB / "CATALOGO.md").write_text("\n".join(lines) + "\n")
    print(len(cat), "gotas;", {c: sum(e["clase"] == c for e in cat) for c in CLASSES}, "plugin bin", len(blob) // 1024, "KB")


if __name__ == "__main__":
    main()
