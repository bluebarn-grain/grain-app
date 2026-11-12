// Office side in the browser. Start the server first: node test/server.js
// Seeds tickets through the fake backend, then adds a contract, checks reports, and does a bins-empty close-out.
const { chromium } = require('playwright');
const BASE = 'http://localhost:8123/';
const shots = process.argv[2] || '/tmp';
const post = b => fetch(BASE + 'api', { method: 'POST', body: JSON.stringify({ key: 'k', ...b }) }).then(r => r.json());
(async () => {
  const at = h => new Date(Date.UTC(2026, 9, 20, h)).toISOString();
  const IN = (no, field, wet, m, tw) => ({ no, dir: 'IN', status: 'Closed', loadNo: no % 100, commodity: 'Corn', cropYear: 2026, field, truck: 'Cart ' + (no % 3), gross: 80000, tare: 80000 - Math.round(wet * 56), net: Math.round(wet * 56), wetBu: wet, moisture: m, tw, timeIn: at(14), timeOut: at(15) });
  const OUT = (no, wet) => ({ no, dir: 'OUT', status: 'Closed', bol: 9000000 + no, commodity: 'Corn', cropYear: 2026, buyer: 'The Andersons', contractNo: 'TEST-C1', truck: 'T' + no, gross: 87000, tare: 27000, net: Math.round(wet * 56), wetBu: wet, timeIn: at(16), timeOut: at(17) });
  const seed = await post({ action: 'saveTickets', tickets: [IN(900101, 'TEST Home Place', 1012.5, 17.8, 56.5), IN(900102, 'TEST Home Place', 987.25, 16.2, 57.1), IN(900103, 'TEST Share Quarter', 1040, 18.4, 55.8), IN(900104, 'TEST Share Quarter', 995, 15.1, 57.4), OUT(900105, 1005.36)] });
  if (!seed.ok) throw new Error(seed.error);

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/ERR_EMPTY/.test(m.text())) errors.push(m.text()); });
  const step = s => console.log('•', s);
  await page.goto(BASE); await page.waitForSelector('#settings[open]');
  await page.fill('#sUrl', BASE + 'api'); await page.fill('#sKey', 'k'); await page.check('#sSim'); await page.fill('#sOp', 'Chris');
  await page.click('#sCheck'); await page.waitForFunction(() => /Connected/.test(document.getElementById('setMsg').textContent)); await page.click('#sSave');

  step('open the office side');
  await page.click('#navOffice'); await page.waitForFunction(() => /Updated/.test(document.getElementById('oStatus').textContent));
  await page.screenshot({ path: shots + '/office-contracts.png', fullPage: true });

  step('add a contract');
  await page.click('#cNew'); await page.fill('#cNo', 'AND-2611'); await page.selectOption('#cBuyer', 'The Andersons'); await page.fill('#cBu', '25000');
  await page.fill('#cStart', '2026-12-01'); await page.fill('#cEnd', '2027-01-31');
  await page.click('#cSave'); await page.waitForSelector('#contractDlg', { state: 'hidden' }); await page.waitForSelector('tr[data-contract="AND-2611"]');
  console.log('   rows:', await page.$$eval('#oBody tbody tr', rs => rs.map(r => r.innerText.replace(/\s+/g, ' ')).join(' | ')));
  step('duplicate contract # is refused');
  await page.click('#cNew'); await page.fill('#cNo', 'AND-2611'); await page.fill('#cBu', '5'); await page.click('#cSave');
  await page.waitForFunction(() => /already exists/.test(document.getElementById('cMsg').textContent)); console.log('   says:', await page.textContent('#cMsg')); await page.click('#cCancel');
  step('edit it: close it');
  await page.click('tr[data-contract="AND-2611"]'); await page.selectOption('#cStatus', 'Closed'); await page.click('#cSave'); await page.waitForSelector('#contractDlg', { state: 'hidden' });
  await page.waitForFunction(() => /Closed/.test(document.querySelector('tr[data-contract="AND-2611"]').innerText));
  const atScale = await page.evaluate(() => window.BBG_APP.L().contracts.map(c => c.ContractNo)); console.log('   scale list now:', atScale);

  step('field report, expand a field');
  await page.click('[data-tab="fields"]'); await page.click('tr[data-open^="TEST Share Quarter"]');
  await page.screenshot({ path: shots + '/office-fields.png', fullPage: true });
  console.log('   ', (await page.textContent('#oBody')).replace(/\s+/g, ' ').slice(0, 400));

  step('inventory: opening balance, then bins empty');
  await page.click('[data-tab="inventory"]');
  await page.click('button[data-adj="Opening"]'); await page.fill('#aBu', '12,500'); await page.fill('#aNote', 'At cutover');
  console.log('   preview:', await page.textContent('#aResult')); await page.click('#aSave'); await page.waitForSelector('#adjDlg', { state: 'hidden' });
  await page.waitForFunction(() => /Opening balance/.test(document.getElementById('oBody').innerText));
  await page.screenshot({ path: shots + '/office-inventory.png', fullPage: true });
  console.log('   ', (await page.textContent('.invcard')).replace(/\s+/g, ' '));
  await page.click('button[data-adj="BinsEmpty"]'); console.log('   bins empty preview:', await page.textContent('#aResult'));
  await page.fill('#aNote', 'Bins swept'); await page.click('#aSave'); await page.waitForSelector('#adjDlg', { state: 'hidden' });
  await page.waitForFunction(() => /Adjustments/.test(document.getElementById('oBody').innerText));
  console.log('   ', (await page.textContent('.invcard')).replace(/\s+/g, ' '));

  step('write-off report');
  await page.click('[data-tab="writeoffs"]'); await page.screenshot({ path: shots + '/office-writeoffs.png', fullPage: true });
  console.log('   ', (await page.textContent('#oBody tbody')).replace(/\s+/g, ' '));

  step('adjustments list, undo the close-out');
  await page.click('[data-tab="adjustments"]'); await page.screenshot({ path: shots + '/office-adjustments.png', fullPage: true });
  await page.click('button[data-void="2"]'); await page.click('button[data-void="2"]');
  await page.waitForFunction(() => document.querySelectorAll('button[data-void]').length === 1); console.log('   adjustments left:', await page.$$eval('button[data-void]', b => b.length));

  step('phone-width check');
  await page.setViewportSize({ width: 390, height: 844 }); await page.click('[data-tab="inventory"]');
  await page.screenshot({ path: shots + '/office-phone.png', fullPage: true });
  step('back to scale keeps working');
  await page.click('#navScale'); console.log('   scale visible:', await page.isVisible('#wIn'));
  console.log('errors:', errors);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
