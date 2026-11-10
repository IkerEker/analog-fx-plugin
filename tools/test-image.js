// Banco de pruebas de IMÁGENES. Uso: python3 tools/make_photo.py && node tools/test-image.js [tecnica] [alpha]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const IM = require('../plugin/js/image.js');
const out = path.join(__dirname, 'out'), meta = JSON.parse(fs.readFileSync(path.join(out, 'photo.json')));
const only = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2].split(',') : null, alpha = process.argv[3] === 'alpha';
const px = fs.readFileSync(path.join(out, alpha ? 'photo_alpha.rgba' : 'photo.rgba')), tiles = [];
for (const t of IM.TECHS) {
  if (only && !only.includes(t.id)) continue;
  for (const v of t.variants) {
    const p = IM.build(t, v, 0); p.seed = 3;
    const t0 = Date.now(), r = IM.render(px, meta.w, meta.h, 4, p), ms = Date.now() - t0;
    const W = meta.w, H = meta.h, img = Buffer.alloc(W * H * 3), bg = [236, 233, 224];
    for (let i = 0; i < W * H; i++) { const a = r.rgba[i * 4 + 3] / 255;
      for (let k = 0; k < 3; k++) { const c = r.rgba[i * 4 + k]; img[i * 3 + k] = Math.round(r.blend === 'multiply' ? bg[k] * (1 - a + a * c / 255) : bg[k] * (1 - a) + c * a); } }
    const f = path.join(out, `im_${t.id}_${v.id}.ppm`);
    fs.writeFileSync(f, Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), img])); tiles.push(f);
    console.log(t.id.padEnd(8), v.id.padEnd(10), ms + ' ms');
  }
}
const cols = 3, TW = 600, TH = 427, args = []; tiles.forEach(t => args.push('-i', t));
const fc = tiles.map((_, i) => `[${i}]scale=${TW}:${TH}[t${i}]`).join(';');
const layout = tiles.map((_, i) => `${(i % cols) * TW}_${Math.floor(i / cols) * TH}`).join('|');
const name = `im_${only ? only.join('-') : 'all'}${alpha ? '_a' : ''}.png`;
execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, '-filter_complex', tiles.length > 1 ? `${fc};${tiles.map((_, i) => `[t${i}]`).join('')}xstack=inputs=${tiles.length}:layout=${layout}:fill=0xECE9E0` : fc.replace('[t0]', ''), path.join(out, name)]);
console.log('->', name);
