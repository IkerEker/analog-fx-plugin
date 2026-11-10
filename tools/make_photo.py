"""Genera una 'fotografía' de prueba con tono continuo (escena con esferas, suelo y cielo).
tools/out/photo.rgba (opaca) y tools/out/photo_alpha.rgba (con fondo transparente) + .json"""
import json
from pathlib import Path
import numpy as np
OUT = Path(__file__).resolve().parent / "out"; OUT.mkdir(exist_ok=True)
W, H = 900, 640
ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
u = (xs - W / 2) / H; v = -(ys - H * 0.45) / H
ro = np.array([0, 0.6, -3.2], np.float32)
rd = np.stack([u, v - 0.12, np.full_like(u, 1.25)], -1); rd /= np.linalg.norm(rd, axis=-1, keepdims=True)
spheres = [((-0.9, 0.55, 0.6), 0.55, (0.85, 0.25, 0.18)), ((0.35, 0.8, 1.4), 0.8, (0.2, 0.45, 0.8)), ((1.25, 0.35, 0.1), 0.35, (0.95, 0.8, 0.3))]
L = np.array([-0.5, 0.8, -0.35], np.float32); L /= np.linalg.norm(L)
t_best = np.full((H, W), 1e9, np.float32); col = np.zeros((H, W, 3), np.float32); hit = np.zeros((H, W), bool)
def sph(c, r, o, d):
    oc = o - np.array(c, np.float32); b = (oc * d).sum(-1); cc = (oc * oc).sum(-1) - r * r; disc = b * b - cc
    t = -b - np.sqrt(np.maximum(disc, 0)); return np.where((disc > 0) & (t > 1e-3), t, 1e9)
for c, r, al in spheres:
    t = sph(c, r, ro, rd); m = t < t_best; t_best = np.where(m, t, t_best)
    p = ro + rd * t[..., None]; n = (p - np.array(c)) / r
    dif = np.clip((n * L).sum(-1), 0, 1); spec = np.clip((n * (L - rd) / np.linalg.norm(L - rd, axis=-1, keepdims=True)).sum(-1), 0, 1) ** 40
    shade = np.array(al) * (0.12 + 0.88 * dif[..., None]) + spec[..., None] * 0.6
    col = np.where(m[..., None], shade, col); hit |= m
# suelo
tg = np.where(rd[..., 1] < -1e-3, -ro[1] / rd[..., 1], 1e9); mg = (tg < t_best)
pg = ro + rd * tg[..., None]
chk = ((np.floor(pg[..., 0] * 1.2) + np.floor(pg[..., 2] * 1.2)) % 2)[..., None]
ground = np.array([0.75, 0.72, 0.65]) * (0.85 + 0.15 * chk)
sh = np.zeros((H, W), np.float32)
for c, r, al in spheres:
    ts = sph(c, r, pg, np.broadcast_to(L, pg.shape)); sh = np.maximum(sh, (ts < 1e8).astype(np.float32))
ground = ground * (1 - 0.55 * sh[..., None]) * np.clip(1.1 - np.abs(pg[..., 2]) * 0.06, 0.4, 1)[..., None]
sky = np.array([0.55, 0.7, 0.9]) * (0.6 + 0.6 * np.clip(rd[..., 1:2] * 2, 0, 1)) + np.array([0.4, 0.3, 0.2]) * np.clip(1 - rd[..., 1:2] * 4, 0, 1) * 0.5
img = np.where(mg[..., None], ground, sky); img = np.where(hit[..., None], col, img)
img = np.clip(img, 0, 1) ** (1 / 1.4)
rgb = (img * 255).astype(np.uint8)
a = np.full((H, W, 1), 255, np.uint8)
(OUT / "photo.rgba").write_bytes(np.concatenate([rgb, a], -1).tobytes())
a2 = (hit.astype(np.uint8) * 255)[..., None]
(OUT / "photo_alpha.rgba").write_bytes(np.concatenate([rgb, a2], -1).tobytes())
(OUT / "photo.json").write_text(json.dumps({"w": W, "h": H}))
from PIL import Image; Image.fromarray(rgb).save(OUT / "photo.png"); print("ok")
