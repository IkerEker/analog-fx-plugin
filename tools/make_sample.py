"""Genera una muestra de texto (RGBA) para probar el motor: tools/out/sample.rgba + .json"""
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
OUT = Path(__file__).resolve().parent / "out"
text = sys.argv[1] if len(sys.argv) > 1 else "REKT"
size = int(sys.argv[2]) if len(sys.argv) > 2 else 300
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", size)
l, t, r, b = font.getbbox(text)
img = Image.new("RGBA", (r - l, b - t), (0, 0, 0, 0))
ImageDraw.Draw(img).text((-l, -t), text, font=font, fill=(18, 18, 18, 255))
OUT.mkdir(exist_ok=True)
(OUT / "sample.rgba").write_bytes(img.tobytes())
(OUT / "sample.json").write_text(json.dumps({"w": img.width, "h": img.height}))
print(img.size)
