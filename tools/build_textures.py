"""Convierte las texturas elegidas (tools/textures_manifest.json) al formato del plugin.

Genera plugin/textures/<familia>_<n>.bin (gris 8 bits ecualizado), miniaturas y textures.json.
Uso: python3 tools/build_textures.py
"""
import json, shutil, sys
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "textures-src"
OUT = ROOT / "plugin" / "textures"
MAN = json.loads((ROOT / "tools" / "textures_manifest.json").read_text())


def equalize(gray):
    flat = gray.ravel()
    order = np.argsort(flat, kind="stable")
    ranks = np.empty_like(order)
    ranks[order] = np.arange(flat.size)
    return (ranks * (255.0 / (flat.size - 1))).reshape(gray.shape).round().astype(np.uint8)


def seamless(a):
    """Hace la textura repetible: mezcla con su copia desplazada media vuelta con una máscara suave."""
    S = a.shape[0]
    b = np.roll(np.roll(a, S // 2, 0), S // 2, 1)
    t = np.minimum(np.arange(S), S - 1 - np.arange(S)) / (S / 2)
    t = np.clip((t - 0.08) / 0.5, 0, 1); t = t * t * (3 - 2 * t)
    w = np.minimum.outer(t, t)
    # igualar contraste local para que la mezcla no se vea lavada
    out = a * w + b * (1 - w)
    return out


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "thumbs").mkdir(parents=True)
    count, index = {}, []
    for fam, rel in MAN["textures"]:
        info = MAN["families"][fam]
        count[fam] = count.get(fam, 0) + 1
        tid = f"{fam}_{count[fam]}"
        img = Image.open(SRC / rel).convert("RGB")
        if img.width != img.height:          # recorte cuadrado centrado (texturas 9:16)
            m = min(img.size); img = img.crop(((img.width - m) // 2, (img.height - m) // 2, (img.width - m) // 2 + m, (img.height - m) // 2 + m))
        gray = np.asarray(img.convert("L").resize((info["size"], info["size"]), Image.Resampling.LANCZOS)).astype(np.float32)
        if info.get("seamless"):
            gray = seamless(gray)
        (OUT / f"{tid}.bin").write_bytes(equalize(gray).tobytes())
        img.resize((96, 96), Image.Resampling.LANCZOS).save(OUT / "thumbs" / f"{tid}.jpg", quality=80)
        index.append({"id": tid, "family": fam, "label": f"{info['label']} {count[fam]}", "size": info["size"]})
        print("ok", tid)
    (OUT / "textures.json").write_text(json.dumps(index, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    sys.exit(main())
