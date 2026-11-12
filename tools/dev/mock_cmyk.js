window.__log = [];
(function () {
  function textPixels(w, h, sw, sh) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
    g.scale(w / sw, h / sh); g.fillStyle = '#c8352b'; g.font = 'bold 140px Arial'; g.textBaseline = 'top'; g.fillText('REKT', 0, 0);
    return new Uint8Array(g.getImageData(0, 0, w, h).data.buffer.slice(0));
  }
  let nextId = 10, nextDoc = 2;
  const docs = {};
  function mkDoc(o) { const d = Object.assign({ layers: [], activeLayers: [] }, o); docs[d.id] = d;
    d.closeWithoutSaving = async () => { delete docs[d.id]; window.__log.push('close doc ' + d.id); }; return d; }
  function mkLayer(doc, o) {
    const L = Object.assign({ visible: true, isBackgroundLayer: false, kind: 'text', doc }, o);
    L.duplicate = async (target) => {
      const td = target && target.layers ? target : L.doc;
      const d = mkLayer(td, { id: nextId++, name: L.name + ' copy', kind: L.kind, bounds: Object.assign({}, L.bounds), visible: L.visible, px: L.px });
      td.layers.unshift(d); td.activeLayers = [d]; window.__log.push('dup ' + L.id + '->' + d.id + ' doc' + td.id); return d; };
    L.rasterize = async () => { L.kind = 'pixel'; window.__log.push('rasterize ' + L.id); };
    L.delete = async () => { L.doc.layers.splice(L.doc.layers.indexOf(L), 1); window.__log.push('delete ' + L.id); };
    L.translate = async (dx, dy) => { window.__log.push('translate ' + L.id + ' ' + dx + ',' + dy); };
    L.move = async (rel, where) => { const arr = L.doc.layers; arr.splice(arr.indexOf(L), 1); arr.splice(arr.indexOf(rel), 0, L); window.__log.push('move ' + L.id + ' ' + where + ' ' + rel.id); };
    return L;
  }
  const doc = mkDoc({ id: 1, mode: 'CMYKColorMode', bitsPerChannel: 'bitDepth16', width: 1200, height: 600, resolution: 300 });
  const src = mkLayer(doc, { id: 5, name: 'REKT', bounds: { left: 100, top: 200, right: 430, bottom: 330 } });
  doc.layers.push(src); doc.activeLayers = [src];
  window.__doc = doc; window.__docs = docs;
  const imaging = {
    getPixels: async (o) => {
      const d = docs[o.documentID];
      if (d.mode !== 'RGBColorMode') throw new Error('Imaging no admite ' + d.mode);   // como Photoshop real con CMYK
      const b = o.sourceBounds, bw = b.right - b.left, bh = b.bottom - b.top;
      const w = o.targetSize ? o.targetSize.width : bw, h = o.targetSize ? o.targetSize.height : bh;
      window.__log.push('getPixels doc' + o.documentID + ' L' + o.layerID + ' ' + w + 'x' + h);
      const data = textPixels(w, h, bw, bh);
      return { sourceBounds: b, imageData: { width: w, height: h, components: 4, colorProfile: 'sRGB IEC61966-2.1', getData: () => data, dispose() {} } };
    },
    createImageDataFromBuffer: (buf, o) => Object.assign({ buf, dispose() {} }, o),
    encodeImageData: ({ imageData: im }) => {
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); const id = g.createImageData(im.width, im.height);
      for (let i = 0; i < im.width * im.height; i++) { id.data[i * 4] = im.buf[i * 3]; id.data[i * 4 + 1] = im.buf[i * 3 + 1]; id.data[i * 4 + 2] = im.buf[i * 3 + 2]; id.data[i * 4 + 3] = 255; }
      g.putImageData(id, 0, 0); return c.toDataURL('image/jpeg').split(',')[1];
    },
    putPixels: async (o) => { if (docs[o.documentID].mode !== 'RGBColorMode') throw new Error('putPixels CMYK'); window.__log.push('putPixels doc' + o.documentID + ' L' + o.layerID + ' ' + o.imageData.width + 'x' + o.imageData.height); window.__put = o; }
  };
  const app = { documents: { add: async (o) => { const d = mkDoc({ id: nextDoc++, mode: 'RGBColorMode', bitsPerChannel: 'bitDepth8', width: o.width, height: o.height }); window.__log.push('new doc ' + d.id + ' ' + o.width + 'x' + o.height + ' ' + o.mode); window.__active = d; return d; } } };
  let active = doc;
  Object.defineProperty(app, 'activeDocument', { get() { return active; }, set(v) { active = v; window.__log.push('activate ' + v.id); } });
  const ps = { app, imaging,
    core: { executeAsModal: async (fn) => fn({ hostControl: { suspendHistory: async () => 77, resumeHistory: async (id, ok) => window.__log.push('resume ' + ok) } }) },
    action: { addNotificationListener() {} },
    constants: { RasterizeType: { ENTIRELAYER: 'entire' }, BlendMode: { MULTIPLY: 'multiply', NORMAL: 'normal' }, NewDocumentMode: { RGB: 'RGBColorMode' }, DocumentFill: { TRANSPARENT: 'transparent' }, ElementPlacement: { PLACEBEFORE: 'placeBefore' } } };
  const uxp = { storage: { formats: { binary: 'binary', utf8: 'utf8' }, localFileSystem: { getPluginFolder: async () => ({ getEntry: async (rel) => ({ read: async ({ format }) => { const r = await fetch(rel); return format === 'binary' ? r.arrayBuffer() : r.text(); } }) }) } } };
  window.require = (n) => n === 'photoshop' ? ps : n === 'uxp' ? uxp : null;
})();
