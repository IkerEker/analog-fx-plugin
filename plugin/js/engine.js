/*
 * Analog FX — motor de efectos.
 * JavaScript puro, sin dependencias: funciona en Photoshop (UXP) y en Node (para pruebas).
 *
 * Trabaja sobre la máscara (alfa) de la capa. Todas las medidas se expresan en
 * "unidades" (U) relativas al tamaño del trazo/letra, así el resultado es el
 * mismo en la vista previa (reducida) y en el documento a tamaño real.
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ utilidades
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function smooth(e0, e1, x) {
    var t = (x - e0) / (e1 - e0);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
  }

  // Generador pseudoaleatorio con semilla (mulberry32)
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Ruido de valor 2D con semilla (red de 256x256, repetible)
  function makeNoise(seed) {
    var r = rng(seed), N = 256, tab = new Float32Array(N * N);
    for (var i = 0; i < tab.length; i++) tab[i] = r();
    function n2(x, y) {
      var xf = Math.floor(x), yf = Math.floor(y);
      var fx = x - xf, fy = y - yf;
      var x0 = xf & 255, y0 = yf & 255, x1 = (x0 + 1) & 255, y1 = (y0 + 1) & 255;
      var a = tab[(y0 << 8) + x0], b = tab[(y0 << 8) + x1];
      var c = tab[(y1 << 8) + x0], d = tab[(y1 << 8) + x1];
      fx = fx * fx * (3 - 2 * fx);
      fy = fy * fy * (3 - 2 * fy);
      var top = a + (b - a) * fx, bot = c + (d - c) * fx;
      return top + (bot - top) * fy;
    }
    // fbm normalizado a ~0..1
    n2.fbm = function (x, y, oct) {
      var s = 0, amp = 0.5, tot = 0, f = 1;
      for (var o = 0; o < oct; o++) {
        s += n2(x * f + o * 17.3, y * f - o * 9.1) * amp;
        tot += amp; amp *= 0.5; f *= 2.03;
      }
      return s / tot;
    };
    return n2;
  }

  // Desenfoque de caja separable (3 pasadas ≈ gaussiano). Fuera de la imagen = 0.
  function boxH(src, dst, w, h, r) {
    var inv = 1 / (2 * r + 1);
    for (var y = 0; y < h; y++) {
      var off = y * w, acc = 0, i;
      for (i = 0; i <= r && i < w; i++) acc += src[off + i];
      for (var x = 0; x < w; x++) {
        dst[off + x] = acc * inv;
        var add = x + r + 1; if (add < w) acc += src[off + add];
        var rem = x - r; if (rem >= 0) acc -= src[off + rem];
      }
    }
  }
  function boxV(src, dst, w, h, r) {
    var inv = 1 / (2 * r + 1), acc = new Float32Array(w), x, i;
    for (i = 0; i <= r && i < h; i++) { var o = i * w; for (x = 0; x < w; x++) acc[x] += src[o + x]; }
    for (var y = 0; y < h; y++) {
      var od = y * w;
      for (x = 0; x < w; x++) dst[od + x] = acc[x] * inv;
      var add = y + r + 1, rem = y - r;
      if (add < h) { var oa = add * w; for (x = 0; x < w; x++) acc[x] += src[oa + x]; }
      if (rem >= 0) { var orr = rem * w; for (x = 0; x < w; x++) acc[x] -= src[orr + x]; }
    }
  }
  function blur(src, w, h, rx, ry) {
    rx = Math.round(rx); ry = Math.round(ry);
    var a = new Float32Array(src), b = new Float32Array(src.length);
    for (var p = 0; p < 3; p++) {
      if (rx > 0) { boxH(a, b, w, h, rx); var t = a; a = b; b = t; }
      if (ry > 0) { boxV(a, b, w, h, ry); var t2 = a; a = b; b = t2; }
    }
    return a;
  }

  // Desenfoque con repetición (para texturas tileables, tamaño potencia de 2)
  function blurWrap(src, S, r) {
    var a = new Float32Array(src), b = new Float32Array(src.length), m = S - 1, inv = 1 / (2 * r + 1);
    for (var p = 0; p < 3; p++) {
      for (var y = 0; y < S; y++) {
        var off = y * S, acc = 0, i;
        for (i = -r; i <= r; i++) acc += a[off + (i & m)];
        for (var x = 0; x < S; x++) {
          b[off + x] = acc * inv;
          acc += a[off + ((x + r + 1) & m)] - a[off + ((x - r) & m)];
        }
      }
      for (var x2 = 0; x2 < S; x2++) {
        var acc2 = 0, j;
        for (j = -r; j <= r; j++) acc2 += b[(j & m) * S + x2];
        for (var y2 = 0; y2 < S; y2++) {
          a[y2 * S + x2] = acc2 * inv;
          acc2 += b[((y2 + r + 1) & m) * S + x2] - b[((y2 - r) & m) * S + x2];
        }
      }
    }
    return a;
  }

  // Reparte los valores de forma uniforme 0..1 (así "cantidad" = % de cobertura)
  function equalize(f) {
    var BINS = 2048, lo = Infinity, hi = -Infinity, i;
    for (i = 0; i < f.length; i++) { if (f[i] < lo) lo = f[i]; if (f[i] > hi) hi = f[i]; }
    var sc = (BINS - 1) / ((hi - lo) || 1), hist = new Float64Array(BINS);
    for (i = 0; i < f.length; i++) hist[(f[i] - lo) * sc | 0]++;
    var cdf = new Float32Array(BINS), acc = 0;
    for (i = 0; i < BINS; i++) { acc += hist[i]; cdf[i] = acc / f.length; }
    var out = new Float32Array(f.length);
    for (i = 0; i < f.length; i++) out[i] = cdf[(f[i] - lo) * sc | 0];
    return out;
  }

  // Campo de baja frecuencia calculado en una rejilla y leído con interpolación
  // (mucho más rápido que evaluar ruido en cada píxel).
  function makeGrid(w, h, step, fn) {
    var gw = Math.ceil(w / step) + 2, gh = Math.ceil(h / step) + 2, g = new Float32Array(gw * gh);
    for (var j = 0; j < gh; j++) for (var i = 0; i < gw; i++) g[j * gw + i] = fn(i * step, j * step);
    var inv = 1 / step;
    return function (x, y) {
      var gx = x * inv, gy = y * inv, xi = gx | 0, yi = gy | 0, fx = gx - xi, fy = gy - yi, k = yi * gw + xi;
      var top = g[k] + (g[k + 1] - g[k]) * fx, bot = g[k + gw] + (g[k + gw + 1] - g[k + gw]) * fx;
      return top + (bot - top) * fy;
    };
  }

  // ------------------------------------------------------------------ texturas
  /**
   * Prepara una textura a partir de bytes en gris (S×S, S potencia de 2).
   * Devuelve { size, base, detail }: base = textura ecualizada, detail = altas
   * frecuencias ecualizadas (pinceladas finas, fibras).
   */
  function prepareTexture(bytes, size) {
    var n = size * size, base = new Float32Array(n);
    for (var i = 0; i < n; i++) base[i] = bytes[i] / 255;
    var low = blurWrap(base, size, Math.max(2, size >> 8));
    var hp = new Float32Array(n);
    for (var k = 0; k < n; k++) hp[k] = base[k] - low[k];
    return { size: size, base: base, detail: equalize(hp) };
  }

  // Muestreador de textura con escala, estiramiento, rotación y desplazamiento
  function makeSampler(data, S, unit, tileUnits, angle, stretch, ox, oy, offX, offY) {
    var k = S / (unit * tileUnits);
    var sx = Math.pow(2, -stretch * 1.6), sy = 1 / sx;
    var c = Math.cos(angle), s = Math.sin(angle);
    // tx = (c*u - s*v)*k*sx + offX ; ty = (s*u + c*v)*k*sy + offY, con u = x-ox, v = y-oy
    var a = c * k * sx, b = -s * k * sx, d = s * k * sy, e = c * k * sy;
    var m = S - 1;
    return function (x, y) {
      var u = x - ox, v = y - oy;
      var tx = a * u + b * v + offX, ty = d * u + e * v + offY;
      var xf = Math.floor(tx), yf = Math.floor(ty);
      var fx = tx - xf, fy = ty - yf;
      var x0 = xf & m, y0 = yf & m, x1 = (x0 + 1) & m, y1 = (y0 + 1) & m;
      var p = data[y0 * S + x0], q = data[y0 * S + x1], r = data[y1 * S + x0], t = data[y1 * S + x1];
      var top = p + (q - p) * fx, bot = r + (t - r) * fx;
      return top + (bot - top) * fy;
    };
  }

  // ------------------------------------------------------------------ medidas
  /**
   * Mide la forma: caja que la contiene y "unidad" U (tamaño característico de
   * trazo/letra). U = min(alto, ancho, 6 × grosor medio del trazo).
   */
  function measure(alpha, w, h) {
    var area = 0, per = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x, a = alpha[i];
        area += a;
        if (x + 1 < w) per += Math.abs(a - alpha[i + 1]);
        if (y + 1 < h) per += Math.abs(a - alpha[i + w]);
        if (a > 0.5) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
    }
    if (x1 < 0) return null;
    var bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    var thick = per > 0 ? 2 * area / per : Math.min(bw, bh);
    var U = Math.max(2, Math.min(bw, bh, 6 * thick));
    return { unit: U, box: { left: x0, top: y0, right: x1 + 1, bottom: y1 + 1 }, thickness: thick };
  }

  // Margen (en px) que necesita el efecto alrededor de la forma
  function margin(p, unit) {
    var U = unit * p.effectScale, m = 0, ext = 0;
    if (p.warp.on) m += U * (0.15 * p.warp.amount + 0.035 * p.warp.rough) + 1;
    if (p.bleed.on) m += U * 0.5 * p.bleed.amount;
    if (p.drips.on && p.drips.amount > 0) ext = Math.max(ext, U * 3.6 * (0.04 + 0.75 * p.drips.length));
    if (p.splat.on && p.splat.amount > 0) ext = Math.max(ext, U * 2.2 * (0.08 + 0.45 * p.splat.spread));
    return Math.ceil(Math.min(m + ext, U * 3) + 3);
  }

  // ------------------------------------------------------------------ render
  /**
   * input: { w, h, alpha: Float32Array(0..1), rgb: Uint8Array|null (w*h*3),
   *          unit, origin: {x, y} (esquina de la forma en px de la región) }
   * p: parámetros (ver DEFAULTS), tex: textura preparada.
   * Devuelve Uint8Array RGBA (w*h*4).
   */
  function render(input, p, tex) {
    var w = input.w, h = input.h, n = w * h, A0 = input.alpha;
    var U = input.unit * p.effectScale;
    var ox = input.origin.x, oy = input.origin.y;
    var R = rng(p.seed * 7919 + 13);
    var noise = makeNoise(p.seed * 31 + 7);
    var S = tex.size, stretch = p.stretch, rotK = Math.pow(1 - Math.abs(stretch), 2);
    var tile = 3 * p.texScale; // en unidades U
    function sampler(which, tileMul, extraStretch) {
      var ang = (R() - 0.5) * 2 * Math.PI * rotK + (R() - 0.5) * 0.15;
      return makeSampler(which === 'd' ? tex.detail : tex.base, S, U, tile * tileMul, ang,
        Math.max(-1.5, Math.min(1.5, stretch + (extraStretch || 0))), ox, oy, R() * S, R() * S);
    }
    var invU = 1 / U, x, y, i;
    var gStep = Math.max(1, Math.min(8, Math.floor(U / 40)));
    function grid(fn) { return makeGrid(w, h, gStep, function (gx, gy) { return fn((gx - ox) * invU, (gy - oy) * invU); }); }

    // 1 · Deformación + rugosidad de borde ---------------------------------
    var A = new Float32Array(n), cidx = input.rgb ? new Int32Array(n) : null;
    var wA = p.warp.on ? p.warp.amount : 0, wR = p.warp.on ? p.warp.rough : 0;
    if (wA > 0 || wR > 0) {
      var twx = sampler('b', 0.7), twy = sampler('b', 0.7);
      var trx = sampler('d', 0.18), trY = sampler('d', 0.18);
      var mN = U * 0.10 * wA, mT = U * 0.045 * wA, mR = U * 0.03 * wR + 0.6 * wR;
      var gwx = grid(function (u, v) { return noise.fbm(u * 0.9, v * 0.9, 2); });
      var gwy = grid(function (u, v) { return noise.fbm(u * 0.9 + 40, v * 0.9 + 40, 2); });
      var reachR = Math.ceil((mN + mT + mR) * 0.75) + 2;
      var reach = blur(A0, w, h, reachR, reachR);
      for (y = 0; y < h; y++) {
        for (x = 0; x < w; x++) {
          if (reach[y * w + x] < 1e-5) { if (cidx) cidx[y * w + x] = -1; continue; }
          var dx = (gwx(x, y) - 0.5) * 2 * mN + (twx(x, y) - 0.5) * 2 * mT + (trx(x, y) - 0.5) * 2 * mR;
          var dy = (gwy(x, y) - 0.5) * 2 * mN + (twy(x, y) - 0.5) * 2 * mT + (trY(x, y) - 0.5) * 2 * mR;
          var sxp = x + dx, syp = y + dy;
          var xf = Math.floor(sxp), yf = Math.floor(syp), fx = sxp - xf, fy = syp - yf, val = 0;
          if (xf >= 0 && yf >= 0 && xf + 1 < w && yf + 1 < h) {
            var j = yf * w + xf;
            var t0 = A0[j] + (A0[j + 1] - A0[j]) * fx, t1 = A0[j + w] + (A0[j + w + 1] - A0[j + w]) * fx;
            val = t0 + (t1 - t0) * fy;
            if (cidx) cidx[y * w + x] = (fx < 0.5 ? j : j + 1) + (fy < 0.5 ? 0 : w);
          } else if (cidx) cidx[y * w + x] = -1;
          A[y * w + x] = val;
        }
      }
    } else {
      A.set(A0);
      if (cidx) for (i = 0; i < n; i++) cidx[i] = i;
    }
    var shape = A; // forma deformada (base para salpicaduras)

    // 2 · Emborronado / tinta corrida --------------------------------------
    if (p.bleed.on && p.bleed.amount > 0) {
      var bA = p.bleed.amount, dir = p.bleed.dir, r = U * 0.16 * bA;
      var B = blur(A, w, h, r * Math.min(1, 1 - dir), r * Math.min(1, 1 + dir));
      var tb = sampler('b', 0.8);
      var out = new Float32Array(n);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        if (B[i] < 1e-4 && A[i] <= 0) continue;
        var kk = clamp01(bA * 1.3 * (0.15 + 0.85 * smooth(0.25, 0.85, tb(x, y))));
        var mixv = A[i] + (B[i] - A[i]) * kk;
        out[i] = Math.max(mixv, A[i] * (1 - 0.6 * kk), B[i] * kk * 0.9);
      }
      A = out;
    }

    // 3 · Goteo / arrastre vertical ----------------------------------------
    if (p.drips.on && p.drips.length > 0 && p.drips.amount > 0) {
      var dl = p.drips.length, da = p.drips.amount, up = p.drips.up;
      var colDecDown = new Float32Array(w), colDecUp = new Float32Array(w);
      for (x = 0; x < w; x++) {
        var uu = (x - ox) * invU;
        var c1 = noise(uu * 14 + 300, 11.5), c2 = noise(uu * 45 + 500, 3.3);
        var on = smooth(1 - da * 0.75, 1 - da * 0.75 + 0.12, c1 * 0.6 + c2 * 0.4);
        var L = U * (0.04 + 0.75 * dl) * on * (0.25 + 0.75 * Math.pow(noise(uu * 6 + 900, 1.7), 2));
        colDecDown[x] = L > 0.5 ? Math.exp(-1 / L) : 0;
        var Lu = L * up * (0.5 + noise(uu * 7 + 120, 8.1));
        colDecUp[x] = Lu > 0.5 ? Math.exp(-1 / Lu) : 0;
      }
      var Dd = new Float32Array(A);
      for (x = 0; x < w; x++) {
        var dd = colDecDown[x], du = colDecUp[x], prev = 0;
        if (dd > 0) for (y = 0; y < h; y++) { i = y * w + x; prev = Math.max(A[i], prev * dd); if (prev > Dd[i]) Dd[i] = prev; }
        prev = 0;
        if (du > 0) for (y = h - 1; y >= 0; y--) { i = y * w + x; prev = Math.max(A[i], prev * du); if (prev > Dd[i]) Dd[i] = prev; }
      }
      var ts = sampler('d', 0.6, -1.2); // vetas verticales
      for (i = 0; i < n; i++) {
        var add = Dd[i] - A[i];
        if (add > 0.001) {
          y = (i / w) | 0; x = i - y * w;
          A[i] = A[i] + add * (0.45 + 0.55 * smooth(0.2, 0.8, ts(x, y)));
        }
      }
    }

    // 4 · Salpicaduras -----------------------------------------------------
    if (p.splat.on && p.splat.amount > 0) {
      var sa = p.splat.amount, sp = p.splat.spread, sz = p.splat.size;
      var N = blur(shape, w, h, U * (0.08 + 0.45 * sp), U * (0.08 + 0.45 * sp));
      var tsp = sampler('b', 0.12 + 0.5 * sz), tsp2 = sampler('d', 0.08 + 0.2 * sz);
      var gcl = grid(function (u, v) { return noise.fbm(u * 0.7 + 70, v * 0.7, 2); });
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        var near = N[i];
        if (near < 0.004 || A[i] > 0.99) continue;
        var cl = gcl(x, y);
        var pr = clamp01(Math.pow(Math.min(1, near * 2.2), 0.8) * sa * (0.05 + 1.9 * smooth(0.45, 0.75, cl)));
        if (pr < 0.004) continue;
        var th = 1 - pr * 0.4;
        var spot = smooth(th, th + 0.03, tsp(x, y)) * (0.75 + 0.25 * tsp2(x, y));
        var fine = smooth(1 - pr * 0.03, 1 - pr * 0.03 + 0.006, tsp2(x, y)) * 0.8;
        var sv = Math.max(spot, fine);
        if (sv > A[i]) A[i] = sv;
      }
    }

    // 5 · Desgaste / erosión ------------------------------------------------
    if (p.erode.on && p.erode.amount > 0) {
      var ea = p.erode.amount, dist = p.erode.distrib, soft = 0.015 + 0.22 * (1 - p.erode.contrast);
      var te = sampler('b', 1);
      var gef = grid(function (u, v) { return noise.fbm(u * 2.2 + 10, v * 2.2 - 5, 3); });
      var gec = grid(function (u, v) { return noise.fbm(u * 0.45 - 30, v * 0.45 + 60, 2); });
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        if (A[i] <= 0) continue;
        var field = te(x, y) * 0.72 + gef(x, y) * 0.28;
        var t = ea * (1 - dist + dist * 2.1 * smooth(0.3, 0.8, gec(x, y)));
        t = Math.min(t, 1.05);
        A[i] *= smooth(t - soft, t + soft, field);
      }
    }

    // 6 · Rayas y grietas ---------------------------------------------------
    if (p.cracks.on && p.cracks.amount > 0) {
      var ca = p.cracks.amount, tc = sampler('d', 0.45, 0.4), tc2 = sampler('d', 0.25, -0.3);
      var gcm = grid(function (u, v) { return noise.fbm(u * 1.3 + 200, v * 1.3, 2); });
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        if (A[i] <= 0) continue;
        var lm = smooth(0.62 - ca * 0.45, 0.82 - ca * 0.4, gcm(x, y));
        var thr = 1 - ca * 0.075;
        var sc = Math.max(smooth(thr, thr + 0.012, tc(x, y)), smooth(thr + 0.01, thr + 0.02, tc2(x, y)) * 0.8);
        A[i] *= 1 - sc * lm;
      }
    }

    // 7 · Presión de tinta y grano -----------------------------------------
    if (p.ink.on && (p.ink.pressure > 0 || p.ink.grain > 0)) {
      var pr2 = p.ink.pressure, gr = p.ink.grain;
      var tp = sampler('b', 0.9), tg = sampler('d', 0.06), gF = Math.min(1 / 1.1, 1 / (U * 0.01));
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        if (A[i] <= 0) continue;
        var inv1 = 1 - tp(x, y), dens = 1 - pr2 * inv1 * Math.sqrt(Math.sqrt(inv1)) * 1.05;
        var g = (tg(x, y) - 0.5) * 0.65 + (noise(x * gF, y * gF) - 0.5) * 0.6;
        dens += g * gr * 1.1;
        A[i] *= clamp01(dens);
      }
    }

    // 8 · Salida: dureza + opacidad + color --------------------------------
    var hard = p.out.hard, wid = 0.5 * (1 - hard) + 0.07, op = p.out.opacity;
    var rgba = new Uint8Array(n * 4);
    var ink = input.ink || [0, 0, 0], custom = p.out.color && p.out.color !== 'original' ? hexToRgb(p.out.color) : null;
    var rgb = input.rgb;
    for (i = 0; i < n; i++) {
      var a2 = A[i];
      if (hard > 0) a2 = smooth(0.5 - wid, 0.5 + wid, a2);
      a2 = clamp01(a2) * op;
      var o = i * 4;
      if (custom) { rgba[o] = custom[0]; rgba[o + 1] = custom[1]; rgba[o + 2] = custom[2]; }
      else if (rgb) {
        var ci = cidx[i];
        if (ci >= 0 && A0[ci] > 0.35) { rgba[o] = rgb[ci * 3]; rgba[o + 1] = rgb[ci * 3 + 1]; rgba[o + 2] = rgb[ci * 3 + 2]; }
        else { rgba[o] = ink[0]; rgba[o + 1] = ink[1]; rgba[o + 2] = ink[2]; }
      } else { rgba[o] = ink[0]; rgba[o + 1] = ink[1]; rgba[o + 2] = ink[2]; }
      rgba[o + 3] = Math.round(a2 * 255);
    }
    return rgba;
  }

  function hexToRgb(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var v = parseInt(h, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  // Color medio de la tinta (ponderado por alfa)
  function averageInk(alpha, rgb, n) {
    var r = 0, g = 0, b = 0, t = 0;
    for (var i = 0; i < n; i++) {
      var a = alpha[i]; if (a < 0.5) continue;
      r += rgb[i * 3] * a; g += rgb[i * 3 + 1] * a; b += rgb[i * 3 + 2] * a; t += a;
    }
    return t ? [Math.round(r / t), Math.round(g / t), Math.round(b / t)] : [0, 0, 0];
  }

  /**
   * Construye la región de trabajo con margen alrededor de los píxeles de la capa.
   * px: Uint8Array intercalado (components = 3 o 4), w, h: tamaño de los píxeles leídos.
   * pad: {l, t, r, b} margen en px. Devuelve el objeto "input" para render().
   */
  function buildInput(px, w, h, components, pad) {
    var W = w + pad.l + pad.r, H = h + pad.t + pad.b, n = W * H;
    var alpha = new Float32Array(n), rgb = new Uint8Array(n * 3);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var s = (y * w + x) * components, d = (y + pad.t) * W + (x + pad.l);
        alpha[d] = components === 4 ? px[s + 3] / 255 : 1;
        rgb[d * 3] = px[s]; rgb[d * 3 + 1] = px[s + 1]; rgb[d * 3 + 2] = px[s + 2];
      }
    }
    return { w: W, h: H, alpha: alpha, rgb: rgb };
  }

  var DEFAULTS = {
    texture: 'grises_8', texScale: 1, stretch: 0, effectScale: 1, seed: 1,
    warp: { on: true, amount: 0.25, rough: 0.4 },
    erode: { on: true, amount: 0.25, distrib: 0.5, contrast: 0.6 },
    cracks: { on: false, amount: 0.3 },
    bleed: { on: false, amount: 0.3, dir: 0 },
    drips: { on: false, length: 0.35, amount: 0.5, up: 0 },
    splat: { on: false, amount: 0.3, spread: 0.4, size: 0.5 },
    ink: { on: true, pressure: 0.3, grain: 0.3 },
    out: { hard: 0.2, opacity: 1, color: 'original' }
  };

  var api = {
    DEFAULTS: DEFAULTS, prepareTexture: prepareTexture, measure: measure, margin: margin,
    render: render, buildInput: buildInput, averageInk: averageInk, hexToRgb: hexToRgb
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AFXEngine = api;
})(this);
