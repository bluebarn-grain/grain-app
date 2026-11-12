// Contract roll-over in the browser. Start the server with: ROLLOVER=1 node test/server.js
const { chromium } = require('playwright');
const BASE = 'http://localhost:8123/';
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const stable = async () => { await page.waitForFunction(() => document.getElementById('flag').textContent === 'STABLE', null, { timeout: 15000 }); await page.waitForTimeout(300); };
  const opts = () => page.$$eval('#contract option', os => os.map(o => o.value));
  await page.goto(BASE); await page.waitForSelector('#settings[open]');
  await page.fill('#sUrl', BASE + 'api'); await page.fill('#sKey', 'k'); await page.check('#sSim'); await page.fill('#sOp', 'JCR');
  await page.click('#sCheck'); await page.waitForFunction(() => /Connected/.test(document.getElementById('setMsg').textContent)); await page.click('#sSave');
  for (const truck of ['T1', 'T2']) {  // simulator loads are ~1,000 bu; TEST-C1 is 1,400
    await page.click('#sOff'); await page.waitForTimeout(400); await page.click('#sEmpty'); await stable();
    await page.selectOption('#buyer', 'The Andersons');
    console.log(truck, 'contracts offered:', await opts());
    await page.selectOption('#contract', (await opts())[0]); await page.fill('#truck', truck);
    console.log(truck, 'contract info:', await page.$eval('#cinfo', e => e.textContent));
    await page.click('#wIn'); await page.click('#newT');
    await page.click('.yrow >> text=' + truck); await page.click('#sLoad'); await stable();
    await page.click('#wOut'); await page.waitForTimeout(1500);
  }
  console.log('\nlast ticket printed:\n' + await page.$eval('#printArea pre', e => e.textContent));
  await page.waitForTimeout(1500);
  await page.click('#newT'); await page.selectOption('#buyer', 'The Andersons');
  console.log('contracts offered now:', await opts());
  console.log('errors:', errors);
  await browser.close();
})();
