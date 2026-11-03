/* Analog FX — estilos predefinidos. Valores de 0 a 1 (dir, stretch, hue, sat, light de -1 a 1).
 * Los módulos que no aparecen en un estilo toman los valores por defecto del motor,
 * pero se apagan explícitamente para que cada estilo sea predecible. */
(function (root) {
  'use strict';
  var OFF = { on: false };
  function P(id, name, p) {
    var base = {
      cracks: OFF, bleed: OFF, drips: OFF, splat: OFF, print: OFF,
      color: { on: true, hue: 0, sat: 0, light: 0, hueVar: 0.1, satVar: 0.15, lightVar: 0.3, edge: 0.25 }
    };
    for (var k in p) base[k] = p[k];
    return { id: id, name: name, p: base };
  }
  var PRESETS = [
    P('sello', 'Sello gastado', {
      texture: 'grises_8', texScale: 1, stretch: 0,
      warp: { on: true, amount: 0.15, rough: 0.45 },
      erode: { on: true, amount: 0.33, distrib: 0.6, contrast: 0.7 },
      cracks: { on: true, amount: 0.3 },
      splat: { on: true, amount: 0.15, spread: 0.3, size: 0.4, drops: 0.1 },
      ink: { on: true, pressure: 0.35, grain: 0.35 },
      color: { on: true, hue: 0, sat: 0, light: 0, hueVar: 0.1, satVar: 0.2, lightVar: 0.4, edge: 0.55 },
      out: { hard: 0.45, opacity: 1 }
    }),
    P('corrida', 'Tinta corrida', {
      texture: 'frias_9', texScale: 1, stretch: 0,
      warp: { on: true, amount: 0.3, rough: 0.35 },
      erode: { on: true, amount: 0.1, distrib: 0.5, contrast: 0.5 },
      bleed: { on: true, amount: 0.55, dir: -0.2, wet: 0.65, pool: 0.55, halo: 0.7, hue: 0.04, sat: 0.25, light: 0.1 },
      splat: { on: true, amount: 0.15, spread: 0.35, size: 0.5, drops: 0.15 },
      ink: { on: true, pressure: 0.2, grain: 0.25 },
      color: { on: true, hue: 0, sat: 0, light: 0, hueVar: 0.15, satVar: 0.25, lightVar: 0.35, edge: 0.3 },
      out: { hard: 0, opacity: 1 }
    }),
    P('acuarela', 'Acuarela', {
      texture: 'frias_11', texScale: 1.3, stretch: 0,
      warp: { on: true, amount: 0.35, rough: 0.3 },
      erode: { on: true, amount: 0.14, distrib: 0.6, contrast: 0.25 },
      bleed: { on: true, amount: 0.7, dir: 0, wet: 1, pool: 0.7, halo: 0.75, hue: 0.06, sat: 0.3, light: 0.2 },
      ink: { on: true, pressure: 0.6, grain: 0.2 },
      color: { on: true, hue: 0, sat: 0, light: 0.05, hueVar: 0.35, satVar: 0.4, lightVar: 0.55, edge: 0.15 },
      out: { hard: 0, opacity: 0.95 }
    }),
    P('tintachina', 'Tinta china', {
      texture: 'grises_8', texScale: 0.8, stretch: 0,
      warp: { on: true, amount: 0.2, rough: 0.55 },
      erode: { on: true, amount: 0.06, distrib: 0.5, contrast: 0.6 },
      bleed: { on: true, amount: 0.35, dir: 0, wet: 0.8, pool: 0.6, halo: 0.6, hue: 0, sat: 0.1, light: 0.15 },
      drips: { on: true, length: 0.3, amount: 0, up: 0, drops: 0.35 },
      splat: { on: true, amount: 0.08, spread: 0.5, size: 0.6, drops: 0.45 },
      ink: { on: true, pressure: 0.15, grain: 0.15 },
      color: { on: true, hue: 0, sat: 0, light: 0, hueVar: 0.05, satVar: 0.1, lightVar: 0.25, edge: 0.6 },
      out: { hard: 0, opacity: 1 }
    }),
    P('goteo', 'Goteo', {
      texture: 'grises_8', texScale: 1, stretch: 0.3,
      warp: { on: true, amount: 0.15, rough: 0.5 },
      erode: { on: true, amount: 0.12, distrib: 0.4, contrast: 0.6 },
      cracks: { on: true, amount: 0.2 },
      bleed: { on: true, amount: 0.25, dir: 0.8, wet: 0.3, pool: 0.5, halo: 0.5, hue: 0, sat: 0.15, light: 0.15 },
      drips: { on: true, length: 0.5, amount: 0.6, up: 0.4, drops: 0.3 },
      ink: { on: true, pressure: 0.2, grain: 0.3 },
      out: { hard: 0.1, opacity: 1 }
    }),
    P('serigrafia', 'Serigrafía', {
      texture: 'frias_4', texScale: 0.8, stretch: 0,
      warp: { on: true, amount: 0.06, rough: 0.3 },
      erode: { on: true, amount: 0.12, distrib: 0.7, contrast: 0.9 },
      splat: { on: true, amount: 0.1, spread: 0.2, size: 0.3, drops: 0 },
      ink: { on: true, pressure: 0.3, grain: 0.45 },
      print: { on: true, bands: 0.15, spacing: 0.7, width: 0.2, dir: 1, streaks: 0, halftone: 0, dot: 0.35, ghost: 0.25, ghostOff: 0.25, ghostHue: 0 },
      color: { on: true, hue: 0, sat: 0, light: 0, hueVar: 0.05, satVar: 0.15, lightVar: 0.25, edge: 0.45 },
      out: { hard: 0.8, opacity: 1 }
    }),
    P('risografia', 'Risografía', {
      texture: 'frias_12', texScale: 0.7, stretch: 0,
      warp: { on: true, amount: 0.05, rough: 0.3 },
      erode: { on: true, amount: 0.1, distrib: 0.6, contrast: 0.8 },
      ink: { on: true, pressure: 0.35, grain: 0.35 },
      print: { on: true, bands: 0.2, spacing: 0.25, width: 0.25, dir: -1, streaks: 0.15, halftone: 0.7, dot: 0.3, ghost: 0.6, ghostOff: 0.4, ghostHue: -0.32 },
      color: { on: true, hue: 0, sat: 0.2, light: 0, hueVar: 0.08, satVar: 0.2, lightVar: 0.3, edge: 0.2 },
      out: { hard: 0.3, opacity: 1 }
    }),
    P('xilografia', 'Xilografía', {
      texture: 'grises_8', texScale: 0.9, stretch: 0.85,
      warp: { on: true, amount: 0.1, rough: 0.6 },
      erode: { on: true, amount: 0.3, distrib: 0.3, contrast: 0.95 },
      cracks: { on: true, amount: 0.5 },
      ink: { on: true, pressure: 0.55, grain: 0.2 },
      color: { on: true, hue: 0, sat: 0, light: 0, hueVar: 0.05, satVar: 0.1, lightVar: 0.35, edge: 0.5 },
      out: { hard: 0.9, opacity: 1 }
    }),
    P('guache', 'Guache', {
      texture: 'frias_11', texScale: 1.2, stretch: 0,
      warp: { on: true, amount: 0.3, rough: 0.4 },
      erode: { on: true, amount: 0.1, distrib: 0.5, contrast: 0.3 },
      bleed: { on: true, amount: 0.2, dir: 0, wet: 0.25, pool: 0.4, halo: 0.6, hue: 0, sat: 0.1, light: 0.1 },
      ink: { on: true, pressure: 0.75, grain: 0.3 },
      color: { on: true, hue: 0, sat: 0, light: 0, hueVar: 0.3, satVar: 0.35, lightVar: 0.5, edge: 0.35 },
      out: { hard: 0, opacity: 1 }
    }),
    P('fotocopia', 'Fotocopia', {
      texture: 'frias_12', texScale: 0.7, stretch: 0,
      warp: { on: true, amount: 0.08, rough: 0.35 },
      erode: { on: true, amount: 0.1, distrib: 0.6, contrast: 0.8 },
      bleed: { on: true, amount: 0.12, dir: 0, wet: 0, pool: 0, halo: 0.5, hue: 0, sat: 0, light: 0 },
      splat: { on: true, amount: 0.3, spread: 0.6, size: 0.15, drops: 0.2 },
      ink: { on: true, pressure: 0.2, grain: 0.7 },
      print: { on: true, bands: 0.25, spacing: 0.3, width: 0.3, dir: -1, shift: 0.15, streaks: 0.35, halftone: 0, dot: 0.35, ghost: 0, ghostOff: 0.3, ghostHue: 0 },
      color: { on: true, hue: 0, sat: -0.3, light: 0, hueVar: 0, satVar: 0, lightVar: 0.25, edge: 0.3 },
      out: { hard: 0.85, opacity: 1 }
    }),
    P('impresora', 'Impresora mala', {
      texture: 'frias_10', texScale: 0.8, stretch: 0.4,
      warp: { on: true, amount: 0.04, rough: 0.25 },
      erode: { on: true, amount: 0.06, distrib: 0.7, contrast: 0.8 },
      ink: { on: true, pressure: 0.25, grain: 0.4 },
      print: { on: true, bands: 0.85, spacing: 0.22, width: 0.35, dir: -1, shift: 0.5, streaks: 0.5, halftone: 0, dot: 0.35, ghost: 0.15, ghostOff: 0.2, ghostHue: 0 },
      color: { on: true, hue: 0, sat: -0.15, light: 0, hueVar: 0, satVar: 0.1, lightVar: 0.3, edge: 0.15 },
      out: { hard: 0.5, opacity: 1 }
    }),
    P('rekt', 'Destrozado', {
      texture: 'frias_10', texScale: 1, stretch: 0,
      warp: { on: true, amount: 0.4, rough: 0.6 },
      erode: { on: true, amount: 0.32, distrib: 0.65, contrast: 0.6 },
      cracks: { on: true, amount: 0.55 },
      bleed: { on: true, amount: 0.3, dir: -0.4, wet: 0.35, pool: 0.5, halo: 0.5, hue: 0, sat: 0.15, light: 0.15 },
      drips: { on: true, length: 0.25, amount: 0.4, up: 0.2, drops: 0.15 },
      splat: { on: true, amount: 0.45, spread: 0.5, size: 0.5, drops: 0.3 },
      ink: { on: true, pressure: 0.4, grain: 0.4 },
      print: { on: true, bands: 0.2, spacing: 0.4, width: 0.3, dir: -1, streaks: 0.15, halftone: 0, dot: 0.35, ghost: 0, ghostOff: 0.3, ghostHue: 0 },
      color: { on: true, hue: 0, sat: 0, light: 0, hueVar: 0.1, satVar: 0.2, lightVar: 0.4, edge: 0.35 },
      out: { hard: 0.2, opacity: 1 }
    })
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = PRESETS;
  else root.AFXPresets = PRESETS;
})(this);
