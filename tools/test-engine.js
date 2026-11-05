// Banco de pruebas v0.4: renderiza cada técnica y variante.
// Uso: python3 tools/make_sample.py REKT 300 && node tools/test-engine.js [tecnica] [paleta]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const E = require('../plugin/js/engine.js'), P = require('../plugin/js/presets.js');
const out = path.join(__dirname, 'out'), TEX = path.join(__dirname, '../plugin/textures');
const meta = JSON.parse(fs.readFileSync(path.join(out, 'sample.json'))), px = fs.readFileSync(path.join(out, 'sample.rgba'));
const index = JSON.parse(fs.readFileSync(path.join(TEX, 'textures.json'))), cache = {};
function tex(id) { const m = index.find(t => t.id === id); if (!cache[id]) cache[id] = E.prepareTexture(fs.readFileSync(path.join(TEX, id + '.bin')), m.size); return cache[id]; }
const FAMS = ['aguada', 'grano', 'rodillo', 'goteo', 'toner', 'fibra', 'floracion', 'granul', 'lavado', 'gubia'];
function texs(p) { const o = { desgaste: tex(p.texture || 'desgaste_1') }; for (const f of FAMS) o[f] = tex(f + '_1'); return o; }
const only = process.argv[2], palIdx = Number(process.argv[3] || 0), tiles = [];
for (const t of P.TECHS) {
  if (only && only !== t.id && !only.split(',').includes(t.id)) continue;
  for (const v of t.variants) {
    const p = P.build(E.DEFAULTS, t, v); p.seed = Number(process.env.SEED || 3);
    const pal = t.palettes[Math.min(palIdx, t.palettes.length - 1)];
    p.out.color = pal.ink; if (pal.c2) p.tintas.c2 = pal.c2; if (pal.c3) p.tintas.c3 = pal.c3;
    const inp = E.prepare(px, meta.w, meta.h, 4, p);
    const tx = texs(p), t0 = Date.now(), rgba = E.render(inp, p, tx), ms = Date.now() - t0;
    const W = inp.w, H = inp.h, img = Buffer.alloc(W * H * 3), bg = [240, 237, 229];
    for (let i = 0; i < W * H; i++) { const a = rgba[i * 4 + 3] / 255; for (let k = 0; k < 3; k++) img[i * 3 + k] = Math.round(bg[k] * (1 - a + a * rgba[i * 4 + k] / 255)); }
    const f = path.join(out, `v4_${t.id}_${v.id}.ppm`);
    fs.writeFileSync(f, Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), img])); tiles.push(f);
    console.log(t.id.padEnd(11), v.id.padEnd(12), `${W}x${H}`, `${ms} ms`);
  }
}
const cols = 3, TW = 620, TH = 260, args = []; tiles.forEach(t => args.push('-i', t));
const fc = tiles.map((_, i) => `[${i}]scale=${TW - 20}:${TH - 20}:force_original_aspect_ratio=decrease,pad=${TW}:${TH}:(ow-iw)/2:(oh-ih)/2:color=0xF0EDE5[t${i}]`).join(';');
const layout = tiles.map((_, i) => `${(i % cols) * TW}_${Math.floor(i / cols) * TH}`).join('|');
const name = `v4_${only || 'all'}_${palIdx}.png`;
execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, '-filter_complex', tiles.length > 1 ? `${fc};${tiles.map((_, i) => `[t${i}]`).join('')}xstack=inputs=${tiles.length}:layout=${layout}:fill=0xF0EDE5` : fc.replace('[t0]', ''), path.join(out, name)]);
console.log('->', name);
