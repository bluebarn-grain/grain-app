const assert = require('assert');
const P = require('../parsers.js');
const { loadBackend, testSheet } = require('./mock-gas.js');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok -', name); };

ok('scale: real 720i line from PuTTY', () => { const r = P.parseScale('   10480LG'); assert.equal(r.weight, 10480); assert.equal(r.motion, false); assert.equal(r.mode, 'G'); });
ok('scale: motion flag', () => { assert.equal(P.parseScale('10480LGM').motion, true); assert.equal(P.parseScale(' 10480LG M').motion, true); });
ok('scale: negative and STX/CR', () => { assert.equal(P.parseScale('\x02  -20LG\r').weight, -20); });
ok('scale: over range', () => { assert.equal(P.parseScale('  0LGO').overload, true); });
ok('scale: garbage rejected', () => { assert.equal(P.parseScale('03/03/2010,22:33,Sorghum'), null); assert.equal(P.parseScale('1'), null); });
ok('moisture: real tester line from PuTTY', () => {
  const r = P.parseMoisture('03/03/2010,22:33,Sorghum,20230412N,27,GUEST,,13.9,54.5,59.6');
  assert.deepEqual([r.grain, r.loadNo, r.moisture, r.testWeight, r.tempF], ['Sorghum', 27, 13.9, 54.5, 59.6]);
});
ok('moisture: not confused with scale', () => { assert.equal(P.parseMoisture('10480LG'), null); });
ok('line splitter handles chunks split mid-line', () => { const got = []; const s = P.lineSplitter(l => got.push(l)); s('  104'); s('80LG\r\n  104'); s('80LG\r\n'); assert.deepEqual(got.map(x => x.trim()), ['10480LG', '10480LG']); });
ok('load numbers wrap at 100 and skip ones in use', () => { assert.equal(P.nextLoadNo(0, []), 1); assert.equal(P.nextLoadNo(100, []), 1); assert.equal(P.nextLoadNo(4, [5, 6]), 7); assert.equal(P.nextLoadNo(99, [100, 1]), 2); });
ok('split adds back to net exactly', () => { const s = P.splitNet(60001, 56, [{ owner: 'A', pct: 33.33 }, { owner: 'B', pct: 33.33 }, { owner: 'C', pct: 33.34 }]); assert.equal(s.reduce((a, x) => a + x.netLb, 0), 60001); });

// backend
const ss = testSheet();
const be = loadBackend(ss, { SHEET_ID: 'x', API_KEY: 'k' });
ok('backend rejects wrong key', () => { assert.equal(be.call({ action: 'ping', key: 'nope' }).ok, false); });
ok('backend ping', () => { assert.equal(be.call({ action: 'ping', key: 'k' }).ok, true); });
ok('backend lists', () => { const j = be.call({ action: 'lists', key: 'k' }); assert.equal(j.contracts.length, 2); assert.equal(j.customers.length, 4); assert.equal(j.settings.NextTicketNo, 900001); });
const out1 = { no: 900001, dir: 'OUT', status: 'Closed', bol: 9000001, commodity: 'Corn', cropYear: 2026, buyer: 'The Andersons', contractNo: 'TEST-C1', truck: '196 Triple 8', gross: 87140, tare: 27140, net: 60000, wetBu: 1071.43, timeIn: '2026-11-11T13:35:00Z', timeOut: '2026-11-11T13:48:00Z' };
const in1 = { no: 900002, dir: 'IN', status: 'Closed', loadNo: 1, commodity: 'Corn', cropYear: 2026, field: 'TEST Share Quarter', truck: 'Grain cart 1', gross: 60000, tare: 25001, net: 34999, wetBu: 624.98, moisture: 15.2, tw: 57.1, timeIn: '2026-11-11T14:00:00Z', timeOut: '2026-11-11T14:20:00Z' };
const in2 = { no: 900003, dir: 'IN', status: 'Closed', loadNo: 2, commodity: 'Corn', cropYear: 2026, field: 'TEST No Split', truck: 'Grain cart 2', gross: 50000, tare: 20000, net: 30000, wetBu: 535.71 };
ok('backend saves tickets and splits 50/50', () => {
  const j = be.call({ action: 'saveTickets', key: 'k', tickets: [out1, in1] });
  assert.deepEqual(j.saved, [900001, 900002]);
  const splits = ss.sheets.TicketSplits.data.slice(1);
  assert.equal(splits.length, 2); assert.equal(splits[0][3] + splits[1][3], 34999);
});
ok('backend is safe to resend (no duplicates)', () => { be.call({ action: 'saveTickets', key: 'k', tickets: [out1, in1] }); assert.equal(ss.sheets.Tickets.getLastRow(), 3); });
ok('backend flags field with no shares as UNASSIGNED', () => { const j = be.call({ action: 'saveTickets', key: 'k', tickets: [in2] }); assert.equal(j.warnings.length, 1); assert.equal(ss.sheets.TicketSplits.data.at(-1)[1], 'UNASSIGNED'); });
ok('backend bumps next ticket and BOL numbers', () => { const j = be.call({ action: 'lists', key: 'k' }); assert.equal(j.settings.NextTicketNo, 900004); assert.equal(j.settings.NextBOLNo, 9000002); });
ok('backend counts delivered bushels on contract', () => { const j = be.call({ action: 'lists', key: 'k' }); assert.equal(j.contracts.find(c => c.ContractNo === 'TEST-C1').DeliveredBu, 1071.43); });
ok('backend added new columns to Tickets header', () => { const h = ss.sheets.Tickets.data[0]; ['BOLNo', 'LoadNo', 'WetBu', 'Buyer'].forEach(c => assert(h.includes(c), c)); });
console.log(`\n${n} passed`);
