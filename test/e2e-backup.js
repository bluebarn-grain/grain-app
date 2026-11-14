const { chromium } = require('playwright');
const BASE = 'http://localhost:8123/';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, acceptDownloads: true }); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  await page.goto(BASE); await page.waitForSelector('#settings[open]');
  await page.fill('#sUrl', BASE + 'api'); await page.fill('#sKey', 'k'); await page.check('#sSim'); await page.fill('#sOp', 'Chris');
  await page.click('#sCheck'); await page.waitForFunction(() => /Connected/.test(document.getElementById('setMsg').textContent)); await page.click('#sSave');
  // a few tickets so the archive has something in it
  await fetch(BASE + 'api', { method: 'POST', body: JSON.stringify({ key: 'k', action: 'saveTickets', tickets: [
    { no: 900101, dir: 'IN', status: 'Closed', loadNo: 1, commodity: 'Corn', cropYear: 2026, field: 'TEST Home Place', truck: 'Cart 1', gross: 80000, tare: 24000, net: 56000, wetBu: 1000, moisture: 17, tw: 56, timeIn: '2026-10-20T14:00:00Z', timeOut: '2026-10-20T14:20:00Z' },
    { no: 900102, dir: 'OUT', status: 'Closed', bol: '1027262', commodity: 'Corn', cropYear: 2026, buyer: 'The Andersons', contractNo: 'TEST-C1', truck: '196 Triple 8', gross: 87140, tare: 27140, net: 60000, wetBu: 1071.43, timeIn: '2026-10-21T13:35:00Z', timeOut: '2026-10-21T13:48:00Z' }] }) });
  console.log('• scale: export tickets on this PC');
  await page.click('#diag summary');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportTk')]);
  const p = await dl.path(); const txt = require('fs').readFileSync(p, 'utf8');
  console.log('   file:', dl.suggestedFilename(), '| lines:', txt.split('\r\n').length, '| msg:', await page.textContent('#exportMsg'));
  console.log('• office status line shows backups');
  await page.click('#navOffice'); await page.waitForFunction(() => /Updated/.test(document.getElementById('oStatus').textContent)); await page.click('[data-tab="contracts"]');
  console.log('   ', await page.textContent('#oStatus'));
  console.log('• year-end archive');
  await page.selectOption('#oYear', '2026'); await page.click('#oArchive'); await page.waitForFunction(() => window.__printed);
  console.log('   sections:', await page.$$eval('#printArea .asec > h2', h => h.map(x => x.textContent)));
  console.log('   field tickets included:', await page.evaluate(() => /900101/.test(document.querySelector('#printArea').textContent.replace(/^0+/, '')) || /000101|900101/.test(document.querySelector('#printArea').textContent)));
  console.log('   contract tickets included:', await page.evaluate(() => /900102/.test(document.querySelector('#printArea').textContent)));
  console.log('   buttons left in printout:', await page.$$eval('#printArea button', x => x.length));
  console.log('   office screen unchanged after:', await page.$eval('[data-tab="contracts"]', x => x.getAttribute('aria-pressed')));
  await page.emulateMedia({ media: 'print' }); await page.pdf({ path: '/tmp/archive.pdf', format: 'Letter' });
  console.log('errors:', errors); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
