/* Analog FX — estilos predefinidos. Los valores van de 0 a 1 (dir y stretch de -1 a 1). */
(function (root) {
  'use strict';
  var PRESETS = [
    {
      id: 'sello', name: 'Sello gastado',
      p: { texture: 'grises_8', texScale: 1, stretch: 0,
        warp: { on: true, amount: 0.15, rough: 0.45 },
        erode: { on: true, amount: 0.35, distrib: 0.6, contrast: 0.7 },
        cracks: { on: true, amount: 0.3 },
        bleed: { on: false, amount: 0.2, dir: 0 },
        drips: { on: false, length: 0.3, amount: 0.4, up: 0 },
        splat: { on: true, amount: 0.15, spread: 0.3, size: 0.4 },
        ink: { on: true, pressure: 0.35, grain: 0.35 },
        out: { hard: 0.45, opacity: 1 } }
    },
    {
      id: 'corrida', name: 'Tinta corrida',
      p: { texture: 'frias_9', texScale: 1, stretch: 0,
        warp: { on: true, amount: 0.3, rough: 0.35 },
        erode: { on: true, amount: 0.12, distrib: 0.5, contrast: 0.5 },
        cracks: { on: false, amount: 0.2 },
        bleed: { on: true, amount: 0.55, dir: -0.2 },
        drips: { on: false, length: 0.3, amount: 0.4, up: 0 },
        splat: { on: true, amount: 0.2, spread: 0.35, size: 0.5 },
        ink: { on: true, pressure: 0.2, grain: 0.25 },
        out: { hard: 0, opacity: 1 } }
    },
    {
      id: 'goteo', name: 'Goteo',
      p: { texture: 'grises_8', texScale: 1, stretch: 0.3,
        warp: { on: true, amount: 0.15, rough: 0.5 },
        erode: { on: true, amount: 0.12, distrib: 0.4, contrast: 0.6 },
        cracks: { on: true, amount: 0.2 },
        bleed: { on: true, amount: 0.25, dir: 0.8 },
        drips: { on: true, length: 0.5, amount: 0.6, up: 0.4 },
        splat: { on: false, amount: 0.2, spread: 0.3, size: 0.4 },
        ink: { on: true, pressure: 0.2, grain: 0.3 },
        out: { hard: 0.1, opacity: 1 } }
    },
    {
      id: 'serigrafia', name: 'Serigrafía',
      p: { texture: 'frias_4', texScale: 0.8, stretch: 0,
        warp: { on: true, amount: 0.06, rough: 0.3 },
        erode: { on: true, amount: 0.12, distrib: 0.7, contrast: 0.9 },
        cracks: { on: false, amount: 0.2 },
        bleed: { on: false, amount: 0.2, dir: 0 },
        drips: { on: false, length: 0.3, amount: 0.4, up: 0 },
        splat: { on: true, amount: 0.1, spread: 0.2, size: 0.3 },
        ink: { on: true, pressure: 0.3, grain: 0.45 },
        out: { hard: 0.8, opacity: 1 } }
    },
    {
      id: 'xilografia', name: 'Xilografía',
      p: { texture: 'grises_8', texScale: 0.9, stretch: 0.85,
        warp: { on: true, amount: 0.1, rough: 0.6 },
        erode: { on: true, amount: 0.3, distrib: 0.3, contrast: 0.95 },
        cracks: { on: true, amount: 0.5 },
        bleed: { on: false, amount: 0.2, dir: 0 },
        drips: { on: false, length: 0.3, amount: 0.4, up: 0 },
        splat: { on: false, amount: 0.1, spread: 0.2, size: 0.3 },
        ink: { on: true, pressure: 0.55, grain: 0.2 },
        out: { hard: 0.9, opacity: 1 } }
    },
    {
      id: 'guache', name: 'Guache',
      p: { texture: 'frias_11', texScale: 1.2, stretch: 0,
        warp: { on: true, amount: 0.3, rough: 0.4 },
        erode: { on: true, amount: 0.1, distrib: 0.5, contrast: 0.3 },
        cracks: { on: false, amount: 0.2 },
        bleed: { on: true, amount: 0.2, dir: 0 },
        drips: { on: false, length: 0.3, amount: 0.4, up: 0 },
        splat: { on: false, amount: 0.1, spread: 0.2, size: 0.3 },
        ink: { on: true, pressure: 0.75, grain: 0.3 },
        out: { hard: 0, opacity: 1 } }
    },
    {
      id: 'fotocopia', name: 'Fotocopia',
      p: { texture: 'frias_12', texScale: 0.7, stretch: 0,
        warp: { on: true, amount: 0.08, rough: 0.35 },
        erode: { on: true, amount: 0.1, distrib: 0.6, contrast: 0.8 },
        cracks: { on: false, amount: 0.2 },
        bleed: { on: true, amount: 0.12, dir: 0 },
        drips: { on: false, length: 0.3, amount: 0.4, up: 0 },
        splat: { on: true, amount: 0.3, spread: 0.6, size: 0.15 },
        ink: { on: true, pressure: 0.2, grain: 0.7 },
        out: { hard: 0.85, opacity: 1 } }
    },
    {
      id: 'rekt', name: 'Destrozado',
      p: { texture: 'frias_10', texScale: 1, stretch: 0,
        warp: { on: true, amount: 0.4, rough: 0.6 },
        erode: { on: true, amount: 0.32, distrib: 0.65, contrast: 0.6 },
        cracks: { on: true, amount: 0.55 },
        bleed: { on: true, amount: 0.3, dir: -0.4 },
        drips: { on: true, length: 0.25, amount: 0.4, up: 0.2 },
        splat: { on: true, amount: 0.45, spread: 0.5, size: 0.5 },
        ink: { on: true, pressure: 0.4, grain: 0.4 },
        out: { hard: 0.2, opacity: 1 } }
    }
  ];
  if (typeof module !== 'undefined' && module.exports) module.exports = PRESETS;
  else root.AFXPresets = PRESETS;
})(this);
