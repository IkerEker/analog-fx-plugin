const { chromium } = require('playwright'); const fs = require('fs'); const S = process.argv[2];
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const [W, H, mode] of [[230, 300, 'text'], [300, 480, 'text'], [320, 800, 'text'], [700, 520, 'text'], [300, 480, 'img'], [700, 520, 'img'], [230, 300, 'img']]) {
    const p = await b.newPage({ viewport: { width: W, height: H } }); p.on('pageerror', e => errs.push(W + 'x' + H + ': ' + e.message));
    await p.addInitScript({ content: fs.readFileSync(S + '/mockps_sync.js', 'utf8') });
    await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(1200);
    if (mode === 'img') { await p.click('#tabImg'); await p.waitForTimeout(600); } else { await p.click('#tabText'); await p.waitForTimeout(400); }
    const r = await p.evaluate(() => { const bb = document.getElementById('btnApply').getBoundingClientRect(); return { top: bb.top, bottom: bb.bottom, vh: window.innerHeight, body: document.body.className, ov: document.documentElement.scrollWidth > window.innerWidth }; });
    await p.screenshot({ path: `${S}/ui_${mode}_${W}x${H}.png` });
    console.log(mode, W + 'x' + H, 'apply', Math.round(r.top) + '-' + Math.round(r.bottom), 'of', r.vh, r.bottom <= r.vh ? 'VISIBLE' : 'CUT', r.body, 'overflowX', r.ov);
    if (W === 300 && mode === 'text') { await p.click('#btnApply'); await p.waitForTimeout(2500); console.log('  apply:', await p.$eval('#status', e => e.textContent)); }
    await p.close();
  }
  console.log('errs', errs); await b.close();
})();
