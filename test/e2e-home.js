// Office Home dashboard with a few days of sample harvest. Start the server first: node test/server.js
const { chromium } = require('playwright');
const BASE = 'http://localhost:8123/';
const shots = process.argv[2] || '/tmp';
const post = b => fetch(BASE + 'api', { method: 'POST', body: JSON.stringify({ key: 'k', ...b }) }).then(r => r.json());
(async () => {
  const day = (d, h) => { const x = new Date(); x.setDate(x.getDate() - d); x.setHours(h, 15, 0, 0); return x.toISOString(); };
  const tix = []; let no = 900300;
  const fields = ['TEST Home Place', 'TEST Share Quarter'];
  for (let d = 9; d >= 0; d--) for (let i = 0; i < 3 + (d % 4); i++) {
    const wet = 950 + ((no * 37) % 120), f = fields[(no + d) % 2];
    tix.push({ no: no++, dir: 'IN', status: 'Closed', loadNo: (no % 100) + 1, commodity: 'Corn', cropYear: 2026, field: f, truck: 'Cart ' + (no % 3), gross: 80000, tare: 80000 - Math.round(wet * 56), net: Math.round(wet * 56), wetBu: wet, moisture: 15 + (no % 5) * 0.6, tw: 56, timeIn: day(d, 9 + i), timeOut: day(d, 9 + i) });
  }
  for (let i = 0; i < 3; i++) tix.push({ no: no++, dir: 'OUT', status: 'Closed', bol: '10272' + i, commodity: 'Corn', cropYear: 2026, buyer: 'The Andersons', contractNo: 'TEST-C1', truck: 'T' + i, gross: 87000, tare: 27000, net: 60000, wetBu: 1071.43, timeIn: day(0, 13 + i), timeOut: day(0, 13 + i) });
  tix.push({ no: no++, dir: 'OUT', status: 'Closed', bol: '5501', commodity: 'Corn', cropYear: 2026, buyer: 'The Andersons', contractNo: 'TBD', truck: 'T9', gross: 86000, tare: 27000, net: 59000, wetBu: 1053.57, timeIn: day(1, 15), timeOut: day(1, 15) });
  let j = await post({ action: 'saveTickets', tickets: tix }); if (!j.ok) throw new Error(j.error);
  await post({ action: 'saveField', isNew: false, field: { Field: 'TEST Home Place', Acres: 125 } });
  await post({ action: 'saveField', isNew: false, field: { Field: 'TEST Share Quarter', Acres: 152 } });
  await post({ action: 'saveAdjustment', adjustment: { Type: 'Opening', Commodity: 'Corn', CropYear: 2026, Bushels: 8000, By: 'Chris' } });
  await post({ action: 'saveBackupStub' }).catch(() => {});

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE); await page.waitForSelector('#settings[open]');
  await page.fill('#sUrl', BASE + 'api'); await page.fill('#sKey', 'k'); await page.check('#sSim'); await page.fill('#sOp', 'Chris');
  await page.click('#sCheck'); await page.waitForFunction(() => /Connected/.test(document.getElementById('setMsg').textContent)); await page.click('#sSave');
  await page.click('#navOffice'); await page.waitForFunction(() => /Updated/.test(document.getElementById('oStatus').textContent));
  console.log('home tab active:', await page.$eval('[data-tab="home"]', x => x.getAttribute('aria-pressed')));
  console.log('tiles:', (await page.$$eval('.tile', t => t.map(x => x.innerText.replace(/\s+/g, ' ')))));
  console.log('attention:', (await page.$$eval('.attn a', t => t.map(x => x.innerText.replace(/\s+/g, ' ')))));
  console.log('contracts:', (await page.$$eval('.prog .pl', t => t.map(x => x.innerText.replace(/\s+/g, ' ')))));
  console.log('bars in chart:', await page.$$eval('.chart rect', r => r.length), '| top fields:', await page.$eval('.topf', x => x.innerText.replace(/\s+/g, ' ')));
  await page.screenshot({ path: shots + '/home-ipad.png', fullPage: true });
  await page.click('.prog[data-goc="TEST-C1"]'); console.log('tap contract → tab:', await page.$eval('[data-tab="contracts"]', x => x.getAttribute('aria-pressed')), '| expanded:', await page.isVisible('#oBody tr.sub'));
  await page.click('[data-tab="home"]'); await page.click('.attn a[data-go="tickets"]'); console.log('tap TBD → tickets tab:', await page.$eval('[data-tab="tickets"]', x => x.getAttribute('aria-pressed')));
  await page.click('[data-tab="home"]'); await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: shots + '/home-phone.png', fullPage: true });
  console.log('errors:', errors); await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
