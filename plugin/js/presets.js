/*
 * Analog FX — técnicas (presets) v0.4.
 * Cada técnica: grupo, descripción, paletas de color y variantes. Cada variante solo
 * indica los módulos que cambia; el resto se apaga (BASE) para que cada técnica sea
 * distinta y predecible. Valores 0..1 (dir, angle, hue… de -1 a 1).
 */
(function (root) {
  'use strict';
  var GROUPS = [
    { id: 'desgaste', name: 'Desgaste' },
    { id: 'impresion', name: 'Impresión' },
    { id: 'copia', name: 'Copistería' },
    { id: 'agua', name: 'Agua' }
  ];
  var OFF = { on: false };
  // base común: módulos opcionales apagados, papel y color sutiles encendidos
  var BASE = {
    erode: OFF, cracks: OFF, bleed: OFF, drips: OFF, splat: OFF, print: OFF, tintas: OFF,
    warp: { on: true, amount: 0.04, rough: 0.2 },
    press: OFF, wood: OFF, mesh: OFF, stone: OFF, wash: OFF,
    seep: OFF, engrave: OFF, stamp: OFF, letters: OFF, damp: OFF, aqua: OFF, gouge: OFF, rim: OFF, stencil: OFF, copy: OFF, drip: OFF,
    paper: { on: true, feather: 0.2, relief: 0.3, tooth: 0.1, paperScale: 0.5 },
    color: { on: true, hue: 0, sat: 0, light: 0, hueVar: 0.05, satVar: 0.1, lightVar: 0.25, edge: 0.25 },
    ink: { on: true, pressure: 0.2, grain: 0.2, fade: 0, roller: 0 },
    out: { hard: 0.2, opacity: 1 }
  };
  // paletas: ink = tinta 1 ('original' = color de la capa), c2/c3 = tintas 2 y 3
  var PAL_LAYER = [{ name: 'Color del texto', ink: 'original' }, { name: 'Negro', ink: '#151515' }, { name: 'Rojo', ink: '#b3261e' }];

  var TECHS = [
    // ------------------------------------------------------------------ DESGASTE (de la 0.2)
    { id: 'sello', group: 'desgaste', name: 'Sello gastado', desc: 'Sello de goma estampado a mano: apoya más de un lado, borde cargado con halo fino, centro pobre con poros del papel y cada letra algo distinta.',
      palettes: PAL_LAYER, variants: [
        { id: 'fresco', name: 'Recién entintado', p: { texture: 'desgaste_1', stamp: { on: true, tilt: 0.3, uneven: 0.4, edge: 0.6, letterVar: 0.25 }, press: { on: true, squeeze: 0.4, halo: 0.35, starve: 0.1 }, warp: { on: true, amount: 0.04, rough: 0.3 }, erode: { on: true, amount: 0.05, fam: 'granul', contrast: 0.8 }, ink: { on: true, pressure: 0.1, grain: 0.15 }, paper: { on: true, feather: 0.12, relief: 0.2, tooth: 0.1 }, color: { on: true, lightVar: 0.15, edge: 0.1 }, out: { hard: 0.25 } } },
        { id: 'gastado', name: 'Gastado', p: { texture: 'desgaste_1', stamp: { on: true, tilt: 0.55, uneven: 0.6, edge: 0.6, letterVar: 0.4 }, press: { on: true, squeeze: 0.45, halo: 0.3, starve: 0.25 }, warp: { on: true, amount: 0.05, rough: 0.35 }, erode: { on: true, amount: 0.15, fam: 'granul', distrib: 0.6, contrast: 0.85 }, cracks: { on: true, amount: 0.15, fam: 'floracion' }, ink: { on: true, pressure: 0.15, grain: 0.2 }, paper: { on: true, feather: 0.1, relief: 0.2, tooth: 0.2 }, color: { on: true, lightVar: 0.2, edge: 0.1 }, out: { hard: 0.3 } } },
        { id: 'seco', name: 'Casi seco', p: { texture: 'desgaste_1', stamp: { on: true, tilt: 0.75, uneven: 0.7, edge: 0.45, letterVar: 0.5 }, press: { on: true, squeeze: 0.35, halo: 0.2, starve: 0.45 }, warp: { on: true, amount: 0.05, rough: 0.4 }, erode: { on: true, amount: 0.28, fam: 'granul', distrib: 0.65, contrast: 0.85 }, ink: { on: true, pressure: 0.25, grain: 0.25 }, paper: { on: true, feather: 0.08, relief: 0.2, tooth: 0.4 }, color: { on: true, lightVar: 0.25, edge: 0.1 }, out: { hard: 0.3 } } }
      ] },
    { id: 'corrida', group: 'desgaste', name: 'Tinta corrida', desc: 'La tinta se escapa por las fibras del papel, poco y de forma desigual, pegada a cada letra y en su color; donde llega más lejos deja una línea más cargada.',
      palettes: PAL_LAYER, variants: [
        { id: 'leve', name: 'Leve', p: { texture: 'desgaste_1', seep: { on: true, amount: 0.5, reach: 0.35, density: 0.7, front: 0.45 }, warp: { on: true, amount: 0.03, rough: 0.25 }, ink: { on: true, pressure: 0.12, grain: 0.15 }, paper: { on: true, feather: 0.35, relief: 0.2, tooth: 0.05 }, color: { on: true, lightVar: 0.2, edge: 0.15 }, out: { hard: 0 } } },
        { id: 'normal', name: 'Corrida', p: { texture: 'desgaste_1', seep: { on: true, amount: 0.7, reach: 0.6, density: 0.75, front: 0.55 }, warp: { on: true, amount: 0.04, rough: 0.3 }, ink: { on: true, pressure: 0.15, grain: 0.18 }, paper: { on: true, feather: 0.45, relief: 0.2, tooth: 0.05 }, color: { on: true, lightVar: 0.22, edge: 0.15 }, out: { hard: 0 } } },
        { id: 'empapada', name: 'Empapada', p: { texture: 'desgaste_1', seep: { on: true, amount: 0.85, reach: 0.95, density: 0.75, front: 0.7 }, warp: { on: true, amount: 0.05, rough: 0.3 }, ink: { on: true, pressure: 0.2, grain: 0.2 }, paper: { on: true, feather: 0.5, relief: 0.2, tooth: 0.05 }, color: { on: true, lightVar: 0.25, edge: 0.2 }, out: { hard: 0 } } }
      ] },
    { id: 'rekt', group: 'desgaste', name: 'Destrozado', desc: 'Tinta rota: desconchones con borde nítido, grietas y huecos por zonas, algo de corrido y goteo, salpicaduras junto a cada letra en su color. Siempre se lee.',
      palettes: PAL_LAYER, variants: [
        { id: 'gastado', name: 'Gastado', p: { texture: 'desgaste_1', erode: { on: true, amount: 0.22, distrib: 0.7, contrast: 0.85, fam: 'granul', perLetter: 0.5, protect: 0.7 }, cracks: { on: true, amount: 0.3, fam: 'floracion' }, warp: { on: true, amount: 0.08, rough: 0.45 }, seep: { on: true, amount: 0.25, reach: 0.25, density: 0.6, front: 0.4 }, splat: { on: true, amount: 0.05, spread: 0.3, size: 0.4, drops: 0.15 }, ink: { on: true, pressure: 0.25, grain: 0.25 }, paper: { on: true, feather: 0.2, relief: 0.2, tooth: 0.1 }, color: { on: true, lightVar: 0.3, edge: 0.3 }, out: { hard: 0.35 } } },
        { id: 'normal', name: 'Muy gastado', p: { texture: 'desgaste_1', erode: { on: true, amount: 0.35, distrib: 0.75, contrast: 0.85, fam: 'granul', perLetter: 0.6, protect: 0.75 }, cracks: { on: true, amount: 0.45, fam: 'floracion' }, warp: { on: true, amount: 0.1, rough: 0.5 }, seep: { on: true, amount: 0.35, reach: 0.3, density: 0.6, front: 0.45 }, drip: { on: true, amount: 0.15, length: 0.3, thick: 0.45, sag: 0.4, beads: 0.2, dark: 0.5 }, splat: { on: true, amount: 0.08, spread: 0.35, size: 0.45, drops: 0.25 }, ink: { on: true, pressure: 0.3, grain: 0.3 }, paper: { on: true, feather: 0.2, relief: 0.2, tooth: 0.15 }, color: { on: true, lightVar: 0.35, edge: 0.3 }, out: { hard: 0.35 } } },
        { id: 'destrozado', name: 'Destrozado', p: { texture: 'desgaste_1', erode: { on: true, amount: 0.48, distrib: 0.8, contrast: 0.85, fam: 'granul', perLetter: 0.6, protect: 0.8 }, cracks: { on: true, amount: 0.6, fam: 'floracion' }, warp: { on: true, amount: 0.14, rough: 0.55 }, seep: { on: true, amount: 0.45, reach: 0.4, density: 0.6, front: 0.5 }, damp: { on: true, amount: 0.25, size: 0.4, spread: 0.4, cloud: 0.7, lift: 0.3, tide: 0.3 }, drip: { on: true, amount: 0.25, length: 0.4, thick: 0.5, sag: 0.5, beads: 0.3, dark: 0.55 }, splat: { on: true, amount: 0.12, spread: 0.4, size: 0.5, drops: 0.35 }, ink: { on: true, pressure: 0.35, grain: 0.3 }, paper: { on: true, feather: 0.22, relief: 0.2, tooth: 0.15 }, color: { on: true, lightVar: 0.35, edge: 0.3 }, out: { hard: 0.35 } } }
      ] },

    // ------------------------------------------------------------------ IMPRESIÓN
    { id: 'offset', group: 'impresion', name: 'Offset · Tritono', desc: 'Trama de imprenta a lineatura real (puntos por pulgada iguales en toda la página): cada tinta con su curva y su ángulo (45°, 75°, 15°), roseta, puntos irregulares y ganancia de punto.',
      palettes: [{ name: 'Color del texto', ink: 'original', c2: 'auto', c3: 'auto' }, { name: 'Clásico', ink: '#1a1a1a', c2: '#7d7468', c3: '#c9b48a' }, { name: 'Frío', ink: '#141821', c2: '#4b6178', c3: '#9cc3d5' }, { name: 'Pop', ink: '#151515', c2: '#e23c3c', c3: '#f5c400' }],
      inks: 3, variants: [
        { id: 'tritono', name: 'Tritono', p: { texture: 'desgaste_1', tintas: { on: true, count: 3, screen: 1, lpi: 45, cell: 0.3, gain: 0.25, misreg: 0.08, tone: 0.78, toneVar: 0.45, c2: 'auto', c3: 'auto' }, warp: { on: true, amount: 0.02, rough: 0.12 }, ink: { on: true, pressure: 0.1, grain: 0.05 }, paper: { on: true, feather: 0.05, relief: 0.12, tooth: 0.03 }, color: { on: true, lightVar: 0.05, edge: 0 }, out: { hard: 0 } } },
        { id: 'duotono', name: 'Duotono', p: { texture: 'desgaste_1', tintas: { on: true, count: 2, screen: 1, lpi: 45, cell: 0.35, gain: 0.25, misreg: 0.1, tone: 0.76, toneVar: 0.45, c2: 'auto', c3: 'auto' }, warp: { on: true, amount: 0.02, rough: 0.12 }, ink: { on: true, pressure: 0.1, grain: 0.05 }, paper: { on: true, feather: 0.05, relief: 0.12, tooth: 0.03 }, color: { on: true, lightVar: 0.05, edge: 0 }, out: { hard: 0 } } },
        { id: 'gruesa', name: 'Trama de periódico', p: { texture: 'desgaste_1', tintas: { on: true, count: 3, screen: 1, lpi: 22, cell: 0.7, gain: 0.4, misreg: 0.25, tone: 0.72, toneVar: 0.55, c2: 'auto', c3: 'auto' }, warp: { on: true, amount: 0.03, rough: 0.15 }, ink: { on: true, pressure: 0.15, grain: 0.08 }, paper: { on: true, feather: 0.1, relief: 0.2, tooth: 0.08 }, color: { on: true, lightVar: 0.05, edge: 0 }, out: { hard: 0 } } }
      ] },
    { id: 'serigrafia', group: 'impresion', name: 'Serigrafía', desc: 'Tinta gruesa y opaca a través de malla: dentado, malla visible, rasqueta irregular, huecos y desregistro.',
      palettes: [{ name: 'Color del texto', ink: 'original', c2: '#e23c3c'  }, { name: 'Negro', ink: '#151515', c2: '#e23c3c' }, { name: 'Rojo + azul', ink: '#e23c3c', c2: '#1f3a93' }, { name: 'Amarillo + negro', ink: '#f5c400', c2: '#151515' }],
      inks: 2, variants: [
        { id: 'limpia', name: 'Limpia', p: { texture: 'desgaste_6', mesh: { on: true, sawtooth: 0.45, mesh: 0.35, voids: 0.15 }, warp: { on: true, amount: 0.04, rough: 0.25 }, erode: { on: true, amount: 0.06, contrast: 0.9 }, ink: { on: true, pressure: 0.1, grain: 0.08, roller: 0.3 }, paper: { on: true, feather: 0.05, relief: 0.12, tooth: 0 }, color: { on: true, lightVar: 0.15, edge: 0.4 }, out: { hard: 0.5 } } },
        { id: 'dos', name: 'Dos tintas', p: { texture: 'desgaste_6', tintas: { on: true, count: 2, screen: 0, misreg: 0.45, misAng: 0.3, d2: 1 }, mesh: { on: true, sawtooth: 0.45, mesh: 0.35, voids: 0.15 }, warp: { on: true, amount: 0.04, rough: 0.25 }, erode: { on: true, amount: 0.06, contrast: 0.9 }, ink: { on: true, pressure: 0.1, grain: 0.08, roller: 0.3 }, paper: { on: true, feather: 0.05, relief: 0.12, tooth: 0 }, out: { hard: 0.5 } } },
        { id: 'gastada', name: 'Pantalla gastada', p: { texture: 'desgaste_3', mesh: { on: true, sawtooth: 0.7, mesh: 0.5, voids: 0.5 }, warp: { on: true, amount: 0.05, rough: 0.35 }, erode: { on: true, amount: 0.18, contrast: 0.85 }, ink: { on: true, pressure: 0.2, grain: 0.1, roller: 0.6 }, paper: { on: true, feather: 0.08, relief: 0.15, tooth: 0.05 }, out: { hard: 0.5 } } }
      ] },
    { id: 'riso', group: 'impresion', name: 'Risografía', desc: 'Tinta de soja transparente y fluorescente: grano, cobertura irregular, bandas del tambor y desregistro de 1-3 mm.',
      palettes: [{ name: 'Color del texto', ink: 'original', c2: '#0078bf'  }, { name: 'Rosa + azul', ink: '#ff48b0', c2: '#0078bf' }, { name: 'Rojo + amarillo', ink: '#f15060', c2: '#ffe800' }, { name: 'Verde + morado', ink: '#00a95c', c2: '#765ba7' }],
      inks: 2, variants: [
        { id: 'dos', name: 'Dos tintas', p: { texture: 'desgaste_2', tintas: { on: true, count: 2, screen: 0, misreg: 0.5, misAng: -0.4, d2: 0.85 }, warp: { on: true, amount: 0.04, rough: 0.2 }, erode: { on: true, amount: 0.06 }, ink: { on: true, pressure: 0.35, grain: 0.45 }, paper: { on: true, feather: 0.1, relief: 0.2, tooth: 0.35 }, print: { on: true, bands: 0.12, spacing: 0.6, width: 0.5, dir: -1 }, color: { on: true, lightVar: 0.2, edge: 0.15 }, out: { hard: 0.25, opacity: 0.94 } } },
        { id: 'una', name: 'Una tinta', p: { texture: 'desgaste_2', warp: { on: true, amount: 0.04, rough: 0.2 }, erode: { on: true, amount: 0.06 }, ink: { on: true, pressure: 0.35, grain: 0.45 }, paper: { on: true, feather: 0.1, relief: 0.2, tooth: 0.35 }, print: { on: true, bands: 0.12, spacing: 0.6, width: 0.5, dir: -1 }, color: { on: true, lightVar: 0.2, edge: 0.15 }, out: { hard: 0.25, opacity: 0.94 } } },
        { id: 'gastada', name: 'Gastada', p: { texture: 'desgaste_4', tintas: { on: true, count: 2, screen: 0, misreg: 0.8, misAng: -0.4, d2: 0.8 }, warp: { on: true, amount: 0.06, rough: 0.3 }, erode: { on: true, amount: 0.14 }, ink: { on: true, pressure: 0.55, grain: 0.55 }, paper: { on: true, feather: 0.12, relief: 0.25, tooth: 0.55 }, print: { on: true, bands: 0.35, spacing: 0.5, width: 0.5, dir: -1 }, out: { hard: 0.25, opacity: 0.94 } } }
      ] },
    { id: 'tipografia', group: 'impresion', name: 'Tipografía', desc: 'Letterpress: el tipo presiona el papel. Más tinta en el borde, halo fino aplastado y macizos con huecos en los valles del papel.',
      palettes: [{ name: 'Color del texto', ink: 'original' }, { name: 'Negro', ink: '#151515' }, { name: 'Rojo', ink: '#c8352b' }], variants: [
        { id: 'fina', name: 'Fina', p: { texture: 'desgaste_6', press: { on: true, squeeze: 0.35, halo: 0.2, starve: 0.2 }, warp: { on: true, amount: 0.03, rough: 0.12 }, erode: { on: true, amount: 0.05 }, ink: { on: true, pressure: 0.15, grain: 0.2 }, paper: { on: true, feather: 0.12, relief: 0.45, tooth: 0.15 }, out: { hard: 0.15 } } },
        { id: 'entintada', name: 'Muy entintada', p: { texture: 'desgaste_6', press: { on: true, squeeze: 0.85, halo: 0.65, starve: 0.1 }, warp: { on: true, amount: 0.03, rough: 0.12 }, erode: { on: true, amount: 0.03 }, ink: { on: true, pressure: 0.1, grain: 0.15 }, paper: { on: true, feather: 0.3, relief: 0.4, tooth: 0.08 }, out: { hard: 0.1 } } },
        { id: 'pobre', name: 'Poca tinta', p: { texture: 'desgaste_1', press: { on: true, squeeze: 0.45, halo: 0.2, starve: 0.75 }, warp: { on: true, amount: 0.04, rough: 0.2 }, erode: { on: true, amount: 0.15 }, ink: { on: true, pressure: 0.3, grain: 0.3 }, paper: { on: true, feather: 0.1, relief: 0.5, tooth: 0.6 }, out: { hard: 0.15 } } }
      ] },
    { id: 'flexo', group: 'impresion', name: 'Flexografía', desc: 'Plancha de goma (bolsas, cajas, etiquetas): macizos sólidos con moteado y poros, halo marcado en el borde y trama de donuts solo en los tonos.',
      palettes: [{ name: 'Color del texto', ink: 'original', c2: '#e23c3c' }, { name: 'Negro', ink: '#151515', c2: '#e23c3c' }, { name: 'Azul + rojo', ink: '#1f3a93', c2: '#e23c3c' }],
      inks: 2, variants: [
        { id: 'etiqueta', name: 'Macizo', p: { texture: 'desgaste_1', press: { on: true, squeeze: 0.6, halo: 0.6, starve: 0.12 }, mesh: { on: true, sawtooth: 0, mesh: 0, voids: 0.35 }, warp: { on: true, amount: 0.02, rough: 0.1 }, ink: { on: true, pressure: 0.25, grain: 0.12 }, paper: { on: true, feather: 0.08, relief: 0.15, tooth: 0.05 }, color: { on: true, lightVar: 0.12, edge: 0 }, out: { hard: 0.1 } } },
        { id: 'kraft', name: 'Bolsa de kraft', p: { texture: 'desgaste_1', press: { on: true, squeeze: 0.75, halo: 0.75, starve: 0.3 }, mesh: { on: true, sawtooth: 0, mesh: 0, voids: 0.55 }, warp: { on: true, amount: 0.04, rough: 0.2 }, erode: { on: true, amount: 0.06, fam: 'granul', contrast: 0.8 }, ink: { on: true, pressure: 0.4, grain: 0.2 }, paper: { on: true, feather: 0.15, relief: 0.3, tooth: 0.25 }, color: { on: true, lightVar: 0.15, edge: 0 }, out: { hard: 0.1 } } },
        { id: 'trama', name: 'Con trama', p: { texture: 'desgaste_1', press: { on: true, squeeze: 0.55, halo: 0.55, starve: 0.1 }, tintas: { on: true, count: 1, screen: 1, lpi: 34, gain: 0.45, donut: 0.6, tone: 0.6, toneVar: 0.85 }, warp: { on: true, amount: 0.02, rough: 0.1 }, ink: { on: true, pressure: 0.15, grain: 0.1 }, paper: { on: true, feather: 0.08, relief: 0.15, tooth: 0.05 }, color: { on: true, lightVar: 0.05, edge: 0 }, out: { hard: 0.1 } } }
      ] },
    { id: 'litografia', group: 'impresion', name: 'Litografía', desc: 'Lápiz o tusche sobre piedra: punteado granuloso, borde graso y velo de plancha.',
      palettes: [{ name: 'Color del texto', ink: 'original' }, { name: 'Negro', ink: '#1d1b19' }, { name: 'Sepia', ink: '#5a3b28' }], variants: [
        { id: 'lapiz', name: 'Lápiz litográfico', p: { texture: 'desgaste_1', stone: { on: true, amount: 0.8, size: 0.35, tone: 0.72, greasy: 0.5, veil: 0.1 }, warp: { on: true, amount: 0.05, rough: 0.2 }, erode: { on: true, amount: 0.05 }, ink: { on: true, pressure: 0.15, grain: 0 }, paper: { on: true, feather: 0.1, relief: 0.2, tooth: 0 }, out: { hard: 0 } } },
        { id: 'tusche', name: 'Tusche', p: { texture: 'desgaste_5', stone: { on: true, amount: 0.35, size: 0.45, tone: 0.9, greasy: 0.3, veil: 0.1 }, wash: { on: true, wash: 0.35, granul: 0.4, blooms: 0.2, transp: 0 }, warp: { on: true, amount: 0.08, rough: 0.25 }, ink: { on: true, pressure: 0.2, grain: 0 }, paper: { on: true, feather: 0.12, relief: 0.2, tooth: 0 }, out: { hard: 0 } } },
        { id: 'gastada', name: 'Piedra gastada', p: { texture: 'desgaste_3', stone: { on: true, amount: 0.85, size: 0.6, tone: 0.68, greasy: 0.6, veil: 0.35 }, warp: { on: true, amount: 0.06, rough: 0.25 }, erode: { on: true, amount: 0.2 }, ink: { on: true, pressure: 0.2, grain: 0 }, paper: { on: true, feather: 0.12, relief: 0.25, tooth: 0 }, out: { hard: 0 } } }
      ] },
    { id: 'xilografia', group: 'impresion', name: 'Xilografía', desc: 'Cartel grabado: líneas de talla que entran desde el lado de la luz, anchas en el borde y afiladas en punta, sombra negra desplazada y, con dos tintas, el color plano desregistrado.',
      palettes: [{ name: 'Color del texto', ink: 'original' }, { name: 'Lavanda', ink: '#7f78b8' }, { name: 'Naranja', ink: '#f29b38' }], variants: [
        { id: 'dos', name: 'Dos tintas', p: { texture: 'desgaste_1', engrave: { on: true, two: true, spacing: 0.38, width: 0.85, length: 0.75, skip: 0.1, wobble: 0.6, light: 1, shadow: 0.7, misreg: 0.5, key: '#161414' }, warp: { on: true, amount: 0.02, rough: 0.2 }, ink: { on: true, pressure: 0.12, grain: 0.15 }, paper: { on: true, feather: 0.05, relief: 0.2, tooth: 0.12 }, color: { on: true, lightVar: 0.12, edge: 0 }, out: { hard: 0.1 } } },
        { id: 'una', name: 'Una tinta', p: { texture: 'desgaste_1', engrave: { on: true, two: false, spacing: 0.3, width: 0.75, length: 0.8, skip: 0.1, wobble: 0.6, light: 1, shadow: 0, misreg: 0 }, warp: { on: true, amount: 0.02, rough: 0.2 }, ink: { on: true, pressure: 0.12, grain: 0.12 }, paper: { on: true, feather: 0.04, relief: 0.2, tooth: 0.12 }, color: { on: true, lightVar: 0.1, edge: 0 }, out: { hard: 0.15 } } },
        { id: 'tallada', name: 'Muy tallada', p: { texture: 'desgaste_1', engrave: { on: true, two: true, spacing: 0.22, width: 0.8, length: 1, skip: 0.05, wobble: 0.75, light: 1, shadow: 0.8, misreg: 0.6, key: '#161414' }, warp: { on: true, amount: 0.03, rough: 0.25 }, ink: { on: true, pressure: 0.18, grain: 0.18 }, paper: { on: true, feather: 0.05, relief: 0.2, tooth: 0.18 }, color: { on: true, lightVar: 0.15, edge: 0 }, out: { hard: 0.1 } } }
      ] },
    { id: 'lino', group: 'impresion', name: 'Linograbado', desc: 'Linóleo: tinta plana y densa, borde limpio de cuchilla, huella suave del rodillo y algo de pigmento acumulado en algunos bordes.',
      palettes: PAL_LAYER, variants: [
        { id: 'limpio', name: 'Limpio', p: { texture: 'desgaste_6', rim: { on: true, amount: 0.3, width: 0.25, coverage: 0.4 }, warp: { on: true, amount: 0.015, rough: 0.12 }, ink: { on: true, pressure: 0.12, grain: 0.06, roller: 0.3 }, paper: { on: true, feather: 0.04, relief: 0.35, tooth: 0.12, paperScale: 0.4 }, color: { on: true, hueVar: 0.03, satVar: 0.05, lightVar: 0.12, edge: 0 }, out: { hard: 0.35 } } },
        { id: 'rodillo', name: 'Rodillo cargado', p: { texture: 'desgaste_6', rim: { on: true, amount: 0.45, width: 0.35, coverage: 0.55 }, warp: { on: true, amount: 0.02, rough: 0.15 }, ink: { on: true, pressure: 0.2, grain: 0.08, roller: 0.55 }, paper: { on: true, feather: 0.05, relief: 0.4, tooth: 0.18, paperScale: 0.4 }, color: { on: true, hueVar: 0.03, satVar: 0.06, lightVar: 0.18, edge: 0 }, out: { hard: 0.3 } } },
        { id: 'pobre', name: 'Poca tinta', p: { texture: 'desgaste_6', rim: { on: true, amount: 0.35, width: 0.3, coverage: 0.45 }, warp: { on: true, amount: 0.02, rough: 0.15 }, ink: { on: true, pressure: 0.35, grain: 0.1, roller: 0.45 }, paper: { on: true, feather: 0.04, relief: 0.45, tooth: 0.45, paperScale: 0.45 }, color: { on: true, hueVar: 0.03, satVar: 0.06, lightVar: 0.2, edge: 0 }, out: { hard: 0.3 } } }
      ] },
    { id: 'mimeo', group: 'impresion', name: 'Mimeógrafo', desc: 'Tinta grasa casi plana a través del esténcil: borde que se humedece y carga algo más de pigmento, y ligerísimas diferencias de tinta entre letras.',
      palettes: PAL_LAYER, variants: [
        { id: 'nuevo', name: 'Esténcil nuevo', p: { texture: 'desgaste_1', stencil: { on: true, fiber: 0.15, density: 0.15, spread: 0.3, setoff: 0.1 }, seep: { on: true, amount: 0.35, reach: 0.12, density: 0.6, front: 0.3 }, rim: { on: true, amount: 0.3, width: 0.25, coverage: 0.5 }, letters: { on: true, density: 0.35, tone: 0.35 }, ink: { on: true, pressure: 0.08, grain: 0.06, fade: 0.05 }, warp: { on: true, amount: 0.02, rough: 0.15 }, paper: { on: true, feather: 0.3, relief: 0.18, tooth: 0.04 }, color: { on: true, lightVar: 0.1, edge: 0.1 }, out: { hard: 0 } } },
        { id: 'gastado', name: 'Esténcil gastado', p: { texture: 'desgaste_1', stencil: { on: true, fiber: 0.35, density: 0.3, spread: 0.4, setoff: 0.1 }, seep: { on: true, amount: 0.45, reach: 0.18, density: 0.6, front: 0.35 }, rim: { on: true, amount: 0.4, width: 0.3, coverage: 0.55 }, letters: { on: true, density: 0.55, tone: 0.45 }, ink: { on: true, pressure: 0.15, grain: 0.1, fade: 0.25 }, warp: { on: true, amount: 0.03, rough: 0.2 }, paper: { on: true, feather: 0.35, relief: 0.18, tooth: 0.06 }, color: { on: true, lightVar: 0.15, edge: 0.1 }, out: { hard: 0 } } }
      ] },

    // ------------------------------------------------------------------ COPISTERÍA
    { id: 'fotocopia', group: 'copia', name: 'Fotocopia', desc: 'Fotocopiadora: negros quemados con huecos de tóner, trazos que engordan y se rompen, motas junto al negro y rayas finas del tambor.',
      palettes: [{ name: 'Color del texto', ink: 'original' }, { name: 'Tóner', ink: '#121212' }, { name: 'Gris', ink: '#3b3b3b' }], variants: [
        { id: 'buena', name: 'Copia limpia', p: { texture: 'desgaste_6', copy: { on: true, gen: 0.25, dropout: 0.25, toner: 0.3, streaks: 0.15, haze: 0.1 }, warp: { on: true, amount: 0.02, rough: 0.15 }, ink: { on: true, pressure: 0.05, grain: 0.05 }, paper: { on: true, feather: 0, relief: 0.06, tooth: 0 }, color: { on: true, lightVar: 0.05, edge: 0 }, out: { hard: 0.8 } } },
        { id: 'barata', name: 'Copia barata', p: { texture: 'desgaste_6', copy: { on: true, gen: 0.5, dropout: 0.5, toner: 0.55, streaks: 0.4, haze: 0.25 }, warp: { on: true, amount: 0.03, rough: 0.2 }, ink: { on: true, pressure: 0.1, grain: 0.08 }, paper: { on: true, feather: 0, relief: 0.06, tooth: 0 }, color: { on: true, lightVar: 0.05, edge: 0 }, out: { hard: 0.85 } } },
        { id: 'copiacopia', name: 'Copia de copia', p: { texture: 'desgaste_6', copy: { on: true, gen: 0.9, dropout: 0.7, toner: 0.8, streaks: 0.55, haze: 0.4 }, warp: { on: true, amount: 0.04, rough: 0.3 }, ink: { on: true, pressure: 0.12, grain: 0.1 }, paper: { on: true, feather: 0, relief: 0.05, tooth: 0 }, color: { on: true, lightVar: 0.05, edge: 0 }, out: { hard: 0.9 } } }
      ] },
    { id: 'laser', group: 'copia', name: 'Láser roto', desc: 'Impresora láser: rayas verticales del tambor, copia fantasma desplazada (ghosting) y tóner disperso.',
      palettes: [{ name: 'Color del texto', ink: 'original' }, { name: 'Tóner', ink: '#121212' }, { name: 'Gris', ink: '#3b3b3b' }], variants: [
        { id: 'tambor', name: 'Tambor rayado', p: { texture: 'desgaste_6', copy: { on: true, gen: 0.15, dropout: 0.2, toner: 0.35, streaks: 0.9, haze: 0.12 }, print: { on: true, bands: 0, streaks: 0, ghost: 0.08, ghostOff: 0.3 }, warp: { on: true, amount: 0.02, rough: 0.12 }, ink: { on: true, pressure: 0.05, grain: 0.05 }, paper: { on: true, feather: 0, relief: 0.05, tooth: 0 }, color: { on: true, lightVar: 0.05, edge: 0 }, out: { hard: 0.8 } } },
        { id: 'ghost', name: 'Ghosting', p: { texture: 'desgaste_6', copy: { on: true, gen: 0.15, dropout: 0.2, toner: 0.3, streaks: 0.3, haze: 0.1 }, print: { on: true, bands: 0, streaks: 0, ghost: 0.4, ghostOff: 0.5 }, warp: { on: true, amount: 0.02, rough: 0.12 }, ink: { on: true, pressure: 0.05, grain: 0.05 }, paper: { on: true, feather: 0, relief: 0.05, tooth: 0 }, color: { on: true, lightVar: 0.05, edge: 0 }, out: { hard: 0.8 } } }
      ] },
    { id: 'inkjet', group: 'copia', name: 'Inyección mala', desc: 'Impresora de tinta: líneas blancas regulares de boquillas obstruidas, tinta que se abre en las fibras y poca tinta.',
      palettes: [{ name: 'Color del texto', ink: 'original' }, { name: 'Negro', ink: '#1a1a1e' }, { name: 'Cian sin tinta', ink: '#2a3f55' }], variants: [
        { id: 'boquillas', name: 'Boquillas obstruidas', p: { texture: 'desgaste_2', print: { on: true, bands: 0.75, spacing: 0.12, width: 0.15, dir: -1, regular: 0.9 }, ink: { on: true, pressure: 0.2, grain: 0.15 }, bleed: { on: true, amount: 0.1, dir: 0, wet: 0.2 }, paper: { on: true, feather: 0.5, relief: 0.12, tooth: 0 }, warp: { on: true, amount: 0.02, rough: 0.1 }, out: { hard: 0.2 } } },
        { id: 'sintinta', name: 'Sin tinta', p: { texture: 'desgaste_4', print: { on: true, bands: 0.5, spacing: 0.15, width: 0.2, dir: -1, regular: 0.8 }, ink: { on: true, pressure: 0.65, grain: 0.25, fade: 0.3 }, erode: { on: true, amount: 0.12, distrib: 0.3 }, paper: { on: true, feather: 0.4, relief: 0.15, tooth: 0.1 }, warp: { on: true, amount: 0.02, rough: 0.1 }, out: { hard: 0.15 } } }
      ] },

    // ------------------------------------------------------------------ AGUA
    { id: 'humedad', group: 'agua', name: 'Humedad', desc: 'Gotas de agua sobre la impresión: donde tocan, la tinta se disuelve en el papel en una nube granulosa que rellena los huecos y se para en el borde del agua. El resto queda nítido.',
      palettes: PAL_LAYER, variants: [
        { id: 'leve', name: 'Unas gotas', p: { texture: 'desgaste_1', damp: { on: true, amount: 0.28, size: 0.3, spread: 0.55, cloud: 0.85, lift: 0.35, tide: 0.35 }, warp: { on: true, amount: 0.04, rough: 0.25 }, erode: { on: true, amount: 0.05 }, ink: { on: true, pressure: 0.15, grain: 0.2 }, paper: { on: true, feather: 0.2, relief: 0.35, tooth: 0.05 }, out: { hard: 0.05 } } },
        { id: 'mojado', name: 'Papel mojado', p: { texture: 'desgaste_1', damp: { on: true, amount: 0.42, size: 0.4, spread: 0.75, cloud: 0.9, lift: 0.4, tide: 0.4 }, warp: { on: true, amount: 0.05, rough: 0.3 }, erode: { on: true, amount: 0.06 }, cracks: { on: true, amount: 0.15 }, ink: { on: true, pressure: 0.2, grain: 0.25 }, paper: { on: true, feather: 0.25, relief: 0.35, tooth: 0.05 }, out: { hard: 0.05 } } },
        { id: 'mancha', name: 'Mancha de agua', p: { texture: 'desgaste_1', damp: { on: true, amount: 0.5, size: 0.75, spread: 0.95, cloud: 0.95, lift: 0.5, tide: 0.55 }, warp: { on: true, amount: 0.05, rough: 0.3 }, ink: { on: true, pressure: 0.2, grain: 0.25 }, paper: { on: true, feather: 0.25, relief: 0.35, tooth: 0.05 }, out: { hard: 0.05 } } }
      ] },
    { id: 'goteo', group: 'agua', name: 'Goteo', desc: 'La tinta fresca gotea desde la base de cada letra: gotas de largo muy distinto, que se afilan y acaban en una lágrima más oscura.',
      palettes: PAL_LAYER, variants: [
        { id: 'fino', name: 'Goteo fino', p: { texture: 'desgaste_6', drip: { on: true, amount: 0.45, length: 0.35, thick: 0.45, sag: 0.4, beads: 0.25, trail: 0.15, dark: 0.5 }, warp: { on: true, amount: 0.03, rough: 0.2 }, ink: { on: true, pressure: 0.15, grain: 0.1 }, paper: { on: true, feather: 0.1, relief: 0.25, tooth: 0.05 }, color: { on: true, lightVar: 0.2, edge: 0.15 }, out: { hard: 0.05 } } },
        { id: 'largo', name: 'Goteo largo', p: { texture: 'desgaste_6', drip: { on: true, amount: 0.6, length: 0.75, thick: 0.6, sag: 0.6, beads: 0.35, trail: 0.3, dark: 0.6 }, warp: { on: true, amount: 0.03, rough: 0.2 }, ink: { on: true, pressure: 0.15, grain: 0.1 }, paper: { on: true, feather: 0.1, relief: 0.25, tooth: 0.05 }, color: { on: true, lightVar: 0.2, edge: 0.15 }, out: { hard: 0.05 } } },
        { id: 'chorreado', name: 'Chorreado', p: { texture: 'desgaste_6', drip: { on: true, amount: 0.9, length: 0.6, thick: 0.85, sag: 0.9, beads: 0.45, trail: 0.45, dark: 0.7 }, bleed: { on: true, amount: 0.15, dir: 0.9, wet: 0.3, pool: 0.4, halo: 0.4, zones: 0.3, zoneSize: 0.5 }, warp: { on: true, amount: 0.04, rough: 0.25 }, ink: { on: true, pressure: 0.2, grain: 0.12 }, paper: { on: true, feather: 0.12, relief: 0.25, tooth: 0.05 }, color: { on: true, lightVar: 0.25, edge: 0.15 }, out: { hard: 0.05 } } }
      ] },
    { id: 'acuarela', group: 'agua', name: 'Acuarelado', desc: 'Acuarela real: pigmento transparente que deriva hacia un lado, aro fino y oscuro donde se secó el agua con el interior más claro, granulación del mismo color, floraciones y una segunda veladura.',
      palettes: [{ name: 'Color del texto', ink: 'original' }, { name: 'Azul', ink: '#1f4fa3' }, { name: 'Sepia', ink: '#6b4a32' }], variants: [
        { id: 'suave', name: 'Lavado', p: { texture: 'desgaste_1', aqua: { on: true, density: 0.45, variation: 0.6, rim: 0.85, rimWidth: 0.3, granul: 0.4, blooms: 0.15, edgeWobble: 0.6, drift: 0.5, glaze: 0.3 }, warp: { on: true, amount: 0.06, rough: 0.04 }, ink: OFF, paper: { on: true, feather: 0.04, relief: 0.06, tooth: 0.04, paperScale: 0.5 }, color: { on: true, sat: 0.08, hueVar: 0.12, satVar: 0.2, lightVar: 0.12, edge: 0 }, out: { hard: 0, opacity: 1 } } },
        { id: 'cargada', name: 'Pigmento cargado', p: { texture: 'desgaste_1', aqua: { on: true, density: 0.65, variation: 0.5, rim: 1, rimWidth: 0.25, granul: 0.6, blooms: 0.2, edgeWobble: 0.65, drift: 0.6, glaze: 0.5 }, warp: { on: true, amount: 0.06, rough: 0.04 }, ink: OFF, paper: { on: true, feather: 0.04, relief: 0.06, tooth: 0.06, paperScale: 0.5 }, color: { on: true, sat: 0.12, hueVar: 0.12, satVar: 0.2, lightVar: 0.12, edge: 0 }, out: { hard: 0, opacity: 1 } } },
        { id: 'floracion', name: 'Con floraciones', p: { texture: 'desgaste_1', aqua: { on: true, density: 0.5, variation: 0.65, rim: 0.9, rimWidth: 0.35, granul: 0.4, blooms: 0.55, edgeWobble: 0.7, drift: 0.5, glaze: 0.35 }, warp: { on: true, amount: 0.07, rough: 0.05 }, ink: OFF, paper: { on: true, feather: 0.04, relief: 0.06, tooth: 0.04, paperScale: 0.5 }, color: { on: true, sat: 0.08, hueVar: 0.15, satVar: 0.22, lightVar: 0.12, edge: 0 }, out: { hard: 0, opacity: 1 } } }
      ] },
  ];

  // parámetros que escala el deslizador "Intensidad" de la página de presets
  var INTENSITY = {
    warp: ['amount', 'rough'], erode: ['amount'], cracks: ['amount'], bleed: ['amount', 'zones', 'dissolve', 'tide'],
    drips: ['amount', 'length', 'drops'], splat: ['amount', 'drops'], ink: ['pressure', 'grain', 'fade', 'roller'],
    print: ['bands', 'shift', 'streaks', 'ghost'], paper: ['feather', 'tooth'], tintas: ['misreg'],
    press: ['squeeze', 'halo', 'starve'], wood: ['grain', 'chips'], mesh: ['sawtooth', 'mesh', 'voids'],
    stone: ['amount', 'veil'], wash: ['wash', 'granul', 'blooms'],
    damp: ['amount', 'spread', 'cloud', 'lift', 'tide'], seep: ['amount', 'reach'], engrave: ['length', 'width'], stamp: ['tilt', 'uneven'], aqua: ['variation', 'rim', 'granul', 'blooms'], gouge: ['edge', 'inner'], rim: ['amount'], stencil: ['fiber', 'density', 'setoff'],
    copy: ['gen', 'dropout', 'toner', 'streaks', 'haze'], drip: ['amount', 'length', 'trail']
  };

  function byId(id) { for (var i = 0; i < TECHS.length; i++) if (TECHS[i].id === id) return TECHS[i]; return null; }
  // parámetros completos de una variante (sobre los valores por defecto del motor)
  function build(defaults, tech, variant) {
    var o = JSON.parse(JSON.stringify(defaults));
    [BASE, variant.p].forEach(function (src) {
      for (var k in src) {
        if (src[k] && typeof src[k] === 'object') { if (src[k].on === false && Object.keys(src[k]).length === 1) o[k].on = false; else for (var q in src[k]) o[k][q] = src[k][q]; if (src[k].on === undefined && o[k] && src !== BASE) o[k].on = true; }
        else o[k] = src[k];
      }
    });
    return o;
  }

  var api = { GROUPS: GROUPS, TECHS: TECHS, INTENSITY: INTENSITY, byId: byId, build: build };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AFXPresets = api;
})(this);
