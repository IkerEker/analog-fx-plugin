"""Convierte las texturas originales al formato ligero del plugin.

Estructura de origen:  textures-src/<familia>/<familia>_<n>.(jpg|png|webp)
(las carpetas que empiezan por "_" se ignoran, p. ej. _descartadas)

Por cada textura genera:
  plugin/textures/<id>.bin         gris 8 bits, ecualizada, tamaño según la familia
  plugin/textures/thumbs/<id>.jpg  miniatura para la interfaz
y el índice plugin/textures/textures.json

Uso:  python3 tools/build_textures.py
"""
import json, re, shutil, sys
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "textures-src"
OUT = ROOT / "plugin" / "textures"
THUMB = 96
# tamaño de almacenamiento por familia (potencia de 2): las aguadas necesitan más detalle
SIZES = {"acuarela": 1024, "humedad": 1024, "gotas": 1024, "granulado": 512, "moteado": 512, "piedra": 512}
NAMES = {"acuarela": "Aguada", "humedad": "Humedad", "gotas": "Gotas", "granulado": "Grano", "moteado": "Moteado", "piedra": "Piedra"}


def equalize(gray):
    flat = gray.ravel()
    order = np.argsort(flat, kind="stable")
    ranks = np.empty_like(order)
    ranks[order] = np.arange(flat.size)
    return (ranks * (255.0 / (flat.size - 1))).reshape(gray.shape).round().astype(np.uint8)


def natural(p):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", p.name)]


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "thumbs").mkdir(parents=True)
    index = []
    for fam_dir in sorted(d for d in SRC.iterdir() if d.is_dir() and not d.name.startswith("_")):
        fam = fam_dir.name
        size = SIZES.get(fam, 512)
        files = sorted([f for f in fam_dir.iterdir() if f.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")], key=natural)
        for k, f in enumerate(files, 1):
            tid = f"{fam}_{k}"
            img = Image.open(f).convert("RGB")
            # tamaño de lado completo: reescalar la imagen entera conserva la repetición (tileable)
            gray = np.asarray(img.convert("L").resize((size, size), Image.Resampling.LANCZOS))
            (OUT / f"{tid}.bin").write_bytes(equalize(gray).tobytes())
            img.resize((THUMB, THUMB), Image.Resampling.LANCZOS).save(OUT / "thumbs" / f"{tid}.jpg", quality=80)
            index.append({"id": tid, "family": fam, "label": f"{NAMES.get(fam, fam.capitalize())} {k}", "size": size})
            print("ok", tid, size)
    (OUT / "textures.json").write_text(json.dumps(index, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    sys.exit(main())
