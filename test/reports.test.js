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
  customers: [{ Customer: 'Roenbaugh Farms', Type: 'Operator' }, { Customer: 'Landlord A', Type: 'Landlord' }, { Customer: 'The Andersons', Type: 'Buyer' }],
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

ok('discount schedule math: per point, handling, drying, test weight', () => {
  const d = { ...data, commodities: [{ Commodity: 'Corn', LbPerBu: 56, StdMoisturePct: 15.5, ShrinkMethod: 'PerPoint', ShrinkPerPoint: 1.4, HandlingShrinkPct: 0.5, DryingPerPoint: 0.03, BaseTestWeight: 54, TWDiscountPerLb: 0.02 }] };
  const m = R.shrinkMath(d, 'Corn', 1000, 18, 52);
  assert.equal(m.shrinkPct, 4);          // 2.5 points × 1.4% + 0.5% handling
  assert.equal(m.dryBu, 960);
  assert.equal(m.dryingCharge, 75);      // 2.5 × $0.03 × 1000
  assert.equal(m.twDiscount, 38.4);      // 2 lb × $0.02 × 960
  assert.ok(m.steps.some(s => /2.5 × 1.4% = 3.5%/.test(s[1])));
  const w = R.shrinkMath(data, 'Corn', 1000, 18, '');   // default water shrink
  near(w.dryBu, 970.41);
  const under = R.shrinkMath(d, 'Corn', 1000, 15, 56);
  assert.equal(under.dryBu, 1000); assert.equal(under.totalDiscount, 0);
  // the reports use the schedule too
  const rows = R.fieldReport({ ...d, tickets: data.tickets });
  near(rows.find(r => r.field === 'Home Place').dryBu, 960 + 500);
});

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
  assert.deepEqual(R.fieldReport(data, { field: 'Share Quarter' }).map(r => r.field), ['Share Quarter']);
});

ok('inventory: opening + dry in − out, open contracts, unsold', () => {
  const [r] = R.inventory(data);
  near(r.inDry, 2470.41); assert.equal(r.out, 1000);
  near(r.onHand, 10000 + 2470.41 - 1000);
  assert.equal(r.openContracts, 4000);   // C1 has 4,000 left; C2 is closed
  assert.deepEqual(r.owners.map(o => [o.owner, o.balance]), [['Roenbaugh Farms', 10970.41], ['Landlord A', 500]]);
  assert.equal(r.landlordHeld, 500);
  near(r.unsold, 10970.41 - 4000);        // landlord grain isn't the farm's to sell
});

ok('buying landlord grain moves it to the farm; total on hand unchanged', () => {
  const d = { ...data, purchases: [{ PurchaseNo: 1, Seller: 'Landlord A', Commodity: 'Corn', CropYear: 2026, Bushels: 300, PricePerBu: 4.1, Status: 'Active' }] };
  const [r] = R.inventory(d);
  near(r.onHand, 11470.41);
  assert.deepEqual(r.owners.map(o => [o.owner, o.balance]), [['Roenbaugh Farms', 11270.41], ['Landlord A', 200]]);
  const [l] = R.landlordGrain(d);
  assert.deepEqual([l.landlord, l.delivered, l.bought, l.stillTheirs], ['Landlord A', 500, 300, 200]);
  const all = { ...d, purchases: d.purchases.concat([{ PurchaseNo: 2, Seller: 'Landlord A', Commodity: 'Corn', CropYear: 2026, Bushels: 200, Status: 'Active' }]) };
  assert.equal(R.inventory(all)[0].landlordHeld, 0);
  assert.equal(R.landlordGrain(all)[0].stillTheirs, 0);
});

ok('opening balance can belong to a landlord', () => {
  const d = { ...data, adjustments: data.adjustments.concat([{ AdjNo: 3, Type: 'Opening', Owner: 'Landlord A', Commodity: 'Corn', CropYear: 2026, Bushels: 1000, Status: 'Active' }]) };
  const [r] = R.inventory(d);
  assert.equal(r.owners.find(o => o.owner === 'Landlord A').balance, 1500);
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

ok('pricing: priced, partly priced, unpriced, average flat, shipped unpriced', () => {
  const d = { ...data, pricing: [
    { PricingNo: 1, ContractNo: 'C1', Bushels: 2000, Futures: 4.40, Basis: -0.35, Fees: 0.02, FlatPrice: 4.03, Status: 'Active' },
    { PricingNo: 2, ContractNo: 'C1', Bushels: 1000, Futures: 4.60, Basis: -0.30, Fees: 0, FlatPrice: 4.30, Status: 'Active' },
    { PricingNo: 3, ContractNo: 'C1', Bushels: 1500, Basis: -0.30, FlatPrice: '', Status: 'Active' },
    { PricingNo: 4, ContractNo: 'C1', Bushels: 500, FlatPrice: 5, Status: 'Void' }] };
  const p = R.contractPricing(d).C1;
  assert.deepEqual([p.priced, p.partial, p.unpriced], [3000, 1500, 500]);
  assert.equal(p.avgFlat, 4.12);              // (2000×4.03 + 1000×4.30) / 3000
  assert.equal(p.shippedUnpriced, 0);         // 1,000 shipped, 3,000 priced
  const none = R.contractPricing(data).C1;
  assert.equal(none.shippedUnpriced, 1000); assert.equal(none.avgFlat, null);
  assert.equal(R.inventory(data)[0].shippedUnpriced, 1000);
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
ok('purchases: save with price, landlord only, void', () => {
  call({ action: 'saveCustomer', isNew: true, customer: { Customer: 'Jones Ag', Type: 'Landlord' } });
  let j = call({ action: 'savePurchase', purchase: { Seller: 'Jones Ag', Commodity: 'Corn', CropYear: 2026, Bushels: 1250.5, PricePerBu: 4.1525, By: 'Chris', Date: '2026-11-11' } });
  assert.ok(j.ok, j.error);
  assert.match(call({ action: 'savePurchase', purchase: { Seller: 'The Andersons', Commodity: 'Corn', CropYear: 2026, Bushels: 5, By: 'Chris' } }).error, /not a landlord/);
  assert.match(call({ action: 'savePurchase', purchase: { Seller: 'Jones Ag', Commodity: 'Corn', CropYear: 2026, Bushels: 0, By: 'Chris' } }).error, /more than 0/);
  let p = call({ action: 'officeData' }).purchases;
  assert.equal(p.length, 1); assert.equal(p[0].Amount, 5192.70);
  assert.ok(call({ action: 'voidPurchase', purchaseNo: 1, by: 'Chris' }).ok);
  assert.equal(call({ action: 'officeData' }).purchases.length, 0);
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
ok('pricing lines: add, flat worked out, partial then completed, can\'t over-price, void', () => {
  call({ action: 'saveContract', isNew: true, contract: { ContractNo: 'P-1', Buyer: 'The Andersons', Commodity: 'Corn', CropYear: 2026, Bushels: 10000 } });
  let j = call({ action: 'savePricing', pricing: { ContractNo: 'P-1', Bushels: 5000, FuturesMonth: 'Mar 27', Futures: 4.4525, Basis: -0.38, Fees: 0.015, By: 'Chris' } });
  assert.ok(j.ok, j.error); assert.equal(j.flatPrice, 4.0575);
  j = call({ action: 'savePricing', pricing: { ContractNo: 'P-1', Bushels: 5000, Basis: -0.35, By: 'Chris' } });
  assert.ok(j.ok, j.error); assert.equal(j.flatPrice, '');
  assert.match(call({ action: 'savePricing', pricing: { ContractNo: 'P-1', Bushels: 1, FlatPrice: 4, By: 'Chris' } }).error, /10001 bu on a 10000 bu contract/);
  j = call({ action: 'savePricing', pricing: { PricingNo: 2, ContractNo: 'P-1', Bushels: 5000, FuturesMonth: 'May 27', Futures: 4.55, Basis: -0.35, By: 'Chris' } });
  assert.ok(j.ok, j.error); assert.equal(j.flatPrice, 4.2);
  assert.match(call({ action: 'savePricing', pricing: { ContractNo: 'P-1', Bushels: 5, By: 'Chris' } }).error, /futures, basis, or a flat price/);
  assert.ok(call({ action: 'voidPricing', pricingNo: 1, by: 'Chris' }).ok);
  const pr = call({ action: 'officeData' }).pricing;
  assert.deepEqual(pr.map(x => [x.PricingNo, x.FlatPrice]), [[2, 4.2]]);
});
ok('manual ticket from paper: added with its own number, split, not bumping the scale counter', () => {
  const before = call({ action: 'lists' }).settings.NextTicketNo;
  let j = call({ action: 'addManualTicket', by: 'Chris', ticket: { no: 5012, dir: 'IN', commodity: 'Corn', cropYear: 2026, field: 'TEST Share Quarter', gross: 80000, tare: 24000, moisture: 17.2, tw: 56, truck: 'Cart 2', timeIn: '2026-11-12T14:00:00Z', timeOut: '2026-11-12T14:20:00Z' } });
  assert.ok(j.ok, j.error); assert.equal(j.wetBu, 1000);
  assert.match(call({ action: 'addManualTicket', by: 'Chris', ticket: { no: 5012, dir: 'IN', commodity: 'Corn', cropYear: 2026, field: 'TEST Share Quarter', gross: 80000, tare: 24000 } }).error, /already in the system/);
  assert.match(call({ action: 'addManualTicket', by: 'Chris', ticket: { no: 5013, dir: 'IN', commodity: 'Corn', cropYear: 2026, field: 'X', gross: 100, tare: 200 } }).error, /Gross must be more than tare/);
  const d = call({ action: 'officeData' });
  const t = d.tickets.find(x => x.TicketNo === 5012);
  assert.equal(t.ManualWeight, true); assert.equal(t.PaperTicket, 5012); assert.match(t.Remarks, /paper ticket/);
  assert.deepEqual(d.splits.filter(x => x.TicketNo === 5012).map(x => [x.Owner, x.WetBu]), [['Roenbaugh Farms', 500], ['TEST Landlord A', 500]]);
  assert.equal(call({ action: 'lists' }).settings.NextTicketNo, before);
  assert.equal(d.editLog.filter(x => x.TicketNo === 5012).length, 1);
});
ok('edit ticket: wrong field fixed, split redone, logged; reason and name required', () => {
  assert.match(call({ action: 'editTicket', ticketNo: 5012, by: 'Chris', reason: '', changes: { Field: 'TEST Home Place' } }).error, /why/);
  let j = call({ action: 'editTicket', ticketNo: 5012, by: 'Chris', reason: 'Fat finger: was Home Place', changes: { Field: 'TEST Home Place', GrossLb: 80056 } });
  assert.ok(j.ok, j.error); assert.equal(j.changed, 2);
  const d = call({ action: 'officeData' });
  const t = d.tickets.find(x => x.TicketNo === 5012);
  assert.equal(t.Field, 'TEST Home Place'); assert.equal(t.NetLb, 56056); assert.equal(t.WetBu, 1001);
  assert.deepEqual(d.splits.filter(x => x.TicketNo === 5012).map(x => x.Owner), ['Roenbaugh Farms']);
  assert.match(d.editLog.filter(x => x.TicketNo === 5012).pop().Changes, /Field: TEST Share Quarter → TEST Home Place; Gross: 80000 → 80056/);
});
ok('edit ticket: outbound moved to another buyer/contract re-applies; void drops it everywhere', () => {
  call({ action: 'saveContract', isNew: true, contract: { ContractNo: 'B-9', Buyer: 'TEST Buyer B', Commodity: 'Corn', CropYear: 2026, Bushels: 5000 } });
  call({ action: 'saveTickets', tickets: [{ no: 900777, dir: 'OUT', status: 'Closed', commodity: 'Corn', cropYear: 2026, buyer: 'The Andersons', contractNo: 'P-1', truck: 'T', gross: 84000, tare: 28000, net: 56000, wetBu: 1000, timeOut: '2026-11-12T16:00:00Z' }] });
  let d = call({ action: 'officeData' });
  assert.equal(d.allocations.find(a => a.TicketNo === 900777).ContractNo, 'P-1');
  let j = call({ action: 'editTicket', ticketNo: 900777, by: 'Chris', reason: 'Wrong customer', changes: { Buyer: 'TEST Buyer B' } });
  assert.ok(j.ok, j.error); assert.match(j.changes.join(), /P-1 → TBD/);
  d = call({ action: 'officeData' });
  assert.equal(d.allocations.filter(a => a.TicketNo === 900777).length, 0);
  j = call({ action: 'editTicket', ticketNo: 900777, by: 'Chris', reason: 'Put on B-9', changes: { ContractNo: 'B-9' } });
  d = call({ action: 'officeData' });
  assert.equal(d.allocations.find(a => a.TicketNo === 900777).ContractNo, 'B-9');
  call({ action: 'editTicket', ticketNo: 900777, by: 'Chris', reason: 'Duplicate', changes: { Status: 'Void' } });
  d = call({ action: 'officeData' });
  assert.equal(d.allocations.filter(a => a.TicketNo === 900777).length, 0);
  assert.equal(d.tickets.find(x => x.TicketNo === 900777).Status, 'Void');
});
ok('discount schedule: save a commodity schedule; field legal saved', () => {
  let j = call({ action: 'saveCommodity', isNew: false, commodity: { Commodity: 'Corn', LbPerBu: 56, StdMoisturePct: 15.5, ShrinkMethod: 'PerPoint', ShrinkPerPoint: 1.4, HandlingShrinkPct: 0.5, DryingPerPoint: 0.03, BaseTestWeight: 54, TWDiscountPerLb: 0.02 } });
  assert.ok(j.ok, j.error);
  assert.match(call({ action: 'saveCommodity', isNew: false, commodity: { Commodity: 'Corn', LbPerBu: 56, ShrinkMethod: 'PerPoint' } }).error, /shrink % per point/);
  const c = call({ action: 'officeData' }).commodities.find(x => x.Commodity === 'Corn');
  assert.equal(c.ShrinkMethod, 'PerPoint'); assert.equal(c.HandlingShrinkPct, 0.5);
  assert.ok(call({ action: 'saveField', isNew: true, field: { Field: 'Legal Test', Acres: 80, Section: '12', Township: '26S', Range: '17W', County: 'Kiowa' } }).ok);
  const f = call({ action: 'officeData' }).fields.find(x => x.Field === 'Legal Test');
  assert.deepEqual([f.Section, f.Township, f.Range, f.County, f.Acres], ['12', '26S', '17W', 'Kiowa', 80]);
});
ok('customers: add, refuse duplicate (any case), edit, type required', () => {
  assert.ok(call({ action: 'saveCustomer', isNew: true, customer: { Customer: 'Smith Land LLC', Type: 'Landlord', Phone: '620-555-0101' } }).ok);
  assert.match(call({ action: 'saveCustomer', isNew: true, customer: { Customer: 'smith land llc', Type: 'Landlord' } }).error, /already exists/);
  assert.match(call({ action: 'saveCustomer', isNew: true, customer: { Customer: 'X', Type: '' } }).error, /Buyer, Landlord or Operator/);
  assert.ok(call({ action: 'saveCustomer', isNew: false, customer: { Customer: 'Smith Land LLC', Type: 'Landlord', Phone: '620-555-0199', Active: false } }).ok);
  const c = call({ action: 'officeData' }).customers.find(x => x.Customer === 'Smith Land LLC');
  assert.equal(c.Phone, '620-555-0199'); assert.equal(c.Active, false);
  assert.equal(call({ action: 'lists' }).customers.some(x => x.Customer === 'Smith Land LLC'), false);  // inactive: not at the scale
});
ok('fields: add with acres, acres column added to the tab, edit acres', () => {
  assert.ok(call({ action: 'saveField', isNew: true, field: { Field: 'North Pivot', Acres: 125.5, InsuranceUnit: '0001-0002' } }).ok);
  assert.match(call({ action: 'saveField', isNew: true, field: { Field: 'Bad', Acres: -3 } }).error, /Acres/);
  assert.ok(call({ action: 'saveField', isNew: false, field: { Field: 'North Pivot', Acres: 126 } }).ok);
  const f = call({ action: 'officeData' }).fields.find(x => x.Field === 'North Pivot');
  assert.equal(f.Acres, 126); assert.equal(f.InsuranceUnit, '0001-0002');
});
ok('splits: replace one field-year, must total 100, others untouched, scale sees it', () => {
  assert.match(call({ action: 'saveShares', fieldName: 'North Pivot', cropYear: 2026, shares: [{ Owner: 'Roenbaugh Farms', SharePct: 60 }, { Owner: 'Smith Land LLC', SharePct: 30 }] }).error, /add to 90%/);
  assert.match(call({ action: 'saveShares', fieldName: 'North Pivot', cropYear: 2026, shares: [{ Owner: 'Roenbaugh Farms', SharePct: 50 }, { Owner: 'Roenbaugh Farms', SharePct: 50 }] }).error, /twice/);
  assert.ok(call({ action: 'saveShares', fieldName: 'North Pivot', cropYear: 2026, shares: [{ Owner: 'Roenbaugh Farms', SharePct: 66.667 }, { Owner: 'Smith Land LLC', SharePct: 33.333 }] }).ok);
  assert.ok(call({ action: 'saveShares', fieldName: 'North Pivot', cropYear: 2026, shares: [{ Owner: 'Roenbaugh Farms', SharePct: 50 }, { Owner: 'Smith Land LLC', SharePct: 50 }] }).ok);
  const sh = call({ action: 'lists' }).shares;
  assert.deepEqual(sh.filter(x => x.Field === 'North Pivot').map(x => [x.Owner, x.SharePct]), [['Roenbaugh Farms', 50], ['Smith Land LLC', 50]]);
  assert.equal(sh.filter(x => x.Field === 'TEST Share Quarter').length, 2);   // other fields untouched
  assert.ok(call({ action: 'saveShares', fieldName: 'North Pivot', cropYear: 2026, shares: [] }).ok);   // clearing is allowed
  assert.equal(call({ action: 'lists' }).shares.filter(x => x.Field === 'North Pivot').length, 0);
});
console.log(`\n${n} passed`);
