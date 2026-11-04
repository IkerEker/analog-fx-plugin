// Genera plugin/thumbs/<técnica>.jpg renderizando la primera variante de cada técnica.
// Uso: node tools/build_thumbs.js
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const E = require('../plugin/js/engine.js'), P = require('../plugin/js/presets.js');
const out = path.join(__dirname, 'out'), TEX = path.join(__dirname, '../plugin/textures'), DST = path.join(__dirname, '../plugin/thumbs');
fs.mkdirSync(DST, { recursive: true }); fs.mkdirSync(out, { recursive: true });
execFileSync('python3', ['-I', path.join(__dirname, 'make_sample.py'), 'Aa', '170']);
const meta = JSON.parse(fs.readFileSync(path.join(out, 'sample.json'))), px = fs.readFileSync(path.join(out, 'sample.rgba'));
const index = JSON.parse(fs.readFileSync(path.join(TEX, 'textures.json'))), cache = {};
function tex(id) { const m = index.find(t => t.id === id); if (!cache[id]) cache[id] = E.prepareTexture(fs.readFileSync(path.join(TEX, id + '.bin')), m.size); return cache[id]; }
for (const t of P.TECHS) {
  const p = P.build(E.DEFAULTS, t, t.variants[0]); p.seed = 7;
  const pal = t.palettes.find(x => x.ink !== 'original') || t.palettes[0];
  p.out.color = pal.ink === 'original' ? '#151515' : pal.ink; if (pal.c2) p.tintas.c2 = pal.c2; if (pal.c3) p.tintas.c3 = pal.c3;
  const inp = E.prepare(px, meta.w, meta.h, 4, p);
  const rgba = E.render(inp, p, { desgaste: tex(p.texture), aguada: tex('aguada_1'), grano: tex('grano_1'), rodillo: tex('rodillo_1') });
  let x0 = inp.w, y0 = inp.h, x1 = -1, y1 = -1;
  for (let y = 0; y < inp.h; y++) for (let x = 0; x < inp.w; x++) if (rgba[(y * inp.w + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const pd = 6; x0 = Math.max(0, x0 - pd); y0 = Math.max(0, y0 - pd); x1 = Math.min(inp.w - 1, x1 + pd); y1 = Math.min(inp.h - 1, y1 + pd);
  const W = x1 - x0 + 1, H = y1 - y0 + 1, bg = [240, 237, 229], img = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const si = ((y + y0) * inp.w + x + x0) * 4, di = (y * W + x) * 3, a = rgba[si + 3] / 255;
    for (let k = 0; k < 3; k++) img[di + k] = Math.round(bg[k] * (1 - a + a * rgba[si + k] / 255)); }
  const ppm = path.join(out, `thumb_${t.id}.ppm`);
  fs.writeFileSync(ppm, Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), img]));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', ppm, '-vf', 'scale=300:170:force_original_aspect_ratio=decrease,pad=300:170:(ow-iw)/2:(oh-ih)/2:color=0xF0EDE5', '-q:v', '4', path.join(DST, t.id + '.jpg')]);
  console.log('thumb', t.id);
}
