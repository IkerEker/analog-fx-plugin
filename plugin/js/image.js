/*
 * Analog FX — IMÁGENES (fotografías, con o sin alfa).
 * Motor independiente del de letras: aquí la imagen tiene que seguir siendo reconocible, así que no
 * hay deformación interna. Cada técnica es un modelo de impresión de imagen (umbral de fotocopia,
 * trama de periódico, tritono, cuatricromía, risografía, serigrafía, tramado 1 bit, impresora rota)
 * más unos pocos defectos físicos comunes (desregistro, tinta irregular, grano del papel, motas…).
 * Todas las medidas son relativas al lado corto de la imagen: la vista previa reducida y el
 * resultado a tamaño real se ven igual.
 */
(function (root) {
  'use strict';

  // ================================================================== utilidades
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function smooth(e0, e1, x) { var t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
  function hash(n) {
    n = (n | 0) ^ 0x5bd1e995; n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d); n = Math.imul(n ^ (n >>> 12), 0x297a2d39); n ^= n >>> 15;
    return (n >>> 0) / 4294967296;
  }
  function hash2(x, y, s) { return hash(Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(s | 0, 83492791)); }
  // ruido de valor con escala en px
  function vnoise(x, y, sc, s) {
    var gx = x / sc, gy = y / sc, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    var a = hash2(ix, iy, s), b = hash2(ix + 1, iy, s), c = hash2(ix, iy + 1, s), d = hash2(ix + 1, iy + 1, s);
    var t = a + (b - a) * fx, u = c + (d - c) * fx; return t + (u - t) * fy;
  }
  function fbm(x, y, sc, s) { return vnoise(x, y, sc, s) * 0.55 + vnoise(x, y, sc * 0.47, s + 7) * 0.3 + vnoise(x, y, sc * 0.22, s + 13) * 0.15; }
  function hexToRgb01(hex) {
    var h = String(hex).replace('#', ''); if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var v = parseInt(h, 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }

  // desenfoque de caja separable (3 pasadas ≈ gaussiano); bordes replicados
  function blur(src, w, h, r) {
    r = Math.round(r); var a = new Float32Array(src); if (r < 1) return a;
    var b = new Float32Array(src.length), inv = 1 / (2 * r + 1), x, y, k;
    for (var p = 0; p < 3; p++) {
      for (y = 0; y < h; y++) {
        var o = y * w, acc = 0;
        for (k = -r; k <= r; k++) acc += a[o + Math.min(w - 1, Math.max(0, k))];
        for (x = 0; x < w; x++) { b[o + x] = acc * inv; acc += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)]; }
      }
      for (x = 0; x < w; x++) {
        var acc2 = 0;
        for (k = -r; k <= r; k++) acc2 += b[Math.min(h - 1, Math.max(0, k)) * w + x];
        for (y = 0; y < h; y++) { a[y * w + x] = acc2 * inv; acc2 += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x]; }
      }
    }
    return a;
  }
  function shift(F, w, h, dx, dy) {
    if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) return F;
    var o = new Float32Array(F.length);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var sx = x - dx, sy = y - dy, xf = Math.floor(sx), yf = Math.floor(sy);
      if (xf < 0 || yf < 0 || xf + 1 >= w || yf + 1 >= h) continue;
      var fx = sx - xf, fy = sy - yf, k = yf * w + xf;
      var t = F[k] + (F[k + 1] - F[k]) * fx, b = F[k + w] + (F[k + w + 1] - F[k + w]) * fx;
      o[y * w + x] = t + (b - t) * fy;
    }
    return o;
  }

  // ================================================================== tramas
  // AM (puntos de tamaño variable en rejilla girada). T = cantidad de tinta 0..1
  function amScreen(T, w, h, cell, angDeg, shape, gain, ragS, seed) {
    var out = new Float32Array(T.length), a = angDeg * Math.PI / 180, cs = Math.cos(a) / cell, sn = Math.sin(a) / cell;
    var e = Math.min(0.45, 0.9 / cell), TWO = Math.PI * 2;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var i = y * w + x, t = T[i];
      if (t <= 0.003) continue;
      t = t + gain * t * (1 - t) * 1.4;                                   // ganancia de punto
      if (t >= 0.995) { out[i] = 1; continue; }
      var u = x * cs + y * sn, v = -x * sn + y * cs, spot;
      if (shape === 'line') { var fu = u - Math.floor(u); spot = Math.abs(fu - 0.5) * 2; }
      else if (shape === 'ellipse') spot = 0.5 - 0.25 * (1.2 * Math.cos(TWO * u) + 0.8 * Math.cos(TWO * v));
      else spot = 0.5 - 0.25 * (Math.cos(TWO * u) + Math.cos(TWO * v));
      if (ragS > 0) spot += (vnoise(x, y, 1.6, seed) - 0.5) * ragS;     // borde del punto irregular (papel)
      out[i] = smooth(spot - e, spot + e, t);
    }
    return out;
  }
  // reduce T a una rejilla de celdas de 'ps' px (media por área)
  function toGrid(T, w, h, ps) {
    var gw = Math.max(1, Math.ceil(w / ps)), gh = Math.max(1, Math.ceil(h / ps)), G = new Float32Array(gw * gh), C = new Float32Array(gw * gh);
    for (var y = 0; y < h; y++) { var gy = Math.min(gh - 1, Math.floor(y / ps)); for (var x = 0; x < w; x++) { var k = gy * gw + Math.min(gw - 1, Math.floor(x / ps)); G[k] += T[y * w + x]; C[k]++; } }
    for (var k2 = 0; k2 < G.length; k2++) G[k2] = C[k2] ? G[k2] / C[k2] : 0;
    return { G: G, gw: gw, gh: gh };
  }
  function fromGrid(B, gw, gh, w, h, ps) {
    var out = new Float32Array(w * h);
    for (var y = 0; y < h; y++) { var gy = Math.min(gh - 1, Math.floor(y / ps)); for (var x = 0; x < w; x++) out[y * w + x] = B[gy * gw + Math.min(gw - 1, Math.floor(x / ps))]; }
    return out;
  }
  // difusión de error (Floyd–Steinberg o Atkinson) en celdas de ps px
  function diffuse(T, w, h, ps, kind) {
    var g = toGrid(T, w, h, ps), G = g.G, gw = g.gw, gh = g.gh, B = new Float32Array(G.length);
    for (var y = 0; y < gh; y++) {
      var rev = kind !== 'atkinson' && (y & 1);                         // serpenteo (menos gusanos)
      for (var xx = 0; xx < gw; xx++) {
        var x = rev ? gw - 1 - xx : xx, i = y * gw + x, old = G[i], nw = old > 0.5 ? 1 : 0, err = old - nw, d = rev ? -1 : 1;
        B[i] = nw;
        if (kind === 'atkinson') {
          err /= 8;
          if (x + 1 < gw) G[i + 1] += err; if (x + 2 < gw) G[i + 2] += err;
          if (y + 1 < gh) { if (x > 0) G[i + gw - 1] += err; G[i + gw] += err; if (x + 1 < gw) G[i + gw + 1] += err; }
          if (y + 2 < gh) G[i + 2 * gw] += err;
        } else {
          if (x + d >= 0 && x + d < gw) G[i + d] += err * 7 / 16;
          if (y + 1 < gh) { if (x - d >= 0 && x - d < gw) G[i + gw - d] += err * 3 / 16; G[i + gw] += err * 5 / 16; if (x + d >= 0 && x + d < gw) G[i + gw + d] += err / 16; }
        }
      }
    }
    return fromGrid(B, gw, gh, w, h, ps);
  }
  var BAYER8 = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21];
  function bayer(T, w, h, ps) {
    var g = toGrid(T, w, h, ps), B = new Float32Array(g.G.length);
    for (var y = 0; y < g.gh; y++) for (var x = 0; x < g.gw; x++) { var i = y * g.gw + x; B[i] = g.G[i] > (BAYER8[(y & 7) * 8 + (x & 7)] + 0.5) / 64 ? 1 : 0; }
    return fromGrid(B, g.gw, g.gh, w, h, ps);
  }
  // mezzotinta: grano aleatorio agrupado (como la plancha graneada)
  function mezzo(T, w, h, ps, seed) {
    var N = new Float32Array(w * h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) N[y * w + x] = vnoise(x, y, ps * 0.6, seed) * 0.6 + vnoise(x, y, ps * 0.25, seed + 3) * 0.4;
    // ecualizar el ruido (que el umbral reparta bien los tonos)
    var hist = new Float64Array(1024), i; for (i = 0; i < N.length; i++) hist[Math.min(1023, N[i] * 1024 | 0)]++;
    var cdf = new Float32Array(1024), acc = 0; for (i = 0; i < 1024; i++) { acc += hist[i]; cdf[i] = acc / N.length; }
    var out = new Float32Array(w * h), e = 0.04;
    for (i = 0; i < N.length; i++) { var nq = cdf[Math.min(1023, N[i] * 1024 | 0)]; out[i] = smooth(nq - e, nq + e, T[i]); }
    return out;
  }

  // ================================================================== separación en tintas planas
  // Busca, para cada color, qué cobertura de cada tinta (mezcla sustractiva sobre papel) se le
  // parece más, dando mucho peso a la luminosidad para que la imagen se siga leyendo.
  var lutCache = {};
  function mixColor(inks, cov, out) {
    var r = 1, g = 1, b = 1;
    for (var k = 0; k < inks.length; k++) { var a = cov[k], c = inks[k]; r *= 1 - a * (1 - c[0]); g *= 1 - a * (1 - c[1]); b *= 1 - a * (1 - c[2]); }
    out[0] = r; out[1] = g; out[2] = b;
  }
  function err(t, m) {
    var lt = 0.299 * t[0] + 0.587 * t[1] + 0.114 * t[2], lm = 0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2];
    var dr = t[0] - m[0], dg = t[1] - m[1], db = t[2] - m[2];
    return 4 * (lt - lm) * (lt - lm) + dr * dr + dg * dg + db * db;
  }
  function sepLUT(inks, steps) {
    var key = inks.map(function (c) { return c.join(','); }).join('|') + '/' + steps;
    if (lutCache[key]) return lutCache[key];
    var N = 17, K = inks.length, combos = [], idx = new Array(K).fill(0), m = [0, 0, 0];
    // todas las combinaciones de cobertura
    (function rec(k) { if (k === K) { combos.push(idx.map(function (v) { return v / (steps - 1); })); return; } for (var s = 0; s < steps; s++) { idx[k] = s; rec(k + 1); } })(0);
    var mixes = combos.map(function (cv) { var o = [0, 0, 0]; mixColor(inks, cv, o); return o; });
    var L = new Float32Array(N * N * N * K), t = [0, 0, 0];
    for (var r = 0; r < N; r++) for (var g = 0; g < N; g++) for (var b = 0; b < N; b++) {
      t[0] = r / (N - 1); t[1] = g / (N - 1); t[2] = b / (N - 1);
      var best = 1e9, bi = 0;
      for (var c = 0; c < combos.length; c++) { var e2 = err(t, mixes[c]); if (e2 < best) { best = e2; bi = c; } }
      var o = ((r * N + g) * N + b) * K;
      for (var k2 = 0; k2 < K; k2++) L[o + k2] = combos[bi][k2];
    }
    lutCache[key] = { L: L, N: N, K: K };
    return lutCache[key];
  }
  function lookup(lut, r, g, b, out) {   // trilineal
    var N = lut.N, K = lut.K, L = lut.L, s = N - 1;
    var fr = r * s, fg = g * s, fb = b * s, ir = Math.min(s - 1, fr | 0), ig = Math.min(s - 1, fg | 0), ib = Math.min(s - 1, fb | 0);
    var tr = fr - ir, tg = fg - ig, tb = fb - ib;
    for (var k = 0; k < K; k++) {
      var c000 = L[((ir * N + ig) * N + ib) * K + k], c001 = L[((ir * N + ig) * N + ib + 1) * K + k];
      var c010 = L[((ir * N + ig + 1) * N + ib) * K + k], c011 = L[((ir * N + ig + 1) * N + ib + 1) * K + k];
      var c100 = L[(((ir + 1) * N + ig) * N + ib) * K + k], c101 = L[(((ir + 1) * N + ig) * N + ib + 1) * K + k];
      var c110 = L[(((ir + 1) * N + ig + 1) * N + ib) * K + k], c111 = L[(((ir + 1) * N + ig + 1) * N + ib + 1) * K + k];
      var c00 = c000 + (c001 - c000) * tb, c01 = c010 + (c011 - c010) * tb, c10 = c100 + (c101 - c100) * tb, c11 = c110 + (c111 - c110) * tb;
      var c0 = c00 + (c01 - c00) * tg, c1 = c10 + (c11 - c10) * tg;
      out[k] = c0 + (c1 - c0) * tr;
    }
  }

  // ================================================================== preparación de la imagen
  function prepare(px, w, h, comps, p) {
    var n = w * h, R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), A = new Float32Array(n), Y = new Float32Array(n);
    var cf = Math.pow(2, (p.contrast || 0) * 1.6), br = (p.bright || 0) * 0.35;
    for (var i = 0; i < n; i++) {
      var o = i * comps, a = comps === 4 ? px[o + 3] / 255 : 1;
      A[i] = a;
      R[i] = clamp01((px[o] / 255 - 0.5) * cf + 0.5 + br);
      G[i] = clamp01((px[o + 1] / 255 - 0.5) * cf + 0.5 + br);
      B[i] = clamp01((px[o + 2] / 255 - 0.5) * cf + 0.5 + br);
      Y[i] = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i];
    }
    var S = Math.min(w, h);
    if ((p.detail || 0) > 0) {   // máscara de enfoque: la impresión pide bordes claros
      var Yb = blur(Y, w, h, Math.max(1, S * 0.004)), am = p.detail * 1.6;
      for (i = 0; i < n; i++) { var d = (Y[i] - Yb[i]) * am; Y[i] = clamp01(Y[i] + d); R[i] = clamp01(R[i] + d); G[i] = clamp01(G[i] + d); B[i] = clamp01(B[i] + d); }
    }
    return { w: w, h: h, n: n, S: S, R: R, G: G, B: B, A: A, Y: Y };
  }
  function darkness(im) { var T = new Float32Array(im.n); for (var i = 0; i < im.n; i++) T[i] = 1 - im.Y[i]; return T; }

  // ================================================================== defectos comunes
  function defects(L, im, p, k, seed) {
    var w = im.w, h = im.h, S = im.S, n = im.n, i, x, y;
    var mot = p.mottle || 0, gr = p.grain || 0;
    if (mot > 0 || gr > 0) {
      var sc1 = S * 0.07, sc2 = Math.max(1.2, S * 0.0018);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x; var c = L[i]; if (c <= 0) continue;
        var m = 1 - mot * 0.4 * smooth(0.3, 0.8, fbm(x, y, sc1, seed + k * 31));                 // tinta irregular
        var sa = 1 - gr * 0.75 * smooth(0.68, 0.95, vnoise(x, y, sc2, seed + 99 + k)) * smooth(0.5, 1, c);   // poros del papel
        L[i] = c * m * sa;
      }
    }
    return L;
  }
  function addSpecks(L, near, im, amount, seed, onlyNear) {
    if (amount <= 0) return;
    var w = im.w, h = im.h, cs = Math.max(2, im.S * 0.006), gw = Math.ceil(w / cs), gh = Math.ceil(h / cs);
    for (var gy = 0; gy < gh; gy++) for (var gx = 0; gx < gw; gx++) {
      var hv = hash2(gx, gy, seed + 501);
      if (hv > amount * 0.035) continue;
      var cx = (gx + hash2(gx, gy, seed + 7)) * cs, cy = (gy + hash2(gx, gy, seed + 9)) * cs, ci = Math.min(h - 1, cy | 0) * w + Math.min(w - 1, cx | 0);
      if (onlyNear && near[ci] < 0.04) continue;
      var r = cs * (0.12 + 0.4 * Math.pow(hash2(gx, gy, seed + 3), 2));
      for (var y = Math.max(0, Math.floor(cy - r - 1)); y <= Math.min(h - 1, cy + r + 1); y++) for (var x = Math.max(0, Math.floor(cx - r - 1)); x <= Math.min(w - 1, cx + r + 1); x++) {
        var d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)), v = clamp01(r + 0.5 - d) * 0.95, j = y * w + x;
        if (v > L[j]) L[j] = v;
      }
    }
  }
  function streaksV(L, im, amount, seed, darkOnly) {   // rayas verticales del tambor
    if (amount <= 0) return;
    var w = im.w, h = im.h, S = im.S, sw = Math.max(1, S * 0.0018);
    for (var x = 0; x < w; x++) {
      var col = Math.floor(x / sw), hs = hash2(col, 1, seed + 41);
      if (hs > amount * 0.05) continue;
      var dark = darkOnly || hash2(col, 2, seed + 43) < 0.6, str = 0.35 + 0.65 * hash2(col, 3, seed + 47);
      for (var y = 0; y < h; y++) {
        var i = y * w + x, a = str * smooth(0.25, 0.7, vnoise(x * 0.01, y, S * 0.15, seed + col));
        L[i] = dark ? L[i] + (1 - L[i]) * a * 0.75 : L[i] * (1 - a * 0.85);
      }
    }
  }

  // ================================================================== técnicas
  var TECH = {};
  // 1 · Fotocopia punk: umbral duro, negro que se come los detalles, motas y rayas
  TECH.xerox = function (im, p) {
    var w = im.w, h = im.h, S = im.S, T = darkness(im), i, seed = p.seed;
    if (p.method === 'trama') T = amScreen(T, w, h, S / (p.lines || 55), 45, 'round', 0.2, 0, seed);  // foto de revista fotocopiada
    var passes = 1 + Math.round((p.gen || 0) * 2);
    for (var g = 0; g < passes; g++) {
      T = blur(T, w, h, Math.max(1, S * 0.0011 * (1 + (p.gen || 0) * 1.5)));
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        i = y * w + x;
        var th = (g === 0 ? 1 - (p.threshold == null ? 0.5 : p.threshold) : 0.5) + (fbm(x, y, S * 0.05, seed + g) - 0.5) * 0.04 + (vnoise(x, y, 1.4, seed + 5 + g) - 0.5) * 0.1;
        T[i] = smooth(th - 0.035, th + 0.035, T[i]);
      }
    }
    var near = blur(T, w, h, S * 0.01);
    if ((p.dropout || 0) > 0) for (i = 0; i < im.n; i++) {
      if (T[i] < 0.5) continue; var yy = (i / w) | 0, xx = i - yy * w;
      var cl = smooth(0.6, 0.85, vnoise(xx, yy, S * 0.008, seed + 61));
      T[i] *= 1 - p.dropout * cl * smooth(0.6, 0.9, vnoise(xx, yy, 1.8, seed + 63));
    }
    addSpecks(T, near, im, p.specks, seed, true);
    streaksV(T, im, p.streaks, seed, false);
    if ((p.haze || 0) > 0) for (i = 0; i < im.n; i++) T[i] = Math.max(T[i], p.haze * 0.18 * smooth(0, 0.5, near[i]));
    return [{ cov: defects(T, im, p, 0, seed), ink: p.inks[0] }];
  };
  // 2 · Periódico: trama AM de una tinta, ganancia de punto fuerte, sombras empastadas
  TECH.news = function (im, p) {
    var w = im.w, h = im.h, S = im.S, T = darkness(im), i;
    for (i = 0; i < im.n; i++) T[i] = clamp01((T[i] - 0.07) / 0.86);
    var C = amScreen(T, w, h, S / (p.lines || 90), p.angle == null ? 45 : p.angle, p.shape || 'round', p.gain == null ? 0.35 : p.gain, 0.22, p.seed);
    if ((p.smear || 0) > 0) C = blur(C, w, h, 1);
    return [{ cov: defects(C, im, p, 0, p.seed), ink: p.inks[0] }];
  };
  // 3 · Duotono / tritono: cada tinta con su curva y su ángulo
  TECH.tone = function (im, p) {
    var w = im.w, h = im.h, S = im.S, T = darkness(im), K = p.inks.length, layers = [], ang = [45, 75, 15], i;
    for (var k = 0; k < K; k++) {
      var C = new Float32Array(im.n);
      for (i = 0; i < im.n; i++) {
        var t = T[i];
        C[i] = K === 1 ? t : K === 2 ? (k === 0 ? Math.pow(t, 1.5) : Math.min(1, t * 1.25) * 0.7)
             : (k === 0 ? Math.pow(t, 1.9) : k === 1 ? Math.pow(t, 1.1) * 0.75 : Math.min(1, t * 1.6) * 0.55);
      }
      if ((p.lines || 0) > 0) C = amScreen(C, w, h, S / p.lines, ang[k], p.shape || 'round', p.gain || 0.15, 0.12, p.seed + k);
      var md = S * 0.004 * (p.misreg || 0) * k;
      C = shift(C, w, h, md * Math.cos(k * 2.1), md * Math.sin(k * 2.1));
      layers.push({ cov: defects(C, im, p, k, p.seed), ink: p.inks[k] });
    }
    return layers;
  };
  // 4 · Cuatricromía CMYK: separación, rosetas, desregistro, tinta desvaída
  TECH.cmyk = function (im, p) {
    var w = im.w, h = im.h, S = im.S, n = im.n, Cc = new Float32Array(n), Mc = new Float32Array(n), Yc = new Float32Array(n), Kc = new Float32Array(n), i;
    var gcr = p.comic ? 0 : 0.65;
    for (i = 0; i < n; i++) {
      var c = 1 - im.R[i], m = 1 - im.G[i], y = 1 - im.B[i], k = Math.min(c, m, y) * gcr;
      Cc[i] = (c - k) / Math.max(0.05, 1 - k); Mc[i] = (m - k) / Math.max(0.05, 1 - k); Yc[i] = (y - k) / Math.max(0.05, 1 - k); Kc[i] = k;
    }
    var fade = 1 - (p.fade || 0) * 0.35, cell = S / (p.lines || 100);
    var inks = [[0.0, 0.62, 0.88], [0.9, 0.05, 0.5], [1, 0.92, 0.05], [0.13, 0.12, 0.12]];
    var chans = [Cc, Mc, Yc, Kc], angs = [15, 75, 0, 45], dirs = [[1, 0.3], [-0.6, 1], [0.2, -1], [0, 0]], layers = [];
    if (p.comic) {   // cómic: negro como línea (umbral) y CMY en puntos gordos
      var T = darkness(im), Tb = blur(T, w, h, Math.max(1, S * 0.0015));
      for (i = 0; i < n; i++) { Kc[i] = smooth(0.8, 0.86, Tb[i]); var f2 = 1 - 0.45 * smooth(0.5, 0.85, Tb[i]); Cc[i] *= f2; Mc[i] *= f2; Yc[i] *= f2; }
    }
    for (var q = 0; q < 4; q++) {
      var L = chans[q];
      if (!(p.comic && q === 3)) L = amScreen(L, w, h, cell, angs[q], 'round', p.gain || 0.15, 0.18, p.seed + q);
      for (i = 0; i < n; i++) L[i] *= fade;
      var md = S * 0.005 * (p.misreg || 0);
      L = shift(L, w, h, md * dirs[q][0], md * dirs[q][1]);
      layers.push({ cov: defects(L, im, p, q, p.seed), ink: inks[q] });
    }
    return layers;
  };
  // 5 · Risografía: dos tintas planas transparentes, grano o trama, desregistro grande
  TECH.riso = function (im, p) {
    var w = im.w, h = im.h, S = im.S, n = im.n, K = p.inks.length, i, k, covs = [];
    for (k = 0; k < K; k++) covs.push(new Float32Array(n));
    if (K === 1) { var T = darkness(im); covs[0] = T; }
    else {
      var lut = sepLUT(p.inks, 11), o = new Float32Array(K);
      for (i = 0; i < n; i++) { lookup(lut, im.R[i], im.G[i], im.B[i], o); for (k = 0; k < K; k++) covs[k][i] = o[k]; }
    }
    var layers = [], ang = [15, 75];
    for (k = 0; k < K; k++) {
      var C = covs[k];
      C = p.method === 'trama' ? amScreen(C, w, h, S / (p.lines || 60), ang[k], 'round', 0.25, 0.25, p.seed + k)
                               : diffuse(C, w, h, Math.max(1, S * 0.0026 * (0.5 + (p.px == null ? 0.5 : p.px))), 'fs');
      var md = S * 0.012 * (p.misreg || 0) * (k ? 1 : -0.4);
      C = shift(C, w, h, md * 0.8, md * 0.6);
      // cobertura irregular del tambor y bandas suaves
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        i = y * w + x; if (C[i] <= 0) continue;
        var band = 1 - (p.bands || 0) * 0.2 * (0.5 + 0.5 * Math.sin(y / (S * 0.06) * 6.283 + k));
        C[i] *= 0.92 * band;
      }
      layers.push({ cov: defects(C, im, p, k, p.seed), ink: p.inks[k] });
    }
    return layers;
  };
  // 6 · Serigrafía póster: colores planos (posterizado) o silueta + negro, malla y desregistro
  TECH.screen = function (im, p) {
    var w = im.w, h = im.h, S = im.S, n = im.n, K = p.inks.length, i, k, masks = [];
    var R = blur(im.R, w, h, S * 0.003), G = blur(im.G, w, h, S * 0.003), B = blur(im.B, w, h, S * 0.003);
    for (k = 0; k < K; k++) masks.push(new Float32Array(n));
    if (p.method === 'silueta') {
      var T = blur(darkness(im), w, h, S * 0.002), th = 1 - (p.threshold == null ? 0.5 : p.threshold);
      for (i = 0; i < n; i++) { masks[0][i] = im.A[i] > 0.5 ? smooth(0.04, 0.1, T[i] + 0.02) : 0; masks[1][i] = smooth(th - 0.04, th + 0.04, T[i]); }
      if (K > 2) for (i = 0; i < n; i++) masks[2][i] = 0;
    } else {
      var lut = sepLUT(p.inks, 2), o = new Float32Array(K);
      for (i = 0; i < n; i++) { lookup(lut, R[i], G[i], B[i], o); for (k = 0; k < K; k++) masks[k][i] = o[k]; }
    }
    var layers = [], mcell = Math.max(2, S * 0.0035);
    for (k = 0; k < K; k++) {
      var M = blur(masks[k], w, h, S * 0.0015);
      for (i = 0; i < n; i++) {   // contorno limpio, con el dentado fino de la malla
        var y = (i / w) | 0, x = i - y * w;
        var mp = Math.sin((x + y) / mcell * 3.14) * Math.sin((x - y) / mcell * 3.14);
        M[i] = smooth(0.46, 0.54, M[i] + mp * 0.03 * (p.mesh || 0.4));
        if (M[i] > 0) M[i] *= 1 - (p.mesh || 0.4) * 0.08 * (0.5 + 0.5 * mp);
      }
      var md = S * 0.006 * (p.misreg || 0) * k;
      M = shift(M, w, h, md, -md * 0.4);
      layers.push({ cov: defects(M, im, p, k, p.seed), ink: p.inks[k] });
    }
    return layers;
  };
  // 7 · Tramado digital 1 bit: Atkinson / Bayer / mezzotinta
  TECH.dither = function (im, p) {
    var w = im.w, h = im.h, S = im.S, T = darkness(im), ps = Math.max(1, S * (0.0015 + 0.01 * (p.px == null ? 0.3 : p.px)));
    var C = p.method === 'bayer' ? bayer(T, w, h, ps) : p.method === 'mezzo' ? mezzo(T, w, h, ps, p.seed) : diffuse(T, w, h, ps, 'atkinson');
    return [{ cov: defects(C, im, p, 0, p.seed), ink: p.inks[0] }];
  };
  // 8 · Impresora estropeada: color continuo con fallos de boquillas, tinta agotada o láser rayado
  TECH.printer = function (im, p) {
    var w = im.w, h = im.h, S = im.S, n = im.n, i, x, y, seed = p.seed;
    if (p.method === 'laser') {   // láser: tóner negro, rayas del tambor, fantasma, motas
      var T = darkness(im);
      T = diffuse(T, w, h, Math.max(1, S * 0.0016), 'fs');
      if ((p.ghost || 0) > 0) { var Gh = shift(T, w, h, 0, S * 0.09); for (i = 0; i < n; i++) T[i] = Math.max(T[i], Gh[i] * p.ghost * 0.22); }
      streaksV(T, im, p.streaks, seed, false);
      addSpecks(T, blur(T, w, h, S * 0.01), im, p.specks, seed, true);
      if ((p.fade || 0) > 0) for (y = 0; y < h; y++) for (x = 0; x < w; x++) { i = y * w + x; T[i] *= 1 - p.fade * 0.7 * smooth(0.45, 0.8, vnoise(x * 0.02, y, S * 0.25, seed + 7)); }
      return [{ cov: defects(T, im, p, 0, seed), ink: hexToRgb01('#141414') }];
    }
    var inks = [[0.0, 0.66, 0.9], [0.92, 0.1, 0.55], [1, 0.93, 0.1], [0.12, 0.12, 0.13]], ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (i = 0; i < n; i++) {
      var c = 1 - im.R[i], m = 1 - im.G[i], yy = 1 - im.B[i], k = Math.min(c, m, yy) * 0.8;
      ch[0][i] = (c - k) / (1 - k + 1e-3); ch[1][i] = (m - k) / (1 - k + 1e-3); ch[2][i] = (yy - k) / (1 - k + 1e-3); ch[3][i] = k;
    }
    // pasadas del cabezal: en cada pasada, algunas boquillas (filas finas y regulares) no echan tinta
    var pass = Math.max(6, S * 0.045), nozzle = Math.max(2, S * 0.006), bad = p.method === 'empty' ? [1] : [0, 1, 3];
    var layers = [];
    for (var q = 0; q < 4; q++) {
      var L = ch[q];
      for (y = 0; y < h; y++) {
        var pi = Math.floor(y / pass), within = y - pi * pass, nz = Math.floor(within / nozzle), nf = within - nz * nozzle;
        var clog = bad.indexOf(q) >= 0 && hash2(pi, nz * 4 + q, seed + 71) < (p.bands || 0) * 0.55 && nf < Math.max(1, nozzle * 0.45);
        var passD = 1 - (p.bands || 0) * 0.12 * (pi & 1);                       // pasadas alternas con distinta densidad
        var xshift = hash2(pi, 9, seed + 3) < (p.bands || 0) * 0.25 ? (hash2(pi, 11, seed) - 0.5) * S * 0.01 : 0;
        for (x = 0; x < w; x++) {
          i = y * w + x;
          var v = xshift ? L[y * w + Math.max(0, Math.min(w - 1, Math.round(x - xshift)))] : L[i];
          v *= passD;
          if (clog) v = 0;
          if (p.method === 'empty' && q === (p.channel == null ? 1 : p.channel)) v *= 1 - smooth(0.15, 0.85, x / w + (vnoise(x, y, S * 0.08, seed + 5) - 0.5) * 0.3) * (p.fade || 0.8);
          L[i] = v;
        }
      }
      // grano fino de la inyección (gotitas)
      for (i = 0; i < n; i++) { if (L[i] <= 0) continue; var yy2 = (i / w) | 0, xx2 = i - yy2 * w; L[i] = clamp01(L[i] + (vnoise(xx2, yy2, 1.1, seed + q * 17) - 0.5) * 0.18); }
      layers.push({ cov: defects(L, im, p, q, seed), ink: inks[q] });
    }
    return layers;
  };

  // ================================================================== composición
  var PAPERS = { white: [0.975, 0.97, 0.955], cream: [0.95, 0.915, 0.84], news: [0.87, 0.855, 0.81] };
  function compose(im, layers, p) {
    var n = im.n, out = new Uint8Array(n * 4), paper = PAPERS[p.paper] || null, w = im.w;
    for (var i = 0; i < n; i++) {
      var Pr = 1, Pg = 1, Pb = 1, Q = 1;
      for (var l = 0; l < layers.length; l++) {
        var a = layers[l].cov[i]; if (a <= 0.001) continue; if (a > 1) a = 1;
        var c = layers[l].ink;
        Pr *= 1 - a * (1 - c[0]); Pg *= 1 - a * (1 - c[1]); Pb *= 1 - a * (1 - c[2]); Q *= 1 - a;
      }
      var o = i * 4, sa = im.A[i];
      if (paper) {   // papel visible: la foto queda impresa sobre papel
        var y = (i / w) | 0, x = i - y * w, pg = 1 - 0.035 * vnoise(x, y, 2.2, 3) - 0.02 * vnoise(x, y, im.S * 0.05, 9);
        out[o] = Math.round(clamp01(paper[0] * pg * Pr) * 255); out[o + 1] = Math.round(clamp01(paper[1] * pg * Pg) * 255);
        out[o + 2] = Math.round(clamp01(paper[2] * pg * Pb) * 255); out[o + 3] = Math.round(sa * 255);
      } else {       // solo tinta (para multiplicar sobre lo que haya debajo)
        var A = 1 - Q; if (A < 0.002) continue;
        out[o] = Math.round(clamp01((Pr - Q) / A) * 255); out[o + 1] = Math.round(clamp01((Pg - Q) / A) * 255);
        out[o + 2] = Math.round(clamp01((Pb - Q) / A) * 255); out[o + 3] = Math.round(A * sa * 255);
      }
    }
    return out;
  }

  /** render(px, w, h, comps, p) -> { rgba, blend: 'multiply' | 'normal' } */
  function render(px, w, h, comps, p) {
    var im = prepare(px, w, h, comps, p);
    var q = Object.assign({}, p, { inks: (p.inks || ['#151515']).map(hexToRgb01) });
    var fn = TECH[p.kind]; if (!fn) throw new Error('Técnica de imagen desconocida: ' + p.kind);
    var layers = fn(im, q);
    return { rgba: compose(im, layers, q), blend: PAPERS[p.paper] ? 'normal' : 'multiply' };
  }

  // ================================================================== técnicas (presets)
  var DEFAULTS = {
    kind: 'xerox', method: '', contrast: 0, bright: 0, detail: 0.3, threshold: 0.5, gen: 0.3, lines: 90, shape: 'round', angle: 45,
    gain: 0.2, px: 0.3, misreg: 0, mottle: 0.2, grain: 0.2, specks: 0, streaks: 0, bands: 0, haze: 0, dropout: 0, fade: 0, ghost: 0,
    mesh: 0.4, smear: 0, comic: false, channel: 1, inks: ['#151515'], paper: 'ink', seed: 1
  };
  var BK = { name: 'Negro', inks: ['#151515'] }, RD = { name: 'Rojo', inks: ['#c8292b'] }, BL = { name: 'Azul', inks: ['#1f3a93'] };
  var TECHS = [
    { id: 'xerox', name: 'Fotocopia punk', desc: 'Blanco y negro a umbral duro, como un flyer fotocopiado: el negro se come el detalle, motas de tóner, huecos y rayas.',
      palettes: [BK, RD, BL], keys: ['threshold', 'gen', 'contrast', 'detail', 'specks', 'dropout', 'streaks', 'haze', 'grain'],
      variants: [
        { id: 'umbral', name: 'Umbral duro', p: { kind: 'xerox', threshold: 0.5, gen: 0.2, detail: 0.5, specks: 0.35, dropout: 0.2, streaks: 0.15, haze: 0.08, grain: 0.15, mottle: 0.1 } },
        { id: 'copia', name: 'Copia de copia', p: { kind: 'xerox', threshold: 0.56, gen: 1, detail: 0.3, specks: 0.7, dropout: 0.45, streaks: 0.35, haze: 0.25, grain: 0.25, mottle: 0.2 } },
        { id: 'trama', name: 'Revista fotocopiada', p: { kind: 'xerox', method: 'trama', lines: 55, threshold: 0.5, gen: 0.25, detail: 0.3, specks: 0.3, dropout: 0.15, streaks: 0.1, haze: 0.1, grain: 0.15, mottle: 0.1 } }
      ] },
    { id: 'news', name: 'Periódico', desc: 'Trama de puntos de una tinta en papel de periódico: punto visible, ganancia fuerte y sombras empastadas.',
      palettes: [{ name: 'Tinta de periódico', inks: ['#262423'] }, RD, BL], keys: ['lines', 'gain', 'contrast', 'detail', 'mottle', 'grain'],
      variants: [
        { id: 'periodico', name: 'Periódico', p: { kind: 'news', lines: 95, shape: 'round', gain: 0.35, detail: 0.35, mottle: 0.3, grain: 0.25, smear: 1, paper: 'news' } },
        { id: 'gruesa', name: 'Puntos gordos', p: { kind: 'news', lines: 38, shape: 'round', gain: 0.2, detail: 0.4, contrast: 0.15, mottle: 0.15, grain: 0.15 } },
        { id: 'lineas', name: 'Trama de líneas', p: { kind: 'news', lines: 70, shape: 'line', angle: 30, gain: 0.15, detail: 0.35, mottle: 0.2, grain: 0.15 } }
      ] },
    { id: 'tone', name: 'Duotono · Tritono', desc: 'La foto en 2 o 3 tintas planas, cada una con su curva y su ángulo de trama (roseta); o en tono continuo sin trama.',
      palettes: [{ name: 'Negro + sepia', inks: ['#1a1716', '#8a6a4a', '#c9ad86'] }, { name: 'Azul noche', inks: ['#141a2b', '#3d5a80', '#98c1d9'] }, { name: 'Negro + rojo', inks: ['#151515', '#c0392b', '#f0b27a'] }],
      keys: ['lines', 'gain', 'contrast', 'detail', 'misreg', 'mottle', 'grain'],
      variants: [
        { id: 'duo', name: 'Duotono', p: { kind: 'tone', lines: 120, gain: 0.15, detail: 0.3, misreg: 0.1, mottle: 0.15, grain: 0.1, nInks: 2 } },
        { id: 'tri', name: 'Tritono', p: { kind: 'tone', lines: 120, gain: 0.15, detail: 0.3, misreg: 0.1, mottle: 0.15, grain: 0.1, nInks: 3 } },
        { id: 'liso', name: 'Duotono sin trama', p: { kind: 'tone', lines: 0, detail: 0.25, misreg: 0, mottle: 0.08, grain: 0.1, nInks: 2 } }
      ] },
    { id: 'cmyk', name: 'Cuatricromía', desc: 'Color de revista en CMYK: cuatro tramas con sus ángulos (roseta), desregistro y tintas desvaídas; o cómic con puntos gordos.',
      palettes: [{ name: 'Proceso CMYK', inks: [] }], keys: ['lines', 'gain', 'misreg', 'fade', 'contrast', 'detail', 'mottle', 'grain'],
      variants: [
        { id: 'revista', name: 'Revista', p: { kind: 'cmyk', lines: 130, gain: 0.12, misreg: 0.08, detail: 0.25, mottle: 0.1, grain: 0.08 } },
        { id: 'vintage', name: 'Vintage desregistrado', p: { kind: 'cmyk', lines: 80, gain: 0.25, misreg: 0.7, fade: 0.6, detail: 0.2, mottle: 0.3, grain: 0.2, paper: 'cream' } },
        { id: 'comic', name: 'Cómic', p: { kind: 'cmyk', comic: true, lines: 42, gain: 0.1, misreg: 0.35, fade: 0.2, detail: 0.5, contrast: 0.15, mottle: 0.15, grain: 0.15, paper: 'cream' } }
      ] },
    { id: 'riso', name: 'Risografía', desc: 'La foto separada en dos tintas riso transparentes, con grano de esténcil o trama, y desregistro de 1-3 mm.',
      palettes: [{ name: 'Rosa + azul', inks: ['#ff48b0', '#0078bf'] }, { name: 'Rojo + azul marino', inks: ['#f15060', '#1f3a5f'] }, { name: 'Amarillo + verde', inks: ['#ffe800', '#00a95c'] }],
      keys: ['misreg', 'px', 'lines', 'contrast', 'detail', 'bands', 'mottle', 'grain'],
      variants: [
        { id: 'grano', name: 'Grano 2 tintas', p: { kind: 'riso', method: 'grano', px: 0.5, misreg: 0.35, detail: 0.3, bands: 0.2, mottle: 0.35, grain: 0.3 } },
        { id: 'trama', name: 'Trama 2 tintas', p: { kind: 'riso', method: 'trama', lines: 60, misreg: 0.35, detail: 0.3, bands: 0.2, mottle: 0.3, grain: 0.25 } },
        { id: 'una', name: 'Una tinta (grano)', p: { kind: 'riso', method: 'grano', px: 0.5, misreg: 0, detail: 0.3, bands: 0.25, mottle: 0.35, grain: 0.3, nInks: 1 } }
      ] },
    { id: 'screen', name: 'Serigrafía póster', desc: 'Sin puntos: la foto reducida a manchas de color plano (posterizado) o a silueta de color con el negro encima, con malla y desregistro.',
      palettes: [{ name: 'Naranja + azul + negro', inks: ['#f28c28', '#2b4c7e', '#151515'] }, { name: 'Rojo + crema + negro', inks: ['#d7263d', '#e9d8a6', '#151515'] }, { name: 'Verde + rosa + negro', inks: ['#2a9d8f', '#e76f9a', '#151515'] }],
      keys: ['threshold', 'misreg', 'contrast', 'detail', 'mottle', 'grain'],
      variants: [
        { id: 'dos', name: '2 tintas planas', p: { kind: 'screen', misreg: 0.25, detail: 0.2, mottle: 0.15, grain: 0.15, nInks: 2 } },
        { id: 'tres', name: '3 tintas planas', p: { kind: 'screen', misreg: 0.25, detail: 0.2, mottle: 0.15, grain: 0.15, nInks: 3 } },
        { id: 'silueta', name: 'Silueta + negro', p: { kind: 'screen', method: 'silueta', threshold: 0.45, misreg: 0.5, detail: 0.4, mottle: 0.15, grain: 0.15, nInks: 2, inkPick: [0, 2] } }
      ] },
    { id: 'dither', name: 'Tramado 1 bit', desc: 'Píxeles de un solo bit, sin grises: difusión clásica (Atkinson), patrón ordenado (Bayer) o grano de mezzotinta.',
      palettes: [BK, BL, RD], keys: ['px', 'contrast', 'bright', 'detail'],
      variants: [
        { id: 'atkinson', name: 'Difusión (Atkinson)', p: { kind: 'dither', method: 'atkinson', px: 0.25, detail: 0.4, mottle: 0, grain: 0 } },
        { id: 'bayer', name: 'Ordenado (Bayer)', p: { kind: 'dither', method: 'bayer', px: 0.3, detail: 0.3, mottle: 0, grain: 0 } },
        { id: 'mezzo', name: 'Mezzotinta', p: { kind: 'dither', method: 'mezzo', px: 0.2, detail: 0.3, mottle: 0.1, grain: 0 } }
      ] },
    { id: 'printer', name: 'Impresora rota', desc: 'La foto impresa en una impresora estropeada: boquillas obstruidas con líneas de color, un cartucho que se acaba, o láser rayado con fantasma.',
      palettes: [{ name: 'Color de la imagen', inks: [] }], keys: ['bands', 'fade', 'streaks', 'ghost', 'specks', 'contrast', 'detail', 'grain'],
      variants: [
        { id: 'boquillas', name: 'Boquillas obstruidas', p: { kind: 'printer', method: 'nozzle', bands: 0.7, detail: 0.2, mottle: 0.1, grain: 0.1, paper: 'white' } },
        { id: 'sintinta', name: 'Cartucho agotado', p: { kind: 'printer', method: 'empty', channel: 1, bands: 0.4, fade: 0.85, detail: 0.2, mottle: 0.15, grain: 0.1, paper: 'white' } },
        { id: 'laser', name: 'Láser rayado', p: { kind: 'printer', method: 'laser', streaks: 0.6, ghost: 0.5, specks: 0.4, fade: 0.3, detail: 0.35, mottle: 0.1, grain: 0.1, paper: 'white' } }
      ] }
  ];
  // lo que escala el deslizador "Intensidad": solo los defectos, nunca la técnica
  var INTENSITY = ['misreg', 'mottle', 'grain', 'specks', 'streaks', 'bands', 'haze', 'dropout', 'fade', 'ghost', 'gen'];
  var PARAMS = {
    threshold: { label: 'Umbral (más o menos negro)' }, gen: { label: 'Copia de copia' }, contrast: { label: 'Contraste', min: -1, max: 1 },
    bright: { label: 'Brillo', min: -1, max: 1 }, detail: { label: 'Nitidez' }, lines: { label: 'Finura de la trama', min: 20, max: 180, step: 1, int: true },
    gain: { label: 'Ganancia de punto' }, px: { label: 'Tamaño del grano / píxel' }, misreg: { label: 'Desregistro' }, mottle: { label: 'Tinta irregular' },
    grain: { label: 'Poros del papel' }, specks: { label: 'Motas de tóner' }, streaks: { label: 'Rayas' }, bands: { label: 'Bandas de impresión' },
    haze: { label: 'Velo gris' }, dropout: { label: 'Huecos en el negro' }, fade: { label: 'Tinta desvaída / agotada' }, ghost: { label: 'Imagen fantasma' }
  };
  function byId(id) { for (var i = 0; i < TECHS.length; i++) if (TECHS[i].id === id) return TECHS[i]; return TECHS[0]; }
  function build(tech, variant, palette) {
    var p = JSON.parse(JSON.stringify(DEFAULTS)), v = variant.p;
    for (var k in v) p[k] = JSON.parse(JSON.stringify(v[k]));
    var pal = tech.palettes[Math.min(palette || 0, tech.palettes.length - 1)];
    var inks = pal.inks.slice();
    if (v.inkPick) inks = v.inkPick.map(function (q) { return pal.inks[q]; });
    else if (v.nInks) inks = inks.slice(0, v.nInks);
    p.inks = inks.length ? inks : ['#151515'];
    return p;
  }

  var api = { DEFAULTS: DEFAULTS, TECHS: TECHS, INTENSITY: INTENSITY, PARAMS: PARAMS, PAPERS: PAPERS, byId: byId, build: build, render: render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AFXImage = api;
})(this);
