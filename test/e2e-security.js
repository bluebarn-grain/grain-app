// Office password: set it, office locks, sign in, Settings asks for it (also on the scale PC, also offline), sign out.
const { chromium } = require('playwright');
const BASE = 'http://localhost:8123/';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext(); let page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE); await page.waitForSelector('#settings[open]');
  console.log('key box type:', await page.getAttribute('#sKey', 'type'));
  await page.fill('#sUrl', BASE + 'api'); await page.fill('#sKey', 'k'); await page.selectOption('#sRole', 'office');
  await page.click('#sCheck'); await page.waitForFunction(() => /Connected/.test(document.getElementById('setMsg').textContent)); await page.click('#sSave');
  await page.waitForFunction(() => /Updated/.test(document.getElementById('oStatus').textContent));
  console.log('warning shown:', await page.isVisible('.pwwarn'));
  await page.click('#pwSetup'); await page.fill('#pwNew', 'bluebarn26'); await page.fill('#pwNew2', 'bluebarn2');
  await page.click('#pwSave'); console.log('mismatch:', await page.textContent('#pwMsg'));
  await page.fill('#pwNew2', 'bluebarn26'); await page.click('#pwSave'); await page.waitForTimeout(600);
  console.log('after set: warning gone:', !(await page.isVisible('.pwwarn')), '| sign out shown:', await page.isVisible('#oSignOut'));
  await page.click('#oSignOut'); await page.waitForSelector('#siPw');
  console.log('signed out: tabs hidden:', await page.isHidden('#officeView .tabs'), '| cached data gone:', await page.evaluate(() => document.getElementById('oBody').innerText.includes('Contract') === false));
  await page.fill('#siPw', 'wrong'); await page.click('#siGo'); await page.waitForFunction(() => /Wrong/.test(document.getElementById('siMsg').textContent));
  console.log('wrong:', await page.textContent('#siMsg'));
  await page.fill('#siPw', 'bluebarn26'); await page.click('#siGo'); await page.waitForFunction(() => /Updated/.test(document.getElementById('oStatus').textContent));
  console.log('signed in: tabs visible:', await page.isVisible('#officeView .tabs'));
  await page.reload(); await page.waitForTimeout(1200); console.log('after reload still in:', await page.isVisible('#officeView .tabs'));
  // Settings lock
  await page.click('#btnSettings'); console.log('settings asks password:', await page.isVisible('#unlockDlg[open]'), '| settings open?', await page.isVisible('#settings[open]'));
  await page.fill('#ulPw', 'nope'); await page.click('#ulGo'); await page.waitForFunction(() => /Wrong/.test(document.getElementById('ulMsg').textContent));
  await page.fill('#ulPw', 'bluebarn26'); await page.click('#ulGo'); await page.waitForSelector('#settings[open]');
  console.log('unlocked → settings open'); await page.click('#sCancel');
  // offline unlock uses the hash saved on this computer
  await ctx.setOffline(true); await page.click('#btnSettings'); await page.fill('#ulPw', 'bluebarn26'); await page.click('#ulGo');
  await page.waitForSelector('#settings[open]', { timeout: 30000 }); console.log('offline unlock works'); await page.click('#sCancel'); await ctx.setOffline(false);
  // scale PC
  page = await (await b.newContext()).newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE); await page.waitForSelector('#settings[open]');
  await page.fill('#sUrl', BASE + 'api'); await page.fill('#sKey', 'scalekey'); await page.check('#sSim');
  await page.click('#sCheck'); await page.waitForFunction(() => /Connected/.test(document.getElementById('setMsg').textContent)); await page.click('#sSave'); await page.waitForTimeout(500);
  await page.click('#btnSettings'); console.log('scale PC settings asks password:', await page.isVisible('#unlockDlg[open]'));
  await page.fill('#ulPw', 'bluebarn26'); await page.click('#ulGo'); await page.waitForSelector('#settings[open]'); console.log('scale PC unlocked');
  console.log('errors:', errs); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
