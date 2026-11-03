// Banco de pruebas: aplica cada estilo a la muestra y crea tools/out/presets.png
// Uso: python3 tools/make_sample.py REKT 300 && node tools/test-engine.js
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const E = require('../plugin/js/engine.js'), PRESETS = require('../plugin/js/presets.js');
const out = path.join(__dirname, 'out');
const meta = JSON.parse(fs.readFileSync(path.join(out, 'sample.json')));
const px = fs.readFileSync(path.join(out, 'sample.rgba'));
const texCache = {};
function tex(id) {
  if (!texCache[id]) texCache[id] = E.prepareTexture(fs.readFileSync(path.join(__dirname, '../plugin/textures', id + '.bin')), 1024);
  return texCache[id];
}
function merge(a, b) { const o = JSON.parse(JSON.stringify(a)); for (const k in b) o[k] = (typeof b[k] === 'object') ? Object.assign(o[k] || {}, b[k]) : b[k]; return o; }
const tiles = [];
const only = process.argv[2];
for (const pr of [{ id: 'none', name: 'Original', p: { warp: { on: false }, erode: { on: false }, ink: { on: false }, out: { hard: 0 } } }].concat(PRESETS)) {
  if (only && pr.id !== only && pr.id !== 'none') continue;
  const p = merge(E.DEFAULTS, pr.p); p.seed = Number(process.env.SEED || 3);
  const src = E.buildInput(px, meta.w, meta.h, 4, { l: 0, t: 0, r: 0, b: 0 });
  const m = E.measure(src.alpha, src.w, src.h);
  const mg = E.margin(p, m.unit);
  const inp = E.buildInput(px, meta.w, meta.h, 4, { l: mg, t: mg, r: mg, b: mg });
  inp.unit = m.unit; inp.origin = { x: mg + m.box.left, y: mg + m.box.top };
  inp.ink = E.averageInk(inp.alpha, inp.rgb, inp.w * inp.h);
  const t0 = Date.now();
  const rgba = E.render(inp, p, tex(p.texture));
  const ms = Date.now() - t0;
  // componer sobre papel
  const W = inp.w, H = inp.h, img = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) { const a = rgba[i * 4 + 3] / 255; const bg = [236, 233, 224];
    for (let c = 0; c < 3; c++) img[i * 3 + c] = Math.round(bg[c] * (1 - a) + rgba[i * 4 + c] * a); }
  const f = path.join(out, `p_${pr.id}.ppm`);
  fs.writeFileSync(f, Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), img]));
  tiles.push(f);
  console.log(pr.id.padEnd(12), `${W}x${H}`, `U=${m.unit.toFixed(1)}`, `margin=${mg}`, `${ms} ms`);
}
const args = [];
tiles.forEach(t => args.push('-i', t));
const fc = tiles.map((_, i) => `[${i}]scale=720:400:force_original_aspect_ratio=decrease,pad=740:420:(ow-iw)/2:(oh-ih)/2:color=0xECE9E0[t${i}]`).join(';');
const cols = 3, rows = Math.ceil(tiles.length / cols);
const layout = tiles.map((_, i) => `${(i % cols) * 740}_${Math.floor(i / cols) * 420}`).join('|');
execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, '-filter_complex', `${fc};${tiles.map((_, i) => `[t${i}]`).join('')}xstack=inputs=${tiles.length}:layout=${layout}:fill=0xECE9E0`, path.join(out, only ? `preset_${only}.png` : 'presets.png')]);
