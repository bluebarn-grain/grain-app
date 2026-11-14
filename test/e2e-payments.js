// Payments tab: read a settlement (Claude is stubbed in test/server.js), check matches, post, void.
// Start the server first: node test/server.js
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://localhost:8123/';
const shots = process.argv[2] || '/tmp';
const post = b => fetch(BASE + 'api', { method: 'POST', body: JSON.stringify({ key: 'k', ...b }) }).then(r => r.json());
(async () => {
  await post({ action: 'saveCustomer', isNew: true, customer: { Customer: 'The Andersons', Type: 'Buyer', Email: '' } });
  await post({ action: 'saveContract', isNew: true, contract: { ContractNo: '0090504-01', Buyer: 'The Andersons', Commodity: 'Corn', CropYear: 2026, Bushels: 50000 } });
  await post({ action: 'savePricing', pricing: { ContractNo: '0090504-01', Bushels: 50000, Futures: 4.40, Basis: 0.4675, By: 'Chris' } });
  const at = h => { const x = new Date(); x.setDate(x.getDate() - 2); x.setHours(h, 0, 0, 0); return x.toISOString(); };
  const tix = [0, 1, 2, 3].map(i => ({ no: 910100 + i, dir: 'OUT', status: 'Closed', bol: '7770' + i, commodity: 'Corn', cropYear: 2026, buyer: 'The Andersons', contractNo: '0090504-01',
    truck: 'T' + i, gross: 88000, tare: 28000, net: 60000 + i * 100, wetBu: (60000 + i * 100) / 56, timeIn: at(9 + i), timeOut: at(9 + i) }));
  let j = await post({ action: 'saveTickets', tickets: tix }); if (!j.ok) throw new Error(j.error);

  const pdf = '/tmp/andersons-test.pdf';
  fs.writeFileSync(pdf, '%PDF-1.4 << /Type /Page >> << /Type /Page >> << /Type /Pages >>');

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE); await page.waitForSelector('#settings[open]');
  await page.fill('#sUrl', BASE + 'api'); await page.fill('#sKey', 'k'); await page.fill('#sOp', 'Chris');
  await page.click('#sCheck'); await page.waitForFunction(() => /Connected/.test(document.getElementById('setMsg').textContent)); await page.click('#sSave');
  await page.click('#navOffice'); await page.waitForFunction(() => /Updated/.test(document.getElementById('oStatus').textContent));
  await page.click('[data-tab="payments"]');
  console.log('before:', await page.$eval('#oBody tr[data-popen]', x => x.innerText.replace(/\s+/g, ' ')));
  await page.click('#payRead'); console.log('no file msg:', await page.$eval('#payMsg', x => x.textContent));
  await page.setInputFiles('#payFile', pdf); await page.click('#payRead');
  await page.waitForSelector('#rvPost', { timeout: 20000 });
  console.log('buyer guessed:', await page.$eval('#rvBuyer', x => x.value));
  console.log('checks:', await page.$$eval('.chips .chip', c => c.map(x => x.innerText.replace(/\s+/g, ' '))));
  console.log('matches:', await page.$$eval('#oBody tbody tr', r => r.map(x => x.querySelector('td b')?.innerText + ' → ' + (x.querySelector('select.tsel')?.value || 'none') + ' ' + (x.querySelector('.badge')?.innerText || ''))));
  await page.screenshot({ path: shots + '/pay-review.png', fullPage: true });
  // pick a ticket for the unmatched line by hand (the 4th load)
  const un = await page.$('#oBody tr.nomatch select.tsel'); await un.selectOption('910102');
  console.log('after pick:', await page.$$eval('#oBody tr.nomatch', r => r.length), 'unmatched,', await page.$eval('.rvhead + .chips + p', x => x.innerText));
  await page.click('#rvPost'); await page.waitForSelector('[data-svoid]', { timeout: 10000 });
  console.log('after post:', await page.$eval('#oBody tr[data-popen]', x => x.innerText.replace(/\s+/g, ' ')));
  console.log('posted row:', await page.$eval('[data-svoid]', x => x.closest('tr').innerText.replace(/\s+/g, ' ')));
  await page.screenshot({ path: shots + '/pay-posted.png', fullPage: true });
  await page.click('[data-tab="tickets"]'); console.log('paid chips on tickets:', await page.$$eval('#oBody .badge', x => x.map(b => b.innerText).filter(t => /paid/.test(t))));
  await page.click('[data-tab="payments"]');
  await page.click('[data-svoid]'); await page.click('[data-svoid]');
  await page.waitForSelector('[data-svoid]', { state: 'detached', timeout: 10000 });
  console.log('after void:', await page.$eval('#oBody tr[data-popen]', x => x.innerText.replace(/\s+/g, ' ')));
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: shots + '/pay-phone.png', fullPage: true });
  console.log('errors:', errors); await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
