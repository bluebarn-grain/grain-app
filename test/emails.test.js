// Nightly buyer emails. Run: TZ=UTC node test/emails.test.js
const assert = require('assert');
const { loadBackend, testSheet } = require('./mock-gas.js');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok -', name); };

const ss = testSheet();
const S = ss.sheets;
S.Customers.data[2][5] = 'logistics@andersons.example, merch@andersons.example';   // The Andersons
S.Settings.data.push(['OfficeEmail', 'office@bblc.example', '']);
S.Contracts.data[1][4] = 3000;  // TEST-C1 corn, 3,000 bu
const be = loadBackend(ss, { SHEET_ID: 'x', API_KEY: 'k' });
const out = (no, at, bu, extra = {}) => ({ no, dir: 'OUT', status: 'Closed', bol: 9000000 + no % 1000, commodity: 'Corn', cropYear: 2026, buyer: 'The Andersons', contractNo: 'TEST-C1', truck: 'T' + no, gross: 87140, tare: 27140, net: Math.round(bu * 56), wetBu: bu, timeIn: at, timeOut: at, ...extra });
be.call({ action: 'saveTickets', key: 'k', tickets: [
  out(900001, '2026-11-11T15:00:00Z', 1000), out(900002, '2026-11-11T18:00:00Z', 1000),
  out(900003, '2026-11-11T19:00:00Z', 500, { contractNo: 'TBD' }),
  out(900004, '2026-11-11T20:00:00Z', 500, { test: true }),
  { no: 900005, dir: 'IN', status: 'Closed', loadNo: 1, commodity: 'Corn', cropYear: 2026, field: 'TEST Home Place', gross: 1, tare: 0, net: 1, wetBu: 0.02, timeOut: '2026-11-11T19:30:00Z' }
] });

const at7 = new Date('2026-11-12T01:00:00Z'); // 7 pm Central, Nov 11
let r;
ok('night 1: one email to the buyer, plus a fix-it note to the office', () => {
  r = be.ctx.nightlyEmails_(ss, at7, false);
  assert.equal(r.sent.length, 1);
  const m = be.sent[0];
  assert.equal(m.to, 'logistics@andersons.example, merch@andersons.example');
  assert.equal(m.name, 'BBL&C');
  assert.match(m.subject, /^BBL&C shipped 2 loads today — Contract TEST-C1, Corn$/);
  assert.match(m.body, /Today: 2 loads, 2,000.00 bu/);
  assert.match(m.body, /Shipped to date: 2 loads, 2,000.00 bu of 3,000 bu/);
  assert.match(m.body, /Remaining: 1,000.00 bu, about 1 more load at/);
  assert.match(m.body, /BBL&C\n2949 S Road/);
  assert.equal(m.attachments[0].data.split('\n').length, 3);   // header + 2 tickets; test, TBD and inbound left out
  assert.match(be.sent[1].subject, /1 thing\(s\) to fix/);
  assert.match(be.sent[1].body, /Ticket 900003/);
  console.log('\n' + m.subject + '\n\n' + m.body + '\n');
});
ok('rerun the same night sends nothing new to the buyer', () => {
  be.sent.length = 0; r = be.ctx.nightlyEmails_(ss, at7, false);
  assert.equal(r.sent.length, 0);
});
ok('late truck after 7 pm + TBD ticket fixed go out next night; contract complete', () => {
  be.call({ action: 'saveTickets', key: 'k', tickets: [out(900006, '2026-11-12T02:30:00Z', 600)] }); // 8:30 pm Nov 11
  const tk = S.Tickets.data, col = tk[0].indexOf('ContractNo');
  tk.find(row => row[0] === 900003)[col] = 'TEST-C1';
  be.sent.length = 0;
  r = be.ctx.nightlyEmails_(ss, new Date('2026-11-13T01:00:00Z'), false);
  const m = be.sent[0];
  assert.match(m.subject, /2 loads today .*\(complete!\)/);
  assert.match(m.body, /Complete — over by 100.00 bu/); assert.match(m.body, /Thanks for the business,/);
  console.log('\n' + m.subject + '\n\n' + m.body + '\n');
});
ok('no shipments, no email', () => {
  be.sent.length = 0; r = be.ctx.nightlyEmails_(ss, new Date('2026-11-14T01:00:00Z'), false);
  assert.equal(be.sent.length, 0);
});
ok('preview goes only to the office and includes test tickets', () => {
  be.sent.length = 0; r = be.ctx.nightlyEmails_(ss, at7, true);
  assert.ok(be.sent.every(m => m.to === 'office@bblc.example'));
  assert.match(be.sent[0].subject, /^\[PREVIEW for logistics@/);
});
ok('banter tab created and lines rotate day to day', () => {
  assert.ok(S.Banter.data.length > 15);
  const b = be.ctx.banter_(ss); const a = be.ctx.pick_(b.Opener, 100, 'x'), c = be.ctx.pick_(b.Opener, 101, 'x');
  assert.notEqual(a, c);
});

// ---------- contract roll-over ----------
const P = require('../parsers.js');
ok('whole loads: 501 left keeps the load, 499 left rolls it, ship window ignored', () => {
  const cs = [
    { ContractNo: 'A', Buyer: 'X', Commodity: 'Corn', Bushels: 1000, ShipStart: new Date('2026-11-01') },
    { ContractNo: 'C', Buyer: 'X', Commodity: 'Corn', Bushels: 1000, ShipStart: new Date('2027-03-01') },
    { ContractNo: 'B', Buyer: 'X', Commodity: 'Corn', Bushels: 1000, ShipStart: new Date('2026-12-01') },
    { ContractNo: 'S', Buyer: 'X', Commodity: 'Sorghum', Bushels: 1000 },
    { ContractNo: 'Y', Buyer: 'Other', Commodity: 'Corn', Bushels: 1000 }];
  assert.deepEqual(P.applyToContracts(1000, 'A', cs, { A: 499 }), { parts: [{ contractNo: 'A', bu: 1000, rolled: false }], over: 0 });  // 501 left
  assert.deepEqual(P.applyToContracts(1000, 'A', cs, { A: 501 }), { parts: [{ contractNo: 'B', bu: 1000, rolled: true }], over: 0 });   // 499 left -> B (Dec) before C (Mar)
  assert.deepEqual(P.applyToContracts(1000, 'A', cs, { A: 600, B: 800 }).parts[0].contractNo, 'C');
  const full = P.applyToContracts(1000, 'A', cs, { A: 900, B: 1000, C: 1000 });
  assert.deepEqual(full, { parts: [{ contractNo: 'A', bu: 1000, rolled: false }], over: 900 });
});
ok('roll-over: backend copy matches the app copy', () => {
  const ss2 = testSheet(); const be2 = loadBackend(ss2, { SHEET_ID: 'x', API_KEY: 'k' });
  for (let i = 0; i < 300; i++) {
    const cs = [1, 2, 3].map(k => ({ ContractNo: 'K' + k, Buyer: 'X', Commodity: 'Corn', Bushels: Math.round(Math.random() * 2000), ShipStart: Math.random() < .3 ? '' : new Date(2026, 10, Math.ceil(Math.random() * 28)), Status: Math.random() < .1 ? 'Closed' : 'Open' }));
    const applied = { K1: Math.random() * 2000, K2: Math.random() * 500 };
    const bu = Math.round(Math.random() * 120000) / 100;
    assert.deepEqual(JSON.parse(JSON.stringify(be2.ctx.applyToContracts(bu, 'K1', cs, applied))), P.applyToContracts(bu, 'K1', cs, applied));
  }
});
ok('roll-over end to end: whole load moves, filled contract is complete, email explains it', () => {
  const ss3 = testSheet(), T = ss3.sheets;
  T.Customers.data[2][5] = 'buyer@andersons.example';
  T.Contracts.data[1][4] = 1500;  // TEST-C1 1,500 bu
  T.Contracts.data.push(['TEST-C3', 'The Andersons', 'Corn', 2026, 5000, new Date('2027-02-01'), '', 'Open', '']);
  const b3 = loadBackend(ss3, { SHEET_ID: 'x', API_KEY: 'k' });
  // second truck: TEST-C1 has 499 left, so the scale put it on TEST-C3
  const j = b3.call({ action: 'saveTickets', key: 'k', tickets: [out(900001, '2026-11-11T15:00:00Z', 1001), out(900002, '2026-11-11T16:00:00Z', 1000, { contractNo: 'TEST-C3', rolledFrom: 'TEST-C1' })] });
  assert.equal(j.warnings.length, 0);
  assert.deepEqual(T.TicketContracts.data.slice(1).map(r => r.slice(0, 4)), [[900001, 'TEST-C1', 1001, false], [900002, 'TEST-C3', 1000, true]]);
  // a TBD ticket assigned later to the filled contract also rolls
  const j2 = b3.call({ action: 'saveTickets', key: 'k', tickets: [out(900003, '2026-11-11T17:00:00Z', 1000)] });
  assert.equal(T.TicketContracts.data[3][1], 'TEST-C3');
  b3.ctx.nightlyEmails_(ss3, new Date('2026-11-12T01:00:00Z'), false);
  const m = b3.sent[0];
  assert.match(m.subject, /shipped 3 loads today — 2 contracts \(TEST-C1 complete!\)/);
  assert.match(m.body, /Complete — 499.00 bu short/);
  assert.match(m.body, /Ticket 900002 went on this contract because TEST-C1 filled/);
  console.log('\n' + m.subject + '\n\n' + m.body + '\n');
});
console.log(`\n${n} passed`);
