/*
 * Analog FX — panel de Photoshop (UXP), v0.3.
 * Página 1: técnicas y variantes (presets) de un clic, colores e intensidad.
 * Página 2: todos los ajustes finos de la técnica, texturas, generales y presets propios.
 * Fuera de Photoshop (navegador) funciona en modo demo para revisar la interfaz.
 */
(function () {
  'use strict';
  var E = window.AFXEngine, TC = window.AFXTech;

  // ---------------------------------------------------------------- entorno
  var ps = null, uxp = null;
  try { if (typeof require === 'function') { ps = require('photoshop'); uxp = require('uxp'); } } catch (e) { ps = null; }
  var IN_PS = !!(ps && ps.app);
  var app = IN_PS ? ps.app : null, core = IN_PS ? ps.core : null;
  var imaging = IN_PS ? ps.imaging : null, action = IN_PS ? ps.action : null, constants = IN_PS ? ps.constants : null;
  var PREVIEW_MAX = 520, RESULT_SUFFIX = ' · Analog';

  // ---------------------------------------------------------------- utilidades
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) { var d = document.createElement(tag); if (cls) d.className = cls; if (html != null) d.innerHTML = html; return d; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function store(k, v) { try { localStorage.setItem('afx3.' + k, JSON.stringify(v)); } catch (e) { /* */ } }
  function load(k, d) { try { var v = localStorage.getItem('afx3.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function debounce(fn, ms) { var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); }; }
  function errMsg(e) { return (e && (e.message || e.toString())) || 'Error desconocido'; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rgbToHex(r, g, b) { return '#' + [r, g, b].map(function (v) { var s = Math.round(clamp(v, 0, 255)).toString(16); return s.length < 2 ? '0' + s : s; }).join(''); }
  function lum(c) { return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; }
  function validHex(s) { return /^#?[0-9a-f]{6}$/i.test(String(s).trim()); }
  function normHex(s) { s = String(s).trim(); return (s[0] === '#' ? s : '#' + s).toLowerCase(); }

  // ---------------------------------------------------------------- estado
  function freshTech(t) {
    var pr = t.presets[0];
    var params = TC.defaults(t.id);
    for (var k in pr.v) params[k] = pr.v[k];
    return { preset: pr.id, params: params, inks: clone(t.inks.palettes[0].c), palette: 0 };
  }
  var state = {
    tech: load('tech', TC.TECHNIQUES[0].id),
    per: load('per', {}),
    intensity: load('intensity', 1),
    common: load('common', { scale: 1, texScale: 1, opacity: 1, blend: 'auto', seed: 1 }),
    texChoice: load('texChoice', {}),
    userPresets: load('userPresets', []),
    page: 'presets', colorsOpen: false,
    textures: [], texCache: {},
    src: null, showOriginal: false, busy: false, rendering: false, dirty: false
  };
  TC.TECHNIQUES.forEach(function (t) {
    var cur = state.per[t.id];
    if (!cur || !cur.params) state.per[t.id] = freshTech(t);
    else { var d = TC.defaults(t.id); for (var k in d) if (!(k in cur.params)) cur.params[k] = d[k]; }
  });
  if (!TC.byId(state.tech)) state.tech = TC.TECHNIQUES[0].id;
  function T() { return TC.byId(state.tech); }
  function S() { return state.per[state.tech]; }
  function save() {
    store('tech', state.tech); store('per', state.per); store('intensity', state.intensity);
    store('common', state.common); store('texChoice', state.texChoice); store('userPresets', state.userPresets);
  }

  // número de tintas activas de la técnica actual
  function inkCount(t, s) {
    t = t || T(); s = s || S();
    return t.inks.param ? clamp(s.params[t.inks.param] | 0, 1, t.inks.max) : 1;
  }
  // parámetros efectivos (intensidad aplicada + comunes)
  function effParams() {
    var t = T(), s = S(), p = clone(s.params), I = state.intensity;
    t.intensity.forEach(function (k) {
      var d = t.params.filter(function (x) { return x.k === k; })[0];
      if (!d || typeof p[k] !== 'number') return;
      var mn = d.min != null ? d.min : 0, mx = d.max != null ? d.max : 1;
      p[k] = clamp(p[k] * I, mn, mx);
    });
    p.scale = state.common.scale; p.texScale = state.common.texScale; p.opacity = state.common.opacity; p.seed = state.common.seed;
    return p;
  }
  function resolveInks(layerInk) {
    var s = S(), n = inkCount(), out = [];
    for (var i = 0; i < n; i++) {
      var hx = s.inks[i] || s.inks[0] || '#151515';
      out.push(hx === 'layer' ? (layerInk || [20, 20, 20]) : E.hexToRgb(hx));
    }
    return out;
  }
  function resolveBlend(inks) {
    var b = state.common.blend || 'auto';
    if (b !== 'auto') return b;
    var light = inks.every(function (c) { return lum(c) > 165; });
    return light ? 'normal' : 'multiply';
  }

  // ---------------------------------------------------------------- formatos
  var FMT = {
    pct: function (v) { return Math.round(v * 100) + '%'; },
    deg90: function (v) { var n = Math.round(v * 90); return (n > 0 ? '+' : '') + n + '°'; },
    def: function (v) { return String(Math.round(v * 100)); }
  };

  // ---------------------------------------------------------------- deslizador propio (negro/verde)
  // def: { label, min, max, fmt, get(), set(v), reset() }
  function makeSlider(def) {
    var min = def.min != null ? def.min : 0, max = def.max != null ? def.max : 1;
    var fmt = typeof def.fmt === 'function' ? def.fmt : FMT[def.fmt] || FMT.def;
    var root = el('div', 'ctl'), head = el('div', 'ctl-head');
    var lab = el('div', 'ctl-label', def.label), val = el('div', 'ctl-val');
    val.title = 'Doble clic: valor por defecto';
    head.appendChild(lab); head.appendChild(val);
    var track = el('div', 'track'), rail = el('div', 'rail'), fill = el('div', 'fill'), dot = el('div', 'thumb-dot');
    track.appendChild(rail); track.appendChild(fill); track.appendChild(dot);
    root.appendChild(head); root.appendChild(track);
    function update() {
      var v = def.get(), t = clamp((v - min) / (max - min), 0, 1);
      var zero = min < 0 ? (0 - min) / (max - min) : 0, a = Math.min(zero, t), b = Math.max(zero, t);
      fill.style.left = (a * 100) + '%'; fill.style.width = ((b - a) * 100) + '%';
      dot.style.left = (t * 100) + '%'; val.textContent = fmt(v);
    }
    function setFromX(x, final) {
      var r = track.getBoundingClientRect(), t = r.width > 0 ? clamp((x - r.left) / r.width, 0, 1) : 0;
      var v = Math.round((min + t * (max - min)) * 100) / 100;
      if (min < 0 && Math.abs(v) < 0.04) v = 0;
      def.set(v); update(); changed(!final, def.custom !== false);
    }
    var dragging = false;
    function move(e) { if (dragging) setFromX(e.clientX, false); }
    function up(e) {
      if (!dragging) return;
      dragging = false;
      ['pointermove', 'mousemove'].forEach(function (ev) { document.removeEventListener(ev, move); });
      ['pointerup', 'mouseup'].forEach(function (ev) { document.removeEventListener(ev, up); });
      if (e && e.clientX != null) setFromX(e.clientX, true); else changed(false, def.custom !== false);
    }
    function down(e) {
      if (dragging) return;
      dragging = true;
      ['pointermove', 'mousemove'].forEach(function (ev) { document.addEventListener(ev, move); });
      ['pointerup', 'mouseup'].forEach(function (ev) { document.addEventListener(ev, up); });
      try { if (e.pointerId != null && track.setPointerCapture) track.setPointerCapture(e.pointerId); } catch (err) { /* */ }
      setFromX(e.clientX, false);
      if (e.preventDefault) e.preventDefault();
    }
    track.addEventListener('pointerdown', down); track.addEventListener('mousedown', down);
    val.addEventListener('dblclick', function () { def.reset(); update(); changed(false, def.custom !== false); });
    root._update = update;
    update();
    return root;
  }
  function chipRow(container, options, isActive, onPick) {
    container.innerHTML = '';
    options.forEach(function (o) {
      var c = el('div', 'chip' + (isActive(o) ? ' active' : ''), o.html || o.label);
      c.addEventListener('click', function () { onPick(o); });
      container.appendChild(c);
    });
  }

  // ---------------------------------------------------------------- cambios
  function markCustom() { S().preset = null; }
  function changed(fast, custom) {
    if (custom) markCustom();
    if (!fast) { save(); refreshVariantChips(); }
    schedulePreview(fast);
  }

  // ---------------------------------------------------------------- página 1
  function buildTechList() {
    var list = $('techList');
    list.innerHTML = '';
    TC.GROUPS.forEach(function (g) {
      var techs = TC.TECHNIQUES.filter(function (t) { return t.group === g.id; });
      if (!techs.length) return;
      list.appendChild(el('div', 'group-label', g.name));
      var grid = el('div', 'tech-grid');
      techs.forEach(function (t) {
        var card = el('div', 'tcard' + (t.id === state.tech ? ' active' : ''));
        card.setAttribute('data-tech', t.id);
        var img = el('img'); img.src = 'thumbs/' + t.id + '.jpg';
        card.appendChild(img);
        card.appendChild(el('div', 'tname', t.name));
        card.addEventListener('click', function () { selectTech(t.id); });
        grid.appendChild(card);
      });
      list.appendChild(grid);
    });
  }
  function selectTech(id) {
    state.tech = id;
    var cards = document.querySelectorAll('.tcard');
    for (var i = 0; i < cards.length; i++) cards[i].className = 'tcard' + (cards[i].getAttribute('data-tech') === id ? ' active' : '');
    save(); buildTechPanel(); buildAdvanced(); renderPreviewSoon();
  }
  function variantOptions() {
    var t = T();
    var opts = t.presets.map(function (p) { return { id: p.id, label: p.name, builtin: true, v: p.v }; });
    state.userPresets.filter(function (u) { return u.tech === t.id; }).forEach(function (u) {
      opts.push({ id: 'u:' + u.id, label: '★ ' + u.name, user: u });
    });
    return opts;
  }
  function refreshVariantChips() {
    chipRow($('variantChips'), variantOptions(), function (o) { return S().preset === o.id; }, applyVariant);
  }
  function applyVariant(o) {
    var t = T(), s = S();
    if (o.user) {
      s.params = clone(o.user.params); if (o.user.inks) s.inks = clone(o.user.inks); s.palette = -1;
    } else {
      var params = TC.defaults(t.id);
      for (var k in o.v) params[k] = o.v[k];
      s.params = params;
    }
    s.preset = o.id;
    save(); buildTechPanel(); buildAdvanced(); renderPreviewSoon();
  }
  function buildTechPanel() {
    var t = T(), s = S();
    $('techName').textContent = t.name;
    $('techDesc').textContent = t.desc;
    refreshVariantChips();
    // paletas + "Elegir colores"
    var opts = t.inks.palettes.map(function (pl, i) {
      var sw = pl.c.slice(0, Math.max(1, inkCount())).map(function (h) {
        return h === 'layer' ? '<span class="sw sw-layer"></span>' : '<span class="sw" style="background:' + h + '"></span>';
      }).join('');
      return { i: i, html: sw + pl.name };
    });
    opts.push({ i: 'pick', html: (state.colorsOpen ? '▾ ' : '▸ ') + 'Elegir colores' });
    chipRow($('paletteChips'), opts, function (o) { return o.i === 'pick' ? state.colorsOpen : s.palette === o.i; }, function (o) {
      if (o.i === 'pick') { state.colorsOpen = !state.colorsOpen; buildTechPanel(); return; }
      s.inks = clone(t.inks.palettes[o.i].c); s.palette = o.i;
      save(); buildTechPanel(); renderPreviewSoon();
    });
    buildInkEditor();
    var ic = $('intensityCtl'); ic.innerHTML = '';
    ic.appendChild(makeSlider({
      label: 'Intensidad', min: 0, max: 2, fmt: 'pct', custom: false,
      get: function () { return state.intensity; },
      set: function (v) { state.intensity = v; },
      reset: function () { state.intensity = 1; }
    }));
  }
  // editor de tintas desplegable
  function buildInkEditor() {
    var box = $('inkEditor'), t = T(), s = S();
    box.innerHTML = '';
    box.style.display = state.colorsOpen ? 'block' : 'none';
    if (!state.colorsOpen) return;
    for (var i = 0; i < inkCount(); i++) (function (idx) {
      var cur = s.inks[idx] || '#151515';
      var row = el('div', 'ink-row');
      var head = el('div', 'ink-head');
      head.appendChild(el('div', 'ink-label', 'Tinta ' + (idx + 1)));
      var big = el('div', 'ink-swatch' + (cur === 'layer' ? ' sw-layer' : ''));
      if (cur !== 'layer') big.style.background = cur;
      big.title = 'Abrir selector de color';
      big.addEventListener('click', function () {
        pickColor(cur === 'layer' ? '#151515' : cur).then(function (hx) { if (hx) setInk(idx, hx); });
      });
      head.appendChild(big);
      var inp = el('input', 'text-in hex');
      inp.type = 'text'; inp.value = cur === 'layer' ? 'capa' : cur;
      inp.addEventListener('change', function () { if (validHex(inp.value)) setInk(idx, normHex(inp.value)); });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' && validHex(inp.value)) setInk(idx, normHex(inp.value)); });
      head.appendChild(inp);
      if (idx === 0) {
        var lc = el('div', 'chip mini' + (cur === 'layer' ? ' active' : ''), 'Color de la capa');
        lc.addEventListener('click', function () { setInk(0, 'layer'); });
        head.appendChild(lc);
      }
      row.appendChild(head);
      var sws = el('div', 'swatches');
      TC.SWATCHES.forEach(function (hx) {
        var d = el('div', 'swatch' + (hx === cur ? ' active' : ''));
        d.style.background = hx; d.title = hx;
        d.addEventListener('click', function () { setInk(idx, hx); });
        sws.appendChild(d);
      });
      row.appendChild(sws);
      box.appendChild(row);
    })(i);
  }
  function setInk(idx, hx) {
    var s = S();
    while (s.inks.length <= idx) s.inks.push('#151515');
    s.inks[idx] = hx; s.palette = -1;
    save(); buildTechPanel(); renderPreviewSoon();
  }
  // selector de color de Photoshop (o el del navegador en modo demo)
  function pickColor(hex) {
    if (IN_PS) {
      var rgb = E.hexToRgb(hex);
      return core.executeAsModal(function () {
        return action.batchPlay([{ _obj: 'showColorPicker', context: 'Analog FX', color: { _obj: 'RGBColor', red: rgb[0], grain: rgb[1], blue: rgb[2] } }], {});
      }, { commandName: 'Elegir color' }).then(function (res) {
        var d = res && res[0], col = d && (d.RGBFloatColor || d.color || d.RGBColor);
        if (!col || col.red == null) return null;
        return rgbToHex(col.red, col.grain != null ? col.grain : col.green, col.blue);
      }).catch(function (e) { setStatus('No se pudo abrir el selector: ' + errMsg(e) + ' (escribe el color en hexadecimal)', 'err'); return null; });
    }
    return new Promise(function (resolve) {
      var nc = $('nativeColor');
      nc.value = hex;
      nc.onchange = function () { resolve(nc.value); };
      nc.click();
    });
  }

  // ---------------------------------------------------------------- página 2
  function buildAdvanced() {
    var t = T(), s = S();
    $('advTitle').textContent = t.name;
    var box = $('advSections');
    box.innerHTML = '';
    var secs = [];
    t.params.forEach(function (d) { if (secs.indexOf(d.sec) < 0) secs.push(d.sec); });
    secs.forEach(function (sec) {
      var card = el('section', 'card');
      card.appendChild(el('div', 'card-title', sec));
      t.params.filter(function (d) { return d.sec === sec; }).forEach(function (d) {
        if (d.type === 'chips') {
          card.appendChild(el('div', 'ctl-label sub', d.label));
          var row = el('div', 'chips');
          chipRow(row, d.options, function (o) { return s.params[d.k] === o.v; }, function (o) {
            s.params[d.k] = o.v; markCustom(); save(); buildAdvanced(); buildTechPanel(); renderPreviewSoon();
          });
          card.appendChild(row);
        } else {
          card.appendChild(makeSlider({
            label: d.label, min: d.min, max: d.max, fmt: d.fmt,
            get: function () { return S().params[d.k]; },
            set: function (v) { S().params[d.k] = v; },
            reset: function () { S().params[d.k] = d.def; }
          }));
        }
      });
      box.appendChild(card);
    });
    buildTexPickers();
    var cc = $('commonCtrls'); cc.innerHTML = '';
    TC.COMMON.forEach(function (d) {
      cc.appendChild(makeSlider({
        label: d.label, min: d.min, max: d.max, fmt: d.fmt || 'pct', custom: false,
        get: function () { return state.common[d.k]; },
        set: function (v) { state.common[d.k] = v; },
        reset: function () { state.common[d.k] = d.def; }
      }));
    });
    chipRow($('blendChips'), [{ v: 'auto', label: 'Auto' }, { v: 'multiply', label: 'Multiplicar' }, { v: 'normal', label: 'Normal' }],
      function (o) { return (state.common.blend || 'auto') === o.v; },
      function (o) { state.common.blend = o.v; save(); buildAdvanced(); renderPreviewSoon(); });
    buildUserPresets();
  }
  function buildTexPickers() {
    var t = T(), box = $('texPickers');
    box.innerHTML = '';
    t.textures.forEach(function (fam) {
      var items = state.textures.filter(function (x) { return x.family === fam; });
      if (!items.length) return;
      box.appendChild(el('div', 'ctl-label sub', items[0].label.replace(/\s\d+$/, '')));
      var row = el('div', 'thumbs');
      var cur = state.texChoice[fam] || items[0].id;
      items.forEach(function (tx) {
        var d = el('div', 'thumb' + (tx.id === cur ? ' active' : ''));
        var img = el('img'); img.src = 'textures/thumbs/' + tx.id + '.jpg';
        d.appendChild(img);
        d.appendChild(el('div', 'tl', tx.label.replace(/^\D+/, '')));
        d.addEventListener('click', function () { state.texChoice[fam] = tx.id; markCustom(); save(); buildTexPickers(); refreshVariantChips(); renderPreviewSoon(); });
        row.appendChild(d);
      });
      box.appendChild(row);
    });
    $('advTextures').style.display = t.textures.length ? 'block' : 'none';
  }
  function buildUserPresets() {
    var t = T(), box = $('userPresetList');
    box.innerHTML = '';
    var mine = state.userPresets.filter(function (u) { return u.tech === t.id; });
    if (!mine.length) { box.appendChild(el('div', 'hint', 'Ajusta a tu gusto y guárdalo: aparecerá en la página de presets.')); return; }
    mine.forEach(function (u) {
      var c = el('div', 'chip', '★ ' + u.name + ' <span class="x" title="Borrar">×</span>');
      c.addEventListener('click', function (e) {
        if (e.target && e.target.className === 'x') {
          state.userPresets = state.userPresets.filter(function (q) { return q.id !== u.id; });
          save(); buildUserPresets(); refreshVariantChips(); return;
        }
        applyVariant({ id: 'u:' + u.id, user: u });
      });
      box.appendChild(c);
    });
  }
  function saveUserPreset() {
    var name = String($('presetName').value || '').trim();
    if (!name) { setStatus('Escribe un nombre para el preset', 'err'); return; }
    var s = S(), u = { id: Date.now().toString(36), tech: state.tech, name: name, params: clone(s.params), inks: clone(s.inks) };
    state.userPresets.push(u);
    s.preset = 'u:' + u.id;
    $('presetName').value = '';
    save(); buildUserPresets(); refreshVariantChips();
    setStatus('Preset "' + name + '" guardado', 'ok');
  }
  function showPage(pg) {
    state.page = pg;
    $('pagePresets').className = 'col page' + (pg === 'presets' ? '' : ' hidden');
    $('pageAdvanced').className = 'col page' + (pg === 'advanced' ? '' : ' hidden');
    try { $('scroll').scrollTop = 0; } catch (e) { /* */ }
  }

  function setStatus(msg, kind) { var s = $('status'); s.textContent = msg || ''; s.className = 'status' + (kind ? ' ' + kind : ''); }

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
  function loadTexture(id) {
    if (state.texCache[id]) return Promise.resolve(state.texCache[id]);
    if (texLoading[id]) return texLoading[id];
    var meta = state.textures.filter(function (t) { return t.id === id; })[0];
    if (!meta) return Promise.resolve(null);
    texLoading[id] = readPluginFile('textures/' + id + '.bin', true).then(function (buf) {
      var tex = E.prepareTexture(new Uint8Array(buf), meta.size);
      state.texCache[id] = tex; delete texLoading[id];
      return tex;
    });
    return texLoading[id];
  }
  // texturas que necesita la técnica: { familia: textura preparada }
  function texturesFor(t) {
    var fams = t.textures.slice();
    if (fams.indexOf('moteado') < 0) fams.push('moteado');
    var out = {};
    return Promise.all(fams.map(function (fam) {
      var items = state.textures.filter(function (x) { return x.family === fam; });
      if (!items.length) return null;
      var id = state.texChoice[fam] && items.some(function (x) { return x.id === state.texChoice[fam]; }) ? state.texChoice[fam] : items[0].id;
      return loadTexture(id).then(function (tx) { if (tx) out[fam] = tx; });
    })).then(function () { return out; });
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
  function resolveSource(doc, layer) {
    var srcId = load(linkKey(doc.id, layer.id), null);
    if (srcId != null) { var src = findLayer(doc.layers, srcId); if (src) return { source: src, result: layer }; }
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
  // Las funciones de imaging pueden devolver el valor directamente o una promesa según la versión
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
    return grabPixels(opts).catch(function () {
      return core.executeAsModal(function () { return grabPixels(opts); }, { commandName: 'Analog FX · vista previa' });
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
    var r = resolveSource(doc, layer);
    var err = checkDoc(doc) || checkLayer(r.source);
    $('layerName').textContent = r.result ? r.source.name + '  ›  resultado' : layer.name;
    if (err) { clearSource(err); return; }
    var b = boundsOf(r.source), bw = b.right - b.left, bh = b.bottom - b.top;
    if (bw <= 0 || bh <= 0) { clearSource('La capa está vacía'); return; }
    var sc = Math.min(1, PREVIEW_MAX / Math.max(bw, bh));
    setBusy(true);
    readPixels({
      documentID: doc.id, layerID: r.source.id, sourceBounds: b,
      targetSize: { width: Math.max(1, Math.round(bw * sc)), height: Math.max(1, Math.round(bh * sc)) }, componentSize: 8
    }).then(function (d) {
      if (token !== srcToken) return;
      setSource({ px: d.px, w: d.w, h: d.h, comps: d.comps });
      if ($('status').className.indexOf('ok') < 0) setStatus(r.result ? 'Resultado seleccionado: al aplicar se regenera desde el original' : '', null);
    }).catch(function (e) {
      if (token !== srcToken) return;
      clearSource('No se pudo leer la capa: ' + errMsg(e));
    }).then(function () { setBusy(false); });
  }
  function setSource(s) {
    var hw = Math.max(1, s.w >> 1), hh = Math.max(1, s.h >> 1), c = s.comps, half = new Uint8Array(hw * hh * c);
    for (var y = 0; y < hh; y++) for (var x = 0; x < hw; x++) {
      var d = (y * hw + x) * c, s0 = ((y * 2) * s.w + x * 2) * c;
      for (var k = 0; k < c; k++) half[d + k] = s.px[s0 + k];
    }
    s.half = { px: half, w: hw, h: hh };
    s.measure = E.measure(E.buildInput(s.px, s.w, s.h, c, { l: 0, t: 0, r: 0, b: 0 }).alpha, s.w, s.h);
    s.halfMeasure = E.measure(E.buildInput(half, hw, hh, c, { l: 0, t: 0, r: 0, b: 0 }).alpha, hw, hh);
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
  function setBusy(on) { $('previewBusy').className = 'preview-busy' + (on ? ' on' : ''); }

  // ---------------------------------------------------------------- render de la vista previa
  var previewTimer = null;
  function schedulePreview(fast) { clearTimeout(previewTimer); previewTimer = setTimeout(function () { renderPreview(fast); }, fast ? 16 : 40); }
  function renderPreviewSoon() { schedulePreview(false); }
  function renderPreview(fast) {
    var s = state.src;
    if (!s) return;
    if (state.rendering) { state.dirty = fast ? 'fast' : 'full'; return; }
    state.rendering = true;
    var t = T();
    $('seedLabel').textContent = 'Semilla ' + state.common.seed;
    texturesFor(t).then(function (texs) {
      var useHalf = fast && s.halfMeasure;
      var px = useHalf ? s.half.px : s.px, w = useHalf ? s.half.w : s.w, h = useHalf ? s.half.h : s.h;
      var m = useHalf ? s.halfMeasure : s.measure, p = effParams();
      var inp = E.prepare(px, w, h, s.comps, t.id, p, null, m);
      var inks = resolveInks(inp.ink);
      var rgba;
      if (state.showOriginal) {
        rgba = new Uint8Array(inp.w * inp.h * 4);
        for (var i = 0; i < inp.w * inp.h; i++) {
          rgba[i * 4] = inp.rgb[i * 3]; rgba[i * 4 + 1] = inp.rgb[i * 3 + 1]; rgba[i * 4 + 2] = inp.rgb[i * 3 + 2];
          rgba[i * 4 + 3] = Math.round(inp.alpha[i] * 255);
        }
      } else rgba = E.render(inp, t.id, p, texs, inks);
      var blend = resolveBlend(inks), darkBg = blend === 'normal' && inks.every(function (c) { return lum(c) > 165; });
      var bg = darkBg ? [27, 31, 29] : [240, 237, 229];
      $('previewBox').className = 'preview' + (darkBg ? ' dark' : '');
      var mul = !state.showOriginal && blend === 'multiply';
      // recortar al contenido visible para que se vea grande
      var W = inp.w, H = inp.h, x0 = W, y0 = H, x1 = -1, y1 = -1, xx, yy;
      for (yy = 0; yy < H; yy++) for (xx = 0; xx < W; xx++) {
        if (rgba[(yy * W + xx) * 4 + 3] > 6) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (yy < y0) y0 = yy; if (yy > y1) y1 = yy; }
      }
      if (x1 < 0) { x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; }
      var pc = Math.round(Math.max(x1 - x0, y1 - y0) * 0.05) + 2;
      x0 = Math.max(0, x0 - pc); y0 = Math.max(0, y0 - pc); x1 = Math.min(W - 1, x1 + pc); y1 = Math.min(H - 1, y1 + pc);
      var cw = x1 - x0 + 1, ch = y1 - y0 + 1, rgb = new Uint8Array(cw * ch * 3);
      for (yy = 0; yy < ch; yy++) for (xx = 0; xx < cw; xx++) {
        var si = ((yy + y0) * W + xx + x0) * 4, di = (yy * cw + xx) * 3, a = rgba[si + 3] / 255, ia = 1 - a;
        for (var k = 0; k < 3; k++) rgb[di + k] = mul ? bg[k] * (ia + a * rgba[si + k] / 255) : rgba[si + k] * a + bg[k] * ia;
      }
      return toImageURL(rgb, cw, ch);
    }).then(function (url) {
      var img = $('previewImg');
      img.src = url; img.className = 'on';
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
      if (typeof enc !== 'string') enc = bytesToBase64(enc);
      return enc.indexOf('data:') === 0 ? enc : 'data:image/jpeg;base64,' + enc;
    } finally { try { im.dispose(); } catch (e) { /* */ } }
  }
  function toImageURL(rgb, w, h) {
    if (IN_PS) return encodePS(rgb, w, h);
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
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
    var btn = $('btnApply'); btn.className = 'btn primary busy'; btn.textContent = 'Aplicando…';
    setStatus('Procesando…', null);
    var t = T(), p = effParams(), inksHex = clone(S().inks), t0 = Date.now();
    texturesFor(t).then(function (texs) {
      return core.executeAsModal(function (ctx) { return runApply(ctx, doc, r.source, r.result, t, p, texs, inksHex); }, { commandName: 'Analog FX · ' + t.name });
    }).then(function (info) {
      setStatus('Listo en ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s · ' + info.w + '×' + info.h + ' px', 'ok');
    }).catch(function (e) {
      setStatus('Error: ' + errMsg(e), 'err');
    }).then(function () {
      state.busy = false; btn.className = 'btn primary'; btn.textContent = 'Aplicar';
      refreshSource();
    });
  }
  async function runApply(ctx, doc, source, oldResult, t, p, texs, inksHex) {
    var hc = ctx.hostControl, suspension = null, ok = false, info = null;
    try { suspension = await hc.suspendHistory({ documentID: doc.id, name: 'Analog FX · ' + t.name }); } catch (e) { suspension = null; }
    try {
      if (oldResult) { try { await oldResult.delete(); } catch (e) { /* */ } }
      var dup = await source.duplicate();
      try { dup.visible = true; } catch (e) { /* */ }
      var kind = String(source.kind || '').toLowerCase();
      if (kind !== 'pixel' && kind !== 'normal') await dup.rasterize(constants.RasterizeType.ENTIRELAYER);
      var b = boundsOf(dup);
      if (b.right - b.left <= 0 || b.bottom - b.top <= 0) throw new Error('La capa está vacía');
      var d = await grabPixels({ documentID: doc.id, layerID: dup.id, sourceBounds: b, componentSize: 8 });
      var sb = d.bounds || b;
      var m = E.measure(E.buildInput(d.px, d.w, d.h, d.comps, { l: 0, t: 0, r: 0, b: 0 }).alpha, d.w, d.h);
      if (!m) throw new Error('La capa no tiene píxeles visibles');
      var dw = Math.round(Number(doc.width)), dh = Math.round(Number(doc.height));
      var inp = E.prepare(d.px, d.w, d.h, d.comps, t.id, p, function (mg) {
        if (!(dw > 0 && dh > 0)) return { l: mg, t: mg, r: mg, b: mg };
        return {
          l: Math.max(0, Math.min(mg, sb.left)), t: Math.max(0, Math.min(mg, sb.top)),
          r: Math.max(0, Math.min(mg, dw - sb.right)), b: Math.max(0, Math.min(mg, dh - sb.bottom))
        };
      }, m);
      var n = t.inks.param ? clamp(p[t.inks.param] | 0, 1, t.inks.max) : 1, inks = [];
      for (var i = 0; i < n; i++) { var hx = inksHex[i] || inksHex[0]; inks.push(hx === 'layer' ? inp.ink : E.hexToRgb(hx)); }
      var rgba = E.render(inp, t.id, p, texs, inks);
      var opts = { width: inp.w, height: inp.h, components: 4, chunky: true, colorSpace: 'RGB' };
      if (d.profile) opts.colorProfile = d.profile;
      var out = await Promise.resolve(imaging.createImageDataFromBuffer(rgba, opts));
      await Promise.resolve(imaging.putPixels({ documentID: doc.id, layerID: dup.id, imageData: out, replace: true, targetBounds: { left: sb.left - inp.pad.l, top: sb.top - inp.pad.t } }));
      try { out.dispose(); } catch (e) { /* */ }
      dup.name = source.name + RESULT_SUFFIX + ' · ' + t.name;
      try { dup.blendMode = resolveBlend(inks) === 'multiply' ? constants.BlendMode.MULTIPLY : constants.BlendMode.NORMAL; } catch (e) { /* */ }
      source.visible = false;
      store(linkKey(doc.id, dup.id), source.id);
      info = { w: inp.w, h: inp.h }; ok = true;
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
    c.fillStyle = '#121212'; c.font = 'bold 130px Arial, Helvetica, sans-serif';
    c.textBaseline = 'middle'; c.textAlign = 'center';
    c.fillText('REKT', W / 2, H / 2 + 6);
    $('layerName').textContent = 'Demo · REKT';
    setSource({ px: new Uint8Array(c.getImageData(0, 0, W, H).data.buffer.slice(0)), w: W, h: H, comps: 4 });
  }

  // ---------------------------------------------------------------- arranque
  function init() {
    buildTechList(); buildTechPanel(); buildAdvanced();
    if (!IN_PS) { $('modeBadge').textContent = 'DEMO'; $('modeBadge').className = 'badge demo'; }
    $('btnAdvanced').addEventListener('click', function () { showPage('advanced'); });
    $('btnBack').addEventListener('click', function () { buildTechPanel(); showPage('presets'); });
    $('btnApply').addEventListener('click', applyEffect);
    $('btnSavePreset').addEventListener('click', saveUserPreset);
    $('btnSeed').addEventListener('click', function () { state.common.seed = 1 + Math.floor(Math.random() * 99999); save(); renderPreviewSoon(); });
    $('btnReset').addEventListener('click', function () {
      var t = T(), id = S().preset || t.presets[0].id, o = variantOptions().filter(function (x) { return x.id === id; })[0] || variantOptions()[0];
      applyVariant(o);
    });
    var cmp = $('compareBtn');
    function cmpOn(e) { state.showOriginal = true; cmp.className = 'pill active'; renderPreview(false); if (e.preventDefault) e.preventDefault(); }
    function cmpOff() { if (!state.showOriginal) return; state.showOriginal = false; cmp.className = 'pill'; renderPreview(false); }
    cmp.addEventListener('pointerdown', cmpOn); cmp.addEventListener('mousedown', cmpOn);
    document.addEventListener('pointerup', cmpOff); document.addEventListener('mouseup', cmpOff);
    cmp.addEventListener('mouseleave', cmpOff);

    readPluginFile('textures/textures.json', false).then(function (txt) {
      state.textures = JSON.parse(txt);
      buildTexPickers();
      refreshSource();
    }).catch(function (e) { setStatus('No se pudieron cargar las texturas: ' + errMsg(e), 'err'); refreshSource(); });

    if (IN_PS && action && action.addNotificationListener) {
      var onPS = debounce(function () { refreshSource(); }, 220);
      try { action.addNotificationListener(['select', 'make', 'delete', 'set', 'move', 'transform', 'open', 'close', 'paste', 'hide', 'show'], onPS); } catch (e) { /* */ }
    }
    document.addEventListener('mouseenter', debounce(function () { if (!state.src) refreshSource(); }, 300));
  }
  init();
})();
