// Genera plugin/thumbs/img_<técnica>.jpg con la primera variante de cada técnica de imagen al 100 %.
// Foto: tools/photos/astronaut.png (retrato oficial de la NASA, dominio público; vía scikit-image).
// Uso: node tools/build_img_thumbs.js
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const IM = require('../plugin/js/image.js');
const out = path.join(__dirname, 'out'), DST = path.join(__dirname, '../plugin/thumbs'), SRC = path.join(__dirname, 'photos/astronaut.png');
fs.mkdirSync(out, { recursive: true });
const W = 512, H = 512, px = execFileSync('ffmpeg', ['-v', 'error', '-i', SRC, '-vf', `scale=${W}:${H}`, '-pix_fmt', 'rgba', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 26 });
for (const t of IM.TECHS) {
  const p = IM.build(t, t.variants[0], 0); p.seed = 3; IM.applyIntensity(p, 1);
  const r = IM.render(px, W, H, 4, p), img = Buffer.alloc(W * H * 3), bg = [240, 237, 229];
  for (let i = 0; i < W * H; i++) { const a = r.rgba[i * 4 + 3] / 255;
    for (let k = 0; k < 3; k++) { const c = r.rgba[i * 4 + k]; img[i * 3 + k] = Math.round(r.blend === 'multiply' ? bg[k] * (1 - a + a * c / 255) : bg[k] * (1 - a) + c * a); } }
  const ppm = path.join(out, `ithumb_${t.id}.ppm`);
  fs.writeFileSync(ppm, Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), img]));
  // recorte de la cara y el casco, a escala 1:1 para que se vea la trama
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', ppm, '-vf', 'crop=300:170:60:40', '-q:v', '4', path.join(DST, 'img_' + t.id + '.jpg')]);
  console.log('thumb img', t.id);
}
