/*
 * Analog FX — motor de técnicas de impresión (v0.3).
 * JavaScript puro, sin dependencias: funciona en Photoshop (UXP) y en Node (pruebas).
 *
 * Entrada: la máscara (alfa) de una capa de texto o forma sólida.
 * Cada técnica produce una o varias "tintas" (cobertura por píxel + color) que se
 * combinan de forma sustractiva, como tinta real sobre papel blanco.
 * Todas las medidas van en unidades U (tamaño de letra/trazo) para que la vista
 * previa reducida y el resultado a tamaño real coincidan.
 */
(function (root) {
  'use strict';

  // ================================================================== utilidades
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function smooth(e0, e1, x) {
    var t = (x - e0) / (e1 - e0);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return t * t * (3 - 2 * t);
  }
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(n) {
    n = (n | 0) ^ 0x5bd1e995;
    n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
    n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
    n ^= n >>> 15;
    return (n >>> 0) / 4294967296;
  }
  function makeNoise(seed) {
    var r = rng(seed), N = 256, tab = new Float32Array(N * N);
    for (var i = 0; i < tab.length; i++) tab[i] = r();
    function n2(x, y) {
      var xf = Math.floor(x), yf = Math.floor(y), fx = x - xf, fy = y - yf;
      var x0 = xf & 255, y0 = yf & 255, x1 = (x0 + 1) & 255, y1 = (y0 + 1) & 255;
      var a = tab[(y0 << 8) + x0], b = tab[(y0 << 8) + x1], c = tab[(y1 << 8) + x0], d = tab[(y1 << 8) + x1];
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      var top = a + (b - a) * fx, bot = c + (d - c) * fx;
      return top + (bot - top) * fy;
    }
    n2.fbm = function (x, y, oct) {
      var s = 0, amp = 0.5, tot = 0, f = 1;
      for (var o = 0; o < oct; o++) { s += n2(x * f + o * 17.3, y * f - o * 9.1) * amp; tot += amp; amp *= 0.5; f *= 2.03; }
      return s / tot;
    };
    return n2;
  }

  // ---- desenfoque de caja separable (3 pasadas ≈ gaussiano), fuera = 0
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
    rx = Math.round(rx); ry = Math.round(ry == null ? rx : ry);
    var a = new Float32Array(src);
    if (rx <= 0 && ry <= 0) return a;
    var b = new Float32Array(src.length);
    for (var p = 0; p < 3; p++) {
      if (rx > 0) { boxH(a, b, w, h, rx); var t = a; a = b; b = t; }
      if (ry > 0) { boxV(a, b, w, h, ry); var t2 = a; a = b; b = t2; }
    }
    return a;
  }
  function blurWrap(src, S, r) {
    var a = new Float32Array(src), b = new Float32Array(src.length), m = S - 1, inv = 1 / (2 * r + 1);
    for (var p = 0; p < 3; p++) {
      for (var y = 0; y < S; y++) {
        var off = y * S, acc = 0, i;
        for (i = -r; i <= r; i++) acc += a[off + (i & m)];
        for (var x = 0; x < S; x++) { b[off + x] = acc * inv; acc += a[off + ((x + r + 1) & m)] - a[off + ((x - r) & m)]; }
      }
      for (var x2 = 0; x2 < S; x2++) {
        var acc2 = 0, j;
        for (j = -r; j <= r; j++) acc2 += b[(j & m) * S + x2];
        for (var y2 = 0; y2 < S; y2++) { a[y2 * S + x2] = acc2 * inv; acc2 += b[((y2 + r + 1) & m) * S + x2] - b[((y2 - r) & m) * S + x2]; }
      }
    }
    return a;
  }
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
  // muestreo bilineal de un campo en (x, y) con 0 fuera
  function sampleField(F, w, h, x, y) {
    var xf = Math.floor(x), yf = Math.floor(y);
    if (xf < 0 || yf < 0 || xf + 1 >= w || yf + 1 >= h) return 0;
    var fx = x - xf, fy = y - yf, k = yf * w + xf;
    var t = F[k] + (F[k + 1] - F[k]) * fx, b = F[k + w] + (F[k + w + 1] - F[k + w]) * fx;
    return t + (b - t) * fy;
  }
  function shift(F, w, h, dx, dy) {
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return F;
    var o = new Float32Array(F.length);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) o[y * w + x] = sampleField(F, w, h, x - dx, y - dy);
    return o;
  }

  // ================================================================== texturas
  function prepareTexture(bytes, size) {
    var n = size * size, base = new Float32Array(n);
    for (var i = 0; i < n; i++) base[i] = bytes[i] / 255;
    var low = blurWrap(base, size, Math.max(2, size >> 8));
    var hp = new Float32Array(n);
    for (var k = 0; k < n; k++) hp[k] = base[k] - low[k];
    return { size: size, base: base, detail: equalize(hp) };
  }
  function makeSampler(data, S, unit, tileUnits, angle, stretch, ox, oy, offX, offY) {
    var k = S / (unit * tileUnits);
    var sx = Math.pow(2, -stretch * 1.6), sy = 1 / sx;
    var c = Math.cos(angle), s = Math.sin(angle);
    var a = c * k * sx, b = -s * k * sx, d = s * k * sy, e = c * k * sy, m = S - 1;
    return function (x, y) {
      var u = x - ox, v = y - oy;
      var tx = a * u + b * v + offX, ty = d * u + e * v + offY;
      var xf = Math.floor(tx), yf = Math.floor(ty), fx = tx - xf, fy = ty - yf;
      var x0 = xf & m, y0 = yf & m, x1 = (x0 + 1) & m, y1 = (y0 + 1) & m;
      var p = data[y0 * S + x0], q = data[y0 * S + x1], r = data[y1 * S + x0], t = data[y1 * S + x1];
      var top = p + (q - p) * fx, bot = r + (t - r) * fx;
      return top + (bot - top) * fy;
    };
  }

  // ================================================================== medidas
  function measure(alpha, w, h) {
    var area = 0, per = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var i = y * w + x, a = alpha[i];
      area += a;
      if (x + 1 < w) per += Math.abs(a - alpha[i + 1]);
      if (y + 1 < h) per += Math.abs(a - alpha[i + w]);
      if (a > 0.5) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return null;
    var bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    var thick = per > 0 ? 2 * area / per : Math.min(bw, bh);
    return { unit: Math.max(2, Math.min(bw, bh, 6 * thick)), box: { left: x0, top: y0, right: x1 + 1, bottom: y1 + 1 }, thickness: thick };
  }

  // margen (px) que necesita cada técnica alrededor de la forma
  function margin(tech, p, unit) {
    var U = unit * (p.scale || 1), m = 0.04;
    switch (tech) {
      case 'serigrafia': m += 0.1 * p.misreg + 0.03; break;
      case 'offset': m += 0.04 * p.misreg + 0.02; break;
      case 'riso': m += 0.1 * p.misreg + 0.03; break;
      case 'tipografia': m += 0.05 + 0.04 * p.halo; break;
      case 'litografia': m += 0.05 + 0.8 * p.veil; break;
      case 'xilografia': m += 0.06 + 0.25 * p.chips; break;
      case 'copia': m += 0.12 + 0.4 * p.specks + 0.08 * p.shift; break;
      case 'humedad': m += 0.08 + 0.35 * p.spread; break;
      case 'goteo': m += 0.1 + 0.12 * p.wet + Math.max(1.6 * p.length * (p.drips > 0 ? 1 : 0), 0.9 * p.smear) + 0.06; break;
      case 'acuarela': m += 0.08 + 0.32 * p.water; break;
    }
    return Math.ceil(Math.min(m, 3) * U + 3);
  }

  // ================================================================== contexto
  function makeCtx(input, p, texs) {
    var w = input.w, h = input.h, U = input.unit * (p.scale || 1);
    var c = {
      w: w, h: h, n: w * h, A0: input.alpha, U: U, invU: 1 / U,
      ox: input.origin.x, oy: input.origin.y, R: rng((p.seed || 1) * 7919 + 13), noise: makeNoise((p.seed || 1) * 31 + 7),
      texs: texs || {}, p: p
    };
    c.gStep = Math.max(1, Math.min(8, Math.floor(U / 40)));
    c.grid = function (fn) {
      return makeGrid(w, h, c.gStep, function (gx, gy) { return fn((gx - c.ox) * c.invU, (gy - c.oy) * c.invU); });
    };
    // muestreador de una familia de texturas; si no hay textura devuelve ruido
    c.samp = function (fam, which, tileU, angle, stretch) {
      var t = c.texs[fam];
      var ang = angle == null ? c.R() * Math.PI * 2 : angle;
      var ofx = c.R(), ofy = c.R();
      if (!t) {
        var f = 1 / (tileU * 0.12 * U);
        return function (x, y) { return c.noise.fbm(x * f + ofx * 99, y * f + ofy * 99, 3); };
      }
      return makeSampler(which === 'd' ? t.detail : t.base, t.size, U, tileU * (p.texScale || 1), ang, stretch || 0, c.ox, c.oy, ofx * t.size, ofy * t.size);
    };
    return c;
  }

  // ---- borde irregular: desplaza el muestreo con ruido + detalle de textura
  function roughen(c, A, amt, fam, low) {
    if (amt <= 0 && !low) return new Float32Array(A);
    var w = c.w, h = c.h, U = c.U, n = c.n;
    var mR = U * 0.022 * amt + 0.7 * amt, mN = U * 0.025 * amt + U * 0.05 * (low || 0);
    var gx = c.grid(function (u, v) { return c.noise.fbm(u * 2.4 + 3, v * 2.4, 2); });
    var gy = c.grid(function (u, v) { return c.noise.fbm(u * 2.4 + 50, v * 2.4 + 50, 2); });
    var sx = c.samp(fam, 'd', 0.45), sy = c.samp(fam, 'd', 0.45);
    var reach = blur(A, w, h, Math.ceil((mR + mN) * 0.8) + 2);
    var out = new Float32Array(n);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var i = y * w + x;
      if (reach[i] < 1e-5) continue;
      var dx = (gx(x, y) - 0.5) * 2 * mN + (sx(x, y) - 0.5) * 2 * mR;
      var dy = (gy(x, y) - 0.5) * 2 * mN + (sy(x, y) - 0.5) * 2 * mR;
      out[i] = sampleField(A, w, h, x + dx, y + dy);
    }
    return out;
  }

  // ---- trama de semitono: devuelve f(x, y, tono) -> cobertura 0..1
  function screen(cellPx, angDeg, shape, ragged) {
    var a = angDeg * Math.PI / 180, cs = Math.cos(a) / cellPx, sn = Math.sin(a) / cellPx;
    var e = Math.min(0.45, 0.85 / cellPx), TWO = Math.PI * 2;
    return function (x, y, tone, jit) {
      if (tone <= 0.001) return 0;
      if (tone >= 0.999) return 1;
      var u = x * cs + y * sn, v = -x * sn + y * cs, s;
      if (shape === 'line') { var fu = u - Math.floor(u); s = Math.abs(fu - 0.5) * 2; }
      else if (shape === 'ellipse') s = 0.5 - 0.25 * (1.15 * Math.cos(TWO * u) + 0.85 * Math.cos(TWO * v));
      else s = 0.5 - 0.25 * (Math.cos(TWO * u) + Math.cos(TWO * v));
      if (jit) s += jit * ragged;
      return smooth(s - e, s + e, tone);
    };
  }

  // ---- campo de borde interior: 1 justo dentro del contorno
  function innerEdge(c, A, r, k) {
    var B = blur(A, c.w, c.h, Math.max(1, r)), E = new Float32Array(c.n);
    for (var i = 0; i < c.n; i++) if (A[i] > 0) E[i] = clamp01((A[i] - B[i]) * (k || 3));
    return E;
  }

  // ---- tinta que se corre en papel húmedo: frente de agua irregular + pigmento atrapado
  // W (opcional): peso por píxel (zonas húmedas). Devuelve { A, pool, wet }
  function wetBleed(c, A, o) {
    var w = c.w, h = c.h, n = c.n, U = c.U;
    var r = Math.max(1, U * 0.2 * o.spread), poolAmt = o.pool, haloOp = o.halo, W = o.W;
    var B = blur(A, w, h, r), B2 = blur(A, w, h, r * 0.4);
    var fam = o.fam || 'acuarela';
    var tf = c.samp(fam, 'b', 0.7), tf2 = c.samp(o.fineFam || 'moteado', 'd', 0.55), tbl = c.samp(fam, 'b', 0.9);
    var gfront = c.grid(function (u, v) { return c.noise.fbm(u * 1.4 + 300, v * 1.4 - 120, 3); });
    var greach = c.grid(function (u, v) { return c.noise.fbm(u * 0.8 - 77, v * 0.8 + 31, 2); });
    var gpool = c.grid(function (u, v) { return c.noise.fbm(u * 3.0 + 11, v * 3.0 + 400, 2); });
    var out = new Float32Array(A), pool = new Float32Array(n), wet = new Float32Array(n);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var i = y * w + x, core = A[i], bv = B[i];
      var wt = W ? W[i] : 1;
      if (wt <= 0.002 || (bv < 1e-4 && core <= 0)) continue;
      var reachM = smooth(0.3, 0.75, greach(x, y));
      var bw2 = B2[i] + (bv - B2[i]) * reachM;
      var gf = smooth(0.32, 0.68, gfront(x, y));
      var th = 0.04 + 0.5 * gf * gf;
      var fib = (tf(x, y) - 0.5) * 0.09 + (tf2(x, y) - 0.5) * 0.015;
      var front = smooth(th - 0.014, th + 0.014, bw2 + fib);
      var inner = smooth(th + 0.005, th + 0.12 + 0.14 * (1 - poolAmt), bw2 + fib);
      var ring = front * (1 - inner) * smooth(0.25, 0.65, gpool(x, y));
      var dil = haloOp * (0.55 + 0.45 * smooth(0, 0.9, bw2)) * (0.55 + 0.45 * tbl(x, y));
      var halo = front * dil;
      var v = Math.max(core, halo);
      v = v + (1 - v) * ring * poolAmt * 0.55;
      out[i] = core + (v - core) * wt;
      pool[i] = ring * poolAmt * wt;
      wet[i] = clamp01(front - core) * wt;
    }
    return { A: out, pool: pool, wet: wet };
  }

  // ---- arrastre vertical (tinta escurrida en columnas)
  function smearDown(c, A, len, amount, up) {
    var w = c.w, h = c.h, U = c.U, invU = c.invU, noise = c.noise;
    var down = new Float32Array(w), upD = new Float32Array(w);
    for (var x = 0; x < w; x++) {
      var uu = (x - c.ox) * invU;
      var on = smooth(1 - amount * 0.75, 1 - amount * 0.75 + 0.12, noise(uu * 14 + 300, 11.5) * 0.6 + noise(uu * 45 + 500, 3.3) * 0.4);
      var L = U * (0.03 + 0.6 * len) * on * (0.25 + 0.75 * Math.pow(noise(uu * 6 + 900, 1.7), 2));
      down[x] = L > 0.5 ? Math.exp(-1 / L) : 0;
      var Lu = L * (up || 0);
      upD[x] = Lu > 0.5 ? Math.exp(-1 / Lu) : 0;
    }
    var D = new Float32Array(A), i, y, prev;
    for (x = 0; x < w; x++) {
      if (down[x] > 0) { prev = 0; for (y = 0; y < h; y++) { i = y * w + x; prev = Math.max(A[i], prev * down[x]); if (prev > D[i]) D[i] = prev; } }
      if (upD[x] > 0) { prev = 0; for (y = h - 1; y >= 0; y--) { i = y * w + x; prev = Math.max(A[i], prev * upD[x]); if (prev > D[i]) D[i] = prev; } }
    }
    var ts = c.samp('moteado', 'd', 0.5, 0, -1.4);
    for (i = 0; i < c.n; i++) {
      var add = D[i] - A[i];
      if (add > 0.001) { y = (i / w) | 0; x = i - y * w; D[i] = A[i] + add * (0.45 + 0.55 * smooth(0.2, 0.8, ts(x, y))); }
    }
    return D;
  }

  // ---- gotas: hilo fino que baja desde los bordes inferiores con bulbo pequeño
  function paintDrops(c, A, amount, length, wMin, wMax, droplets) {
    var w = c.w, h = c.h, U = c.U, R = c.R, noise = c.noise;
    var stepX = Math.max(1, Math.round(U * 0.008)), placed = [], maxDrops = 260, x, y, i;
    for (x = 1; x < w - 1 && placed.length < maxDrops; x += stepX) {
      for (y = 1; y < h - 2; y++) {
        i = y * w + x;
        if (A[i] < 0.5 || A[i + w] >= 0.5) continue;
        if (R() > amount * 0.1) continue;
        var wd = U * (wMin + (wMax - wMin) * Math.pow(R(), 1.6)) + 0.35;
        var ok = true;
        for (var k = 0; k < placed.length; k++) {
          var q = placed[k];
          if (Math.abs(q.x - x) < (q.wd + wd) * 3 && Math.abs(q.y - y) < U * 0.15) { ok = false; break; }
        }
        if (!ok) continue;
        placed.push({ x: x, y: y, wd: wd, L: U * (0.05 + 1.3 * length) * (0.15 + 0.85 * Math.pow(R(), 1.7)), id: placed.length });
      }
    }
    function dot(cx, cy, r, op) {
      var ya = Math.max(0, Math.floor(cy - r - 1)), yb = Math.min(h - 1, Math.ceil(cy + r + 1));
      var xa = Math.max(0, Math.floor(cx - r - 1)), xb = Math.min(w - 1, Math.ceil(cx + r + 1));
      for (var yy = ya; yy <= yb; yy++) for (var xx = xa; xx <= xb; xx++) {
        var d = Math.sqrt((xx - cx) * (xx - cx) + (yy - cy) * (yy - cy));
        var cv = clamp01(r + 0.5 - d) * op, j = yy * w + xx;
        if (cv > A[j]) A[j] = cv;
      }
    }
    for (var d = 0; d < placed.length; d++) {
      var P = placed[d], ex = P.x;
      for (var t = 0; t <= P.L; t++) {
        var yy = Math.round(P.y + t); if (yy >= h) break;
        var tt = t / P.L, root0 = tt < 0.15 ? (0.15 - tt) / 0.15 : 0;
        var hw = P.wd * (1 - 0.45 * tt) + P.wd * 1.8 * root0 * root0;
        ex = P.x + (noise(t / U * 5 + P.id * 3.1, P.id * 1.7) - 0.5) * P.wd * 1.4;
        var xa = Math.max(0, Math.floor(ex - hw - 1)), xb = Math.min(w - 1, Math.ceil(ex + hw + 1));
        for (var xx = xa; xx <= xb; xx++) {
          var cov = clamp01(hw + 0.5 - Math.abs(xx - ex)) * (0.85 + 0.15 * (1 - tt)), j = yy * w + xx;
          if (cov > A[j]) A[j] = cov;
        }
      }
      dot(ex, P.y + P.L, P.wd * (1.15 + 0.6 * R()), 1);
      // gotitas que se desprenden por debajo del hilo
      if (droplets > 0) {
        var nd = Math.floor(R() * 4 * droplets + droplets);
        for (var s = 0; s < nd; s++) dot(ex + (R() - 0.5) * P.wd * 3, P.y + P.L + P.wd * (3 + R() * 14), P.wd * (0.35 + 0.5 * R()), 0.9);
      }
    }
    return placed.length;
  }

  // ---- bandas, franjas desplazadas y rayas (impresora / fotocopiadora)
  function machineLines(c, A, o, DK) {
    var w = c.w, h = c.h, U = c.U, invU = c.invU, noise = c.noise, seed = (c.p.seed || 1) * 131, x, y, i;
    var spacing = U * (0.025 + 0.28 * o.spacing * o.spacing);
    if (o.shift > 0) {
      var spS = spacing * 2.3, As = new Float32Array(c.n);
      for (y = 0; y < h; y++) {
        var iS = Math.floor((y - c.oy) / spS), hS = hash(iS + seed * 7);
        var off = hS > 0.55 ? (hash(iS * 3 + 1 + seed) - 0.5) * U * 0.09 * o.shift : 0;
        for (x = 0; x < w; x++) { var xs = Math.round(x - off); As[y * w + x] = xs >= 0 && xs < w ? A[y * w + xs] : 0; }
      }
      A.set(As);
    }
    var stW = Math.max(1.1, U * 0.0045), near = o.streaks > 0 ? blur(A, w, h, U * 0.12) : null;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      var a = A[i], q = y - c.oy, al = x - c.ox;
      if (o.bands > 0 && a > 0) {
        var qq = q / spacing + (noise(al * invU * 0.8, q / spacing * 0.15 + 50) - 0.5) * 0.35;
        var idx = Math.floor(qq), fr = qq - idx, hr = hash(idx + seed), hr2 = hash(idx * 7 + 3 + seed);
        var lw = (0.08 + 0.45 * (o.width == null ? 0.3 : o.width)) * (0.4 + 0.9 * hr2);
        var line = 1 - smooth(lw * 0.55, lw, Math.abs(fr - 0.5) * 2);
        var lv = line * o.bands * Math.pow(hr, 1.6) * (0.35 + 0.65 * smooth(0.25, 0.65, noise(al * invU * 2.2 + idx * 13.1, idx * 0.37)));
        if (hr2 < 0.62) a *= 1 - lv * 0.92;
        else { if (DK) DK[i] = Math.max(DK[i], lv); a = a + (1 - a) * lv * 0.5 * smooth(0, 0.3, a); }
        a *= 1 - o.bands * 0.18 * (0.5 + 0.5 * Math.sin(q / (spacing * 3.7) * 6.283 + hr));
      }
      if (o.streaks > 0) {
        var sIdx = Math.floor(al / stW), sh = hash(sIdx * 3 + 11 + seed);
        if (sh > 1 - o.streaks * 0.07) {
          var sStr = smooth(0.3, 0.7, noise(q * invU * 0.6 + sIdx * 0.71, sIdx * 0.13 + 9)) * (0.5 + 0.5 * hash(sIdx * 5 + 1 + seed));
          if (hash(sIdx + 77 + seed) < 0.5) a *= 1 - sStr * 0.9;
          else { if (DK) DK[i] = Math.max(DK[i], sStr); a = a + (1 - a) * sStr * (a > 0.02 ? 0.6 : 0.14 * smooth(0.05, 0.4, near[i])); }
        }
      }
      A[i] = a;
    }
  }

  // ================================================================== TÉCNICAS
  // Cada una devuelve una lista de tintas: { a: Float32Array, ink: índice, dark?: Float32Array }
  var TECH = {};

  // ------------------------------------------------------------ Serigrafía
  TECH.serigrafia = function (c, p) {
    var w = c.w, h = c.h, n = c.n, U = c.U, x, y, i;
    var A = roughen(c, c.A0, p.rough, 'moteado');
    var cell = Math.max(2.2, U * 0.014), ang = 0.38, cs = Math.cos(ang) / cell, sn = Math.sin(ang) / cell, TWO = Math.PI * 2;
    var Ab = blur(A, w, h, Math.max(1, cell * 0.7));
    var tv = c.samp('moteado', 'd', 0.5), tvb = c.samp('moteado', 'b', 0.9);
    var ang2 = (c.R() - 0.5) * 0.6;
    var gsq = c.grid(function (u, v) { return c.noise.fbm((u * Math.cos(ang2) + v * Math.sin(ang2)) * 0.25, (v * Math.cos(ang2) - u * Math.sin(ang2)) * 7, 2); });
    var base = new Float32Array(n);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      if (Ab[i] < 0.002 && A[i] <= 0) continue;
      var u = x * cs + y * sn, v = -x * sn + y * cs;
      var mp = Math.sin(TWO * u) * Math.sin(TWO * v);       // -1..1 hilos de la malla
      var e = 0.08 + 0.1 * (1 - p.edge);
      var shp = smooth(0.5 - e, 0.5 + e, Ab[i] + mp * 0.22 * p.edge + (A[i] - Ab[i]) * (1 - p.edge * 0.6));
      if (shp <= 0) continue;
      var dens = p.density * (1 - p.mesh * 0.22 * (0.5 + 0.5 * mp));
      dens *= 1 - p.squeegee * 0.4 * smooth(0.45, 0.8, gsq(x, y));
      var hole = smooth(1 - p.voids * 0.1, 1 - p.voids * 0.1 + 0.015, tv(x, y)) * (0.4 + 0.6 * smooth(0.3, 0.7, tvb(x, y)));
      dens *= 1 - hole;
      base[i] = shp * clamp01(dens);
    }
    var layers = [{ a: base, ink: 0 }];
    if (p.inkCount >= 2) {
      var ma = p.misAng * Math.PI * 0.5 + Math.PI * 0.25, md = U * 0.09 * p.misreg + 0.5;
      // la 2.ª tinta va debajo, desplazada (como un fotolito mal colocado)
      layers.unshift({ a: shift(base, w, h, Math.cos(ma) * md, Math.sin(ma) * md), ink: 1 });
    }
    return layers;
  };

  // ------------------------------------------------------------ Offset / tritono
  TECH.offset = function (c, p) {
    var w = c.w, h = c.h, n = c.n, U = c.U, x, y, i;
    var A = roughen(c, c.A0, 0.08, 'moteado');
    var count = Math.max(1, Math.min(3, p.inkCount | 0));
    var cellPx = Math.max(2.6, U * (0.018 + 0.1 * p.cell));
    var angles = [45, 75, 15], shapes = p.dot || 'round';
    var tvar = c.samp('granulado', 'b', 2.2), tvar2 = c.samp('granulado', 'b', 0.9), rag = c.samp('moteado', 'd', 0.4);
    var gt = c.grid(function (u, v) { return c.noise.fbm(u * 0.7 + 5, v * 0.7 - 9, 3); });
    var Ab = p.edgeFade > 0 ? blur(A, w, h, U * 0.12) : null;
    var T = new Float32Array(n);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      if (A[i] <= 0) continue;
      var t = p.tone + p.toneVar * ((tvar(x, y) - 0.5) * 0.55 + (tvar2(x, y) - 0.5) * 0.2 + (gt(x, y) - 0.5) * 0.45);
      if (Ab) t *= 1 - p.edgeFade * (1 - smooth(0.3, 0.95, Ab[i]));
      T[i] = clamp01(t);
    }
    // curvas por tinta: oscura (sombras), media y clara (luces)
    var curves = count === 3 ? [function (t) { return Math.pow(t, 1.7); }, function (t) { return t * 0.82; }, function (t) { return 0.22 + 0.78 * t; }]
      : count === 2 ? [function (t) { return Math.pow(t, 1.35); }, function (t) { return 0.18 + 0.82 * t; }] : [function (t) { return t; }];
    var layers = [];
    for (var k = 0; k < count; k++) {
      var scr = screen(cellPx, angles[k], shapes, 0.35 * p.paper);
      var ma = c.R() * Math.PI * 2, md = k === 0 ? 0 : U * 0.035 * p.misreg * (0.6 + 0.4 * c.R());
      var dx = Math.cos(ma) * md, dy = Math.sin(ma) * md, cv = curves[k], a = new Float32Array(n);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        var sx = x - dx, sy = y - dy;
        var Am = md ? sampleField(A, w, h, sx, sy) : A[i];
        if (Am <= 0.002) continue;
        var tt = md ? sampleField(T, w, h, sx, sy) : T[i];
        tt = cv(clamp01(tt));
        tt = tt + p.gain * tt * (1 - tt) * 1.3;                 // ganancia de punto
        // borde de la forma: el semitono también recorta el contorno
        a[i] = scr(sx, sy, tt * smooth(0.0, 1, Am), (rag(x, y) - 0.5)) * smooth(0.15, 0.6, Am);
      }
      layers.push({ a: a, ink: k });
    }
    return layers.reverse();
  };

  // ------------------------------------------------------------ Risografía
  TECH.riso = function (c, p) {
    var w = c.w, h = c.h, n = c.n, U = c.U, x, y, i;
    var count = p.inkCount >= 2 ? 2 : 1;
    var A = roughen(c, c.A0, p.rough, 'piedra');
    var cellPx = Math.max(2.6, U * (0.022 + 0.07 * p.cell));
    var tg = c.samp('piedra', 'b', 0.45), tg2 = c.samp('piedra', 'd', 0.4);
    var gu = c.grid(function (u, v) { return c.noise.fbm(u * 0.6 + 2, v * 0.6 + 8, 3); });
    var ma = p.misAng * Math.PI * 0.5 + Math.PI * 0.25, md = U * 0.08 * p.misreg + 0.5;
    var offs = [[-Math.cos(ma) * md * 0.25, -Math.sin(ma) * md * 0.25], [Math.cos(ma) * md * 0.75, Math.sin(ma) * md * 0.75]];
    var dens = [p.d1, p.d2], angles = [15, 75], layers = [], spacing = U * 0.35;
    for (var k = 0; k < count; k++) {
      var scr = screen(cellPx, angles[k], 'round', 0.25), a = new Float32Array(n);
      var dx = count === 1 ? 0 : offs[k][0], dy = count === 1 ? 0 : offs[k][1];
      var tgk = c.samp('piedra', 'b', 0.45);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        var sx = x - dx, sy = y - dy, Am = (dx || dy) ? sampleField(A, w, h, sx, sy) : A[i];
        if (Am <= 0.002) continue;
        var d = dens[k] * (1 - p.uneven * 0.35 * smooth(0.35, 0.8, gu(sx, sy)));
        d *= 1 - p.bands * 0.3 * (0.5 + 0.5 * Math.sin((sy - c.oy) / spacing * 6.283 + k));
        var cov = d >= 0.97 ? 1 : scr(sx, sy, d, (tg2(x, y) - 0.5));
        // grano del esténcil: puntos blancos y moteado (la tinta de soja no cubre del todo)
        var g = (k === 0 ? tg(x, y) : tgk(x, y));
        cov *= 1 - p.grain * (0.55 * smooth(0.72, 0.98, g) + 0.18 * (g - 0.5));
        a[i] = clamp01(cov) * smooth(0.12, 0.6, Am) * 0.93;
      }
      layers.push({ a: a, ink: k });
    }
    return layers.reverse();
  };

  // ------------------------------------------------------------ Tipografía (letterpress)
  TECH.tipografia = function (c, p) {
    var w = c.w, h = c.h, n = c.n, U = c.U, x, y, i;
    var A = roughen(c, c.A0, p.rough, 'moteado');
    var E = innerEdge(c, A, U * 0.018 + 0.8, 3.2);
    var C = blur(A, w, h, U * 0.07);
    var Bh = blur(A, w, h, U * 0.005 + 0.8);
    var tm = c.samp('moteado', 'b', 0.8), tp = c.samp('piedra', 'b', 0.45);
    var gm = c.grid(function (u, v) { return c.noise.fbm(u * 1.4, v * 1.4 + 7, 3); });
    var a = new Float32Array(n), dark = new Float32Array(n);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      var ai = A[i], out = 0;
      if (ai > 0) {
        var center = smooth(0.45, 1, C[i]);
        var dens = 1 - p.starve * 0.5 * center * (0.35 + 0.65 * smooth(0.25, 0.8, gm(x, y))) * (0.6 + 0.4 * tm(x, y));
        var hole = smooth(1 - p.valleys * 0.28, 1 - p.valleys * 0.28 + 0.05, tp(x, y)) * (1 - E[i]) * (0.4 + 0.6 * center);
        dens *= 1 - hole;
        dens = Math.min(1, dens + p.squeeze * E[i] * 0.9);
        out = ai * clamp01(dens);
        dark[i] = p.squeeze * E[i] * 0.55;
        if (p.deboss > 0) {
          var gx = sampleField(C, w, h, x - 1.5, y - 1.5) - sampleField(C, w, h, x + 1.5, y + 1.5);
          dark[i] += p.deboss * clamp01(gx * U * 0.03) * 0.3;
        }
      }
      // halo: tinta aplastada que sale por fuera del borde
      var ring = smooth(0.02, 0.22, Bh[i] - ai) * (1 - smooth(0.3, 0.5, Bh[i] - ai));
      var hv = p.halo * 0.5 * ring * (0.45 + 0.55 * smooth(0.3, 0.7, tm(x, y)));
      a[i] = Math.max(out, hv);
    }
    return [{ a: a, ink: 0, dark: dark }];
  };

  // ------------------------------------------------------------ Litografía
  TECH.litografia = function (c, p) {
    var w = c.w, h = c.h, n = c.n, U = c.U, x, y, i;
    var A = roughen(c, c.A0, 0.22, 'piedra');
    var Ab = blur(A, w, h, U * 0.035 * p.greasy + 0.5);
    var tile = 0.3 + 0.8 * p.grainSize;
    var tg = c.samp('piedra', 'b', tile), tg2 = c.samp('piedra', 'd', tile * 0.8);
    var tr = c.samp('granulado', 'd', 0.9), trb = c.samp('granulado', 'b', 1.6);
    var gt = c.grid(function (u, v) { return c.noise.fbm(u * 0.9 + 1, v * 0.9, 3); });
    var N = p.veil > 0 ? blur(A, w, h, U * 0.45) : null;
    var a = new Float32Array(n), dark = new Float32Array(n);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      var shp = A[i] + (Ab[i] - A[i]) * p.greasy;
      var out = 0;
      if (shp > 0.003) {
        var T = p.tone * (0.85 + 0.3 * (gt(x, y) - 0.5)) * smooth(0, 0.85, shp);
        T *= 1 - p.tusche * 0.55 * smooth(0.55, 0.85, tr(x, y)) * (0.5 + 0.5 * trb(x, y));
        var g = tg(x, y) * 0.75 + tg2(x, y) * 0.25;
        var crayon = smooth(g - 0.05, g + 0.05, T);           // el grano de la piedra retiene o no la grasa
        out = clamp01(T + (crayon - T) * p.grain) * (shp > 0.5 ? 1 : smooth(0, 0.5, shp) * 0.6 + 0.4 * shp);
        dark[i] = p.tusche * 0.25 * smooth(0.7, 0.95, tr(x, y));
      }
      if (N && out < 0.3) {
        var veil = p.veil * 0.14 * smooth(0.0, 0.5, N[i]) * (0.4 + 0.6 * tg(x, y));
        out = Math.max(out, veil);
      }
      a[i] = out;
    }
    return [{ a: a, ink: 0, dark: dark }];
  };

  // ------------------------------------------------------------ Xilografía / linograbado
  TECH.xilografia = function (c, p) {
    var w = c.w, h = c.h, n = c.n, U = c.U, invU = c.invU, noise = c.noise, x, y, i;
    var A = roughen(c, c.A0, p.rough * 1.1, 'moteado', 0.08 * p.rough);
    var ang = p.woodAng * Math.PI * 0.5, ca = Math.cos(ang), sa = Math.sin(ang);
    var period = U * (0.03 + 0.12 * p.woodSpacing);
    var gw1 = c.grid(function (u, v) { return noise.fbm((u * ca + v * sa) * 0.22, (v * ca - u * sa) * 0.3 + 17, 3); });
    var gw3 = c.grid(function (u, v) { return noise.fbm((u * ca + v * sa) * 0.12 + 70, (v * ca - u * sa) * 0.12, 2); });
    var gw2 = c.grid(function (u, v) { return noise.fbm((u * ca + v * sa) * 1.1 + 40, (v * ca - u * sa) * 0.9, 3); });
    var gp = c.grid(function (u, v) { return noise.fbm(u * 0.55 + 9, v * 0.55 - 4, 3); });
    var gAng = c.R() * Math.PI, gc = Math.cos(gAng), gs = Math.sin(gAng);
    var Ab = blur(A, w, h, U * 0.04 + 1);
    var N = p.chips > 0 ? blur(A, w, h, U * 0.22) : null;
    var gchip = c.grid(function (u, v) { return noise.fbm(u * 3.2 + 21, v * 3.2 - 8, 3); });
    var tm = c.samp('moteado', 'b', 0.8), tmd = c.samp('moteado', 'd', 0.45);
    var E = innerEdge(c, A, U * 0.012 + 0.7, 3);
    var a = new Float32Array(n), dark = new Float32Array(n);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      var px = x - c.ox, py = y - c.oy;
      var along = px * ca + py * sa, across = py * ca - px * sa;
      var q = across + U * 0.55 * (gw1(x, y) - 0.5) + U * 0.16 * (gw2(x, y) - 0.5);
      q += U * 0.9 * Math.pow(gw3(x, y), 2);       // anillos que se abren y cierran (nudos)
      var ph = q / period, ai = A[i], out = 0;
      if (ai > 0) {
        var dens = 1;
        if (p.wood > 0) {
          var cosv = 0.5 + 0.5 * Math.cos(ph * 6.283 + 2.5 * noise(along * invU * 0.6, ph * 0.3));
          var ring = Math.floor(ph), rs0 = hash(ring * 17 + 3);
          var brk = smooth(0.3, 0.7, noise(along * invU * 1.8 + ring * 7.3, ring * 0.61));
          dens *= 1 - p.wood * 0.9 * smooth(0.8 - 0.1 * rs0, 0.97, cosv) * (0.2 + 0.8 * brk) * (0.3 + 0.7 * rs0);
          dens *= 1 - p.wood * 0.16 * (0.5 + 0.5 * Math.cos(ph * 1.57));
        }
        dens *= 1 - p.pressure * 0.5 * smooth(0.35, 0.8, gp(x, y));
        dens *= 1 - p.mottle * 0.55 * smooth(0.5, 0.92, tm(x, y)) - p.mottle * 0.15 * (tmd(x, y) - 0.5);
        // marcas de gubia: cortes alargados que muerden el borde
        var eb = smooth(0.12, 0.5, Ab[i]) * (1 - smooth(0.55, 0.95, Ab[i]));
        if (p.gouge > 0 && eb > 0) {
          var g1 = noise((px * gc + py * gs) * invU * 1.3, (py * gc - px * gs) * invU * 10);
          dens *= 1 - p.gouge * smooth(0.6, 0.68, g1) * eb * 1.3;
        }
        out = ai * clamp01(dens);
        out = smooth(0.28, 0.62, out) * 0.97 + out * 0.03;   // la tinta del taco es dura: bordes nítidos
        dark[i] = E[i] * 0.3;
      }
      // restos de talla: tiras paralelas a la veta que no se vaciaron del todo
      if (N && ai < 0.5) {
        var nv = N[i];
        if (nv > 0.01) {
          // islas de madera sin vaciar pegadas al contorno, con su propia veta
          var isl = gchip(x, y) + (tm(x, y) - 0.5) * 0.08;
          var thr = 0.74 - 0.12 * p.chips;
          var band = smooth(0.1, 0.28, nv) * (1 - smooth(0.42, 0.6, nv));
          var m2 = smooth(thr, thr + 0.02, isl) * band;
          if (m2 > 0) {
            var cv2 = 0.5 + 0.5 * Math.cos(ph * 6.283);
            m2 *= 1 - 0.8 * smooth(0.75, 0.95, cv2);
            out = Math.max(out, smooth(0.3, 0.6, m2) * 0.95);
          }
        }
      }
      a[i] = out;
    }
    return [{ a: a, ink: 0, dark: dark }];
  };

  // ------------------------------------------------------------ Copistería
  TECH.copia = function (c, p) {
    var w = c.w, h = c.h, n = c.n, U = c.U, x, y, i;
    var A = roughen(c, c.A0, 0.18, 'moteado');
    // copia de copia: desenfocar y volver a umbralizar redondea esquinas y come trazos finos
    if (p.gen > 0) {
      var passes = p.gen > 0.55 ? 2 : 1;
      for (var g = 0; g < passes; g++) {
        var Bg = blur(A, w, h, U * 0.012 * p.gen + 0.6);
        var tn = c.samp('moteado', 'd', 0.45);
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) { i = y * w + x; if (Bg[i] > 0) A[i] = smooth(0.42, 0.58, Bg[i] + (tn(x, y) - 0.5) * 0.18 * p.gen); }
      }
    }
    var tm = c.samp('moteado', 'b', 0.6), tm2 = c.samp('piedra', 'b', 0.45);
    var wide = blur(c.A0, w, h, U * 0.3);
    var a = new Float32Array(n), DK = new Float32Array(n);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      var v = A[i];
      if (v > 0) {
        v *= 1 - p.toner * 0.6 * smooth(0.55, 0.95, tm(x, y)) * (0.4 + 0.6 * tm2(x, y));
        var hw = 0.5 * (1 - p.contrast) + 0.06;
        v = smooth(0.5 - hw, 0.5 + hw, v);
      }
      // motas de tóner y velo gris alrededor
      var nr = wide[i];
      var sp = smooth(1 - p.specks * 0.05, 1 - p.specks * 0.05 + 0.004, tm2(x, y)) * (0.25 + 0.75 * smooth(0, 0.3, nr));
      var hz = p.haze * 0.18 * smooth(0, 0.35, nr) * (0.6 + 0.4 * tm(x, y));
      a[i] = Math.max(v, sp * 0.9, hz);
    }
    machineLines(c, a, { bands: p.bands, spacing: p.spacing, shift: p.shift, streaks: p.streaks, width: 0.3 }, DK);
    return [{ a: a, ink: 0, dark: DK }];
  };

  // ------------------------------------------------------------ base de impresión ligera (humedad / goteo)
  function lightPrint(c, amt) {
    var A = roughen(c, c.A0, 0.1 + 0.25 * amt, 'moteado');
    if (amt > 0) {
      var tm = c.samp('moteado', 'b', 0.7);
      for (var y = 0; y < c.h; y++) for (var x = 0; x < c.w; x++) {
        var i = y * c.w + x;
        if (A[i] > 0) A[i] *= 1 - amt * 0.6 * smooth(0.8, 0.98, tm(x, y)) - amt * 0.08 * (tm(x, y) - 0.5);
      }
    }
    return A;
  }
  function wetZones(c, wet, size) {
    var Z = new Float32Array(c.n), tw = c.samp('acuarela', 'b', 2 + 5 * size);
    var gz = c.grid(function (u, v) { return c.noise.fbm(u / (0.8 + 2.4 * size) + 60, v / (0.8 + 2.4 * size), 3); });
    for (var y = 0; y < c.h; y++) for (var x = 0; x < c.w; x++) {
      var f = tw(x, y) * 0.55 + gz(x, y) * 0.45;
      Z[y * c.w + x] = smooth(1 - wet - 0.08, 1 - wet + 0.08, f);
    }
    return Z;
  }

  // ------------------------------------------------------------ Humedad
  TECH.humedad = function (c, p) {
    var n = c.n, x, y, i;
    var A = lightPrint(c, p.print);
    var Z = wetZones(c, p.wet, p.zoneSize);
    var r = wetBleed(c, A, { spread: p.spread * 0.85, pool: p.ring, halo: 0.42, W: Z, fam: 'acuarela' });
    var tw = c.samp('acuarela', 'b', 1.4), twd = c.samp('acuarela', 'd', 1.1);
    var a = r.A, dark = new Float32Array(n);
    for (y = 0; y < c.h; y++) for (x = 0; x < c.w; x++) {
      i = y * c.w + x;
      if (a[i] <= 0) continue;
      var z = Z[i];
      if (z > 0) {
        a[i] *= 1 - p.dissolve * 0.6 * z * (0.35 + 0.65 * (1 - tw(x, y)));   // tinta que se disuelve
        var tide = smooth(0.93, 0.97, twd(x, y)) * z * p.tide;
        a[i] = a[i] + (1 - a[i]) * tide * 0.5 * smooth(0, 0.2, a[i]);
        dark[i] = r.pool[i] * 0.6 + tide * 0.4;
      }
    }
    return [{ a: a, ink: 0, dark: dark }];
  };

  // ------------------------------------------------------------ Goteo
  TECH.goteo = function (c, p) {
    var A = lightPrint(c, p.print), dark = null;
    if (p.wet > 0) {
      var Z = wetZones(c, p.wet, 0.4);
      var r = wetBleed(c, A, { spread: 0.45, pool: 0.5, halo: 0.65, W: Z, fam: 'acuarela' });
      A = r.A; dark = r.pool;
    }
    if (p.smear > 0) A = smearDown(c, A, p.smear * 0.6, Math.min(1, p.smear + 0.2), 0);
    if (p.drips > 0) paintDrops(c, A, p.drips, p.length, 0.003 + 0.012 * p.thick, 0.007 + 0.022 * p.thick, p.droplets);
    return [{ a: A, ink: 0, dark: dark }];
  };

  // ------------------------------------------------------------ Acuarelado
  TECH.acuarela = function (c, p) {
    var n = c.n, U = c.U, x, y, i;
    var A = roughen(c, c.A0, 0.3, 'granulado', 0.35);
    var r = wetBleed(c, A, { spread: 0.15 + 0.6 * p.water, pool: p.pool, halo: 0.55, fam: 'acuarela', fineFam: 'granulado' });
    var Aw = r.A;
    var E = innerEdge(c, Aw, U * 0.035 + 1, 2.6);
    var tw = c.samp('acuarela', 'b', 1.6), twd = c.samp('acuarela', 'd', 1.2);
    var tg = c.samp('granulado', 'b', 0.7), tgd = c.samp('granulado', 'd', 0.5);
    var a = new Float32Array(n), dark = new Float32Array(n);
    for (y = 0; y < c.h; y++) for (x = 0; x < c.w; x++) {
      i = y * c.w + x;
      var v = Aw[i];
      if (v <= 0) continue;
      var wv = tw(x, y);
      var dens = 1 - p.wash * 0.62 * (1 - wv);                               // manchas de aguada
      dens *= 1 - p.granul * 0.45 * smooth(0.45, 0.95, tgd(x, y));           // el grano deja papel
      var settle = p.granul * 0.35 * smooth(0.72, 0.97, tg(x, y));          // el pigmento se asienta en el grano
      var bd = twd(x, y);
      var bloomIn = smooth(0.6, 0.9, bd) * (1 - smooth(0.9, 0.96, bd));
      var bloomLine = smooth(0.9, 0.95, bd) * (1 - smooth(0.96, 0.995, bd));
      dens *= 1 - p.blooms * 0.45 * bloomIn;
      var pe = p.pool * E[i];
      dens = Math.min(1, dens + pe * 0.7 + bloomLine * p.blooms * 0.5 + settle * 0.5);
      a[i] = v * clamp01(dens) * (1 - p.transp * 0.5);
      dark[i] = pe * 0.55 + r.pool[i] * 0.6 + settle * 0.5 + bloomLine * p.blooms * 0.4;
    }
    return [{ a: a, ink: 0, dark: dark }];
  };

  // ================================================================== composición
  // Mezcla sustractiva exacta sobre papel blanco: P = Π(1 - a_i·(1 - c_i)).
  // La capa resultante (color L, alfa A) da ese mismo resultado en modo Normal sobre
  // blanco y también en Multiplicar sobre cualquier fondo.
  function compose(c, layers, inks, opacity) {
    var n = c.n, rgba = new Uint8Array(n * 4), op = opacity == null ? 1 : opacity;
    var cols = inks.map(function (k) { return [k[0] / 255, k[1] / 255, k[2] / 255]; });
    for (var i = 0; i < n; i++) {
      var Pr = 1, Pg = 1, Pb = 1, Q = 1, any = false;
      for (var l = 0; l < layers.length; l++) {
        var L = layers[l], a = L.a[i] * op;
        if (a <= 0.0008) continue;
        if (a > 1) a = 1;
        any = true;
        var col = cols[L.ink] || cols[0], r = col[0], g = col[1], b = col[2];
        if (L.dark) {
          var d = L.dark[i];
          if (d > 0) { var gm = 1 + Math.min(1.5, d) * 1.4; r = Math.pow(r, gm); g = Math.pow(g, gm); b = Math.pow(b, gm); }
        }
        Pr *= 1 - a * (1 - r); Pg *= 1 - a * (1 - g); Pb *= 1 - a * (1 - b); Q *= 1 - a;
      }
      if (!any) continue;
      var A = 1 - Q, o = i * 4;
      if (A < 0.002) continue;
      rgba[o] = Math.round(clamp01((Pr - Q) / A) * 255);
      rgba[o + 1] = Math.round(clamp01((Pg - Q) / A) * 255);
      rgba[o + 2] = Math.round(clamp01((Pb - Q) / A) * 255);
      rgba[o + 3] = Math.round(A * 255);
    }
    return rgba;
  }

  /**
   * render(input, tech, p, texs, inks)
   * input: de prepare(); p: parámetros de la técnica + comunes (scale, texScale, opacity, seed)
   * texs: { familia: textura preparada }, inks: [[r,g,b], ...]
   */
  function render(input, tech, p, texs, inks) {
    var fn = TECH[tech];
    if (!fn) throw new Error('Técnica desconocida: ' + tech);
    var c = makeCtx(input, p, texs);
    return compose(c, fn(c, p), inks, p.opacity);
  }

  // ================================================================== entrada
  function hexToRgb(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var v = parseInt(h, 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  function averageInk(alpha, rgb, n) {
    var r = 0, g = 0, b = 0, t = 0;
    for (var i = 0; i < n; i++) {
      var a = alpha[i]; if (a < 0.5) continue;
      r += rgb[i * 3] * a; g += rgb[i * 3 + 1] * a; b += rgb[i * 3 + 2] * a; t += a;
    }
    return t ? [Math.round(r / t), Math.round(g / t), Math.round(b / t)] : [0, 0, 0];
  }
  function buildInput(px, w, h, components, pad) {
    var W = w + pad.l + pad.r, H = h + pad.t + pad.b, n = W * H;
    var alpha = new Float32Array(n), rgb = new Uint8Array(n * 3);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var s = (y * w + x) * components, d = (y + pad.t) * W + (x + pad.l);
      alpha[d] = components === 4 ? px[s + 3] / 255 : 1;
      rgb[d * 3] = px[s]; rgb[d * 3 + 1] = px[s + 1]; rgb[d * 3 + 2] = px[s + 2];
    }
    return { w: W, h: H, alpha: alpha, rgb: rgb };
  }
  function prepare(px, w, h, comps, tech, p, padFn, measured) {
    var m = measured;
    if (!m) {
      var base = buildInput(px, w, h, comps, { l: 0, t: 0, r: 0, b: 0 });
      m = measure(base.alpha, w, h);
      if (!m) return null;
    }
    var mg = margin(tech, p, m.unit);
    var pd = padFn ? padFn(mg) : { l: mg, t: mg, r: mg, b: mg };
    var inp = buildInput(px, w, h, comps, pd);
    inp.unit = m.unit;
    inp.origin = { x: pd.l + m.box.left, y: pd.t + m.box.top };
    inp.ink = averageInk(inp.alpha, inp.rgb, inp.w * inp.h);
    inp.pad = pd;
    return inp;
  }

  var api = {
    VERSION: '0.3.0', TECH_IDS: Object.keys(TECH),
    prepareTexture: prepareTexture, measure: measure, margin: margin, prepare: prepare,
    render: render, buildInput: buildInput, averageInk: averageInk, hexToRgb: hexToRgb
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AFXEngine = api;
})(this);
