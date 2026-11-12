window.__log = [];
(function () {
  function textPixels(w, h, sw, sh) { // renders "REKT" scaled into w×h
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
    g.scale(w / sw, h / sh); g.fillStyle = '#c8352b'; g.font = 'bold 140px Arial'; g.textBaseline = 'top'; g.fillText('REKT', 0, 0);
    return new Uint8Array(g.getImageData(0, 0, w, h).data.buffer.slice(0));
  }
  let nextId = 10;
  function mkLayer(o) {
    const L = Object.assign({ visible: true, isBackgroundLayer: false, kind: 'text' }, o);
    L.duplicate = async () => { const d = mkLayer({ id: nextId++, name: L.name + ' copy', kind: L.kind, bounds: Object.assign({}, L.bounds), visible: L.visible }); doc.layers.unshift(d); doc.activeLayers = [d]; window.__log.push('dup ' + d.id); return d; };
    L.rasterize = async (t) => { window.__log.push('rasterize ' + L.id + ' ' + t); L.kind = 'pixel'; };
    L.delete = async () => { doc.layers.splice(doc.layers.indexOf(L), 1); window.__log.push('delete ' + L.id); };
    return L;
  }
  const doc = { id: 1, mode: 'RGBColorMode', bitsPerChannel: 'bitDepth8', width: 1200, height: 600, layers: [] };
  const src = mkLayer({ id: 5, name: 'REKT', bounds: { left: 100, top: 200, right: 430, bottom: 330 } });
  doc.layers.push(src); doc.activeLayers = [src];
  window.__doc = doc;
  const imaging = {
    getPixels: async (o) => {
      const b = o.sourceBounds, bw = b.right - b.left, bh = b.bottom - b.top;
      const w = o.targetSize ? o.targetSize.width : bw, h = o.targetSize ? o.targetSize.height : bh;
      window.__log.push('getPixels L' + o.layerID + ' ' + w + 'x' + h);
      const data = textPixels(w, h, bw, bh);
      return { sourceBounds: b, imageData: { width: w, height: h, components: 4, colorProfile: 'sRGB IEC61966-2.1', getData: async () => data, dispose() {} } };
    },
    createImageDataFromBuffer: (buf, o) => { if (buf.length !== o.width * o.height * o.components) throw new Error('bad buffer size'); return Object.assign({ buf, dispose() {} }, o); },
    encodeImageData: ({ imageData: im }) => {
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); const id = g.createImageData(im.width, im.height);
      for (let i = 0; i < im.width * im.height; i++) { id.data[i * 4] = im.buf[i * 3]; id.data[i * 4 + 1] = im.buf[i * 3 + 1]; id.data[i * 4 + 2] = im.buf[i * 3 + 2]; id.data[i * 4 + 3] = 255; }
      g.putImageData(id, 0, 0); return c.toDataURL('image/jpeg').split(',')[1];
    },
    putPixels: async (o) => { window.__log.push('putPixels L' + o.layerID + ' ' + o.imageData.width + 'x' + o.imageData.height + ' @' + o.targetBounds.left + ',' + o.targetBounds.top + ' replace=' + o.replace); window.__put = o; }
  };
  const ps = { app: { get activeDocument() { return doc; } }, imaging,
    core: { executeAsModal: async (fn, o) => fn({ hostControl: { suspendHistory: async () => 77, resumeHistory: async (id, ok) => window.__log.push('resume ' + id + ' ' + ok) } }) },
    action: { addNotificationListener() {} }, constants: { RasterizeType: { ENTIRELAYER: 'entire' }, BlendMode: { MULTIPLY: 'multiply', NORMAL: 'normal' } } };
  const uxp = { storage: { formats: { binary: 'binary', utf8: 'utf8' }, localFileSystem: { getPluginFolder: async () => ({ getEntry: async (rel) => ({ read: async ({ format }) => { const r = await fetch(rel); return format === 'binary' ? r.arrayBuffer() : r.text(); } }) }) } } };
  window.require = (n) => n === 'photoshop' ? ps : n === 'uxp' ? uxp : null;
})();
