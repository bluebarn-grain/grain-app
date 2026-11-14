// Scale key = scale only; office computer = office only; inbound trucks carry the last field. Start: node test/server.js
const { chromium } = require('playwright');
const BASE = 'http://localhost:8123/';
const post = b => fetch(BASE + 'api', { method: 'POST', body: JSON.stringify(b) }).then(r => r.json());
(async () => {
  console.log('scale key ping:', (await post({ key: 'scalekey', action: 'ping' })).role);
  console.log('scale key officeData:', (await post({ key: 'scalekey', action: 'officeData' })).error);
  const l = await post({ key: 'scalekey', action: 'lists' });
  console.log('scale lists customer keys:', Object.keys(l.customers[0] || {}), '| settings:', Object.keys(l.settings));
  const b = await chromium.launch();
  const errs = [];
  // --- scale PC
  let page = await (await b.newContext()).newPage(); page.on('pageerror', e => errs.push(e.message));
  const stable = async () => { await page.waitForFunction(() => document.getElementById('flag').textContent === 'STABLE', null, { timeout: 15000 }); await page.waitForTimeout(300); };
  await page.goto(BASE); await page.waitForSelector('#settings[open]');
  await page.fill('#sUrl', BASE + 'api'); await page.fill('#sKey', 'scalekey'); await page.check('#sSim'); await page.fill('#sOp', 'Rocio');
  await page.click('#sCheck'); await page.waitForFunction(() => /Connected/.test(document.getElementById('setMsg').textContent));
  console.log('scale PC role box:', await page.$eval('#sRole', x => x.value + (x.disabled ? ' (locked)' : '')), '|', await page.textContent('#sRoleWhy'));
  await page.click('#sSave'); await page.waitForTimeout(500);
  console.log('scale PC Office button hidden:', await page.isHidden('#navOffice'));
  // inbound carry-over
  await page.click('#dIn'); await page.click('#sLoad'); await stable();
  const fld = await page.$$eval('#field option', o => o.map(x => x.value).filter(Boolean));
  await page.selectOption('#field', fld[1] || fld[0]); await page.fill('#truck', 'Cart 1');
  await page.click('#wIn'); await page.waitForTimeout(400);
  console.log('after weigh-in, next truck form → field:', await page.inputValue('#field'), '| op:', await page.inputValue('#op'), '| truck:', JSON.stringify(await page.inputValue('#truck')));
  await page.reload(); await page.waitForTimeout(800); await page.click('#dOut'); await page.click('#dIn');
  console.log('after reload + OUT→IN → field:', await page.inputValue('#field'), '| comm:', await page.inputValue('#comm'), '| cy:', await page.inputValue('#cy'), '| op:', await page.inputValue('#op'));
  // --- office computer
  page = await (await b.newContext()).newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE); await page.waitForSelector('#settings[open]');
  await page.fill('#sUrl', BASE + 'api'); await page.fill('#sKey', 'k'); await page.selectOption('#sRole', 'office');
  console.log('office: ticket # field hidden:', await page.isHidden('#sTicket'));
  await page.click('#sCheck'); await page.waitForFunction(() => /Connected/.test(document.getElementById('setMsg').textContent)); await page.click('#sSave');
  await page.waitForTimeout(800);
  console.log('office: Scale button hidden:', await page.isHidden('#navScale'), '| office view shown:', await page.isVisible('#officeView'));
  await page.reload(); await page.waitForTimeout(1000);
  console.log('office after reload: settings popped?', await page.isVisible('#settings[open]'), '| office view:', await page.isVisible('#officeView'));
  console.log('errors:', errs); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
