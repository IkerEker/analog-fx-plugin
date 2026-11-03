"""Convierte las texturas originales (textures-src/*.png) al formato ligero del plugin.

Por cada textura genera:
  plugin/textures/<id>.bin        1024x1024, 8 bits gris, ecualizada (valores uniformes 0..255)
  plugin/textures/thumbs/<id>.jpg miniatura en color para la interfaz
y un indice plugin/textures/textures.json.

Uso:  python3 tools/build_textures.py
"""
import json, re, sys
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "textures-src"
OUT = ROOT / "plugin" / "textures"
SIZE = 1024
THUMB = 112
FAMILY_NAMES = {"frias": "Frías", "grises": "Grises"}


def equalize(gray):
    flat = gray.ravel()
    order = np.argsort(flat, kind="stable")
    ranks = np.empty_like(order)
    ranks[order] = np.arange(flat.size)
    return (ranks * (255.0 / (flat.size - 1))).reshape(gray.shape).round().astype(np.uint8)


def main():
    (OUT / "thumbs").mkdir(parents=True, exist_ok=True)
    index = []
    files = sorted(SRC.glob("*.png"), key=lambda p: [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", p.name)])
    for f in files:
        m = re.search(r"Pinceladas_([A-Za-z]+)_(\d+)", f.name)
        family = m.group(1).lower() if m else "otras"
        num = m.group(2) if m else str(len(index) + 1)
        tid = f"{family}_{num}"
        img = Image.open(f).convert("RGB")
        gray = np.asarray(img.convert("L").resize((SIZE, SIZE), Image.Resampling.BOX))
        (OUT / f"{tid}.bin").write_bytes(equalize(gray).tobytes())
        img.resize((THUMB, THUMB), Image.Resampling.LANCZOS).save(OUT / "thumbs" / f"{tid}.jpg", quality=82)
        index.append({"id": tid, "family": family, "label": f"{FAMILY_NAMES.get(family, family.capitalize())} {num}", "size": SIZE})
        print("ok", tid)
    (OUT / "textures.json").write_text(json.dumps(index, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    sys.exit(main())
