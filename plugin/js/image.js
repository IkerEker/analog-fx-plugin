/*
 * Analog FX — IMÁGENES (fotografías, con o sin alfa).
 * Motor independiente del de letras: aquí la foto tiene que seguir siendo reconocible, así que no
 * hay deformación interna. Cada técnica es un modelo de reproducción de imagen impresa (umbral de
 * fotocopia, trama de periódico, duotono, cuatricromía, risografía, serigrafía, tramado 1 bit,
 * impresora rota) con sus defectos físicos.
 *
 * Preimpresión "inteligente" común: niveles automáticos (punto de luz y de sombra), contraste
 * local para que el detalle sobreviva a la trama o al umbral, enfoque y compensación de la
 * ganancia de punto (como las curvas de una preimpresión real).
 *
 * INTENSIDAD (applyIntensity): e = 0..1 (0 % … 200 % del deslizador; 100 % = 0,5).
 *   e≈0   apenas se nota: trama finísima, sin defectos y casi la foto original.
 *   e=0,5 el preset tal cual.
 *   e=1   una locura: trama enorme, umbral quemado, desregistro grande, defectos a tope.
 * Todas las medidas son relativas al lado corto de la imagen: la vista previa reducida y el
 * resultado a tamaño real se ven igual.
 */
(function (root) {
  'use strict';

  // ================================================================== utilidades
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function smooth(e0, e1, x) { var t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
  function lerp(a, b, t) { return a + (b - a) * t; }
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
  // campo de ruido a baja resolución (barato para imágenes grandes)
  function noiseField(w, h, sc, seed, oct) {
    var st = Math.max(1, Math.floor(sc / 6)), gw = Math.ceil(w / st) + 2, gh = Math.ceil(h / st) + 2, G = new Float32Array(gw * gh), x, y;
    for (y = 0; y < gh; y++) for (x = 0; x < gw; x++) G[y * gw + x] = oct ? fbm(x * st, y * st, sc, seed) : vnoise(x * st, y * st, sc, seed);
    var F = new Float32Array(w * h);
    for (y = 0; y < h; y++) {
      var fy = y / st, iy = fy | 0, ty = fy - iy;
      for (x = 0; x < w; x++) {
        var fx = x / st, ix = fx | 0, tx = fx - ix, k = iy * gw + ix;
        var a = G[k] + (G[k + 1] - G[k]) * tx, b = G[k + gw] + (G[k + gw + 1] - G[k + gw]) * tx;
        F[y * w + x] = a + (b - a) * ty;
      }
    }
    return F;
  }
  function hexToRgb01(hex) {
    var h = String(hex).replace('#', ''); if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var v = parseInt(h, 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }
  function lum(c) { return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; }

  // desenfoque de caja separable (3 pasadas ≈ gaussiano); bordes replicados. Radio fraccionario
  // aproximado mezclando dos radios enteros.
  function blurInt(src, w, h, r) {
    var a = new Float32Array(src); if (r < 1) return a;
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
  function blur(src, w, h, r) {
    if (r < 0.35) return new Float32Array(src);
    if (r < 1) {   // radio < 1 px: mezcla con un 3x3
      var o = new Float32Array(src.length), t = r;
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        var i = y * w + x, s = 0, c = 0;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var yy = y + dy, xx = x + dx; if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue; s += src[yy * w + xx]; c++; }
        o[i] = src[i] * (1 - t) + (s / c) * t;
      }
      return o;
    }
    var r0 = Math.floor(r), f = r - r0, A = blurInt(src, w, h, r0);
    if (f < 0.15) return A;
    var B = blurInt(src, w, h, r0 + 1);
    for (var j = 0; j < A.length; j++) A[j] += (B[j] - A[j]) * f;
    return A;
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
  function percentile(F, A, q) {   // percentil de F (0..1) solo en la parte opaca
    var hist = new Float64Array(512), tot = 0, i;
    for (i = 0; i < F.length; i++) { if (A && A[i] < 0.5) continue; hist[Math.min(511, Math.max(0, F[i] * 511) | 0)]++; tot++; }
    if (!tot) return q;
    var acc = 0, lim = q * tot;
    for (i = 0; i < 512; i++) { acc += hist[i]; if (acc >= lim) return i / 511; }
    return 1;
  }

  // ================================================================== tramas
  // AM (puntos de tamaño variable en rejilla girada). T = cantidad de tinta 0..1.
  // o: { cell (px), ang (°), shape: round|ellipse|line|square, gain, rag, seed, comp }
  // - comp: compensación de la ganancia en preimpresión (0..1): la curva se corrige antes.
  // - en tramas gruesas la tinta se promedia por celda (puntos redondos limpios, como un punto real).
  function amScreen(T, w, h, o) {
    var cell = Math.max(1.2, o.cell), out = new Float32Array(T.length), a = (o.ang || 0) * Math.PI / 180;
    var cs = Math.cos(a) / cell, sn = Math.sin(a) / cell, e = Math.min(0.48, 0.85 / cell), TWO = Math.PI * 2;
    var g = o.gain || 0, comp = o.comp == null ? 0.7 : o.comp, rag = o.rag || 0, seed = o.seed || 0, shape = o.shape || 'round';
    var Ts = cell > 5 ? blur(T, w, h, cell * 0.2) : T;
    var Rg = rag > 0 ? noiseField(w, h, 1.7, seed, false) : null;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var i = y * w + x, t = Ts[i];
      if (t <= 0.004) continue;
      t = t - comp * g * t * (1 - t) * 1.15;                                // curva de preimpresión
      t = t + g * t * (1 - t) * 1.4;                                        // ganancia en máquina
      if (t >= 0.993) { out[i] = 1; continue; }
      var u = x * cs + y * sn, v = -x * sn + y * cs, spot;
      if (shape === 'line') { var fu = u - Math.floor(u); spot = Math.abs(fu - 0.5) * 2; }
      else if (shape === 'ellipse') spot = 0.5 - 0.25 * (1.25 * Math.cos(TWO * u) + 0.75 * Math.cos(TWO * v));
      else if (shape === 'square') { var su = Math.abs(u - Math.floor(u) - 0.5), sv = Math.abs(v - Math.floor(v) - 0.5); spot = 1 - 2 * Math.max(su, sv) * 0.98; spot = spot * spot * 0.5 + spot * 0.5; }
      else spot = 0.5 - 0.25 * (Math.cos(TWO * u) + Math.cos(TWO * v));
      if (Rg) spot += (Rg[i] - 0.5) * rag;                                  // borde del punto irregular (fibra)
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
  // difusión de error (Floyd–Steinberg serpenteado o Atkinson) en celdas de ps px
  function diffuse(T, w, h, ps, kind, seed) {
    var g = toGrid(T, w, h, ps), G = g.G, gw = g.gw, gh = g.gh, B = new Float32Array(G.length);
    for (var y = 0; y < gh; y++) {
      var rev = kind !== 'atkinson' && (y & 1);
      for (var xx = 0; xx < gw; xx++) {
        var x = rev ? gw - 1 - xx : xx, i = y * gw + x, old = G[i];
        var thr = kind === 'fs' && seed ? 0.5 + (hash2(x, y, seed) - 0.5) * 0.18 : 0.5;   // umbral algo ruidoso: sin gusanos
        var nw = old > thr ? 1 : 0, err = old - nw, d = rev ? -1 : 1;
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
  // mezzotinta: grano aleatorio agrupado (como la plancha graneada con el graneador)
  function mezzo(T, w, h, ps, seed) {
    var N1 = noiseField(w, h, Math.max(1, ps * 0.6), seed, false), N2 = noiseField(w, h, Math.max(1, ps * 0.25), seed + 3, false), N = new Float32Array(w * h), i;
    for (i = 0; i < N.length; i++) N[i] = N1[i] * 0.6 + N2[i] * 0.4;
    var hist = new Float64Array(1024); for (i = 0; i < N.length; i++) hist[Math.min(1023, N[i] * 1024 | 0)]++;
    var cdf = new Float32Array(1024), acc = 0; for (i = 0; i < 1024; i++) { acc += hist[i]; cdf[i] = acc / N.length; }
    var out = new Float32Array(w * h), e = 0.04;
    for (i = 0; i < N.length; i++) { var nq = cdf[Math.min(1023, N[i] * 1024 | 0)]; out[i] = smooth(nq - e, nq + e, T[i]); }
    return out;
  }

  // ================================================================== separación en tintas transparentes
  // Para cada color, qué cobertura de cada tinta (mezcla sustractiva sobre papel) se le parece más,
  // dando mucho peso a la luminosidad para que la imagen se siga leyendo.
  var lutCache = {};
  function mixColor(inks, cov, out) {
    var r = 1, g = 1, b = 1;
    for (var k = 0; k < inks.length; k++) { var a = cov[k], c = inks[k]; r *= 1 - a * (1 - c[0]); g *= 1 - a * (1 - c[1]); b *= 1 - a * (1 - c[2]); }
    out[0] = r; out[1] = g; out[2] = b;
  }
  function err(t, m) {
    var lt = lum(t), lm = lum(m), dr = t[0] - m[0], dg = t[1] - m[1], db = t[2] - m[2];
    return 4 * (lt - lm) * (lt - lm) + dr * dr + dg * dg + db * db;
  }
  function sepLUT(inks, steps) {
    var key = inks.map(function (c) { return c.join(','); }).join('|') + '/' + steps;
    if (lutCache[key]) return lutCache[key];
    var N = 17, K = inks.length, combos = [], idx = new Array(K).fill(0);
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

  // ================================================================== preimpresión de la foto
  // Niveles automáticos (la foto llena todo el rango sin cambiar su color), contraste local
  // (claridad: el detalle de sombras y luces sobrevive a la trama o al umbral) y enfoque.
  function prepare(px, w, h, comps, p) {
    var n = w * h, R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), A = new Float32Array(n), Y = new Float32Array(n), i;
    for (i = 0; i < n; i++) {
      var o = i * comps;
      A[i] = comps === 4 ? px[o + 3] / 255 : 1;
      R[i] = px[o] / 255; G[i] = px[o + 1] / 255; B[i] = px[o + 2] / 255;
      Y[i] = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i];
    }
    var S = Math.min(w, h), au = p.auto == null ? 1 : p.auto;
    // niveles automáticos: punto de sombra y de luz con los percentiles extremos
    var lo = percentile(Y, A, 0.004) * au, hi = 1 - (1 - percentile(Y, A, 0.996)) * au;
    if (hi - lo < 0.25) { var mid = (hi + lo) / 2; lo = mid - 0.125; hi = mid + 0.125; }
    var cf = Math.pow(2, (p.contrast || 0) * 1.6), br = (p.bright || 0) * 0.35, sc = 1 / (hi - lo);
    for (i = 0; i < n; i++) {
      R[i] = clamp01(((R[i] - lo) * sc - 0.5) * cf + 0.5 + br);
      G[i] = clamp01(((G[i] - lo) * sc - 0.5) * cf + 0.5 + br);
      B[i] = clamp01(((B[i] - lo) * sc - 0.5) * cf + 0.5 + br);
      Y[i] = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i];
    }
    function addDelta(D) { for (var j = 0; j < n; j++) { var d = D[j]; if (!d) continue; Y[j] = clamp01(Y[j] + d); R[j] = clamp01(R[j] + d); G[j] = clamp01(G[j] + d); B[j] = clamp01(B[j] + d); } }
    if ((p.clarity || 0) > 0) {   // contraste local de radio medio
      var Yl = blur(Y, w, h, Math.max(2, S * 0.03)), D1 = new Float32Array(n), cl = p.clarity * 0.9;
      for (i = 0; i < n; i++) { var dd = (Y[i] - Yl[i]) * cl; D1[i] = dd * (1 - Math.abs(Y[i] - 0.5) * 0.8); }
      addDelta(D1);
    }
    if ((p.detail || 0) > 0) {    // máscara de enfoque: la impresión pide bordes claros
      var Yb = blur(Y, w, h, Math.max(0.8, S * 0.003)), D2 = new Float32Array(n), am = p.detail * 1.5;
      for (i = 0; i < n; i++) D2[i] = (Y[i] - Yb[i]) * am;
      addDelta(D2);
    }
    return { w: w, h: h, n: n, S: S, R: R, G: G, B: B, A: A, Y: Y, px: px, comps: comps };
  }
  function darkness(im) { var T = new Float32Array(im.n); for (var i = 0; i < im.n; i++) T[i] = 1 - im.Y[i]; return T; }

  // ================================================================== defectos comunes de la tinta
  // mottle: densidad irregular a manchas grandes; grain: poros del papel que no cogen tinta en los
  // macizos; starve: macizos grandes con menos tinta (el rodillo no llega a cargarlos).
  function defects(L, im, p, k, seed) {
    var w = im.w, h = im.h, S = im.S, n = im.n, i;
    var mot = Math.min(1.6, p.mottle || 0), gr = Math.min(1.6, p.grain || 0), stv = Math.min(1.5, p.starve || 0);
    if (mot > 0) {
      var M1 = noiseField(w, h, S * 0.08, seed + k * 31, true), M2 = noiseField(w, h, S * 0.018, seed + k * 31 + 5, false);
      for (i = 0; i < n; i++) { if (L[i] <= 0) continue; L[i] *= 1 - mot * 0.42 * smooth(0.3, 0.85, M1[i] * 0.75 + M2[i] * 0.25); }
    }
    if (gr > 0) {
      var sc2 = Math.max(1.1, S * 0.0016), P1 = noiseField(w, h, sc2, seed + 99 + k, false);
      for (i = 0; i < n; i++) { var c = L[i]; if (c <= 0.3) continue; L[i] = c * (1 - gr * 0.8 * smooth(0.66, 0.95, P1[i]) * smooth(0.45, 1, c)); }
    }
    if (stv > 0) {
      var Lb = blur(L, w, h, S * 0.02);
      for (i = 0; i < n; i++) if (L[i] > 0) L[i] *= 1 - stv * 0.3 * smooth(0.75, 0.97, Lb[i]);
    }
    return L;
  }
  function addSpecks(L, near, im, amount, seed, onlyNear, sizeK) {
    if (amount <= 0) return;
    var w = im.w, h = im.h, cs = Math.max(2, im.S * 0.006), gw = Math.ceil(w / cs), gh = Math.ceil(h / cs), sz = sizeK || 1;
    for (var gy = 0; gy < gh; gy++) for (var gx = 0; gx < gw; gx++) {
      var hv = hash2(gx, gy, seed + 501);
      if (hv > amount * 0.035) continue;
      var cx = (gx + hash2(gx, gy, seed + 7)) * cs, cy = (gy + hash2(gx, gy, seed + 9)) * cs, ci = Math.min(h - 1, cy | 0) * w + Math.min(w - 1, cx | 0);
      if (onlyNear && near[ci] < 0.04) continue;
      var r = cs * sz * (0.1 + 0.4 * Math.pow(hash2(gx, gy, seed + 3), 2.2));
      for (var y = Math.max(0, Math.floor(cy - r - 1)); y <= Math.min(h - 1, cy + r + 1); y++) for (var x = Math.max(0, Math.floor(cx - r - 1)); x <= Math.min(w - 1, cx + r + 1); x++) {
        var d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)), v = clamp01(r + 0.5 - d) * 0.95, j = y * w + x;
        if (v > L[j]) L[j] = v;
      }
    }
  }
  // tóner que salpica junto a los bordes oscuros (motitas finas, como en una fotocopia real)
  function tonerScatter(L, im, amount, seed) {
    if (amount <= 0) return;
    var w = im.w, h = im.h, S = im.S, Lb = blur(L, w, h, Math.max(1.5, S * 0.004)), i;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      i = y * w + x; if (L[i] > 0.5) continue;
      var near = Lb[i] * (1 - Lb[i]) * 4;
      if (near < 0.05) continue;
      if (hash2(x, y, seed + 77) < amount * 0.06 * near) L[i] = Math.max(L[i], 0.6 + 0.4 * hash2(x, y, seed + 78));
    }
  }
  function streaksV(L, im, amount, seed, darkOnly) {   // rayas verticales del tambor / del cristal
    if (amount <= 0) return;
    var w = im.w, h = im.h, S = im.S, sw = Math.max(1, S * 0.0018);
    for (var x = 0; x < w; x++) {
      var col = Math.floor(x / sw), hs = hash2(col, 1, seed + 41);
      if (hs > Math.min(1, amount) * 0.05) continue;
      var dark = darkOnly || hash2(col, 2, seed + 43) < 0.6, str = Math.min(1, (0.35 + 0.65 * hash2(col, 3, seed + 47)) * Math.max(1, amount));
      for (var y = 0; y < h; y++) {
        var i = y * w + x, a = str * smooth(0.25, 0.7, vnoise(x * 0.01, y, S * 0.15, seed + col));
        L[i] = dark ? L[i] + (1 - L[i]) * a * 0.75 : L[i] * (1 - a * 0.85);
      }
    }
  }
  // corrimiento del punto en la dirección de impresión (slur) y doble impresión
  function slur(L, w, h, len, dbl, dx, dy) {
    if (len < 0.3 && dbl < 0.3) return L;
    var O = new Float32Array(L);
    if (len >= 0.3) { var Sl = shift(L, w, h, dx * len, dy * len); for (var i = 0; i < O.length; i++) O[i] = Math.max(O[i], Sl[i] * 0.85); }
    if (dbl >= 0.3) { var Db = shift(L, w, h, dx * dbl, dy * dbl); for (var j = 0; j < O.length; j++) O[j] = Math.max(O[j], Db[j] * 0.45); }
    return O;
  }

  // ================================================================== técnicas
  // Cada técnica devuelve capas { cov: Float32Array 0..1, ink: [r,g,b], opaque?: bool }.
  // p.e = intensidad 0..1 (ver applyIntensity).
  var TECH = {};

  // 1 · Fotocopia punk: umbral (más o menos duro según la intensidad), umbral adaptativo para que
  // el detalle no se pierda, copia de copia (cada pasada empasta y redondea), tóner que salpica,
  // huecos, rayas, velo y sombra del borde del original en el cristal.
  TECH.xerox = function (im, p) {
    var w = im.w, h = im.h, S = im.S, n = im.n, e = p.e, seed = p.seed, i, T = darkness(im);
    // umbral adaptativo: el fondo local se lleva hacia el medio, así el detalle de luces y sombras se lee
    var ad = p.adapt == null ? 0.35 : p.adapt;
    if (ad > 0) { var M = blur(T, w, h, S * 0.05); for (i = 0; i < n; i++) T[i] = clamp01(T[i] + ad * (0.5 - M[i]) * 0.9); }
    if (p.method === 'trama') T = amScreen(T, w, h, { cell: S / (p.lines || 55), ang: 45, shape: 'round', gain: 0.25, comp: 0.4, rag: 0.15, seed: seed });
    var ew = 0.006 + 0.32 * Math.pow(1 - e, 3.2);                        // e bajo: casi tono continuo
    var passes = 1 + Math.min(4, Math.round((p.gen || 0) * 1.6)), thr = 1 - (p.threshold == null ? 0.5 : p.threshold);
    var J = noiseField(w, h, S * 0.05, seed, true);
    for (var g = 0; g < passes; g++) {
      if (g > 0 || p.method !== 'trama') T = blur(T, w, h, Math.max(0.5, S * 0.0011 * (1 + (p.gen || 0) * 1.2)));
      var th = g === 0 ? thr : 0.5;                                        // las copias siguientes no mueven el borde
      for (i = 0; i < n; i++) {
        var tj = th + (J[i] - 0.5) * 0.05 * (0.5 + e);
        T[i] = smooth(tj - ew, tj + ew, T[i]);
      }
    }
    var near = blur(T, w, h, S * 0.01);
    if ((p.dropout || 0) > 0) {   // huecos en el negro (falta de tóner) a manchas
      var D1 = noiseField(w, h, S * 0.008, seed + 61, false), D2 = noiseField(w, h, 1.8, seed + 63, false);
      for (i = 0; i < n; i++) { if (T[i] < 0.5) continue; T[i] *= 1 - Math.min(1, p.dropout) * smooth(0.6, 0.85, D1[i]) * smooth(0.55, 0.9, D2[i]); }
    }
    tonerScatter(T, im, (p.specks || 0) * 0.8, seed);
    addSpecks(T, near, im, p.specks || 0, seed, true);
    streaksV(T, im, p.streaks || 0, seed, false);
    if ((p.haze || 0) > 0) for (i = 0; i < n; i++) T[i] = Math.max(T[i], Math.min(1, p.haze) * 0.2 * smooth(0, 0.5, near[i]));
    // sombra del borde del original en el cristal (solo fotos sin recorte)
    var fr = (p.frame || 0) * smooth(0.55, 1, e);
    if (fr > 0 && im.A[0] > 0.5 && im.A[n - 1] > 0.5) {
      var Fn = noiseField(w, h, S * 0.04, seed + 91, true);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        i = y * w + x; var d = Math.min(x, y, w - 1 - x, h - 1 - y) / S;
        var band = smooth(0.012 + 0.05 * fr * Fn[i], 0.004, d) * fr;
        if (band > 0) T[i] = Math.max(T[i], band * (0.85 + 0.15 * hash2(x, y, seed)));
      }
    }
    return [{ cov: defects(T, im, p, 0, seed), ink: p.inks[0] }];
  };

  // 2 · Periódico: trama AM de una tinta en papel absorbente: pérdida de punto en las luces,
  // ganancia fuerte en medios y sombras empastadas, corrimiento del punto y doble impresión.
  TECH.news = function (im, p) {
    var w = im.w, h = im.h, S = im.S, T = darkness(im), i;
    var lo = 0.04 + 0.04 * p.e, hi = 0.95 - 0.08 * p.e;                    // las luces se quedan sin punto
    for (i = 0; i < im.n; i++) T[i] = Math.pow(clamp01((T[i] - lo) / (hi - lo)), 1.2);   // la preimpresión aclara los medios
    var C = amScreen(T, w, h, { cell: S / (p.lines || 90), ang: p.angle == null ? 45 : p.angle, shape: p.shape || 'round', gain: p.gain == null ? 0.35 : p.gain, comp: 0.95 - 0.75 * p.e, rag: 0.18 + 0.25 * p.e, seed: p.seed });
    C = blur(C, w, h, 0.45 + 0.6 * p.e);                                   // la tinta se abre en el papel
    for (i = 0; i < C.length; i++) C[i] = smooth(0.2, 0.72, C[i]);
    C = slur(C, w, h, (p.slur || 0) * S * 0.004, (p.double || 0) * S * 0.006, 0.15, 1);
    return [{ cov: defects(C, im, p, 0, p.seed), ink: p.inks[0] }];
  };

  // 3 · Duotono / tritono: cada tinta con su curva (la oscura las sombras, la clara los medios y
  // luces) y su ángulo de trama; o en tono continuo sin trama.
  TECH.tone = function (im, p) {
    var w = im.w, h = im.h, S = im.S, T = darkness(im), K = p.inks.length, layers = [], ang = [45, 75, 15], i;
    for (var k = 0; k < K; k++) {
      var C = new Float32Array(im.n);
      for (i = 0; i < im.n; i++) {
        var t = T[i];
        C[i] = K === 1 ? t : K === 2 ? (k === 0 ? Math.pow(t, 1.6) : Math.min(1, t * 1.3) * 0.75)
             : (k === 0 ? Math.pow(t, 2) : k === 1 ? Math.pow(t, 1.15) * 0.75 : Math.min(1, t * 1.7) * 0.55);
      }
      if ((p.lines || 0) > 0) C = amScreen(C, w, h, { cell: S / p.lines, ang: ang[k], shape: p.shape || 'round', gain: p.gain || 0.15, comp: 0.8, rag: 0.12, seed: p.seed + k });
      var md = S * 0.004 * (p.misreg || 0) * k;
      C = shift(C, w, h, md * Math.cos(k * 2.1), md * Math.sin(k * 2.1));
      layers.push({ cov: defects(C, im, p, k, p.seed), ink: p.inks[k] });
    }
    return layers;
  };

  // 4 · Cuatricromía CMYK: separación con generación de negro (GCR), cuatro tramas a 15/75/0/45°
  // (roseta), compensación de ganancia, desregistro, tintas desvaídas (vintage).
  // Cómic: tintas planas Ben-Day (pocos niveles, puntos iguales) y el negro como línea con contornos.
  TECH.cmyk = function (im, p) {
    var w = im.w, h = im.h, S = im.S, n = im.n, Cc = new Float32Array(n), Mc = new Float32Array(n), Yc = new Float32Array(n), Kc = new Float32Array(n), i;
    var gcr = p.comic ? 0 : 0.7;
    for (i = 0; i < n; i++) {
      var c = 1 - im.R[i], m = 1 - im.G[i], y = 1 - im.B[i], k0 = Math.min(c, m, y);
      var k = gcr * k0 * smooth(0.15, 0.8, k0);                            // el negro entra a partir de los medios
      var den = Math.max(0.05, 1 - k);
      Cc[i] = (c - k) / den; Mc[i] = (m - k) / den; Yc[i] = (y - k) / den; Kc[i] = k;
    }
    var fade = p.fade || 0, cell = S / (p.lines || 100);
    var inks = [[0.0, 0.6, 0.88], [0.9, 0.06, 0.52], [1, 0.92, 0.06], [0.12, 0.11, 0.12]];
    var chans = [Cc, Mc, Yc, Kc], angs = [15, 75, 0, 45], dirs = [[1, 0.3], [-0.6, 1], [0.2, -1], [0, 0]], layers = [];
    var fadeK = [1 - fade * 0.22, 1 - fade * 0.5, 1 - fade * 0.4, 1 - fade * 0.15];   // el magenta y el amarillo se van antes
    if (p.comic) {
      var Yb = blur(im.Y, w, h, Math.max(0.8, S * 0.0018)), Tb = new Float32Array(n);
      for (i = 0; i < n; i++) Tb[i] = 1 - Yb[i];
      // contornos (bordes de luminancia) más gruesos cuanto más intenso
      var gx, gy, Ed = new Float32Array(n);
      for (var yy = 1; yy < h - 1; yy++) for (var xx = 1; xx < w - 1; xx++) {
        i = yy * w + xx; gx = Yb[i + 1] - Yb[i - 1]; gy = Yb[i + w] - Yb[i - w]; Ed[i] = Math.sqrt(gx * gx + gy * gy);
      }
      var eth = Math.max(0.02, percentile(Ed, im.A, 0.9 - 0.06 * p.e));
      Ed = blur(Ed, w, h, 0.5 + S * 0.0012 * (0.5 + p.e));
      var lv = 3 + Math.round((1 - p.e) * 2);                              // niveles de tinta plana
      for (i = 0; i < n; i++) {
        var line = smooth(eth * 0.8, eth * 1.3, Ed[i]);
        Kc[i] = Math.max(smooth(0.8 - 0.1 * p.e, 0.86 - 0.1 * p.e, Tb[i]), line);
        var f2 = 1 - 0.5 * smooth(0.5, 0.85, Tb[i]);
        Cc[i] = Math.round(clamp01(Cc[i] * f2) * (lv - 1)) / (lv - 1);
        Mc[i] = Math.round(clamp01(Mc[i] * f2) * (lv - 1)) / (lv - 1);
        Yc[i] = Math.round(clamp01(Yc[i] * f2) * (lv - 1)) / (lv - 1);
      }
      for (var qq = 0; qq < 3; qq++) chans[qq] = blur(chans[qq], w, h, Math.max(0.6, cell * 0.25));   // bordes de la tinta plana
    }
    for (var q = 0; q < 4; q++) {
      var L = chans[q];
      if (!(p.comic && q === 3)) L = amScreen(L, w, h, { cell: cell, ang: angs[q], shape: 'round', gain: p.gain || 0.15, comp: p.comic ? 0 : 0.75, rag: 0.15, seed: p.seed + q });
      if (fadeK[q] < 1) for (i = 0; i < n; i++) L[i] *= fadeK[q];
      var md = S * 0.005 * (p.misreg || 0);
      L = shift(L, w, h, md * dirs[q][0], md * dirs[q][1]);
      layers.push({ cov: defects(L, im, p, q, p.seed), ink: inks[q] });
    }
    return layers;
  };

  // 5 · Risografía: tintas riso transparentes, grano de esténcil (difusión) o trama, la tinta se
  // abre un poco (el grano no es de píxel), desregistro grande, bandas y macizos sin carga.
  TECH.riso = function (im, p) {
    var w = im.w, h = im.h, S = im.S, n = im.n, K = p.inks.length, i, k, covs = [];
    for (k = 0; k < K; k++) covs.push(new Float32Array(n));
    if (K === 1) covs[0] = darkness(im);
    else {
      var lut = sepLUT(p.inks, 11), o = new Float32Array(K);
      for (i = 0; i < n; i++) { lookup(lut, im.R[i], im.G[i], im.B[i], o); for (k = 0; k < K; k++) covs[k][i] = o[k]; }
    }
    var layers = [], ang = [15, 75];
    for (k = 0; k < K; k++) {
      var C = covs[k], ps = Math.max(1, S * 0.0038 * (0.25 + (p.px == null ? 0.5 : p.px)));
      C = p.method === 'trama' ? amScreen(C, w, h, { cell: S / (p.lines || 60), ang: ang[k], shape: 'round', gain: 0.25, comp: 0.5, rag: 0.3, seed: p.seed + k })
                               : diffuse(C, w, h, ps, 'fs', p.seed + k);
      C = blur(C, w, h, Math.min(2.5, 0.4 + ps * 0.3));                    // la tinta se abre: grano redondeado
      for (i = 0; i < n; i++) C[i] = smooth(0.18, 0.7, C[i]);
      var md = S * 0.02 * (p.misreg || 0) * (k ? 1 : -0.4);
      C = shift(C, w, h, md * 0.8, md * 0.6);
      var Bn = noiseField(w, h, S * 0.3, p.seed + 17 + k, false);
      for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
        i = y * w + x; if (C[i] <= 0) continue;
        var band = 1 - Math.min(1.5, p.bands || 0) * 0.2 * (0.5 + 0.5 * Math.sin(y / (S * 0.06) * 6.283 + k + Bn[i] * 3));
        C[i] *= 0.93 * band;
      }
      layers.push({ cov: defects(C, im, p, k, p.seed), ink: p.inks[k] });
    }
    return layers;
  };

  // 6 · Serigrafía póster: tintas OPACAS planas, de la más clara a la más oscura (como se tira),
  // posterizado por luminancia repartido según la propia foto (cada tinta se lleva su parte),
  // formas simplificadas (más gráficas cuanto más intenso), dentado de la malla y desregistro que
  // deja ver el papel entre colores.
  TECH.screen = function (im, p) {
    var w = im.w, h = im.h, S = im.S, n = im.n, i, k, inks = p.inks.slice();
    var simp = S * (0.0012 + 0.006 * p.e);
    var Yb = blur(im.Y, w, h, simp);
    // tintas ordenadas de clara a oscura; el papel es el nivel más claro
    var order = inks.map(function (c, j) { return j; }).sort(function (a, b) { return lum(inks[b]) - lum(inks[a]); });
    var K = order.length, cuts = [];
    if (p.method === 'silueta') {
      var thS = 1 - (p.threshold == null ? 0.5 : p.threshold);
      cuts = [percentile(Yb, im.A, 0.86), thS];                           // papel en las luces, color, negro
    } else {
      for (k = 1; k <= K; k++) {
        var q = 1 - k / (K + 1), pv = percentile(Yb, im.A, q), mid = 1 - k / (K + 1);
        cuts.push(lerp(mid, pv, 0.7));                                     // cuantiles de la foto + reparto fijo
      }
    }
    var layers = [], mcell = Math.max(2, S * 0.0035), mesh = p.mesh == null ? 0.4 : p.mesh, aa = Math.max(0.6, S * 0.0012);
    for (var j = 0; j < K; j++) {
      var M = new Float32Array(n), cut = cuts[Math.min(j, cuts.length - 1)];
      // cada tinta cubre todo lo que está por debajo de su corte (las oscuras se tiran encima)
      for (i = 0; i < n; i++) M[i] = im.A[i] > 0.02 ? smooth(cut + 0.012, cut - 0.012, Yb[i]) : 0;
      M = blur(M, w, h, aa + simp * 0.4);
      var trap = 0.5 - 0.04 * j;                                           // las claras algo engordadas (reventado)
      for (i = 0; i < n; i++) {
        var yv = (i / w) | 0, xv = i - yv * w;
        var mp = Math.sin((xv + yv) / mcell * 3.14) * Math.sin((xv - yv) / mcell * 3.14);
        M[i] = smooth(trap - 0.05, trap + 0.05, M[i] + mp * 0.035 * mesh);
        if (M[i] > 0) M[i] *= 1 - mesh * 0.06 * (0.5 + 0.5 * mp);
      }
      var md = S * 0.014 * (p.misreg || 0) * (j ? 1 : 0.4);
      M = shift(M, w, h, md * (j & 1 ? -1 : 1), -md * 0.5);
      layers.push({ cov: defects(M, im, p, j, p.seed), ink: inks[order[j]], opaque: true });
    }
    return layers;
  };

  // 7 · Tramado digital 1 bit: Atkinson / Bayer / mezzotinta
  TECH.dither = function (im, p) {
    var w = im.w, h = im.h, S = im.S, T = darkness(im), ps = Math.max(1, S * (0.0012 + 0.01 * (p.px == null ? 0.3 : p.px)));
    var C = p.method === 'bayer' ? bayer(T, w, h, ps) : p.method === 'mezzo' ? mezzo(T, w, h, ps, p.seed) : diffuse(T, w, h, ps, 'atkinson');
    return [{ cov: defects(C, im, p, 0, p.seed), ink: p.inks[0] }];
  };

  // 8 · Impresora estropeada: chorro de tinta (gotitas FM de las 4 tintas) con boquillas obstruidas,
  // pasadas del cabezal desalineadas, un cartucho que se acaba, o láser rayado con fantasma.
  TECH.printer = function (im, p) {
    var w = im.w, h = im.h, S = im.S, n = im.n, i, x, y, seed = p.seed, e = p.e, bandsA = Math.min(1.6, p.bands || 0);
    if (p.method === 'laser') {
      var T = darkness(im);
      T = diffuse(T, w, h, Math.max(1, S * 0.0012 * (0.6 + e * 1.5)), 'fs', seed);
      T = blur(T, w, h, 0.5);
      if ((p.ghost || 0) > 0) { var Gh = shift(T, w, h, 0, S * 0.09); for (i = 0; i < n; i++) T[i] = Math.max(T[i], Gh[i] * Math.min(1, p.ghost) * 0.25); }
      streaksV(T, im, p.streaks || 0, seed, false);
      tonerScatter(T, im, (p.specks || 0) * 0.5, seed);
      addSpecks(T, blur(T, w, h, S * 0.01), im, p.specks || 0, seed, true);
      if ((p.fade || 0) > 0) { var Fd = noiseField(w, h, S * 0.25, seed + 7, false); for (y = 0; y < h; y++) for (x = 0; x < w; x++) { i = y * w + x; T[i] *= 1 - Math.min(1, p.fade) * 0.7 * smooth(0.45, 0.8, vnoise(x * 0.02, y, S * 0.25, seed + 7) * 0.6 + Fd[i] * 0.4); } }
      return [{ cov: defects(T, im, p, 0, seed), ink: hexToRgb01('#141414') }];
    }
    var inks = [[0.0, 0.66, 0.9], [0.92, 0.1, 0.55], [1, 0.93, 0.1], [0.12, 0.12, 0.13]], ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (i = 0; i < n; i++) {
      var c = 1 - im.R[i], m = 1 - im.G[i], yy = 1 - im.B[i], k0 = Math.min(c, m, yy), k = k0 * 0.8 * smooth(0.1, 0.7, k0);
      ch[0][i] = (c - k) / (1 - k + 1e-3); ch[1][i] = (m - k) / (1 - k + 1e-3); ch[2][i] = (yy - k) / (1 - k + 1e-3); ch[3][i] = k;
    }
    var pass = Math.max(6, S * 0.045), nozzle = Math.max(2, S * 0.006), bad = p.method === 'empty' ? [1] : [0, 1, 3];
    var dropPs = Math.max(1, S * 0.001 * (0.5 + 2 * e)), layers = [];
    for (var q = 0; q < 4; q++) {
      var L = ch[q];
      // tinta que se acaba (antes de tramar, para que las gotitas se espacien)
      if (p.method === 'empty' && q === (p.channel == null ? 1 : p.channel)) {
        var Fe = noiseField(w, h, S * 0.08, seed + 5, false), fd = Math.min(1, p.fade || 0.8);
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) { i = y * w + x; L[i] *= 1 - smooth(0.1, 0.8, x / w + (Fe[i] - 0.5) * 0.35) * fd; }
      }
      // gotitas de la inyección (FM): con poca intensidad casi tono continuo
      if (e > 0.15) { var Ld = diffuse(L, w, h, dropPs, 'fs', seed + q), mixD = smooth(0.15, 0.7, e); for (i = 0; i < n; i++) L[i] = L[i] * (1 - mixD) + Ld[i] * mixD; L = blur(L, w, h, 0.45); }
      var O = new Float32Array(n);
      for (y = 0; y < h; y++) {
        var pi = Math.floor(y / pass), within = y - pi * pass, nz = Math.floor(within / nozzle), nf = within - nz * nozzle;
        var clog = (bad.indexOf(q) >= 0 ? 1 : 0.35) * Math.min(0.5, bandsA * 0.32) > hash2(pi, nz * 4 + q, seed + 71) && nf < Math.max(1, nozzle * 0.45);
        var passD = 1 - bandsA * 0.14 * (pi & 1);                         // pasadas alternas con distinta densidad
        var xshift = hash2(pi, 9 + q, seed + 3) < bandsA * 0.3 ? (hash2(pi, 11 + q, seed) - 0.5) * S * 0.012 * bandsA : 0;
        for (x = 0; x < w; x++) {
          i = y * w + x;
          var v = xshift ? L[y * w + Math.max(0, Math.min(w - 1, Math.round(x - xshift)))] : L[i];
          O[i] = clog ? 0 : v * passD;
        }
      }
      layers.push({ cov: defects(O, im, p, q, seed), ink: inks[q] });
    }
    return layers;
  };

  // ================================================================== composición
  var PAPERS = { white: [0.975, 0.97, 0.955], cream: [0.95, 0.915, 0.84], news: [0.87, 0.855, 0.81] };
  function paperTone(im, p) {   // textura del papel: grano fino, nubes de fibra y (periódico) motas recicladas
    var w = im.w, h = im.h, S = im.S, n = im.n, P = new Float32Array(n), i;
    var F1 = noiseField(w, h, Math.max(1.2, S * 0.002), 3, false), F2 = noiseField(w, h, S * 0.05, 9, true);
    var news = p.paper === 'news';
    for (i = 0; i < n; i++) P[i] = 1 - 0.035 * F1[i] - (news ? 0.035 : 0.02) * F2[i];
    if (news) for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      if (hash2(x >> 1, y >> 1, 811) > 0.0025) continue;
      var L = 1 + (hash2(x, y, 3) * 6 | 0), ang = hash2(x, y, 5) * 3.14;
      for (var s = 0; s < L; s++) { var xx = Math.round(x + Math.cos(ang) * s), yy = Math.round(y + Math.sin(ang) * s); if (xx >= 0 && yy >= 0 && xx < w && yy < h) P[yy * w + xx] *= 0.82; }
    }
    return P;
  }
  function compose(im, layers, p) {
    var n = im.n, out = new Uint8Array(n * 4), paper = PAPERS[p.paper] || null;
    var PT = paper ? paperTone(im, p) : null, keep = p.keep || 0, ipx = im.px, cp = im.comps;
    for (var i = 0; i < n; i++) {
      var Pr = 1, Pg = 1, Pb = 1, Q = 1;
      for (var l = 0; l < layers.length; l++) {
        var a = layers[l].cov[i]; if (a <= 0.001) continue; if (a > 1) a = 1;
        var c = layers[l].ink;
        if (layers[l].opaque) {   // tinta opaca: tapa lo de debajo
          Pr = Pr * (1 - a) + c[0] * a; Pg = Pg * (1 - a) + c[1] * a; Pb = Pb * (1 - a) + c[2] * a;
        } else { Pr *= 1 - a * (1 - c[0]); Pg *= 1 - a * (1 - c[1]); Pb *= 1 - a * (1 - c[2]); }
        Q *= 1 - a;
      }
      var o = i * 4, sa = im.A[i];
      if (paper) {
        var pg = PT[i];
        Pr = paper[0] * pg * Pr; Pg = paper[1] * pg * Pg; Pb = paper[2] * pg * Pb;
      }
      if (keep > 0) {   // intensidad baja: casi la foto original
        var orr = ipx[i * cp] / 255, og = ipx[i * cp + 1] / 255, ob = ipx[i * cp + 2] / 255;
        Pr = Pr + (orr - Pr) * keep; Pg = Pg + (og - Pg) * keep; Pb = Pb + (ob - Pb) * keep;
      }
      if (paper || keep > 0) {
        out[o] = Math.round(clamp01(Pr) * 255); out[o + 1] = Math.round(clamp01(Pg) * 255);
        out[o + 2] = Math.round(clamp01(Pb) * 255); out[o + 3] = Math.round(sa * 255);
      } else {       // solo tinta (para multiplicar sobre lo que haya debajo)
        var A = 1 - Q; if (A < 0.002) continue;
        out[o] = Math.round(clamp01((Pr - Q) / A) * 255); out[o + 1] = Math.round(clamp01((Pg - Q) / A) * 255);
        out[o + 2] = Math.round(clamp01((Pb - Q) / A) * 255); out[o + 3] = Math.round(A * sa * 255);
      }
    }
    return out;
  }

  // ================================================================== intensidad
  // Lo que cambia con el deslizador. Los defectos crecen de 0 a mucho más que el preset; las tramas
  // y los granos se hacen más finos (casi invisibles) o enormes; con intensidad baja además se
  // conserva parte de la foto original. Así el 0 % casi no se nota y el 200 % es una locura.
  var DEFECTS = ['misreg', 'mottle', 'grain', 'specks', 'streaks', 'bands', 'haze', 'dropout', 'fade', 'ghost', 'gen', 'slur', 'double', 'starve', 'frame'];
  function applyIntensity(p, I) {
    var e = clamp01((I == null ? 1 : I) / 2);
    p.e = e;
    var f = Math.pow(2 * e, 1.5);                                          // 0 → 0 · 0,5 → 1 · 1 → 2,8
    DEFECTS.forEach(function (k) { if (typeof p[k] === 'number') p[k] = Math.min(2.5, p[k] * f); });
    if (p.lines > 0) p.lines = p.lines * Math.pow(2, (0.5 - e) * 2.6);    // ×2,5 más fina … ×2,5 más gruesa
    if (typeof p.px === 'number') p.px = p.px * Math.pow(2, (e - 0.5) * 3);
    if (typeof p.gain === 'number') p.gain = p.gain * (0.3 + 1.1 * e);
    p.clarity = (p.clarity == null ? 0.3 : p.clarity) * (0.3 + 1.4 * e);
    p.detail = (p.detail || 0) * (0.35 + 1.3 * e);
    p.contrast = (p.contrast || 0) + Math.max(0, e - 0.55) * (p.punch == null ? 0.5 : p.punch);
    p.keep = 0.92 * Math.pow(1 - smooth(0, 0.48, e), 1.3);
    return p;
  }

  /** render(px, w, h, comps, p) -> { rgba, blend: 'multiply' | 'normal' } */
  function render(px, w, h, comps, p) {
    if (p.e == null) applyIntensity(p, 1);
    var im = prepare(px, w, h, comps, p);
    var q = Object.assign({}, p, { inks: (p.inks || ['#151515']).map(hexToRgb01) });
    var fn = TECH[p.kind]; if (!fn) throw new Error('Técnica de imagen desconocida: ' + p.kind);
    var layers = fn(im, q);
    return { rgba: compose(im, layers, q), blend: PAPERS[p.paper] ? 'normal' : 'multiply' };
  }

  // ================================================================== técnicas (presets, al 100 %)
  var DEFAULTS = {
    kind: 'xerox', method: '', contrast: 0, bright: 0, detail: 0.3, clarity: 0.3, auto: 1, punch: 0.5, threshold: 0.5, gen: 0.3, adapt: 0.35,
    lines: 90, shape: 'round', angle: 45, gain: 0.2, px: 0.3, misreg: 0, mottle: 0.2, grain: 0.2, specks: 0, streaks: 0, bands: 0, haze: 0,
    dropout: 0, fade: 0, ghost: 0, slur: 0, double: 0, starve: 0, frame: 0, mesh: 0.4, comic: false, channel: 1, inks: ['#151515'], paper: 'ink', seed: 1
  };
  var BK = { name: 'Negro', inks: ['#151515'] }, RD = { name: 'Rojo', inks: ['#c8292b'] }, BL = { name: 'Azul', inks: ['#1f3a93'] };
  var TECHS = [
    { id: 'xerox', name: 'Fotocopia punk', desc: 'Blanco y negro a umbral, como un flyer fotocopiado: el negro se come el detalle, el tóner salpica junto a los bordes, huecos, rayas del cristal y, a tope, la sombra del borde del original.',
      palettes: [BK, RD, BL], keys: ['threshold', 'gen', 'adapt', 'contrast', 'detail', 'specks', 'dropout', 'streaks', 'haze', 'grain'],
      variants: [
        { id: 'umbral', name: 'Umbral duro', p: { kind: 'xerox', threshold: 0.5, gen: 0.2, adapt: 0.4, detail: 0.5, clarity: 0.5, specks: 0.35, dropout: 0.2, streaks: 0.15, haze: 0.08, grain: 0.15, mottle: 0.1, frame: 0.6 } },
        { id: 'copia', name: 'Copia de copia', p: { kind: 'xerox', threshold: 0.56, gen: 1, adapt: 0.45, detail: 0.3, clarity: 0.3, specks: 0.7, dropout: 0.45, streaks: 0.35, haze: 0.25, grain: 0.25, mottle: 0.2, frame: 1 } },
        { id: 'trama', name: 'Revista fotocopiada', p: { kind: 'xerox', method: 'trama', lines: 55, threshold: 0.5, gen: 0.25, adapt: 0.15, detail: 0.3, clarity: 0.3, specks: 0.3, dropout: 0.15, streaks: 0.1, haze: 0.1, grain: 0.15, mottle: 0.1, frame: 0.5 } }
      ] },
    { id: 'news', name: 'Periódico', desc: 'Trama de puntos de una tinta en papel de periódico: las luces pierden el punto, los medios engordan, las sombras se empastan; el punto se corre y a veces se dobla.',
      palettes: [{ name: 'Tinta de periódico', inks: ['#262423'] }, RD, BL], keys: ['lines', 'gain', 'slur', 'contrast', 'detail', 'mottle', 'grain'],
      variants: [
        { id: 'periodico', name: 'Periódico', p: { kind: 'news', lines: 95, shape: 'round', gain: 0.35, detail: 0.35, clarity: 0.35, mottle: 0.3, grain: 0.25, slur: 0.3, double: 0.15, paper: 'news' } },
        { id: 'gruesa', name: 'Puntos gordos', p: { kind: 'news', lines: 38, shape: 'round', gain: 0.2, detail: 0.4, clarity: 0.4, contrast: 0.15, mottle: 0.15, grain: 0.15 } },
        { id: 'lineas', name: 'Trama de líneas', p: { kind: 'news', lines: 70, shape: 'line', angle: 30, gain: 0.15, detail: 0.35, clarity: 0.35, mottle: 0.2, grain: 0.15 } }
      ] },
    { id: 'tone', name: 'Duotono · Tritono', desc: 'La foto en 2 o 3 tintas planas: la oscura lleva las sombras y la clara los medios y las luces, cada una con su ángulo de trama (roseta); o en tono continuo sin trama.',
      palettes: [{ name: 'Negro + sepia', inks: ['#1a1716', '#8a6a4a', '#c9ad86'] }, { name: 'Azul noche', inks: ['#141a2b', '#3d5a80', '#98c1d9'] }, { name: 'Negro + rojo', inks: ['#151515', '#c0392b', '#f0b27a'] }],
      keys: ['lines', 'gain', 'contrast', 'detail', 'misreg', 'mottle', 'grain'],
      variants: [
        { id: 'duo', name: 'Duotono', p: { kind: 'tone', lines: 120, gain: 0.15, detail: 0.3, misreg: 0.12, mottle: 0.15, grain: 0.1, nInks: 2 } },
        { id: 'tri', name: 'Tritono', p: { kind: 'tone', lines: 120, gain: 0.15, detail: 0.3, misreg: 0.12, mottle: 0.15, grain: 0.1, nInks: 3 } },
        { id: 'liso', name: 'Duotono sin trama', p: { kind: 'tone', lines: 0, detail: 0.25, misreg: 0.05, mottle: 0.1, grain: 0.1, nInks: 2 } }
      ] },
    { id: 'cmyk', name: 'Cuatricromía', desc: 'Color de revista en CMYK: cuatro tramas con sus ángulos (roseta), negro por GCR, desregistro y tintas que se desvanecen; o cómic con tintas planas de puntos iguales y contornos negros.',
      palettes: [{ name: 'Proceso CMYK', inks: [] }], keys: ['lines', 'gain', 'misreg', 'fade', 'contrast', 'detail', 'mottle', 'grain'],
      variants: [
        { id: 'revista', name: 'Revista', p: { kind: 'cmyk', lines: 130, gain: 0.12, misreg: 0.1, detail: 0.25, clarity: 0.25, mottle: 0.1, grain: 0.08 } },
        { id: 'vintage', name: 'Vintage desregistrado', p: { kind: 'cmyk', lines: 80, gain: 0.25, misreg: 0.7, fade: 0.6, detail: 0.2, mottle: 0.3, grain: 0.2, paper: 'cream' } },
        { id: 'comic', name: 'Cómic', p: { kind: 'cmyk', comic: true, lines: 42, gain: 0.1, misreg: 0.35, fade: 0.2, detail: 0.5, clarity: 0.5, contrast: 0.15, mottle: 0.15, grain: 0.15, paper: 'cream' } }
      ] },
    { id: 'riso', name: 'Risografía', desc: 'La foto separada en tintas riso transparentes, con grano de esténcil o trama que se abre un poco en el papel, desregistro de 1-3 mm, bandas y macizos con poca carga.',
      palettes: [{ name: 'Rosa + azul', inks: ['#ff48b0', '#0078bf'] }, { name: 'Rojo + azul marino', inks: ['#f15060', '#1f3a5f'] }, { name: 'Amarillo + verde', inks: ['#ffe800', '#00a95c'] }],
      keys: ['misreg', 'px', 'lines', 'contrast', 'detail', 'bands', 'mottle', 'grain', 'starve'],
      variants: [
        { id: 'grano', name: 'Grano 2 tintas', p: { kind: 'riso', method: 'grano', px: 0.5, misreg: 0.35, detail: 0.3, bands: 0.2, mottle: 0.35, grain: 0.3, starve: 0.4 } },
        { id: 'trama', name: 'Trama 2 tintas', p: { kind: 'riso', method: 'trama', lines: 60, misreg: 0.35, detail: 0.3, bands: 0.2, mottle: 0.3, grain: 0.25, starve: 0.4 } },
        { id: 'una', name: 'Una tinta (grano)', p: { kind: 'riso', method: 'grano', px: 0.5, misreg: 0, detail: 0.3, bands: 0.25, mottle: 0.35, grain: 0.3, starve: 0.4, nInks: 1 } }
      ] },
    { id: 'screen', name: 'Serigrafía póster', desc: 'Tintas opacas planas tiradas de la clara a la oscura: la foto reducida a manchas de color repartidas según su propia luz, formas simplificadas, dentado de la malla y papel entre colores por el desregistro.',
      palettes: [{ name: 'Naranja + azul + negro', inks: ['#f28c28', '#2b4c7e', '#151515'] }, { name: 'Rojo + crema + negro', inks: ['#d7263d', '#e9d8a6', '#151515'] }, { name: 'Verde + rosa + negro', inks: ['#2a9d8f', '#e76f9a', '#151515'] }],
      keys: ['threshold', 'misreg', 'mesh', 'contrast', 'detail', 'mottle', 'grain'],
      variants: [
        { id: 'dos', name: '2 tintas planas', p: { kind: 'screen', misreg: 0.3, detail: 0.2, mottle: 0.15, grain: 0.15, nInks: 2, inkPick: [0, 2] } },
        { id: 'tres', name: '3 tintas planas', p: { kind: 'screen', misreg: 0.3, detail: 0.2, mottle: 0.15, grain: 0.15, nInks: 3 } },
        { id: 'silueta', name: 'Silueta + negro', p: { kind: 'screen', method: 'silueta', threshold: 0.6, misreg: 0.5, detail: 0.4, clarity: 0.5, mottle: 0.15, grain: 0.15, nInks: 2, inkPick: [0, 2] } }
      ] },
    { id: 'dither', name: 'Tramado 1 bit', desc: 'Píxeles de un solo bit, sin grises: difusión clásica (Atkinson), patrón ordenado (Bayer) o grano de mezzotinta.',
      palettes: [BK, BL, RD], keys: ['px', 'contrast', 'bright', 'detail'],
      variants: [
        { id: 'atkinson', name: 'Difusión (Atkinson)', p: { kind: 'dither', method: 'atkinson', px: 0.25, detail: 0.4, clarity: 0.4, mottle: 0, grain: 0 } },
        { id: 'bayer', name: 'Ordenado (Bayer)', p: { kind: 'dither', method: 'bayer', px: 0.3, detail: 0.3, mottle: 0, grain: 0 } },
        { id: 'mezzo', name: 'Mezzotinta', p: { kind: 'dither', method: 'mezzo', px: 0.2, detail: 0.3, mottle: 0.1, grain: 0 } }
      ] },
    { id: 'printer', name: 'Impresora rota', desc: 'La foto en una impresora estropeada: gotitas de las cuatro tintas, boquillas obstruidas y pasadas del cabezal desalineadas, un cartucho que se acaba, o láser rayado con fantasma.',
      palettes: [{ name: 'Color de la imagen', inks: [] }], keys: ['bands', 'fade', 'streaks', 'ghost', 'specks', 'contrast', 'detail', 'grain'],
      variants: [
        { id: 'boquillas', name: 'Boquillas obstruidas', p: { kind: 'printer', method: 'nozzle', bands: 0.7, detail: 0.2, mottle: 0.1, grain: 0.1, paper: 'white' } },
        { id: 'sintinta', name: 'Cartucho agotado', p: { kind: 'printer', method: 'empty', channel: 1, bands: 0.4, fade: 0.85, detail: 0.2, mottle: 0.15, grain: 0.1, paper: 'white' } },
        { id: 'laser', name: 'Láser rayado', p: { kind: 'printer', method: 'laser', streaks: 0.6, ghost: 0.5, specks: 0.4, fade: 0.3, detail: 0.35, mottle: 0.1, grain: 0.1, paper: 'white' } }
      ] }
  ];
  var INTENSITY = DEFECTS;   // compatibilidad
  var PARAMS = {
    threshold: { label: 'Umbral (más o menos negro)' }, gen: { label: 'Copia de copia' }, adapt: { label: 'Detalle en luces y sombras' },
    contrast: { label: 'Contraste', min: -1, max: 1 }, bright: { label: 'Brillo', min: -1, max: 1 }, detail: { label: 'Nitidez' },
    lines: { label: 'Finura de la trama', min: 20, max: 180, step: 1, int: true }, gain: { label: 'Ganancia de punto' }, slur: { label: 'Punto corrido' },
    px: { label: 'Tamaño del grano / píxel' }, misreg: { label: 'Desregistro' }, mottle: { label: 'Tinta irregular' }, mesh: { label: 'Malla de la pantalla' },
    grain: { label: 'Poros del papel' }, specks: { label: 'Motas de tóner' }, streaks: { label: 'Rayas' }, bands: { label: 'Bandas de impresión' },
    haze: { label: 'Velo gris' }, dropout: { label: 'Huecos en el negro' }, fade: { label: 'Tinta desvaída / agotada' }, ghost: { label: 'Imagen fantasma' },
    starve: { label: 'Macizos con poca tinta' }
  };
  function byId(id) { for (var i = 0; i < TECHS.length; i++) if (TECHS[i].id === id) return TECHS[i]; return TECHS[0]; }
  function build(tech, variant, palette) {
    var p = JSON.parse(JSON.stringify(DEFAULTS)), v = variant.p;
    for (var k in v) p[k] = JSON.parse(JSON.stringify(v[k]));
    var pal = tech.palettes[Math.min(palette || 0, tech.palettes.length - 1)];
    var inks = pal.inks.slice();
    if (v.inkPick) inks = v.inkPick.map(function (q) { return pal.inks[q]; }).filter(Boolean);
    else if (v.nInks) inks = inks.slice(0, v.nInks);
    p.inks = inks.length ? inks : ['#151515'];
    return p;
  }

  var api = { DEFAULTS: DEFAULTS, TECHS: TECHS, INTENSITY: INTENSITY, PARAMS: PARAMS, PAPERS: PAPERS, byId: byId, build: build, render: render, applyIntensity: applyIntensity };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AFXImage = api;
})(this);
