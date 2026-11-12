// Office report math and the office backend actions. Run: node test/reports.test.js
const assert = require('assert');
const R = require('../reports.js');
const { loadBackend, testSheet } = require('./mock-gas.js');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok -', name); };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.011, `${msg || ''} ${a} vs ${b}`);

ok('dry bushels: water shrink to standard, nothing credited under standard', () => {
  near(R.shrinkFactor(18, 15.5) * 1000, 970.41);   // 1000 × 82 / 84.5
  assert.equal(R.shrinkFactor(14, 15.5), 1);
  assert.equal(R.shrinkFactor('', 15.5), 1);
  near(R.shrinkFactor(18, 15.5, 1.4) * 1000, 965);  // 2.5 points × 1.4%
});

const data = {
  settings: { TypicalLoadBu: 1000 },
  commodities: [{ Commodity: 'Corn', LbPerBu: 56, StdMoisturePct: 15.5 }, { Commodity: 'Sorghum', LbPerBu: 56, StdMoisturePct: 14 }],
  fields: [{ Field: 'Home Place', Acres: 125 }, { Field: 'Share Quarter' }],
  tickets: [
    { TicketNo: 1, Status: 'Closed', Direction: 'IN', Field: 'Home Place', Commodity: 'Corn', CropYear: 2026, NetLb: 56000, WetBu: 1000, MoisturePct: 18, TestWeight: 57 },
    { TicketNo: 2, Status: 'Closed', Direction: 'IN', Field: 'Home Place', Commodity: 'Corn', CropYear: 2026, NetLb: 28000, WetBu: 500, MoisturePct: 15, TestWeight: 60 },
    { TicketNo: 3, Status: 'Closed', Direction: 'IN', Field: 'Share Quarter', Commodity: 'Corn', CropYear: 2026, NetLb: 56000, WetBu: 1000, MoisturePct: '', TestWeight: '' },
    { TicketNo: 4, Status: 'Closed', Direction: 'OUT', Commodity: 'Corn', CropYear: 2026, ContractNo: 'C1', NetLb: 56000, WetBu: 1000 },
    { TicketNo: 5, Status: 'Closed', Direction: 'IN', Field: 'Home Place', Commodity: 'Corn', CropYear: 2026, NetLb: 56000, WetBu: 1000, MoisturePct: 15, TestTicket: true }],
  splits: [{ TicketNo: 1, Owner: 'Roenbaugh Farms', SharePct: 100, WetBu: 1000 }, { TicketNo: 2, Owner: 'Roenbaugh Farms', SharePct: 100, WetBu: 500 },
    { TicketNo: 3, Owner: 'Roenbaugh Farms', SharePct: 50, WetBu: 500 }, { TicketNo: 3, Owner: 'Landlord A', SharePct: 50, WetBu: 500 }],
  allocations: [{ TicketNo: 4, ContractNo: 'C1', Bushels: 1000 }],
  contracts: [{ ContractNo: 'C1', Buyer: 'The Andersons', Commodity: 'Corn', CropYear: 2026, Bushels: 5000, Status: 'Open' },
    { ContractNo: 'C2', Buyer: 'The Andersons', Commodity: 'Corn', CropYear: 2026, Bushels: 2000, Status: 'Closed' }],
  adjustments: [{ AdjNo: 1, Type: 'Opening', Commodity: 'Corn', CropYear: 2026, Bushels: 10000, Status: 'Active' }]
};

ok('field report: totals, weighted moisture, owners, bu/acre, test tickets left out', () => {
  const rows = R.fieldReport(data);
  assert.equal(rows.length, 2);
  const hp = rows.find(r => r.field === 'Home Place');
  assert.equal(hp.loads, 2); assert.equal(hp.wetBu, 1500);
  near(hp.dryBu, 970.41 + 500);
  near(hp.moisture, (18 * 1000 + 15 * 500) / 1500);
  near(hp.dryBuPerAcre, 1470.41 / 125);
  const sq = rows.find(r => r.field === 'Share Quarter');
  assert.equal(sq.noMoisture, 1); assert.equal(sq.dryBu, 1000); assert.equal(sq.acres, null);
  assert.deepEqual(sq.owners.map(o => [o.owner, o.dryBu]), [['Roenbaugh Farms', 500], ['Landlord A', 500]]);
  assert.equal(R.fieldReport(data, { includeTest: true }).find(r => r.field === 'Home Place').loads, 3);
});

ok('inventory: opening + dry in − out, open contracts, unsold', () => {
  const [r] = R.inventory(data);
  near(r.inDry, 2470.41); assert.equal(r.out, 1000);
  near(r.onHand, 10000 + 2470.41 - 1000);
  assert.equal(r.openContracts, 4000);   // C1 has 4,000 left; C2 is closed
  near(r.unsold, 11470.41 - 4000);
});

ok('inventory: a contract with less than half a load left counts as filled', () => {
  const d = { ...data, allocations: [{ TicketNo: 4, ContractNo: 'C1', Bushels: 4600 }] };
  assert.equal(R.inventory(d)[0].openContracts, 0);
});

ok('bins empty write-off zeroes the book and shows shrink %', () => {
  const book = R.inventory(data)[0].onHand;
  const d = { ...data, adjustments: data.adjustments.concat([{ AdjNo: 2, Type: 'BinsEmpty', Commodity: 'Corn', CropYear: 2026, Bushels: -book, Status: 'Active' }]) };
  assert.equal(R.inventory(d)[0].onHand, 0);
  const [w] = R.writeOffs(d);
  near(w.writeOff, -book);
  near(w.shrinkPct, book / (10000 + 2470.41) * 100);
  const voided = { ...d, adjustments: d.adjustments.map(a => a.AdjNo === 2 ? { ...a, Status: 'Void' } : a) };
  near(R.inventory(voided)[0].onHand, book);
});

// ---------- backend office actions ----------
const ss = testSheet();
const be = loadBackend(ss, { SHEET_ID: 'x', API_KEY: 'k' });
const call = b => be.call({ key: 'k', ...b });
ok('contracts: add, refuse duplicates, edit, close', () => {
  let j = call({ action: 'saveContract', isNew: true, contract: { ContractNo: 'A-100', Buyer: 'The Andersons', Commodity: 'Corn', CropYear: 2026, Bushels: 25000, ShipStart: '2026-12-01', ShipEnd: '2026-12-31', Email: 'x@y.example' } });
  assert.ok(j.ok, j.error);
  j = call({ action: 'saveContract', isNew: true, contract: { ContractNo: 'A-100', Buyer: 'The Andersons', Commodity: 'Corn', CropYear: 2026, Bushels: 1 } });
  assert.match(j.error, /already exists/);
  j = call({ action: 'saveContract', isNew: true, contract: { ContractNo: 'A-101', Buyer: 'The Andersons', Commodity: 'Corn', Bushels: 0 } });
  assert.match(j.error, /more than 0/);
  j = call({ action: 'saveContract', isNew: false, contract: { ContractNo: 'A-100', Buyer: 'The Andersons', Commodity: 'Corn', CropYear: 2026, Bushels: 30000, Status: 'Closed' } });
  assert.ok(j.ok, j.error);
  const d = call({ action: 'officeData' });
  const c = d.contracts.find(x => x.ContractNo === 'A-100');
  assert.equal(c.Bushels, 30000); assert.equal(c.Status, 'Closed');
  assert.equal(call({ action: 'lists' }).contracts.some(x => x.ContractNo === 'A-100'), false);  // closed: not at the scale
});
ok('adjustments: save, require a name, void', () => {
  let j = call({ action: 'saveAdjustment', adjustment: { Type: 'Opening', Commodity: 'Corn', CropYear: 2026, Bushels: 5000, By: 'Chris' } });
  assert.ok(j.ok, j.error); assert.equal(j.adjNo, 1);
  j = call({ action: 'saveAdjustment', adjustment: { Type: 'BinsEmpty', Commodity: 'Corn', CropYear: 2026, Bushels: -812.4, BookBefore: 812.4, By: '' } });
  assert.match(j.error, /who/);
  j = call({ action: 'saveAdjustment', adjustment: { Type: 'BinsEmpty', Commodity: 'Corn', CropYear: 2026, Bushels: -812.4, BookBefore: 812.4, By: 'Chris', Note: 'bins swept' } });
  assert.equal(j.adjNo, 2);
  let d = call({ action: 'officeData' });
  assert.equal(d.adjustments.length, 2); assert.equal(d.adjustments[1].BookAfter, 0);
  assert.ok(call({ action: 'voidAdjustment', adjNo: 2, by: 'Chris' }).ok);
  d = call({ action: 'officeData' });
  assert.equal(d.adjustments.length, 1);
});
console.log(`\n${n} passed`);
