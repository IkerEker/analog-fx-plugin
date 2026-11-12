const { chromium } = require('playwright'); const fs = require('fs'); const S = process.argv[2];
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const W of [230, 320, 700]) {
    const p = await b.newPage({ viewport: { width: W, height: 900 } }); p.on('pageerror', e => errs.push(W + ': ' + e.message));
    await p.addInitScript({ content: fs.readFileSync(S + '/mockps_sync.js', 'utf8') });
    await p.goto('http://localhost:8765/index.html'); await p.waitForTimeout(1200);
    await p.click('#tabImg'); await p.waitForTimeout(1500);
    const techs = await p.$$eval('#imgTechList [data-itech]', a => a.map(x => x.dataset.itech));
    if (W === 320) {
      for (const t of techs) { await p.click(`#imgTechList [data-itech="${t}"]`); await p.waitForTimeout(400);
        const n = (await p.$$('#imgVariantChips > *')).length; for (let i = 0; i < n; i++) { await p.click(`#imgVariantChips > *:nth-child(${i + 1})`); await p.waitForTimeout(300); } }
      await p.click('#btnImgAdv'); await p.waitForTimeout(600);
      await p.screenshot({ path: S + '/im_ui_adv.png', fullPage: true });
      await p.click('#btnImgAdv');
    }
    const ov = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth || document.getElementById('scroll').scrollWidth > document.getElementById('scroll').clientWidth);
    await p.screenshot({ path: S + `/im_ui_${W}.png`, fullPage: true });
    console.log(W, 'techs', techs.length, 'overflow', ov, 'status', await p.$eval('#status', e => e.textContent));
    if (W === 320) {
      await p.click('#btnApply'); await p.waitForTimeout(3000);
      console.log(JSON.stringify(await p.evaluate(() => ({ status: document.getElementById('status').textContent, layers: __doc.layers.map(l => [l.id, l.name, l.visible, l.blendMode || '']), log: __log }))));
      await p.click('#tabText'); await p.waitForTimeout(800);
      console.log('text page visible', await p.$eval('#pagePresets', e => !e.classList.contains('hidden')), 'img hidden', await p.$eval('#pageImage', e => e.classList.contains('hidden')));
    }
    await p.close();
  }
  console.log('errs', errs); await b.close();
})();
