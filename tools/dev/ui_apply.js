const { chromium } = require('playwright'); const fs = require('fs'); const S = process.argv[2];
(async () => { const b = await chromium.launch(); const errs = [];
  for (const [W, H] of [[230, 300], [300, 480], [880, 1000], [1400, 900]]) {
    const p = await b.newPage({ viewport: { width: W, height: H } }); p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript({ content: fs.readFileSync(S + '/mockps_sync.js', 'utf8') });
    await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(1000);
    await p.click('#btnApply'); await p.waitForTimeout(2500);
    const r = await p.evaluate(() => { const a = document.getElementById('btnApply').getBoundingClientRect(); return { l: a.left, r: a.right, b: a.bottom, vw: window.innerWidth, vh: window.innerHeight, st: document.getElementById('status').textContent }; });
    console.log(W + 'x' + H, r.r <= r.vw && r.b <= r.vh ? 'OK' : 'CUT', JSON.stringify(r));
    if (W === 880) await p.screenshot({ path: S + '/ui_foot.png', clip: { x: 0, y: H - 90, width: W, height: 90 } });
    await p.close(); }
  console.log('errs', errs); await b.close(); })();
