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
    paper: { on: true, feather: 0.2, relief: 0.3, tooth: 0.1, paperScale: 0.5 },
    color: { on: true, hue: 0, sat: 0, light: 0, hueVar: 0.05, satVar: 0.1, lightVar: 0.25, edge: 0.25 },
    ink: { on: true, pressure: 0.2, grain: 0.2, fade: 0, roller: 0 },
    out: { hard: 0.2, opacity: 1 }
  };
  // paletas: ink = tinta 1 ('original' = color de la capa), c2/c3 = tintas 2 y 3
  var PAL_LAYER = [{ name: 'Capa', ink: 'original' }, { name: 'Negro', ink: '#151515' }, { name: 'Rojo', ink: '#b3261e' }];

  var TECHS = [
    // ------------------------------------------------------------------ DESGASTE (de la 0.2)
    { id: 'sello', group: 'desgaste', name: 'Sello gastado', desc: 'Tampón con poca tinta: pérdidas grandes, grietas, grano y bordes rotos.',
      palettes: PAL_LAYER, variants: [
        { id: 'normal', name: 'Normal', p: { texture: 'desgaste_1', warp: { on: true, amount: 0.15, rough: 0.45 }, erode: { on: true, amount: 0.33, distrib: 0.6, contrast: 0.7 }, cracks: { on: true, amount: 0.3 }, splat: { on: true, amount: 0.15, spread: 0.3, size: 0.4, drops: 0.1 }, ink: { on: true, pressure: 0.35, grain: 0.35 }, color: { on: true, hueVar: 0.1, satVar: 0.2, lightVar: 0.4, edge: 0.55 }, out: { hard: 0.45 } } },
        { id: 'muy', name: 'Muy gastado', p: { texture: 'desgaste_3', warp: { on: true, amount: 0.2, rough: 0.55 }, erode: { on: true, amount: 0.48, distrib: 0.7, contrast: 0.7 }, cracks: { on: true, amount: 0.5 }, splat: { on: true, amount: 0.25, spread: 0.4, size: 0.45, drops: 0.15 }, ink: { on: true, pressure: 0.5, grain: 0.45 }, color: { on: true, lightVar: 0.45, edge: 0.5 }, out: { hard: 0.4 } } }
      ] },
    { id: 'corrida', group: 'desgaste', name: 'Tinta corrida', desc: 'Tinta que se corre con borde húmedo y pigmento atrapado en el frente del agua.',
      palettes: PAL_LAYER, variants: [
        { id: 'normal', name: 'Normal', p: { texture: 'desgaste_3', warp: { on: true, amount: 0.3, rough: 0.35 }, erode: { on: true, amount: 0.1, distrib: 0.5, contrast: 0.5 }, bleed: { on: true, amount: 0.55, dir: -0.2, wet: 0.65, pool: 0.55, halo: 0.7, hue: 0.04, sat: 0.25, light: 0.1 }, splat: { on: true, amount: 0.15, spread: 0.35, size: 0.5, drops: 0.15 }, ink: { on: true, pressure: 0.2, grain: 0.25 }, color: { on: true, hueVar: 0.15, satVar: 0.25, lightVar: 0.35, edge: 0.3 }, out: { hard: 0 } } },
        { id: 'arrastre', name: 'Arrastre', p: { texture: 'desgaste_2', warp: { on: true, amount: 0.3, rough: 0.4 }, bleed: { on: true, amount: 0.5, dir: -0.85, wet: 0.25, pool: 0.4, halo: 0.6 }, drips: { on: true, length: 0.3, amount: 0.45, up: 0.5, drops: 0 }, erode: { on: true, amount: 0.12 }, ink: { on: true, pressure: 0.25, grain: 0.3 }, out: { hard: 0.05 } } }
      ] },
    { id: 'rekt', group: 'desgaste', name: 'Destrozado', desc: 'Todo a la vez: deformación, pérdidas, grietas, corrido, goteo y salpicaduras.',
      palettes: PAL_LAYER, variants: [
        { id: 'normal', name: 'Normal', p: { texture: 'desgaste_4', warp: { on: true, amount: 0.4, rough: 0.6 }, erode: { on: true, amount: 0.32, distrib: 0.65, contrast: 0.6 }, cracks: { on: true, amount: 0.55 }, bleed: { on: true, amount: 0.3, dir: -0.4, wet: 0.35, pool: 0.5, halo: 0.5, sat: 0.15, light: 0.15 }, drips: { on: true, length: 0.25, amount: 0.4, up: 0.2, drops: 0.15 }, splat: { on: true, amount: 0.45, spread: 0.5, size: 0.5, drops: 0.3 }, ink: { on: true, pressure: 0.4, grain: 0.4 }, print: { on: true, bands: 0.2, spacing: 0.4, width: 0.3, dir: -1, streaks: 0.15 }, color: { on: true, hueVar: 0.1, satVar: 0.2, lightVar: 0.4, edge: 0.35 }, out: { hard: 0.2 } } }
      ] },

    // ------------------------------------------------------------------ IMPRESIÓN
    { id: 'offset', group: 'impresion', name: 'Offset · Tritono', desc: 'Trama de puntos: cada tinta con su ángulo (45°, 75°, 15°) forma la roseta, con ganancia de punto.',
      palettes: [{ name: 'Clásico', ink: '#1a1a1a', c2: '#7d7468', c3: '#b08d57' }, { name: 'Frío', ink: '#141821', c2: '#4b6178', c3: '#48a9c5' }, { name: 'Pop', ink: '#151515', c2: '#e23c3c', c3: '#f5c400' }],
      inks: 3, variants: [
        { id: 'tritono', name: 'Tritono', p: { texture: 'desgaste_2', tintas: { on: true, count: 3, screen: 1, cell: 0.3, gain: 0.3, misreg: 0.12, tone: 0.8 }, warp: { on: true, amount: 0.03, rough: 0.15 }, erode: { on: true, amount: 0.05 }, ink: { on: true, pressure: 0.3, grain: 0.15 }, paper: { on: true, feather: 0.08, relief: 0.2, tooth: 0.05 }, out: { hard: 0 } } },
        { id: 'duotono', name: 'Duotono', p: { texture: 'desgaste_2', tintas: { on: true, count: 2, screen: 1, cell: 0.35, gain: 0.3, misreg: 0.15, tone: 0.78 }, warp: { on: true, amount: 0.03, rough: 0.15 }, erode: { on: true, amount: 0.05 }, ink: { on: true, pressure: 0.3, grain: 0.15 }, paper: { on: true, feather: 0.08, relief: 0.2, tooth: 0.05 }, out: { hard: 0 } } },
        { id: 'gruesa', name: 'Trama gruesa', p: { texture: 'desgaste_4', tintas: { on: true, count: 3, screen: 1, cell: 0.75, gain: 0.45, misreg: 0.3, tone: 0.72 }, warp: { on: true, amount: 0.05, rough: 0.2 }, erode: { on: true, amount: 0.1 }, ink: { on: true, pressure: 0.4, grain: 0.2 }, paper: { on: true, feather: 0.12, relief: 0.3, tooth: 0.1 }, out: { hard: 0 } } }
      ] },
    { id: 'serigrafia', group: 'impresion', name: 'Serigrafía', desc: 'Tinta gruesa y opaca a través de malla: dentado, malla visible, rasqueta irregular, huecos y desregistro.',
      palettes: [{ name: 'Negro', ink: '#151515', c2: '#e23c3c' }, { name: 'Rojo + azul', ink: '#e23c3c', c2: '#1f3a93' }, { name: 'Amarillo + negro', ink: '#f5c400', c2: '#151515' }],
      inks: 2, variants: [
        { id: 'limpia', name: 'Limpia', p: { texture: 'desgaste_6', mesh: { on: true, sawtooth: 0.45, mesh: 0.35, voids: 0.15 }, warp: { on: true, amount: 0.04, rough: 0.25 }, erode: { on: true, amount: 0.06, contrast: 0.9 }, ink: { on: true, pressure: 0.1, grain: 0.08, roller: 0.3 }, paper: { on: true, feather: 0.05, relief: 0.12, tooth: 0 }, color: { on: true, lightVar: 0.15, edge: 0.4 }, out: { hard: 0.5 } } },
        { id: 'dos', name: 'Dos tintas', p: { texture: 'desgaste_6', tintas: { on: true, count: 2, screen: 0, misreg: 0.45, misAng: 0.3, d2: 1 }, mesh: { on: true, sawtooth: 0.45, mesh: 0.35, voids: 0.15 }, warp: { on: true, amount: 0.04, rough: 0.25 }, erode: { on: true, amount: 0.06, contrast: 0.9 }, ink: { on: true, pressure: 0.1, grain: 0.08, roller: 0.3 }, paper: { on: true, feather: 0.05, relief: 0.12, tooth: 0 }, out: { hard: 0.5 } } },
        { id: 'gastada', name: 'Pantalla gastada', p: { texture: 'desgaste_3', mesh: { on: true, sawtooth: 0.7, mesh: 0.5, voids: 0.5 }, warp: { on: true, amount: 0.05, rough: 0.35 }, erode: { on: true, amount: 0.18, contrast: 0.85 }, ink: { on: true, pressure: 0.2, grain: 0.1, roller: 0.6 }, paper: { on: true, feather: 0.08, relief: 0.15, tooth: 0.05 }, out: { hard: 0.5 } } }
      ] },
    { id: 'riso', group: 'impresion', name: 'Risografía', desc: 'Tinta de soja transparente y fluorescente: grano, cobertura irregular, bandas del tambor y desregistro de 1-3 mm.',
      palettes: [{ name: 'Rosa + azul', ink: '#ff48b0', c2: '#0078bf' }, { name: 'Rojo + amarillo', ink: '#f15060', c2: '#ffe800' }, { name: 'Verde + morado', ink: '#00a95c', c2: '#765ba7' }],
      inks: 2, variants: [
        { id: 'dos', name: 'Dos tintas', p: { texture: 'desgaste_2', tintas: { on: true, count: 2, screen: 0, misreg: 0.5, misAng: -0.4, d2: 0.85 }, warp: { on: true, amount: 0.04, rough: 0.2 }, erode: { on: true, amount: 0.06 }, ink: { on: true, pressure: 0.35, grain: 0.45 }, paper: { on: true, feather: 0.1, relief: 0.2, tooth: 0.35 }, print: { on: true, bands: 0.12, spacing: 0.6, width: 0.5, dir: -1 }, color: { on: true, lightVar: 0.2, edge: 0.15 }, out: { hard: 0.25, opacity: 0.94 } } },
        { id: 'una', name: 'Una tinta', p: { texture: 'desgaste_2', warp: { on: true, amount: 0.04, rough: 0.2 }, erode: { on: true, amount: 0.06 }, ink: { on: true, pressure: 0.35, grain: 0.45 }, paper: { on: true, feather: 0.1, relief: 0.2, tooth: 0.35 }, print: { on: true, bands: 0.12, spacing: 0.6, width: 0.5, dir: -1 }, color: { on: true, lightVar: 0.2, edge: 0.15 }, out: { hard: 0.25, opacity: 0.94 } } },
        { id: 'gastada', name: 'Gastada', p: { texture: 'desgaste_4', tintas: { on: true, count: 2, screen: 0, misreg: 0.8, misAng: -0.4, d2: 0.8 }, warp: { on: true, amount: 0.06, rough: 0.3 }, erode: { on: true, amount: 0.14 }, ink: { on: true, pressure: 0.55, grain: 0.55 }, paper: { on: true, feather: 0.12, relief: 0.25, tooth: 0.55 }, print: { on: true, bands: 0.35, spacing: 0.5, width: 0.5, dir: -1 }, out: { hard: 0.25, opacity: 0.94 } } }
      ] },
    { id: 'tipografia', group: 'impresion', name: 'Tipografía', desc: 'Letterpress: el tipo presiona el papel. Más tinta en el borde, halo fino aplastado y macizos con huecos en los valles del papel.',
      palettes: [{ name: 'Capa', ink: 'original' }, { name: 'Negro', ink: '#151515' }, { name: 'Rojo', ink: '#c8352b' }], variants: [
        { id: 'fina', name: 'Fina', p: { texture: 'desgaste_6', press: { on: true, squeeze: 0.35, halo: 0.2, starve: 0.2 }, warp: { on: true, amount: 0.03, rough: 0.12 }, erode: { on: true, amount: 0.05 }, ink: { on: true, pressure: 0.15, grain: 0.2 }, paper: { on: true, feather: 0.12, relief: 0.45, tooth: 0.15 }, out: { hard: 0.15 } } },
        { id: 'entintada', name: 'Muy entintada', p: { texture: 'desgaste_6', press: { on: true, squeeze: 0.85, halo: 0.65, starve: 0.1 }, warp: { on: true, amount: 0.03, rough: 0.12 }, erode: { on: true, amount: 0.03 }, ink: { on: true, pressure: 0.1, grain: 0.15 }, paper: { on: true, feather: 0.3, relief: 0.4, tooth: 0.08 }, out: { hard: 0.1 } } },
        { id: 'pobre', name: 'Poca tinta', p: { texture: 'desgaste_1', press: { on: true, squeeze: 0.45, halo: 0.2, starve: 0.75 }, warp: { on: true, amount: 0.04, rough: 0.2 }, erode: { on: true, amount: 0.15 }, ink: { on: true, pressure: 0.3, grain: 0.3 }, paper: { on: true, feather: 0.1, relief: 0.5, tooth: 0.6 }, out: { hard: 0.15 } } }
      ] },
    { id: 'flexo', group: 'impresion', name: 'Flexografía', desc: 'Plancha de goma tipo tampón (bolsas, cajas, etiquetas): halo marcado en el borde y puntos de trama en forma de donut.',
      palettes: [{ name: 'Capa', ink: 'original', c2: '#e23c3c' }, { name: 'Negro', ink: '#151515', c2: '#e23c3c' }, { name: 'Azul + rojo', ink: '#1f3a93', c2: '#e23c3c' }],
      inks: 2, variants: [
        { id: 'etiqueta', name: 'Etiqueta', p: { texture: 'desgaste_2', press: { on: true, squeeze: 0.65, halo: 0.6, starve: 0.15 }, tintas: { on: true, count: 1, screen: 0.5, cell: 0.25, gain: 0.35, donut: 0.7, tone: 0.85 }, warp: { on: true, amount: 0.03, rough: 0.1 }, ink: { on: true, pressure: 0.15, grain: 0.15 }, paper: { on: true, feather: 0.1, relief: 0.15, tooth: 0.05 }, out: { hard: 0.1 } } },
        { id: 'kraft', name: 'Bolsa de kraft', p: { texture: 'desgaste_4', press: { on: true, squeeze: 0.8, halo: 0.8, starve: 0.3 }, tintas: { on: true, count: 1, screen: 0.8, cell: 0.4, gain: 0.45, donut: 0.8, tone: 0.8 }, warp: { on: true, amount: 0.05, rough: 0.2 }, erode: { on: true, amount: 0.08 }, ink: { on: true, pressure: 0.3, grain: 0.25 }, paper: { on: true, feather: 0.2, relief: 0.4, tooth: 0.25 }, out: { hard: 0.1 } } },
        { id: 'dos', name: 'Dos tintas', p: { texture: 'desgaste_2', press: { on: true, squeeze: 0.6, halo: 0.55, starve: 0.15 }, tintas: { on: true, count: 2, screen: 0.5, cell: 0.28, gain: 0.35, donut: 0.65, misreg: 0.3, tone: 0.85 }, warp: { on: true, amount: 0.03, rough: 0.12 }, ink: { on: true, pressure: 0.15, grain: 0.15 }, paper: { on: true, feather: 0.1, relief: 0.15, tooth: 0.05 }, out: { hard: 0.1 } } }
      ] },
    { id: 'litografia', group: 'impresion', name: 'Litografía', desc: 'Lápiz o tusche sobre piedra: punteado granuloso, borde graso y velo de plancha.',
      palettes: [{ name: 'Capa', ink: 'original' }, { name: 'Negro', ink: '#1d1b19' }, { name: 'Sepia', ink: '#5a3b28' }], variants: [
        { id: 'lapiz', name: 'Lápiz litográfico', p: { texture: 'desgaste_1', stone: { on: true, amount: 0.8, size: 0.35, tone: 0.72, greasy: 0.5, veil: 0.1 }, warp: { on: true, amount: 0.05, rough: 0.2 }, erode: { on: true, amount: 0.05 }, ink: { on: true, pressure: 0.15, grain: 0 }, paper: { on: true, feather: 0.1, relief: 0.2, tooth: 0 }, out: { hard: 0 } } },
        { id: 'tusche', name: 'Tusche', p: { texture: 'desgaste_5', stone: { on: true, amount: 0.35, size: 0.45, tone: 0.9, greasy: 0.3, veil: 0.1 }, wash: { on: true, wash: 0.35, granul: 0.4, blooms: 0.2, transp: 0 }, warp: { on: true, amount: 0.08, rough: 0.25 }, ink: { on: true, pressure: 0.2, grain: 0 }, paper: { on: true, feather: 0.12, relief: 0.2, tooth: 0 }, out: { hard: 0 } } },
        { id: 'gastada', name: 'Piedra gastada', p: { texture: 'desgaste_3', stone: { on: true, amount: 0.85, size: 0.6, tone: 0.68, greasy: 0.6, veil: 0.35 }, warp: { on: true, amount: 0.06, rough: 0.25 }, erode: { on: true, amount: 0.2 }, ink: { on: true, pressure: 0.2, grain: 0 }, paper: { on: true, feather: 0.12, relief: 0.25, tooth: 0 }, out: { hard: 0 } } }
      ] },
    { id: 'xilografia', group: 'impresion', name: 'Xilografía', desc: 'Taco de madera: veta donde salta la tinta, restos de talla junto al contorno y presión desigual.',
      palettes: PAL_LAYER, variants: [
        { id: 'madera', name: 'Madera', p: { texture: 'desgaste_6', wood: { on: true, grain: 0.6, angle: 0, spacing: 0.4, chips: 0.25 }, warp: { on: true, amount: 0.08, rough: 0.45 }, erode: { on: true, amount: 0.12, contrast: 0.95 }, ink: { on: true, pressure: 0.3, grain: 0.1, roller: 0.25 }, paper: { on: true, feather: 0.1, relief: 0.3, tooth: 0.1 }, out: { hard: 0.6 } } },
        { id: 'gastado', name: 'Taco gastado', p: { texture: 'desgaste_3', wood: { on: true, grain: 0.85, angle: 0, spacing: 0.55, chips: 0.5 }, warp: { on: true, amount: 0.1, rough: 0.55 }, erode: { on: true, amount: 0.25, contrast: 0.95 }, cracks: { on: true, amount: 0.3 }, ink: { on: true, pressure: 0.45, grain: 0.15, roller: 0.35 }, paper: { on: true, feather: 0.12, relief: 0.35, tooth: 0.15 }, out: { hard: 0.6 } } }
      ] },
    { id: 'lino', group: 'impresion', name: 'Linograbado', desc: 'Como la xilografía pero sin veta: tinta plana con marcas del rodillo y cortes limpios de gubia.',
      palettes: PAL_LAYER, variants: [
        { id: 'limpio', name: 'Limpio', p: { texture: 'desgaste_6', wood: { on: true, grain: 0, chips: 0.2 }, warp: { on: true, amount: 0.06, rough: 0.35 }, erode: { on: true, amount: 0.08, contrast: 0.95 }, ink: { on: true, pressure: 0.3, grain: 0.15, roller: 0.55 }, paper: { on: true, feather: 0.1, relief: 0.3, tooth: 0.1 }, out: { hard: 0.55 } } },
        { id: 'rodillo', name: 'Rodillo cargado', p: { texture: 'desgaste_2', wood: { on: true, grain: 0, chips: 0.3 }, warp: { on: true, amount: 0.08, rough: 0.4 }, erode: { on: true, amount: 0.12, contrast: 0.9 }, ink: { on: true, pressure: 0.5, grain: 0.2, roller: 0.85 }, paper: { on: true, feather: 0.12, relief: 0.35, tooth: 0.15 }, out: { hard: 0.5 } } }
      ] },
    { id: 'mimeo', group: 'impresion', name: 'Mimeógrafo', desc: 'Tinta grasa a través de un esténcil que se gasta: la tinta se abre, pierde fuerza a trompicones y deja marcas del rodillo.',
      palettes: [{ name: 'Negro', ink: '#1b1a1d' }, { name: 'Capa', ink: 'original' }, { name: 'Violeta', ink: '#4b3f9e' }], variants: [
        { id: 'nuevo', name: 'Esténcil nuevo', p: { texture: 'desgaste_5', ink: { on: true, pressure: 0.35, grain: 0.35, fade: 0.2, roller: 0.25 }, bleed: { on: true, amount: 0.12, dir: 0, wet: 0 }, warp: { on: true, amount: 0.05, rough: 0.3 }, erode: { on: true, amount: 0.1, distrib: 0.7 }, print: { on: true, bands: 0.15, spacing: 0.5, width: 0.4, dir: -1, streaks: 0.1 }, color: { on: true, lightVar: 0.4 }, out: { hard: 0.1 } } },
        { id: 'gastado', name: 'Esténcil gastado', p: { texture: 'desgaste_3', ink: { on: true, pressure: 0.6, grain: 0.45, fade: 0.7, roller: 0.4 }, bleed: { on: true, amount: 0.18, dir: 0, wet: 0 }, warp: { on: true, amount: 0.06, rough: 0.35 }, erode: { on: true, amount: 0.3, distrib: 0.75 }, print: { on: true, bands: 0.25, spacing: 0.5, width: 0.4, dir: -1, streaks: 0.15 }, color: { on: true, lightVar: 0.45 }, out: { hard: 0.1 } } }
      ] },

    // ------------------------------------------------------------------ COPISTERÍA
    { id: 'fotocopia', group: 'copia', name: 'Fotocopia', desc: 'Fotocopiadora: negros quemados, motas de tóner, bandas y, en copias de copias, trazos que engordan.',
      palettes: [{ name: 'Tóner', ink: '#121212' }, { name: 'Capa', ink: 'original' }, { name: 'Gris', ink: '#3b3b3b' }], variants: [
        { id: 'barata', name: 'Copia barata', p: { texture: 'desgaste_6', warp: { on: true, amount: 0.08, rough: 0.35 }, erode: { on: true, amount: 0.1, distrib: 0.6, contrast: 0.8 }, bleed: { on: true, amount: 0.12, dir: 0, wet: 0 }, splat: { on: true, amount: 0.3, spread: 0.6, size: 0.15, drops: 0.2 }, ink: { on: true, pressure: 0.2, grain: 0.7 }, print: { on: true, bands: 0.25, spacing: 0.3, width: 0.3, dir: -1, shift: 0.15, streaks: 0.35 }, color: { on: true, sat: -0.3, lightVar: 0.25 }, paper: { on: true, feather: 0.05, relief: 0.1, tooth: 0 }, out: { hard: 0.85 } } },
        { id: 'copiacopia', name: 'Copia de copia', p: { texture: 'desgaste_1', warp: { on: true, amount: 0.1, rough: 0.45 }, erode: { on: true, amount: 0.15, distrib: 0.6, contrast: 0.8 }, bleed: { on: true, amount: 0.25, dir: 0, wet: 0 }, splat: { on: true, amount: 0.45, spread: 0.7, size: 0.15, drops: 0.3 }, ink: { on: true, pressure: 0.25, grain: 0.8 }, print: { on: true, bands: 0.2, spacing: 0.3, width: 0.3, dir: -1, shift: 0.1, streaks: 0.25 }, color: { on: true, sat: -0.3, lightVar: 0.2 }, paper: { on: true, feather: 0.05, relief: 0.08, tooth: 0 }, out: { hard: 0.95 } } }
      ] },
    { id: 'laser', group: 'copia', name: 'Láser roto', desc: 'Impresora láser: rayas verticales del tambor, copia fantasma desplazada (ghosting) y tóner disperso.',
      palettes: [{ name: 'Tóner', ink: '#121212' }, { name: 'Capa', ink: 'original' }, { name: 'Gris', ink: '#3b3b3b' }], variants: [
        { id: 'tambor', name: 'Tambor rayado', p: { texture: 'desgaste_6', print: { on: true, bands: 0.3, spacing: 0.5, width: 0.3, dir: -1, streaks: 0.7, ghost: 0.1, ghostOff: 0.3 }, splat: { on: true, amount: 0.25, spread: 0.3, size: 0.1, drops: 0.1 }, ink: { on: true, pressure: 0.3, grain: 0.5 }, erode: { on: true, amount: 0.05 }, warp: { on: true, amount: 0.03, rough: 0.2 }, color: { on: true, sat: -0.3 }, paper: { on: true, feather: 0.03, relief: 0.08, tooth: 0 }, out: { hard: 0.7 } } },
        { id: 'ghost', name: 'Ghosting', p: { texture: 'desgaste_6', print: { on: true, bands: 0.2, spacing: 0.5, width: 0.3, dir: -1, streaks: 0.25, ghost: 0.45, ghostOff: 0.45 }, splat: { on: true, amount: 0.2, spread: 0.3, size: 0.1, drops: 0.1 }, ink: { on: true, pressure: 0.3, grain: 0.45 }, erode: { on: true, amount: 0.05 }, warp: { on: true, amount: 0.03, rough: 0.2 }, color: { on: true, sat: -0.3 }, paper: { on: true, feather: 0.03, relief: 0.08, tooth: 0 }, out: { hard: 0.7 } } }
      ] },
    { id: 'inkjet', group: 'copia', name: 'Inyección mala', desc: 'Impresora de tinta: líneas blancas regulares de boquillas obstruidas, tinta que se abre en las fibras y poca tinta.',
      palettes: [{ name: 'Capa', ink: 'original' }, { name: 'Negro', ink: '#1a1a1e' }, { name: 'Cian sin tinta', ink: '#2a3f55' }], variants: [
        { id: 'boquillas', name: 'Boquillas obstruidas', p: { texture: 'desgaste_2', print: { on: true, bands: 0.75, spacing: 0.12, width: 0.15, dir: -1, regular: 0.9 }, ink: { on: true, pressure: 0.2, grain: 0.15 }, bleed: { on: true, amount: 0.1, dir: 0, wet: 0.2 }, paper: { on: true, feather: 0.5, relief: 0.12, tooth: 0 }, warp: { on: true, amount: 0.02, rough: 0.1 }, out: { hard: 0.2 } } },
        { id: 'sintinta', name: 'Sin tinta', p: { texture: 'desgaste_4', print: { on: true, bands: 0.5, spacing: 0.15, width: 0.2, dir: -1, regular: 0.8 }, ink: { on: true, pressure: 0.65, grain: 0.25, fade: 0.3 }, erode: { on: true, amount: 0.12, distrib: 0.3 }, paper: { on: true, feather: 0.4, relief: 0.15, tooth: 0.1 }, warp: { on: true, amount: 0.02, rough: 0.1 }, out: { hard: 0.15 } } }
      ] },

    // ------------------------------------------------------------------ AGUA
    { id: 'humedad', group: 'agua', name: 'Humedad', desc: 'Impresión normal que se moja: en algunas zonas la tinta se abre y se corre, el centro se lava y en el frente queda la marca del agua.',
      palettes: PAL_LAYER, variants: [
        { id: 'leve', name: 'Humedad leve', p: { texture: 'desgaste_1', bleed: { on: true, amount: 0.4, dir: 0, wet: 0.9, pool: 0.55, halo: 0.45, light: 0.1, zones: 0.3, zoneSize: 0.5, dissolve: 0.25, tide: 0.3 }, warp: { on: true, amount: 0.05, rough: 0.25 }, erode: { on: true, amount: 0.05 }, ink: { on: true, pressure: 0.15, grain: 0.2 }, paper: { on: true, feather: 0.25, relief: 0.3, tooth: 0.05 }, out: { hard: 0.1 } } },
        { id: 'mojado', name: 'Papel mojado', p: { texture: 'desgaste_1', bleed: { on: true, amount: 0.6, dir: 0, wet: 0.9, pool: 0.6, halo: 0.45, light: 0.1, zones: 0.55, zoneSize: 0.55, dissolve: 0.45, tide: 0.4 }, warp: { on: true, amount: 0.06, rough: 0.3 }, erode: { on: true, amount: 0.05 }, ink: { on: true, pressure: 0.2, grain: 0.2 }, paper: { on: true, feather: 0.3, relief: 0.3, tooth: 0.05 }, out: { hard: 0.05 } } },
        { id: 'mancha', name: 'Mancha de agua', p: { texture: 'desgaste_1', bleed: { on: true, amount: 0.75, dir: 0, wet: 1, pool: 0.75, halo: 0.45, light: 0.1, zones: 0.45, zoneSize: 0.85, dissolve: 0.55, tide: 0.6 }, warp: { on: true, amount: 0.06, rough: 0.3 }, ink: { on: true, pressure: 0.2, grain: 0.2 }, paper: { on: true, feather: 0.3, relief: 0.3, tooth: 0.05 }, out: { hard: 0.05 } } }
      ] },
    { id: 'goteo', group: 'agua', name: 'Goteo', desc: 'La tinta húmeda gotea hacia abajo con hilos finos y gotas muy pequeñas.',
      palettes: PAL_LAYER, variants: [
        { id: 'fino', name: 'Goteo fino', p: { texture: 'desgaste_1', drips: { on: true, length: 0.35, amount: 0.3, up: 0, drops: 0.4, thick: 0.15 }, bleed: { on: true, amount: 0.2, dir: 0.8, wet: 0.4, pool: 0.5, halo: 0.45, zones: 0.3, zoneSize: 0.4 }, warp: { on: true, amount: 0.06, rough: 0.3 }, erode: { on: true, amount: 0.06 }, ink: { on: true, pressure: 0.2, grain: 0.25 }, paper: { on: true, feather: 0.2, relief: 0.3, tooth: 0.05 }, out: { hard: 0.1 } } },
        { id: 'largo', name: 'Goteo largo', p: { texture: 'desgaste_1', drips: { on: true, length: 0.75, amount: 0.55, up: 0, drops: 0.45, thick: 0.25 }, bleed: { on: true, amount: 0.25, dir: 0.85, wet: 0.4, pool: 0.5, halo: 0.45, zones: 0.35, zoneSize: 0.4 }, warp: { on: true, amount: 0.06, rough: 0.3 }, erode: { on: true, amount: 0.06 }, ink: { on: true, pressure: 0.2, grain: 0.25 }, paper: { on: true, feather: 0.2, relief: 0.3, tooth: 0.05 }, out: { hard: 0.1 } } },
        { id: 'chorreado', name: 'Chorreado', p: { texture: 'desgaste_3', drips: { on: true, length: 0.55, amount: 0.85, up: 0.25, drops: 0.6, thick: 0.4 }, bleed: { on: true, amount: 0.3, dir: 0.85, wet: 0.5, pool: 0.55, halo: 0.45, zones: 0.45, zoneSize: 0.5 }, warp: { on: true, amount: 0.1, rough: 0.4 }, erode: { on: true, amount: 0.1 }, cracks: { on: true, amount: 0.2 }, ink: { on: true, pressure: 0.25, grain: 0.3 }, paper: { on: true, feather: 0.2, relief: 0.3, tooth: 0.05 }, out: { hard: 0.1 } } }
      ] },
    { id: 'acuarela', group: 'agua', name: 'Acuarelado', desc: 'La forma pintada a la acuarela: aguada con manchas, pigmento en el borde, granulación y floraciones.',
      palettes: [{ name: 'Capa', ink: 'original' }, { name: 'Azul', ink: '#1f4fa3' }, { name: 'Sepia', ink: '#6b4a32' }], variants: [
        { id: 'suave', name: 'Suave', p: { texture: 'desgaste_5', bleed: { on: true, amount: 0.6, dir: 0, wet: 1, pool: 0.6, halo: 0.75, hue: 0.06, sat: 0.3, light: 0.2 }, wash: { on: true, wash: 0.4, granul: 0.35, blooms: 0.25, transp: 0.25 }, warp: { on: true, amount: 0.35, rough: 0.3 }, erode: { on: true, amount: 0.1, distrib: 0.6, contrast: 0.25 }, ink: { on: true, pressure: 0.45, grain: 0.15 }, color: { on: true, hueVar: 0.3, satVar: 0.35, lightVar: 0.5, edge: 0.2 }, paper: { on: true, feather: 0.2, relief: 0.35, tooth: 0.1 }, out: { hard: 0, opacity: 0.95 } } },
        { id: 'cargada', name: 'Cargada', p: { texture: 'desgaste_5', bleed: { on: true, amount: 0.7, dir: 0, wet: 1, pool: 0.8, halo: 0.75, hue: 0.06, sat: 0.3, light: 0.15 }, wash: { on: true, wash: 0.5, granul: 0.6, blooms: 0.4, transp: 0.1 }, warp: { on: true, amount: 0.35, rough: 0.3 }, erode: { on: true, amount: 0.12, distrib: 0.6, contrast: 0.25 }, ink: { on: true, pressure: 0.55, grain: 0.2 }, color: { on: true, hueVar: 0.35, satVar: 0.4, lightVar: 0.55, edge: 0.3 }, paper: { on: true, feather: 0.2, relief: 0.35, tooth: 0.15 }, out: { hard: 0, opacity: 0.97 } } },
        { id: 'aguada', name: 'Aguada', p: { texture: 'desgaste_5', bleed: { on: true, amount: 0.85, dir: 0, wet: 1, pool: 0.65, halo: 0.75, hue: 0.06, sat: 0.3, light: 0.25 }, wash: { on: true, wash: 0.75, granul: 0.3, blooms: 0.55, transp: 0.4 }, warp: { on: true, amount: 0.4, rough: 0.3 }, erode: { on: true, amount: 0.14, distrib: 0.6, contrast: 0.25 }, ink: { on: true, pressure: 0.6, grain: 0.2 }, color: { on: true, hueVar: 0.35, satVar: 0.4, lightVar: 0.55, edge: 0.15 }, paper: { on: true, feather: 0.25, relief: 0.35, tooth: 0.1 }, out: { hard: 0, opacity: 0.93 } } }
      ] }
  ];

  // parámetros que escala el deslizador "Intensidad" de la página de presets
  var INTENSITY = {
    warp: ['amount', 'rough'], erode: ['amount'], cracks: ['amount'], bleed: ['amount', 'zones', 'dissolve', 'tide'],
    drips: ['amount', 'length', 'drops'], splat: ['amount', 'drops'], ink: ['pressure', 'grain', 'fade', 'roller'],
    print: ['bands', 'shift', 'streaks', 'ghost'], paper: ['feather', 'tooth'], tintas: ['misreg'],
    press: ['squeeze', 'halo', 'starve'], wood: ['grain', 'chips'], mesh: ['sawtooth', 'mesh', 'voids'],
    stone: ['amount', 'veil'], wash: ['wash', 'granul', 'blooms']
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
