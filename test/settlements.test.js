// Buyer settlements: reading (Claude mocked), merging, tie-out, matching, posting, paid status.
// Run: node test/settlements.test.js
const assert = require('assert');
const R = require('../reports.js');
const { loadBackend, testSheet } = require('./mock-gas.js');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok -', name); };

const ss = testSheet();
const be = loadBackend(ss, { SHEET_ID: 'x', API_KEY: 'k', ANTHROPIC_API_KEY: 'sk-test' });
const call = b => be.call({ key: 'k', ...b });
// our four outbound loads to The Andersons on TEST-C1
const OUT = (no, at, net, extra = {}) => ({ no, dir: 'OUT', status: 'Closed', commodity: 'Corn', cropYear: 2026, buyer: 'The Andersons', contractNo: 'TEST-C1',
  truck: 'T' + no, gross: net + 27000, tare: 27000, net, wetBu: Math.round(net / 56 * 100) / 100, timeIn: at, timeOut: at, ...extra });
call({ action: 'saveTickets', tickets: [
  OUT(900501, '2026-10-16T15:00:00Z', 55600, { bol: '7891' }),
  OUT(900502, '2026-10-16T16:00:00Z', 52060, { bol: '7890' }),
  OUT(900503, '2026-10-17T15:00:00Z', 59080, { bol: '7926', truck: '77412' }),
  OUT(900504, '2026-10-18T15:00:00Z', 62760, { bol: '877949' })] });
call({ action: 'savePricing', pricing: { ContractNo: 'TEST-C1', Bushels: 10000, FlatPrice: 4.8675, By: 'Chris' } });

// What Claude "reads": header + a delivery-sheet section (pages 2-3, grades) + a settlement section (pages 4-5, prices)
const sheetLines = [
  { page: 2, buyer_ticket: 'R053093-01', ship_date: '2026-10-16', vehicle: '10046272', other_ref: '7891', weight_lb: 55600, apply_pct: 100, net_bu: 992.86, test_weight: 60.4, moisture: 14.8, fm: 1.3 },
  { page: 2, buyer_ticket: 'R053094-01', ship_date: '2026-10-16', vehicle: '10046270', other_ref: '900502', weight_lb: 52060, apply_pct: 100, net_bu: 929.64 },
  { page: 3, buyer_ticket: 'S598890-01', ship_date: '2026-10-17', vehicle: '77412', weight_lb: 59080, apply_pct: 100, net_bu: 1055.00 },
  { page: 3, buyer_ticket: 'R053091-02', ship_date: '2026-10-18', vehicle: '10046339', other_ref: '877949', weight_lb: 62760, apply_pct: 93.4, net_bu: 1046.78, moisture: 16.3, adjustments: 'MO -1.2%' }];
const priceLines = sheetLines.map((l, i) => ({ page: 4 + (i > 1 ? 1 : 0), buyer_ticket: l.buyer_ticket, contract_no: '0090504-01', price: 4.8675, net_bu: l.net_bu, amount: Math.round(l.net_bu * 4.8675 * 100) / 100 }));
const gross = Math.round(priceLines.reduce((a, l) => a + l.amount, 0) * 100) / 100, bu = Math.round(sheetLines.reduce((a, l) => a + l.net_bu, 0) * 100) / 100;
const assess = Math.round(bu * 0.01 * 100) / 100;
let calls = [];
be.ctx.__claude = body => {
  calls.push(body);
  const ask = body.messages[0].content.find(c => c.type === 'text').text;
  if (body.tools[0].name === 'settlement_header') return { buyer: 'The Andersons, Inc.', statement_no: '246-093971', voucher: '758580', check_no: '070611', check_date: '2026-11-04',
    commodity: 'Yellow Corn', contracts: [{ contract_no: '0090504-01', price: 4.8675 }], total_bushels: bu, gross_amount: gross,
    deductions: [{ label: 'Kansas Grain Assessment', amount: assess }], net_amount: Math.round((gross - assess) * 100) / 100, check_amount: Math.round((gross - assess) * 100) / 100, load_count: 4, page_count: 5 };
  const m = /pages? (\d+)(?: to (\d+))?/.exec(ask), from = +m[1], to = +(m[2] || m[1]);
  return { lines: sheetLines.concat(priceLines).filter(l => l.page >= from && l.page <= to) };
};
const pdf = Buffer.from('%PDF-1.4 ' + Array(5).fill('<< /Type /Page >>').join(' ') + ' << /Type /Pages >>').toString('base64');
let read;
ok('read: pages in groups at once, loads in two sections merged, totals tie out, original kept', () => {
  read = call({ action: 'readSettlement', buyer: 'The Andersons', files: [{ name: 'andersons.pdf', type: 'application/pdf', data: pdf }] });
  assert.ok(read.ok, read.error);
  assert.equal(read.pages, 5);
  assert.equal(calls.length, 3);                   // header + pages 1-3 + pages 4-5
  assert.equal(read.lines.length, 4);
  const l1 = read.lines.find(l => l.buyer_ticket === 'R053093-01');
  assert.equal(l1.test_weight, 60.4); assert.equal(l1.price, 4.8675); assert.equal(l1.other_ref, '7891');   // grades and price merged
  assert.ok(read.checks.every(c => c.ok), JSON.stringify(read.checks));
  assert.ok(read.fileUrls[0].includes('drive.example'));
});
ok('read: no API key gives a plain message', () => {
  const b2 = loadBackend(testSheet(), { SHEET_ID: 'x', API_KEY: 'k' });
  assert.match(b2.call({ key: 'k', action: 'readSettlement', files: [{ type: 'application/pdf', data: pdf }] }).error, /ANTHROPIC_API_KEY/);
});
let matched;
ok('match: by our ticket #, by BOL, by date + weight + truck, split load 93.4%', () => {
  const d = call({ action: 'officeData' });
  matched = R.matchSettlement(d, read.lines, 'The Andersons', { includeTest: true });
  const by = Object.fromEntries(matched.map(l => [l.buyer_ticket, [l.ticketNo, l.matchedBy]]));
  assert.deepEqual(by['R053093-01'], [900501, 'BOL']);
  assert.deepEqual(by['R053094-01'], [900502, 'ticket #']);
  assert.deepEqual(by['S598890-01'], [900503, 'date + weight']);
  assert.deepEqual(by['R053091-02'], [900504, 'BOL']);
  const split = matched.find(l => l.buyer_ticket === 'R053091-02');
  assert.equal(split.ourBu, Math.round(Math.round(62760 / 56 * 100) / 100 * 0.934 * 100) / 100);
  assert.equal(split.priceDiff, 0); assert.ok(split.mathOk);
});
ok('post: saved with check, duplicate refused, tickets show paid, contract totals', () => {
  const j = call({ action: 'saveSettlement', by: 'Chris', settlement: { buyer: 'The Andersons', header: read.header, lines: matched, fileUrls: read.fileUrls } });
  assert.ok(j.ok, j.error); assert.equal(j.lines, 4);
  assert.match(call({ action: 'saveSettlement', by: 'Chris', settlement: { buyer: 'The Andersons', header: read.header, lines: matched } }).error, /already posted/);
  const d = call({ action: 'officeData' });
  assert.equal(d.tickets.find(t => t.TicketNo === 900504).BuyerTicket, 'R053091-02');
  const s = R.settlementStatus(d, { includeTest: true });
  assert.equal(s.byTicket['900501'].paid, true); assert.deepEqual(s.byTicket['900501'].checks, ['070611']);
  assert.equal(s.byTicket['900504'].pct, 93.4);
  const c = s.contracts.find(x => x.contractNo === 'TEST-C1');
  assert.equal(c.loads, 4); assert.equal(c.unsettled.length, 1);   // the split load still has 6.6% to be settled
  assert.equal(c.amount, gross); assert.equal(c.paidAmount, gross);
  const b = s.buyers.find(x => x.buyer === 'The Andersons');
  assert.equal(b.deductions, assess); assert.equal(b.paid, Math.round((gross - assess) * 100) / 100);
  // the rest of the split shows up later on another settlement and matches the same ticket
  const rest = R.matchSettlement(d, [{ buyer_ticket: 'R053091-01', ship_date: '2026-10-18', other_ref: '877949', weight_lb: 62760, apply_pct: 6.6, net_bu: 73.97 }], 'The Andersons', { includeTest: true });
  assert.equal(rest[0].ticketNo, 900504);
});
ok('void: settlement comes off, tickets unsettled again', () => {
  const d0 = call({ action: 'officeData' });
  assert.ok(call({ action: 'voidSettlement', settlementId: d0.settlements[0].SettlementId, by: 'Chris' }).ok);
  const d = call({ action: 'officeData' });
  assert.equal(d.settlements.length, 0);
  assert.equal(Object.keys(R.settlementStatus(d, { includeTest: true }).byTicket).length, 0);
});
ok('a total that does not add up is flagged', () => {
  const bad = be.ctx.tieOut_({ gross_amount: 1000, deductions: [{ label: 'x', amount: 10 }], net_amount: 980, load_count: 2 }, [{ amount: 500 }, { amount: 450 }]);
  assert.deepEqual(bad.map(c => c.ok), [true, false, false]);
});
console.log(`\n${n} passed`);
