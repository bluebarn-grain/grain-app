// Browser run-through of Stage 1 on the simulator, against the fake backend in test/server.js.
const { chromium } = require('playwright');
const BASE = 'http://localhost:8123/';
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const step = s => console.log('•', s);
  const stable = async () => { await page.waitForFunction(() => document.getElementById('flag').textContent === 'STABLE', null, { timeout: 15000 }); await page.waitForTimeout(300); };
  const yard = () => page.$eval('#ycount', e => +e.textContent);
  const why = id => page.$eval(id, e => e.textContent);

  await page.goto(BASE);
  step('first-time setup dialog');
  await page.waitForSelector('#settings[open]');
  await page.fill('#sUrl', BASE + 'api'); await page.fill('#sKey', 'k'); await page.check('#sSim'); await page.fill('#sOp', 'Rocio Vazquez');
  await page.click('#sCheck'); await page.waitForFunction(() => /Connected/.test(document.getElementById('setMsg').textContent));
  console.log('  ', await why('#setMsg'), '| next ticket field =', await page.inputValue('#sTicket'));
  await page.click('#sSave');

  step('outbound truck 1 weighs in empty');
  await page.click('#sEmpty'); await stable();
  await page.selectOption('#buyer', 'The Andersons'); await page.selectOption('#contract', 'TEST-C1');
  await page.fill('#truck', '196 Triple 8'); await page.fill('#driver', 'Jose');
  await page.click('#wIn'); console.log('   yard:', await yard());

  step('same truck again is blocked');
  await page.fill('#truck', '196 Triple 8'); await page.waitForTimeout(100);
  console.log('   weigh in says:', await why('#wInWhy'));

  step('outbound truck 2 weighs in');
  await page.click('#sOff'); await page.waitForTimeout(500); await page.click('#sEmpty'); await stable();
  await page.selectOption('#buyer', 'The Andersons'); await page.selectOption('#contract', 'TEST-C1'); await page.fill('#truck', '22 Friesen');
  await page.click('#wIn'); console.log('   yard:', await yard());

  step('inbound truck weighs in loaded and gets a load #');
  await page.click('#dIn'); await page.click('#sLoad'); await stable();
  await page.selectOption('#field', 'TEST Share Quarter'); await page.fill('#truck', 'Grain cart 1');
  console.log('   shares shown:', await why('#shareInfo'));
  await page.click('#wIn'); console.log('   yard:', await yard(), '|', (await page.textContent('#ylist')).replace(/\s+/g, ' ').slice(0, 160));

  step('moisture reading for load 1, and a stray one for load 9');
  await page.fill('#sLoadNo', '1'); await page.click('#sMoist'); await page.waitForTimeout(200);
  await page.fill('#sLoadNo', '9'); await page.click('#sMoist'); await page.waitForTimeout(200);
  console.log('   unmatched box visible:', await page.isVisible('#unmatchedBox'));

  step('select truck 1 while an empty truck is on the scale: wrong-truck lockout');
  await page.click('.yrow >> text=196 Triple 8'); await page.waitForTimeout(400);
  console.log('   weigh out says:', await why('#wOutWhy'), '| disabled:', await page.isDisabled('#wOut'));

  step('truck 2 rolls on loaded and weighs out');
  await page.click('#newT'); await page.click('.yrow >> text=22 Friesen'); await page.click('#sLoad'); await stable();
  await page.click('#wOut'); await page.waitForTimeout(500); console.log('   yard:', await yard());

  step('inbound load 1 dumps and weighs out empty');
  await page.click('.yrow >> text=Grain cart 1'); await page.click('#sEmpty'); await stable();
  await page.click('#wOut'); await page.waitForTimeout(500); console.log('   yard:', await yard());

  step('internet goes down; truck 1 loads and weighs out');
  await page.request.get(BASE + '__down');
  await page.click('.yrow >> text=196 Triple 8'); await page.click('#sLoad'); await stable();
  await page.click('#wOut');
  await page.waitForFunction(() => /Offline/.test(document.getElementById('pNet').textContent), null, { timeout: 40000 });
  console.log('   pill:', await why('#pNet'));

  step('browser reloads while offline; tickets still there');
  await page.reload(); await page.waitForTimeout(1500);
  console.log('   finished rows:', await page.$$eval('#done tr[data-no]', r => r.length), '| yard:', await yard());

  step('internet back; everything syncs');
  await page.request.get(BASE + '__up');
  await page.waitForFunction(() => /synced/i.test(document.getElementById('pNet').textContent), null, { timeout: 40000 });
  const sheet = await (await page.request.get(BASE + '__sheet')).json();
  const head = sheet.tickets[0];
  const col = k => head.indexOf(k);
  console.log('   Sheet tickets:', sheet.tickets.slice(1).map(r => `${r[col('TicketNo')]} ${r[col('Direction')]} net ${r[col('NetLb')]} bu ${r[col('WetBu')]} load ${r[col('LoadNo')]} moist ${r[col('MoisturePct')]}`).join(' | '));
  console.log('   Splits:', sheet.splits.slice(1).map(r => r.slice(0, 4).join(' ')).join(' | '));
  console.log('   Settings next:', sheet.settings.filter(r => /^Next/.test(r[0])).map(r => r.join('=')).join(', '));

  await page.screenshot({ path: process.argv[2] || 'shot.png', fullPage: false });
  console.log('\nerrors:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
