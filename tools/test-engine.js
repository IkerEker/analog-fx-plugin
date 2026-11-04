// Banco de pruebas: renderiza cada técnica con sus variantes.
// Uso: python3 tools/make_sample.py REKT 300 && node tools/test-engine.js [tecnica] [paleta]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const E = require('../plugin/js/engine.js'), T = require('../plugin/js/techniques.js');
const out = path.join(__dirname, 'out'), TEX = path.join(__dirname, '../plugin/textures');
const meta = JSON.parse(fs.readFileSync(path.join(out, 'sample.json')));
const px = fs.readFileSync(path.join(out, 'sample.rgba'));
const index = JSON.parse(fs.readFileSync(path.join(TEX, 'textures.json')));
const cache = {};
function texs(tech) {
  const o = {};
  for (const fam of tech.textures.concat(['moteado'])) {
    const meta = index.find(t => t.family === fam);
    if (!meta) continue;
    if (!cache[meta.id]) cache[meta.id] = E.prepareTexture(fs.readFileSync(path.join(TEX, meta.id + '.bin')), meta.size);
    o[fam] = cache[meta.id];
  }
  return o;
}
const only = process.argv[2], palIdx = Number(process.argv[3] || 0);
const tiles = [];
for (const tech of T.TECHNIQUES) {
  if (only && only !== tech.id) continue;
  for (const pr of tech.presets) {
    const p = Object.assign({ scale: 1, texScale: 1, opacity: 1, seed: Number(process.env.SEED || 3) }, T.defaults(tech.id), pr.v);
    const inp = E.prepare(px, meta.w, meta.h, 4, tech.id, p);
    const pal = tech.inks.palettes[Math.min(palIdx, tech.inks.palettes.length - 1)].c;
    const inks = pal.map(h => h === 'layer' ? inp.ink : E.hexToRgb(h));
    const tx = texs(tech);
    const t0 = Date.now();
    const rgba = E.render(inp, tech.id, p, tx, inks);
    const ms = Date.now() - t0;
    const W = inp.w, H = inp.h, img = Buffer.alloc(W * H * 3), bg = [240, 237, 229];
    for (let i = 0; i < W * H; i++) { const a = rgba[i * 4 + 3] / 255;
      for (let k = 0; k < 3; k++) img[i * 3 + k] = Math.round(bg[k] * (1 - a + a * rgba[i * 4 + k] / 255)); }
    const f = path.join(out, `t_${tech.id}_${pr.id}.ppm`);
    fs.writeFileSync(f, Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), img]));
    tiles.push(f);
    console.log(tech.id.padEnd(11), pr.id.padEnd(12), `${W}x${H}`, `${ms} ms`);
  }
}
const cols = 3, TW = 620, TH = 300;
const args = []; tiles.forEach(t => args.push('-i', t));
const fc = tiles.map((_, i) => `[${i}]scale=${TW - 20}:${TH - 20}:force_original_aspect_ratio=decrease,pad=${TW}:${TH}:(ow-iw)/2:(oh-ih)/2:color=0xF0EDE5[t${i}]`).join(';');
const layout = tiles.map((_, i) => `${(i % cols) * TW}_${Math.floor(i / cols) * TH}`).join('|');
const name = only ? `tech_${only}_${palIdx}.png` : `techs_${palIdx}.png`;
execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, '-filter_complex', tiles.length > 1 ? `${fc};${tiles.map((_, i) => `[t${i}]`).join('')}xstack=inputs=${tiles.length}:layout=${layout}:fill=0xF0EDE5` : fc.replace('[t0]', ''), path.join(out, name)]);
console.log('->', name);
