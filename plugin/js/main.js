/*
 * Analog FX — panel de Photoshop (UXP).
 * Lee la capa activa, genera la vista previa con el motor (engine.js) y al
 * pulsar "Aplicar" crea una copia rasterizada con el efecto, ocultando el original.
 * Fuera de Photoshop (navegador) funciona en modo demo para revisar la interfaz.
 */
(function () {
  'use strict';
  var E = window.AFXEngine, PR = window.AFXPresets, IM = window.AFXImage;

  // ---------------------------------------------------------------- entorno
  var ps = null, uxp = null;
  try {
    if (typeof require === 'function') { ps = require('photoshop'); uxp = require('uxp'); }
  } catch (e) { ps = null; }
  var IN_PS = !!(ps && ps.app);
  var app = IN_PS ? ps.app : null, core = IN_PS ? ps.core : null;
  var imaging = IN_PS ? ps.imaging : null, action = IN_PS ? ps.action : null;
  var constants = IN_PS ? ps.constants : null;

  var PREVIEW_MAX = 520;      // lado máximo de la fuente de la vista previa (px)
  var RESULT_SUFFIX = ' · Analog';

  // ---------------------------------------------------------------- utilidades
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) { var d = document.createElement(tag); if (cls) d.className = cls; if (html != null) d.innerHTML = html; return d; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function merge(base, over) {
    var o = clone(base);
    for (var k in over) {
      if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k])) o[k] = Object.assign(o[k] || {}, over[k]);
      else o[k] = over[k];
    }
    return o;
  }
  function getPath(o, path) { var ks = path.split('.'); for (var i = 0; i < ks.length; i++) o = o[ks[i]]; return o; }
  function setPath(o, path, v) { var ks = path.split('.'); for (var i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = v; }
  function store(k, v) { try { localStorage.setItem('afx.' + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } }
  function load(k, d) { try { var v = localStorage.getItem('afx.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function debounce(fn, ms) { var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); }; }
  function errMsg(e) { return (e && (e.message || e.toString())) || 'Error desconocido'; }

  // ---------------------------------------------------------------- estado
  var state = {
    tech: load('v4.tech', PR.TECHS[0].id), variant: load('v4.variant', null), palette: load('v4.palette', 0),
    intensity: load('v4.intensity', 1), page: 'presets', colorsOpen: false,
    p: null, custom: load('v4.custom', false),
    textures: [], texCache: {},
    src: null,          // { w, h, px, comps, half, layerId, docId, name, isResult }
    showOriginal: false, busy: false, rendering: false, dirty: false
  };
  if (!PR.byId(state.tech)) state.tech = PR.TECHS[0].id;
  var saved = load('v4.params', null);
  function techObj() { return PR.byId(state.tech); }
  function variantObj() { var t = techObj(); return t.variants.filter(function (v) { return v.id === state.variant; })[0] || t.variants[0]; }
  state.p = saved ? merge(E.DEFAULTS, saved) : PR.build(E.DEFAULTS, techObj(), variantObj());
  if (!state.variant) state.variant = variantObj().id;
  var openMods = load('open', { warp: true, erode: true });
  function saveState() {
    store('v4.tech', state.tech); store('v4.variant', state.variant); store('v4.palette', state.palette);
    store('v4.intensity', state.intensity); store('v4.params', state.p); store('v4.custom', state.custom);
  }
  // parámetros efectivos: los del estado escalados por el deslizador de intensidad
  function effParams() {
    var p = clone(state.p), I = state.intensity;
    if (I !== 1) for (var mod in PR.INTENSITY) {
      if (!p[mod]) continue;
      PR.INTENSITY[mod].forEach(function (k) { if (typeof p[mod][k] === 'number') p[mod][k] = Math.max(0, Math.min(1, p[mod][k] * I)); });
    }
    return p;
  }

  // ---------------------------------------------------------------- definición de controles
  function pct(v) { return Math.round(v * 100); }
  function pctS(v) { return Math.round(v * 100) + '%'; }
  function signed(v) { var n = Math.round(v * 100); return n > 0 ? '+' + n : String(n); }
  function dirFmt(v) { var n = Math.round(Math.abs(v) * 100); return v < -0.05 ? 'H ' + n : v > 0.05 ? 'V ' + n : 'Libre'; }
  function degFmt(v) { var n = Math.round(v * 180); return (n > 0 ? '+' : '') + n + '°'; }
  function angFmt(v) { return Math.round((v + 1) * 45) + '°'; }
  function veinFmt(v) { var n = Math.round(Math.abs(v) * 100); return v > 0.05 ? 'H ' + n : v < -0.05 ? 'V ' + n : 'No'; }

  var GLOBAL = [
    { path: 'texScale', label: 'Escala de textura', min: 0.25, max: 3, fmt: pctS },
    { path: 'stretch', label: 'Veta (estirar textura)', min: -1, max: 1, fmt: veinFmt },
    { path: 'effectScale', label: 'Tamaño del efecto', min: 0.25, max: 3, fmt: pctS }
  ];
  var MODULES = [
    { id: 'warp', title: 'Deformación', ctl: [
      { k: 'amount', label: 'Ondulación' }, { k: 'rough', label: 'Rugosidad del borde' }] },
    { id: 'erode', title: 'Desgaste', ctl: [
      { k: 'amount', label: 'Cantidad' }, { k: 'distrib', label: 'Concentración' }, { k: 'contrast', label: 'Dureza del corte' }] },
    { id: 'cracks', title: 'Rayas y grietas', ctl: [{ k: 'amount', label: 'Cantidad' }] },
    { id: 'bleed', title: 'Tinta corrida · borde húmedo', ctl: [
      { k: 'amount', label: 'Cantidad' }, { k: 'dir', label: 'Dirección', min: -1, max: 1, fmt: dirFmt },
      { sep: 'Borde húmedo' },
      { k: 'wet', label: 'Borde húmedo (agua)' }, { k: 'pool', label: 'Pigmento atrapado en el borde' },
      { k: 'halo', label: 'Opacidad del halo' },
      { sep: 'Color del borde húmedo' },
      { k: 'hue', label: 'Tono', min: -1, max: 1, fmt: degFmt },
      { k: 'sat', label: 'Saturación', min: -1, max: 1, fmt: signed },
      { k: 'light', label: 'Luminosidad (dilución)', min: -1, max: 1, fmt: signed },
      { sep: 'Zonas mojadas (humedad)' },
      { k: 'zones', label: 'Zonas mojadas (0 = todo)' }, { k: 'zoneSize', label: 'Tamaño de las manchas' },
      { k: 'dissolve', label: 'Tinta lavada en el centro' }, { k: 'tide', label: 'Marca del agua' }] },
    { id: 'drips', title: 'Goteo', ctl: [
      { k: 'length', label: 'Longitud' }, { k: 'amount', label: 'Arrastre' }, { k: 'up', label: 'Hacia arriba' },
      { k: 'drops', label: 'Gotas con bulbo' }, { k: 'thick', label: 'Grosor de las gotas' }] },
    { id: 'splat', title: 'Salpicaduras', ctl: [
      { k: 'amount', label: 'Manchas' }, { k: 'drops', label: 'Gotas redondas' },
      { k: 'spread', label: 'Alcance' }, { k: 'size', label: 'Tamaño' }] },
    { id: 'ink', title: 'Tinta y grano', ctl: [
      { k: 'pressure', label: 'Presión irregular' }, { k: 'grain', label: 'Grano' },
      { k: 'fade', label: 'Esténcil gastado (pierde fuerza)' }, { k: 'roller', label: 'Marcas del rodillo' }] },
    { id: 'paper', title: 'Papel', ctl: [
      { k: 'feather', label: 'Tinta en las fibras' }, { k: 'relief', label: 'Relieve del papel' },
      { k: 'tooth', label: 'Valles sin tinta' }, { k: 'paperScale', label: 'Tamaño del grano' }] },
    { id: 'tintas', title: 'Tintas y trama', ctl: [
      { k: 'count', label: 'Número de tintas', min: 1, max: 3, fmt: function (v) { return String(Math.round(v)); }, plain: true, step: 1 },
      { k: 'd2', label: 'Densidad de las otras tintas' }, { k: 'tone', label: 'Densidad general' },
      { sep: 'Trama de semitono' },
      { k: 'lpi', label: 'Lineatura (líneas por pulgada)', min: 0, max: 150, step: 1, plain: true, fmt: function (v) { return v > 0 ? Math.round(v) + ' lpp' : 'Auto'; } },
      { k: 'toneVar', label: 'Variación del tono' },
      { k: 'screen', label: 'Trama' }, { k: 'cell', label: 'Tamaño del punto' }, { k: 'gain', label: 'Ganancia de punto' },
      { k: 'donut', label: 'Puntos donut (flexo)' }, { k: 'slur', label: 'Corrido del punto (slur)' },
      { k: 'double', label: 'Doble impresión del punto' }, { k: 'hickeys', label: 'Motas de suciedad (hickeys)' },
      { sep: 'Registro' },
      { k: 'misreg', label: 'Desregistro' }, { k: 'misAng', label: 'Dirección', min: -1, max: 1, fmt: degFmt }] },
    { id: 'press', title: 'Prensa · relieve', ctl: [
      { k: 'squeeze', label: 'Tinta acumulada en el borde' }, { k: 'halo', label: 'Halo aplastado' },
      { k: 'starve', label: 'Poca tinta en macizos' }, { k: 'deboss', label: 'Hundimiento en el papel' }] },
    { id: 'mesh', title: 'Malla de serigrafía', ctl: [
      { k: 'sawtooth', label: 'Dentado de la malla' }, { k: 'mesh', label: 'Malla visible' }, { k: 'voids', label: 'Huecos' },
      { k: 'ridge', label: 'Cresta de la rasqueta' }] },
    { id: 'wood', title: 'Madera', ctl: [
      { k: 'grain', label: 'Veta' }, { k: 'angle', label: 'Ángulo de la veta', min: -1, max: 1, fmt: degFmt },
      { k: 'spacing', label: 'Separación de la veta' }, { k: 'chips', label: 'Restos de talla' }] },
    { id: 'stone', title: 'Piedra litográfica', ctl: [
      { k: 'amount', label: 'Grano de piedra' }, { k: 'size', label: 'Tamaño del grano' }, { k: 'tone', label: 'Densidad' },
      { k: 'greasy', label: 'Borde graso' }, { k: 'veil', label: 'Velo de plancha' }] },
    { id: 'seep', title: 'Tinta corrida (fibras)', ctl: [
      { k: 'amount', label: 'Tramos donde se corre' }, { k: 'reach', label: 'Hasta dónde llega' },
      { k: 'density', label: 'Densidad de la tinta corrida' }, { k: 'front', label: 'Línea del frente' }] },
    { id: 'wick', title: 'Tinta corrida (capilaridad)', ctl: [
      { k: 'amount', label: 'Tramos donde se corre' }, { k: 'reach', label: 'Hasta dónde llega' },
      { k: 'front', label: 'Frente cargado (borde húmedo)' }, { k: 'drag', label: 'Largo del arrastre (a un lado)' },
      { k: 'dir', label: 'Dirección del arrastre', min: -1, max: 1, fmt: function (v) { return Math.round(v * 180) + '°'; } }] },
    { id: 'engrave', title: 'Talla (xilografía)', ctl: [
      { k: 'spacing', label: 'Separación de las líneas' }, { k: 'width', label: 'Grosor de las líneas' },
      { k: 'length', label: 'Cuánto entran en la letra' }, { k: 'skip', label: 'Líneas que faltan' },
      { k: 'wobble', label: 'Pulso de la mano' }, { k: 'light', label: 'Lado de la luz (rayado horizontal)', min: -1, max: 1, fmt: function (v) { return v >= 0 ? 'Derecha' : 'Izquierda'; } },
      { k: 'lightAng', label: 'Dirección de la luz', min: -1, max: 1, fmt: function (v) { return Math.round(v * 180) + '°'; } },
      { k: 'shadow', label: 'Sombra negra' }, { k: 'misreg', label: 'Desregistro del color' }] },
    { id: 'stamp', title: 'Sello de goma', ctl: [
      { k: 'tilt', label: 'Inclinación (presión desigual)' }, { k: 'uneven', label: 'Irregularidad' },
      { k: 'edge', label: 'Tinta cargada en el borde' }, { k: 'letterVar', label: 'Diferencia entre letras' },
      { k: 'periph', label: 'Marca del canto del sello' }] },
    { id: 'letters', title: 'Variación entre letras', ctl: [
      { k: 'density', label: 'Carga de tinta' }, { k: 'tone', label: 'Tono' }] },
    { id: 'damp', title: 'Humedad (gotas de agua)', ctl: [
      { k: 'amount', label: 'Zona mojada' }, { k: 'size', label: 'Tamaño de las gotas' }, { k: 'spread', label: 'Cuánto se abre la tinta' },
      { k: 'cloud', label: 'Tinta disuelta en el papel' }, { k: 'lift', label: 'Tinta lavada en la letra' }, { k: 'tide', label: 'Marca del borde del agua' },
      { k: 'cockle', label: 'Papel abombado' }] },
    { id: 'gouge', title: 'Gubia (xilografía)', ctl: [
      { k: 'edge', label: 'Cortes desde el borde' }, { k: 'inner', label: 'Cortes interiores' },
      { k: 'length', label: 'Largo del corte' }, { k: 'width', label: 'Ancho de la cuña' }, { k: 'spacing', label: 'Separación' },
      { k: 'zone', label: 'Tamaño de las zonas' }, { k: 'chaos', label: 'Variedad de direcciones' },
      { k: 'angle', label: 'Dirección interior', min: -1, max: 1, fmt: degFmt }] },
    { id: 'rim', title: 'Pigmento en el borde', ctl: [
      { k: 'amount', label: 'Cantidad' }, { k: 'width', label: 'Ancho' }, { k: 'coverage', label: 'Tramos con pigmento' }] },
    { id: 'stencil', title: 'Esténcil (mimeógrafo)', ctl: [
      { k: 'fiber', label: 'Fibra del esténcil' }, { k: 'density', label: 'Desigualdad de tinta' },
      { k: 'spread', label: 'Tinta que se abre' }, { k: 'setoff', label: 'Repinte' }, { k: 'oil', label: 'Halo de aceite' }, { k: 'starve', label: 'Zonas con poca tinta' }] },
    { id: 'copy', title: 'Fotocopia', ctl: [
      { k: 'gen', label: 'Copia de copia' }, { k: 'dropout', label: 'Huecos de tóner' }, { k: 'toner', label: 'Motas de tóner' },
      { k: 'streaks', label: 'Rayas del tambor' }, { k: 'haze', label: 'Velo gris' }, { k: 'slur', label: 'Tóner arrastrado' }] },
    { id: 'drip', title: 'Goteo desde las letras', ctl: [
      { k: 'amount', label: 'Cantidad de gotas' }, { k: 'length', label: 'Longitud' }, { k: 'thick', label: 'Grosor' },
      { k: 'sag', label: 'Tinta acumulada en la base' }, { k: 'beads', label: 'Gotitas que se desprenden' }, { k: 'dark', label: 'Pigmento en la gota' }, { k: 'absorb', label: 'Papel absorbente (se infiltra)' }, { k: 'runs', label: 'Agua que cae encima (se come el pigmento)' }] },
    { id: 'aqua', title: 'Acuarela', ctl: [
      { k: 'density', label: 'Densidad del pigmento' }, { k: 'variation', label: 'Manchas del lavado' },
      { k: 'rim', label: 'Aro oscuro del borde' }, { k: 'rimWidth', label: 'Ancho del aro' },
      { k: 'granul', label: 'Granulación' }, { k: 'blooms', label: 'Floraciones' }, { k: 'edgeWobble', label: 'Borde ondulado' },
      { k: 'drift', label: 'Pigmento que se va a un lado' }, { k: 'letterVar', label: 'Diferencia entre letras' },
      { k: 'dry', label: 'Pincel seco' }] },
    { id: 'wash', title: 'Aguada (litografía)', ctl: [
      { k: 'wash', label: 'Manchas de aguada' }, { k: 'granul', label: 'Granulación' }, { k: 'blooms', label: 'Floraciones' },
      { k: 'transp', label: 'Transparencia' }] },
    { id: 'print', title: 'Impresión · fotocopia', ctl: [
      { sep: 'Bandas de impresora' },
      { k: 'bands', label: 'Bandas' }, { k: 'spacing', label: 'Separación' }, { k: 'width', label: 'Grosor' },
      { k: 'dir', label: 'Ángulo', min: -1, max: 1, fmt: angFmt, plain: true }, { k: 'shift', label: 'Desplazamiento de franjas' },
      { k: 'streaks', label: 'Rayas de tóner / cabezal' }, { k: 'regular', label: 'Líneas regulares (boquillas)' },
      { sep: 'Trama' },
      { k: 'halftone', label: 'Semitono' }, { k: 'dot', label: 'Tamaño del punto' },
      { sep: 'Doble impresión' },
      { k: 'ghost', label: 'Fantasma (desregistro)' }, { k: 'ghostOff', label: 'Desplazamiento' },
      { k: 'ghostHue', label: 'Tono del fantasma', min: -1, max: 1, fmt: degFmt }] },
    { id: 'color', title: 'Color y tono', ctl: [
      { k: 'hue', label: 'Tono', min: -1, max: 1, fmt: degFmt },
      { k: 'sat', label: 'Saturación', min: -1, max: 1, fmt: signed },
      { k: 'light', label: 'Luminosidad', min: -1, max: 1, fmt: signed },
      { sep: 'Variación del pigmento' },
      { k: 'hueVar', label: 'Variación de tono' }, { k: 'satVar', label: 'Variación de saturación' },
      { k: 'lightVar', label: 'Variación de densidad' },
      { k: 'edge', label: 'Acumulación en bordes' }] }
  ];
  var OUT = [
    { path: 'out.hard', label: 'Dureza (impresión)' },
    { path: 'out.opacity', label: 'Opacidad' }
  ];
  var COLORS = [
    { id: 'original', label: 'Original', sw: null },
    { id: '#141414', label: 'Negro', sw: '#141414' },
    { id: '#f4f1ea', label: 'Blanco', sw: '#f4f1ea' },
    { id: '#c8352b', label: 'Rojo', sw: '#c8352b' },
    { id: '#1f4fa3', label: 'Azul', sw: '#1f4fa3' },
    { id: '#5a3b28', label: 'Sepia', sw: '#5a3b28' },
    { id: '#e8458b', label: 'Rosa riso', sw: '#e8458b' }
  ];
  var SWATCHES = ['#151515', '#3b3b3b', '#f4f1ea', '#5a3b28', '#b08d57', '#7d7468', '#e23c3c', '#f15060', '#ff48b0',
    '#ff6c2f', '#f5c400', '#ffe800', '#00a95c', '#00838a', '#0078bf', '#1f3a93', '#765ba7', '#48a9c5'];
  var BLENDS = [
    { id: 'auto', label: 'Auto' }, { id: 'multiply', label: 'Multiplicar' }, { id: 'normal', label: 'Normal' }
  ];

  var sliders = [];   // { path, def, update() }

  // ---------------------------------------------------------------- deslizador propio (negro/verde)
  function makeSlider(def) {
    var min = def.min != null ? def.min : 0, max = def.max != null ? def.max : 1, fmt = def.fmt || pct;
    var root = el('div', 'ctl');
    var head = el('div', 'ctl-head');
    var lab = el('div', 'ctl-label', def.label);
    var val = el('div', 'ctl-val');
    val.title = 'Doble clic: valor por defecto';
    head.appendChild(lab); head.appendChild(val);
    var track = el('div', 'track');
    var rail = el('div', 'rail'), fill = el('div', 'fill'), dot = el('div', 'thumb-dot');
    track.appendChild(rail); track.appendChild(fill); track.appendChild(dot);
    root.appendChild(head); root.appendChild(track);

    function update() {
      var v = def.get ? def.get() : getPath(state.p, def.path);
      var t = (v - min) / (max - min); t = t < 0 ? 0 : t > 1 ? 1 : t;
      var zero = min < 0 && !def.plain ? (0 - min) / (max - min) : 0;
      var a = Math.min(zero, t), b = Math.max(zero, t);
      fill.style.left = (a * 100) + '%';
      fill.style.width = ((b - a) * 100) + '%';
      dot.style.left = (t * 100) + '%';
      val.textContent = fmt(v);
    }
    function setFromX(clientX, final) {
      var r = track.getBoundingClientRect();
      var t = r.width > 0 ? (clientX - r.left) / r.width : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      var v = min + t * (max - min);
      v = def.step ? Math.round(v / def.step) * def.step : Math.round(v * 100) / 100;
      if (min < 0 && !def.plain && Math.abs(v) < 0.04) v = 0; // imán al centro
      if (def.set) def.set(v); else { setPath(state.p, def.path, v); markCustom(); }
      update();
      onParamChange(!final);
    }
    var dragging = false;
    function move(e) { if (dragging) setFromX(e.clientX, false); }
    function up(e) {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('pointermove', move); document.removeEventListener('mousemove', move);
      document.removeEventListener('pointerup', up); document.removeEventListener('mouseup', up);
      if (e && e.clientX != null) setFromX(e.clientX, true); else onParamChange(false);
    }
    function down(e) {
      if (dragging) return;
      dragging = true;
      document.addEventListener('pointermove', move); document.addEventListener('mousemove', move);
      document.addEventListener('pointerup', up); document.addEventListener('mouseup', up);
      try { if (e.pointerId != null && track.setPointerCapture) track.setPointerCapture(e.pointerId); } catch (err) { /* opcional */ }
      setFromX(e.clientX, false);
      if (e.preventDefault) e.preventDefault();
    }
    track.addEventListener('pointerdown', down);
    track.addEventListener('mousedown', down);
    val.addEventListener('dblclick', function () {
      if (def.reset) def.reset(); else { setPath(state.p, def.path, getPath(E.DEFAULTS, def.path)); markCustom(); }
      update(); onParamChange(false);
    });
    var s = { path: def.path, update: update };
    sliders.push(s);
    update();
    return root;
  }

  // ---------------------------------------------------------------- construcción de la interfaz
  function buildUI() {
    // página 1: técnicas agrupadas
    var list = $('techList');
    PR.GROUPS.forEach(function (g) {
      var techs = PR.TECHS.filter(function (t) { return t.group === g.id; });
      if (!techs.length) return;
      list.appendChild(el('div', 'group-label', g.name));
      var grid = el('div', 'tech-grid');
      techs.forEach(function (t) {
        var card = el('div', 'tcard');
        card.setAttribute('data-tech', t.id);
        var img = el('img'); img.src = 'thumbs/' + t.id + '.jpg';
        card.appendChild(img); card.appendChild(el('div', 'tname', t.name));
        card.addEventListener('click', function () { selectTech(t.id); });
        grid.appendChild(card);
      });
      list.appendChild(grid);
    });
    $('intensityCtl').appendChild(makeSlider({
      label: 'Intensidad del efecto', min: 0, max: 2, fmt: pctS,
      get: function () { return state.intensity; }, set: function (v) { state.intensity = v; }, reset: function () { state.intensity = 1; }
    }));
    $('intensityCtl2').appendChild(makeSlider({
      label: 'Intensidad del efecto', min: 0, max: 2, fmt: pctS,
      get: function () { return state.intensity; }, set: function (v) { state.intensity = v; }, reset: function () { state.intensity = 1; }
    }));
    $('btnDetails').addEventListener('click', function () { showPage('details'); });
    $('btnBack').addEventListener('click', function () { showPage('presets'); });
    // controles globales
    var g = $('globalCtrls');
    GLOBAL.forEach(function (d) { g.appendChild(makeSlider(d)); });
    // módulos
    var mods = $('modules');
    MODULES.forEach(function (m) {
      var box = el('div', 'mod');
      box.setAttribute('data-mod', m.id);
      var head = el('div', 'mod-head');
      var sw = el('div', 'switch', '<div class="knob"></div>');
      var title = el('div', 'mod-title', m.title);
      var chev = el('div', 'chev', '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>');
      head.appendChild(sw); head.appendChild(title); head.appendChild(chev);
      var body = el('div', 'mod-body');
      m.ctl.forEach(function (c) {
        if (c.sep) { body.appendChild(el('div', 'ctl-sep', c.sep)); return; }
        body.appendChild(makeSlider({ path: m.id + '.' + c.k, label: c.label, min: c.min, max: c.max, fmt: c.fmt, plain: c.plain }));
      });
      box.appendChild(head); box.appendChild(body);
      sw.addEventListener('click', function (e) {
        e.stopPropagation();
        state.p[m.id].on = !state.p[m.id].on; markCustom();
        if (state.p[m.id].on && !openMods[m.id]) { openMods[m.id] = true; store('open', openMods); }
        syncModules(); onParamChange(false);
      });
      head.addEventListener('click', function () {
        openMods[m.id] = !openMods[m.id]; store('open', openMods); syncModules();
      });
      mods.appendChild(box);
    });
    // salida
    var o = $('outCtrls');
    OUT.forEach(function (d) { o.appendChild(makeSlider(d)); });
    var cc = $('colorChips');
    COLORS.forEach(function (c) {
      var chip = el('div', 'chip', (c.sw ? '<span class="sw" style="background:' + c.sw + '"></span>' : '') + c.label);
      chip.setAttribute('data-color', c.id);
      chip.addEventListener('click', function () { state.p.out.color = c.id; markCustom(); syncAll(); onParamChange(false); });
      cc.appendChild(chip);
    });
    var bc = $('blendChips');
    BLENDS.forEach(function (b) {
      var chip = el('div', 'chip', b.label);
      chip.setAttribute('data-blend', b.id);
      chip.addEventListener('click', function () { state.p.out.blend = b.id; syncAll(); onParamChange(false); });
      bc.appendChild(chip);
    });
    // acciones
    $('btnApply').addEventListener('click', applyEffect);
    $('btnSeed').addEventListener('click', function () {
      state.p.seed = 1 + Math.floor(Math.random() * 99999); syncAll(); onParamChange(false);
    });
    $('btnReset').addEventListener('click', function () { if (state.mode === 'img') { stI.over = {}; stI.paper = null; imgChanged(); } else applyVariant(state.variant); });
    // comparar (mantener pulsado)
    var cmp = $('compareBtn');
    function cmpOn(e) { state.showOriginal = true; cmp.className = 'pill active'; renderPreview(false); if (e.preventDefault) e.preventDefault(); }
    function cmpOff() { if (!state.showOriginal) return; state.showOriginal = false; cmp.className = 'pill'; renderPreview(false); }
    cmp.addEventListener('pointerdown', cmpOn); cmp.addEventListener('mousedown', cmpOn);
    document.addEventListener('pointerup', cmpOff); document.addEventListener('mouseup', cmpOff);
    cmp.addEventListener('mouseleave', cmpOff);
  }

  function buildThumbs() {
    var t = $('thumbs');
    t.innerHTML = '';
    state.textures.filter(function (tx) { return tx.family === 'desgaste'; }).forEach(function (tx) {
      var d = el('div', 'thumb');
      d.setAttribute('data-tex', tx.id);
      var img = el('img');
      img.src = 'textures/thumbs/' + tx.id + '.jpg';
      d.appendChild(img);
      d.appendChild(el('div', 'tl', tx.label));
      d.addEventListener('click', function () { state.p.texture = tx.id; markCustom(); syncAll(); onParamChange(false); });
      t.appendChild(d);
    });
  }

  function syncModules() {
    var boxes = document.querySelectorAll('.mod');
    for (var i = 0; i < boxes.length; i++) {
      var id = boxes[i].getAttribute('data-mod'), on = state.p[id].on;
      boxes[i].className = 'mod' + (on ? '' : ' off') + (openMods[id] ? ' open' : '');
      boxes[i].querySelector('.switch').className = 'switch' + (on ? ' on' : '');
    }
  }
  function syncAll() {
    sliders.forEach(function (s) { s.update(); });
    syncModules();
    syncPresetsPage();
    var th = document.querySelectorAll('.thumb');
    for (var j = 0; j < th.length; j++) th[j].className = 'thumb' + (th[j].getAttribute('data-tex') === state.p.texture ? ' active' : '');
    var cc = document.querySelectorAll('#colorChips .chip');
    for (var k = 0; k < cc.length; k++) cc[k].className = 'chip' + (cc[k].getAttribute('data-color') === (state.p.out.color || 'original') ? ' active' : '');
    var bcs = document.querySelectorAll('#blendChips .chip');
    for (var b = 0; b < bcs.length; b++) bcs[b].className = 'chip' + (bcs[b].getAttribute('data-blend') === (state.p.out.blend || 'auto') ? ' active' : '');
    $('seedLabel').textContent = 'Semilla ' + state.p.seed;
  }

  // ---------------------------------------------------------------- página 1: técnica, variante, color
  function markCustom() { if (!state.custom) { state.custom = true; refreshVariantChips(); } }
  function applyPalette() {
    var t = techObj(), pl = t.palettes[state.palette];
    if (!pl) return;
    state.p.out.color = pl.ink;
    if (pl.c2) state.p.tintas.c2 = pl.c2;
    if (pl.c3) state.p.tintas.c3 = pl.c3;
  }
  function applyVariant(id) {
    var t = techObj(), v = t.variants.filter(function (x) { return x.id === id; })[0] || t.variants[0];
    var keep = { seed: state.p.seed, blend: state.p.out.blend, effectScale: state.p.effectScale, color: state.p.out.color, c2: state.p.tintas.c2, c3: state.p.tintas.c3 };
    state.p = PR.build(E.DEFAULTS, t, v);
    state.p.seed = keep.seed; state.p.out.blend = keep.blend || 'auto'; state.p.effectScale = keep.effectScale;
    if (state.palette >= 0) applyPalette(); else { state.p.out.color = keep.color; state.p.tintas.c2 = keep.c2; state.p.tintas.c3 = keep.c3; }
    state.variant = v.id; state.custom = false;
    syncAll(); onParamChange(false);
  }
  function selectTech(id) {
    state.tech = id; state.palette = 0; state.colorsOpen = false;
    applyVariant(techObj().variants[0].id);
  }
  function inkCount() { return state.p.tintas && state.p.tintas.on ? Math.max(1, Math.min(3, state.p.tintas.count | 0)) : 1; }
  function refreshVariantChips() {
    var box = $('variantChips'); if (!box) return;
    box.innerHTML = '';
    techObj().variants.forEach(function (v) {
      var c = el('div', 'chip' + (!state.custom && v.id === state.variant ? ' active' : ''), v.name);
      c.addEventListener('click', function () { applyVariant(v.id); });
      box.appendChild(c);
    });
    if (state.custom) box.appendChild(el('div', 'chip active ghost', 'Personalizado'));
  }
  function swatchHtml(hx) { return hx === 'original' ? '<span class="sw sw-layer"></span>' : '<span class="sw" style="background:' + hx + '"></span>'; }
  function syncPresetsPage() {
    var t = techObj();
    var cards = document.querySelectorAll('.tcard');
    for (var i = 0; i < cards.length; i++) cards[i].className = 'tcard' + (cards[i].getAttribute('data-tech') === t.id ? ' active' : '');
    $('techName').textContent = t.name; $('techDesc').textContent = t.desc; $('advTitle').textContent = t.name;
    refreshVariantChips();
    var pc = $('paletteChips'); pc.innerHTML = '';
    var n = inkCount();
    t.palettes.forEach(function (pl, k) {
      var cols = [pl.ink, pl.c2, pl.c3].slice(0, n).filter(Boolean);
      var c = el('div', 'chip' + (state.palette === k ? ' active' : ''), cols.map(swatchHtml).join('') + pl.name);
      c.addEventListener('click', function () { state.palette = k; applyPalette(); syncAll(); onParamChange(false); });
      pc.appendChild(c);
    });
    var pick = el('div', 'chip' + (state.colorsOpen ? ' active' : ''), (state.colorsOpen ? '▾ ' : '▸ ') + 'Elegir color');
    pick.addEventListener('click', function () { state.colorsOpen = !state.colorsOpen; syncPresetsPage(); });
    pc.appendChild(pick);
    buildInkEditor();
  }
  // editor de tintas desplegable (tinta 1 = color de salida, 2 y 3 = tintas adicionales)
  function buildInkEditor() {
    var box = $('inkEditor'); box.innerHTML = '';
    box.style.display = state.colorsOpen ? 'block' : 'none';
    if (!state.colorsOpen) return;
    for (var idx = 0; idx < inkCount(); idx++) (function (k) {
      var cur = k === 0 ? (state.p.out.color || 'original') : state.p.tintas[k === 1 ? 'c2' : 'c3'];
      var row = el('div', 'ink-row'), head = el('div', 'ink-head');
      head.appendChild(el('div', 'ink-label', 'Tinta ' + (k + 1)));
      var big = el('div', 'ink-swatch' + (cur === 'original' ? ' sw-layer' : ''));
      if (cur !== 'original') big.style.background = cur;
      big.title = 'Abrir selector de color';
      big.addEventListener('click', function () { pickColor(cur === 'original' ? '#151515' : cur).then(function (hx) { if (hx) setInk(k, hx); }); });
      head.appendChild(big);
      var inp = el('input', 'text-in hex'); inp.type = 'text'; inp.value = cur === 'original' ? 'capa' : cur;
      function commit() { var v = String(inp.value).trim(); if (/^#?[0-9a-f]{6}$/i.test(v)) setInk(k, (v[0] === '#' ? v : '#' + v).toLowerCase()); }
      inp.addEventListener('change', commit);
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') commit(); });
      head.appendChild(inp);
      if (k === 0) {
        var lc = el('div', 'chip mini' + (cur === 'original' ? ' active' : ''), 'Color de la capa');
        lc.addEventListener('click', function () { setInk(0, 'original'); });
        head.appendChild(lc);
      }
      row.appendChild(head);
      var sws = el('div', 'swatches');
      SWATCHES.forEach(function (hx) {
        var d = el('div', 'swatch' + (hx === cur ? ' active' : '')); d.style.background = hx; d.title = hx;
        d.addEventListener('click', function () { setInk(k, hx); });
        sws.appendChild(d);
      });
      row.appendChild(sws);
      box.appendChild(row);
    })(idx);
  }
  function setInk(k, hx) {
    if (k === 0) state.p.out.color = hx; else state.p.tintas[k === 1 ? 'c2' : 'c3'] = hx;
    state.palette = -1;
    syncAll(); onParamChange(false);
  }
  function pickColor(hex) {
    if (IN_PS) {
      var rgb = E.hexToRgb(hex);
      return core.executeAsModal(function () {
        return action.batchPlay([{ _obj: 'showColorPicker', context: 'Analog FX', color: { _obj: 'RGBColor', red: rgb[0], grain: rgb[1], blue: rgb[2] } }], {});
      }, { commandName: 'Elegir color' }).then(function (res) {
        var d = res && res[0], col = d && (d.RGBFloatColor || d.color || d.RGBColor);
        if (!col || col.red == null) return null;
        var hx = '#' + [col.red, col.grain != null ? col.grain : col.green, col.blue].map(function (v) { var q = Math.round(Math.max(0, Math.min(255, v))).toString(16); return q.length < 2 ? '0' + q : q; }).join('');
        return hx;
      }).catch(function () { setStatus('Selector no disponible: escribe el color en hexadecimal', 'err'); return null; });
    }
    return new Promise(function (resolve) { var nc = $('nativeColor'); nc.value = hex; nc.onchange = function () { resolve(nc.value); }; nc.click(); });
  }
  function showPage(pg) {
    state.page = pg;
    if (state.mode === 'img') return;
    $('pagePresets').className = 'col page' + (pg === 'presets' ? '' : ' hidden');
    $('pageDetails').className = 'page' + (pg === 'details' ? '' : ' hidden');
    sliders.forEach(function (sl) { sl.update(); });
    if (pg === 'presets') syncPresetsPage();
    try { $('scroll').scrollTop = 0; } catch (e) { /* */ }
  }

  // ================================================================ MODO IMÁGENES
  var stI = {
    tech: load('img.tech', 'xerox'), variant: load('img.variant', null), palette: load('img.palette', 0),
    paper: load('img.paper', null), intensity: load('img.intensity', 1), over: load('img.over', {}), advOpen: false
  };
  state.mode = load('mode', 'text');
  function imTech() { return IM.byId(stI.tech); }
  function imVariant() { var t = imTech(); return t.variants.filter(function (v) { return v.id === stI.variant; })[0] || t.variants[0]; }
  function saveImg() {
    store('img.tech', stI.tech); store('img.variant', stI.variant); store('img.palette', stI.palette);
    store('img.paper', stI.paper); store('img.intensity', stI.intensity); store('img.over', stI.over); store('mode', state.mode);
  }
  function imgBase() {
    var t = imTech(), p = IM.build(t, imVariant(), stI.palette);
    for (var k in stI.over) p[k] = stI.over[k];
    if (stI.paper) p.paper = stI.paper;
    return p;
  }
  function imgParams() {
    var p = imgBase(), I = stI.intensity;
    IM.applyIntensity(p, I);
    p.seed = state.p.seed || 1;
    return p;
  }
  var PAPER_OPTS = [{ v: 'ink', label: 'Solo tinta' }, { v: 'white', label: 'Papel blanco' }, { v: 'cream', label: 'Papel crema' }, { v: 'news', label: 'Periódico' }];
  function buildImageUI() {
    var list = $('imgTechList');
    IM.TECHS.forEach(function (t) {
      var card = el('div', 'tcard'); card.setAttribute('data-itech', t.id);
      var img = el('img'); img.src = 'thumbs/img_' + t.id + '.jpg';
      card.appendChild(img); card.appendChild(el('div', 'tname', t.name));
      card.addEventListener('click', function () { stI.tech = t.id; stI.variant = null; stI.palette = 0; stI.over = {}; stI.paper = null; imgChanged(); });
      list.appendChild(card);
    });
    $('imgIntensityCtl').appendChild(makeSlider({
      label: 'Intensidad del efecto', min: 0, max: 2, fmt: pctS,
      get: function () { return stI.intensity; }, set: function (v) { stI.intensity = v; }, reset: function () { stI.intensity = 1; }
    }));
    $('btnImgAdv').addEventListener('click', function () { stI.advOpen = !stI.advOpen; syncImagePage(); });
  }
  function syncImagePage() {
    var t = imTech(), v = imVariant(), base = imgBase();
    var cards = document.querySelectorAll('[data-itech]');
    for (var i = 0; i < cards.length; i++) cards[i].className = 'tcard' + (cards[i].getAttribute('data-itech') === t.id ? ' active' : '');
    $('imgTechName').textContent = t.name; $('imgTechDesc').textContent = t.desc;
    chipRow($('imgVariantChips'), t.variants.map(function (x) { return { id: x.id, label: x.name }; }), function (o) { return o.id === v.id; },
      function (o) { stI.variant = o.id; stI.over = {}; stI.paper = null; imgChanged(); });
    chipRow($('imgPaletteChips'), t.palettes.map(function (pl, k) {
      var sw = pl.inks.length ? pl.inks.map(function (h) { return '<span class="sw" style="background:' + h + '"></span>'; }).join('') : '';
      return { k: k, html: sw + pl.name };
    }), function (o) { return o.k === stI.palette; }, function (o) { stI.palette = o.k; imgChanged(); });
    chipRow($('imgPaperChips'), PAPER_OPTS, function (o) { return base.paper === o.v; }, function (o) { stI.paper = o.v; imgChanged(); });
    $('imgAdvArrow').textContent = stI.advOpen ? '▾' : '›';
    var adv = $('imgAdv'); adv.className = stI.advOpen ? '' : 'hidden'; adv.innerHTML = '';
    if (stI.advOpen) t.keys.forEach(function (k) {
      var d = IM.PARAMS[k]; if (!d) return;
      adv.appendChild(makeSlider({
        label: d.label, min: d.min == null ? 0 : d.min, max: d.max == null ? 1 : d.max, step: d.step, plain: !!d.int,
        fmt: d.int ? function (x) { return String(Math.round(x)); } : (d.min < 0 ? signed : pct),
        get: function () { var b = imgBase(); return b[k] == null ? 0 : b[k]; },
        set: function (x) { stI.over[k] = x; }, reset: function () { delete stI.over[k]; }
      }));
    });
    var cmpR = $('btnReset'); if (cmpR) cmpR.title = 'Restablecer la variante';
  }
  function imgChanged() { saveImg(); syncImagePage(); schedulePreview(false); }
  function chipRow(box, opts, isOn, onPick) {
    box.innerHTML = '';
    opts.forEach(function (o) {
      var c = el('div', 'chip' + (isOn(o) ? ' active' : ''), o.html || o.label);
      c.addEventListener('click', function () { onPick(o); });
      box.appendChild(c);
    });
  }
  function setMode(m) {
    state.mode = m; saveImg();
    $('tabText').className = 'mtab' + (m === 'text' ? ' active' : '');
    $('tabImg').className = 'mtab' + (m === 'img' ? ' active' : '');
    if (m === 'img') {
      $('pagePresets').className = 'col page hidden'; $('pageDetails').className = 'page hidden';
      $('pageImage').className = 'col page'; syncImagePage();
    } else { $('pageImage').className = 'col page hidden'; showPage(state.page || 'presets'); }
    if (!IN_PS) demoSource(); else refreshSource();
  }

  function onParamChange(fast) {
    if (!fast) { saveState(); if (state.mode === 'img') saveImg(); }
    schedulePreview(fast);
  }

  function setStatus(msg, kind) {
    var s = $('status');
    s.textContent = msg || '';
    s.className = 'status' + (kind ? ' ' + kind : '');
  }

  // ---------------------------------------------------------------- texturas
  function readPluginFile(rel, binary) {
    if (IN_PS) {
      var fs = uxp.storage.localFileSystem;
      return fs.getPluginFolder().then(function (folder) { return folder.getEntry(rel); })
        .then(function (f) { return f.read({ format: binary ? uxp.storage.formats.binary : uxp.storage.formats.utf8 }); });
    }
    return fetch(rel).then(function (r) { return binary ? r.arrayBuffer() : r.text(); });
  }
  var texLoading = {};
  function getTexture(id) {
    if (state.texCache[id]) return Promise.resolve(state.texCache[id]);
    if (texLoading[id]) return texLoading[id];
    var meta = state.textures.filter(function (t) { return t.id === id; })[0] || state.textures[0];
    if (!meta) return Promise.reject(new Error('No hay texturas'));
    texLoading[meta.id] = readPluginFile('textures/' + meta.id + '.bin', true).then(function (buf) {
      var tex = E.prepareTexture(new Uint8Array(buf), meta.size);
      state.texCache[meta.id] = tex;
      delete texLoading[meta.id];
      return tex;
    });
    return texLoading[meta.id];
  }

  // banco de goteos reales (plugin/drips): se carga una vez y solo si la técnica gotea
  var dripLib = null, dripLoading = null;
  function getDrips() {
    if (dripLib) return Promise.resolve(dripLib);
    if (!dripLoading) dripLoading = Promise.all([readPluginFile('drips/drips.json', false), readPluginFile('drips/drips.bin', true)]).then(function (r) {
      dripLib = E.prepareDrips(JSON.parse(r[0]), new Uint8Array(r[1])); return dripLib;
    }).catch(function () { dripLoading = null; return null; });   // sin banco: gotas dibujadas
    return dripLoading;
  }
  // texturas de todas las familias que usa el motor
  function getTexs(p) {
    function first(fam) { var t = state.textures.filter(function (x) { return x.family === fam; })[0]; return t ? t.id : null; }
    var ids = { desgaste: p.texture || first('desgaste') }, out = {};
    ['aguada', 'grano', 'rodillo', 'goteo', 'toner', 'fibra', 'floracion', 'granul', 'lavado', 'gubia'].forEach(function (f) { ids[f] = first(f); });
    return Promise.all(Object.keys(ids).map(function (f) {
      if (!ids[f]) return null;
      return getTexture(ids[f]).then(function (t) { out[f] = t; }).catch(function () { /* sin esa textura: ruido */ });
    }).concat([((p.drip && p.drip.on) || (p.drips && p.drips.on && p.drips.drops > 0)) ? getDrips().then(function (d) { if (d) out.drips = d; }) : null])).then(function () { return out; });
  }

  // ---------------------------------------------------------------- Photoshop: capas
  function findLayer(layers, id) {
    for (var i = 0; i < layers.length; i++) {
      if (layers[i].id === id) return layers[i];
      if (layers[i].layers && layers[i].layers.length) { var f = findLayer(layers[i].layers, id); if (f) return f; }
    }
    return null;
  }
  function linkKey(docId, resultId) { return 'link.' + docId + '.' + resultId; }

  // Si la capa activa es un resultado de Analog FX, devuelve su original
  function resolveSource(doc, layer) {
    var srcId = load(linkKey(doc.id, layer.id), null);
    if (srcId != null) {
      var src = findLayer(doc.layers, srcId);
      if (src) return { source: src, result: layer };
    }
    return { source: layer, result: null };
  }

  var OK_KINDS = ['pixel', 'normal', 'text', 'smartobject', 'solidcolor', 'gradientfill', 'patternfill'];
  function checkLayer(layer) {
    if (!layer) return 'Selecciona una capa';
    if (layer.isBackgroundLayer && state.mode !== 'img') return 'El fondo no se puede usar: selecciona una capa de texto o forma (o cambia a Imágenes)';
    var kind = String(layer.kind || '').toLowerCase();
    if (kind === 'group') return 'Es un grupo: selecciona una capa dentro de él';
    if (kind && OK_KINDS.indexOf(kind) < 0) return 'Tipo de capa no compatible (' + kind + ')';
    return null;
  }
  // Modos admitidos: RGB, CMYK, Lab, Escala de grises y Duotono, en 8, 16 o 32 bits.
  // Mapa de bits y Color indexado no admiten capas; Multicanal no admite capas con transparencia.
  function checkDoc(doc) {
    var mode = String(doc.mode || '').toLowerCase();
    if (mode.indexOf('bitmap') >= 0) return 'El modo Mapa de bits no admite capas: conviértelo a Escala de grises, RGB o CMYK';
    if (mode.indexOf('indexed') >= 0) return 'El modo Color indexado no admite capas: conviértelo a RGB o CMYK';
    if (mode.indexOf('multichannel') >= 0) return 'El modo Multicanal no es compatible: conviértelo a RGB o CMYK';
    return null;
  }
  // RGB de 8 bits: se trabaja directamente sobre el documento (lo más rápido).
  // Cualquier otro modo o profundidad: a través de un documento temporal RGB.
  function isDirectDoc(doc) {
    var mode = String(doc.mode || '').toLowerCase();
    var bits = String(doc.bitsPerChannel || '').toLowerCase();
    return (!mode || mode.indexOf('rgb') >= 0) && !(bits.indexOf('16') >= 0 || bits.indexOf('32') >= 0);
  }
  // Copia la capa a un documento temporal RGB 8 bits del mismo tamaño, ejecuta fn y lo cierra
  // sin guardar. Photoshop convierte los colores al copiar la capa entre documentos.
  async function withTempCopy(doc, layer, fn) {
    var tmp = await app.documents.add({
      name: 'Analog FX (temporal)',
      width: Math.round(Number(doc.width)), height: Math.round(Number(doc.height)),
      resolution: Number(doc.resolution) || 72,
      mode: constants.NewDocumentMode.RGB, fill: constants.DocumentFill.TRANSPARENT, depth: 8
    });
    try {
      var copy = await layer.duplicate(tmp);
      if (!copy) copy = tmp.activeLayers && tmp.activeLayers[0];
      try { copy.visible = true; } catch (e) { /* */ }
      var lb = boundsOf(layer), cb = boundsOf(copy);
      if (lb.left !== cb.left || lb.top !== cb.top) { try { await copy.translate(lb.left - cb.left, lb.top - cb.top); } catch (e) { /* */ } }
      return await fn(tmp, copy);
    } finally {
      try { await tmp.closeWithoutSaving(); } catch (e) { /* */ }
      try { app.activeDocument = doc; } catch (e) { /* */ }
    }
  }
  function boundsOf(layer) {
    var b = layer.bounds;
    return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom) };
  }

  // Las funciones de imaging pueden devolver el valor directamente o una promesa
  // según la versión de Photoshop: siempre se envuelven con Promise.resolve / await.
  async function grabPixels(opts) {
    var res = await Promise.resolve(imaging.getPixels(opts));
    var im = res.imageData;
    var data = await Promise.resolve(im.getData({ chunky: true }));
    if (!(data instanceof Uint8Array)) data = new Uint8Array(data.buffer ? data.buffer : data);
    var out = { px: data, w: im.width, h: im.height, comps: im.components, profile: im.colorProfile, bounds: res.sourceBounds };
    try { im.dispose(); } catch (e) { /* */ }
    return out;
  }
  function readPixels(opts) {
    var run = function () { return grabPixels(opts); };
    // getPixels normalmente funciona fuera del modo modal; si no, se reintenta dentro.
    return run().catch(function () {
      return core.executeAsModal(function () { return run(); }, { commandName: 'Analog FX · vista previa' });
    });
  }

  // ---------------------------------------------------------------- fuente de la vista previa
  var srcToken = 0;
  function refreshSource() {
    if (state.busy) return;
    var token = ++srcToken;
    if (!IN_PS) return demoSource();
    var doc = null, layer = null;
    try { doc = app.activeDocument; } catch (e) { doc = null; }
    if (!doc) { clearSource('Abre un documento'); return; }
    try { layer = doc.activeLayers && doc.activeLayers[0]; } catch (e) { layer = null; }
    if (!layer) { clearSource('Selecciona una capa de texto o forma'); return; }
    var docErr = checkDoc(doc);
    var r = resolveSource(doc, layer);
    var err = docErr || checkLayer(r.source);
    $('layerName').textContent = r.result ? r.source.name + '  ›  resultado' : layer.name;
    if (err) { clearSource(err); return; }
    var b = boundsOf(r.source);
    var bw = b.right - b.left, bh = b.bottom - b.top;
    if (bw <= 0 || bh <= 0) { clearSource('La capa está vacía'); return; }
    var sc = Math.min(1, PREVIEW_MAX / Math.max(bw, bh));
    var tsz = { width: Math.max(1, Math.round(bw * sc)), height: Math.max(1, Math.round(bh * sc)) };
    setBusy(true);
    var reading;
    if (isDirectDoc(doc)) {
      reading = readPixels({ documentID: doc.id, layerID: r.source.id, sourceBounds: b, targetSize: tsz, componentSize: 8 });
    } else {
      // CMYK, Lab, grises, 16/32 bits: se pide la conversión a RGB y, si Photoshop no la admite,
      // se lee desde una copia temporal en RGB.
      reading = readPixels({ documentID: doc.id, layerID: r.source.id, sourceBounds: b, targetSize: tsz, componentSize: 8, colorSpace: 'RGB' })
        .then(function (d) { if (d.comps !== 3 && d.comps !== 4) throw new Error('canales ' + d.comps); return d; })
        .catch(function () {
          return core.executeAsModal(function () {
            return withTempCopy(doc, r.source, function (tmp, copy) {
              return grabPixels({ documentID: tmp.id, layerID: copy.id, sourceBounds: boundsOf(copy), targetSize: tsz, componentSize: 8 });
            });
          }, { commandName: 'Analog FX · vista previa' });
        });
    }
    reading.then(function (d) {
      if (token !== srcToken) return;
      setSource({ px: d.px, w: d.w, h: d.h, comps: d.comps, layerId: r.source.id, docId: doc.id, isResult: !!r.result, scale: d.w / Math.max(1, bw), dpi: Number(doc.resolution) || 300 });
      if ($('status').className.indexOf('ok') < 0) setStatus(r.result ? 'Resultado seleccionado: al aplicar se regenera desde el original' : '', null);
    }).catch(function (e) {
      if (token !== srcToken) return;
      clearSource('No se pudo leer la capa: ' + errMsg(e));
    }).then(function () { setBusy(false); });
  }

  function setSource(s) {
    // versión a mitad de resolución para arrastrar deslizadores con fluidez
    var hw = Math.max(1, s.w >> 1), hh = Math.max(1, s.h >> 1), c = s.comps, half = new Uint8Array(hw * hh * c);
    for (var y = 0; y < hh; y++) for (var x = 0; x < hw; x++) {
      var d = (y * hw + x) * c, s0 = ((y * 2) * s.w + x * 2) * c;
      for (var k = 0; k < c; k++) half[d + k] = s.px[s0 + k];
    }
    s.half = { px: half, w: hw, h: hh };
    var base = E.buildInput(s.px, s.w, s.h, c, { l: 0, t: 0, r: 0, b: 0 });
    s.measure = E.measure(base.alpha, s.w, s.h);
    var hb = E.buildInput(half, hw, hh, c, { l: 0, t: 0, r: 0, b: 0 });
    s.halfMeasure = E.measure(hb.alpha, hw, hh);
    if (!s.measure) { clearSource('La capa no tiene píxeles visibles'); return; }
    state.src = s;
    $('btnApply').className = 'btn primary';
    renderPreview(false);
  }

  function clearSource(msg) {
    state.src = null;
    $('previewImg').className = '';
    $('previewEmpty').style.display = 'flex';
    $('btnApply').className = 'btn primary disabled';
    if (msg) setStatus(msg, null);
  }

  // Auto: las tintas oscuras se multiplican con el papel (como la tinta real); las claras, normal
  function resolveBlend(p, ink) {
    var b = p.out.blend || 'auto';
    if (b !== 'auto') return b;
    var c = p.out.color && p.out.color !== 'original' ? E.hexToRgb(p.out.color) : ink;
    var lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    return lum < 150 ? 'multiply' : 'normal';
  }

  function setBusy(on) { $('previewBusy').className = 'preview-busy' + (on ? ' on' : ''); }

  // ---------------------------------------------------------------- render de la vista previa
  var previewTimer = null;
  function schedulePreview(fast) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () { renderPreview(fast); }, fast ? 16 : 40);
  }

  var NO_PREVIEW = true;   // la vista previa se ha quitado del panel (no servía): no se calcula
  function renderPreview(fast) {
    var s = state.src;
    if (!s || NO_PREVIEW) return;
    if (state.rendering) { state.dirty = fast ? 'fast' : 'full'; return; }
    state.rendering = true;
    if (state.mode === 'img') return renderPreviewImg(s, fast);
    var pEff = effParams();
    getTexs(pEff).then(function (tex) {
      var useHalf = fast && s.halfMeasure;
      var px = useHalf ? s.half.px : s.px, w = useHalf ? s.half.w : s.w, h = useHalf ? s.half.h : s.h;
      var m = useHalf ? s.halfMeasure : s.measure;
      var p = pEff;
      var inp = E.prepare(px, w, h, s.comps, p, null, m);
      inp.dpi = s.dpi || 300; inp.pxScale = (s.scale || 1) * (useHalf ? s.half.w / s.w : 1);
      var rgba;
      if (state.showOriginal) {
        rgba = new Uint8Array(inp.w * inp.h * 4);
        for (var i = 0; i < inp.w * inp.h; i++) {
          rgba[i * 4] = inp.rgb[i * 3]; rgba[i * 4 + 1] = inp.rgb[i * 3 + 1]; rgba[i * 4 + 2] = inp.rgb[i * 3 + 2];
          rgba[i * 4 + 3] = Math.round(inp.alpha[i] * 255);
        }
      } else {
        rgba = E.render(inp, p, tex);
      }
      // fondo: papel claro, u oscuro si la tinta es clara
      var ink = p.out.color && p.out.color !== 'original' ? E.hexToRgb(p.out.color) : inp.ink;
      var lum = 0.299 * ink[0] + 0.587 * ink[1] + 0.114 * ink[2];
      var bg = lum > 150 ? [27, 31, 29] : [236, 233, 224];
      var mul = !state.showOriginal && resolveBlend(p, ink) === 'multiply';
      $('previewBox').className = 'preview' + (lum > 150 ? ' dark' : '');
      // recortar al contenido visible (+ un pequeño margen) para que se vea grande
      var W = inp.w, H = inp.h, x0 = W, y0 = H, x1 = -1, y1 = -1, xx, yy;
      for (yy = 0; yy < H; yy++) for (xx = 0; xx < W; xx++) {
        if (rgba[(yy * W + xx) * 4 + 3] > 6) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
      }
      if (x1 < 0) { x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; }
      var padC = Math.round(Math.max(x1 - x0, y1 - y0) * 0.05) + 2;
      x0 = Math.max(0, x0 - padC); y0 = Math.max(0, y0 - padC); x1 = Math.min(W - 1, x1 + padC); y1 = Math.min(H - 1, y1 + padC);
      var cw = x1 - x0 + 1, ch = y1 - y0 + 1, rgb = new Uint8Array(cw * ch * 3);
      for (yy = 0; yy < ch; yy++) for (xx = 0; xx < cw; xx++) {
        var si = ((yy + y0) * W + xx + x0) * 4, di = (yy * cw + xx) * 3;
        var a = rgba[si + 3] / 255, ia = 1 - a;
        if (mul) {
          rgb[di] = bg[0] * (ia + a * rgba[si] / 255);
          rgb[di + 1] = bg[1] * (ia + a * rgba[si + 1] / 255);
          rgb[di + 2] = bg[2] * (ia + a * rgba[si + 2] / 255);
        } else {
          rgb[di] = rgba[si] * a + bg[0] * ia;
          rgb[di + 1] = rgba[si + 1] * a + bg[1] * ia;
          rgb[di + 2] = rgba[si + 2] * a + bg[2] * ia;
        }
      }
      return toImageURL(rgb, cw, ch);
    }).then(function (url) {
      var img = $('previewImg');
      img.src = url;
      img.className = 'on';
      $('previewEmpty').style.display = 'none';
    }).catch(function (e) {
      setStatus('Vista previa no disponible: ' + errMsg(e), 'err');
    }).then(function () {
      state.rendering = false;
      if (state.dirty) { var f = state.dirty === 'fast'; state.dirty = false; renderPreview(f); }
    });
  }

  function renderPreviewImg(s, fast) {
    Promise.resolve().then(function () {
      var useHalf = fast && s.half, px = useHalf ? s.half.px : s.px, w = useHalf ? s.half.w : s.w, h = useHalf ? s.half.h : s.h;
      var rgba, blend = 'normal', n = w * h, bg = [236, 233, 224];
      if (state.showOriginal) { rgba = new Uint8Array(n * 4); for (var i = 0; i < n; i++) { rgba[i * 4] = px[i * s.comps]; rgba[i * 4 + 1] = px[i * s.comps + 1]; rgba[i * 4 + 2] = px[i * s.comps + 2]; rgba[i * 4 + 3] = s.comps === 4 ? px[i * 4 + 3] : 255; } }
      else { var r = IM.render(px, w, h, s.comps, imgParams()); rgba = r.rgba; blend = r.blend; }
      $('previewBox').className = 'preview';
      var rgb = new Uint8Array(n * 3);
      for (var j = 0; j < n; j++) {
        var a = rgba[j * 4 + 3] / 255, ia = 1 - a;
        for (var k = 0; k < 3; k++) rgb[j * 3 + k] = blend === 'multiply' ? bg[k] * (ia + a * rgba[j * 4 + k] / 255) : rgba[j * 4 + k] * a + bg[k] * ia;
      }
      return toImageURL(rgb, w, h);
    }).then(function (url) {
      var img = $('previewImg'); img.src = url; img.className = 'on'; $('previewEmpty').style.display = 'none';
    }).catch(function (e) { setStatus('Vista previa no disponible: ' + errMsg(e), 'err'); })
      .then(function () { state.rendering = false; if (state.dirty) { var f = state.dirty === 'fast'; state.dirty = false; renderPreview(f); } });
  }

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function bytesToBase64(b) {
    var out = '', i;
    for (i = 0; i + 2 < b.length; i += 3) {
      var n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    if (i < b.length) {
      var n2 = (b[i] << 16) | ((i + 1 < b.length ? b[i + 1] : 0) << 8);
      out += B64[(n2 >> 18) & 63] + B64[(n2 >> 12) & 63] + (i + 1 < b.length ? B64[(n2 >> 6) & 63] : '=') + '=';
    }
    return out;
  }
  async function encodePS(rgb, w, h) {
    var im = await Promise.resolve(imaging.createImageDataFromBuffer(rgb, { width: w, height: h, components: 3, chunky: true, colorSpace: 'RGB', colorProfile: 'sRGB IEC61966-2.1' }));
    try {
      var enc = await Promise.resolve(imaging.encodeImageData({ imageData: im, base64: true }));
      if (typeof enc !== 'string') enc = bytesToBase64(enc);   // algunas versiones devuelven los bytes del JPEG
      if (enc.indexOf('data:') === 0) return enc;
      return 'data:image/jpeg;base64,' + enc;
    } finally {
      try { im.dispose(); } catch (e) { /* */ }
    }
  }
  function toImageURL(rgb, w, h) {
    if (IN_PS) return encodePS(rgb, w, h);
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d'), id = ctx.createImageData(w, h);
    for (var i = 0; i < w * h; i++) { id.data[i * 4] = rgb[i * 3]; id.data[i * 4 + 1] = rgb[i * 3 + 1]; id.data[i * 4 + 2] = rgb[i * 3 + 2]; id.data[i * 4 + 3] = 255; }
    ctx.putImageData(id, 0, 0);
    return Promise.resolve(cv.toDataURL('image/jpeg', 0.9));
  }

  // ---------------------------------------------------------------- aplicar en Photoshop
  function applyEffect() {
    if (state.busy) return;
    if (!IN_PS) { setStatus('Modo demo: abre el panel dentro de Photoshop para aplicar', 'err'); return; }
    var doc;
    try { doc = app.activeDocument; } catch (e) { doc = null; }
    if (!doc) { setStatus('Abre un documento', 'err'); return; }
    var layer = doc.activeLayers && doc.activeLayers[0];
    var r = layer ? resolveSource(doc, layer) : null;
    var err = checkDoc(doc) || (r ? checkLayer(r.source) : 'Selecciona una capa');
    if (err) { setStatus(err, 'err'); return; }

    state.busy = true;
    var btn = $('btnApply');
    btn.className = 'btn primary busy'; btn.textContent = 'Aplicando…';
    setStatus('Procesando…', null);
    var isImg = state.mode === 'img', p = isImg ? imgParams() : effParams(), t0 = Date.now();
    if (isImg) p.__img = true;

    (isImg ? Promise.resolve({}) : getTexs(p)).then(function (tex) {
      return core.executeAsModal(function (ctx) {
        return runApply(ctx, doc, r.source, r.result, p, tex);
      }, { commandName: 'Analog FX' });
    }).then(function (info) {
      setStatus('Listo en ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s · ' + info.w + '×' + info.h + ' px', 'ok');
    }).catch(function (e) {
      setStatus('Error: ' + errMsg(e), 'err');
    }).then(function () {
      state.busy = false;
      btn.className = 'btn primary'; btn.textContent = 'Aplicar';
      refreshSource();
    });
  }

  // Todo lo que cambia el documento del usuario ocurre dentro de UNA sola entrada de historial
  // ("Analog FX"), con el documento activo todo el rato: así Ctrl+Z deshace el efecto completo
  // (capa nueva, original oculto y nombre) de una vez y deja todo como estaba.
  async function runApply(ctx, doc, source, oldResult, p, tex) {
    var hc = ctx.hostControl, info = null, tmp = null, tmpLayer = null;
    var direct = isDirectDoc(doc);
    try {
      if (!direct) {
        // 1) CMYK / Lab / grises / 16-32 bits: el efecto se calcula ANTES, en un documento temporal RGB
        tmp = await app.documents.add({
          name: 'Analog FX (temporal)',
          width: Math.round(Number(doc.width)), height: Math.round(Number(doc.height)),
          resolution: Number(doc.resolution) || 72,
          mode: constants.NewDocumentMode.RGB, fill: constants.DocumentFill.TRANSPARENT, depth: 8
        });
        tmpLayer = await source.duplicate(tmp);
        if (!tmpLayer) tmpLayer = tmp.activeLayers && tmp.activeLayers[0];
        try { tmpLayer.visible = true; } catch (e) { /* */ }
        var lb = boundsOf(source), cb0 = boundsOf(tmpLayer);
        if (lb.left !== cb0.left || lb.top !== cb0.top) { try { await tmpLayer.translate(lb.left - cb0.left, lb.top - cb0.top); } catch (e) { /* */ } }
        info = await processLayer(tmp, doc, tmpLayer, source, p, tex);
        try { app.activeDocument = doc; } catch (e) { /* */ }
      }
      // 2) cambios en el documento del usuario: una sola entrada de historial
      var suspension = null, ok = false;
      try { suspension = await hc.suspendHistory({ documentID: doc.id, name: 'Analog FX' }); } catch (e) { suspension = null; }
      try {
        if (oldResult) { try { await oldResult.delete(); } catch (e) { /* ya no existe */ } }
        var result;
        if (direct) {
          result = await source.duplicate();
          info = await processLayer(doc, doc, result, source, p, tex);
        } else {
          result = await tmpLayer.duplicate(doc);
          if (!result) result = doc.activeLayers && doc.activeLayers[0];
          var cb = boundsOf(tmpLayer), bb = boundsOf(result);
          if (cb.left !== bb.left || cb.top !== bb.top) { try { await result.translate(cb.left - bb.left, cb.top - bb.top); } catch (e) { /* */ } }
          try { await result.move(source, constants.ElementPlacement.PLACEBEFORE); } catch (e) { /* queda arriba */ }
        }
        result.name = source.name + RESULT_SUFFIX;
        try {
          var bm = p.__img ? info.blend : resolveBlend(p, info.ink);
          result.blendMode = bm === 'multiply' ? constants.BlendMode.MULTIPLY : constants.BlendMode.NORMAL;
        } catch (e) { /* modo de fusión opcional */ }
        try { result.visible = true; } catch (e) { /* */ }
        source.visible = false;
        ok = true;
        store(linkKey(doc.id, result.id), source.id);
      } finally {
        if (suspension) { try { await hc.resumeHistory(suspension, ok); } catch (e) { /* */ } }
      }
    } finally {
      // 3) el temporal se cierra al final, sin tocar ya el historial del documento
      if (tmp) { try { await tmp.closeWithoutSaving(); } catch (e) { /* */ } try { app.activeDocument = doc; } catch (e) { /* */ } }
    }
    return info;
  }

  // Rasteriza la copia, aplica el efecto y escribe los píxeles (siempre en un documento RGB 8 bits).
  // workDoc: documento donde está la copia; origDoc: documento original (para el tamaño del lienzo).
  async function processLayer(workDoc, origDoc, dup, source, p, tex) {
    if (p.__img) {   // IMÁGENES: mismo tamaño que la capa, sin márgenes ni deformación
      try { dup.visible = true; } catch (e) { /* */ }
      var kindI = String(source.kind || '').toLowerCase();
      if (kindI !== 'pixel' && kindI !== 'normal') await dup.rasterize(constants.RasterizeType.ENTIRELAYER);
      var bI = boundsOf(dup);
      if (bI.right - bI.left <= 0 || bI.bottom - bI.top <= 0) throw new Error('La capa está vacía');
      var dI = await grabPixels({ documentID: workDoc.id, layerID: dup.id, sourceBounds: bI, componentSize: 8 });
      var sbI = dI.bounds || bI, rI = IM.render(dI.px, dI.w, dI.h, dI.comps, p);
      var optsI = { width: dI.w, height: dI.h, components: 4, chunky: true, colorSpace: 'RGB' };
      if (dI.profile && dI.comps >= 3) optsI.colorProfile = dI.profile;
      var outI = await Promise.resolve(imaging.createImageDataFromBuffer(rI.rgba, optsI));
      await Promise.resolve(imaging.putPixels({ documentID: workDoc.id, layerID: dup.id, imageData: outI, replace: true, targetBounds: { left: sbI.left, top: sbI.top } }));
      try { outI.dispose(); } catch (e) { /* */ }
      return { w: dI.w, h: dI.h, ink: [0, 0, 0], blend: rI.blend };
    }
    {
      try { dup.visible = true; } catch (e) { /* */ }
      var kind = String(source.kind || '').toLowerCase();
      if (kind !== 'pixel' && kind !== 'normal') {
        await dup.rasterize(constants.RasterizeType.ENTIRELAYER);
      }
      var b = boundsOf(dup);
      if (b.right - b.left <= 0 || b.bottom - b.top <= 0) throw new Error('La capa está vacía');
      var d = await grabPixels({ documentID: workDoc.id, layerID: dup.id, sourceBounds: b, componentSize: 8 });
      var sb = d.bounds || b;
      var base = E.buildInput(d.px, d.w, d.h, d.comps, { l: 0, t: 0, r: 0, b: 0 });
      var m = E.measure(base.alpha, d.w, d.h);
      if (!m) throw new Error('La capa no tiene píxeles visibles');
      var dw = Math.round(Number(origDoc.width)), dh = Math.round(Number(origDoc.height));
      var inp = E.prepare(d.px, d.w, d.h, d.comps, p, function (mg) {
        if (!(dw > 0 && dh > 0)) return { l: mg, t: mg, r: mg, b: mg };
        return {
          l: Math.max(0, Math.min(mg, sb.left)), t: Math.max(0, Math.min(mg, sb.top)),
          r: Math.max(0, Math.min(mg, dw - sb.right)), b: Math.max(0, Math.min(mg, dh - sb.bottom))
        };
      }, m);
      var pad = inp.pad;
      inp.dpi = Number(origDoc.resolution) || 300; inp.pxScale = 1;
      var rgba = E.render(inp, p, tex);
      var opts = { width: inp.w, height: inp.h, components: 4, chunky: true, colorSpace: 'RGB' };
      if (d.profile && d.comps >= 3) opts.colorProfile = d.profile;
      var out = await Promise.resolve(imaging.createImageDataFromBuffer(rgba, opts));
      await Promise.resolve(imaging.putPixels({
        documentID: workDoc.id, layerID: dup.id, imageData: out, replace: true,
        targetBounds: { left: sb.left - pad.l, top: sb.top - pad.t }
      }));
      try { out.dispose(); } catch (e) { /* */ }
      return { w: inp.w, h: inp.h, ink: inp.ink };
    }
  }

  // ---------------------------------------------------------------- modo demo (navegador)
  function demoSource() {
    if (state.mode === 'img') {
      var cv2 = document.createElement('canvas'), W2 = 520, H2 = 360; cv2.width = W2; cv2.height = H2;
      var g = cv2.getContext('2d'), sky = g.createLinearGradient(0, 0, 0, H2);
      sky.addColorStop(0, '#8fb0d8'); sky.addColorStop(0.5, '#d9cbb5'); sky.addColorStop(1, '#a89a86');
      g.fillStyle = sky; g.fillRect(0, 0, W2, H2);
      [[150, 200, 80, '#d0503a'], [300, 170, 105, '#3a6db5'], [430, 230, 55, '#e8c45a']].forEach(function (b) {
        var rg = g.createRadialGradient(b[0] - b[2] * 0.35, b[1] - b[2] * 0.4, b[2] * 0.05, b[0], b[1], b[2]);
        rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.18, b[3]); rg.addColorStop(1, '#120e0c');
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.ellipse(b[0] + b[2] * 0.4, b[1] + b[2] * 0.95, b[2] * 1.1, b[2] * 0.22, 0, 0, 6.3); g.fill();
        g.fillStyle = rg; g.beginPath(); g.arc(b[0], b[1], b[2], 0, 6.3); g.fill();
      });
      $('layerName').textContent = 'Demo · foto';
      setSource({ px: new Uint8Array(g.getImageData(0, 0, W2, H2).data.buffer.slice(0)), w: W2, h: H2, comps: 4, layerId: 0, docId: 0, scale: 1, dpi: 300 });
      return;
    }
    var cv = document.createElement('canvas'), W = 520, H = 150;
    cv.width = W; cv.height = H;
    var c = cv.getContext('2d');
    c.fillStyle = '#121212';
    c.font = 'bold 130px Arial, Helvetica, sans-serif';
    c.textBaseline = 'middle'; c.textAlign = 'center';
    c.fillText('REKT', W / 2, H / 2 + 6);
    var data = c.getImageData(0, 0, W, H).data;
    $('layerName').textContent = 'Demo · REKT';
    setSource({ px: new Uint8Array(data.buffer.slice(0)), w: W, h: H, comps: 4, layerId: 0, docId: 0, scale: 1, dpi: 300 });
  }

  // ---------------------------------------------------------------- arranque
  // el panel se adapta al tamaño de la ventana: compacto si es baja o estrecha
  function fitPanel() {
    var w = window.innerWidth || document.documentElement.clientWidth || 300, h = window.innerHeight || document.documentElement.clientHeight || 600;
    var b = document.body; if (!b) return;
    var cls = (h < 640 || w < 250 ? ' compact' : '') + (h < 430 ? ' tiny' : '');
    if (b.className !== cls.trim()) b.className = cls.trim();
  }
  function init() {
    fitPanel();
    try { window.addEventListener('resize', fitPanel); } catch (e) { /* sin evento de tamaño */ }
    setInterval(fitPanel, 700);   // UXP no siempre avisa del cambio de tamaño del panel
    buildUI();
    buildImageUI();
    syncAll();
    showPage('presets');
    $('tabText').addEventListener('click', function () { setMode('text'); });
    $('tabImg').addEventListener('click', function () { setMode('img'); });
    $('tabText').className = 'mtab' + (state.mode === 'text' ? ' active' : '');
    $('tabImg').className = 'mtab' + (state.mode === 'img' ? ' active' : '');
    if (state.mode === 'img') { $('pagePresets').className = 'col page hidden'; $('pageDetails').className = 'page hidden'; $('pageImage').className = 'col page'; syncImagePage(); }
    if (!IN_PS) { $('modeBadge').textContent = 'DEMO'; $('modeBadge').className = 'badge demo'; }
    readPluginFile('textures/textures.json', false).then(function (txt) {
      state.textures = JSON.parse(txt);
      if (!state.textures.some(function (t) { return t.id === state.p.texture; })) state.p.texture = 'desgaste_1';
      buildThumbs(); syncAll();
      refreshSource();
    }).catch(function (e) { setStatus('No se pudieron cargar las texturas: ' + errMsg(e), 'err'); });

    if (IN_PS && action && action.addNotificationListener) {
      var onPS = debounce(function () { refreshSource(); }, 220);
      try {
        action.addNotificationListener(['select', 'make', 'delete', 'set', 'move', 'transform', 'open', 'close', 'historyStateChanged', 'paste', 'hide', 'show'], onPS);
      } catch (e) { /* sin notificaciones: se actualiza al pulsar */ }
    }
    // al volver a enfocar el panel, refrescar
    document.addEventListener('mouseenter', debounce(function () { if (!state.src) refreshSource(); }, 300));
  }

  init();
})();
