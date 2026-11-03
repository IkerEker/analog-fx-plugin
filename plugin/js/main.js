/*
 * Analog FX — panel de Photoshop (UXP).
 * Lee la capa activa, genera la vista previa con el motor (engine.js) y al
 * pulsar "Aplicar" crea una copia rasterizada con el efecto, ocultando el original.
 * Fuera de Photoshop (navegador) funciona en modo demo para revisar la interfaz.
 */
(function () {
  'use strict';
  var E = window.AFXEngine, PRESETS = window.AFXPresets;

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
    p: merge(E.DEFAULTS, (PRESETS[0] || {}).p || {}),
    preset: (PRESETS[0] || {}).id,
    textures: [], texCache: {},
    src: null,          // { w, h, px, comps, half, layerId, docId, name, isResult }
    showOriginal: false, busy: false, rendering: false, dirty: false
  };
  var saved = load('params', null);
  if (saved) { state.p = merge(E.DEFAULTS, saved); state.preset = load('preset', null); }
  var openMods = load('open', { warp: true, erode: true });

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
      { k: 'light', label: 'Luminosidad (dilución)', min: -1, max: 1, fmt: signed }] },
    { id: 'drips', title: 'Goteo', ctl: [
      { k: 'length', label: 'Longitud' }, { k: 'amount', label: 'Arrastre' }, { k: 'up', label: 'Hacia arriba' },
      { k: 'drops', label: 'Gotas con bulbo' }] },
    { id: 'splat', title: 'Salpicaduras', ctl: [
      { k: 'amount', label: 'Manchas' }, { k: 'drops', label: 'Gotas redondas' },
      { k: 'spread', label: 'Alcance' }, { k: 'size', label: 'Tamaño' }] },
    { id: 'ink', title: 'Tinta y grano', ctl: [
      { k: 'pressure', label: 'Presión irregular' }, { k: 'grain', label: 'Grano' }] },
    { id: 'print', title: 'Impresión · fotocopia', ctl: [
      { sep: 'Bandas de impresora' },
      { k: 'bands', label: 'Bandas' }, { k: 'spacing', label: 'Separación' }, { k: 'width', label: 'Grosor' },
      { k: 'dir', label: 'Ángulo', min: -1, max: 1, fmt: angFmt, plain: true }, { k: 'shift', label: 'Desplazamiento de franjas' },
      { k: 'streaks', label: 'Rayas de tóner / cabezal' },
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
      var v = getPath(state.p, def.path);
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
      v = Math.round(v * 100) / 100;
      if (min < 0 && !def.plain && Math.abs(v) < 0.04) v = 0; // imán al centro
      setPath(state.p, def.path, v);
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
      setPath(state.p, def.path, getPath(E.DEFAULTS, def.path)); update(); onParamChange(false);
    });
    var s = { path: def.path, update: update };
    sliders.push(s);
    update();
    return root;
  }

  // ---------------------------------------------------------------- construcción de la interfaz
  function buildUI() {
    // estilos
    var chips = $('presetChips');
    PRESETS.forEach(function (pr) {
      var c = el('div', 'chip', pr.name);
      c.setAttribute('data-id', pr.id);
      c.addEventListener('click', function () { applyPreset(pr.id); });
      chips.appendChild(c);
    });
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
        state.p[m.id].on = !state.p[m.id].on;
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
      chip.addEventListener('click', function () { state.p.out.color = c.id; syncAll(); onParamChange(false); });
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
    $('btnReset').addEventListener('click', function () {
      if (state.preset) applyPreset(state.preset);
      else { state.p = merge(E.DEFAULTS, { seed: state.p.seed }); syncAll(); onParamChange(false); }
    });
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
    state.textures.forEach(function (tx) {
      var d = el('div', 'thumb');
      d.setAttribute('data-tex', tx.id);
      var img = el('img');
      img.src = 'textures/thumbs/' + tx.id + '.jpg';
      d.appendChild(img);
      d.appendChild(el('div', 'tl', tx.label));
      d.addEventListener('click', function () { state.p.texture = tx.id; syncAll(); onParamChange(false); });
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
    var chips = document.querySelectorAll('#presetChips .chip');
    for (var i = 0; i < chips.length; i++) chips[i].className = 'chip' + (chips[i].getAttribute('data-id') === state.preset ? ' active' : '');
    var th = document.querySelectorAll('.thumb');
    for (var j = 0; j < th.length; j++) th[j].className = 'thumb' + (th[j].getAttribute('data-tex') === state.p.texture ? ' active' : '');
    var cc = document.querySelectorAll('#colorChips .chip');
    for (var k = 0; k < cc.length; k++) cc[k].className = 'chip' + (cc[k].getAttribute('data-color') === (state.p.out.color || 'original') ? ' active' : '');
    var bcs = document.querySelectorAll('#blendChips .chip');
    for (var b = 0; b < bcs.length; b++) bcs[b].className = 'chip' + (bcs[b].getAttribute('data-blend') === (state.p.out.blend || 'auto') ? ' active' : '');
    $('seedLabel').textContent = 'Semilla ' + state.p.seed;
  }

  function applyPreset(id) {
    var pr = PRESETS.filter(function (x) { return x.id === id; })[0];
    if (!pr) return;
    var keep = { seed: state.p.seed, color: state.p.out.color, blend: state.p.out.blend, effectScale: state.p.effectScale };
    state.p = merge(E.DEFAULTS, pr.p);
    state.p.seed = keep.seed; state.p.out.color = keep.color; state.p.out.blend = keep.blend || 'auto'; state.p.effectScale = keep.effectScale;
    state.preset = id;
    syncAll(); onParamChange(false);
  }

  function onParamChange(fast) {
    if (!fast) { store('params', state.p); store('preset', state.preset); }
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
    if (layer.isBackgroundLayer) return 'El fondo no se puede usar: selecciona una capa de texto o forma';
    var kind = String(layer.kind || '').toLowerCase();
    if (kind === 'group') return 'Es un grupo: selecciona una capa dentro de él';
    if (kind && OK_KINDS.indexOf(kind) < 0) return 'Tipo de capa no compatible (' + kind + ')';
    return null;
  }
  function checkDoc(doc) {
    var mode = String(doc.mode || '').toLowerCase();
    if (mode && mode.indexOf('rgb') < 0) return 'Convierte el documento a modo RGB (Imagen › Modo › Color RGB)';
    var bits = String(doc.bitsPerChannel || '').toLowerCase();
    if (bits && (bits.indexOf('16') >= 0 || bits.indexOf('32') >= 0)) return 'Usa un documento de 8 bits (Imagen › Modo › 8 bits/canal)';
    return null;
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
    setBusy(true);
    readPixels({
      documentID: doc.id, layerID: r.source.id, sourceBounds: b,
      targetSize: { width: Math.max(1, Math.round(bw * sc)), height: Math.max(1, Math.round(bh * sc)) },
      componentSize: 8
    }).then(function (d) {
      if (token !== srcToken) return;
      setSource({ px: d.px, w: d.w, h: d.h, comps: d.comps, layerId: r.source.id, docId: doc.id, isResult: !!r.result });
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

  function renderPreview(fast) {
    var s = state.src;
    if (!s) return;
    if (state.rendering) { state.dirty = fast ? 'fast' : 'full'; return; }
    state.rendering = true;
    getTexture(state.p.texture).then(function (tex) {
      var useHalf = fast && s.halfMeasure;
      var px = useHalf ? s.half.px : s.px, w = useHalf ? s.half.w : s.w, h = useHalf ? s.half.h : s.h;
      var m = useHalf ? s.halfMeasure : s.measure;
      var p = state.p;
      var inp = E.prepare(px, w, h, s.comps, p, null, m);
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
    var p = clone(state.p), t0 = Date.now();

    getTexture(p.texture).then(function (tex) {
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

  async function runApply(ctx, doc, source, oldResult, p, tex) {
    var hc = ctx.hostControl, suspension = null, ok = false, info = null;
    try { suspension = await hc.suspendHistory({ documentID: doc.id, name: 'Analog FX' }); } catch (e) { suspension = null; }
    try {
      if (oldResult) { try { await oldResult.delete(); } catch (e) { /* ya no existe */ } }
      var dup = await source.duplicate();
      try { dup.visible = true; } catch (e) { /* */ }
      var kind = String(source.kind || '').toLowerCase();
      if (kind !== 'pixel' && kind !== 'normal') {
        await dup.rasterize(constants.RasterizeType.ENTIRELAYER);
      }
      var b = boundsOf(dup);
      if (b.right - b.left <= 0 || b.bottom - b.top <= 0) throw new Error('La capa está vacía');
      var d = await grabPixels({ documentID: doc.id, layerID: dup.id, sourceBounds: b, componentSize: 8 });
      var sb = d.bounds || b;
      var base = E.buildInput(d.px, d.w, d.h, d.comps, { l: 0, t: 0, r: 0, b: 0 });
      var m = E.measure(base.alpha, d.w, d.h);
      if (!m) throw new Error('La capa no tiene píxeles visibles');
      var dw = Math.round(Number(doc.width)), dh = Math.round(Number(doc.height));
      var inp = E.prepare(d.px, d.w, d.h, d.comps, p, function (mg) {
        if (!(dw > 0 && dh > 0)) return { l: mg, t: mg, r: mg, b: mg };
        return {
          l: Math.max(0, Math.min(mg, sb.left)), t: Math.max(0, Math.min(mg, sb.top)),
          r: Math.max(0, Math.min(mg, dw - sb.right)), b: Math.max(0, Math.min(mg, dh - sb.bottom))
        };
      }, m);
      var pad = inp.pad;
      var rgba = E.render(inp, p, tex);
      var opts = { width: inp.w, height: inp.h, components: 4, chunky: true, colorSpace: 'RGB' };
      if (d.profile) opts.colorProfile = d.profile;
      var out = await Promise.resolve(imaging.createImageDataFromBuffer(rgba, opts));
      await Promise.resolve(imaging.putPixels({
        documentID: doc.id, layerID: dup.id, imageData: out, replace: true,
        targetBounds: { left: sb.left - pad.l, top: sb.top - pad.t }
      }));
      try { out.dispose(); } catch (e) { /* */ }
      var baseName = source.name;
      dup.name = baseName + RESULT_SUFFIX;
      try {
        var bm = resolveBlend(p, inp.ink);
        dup.blendMode = bm === 'multiply' ? constants.BlendMode.MULTIPLY : constants.BlendMode.NORMAL;
      } catch (e) { /* modo de fusión opcional */ }
      source.visible = false;
      store(linkKey(doc.id, dup.id), source.id);
      info = { w: inp.w, h: inp.h };
      ok = true;
    } finally {
      if (suspension) { try { await hc.resumeHistory(suspension, ok); } catch (e) { /* */ } }
    }
    return info;
  }

  // ---------------------------------------------------------------- modo demo (navegador)
  function demoSource() {
    var cv = document.createElement('canvas'), W = 520, H = 150;
    cv.width = W; cv.height = H;
    var c = cv.getContext('2d');
    c.fillStyle = '#121212';
    c.font = 'bold 130px Arial, Helvetica, sans-serif';
    c.textBaseline = 'middle'; c.textAlign = 'center';
    c.fillText('REKT', W / 2, H / 2 + 6);
    var data = c.getImageData(0, 0, W, H).data;
    $('layerName').textContent = 'Demo · REKT';
    setSource({ px: new Uint8Array(data.buffer.slice(0)), w: W, h: H, comps: 4, layerId: 0, docId: 0 });
  }

  // ---------------------------------------------------------------- arranque
  function init() {
    buildUI();
    syncAll();
    if (!IN_PS) { $('modeBadge').textContent = 'DEMO'; $('modeBadge').className = 'badge demo'; }
    readPluginFile('textures/textures.json', false).then(function (txt) {
      state.textures = JSON.parse(txt);
      if (!state.textures.some(function (t) { return t.id === state.p.texture; })) state.p.texture = state.textures[0].id;
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
