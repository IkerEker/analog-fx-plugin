/*
 * Analog FX — catálogo de técnicas.
 * Cada técnica define: grupo, tintas (paletas), texturas que usa, parámetros finos
 * (que generan la página "Ajustes avanzados") y variantes rápidas (presets).
 * Valores de 0 a 1 salvo que se indique min/max.
 */
(function (root) {
  'use strict';

  var GROUPS = [
    { id: 'impresion', name: 'Impresión' },
    { id: 'copia', name: 'Copistería' },
    { id: 'gotitas', name: 'Gotitas' },
    { id: 'acuarela', name: 'Acuarelado' }
  ];

  // Tintas risográficas estándar y colores de imprenta habituales (selector rápido)
  var SWATCHES = [
    '#151515', '#3b3b3b', '#f4f1ea', '#5a3b28', '#b08d57', '#7d7468',
    '#e23c3c', '#f15060', '#ff48b0', '#ff6c2f', '#f5c400', '#ffe800',
    '#00a95c', '#00838a', '#0078bf', '#1f3a93', '#765ba7', '#48a9c5'
  ];

  function chips(k, label, sec, def, options) { return { k: k, label: label, sec: sec, def: def, type: 'chips', options: options }; }
  function S(k, label, sec, def, extra) {
    var o = { k: k, label: label, sec: sec, def: def };
    if (extra) for (var e in extra) o[e] = extra[e];
    return o;
  }
  var ANG = { min: -1, max: 1, fmt: 'deg90' };

  var TECHNIQUES = [
    // ------------------------------------------------------------ SERIGRAFÍA
    {
      id: 'serigrafia', group: 'impresion', name: 'Serigrafía',
      desc: 'Tinta plana y opaca empujada por una malla. Bordes dentados, textura de malla, huecos y desregistro entre colores.',
      inks: { param: 'inkCount', max: 2, palettes: [
        { name: 'Negro', c: ['#151515', '#e23c3c'] },
        { name: 'Rojo + azul', c: ['#e23c3c', '#1f3a93'] },
        { name: 'Amarillo + negro', c: ['#f5c400', '#151515'] }] },
      textures: ['moteado'],
      params: [
        chips('inkCount', 'Número de tintas', 'Tintas', 1, [{ v: 1, label: '1 tinta' }, { v: 2, label: '2 tintas' }]),
        S('density', 'Opacidad de la tinta', 'Tintas', 0.96),
        S('misreg', 'Desregistro (2.ª tinta)', 'Tintas', 0.35),
        S('misAng', 'Dirección del desregistro', 'Tintas', 0.3, ANG),
        S('edge', 'Dentado de la malla', 'Borde', 0.4),
        S('rough', 'Irregularidad del borde', 'Borde', 0.25),
        S('mesh', 'Malla visible', 'Tinta', 0.3),
        S('squeegee', 'Rasqueta irregular', 'Tinta', 0.3),
        S('voids', 'Huecos de tinta', 'Tinta', 0.2)
      ],
      intensity: ['edge', 'rough', 'mesh', 'squeegee', 'voids', 'misreg'],
      presets: [
        { id: 'limpia', name: 'Limpia', v: { inkCount: 1, edge: 0.45, rough: 0.2, mesh: 0.35, squeegee: 0.3, voids: 0.15 } },
        { id: 'desregistro', name: 'Desregistrada', v: { inkCount: 2, misreg: 0.45, edge: 0.35, rough: 0.2, mesh: 0.3, squeegee: 0.25, voids: 0.15 } },
        { id: 'gastada', name: 'Pantalla gastada', v: { inkCount: 1, edge: 0.6, rough: 0.4, mesh: 0.5, squeegee: 0.65, voids: 0.5, density: 0.9 } }
      ]
    },
    // ------------------------------------------------------------ OFFSET / TRITONO
    {
      id: 'offset', group: 'impresion', name: 'Offset · Tritono',
      desc: 'Trama de puntos de imprenta. Cada tinta con su ángulo (45°, 75°, 15°) forma la roseta; ganancia de punto y ligero desregistro.',
      inks: { param: 'inkCount', max: 3, palettes: [
        { name: 'Clásico', c: ['#1a1a1a', '#7d7468', '#b08d57'] },
        { name: 'Frío', c: ['#141821', '#4b6178', '#48a9c5'] },
        { name: 'Pop', c: ['#151515', '#e23c3c', '#f5c400'] }] },
      textures: ['granulado', 'moteado'],
      params: [
        chips('inkCount', 'Tintas', 'Tintas', 3, [{ v: 1, label: 'Monotono' }, { v: 2, label: 'Duotono' }, { v: 3, label: 'Tritono' }]),
        S('tone', 'Densidad', 'Tono', 0.72),
        S('toneVar', 'Variación de tono', 'Tono', 0.4),
        S('edgeFade', 'Degradado hacia el borde', 'Tono', 0.15),
        S('cell', 'Tamaño de la trama', 'Trama', 0.35),
        chips('dot', 'Forma del punto', 'Trama', 'round', [{ v: 'round', label: 'Redondo' }, { v: 'ellipse', label: 'Elíptico' }, { v: 'line', label: 'Línea' }]),
        S('gain', 'Ganancia de punto', 'Trama', 0.3),
        S('paper', 'Absorción del papel', 'Trama', 0.3),
        S('misreg', 'Desregistro', 'Registro', 0.2)
      ],
      intensity: ['toneVar', 'gain', 'paper', 'misreg'],
      presets: [
        { id: 'tritono', name: 'Tritono', v: { inkCount: 3, tone: 0.72, cell: 0.3, misreg: 0.15 } },
        { id: 'duotono', name: 'Duotono', v: { inkCount: 2, tone: 0.68, cell: 0.35, misreg: 0.2 } },
        { id: 'gruesa', name: 'Trama gruesa', v: { inkCount: 3, tone: 0.62, cell: 0.75, gain: 0.45, paper: 0.5, misreg: 0.35 } }
      ]
    },
    // ------------------------------------------------------------ RISOGRAFÍA
    {
      id: 'riso', group: 'impresion', name: 'Risografía',
      desc: 'Esténcil sobre tambor con tinta de soja: grano, trama gruesa, tintas transparentes que se superponen y desregistro de 1-3 mm.',
      inks: { param: 'inkCount', max: 2, palettes: [
        { name: 'Rosa + azul', c: ['#ff48b0', '#0078bf'] },
        { name: 'Rojo + amarillo', c: ['#f15060', '#ffe800'] },
        { name: 'Verde + morado', c: ['#00a95c', '#765ba7'] }] },
      textures: ['piedra'],
      params: [
        chips('inkCount', 'Número de tintas', 'Tintas', 2, [{ v: 1, label: '1 tinta' }, { v: 2, label: '2 tintas' }]),
        S('d1', 'Densidad tinta 1', 'Tintas', 0.94),
        S('d2', 'Densidad tinta 2', 'Tintas', 0.5),
        S('misreg', 'Desregistro', 'Tintas', 0.45),
        S('misAng', 'Dirección del desregistro', 'Tintas', -0.4, ANG),
        S('grain', 'Grano del esténcil', 'Textura', 0.45),
        S('cell', 'Tamaño de la trama', 'Textura', 0.3),
        S('uneven', 'Cobertura irregular', 'Textura', 0.35),
        S('bands', 'Bandas del tambor', 'Textura', 0.15),
        S('rough', 'Irregularidad del borde', 'Textura', 0.2)
      ],
      intensity: ['grain', 'uneven', 'bands', 'misreg', 'rough'],
      presets: [
        { id: 'dos', name: 'Dos tintas', v: { inkCount: 2, misreg: 0.45, d2: 0.5, grain: 0.55 } },
        { id: 'una', name: 'Una tinta', v: { inkCount: 1, d1: 0.92, grain: 0.4 } },
        { id: 'gastada', name: 'Gastada', v: { inkCount: 2, d1: 0.85, d2: 0.5, misreg: 0.7, grain: 0.75, uneven: 0.65, bands: 0.4, rough: 0.35 } }
      ]
    },
    // ------------------------------------------------------------ TIPOGRAFÍA (LETTERPRESS)
    {
      id: 'tipografia', group: 'impresion', name: 'Tipografía',
      desc: 'Relieve presionado (letterpress): más tinta en los bordes que en el centro, halo de tinta aplastada y macizos con huecos.',
      inks: { max: 1, palettes: [
        { name: 'Capa', c: ['layer'] }, { name: 'Negro', c: ['#151515'] }, { name: 'Rojo', c: ['#c8352b'] }] },
      textures: ['moteado', 'piedra'],
      params: [
        S('squeeze', 'Tinta acumulada en el borde', 'Tinta', 0.5),
        S('halo', 'Halo de tinta aplastada', 'Tinta', 0.35),
        S('starve', 'Tinta escasa en macizos', 'Tinta', 0.35),
        S('valleys', 'Valles del papel', 'Papel', 0.3),
        S('deboss', 'Huella de presión', 'Papel', 0.2),
        S('rough', 'Irregularidad del borde', 'Borde', 0.12)
      ],
      intensity: ['squeeze', 'halo', 'starve', 'valleys', 'deboss', 'rough'],
      presets: [
        { id: 'fina', name: 'Fina', v: { squeeze: 0.35, halo: 0.2, starve: 0.2, valleys: 0.15 } },
        { id: 'entintada', name: 'Muy entintada', v: { squeeze: 0.85, halo: 0.7, starve: 0.15, valleys: 0.1, deboss: 0.4 } },
        { id: 'pobre', name: 'Poca tinta', v: { squeeze: 0.45, halo: 0.2, starve: 0.75, valleys: 0.65, rough: 0.25 } }
      ]
    },
    // ------------------------------------------------------------ LITOGRAFÍA
    {
      id: 'litografia', group: 'impresion', name: 'Litografía',
      desc: 'Lápiz o tusche sobre piedra: punteado granuloso, bordes grasos y suaves, reticulado de tusche y velo de plancha.',
      inks: { max: 1, palettes: [
        { name: 'Capa', c: ['layer'] }, { name: 'Negro', c: ['#1d1b19'] }, { name: 'Sepia', c: ['#5a3b28'] }] },
      textures: ['piedra', 'granulado'],
      params: [
        S('tone', 'Densidad', 'Piedra', 0.8),
        S('grain', 'Grano de piedra', 'Piedra', 0.6),
        S('grainSize', 'Tamaño del grano', 'Piedra', 0.4),
        S('greasy', 'Borde graso', 'Dibujo', 0.4),
        S('tusche', 'Reticulado de tusche', 'Dibujo', 0.25),
        S('veil', 'Velo de plancha', 'Dibujo', 0.15)
      ],
      intensity: ['grain', 'greasy', 'tusche', 'veil'],
      presets: [
        { id: 'lapiz', name: 'Lápiz litográfico', v: { tone: 0.72, grain: 0.75, grainSize: 0.35, greasy: 0.5, tusche: 0.1 } },
        { id: 'tusche', name: 'Tusche', v: { tone: 0.88, grain: 0.35, greasy: 0.3, tusche: 0.65, veil: 0.1 } },
        { id: 'gastada', name: 'Piedra gastada', v: { tone: 0.7, grain: 0.85, grainSize: 0.6, greasy: 0.6, tusche: 0.3, veil: 0.35 } }
      ]
    },
    // ------------------------------------------------------------ XILOGRAFÍA / LINOGRABADO
    {
      id: 'xilografia', group: 'impresion', name: 'Xilografía',
      desc: 'Taco de madera (o linóleo) tallado con gubia: veta donde salta la tinta, marcas de gubia, restos de talla y presión desigual.',
      inks: { max: 1, palettes: [
        { name: 'Capa', c: ['layer'] }, { name: 'Negro', c: ['#151515'] }, { name: 'Rojo', c: ['#b3261e'] }] },
      textures: ['moteado'],
      params: [
        S('wood', 'Veta de madera (0 = linóleo)', 'Madera', 0.55),
        S('woodAng', 'Ángulo de la veta', 'Madera', 0, ANG),
        S('woodSpacing', 'Separación de la veta', 'Madera', 0.4),
        S('gouge', 'Marcas de gubia', 'Talla', 0.4),
        S('chips', 'Restos de talla', 'Talla', 0.25),
        S('rough', 'Irregularidad del borde', 'Talla', 0.3),
        S('pressure', 'Presión irregular', 'Entintado', 0.35),
        S('mottle', 'Tinta moteada', 'Entintado', 0.3)
      ],
      intensity: ['wood', 'gouge', 'chips', 'rough', 'pressure', 'mottle'],
      presets: [
        { id: 'xilo', name: 'Madera', v: { wood: 0.6, gouge: 0.4, chips: 0.25 } },
        { id: 'lino', name: 'Linograbado', v: { wood: 0, gouge: 0.35, chips: 0.15, mottle: 0.45, pressure: 0.3 } },
        { id: 'gastado', name: 'Taco gastado', v: { wood: 0.85, woodSpacing: 0.55, gouge: 0.65, chips: 0.5, rough: 0.5, pressure: 0.6 } }
      ]
    },
    // ------------------------------------------------------------ COPISTERÍA
    {
      id: 'copia', group: 'copia', name: 'Copistería',
      desc: 'Fotocopiadora mala: bandas y franjas desplazadas, rayas del tambor, motas de tóner, negros quemados y pérdida por copia de copia.',
      inks: { max: 1, palettes: [
        { name: 'Tóner', c: ['#121212'] }, { name: 'Capa', c: ['layer'] }, { name: 'Gris', c: ['#3b3b3b'] }] },
      textures: ['moteado', 'piedra'],
      params: [
        S('gen', 'Copia de copia', 'Copia', 0.3),
        S('contrast', 'Negros quemados', 'Copia', 0.6),
        S('toner', 'Tóner irregular', 'Copia', 0.3),
        S('bands', 'Bandas', 'Máquina', 0.35),
        S('spacing', 'Separación de bandas', 'Máquina', 0.3),
        S('shift', 'Franjas desplazadas', 'Máquina', 0.25),
        S('streaks', 'Rayas del tambor', 'Máquina', 0.3),
        S('specks', 'Motas de tóner', 'Suciedad', 0.35),
        S('haze', 'Velo gris', 'Suciedad', 0.08)
      ],
      intensity: ['gen', 'toner', 'bands', 'shift', 'streaks', 'specks', 'haze'],
      presets: [
        { id: 'barata', name: 'Copia barata', v: { gen: 0.2, bands: 0.3, shift: 0.1, streaks: 0.25, specks: 0.3 } },
        { id: 'copiacopia', name: 'Copia de copia', v: { gen: 0.7, contrast: 0.8, toner: 0.45, bands: 0.25, streaks: 0.2, specks: 0.55, haze: 0.15 } },
        { id: 'rota', name: 'Máquina rota', v: { gen: 0.3, bands: 0.85, spacing: 0.22, shift: 0.6, streaks: 0.65, specks: 0.4 } }
      ]
    },
    // ------------------------------------------------------------ HUMEDAD
    {
      id: 'humedad', group: 'gotitas', name: 'Humedad',
      desc: 'Impresión normal sobre la que cae humedad: en algunas zonas la tinta se abre y se corre con borde húmedo; el resto queda nítido.',
      inks: { max: 1, palettes: [
        { name: 'Capa', c: ['layer'] }, { name: 'Negro', c: ['#151515'] }, { name: 'Azul', c: ['#1f3a93'] }] },
      textures: ['acuarela', 'moteado'],
      params: [
        S('wet', 'Zonas húmedas', 'Humedad', 0.5),
        S('zoneSize', 'Tamaño de las manchas', 'Humedad', 0.5),
        S('spread', 'Corrido de la tinta', 'Humedad', 0.5),
        S('ring', 'Borde húmedo (pigmento)', 'Humedad', 0.5),
        S('dissolve', 'Tinta disuelta', 'Humedad', 0.35),
        S('tide', 'Marcas de agua', 'Humedad', 0.25),
        S('print', 'Textura de impresión', 'Impresión', 0.2)
      ],
      intensity: ['wet', 'spread', 'ring', 'dissolve', 'tide'],
      presets: [
        { id: 'leve', name: 'Humedad leve', v: { wet: 0.35, spread: 0.35, ring: 0.4, dissolve: 0.2 } },
        { id: 'mojado', name: 'Papel mojado', v: { wet: 0.55, spread: 0.5, ring: 0.6, dissolve: 0.45, tide: 0.35 } },
        { id: 'mancha', name: 'Mancha de agua', v: { wet: 0.45, zoneSize: 0.8, spread: 0.8, ring: 0.75, dissolve: 0.55, tide: 0.5 } }
      ]
    },
    // ------------------------------------------------------------ GOTEO
    {
      id: 'goteo', group: 'gotitas', name: 'Goteo',
      desc: 'La misma impresión húmeda, pero la tinta gotea hacia abajo con hilos finos y gotas muy pequeñas.',
      inks: { max: 1, palettes: [
        { name: 'Capa', c: ['layer'] }, { name: 'Negro', c: ['#151515'] }, { name: 'Rojo', c: ['#b3261e'] }] },
      textures: ['acuarela', 'moteado'],
      params: [
        S('drips', 'Cantidad de goteo', 'Goteo', 0.5),
        S('length', 'Longitud', 'Goteo', 0.4),
        S('thick', 'Grosor de las gotas', 'Goteo', 0.25),
        S('droplets', 'Gotitas sueltas', 'Goteo', 0.3),
        S('smear', 'Arrastre de tinta', 'Goteo', 0.25),
        S('wet', 'Humedad', 'Humedad', 0.15),
        S('print', 'Textura de impresión', 'Impresión', 0.2)
      ],
      intensity: ['drips', 'length', 'droplets', 'smear', 'wet'],
      presets: [
        { id: 'fino', name: 'Goteo fino', v: { drips: 0.45, length: 0.35, thick: 0.15, droplets: 0.3, smear: 0.15 } },
        { id: 'largo', name: 'Goteo largo', v: { drips: 0.55, length: 0.75, thick: 0.25, droplets: 0.35, smear: 0.3 } },
        { id: 'chorreado', name: 'Chorreado', v: { drips: 0.85, length: 0.55, thick: 0.4, droplets: 0.5, smear: 0.55, wet: 0.3 } }
      ]
    },
    // ------------------------------------------------------------ ACUARELADO
    {
      id: 'acuarela', group: 'acuarela', name: 'Acuarelado',
      desc: 'La forma pintada a la acuarela: aguada con manchas, pigmento acumulado en el borde, granulación, floraciones y frente de agua.',
      inks: { max: 1, palettes: [
        { name: 'Capa', c: ['layer'] }, { name: 'Azul', c: ['#1f4fa3'] }, { name: 'Sepia', c: ['#6b4a32'] }] },
      textures: ['acuarela', 'granulado'],
      params: [
        S('water', 'Agua (expansión)', 'Agua', 0.5),
        S('pool', 'Pigmento en el borde', 'Agua', 0.6),
        S('blooms', 'Floraciones', 'Agua', 0.3),
        S('wash', 'Manchas de aguada', 'Pigmento', 0.5),
        S('granul', 'Granulación', 'Pigmento', 0.5),
        S('transp', 'Transparencia', 'Pigmento', 0.3)
      ],
      intensity: ['water', 'pool', 'blooms', 'wash', 'granul'],
      presets: [
        { id: 'suave', name: 'Suave', v: { water: 0.4, pool: 0.45, wash: 0.4, granul: 0.35, transp: 0.4 } },
        { id: 'cargada', name: 'Cargada', v: { water: 0.55, pool: 0.8, wash: 0.55, granul: 0.6, blooms: 0.4, transp: 0.15 } },
        { id: 'aguada', name: 'Aguada', v: { water: 0.8, pool: 0.55, wash: 0.75, granul: 0.3, blooms: 0.55, transp: 0.5 } }
      ]
    }
  ];

  // parámetros comunes a todas las técnicas (página avanzada, sección "General")
  var COMMON = [
    { k: 'scale', label: 'Tamaño del efecto', def: 1, min: 0.25, max: 3, fmt: 'pct' },
    { k: 'texScale', label: 'Escala de textura', def: 1, min: 0.25, max: 3, fmt: 'pct' },
    { k: 'opacity', label: 'Opacidad', def: 1 }
  ];

  function byId(id) { for (var i = 0; i < TECHNIQUES.length; i++) if (TECHNIQUES[i].id === id) return TECHNIQUES[i]; return null; }
  function defaults(id) {
    var t = byId(id), o = {};
    t.params.forEach(function (d) { o[d.k] = d.def; });
    return o;
  }

  var api = { GROUPS: GROUPS, TECHNIQUES: TECHNIQUES, COMMON: COMMON, SWATCHES: SWATCHES, byId: byId, defaults: defaults };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AFXTech = api;
})(this);
