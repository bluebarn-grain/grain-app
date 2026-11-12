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
  step('price the shipping contract: one full line, one basis-only line');
  await page.click('tr[data-contract="TEST-C1"]');
  await page.click('#pAdd'); console.log('   default bushels:', await page.inputValue('#pBu'));
  await page.fill('#pBu', '6000'); await page.fill('#pMonth', 'Mar 27'); await page.fill('#pFut', '4.4525'); await page.fill('#pBasis', '-0.38'); await page.fill('#pFees', '0.015');
  console.log('   preview:', await page.textContent('#pResult'));
  await page.click('#pSave'); await page.waitForSelector('#priceDlg', { state: 'hidden' });
  await page.click('#pAdd'); await page.fill('#pBu', '5000'); await page.fill('#pBasis', '-0.35'); await page.click('#pSave');
  console.log('   too many bushels says:', await page.textContent('#pMsg'));
  await page.fill('#pBu', '4000'); console.log('   preview:', await page.textContent('#pResult')); await page.click('#pSave'); await page.waitForSelector('#priceDlg', { state: 'hidden' });
  await page.screenshot({ path: shots + '/office-pricing.png' });
  console.log('   ', (await page.textContent('#cPricing')).replace(/\s+/g, ' '));
  step('fill in the futures on the basis-only line later');
  await page.click('#cPricing tr[data-pricing="2"]'); await page.fill('#pMonth', 'May 27'); await page.fill('#pFut', '4.61');
  console.log('   preview:', await page.textContent('#pResult')); await page.click('#pSave'); await page.waitForSelector('#priceDlg', { state: 'hidden' });
  await page.click('#cCancel');
  console.log('   contract row:', (await page.textContent('tr[data-contract="TEST-C1"]')).replace(/\s+/g, ' '));

  step('edit it: close it');
  await page.click('tr[data-contract="AND-2611"]'); await page.selectOption('#cStatus', 'Closed'); await page.click('#cSave'); await page.waitForSelector('#contractDlg', { state: 'hidden' });
  await page.waitForFunction(() => /Closed/.test(document.querySelector('tr[data-contract="AND-2611"]').innerText));
  const atScale = await page.evaluate(() => window.BBG_APP.L().contracts.map(c => c.ContractNo)); console.log('   scale list now:', atScale);

  step('add a landlord');
  await page.click('[data-tab="customers"]'); await page.click('#kNew');
  await page.fill('#kName', 'Smith Land LLC'); await page.selectOption('#kType', 'Landlord'); await page.fill('#kPhone', '620-555-0101'); await page.fill('#kEmail', 'smith@example.com');
  await page.click('#kSave'); await page.waitForSelector('#custDlg', { state: 'hidden' }); await page.waitForSelector('tr[data-customer="Smith Land LLC"]');
  await page.screenshot({ path: shots + '/office-customers.png', fullPage: true });

  step('fields: missing-split warning, new field with acres and a split');
  await page.click('[data-tab="fieldsetup"]'); console.log('   banner:', await page.$eval('#oBody .banner', b => b.textContent).catch(() => 'none'));
  await page.click('#fNew'); await page.fill('#fName', 'North Pivot'); await page.fill('#fAcres', '125.5'); await page.fill('#fUnit', '0001-0002');
  console.log('   default split:', await page.$$eval('#fShares select', ss => ss.map(s => s.value)), await page.textContent('#fTotal'));
  await page.fill('#fShares input[data-k="SharePct"]', '60'); await page.click('#fAddOwner');
  await page.selectOption('#fShares select[data-si="1"]', 'Smith Land LLC'); await page.fill('#fShares input[data-si="1"]', '30');
  console.log('   total shows:', await page.textContent('#fTotal'));
  await page.click('#fSave'); console.log('   says:', await page.textContent('#fMsg'));
  await page.fill('#fShares input[data-si="1"]', '40'); await page.screenshot({ path: shots + '/office-field-dialog.png' });
  await page.click('#fSave'); await page.waitForSelector('#fieldDlg', { state: 'hidden' }); await page.waitForSelector('tr[data-field="North Pivot"]');
  console.log('   row:', (await page.textContent('tr[data-field="North Pivot"]')).replace(/\s+/g, ' '));
  step('set acres and a 2026 split on an existing field');
  await page.click('tr[data-field="TEST Home Place"]'); await page.fill('#fAcres', '160');
  console.log('   existing split:', await page.$$eval('#fShares select', ss => ss.map(s => s.value)), '| note:', await page.textContent('#fSplitNote'));
  await page.click('#fSave'); await page.waitForSelector('#fieldDlg', { state: 'hidden' });
  await page.waitForFunction(() => /160/.test(document.querySelector('tr[data-field="TEST Home Place"]').textContent));
  await page.screenshot({ path: shots + '/office-fieldsetup.png', fullPage: true });
  const scaleShares = await page.evaluate(() => window.BBG_APP.L().shares.filter(s => s.Field === 'North Pivot').map(s => s.Owner + ' ' + s.SharePct));
  console.log('   scale sees North Pivot split:', scaleShares);

  step('field report, expand a field');
  await page.click('[data-tab="fields"]'); await page.click('tr[data-open^="TEST Share Quarter"]');
  console.log('   Home Place row:', (await page.textContent('tr[data-open^="TEST Home Place"]')).replace(/\s+/g, ' '));
  await page.screenshot({ path: shots + '/office-fields.png', fullPage: true });
  console.log('   ', (await page.textContent('#oBody')).replace(/\s+/g, ' ').slice(0, 400));

  step('inventory: opening balance, then bins empty');
  await page.click('[data-tab="inventory"]');
  await page.click('button[data-adj="Opening"]'); await page.fill('#aBu', '12,500'); await page.fill('#aNote', 'At cutover');
  console.log('   preview:', await page.textContent('#aResult')); await page.click('#aSave'); await page.waitForSelector('#adjDlg', { state: 'hidden' });
  await page.waitForFunction(() => /Opening balance/.test(document.getElementById('oBody').innerText));
  await page.screenshot({ path: shots + '/office-inventory.png', fullPage: true });
  console.log('   ', (await page.textContent('.invcard')).replace(/\s+/g, ' '));
  step('bins empty is blocked while the landlord still owns grain');
  await page.click('button[data-adj="BinsEmpty"]'); await page.click('#aSave'); console.log('   says:', await page.textContent('#aMsg')); await page.click('#aCancel');

  step('buy part of the landlord grain, with a price');
  await page.click('[data-tab="landlord"]'); await page.click('#oBody tr button[data-buy]');
  console.log('   held:', await page.textContent('#bHeld'));
  await page.fill('#bBu', '600'); await page.fill('#bPrice', '4.15'); await page.fill('#bNote', 'Ck 10422');
  console.log('   preview:', await page.textContent('#bResult'));
  await page.click('#bSave'); await page.waitForSelector('#buyDlg', { state: 'hidden' }); await page.waitForFunction(() => /Ck 10422/.test(document.getElementById('oBody').innerText));
  await page.screenshot({ path: shots + '/office-landlord.png', fullPage: true });
  console.log('   ', (await page.textContent('#oBody tbody')).replace(/\s+/g, ' '));
  step('trying to buy more than they have is refused, then buy the rest');
  await page.click('#oBody tr button[data-buy]'); await page.fill('#bBu', '5000'); await page.click('#bSave'); console.log('   says:', await page.textContent('#bMsg'));
  await page.click('#bAll'); await page.click('#bSave'); await page.waitForSelector('#buyDlg', { state: 'hidden' });
  await page.waitForFunction(() => /All bought/.test(document.getElementById('oBody').innerText));
  await page.click('[data-tab="inventory"]'); await page.screenshot({ path: shots + '/office-inventory2.png', fullPage: true });
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
