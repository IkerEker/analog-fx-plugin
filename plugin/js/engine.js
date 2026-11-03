/*
 * Analog FX — motor de efectos (v0.2).
 * JavaScript puro, sin dependencias: funciona en Photoshop (UXP) y en Node (para pruebas).
 *
 * Trabaja sobre la máscara (alfa) de la capa y, en paralelo, sobre campos de color
 * (tono / saturación / luminosidad por píxel), de modo que la tinta no solo pierde
 * opacidad: también cambia de tono donde se acumula, se diluye o se imprime mal.
 *
 * Todas las medidas se expresan en "unidades" (U) relativas al tamaño de la letra,
 * así el resultado es el mismo en la vista previa (reducida) y a tamaño real.
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
  // Hash entero -> 0..1
  function hash(n) {
    n = (n | 0) ^ 0x5bd1e995;
    n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
    n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
    n ^= n >>> 15;
    return (n >>> 0) / 4294967296;
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

  // ------------------------------------------------------------------ color (HSL)
  function rgb2hsl(r, g, b, out) {
    r /= 255; g /= 255; b /= 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0, d = mx - mn;
    if (d > 1e-6) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    out[0] = h; out[1] = s; out[2] = l;
  }
  function hue2(p, q, t) {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
  function hsl2rgb(h, s, l, out, o) {
    h = h - Math.floor(h);
    var r, g, b;
    if (s <= 1e-6) { r = g = b = l; } else {
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
      r = hue2(p, q, h + 1 / 3); g = hue2(p, q, h); b = hue2(p, q, h - 1 / 3);
    }
    out[o] = Math.round(clamp01(r) * 255); out[o + 1] = Math.round(clamp01(g) * 255); out[o + 2] = Math.round(clamp01(b) * 255);
  }
  // ajustes relativos -1..1
  function adj(v, d) { return d >= 0 ? v + (1 - v) * d : v * (1 + d); }

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
    if (p.bleed.on) m += U * 0.55 * p.bleed.amount;
    if (p.drips.on) {
      if (p.drips.amount > 0) ext = Math.max(ext, U * 3.6 * (0.04 + 0.75 * p.drips.length));
      if (p.drips.drops > 0) ext = Math.max(ext, U * (0.2 + 1.45 * p.drips.length));
    }
    if (p.splat.on && (p.splat.amount > 0 || p.splat.drops > 0)) ext = Math.max(ext, U * 2.2 * (0.08 + 0.45 * p.splat.spread));
    if (p.print.on && p.print.ghost > 0) m += U * 0.09 * p.print.ghostOff + 1;
    if (p.print.on && p.print.shift > 0) m += U * 0.05 * p.print.shift;
    return Math.ceil(Math.min(m + ext, U * 3) + 3);
  }

  // ------------------------------------------------------------------ gotas discretas
  // Pinta gotas verticales con raíz ensanchada y bulbo final (pintura que chorrea)
  function paintDrops(A, w, h, U, amount, length, R, noise, wetW) {
    var stepX = Math.max(1, Math.round(U * 0.012)), placed = [], maxDrops = 220;
    for (var x = 1; x < w - 1 && placed.length < maxDrops; x += stepX) {
      for (var y = 1; y < h - 2; y++) {
        var i = y * w + x;
        if (A[i] < 0.5 || A[i + w] >= 0.5) continue;
        if (R() > amount * 0.09) continue;
        var wd = U * (0.010 + 0.026 * Math.pow(R(), 1.4));
        var ok = true;
        for (var k = 0; k < placed.length; k++) {
          var q = placed[k];
          if (Math.abs(q.x - x) < (q.wd + wd) * 2.6 && Math.abs(q.y - y) < U * 0.15) { ok = false; break; }
        }
        if (!ok) continue;
        var L = U * (0.08 + 1.35 * length) * (0.2 + 0.8 * Math.pow(R(), 1.6));
        placed.push({ x: x, y: y, wd: wd, L: L, id: placed.length });
      }
    }
    for (var d = 0; d < placed.length; d++) {
      var P = placed[d], cx = P.x, y0 = P.y, Ld = P.L, wdd = P.wd, ex = cx;
      for (var t = 0; t <= Ld; t++) {
        var yy = Math.round(y0 + t); if (yy >= h) break;
        var tt = t / Ld;
        var root = tt < 0.18 ? (0.18 - tt) / 0.18 : 0;
        var hw = wdd * (1 - 0.35 * tt) + wdd * 1.6 * root * root;
        ex = cx + (noise(t / U * 5 + P.id * 3.1, P.id * 1.7) - 0.5) * wdd * 1.2;
        var xa = Math.max(0, Math.floor(ex - hw - 1)), xb = Math.min(w - 1, Math.ceil(ex + hw + 1));
        for (var xx = xa; xx <= xb; xx++) {
          var cov = clamp01(hw + 0.5 - Math.abs(xx - ex));
          var j = yy * w + xx;
          if (cov > A[j]) A[j] = cov;
          if (wetW && cov > 0) wetW[j] = Math.max(wetW[j], cov * 0.35);
        }
      }
      // bulbo
      var rb = wdd * (1.1 + 0.5 * R()), cy = y0 + Ld;
      var ya = Math.max(0, Math.floor(cy - rb - 1)), yb = Math.min(h - 1, Math.ceil(cy + rb + 1));
      for (var by = ya; by <= yb; by++) {
        for (var bx = Math.max(0, Math.floor(ex - rb - 1)); bx <= Math.min(w - 1, Math.ceil(ex + rb + 1)); bx++) {
          var dd = Math.sqrt((bx - ex) * (bx - ex) + (by - cy) * (by - cy));
          var cv = clamp01(rb + 0.5 - dd);
          var jj = by * w + bx;
          if (cv > A[jj]) A[jj] = cv;
          if (wetW && cv > 0) wetW[jj] = Math.max(wetW[jj], cv * 0.5);
        }
      }
    }
  }

  // Gotas redondas de salpicadura con satélites
  function paintDroplets(A, w, h, U, near, amount, size, spread, R, noise, ox, oy, bw) {
    var count = Math.round(amount * 34 * Math.max(1, bw / U)), tries = count * 40, n = 0;
    for (var t = 0; t < tries && n < count; t++) {
      var x = R() * w, y = R() * h, i = (y | 0) * w + (x | 0);
      var nv = near[i];
      if (nv < 0.01 || nv > 0.7 || A[i] > 0.5) continue;
      var cl = noise.fbm((x - ox) / U * 0.7 + 70, (y - oy) / U * 0.7, 2);
      if (R() > smooth(0.35, 0.7, cl) * Math.min(1, nv * 4)) continue;
      n++;
      var r = U * 0.005 * (1 + 5 * size) * (0.3 + 4 * Math.pow(R(), 3));
      disk(A, w, h, x, y, r, 0.8 + 0.2 * R(), noise, t);
      var sat = Math.floor(R() * 4 * spread);
      for (var s = 0; s < sat; s++) {
        var ang = R() * 6.283, dist = r * (2 + 4 * R());
        disk(A, w, h, x + Math.cos(ang) * dist, y + Math.sin(ang) * dist, r * (0.15 + 0.35 * R()), 0.9, noise, t + s + 1);
      }
    }
  }
  function disk(A, w, h, cx, cy, r, op, noise, id) {
    if (r < 0.35) r = 0.35;
    var ya = Math.max(0, Math.floor(cy - r * 1.3 - 1)), yb = Math.min(h - 1, Math.ceil(cy + r * 1.3 + 1));
    var xa = Math.max(0, Math.floor(cx - r * 1.3 - 1)), xb = Math.min(w - 1, Math.ceil(cx + r * 1.3 + 1));
    for (var y = ya; y <= yb; y++) for (var x = xa; x <= xb; x++) {
      var dx = x - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy);
      var ang = Math.atan2(dy, dx);
      var rr = r * (0.85 + 0.3 * noise(Math.cos(ang) * 1.5 + id * 7.7, Math.sin(ang) * 1.5 + id * 3.3));
      var cov = clamp01(rr + 0.5 - d) * op;
      var i = y * w + x;
      if (cov > A[i]) A[i] = cov;
    }
  }

  // ------------------------------------------------------------------ render
  /**
   * input: { w, h, alpha: Float32Array(0..1), rgb: Uint8Array|null (w*h*3),
   *          unit, origin: {x, y}, ink: [r,g,b] }
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

    // campos de color por píxel
    var wetW = null;   // peso de "zona húmeda" (halo + borde)  -> desplaza tono/sat/lum del borde
    var pool = null;   // acumulación de pigmento en el frente húmedo -> más oscuro y opaco
    var dark = null;   // líneas oscuras de impresión
    function needWet() { if (!wetW) wetW = new Float32Array(n); return wetW; }
    function needPool() { if (!pool) pool = new Float32Array(n); return pool; }
    function needDark() { if (!dark) dark = new Float32Array(n); return dark; }

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

    // 2 · Tinta corrida: difuminado + borde húmedo con pigmento atrapado ----
    if (p.bleed.on && p.bleed.amount > 0) {
      var bA = p.bleed.amount, dir = p.bleed.dir, r = U * 0.16 * bA;
      var wet = p.bleed.wet, poolAmt = p.bleed.pool, haloOp = p.bleed.halo;
      // el agua avanza más por unas fibras que por otras: el desenfoque se modula con la textura
      var rxB = r * Math.min(1, 1 - dir), ryB = r * Math.min(1, 1 + dir);
      var B = blur(A, w, h, rxB, ryB);
      var B2 = wet > 0 ? blur(A, w, h, rxB * 0.4, ryB * 0.4) : null;
      var tb = sampler('b', 0.8), tf = sampler('b', 0.22), tf2 = sampler('d', 0.08), tbl = sampler('b', 0.35);
      var gfront = grid(function (u, v) { return noise.fbm(u * 1.4 + 300, v * 1.4 - 120, 3); });
      var greach = grid(function (u, v) { return noise.fbm(u * 0.8 - 77, v * 0.8 + 31, 2); });
      var gpool = grid(function (u, v) { return noise.fbm(u * 3.0 + 11, v * 3.0 + 400, 2); });
      var out = new Float32Array(n), WW = wet > 0 ? needWet() : null, PP = wet > 0 && poolAmt > 0 ? needPool() : null;
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        var core = A[i], bv = B[i];
        if (bv < 1e-4 && core <= 0) continue;
        // a) difuminado suave (versión 0.1)
        var kk = clamp01(bA * 1.3 * (0.15 + 0.85 * smooth(0.25, 0.85, tb(x, y))));
        var soft = Math.max(core + (bv - core) * kk, core * (1 - 0.6 * kk), bv * kk * 0.9);
        if (wet <= 0) { out[i] = soft; continue; }
        // b) borde húmedo: frente de agua definido, fibroso, con anillo de pigmento
        // el alcance del agua varía mucho: en unas zonas apenas sale, en otras se expande
        var reachM = smooth(0.3, 0.75, greach(x, y));
        var bw2 = B2[i] + (bv - B2[i]) * reachM;
        var gf = smooth(0.32, 0.68, gfront(x, y));
        var th = 0.04 + 0.5 * gf * gf;                       // dónde se detuvo el agua
        var fib = (tf(x, y) - 0.5) * 0.08 + (tf2(x, y) - 0.5) * 0.015;   // borde ondulado + fibra fina
        var front = smooth(th - 0.014, th + 0.014, bw2 + fib);
        var inner = smooth(th + 0.005, th + 0.12 + 0.14 * (1 - poolAmt), bw2 + fib);
        var ring = front * (1 - inner) * smooth(0.25, 0.65, gpool(x, y));   // anillo discontinuo
        var dilute = haloOp * (0.55 + 0.45 * smooth(0.0, 0.9, bw2)) * (0.55 + 0.45 * tbl(x, y));
        var halo = front * dilute;
        var wA2 = Math.max(core, halo);
        wA2 = wA2 + (1 - wA2) * ring * poolAmt * 0.55;       // el pigmento se queda atrapado en el borde
        out[i] = soft + (wA2 - soft) * wet;
        var outside = clamp01(front - core) * (1 - ring * 0.8);
        WW[i] = Math.max(WW[i], wet * clamp01(outside));
        if (PP) PP[i] = Math.max(PP[i], wet * ring * poolAmt);
      }
      A = out;
    }

    // 3 · Goteo: arrastre vertical + gotas con bulbo ------------------------
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
        var ddn = colDecDown[x], du = colDecUp[x], prev = 0;
        if (ddn > 0) for (y = 0; y < h; y++) { i = y * w + x; prev = Math.max(A[i], prev * ddn); if (prev > Dd[i]) Dd[i] = prev; }
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
    if (p.drips.on && p.drips.drops > 0) {
      paintDrops(A, w, h, U, p.drips.drops, Math.max(0.05, p.drips.length), R, noise, wetW);
    }

    // 4 · Salpicaduras: manchas de textura + gotas redondas -----------------
    var N = null;
    function nearField() {
      if (!N) N = blur(shape, w, h, U * (0.08 + 0.45 * p.splat.spread), U * (0.08 + 0.45 * p.splat.spread));
      return N;
    }
    if (p.splat.on && p.splat.amount > 0) {
      var sa = p.splat.amount, sz = p.splat.size;
      nearField();
      var tsp = sampler('b', 0.12 + 0.5 * sz), tsp2 = sampler('d', 0.08 + 0.2 * sz);
      var gcl = grid(function (u, v) { return noise.fbm(u * 0.7 + 70, v * 0.7, 2); });
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        var near = N[i];
        if (near < 0.004 || A[i] > 0.99) continue;
        var cl = gcl(x, y);
        var pr = clamp01(Math.pow(Math.min(1, near * 2.2), 0.8) * sa * (0.05 + 1.9 * smooth(0.45, 0.75, cl)));
        if (pr < 0.004) continue;
        var th2 = 1 - pr * 0.4;
        var spot = smooth(th2, th2 + 0.03, tsp(x, y)) * (0.75 + 0.25 * tsp2(x, y));
        var fine = smooth(1 - pr * 0.03, 1 - pr * 0.03 + 0.006, tsp2(x, y)) * 0.8;
        var sv = Math.max(spot, fine);
        if (sv > A[i]) A[i] = sv;
      }
    }
    if (p.splat.on && p.splat.drops > 0) {
      paintDroplets(A, w, h, U, nearField(), p.splat.drops, p.splat.size, p.splat.spread, R, noise, ox, oy, input.bw || U * 3);
    }

    // 5 · Desgaste / erosión ------------------------------------------------
    if (p.erode.on && p.erode.amount > 0) {
      var ea = p.erode.amount, dist = p.erode.distrib, soft2 = 0.015 + 0.22 * (1 - p.erode.contrast);
      var te = sampler('b', 1);
      var gef = grid(function (u, v) { return noise.fbm(u * 2.2 + 10, v * 2.2 - 5, 3); });
      var gec = grid(function (u, v) { return noise.fbm(u * 0.45 - 30, v * 0.45 + 60, 2); });
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        if (A[i] <= 0) continue;
        var field = te(x, y) * 0.72 + gef(x, y) * 0.28;
        var tE = ea * (1 - dist + dist * 2.1 * smooth(0.3, 0.8, gec(x, y)));
        tE = Math.min(tE, 1.05);
        A[i] *= smooth(tE - soft2, tE + soft2, field);
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

    // 8 · Dureza (impresión) ------------------------------------------------
    var hard = p.out.hard;
    if (hard > 0) {
      var wid = 0.5 * (1 - hard) + 0.07;
      for (i = 0; i < n; i++) if (A[i] > 0) A[i] = smooth(0.5 - wid, 0.5 + wid, A[i]);
    }

    // 9 · Impresión: bandas, rayas de tóner, trama de semitono --------------
    var PR = p.print;
    if (PR.on && PR.shift > 0) {
      // franjas desplazadas lateralmente (arrastre del papel / cabezal)
      var angS = (PR.dir + 1) * 0.25 * Math.PI, csS = Math.cos(angS), snS = Math.sin(angS);
      var spS = U * (0.025 + 0.28 * PR.spacing * PR.spacing) * 2.3, Ash = new Float32Array(n), soS = p.seed * 977;
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        var qS = ((x - ox) * snS + (y - oy) * csS) / spS, iS = Math.floor(qS);
        var hS = hash(iS + soS), off = hS > 0.55 ? (hash(iS * 3 + 1 + soS) - 0.5) * U * 0.09 * PR.shift : 0;
        var sx2 = x - off * csS, sy2 = y + off * snS, xs = Math.round(sx2), ys = Math.round(sy2);
        Ash[y * w + x] = (xs >= 0 && ys >= 0 && xs < w && ys < h) ? A[ys * w + xs] : 0;
      }
      A = Ash;
    }
    if (PR.on && (PR.bands > 0 || PR.streaks > 0 || PR.halftone > 0)) {
      var ang9 = (PR.dir + 1) * 0.25 * Math.PI;              // -1 → líneas horizontales, +1 → verticales
      var cs = Math.cos(ang9), sn = Math.sin(ang9);
      var spacing = U * (0.025 + 0.28 * PR.spacing * PR.spacing);
      var bw9 = 0.08 + 0.45 * PR.width;
      var stW = Math.max(1.1, U * 0.0045);
      var DK = (PR.bands > 0 || PR.streaks > 0) ? needDark() : null;
      var nearP = PR.streaks > 0 ? blur(shape, w, h, U * 0.12, U * 0.12) : null;
      var cell = Math.max(2.2, U * (0.012 + 0.07 * PR.dot)), c45 = Math.SQRT1_2 / cell, TWO_PI = 2 * Math.PI;
      var seedOff = p.seed * 131;
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        var a9 = A[i];
        var q = ((x - ox) * sn + (y - oy) * cs);              // a través de las líneas
        var al = ((x - ox) * cs - (y - oy) * sn);             // a lo largo
        if (PR.bands > 0 && a9 > 0) {
          var qq = q / spacing + (noise(al * invU * 0.8, q / spacing * 0.15 + 50) - 0.5) * 0.35;
          var idx = Math.floor(qq), fr = qq - idx;
          var hr = hash(idx + seedOff), hr2 = hash(idx * 7 + 3 + seedOff);
          var str = PR.bands * Math.pow(hr, 1.6);
          var lw = bw9 * (0.4 + 0.9 * hr2);
          var line = 1 - smooth(lw * 0.55, lw, Math.abs(fr - 0.5) * 2);
          var brk = smooth(0.25, 0.65, noise(al * invU * 2.2 + idx * 13.1, idx * 0.37));   // líneas cortadas
          var lv = line * str * (0.35 + 0.65 * brk);
          if (hr2 < 0.62) a9 *= 1 - lv * 0.92;                 // falta de tinta
          else { DK[i] = Math.max(DK[i], lv); a9 = a9 + (1 - a9) * lv * 0.5 * smooth(0, 0.3, a9); }
          // densidad ondulante (banding ancho del rodillo)
          a9 *= 1 - PR.bands * 0.18 * (0.5 + 0.5 * Math.sin(q / (spacing * 3.7) * TWO_PI + hr));
        }
        if (PR.streaks > 0) {
          var sIdx = Math.floor(al / stW);
          var sh = hash(sIdx * 3 + 11 + seedOff);
          if (sh > 1 - PR.streaks * 0.07) {
            var sAlong = smooth(0.3, 0.7, noise(q * invU * 0.6 + sIdx * 0.71, sIdx * 0.13 + 9));
            var sStr = sAlong * (0.5 + 0.5 * hash(sIdx * 5 + 1 + seedOff));
            if (hash(sIdx + 77 + seedOff) < 0.5) { a9 *= 1 - sStr * 0.9; }
            else {
              DK[i] = Math.max(DK[i], sStr);
              var npv = nearP[i];
              a9 = a9 + (1 - a9) * sStr * (a9 > 0.02 ? 0.6 : 0.12 * smooth(0.05, 0.4, npv));
            }
          }
        }
        if (PR.halftone > 0 && a9 > 0) {
          var hu = (x + y) * c45, hv = (x - y) * c45;
          var pat = 0.5 + 0.25 * (Math.cos(hu * TWO_PI) + Math.cos(hv * TWO_PI));
          var ht = smooth(pat - 0.09, pat + 0.09, a9 * 0.98);
          a9 = a9 + (ht - a9) * PR.halftone;
        }
        A[i] = a9;
      }
    }

    // 10 · Acumulación de pigmento en bordes (color) -------------------------
    var CO = p.color, edgeIn = null;
    if (CO.on && CO.edge > 0) {
      var rE = Math.max(1, U * 0.03);
      var Ab = blur(A, w, h, rE, rE);
      edgeIn = new Float32Array(n);
      for (i = 0; i < n; i++) {
        if (A[i] <= 0) continue;
        var e = clamp01((A[i] - Ab[i]) * 3.2);
        edgeIn[i] = e;
        A[i] = A[i] + (1 - A[i]) * e * CO.edge * 0.75;
      }
    }

    // 11 · Doble impresión (fantasma desplazado) -----------------------------
    var G = null;
    if (PR.on && PR.ghost > 0) {
      var gAng = Math.PI * 0.25 + (R() - 0.5) * 1.2, gD = U * 0.09 * PR.ghostOff + 0.8;
      var gx = Math.cos(gAng) * gD, gy = Math.sin(gAng) * gD;
      G = new Float32Array(n);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        var sxg = x - gx, syg = y - gy, xg = Math.floor(sxg), yg = Math.floor(syg);
        if (xg < 0 || yg < 0 || xg + 1 >= w || yg + 1 >= h) continue;
        var fxg = sxg - xg, fyg = syg - yg, k0 = yg * w + xg;
        var top = A[k0] + (A[k0 + 1] - A[k0]) * fxg, bot = A[k0 + w] + (A[k0 + w + 1] - A[k0 + w]) * fxg;
        G[y * w + x] = (top + (bot - top) * fyg) * PR.ghost;
      }
    }

    // 12 · Salida: color por píxel (tono / saturación / luminosidad) ---------
    var op = p.out.opacity;
    var rgba = new Uint8Array(n * 4);
    var ink = input.ink || [0, 0, 0], custom = p.out.color && p.out.color !== 'original' ? hexToRgb(p.out.color) : null;
    var rgb = input.rgb;
    var colorOn = CO.on;
    var gH = colorOn ? CO.hue * 0.5 : 0, gS = colorOn ? CO.sat : 0, gL = colorOn ? CO.light : 0;
    var vH = colorOn ? CO.hueVar : 0, vS = colorOn ? CO.satVar : 0, vL = colorOn ? CO.lightVar : 0;
    var sH = vH > 0 ? sampler('b', 1.6) : null, sS = vS > 0 ? sampler('b', 1.2) : null;
    var sL = vL > 0 ? sampler('b', 0.7) : null, sL2 = vL > 0 ? sampler('d', 0.2) : null;
    var bH = p.bleed.on ? p.bleed.hue * 0.5 : 0, bS = p.bleed.on ? p.bleed.sat : 0, bL = p.bleed.on ? p.bleed.light : 0;
    var ghH = PR.on ? PR.ghostHue * 0.5 : 0;
    var hsl = [0, 0, 0], lastKey = -1, baseH = 0, baseS = 0, baseL = 0, neutral = false;
    var tmp = [0, 0, 0], gr2 = [0, 0, 0];
    var anyColor = colorOn || wetW || pool || dark || G;
    for (i = 0; i < n; i++) {
      var a2 = A[i], ga = G ? G[i] : 0;
      if (a2 <= 0.0005 && ga <= 0.0005) continue;
      var o = i * 4, cr, cg, cb;
      if (custom) { cr = custom[0]; cg = custom[1]; cb = custom[2]; }
      else if (rgb) {
        var ci = cidx[i];
        if (ci >= 0 && A0[ci] > 0.35) { cr = rgb[ci * 3]; cg = rgb[ci * 3 + 1]; cb = rgb[ci * 3 + 2]; }
        else { cr = ink[0]; cg = ink[1]; cb = ink[2]; }
      } else { cr = ink[0]; cg = ink[1]; cb = ink[2]; }
      if (!anyColor) {
        rgba[o] = cr; rgba[o + 1] = cg; rgba[o + 2] = cb;
        rgba[o + 3] = Math.round(clamp01(a2) * op * 255);
        continue;
      }
      var key = (cr << 16) | (cg << 8) | cb;
      if (key !== lastKey) { rgb2hsl(cr, cg, cb, hsl); baseH = hsl[0]; baseS = hsl[1]; baseL = hsl[2]; neutral = baseS < 0.04; lastKey = key; }
      y = (i / w) | 0; x = i - y * w;
      var wv = wetW ? wetW[i] : 0, pv = pool ? pool[i] : 0, dv = dark ? dark[i] : 0, ev = edgeIn ? edgeIn[i] : 0;
      // en tinta real "más clara" = menos pigmento = más transparente: la parte positiva
      // de la luminosidad del borde y de la variación se convierte sobre todo en opacidad.
      var wl = wv * bL, dil = 0;
      var dH = gH + wv * bH, dS = gS + wv * bS, dL = gL;
      if (wl > 0) { dL += wl * 0.15; dil += wl * 0.75; } else dL += wl;
      if (sH) dH += vH * (sH(x, y) - 0.5) * 0.22;
      if (sS) dS += vS * (sS(x, y) - 0.5) * 1.3;
      if (sL) {
        var lvv = vL * ((sL(x, y) - 0.5) * 0.45 + (sL2(x, y) - 0.5) * 0.25);
        if (lvv > 0) { dL += lvv * 0.35; dil += lvv * 0.9; } else dL += lvv;
      }
      if (dil > 0) a2 *= 1 - Math.min(0.92, dil);
      if (ev > 0) { dL -= ev * CO.edge * 0.28; dS += ev * CO.edge * 0.2; }
      dL -= pv * 0.42; dS += pv * 0.25;                      // pigmento atrapado: más denso y saturado
      dL -= dv * 0.45;                                        // líneas oscuras de impresión
      dS = Math.max(-1, Math.min(1, dS)); dL = Math.max(-1, Math.min(1, dL));
      var hh = (neutral ? 0.08 : baseH) + dH;                 // las tintas neutras toman un matiz cálido al saturar
      var ss = neutral ? Math.max(0, dS) * 0.35 + baseS : adj(baseS, dS);
      var ll = adj(baseL, dL);
      hsl2rgb(hh, clamp01(ss), clamp01(ll), tmp, 0);
      if (ga > 0.0005) {
        // fantasma debajo de la tinta principal, con su propio tono
                if (neutral) hsl2rgb(0.08 + ghH, ghH !== 0 ? 0.78 : 0, ghH !== 0 ? 0.55 : clamp01(adj(baseL, 0.2)), gr2, 0);
        else hsl2rgb(baseH + ghH, baseS, clamp01(adj(baseL, 0.12)), gr2, 0);
        var aT = a2 + ga * (1 - a2);
        var kM = a2 / aT, kG = ga * (1 - a2) / aT;
        rgba[o] = Math.round(tmp[0] * kM + gr2[0] * kG);
        rgba[o + 1] = Math.round(tmp[1] * kM + gr2[1] * kG);
        rgba[o + 2] = Math.round(tmp[2] * kM + gr2[2] * kG);
        rgba[o + 3] = Math.round(clamp01(aT) * op * 255);
      } else {
        rgba[o] = tmp[0]; rgba[o + 1] = tmp[1]; rgba[o + 2] = tmp[2];
        rgba[o + 3] = Math.round(clamp01(a2) * op * 255);
      }
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

  // Prepara todo lo necesario para render() a partir de los píxeles de la capa
  function prepare(px, w, h, comps, p, pad, measured) {
    var m = measured;
    if (!m) {
      var base = buildInput(px, w, h, comps, { l: 0, t: 0, r: 0, b: 0 });
      m = measure(base.alpha, w, h);
      if (!m) return null;
    }
    var mg = margin(p, m.unit);
    var pd = pad ? pad(mg) : { l: mg, t: mg, r: mg, b: mg };
    var inp = buildInput(px, w, h, comps, pd);
    inp.unit = m.unit;
    inp.bw = m.box.right - m.box.left;
    inp.origin = { x: pd.l + m.box.left, y: pd.t + m.box.top };
    inp.ink = averageInk(inp.alpha, inp.rgb, inp.w * inp.h);
    inp.pad = pd;
    return inp;
  }

  var DEFAULTS = {
    texture: 'grises_8', texScale: 1, stretch: 0, effectScale: 1, seed: 1,
    warp: { on: true, amount: 0.25, rough: 0.4 },
    erode: { on: true, amount: 0.25, distrib: 0.5, contrast: 0.6 },
    cracks: { on: false, amount: 0.3 },
    bleed: { on: false, amount: 0.3, dir: 0, wet: 0.6, pool: 0.5, halo: 0.7, hue: 0, sat: 0, light: 0.15 },
    drips: { on: false, length: 0.35, amount: 0.5, up: 0, drops: 0 },
    splat: { on: false, amount: 0.3, spread: 0.4, size: 0.5, drops: 0 },
    ink: { on: true, pressure: 0.3, grain: 0.3 },
    print: { on: false, bands: 0.45, spacing: 0.35, width: 0.3, dir: -1, shift: 0, streaks: 0, halftone: 0, dot: 0.35, ghost: 0, ghostOff: 0.35, ghostHue: 0 },
    color: { on: true, hue: 0, sat: 0, light: 0, hueVar: 0.15, satVar: 0.2, lightVar: 0.3, edge: 0.3 },
    out: { hard: 0.2, opacity: 1, color: 'original', blend: 'auto' }
  };

  var api = {
    VERSION: '0.2.0',
    DEFAULTS: DEFAULTS, prepareTexture: prepareTexture, measure: measure, margin: margin,
    render: render, buildInput: buildInput, averageInk: averageInk, hexToRgb: hexToRgb, prepare: prepare
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AFXEngine = api;
})(this);
