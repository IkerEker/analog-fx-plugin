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
    return Math.ceil(Math.min(m + ext, U * 3) + 3);
  }


  // ------------------------------------------------------------------ distancia al borde
  // Distancia aproximada (chaflán 3-4, en px) desde cada píxel de la máscara al exterior.
  function distInside(A, w, h, thr) {
    var n = w * h, D = new Float32Array(n), BIG = 1e9, x, y, i;
    for (i = 0; i < n; i++) D[i] = A[i] > thr ? BIG : 0;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x; if (D[i] === 0) continue;
      var v = D[i];
      if (x > 0) v = Math.min(v, D[i - 1] + 1); else v = Math.min(v, 1);
      if (y > 0) { v = Math.min(v, D[i - w] + 1); if (x > 0) v = Math.min(v, D[i - w - 1] + 1.4142); if (x < w - 1) v = Math.min(v, D[i - w + 1] + 1.4142); } else v = Math.min(v, 1);
      D[i] = v;
    }
    for (y = h - 1; y >= 0; y--) for (x = w - 1; x >= 0; x--) {
      i = y * w + x; if (D[i] === 0) continue;
      var u = D[i];
      if (x < w - 1) u = Math.min(u, D[i + 1] + 1); else u = Math.min(u, 1);
      if (y < h - 1) { u = Math.min(u, D[i + w] + 1); if (x < w - 1) u = Math.min(u, D[i + w + 1] + 1.4142); if (x > 0) u = Math.min(u, D[i + w - 1] + 1.4142); } else u = Math.min(u, 1);
      D[i] = u;
    }
    return D;
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

  // ------------------------------------------------------------------ GOTEO: gotas que nacen de cada letra
  function dripsFromLetters(A, w, h, U, P, R, noise, dark) {
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
      // menisco: la tinta se acumula y abomba la base del trazo
      if (P.sag > 0) {
        for (var pi2 = 0; pi2 < run.pts.length; pi2++) {
          var px2 = run.pts[pi2][0], py2 = run.pts[pi2][1];
          var tt = pi2 / Math.max(1, run.pts.length - 1), env = Math.sin(Math.PI * tt);
          var hh = U * 0.012 * P.sag * env * (0.4 + 0.8 * noise(px2 / U * 6, py2 / U * 3));
          for (var k2 = 1; k2 <= Math.ceil(hh); k2++) put(px2, py2 + k2, clamp01(hh - k2 + 1), 0.25 * P.sag);
        }
      }
      var expected = Math.min(6, len / U * P.amount * 7 + P.amount * 0.6);
      var nd = Math.floor(expected) + (R() < expected - Math.floor(expected) ? 1 : 0);
      for (var d = 0; d < nd && count < MAX; d++) {
        count++;
        var rw = Math.max(0.9, U * (0.006 + 0.02 * P.thick * Math.pow(R(), 1.1)));
        var L = U * (0.03 + 1.7 * P.length * Math.pow(R(), 2.3)) + rw * 3;
        var pk = run.pts[Math.min(run.pts.length - 1, Math.floor(rw + R() * Math.max(1, run.pts.length - 2 * rw)))];
        var cx = pk[0], y0 = pk[1], ex = cx, drift = (R() - 0.5) * 0.08;
        var thin = rw < U * 0.006;
        // el menisco: la tinta sale de la base formando un filete cóncavo que se funde con la letra
        var Lf = rw * (3 + 3 * R()) + U * 0.01, Fw = rw * (2.2 + 2.5 * R());
        var ya0 = Math.round(y0 - rw * 1.5);
        for (var t = ya0 - y0; t <= L; t++) {
          var yy = Math.round(y0 + t); if (yy >= h || yy < 0) continue;
          var tl = Math.max(0, t) / L;
          var tf = Math.max(0, t) / Lf, fil = t < 0 ? 1 : tf < 1 ? (1 - Math.sqrt(1 - (1 - tf) * (1 - tf))) : 0;
          var hw = rw * (1 - 0.4 * tl) + Fw * fil + 0.2;
          ex = cx + drift * Math.max(0, t) + (noise(t / U * 4 + d * 3.1 + r, r * 0.7) - 0.5) * rw * 1.1;
          var xa = Math.floor(ex - hw - 2), xb = Math.ceil(ex + hw + 2);
          var edgeN = 0.6 + 0.4 * noise(yy / U * 22 + d, d * 1.3);           // borde algo irregular
          for (var xx = xa; xx <= xb; xx++) {
            var dd = Math.abs(xx - ex), cov = smooth(hw + 0.9 * edgeN, hw - 0.9, dd) * (thin ? 0.85 : 1);
            // pigmento: nulo en la raíz (se funde con la letra), crece hacia abajo
            var dk = (0.15 + 0.35 * (1 - dd / (hw + 0.5))) * cov * P.dark * smooth(0, 0.35, tl);
            if (cov > 0) put(xx, yy, cov, dk);
          }
        }
        // gota final alargada (lágrima): más pigmento, más oscura
        var rb = rw * (1.15 + 0.6 * R());
        ellipse(ex, y0 + L, rb, rb * (1.15 + 0.4 * R()), 0.7 * P.dark);
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
  function paintDrops(A, w, h, U, amount, length, R, noise, wetW, thick) {
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
      return makeSampler(which === 'd' ? T.detail : T.base, T.size, U, tile * tileMul, ang, st, ox, oy, ofx * T.size, ofy * T.size);
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
    var DP = p.damp || {}, AQ = p.aqua || {}, GO = p.gouge || {}, RI = p.rim || {}, SN = p.stencil || {}, CP = p.copy || {}, DR = p.drip || {};

    // 1b · Fibras del papel: la tinta se escapa por las fibras (feathering) ----
    if (PA.on && PA.feather > 0) {
      var frR = U * 0.014 * PA.feather + 0.8, Af = blur(A, w, h, frR, frR);
      var tfa = sampler('d', 0.35, 1.3, 'grano'), tfb = sampler('d', 0.5, -1.3, 'grano'), tfc = sampler('d', 0.22, 0, 'grano');
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

    // 1c · ACUARELA: forma con borde definido, pigmento transparente, aro oscuro, granulación y floraciones
    if (AQ.on) {
      var tlv = sampler('b', 4.5, 0, 'lavado'), tlv2 = sampler('b', 1.2, 0, 'lavado');
      var Ae = blur(A, w, h, U * 0.01 + 0.6, U * 0.01 + 0.6), Aq = new Float32Array(n);
      for (i = 0; i < n; i++) {
        if (Ae[i] < 0.01) continue;
        y = (i / w) | 0; x = i - y * w;
        Aq[i] = smooth(0.44, 0.52, Ae[i] + (tlv2(x, y) - 0.5) * 0.12 * AQ.edgeWobble);
      }
      var Dq = distInside(Aq, w, h, 0.5);
      var rimW = U * (0.004 + 0.016 * AQ.rimWidth) + 0.7;
      var tgq = sampler('d', 0.22, 0, 'granul'), tgq2 = sampler('b', 0.35, 0, 'granul');
      var tfl = sampler('b', 1.6, 0, 'floracion'), tfd = sampler('d', 1.6, 0, 'floracion');
      var grim = grid(function (u, v) { return noise.fbm(u * 2.2 + 5, v * 2.2 + 11, 2); });
      var gflow = grid(function (u, v) { return noise.fbm(u * 0.6 + 40, v * 0.6 - 3, 3); });
      var PQ = needPool();
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        var sq = Aq[i];
        if (sq <= 0.002) { A[i] = 0; continue; }
        var dq = Dq[i];
        // densidad del lavado: manchas suaves y desplazamiento del pigmento al secar
        var dn = AQ.density * (1 + AQ.variation * ((tlv(x, y) - 0.5) * 0.55 + (gflow(x, y) - 0.5) * 0.7));
        // floraciones: zonas donde el agua empujó el pigmento (más claras, con línea oscura)
        var bl = 0, bline = 0;
        if (AQ.blooms > 0) {
          var fv = tfl(x, y);
          bl = smooth(1 - AQ.blooms * 0.55, 1 - AQ.blooms * 0.55 + 0.05, fv);
          bline = smooth(0.1, 0.02, tfd(x, y)) * AQ.blooms;
          dn *= 1 - 0.45 * bl;
        }
        // granulación: pigmento en los valles del papel
        var gq = tgq(x, y), settle = AQ.granul * smooth(0.6, 0.95, tgq2(x, y));
        dn *= 1 - AQ.granul * 0.3 * smooth(0.55, 0.92, gq);
        dn += settle * 0.15;
        // aro de pigmento acumulado en el borde (efecto "anillo de café"), discontinuo
        var seg = 0.55 + 0.45 * smooth(0.3, 0.7, grim(x, y));
        var rim = Math.exp(-dq / rimW) * AQ.rim * seg;
        var aOut = clamp01(dn + (0.97 - dn) * Math.min(1, rim * 1.15) + bline * 0.35);
        A[i] = sq * aOut;
        PQ[i] = Math.max(PQ[i], Math.min(1, rim * 1.1) * 0.75 + bline * 0.5 + settle * 0.35);
      }
      shape = A;
    }

    // 1d · HUMEDAD: gotas de agua sobre la impresión. Donde el agua toca, la tinta
    // se disuelve en el papel: nube granulosa que sigue la fibra, densa junto a la
    // letra, que rellena los huecos y se detiene en el límite del agua. Fuera, nítido.
    if (DP.on && DP.amount > 0) {
      // 1) dónde ha caído el agua: manchas grandes con borde orgánico
      var zsD = 0.9 + 2.6 * DP.size;
      var tzw = sampler('b', zsD * 1.1, 0, 'floracion'), tzw2 = sampler('d', 0.6, 0, 'lavado');
      var gzw = grid(function (u, v) { return noise.fbm(u / zsD + 13, v / zsD - 7, 3); });
      var Wd = new Float32Array(n), cov0 = DP.amount;
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        var fz = gzw(x, y) * 0.6 + tzw(x, y) * 0.4 + (tzw2(x, y) - 0.5) * 0.06;
        Wd[i] = smooth(1 - cov0 - 0.03, 1 - cov0 + 0.03, fz);
      }
      // 2) la tinta se disuelve: difusión a dos escalas (cerca densa, lejos tenue)
      var rN = U * (0.03 + 0.07 * DP.spread), rF = U * (0.08 + 0.22 * DP.spread);
      var Bn = blur(A, w, h, rN, rN), Bf = blur(A, w, h, rF, rF);
      var tfib = sampler('d', 0.18, 0, 'fibra'), tfib2 = sampler('b', 0.4, 0, 'granul'), tlift = sampler('b', 0.9, 0, 'lavado');
      var Ad = new Float32Array(n), Wb = blur(Wd, w, h, 1.2, 1.2), PDm = needPool();
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        var a0 = A[i], wv = Wb[i];
        if (wv <= 0.003) { Ad[i] = a0; continue; }
        // nube de tinta disuelta: granulosa, modulada por la fibra del papel
        var cloud = Math.pow(clamp01(Bn[i] * 1.15), 0.8) * 0.85 + Math.pow(clamp01(Bf[i] * 1.4), 0.9) * 0.45;
        var fibv = tfib(x, y), grv = tfib2(x, y);
        cloud *= 0.55 + 0.75 * smooth(0.25, 0.85, fibv) * (0.6 + 0.6 * grv);
        cloud = clamp01(cloud) * DP.cloud;
        // la letra pierde el borde y se lava en parte por dentro
        var core = a0 * (1 - DP.lift * 0.55 * smooth(0.45, 0.85, tlift(x, y)) * (0.4 + 0.6 * fibv));
        var soft = Math.max(core * smooth(0.35, 0.9, Bn[i] + (fibv - 0.5) * 0.25), cloud);
        var wet = Math.max(soft, cloud);
        // línea de marea: el pigmento arrastrado se acumula en el borde del agua
        var tide = DP.tide * smooth(0.15, 0.45, wv) * (1 - smooth(0.5, 0.85, wv)) * smooth(0.02, 0.25, Bf[i]);
        wet = wet + (1 - wet) * tide * 0.55;
        Ad[i] = a0 + (wet - a0) * wv;
        if (tide > 0) PDm[i] = Math.max(PDm[i], tide * 0.6);
      }
      A = Ad; shape = A;
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
    if (DR.on) {
      // rastro de tinta que cae: estela vertical tenue con textura de goteo
      if (DR.trail > 0 && false) {
        var trail = new Float32Array(n), decay = Math.exp(-1 / (U * (0.1 + 1.2 * DR.length)));
        for (x = 0; x < w; x++) { var pv = 0; for (y = 0; y < h; y++) { i = y * w + x; pv = Math.max(A[i] > 0.5 ? 1 : 0, pv * decay); trail[i] = pv; } }
        var tgt = isoSampler('b', 1.6, 'goteo', 0, 0.6), tgt2 = isoSampler('d', 0.8, 'goteo', 0, 0.9);
        for (i = 0; i < n; i++) {
          var tv = trail[i];
          if (tv < 0.02 || A[i] > 0.98) continue;
          y = (i / w) | 0; x = i - y * w;
          var streak = smooth(0.62, 0.9, 1 - tgt(x, y)) * 0.7 + smooth(0.75, 0.95, 1 - tgt2(x, y)) * 0.5;
          var av = tv * streak * DR.trail * 0.55;
          if (av > A[i]) A[i] = av;
        }
      }
      dripsFromLetters(A, w, h, U, DR, R, noise, needDark());
      shape = A;
    }
    if (p.drips.on && p.drips.drops > 0) {
      paintDrops(A, w, h, U, p.drips.drops, Math.max(0.05, p.drips.length), R, noise, wetW, p.drips.thick);
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
        A[i] = Math.max(outp, PS.halo * 0.5 * rh * (0.45 + 0.55 * smooth(0.3, 0.7, tmo(x, y))));
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
      var tfb = sampler('d', 0.25, 0, 'fibra'), tfb2 = sampler('b', 1.1, 0, 'fibra'), tfb3 = sampler('d', 0.1, 0, 'fibra');
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        if (A[i] <= 0) continue;
        var fb = tfb(x, y), fb3 = tfb3(x, y);
        var dd = 1 - SN.fiber * 0.75 * smooth(0.7, 0.92, fb) - SN.fiber * 0.35 * smooth(0.75, 0.95, fb3);
        dd *= 1 - SN.density * 0.45 * smooth(0.35, 0.85, tfb2(x, y));
        A[i] *= clamp01(dd);
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
    if (CP.on) {
      var ttn = sampler('d', 0.3, 0, 'toner'), ttb = sampler('b', 0.7, 0, 'toner'), ttf = sampler('d', 0.09, 0, 'toner');
      if (CP.gen > 0) {   // cada generación engorda, rompe y redondea los trazos
        var Bg = blur(A, w, h, U * 0.008 * CP.gen + 0.6, U * 0.008 * CP.gen + 0.6);
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
          i = y * w + x;
          if (Bg[i] < 0.005) { A[i] = 0; continue; }
          var thrg = 0.5 - 0.1 * CP.gen + (ttn(x, y) - 0.5) * 0.3 * CP.gen;
          A[i] = smooth(thrg - 0.05, thrg + 0.05, Bg[i]);
        }
      }
      var nearC = blur(A, w, h, U * 0.12, U * 0.12), DKc = needDark(), sdC = p.seed * 313;
      var stW = Math.max(1, U * 0.003), gstr = grid(function (u, v) { return noise.fbm(u * 0.15 + 9, v * 1.8, 2); });
      for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
        i = y * w + x;
        var ac = A[i];
        if (ac > 0) {
          // tóner que no agarra en los negros (puntitos y zonas blancas)
          var tbv = ttb(x, y), clus = smooth(0.55, 0.85, tbv);
          ac *= 1 - CP.dropout * (0.95 * smooth(0.86, 0.95, ttf(x, y)) * (0.25 + 0.75 * clus) + 0.35 * smooth(0.75, 0.95, tbv));
        }
        // motas de tóner junto al negro
        var nr = nearC[i];
        if (nr > 0.01 && ac < 0.9) {
          var spk = smooth(1 - CP.toner * 0.05, 1 - CP.toner * 0.05 + 0.008, 1 - ttf(x, y)) * smooth(0.04, 0.5, nr) * smooth(0.3, 0.7, 1 - ttb(x, y));
          ac = Math.max(ac, spk * 0.95);
          ac = Math.max(ac, CP.haze * 0.1 * smooth(0.05, 0.6, nr) * (0.5 + ttb(x, y)));
        }
        // rayas del tambor: finas, verticales (sentido del papel), de intensidad variable
        if (CP.streaks > 0) {
          var col = Math.floor((x - ox) / stW), hs = hash(col * 7 + sdC);
          if (hs > 1 - CP.streaks * 0.035) {
            var sv = smooth(0.3, 0.75, gstr(x, y)) * (0.35 + 0.65 * hash(col * 3 + 1 + sdC));
            if (hash(col + 99 + sdC) < 0.6) ac = ac + (1 - ac) * sv * 0.55 * smooth(0, 0.45, nr);   // raya oscura
            else ac *= 1 - sv * 0.7;                                                                     // raya clara
            DKc[i] = Math.max(DKc[i], sv * 0.3);
          }
        }
        A[i] = ac;
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
      var tpp = sampler('b', 0.55 * (PA.paperScale == null ? 1 : PA.paperScale + 0.3), 0, 'grano');
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
    var multi = TI.on && (nInk > 1 || TI.screen > 0);
    var covs = null, inkCols = null;
    if (multi) {
      var cellT = Math.max(2.6, U * (0.018 + 0.1 * (TI.cell == null ? 0.35 : TI.cell)));
      var angles = [45, 75, 15];
      // curvas de cada tinta en dúo/tritono: oscura (sombras), media, clara (luces)
      var curveK = function (k, t) {
        if (nInk === 3) return k === 0 ? Math.pow(t, 1.7) : k === 1 ? t * 0.82 : 0.22 + 0.78 * t;
        if (nInk === 2) return k === 0 ? Math.pow(t, 1.35) : 0.18 + 0.82 * t;
        return t;
      };
      var trg = sampler('d', 0.4, 0, 'grano'), ma0 = (TI.misAng || 0) * Math.PI * 0.5 + Math.PI * 0.25;
      covs = []; inkCols = [null, hexToRgb(TI.c2 || '#0078bf'), hexToRgb(TI.c3 || '#f5c400')];
      for (var k = 0; k < nInk; k++) {
        var aRad = angles[k] * Math.PI / 180, hcs = Math.cos(aRad) / cellT, hsn = Math.sin(aRad) / cellT, eT = Math.min(0.45, 0.85 / cellT);
        var md = k === 0 ? 0 : U * 0.06 * (TI.misreg || 0) * (k === 1 ? 1 : 0.6) + ((TI.misreg || 0) > 0 ? 0.4 : 0);
        var mdx = Math.cos(ma0 + k * 2.1) * md, mdy = Math.sin(ma0 + k * 2.1) * md, cv = new Float32Array(n);
        var dk = k === 0 ? 1 : (TI.d2 == null ? 1 : TI.d2);
        for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
          i = y * w + x;
          var sxk = x - mdx, syk = y - mdy, ak = md ? sampleBil(A, w, h, sxk, syk) : A[i];
          if (ak <= 0.002) continue;
          var cover = ak * dk * (TI.tone == null ? 1 : TI.tone);
          if (TI.screen > 0) {
            var mask = smooth(0.08, 0.5, ak), tc = curveK(k, clamp01(cover));
            var tt2 = tc + (TI.gain || 0) * tc * (1 - tc) * 1.3;
            var hu2 = sxk * hcs + syk * hsn, hv2 = -sxk * hsn + syk * hcs;
            var sp2 = 0.5 - 0.25 * (Math.cos(6.283 * hu2) + Math.cos(6.283 * hv2)) + (trg(x, y) - 0.5) * 0.12;
            var dot = tt2 <= 0.001 ? 0 : tt2 >= 0.999 ? 1 : smooth(sp2 - eT, sp2 + eT, tt2);
            if ((TI.donut || 0) > 0 && dot > 0) dot *= 1 - TI.donut * 0.6 * (1 - smooth(0.15, 0.75, sp2 / Math.max(0.01, tt2)));
            cover = (tc + (dot - tc) * TI.screen) * mask;
          }
          cv[i] = clamp01(cover);
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
        else { cr = ink[0]; cg = ink[1]; cb = ink[2]; }
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
    inp.origin = { x: pd.l + m.box.left, y: pd.t + m.box.top };
    inp.ink = averageInk(inp.alpha, inp.rgb, inp.w * inp.h);
    inp.pad = pd;
    return inp;
  }

  var DEFAULTS = {
    texture: 'desgaste_1', texScale: 1, stretch: 0, effectScale: 1, seed: 1,
    warp: { on: true, amount: 0.25, rough: 0.4 },
    erode: { on: true, amount: 0.25, distrib: 0.5, contrast: 0.6 },
    cracks: { on: false, amount: 0.3 },
    bleed: { on: false, amount: 0.3, dir: 0, wet: 0.6, pool: 0.5, halo: 0.7, hue: 0, sat: 0, light: 0.15, zones: 0, zoneSize: 0.5, dissolve: 0, tide: 0 },
    drips: { on: false, length: 0.35, amount: 0.5, up: 0, drops: 0, thick: 0.5 },
    splat: { on: false, amount: 0.3, spread: 0.4, size: 0.5, drops: 0 },
    ink: { on: true, pressure: 0.3, grain: 0.3, fade: 0, roller: 0 },
    print: { on: false, bands: 0.45, spacing: 0.35, width: 0.3, dir: -1, shift: 0, streaks: 0, regular: 0, halftone: 0, dot: 0.35, ghost: 0, ghostOff: 0.35, ghostHue: 0 },
    color: { on: true, hue: 0, sat: 0, light: 0, hueVar: 0.15, satVar: 0.2, lightVar: 0.3, edge: 0.3 },
    paper: { on: true, feather: 0.3, relief: 0.35, tooth: 0.15, paperScale: 0.5 },
    tintas: { on: false, count: 1, c2: '#0078bf', c3: '#f5c400', d2: 1, tone: 1, screen: 0, cell: 0.35, gain: 0.25, donut: 0, misreg: 0.3, misAng: 0.3 },
    press: { on: false, squeeze: 0.5, halo: 0.35, starve: 0.3 },
    wood: { on: false, grain: 0.55, angle: 0, spacing: 0.4, chips: 0.25 },
    mesh: { on: false, sawtooth: 0.4, mesh: 0.3, voids: 0.2 },
    stone: { on: false, amount: 0.6, size: 0.4, tone: 0.8, greasy: 0.4, veil: 0.15 },
    wash: { on: false, wash: 0.5, granul: 0.5, blooms: 0.3, transp: 0.3 },
    damp: { on: false, amount: 0.45, size: 0.5, spread: 0.5, cloud: 0.8, lift: 0.35, tide: 0.35 },
    aqua: { on: false, density: 0.55, variation: 0.5, rim: 0.7, rimWidth: 0.35, granul: 0.4, blooms: 0.3, edgeWobble: 0.5 },
    gouge: { on: false, zone: 0.45, spacing: 0.4, length: 0.45, width: 0.7, edge: 0.75, inner: 0.35, chaos: 0.4, angle: 0 },
    rim: { on: false, amount: 0.35, width: 0.3, coverage: 0.4 },
    stencil: { on: false, fiber: 0.5, density: 0.35, spread: 0.4, setoff: 0.3 },
    copy: { on: false, gen: 0.4, dropout: 0.4, toner: 0.4, streaks: 0.4, haze: 0.2 },
    drip: { on: false, amount: 0.5, length: 0.45, thick: 0.4, sag: 0.5, beads: 0.3, trail: 0.3, dark: 0.6 },
    out: { hard: 0.2, opacity: 1, color: 'original', blend: 'auto' }
  };

  var api = {
    VERSION: '0.5.0',
    DEFAULTS: DEFAULTS, prepareTexture: prepareTexture, measure: measure, margin: margin,
    render: render, buildInput: buildInput, averageInk: averageInk, hexToRgb: hexToRgb, prepare: prepare
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AFXEngine = api;
})(this);
