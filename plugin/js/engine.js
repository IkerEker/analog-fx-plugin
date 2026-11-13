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

  function sampleBil(F, w, h, x, y) {
    var xf = Math.floor(x), yf = Math.floor(y);
    if (xf < 0 || yf < 0 || xf + 1 >= w || yf + 1 >= h) return 0;
    var fx = x - xf, fy = y - yf, k = yf * w + xf;
    var t = F[k] + (F[k + 1] - F[k]) * fx, b = F[k + w] + (F[k + w + 1] - F[k + w]) * fx;
    return t + (b - t) * fy;
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

  // Muestreo estocástico sin repetición (al estilo Heitz-Neyret / Burley): el plano se divide en
  // celdas; cada celda lee la textura con un desplazamiento aleatorio y las 4 vecinas se mezclan
  // con pesos afilados, reescalando la varianza para no perder contraste.
  function makeStochastic(data, S, unit, tileUnits, angle, stretch, ox, oy, seedS) {
    var k = S / (unit * tileUnits);
    var sx = Math.pow(2, -stretch * 1.6), sy = 1 / sx;
    var c = Math.cos(angle), s = Math.sin(angle);
    var a = c * k * sx, b = -s * k * sx, d = s * k * sy, e = c * k * sy, m = S - 1, cell = S * 0.5, inv = 1 / cell;
    function tap(tx, ty) {
      var xf = Math.floor(tx), yf = Math.floor(ty), fx = tx - xf, fy = ty - yf;
      var x0 = xf & m, y0 = yf & m, x1 = (x0 + 1) & m, y1 = (y0 + 1) & m;
      var p = data[y0 * S + x0], q = data[y0 * S + x1], r = data[y1 * S + x0], t = data[y1 * S + x1];
      var top = p + (q - p) * fx, bot = r + (t - r) * fx;
      return top + (bot - top) * fy;
    }
    return function (x, y) {
      var u = x - ox, v = y - oy;
      var tx = a * u + b * v, ty = d * u + e * v;
      var gx = tx * inv - 0.5, gy = ty * inv - 0.5, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      var acc = 0, wsum2 = 0, wsum = 0;
      for (var j = 0; j < 2; j++) for (var i = 0; i < 2; i++) {
        var wgt = (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
        wgt = wgt * wgt * wgt;
        if (wgt < 1e-5) continue;
        var cx = ix + i, cy = iy + j, hh = hash(cx * 73856093 ^ cy * 19349663 ^ seedS);
        var hv = hash(cx * 83492791 ^ cy * 297121507 ^ (seedS + 7));
        acc += wgt * (tap(tx + hh * S, ty + hv * S) - 0.5); wsum += wgt; wsum2 += wgt * wgt;
      }
      return clamp01(0.5 + (acc / wsum) * (wsum / Math.sqrt(wsum2)) * 0.92);
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
    if (p.paper && p.paper.on) m += U * 0.03 * (p.paper.feather || 0);
    if (p.tintas && p.tintas.on) m += U * 0.07 * (p.tintas.misreg || 0) + 1;
    if (p.press && p.press.on) m += U * 0.02 * (p.press.halo || 0) + 1;
    if (p.wood && p.wood.on) ext = Math.max(ext, U * 0.3 * (p.wood.chips || 0));
    if (p.stone && p.stone.on) ext = Math.max(ext, U * 0.8 * (p.stone.veil || 0));
    if (p.drip && p.drip.on) ext = Math.max(ext, U * (0.12 + 2.1 * (p.drip.length || 0)));
    if (p.copy && p.copy.on) m += U * 0.25;
    if (p.stencil && p.stencil.on) m += U * 0.15 * (p.stencil.setoff || 0) + U * 0.02;
    if (p.aqua && p.aqua.on) m += U * 0.05;
    if (p.damp && p.damp.on) m += U * (0.1 + 0.35 * (p.damp.spread || 0));
    if (p.laser && p.laser.on) m += p.laser.mode === 'fuser' ? U * 0.8 : U * 0.3;
    if (p.tangle && p.tangle.on) m += U * 0.6 * (p.tangle.amount || 0);
    if (p.glitch && p.glitch.on) m += p.glitch.mode === 'drag' ? U * 1.4 : U * 0.5;
    if (p.soak && p.soak.on) m += p.soak.mode === 'water' ? U * (0.35 + 0.2 * (p.soak.amount || 0)) : p.soak.mode === 'resist' ? U * (1.0 + 1.3 * (p.soak.roots == null ? 0.7 : p.soak.roots)) : p.soak.mode === 'runs' ? U * 1.4 : U * 0.25;
    if (p.seep && p.seep.on) m += U * (0.02 + 0.15 * (p.seep.reach || 0));
    if (p.wick && p.wick.on) m += p.wick.mode === 'wet' ? U * (0.06 + 0.35 * (p.wick.reach || 0)) : p.wick.mode === 'smear' ? U * (0.1 + 0.9 * (p.wick.drag || 0)) : U * (0.03 + 0.16 * (p.wick.reach || 0)) + 6;
    if (p.engrave && p.engrave.on) m += U * 0.06 * ((p.engrave.shadow || 0) + (p.engrave.misreg || 0));
    if (p.engrave && p.engrave.on && p.engrave.mode === 'scribble') ext = Math.max(ext, U * (0.35 + 0.4 * (p.engrave.width == null ? 0.6 : p.engrave.width)) + U * 0.5 * (p.engrave.blocks || 0));
    return Math.ceil(Math.min(m + ext, U * 3) + 3);
  }


  // ------------------------------------------------------------------ distancia al borde
  // Distancia aproximada (chaflán 3-4, en px) desde cada píxel de la máscara al exterior.
  function distInside(A, w, h, thr, noBorder) {
    var n = w * h, D = new Float32Array(n), BIG = 1e9, x, y, i, EB = noBorder ? BIG : 1;
    for (i = 0; i < n; i++) D[i] = A[i] > thr ? BIG : 0;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x; if (D[i] === 0) continue;
      var v = D[i];
      if (x > 0) v = Math.min(v, D[i - 1] + 1); else v = Math.min(v, EB);
      if (y > 0) { v = Math.min(v, D[i - w] + 1); if (x > 0) v = Math.min(v, D[i - w - 1] + 1.4142); if (x < w - 1) v = Math.min(v, D[i - w + 1] + 1.4142); } else v = Math.min(v, EB);
      D[i] = v;
    }
    for (y = h - 1; y >= 0; y--) for (x = w - 1; x >= 0; x--) {
      i = y * w + x; if (D[i] === 0) continue;
      var u = D[i];
      if (x < w - 1) u = Math.min(u, D[i + 1] + 1); else u = Math.min(u, EB);
      if (y < h - 1) { u = Math.min(u, D[i + w] + 1); if (x < w - 1) u = Math.min(u, D[i + w + 1] + 1.4142); if (x > 0) u = Math.min(u, D[i + w - 1] + 1.4142); } else u = Math.min(u, EB);
      D[i] = u;
    }
    return D;
  }

  // ------------------------------------------------------------------ color y letra más cercanos
  // Para cada píxel, índice del píxel de tinta más cercano (propagación en dos pasadas).
  function nearestSeed(A, w, h) {
    var n = w * h, S = new Int32Array(n), x, y, i, BIG = 1e18;
    for (i = 0; i < n; i++) S[i] = A[i] > 0.5 ? i : -1;
    function d2(i0, s0) { if (s0 < 0) return BIG; var ax = i0 % w, ay = (i0 / w) | 0, bx = s0 % w, by = (s0 / w) | 0; return (ax - bx) * (ax - bx) + (ay - by) * (ay - by); }
    function tryN(i0, j) { var sj = S[j]; if (sj < 0) return; if (S[i0] < 0 || d2(i0, sj) < d2(i0, S[i0])) S[i0] = sj; }
    for (var pass = 0; pass < 2; pass++) {
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        if (x > 0) tryN(i, i - 1);
        if (y > 0) { tryN(i, i - w); if (x > 0) tryN(i, i - w - 1); if (x < w - 1) tryN(i, i - w + 1); }
      }
      for (y = h - 1; y >= 0; y--) for (x = w - 1; x >= 0; x--) {
        i = y * w + x;
        if (x < w - 1) tryN(i, i + 1);
        if (y < h - 1) { tryN(i, i + w); if (x < w - 1) tryN(i, i + w + 1); if (x > 0) tryN(i, i + w - 1); }
      }
    }
    return S;
  }
  // Etiqueta cada letra (componente conexa de tinta). Devuelve { lab, size, count }.
  function labelLetters(A, w, h) {
    var n = w * h, lab = new Int32Array(n), size = [0], stack = new Int32Array(n), id = 0;
    for (var s0 = 0; s0 < n; s0++) {
      if (A[s0] <= 0.5 || lab[s0]) continue;
      id++; var top = 0, cnt = 0; stack[top++] = s0; lab[s0] = id;
      while (top) {
        var c = stack[--top], cx = c % w, cy = (c / w) | 0; cnt++;
        if (cx > 0 && !lab[c - 1] && A[c - 1] > 0.5) { lab[c - 1] = id; stack[top++] = c - 1; }
        if (cx < w - 1 && !lab[c + 1] && A[c + 1] > 0.5) { lab[c + 1] = id; stack[top++] = c + 1; }
        if (cy > 0 && !lab[c - w] && A[c - w] > 0.5) { lab[c - w] = id; stack[top++] = c - w; }
        if (cy < h - 1 && !lab[c + w] && A[c + w] > 0.5) { lab[c + w] = id; stack[top++] = c + w; }
      }
      size.push(cnt);
    }
    return { lab: lab, size: size, count: id };
  }

  // ------------------------------------------------------------------ tinta que se extiende
  // No es una mancha superpuesta: es la tinta de la letra que avanza por el papel. Pegada al borde
  // tiene la MISMA intensidad que la letra y se desvanece con la distancia. El alcance varía por
  // zonas y por fibras (pelillos), y puede caer más hacia abajo.
  // reachAt(x, y, i) -> alcance en px (0 = no se extiende ahí); grainAt(x, y) -> 0..1
  function inkSpread(A, w, h, reachAt, grainAt, grainAmt, down) {
    var n = w * h, inv = new Float32Array(n), i, x, y;
    for (i = 0; i < n; i++) inv[i] = 1 - A[i];
    var D = distInside(inv, w, h, 0.5, true), O = new Float32Array(A);
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
      i = y * w + x;
      var d = D[i];
      if (d <= 0 || d > 1e8) continue;
      var r = reachAt(x, y, i);
      if (r <= 0.3) continue;
      if (down > 0) { var gy = (D[i + w] - D[i - w]) * 0.5; if (gy > 0) r *= 1 + down * gy; }
      if (d > r * 2.6) continue;
      var t = d / r, v = Math.exp(-Math.pow(t, 1.35));
      if (grainAt) v *= 1 - grainAmt * smooth(0.1, 1.2, t) * (1 - grainAt(x, y));
      if (v > O[i]) O[i] = v;
    }
    return O;
  }

  // ------------------------------------------------------------------ TINTA CORRIDA por capilaridad
  // La tinta no se difumina: avanza por las fibras de celulosa que tocan el borde de la letra
  // (capilaridad). Se dibuja una red de fibras a tamaño físico y se calcula la distancia
  // "por dentro del papel" desde la tinta: por una fibra cuesta poco avanzar, fuera de ella mucho.
  // Así salen pelillos finos de largo muy distinto, ramificados donde se cruzan fibras.
  function fiberNet(w, h, band, opt, R, zoneAt) {
    var n = w * h, F = new Float32Array(n), cnt = 0, i;
    for (i = 0; i < n; i++) if (band[i]) cnt++;
    var Lm = opt.len, N = Math.round(opt.cover * cnt / Lm), tries = N * 3;
    for (var f = 0; f < tries && N > 0; f++) {
      var x = R() * w, y = R() * h, i0 = (y | 0) * w + (x | 0);
      if (!band[i0]) continue;
      if (zoneAt && R() > zoneAt(x | 0, y | 0)) continue;
      N--;
      var L = Lm * (0.35 + 1.3 * Math.pow(R(), 1.4)), ang = R() * Math.PI, cur = (R() - 0.5) * 0.08;
      var cond = 0.45 + 0.55 * R(), thick = R() < opt.thick;
      if (opt.biasAng != null && R() < opt.bias) ang = opt.biasAng + (R() - 0.5) * 0.6;
      x -= Math.cos(ang) * L * 0.5; y -= Math.sin(ang) * L * 0.5;
      for (var s = 0; s < L; s += 0.5) {
        var xi = x | 0, yi = y | 0;
        if (xi >= 1 && yi >= 1 && xi < w - 1 && yi < h - 1) {
          var k = yi * w + xi, c = cond * (s < 2 || L - s < 2 ? 0.6 : 1);
          if (c > F[k]) F[k] = c;
          if (thick) { var k2 = k + (Math.abs(Math.sin(ang)) > 0.7 ? 1 : w); if (c * 0.85 > F[k2]) F[k2] = c * 0.85; }
        }
        ang += cur + (R() - 0.5) * 0.05; x += Math.cos(ang) * 0.5; y += Math.sin(ang) * 0.5;
      }
    }
    return F;
  }
  // distancia geodésica desde los píxeles con G=0 a través de un coste por píxel (relajación por barridos)
  function geodesic(G, C, w, h, act, sweeps) {
    var S2 = 1.41421, x, y, i, s;
    function relax(i, x, y) {
      var c = C[i], g = G[i], t;
      if (x > 0) { t = G[i - 1] + 0.5 * (c + C[i - 1]); if (t < g) g = t; }
      if (x < w - 1) { t = G[i + 1] + 0.5 * (c + C[i + 1]); if (t < g) g = t; }
      if (y > 0) {
        t = G[i - w] + 0.5 * (c + C[i - w]); if (t < g) g = t;
        if (x > 0) { t = G[i - w - 1] + S2 * 0.5 * (c + C[i - w - 1]); if (t < g) g = t; }
        if (x < w - 1) { t = G[i - w + 1] + S2 * 0.5 * (c + C[i - w + 1]); if (t < g) g = t; }
      }
      if (y < h - 1) {
        t = G[i + w] + 0.5 * (c + C[i + w]); if (t < g) g = t;
        if (x > 0) { t = G[i + w - 1] + S2 * 0.5 * (c + C[i + w - 1]); if (t < g) g = t; }
        if (x < w - 1) { t = G[i + w + 1] + S2 * 0.5 * (c + C[i + w + 1]); if (t < g) g = t; }
      }
      G[i] = g;
    }
    for (s = 0; s < sweeps; s++) {
      var dy = s & 1, dx = (s >> 1) & 1;
      for (var yy = 0; yy < h; yy++) {
        y = dy ? h - 1 - yy : yy;
        for (var xx = 0; xx < w; xx++) {
          x = dx ? w - 1 - xx : xx; i = y * w + x;
          if (act[i] && G[i] > 0) relax(i, x, y);
        }
      }
    }
    return G;
  }

  // ------------------------------------------------------------------ AGUA QUE CAE POR ENCIMA
  // Gotas de agua limpia que caen desde arriba sobre las letras (papel absorbente). Encima del papel
  // no se ven. Al tocar la letra se comen casi el 100 % del pigmento; según bajan se van cargando de
  // la tinta que disuelven: comen cada vez menos y dejan esa tinta diluida y en estrías en su canal,
  // hasta perderse en la letra. Dos tipos:
  //  - mordidas: muchas, cortas; muerden el borde de arriba y se cargan enseguida.
  //  - cruzan: canal largo; unas se pierden dentro de la letra y otras salen por abajo llevando
  //    tinta, que se infiltra en el papel y se apaga.
  function waterRuns(A, w, h, U, DR, R, noise, PL, mott, gran) {
    var n = w * h, x, y, i, runs = DR.runs || 0;
    if (runs <= 0) return A;
    var top = new Int32Array(w).fill(-1), bot = new Int32Array(w).fill(-1), cols = [];
    for (x = 0; x < w; x++) { for (y = 0; y < h; y++) if (A[y * w + x] > 0.5) { if (top[x] < 0) top[x] = y; bot[x] = y; } if (top[x] >= 0) cols.push(x); }
    if (!cols.length) return A;
    var O = new Float32Array(A), rk = Math.min(1.6, runs);
    var nr = Math.max(1, Math.round(runs * (cols.length / U) * 32));
    for (var r = 0; r < nr; r++) {
      var x0 = cols[(R() * cols.length) | 0], sd = R() * 100;
      var bite = R() < 0.6;
      var hw = bite ? U * (0.005 + 0.015 * Math.pow(R(), 1.5)) + 0.6 : U * (0.003 + 0.011 * Math.pow(R(), 1.7)) + 0.5;
      var satL = bite ? U * (0.012 + 0.05 * R()) * (0.6 + 0.4 * rk) : U * (0.1 + 0.3 * R()) * (0.6 + 0.4 * rk);   // cuánto tarda en cargarse de tinta
      var lostInside = !bite && R() < 0.5;
      var ys = Math.max(1, top[x0] - U * (0.03 + 0.45 * R()));
      var tail = U * (0.06 + 0.5 * (DR.length || 0.4) * (0.3 + 0.7 * R()));
      var lastInk = -1, entry = -1, c = 0, xc = x0;
      for (y = Math.max(0, ys | 0); y < h; y++) {
        xc = x0 + (noise(y / (U * 0.3) + sd, sd * 0.3) - 0.5) * U * 0.1 + (noise(y / (U * 0.05) - sd, 4.1) - 0.5) * U * 0.015;
        var xi = Math.round(xc), aC = xi >= 0 && xi < w ? A[y * w + xi] : 0;
        if (aC > 0.5) { if (entry < 0) entry = y; lastInk = y; c += (1 - c) / Math.max(1.5, satL); }
        else if (lastInk >= 0) { if (bite) break; c *= Math.exp(-1 / (tail * 0.45)); if (y - lastInk > tail) break; }
        else if (y > ys + U * 1.2 && y > bot[x0]) break;
        if (bite && c > 0.9) break;                                    // la mordida ya se cargó
        if (lostInside && c > 0.97) break;                             // se pierde dentro de la letra
        var hwy = hw * (0.6 + 0.8 * noise(y / (U * 0.08) + sd, 7.7));
        if (entry >= 0 && aC > 0.5) hwy *= 1 + 0.6 * smooth(hw * 3, 0, y - entry) * (bite ? 1.4 : 1);   // la gota se aplasta al llegar
        if (lastInk >= 0 && aC <= 0.5) hwy *= 1 + 0.9 * Math.min(1, (y - lastInk) / tail);            // fuera de la letra se abre en el papel
        var eat = Math.pow(1 - c, 1.3);                                 // agua limpia: casi todo; cargada: casi nada
        for (x = Math.max(0, Math.floor(xc - hwy - 3)); x <= Math.min(w - 1, Math.ceil(xc + hwy + 3)); x++) {
          i = y * w + x;
          var dx = Math.abs(x - xc) + (noise(x * 0.35 + sd, y * 0.35) - 0.5) * (0.8 + hwy * 0.3), soft = 0.5 + hwy * 0.14, prof = smooth(hwy + soft, hwy - soft, dx);
          if (prof <= 0) continue;
          var rim = Math.exp(-Math.pow((dx - hwy) / (0.7 + hwy * 0.2), 2));
          if (A[i] > 0.05 && (aC > 0.5 || lastInk < 0 || y - lastInk < 2)) {
            // dentro de la letra: se come el pigmento y deja el que ya lleva disuelto, en estrías
            var st = 0.6 + 0.4 * noise((x - xc) * 0.6 + sd, y * 0.04);
            var left = A[i] * (1 - prof * eat * (0.9 + 0.1 * mott(x, y)));
            var dep = A[i] * prof * c * (0.5 + 0.35 * st);
            var v = Math.max(left, dep);
            if (v < O[i]) O[i] = v;
            PL[i] = Math.max(PL[i], rim * 0.55 * A[i] * eat);            // el pigmento empujado al borde del canal
          } else if (c > 0.01 && lastInk >= 0 && aC <= 0.5) {
            // abajo (o en el hueco de la letra): el agua lleva tinta disuelta, diluida y granulosa
            var tt = Math.min(1, (y - lastInk) / tail);
            var v2 = c * 0.55 * prof * (1 - tt) * (0.6 + 0.4 * mott(x, y)) * (1 - 0.4 * smooth(0.45, 0.85, 1 - gran(x, y)));
            v2 += c * 0.25 * rim * prof * (1 - tt);
            if (v2 > O[i]) O[i] = v2;
          }
        }
      }
    }
    return O;
  }

  // ------------------------------------------------------------------ campo del trazo
  function maxFilter(F, w, h, r) {
    r = Math.max(1, Math.round(r));
    var T = new Float32Array(F.length), O = new Float32Array(F.length), x, y, k;
    for (y = 0; y < h; y++) { var o = y * w; for (x = 0; x < w; x++) { var m = 0, a = Math.max(0, x - r), b = Math.min(w - 1, x + r); for (k = a; k <= b; k++) if (F[o + k] > m) m = F[o + k]; T[o + x] = m; } }
    for (x = 0; x < w; x++) for (y = 0; y < h; y++) { var m2 = 0, a2 = Math.max(0, y - r), b2 = Math.min(h - 1, y + r); for (k = a2; k <= b2; k++) if (T[k * w + x] > m2) m2 = T[k * w + x]; O[y * w + x] = m2; }
    return O;
  }
  // Para cada píxel de la forma: distancia al borde (D), normal hacia dentro (nx, ny),
  // eje del trazo (ax, ay: dirección en la que "corre" la letra) y medio grosor local (Hw).
  function strokeField(M, w, h, U) {
    var n = w * h, D = distInside(M, w, h, 0.5), x, y, i;
    var Ds = blur(D, w, h, 1.5, 1.5);
    var gx = new Float32Array(n), gy = new Float32Array(n), Jxx = new Float32Array(n), Jxy = new Float32Array(n), Jyy = new Float32Array(n);
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
      i = y * w + x;
      var a = (Ds[i + 1] - Ds[i - 1]) * 0.5, b = (Ds[i + w] - Ds[i - w]) * 0.5;
      gx[i] = a; gy[i] = b; Jxx[i] = a * a; Jxy[i] = a * b; Jyy[i] = b * b;
    }
    var rT = Math.max(2, U * 0.1);
    Jxx = blur(Jxx, w, h, rT, rT); Jxy = blur(Jxy, w, h, rT, rT); Jyy = blur(Jyy, w, h, rT, rT);
    var ax = new Float32Array(n), ay = new Float32Array(n), nx = new Float32Array(n), ny = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var th = 0.5 * Math.atan2(2 * Jxy[i], Jxx[i] - Jyy[i]);       // dirección dominante del gradiente
      ax[i] = -Math.sin(th); ay[i] = Math.cos(th);                      // el trazo corre perpendicular
      var gl = Math.sqrt(gx[i] * gx[i] + gy[i] * gy[i]) || 1;
      nx[i] = gx[i] / gl; ny[i] = gy[i] / gl;
    }
    var Hw = blur(maxFilter(D, w, h, U * 0.07), w, h, U * 0.03, U * 0.03);
    return { D: D, ax: ax, ay: ay, nx: nx, ny: ny, Hw: Hw };
  }

  // Talla que sigue la dirección de cada letra.
  // mode 'across': líneas que cruzan el trazo (perpendiculares a su eje), nacen anchas en el borde
  //                iluminado y se afilan en punta hacia el otro lado.
  // mode 'contour': líneas paralelas al contorno (siguen la forma), troceadas y afiladas en sus extremos.
  function engraveDirectional(M, w, h, U, E, seed, noise, ox, oy, invU) {
    var n = w * h, x, y, i, K = new Float32Array(n), F = strokeField(M, w, h, U);
    var sp = Math.max(3, U * (0.03 + 0.07 * E.spacing));
    var la = (E.lightAng == null ? -0.6 : E.lightAng) * Math.PI, lx = Math.cos(la), ly = Math.sin(la);
    var gstep = Math.max(1, Math.min(8, Math.floor(U / 40)));
    var gw = makeGrid(w, h, gstep, function (gx2, gy2) { return noise.fbm((gx2 - ox) * invU * 1.3 + 9, (gy2 - oy) * invU * 1.3 - 4, 3); });
    var gs = makeGrid(w, h, gstep, function (gx2, gy2) { return noise.fbm((gx2 - ox) * invU * 5 + 31, (gy2 - oy) * invU * 5 + 2, 2); });
    var sd = seed * 7919, Dc = E.mode === 'contour' ? blur(F.D, w, h, Math.max(1, sp * 0.35), Math.max(1, sp * 0.35)) : null;
    if (Dc) for (i = 0; i < n; i++) if (M[i] < 0.5) Dc[i] = 0; else Dc[i] = Math.min(Dc[i] + 0.6 * Math.max(0, F.D[i] - Dc[i]), F.D[i]);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      var m = M[i];
      if (m <= 0.002) continue;
      if (m < 0.5) { K[i] = m; continue; }
      var Dv = F.D[i], H = Math.max(1.5, F.Hw[i]), cut = 0;
      if (E.mode === 'contour') {
        // Talla de contorno como en la madera: UNA línea de gubia en V paralela al borde, a una
        // distancia fija dentro del trazo (la distancia se suaviza para que las esquinas sean curvas,
        // como las deja la gubia). Engorda en el lado de la luz y se afila hasta desaparecer en el
        // de sombra; se corta a tramos con entrada y salida en punta. Una segunda línea, más corta,
        // solo en los trazos anchos y del lado iluminado. Los trazos finos y los puntos quedan macizos.
        var Dsm = Dc[i], inset = Math.min(sp * 0.95, H * 0.42), hw0 = Math.min(0.5 * E.width * sp * 0.9, H * 0.2);
        var facing = -(F.nx[i] * lx + F.ny[i] * ly);
        var lit = smooth(-0.75, 0.55, facing);
        var pulse = (gw(x, y) - 0.5) * sp * 0.35 * E.wobble;
        var brk = gs(x, y), keep = smooth(E.skip * 0.7, E.skip * 0.7 + 0.18, brk);
        var nl = 1 + (E.length > 0.55 ? 1 : 0);
        for (var kk = 0; kk < nl; kk++) {
          var cpos = inset + kk * Math.max(sp * 1.15, inset * 1.2);
          if (H < 3.5 || (kk > 0 && H < cpos + hw0 + sp * 1.1)) break;                              // no cabe con tinta a los dos lados
          var hwk = hw0 * (kk === 0 ? 0.12 + 0.88 * lit : Math.max(0, lit * 1.3 - 0.45) * 0.8) * keep;
          hwk += (noise(x * 0.45 + 13.1, y * 0.45 - 7.3) - 0.5) * 0.7;                             // borde de madera, no de vector
          if (hwk < 0.35) continue;
          var c1 = clamp01(hwk - Math.abs(Dsm + pulse - cpos) + 0.5);
          if (c1 > cut) cut = c1;
        }
      } else {
        // cruzando el trazo: la dirección se agrupa en sectores de 15°, así las líneas son rectas
        // y continuas dentro de cada trazo y cambian de dirección donde cambia la letra
        var thA = Math.atan2(F.ay[i], F.ax[i]); if (thA < 0) thA += Math.PI; if (thA >= Math.PI) thA -= Math.PI;
        var bin = Math.round(thA / (Math.PI / 12)) % 12, thq = bin * Math.PI / 12;
        var along2 = (x - ox) * Math.cos(thq) + (y - oy) * Math.sin(thq) + bin * sp * 0.37;
        var qv2 = (along2 + (gw(x, y) - 0.5) * sp * 1.6 * E.wobble) / sp, k2 = Math.floor(qv2), f2 = qv2 - k2;
        var hk2 = hash(k2 * 7919 + sd), hk3 = hash(k2 * 31 + 5 + sd);
        if (hk3 >= E.skip) {
          var facing = -(F.nx[i] * lx + F.ny[i] * ly);                    // >0: borde que mira a la luz
          var dl = facing > 0 ? Dv : 2 * H - Dv;                           // distancia desde el borde iluminado
          var Lk = 2 * H * Math.min(1.05, E.length * (0.4 + 0.9 * hk2)) + 1;
          if (dl < Lk) {
            var tq = dl / Lk, offL = Math.abs(f2 - 0.5) * sp;
            if (hash(k2 * 53 + 9 + sd) < (E.uRatio == null ? 0.35 : E.uRatio)) {
              // gubia en U: ancho constante y extremo redondeado
              var hwU = 0.5 * E.width * 0.75 * sp, endD = Lk - dl;
              cut = endD > hwU ? clamp01(hwU - offL + 0.5) : clamp01(hwU - Math.sqrt(offL * offL + (hwU - endD) * (hwU - endD)) + 0.5);
            } else {
              var half = 0.5 * E.width * (tq < 0.6 ? 1 - 0.25 * tq : 0.85 * Math.pow((1 - tq) / 0.4, 0.8)) * (0.7 + 0.6 * gs(x, y));
              cut = clamp01(half * sp - offL + 0.5);
            }
          }
        }
      }
      K[i] = m * (1 - cut);
    }
    return K;
  }

  // ------------------------------------------------------------------ XILOGRAFÍA: talla suelta (garabato)
  // Como los carteles de madera tallados a mano con gubia rápida: la letra queda negra (tinta con
  // vetas), una o dos líneas blancas de gubia siguen su contorno, alrededor queda una franja de
  // madera SIN tallar (negra) llena de garabatos blancos enredados que siguen la forma, con el
  // borde roto; fuera, papel con restos de tinta del rodillo en parches rectangulares de taco
  // (grises, estriados) y algún arrastre vertical. Devuelve la cobertura de tinta (0..1).
  function engraveScribble(M, w, h, U, E, seed, noise, ox, oy, invU) {
    var n = w * h, x, y, i, R = rng(seed * 7919 + 101);
    var Minv = new Float32Array(n); for (i = 0; i < n; i++) Minv[i] = 1 - M[i];
    var Dout = distInside(Minv, w, h, 0.5, true);                  // distancia fuera de la letra
    var bandW = U * (0.06 + 0.16 * (E.width == null ? 0.6 : E.width));
    var gstep = Math.max(1, Math.min(8, Math.floor(U / 40)));
    var gb = makeGrid(w, h, gstep, function (gx2, gy2) { return noise.fbm((gx2 - ox) * invU * 1.6 + 5, (gy2 - oy) * invU * 1.6 - 9, 3); });
    var gr = makeGrid(w, h, gstep, function (gx2, gy2) { return noise.fbm((gx2 - ox) * invU * 9 + 41, (gy2 - oy) * invU * 9 + 3, 2); });
    var K = new Float32Array(n), cut = new Float32Array(n), band = new Float32Array(n);
    // 1) BLOQUE de madera sin tallar: las letras de una misma línea comparten un taco rectangular
    //    (dilatación y cierre con núcleo cuadrado), con el borde astillado a trozos
    var r1 = Math.max(3, U * (0.14 + 0.3 * (E.width == null ? 0.6 : E.width)));
    var dil = maxFilter(M, w, h, r1), inv0 = new Float32Array(n);
    for (i = 0; i < n; i++) inv0[i] = 1 - dil[i];
    var clo = maxFilter(inv0, w, h, r1 * 0.55);
    for (i = 0; i < n; i++) clo[i] = 1 - clo[i];
    var cloB = blur(clo, w, h, Math.max(2, U * 0.02), Math.max(2, U * 0.02));
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      band[i] = smooth(0.47, 0.53, cloB[i] + (gr(x, y) - 0.5) * 0.22 + (gb(x, y) - 0.5) * 0.2 + (hash(((x >> 2) * 31 + (y >> 2)) ^ seed) - 0.5) * 0.08);
    }
    // 2) líneas de gubia que siguen el contorno, pegadas a la letra (una siempre, otra a ratos)
    var off1 = U * (0.012 + 0.03 * (E.spacing == null ? 0.4 : E.spacing)), lw = Math.max(0.9, U * 0.011);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x; var d2 = Dout[i]; if (d2 <= 0 || d2 > off1 * 4 + lw * 4) continue;
      var wob = (noise((x - ox) * invU * 6 + 3, (y - oy) * invU * 6) - 0.5) * lw * 1.4 * (E.wobble == null ? 0.5 : E.wobble);
      var lwl = lw * (0.7 + 0.7 * gr(x, y));
      var c1 = clamp01(lwl - Math.abs(d2 + wob - off1) + 0.5);
      var on2 = smooth(0.45, 0.6, gb(x + 71, y - 33));
      var c2 = on2 * clamp01(lwl * 0.8 - Math.abs(d2 - wob - off1 * 2.6) + 0.5);
      cut[i] = Math.max(c1, c2);
    }
    // 3) cortes de GUBIA en la madera sobrante: cuñas (entran anchas, salen en punta) que siguen el
    //    contorno de la letra a distintas distancias, apretadas; entre ellas quedan crestas de madera
    //    que imprimen como líneas negras irregulares. Cerca del borde del taco, cortes más largos.
    var dens = E.length == null ? 0.7 : E.length, area = 0;
    for (i = 0; i < n; i++) if (band[i] > 0.5 && M[i] < 0.5) area++;
    var nCut = Math.min(14000, Math.round(area / (U * U) * 340 * dens));
    function grad(px, py) {
      var xi = Math.max(1, Math.min(w - 2, px | 0)), yi = Math.max(1, Math.min(h - 2, py | 0)), j = yi * w + xi;
      var a = Dout[j + 1], b = Dout[j - 1], c = Dout[j + w], e = Dout[j - w];
      if (a > 1e8 || b > 1e8 || c > 1e8 || e > 1e8) return [0, 0];
      return [(a - b) * 0.5, (c - e) * 0.5];
    }
    var placed = 0;
    for (var tries = 0; placed < nCut && tries < nCut * 30; tries++) {
      var px0 = R() * w, py0 = R() * h, j0 = (py0 | 0) * w + (px0 | 0);
      if (M[j0] > 0.5 || band[j0] < 0.6 || Dout[j0] < off1 * 1.8) continue;
      placed++;
      var g = grad(px0, py0), ang = Math.atan2(g[0], -g[1]) + (R() < 0.5 ? Math.PI : 0) + (R() - 0.5) * 0.35;
      var len = U * (0.04 + 0.16 * Math.pow(R(), 1.2)), wmax = Math.max(0.9, U * (0.006 + 0.012 * R()));
      var xx = px0, yy = py0, steps = Math.ceil(len / 0.8), curv = (R() - 0.5) * 0.05;
      for (var k = 0; k < steps; k++) {
        var tt = k / steps;
        // cuña: la gubia entra rápida (0..0.15), sostiene y sale en punta larga
        var rr = wmax * smooth(0, 0.12, tt) * Math.pow(1 - tt, 0.7) + 0.25;
        var xa = Math.floor(xx - rr - 1), xb = Math.ceil(xx + rr + 1), ya = Math.floor(yy - rr - 1), yb = Math.ceil(yy + rr + 1);
        for (var y2 = ya; y2 <= yb; y2++) { if (y2 < 0 || y2 >= h) continue; for (var x2 = xa; x2 <= xb; x2++) { if (x2 < 0 || x2 >= w) continue;
          var j2 = y2 * w + x2; if (M[j2] > 0.5 || Dout[j2] < off1 * 1.4) continue;
          var cv = clamp01(rr + 0.5 - Math.sqrt((x2 - xx) * (x2 - xx) + (y2 - yy) * (y2 - yy)));
          if (cv > cut[j2]) cut[j2] = cv; } }
        var g2 = grad(xx, yy), tang = Math.atan2(g2[0], -g2[1]);
        var da = Math.atan2(Math.sin(tang - ang), Math.cos(tang - ang)), da2 = Math.atan2(Math.sin(tang + Math.PI - ang), Math.cos(tang + Math.PI - ang));
        ang += (Math.abs(da) < Math.abs(da2) ? da : da2) * 0.12 + curv;
        xx += Math.cos(ang) * 0.8; yy += Math.sin(ang) * 0.8;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) break;
      }
    }
    // 4) tinta del sello: veta horizontal de la madera, presión desigual (zonas más pálidas), poros
    var gGrain = makeGrid(w, h, 1, function (gx2, gy2) { var u2 = (gx2 - ox) * invU, v2 = (gy2 - oy) * invU; return noise(u2 * 1.5 + noise(u2 * 0.8, v2 * 3) * 1.5, v2 * 38) * 0.65 + noise(u2 * 4, v2 * 90 + 3) * 0.35; });
    var gPress = makeGrid(w, h, gstep, function (gx2, gy2) { return noise.fbm((gx2 - ox) * invU * 0.9 - 17, (gy2 - oy) * invU * 0.9 + 29, 3); });
    var grainA = E.grain == null ? 0.5 : E.grain;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      var inkv = Math.max(M[i], band[i]) * (1 - cut[i]);
      if (inkv <= 0) continue;
      var gv = gGrain(x, y), pr = gPress(x, y);
      var lift = grainA * (0.45 * smooth(0.55, 0.85, gv) + 0.35 * smooth(0.6, 0.85, pr) * (0.5 + 0.5 * gv));
      if (hash(i * 7 + seed) < 0.015 * grainA) lift = Math.max(lift, 0.8);           // poros de la madera
      K[i] = inkv * (1 - Math.min(0.85, lift));
    }
    // 5) papel fuera: parches rectangulares de taco con tinta gris estriada y arrastres verticales
    var blocks = E.blocks == null ? 0.5 : E.blocks;
    if (blocks > 0) {
      var rowY = 0, row = 0;
      while (rowY < h) {
        var rh = U * (0.18 + 0.5 * hash(row * 31 + seed)), colX = 0, col = 0;
        while (colX < w) {
          var cw = U * (0.25 + 0.9 * hash(row * 977 + col * 13 + seed)), hb = hash(row * 7 + col * 131 + seed * 3);
          var cxm = Math.min(w - 1, (colX + cw / 2) | 0), cym = Math.min(h - 1, (rowY + rh / 2) | 0), dn = Dout[cym * w + cxm];
          var nearF = dn > 1e8 ? 0 : smooth(U * 1.4, U * 0.35, dn);
          if (hb < blocks * 0.55 * nearF) {
            var dkv = 0.07 + 0.28 * hash(row * 5 + col * 3 + 11), horiz = hash(col * 17 + row) < 0.6;
            var y0b = Math.floor(rowY + (hash(col + row * 3) - 0.5) * U * 0.05), y1b = Math.floor(rowY + rh), x0b = Math.floor(colX), x1b = Math.floor(colX + cw);
            for (y = Math.max(0, y0b); y < Math.min(h, y1b); y++) for (x = Math.max(0, x0b); x < Math.min(w, x1b); x++) {
              i = y * w + x;
              var st = horiz ? noise((x - ox) * invU * 1.2 + col, (y - oy) * invU * 45 + row) * 0.7 + noise((x - ox) * invU * 6, (y - oy) * invU * 6 + row) * 0.3 : noise((x - ox) * invU * 45 + col, (y - oy) * invU * 1.2 + row) * 0.7 + noise((x - ox) * invU * 6 + col, (y - oy) * invU * 6) * 0.3;
              var edge = Math.min(y - y0b, y1b - y, x - x0b, x1b - x), fade = smooth(0, U * 0.02, edge) * (0.6 + 0.4 * smooth(0, U * 0.15, edge));
              var v = dkv * (0.25 + 1.0 * smooth(0.42, 0.62, st)) * fade;
              if (v > K[i]) K[i] = Math.min(1, v);
            }
          }
          colX += cw; col++;
        }
        rowY += rh; row++;
      }
    }
    // arrastres verticales desde el borde inferior de la franja (tinta corrida del rodillo)
    var nDr = Math.round(w / U * 3 * blocks);
    for (var q = 0; q < nDr; q++) {
      var sx0 = (R() * w) | 0, sy0 = -1;
      for (y = h - 2; y > 0; y--) { var jq = y * w + sx0; if (band[jq] > 0.5 && band[jq + w] <= 0.5) { sy0 = y; break; } }
      if (sy0 < 0) continue;
      var dl = U * (0.1 + 0.5 * R()), dwid = U * (0.02 + 0.06 * R()), dd0 = 0.4 + 0.5 * R();
      for (y = sy0; y < Math.min(h, sy0 + dl); y++) for (x = Math.max(0, (sx0 - dwid) | 0); x < Math.min(w, (sx0 + dwid) | 0); x++) {
        i = y * w + x; var tq = (y - sy0) / dl;
        var v2 = dd0 * (1 - tq) * smooth(0.25, 0.75, noise(x * 0.4 + q, y * 0.03)) * smooth(dwid, dwid * 0.4, Math.abs(x - sx0));
        if (v2 > K[i]) K[i] = v2;
      }
    }
    return K;
  }

  // ------------------------------------------------------------------ XILOGRAFÍA: líneas de talla
  // Líneas paralelas (casi horizontales, hechas a mano) que entran desde el lado de la luz de cada
  // trazo, anchas en el borde y afiladas en punta hacia dentro, como en los carteles grabados.
  function engraveCuts(M, w, h, U, E, seed, noise, ox, oy, invU) {
    var n = w * h, x, y, i, K = new Float32Array(n);
    var sp = Math.max(3, U * (0.03 + 0.07 * E.spacing)), dirR = (E.light || 0) >= 0 ? 1 : -1;
    var rs = new Int32Array(n), re = new Int32Array(n);
    for (y = 0; y < h; y++) {
      var st = -1;
      for (x = 0; x <= w; x++) {
        var inside = x < w && M[y * w + x] > 0.5;
        if (inside && st < 0) st = x;
        if (!inside && st >= 0) { for (var q = st; q < x; q++) { rs[y * w + q] = st; re[y * w + q] = x - 1; } st = -1; }
      }
    }
    var gstep = Math.max(1, Math.min(8, Math.floor(U / 40)));
    var gw = makeGrid(w, h, gstep, function (gx, gy) { return noise.fbm((gx - ox) * invU * 1.2 + 9, (gy - oy) * invU * 0.4, 3); });
    var gw2 = makeGrid(w, h, gstep, function (gx, gy) { return noise.fbm((gx - ox) * invU * 4.5 - 3, (gy - oy) * invU * 1.5 + 2, 2); });
    var sd = seed * 7919;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      var m = M[i];
      if (m <= 0.002) continue;
      if (m < 0.5) { K[i] = m; continue; }
      var yy = y + (gw(x, y) - 0.5) * sp * 2.2 * E.wobble + (gw2(x, y) - 0.5) * sp * 0.5 * E.wobble;
      var qv = yy / sp, k = Math.floor(qv), f = qv - k;
      var hk = hash(k * 7919 + sd), hk2 = hash(k * 31 + 5 + sd), hk3 = hash(k * 131 + 17 + sd);
      var span = re[i] - rs[i] + 1, d = dirR > 0 ? re[i] - x : x - rs[i];
      var cut = 0;
      if (hk2 >= E.skip && span > 2) {
        var Lk = span * Math.min(1.05, E.length * (0.35 + 0.95 * hk)) + 1;
        if (d < Lk) {
          var tt = d / Lk, half = 0.5 * E.width * Math.pow(1 - tt, 0.65) * (0.75 + 0.5 * hk3);
          var off = Math.abs(f - 0.5) * sp, hwp = half * sp;
          cut = clamp01(hwp - off + 0.5);
        }
      }
      K[i] = m * (1 - cut);
    }
    return K;
  }

  // ------------------------------------------------------------------ XILOGRAFÍA: cortes de gubia
  // Cortes en cuña agrupados por zonas (como el "hatching" del grabador): en las zonas del borde
  // entran desde el contorno y se afilan hacia dentro; en el interior son hojas cortas paralelas.
  function gouge(A, w, h, U, G, R, noise, ox, oy, invU) {
    var n = w * h, x, y, i, k;
    var M = new Float32Array(n);
    for (i = 0; i < n; i++) M[i] = smooth(0.42, 0.58, A[i]);          // tinta plana y dura
    var D = distInside(M, w, h, 0.5);
    function D0max(MM) { return D; }
    var Z = U * (0.22 + 0.5 * G.zone), invZ = 1 / Z;
    var Ab = blur(M, w, h, Z * 0.45, Z * 0.45);
    var sp = Math.max(2.6, U * (0.03 + 0.06 * G.spacing));           // separación entre cortes
    var cutLen = U * (0.02 + 0.16 * G.length);
    var Dmax = blur(D0max(M, w, h), w, h, U * 0.05, U * 0.05);           // medio grosor local del trazo
    var seed = (G.seed || 1) * 7.13, cells = {};
    function cell(cx, cy) {
      var key = cx + ',' + cy, c = cells[key];
      if (c) return c;
      var hx = hash(cx * 73856093 ^ cy * 19349663 ^ (seed * 1000 | 0)), hy = hash(cx * 83492791 ^ cy * 2971215073 ^ 77);
      var px = (cx + 0.15 + 0.7 * hx) * Z, py = (cy + 0.15 + 0.7 * hy) * Z;
      var pxi = Math.max(1, Math.min(w - 2, Math.round(px))), pyi = Math.max(1, Math.min(h - 2, Math.round(py)));
      var j = pyi * w + pxi, ab = Ab[j];
      var gx = Ab[j + 1] - Ab[j - 1], gy = Ab[j + w] - Ab[j - w];
      var edge = ab > 0.04 && ab < 0.96 && (gx * gx + gy * gy) > 1e-6;
      var ang = edge ? Math.atan2(gy, gx) + (hash(cx * 7 + cy * 131) - 0.5) * 0.5
                     : (G.angle || 0) * Math.PI * 0.5 + (hash(cx * 13 + cy * 7 + 5) - 0.5) * Math.PI * (0.35 + 0.65 * G.chaos);
      c = { x: px, y: py, ca: Math.cos(ang), sa: Math.sin(ang), edge: edge, h: hash(cx * 31 + cy * 17 + 3),
        dens: edge ? G.edge : G.inner * (hash(cx * 5 + cy * 11 + 9) < 0.55 ? 1 : 0.25) };
      cells[key] = c; return c;
    }
    var gnz = makeGrid(w, h, Math.max(1, Math.min(8, Math.floor(U / 40))), function (gx2, gy2) { return noise.fbm((gx2 - ox) * invU * 2.5, (gy2 - oy) * invU * 2.5, 2); });
    var out = new Float32Array(n);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      var m = M[i];
      if (m <= 0.002) continue;
      // celda de Voronoi más cercana
      var gxc = Math.floor(x * invZ), gyc = Math.floor(y * invZ), best = 1e18, C = null;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var cc = cell(gxc + dx, gyc + dy), d2 = (cc.x - x) * (cc.x - x) + (cc.y - y) * (cc.y - y);
        if (d2 < best) { best = d2; C = cc; }
      }
      if (C.dens <= 0) { out[i] = m; continue; }
      var lx = x - C.x, ly = y - C.y;
      var along = lx * C.ca + ly * C.sa, across = -lx * C.sa + ly * C.ca;
      across += (gnz(x, y) - 0.5) * sp * 0.9;                         // pulso de la mano
      var q = across / sp + C.h * 7, kk = Math.floor(q), f = q - kk;
      var hk = hash(kk * 92821 + (C.h * 1e6 | 0));
      var halfW = 0, cut = false;
      if (C.edge) {
        // corte que entra desde el borde: ancho en el contorno, se afila hacia dentro
        if (hk < C.dens) {
          var Lk = cutLen * (0.3 + 0.9 * hash(kk * 31 + 7 + (C.h * 1e5 | 0)));
          Lk = Math.min(Lk, Math.max(2, Dmax[i] * 1.6));                 // nunca atraviesa el trazo entero
          var dep = D[i];
          if (dep < Lk) { halfW = 0.5 * sp * G.width * Math.pow(1 - dep / Lk, 0.75) * (0.7 + 0.3 * hk); cut = true; }
        }
      } else {
        // hojas cortas paralelas en el interior (zonas de medio tono)
        var Ls = cutLen * 1.4 * (0.6 + 0.8 * hk), period = Ls * (1.4 + 1.5 * hk);
        var a2 = along + hash(kk * 17 + 3) * period * 3, si = Math.floor(a2 / period), t = (a2 - si * period) / Ls;
        if (t < 1 && hash(si * 131 + kk * 7 + 11) < C.dens && D[i] > sp * 0.9 && D[i] > Dmax[i] * 0.55) {
          halfW = 0.5 * sp * G.width * Math.pow(Math.sin(Math.PI * t), 0.7) * (0.6 + 0.4 * hash(si + kk * 3)); cut = true;
        }
      }
      if (cut && halfW > 0.05) {
        var dist = Math.abs(f - 0.5) * sp - halfW;                    // <0 dentro del corte
        var keep = clamp01(0.5 + dist);
        out[i] = m * keep;
      } else out[i] = m;
    }
    return out;
  }

  // ------------------------------------------------------------------ BANCO DE GOTEOS REALES
  // plugin/drips/drips.json + drips.bin (generados por tools/build_drips.py desde GOTAS/).
  // Cada gota: máscara (w*h bytes) y sombreado (w*h bytes). La raíz es el borde de arriba,
  // salvo en las clases 'suelta' e 'impacto'. Clases: lagrima, fina, serpenteante, seca, impacto, suelta.
  function prepareDrips(index, buf) {
    var bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf), items = [], byClass = {};
    (index.items || []).forEach(function (it) {
      var n = it.w * it.h; if (it.o + 2 * n > bytes.length) return;
      var a = bytes.subarray(it.o, it.o + n), s = bytes.subarray(it.o + n, it.o + 2 * n);
      // centro de la raíz (primeras filas con pintura) y alto real ocupado
      var sx = 0, sw = 0, top = -1, bot = 0, x, y;
      for (y = 0; y < it.h; y++) {
        var any = false;
        for (x = 0; x < it.w; x++) { var v = a[y * it.w + x]; if (v > 127) { any = true; if (top < 0 || y - top < 4) { sx += x * v; sw += v; } } }
        if (any) { if (top < 0) top = y; bot = y; }
      }
      if (top < 0) return;
      var d = { id: it.id, c: it.c, w: it.w, h: it.h, a: a, s: s, top: top, len: bot - top + 1, rx: sw ? sx / sw : it.w / 2,
                rw: Math.max(1, it.rw || it.mw || 2), mw: Math.max(1, it.mw || 2), bw: it.bw || it.mw || 2 };
      d.asp = d.len / d.mw;
      d.cg = it.cg == null ? 1 : it.cg; d.gp = it.gp || 0;
      items.push(d);
      // para colgar de una letra solo valen las que cuelgan de verdad y no se tuercen en diagonal
      // (recortes con dos gotas o gotas inclinadas quedan fuera); las sueltas van aparte
      var straight = d.c === 'serpenteante' ? d.w <= d.mw * 7 + 30 : d.w <= d.mw * 3 + 14;
      if (d.c === 'suelta' || (d.cg && straight && d.gp < 0.02 && d.c !== 'impacto')) (byClass[d.c] = byClass[d.c] || []).push(d);
    });
    return { items: items, byClass: byClass };
  }
  // elige una gota de las clases pedidas (pesos), con la proporción largo/ancho más parecida
  function pickDrip(lib, weights, aspect, R) {
    var tot = 0, k, cls = null;
    for (k in weights) if (lib.byClass[k] && lib.byClass[k].length) tot += weights[k];
    if (tot <= 0) return null;
    var r = R() * tot;
    for (k in weights) { if (!lib.byClass[k] || !lib.byClass[k].length) continue; r -= weights[k]; if (r <= 0) { cls = k; break; } }
    var list = lib.byClass[cls || Object.keys(lib.byClass)[0]], best = [], i;
    for (i = 0; i < list.length; i++) best.push({ d: list[i], e: Math.abs(Math.log(list[i].asp / Math.max(0.5, aspect))) + R() * 0.5 });
    best.sort(function (p1, p2) { return p1.e - p2.e; });
    return best[Math.min(best.length - 1, Math.floor(R() * Math.min(4, best.length)))].d;
  }
  // muestreo bilineal de la máscara (ch='a') o del sombreado (ch='s') de una gota
  function dripAt(d, ch, x, y) {
    var F = d[ch], xf = Math.floor(x), yf = Math.floor(y);
    if (xf < 0 || yf < 0 || xf + 1 >= d.w || yf + 1 >= d.h) return 0;
    var fx = x - xf, fy = y - yf, k = yf * d.w + xf;
    var t = F[k] + (F[k + 1] - F[k]) * fx, b = F[k + d.w] + (F[k + d.w + 1] - F[k + d.w]) * fx;
    return (t + (b - t) * fy) / 255;
  }
  // estampa la gota d con su raíz (centro rx, fila top) en (cx, y0); ancho de raíz -> rootW px y
  // largo -> len px (escala casi uniforme). put(x, y, cobertura, sombreado, fracción de largo)
  function stampDrip(d, cx, y0, rootW, len, flip, put) {
    var sx = rootW / d.mw, sy = len / d.len;
    var k = Math.sqrt(sx * sy); sx = Math.max(k * 0.7, Math.min(k * 1.4, sx)); sy = Math.max(k * 0.7, Math.min(k * 1.4, sy));
    var x0 = Math.floor(cx - (d.rx + 1) * sx), x1 = Math.ceil(cx + (d.w - d.rx + 1) * sx);
    var ya = Math.floor(y0 - 1), yb = Math.ceil(y0 + (d.h - d.top) * sy);
    for (var yy = ya; yy <= yb; yy++) {
      var v = (yy - y0) / sy + d.top; if (v < d.top - 0.5) v = d.top;   // por encima de la raíz: la raíz repetida (se funde en la letra)
      for (var xx = x0; xx <= x1; xx++) {
        var u = (flip ? -(xx - cx) : (xx - cx)) / sx + d.rx;
        var c = dripAt(d, 'a', u, v);
        if (c > 0.004) put(xx, yy, c, dripAt(d, 's', u, v), (v - d.top) / d.len);
      }
    }
    return { sx: sx, sy: sy, end: y0 + d.len * sy };
  }

  // ------------------------------------------------------------------ GOTEO: gotas que nacen de cada letra
  function dripsFromLetters(A, w, h, U, P, R, noise, dark, lib) {
    var Aorig = new Float32Array(A);
    var useLib = lib && lib.items && lib.items.length && P.lib !== 0, absP = P.absorb || 0;
    // qué clases de gota real usa cada goteo: espeso y brillante -> lágrimas; absorbente -> finas
    var W8 = absP > 0.4 ? { fina: 0.6, lagrima: 0.4 } : { lagrima: 0.55, fina: 0.3, serpenteante: 0.15 };
    if (P.dry) W8.seca = P.dry;
    var x, y, i, runs = [];
    // tramos de borde inferior (bases de los trazos)
    // puntos de base (tinta encima, aire limpio debajo) agrupados en tramos casi horizontales
    var clr = Math.max(3, Math.round(U * 0.03)), open = [];
    for (x = 0; x < w; x++) {
      for (y = 2; y < h - clr - 1; y++) {
        if (!(A[y * w + x] > 0.5 && A[(y + 1) * w + x] < 0.5 && A[(y + clr) * w + x] < 0.3 && A[(y - 2) * w + x] > 0.4)) continue;
        var found = null;
        for (var o = 0; o < open.length; o++) { var rr0 = open[o]; if (x - rr0.lx <= 3 && Math.abs(y - rr0.ly) <= 3) { found = rr0; break; } }
        if (!found) { found = { pts: [], lx: x, ly: y }; open.push(found); runs.push(found); }
        found.pts.push([x, y]); found.lx = x; found.ly = y;
      }
      if (x % 8 === 0) open = open.filter(function (q) { return x - q.lx <= 3; });
    }
    var minRun = Math.max(3, U * 0.04);
    runs = runs.filter(function (q) { return q.pts.length >= minRun; }).map(function (q) {
      var ys = q.pts.map(function (p2) { return p2[1]; }).sort(function (a2, b2) { return a2 - b2; });
      return { x0: q.pts[0][0], x1: q.pts[q.pts.length - 1][0], y: ys[ys.length >> 1], pts: q.pts };
    });
    var count = 0, MAX = 700;
    function put(px, py, cov, dk) {
      if (px < 0 || py < 0 || px >= w || py >= h) return;
      var j = py * w + px;
      if (cov > A[j]) A[j] = cov;
      if (dark && dk > dark[j]) dark[j] = dk;
    }
    function ellipse(cx, cy, rx, ry, dk) {
      var xa = Math.floor(cx - rx - 1), xb = Math.ceil(cx + rx + 1), ya = Math.floor(cy - ry - 1), yb = Math.ceil(cy + ry + 1);
      for (var yy = ya; yy <= yb; yy++) for (var xx = xa; xx <= xb; xx++) {
        var ex = (xx - cx) / rx, ey = (yy - cy) / ry, d = Math.sqrt(ex * ex + ey * ey);
        var cov = clamp01((1 - d) * Math.min(rx, ry) + 0.5);
        if (cov > 0) put(xx, yy, cov, dk * cov);
      }
    }
    for (var r = 0; r < runs.length && count < MAX; r++) {
      var run = runs[r], len = run.pts.length;
      // (sin franja a lo largo de toda la base: la acumulación solo existe en la raíz de cada gota)
      var expected = Math.min(6, len / U * P.amount * 7 + P.amount * 0.6);
      var nd = Math.floor(expected) + (R() < expected - Math.floor(expected) ? 1 : 0);
      for (var d = 0; d < nd && count < MAX; d++) {
        count++;
        var rw = Math.max(0.9, U * (0.006 + 0.02 * P.thick * Math.pow(R(), 1.1)));
        var L = U * (0.03 + 1.7 * P.length * Math.pow(R(), 2.3)) + rw * 3;
        var mgn = Math.min(Math.floor(run.pts.length / 2), Math.ceil(rw * 4.5)); if (run.pts.length < 2 * mgn + 1) continue;
        var kI = mgn + Math.floor(R() * (run.pts.length - 2 * mgn)), mS = Math.max(2, Math.ceil(rw * 2));
        var kA = Math.max(0, kI - mS), kB = Math.min(run.pts.length - 1, kI + mS);
        // solo nace donde la base es casi horizontal (en un borde curvo dejaría una rendija)
        if (Math.abs(run.pts[kA][1] - run.pts[kB][1]) > (kB - kA) * 0.45) continue;
        var pk = run.pts[kI];
        var cx = pk[0], y0 = pk[1], ex = cx, drift = (R() - 0.5) * 0.08;
        var thin = rw < U * 0.006;
        // el menisco: la tinta sale de la base formando un filete cóncavo que se funde con la letra
        var Lf = rw * (3 + 3 * R()) + U * 0.01, Fw = rw * (2.2 + 2.5 * R());
        var bph = R() * 6.28, bfr = 1.5 + 2.5 * R(), bamp = 0.12 + 0.18 * R();   // cuello y barriga
        var stops = R() < 0.25;                                                      // algunas se paran sin lágrima
        var real = useLib ? pickDrip(lib, W8, L / (2 * rw), R) : null;              // gota REAL del banco
        var Ldraw = real ? Math.min(L, Lf) : L;
        for (var t = 0; t <= Ldraw; t++) {
          var yy = Math.round(y0 + t); if (yy >= h || yy < 0) continue;
          var tl = Math.max(0, t) / L;
          var tf = t / Lf, fil = tf < 1 ? (1 - Math.sqrt(1 - (1 - tf) * (1 - tf))) : 0;
          var belly = 1 + bamp * Math.sin(tl * bfr * Math.PI + bph) - 0.25 * smooth(0.75, 0.95, tl) * (stops ? 0 : 1);
          var abs = P.absorb || 0;
          var hw = rw * (1 - 0.4 * tl * (1 - abs) + abs * 2.4 * smooth(0, U * 0.7, t) * (0.6 + 0.4 * tl)) * belly + Fw * fil + 0.2;
          if (stops && abs <= 0.4) hw *= 1 - 0.7 * smooth(0.7, 1, tl);
          ex = cx + drift * Math.max(0, t) + (noise(t / U * 4 + d * 3.1 + r, r * 0.7) - 0.5) * rw * 1.1;
          var xa = Math.floor(ex - hw - 2), xb = Math.ceil(ex + hw + 2);
          var edgeN = 0.6 + 0.4 * noise(yy / U * 22 + d, d * 1.3);           // borde algo irregular
          for (var xx = xa; xx <= xb; xx++) {
            var dd = Math.abs(xx - ex), cov = smooth(hw + 0.9 * edgeN, hw - 0.9, dd) * (thin ? 0.85 : 1);
            // el menisco solo existe pegado a la letra: fuera del cuerpo de la gota, exige tinta
            // de la letra justo encima (si no, saldría una base plana que sobresale)
            var bodyW = rw * (1 - 0.4 * tl * (1 - abs) + abs * 2.4 * smooth(0, U * 0.7, t) * (0.6 + 0.4 * tl)) * belly + 0.2;
            if (real && dd <= bodyW) continue;                                // el cuerpo lo pone la gota real
            if (dd > bodyW && cov > 0) {
              var up = Math.round(1 + t * 0.9), yu = yy - up;
              var supp = 0;
              if (yu >= 0) for (var dxs = -1; dxs <= 1; dxs++) { var xs2 = xx + dxs; if (xs2 >= 0 && xs2 < w) supp = Math.max(supp, Aorig[yu * w + xs2]); }
              cov *= smooth(0.15, 0.55, supp);
            }
            // pigmento: nulo en la raíz (se funde con la letra), crece hacia abajo
            var dk = (0.15 + 0.35 * (1 - dd / (hw + 0.5))) * cov * P.dark * smooth(0, 0.35, tl);
            // el tramo fino es más transparente; la tinta se concentra donde la gota engorda
            if (abs > 0.4) cov *= 1 - smooth(0.6, 1, tl);   // en papel absorbente la punta se desvanece, sin corte
            if (cov > 0) put(xx, yy, cov * (hw < 1.6 ? 0.8 : 1) * (0.88 + 0.12 * belly), dk);
          }
        }
        if (real) {
          // cuerpo de la gota real, escalado a este goteo; la raíz entra un poco en la letra
          var flipD = R() < 0.5, glossy = absP <= 0.25, absF = absP > 0.4;
          var st = stampDrip(real, cx, y0 - 1, 2 * rw, L, flipD, function (px2, py2, c2, sh2, tl2) {
            var cv = c2;
            if (absF) cv *= 1 - smooth(0.6, 1, tl2);                           // en papel absorbente la punta se desvanece
            var dk2 = P.dark * cv * smooth(0, 0.35, tl2) * (0.25 + 0.45 * (1 - sh2));
            put(px2, py2, cv, dk2);
            if (glossy && sh2 > 0.86 && tl2 > 0.2) {                          // brillo real de la pintura (lente de tinta)
              var jg = py2 * w + px2; if (jg >= 0 && jg < A.length) { A[jg] *= 1 - 0.28 * smooth(0.86, 1, sh2) * cv; if (dark) dark[jg] *= 0.6; }
            }
          });
          // a veces se desprenden gotitas reales por debajo
          if (!absF && R() < P.beads && lib.byClass.suelta) {
            var nb2 = 1 + Math.floor(R() * 2), yb3 = st.end + rw * 2;
            for (var b2 = 0; b2 < nb2; b2++) {
              var gd = lib.byClass.suelta[Math.floor(R() * lib.byClass.suelta.length)], rr2 = rw * (0.6 + 0.6 * R());
              yb3 += rr2 * (2 + 4 * R());
              stampDrip(gd, cx + (R() - 0.5) * rw, yb3, 2 * rr2, 2 * rr2 * gd.asp, R() < 0.5, function (px3, py3, c3, sh3) { put(px3, py3, c3, 0.5 * P.dark * c3); });
            }
          }
          continue;
        }
        // gota final alargada (lágrima): más pigmento, más oscura
        if (stops || (P.absorb || 0) > 0.4) continue;
        var rb = rw * (1.15 + 0.6 * R()), ryb = rb * (1.15 + 0.4 * R());
        ellipse(ex, y0 + L, rb, ryb, 0.7 * P.dark);
        // brillo: la gota es una lente de tinta; un punto algo más claro arriba a la izquierda
        if (rb > 2.2 && !(P.absorb > 0.25)) {
          var hx0 = ex - rb * 0.35, hy0 = y0 + L - ryb * 0.35, hr = Math.max(0.8, rb * 0.28);
          for (var yh = Math.floor(hy0 - hr); yh <= Math.ceil(hy0 + hr); yh++) for (var xh = Math.floor(hx0 - hr); xh <= Math.ceil(hx0 + hr); xh++) {
            if (xh < 0 || yh < 0 || xh >= w || yh >= h) continue;
            var dh = Math.sqrt((xh - hx0) * (xh - hx0) + (yh - hy0) * (yh - hy0)), kh = clamp01(1 - dh / hr);
            var jh = yh * w + xh; A[jh] *= 1 - 0.35 * kh; if (dark) dark[jh] *= 1 - 0.8 * kh;
          }
        }
        // a veces la gota se rompe en gotitas que caen por debajo
        if (R() < P.beads) {
          var nb = 1 + Math.floor(R() * 3), yb2 = y0 + L + rb * 2;
          for (var b = 0; b < nb; b++) { var rr = rb * (0.35 + 0.4 * R()); yb2 += rr * (2.5 + 4 * R()); ellipse(ex + (R() - 0.5) * rw, yb2, rr, rr * 1.1, 0.5 * P.dark); }
        }
      }
    }
  }

  // ------------------------------------------------------------------ gotas discretas
  // Pinta gotas verticales con raíz ensanchada y bulbo final (pintura que chorrea)
  function paintDrops(A, w, h, U, amount, length, R, noise, wetW, thick, lib) {
    var useLib = lib && lib.items && lib.items.length;
    var tk = thick == null ? 1 : 0.35 + 1.3 * thick;
    var stepX = Math.max(1, Math.round(U * 0.012)), placed = [], maxDrops = 220;
    for (var x = 1; x < w - 1 && placed.length < maxDrops; x += stepX) {
      for (var y = 1; y < h - 2; y++) {
        var i = y * w + x;
        if (A[i] < 0.5 || A[i + w] >= 0.5) continue;
        if (R() > amount * 0.09) continue;
        var wd = U * (0.010 + 0.026 * Math.pow(R(), 1.4)) * tk + 0.3;
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
      var real = useLib ? pickDrip(lib, { lagrima: 0.6, fina: 0.25, serpenteante: 0.15 }, Ld / (2 * wdd), R) : null;
      if (real) {   // gota real del banco
        stampDrip(real, cx, y0 - 1, 2 * wdd, Ld, R() < 0.5, function (px2, py2, c2) {
          if (px2 < 0 || py2 < 0 || px2 >= w || py2 >= h) return;
          var j2 = py2 * w + px2; if (c2 > A[j2]) A[j2] = c2;
          if (wetW) wetW[j2] = Math.max(wetW[j2], c2 * 0.35);
        });
        continue;
      }
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
  function render(input, p, texs) {
    if (texs && texs.base) texs = { desgaste: texs };      // compatibilidad: una sola textura
    texs = texs || {};
    var tex = texs.desgaste || texs.aguada || texs.grano;
    var w = input.w, h = input.h, n = w * h, A0 = input.alpha;
    var U = input.unit * p.effectScale;
    var ox = input.origin.x, oy = input.origin.y;
    var R = rng(p.seed * 7919 + 13);
    var noise = makeNoise(p.seed * 31 + 7);
    var stretch = p.stretch, rotK = Math.pow(1 - Math.abs(stretch), 2);
    var tile = 3 * p.texScale; // en unidades U
    // muestreador de una familia de texturas (desgaste, aguada, grano, rodillo); ruido si falta
    function sampler(which, tileMul, extraStretch, fam) {
      var T = texs[fam || 'desgaste'] || tex;
      var ang = (R() - 0.5) * 2 * Math.PI * rotK + (R() - 0.5) * 0.15;
      var st = Math.max(-1.5, Math.min(1.5, stretch + (extraStretch || 0)));
      var ofx = R(), ofy = R();
      if (!T) { var fq = 1 / (U * tile * tileMul * 0.15); return function (x, y) { return noise.fbm(x * fq + ofx * 97, y * fq + ofy * 97, 3); }; }
      if (p.stochastic !== false) return makeStochastic(which === 'd' ? T.detail : T.base, T.size, U, tile * tileMul, ang, st, ox, oy, (R() * 1e9) | 0);
      return makeSampler(which === 'd' ? T.detail : T.base, T.size, U, tile * tileMul, ang, st, ox, oy, ofx * T.size, ofy * T.size);
    }
    // muestreador en tamaño físico: el tamaño de la textura va en píxeles a la resolución real
    // (300 ppp por defecto), no relativo a la letra — el grano del papel no cambia con el texto
    var physK = (input.pxScale || 1) * ((input.dpi || 300) / 300);
    function physSampler(which, sizePx, fam, extraStretch) {
      return sampler(which, (sizePx * physK) / (U * tile), extraStretch || 0, fam);
    }
    function isoSampler(which, tileMul, fam, ang, st) {   // sin rotación aleatoria (para vetas y rodillos)
      var T = texs[fam] || tex, ofx = R(), ofy = R();
      if (!T) { var fq = 1 / (U * tile * tileMul * 0.15); return function (x, y) { return noise.fbm(x * fq + ofx * 97, y * fq + ofy * 97, 3); }; }
      return makeSampler(which === 'd' ? T.detail : T.base, T.size, U, tile * tileMul, ang || 0, st || 0, ox, oy, ofx * T.size, ofy * T.size);
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
    var PA = p.paper || {}, TI = p.tintas || {}, PS = p.press || {}, WO = p.wood || {}, ME = p.mesh || {}, ST = p.stone || {}, WA = p.wash || {};
    var NEAR = null, LAB = null;
    function getNear() { if (!NEAR) NEAR = nearestSeed(A0, w, h); return NEAR; }
    function getLab() { if (!LAB) LAB = labelLetters(A0, w, h); return LAB; }
    // id de letra (la más cercana) y su escala respecto a U
    function letterOf(i0) { var nn = getNear()[i0]; return nn >= 0 ? getLab().lab[nn] : 0; }
    function letterScale(id) { var L = getLab(); return id > 0 ? Math.sqrt(L.size[id]) / U : 1; }
    var SE = p.seep || {}, WK = p.wick || {}, EN = p.engrave || {}, SPm = p.stamp || {}, LV = p.letters || {};
    var DP = p.damp || {}, AQ = p.aqua || {}, GO = p.gouge || {}, RI = p.rim || {}, SN = p.stencil || {}, CP = p.copy || {}, DR = p.drip || {};

    // 1a · GOTEO desde las letras (antes del papel, para que la gota y la letra compartan borde)
    if (DR.on) {
      var Ddr = new Float32Array(A), DKd = needDark();
      dripsFromLetters(Ddr, w, h, U, DR, R, noise, DKd, texs.drips);
      var ab = DR.absorb || 0;
      if (ab > 0) {
        // papel absorbente: la gota sale de la letra empapada de su pintura (opaca, mismo color)
        // y, según baja, se infiltra en la fibra, se abre un poco y se vuelve más transparente
        var add2 = new Float32Array(n), dist = new Float32Array(n);
        for (i = 0; i < n; i++) add2[i] = Math.max(0, Ddr[i] - A[i]);
        for (x = 0; x < w; x++) { var run = 1e9; for (y = 0; y < h; y++) { i = y * w + x; if (A[i] > 0.5) run = 0; else run += 1; dist[i] = run; } }
        var Lref = U * (0.05 + 0.35 * DR.length);   // la gota se infiltra pronto: el tramo opaco es corto
        // la gota se va abriendo: desenfoque creciente con la distancia a la letra (mezcla de 3 escalas)
        var r1 = 0.8 + U * 0.004 * ab, r2 = 1 + U * 0.018 * ab, r3 = 1.5 + U * 0.04 * ab;
        var B1 = blur(add2, w, h, r1, r1), B2 = blur(add2, w, h, r2, r2 * 0.8), B3 = blur(add2, w, h, r3, r3 * 0.7);
        var tfa1 = physSampler('d', 280, 'fibra', 1.2), tfa2 = physSampler('d', 280, 'fibra', -1.2), tga = physSampler('b', 260, 'granul'), tgb = sampler('b', 1.2, 0, 'lavado');
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
          i = y * w + x;
          if (B3[i] < 0.003 && add2[i] <= 0) continue;
          var tdn = smooth(0, Lref, dist[i]);                      // 0 en la raíz -> 1 abajo
          var e1 = tdn * ab;
          // forma: nítida arriba, cada vez más abierta abajo
          var shp = e1 < 0.5 ? add2[i] + (clamp01(B2[i] * 2.2) - add2[i]) * (e1 * 2) : clamp01(B2[i] * 2.2) + (clamp01(B3[i] * 3) - clamp01(B2[i] * 2.2)) * (e1 * 2 - 1);
          shp = Math.max(shp, add2[i] * (1 - e1));
          // densidad: misma tinta que la letra arriba; abajo diluida, con lavado y granulación
          var dens = 1 - ab * 0.65 * tdn;
          dens *= 1 - e1 * 0.35 * (1 - tgb(x, y)) - e1 * 0.25 * smooth(0.5, 0.9, 1 - tga(x, y));
          // borde de acuarela: el pigmento se acumula en el contorno de la parte abierta
          var rimA = clamp01((clamp01(B1[i] * 1.5) - clamp01(B3[i] * 2.4)) * 2.5) * e1;
          var fbr = Math.max(smooth(0.55, 0.92, tfa1(x, y)), smooth(0.55, 0.92, tfa2(x, y)));
          var wick = clamp01(B3[i] * 3) * fbr * 0.35 * e1;
          var vv = Math.max(shp * clamp01(dens + rimA * 0.4), wick);
          if (vv > A[i]) A[i] = vv;
          DKd[i] = Math.max(DKd[i] * (1 - e1), rimA * 0.5);
        }
        if ((DR.runs || 0) > 0) A = waterRuns(A, w, h, U, DR, R, noise, needPool(), tgb, tga);
      } else A = Ddr;
      shape = A;
    }

    // 1b · Fibras del papel: la tinta se escapa por las fibras (feathering) ----
    if (PA.on && PA.feather > 0) {
      var frR = U * 0.014 * PA.feather + 0.8, Af = blur(A, w, h, frR, frR);
      var tfa = physSampler('d', 260, 'fibra', 1.3), tfb = physSampler('d', 340, 'fibra', -1.3), tfc = physSampler('d', 180, 'grano');
      var Fe = new Float32Array(A);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        var af = Af[i];
        if (af < 0.004 || (A[i] > 0.995 && af > 0.995)) continue;
        var fib = Math.max(smooth(0.8, 0.93, tfa(x, y)), smooth(0.8, 0.93, tfb(x, y)), smooth(0.86, 0.96, tfc(x, y)) * 0.8);
        var outv = smooth(0.03, 0.5, af) * fib * PA.feather;               // pelillos de tinta hacia fuera
        var inner = (1 - smooth(0.5, 0.97, af)) * (1 - fib) * 0.35 * PA.feather; // el borde se abre donde no hay fibra
        Fe[i] = Math.max(A[i] * (1 - inner), outv * 0.92);
      }
      A = Fe; shape = A;
    }

    // 1b2 · TINTA CORRIDA (realista): la tinta se escapa poco y de forma muy desigual por las
    // fibras, pegada al trazo; en algunos tramos llega más lejos y deja una línea más oscura.
    if (SE.on && SE.amount > 0) {
      var Ainv = new Float32Array(n);
      for (i = 0; i < n; i++) Ainv[i] = 1 - A[i];
      var Dout = distInside(Ainv, w, h, 0.5, true), reachMax = U * (0.008 + 0.09 * SE.reach);
      var gR = grid(function (u, v) { return noise.fbm(u * 1.7 + 41, v * 1.7 - 13, 3); });
      var tsf1 = sampler('d', 0.28, 1.3, 'fibra'), tsf2 = sampler('d', 0.28, -1.3, 'fibra'), tsb = sampler('b', 0.7, 0, 'fibra');
      var As2 = new Float32Array(A), PS2 = needPool();
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        var dO = Dout[i];
        if (dO <= 0 || dO > reachMax * 1.6) continue;
        var patch = Math.pow(smooth(1 - SE.amount - 0.05, 1 - SE.amount + 0.35, gR(x, y)), 1.4);
        if (patch <= 0.001) continue;
        var fbm2 = Math.max(smooth(0.55, 0.92, tsf1(x, y)), smooth(0.55, 0.92, tsf2(x, y)));
        var reach = reachMax * patch * (0.35 + 1.1 * fbm2);
        if (dO >= reach) continue;
        var tt3 = dO / reach;
        var dens = Math.exp(-Math.pow(tt3 * 2.2, 1.35)) * (1 - (1 - SE.density) * smooth(0.15, 0.9, tt3)) * (0.85 + 0.15 * tsb(x, y));
        var front = SE.front * smooth(0.65, 0.92, tt3) * (1 - smooth(0.94, 1, tt3)) * smooth(0.3, 0.8, patch);
        var v3 = Math.max(dens, front * 0.55);
        if (v3 > As2[i]) As2[i] = v3;
        if (front > 0) PS2[i] = Math.max(PS2[i], front * 0.8);
      }
      A = As2; shape = A;
    }

    // 1b2b · TINTA CORRIDA por capilaridad (red de fibras + distancia por dentro del papel) ----
    // fiber: pelillos finos por las fibras.  wet: papel mojado, la tinta se abre diluida hasta un
    // frente fibroso más cargado.  smear: la tinta fresca arrastrada hacia un lado (estrías).
    if (WK.on && WK.amount > 0) {
      var wMode = WK.mode || 'fiber', wAmt = WK.amount, wRe = WK.reach == null ? 0.5 : WK.reach;
      var Ainv2 = new Float32Array(n);
      for (i = 0; i < n; i++) Ainv2[i] = 1 - A[i];
      var Dw = distInside(Ainv2, w, h, 0.5, true);
      // alcance en px de fibra; zonas donde el papel chupa más (encolado desigual)
      var rW = wMode === 'wet' ? U * (0.015 + 0.09 * wRe) + 3 * physK : U * (0.008 + 0.06 * wRe) + 3 * physK;
      var bgC = wMode === 'wet' ? 2.4 : 13;
      var gZone = grid(function (u, v) { return noise.fbm(u * 1.5 + 211, v * 1.5 - 57, 3); });
      var zMin = wMode === 'fiber' ? 0.02 : 0.08, zoneAt = function (x2, y2) { return zMin + (1 - zMin) * smooth(0.62 - 0.55 * wAmt, 0.85 - 0.35 * wAmt, gZone(x2, y2)); };
      var lim = rW * 2.4 / 1 + 2, band = new Uint8Array(n), act = new Uint8Array(n);
      for (i = 0; i < n; i++) { var dq = Dw[i]; band[i] = dq < lim + 2 && dq < 1e8 ? 1 : 0; act[i] = dq > 0 && dq < lim && dq < 1e8 ? 1 : 0; }
      var Fw = fiberNet(w, h, band, { len: physK * 26, cover: WK.cover || (wMode === 'wet' ? 0.5 : 0.1), thick: wMode === 'fiber' ? 0.07 : 0.2 }, R, zoneAt);
      var tPf = physSampler('b', 220, 'granul');
      var Cw = new Float32Array(n), Gw = new Float32Array(n);
      for (i = 0; i < n; i++) {
        if (!band[i]) { Cw[i] = 1e3; Gw[i] = 1e9; continue; }
        var yq = (i / w) | 0, xq = i - yq * w;
        // formación del papel: el fondo también es algo irregular (nubes de fibra más densas)
        var bgv = bgC * (0.75 + 0.5 * tPf(xq, yq)) / (0.4 + 1.2 * zoneAt(xq, yq));
        Cw[i] = 1 / (1 / bgv + Fw[i] * 1.1);
        Gw[i] = A[i] >= 0.5 ? 0 : 1e9;
      }
      geodesic(Gw, Cw, w, h, act, 8);
      var Aw = new Float32Array(A), PW = needPool(), tgw = physSampler('b', 260, 'granul'), tlw = sampler('b', 0.9, 0, 'lavado');
      if (wMode === 'smear') {
        // a) BORRÓN: una o varias pasadas de dedo/mano sobre la tinta fresca, hacia un lado.
        //    Solo donde pasó el dedo (bandas en la dirección del arrastre). La tinta se TRANSPORTA:
        //    se recoge de la letra (más de los trazos gruesos) y se va depositando cada vez más
        //    diluida; pegado a la letra queda denso y luego un rastro largo con estrías de la piel
        //    y del papel. La letra pierde tinta por donde pasó el dedo (estrías claras).
        var sa = (WK.dir == null ? 0.06 : WK.dir) * Math.PI, sdx2 = Math.cos(sa), sdy2 = Math.sin(sa);
        var Ls = U * (0.035 + 0.25 * (WK.drag == null ? 0.5 : WK.drag)), sMax = Ls * 3.2;
        var Pm = new Float32Array(n), Str = new Float32Array(n), sBand = new Uint8Array(n);
        for (i = 0; i < n; i++) sBand[i] = Dw[i] < sMax ? 1 : 0;
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
          i = y * w + x; if (!sBand[i]) continue;
          var perp = (x - ox) * -sdy2 + (y - oy) * sdx2, along = (x - ox) * sdx2 + (y - oy) * sdy2;
          // estrías: crestas finas de la piel / del papel y otras más anchas
          var st1 = noise(perp / (physK * 2.6) + 17.3, along / (U * 2) + 3.1), st2 = noise(perp / (U * 0.035) - 4.2, along / (U * 1.5) + 8.7);
          Str[i] = clamp01(0.15 + 0.55 * st1 + 0.5 * st2);
          // presión del dedo: bandas a lo largo del arrastre, con bordes blandos y que empiezan y acaban
          var bn = noise(perp / (U * 0.42) + 2.2, along / (U * 3.5) + 1.9) * 0.8 + noise(perp / (U * 0.12) + 7.7, 0.3) * 0.2;
          Pm[i] = smooth(0.74 - 0.4 * wAmt, 0.88 - 0.32 * wAmt, bn) * (0.55 + 0.45 * st2);   // pocas pasadas, presión suave
        }
        // tinta recogida (la letra) y transporte: suma con decaimiento exponencial (en log pasos)
        var Tsum = new Float32Array(n), Tmax = new Float32Array(n), aL = Math.exp(-1 / Math.max(2, Ls)), aS = Math.exp(-1 / Math.max(1.5, Ls * 0.12));
        for (i = 0; i < n; i++) { var pk = A[i] * Pm[i]; Tsum[i] = pk; Tmax[i] = pk; }
        for (var stp = 1; stp < sMax; stp *= 2) {
          var Ns = new Float32Array(Tsum), Nm = new Float32Array(Tmax), fa = Math.pow(aL, stp), fm = Math.pow(aS, stp);
          for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
            i = y * w + x; if (!sBand[i]) continue;
            var sxq = x - sdx2 * stp, syq = y - sdy2 * stp;
            Ns[i] += sampleBil(Tsum, w, h, sxq, syq) * fa;
            var vm = sampleBil(Tmax, w, h, sxq, syq) * fm; if (vm > Nm[i]) Nm[i] = vm;
          }
          Tsum = Ns; Tmax = Nm;
        }
        for (i = 0; i < n; i++) {
          var a0 = A[i], yq2 = (i / w) | 0, xq2 = i - yq2 * w, pr = Pm[i];
          if (a0 >= 0.5) {   // la letra pierde tinta por donde pasó el dedo, en estrías
            if (pr > 0) Aw[i] = a0 * (1 - 0.3 * pr * (0.35 + 0.65 * (1 - Str[i])));
            continue;
          }
          if (!sBand[i]) continue;
          var dense = Tmax[i];                                    // pegado a la letra: denso, casi su tinta
          var trail = Tsum[i] * (1 - aL) * 1.25;                   // el rastro: depende de cuánta tinta había
          var tk = smooth(0, Math.max(2, Ls * 0.35), Dw[i]);
          trail *= (0.3 + 0.7 * Str[i]) * (1 - 0.22 * smooth(0.5, 0.9, 1 - tgw(xq2, yq2)));   // estrías y papel que coge el pigmento a trozos
          trail = Math.min(0.6, trail);
          var vv = Math.max(dense * (1 - 0.35 * tk * (1 - Str[i])), trail);
          if (vv > Aw[i]) Aw[i] = vv;
        }
        // y un poco de capilaridad en el borde, como en todo papel
        for (i = 0; i < n; i++) { if (A[i] >= 0.5) continue; var gv0 = Gw[i]; if (gv0 > 1e8) continue; var fv0 = Math.exp(-Math.pow(gv0 / (rW * 0.35), 1.6)); if (fv0 > Aw[i]) Aw[i] = fv0; }
      } else if (wMode === 'wet') {
        // b) papel mojado: junto al borde la tinta de la letra; luego diluida y desigual; el frente
        //    se para donde llegó el agua (siguiendo fibras) y allí se acumula el pigmento
        var fr = WK.front == null ? 0.5 : WK.front;
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
          i = y * w + x;
          if (A[i] >= 0.5) continue;
          var gv = Gw[i]; if (gv > 1e8) continue;
          var zw2 = zoneAt(x, y), rl = rW * (0.04 + 1.1 * zw2 * zw2);
          var tw = gv / rl;
          if (tw > 1.15) continue;
          // misma tinta junto a la letra; luego el tinte diluido, moteado, que se para de golpe
          // en un borde fibroso donde se secó el agua (sin aro continuo)
          var mott = (0.65 + 0.35 * tlw(x, y)) * (1 - 0.45 * smooth(0.4, 0.85, 1 - tgw(x, y)));
          var grad = (0.3 + 0.7 * Math.exp(-Math.pow(tw / 0.28, 1.4))) * (tw < 0.2 ? 1 : mott + (1 - mott) * smooth(0.35, 0.2, tw));
          var stop = smooth(1.0, 0.94, tw);
          var ring = fr * smooth(0.85, 0.98, tw) * stop * smooth(0.5, 0.85, zw2) * smooth(0.4, 0.8, tlw(x, y));
          var vW2 = (grad + (1 - grad) * ring * 0.35) * stop;
          if (vW2 > Aw[i]) Aw[i] = vW2;
          if (ring > 0.02) PW[i] = Math.max(PW[i], ring * 0.6);
        }
      } else {
        // c) pelillos: misma tinta que la letra junto al borde, se afinan hacia la punta
        for (i = 0; i < n; i++) {
          if (A[i] >= 0.5) continue;
          var gv2 = Gw[i]; if (gv2 > 1e8) continue;
          var fv = Math.exp(-Math.pow(gv2 / rW, 1.7));
          if (fv > Aw[i]) Aw[i] = fv;
        }
      }
      // el borde antialias de la letra no puede quedar más claro que la tinta que ya ha salido
      if (wMode !== 'smear') for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
        i = y * w + x; if (A[i] < 0.5 || A[i] >= 0.999) continue;
        var mN = 0; if (A[i - 1] < 0.5) mN = Math.max(mN, Aw[i - 1]); if (A[i + 1] < 0.5) mN = Math.max(mN, Aw[i + 1]); if (A[i - w] < 0.5) mN = Math.max(mN, Aw[i - w]); if (A[i + w] < 0.5) mN = Math.max(mN, Aw[i + w]);
        if (mN > Aw[i]) Aw[i] = mN;
      }
      A = Aw; shape = A;
    }

    // 1b3 · XILOGRAFÍA (carteles grabados): plancha negra con líneas de talla y sombra
    var keyPlate = null, colorPlate = null;
    if (EN.on) {
      var Mh = new Float32Array(n);
      for (i = 0; i < n; i++) Mh[i] = smooth(0.42, 0.58, A[i]);
      var Kc = EN.mode === 'scribble' ? engraveScribble(Mh, w, h, U, EN, p.seed, noise, ox, oy, invU) : (EN.mode === 'across' || EN.mode === 'contour') ? engraveDirectional(Mh, w, h, U, EN, p.seed, noise, ox, oy, invU) : engraveCuts(Mh, w, h, U, EN, p.seed, noise, ox, oy, invU);
      var inkE = (p.out.color && p.out.color !== 'original') ? hexToRgb(p.out.color) : (input.ink || [0, 0, 0]);
      var twoE = EN.two && (0.299 * inkE[0] + 0.587 * inkE[1] + 0.114 * inkE[2]) > 95;
      if (twoE) {   // la talla queda como líneas negras sobre la letra de color (como en los carteles)
        for (i = 0; i < n; i++) Kc[i] = Mh[i] > 0.02 ? clamp01(Mh[i] - Kc[i]) : 0;
      }
      var dirE = (EN.light || 0) >= 0 ? 1 : -1, sdx = -dirE * U * 0.04 * EN.shadow, sdy = U * 0.03 * EN.shadow;
      if (EN.shadow > 0) for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        var sh = sampleBil(Mh, w, h, x - sdx, y - sdy) * (1 - Mh[i]);
        if (sh > Kc[i]) Kc[i] = sh;
      }
      if (twoE) {
        var mrx = U * 0.025 * EN.misreg, mry = -U * 0.012 * EN.misreg;
        colorPlate = new Float32Array(n);
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) colorPlate[y * w + x] = sampleBil(Mh, w, h, x - mrx, y - mry);
        keyPlate = Kc;
        A = colorPlate;
      } else A = Kc;
      shape = A;
    }

    // 1c · ACUARELA pintada a mano, letra a letra. Bordes rectos y cortantes (solo deformados,
    // nunca redondeados); pigmento que sigue la dirección del trazo como la pincelada; aro de
    // pigmento seco en el borde; cada letra con su carga, su deriva y su humedad.
    if (AQ.on) {
      var Ms = new Float32Array(n);
      for (i = 0; i < n; i++) Ms[i] = A[i];                              // forma nítida (sin desenfoque)
      // borde cortante con pequeñas irregularidades del pincel (desplazamiento, no suavizado)
      var tlvE = sampler('d', 0.35, 0, 'lavado'), gE = grid(function (u, v) { return noise.fbm(u * 3.5 + 7, v * 3.5 - 2, 2); });
      var dmax = U * 0.012 * AQ.edgeWobble + 0.4, Aq = new Float32Array(n);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        var dxq = (gE(x, y) - 0.5) * 2 * dmax + (tlvE(x, y) - 0.5) * dmax * 0.6;
        var dyq = (gE(y * 0.7, x * 0.7) - 0.5) * 2 * dmax;
        var v0 = sampleBil(Ms, w, h, x + dxq, y + dyq);
        Aq[i] = smooth(0.46, 0.54, v0);                                    // corte seco y nítido
      }
      var SF = strokeField(Aq, w, h, U), Dq = SF.D;
      var rimW = U * (0.006 + 0.016 * AQ.rimWidth) + 0.9;
      var gGlz = grid(function (u, v) { return noise.fbm(u * 0.9 + 33, v * 0.9 - 61, 3); });
      var gLoad = grid(function (u, v) { return noise.fbm(u * 0.7 + 3, v * 0.7 + 19, 3); }), gLoad2 = grid(function (u, v) { return noise.fbm(u * 2.2 - 8, v * 2.2 + 4, 2); });
      var gDry = grid(function (u, v) { return noise.fbm(u * 1.1 + 57, v * 1.1 - 23, 3); });
      // capas de densidad (Bousseau): papel (grano), flujo turbulento (manchas grandes), dispersión (fina)
      var tPap = physSampler('b', 420, 'grano'), tFlow = sampler('b', 3.2, 0, 'lavado'), tFlow2 = sampler('b', 1.3, 0, 'lavado');
      var tDisp = physSampler('d', 160, 'granul'), tfl = sampler('b', 1.1, 0, 'floracion'), tfd = sampler('d', 1.1, 0, 'floracion');
      var PQ = needPool(), cache = {};
      // grosor medio de cada letra -> ancho del pincel
      var Lb = getLab(), sumH = new Float64Array(Lb.count + 1), cntH = new Float64Array(Lb.count + 1);
      for (i = 0; i < n; i++) if (Aq[i] > 0.5) { var li = letterOf(i); sumH[li] += SF.Hw[i]; cntH[li]++; }
      function letterParams(id) {
        var c = cache[id]; if (c) return c;
        var h1 = hash(id * 101 + p.seed), h2 = hash(id * 211 + 7 + p.seed), h3 = hash(id * 307 + 3 + p.seed), h4 = hash(id * 401 + 9 + p.seed);
        var Hm = cntH[id] ? sumH[id] / cntH[id] : U * 0.1;
        c = { load: 1 + AQ.letterVar * (h1 - 0.5) * 0.8, bw: Math.max(4, 2 * Hm * (0.55 + 0.35 * h2)), bloom: h4 < AQ.blooms * 0.7, ph: h3 * 100, h3: h3 };
        cache[id] = c; return c;
      }
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        var sq = Aq[i];
        if (sq <= 0.002) { A[i] = 0; continue; }
        var lid = letterOf(i), LP = letterParams(lid), dq = Dq[i];
        // carga de pigmento: campo suave y orgánico (sin direcciones ni bandas -> sin líneas rectas)
        var alongN = gLoad(x, y) * 0.7 + gLoad2(x, y) * 0.3;
        var load = LP.load * (0.78 + 0.5 * alongN);
        // densidad en tres capas
        var pg = tPap(x, y);
        var dn = AQ.density * load * (1 + AQ.variation * ((tFlow(x, y) - 0.5) * 0.75 + (tFlow2(x, y) - 0.5) * 0.35) + (tDisp(x, y) - 0.5) * 0.18);
        // veladuras: una segunda pasada cubre parte de la letra; donde acaba deja su borde de secado
        var gz = gGlz(x, y) + (tDisp(x, y) - 0.5) * 0.02, thrG = 0.56 + (LP.h3 - 0.5) * 0.12;
        var inG = smooth(thrG - 0.006, thrG + 0.006, gz);
        var lineG = inG * (1 - smooth(thrG, thrG + 0.035, gz));
        dn *= 1 + inG * 0.42 * AQ.variation;
        // borde oscurecido gradual del contorno; más marcado cuanto más diluida está la letra
        var rimAmp = AQ.rim * 0.6 * (1.35 - 0.5 * clamp01(load));
        var rim = Math.exp(-dq / rimW) * rimAmp + lineG * 0.25 * AQ.rim;
        dn *= 1 - 0.22 * AQ.rim * Math.exp(-dq / (rimW * 5)) * (1 - Math.exp(-dq / rimW));   // migración
        // granulación: el pigmento se asienta en los valles del papel
        var valley = smooth(0.45, 0.15, pg);
        dn *= 1 + AQ.granul * (0.55 * valley - 0.3 * smooth(0.6, 0.9, pg));
        // floraciones en algunas letras
        var bline = 0;
        if (LP.bloom) { var fv = tfl(x, y), bl = smooth(0.55, 0.6, fv); dn *= 1 - 0.45 * bl; bline = smooth(0.1, 0.02, tfd(x, y)) * bl; }
        var aOut = clamp01(dn + (0.96 - dn) * Math.min(1, rim) + bline * 0.4);
        // pincel seco al final de algunas pasadas: la tinta solo en las crestas del papel
        if (LP.h3 < AQ.dry) {
          var dryZ = smooth(0.4, 0.22, gDry(x, y));
          if (dryZ > 0) aOut *= 1 - dryZ * smooth(0.62, 0.42, pg);
        }
        A[i] = sq * aOut;
        PQ[i] = Math.max(PQ[i], Math.min(1, rim) * 0.7 + bline * 0.5 + valley * AQ.granul * 0.3 + inG * 0.15);
      }
      shape = A;
    }

    // 1d · HUMEDAD: gotas de agua sobre la impresión. Donde el agua toca, la tinta
    // se disuelve en el papel: nube granulosa que sigue la fibra, densa junto a la
    // letra, que rellena los huecos y se detiene en el límite del agua. Fuera, nítido.
    if (DP.on && DP.amount > 0) {
      // 1) dónde ha caído el agua: gotas y charcos con borde definido (no un halo general)
      var Wd = new Float32Array(n), Rd = rng(p.seed * 4111 + 17), nearD = blur(A0, w, h, U * 0.25, U * 0.25);
      var areaW = w * h, target = DP.amount * 0.55 * areaW, got = 0, tries = 0;
      var tzw = sampler('b', 1.2, 0, 'floracion'), gzb = grid(function (u, v) { return noise.fbm(u * 4 + 13, v * 4 - 7, 4); });
      var drops = [];
      if (DP.global) { for (i = 0; i < n; i++) Wd[i] = 1; target = 0; }
      while (got < target && tries < 4000 && drops.length < 160) {
        tries++;
        var cxD = Rd() * w, cyD = Rd() * h, nv0 = nearD[(cyD | 0) * w + (cxD | 0)];
        if (Rd() > 0.15 + 0.85 * smooth(0.02, 0.4, nv0)) continue;          // las gotas caen sobre todo donde hay tinta
        // tamaños muy variados: muchas pequeñas, pocas grandes
        var rD = U * (0.05 + 0.9 * DP.size * Math.pow(Rd(), 2.6));
        drops.push([cxD, cyD, rD, Rd() * 6.28]); got += Math.PI * rD * rD;
        // a veces una gota grande salpica gotitas alrededor
        if (rD > U * 0.25 && Rd() < 0.6) for (var sd2 = 0; sd2 < 3; sd2++) { var aS = Rd() * 6.28, dS2 = rD * (1.2 + Rd()); drops.push([cxD + Math.cos(aS) * dS2, cyD + Math.sin(aS) * dS2, rD * (0.08 + 0.15 * Rd()), Rd() * 6.28]); }
      }
      for (var q = 0; q < drops.length; q++) {
        var Dq2 = drops[q], rr = Dq2[2], ext = rr * 1.9 + 2;
        var xa2 = Math.max(0, Math.floor(Dq2[0] - ext)), xb2 = Math.min(w - 1, Math.ceil(Dq2[0] + ext));
        var ya2 = Math.max(0, Math.floor(Dq2[1] - ext)), yb2 = Math.min(h - 1, Math.ceil(Dq2[1] + ext));
        for (y = ya2; y <= yb2; y++) for (x = xa2; x <= xb2; x++) {
          var dxw = x - Dq2[0], dyw = y - Dq2[1], dd2 = Math.sqrt(dxw * dxw + dyw * dyw);
          var an = Math.atan2(dyw, dxw);
          // borde orgánico: ondulación lenta + dentado fino de la fibra
          var el = 1 + 0.35 * Math.cos(2 * (an - Dq2[3]));                     // algo alargada
          var rEdge = rr * el * (0.7 + 0.45 * noise(Math.cos(an) * 1.6 + q * 7.1, Math.sin(an) * 1.6 + Dq2[3]) + 0.3 * (gzb(x, y) - 0.5) + 0.22 * (tzw(x, y) - 0.5));
          var vW = smooth(rEdge + 0.8, rEdge - 0.8, dd2);
          i = y * w + x; if (vW > Wd[i]) Wd[i] = vW;
        }
      }
      // distancia dentro del agua (para la franja sin color y la marca del borde)
      var Dz = distInside(Wd, w, h, 0.5, true);
      // abombado del papel mojado: desplaza muy poco la letra solo dentro del agua
      var gck = grid(function (u, v) { return noise.fbm(u * 1.4 + 91, v * 1.4 - 17, 2); }), gck2 = grid(function (u, v) { return noise.fbm(u * 1.4 - 41, v * 1.4 + 23, 2); });
      var Ack = new Float32Array(n), ckA = U * 0.014 * (DP.cockle == null ? 0.5 : DP.cockle);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) { i = y * w + x; var wk = Wd[i]; Ack[i] = wk > 0 ? sampleBil(A, w, h, x + (gck(x, y) - 0.5) * 2 * ckA * wk, y + (gck2(x, y) - 0.5) * 2 * ckA * wk) * wk + A[i] * (1 - wk) : A[i]; }
      A = Ack;
      // 2) la tinta de la letra se extiende por el papel mojado: misma intensidad junto al borde,
      //    se desvanece al alejarse; avanza por las fibras y en el papel húmedo cae algo hacia abajo
      var reachD = U * (0.012 + (DP.global ? 0.13 : 0.09) * DP.spread) * (0.45 + 0.8 * DP.cloud);
      var tfg1 = physSampler('d', 220, 'fibra', 0.5), tfg2 = physSampler('d', 220, 'fibra', -0.5);
      var tgr2 = physSampler('b', 260, 'granul'), tlift = sampler('b', 0.7, 0, 'lavado');
      var gPatch = grid(function (u, v) { return noise.fbm(u * 1.6 + 7, v * 1.6 - 33, 3); });
      var Ed = inkSpread(A, w, h, function (x2, y2, i2) {
        var wv2 = Wd[i2]; if (wv2 <= 0.01) return 0;
        var fb = Math.max(tfg1(x2, y2), tfg2(x2, y2));
        return reachD * wv2 * (0.25 + 1.1 * smooth(0.25, 0.75, gPatch(x2, y2))) * (0.7 + 0.55 * smooth(0.4, 0.9, fb));
      }, function (x2, y2) { return tgr2(x2, y2); }, 0.55, DP.global ? 0.9 : 0.3);
      var tideW = U * 0.008 + 1.2, Ad = new Float32Array(n), PDm = needPool(), Bf = blur(A, w, h, U * 0.08, U * 0.08);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        var a0 = A[i], wv = Wd[i];
        if (wv <= 0.003) { Ad[i] = a0; continue; }
        // la letra se lava a ratos por dentro (el agua levanta pigmento)
        var lift = DP.lift * 0.6 * smooth(0.55, 0.85, tlift(x, y)) * wv;
        var wet = Math.max(a0 * (1 - lift), Ed[i] * (1 - lift * 0.5));
        // marca del borde del agua (solo en gotas, no en papel húmedo general)
        if (!DP.global) {
          var dzv = Dz[i], edgeW = Math.exp(-dzv / tideW) * smooth(0.0, 1.0, dzv);
          var tide = DP.tide * edgeW * smooth(0.02, 0.25, Bf[i]);
          wet = wet + (1 - wet) * tide * 0.5;
          if (tide > 0.01) PDm[i] = Math.max(PDm[i], tide * 0.7);
        }
        Ad[i] = a0 + (wet - a0) * wv;
      }
      A = Ad; shape = A;
    }

    // 1d · EMPAPADO (Humedad): dos modos sacados de referencias reales
    //  'paper': tinta sobre papel empapado: núcleo negro, borde peludo y denso (fibra), zonas grises
    //           granulosas donde el papel chupó, huecos blancos y una pincelada gris diluida encima.
    //  'water': letras sobre una superficie con agua: la tinta flota y se deforma, borde blando,
    //           vetas jaspeadas claras, mancha de agua gris con borde seco y sedimento, burbujas
    //           (anillo oscuro, centro gris y brillo) y motitas alrededor.
    var SK = p.soak || {};
    if (SK.on && (SK.amount || 0) > 0) {
      var skA = Math.min(1.6, SK.amount), skW = SK.mode === 'water';
      var tsg = physSampler('b', 240, 'granul'), tsl = sampler('b', 0.8, 0, 'lavado'), tsf = physSampler('d', 260, 'fibra', 1.1);
      var gS1 = grid(function (u, v) { return noise.fbm(u * 1.3 + 13, v * 1.3 - 51, 3); });
      var gS2 = grid(function (u, v) { return noise.fbm(u * 3.2 - 7, v * 3.2 + 19, 3); });
      var gWx = grid(function (u, v) { return noise.fbm(u * 0.9 + 101, v * 0.9 + 7, 3); });
      var gWy = grid(function (u, v) { return noise.fbm(u * 0.9 - 33, v * 0.9 + 61, 3); });
      var Ao = new Float32Array(n), sh2;
      if (skW) {
        // SOBRE AGUA: la tinta flota en una lámina de agua sobre la superficie.
        //  - la letra se deforma un poco con el flujo (sigue legible); el borde es nítido en unas
        //    zonas y se abre en degradado fotográfico en otras.
        //  - por dentro, láminas de tinta: macizos negros y velos grises transparentes con su propio
        //    contorno fino más oscuro (donde el agua dejó la tinta) y remolinos.
        //  - fuera, costra de sedimento: gris claro granuloso con motitas y borde fino.
        //  - burbujas con anillos concéntricos, centro y brillo; la tinta se acumula alrededor.
        //  - salpicaduras: puntitos negros sueltos.
        var filmK = SK.film == null ? 0.7 : SK.film, crustK = SK.crust == null ? 0.6 : SK.crust, bubK = SK.bubbles == null ? 0.6 : SK.bubbles;
        var amp = U * 0.045 * skA, Aw2 = new Float32Array(n);
        var gWa = grid(function (u, v) { return noise.fbm(u * 2.2 + 33, v * 2.2 - 8, 3); });
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
          i = y * w + x;
          var wx = (gWx(x, y) - 0.5) * 2 + (gWa(x, y) - 0.5) * 0.8, wy = (gWy(x, y) - 0.5) * 2 + (gWa(x + 91, y) - 0.5) * 0.8;
          Aw2[i] = sampleBil(A, w, h, x + wx * amp, y + wy * amp);
        }
        var Ab1 = blur(Aw2, w, h, U * 0.006, U * 0.006), Ab2 = blur(Aw2, w, h, U * 0.04, U * 0.04), Ab3 = blur(Aw2, w, h, U * 0.1, U * 0.1);
        var Ain5 = new Float32Array(n); for (i = 0; i < n; i++) Ain5[i] = 1 - Aw2[i];
        var Din5 = distInside(Aw2, w, h, 0.5, true); for (i = 0; i < n; i++) if (Din5[i] > 1e8) Din5[i] = 0;
        var Dout5 = distInside(Ain5, w, h, 0.5, true);
        var gSoft = grid(function (u, v) { return noise.fbm(u * 1.4 - 61, v * 1.4 + 5, 3); });
        var gFilm = grid(function (u, v) { var q1 = noise.fbm(u * 1.8 + 7, v * 1.8, 3), q2 = noise.fbm(u * 1.8 - 3, v * 1.8 + 11, 3); return noise.fbm(u * 2.6 + q1 * 2.5, v * 2.6 + q2 * 2.5, 4); });
        var gSw = grid(function (u, v) { return noise.fbm(u * 6 + 17, v * 6 - 2, 3); });
        var gCr = grid(function (u, v) { return noise.fbm(u * 1.6 + 201, v * 1.6 - 77, 3); });
        var PW2 = needPool();
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
          i = y * w + x;
          // borde: nítido o abierto según la zona
          var soft = smooth(0.45, 0.7, gSoft(x, y));
          var edgeA = smooth(0.3, 0.7, Ab1[i]) * (1 - soft) + Math.pow(smooth(0.05, 0.85, Ab2[i]), 1.3) * soft;
          // láminas de tinta dentro
          var fv = gFilm(x, y), thin = Math.pow(smooth(0.46, 0.64, fv), 1.4) * filmK;  // velo gris en degradado (lámina que se adelgaza)
          var cont = Math.exp(-Math.pow((fv - 0.47) / 0.005, 2)) * filmK * smooth(0.4, 0.7, gSw(x + 40, y));          // contorno fino de la lámina
          var swirl = (gSw(x, y) - 0.5) * 0.5 * thin;
          var dens = 1 - thin * (0.62 + 0.18 * tsl(x, y)) - swirl + cont * 0.45;
          // reticulado de la tinta al secar (red de crestas finas) y granulación en las zonas finas
          var u7 = (x - ox) * invU, v7 = (y - oy) * invU;
          var ret = Math.abs(noise.fbm(u7 * 9 + gWx(x, y) * 2, v7 * 9 + gWy(x, y) * 2, 3) - 0.5);
          var retL = smooth(0.035, 0.0, ret) * (0.3 + 0.7 * thin);
          var gran = smooth(0.5, 0.85, 1 - tsg(x, y)) * thin * 0.35;
          dens = dens - gran + retL * 0.35;
          // la tinta se acumula en el borde de la letra (anillo de secado por dentro)
          var rimW = Math.exp(-Math.max(0, Din5[i]) / (U * 0.012)) * (Din5[i] > 0 ? 0.35 : 0) * (0.5 + 0.5 * gSw(x, y));
          dens += rimW;
          var inkW = edgeA * clamp01(dens);
          // costra de sedimento fuera de la letra
          var dO5 = Dout5[i] > 1e8 ? U * 3 : Dout5[i];
          var reach = U * (0.02 + 0.14 * crustK) * Math.pow(smooth(0.42, 0.78, gCr(x, y)), 1.5);
          var inCrust = smooth(reach + 1.5, reach - 1.5, dO5) * (Aw2[i] < 0.5 ? 1 : 0);
          var grit = smooth(0.5, 0.85, 1 - tsg(x, y)), dots = hash(i * 13 + 7) < 0.05 ? 0.35 : 0;
          var crust = inCrust * (0.06 + 0.14 * tsl(x, y) + 0.16 * grit + dots) * (0.6 + 0.4 * gSw(x, y + 70));
          var crustEdge = Math.exp(-Math.pow((dO5 - reach) / 1.1, 2)) * smooth(0.45, 0.8, gCr(x, y)) * crustK * 0.5;
          // halo gris suave donde el agua llevó tinta
          var halo5 = smooth(0.02, 0.35, Ab3[i]) * 0.22 * soft;
          var tl5 = Ab3[i] * 14 + gSw(x, y) * 1.5, tlf = Math.abs(tl5 - Math.round(tl5));
          halo5 = Math.max(halo5, smooth(0.07, 0.0, tlf) * smooth(0.01, 0.12, Ab3[i]) * smooth(0.6, 0.2, Ab3[i]) * 0.3 * smooth(0.4, 0.7, gCr(x + 30, y)) * (Aw2[i] < 0.5 ? 1 : 0));
          var vW = Math.max(inkW, crust + crustEdge, halo5);
          Ao[i] = clamp01(vW);
          if (cont > 0.2 || crustEdge > 0.1) PW2[i] = Math.max(PW2[i], Math.max(cont, crustEdge) * 0.6);
        }
        // burbujas: anillos concéntricos, centro algo más claro, brillo; tinta acumulada alrededor
        var nb3 = Math.round(bubK * 1.6 * Math.max(1, (w * h) / (U * U * 3)));
        for (var bq = 0, tr = 0; bq < nb3 && tr < nb3 * 40; tr++) {
          var bx = R() * w, by = R() * h, bi = (by | 0) * w + (bx | 0);
          if (Ab1[bi] < 0.6) continue;
          bq++;
          var br = U * (0.02 + 0.07 * Math.pow(R(), 1.6)), ha = -2.3 + (R() - 0.5) * 0.6, rings = 1 + Math.floor(R() * 3);
          for (var yb = Math.max(0, (by - br * 3) | 0); yb < Math.min(h, by + br * 3); yb++) for (var xb = Math.max(0, (bx - br * 3) | 0); xb < Math.min(w, bx + br * 3); xb++) {
            var jb = yb * w + xb, db = Math.sqrt((xb - bx) * (xb - bx) + (yb - by) * (yb - by)) / br;
            var inner = smooth(1.0, 0.9, db);
            var ringA = Math.exp(-Math.pow((db - 1) / 0.08, 2));
            var ringB = rings > 1 ? Math.exp(-Math.pow((db - 0.62) / 0.06, 2)) * 0.6 : 0;
            var ringC = rings > 2 ? Math.exp(-Math.pow((db - 0.32) / 0.06, 2)) * 0.5 : 0;
            var outerD = Math.pow(smooth(2.6, 1.0, db), 2) * (1 - inner);
            var hx = bx + Math.cos(ha) * br * 0.42, hy = by + Math.sin(ha) * br * 0.42, dh = Math.sqrt((xb - hx) * (xb - hx) + (yb - hy) * (yb - hy)) / (br * 0.2);
            var v4 = Math.max(Ao[jb], outerD * 0.95, ringA);
            if (inner > 0) {
              var cen = 0.28 + 0.2 * tsg(xb, yb) + ringB + ringC;
              v4 = v4 * (1 - inner) + inner * clamp01(cen) * (1 - 0.95 * smooth(1, 0.2, dh));
            }
            Ao[jb] = v4;
          }
        }
        // salpicaduras: puntitos negros sueltos alrededor
        var nsp5 = Math.round(bubK * 30 * Math.max(1, (w * h) / (U * U * 3)));
        for (var sq5 = 0, t5 = 0; sq5 < nsp5 && t5 < nsp5 * 20; t5++) {
          var sx5 = R() * w, sy5 = R() * h, si5 = (sy5 | 0) * w + (sx5 | 0);
          if (Ab3[si5] < 0.02 || Ab3[si5] > 0.5) continue;
          sq5++;
          var sr5 = 0.6 + 2.2 * Math.pow(R(), 3);
          for (var yy5 = Math.floor(sy5 - sr5 - 1); yy5 <= sy5 + sr5 + 1; yy5++) for (var xx5 = Math.floor(sx5 - sr5 - 1); xx5 <= sx5 + sr5 + 1; xx5++) {
            if (xx5 < 0 || yy5 < 0 || xx5 >= w || yy5 >= h) continue;
            var c5 = clamp01(sr5 + 0.5 - Math.sqrt((xx5 - sx5) * (xx5 - sx5) + (yy5 - sy5) * (yy5 - sy5)));
            var j5 = yy5 * w + xx5; if (c5 > Ao[j5]) Ao[j5] = c5;
          }
        }
      } else if (SK.mode === 'resist') {
        // NEGATIVO (reserva): la letra repele el agua y la tinta se acumula FUERA.
        //  - halo negro denso pegado al borde, hecho de pelillos perpendiculares al contorno, que se
        //    deshace en humo gris; llena los huecos de las letras; su tamaño cambia por zonas.
        //  - la letra: gris claro mojado, moteado, más oscura junto al borde (bisel) y con brillos
        //    blancos de líquido.
        //  - raíces: hilos finos que se ramifican desde el halo, sobre todo hacia abajo.
        var hairK = SK.hair == null ? 0.8 : SK.hair, rootK = SK.roots == null ? 0.7 : SK.roots, smokeK = SK.smoke == null ? 0.5 : SK.smoke, glossK = SK.gloss == null ? 0.6 : SK.gloss;
        var Ainv4 = new Float32Array(n); for (i = 0; i < n; i++) Ainv4[i] = 1 - A[i];
        var Do4 = distInside(Ainv4, w, h, 0.5, true), Di4 = distInside(A, w, h, 0.5, true);
        var Dsm4 = blur(Do4.map(function (v) { return v > 1e8 ? U * 3 : v; }), w, h, 2, 2);
        var gZ4 = grid(function (u, v) { return noise.fbm(u * 1.1 + 17, v * 1.1 - 23, 3) * 0.6 + noise.fbm(u * 4.5 - 3, v * 4.5 + 9, 3) * 0.4; });
        var gL4 = grid(function (u, v) { return noise.fbm(u * 3.5 - 5, v * 3.5 + 12, 3); });
        var R0 = U * (0.025 + 0.035 * skA);                                        // grosor del núcleo negro
        // 1) la tinta se INFILTRA en el papel desde el borde de la letra: avanza por una red de
        //    fibras (distancia por dentro del papel), así el frente es orgánico y desigual. Junto a la
        //    letra el pigmento es negro y duro; más allá, pelillos de fibra y un velo gris con la
        //    textura del papel. El alcance cambia mucho por zonas y entre letras se cierra en negro.
        var reachMax4 = R0 * 4.5, band4 = new Uint8Array(n), act4 = new Uint8Array(n);
        for (i = 0; i < n; i++) { var dq = Do4[i]; band4[i] = dq < reachMax4 * 2.2 + 4 ? 1 : 0; act4[i] = dq > 0 && dq < reachMax4 * 2.2 ? 1 : 0; }
        var zoneAt4 = function (x2, y2) { return 0.35 + 0.65 * gZ4(x2, y2); };
        var Fw4 = fiberNet(w, h, band4, { len: physK * 30, cover: 0.35, thick: 0.3 }, R, zoneAt4);
        var tP4 = physSampler('b', 200, 'granul'), C4 = new Float32Array(n), G4 = new Float32Array(n);
        for (i = 0; i < n; i++) {
          if (!band4[i]) { C4[i] = 1e3; G4[i] = 1e9; continue; }
          var yq4 = (i / w) | 0, xq4 = i - yq4 * w;
          var bg4 = 2.2 * (0.7 + 0.6 * tP4(xq4, yq4)) / (0.45 + 1.1 * zoneAt4(xq4, yq4));
          C4[i] = 1 / (1 / bg4 + Fw4[i] * 1.6);
          G4[i] = A[i] >= 0.5 ? 0 : 1e9;
        }
        geodesic(G4, C4, w, h, act4, 8);
        var gH4 = grid(function (u, v) { return noise.fbm(u * 9 + 3, v * 9 - 1, 3); });
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
          i = y * w + x;
          if (A[i] >= 0.5) continue;
          var g4 = G4[i]; if (g4 > 1e8) continue;
          var zA = zoneAt4(x, y), rl4 = R0 * (0.3 + 2.4 * zA * zA * zA) * (0.7 + 0.6 * gH4(x, y)), fadeB = smooth(reachMax4 * 2.1, reachMax4 * 0.8, Do4[i]);
          var paper = tP4(x, y), fib4 = Fw4[i];
          // pigmento duro: macizo negro con frente nítido pero irregular
          var core4 = smooth(rl4 * 1.05, rl4 * 0.6, g4 + (paper - 0.5) * rl4 * 0.5 + (gH4(x + 60, y) - 0.5) * rl4 * 0.9);
          // pelillos: la tinta sigue avanzando por las fibras más allá del frente
          var hair4 = Math.exp(-Math.pow(g4 / (rl4 * 1.7), 1.8)) * (0.25 + 0.55 * smooth(0.3, 0.9, fib4)) * hairK;
          // velo gris que empapa el papel, con su grano
          var veil4 = smokeK * 0.75 * Math.exp(-g4 / (rl4 * 2.1)) * (0.45 + 0.55 * paper) * (0.6 + 0.4 * tsl(x, y)) * fadeB;
          var v4 = Math.max(core4, hair4 * 0.95, veil4);
          // el negro no es plano: zonas algo más cargadas y algún poro del papel sin tinta
          v4 *= 1 - 0.06 * smooth(0.6, 0.9, 1 - paper) * core4;
          Ao[i] = Math.min(1, v4);
        }
        // 2) pelillos sueltos: algunas fibras largas que salen del frente en direcciones irregulares
        function plot(px, py, c) {
          var xi = Math.floor(px), yi = Math.floor(py), fx = px - xi, fy = py - yi;
          if (xi < 0 || yi < 0 || xi + 1 >= w || yi + 1 >= h) return;
          var j = yi * w + xi, a1 = c * (1 - fx) * (1 - fy), a2 = c * fx * (1 - fy), a3 = c * (1 - fx) * fy, a4 = c * fx * fy;
          if (A[j] < 0.5) Ao[j] = Math.min(1, Ao[j] + a1 * (1 - Ao[j]));
          if (A[j + 1] < 0.5) Ao[j + 1] = Math.min(1, Ao[j + 1] + a2 * (1 - Ao[j + 1]));
          if (A[j + w] < 0.5) Ao[j + w] = Math.min(1, Ao[j + w] + a3 * (1 - Ao[j + w]));
          if (A[j + w + 1] < 0.5) Ao[j + w + 1] = Math.min(1, Ao[j + w + 1] + a4 * (1 - Ao[j + w + 1]));
        }
        function gradAt(px, py) {
          var xi = Math.max(1, Math.min(w - 2, px | 0)), yi = Math.max(1, Math.min(h - 2, py | 0)), j = yi * w + xi;
          var gx = Dsm4[j + 1] - Dsm4[j - 1], gy = Dsm4[j + w] - Dsm4[j - w], gl = Math.sqrt(gx * gx + gy * gy) || 1;
          return [gx / gl, gy / gl];
        }
        var edges = [];
        for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) { i = y * w + x; if (A[i] < 0.5 && Do4[i] <= 1.5) edges.push(i); }
        var nHair = Math.round(edges.length * 0.5 * hairK), budgetH = 1500000;
        for (var hq = 0; hq < nHair && budgetH > 0; hq++) {
          var e0 = edges[(R() * edges.length) | 0], g0 = gradAt(e0 % w, (e0 / w) | 0);
          var zone2 = zoneAt4(e0 % w, (e0 / w) | 0), st0 = R0 * (0.35 + 1.5 * zone2 * zone2) * (0.6 + 0.4 * R());
          var hx = (e0 % w) + g0[0] * st0, hy = ((e0 / w) | 0) + g0[1] * st0;
          var Lh = R0 * (0.4 + 2.2 * Math.pow(R(), 2.5)), ch = 0.3 + 0.5 * R(), ang = Math.atan2(g0[1], g0[0]) + (R() - 0.5) * 1.4;
          for (var k = 0; k < Lh && budgetH > 0; k++, budgetH--) {
            ang += (R() - 0.5) * 0.35;
            hx += Math.cos(ang) * 0.8; hy += Math.sin(ang) * 0.8;
            var jh = (hy | 0) * w + (hx | 0); if (jh < 0 || jh >= n || A[jh] >= 0.5) break;
            plot(hx, hy, ch * Math.pow(1 - k / Lh, 0.7));
          }
        }
        // 3) la letra: gris claro mojado, moteado, bisel oscuro junto al borde y brillos de líquido
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
          i = y * w + x;
          if (A[i] < 0.5) continue;
          var di = Di4[i] > 1e8 ? U : Di4[i];
          var base = 0.16 + 0.14 * tsl(x, y) + 0.16 * smooth(0.4, 0.85, 1 - tsg(x, y)) + 0.12 * smooth(0.45, 0.75, gL4(x, y));
          var bevel = 0.55 * Math.exp(-di / (U * 0.018)) + 0.25 * Math.exp(-di / (U * 0.06));
          var gl4 = gL4(x + 211, y - 97), sheen = smooth(0.6, 0.66, gl4) * glossK;           // brillo: zona blanca de borde nítido
          var sheenRim = (smooth(0.56, 0.6, gl4) - smooth(0.6, 0.64, gl4)) * glossK * 0.35;  // con un filo algo más oscuro
          var v7 = Math.min(1, base + bevel) * (1 - 0.92 * sheen) + sheenRim;
          v7 = Math.max(v7, 0.85 * smooth(1.6, 0.4, di));                                     // filo negro del borde
          Ao[i] = clamp01(v7);
        }
        // 4) raíces: hilos finos ramificados que crecen desde el halo, sobre todo hacia abajo
        var nRoot = Math.round(edges.length * 0.012 * rootK), budgetR = 900000;
        function grow(x0, y0, ang, len, ink, depth) {
          var xx = x0, yy = y0, seg = 0, segL = 4 + R() * 10, turn = 0;
          for (var k = 0; k < len && budgetR > 0; k++, budgetR--) {
            if (++seg > segL) { seg = 0; segL = 4 + R() * 12; turn = (R() - 0.5) * 0.9; }   // en quiebros, como un rayo
            ang += turn * 0.18 + (R() - 0.5) * 0.22;
            ang += Math.atan2(Math.sin(Math.PI / 2 - ang), Math.cos(Math.PI / 2 - ang)) * 0.012;  // tienden a bajar
            xx += Math.cos(ang); yy += Math.sin(ang);
            if (xx < 1 || yy < 1 || xx >= w - 1 || yy >= h - 1) return;
            var jr = (yy | 0) * w + (xx | 0); if (A[jr] >= 0.5) return;
            plot(xx, yy, ink * (1 - 0.65 * k / len) * (0.6 + 0.4 * tsg(xx | 0, yy | 0)));
            if (depth < 6 && R() < 0.022) grow(xx, yy, ang + (R() < 0.5 ? 1 : -1) * (0.35 + 0.6 * R()), len * (0.3 + 0.45 * R()), ink * 0.85, depth + 1);
          }
        }
        for (var rq = 0; rq < nRoot; rq++) {
          var e1 = edges[(R() * edges.length) | 0], rx = e1 % w, ry = (e1 / w) | 0, gg = gradAt(rx, ry);
          var down = gg[1] > -0.2 ? 1 : 0.35; if (R() > down) continue;
          var zone3 = 0.45 + 1.1 * gZ4(rx, ry), off = R0 * zone3 * (0.8 + 1.2 * R());
          var ang0 = Math.atan2(gg[1], gg[0]) + (R() - 0.5) * 0.7;
          grow(rx + gg[0] * off, ry + gg[1] * off, ang0, U * (0.25 + 1.2 * Math.pow(R(), 1.4)) * (0.6 + 0.6 * skA), 0.55 + 0.35 * R(), 0);
        }
      } else if (SK.mode === 'runs') {
        // LAVADO VERTICAL: el agua baja por la hoja en regueros de anchos muy distintos (muchos finos,
        // alguno ancho). Dentro de cada reguero el pigmento se arrastra hacia abajo (largo) y hacia
        // arriba (corto) como un desenfoque suave, y la letra se borra en parte; fuera de los regueros
        // la letra queda casi intacta. Mucho grano fino.
        var band5 = new Float32Array(w), Ld5 = new Float32Array(w), Lu5 = new Float32Array(w), er5 = new Float32Array(w);
        for (x = 0; x < w; x++) {
          var u5 = (x - ox) * invU;
          var f1 = smooth(0.7, 0.75, noise(u5 * 55 + 3, 1.7)), f2 = smooth(0.66, 0.74, noise(u5 * 16 - 9, 4.1)), f3 = smooth(0.66, 0.78, noise(u5 * 4 + 21, 8.8));
          var b5 = Math.max(f1 * 0.5, f2 * 0.85, f3);
          band5[x] = b5 * (0.55 + 0.45 * noise(u5 * 90 + 5, 2.2)) * Math.min(1, skA * 1.2);
          Ld5[x] = U * (0.06 + 0.4 * noise(u5 * 7 + 11, 8.3)) * (0.5 + 0.6 * skA);
          Lu5[x] = Ld5[x] * (0.25 + 0.45 * noise(u5 * 9 - 4, 3.3));
          er5[x] = 0.3 + 0.6 * noise(u5 * 25 + 40, 1.1);
        }
        var Abase = blur(A, w, h, U * 0.008, U * 0.012), Dn5 = new Float32Array(n), Up5 = new Float32Array(n);
        for (x = 0; x < w; x++) {
          var kd = Math.exp(-1 / Math.max(1.5, Ld5[x])), ku = Math.exp(-1 / Math.max(1.5, Lu5[x])), cD = 0, cU = 0;
          var hD = 0, hU = 0;
          for (y = 0; y < h; y++) { i = y * w + x; cD = cD * kd + Abase[i] * (1 - kd); hD = Math.max(Abase[i], hD * kd); Dn5[i] = Math.max(cD * 2, hD * 0.85); }
          for (y = h - 1; y >= 0; y--) { i = y * w + x; cU = cU * ku + Abase[i] * (1 - ku); hU = Math.max(Abase[i], hU * ku); Up5[i] = Math.max(cU * 2, hU * 0.8); }
        }
        var Sm5 = new Float32Array(n);
        for (i = 0; i < n; i++) { var yE = (i / w) | 0, edgeF = smooth(0, U * 0.3, Math.min(yE, h - 1 - yE)); Sm5[i] = Math.min(1, Math.max(Dn5[i], Up5[i] * 0.85)) * edgeF; }
        Sm5 = blur(Sm5, w, h, U * 0.003, U * 0.01);
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
          i = y * w + x;
          var bb = band5[x], a8 = Abase[i];
          // en el reguero la letra se sustituye por su versión arrastrada (y en parte borrada)
          var v8 = a8 + (Sm5[i] * (0.7 + 0.3 * tsl(x, y)) * (1 - 0.45 * er5[x]) - a8) * bb;
          // grano fino de fotocopia: más en los medios tonos
          var gr8 = hash(i * 7 + 13) - 0.5;
          v8 = clamp01(v8 + gr8 * 0.7 * Math.min(1, 4 * v8 * (1 - v8) + 0.05));
          Ao[i] = v8;
        }
      } else {
        // papel empapado
        var Da = blur(A, w, h, U * 0.012, U * 0.012);
        var Ainv3 = new Float32Array(n); for (i = 0; i < n; i++) Ainv3[i] = 1 - A[i];
        var Do3 = distInside(Ainv3, w, h, 0.5, true), tsf2 = physSampler('d', 140, 'fibra', -0.9);
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
          i = y * w + x;
          var a0 = A[i];
          if (a0 < 0.5) {   // borde aterciopelado: la tinta empapa la fibra pegada a la letra, denso y peludo
            var dq = Do3[i]; if (dq > 1e8) { Ao[i] = a0; continue; }
            var rr4 = U * (0.012 + 0.03 * skA) * (0.45 + 0.9 * gS1(x, y));
            var fib4 = Math.max(tsf(x, y), tsf2(x, y));
            var fr4 = Math.exp(-Math.pow(dq / rr4, 1.1)) * (0.55 + 0.45 * smooth(0.35, 0.8, fib4));
            Ao[i] = Math.max(a0, Math.min(1, fr4 * 1.05));
            continue;
          }
          var patch = smooth(0.68, 0.82, gS1(x, y)) * skA;                         // zonas donde el papel chupó la tinta: gris granuloso
          var grain = 0.35 + 0.4 * tsg(x, y) + 0.2 * (tsf(x, y) - 0.5);
          var hole = smooth(0.74, 0.86, gS2(x, y)) * smooth(0.3, 0.9, Da[i]) * skA;   // huecos blancos irregulares
          var v5 = a0 * (1 - patch * (1 - clamp01(grain)));
          v5 *= 1 - clamp01(hole) * smooth(0.35, 0.65, tsf(x, y) * 0.5 + tsg(x, y) * 0.5);
          Ao[i] = v5;
        }
        // pincelada gris diluida por encima de algunas letras (pigmento arrastrado con agua)
        var LB = getLab(), boxes = {};
        for (i = 0; i < n; i++) { var lb = LB.lab[i]; if (!lb) continue; var yy0 = (i / w) | 0, xx0 = i - yy0 * w, b = boxes[lb]; if (!b) b = boxes[lb] = [xx0, yy0, xx0, yy0]; if (xx0 < b[0]) b[0] = xx0; if (xx0 > b[2]) b[2] = xx0; if (yy0 < b[1]) b[1] = yy0; if (yy0 > b[3]) b[3] = yy0; }
        Object.keys(boxes).forEach(function (k) {
          var b = boxes[k], bwid = b[2] - b[0], bh = b[3] - b[1];
          if (bwid < U * 0.25 || R() > 0.45 * Math.min(1, skA)) return;
          var cx3 = (b[0] + b[2]) / 2 + (R() - 0.5) * bwid * 0.3, cy3 = b[1] + bh * (0.02 + 0.12 * R()), sw3 = bwid * (0.6 + 0.5 * R()), sh3 = U * (0.08 + 0.12 * R()), tilt = (R() - 0.5) * 0.5, sd3 = R() * 50;
          for (var y3 = Math.max(0, (cy3 - sh3 * 2) | 0); y3 < Math.min(h, cy3 + sh3 * 2); y3++) for (var x3 = Math.max(0, (cx3 - sw3) | 0); x3 < Math.min(w, cx3 + sw3); x3++) {
            var tx = (x3 - cx3) / sw3, cyl = cy3 + tilt * (x3 - cx3) + Math.sin(tx * 3 + sd3) * sh3 * 0.4, ty = (y3 - cyl) / sh3;
            var env = smooth(1, 0.7, Math.abs(tx)) * smooth(1, 0.55, Math.abs(ty) + (noise(x3 * 0.05 + sd3, y3 * 0.05) - 0.5) * 0.5);
            if (env <= 0) continue;
            var bristle = 0.55 + 0.45 * noise((y3 - tilt * (x3 - cx3)) * 0.35 + sd3, x3 * 0.01);
            var v6 = 0.4 * env * (0.45 + 0.55 * bristle) * (0.75 + 0.25 * tsg(x3, y3));
            var j3 = y3 * w + x3; if (v6 > Ao[j3]) Ao[j3] = v6;
          }
        });
      }
      A = Ao; shape = A;
    }

    // 1e · MARAÑA: la letra está hecha SOLO de hilos finos, rizados y quebrados (alambre, estropajo,
    // raíces). Miles de hilos se acumulan: donde se cruzan muchos sale negro (el centro del trazo),
    // en el borde quedan ralos y deshilachados, algunos se escapan y cuelgan; en algunas franjas los
    // hilos están peinados en horizontal. Los hilos están algo levantados: sombra suave en el papel.
    var TG = p.tangle || {};
    if (TG.on && (TG.amount || 0) > 0) {
      var tA = Math.min(1.6, TG.amount), comb = TG.comb == null ? 0.4 : TG.comb;
      var Ain = new Float32Array(n); for (i = 0; i < n; i++) Ain[i] = 1 - A[i];
      var Dto = distInside(Ain, w, h, 0.5, true), Dti = distInside(A, w, h, 0.5, true), area = 0;
      for (i = 0; i < n; i++) if (A[i] > 0.5) area++;
      var Dts = blur(Dto.map(function (v) { return v > 1e8 ? U : v; }), w, h, 1.5, 1.5);
      var At = new Float32Array(n);
      var gCo = grid(function (u, v) { return noise(u * 0.4 + 3, v * 7 - 2); });            // franjas peinadas
      var gDe = grid(function (u, v) { return noise.fbm(u * 3 + 11, v * 3 - 5, 3); });       // densidad por zonas
      var wire = Math.max(0.55, U * 0.0035);                                                 // grosor del hilo
      function dep(px, py, a) {   // deposita un hilo (antialias); la tinta se acumula
        var xi = Math.floor(px), yi = Math.floor(py), fx = px - xi, fy = py - yi;
        if (xi < 0 || yi < 0 || xi + 1 >= w || yi + 1 >= h) return;
        var j = yi * w + xi, ws = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy], js = [j, j + 1, j + w, j + w + 1];
        for (var q = 0; q < 4; q++) { var c = a * ws[q] * 1.6; if (c > 0.002) At[js[q]] = 1 - (1 - At[js[q]]) * (1 - Math.min(1, c)); }
      }
      var nS = Math.round(area / (U * U) * 6000 * tA), budget = Math.round(area * 40 * tA) + 50000, escN = 0;
      for (var sq = 0, tries = 0; sq < nS && budget > 0 && tries < nS * 20; tries++) {
        var sx = R() * w, sy = R() * h, j0 = (sy | 0) * w + (sx | 0);
        if (A[j0] < 0.5) continue;
        // más hilos en el centro del trazo y en las zonas densas
        var cen = smooth(0, U * 0.05, Dti[j0] > 1e8 ? U : Dti[j0]);
        if (R() > 0.35 + 0.65 * cen * (0.5 + 0.7 * gDe(sx | 0, sy | 0))) continue;
        sq++;
        var combed = gCo(sx | 0, sy | 0) > 1 - comb * 0.45;
        var ang = combed ? (R() < 0.5 ? 0 : Math.PI) + (R() - 0.5) * 0.4 : R() * 6.283;
        var esc = R() < 0.008 * tA + 0.03 * (TG.hang || 0), len = U * (combed ? 0.12 + 0.3 * R() : 0.04 + 0.16 * R()) * (esc ? 3 : 1);
        var ink = 0.4 + 0.45 * R(), margin = U * (0.004 + 0.03 * Math.pow(R(), 2)), segL = 0, kink = 0;
        var px = sx, py = sy, k;
        for (k = 0; k < len && budget > 0; k++, budget--) {
          // quiebros cortos: el hilo es rizado y crespo, no una curva suave
          if (--segL <= 0) { segL = 1 + R() * (combed ? 6 : 3.5); kink = (R() - 0.5) * (combed ? 1.0 : 2.4); }
          ang += kink * 0.45 + (R() - 0.5) * 0.35;
          if (combed) ang += Math.atan2(Math.sin(-ang), Math.cos(ang) > 0 ? Math.cos(ang) : -Math.cos(ang)) * 0.05;
          if (esc && k > len * 0.2) ang += Math.atan2(Math.sin(Math.PI / 2 - ang), Math.cos(Math.PI / 2 - ang)) * 0.04;   // cuelga
          var nx = px + Math.cos(ang) * 0.9, ny = py + Math.sin(ang) * 0.9, jn = (ny | 0) * w + (nx | 0);
          if (jn < 0 || jn >= n) break;
          if (!esc && A[jn] < 0.5 && Dto[jn] > margin) {   // se sale: vuelve hacia la letra
            var xi2 = Math.max(1, Math.min(w - 2, nx | 0)), yi2 = Math.max(1, Math.min(h - 2, ny | 0)), jj = yi2 * w + xi2;
            ang = Math.atan2(-(Dts[jj + w] - Dts[jj - w]), -(Dts[jj + 1] - Dts[jj - 1])) + (R() - 0.5) * 1.2;
            continue;
          }
          dep(nx, ny, ink * (esc ? Math.max(0.3, 1 - k / len) : 1) * wire);
          px = nx; py = ny;
          if (px < 1 || py < 1 || px >= w - 1 || py >= h - 1) break;
        }
      }
      // sombra suave: los hilos están algo levantados del papel
      var Sh = blur(At, w, h, U * 0.008 + 1, U * 0.008 + 1), sdx = Math.round(U * 0.008 + 1), sdy = Math.round(U * 0.014 + 1);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x; var ys = y - sdy, xs = x - sdx;
        var sv = ys >= 0 && xs >= 0 ? Sh[ys * w + xs] * 0.28 : 0;
        A[i] = clamp01(1 - (1 - At[i]) * (1 - sv));
      }
      shape = A;
    }

    // 1f · IMPRESIÓN LOCA: la plancha se mueve mientras imprime. 'collage': copias desplazadas que se
    // solapan, tramos de la letra recortados y movidos, restos de tóner y manchas. 'drag': la hoja se
    // arrastra en el escáner: franjas repetidas y desplazadas, estela horizontal y letras duplicadas.
    var GL = p.glitch || {};
    if (GL.on && (GL.amount || 0) > 0) {
      var gA = Math.min(1.6, GL.amount), A0g = new Float32Array(A), Og = new Float32Array(n), gmode = GL.mode || 'collage';
      var LBg = getLab(), gbx = {};
      for (i = 0; i < n; i++) { var lq = LBg.lab[i]; if (!lq) continue; var yq0 = (i / w) | 0, xq0 = i - yq0 * w, bq0 = gbx[lq]; if (!bq0) bq0 = gbx[lq] = [xq0, yq0, xq0, yq0]; if (xq0 < bq0[0]) bq0[0] = xq0; if (xq0 > bq0[2]) bq0[2] = xq0; if (yq0 < bq0[1]) bq0[1] = yq0; if (yq0 > bq0[3]) bq0[3] = yq0; }
      var gTex1 = grid(function (u, v) { return noise.fbm(u * 3 + 5, v * 3 - 2, 3); }), gTex2 = grid(function (u, v) { return noise.fbm(u * 14 - 9, v * 14 + 3, 2); });
      function stampShift(dst, src, dx, dy, op, x0r, x1r, y0r, y1r) {
        for (var yy = Math.max(0, y0r); yy < Math.min(h, y1r); yy++) for (var xx = Math.max(0, x0r); xx < Math.min(w, x1r); xx++) {
          var sx = xx - dx, sy = yy - dy; if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
          var v = sampleBil(src, w, h, sx, sy) * op, j = yy * w + xx; if (v > dst[j]) dst[j] = v;
        }
      }
      function smearH(src, len, dir) {   // estela horizontal suave (filtro exponencial normalizado)
        var o = new Float32Array(n), k = Math.exp(-1 / Math.max(1.5, len));
        for (var yy = 0; yy < h; yy++) { var c = 0; if (dir > 0) for (var xx = 0; xx < w; xx++) { var j = yy * w + xx; c = c * k + src[j] * (1 - k); o[j] = Math.max(src[j] * 0.0, c); } else for (var xx2 = w - 1; xx2 >= 0; xx2--) { var j2 = yy * w + xx2; c = c * k + src[j2] * (1 - k); o[j2] = c; } }
        return o;
      }
      if (gmode === 'collage') {
        // 1) cada letra impresa con la plancha algo movida: se apiñan y se solapan
        Object.keys(gbx).forEach(function (k) {
          var b = gbx[k], dx = Math.round((R() - 0.5) * U * 0.4 * gA), dy = Math.round((R() - 0.5) * U * 0.1 * gA);
          stampShift(Og, A0g, dx, dy, 1, b[0] + dx - 2, b[2] + dx + 3, b[1] + dy - 2, b[3] + dy + 3);
          if (R() < 0.45 * gA) {   // segunda impresión de la misma letra, más desplazada
            var dx2 = Math.round((R() < 0.5 ? -1 : 1) * U * (0.08 + 0.2 * R()) * gA), dy2 = Math.round((R() - 0.5) * U * 0.1);
            stampShift(Og, A0g, dx + dx2, dy + dy2, 0.92, b[0] + dx + dx2 - 2, b[2] + dx + dx2 + 3, b[1] + dy + dy2 - 2, b[3] + dy + dy2 + 3);
          }
        });
        // 2) tiras verticales cortadas y movidas (papel recortado y vuelto a pegar)
        var Oc = new Float32Array(Og), xs6 = 0;
        while (xs6 < w) {
          var sw6 = Math.round(U * (0.06 + 0.5 * R())), mv = R() < 0.4 * gA ? Math.round((R() - 0.5) * U * 0.35 * gA) : 0;
          if (mv) for (y = 0; y < h; y++) for (x = xs6; x < Math.min(w, xs6 + sw6); x++) { var sy6 = y - mv; Og[y * w + x] = sy6 >= 0 && sy6 < h ? Oc[sy6 * w + x] : 0; }
          xs6 += sw6;
        }
        // 3) restos de otras impresiones: líneas de letra pequeña, tiras de tinta y manchas de tóner
        var nTxt = Math.round(2 + 4 * gA);
        for (var tq = 0; tq < nTxt; tq++) {
          var tx0 = R() * w * 0.8, ty0 = R() * h, vert = R() < 0.35, tl = U * (0.4 + 1.2 * R()), th6 = Math.max(2, U * (0.025 + 0.02 * R())), gray = 0.55 + 0.35 * R();
          for (var cpos = 0; cpos < tl;) {   // "letras" pequeñas: trazos cortos de alto variable
            var cw = Math.max(1.5, th6 * (0.35 + 0.6 * R())), ch6 = th6 * (R() < 0.25 ? 1.35 : 1), gap = th6 * (0.12 + 0.25 * R()) + (R() < 0.15 ? th6 * 0.8 : 0);
            for (var a6 = 0; a6 < cw; a6++) for (var b6 = 0; b6 < ch6; b6++) {
              var px6 = Math.round(vert ? tx0 + b6 : tx0 + cpos + a6), py6 = Math.round(vert ? ty0 + cpos + a6 : ty0 - b6);
              if (px6 < 0 || py6 < 0 || px6 >= w || py6 >= h) continue;
              if (hash(px6 * 31 + py6 * 17) < 0.25) continue;
              var j6 = py6 * w + px6; Og[j6] = Math.max(Og[j6], gray);
            }
            cpos += cw + gap;
          }
        }
        // 4) textura de fotocopia: el tóner es binario. Zonas con poca carga se vuelven grano duro
        //    (punteado), rayas blancas finas y nítidas, bocados de borde dentado; y manchas de tóner
        //    granulosas pegadas a algunas letras (como suciedad del cristal)
        var sdT = p.seed * 53 + 1;
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
          i = y * w + x; var t1 = gTex1(x, y), t2 = gTex2(x, y), v = Og[i];
          // mancha de tóner junto a la tinta: grano oscuro
          var sm = smooth(0.72, 0.78, gTex1(x + 400, y - 90)) * gA;
          if (sm > 0 && v < 0.5) { var gsm = hash(i * 13 + sdT); if (gsm < sm * (0.35 + 0.5 * t2)) v = Math.max(v, 0.85); }
          if (v <= 0.02) { Og[i] = v; continue; }
          var low = smooth(0.58, 0.7, t1) * Math.min(1, 0.8 * gA);                       // tóner flojo
          if (low > 0 && hash(i * 7 + sdT) < low * (0.35 + 0.55 * t2)) v *= 0.08;        // punteado duro, no nube
          var row = (y / Math.max(1, U * 0.006)) | 0;
          if (hash(row * 31 + sdT) < 0.04 * gA && smooth(0.45, 0.6, t1) > 0) v *= 0.1;   // raya blanca fina
          var bite = smooth(0.76, 0.78, t2 + (hash(i * 5 + sdT) - 0.5) * 0.06) * smooth(0.45, 0.6, t1);
          v *= 1 - 0.95 * bite;                                                             // bocado de borde dentado
          Og[i] = v;
        }
        // 5) motas de tóner agrupadas (como el polvo del cristal), más cerca de la tinta
        var Ob = blur(Og, w, h, U * 0.15, U * 0.15), nsp6 = Math.round(w * h / (U * U) * 30 * gA);
        for (var sp6 = 0, tr6 = 0; sp6 < nsp6 && tr6 < nsp6 * 10; tr6++) {
          var sx7 = (R() * w) | 0, sy7 = (R() * h) | 0, j7 = sy7 * w + sx7;
          if (Ob[j7] < 0.02 || R() > 1.5 * Ob[j7] || gTex2(sx7, sy7) < 0.45) continue;
          sp6++;
          var r7 = R() < 0.85 ? 0.7 : 1.4 + R() * 1.5;
          for (var dy7 = -2; dy7 <= 2; dy7++) for (var dx7 = -2; dx7 <= 2; dx7++) { var xx7 = sx7 + dx7, yy7 = sy7 + dy7; if (xx7 < 0 || yy7 < 0 || xx7 >= w || yy7 >= h) continue; var c7 = clamp01(r7 + 0.5 - Math.sqrt(dx7 * dx7 + dy7 * dy7)) * 0.9; var jj7 = yy7 * w + xx7; if (c7 > Og[jj7]) Og[jj7] = c7; }
        }
      } else if (gmode === 'drag') {
        // ARRASTRE DE ESCÁNER: la hoja se mueve mientras pasa la luz: el texto se repite debajo,
        // desplazado y con estela horizontal; franjas finas descolocadas; líneas de barrido y un marco.
        Og.set(A0g);
        var yMin = h, yMax = 0, xMin = w, xMax = 0;
        for (i = 0; i < n; i++) if (A0g[i] > 0.5) { var yq1 = (i / w) | 0, xq1 = i - yq1 * w; if (yq1 < yMin) yMin = yq1; if (yq1 > yMax) yMax = yq1; if (xq1 < xMin) xMin = xq1; if (xq1 > xMax) xMax = xq1; }
        var lineH = Math.max(U * 0.3, (yMax - yMin) * 0.45), nCopy = gA > 1.1 ? 2 : 1;
        for (var cq2 = 1; cq2 <= nCopy; cq2++) {
          var Sm6 = smearH(A0g, U * (0.03 + 0.12 * R()) * gA, 1), dyc = Math.round(lineH * (0.3 + 0.25 * R()) * cq2), dxc = Math.round(U * (0.03 + 0.12 * R()) * cq2), opc = 0.55 - 0.15 * cq2;
          // solo la parte derecha / una franja vertical (la hoja se arrastró a trozos)
          var yc0 = yMin + dyc + Math.round((yMax - yMin) * 0.2 * R()), yc1 = yc0 + Math.round((yMax - yMin) * (0.15 + 0.25 * R())), xc0 = xMin + Math.round((xMax - xMin) * (0.3 + 0.4 * R()));
          stampShift(Og, Sm6, dxc, dyc, opc, xc0 + dxc, w, yc0, yc1);
          stampShift(Og, A0g, dxc, dyc, opc * 0.85, xc0 + dxc, w, yc0, yc1);
        }
        // franjas finas descolocadas en horizontal, con estela
        var Of = new Float32Array(Og), yb2 = 0;
        while (yb2 < h) {
          var bh6 = Math.max(1, Math.round(U * (0.008 + 0.06 * Math.pow(R(), 2))));
          if (R() < 0.12 * gA) {
            var sh6 = Math.round((R() - 0.3) * U * 0.12 * gA), kk = Math.exp(-1 / Math.max(1.5, U * 0.08 * R() * gA));
            for (y = yb2; y < Math.min(h, yb2 + bh6); y++) { var c8 = 0; for (x = 0; x < w; x++) { var sx8 = x - sh6, sv8 = sx8 >= 0 && sx8 < w ? Of[y * w + sx8] : 0; c8 = Math.max(sv8, c8 * kk); Og[y * w + x] = c8; } }
          }
          yb2 += bh6;
        }
        // líneas de barrido muy finas y algo de grano
        for (y = 0; y < h; y++) { var sl = 1 - 0.18 * gA * smooth(0.6, 0.9, hash(y * 13 + 5)); for (x = 0; x < w; x++) { i = y * w + x; var v9 = Og[i] * sl; v9 = clamp01(v9 + (hash(i * 3 + 1) - 0.5) * 0.3 * Math.min(1, 4 * v9 * (1 - v9) + 0.02)); Og[i] = v9; } }
        // marco fino de la caja (borde del cristal), interrumpido
        if (gA > 0.4 && xMax > xMin) {
          var fx0 = Math.max(1, xMin - Math.round(U * 0.12)), fx1 = Math.min(w - 2, xMax + Math.round(U * 0.5)), fy0 = Math.round(yMin + (yMax - yMin) * 0.35), fy1 = Math.min(h - 2, yMax + Math.round(lineH * 0.9));
          for (x = fx0; x < fx1; x++) { if (noise(x * 0.05, 1.1) > 0.3) Og[fy0 * w + x] = Math.max(Og[fy0 * w + x], 0.55); if (noise(x * 0.05, 3.3) > 0.3) Og[fy1 * w + x] = Math.max(Og[fy1 * w + x], 0.45); }
          for (y = fy0; y < fy1; y++) Og[y * w + fx0] = Math.max(Og[y * w + fx0], 0.5);
          // marcas de registro (barritas) junto al marco
          for (var mq = 0; mq < 5; mq++) { var my6 = fy0 + 4 + mq * Math.round(U * 0.05); for (x = fx0 + 3; x < fx0 + 3 + Math.round(U * (0.05 + 0.1 * R())); x++) if (my6 < h) Og[my6 * w + x] = Math.max(Og[my6 * w + x], 0.6); }
        }
      } else {
        // DOBLE PASADA: la hoja pasa dos veces por la prensa con la plancha movida. Cada pasada
        // con su carga de rodillo: estrías horizontales del rodillo, grano duro donde falta tinta,
        // borde algo aplastado; la segunda más desplazada y con menos carga; papel visible a puntos.
        var ddx = U * (0.035 + 0.04 * gA), ddy = U * (0.015 + 0.015 * gA) * (R() < 0.5 ? -1 : 1), sdD = p.seed * 71 + 3;
        var gRol = grid(function (u, v) { return noise(u * 0.35 + 2, v * 26) * 0.6 + noise(u * 1.2, v * 60 + 5) * 0.4; });   // estrías del rodillo
        var gLoad = grid(function (u, v) { return noise.fbm(u * 1.4 + 8, v * 1.4 - 3, 3); });
        function pass(xx, yy, load, salt) {
          var a0 = sampleBil(A0g, w, h, xx, yy); if (a0 <= 0.02) return 0;
          var rol = gRol(xx | 0, yy | 0), ld = gLoad((xx | 0) + salt, yy | 0);
          var starve = clamp01((1 - load) + 0.6 * smooth(0.55, 0.8, ld) + 0.35 * smooth(0.55, 0.85, rol) - 0.25);
          var hk = hash(((yy | 0) * w + (xx | 0)) * 9 + sdD + salt);
          return a0 * (hk < starve * 0.85 ? 0.12 : 1) * (0.85 + 0.15 * rol);
        }
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
          i = y * w + x;
          var p1 = pass(x, y, 0.92 - 0.15 * gA, 0), p2 = pass(x - ddx, y - ddy, 0.7 - 0.2 * gA, 300) * 0.85;
          Og[i] = clamp01(1 - (1 - p1) * (1 - p2));
        }
      }
      A = Og; shape = A;
    }

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
      // zonas húmedas: solo donde ha caído el agua (0 = toda la forma, como antes)
      var Z = null, zon = p.bleed.zones || 0;
      if (zon > 0) {
        Z = new Float32Array(n);
        var zs = 0.8 + 2.4 * (p.bleed.zoneSize == null ? 0.5 : p.bleed.zoneSize);
        var tz = sampler('b', zs * 0.9, 0, 'aguada');
        var gz = grid(function (u, v) { return noise.fbm(u / zs + 60, v / zs, 3); });
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) { i = y * w + x; Z[i] = smooth(1 - zon - 0.07, 1 - zon + 0.07, tz(x, y) * 0.55 + gz(x, y) * 0.45); }
      }
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        var core = A[i], bv = B[i];
        if (bv < 1e-4 && core <= 0) continue;
        var zw = Z ? Z[i] : 1;
        if (zw <= 0.002) { out[i] = core; continue; }
        // a) difuminado suave (versión 0.1)
        var kk = clamp01(bA * 1.3 * (0.15 + 0.85 * smooth(0.25, 0.85, tb(x, y))));
        var soft = Math.max(core + (bv - core) * kk, core * (1 - 0.6 * kk), bv * kk * 0.9);
        if (wet <= 0) { out[i] = core + (soft - core) * zw; continue; }
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
        var res = soft + (wA2 - soft) * wet;
        out[i] = core + (res - core) * zw;
        var outside = clamp01(front - core) * (1 - ring * 0.8);
        WW[i] = Math.max(WW[i], wet * clamp01(outside) * zw);
        if (PP) PP[i] = Math.max(PP[i], wet * ring * poolAmt * zw);
      }
      A = out;
      // donde cayó el agua: el centro se lava y en el frente queda la línea de marea
      if (Z && ((p.bleed.dissolve || 0) > 0 || (p.bleed.tide || 0) > 0)) {
        var tdw = sampler('b', 1.4, 0, 'aguada'), PT = needPool();
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
          i = y * w + x;
          if (A[i] <= 0) continue;
          var zz = Z[i];
          if (zz <= 0) continue;
          A[i] *= 1 - (p.bleed.dissolve || 0) * 0.65 * zz * (0.35 + 0.65 * (1 - tdw(x, y)));
          var tide = (p.bleed.tide || 0) * smooth(0.05, 0.3, zz) * (1 - smooth(0.35, 0.6, zz));
          if (tide > 0) { A[i] = A[i] + (1 - A[i]) * tide * 0.6 * smooth(0, 0.25, A[i]); PT[i] = Math.max(PT[i], tide); }
        }
      }
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
      paintDrops(A, w, h, U, p.drips.drops, Math.max(0.05, p.drips.length), R, noise, wetW, p.drips.thick, texs.drips);
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
      var te = sampler('b', 1, 0, p.erode.fam);
      var perL = p.erode.perLetter || 0, prot = p.erode.protect || 0;
      var gez = grid(function (u, v) { return noise.fbm(u * 0.33 + 71, v * 0.33 - 9, 3); });
      var gef = grid(function (u, v) { return noise.fbm(u * 2.2 + 10, v * 2.2 - 5, 3); });
      var gec = grid(function (u, v) { return noise.fbm(u * 0.45 - 30, v * 0.45 + 60, 2); });
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        if (A[i] <= 0) continue;
        var field = te(x, y) * 0.72 + gef(x, y) * 0.28;
        var tE = ea * (1 - dist + dist * 2.1 * smooth(0.3, 0.8, gec(x, y)));
        if ((p.erode.zones || 0) > 0) tE *= 1 - p.erode.zones + p.erode.zones * 2.2 * smooth(0.48, 0.72, gez(x, y));
        if (perL > 0 || prot > 0) {
          var lid = letterOf(i);
          if (perL > 0) tE *= 1 - perL * 0.85 * hash(lid * 977 + p.seed);
          if (prot > 0) tE *= 1 - prot * (1 - smooth(0.12, 0.55, letterScale(lid)));
        }
        tE = Math.min(tE, 1.05);
        A[i] *= smooth(tE - soft2, tE + soft2, field);
      }
    }

    // 6 · Rayas y grietas ---------------------------------------------------
    if (p.cracks.on && p.cracks.amount > 0) {
      var ca = p.cracks.amount, tc = sampler('d', 0.45, 0.4, p.cracks.fam), tc2 = sampler('d', 0.25, -0.3, p.cracks.fam);
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

    // 6a · Xilografía: cortes de gubia -------------------------------------
    if (GO.on) { A = gouge(A, w, h, U, { zone: GO.zone, spacing: GO.spacing, length: GO.length, width: GO.width, edge: GO.edge, inner: GO.inner, chaos: GO.chaos, angle: GO.angle, seed: p.seed }, R, noise, ox, oy, invU); }

    // 6b · Xilografía / linograbado: veta de madera y restos de talla --------
    if (WO.on && (WO.grain > 0 || WO.chips > 0)) {
      var wAng = (WO.angle || 0) * Math.PI * 0.5, wca = Math.cos(wAng), wsa = Math.sin(wAng);
      var period = U * (0.03 + 0.12 * (WO.spacing == null ? 0.4 : WO.spacing));
      var gw1 = grid(function (u, v) { return noise.fbm((u * wca + v * wsa) * 0.22, (v * wca - u * wsa) * 0.3 + 17, 3); });
      var gw2 = grid(function (u, v) { return noise.fbm((u * wca + v * wsa) * 1.1 + 40, (v * wca - u * wsa) * 0.9, 3); });
      var gw3 = grid(function (u, v) { return noise.fbm((u * wca + v * wsa) * 0.12 + 70, (v * wca - u * wsa) * 0.12, 2); });
      var gch = grid(function (u, v) { return noise.fbm(u * 3.2 + 21, v * 3.2 - 8, 3); });
      var Nw = WO.chips > 0 ? blur(A, w, h, U * 0.22, U * 0.22) : null;
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        var px9 = x - ox, py9 = y - oy, along9 = px9 * wca + py9 * wsa, across9 = py9 * wca - px9 * wsa;
        var q9 = across9 + U * 0.55 * (gw1(x, y) - 0.5) + U * 0.16 * (gw2(x, y) - 0.5) + U * 0.9 * Math.pow(gw3(x, y), 2);
        var ph9 = q9 / period, ai9 = A[i];
        if (ai9 > 0 && WO.grain > 0) {
          var ring9 = Math.floor(ph9), rs9 = hash(ring9 * 17 + 3);
          var cosv9 = 0.5 + 0.5 * Math.cos(ph9 * 6.283 + 2.5 * noise(along9 * invU * 0.6, ph9 * 0.3));
          var brk9 = smooth(0.3, 0.7, noise(along9 * invU * 1.8 + ring9 * 7.3, ring9 * 0.61));
          var d9 = 1 - WO.grain * 0.9 * smooth(0.8 - 0.1 * rs9, 0.97, cosv9) * (0.2 + 0.8 * brk9) * (0.3 + 0.7 * rs9);
          d9 *= 1 - WO.grain * 0.14 * (0.5 + 0.5 * Math.cos(ph9 * 1.57));
          A[i] = ai9 * clamp01(d9);
        }
        if (Nw && ai9 < 0.5) {
          var nv9 = Nw[i];
          if (nv9 > 0.1) {
            var isl = gch(x, y), thr9 = 0.74 - 0.12 * WO.chips;
            var m9 = smooth(thr9, thr9 + 0.02, isl) * smooth(0.12, 0.3, nv9) * (1 - smooth(0.42, 0.62, nv9));
            if (m9 > 0) { m9 *= 1 - 0.8 * smooth(0.75, 0.95, 0.5 + 0.5 * Math.cos(ph9 * 6.283)); A[i] = Math.max(A[i], smooth(0.3, 0.6, m9) * 0.95); }
          }
        }
      }
    }

    // 6c · Serigrafía: dentado de la malla, malla visible y huecos ----------
    if (ME.on && (ME.sawtooth > 0 || ME.mesh > 0 || ME.voids > 0)) {
      var mcell = Math.max(2.2, U * 0.014), mang = 0.38, mcs = Math.cos(mang) / mcell, msn = Math.sin(mang) / mcell;
      var Amb = blur(A, w, h, Math.max(1, mcell * 0.7), Math.max(1, mcell * 0.7));
      var tvo = sampler('d', 0.5, 0, 'grano'), tvb = sampler('b', 0.9, 0, 'grano'), Ame = new Float32Array(n);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        if (Amb[i] < 0.002 && A[i] <= 0) continue;
        var mu = x * mcs + y * msn, mv = -x * msn + y * mcs;
        var mp = Math.sin(6.283 * mu) * Math.sin(6.283 * mv);
        var se = 0.08 + 0.1 * (1 - ME.sawtooth);
        var shp = ME.sawtooth > 0 ? smooth(0.5 - se, 0.5 + se, Amb[i] + mp * 0.22 * ME.sawtooth + (A[i] - Amb[i]) * (1 - ME.sawtooth * 0.6)) : A[i];
        var dme = 1 - ME.mesh * 0.22 * (0.5 + 0.5 * mp);
        var hole = smooth(1 - ME.voids * 0.1, 1 - ME.voids * 0.1 + 0.015, tvo(x, y)) * (0.4 + 0.6 * smooth(0.3, 0.7, tvb(x, y)));
        Ame[i] = shp * clamp01(dme * (1 - hole));
      }
      A = Ame;
      if ((ME.ridge || 0) > 0) {
        var Ar = blur(A, w, h, U * 0.01 + 0.8, U * 0.01 + 0.8), DKr = needDark();
        for (y = 1; y < h - 1; y++) for (x = 0; x < w; x++) {
          i = y * w + x;
          if (A[i] <= 0.1) continue;
          var gyr = Ar[i + w] - Ar[i - w];                                   // borde inferior: final del barrido
          var rr2 = clamp01((A[i] - Ar[i]) * 3) * clamp01(-gyr * 6) * ME.ridge;
          if (rr2 > 0) { A[i] = A[i] + (1 - A[i]) * rr2 * 0.5; DKr[i] = Math.max(DKr[i], rr2 * 0.6); }
        }
      }
    }

    // 6d · Prensa (tipografía / flexografía): borde cargado, halo y centros pobres
    var pressDark = null;
    if (PS.on && (PS.squeeze > 0 || PS.halo > 0 || PS.starve > 0)) {
      var Ein = blur(A, w, h, U * 0.018 + 0.8, U * 0.018 + 0.8), Cc = blur(A, w, h, U * 0.07, U * 0.07);
      var Bh = blur(A, w, h, U * 0.005 + 0.8, U * 0.005 + 0.8);
      var tmo = sampler('b', 0.8, 0, 'grano'), gpm = grid(function (u, v) { return noise.fbm(u * 1.4, v * 1.4 + 7, 3); });
      pressDark = new Float32Array(n);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        var ap = A[i], outp = ap;
        if (ap > 0) {
          var Ee = clamp01((ap - Ein[i]) * 3.2), center = smooth(0.45, 1, Cc[i]);
          var dp = 1 - PS.starve * 0.5 * center * (0.35 + 0.65 * smooth(0.25, 0.8, gpm(x, y))) * (0.6 + 0.4 * tmo(x, y));
          dp = Math.min(1, dp + PS.squeeze * Ee * 0.9);
          outp = ap * clamp01(dp);
          pressDark[i] = PS.squeeze * Ee * 0.55;
        }
        var rh = smooth(0.02, 0.22, Bh[i] - ap) * (1 - smooth(0.3, 0.5, Bh[i] - ap));
        var hv5 = PS.halo * 0.5 * rh * (0.45 + 0.55 * smooth(0.3, 0.7, tmo(x, y)));
        if ((PS.deboss || 0) > 0 && ap < 0.5) {   // el papel hundido proyecta una sombra fina abajo a la derecha
          var dbs = U * 0.008 + 0.8, shd = sampleBil(Bh, w, h, x - dbs, y - dbs) - Bh[i];
          if (shd > 0) hv5 = Math.max(hv5, shd * PS.deboss * 0.22);
        }
        A[i] = Math.max(outp, hv5);
      }
    }

    // 7 · Presión de tinta y grano -----------------------------------------
    if (p.ink.on && (p.ink.pressure > 0 || p.ink.grain > 0)) {
      var pr2 = p.ink.pressure, gr = p.ink.grain;
      var tp = sampler('b', 0.9), tg = physSampler('d', 90, 'grano'), gF = Math.min(1 / 1.1, 1 / Math.max(1.2, 2.5 * physK));
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        if (A[i] <= 0) continue;
        var inv1 = 1 - tp(x, y), dens = 1 - pr2 * inv1 * Math.sqrt(Math.sqrt(inv1)) * 1.05;
        var g = (tg(x, y) - 0.5) * 0.65 + (noise(x * gF, y * gF) - 0.5) * 0.6;
        dens += g * gr * 1.1;
        A[i] *= clamp01(dens);
      }
    }
    if (p.ink.on && ((p.ink.fade || 0) > 0 || (p.ink.roller || 0) > 0)) {
      var bwI = input.bw || U * 3, trl = (p.ink.roller || 0) > 0 ? isoSampler('b', 0.9, 'rodillo', 0, 0.9) : null;
      var gfd = grid(function (u, v) { return noise.fbm(u * 0.5 + 3, v * 2.5, 2); });
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        if (A[i] <= 0) continue;
        var df = 1;
        if (p.ink.fade > 0) {   // el esténcil se gasta: la tinta pierde fuerza hacia un lado, a trompicones
          var fx9 = clamp01((x - ox) / bwI);
          df *= 1 - p.ink.fade * 0.85 * smooth(0.15, 1, fx9 + (gfd(x, y) - 0.5) * 0.5);
        }
        if (trl) df *= 1 - p.ink.roller * 0.55 * smooth(0.45, 0.9, trl(x, y));   // marcas del rodillo
        A[i] *= clamp01(df);
      }
    }

    // 7a · MIMEÓGRAFO: esténcil de fibra, tinta grasa que se abre y repinte ---
    if (SN.on) {
      if (SN.spread > 0) {
        var As = blur(A, w, h, U * 0.006 * SN.spread + 0.6, U * 0.006 * SN.spread + 0.6);
        for (i = 0; i < n; i++) A[i] = Math.max(A[i] * 0.6, smooth(0.32, 0.55, As[i]));
      }
      var tfb = physSampler('d', 300, 'fibra'), tfb2 = sampler('b', 1.1, 0, 'fibra'), tfb3 = physSampler('d', 130, 'fibra');
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        if (A[i] <= 0) continue;
        var fb = tfb(x, y), fb3 = tfb3(x, y);
        var dd = 1 - SN.fiber * 0.75 * smooth(0.7, 0.92, fb) - SN.fiber * 0.35 * smooth(0.75, 0.95, fb3);
        dd *= 1 - SN.density * 0.45 * smooth(0.35, 0.85, tfb2(x, y));
        A[i] *= clamp01(dd);
      }
      // halo de aceite: la tinta de mimeógrafo es grasa; el aceite migra unos píxeles más allá del
      // pigmento y deja un velo gris muy tenue, fibroso, alrededor de la letra
      if ((SN.oil || 0) > 0) {
        var rOil = U * 0.007 + 1.2 * physK, Boil = blur(A, w, h, rOil, rOil), tOil = physSampler('d', 220, 'fibra');
        for (i = 0; i < n; i++) {
          var hv = Boil[i] - A[i];
          if (hv <= 0.01) continue;
          y = (i / w) | 0; x = i - y * w;
          A[i] = Math.max(A[i], hv * SN.oil * 0.16 * (0.4 + tOil(x, y)));
        }
      }
      // esténcil que no entinta igual: zonas grandes más pobres (tambor con poca tinta)
      if ((SN.starve || 0) > 0) {
        var gSt = grid(function (u, v) { return noise.fbm(u * 0.45 + 12, v * 0.9 - 4, 3); }), tSt = physSampler('b', 260, 'granul');
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) { i = y * w + x; if (A[i] <= 0) continue; var stv = smooth(0.45, 0.75, gSt(x, y)); A[i] *= 1 - SN.starve * 0.7 * stv * (0.4 + 0.6 * smooth(0.35, 0.75, tSt(x, y))); }
      }
      if (SN.setoff > 0) {   // repinte: tinta de la hoja de al lado, borrosa y desplazada
        var sa0 = R() * Math.PI * 2, sd = U * (0.04 + 0.08 * R());
        var Bs = blur(A, w, h, U * 0.03, U * 0.03), tso = sampler('b', 0.8, 0, 'fibra');
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
          i = y * w + x;
          var gv = sampleBil(Bs, w, h, x - Math.cos(sa0) * sd, y - Math.sin(sa0) * sd) * SN.setoff * 0.22 * (0.5 + tso(x, y));
          if (gv > A[i]) A[i] = gv;
        }
      }
    }

    // 7a2 · FOTOCOPIA: copia de copia, tóner, rayas del tambor y polvo ------
    if (CP.on && (CP.slur || 0) > 0) {
      var decS = Math.exp(-1 / Math.max(1, U * 0.035 * CP.slur + 1)), tsl = physSampler('d', 200, 'toner');
      for (x = 0; x < w; x++) { var pv2 = 0; for (y = 0; y < h; y++) { i = y * w + x; pv2 = Math.max(A[i], pv2 * decS); if (pv2 > A[i] && A[i] < 0.9) A[i] = Math.max(A[i], pv2 * 0.7 * smooth(0.4, 0.8, tsl(x, y))); } }
    }
    if (CP.on) {
      var ttn = physSampler('d', 260, 'toner'), ttb = physSampler('b', 600, 'toner'), ttf = physSampler('d', 110, 'toner');
      if (CP.gen > 0) {   // cada generación engorda, rompe y redondea los trazos
        var Bg = blur(A, w, h, U * 0.02 * CP.gen + 0.8, U * 0.02 * CP.gen + 0.8), sdG = p.seed * 977;
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
          i = y * w + x;
          if (Bg[i] < 0.005) { A[i] = 0; continue; }
          var thrg = 0.5 - 0.14 * CP.gen + (ttn(x, y) - 0.5) * 0.55 * CP.gen + (ttb(x, y) - 0.5) * 0.25 * CP.gen;
          thrg += (hash(i * 11 + sdG) - 0.5) * 0.18 * CP.gen;
          A[i] = smooth(thrg - 0.04, thrg + 0.04, Bg[i]);
        }
      }
      var nearC = blur(A, w, h, U * 0.12, U * 0.12), DKc = needDark(), sdC = p.seed * 313;
      var gblot = grid(function (u, v) { return noise.fbm(u * 2.4 + 61, v * 2.4 - 7, 4); });
      var stW = Math.max(1, U * 0.004), gstr = grid(function (u, v) { return noise.fbm(u * 0.15 + 9, v * 1.8, 2); });
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        var ac = A[i];
        if (ac > 0) {
          // tóner que no agarra en los negros (puntitos y zonas blancas)
          var tbv = ttb(x, y), clus = smooth(0.55, 0.85, tbv);
          ac *= 1 - Math.min(0.95, CP.dropout * (0.95 * smooth(0.78, 0.92, ttf(x, y)) * (0.35 + 0.65 * clus) + 0.6 * smooth(0.68, 0.9, tbv)));
          // manchas blancas grandes donde el tóner no agarró (a zonas) y borde comido
          var blot = smooth(0.6, 0.66, gblot(x, y)) * smooth(0.35, 0.75, ttf(x, y));
          ac *= 1 - Math.min(1, CP.dropout * 1.1) * blot;
        }
        // motas de tóner junto al negro
        var nr = nearC[i];
        if (nr > 0.01 && ac < 0.9) {
          var spk = smooth(1 - CP.toner * 0.13, 1 - CP.toner * 0.13 + 0.012, 1 - ttf(x, y)) * smooth(0.02, 0.4, nr) * smooth(0.25, 0.65, 1 - ttb(x, y));
          ac = Math.max(ac, spk * 0.95);
          ac = Math.max(ac, CP.haze * 0.28 * smooth(0.03, 0.5, nr) * (0.5 + ttb(x, y)));
        }
        // rayas del tambor: finas, verticales (sentido del papel), de intensidad variable
        if (CP.streaks > 0) {
          var col = Math.floor((x - ox) / stW), hs = hash(col * 7 + sdC);
          if (hs > 1 - CP.streaks * 0.09) {
            var sv = smooth(0.3, 0.75, gstr(x, y)) * (0.35 + 0.65 * hash(col * 3 + 1 + sdC));
            var svb = smooth(0.25, 0.4, sv);                                                       // la fotocopia no tiene grises: raya entera o nada
            if (hash(col + 99 + sdC) < 0.6) ac = Math.max(ac, svb * (0.55 + 0.45 * smooth(0, 0.3, nr)) * (0.6 + 0.4 * ttf(x, y)));   // raya oscura
            else ac *= 1 - svb * 0.95;                                                                     // raya clara
            DKc[i] = Math.max(DKc[i], sv * 0.3);
          }
        }
        A[i] = ac;
      }
    }

    // 7a2b · LÁSER ROTO: defectos reales de una impresora láser
    //  'drum'  tambor rayado: rayas verticales continuas (finas y gruesas) que cruzan papel y letras,
    //          un canal blanco sin tóner y una mota que se repite cada vuelta del tambor.
    //  'fuser' fusor y fantasma: tóner sin fundir restregado en horizontal, imagen fantasma repetida
    //          una vuelta de tambor más abajo y velo gris de fondo.
    //  'empty' tóner agotado: franjas verticales donde la tinta pasa a trama de puntos de láser cada
    //          vez más rala, y banding horizontal.
    var LZ = p.laser || {};
    if (LZ.on && (LZ.amount || 0) > 0) {
      var lA = Math.min(1.6, LZ.amount), lm = LZ.mode || 'drum', sdL = p.seed * 131 + 7, A0L = new Float32Array(A);
      var drumC = Math.max(U * 0.8, h * 0.45);                                     // vuelta del tambor (px)
      var tdust = physSampler('d', 110, 'toner'), tbig = physSampler('b', 420, 'toner');
      var cell = Math.max(2, physK * 3.2);                                          // trama de la láser (~ 100 lpi a 300 ppp)
      function laserDot(x2, y2, t) {                                                // trama de puntos a 45°
        var u2 = (x2 + y2) / cell, v2 = (x2 - y2) / cell, fu = u2 - Math.floor(u2) - 0.5, fv = v2 - Math.floor(v2) - 0.5;
        var r = Math.sqrt(fu * fu + fv * fv) * 1.41;
        return smooth(Math.sqrt(t) + 0.06, Math.sqrt(t) - 0.06, r);
      }
      if (lm === 'drum') {
        var cols = [], xx;
        for (xx = 0; xx < w;) {
          var gap = U * (0.03 + 0.4 * Math.pow(hash(xx * 13 + sdL), 2)) / lA;
          xx += Math.max(2, gap);
          if (xx >= w) break;
          var wid = hash(xx * 7 + sdL) < 0.8 ? 0.6 + 1.2 * hash(xx + sdL) : 2 + U * 0.02 * hash(xx * 3 + sdL);
          cols.push({ x: xx, w: wid, k: 0.35 + 0.65 * hash(xx * 5 + sdL), white: hash(xx * 11 + sdL) < 0.18 });
        }
        for (var c = 0; c < cols.length; c++) {
          var co = cols[c];
          for (y = 0; y < h; y++) {
            var fl = smooth(0.25, 0.6, noise(co.x * 0.01, y / (U * 0.6) + c)) * co.k;   // la raya va y viene
            for (x = Math.max(0, Math.floor(co.x - co.w - 1)); x <= Math.min(w - 1, Math.ceil(co.x + co.w + 1)); x++) {
              i = y * w + x;
              var cv = clamp01(co.w + 0.5 - Math.abs(x - co.x)) * fl;
              if (co.white) A[i] *= 1 - cv * 0.95;
              else A[i] = Math.max(A[i], cv * (0.55 + 0.45 * tdust(x, y)));
            }
          }
        }
        // mota repetida cada vuelta del tambor
        var mx = w * (0.2 + 0.6 * hash(sdL + 3)), my0 = h * hash(sdL + 5) % drumC, mr = Math.max(1.5, U * 0.012);
        for (var my = my0; my < h; my += drumC) for (y = Math.floor(my - mr * 2); y <= my + mr * 2; y++) for (x = Math.floor(mx - mr * 3); x <= mx + mr * 3; x++) {
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          var dm = Math.sqrt((x - mx) * (x - mx) / 4 + (y - my) * (y - my)) / mr;
          i = y * w + x; A[i] = Math.max(A[i], smooth(1, 0.6, dm) * (0.6 + 0.4 * tdust(x, y)));
        }
      } else if (lm === 'fuser') {
        // tóner sin fundir: se restriega hacia la derecha a tramos
        var rub = new Float32Array(n);
        for (y = 0; y < h; y++) {
          var on = smooth(0.45, 0.65, noise(y / (U * 0.15), 3.3 + sdL * 0.001)), len = U * (0.05 + 0.25 * lA), kk = Math.exp(-1 / Math.max(1.5, len)), acc = 0;
          for (x = 0; x < w; x++) { i = y * w + x; acc = Math.max(A0L[i], acc * kk); rub[i] = acc * on; }
        }
        // fantasma una vuelta de tambor más abajo
        var gdy = Math.round(drumC * 0.55), gdx = Math.round(U * 0.02);
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
          i = y * w + x;
          var src = (y - gdy) >= 0 && (x - gdx) >= 0 ? A0L[(y - gdy) * w + x - gdx] : 0;
          var ghost = src * 0.3 * lA * (0.5 + 0.5 * tbig(x, y));
          var rb = rub[i] * 0.55 * (0.4 + 0.6 * tdust(x, y));
          var fog = 0.05 * lA * smooth(0.45, 0.8, tbig(x, y)) * (0.4 + 0.6 * tdust(x, y));
          // la letra pierde tóner donde se restregó (se queda gris)
          var a0 = A[i] * (1 - 0.45 * rub[i] * smooth(0.45, 0.75, tdust(x, y)) * (A0L[i] > 0.5 ? 1 : 0));
          A[i] = Math.max(a0, rb, ghost, fog);
        }
      } else {
        // tóner agotado: franjas verticales anchas donde la densidad cae; ahí se ve la trama láser
        for (y = 0; y < h; y++) {
          var bandH = 1 - 0.25 * lA * smooth(0.55, 0.75, noise(y / (U * 0.08), 9.1));       // banding horizontal
          for (x = 0; x < w; x++) {
            i = y * w + x; if (A[i] <= 0.01) continue;
            var lowT = smooth(0.35, 0.75, noise(x / (U * 0.5) + sdL * 0.001, 0.7)) * Math.min(1, lA);
            var dens = A[i] * (1 - 0.82 * lowT) * bandH;
            var dot = laserDot(x, y, clamp01(dens));
            var tex = dens > 0.9 ? 1 : dot * (0.75 + 0.25 * tdust(x, y));
            A[i] = A[i] * (lowT > 0.05 ? tex : dens);
          }
        }
      }
      // polvo de tóner por la hoja (motitas finas), más cerca de la tinta
      var nearL = blur(A0L, w, h, U * 0.15, U * 0.15);
      for (i = 0; i < n; i++) {
        if (A[i] > 0.5) continue;
        if (hash(i * 3 + sdL) < (0.002 + 0.02 * nearL[i]) * lA) A[i] = Math.max(A[i], 0.55 + 0.4 * hash(i + sdL));
      }
    }

    // 7a3 · Pigmento acumulado en algunos tramos del borde (sutil) ---------
    if (RI.on && RI.amount > 0) {
      var Dr = distInside(A, w, h, 0.5), rw2 = U * (0.004 + 0.02 * RI.width) + 0.7;
      var grr = grid(function (u, v) { return noise.fbm(u * 1.8 + 77, v * 1.8 - 21, 2); }), PR2 = needPool();
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        if (A[i] <= 0.02) continue;
        var segr = smooth(1 - RI.coverage - 0.08, 1 - RI.coverage + 0.08, grr(x, y));
        var band = Math.exp(-Dr[i] / rw2) * segr * RI.amount;
        if (band <= 0.002) continue;
        A[i] = A[i] + (1 - A[i]) * band * 0.6;
        PR2[i] = Math.max(PR2[i], band);
      }
    }

    // 7a4 · SELLO DE GOMA: presión desigual (sello inclinado), borde cargado, centro pobre, poros
    if (SPm.on) {
      var angS = R() * Math.PI * 2, cS = Math.cos(angS), sS = Math.sin(angS), bwS = input.bw || U * 3;
      var gpS = grid(function (u, v) { return noise.fbm(u * 0.5 + 21, v * 0.5 - 4, 3); });
      var Dst = distInside(A, w, h, 0.5), eW = U * 0.012 + 0.8;
      var tpS = physSampler('b', 380, 'grano'), tpS2 = physSampler('d', 200, 'grano'), PSt = needPool();
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        if (A[i] <= 0) continue;
        var sproj = (((x - ox) * cS + (y - oy) * sS) / bwS) + 0.5;
        var P = 1 - SPm.tilt * smooth(0.0, 1.2, sproj) + (gpS(x, y) - 0.5) * 0.5 * SPm.uneven;
        if (SPm.letterVar > 0) P -= SPm.letterVar * 0.35 * hash(letterOf(i) * 613 + p.seed);
        P = clamp01(P);
        var edgeL = Math.exp(-Dst[i] / eW) * SPm.edge;
        var thrP = 0.25 + 0.7 * P;
        var pore = smooth(thrP - 0.05, thrP + 0.05, tpS(x, y) * 0.7 + tpS2(x, y) * 0.3);
        var dS = clamp01((0.35 + 0.65 * P) * (1 - pore * (1 - edgeL * 0.8)) + edgeL * 0.5);
        A[i] *= dS;
        PSt[i] = Math.max(PSt[i], edgeL * 0.45);
      }
    }

    if (SPm.on && (SPm.periph || 0) > 0) {
      var bxS = ox - U * 0.22, byS = oy - U * 0.2, bwS2 = (input.bw || U * 3) + U * 0.44, bhS = (input.bh || U) + U * 0.4, lwS = U * 0.01 + 1;
      var gpe = grid(function (u, v) { return noise.fbm(u * 1.2 + 5, v * 1.2 + 15, 2); }), sideS = R();
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        var dxl = Math.abs(x - bxS), dxr = Math.abs(x - (bxS + bwS2)), dyt = Math.abs(y - byS), dyb = Math.abs(y - (byS + bhS));
        var inX = x > bxS - lwS && x < bxS + bwS2 + lwS, inY = y > byS - lwS && y < byS + bhS + lwS;
        var dmin = Math.min(inY ? dxl : 1e9, inY ? dxr : 1e9, inX ? dyt : 1e9, inX ? dyb : 1e9);
        if (dmin > lwS * 1.5) continue;
        // solo un tramo del canto toca el papel (el sello se inclina)
        var segP = smooth(0.55, 0.7, gpe(x, y)) * (sideS < 0.5 ? (x < bxS + bwS2 * 0.5 ? 1 : 0.2) : (y > byS + bhS * 0.5 ? 1 : 0.2));
        var vP = clamp01(1 - dmin / lwS) * segP * SPm.periph * 0.55;
        if (vP > A[i]) A[i] = vP;
      }
    }

    // 7b · Litografía: grano de piedra, borde graso y velo de plancha ---------
    if (ST.on && (ST.amount > 0 || ST.veil > 0)) {
      var greasy = ST.greasy || 0, Abs = blur(A, w, h, U * 0.035 * greasy + 0.5, U * 0.035 * greasy + 0.5);
      var stile = 0.3 + 0.8 * (ST.size == null ? 0.4 : ST.size);
      var tst = sampler('b', stile, 0, 'grano'), tst2 = sampler('d', stile * 0.8, 0, 'grano');
      var Nv = ST.veil > 0 ? blur(A, w, h, U * 0.45, U * 0.45) : null, Ast = new Float32Array(n);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        var shs = A[i] + (Abs[i] - A[i]) * greasy, os = 0;
        if (shs > 0.003) {
          var Tt = (ST.tone == null ? 0.8 : ST.tone) * smooth(0, 0.85, shs) * (A[i] > 0 ? 1 : 0.8);
          var gg = tst(x, y) * 0.75 + tst2(x, y) * 0.25;
          var cray = smooth(gg - 0.05, gg + 0.05, Tt);
          os = clamp01(Tt + (cray - Tt) * ST.amount) * (shs > 0.5 ? 1 : smooth(0, 0.5, shs) * 0.6 + 0.4 * shs);
        }
        if (Nv && os < 0.3) os = Math.max(os, ST.veil * 0.14 * smooth(0, 0.5, Nv[i]) * (0.4 + 0.6 * tst(x, y)));
        Ast[i] = os;
      }
      A = Ast;
    }

    // 7c · Acuarela: aguada con manchas, granulación y floraciones ------------
    var washDark = null;
    if (WA.on && (WA.wash > 0 || WA.granul > 0 || WA.blooms > 0)) {
      var tw = sampler('b', 1.6, 0, 'aguada'), twd = sampler('d', 1.2, 0, 'aguada');
      var tgr = sampler('b', 0.7, 0, 'grano'), tgd = sampler('d', 0.5, 0, 'grano');
      washDark = new Float32Array(n);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        if (A[i] <= 0) continue;
        var dw = 1 - WA.wash * 0.62 * (1 - tw(x, y));
        dw *= 1 - WA.granul * 0.45 * smooth(0.45, 0.95, tgd(x, y));
        var settle = WA.granul * 0.35 * smooth(0.72, 0.97, tgr(x, y));
        var bd = twd(x, y), bIn = smooth(0.6, 0.9, bd) * (1 - smooth(0.9, 0.96, bd)), bLn = smooth(0.9, 0.95, bd) * (1 - smooth(0.96, 0.995, bd));
        dw *= 1 - WA.blooms * 0.45 * bIn;
        dw = Math.min(1, dw + bLn * WA.blooms * 0.5 + settle * 0.5);
        A[i] *= clamp01(dw) * (1 - (WA.transp || 0) * 0.5);
        washDark[i] = settle * 0.5 + bLn * WA.blooms * 0.4;
      }
    }

    // 7z · Ganancia de punto óptica: la luz que entra en el papel junto a la tinta se absorbe
    // bajo ella; el borde gana un poco de densidad suave (la tinta "dentro" del papel, no encima)
    var optG = p.out.optical == null ? 0.35 : p.out.optical;
    if (optG > 0) {
      var rO = Math.max(0.6, 0.9 * physK), Ao = blur(A, w, h, rO, rO);
      for (i = 0; i < n; i++) { var dO2 = Ao[i] - A[i]; if (dO2 > 0.004 && Ao[i] > 0.01) A[i] += dO2 * optG * 0.55; }
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
          var reg = PR.regular || 0;
          var qq = q / spacing + (noise(al * invU * 0.8, q / spacing * 0.15 + 50) - 0.5) * 0.35 * (1 - reg);
          var idx = Math.floor(qq), fr = qq - idx;
          var hr = hash(idx + seedOff), hr2 = hash(idx * 7 + 3 + seedOff);
          var str = PR.bands * Math.pow(hr, 1.6 * (1 - reg) + 0.2);
          var lw = bw9 * (0.4 + 0.9 * hr2) * (1 - 0.6 * reg);
          if (reg > 0 && hash(idx * 11 + seedOff) > 0.35 + 0.6 * (1 - PR.bands)) str = Math.max(str, PR.bands * reg);
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
    var anyColor = colorOn || wetW || pool || dark || G || pressDark || washDark || (PA.on && PA.relief > 0);
    // relieve del papel: luz rasante sobre el grano del papel que se ve a través de la tinta
    var relief = null, tooth = null;
    if (PA.on && (PA.relief > 0 || PA.tooth > 0)) {
      var tpp = physSampler('b', 420 * (0.5 + (PA.paperScale == null ? 0.5 : PA.paperScale)), 'grano');
      var Hh = new Float32Array(n);
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) Hh[y * w + x] = tpp(x, y);
      var Hb = blur(Hh, w, h, 1, 1);
      relief = new Float32Array(n);
      for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) {
        i = y * w + x;
        if (A[i] <= 0) continue;
        relief[i] = (Hb[i - w - 1] - Hb[i + w + 1]) * 3.5;                 // luz desde arriba a la izquierda
        if (PA.tooth > 0) A[i] *= 1 - PA.tooth * 0.75 * smooth(0.8, 0.98, Hh[i]);   // la tinta no llega a los valles
      }
    }
    // tintas múltiples (duotono / tritono / riso / 2 colores), mezcla sustractiva
    var nInk = TI.on ? Math.max(1, Math.min(3, TI.count | 0)) : 1;
    var multi = TI.on && (nInk > 1 || TI.screen > 0) && !keyPlate;
    var covs = null, inkCols = null;
    if (keyPlate) { covs = [A, keyPlate]; inkCols = [null, hexToRgb(EN.key || '#161414')]; }
    if (multi) {
      // la trama va en líneas por pulgada reales (igual en toda la página); sin resolución, relativa a U
      var cellT = input.dpi && TI.lpi ? (input.dpi / TI.lpi) * (input.pxScale || 1) : U * (0.018 + 0.1 * (TI.cell == null ? 0.35 : TI.cell));
      cellT = Math.max(2.4, cellT);
      // tono vivo bajo la trama (la tinta nunca es uniforme)
      var ttv = sampler('b', 1.8, 0, 'lavado'), ttv2 = sampler('b', 0.6, 0, 'granul');
      var gtv = grid(function (u, v) { return noise.fbm(u * 0.8 + 3, v * 0.8 - 2, 3); });
      var TV = new Float32Array(n), tvAmt = TI.toneVar == null ? 0.35 : TI.toneVar;
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) { i = y * w + x; if (A[i] > 0) TV[i] = 1 + tvAmt * ((ttv(x, y) - 0.5) * 0.7 + (ttv2(x, y) - 0.5) * 0.35 + (gtv(x, y) - 0.5) * 0.6); }
      var jit = grid(function (u, v) { return noise.fbm(u * 6 + 50, v * 6, 2); }), jit2 = grid(function (u, v) { return noise.fbm(u * 6 - 20, v * 6 + 70, 2); });
      var angles = [45, 75, 15];
      // curvas de cada tinta en dúo/tritono: oscura (sombras), media, clara (luces)
      var curveK = function (k, t) {
        if (nInk === 3) return k === 0 ? Math.pow(t, 1.7) : k === 1 ? t * 0.82 : 0.22 + 0.78 * t;
        if (nInk === 2) return k === 0 ? Math.pow(t, 1.35) : 0.18 + 0.82 * t;
        return t;
      };
      var trg = sampler('d', 0.4, 0, 'grano'), ma0 = (TI.misAng || 0) * Math.PI * 0.5 + Math.PI * 0.25;
      covs = [];
      var baseInk = custom || ink;
      function tint(c, t2) { return [Math.round(c[0] + (255 - c[0]) * t2), Math.round(c[1] + (255 - c[1]) * t2), Math.round(c[2] + (255 - c[2]) * t2)]; }
      inkCols = [null, TI.c2 === 'auto' || !TI.c2 ? tint(baseInk, 0.45) : hexToRgb(TI.c2), TI.c3 === 'auto' || !TI.c3 ? tint(baseInk, 0.72) : hexToRgb(TI.c3)];
      for (var k = 0; k < nInk; k++) {
        var aRad = angles[k] * Math.PI / 180, hcs = Math.cos(aRad) / cellT, hsn = Math.sin(aRad) / cellT, eT = Math.min(0.45, 0.85 / cellT);
        var md = k === 0 ? 0 : U * 0.06 * (TI.misreg || 0) * (k === 1 ? 1 : 0.6) + ((TI.misreg || 0) > 0 ? 0.4 : 0);
        var mdx = Math.cos(ma0 + k * 2.1) * md, mdy = Math.sin(ma0 + k * 2.1) * md, cv = new Float32Array(n);
        var dk = k === 0 ? 1 : (TI.d2 == null ? 1 : TI.d2);
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
          i = y * w + x;
          var sxk = x - mdx, syk = y - mdy, ak = md ? sampleBil(A, w, h, sxk, syk) : A[i];
          if (ak <= 0.002) continue;
          var cover = ak * dk * (TI.tone == null ? 1 : TI.tone) * TV[i];
          if (TI.screen > 0) {
            var mask = smooth(0.08, 0.5, ak), tc = curveK(k, clamp01(cover));
            var tt2 = tc + (TI.gain || 0) * tc * (1 - tc) * 1.3;
            // posición del punto algo irregular (la plancha y el papel no son perfectos)
            var jx = sxk + (jit(x, y) - 0.5) * cellT * 0.35, jy = syk + (jit2(x, y) - 0.5) * cellT * 0.35;
            var hu2 = jx * hcs + jy * hsn, hv2 = -jx * hsn + jy * hcs;
            var sp2 = 0.5 - 0.25 * (Math.cos(6.283 * hu2) + Math.cos(6.283 * hv2)) + (trg(x, y) - 0.5) * 0.22;
            var dot = tt2 <= 0.001 ? 0 : tt2 >= 0.999 ? 1 : smooth(sp2 - eT, sp2 + eT, tt2);
            // corrido (slur): el punto engorda en una sola dirección; doble impresión: punto fantasma
            if ((TI.slur || 0) > 0 || (TI.double || 0) > 0) {
              var sls = (TI.slur || 0) * cellT * 0.35, dbl = cellT * 0.28;
              if (sls > 0) { var hu3 = (jx - sls) * hcs + jy * hsn, hv3 = -(jx - sls) * hsn + jy * hcs, sp3 = 0.5 - 0.25 * (Math.cos(6.283 * hu3) + Math.cos(6.283 * hv3)); dot = Math.max(dot, smooth(sp3 - eT, sp3 + eT, tt2) * 0.92); }
              if ((TI.double || 0) > 0) { var hu4 = (jx + dbl) * hcs + (jy + dbl * 0.4) * hsn, hv4 = -(jx + dbl) * hsn + (jy + dbl * 0.4) * hcs, sp4 = 0.5 - 0.25 * (Math.cos(6.283 * hu4) + Math.cos(6.283 * hv4)); dot = Math.max(dot, smooth(sp4 - eT, sp4 + eT, tt2) * TI.double * 0.45); }
            }
            if ((TI.donut || 0) > 0 && dot > 0) dot *= 1 - TI.donut * 0.6 * (1 - smooth(0.15, 0.75, sp2 / Math.max(0.01, tt2)));
            cover = (tc + (dot - tc) * TI.screen) * mask;
          }
          cv[i] = clamp01(cover);
        }
        // hickeys: partículas de suciedad en la mantilla -> isla de tinta con halo blanco (o hueco)
        if ((TI.hickeys || 0) > 0) {
          var nh = Math.round(TI.hickeys * 6 * Math.max(1, (input.bw || U * 3) / U)), Rh = rng(p.seed * 17 + k * 101);
          for (var hq = 0; hq < nh * 6 && nh > 0; hq++) {
            var hx = Math.floor(Rh() * w), hy = Math.floor(Rh() * h), hi = hy * w + hx;
            if (A[hi] < 0.6) continue;
            nh--; var rh = Math.max(2, U * (0.008 + 0.012 * Rh())), solid = Rh() < 0.65;
            for (var yq = hy - Math.ceil(rh) - 1; yq <= hy + rh + 1; yq++) for (var xq = hx - Math.ceil(rh) - 1; xq <= hx + rh + 1; xq++) {
              if (xq < 0 || yq < 0 || xq >= w || yq >= h) continue;
              var dqh = Math.sqrt((xq - hx) * (xq - hx) + (yq - hy) * (yq - hy)), jq = yq * w + xq;
              if (dqh < rh * 0.42) { if (solid) cv[jq] = 1; else cv[jq] *= smooth(rh * 0.3, rh * 0.42, dqh); }
              else if (dqh < rh) cv[jq] *= solid ? smooth(rh * 0.9, rh, dqh) : 1;
            }
          }
        }
        covs.push(cv);
      }
    }
    for (i = 0; i < n; i++) {
      var a2 = covs ? covs[0][i] : A[i], ga = G ? G[i] : 0;
      var anyInk = a2 > 0.0005 || ga > 0.0005;
      if (covs && !anyInk) for (var kk = 1; kk < covs.length; kk++) if (covs[kk][i] > 0.0005) { anyInk = true; break; }
      if (!anyInk) continue;
      var o = i * 4, cr, cg, cb;
      if (custom) { cr = custom[0]; cg = custom[1]; cb = custom[2]; }
      else if (rgb) {
        var ci = cidx[i];
        if (ci >= 0 && A0[ci] > 0.35) { cr = rgb[ci * 3]; cg = rgb[ci * 3 + 1]; cb = rgb[ci * 3 + 2]; }
        else { var nn0 = getNear()[i]; if (nn0 >= 0) { cr = rgb[nn0 * 3]; cg = rgb[nn0 * 3 + 1]; cb = rgb[nn0 * 3 + 2]; } else { cr = ink[0]; cg = ink[1]; cb = ink[2]; } }
      } else { cr = ink[0]; cg = ink[1]; cb = ink[2]; }
      if (!anyColor && !covs) {
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
      if (pressDark) { dL -= pressDark[i] * 0.4; dS += pressDark[i] * 0.2; }
      if (LV.on) {   // variaciones muy ligeras entre letras (carga de tinta y tono)
        var lidv = letterOf(i), hv1 = hash(lidv * 313 + p.seed), hv2b = hash(lidv * 727 + 11 + p.seed);
        a2 *= 1 - LV.density * 0.18 * hv1;
        dL += (hv2b - 0.5) * LV.tone * 0.14; dH += (hv1 - 0.5) * LV.tone * 0.02;
      }
      if (washDark) { dL -= washDark[i] * 0.4; dS += washDark[i] * 0.25; }
      if (relief) { var rv = relief[i] * PA.relief; dL += rv * 0.35; if (rv > 0) a2 *= 1 - Math.min(0.5, rv * 0.5); }
      dS = Math.max(-1, Math.min(1, dS)); dL = Math.max(-1, Math.min(1, dL));
      var hh = (neutral ? 0.08 : baseH) + dH;                 // las tintas neutras toman un matiz cálido al saturar
      var ss = neutral ? Math.max(0, dS) * 0.35 + baseS : adj(baseS, dS);
      var ll = adj(baseL, dL);
      hsl2rgb(hh, clamp01(ss), clamp01(ll), tmp, 0);
      if (covs) {
        // mezcla sustractiva exacta sobre blanco: P = Π(1 - a·(1 - c))
        var Pr = 1 - a2 * (1 - tmp[0] / 255), Pg = 1 - a2 * (1 - tmp[1] / 255), Pb = 1 - a2 * (1 - tmp[2] / 255), Qm = 1 - a2;
        for (var k2 = 1; k2 < covs.length; k2++) {
          var ak2 = covs[k2][i] * (relief ? 1 - Math.max(0, relief[i] * PA.relief) * 0.4 : 1);
          if (ak2 <= 0) continue;
          var ic = inkCols[k2];
          Pr *= 1 - ak2 * (1 - ic[0] / 255); Pg *= 1 - ak2 * (1 - ic[1] / 255); Pb *= 1 - ak2 * (1 - ic[2] / 255); Qm *= 1 - ak2;
        }
        if (ga > 0.0005) {
          if (neutral) hsl2rgb(0.08 + ghH, ghH !== 0 ? 0.78 : 0, ghH !== 0 ? 0.55 : clamp01(adj(baseL, 0.2)), gr2, 0);
          else hsl2rgb(baseH + ghH, baseS, clamp01(adj(baseL, 0.12)), gr2, 0);
          Pr *= 1 - ga * (1 - gr2[0] / 255); Pg *= 1 - ga * (1 - gr2[1] / 255); Pb *= 1 - ga * (1 - gr2[2] / 255); Qm *= 1 - ga;
        }
        var At = 1 - Qm;
        if (At < 0.002) continue;
        rgba[o] = Math.round(clamp01((Pr - Qm) / At) * 255);
        rgba[o + 1] = Math.round(clamp01((Pg - Qm) / At) * 255);
        rgba[o + 2] = Math.round(clamp01((Pb - Qm) / At) * 255);
        rgba[o + 3] = Math.round(clamp01(At) * op * 255);
        continue;
      }
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
    inp.bh = m.box.bottom - m.box.top;
    inp.origin = { x: pd.l + m.box.left, y: pd.t + m.box.top };
    inp.ink = averageInk(inp.alpha, inp.rgb, inp.w * inp.h);
    inp.pad = pd;
    return inp;
  }

  var DEFAULTS = {
    texture: 'desgaste_1', texScale: 1, stretch: 0, effectScale: 1, seed: 1,
    warp: { on: true, amount: 0.25, rough: 0.4 },
    erode: { on: true, amount: 0.25, distrib: 0.5, contrast: 0.6, fam: 'desgaste', perLetter: 0, protect: 0 },
    cracks: { on: false, amount: 0.3, fam: 'desgaste' },
    bleed: { on: false, amount: 0.3, dir: 0, wet: 0.6, pool: 0.5, halo: 0.7, hue: 0, sat: 0, light: 0.15, zones: 0, zoneSize: 0.5, dissolve: 0, tide: 0 },
    drips: { on: false, length: 0.35, amount: 0.5, up: 0, drops: 0, thick: 0.5 },
    splat: { on: false, amount: 0.3, spread: 0.4, size: 0.5, drops: 0 },
    ink: { on: true, pressure: 0.3, grain: 0.3, fade: 0, roller: 0 },
    print: { on: false, bands: 0.45, spacing: 0.35, width: 0.3, dir: -1, shift: 0, streaks: 0, regular: 0, halftone: 0, dot: 0.35, ghost: 0, ghostOff: 0.35, ghostHue: 0 },
    color: { on: true, hue: 0, sat: 0, light: 0, hueVar: 0.15, satVar: 0.2, lightVar: 0.3, edge: 0.3 },
    paper: { on: true, feather: 0.3, relief: 0.35, tooth: 0.15, paperScale: 0.5 },
    tintas: { on: false, count: 1, c2: '#0078bf', c3: '#f5c400', d2: 1, tone: 1, toneVar: 0.35, lpi: 0, screen: 0, cell: 0.35, gain: 0.25, donut: 0, misreg: 0.3, misAng: 0.3 },
    press: { on: false, squeeze: 0.5, halo: 0.35, starve: 0.3 },
    wood: { on: false, grain: 0.55, angle: 0, spacing: 0.4, chips: 0.25 },
    mesh: { on: false, sawtooth: 0.4, mesh: 0.3, voids: 0.2 },
    stone: { on: false, amount: 0.6, size: 0.4, tone: 0.8, greasy: 0.4, veil: 0.15 },
    wash: { on: false, wash: 0.5, granul: 0.5, blooms: 0.3, transp: 0.3 },
    seep: { on: false, amount: 0.45, reach: 0.35, density: 0.7, front: 0.5 },
    wick: { on: false, mode: 'fiber', amount: 0.6, reach: 0.5, front: 0.5, dir: 0.06, drag: 0.5 },
    engrave: { on: false, mode: 'horizontal', lightAng: -0.6, spacing: 0.35, width: 0.6, length: 0.7, skip: 0.12, wobble: 0.5, light: 1, shadow: 0.6, two: false, misreg: 0.4, key: '#161414' },
    stamp: { on: false, tilt: 0.45, uneven: 0.5, edge: 0.5, letterVar: 0.3 },
    letters: { on: false, density: 0.4, tone: 0.4 },
    damp: { on: false, global: false, amount: 0.45, size: 0.5, spread: 0.5, cloud: 0.8, lift: 0.35, tide: 0.35, cockle: 0.5 },
    aqua: { on: false, density: 0.5, variation: 0.6, rim: 0.85, rimWidth: 0.35, granul: 0.45, blooms: 0.3, edgeWobble: 0.5, drift: 0.55, letterVar: 0.6, dry: 0.25 },
    gouge: { on: false, zone: 0.45, spacing: 0.4, length: 0.45, width: 0.7, edge: 0.75, inner: 0.35, chaos: 0.4, angle: 0 },
    rim: { on: false, amount: 0.35, width: 0.3, coverage: 0.4 },
    stencil: { on: false, fiber: 0.5, density: 0.35, spread: 0.4, setoff: 0.3, oil: 0.5, starve: 0.3 },
    copy: { on: false, gen: 0.4, dropout: 0.4, toner: 0.4, streaks: 0.4, haze: 0.2 },
    soak: { on: false, mode: 'paper', amount: 0.8 },
    tangle: { on: false, amount: 0.8, comb: 0.4 },
    laser: { on: false, mode: 'drum', amount: 0.8 },
    glitch: { on: false, mode: 'collage', amount: 0.8 },
    drip: { on: false, amount: 0.5, length: 0.45, thick: 0.4, sag: 0.5, beads: 0.3, trail: 0.3, dark: 0.6, absorb: 0, runs: 0 },
    out: { hard: 0.2, opacity: 1, color: 'original', blend: 'auto' }
  };

  var api = {
    VERSION: '0.5.0',
    DEFAULTS: DEFAULTS, prepareTexture: prepareTexture, measure: measure, margin: margin,
    render: render, buildInput: buildInput, prepareDrips: prepareDrips, averageInk: averageInk, hexToRgb: hexToRgb, prepare: prepare
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AFXEngine = api;
})(this);
