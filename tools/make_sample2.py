"""Muestra de prueba con varias palabras y colores (como un cartel): tools/out/sample.rgba"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
OUT = Path(__file__).resolve().parent / "out"
F = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
img = Image.new("RGBA", (900, 560), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
d.text((10, 0), "CADA", font=ImageFont.truetype(F, 48), fill=(25, 25, 25, 255))
d.text((170, -20), "LETRA", font=ImageFont.truetype(F, 150), fill=(214, 40, 40, 255))
d.text((10, 160), "ESTRECHAN", font=ImageFont.truetype(F, 150), fill=(214, 40, 40, 255))
d.text((10, 330), "VEZ DE", font=ImageFont.truetype(F, 190), fill=(28, 28, 28, 255))
bb = img.getbbox(); img = img.crop(bb)
OUT.mkdir(exist_ok=True)
(OUT / "sample.rgba").write_bytes(img.tobytes()); (OUT / "sample.json").write_text(json.dumps({"w": img.width, "h": img.height}))
print(img.size)
