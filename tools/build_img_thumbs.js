// Genera plugin/thumbs/img_<técnica>.jpg con la primera variante de cada técnica de imagen.
// Uso: python3 tools/make_photo.py && node tools/build_img_thumbs.js
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const IM = require('../plugin/js/image.js');
const out = path.join(__dirname, 'out'), DST = path.join(__dirname, '../plugin/thumbs');
const meta = JSON.parse(fs.readFileSync(path.join(out, 'photo.json'))), px = fs.readFileSync(path.join(out, 'photo.rgba'));
for (const t of IM.TECHS) {
  const p = IM.build(t, t.variants[0], 0); p.seed = 3;
  const r = IM.render(px, meta.w, meta.h, 4, p), W = meta.w, H = meta.h, img = Buffer.alloc(W * H * 3), bg = [240, 237, 229];
  for (let i = 0; i < W * H; i++) { const a = r.rgba[i * 4 + 3] / 255;
    for (let k = 0; k < 3; k++) { const c = r.rgba[i * 4 + k]; img[i * 3 + k] = Math.round(r.blend === 'multiply' ? bg[k] * (1 - a + a * c / 255) : bg[k] * (1 - a) + c * a); } }
  const ppm = path.join(out, `ithumb_${t.id}.ppm`);
  fs.writeFileSync(ppm, Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), img]));
  // recorte central 300x170 a escala ~1/2 para que se vea la trama
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', ppm, '-vf', 'scale=360:-1,crop=300:170:30:40', '-q:v', '4', path.join(DST, 'img_' + t.id + '.jpg')]);
  console.log('thumb img', t.id);
}
