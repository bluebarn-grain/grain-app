/**
 * Blue Barn Grain — backend (Google Apps Script web app).
 *
 * The scale app sends tickets here; this script writes them into the Google Sheet.
 * Which Sheet it writes to is set by the SHEET_ID script property, so switching from
 * the TEST Sheet to the real one is a one-line change. See README.md for setup.
 */

var PROPS = PropertiesService.getScriptProperties();
var TEST_SHEET_ID = '1PcNarJVBoylGRON6OAX6w4IH8yqJk_0Db-KZo5j8T-k';

var TICKET_COLUMNS = ['TicketNo', 'DateTime', 'Direction', 'Commodity', 'CropYear', 'Field', 'ContractNo', 'Destination',
  'Truck', 'Driver', 'Operator', 'GrossLb', 'TareLb', 'NetLb', 'ManualWeight', 'MoisturePct', 'TestWeight', 'GrainTempF',
  'FMPct', 'WeighBillNo', 'DestNetLb', 'DestMoisturePct', 'DestTestWeight', 'Status', 'Remarks', 'CreatedAt',
  'BOLNo', 'Buyer', 'LoadNo', 'TimeIn', 'TimeOut', 'WetBu', 'GradeSource', 'Station', 'TestTicket', 'SyncedAt', 'RolledFrom'];
var SPLIT_COLUMNS = ['TicketNo', 'Owner', 'SharePct', 'NetLb', 'WetBu'];

/** Run once from the editor: points the backend at the TEST Sheet and makes a key. */
function setupTest() {
  PROPS.setProperty('SHEET_ID', TEST_SHEET_ID);
  if (!PROPS.getProperty('API_KEY')) PROPS.setProperty('API_KEY', Utilities.getUuid());
  var ss = SpreadsheetApp.openById(TEST_SHEET_ID);
  Logger.log('Connected to: ' + ss.getName());
  Logger.log('Backend key (type this into the scale app Settings): ' + PROPS.getProperty('API_KEY'));
}

/** Run when going live. Paste the real Sheet's ID between the quotes first. */
function switchToLive() {
  var LIVE_SHEET_ID = '';
  if (!LIVE_SHEET_ID) throw new Error('Paste the real Sheet ID into switchToLive() first.');
  PROPS.setProperty('SHEET_ID', LIVE_SHEET_ID);
  Logger.log('Now writing to: ' + SpreadsheetApp.openById(LIVE_SHEET_ID).getName());
}

/** Shows the current key and Sheet in the log. */
function showSettings() {
  Logger.log('SHEET_ID: ' + PROPS.getProperty('SHEET_ID'));
  Logger.log('API_KEY: ' + PROPS.getProperty('API_KEY'));
}

function doGet(e) { return handle_((e && e.parameter) || {}); }
function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return out_({ ok: false, error: 'Request was not valid JSON' }); }
  return handle_(body);
}

function handle_(p) {
  var sheetId = PROPS.getProperty('SHEET_ID'), key = PROPS.getProperty('API_KEY');
  if (!sheetId || !key) return out_({ ok: false, error: 'Backend not set up. Run setupTest() in the script editor.' });
  if (p.key !== key) return out_({ ok: false, error: 'Wrong backend key' });
  try {
    var ss = SpreadsheetApp.openById(sheetId);
    switch (p.action) {
      case 'ping': return out_({ ok: true, sheet: ss.getName(), time: new Date().toISOString() });
      case 'lists': return out_(merge_({ ok: true }, lists_(ss)));
      case 'saveTickets': return out_(merge_({ ok: true }, saveTickets_(ss, p.tickets || [], p.station || '')));
      case 'officeData': return out_(merge_({ ok: true }, officeData_(ss)));
      case 'saveContract': return out_(merge_({ ok: true }, saveContract_(ss, p.contract || {}, !!p.isNew)));
      case 'saveAdjustment': return out_(merge_({ ok: true }, saveAdjustment_(ss, p.adjustment || {})));
      case 'saveCustomer': return out_(merge_({ ok: true }, saveCustomer_(ss, p.customer || {}, !!p.isNew)));
      case 'saveField': return out_(merge_({ ok: true }, saveField_(ss, p.field || {}, !!p.isNew)));
      case 'saveShares': return out_(merge_({ ok: true }, saveShares_(ss, p.fieldName, p.cropYear, p.shares || [])));
      case 'savePurchase': return out_(merge_({ ok: true }, savePurchase_(ss, p.purchase || {})));
      case 'voidPurchase': return out_(merge_({ ok: true }, voidPurchase_(ss, p.purchaseNo, p.by)));
      case 'savePricing': return out_(merge_({ ok: true }, savePricing_(ss, p.pricing || {})));
      case 'voidPricing': return out_(merge_({ ok: true }, voidPricing_(ss, p.pricingNo, p.by)));
      case 'addManualTicket': return out_(merge_({ ok: true }, addManualTicket_(ss, p.ticket || {}, p.by)));
      case 'editTicket': return out_(merge_({ ok: true }, editTicket_(ss, p.ticketNo, p.changes || {}, p.by, p.reason)));
      case 'saveCommodity': return out_(merge_({ ok: true }, saveCommodity_(ss, p.commodity || {}, !!p.isNew)));
      case 'readSettlement': return out_(merge_({ ok: true }, readSettlement_(ss, p)));
      case 'saveSettlement': return out_(merge_({ ok: true }, saveSettlement_(ss, p.settlement || {}, p.by)));
      case 'voidSettlement': return out_(merge_({ ok: true }, voidSettlement_(ss, p.settlementId, p.by)));
      case 'voidAdjustment': return out_(merge_({ ok: true }, voidAdjustment_(ss, p.adjNo, p.by)));
      default: return out_({ ok: false, error: 'Unknown action: ' + p.action });
    }
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function merge_(a, b) { for (var k in b) a[k] = b[k]; return a; }

function tab_(ss, name) { var s = ss.getSheetByName(name); if (!s) throw new Error('The Sheet is missing the "' + name + '" tab'); return s; }

/** Rows as objects keyed by header. Skips blank rows. */
function rows_(sh) {
  var v = sh.getDataRange().getValues();
  if (!v.length) return [];
  var h = v.shift().map(String);
  return v.filter(function (r) { return r.some(function (x) { return x !== '' && x !== null; }); })
    .map(function (r) { var o = {}; h.forEach(function (k, i) { if (k) o[k] = r[i]; }); return o; });
}

/** Adds any missing columns to the header row and returns header -> column number. */
function ensureColumns_(sh, cols) {
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  var missing = cols.filter(function (c) { return head.indexOf(c) < 0; });
  if (missing.length) {
    var start = head.filter(String).length ? head.length + 1 : 1;
    if (!head.filter(String).length) head = [];
    sh.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold');
    head = head.concat(missing);
  }
  var map = {};
  head.forEach(function (k, i) { if (k) map[k] = i + 1; });
  return { map: map, width: head.length };
}

function isActive_(v) { return !(v === false || String(v).toUpperCase() === 'FALSE'); }

function lists_(ss) {
  var customers = rows_(tab_(ss, 'Customers')).filter(function (r) { return r.Customer && isActive_(r.Active); });
  var fields = rows_(tab_(ss, 'Fields')).filter(function (r) { return r.Field && isActive_(r.Active); });
  var shares = rows_(tab_(ss, 'Shares')).filter(function (r) { return r.Field && r.Owner; });
  var commodities = rows_(tab_(ss, 'Commodities')).filter(function (r) { return r.Commodity; });
  var settings = {};
  rows_(tab_(ss, 'Settings')).forEach(function (r) { if (r.Key) settings[r.Key] = r.Value; });
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  var applied;
  try { applied = allocatePending_(ss).applied; } finally { lock.releaseLock(); }
  var contracts = rows_(tab_(ss, 'Contracts')).filter(function (r) { return r.ContractNo && String(r.Status) !== 'Closed'; })
    .map(function (r) { r.DeliveredBu = Math.round((applied[String(r.ContractNo)] || 0) * 100) / 100; return r; });
  return { customers: customers, fields: fields, shares: shares, commodities: commodities, settings: settings, contracts: contracts };
}

function splitNet_(netLb, lbPerBu, shares) {
  var left = netLb;
  return shares.map(function (s, i) {
    var lb = i === shares.length - 1 ? left : Math.round(netLb * s.pct / 100);
    left -= lb;
    return { owner: s.owner, pct: s.pct, netLb: lb, wetBu: Math.round(lb / lbPerBu * 100) / 100 };
  });
}

/** Writes tickets. Safe to call twice with the same ticket: already-saved numbers are skipped. */
function saveTickets_(ss, tickets, station) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var tsh = tab_(ss, 'Tickets'), ssh = tab_(ss, 'TicketSplits');
    var tc = ensureColumns_(tsh, TICKET_COLUMNS), sc = ensureColumns_(ssh, SPLIT_COLUMNS);
    var existing = {};
    if (tsh.getLastRow() > 1) {
      tsh.getRange(2, tc.map.TicketNo, tsh.getLastRow() - 1, 1).getValues().forEach(function (r) { if (r[0] !== '') existing[Number(r[0])] = true; });
    }
    var shareRows = rows_(tab_(ss, 'Shares'));
    var lbBu = {};
    rows_(tab_(ss, 'Commodities')).forEach(function (c) { lbBu[c.Commodity] = Number(c.LbPerBu) || 56; });
    var now = new Date(), saved = [], warnings = [], tOut = [], sOut = [], maxNo = 0, maxBol = 0;

    tickets.forEach(function (t) {
      var no = Number(t.no);
      if (!no) return;
      if (!t.manual) maxNo = Math.max(maxNo, no);
      if (existing[no]) { saved.push(no); return; }
      var row = new Array(tc.width).fill('');
      var set = function (k, v) { if (tc.map[k]) row[tc.map[k] - 1] = (v === null || v === undefined) ? '' : v; };
      set('TicketNo', no); set('DateTime', t.timeOut ? new Date(t.timeOut) : (t.timeIn ? new Date(t.timeIn) : now));
      set('Direction', t.dir); set('Commodity', t.commodity); set('CropYear', t.cropYear); set('Field', t.field);
      set('ContractNo', t.contractNo); set('Destination', t.buyer); set('Buyer', t.buyer);
      set('Truck', t.truck); set('Driver', t.driver); set('Operator', t.operator);
      set('GrossLb', t.gross); set('TareLb', t.tare); set('NetLb', t.net); set('WetBu', t.wetBu); set('ManualWeight', !!t.manual);
      set('MoisturePct', t.moisture); set('TestWeight', t.tw); set('GrainTempF', t.temp); set('FMPct', t.fm); set('GradeSource', t.gradeSource);
      set('Status', t.status); set('Remarks', t.remarks); set('CreatedAt', t.timeIn ? new Date(t.timeIn) : now);
      set('BOLNo', t.bol); set('LoadNo', t.loadNo); set('TimeIn', t.timeIn ? new Date(t.timeIn) : '');
      set('TimeOut', t.timeOut ? new Date(t.timeOut) : ''); set('Station', t.station || station); set('TestTicket', !!t.test); set('SyncedAt', now); set('RolledFrom', t.rolledFrom);
      tOut.push(row);

      if (t.dir === 'IN' && t.status === 'Closed') {
        var sh = shareRows.filter(function (s) { return s.Field === t.field && String(s.CropYear) === String(t.cropYear); })
          .map(function (s) { return { owner: s.Owner, pct: Number(s.SharePct) }; });
        var total = sh.reduce(function (a, s) { return a + s.pct; }, 0);
        if (!sh.length || Math.abs(total - 100) > 0.001) {
          warnings.push('Ticket ' + no + ': ' + (sh.length ? 'shares for ' + t.field + ' ' + t.cropYear + ' add to ' + total + '%, not 100%' : 'no shares set for ' + t.field + ' ' + t.cropYear) + '. Recorded as UNASSIGNED; fix the Shares tab.');
          sh = [{ owner: 'UNASSIGNED', pct: 100 }];
        }
        splitNet_(Number(t.net) || 0, lbBu[t.commodity] || 56, sh).forEach(function (s) {
          var r = new Array(sc.width).fill('');
          r[sc.map.TicketNo - 1] = no; r[sc.map.Owner - 1] = s.owner; r[sc.map.SharePct - 1] = s.pct;
          r[sc.map.NetLb - 1] = s.netLb; r[sc.map.WetBu - 1] = s.wetBu;
          sOut.push(r);
        });
      }
      existing[no] = true;
      saved.push(no);
    });

    if (tOut.length) tsh.getRange(tsh.getLastRow() + 1, 1, tOut.length, tc.width).setValues(tOut);
    if (sOut.length) ssh.getRange(ssh.getLastRow() + 1, 1, sOut.length, sc.width).setValues(sOut);
    bumpSetting_(ss, 'NextTicketNo', maxNo + 1);
    warnings = warnings.concat(allocatePending_(ss).warnings);
    return { saved: saved, warnings: warnings };
  } finally {
    lock.releaseLock();
  }
}

/** Raises a Settings value to at least n (never lowers it). */
function bumpSetting_(ss, key, n) {
  if (!n || n < 2) return;
  var sh = tab_(ss, 'Settings'), v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) {
    if (v[i][0] === key) { if (!(Number(v[i][1]) >= n)) sh.getRange(i + 1, 2).setValue(n); return; }
  }
  sh.appendRow([key, n, 'Kept up to date by the scale app']);
}

/* ---- contract allocation (keep identical to the copy in parsers.js) ---- */
// The chosen contract, then the same buyer's other open contracts for the same commodity,
// earliest shipment start first. Shipment windows don't block a roll-over.
function contractChain(chosen, contracts) {
const first = contracts.find(c => String(c.ContractNo) === String(chosen));
if (!first) return [];
const start = c => { const d = c.ShipStart ? new Date(c.ShipStart).getTime() : NaN; return isNaN(d) ? Infinity : d; };
const rest = contracts.filter(c => c !== first && String(c.Status) !== 'Closed' && c.Buyer === first.Buyer && c.Commodity === first.Commodity)
  .sort((a, b) => (start(a) - start(b)) || String(a.ContractNo).localeCompare(String(b.ContractNo)));
return [first].concat(rest);
}
// Whole loads only. The load goes on the first contract in the chain that has at least half
// the load left (a ~1,000 bu truck: 500+ left stays, 499 rolls to the next contract).
// If none does, it stays on the chosen contract and the excess comes back as "over".
function applyToContracts(bu, chosen, contracts, applied) {
  const chain = contractChain(chosen, contracts);
  if (!chain.length) return { parts: [], over: 0 };
  const load = Math.round(Number(bu || 0) * 100);
  const room = c => Math.round(Number(c.Bushels || 0) * 100) - Math.round(Number(applied[String(c.ContractNo)] || 0) * 100);
  let target = chain.find(c => room(c) * 2 >= load), over = 0;
  if (!target) { target = chain[0]; over = (load - Math.max(0, room(target))) / 100; }
  return { parts: [{ contractNo: String(target.ContractNo), bu: load / 100, rolled: target !== chain[0] }], over };
}

var ALLOC_COLUMNS = ['TicketNo', 'ContractNo', 'Bushels', 'RolledOver'];

/**
 * Applies every closed outbound ticket that has a contract but isn't applied yet, in ticket order.
 * Results go to the TicketContracts tab (one row per ticket per contract). The office can edit
 * those rows by hand; a ticket that already has rows is never re-applied.
 * Caller holds the script lock.
 */
function allocatePending_(ss) {
  var ash = ss.getSheetByName('TicketContracts');
  if (!ash) { ash = ss.insertSheet('TicketContracts'); }
  var ac = ensureColumns_(ash, ALLOC_COLUMNS);
  var applied = {}, done = {};
  rows_(ash).forEach(function (a) {
    if (a.TicketNo === '' || a.TicketNo == null) return;
    done[String(a.TicketNo)] = true;
    applied[String(a.ContractNo)] = (applied[String(a.ContractNo)] || 0) + Number(a.Bushels || 0);
  });
  var contracts = rows_(tab_(ss, 'Contracts')).filter(function (c) { return c.ContractNo; });
  var known = {}; contracts.forEach(function (c) { known[String(c.ContractNo)] = true; });
  var pend = rows_(tab_(ss, 'Tickets')).filter(function (t) {
    var c = String(t.ContractNo || '');
    return t.Direction === 'OUT' && t.Status === 'Closed' && c && c !== 'TBD' && known[c] && !done[String(t.TicketNo)];
  }).sort(function (a, b) { return Number(a.TicketNo) - Number(b.TicketNo); });
  var rowsOut = [], warnings = [];
  pend.forEach(function (t) {
    var r = applyToContracts(t.WetBu, t.ContractNo, contracts, applied);
    r.parts.forEach(function (p) {
      applied[p.contractNo] = (applied[p.contractNo] || 0) + p.bu;
      var row = new Array(ac.width).fill('');
      row[ac.map.TicketNo - 1] = Number(t.TicketNo); row[ac.map.ContractNo - 1] = p.contractNo;
      row[ac.map.Bushels - 1] = p.bu; row[ac.map.RolledOver - 1] = p.rolled || !!t.RolledFrom;
      rowsOut.push(row);
    });
    if (r.over > 0) warnings.push('Ticket ' + t.TicketNo + ': ' + t.ContractNo + ' and the buyer\'s other contracts are full. ' + r.over.toFixed(2) + ' bu over on ' + t.ContractNo + '.');
  });
  if (rowsOut.length) ash.getRange(ash.getLastRow() + 1, 1, rowsOut.length, ac.width).setValues(rowsOut);
  return { applied: applied, warnings: warnings };
}

/** Ticket number -> [{contractNo, bu, rolled}] from the TicketContracts tab. */
function allocations_(ss) {
  var by = {}, sh = ss.getSheetByName('TicketContracts');
  if (sh) rows_(sh).forEach(function (a) {
    if (a.TicketNo === '' || a.TicketNo == null) return;
    (by[String(a.TicketNo)] = by[String(a.TicketNo)] || []).push({ contractNo: String(a.ContractNo), bu: Number(a.Bushels || 0), rolled: isTrue_(a.RolledOver) });
  });
  return by;
}

/* ======================================================================
 * Nightly shipment emails to buyers
 *
 * Every night at 7 pm, each buyer that shipped grain that day gets one email:
 * a block per contract (today, to date, remaining) plus the day's tickets, with
 * a CSV attached. Banter lines rotate from the "Banter" tab so they don't repeat.
 *
 * Who gets it: the Email column on the Customers tab (several addresses can be
 * separated by commas). An Email on a Contracts row overrides that for the contract.
 * Problems (no email for a buyer, tickets with no contract) go to Settings → OfficeEmail.
 *
 * Setup: run setupNightlyEmails() once from the editor. Run previewNightlyEmails()
 * any time to send today's emails to OfficeEmail only (test tickets included).
 * ==================================================================== */

var SIGNATURE = ['BBL&C', '2949 S Road · Haviland, KS 67059 · 620-995-4245'];
var DEFAULT_BANTER = [
  ['Opener', 'Good news: you hauled grain out of Blue Barn today!'],
  ['Opener', 'The trucks rolled, the scale worked, and the grain is yours.'],
  ['Opener', 'Another productive day of moving our grain into your bins.'],
  ['Opener', 'Your trucks were here so often today we started naming them.'],
  ['Opener', 'The scale got a workout today, courtesy of your trucks.'],
  ['Payment', 'We look forward to payment. We accept cash. And, well… cash.'],
  ['Payment', 'Payment terms: soon. Preferred method: also soon.'],
  ['Payment', 'Our accountant asked us to mention payment. Consider it mentioned.'],
  ['Payment', 'We looked into taking crypto and decided that was a bad plan. Checks are fine.'],
  ['Payment', 'Grain left, money hasn\'t arrived yet. We trust this will sort itself out.'],
  ['SignOff', 'See you on the next load,'],
  ['SignOff', 'Keep \'em coming,'],
  ['SignOff', 'Until tomorrow\'s trucks,'],
  ['Complete', 'That\'s a wrap on this contract. Every last bushel is yours now.'],
  ['Complete', 'Contract complete. The bins are lighter and our hopes for prompt payment are higher.'],
  ['Complete', 'Done and done. It was a pleasure watching your trucks leave full.'],
  ['Complete', 'Last load is out. Please direct all remaining enthusiasm toward the check.'],
  ['Complete', 'Contract filled. If you\'d like to buy more, we know a farm.']
];

/** Run once from the editor: makes the 7 pm trigger and the Banter tab. */
function setupNightlyEmails() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'sendNightlyEmails') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sendNightlyEmails').timeBased().atHour(19).nearMinute(0).everyDays(1).inTimezone('America/Chicago').create();
  var ss = SpreadsheetApp.openById(PROPS.getProperty('SHEET_ID'));
  banter_(ss);
  Logger.log('Nightly buyer emails will send at 7 pm Central. Put buyer emails on the Customers tab and your address in Settings → OfficeEmail.');
}

/** Trigger entry point. */
function sendNightlyEmails() {
  var id = PROPS.getProperty('SHEET_ID'), ss = SpreadsheetApp.openById(id);
  // On the TEST sheet, test tickets count and every email goes only to OfficeEmail, never to a buyer.
  return nightlyEmails_(ss, new Date(), false, id === TEST_SHEET_ID);
}

/** Sends today's emails to OfficeEmail only, test tickets included. Nothing is logged as sent. */
function previewNightlyEmails() {
  var ss = SpreadsheetApp.openById(PROPS.getProperty('SHEET_ID'));
  return nightlyEmails_(ss, new Date(), true);
}

function isTrue_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
var TZ = 'America/Chicago';
function day_(d) { return Utilities.formatDate(new Date(d), TZ, 'yyyy-MM-dd'); }
function n2_(x) { return Number(x || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function n0_(x) { return Math.round(Number(x || 0)).toLocaleString('en-US'); }
function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

/** Banter lines by type. Creates the tab with the starter lines if it's missing. */
function banter_(ss) {
  var sh = ss.getSheetByName('Banter');
  if (!sh) {
    sh = ss.insertSheet('Banter');
    sh.getRange(1, 1, 1, 3).setValues([['Type', 'Line', 'Active']]).setFontWeight('bold');
    sh.getRange(2, 1, DEFAULT_BANTER.length, 3).setValues(DEFAULT_BANTER.map(function (r) { return [r[0], r[1], true]; }));
  }
  var by = { Opener: [], Payment: [], SignOff: [], Complete: [] };
  rows_(sh).forEach(function (r) { if (r.Line && isActive_(r.Active) && by[r.Type]) by[r.Type].push(String(r.Line)); });
  DEFAULT_BANTER.forEach(function (r) { if (!by[r[0]].length) by[r[0]].push(r[1]); });
  return by;
}
/** Same line all day, next one tomorrow; different buyers start at different spots. */
function pick_(list, dayNo, salt) {
  var h = 0; String(salt || '').split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) % 9973; });
  return list[(dayNo + h) % list.length];
}

function nightlyEmails_(ss, now, preview, testEnv) {
  var today = day_(now), dayNo = Math.floor(new Date(today + 'T12:00:00Z').getTime() / 86400000);
  var settings = {}; rows_(tab_(ss, 'Settings')).forEach(function (r) { if (r.Key) settings[r.Key] = r.Value; });
  var office = String(settings.OfficeEmail || '').trim();
  var emails = {}; rows_(tab_(ss, 'Customers')).forEach(function (c) { if (c.Customer) emails[c.Customer] = String(c.Email || '').trim(); });
  var contracts = {}; rows_(tab_(ss, 'Contracts')).forEach(function (c) { if (c.ContractNo) contracts[String(c.ContractNo)] = c; });
  var banter = banter_(ss);
  var halfLoad = (Number(settings.TypicalLoadBu) || 1000) / 2;

  var out = rows_(tab_(ss, 'Tickets')).filter(function (t) {
    return t.Direction === 'OUT' && t.Status === 'Closed' && (preview || testEnv || !isTrue_(t.TestTicket));
  });
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try { allocatePending_(ss); } finally { lock.releaseLock(); }
  var alloc = allocations_(ss);
  var toDate = {}, loadsToDate = {}, truckBu = {};
  out.forEach(function (t) {
    (alloc[String(t.TicketNo)] || []).forEach(function (p) {
      toDate[p.contractNo] = (toDate[p.contractNo] || 0) + p.bu;
      loadsToDate[p.contractNo] = (loadsToDate[p.contractNo] || 0) + 1;
      truckBu[p.contractNo] = (truckBu[p.contractNo] || 0) + Number(t.WetBu || 0);
    });
  });
  // Every closed outbound ticket since cutover that hasn't been emailed yet, so a truck
  // weighed after 7 pm or a ticket assigned to a contract later still goes out next time.
  var sentLog = ss.getSheetByName('EmailLog');
  if (!sentLog && !preview) { sentLog = ss.insertSheet('EmailLog'); sentLog.appendRow(['Date', 'Buyer', 'To', 'Contracts', 'Tickets', 'SentAt']); }
  var emailed = {};
  if (sentLog) rows_(sentLog).forEach(function (r) { String(r.Tickets || '').split(/[ ,]+/).forEach(function (n) { if (n) emailed[n] = true; }); });
  var cutover = settings.CutoverDate ? day_(settings.CutoverDate) : '';
  var todays = out.filter(function (t) {
    if (!t.DateTime) return false;
    if (preview) return day_(t.DateTime) === today;
    return !emailed[String(t.TicketNo)] && (!cutover || day_(t.DateTime) >= cutover) && day_(t.DateTime) <= today;
  });

  var problems = [], byBuyer = {};
  todays.forEach(function (t) {
    var parts = alloc[String(t.TicketNo)] || [];
    if (!parts.length) { problems.push('Ticket ' + t.TicketNo + ' (' + (t.Buyer || 'no buyer') + ') has no contract, so it was held back. Put it on a contract and it goes out with the next night\'s email.'); return; }
    parts.forEach(function (p) {
      var c = p.contractNo, k = contracts[c] || {};
      var buyer = k.Buyer || t.Buyer;
      var to = String(k.Email || '').trim() || emails[buyer] || '';
      var key = buyer + '|' + to;
      (byBuyer[key] = byBuyer[key] || { buyer: buyer, to: to, contracts: {} });
      (byBuyer[key].contracts[c] = byBuyer[key].contracts[c] || []).push({ t: t, bu: p.bu, rolledFrom: t.RolledFrom || (p.rolled ? String(t.ContractNo) : '') });
    });
  });

  // TEST sheet only: Settings → TestSendToBuyers = TRUE sends the sample emails to the buyers
  // themselves (subject marked [SAMPLE], OfficeEmail copied) so a buyer can see what they'll get.
  var toBuyers = testEnv && isTrue_(settings.TestSendToBuyers);
  var sent = [];
  Object.keys(byBuyer).forEach(function (key) {
    var g = byBuyer[key];
    if (!g.to && (!testEnv || toBuyers)) { problems.push(g.buyer + ' shipped today but has no email on the Customers tab. Nothing was sent to them.'); return; }
    var msg = buildEmail_(g, contracts, toDate, loadsToDate, truckBu, banter, dayNo, now, halfLoad);
    var to = preview || (testEnv && !toBuyers) ? office : g.to;
    if (!to) return;
    MailApp.sendEmail({
      to: to, name: 'BBL&C', replyTo: office || undefined, cc: toBuyers && office ? office : undefined,
      subject: (preview ? '[PREVIEW for ' + g.to + '] ' : toBuyers ? '[SAMPLE] ' : testEnv ? '[TEST for ' + (g.to || g.buyer) + '] ' : '') + msg.subject,
      body: msg.text, htmlBody: msg.html,
      attachments: [Utilities.newBlob(msg.csv, 'text/csv', 'BBLC tickets ' + today + ' ' + g.buyer + '.csv')]
    });
    if (!preview) sentLog.appendRow([today, g.buyer, g.to, Object.keys(g.contracts).join(', '), msg.ticketNos.join(', '), new Date()]);
    sent.push({ buyer: g.buyer, to: to, subject: msg.subject });
  });

  if (problems.length && office) {
    MailApp.sendEmail({ to: office, name: 'BBL&C scale', subject: (preview ? '[PREVIEW] ' : testEnv ? '[TEST] ' : '') + 'Buyer emails for ' + today + ': ' + problems.length + ' thing(s) to fix', body: problems.join('\n\n') });
  }
  return { sent: sent, problems: problems };
}

function buildEmail_(g, contracts, toDate, loadsToDate, truckBu, banter, dayNo, now, halfLoad) {
  var dateStr = Utilities.formatDate(now, TZ, 'EEEE, MMM d');
  var blocks = [], rows = [], loadsToday = 0, completed = [];
  Object.keys(g.contracts).sort().forEach(function (c) {
    var k = contracts[c] || {}, ts = g.contracts[c].sort(function (a, b) { return Number(a.t.TicketNo) - Number(b.t.TicketNo); });
    var buToday = ts.reduce(function (a, x) { return a + x.bu; }, 0);
    var total = Number(k.Bushels || 0), done = toDate[c] || 0, left = total - done;
    var avg = loadsToDate[c] ? truckBu[c] / loadsToDate[c] : 0;  // average whole truck, not the split piece
    var lines = ['Contract ' + c + ' — ' + (k.Commodity || ts[0].t.Commodity || ''),
      'Today: ' + ts.length + ' load' + (ts.length === 1 ? '' : 's') + ', ' + n2_(buToday) + ' bu',
      'Shipped to date: ' + loadsToDate[c] + ' load' + (loadsToDate[c] === 1 ? '' : 's') + ', ' + n2_(done) + ' bu of ' + n0_(total) + ' bu'];
    var complete = total > 0 && left < halfLoad;  // less than half a load left: no more trucks go on it
    if (!total) lines.push('Remaining: contract bushels not set');
    else if (complete) { lines.push(left < 0 ? 'Complete — over by ' + n2_(-left) + ' bu' : left > 0 ? 'Complete — ' + n2_(left) + ' bu short' : 'Complete'); completed.push(c); }
    else lines.push('Remaining: ' + n2_(left) + ' bu' + (avg ? ', about ' + Math.ceil(left / avg) + ' more load' + (Math.ceil(left / avg) === 1 ? '' : 's') + ' at the average so far' : ''));
    ts.forEach(function (x) {
      if (x.rolledFrom) lines.push('Ticket ' + x.t.TicketNo + ' went on this contract because ' + x.rolledFrom + ' filled');
    });
    if (complete) lines.push(pick_(banter.Complete, dayNo, c));
    blocks.push(lines);
    loadsToday += ts.length;
    ts.forEach(function (x) {
      var t = x.t;
      rows.push([t.TicketNo, Utilities.formatDate(new Date(t.DateTime), TZ, 'MM/dd/yyyy HH:mm'), c, t.Commodity, t.Truck, t.BOLNo, t.GrossLb, t.TareLb, t.NetLb, x.bu.toFixed(2)]);
    });
  });

  var trucks = {}; Object.keys(g.contracts).forEach(function (c) { g.contracts[c].forEach(function (x) { trucks[x.t.TicketNo] = 1; }); }); loadsToday = Object.keys(trucks).length;
  var subject = 'BBL&C shipped ' + loadsToday + ' load' + (loadsToday === 1 ? '' : 's') + ' today — ' +
    (blocks.length === 1 ? 'Contract ' + Object.keys(g.contracts)[0] + ', ' + ((contracts[Object.keys(g.contracts)[0]] || {}).Commodity || '') : blocks.length + ' contracts') +
    (completed.length ? ' (' + (blocks.length > 1 ? completed.join(', ') + ' ' : '') + 'complete!)' : '');
  var opener = pick_(banter.Opener, dayNo, g.buyer), pay = pick_(banter.Payment, dayNo, g.buyer + 'p'), signoff = completed.length === blocks.length ? 'Thanks for the business,' : pick_(banter.SignOff, dayNo, g.buyer + 's');
  var greet = 'Hey ' + String(g.buyer).replace(/^the\s+/i, '') + ' crew,';
  var middle = 'The ticket list (' + dateStr + ') is attached for your diligent and professional staff to review. All weights are from the Blue Barn scale.';

  var text = [greet, '', opener, ''].concat(blocks.map(function (b) { return b.join('\n'); }).join('\n\n'), '', middle, '', pay, '', signoff, '', SIGNATURE.join('\n')).join('\n');

  var head = ['Ticket', 'Date/Time', 'Contract', 'Commodity', 'Truck', 'BOL', 'Gross lb', 'Tare lb', 'Net lb', 'Bushels'];
  var td = 'style="padding:4px 8px;border-bottom:1px solid #ddd;text-align:right"';
  var table = '<table style="border-collapse:collapse;font-size:13px"><tr>' + head.map(function (h) { return '<th ' + td.replace('1px solid #ddd', '2px solid #333') + '>' + h + '</th>'; }).join('') + '</tr>' +
    rows.map(function (r) { return '<tr>' + r.map(function (v, i) { return '<td ' + td + '>' + esc_(i >= 6 && i <= 8 ? n0_(v) : v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>';
  var html = '<div style="font-family:Arial,sans-serif;font-size:15px;color:#222;line-height:1.45">' +
    '<p>' + esc_(greet) + '</p><p>' + esc_(opener) + '</p>' +
    blocks.map(function (b) { return '<p><b>' + esc_(b[0]) + '</b><br>' + b.slice(1).map(esc_).join('<br>') + '</p>'; }).join('') +
    '<p>' + esc_(middle) + '</p>' + table + '<p>' + esc_(pay) + '</p><p>' + esc_(signoff) + '</p><p>' + SIGNATURE.map(esc_).join('<br>') + '</p></div>';

  var csv = [head].concat(rows).map(function (r) { return r.map(function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\n');
  return { subject: subject, text: text, html: html, csv: csv, ticketNos: rows.map(function (r) { return r[0]; }).filter(function (v, i, a) { return a.indexOf(v) === i; }) };
}


/* ======================================================================
 * Office side: everything the reports need, contract entry, inventory adjustments
 * ==================================================================== */

var CONTRACT_COLUMNS = ['ContractNo', 'Buyer', 'Commodity', 'CropYear', 'Bushels', 'ShipStart', 'ShipEnd', 'Status', 'Email', 'Notes'];
var ADJ_COLUMNS = ['AdjNo', 'Date', 'Commodity', 'CropYear', 'Type', 'Bushels', 'BookBefore', 'BookAfter', 'Note', 'By', 'CreatedAt', 'Status', 'Owner'];
var ADJ_TYPES = ['Opening', 'Measured', 'BinsEmpty', 'Other'];

function sheetOrNew_(ss, name, cols) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return { sh: sh, cols: ensureColumns_(sh, cols) };
}

/** Raw data for the office screens. The app does the math so it works offline from the last copy. */
function officeData_(ss) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try { allocatePending_(ss); } finally { lock.releaseLock(); }
  var keep = ['TicketNo', 'DateTime', 'Direction', 'Status', 'Commodity', 'CropYear', 'Field', 'ContractNo', 'Buyer', 'Truck', 'Driver', 'Operator', 'LoadNo',
    'GrossLb', 'TareLb', 'NetLb', 'WetBu', 'MoisturePct', 'TestWeight', 'GrainTempF', 'FMPct', 'BOLNo', 'TestTicket', 'RolledFrom', 'ManualWeight',
    'TimeIn', 'TimeOut', 'Remarks', 'Station', 'PaperTicket', 'EditedAt', 'BuyerTicket'];
  var tickets = rows_(tab_(ss, 'Tickets')).filter(function (t) { return t.TicketNo !== '' && (t.Status === 'Closed' || t.Status === 'Void'); })
    .map(function (t) { var o = {}; keep.forEach(function (k) { o[k] = t[k]; }); return o; });
  var opt = function (name) { var sh = ss.getSheetByName(name); return sh ? rows_(sh) : []; };
  var settings = {}; rows_(tab_(ss, 'Settings')).forEach(function (r) { if (r.Key) settings[r.Key] = r.Value; });
  return {
    tickets: tickets,
    splits: rows_(tab_(ss, 'TicketSplits')),
    allocations: opt('TicketContracts'),
    adjustments: opt('Adjustments').filter(function (a) { return String(a.Status) !== 'Void'; }),
    purchases: opt('Purchases').filter(function (a) { return String(a.Status) !== 'Void'; }),
    pricing: opt('Pricing').filter(function (a) { return String(a.Status) !== 'Void'; }),
    contracts: rows_(tab_(ss, 'Contracts')).filter(function (c) { return c.ContractNo; }),
    customers: rows_(tab_(ss, 'Customers')).filter(function (c) { return c.Customer; }),
    fields: rows_(tab_(ss, 'Fields')).filter(function (f) { return f.Field; }),
    shares: rows_(tab_(ss, 'Shares')).filter(function (r) { return r.Field && r.Owner; }),
    editLog: opt('EditLog').slice(-500),
    backupLog: opt('BackupLog').slice(-5),
    settlements: opt('Settlements').filter(function (a) { return String(a.Status) !== 'Void'; }),
    settlementLines: opt('SettlementLines').filter(function (a) { return String(a.Status) !== 'Void'; }),
    commodities: rows_(tab_(ss, 'Commodities')).filter(function (c) { return c.Commodity; }),
    settings: settings,
    at: new Date().toISOString()
  };
}

function date_(v) {
  if (!v) return '';
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
  var d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : new Date(v);  // a plain date is noon local, so it never shows as the day before
  return isNaN(d) ? '' : d;
}

/** New contract, or changes to one. The contract number can't change once saved. */
function saveContract_(ss, c, isNew) {
  var no = String(c.ContractNo || '').trim();
  if (!no) throw new Error('Contract # is required');
  if (!c.Buyer) throw new Error('Pick a buyer');
  if (!c.Commodity) throw new Error('Pick a commodity');
  var bu = Number(c.Bushels);
  if (!(bu > 0)) throw new Error('Bushels must be more than 0');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var t = sheetOrNew_(ss, 'Contracts', CONTRACT_COLUMNS), sh = t.sh, m = t.cols.map;
    var v = sh.getDataRange().getValues(), at = -1;
    for (var i = 1; i < v.length; i++) if (String(v[i][m.ContractNo - 1]).trim() === no) { at = i + 1; break; }
    if (isNew && at > 0) throw new Error('Contract ' + no + ' already exists');
    if (!isNew && at < 0) throw new Error('Contract ' + no + ' was not found');
    var row = at > 0 ? v[at - 1].slice() : new Array(t.cols.width).fill('');
    while (row.length < t.cols.width) row.push('');
    var set = function (k, val) { row[m[k] - 1] = val; };
    set('ContractNo', no); set('Buyer', c.Buyer); set('Commodity', c.Commodity); set('CropYear', Number(c.CropYear) || '');
    set('Bushels', bu); set('ShipStart', date_(c.ShipStart)); set('ShipEnd', date_(c.ShipEnd));
    set('Status', c.Status === 'Closed' ? 'Closed' : 'Open'); set('Email', String(c.Email || '').trim()); set('Notes', c.Notes || '');
    if (at > 0) sh.getRange(at, 1, 1, t.cols.width).setValues([row]);
    else sh.getRange(sh.getLastRow() + 1, 1, 1, t.cols.width).setValues([row]);
    return { contractNo: no };
  } finally { lock.releaseLock(); }
}

/** Inventory adjustment. Bushels is the change (minus to write off). The app works out BookBefore from its reports. */
function saveAdjustment_(ss, a) {
  if (ADJ_TYPES.indexOf(a.Type) < 0) throw new Error('Unknown adjustment type');
  if (!a.Commodity || !a.CropYear) throw new Error('Pick a commodity and crop year');
  var bu = Math.round(Number(a.Bushels) * 100) / 100;
  if (isNaN(bu) || (bu === 0 && a.Type !== 'BinsEmpty')) throw new Error('Bushels must be a number other than 0');
  if (!String(a.By || '').trim()) throw new Error('Enter who is making the adjustment');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var t = sheetOrNew_(ss, 'Adjustments', ADJ_COLUMNS), sh = t.sh, m = t.cols.map;
    var last = 0; rows_(sh).forEach(function (r) { last = Math.max(last, Number(r.AdjNo) || 0); });
    var row = new Array(t.cols.width).fill('');
    var set = function (k, val) { row[m[k] - 1] = val; };
    var before = Number(a.BookBefore);
    set('AdjNo', last + 1); set('Date', date_(a.Date) || new Date()); set('Commodity', a.Commodity); set('CropYear', Number(a.CropYear));
    set('Type', a.Type); set('Bushels', bu); set('BookBefore', isNaN(before) ? '' : before); set('BookAfter', isNaN(before) ? '' : Math.round((before + bu) * 100) / 100);
    set('Note', a.Note || ''); set('By', String(a.By).trim()); set('CreatedAt', new Date()); set('Status', 'Active');
    set('Owner', a.Type === 'Opening' ? String(a.Owner || '').trim() : '');  // opening grain can belong to a landlord; everything else is the farm's
    sh.getRange(sh.getLastRow() + 1, 1, 1, t.cols.width).setValues([row]);
    return { adjNo: last + 1 };
  } finally { lock.releaseLock(); }
}

/** Undo an adjustment. The row stays in the Sheet marked Void. */
function voidAdjustment_(ss, adjNo, by) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = tab_(ss, 'Adjustments'), m = ensureColumns_(sh, ADJ_COLUMNS).map, v = sh.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) if (Number(v[i][m.AdjNo - 1]) === Number(adjNo)) {
      sh.getRange(i + 1, m.Status).setValue('Void');
      sh.getRange(i + 1, m.Note).setValue(String(v[i][m.Note - 1] || '') + ' [voided by ' + (by || '?') + ' ' + new Date().toLocaleDateString() + ']');
      return { adjNo: Number(adjNo) };
    }
    throw new Error('Adjustment ' + adjNo + ' was not found');
  } finally { lock.releaseLock(); }
}


/* ---- customers, fields and splits ---- */
var CUSTOMER_COLUMNS = ['Customer', 'Type', 'PaysAsName', 'Contact', 'Phone', 'Email', 'Address', 'Active', 'Notes', 'SettlementNotes'];
var FIELD_COLUMNS = ['Field', 'Acres', 'OpsCenterName', 'FSAFarm', 'FSATract', 'InsuranceUnit', 'Active', 'Notes', 'Section', 'Township', 'Range', 'County'];
var CUSTOMER_TYPES = ['Buyer', 'Landlord', 'Operator'];

/** Adds a row or updates the row whose key column matches. The key can't change once saved. */
function upsert_(ss, tabName, cols, keyCol, rec, isNew, what) {
  var key = String(rec[keyCol] || '').trim();
  if (!key) throw new Error(what + ' name is required');
  var t = sheetOrNew_(ss, tabName, cols), sh = t.sh, m = t.cols.map;
  var v = sh.getDataRange().getValues(), at = -1;
  for (var i = 1; i < v.length; i++) if (String(v[i][m[keyCol] - 1]).trim().toLowerCase() === key.toLowerCase()) { at = i + 1; break; }
  if (isNew && at > 0) throw new Error(what + ' "' + key + '" already exists');
  if (!isNew && at < 0) throw new Error(what + ' "' + key + '" was not found');
  var row = at > 0 ? v[at - 1].slice() : new Array(t.cols.width).fill('');
  while (row.length < t.cols.width) row.push('');
  cols.forEach(function (c) { if (c in rec) row[m[c] - 1] = rec[c]; });
  row[m[keyCol] - 1] = key;
  if (at > 0) sh.getRange(at, 1, 1, t.cols.width).setValues([row]);
  else sh.getRange(sh.getLastRow() + 1, 1, 1, t.cols.width).setValues([row]);
  return key;
}

function saveCustomer_(ss, c, isNew) {
  if (CUSTOMER_TYPES.indexOf(c.Type) < 0) throw new Error('Pick Buyer, Landlord or Operator');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var rec = { Customer: c.Customer, Type: c.Type };
    if ('Active' in c || isNew) rec.Active = c.Active === false || String(c.Active).toUpperCase() === 'FALSE' ? false : true;
    ['PaysAsName', 'Contact', 'Phone', 'Email', 'Address', 'Notes', 'SettlementNotes'].forEach(function (k) { if (k in c) rec[k] = String(c[k] == null ? '' : c[k]).trim(); });
    return { customer: upsert_(ss, 'Customers', CUSTOMER_COLUMNS, 'Customer', rec, isNew, 'Customer') };
  } finally { lock.releaseLock(); }
}

function saveField_(ss, f, isNew) {
  var acres = f.Acres === '' || f.Acres == null ? '' : Number(f.Acres);
  if (acres !== '' && !(acres > 0)) throw new Error('Acres must be more than 0, or left blank');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var rec = { Field: f.Field };
    if ('Acres' in f) rec.Acres = acres;
    if ('Active' in f || isNew) rec.Active = f.Active === false || String(f.Active).toUpperCase() === 'FALSE' ? false : true;
    ['OpsCenterName', 'FSAFarm', 'FSATract', 'InsuranceUnit', 'Notes', 'Section', 'Township', 'Range', 'County'].forEach(function (k) { if (k in f) rec[k] = String(f[k] == null ? '' : f[k]).trim(); });
    return { field: upsert_(ss, 'Fields', FIELD_COLUMNS, 'Field', rec, isNew, 'Field') };
  } finally { lock.releaseLock(); }
}

/** Replaces one field's split for one crop year. Shares must add to 100%. Loads already weighed keep the split they were saved with. */
function saveShares_(ss, fieldName, cropYear, shares) {
  fieldName = String(fieldName || '').trim(); cropYear = Number(cropYear);
  if (!fieldName || !cropYear) throw new Error('Field and crop year are required');
  var clean = shares.filter(function (s) { return s && s.Owner; }).map(function (s) { return { Owner: String(s.Owner).trim(), SharePct: Math.round(Number(s.SharePct) * 1000) / 1000 }; });
  var seen = {};
  clean.forEach(function (s) {
    if (!(s.SharePct > 0 && s.SharePct <= 100)) throw new Error(s.Owner + ': share must be more than 0 and at most 100');
    if (seen[s.Owner]) throw new Error(s.Owner + ' is listed twice'); seen[s.Owner] = true;
  });
  var total = clean.reduce(function (a, s) { return a + s.SharePct; }, 0);
  if (clean.length && Math.abs(total - 100) > 0.001) throw new Error('Shares add to ' + total + '%, not 100%');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = tab_(ss, 'Shares'), m = ensureColumns_(sh, ['Field', 'CropYear', 'Owner', 'SharePct']).map;
    var v = sh.getDataRange().getValues(), head = v.shift(), width = head.length;
    var keepRows = v.filter(function (r) { return !(String(r[m.Field - 1]).trim() === fieldName && Number(r[m.CropYear - 1]) === cropYear); });
    clean.forEach(function (s) { var r = new Array(width).fill(''); r[m.Field - 1] = fieldName; r[m.CropYear - 1] = cropYear; r[m.Owner - 1] = s.Owner; r[m.SharePct - 1] = s.SharePct; keepRows.push(r); });
    keepRows = keepRows.filter(function (r) { return r.some(function (x) { return x !== '' && x !== null; }); });
    var blanks = v.length - keepRows.length;
    if (keepRows.length) sh.getRange(2, 1, keepRows.length, width).setValues(keepRows);
    if (blanks > 0) sh.getRange(2 + keepRows.length, 1, blanks, width).setValues(new Array(blanks).fill(0).map(function () { return new Array(width).fill(''); }));
    return { field: fieldName, cropYear: cropYear, shares: clean };
  } finally { lock.releaseLock(); }
}


/* ---- buying landlord grain that's in storage ---- */
var PURCHASE_COLUMNS = ['PurchaseNo', 'Date', 'Seller', 'Commodity', 'CropYear', 'Bushels', 'PricePerBu', 'Amount', 'Note', 'By', 'CreatedAt', 'Status'];

/** Records buying a landlord's stored grain. Ownership moves to the farm; the bushels don't move. */
function savePurchase_(ss, p) {
  var seller = String(p.Seller || '').trim();
  var cust = rows_(tab_(ss, 'Customers')).filter(function (c) { return c.Customer === seller; })[0];
  if (!cust) throw new Error('Pick the landlord');
  if (cust.Type !== 'Landlord') throw new Error(seller + ' is not a landlord');
  if (!p.Commodity || !p.CropYear) throw new Error('Pick a commodity and crop year');
  var bu = Math.round(Number(p.Bushels) * 100) / 100;
  if (!(bu > 0)) throw new Error('Bushels must be more than 0');
  var price = p.PricePerBu === '' || p.PricePerBu == null ? '' : Math.round(Number(p.PricePerBu) * 10000) / 10000;
  if (price !== '' && !(price >= 0)) throw new Error('Price must be a number, or blank');
  if (!String(p.By || '').trim()) throw new Error('Enter who is recording the purchase');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var t = sheetOrNew_(ss, 'Purchases', PURCHASE_COLUMNS), sh = t.sh, m = t.cols.map;
    var last = 0; rows_(sh).forEach(function (r) { last = Math.max(last, Number(r.PurchaseNo) || 0); });
    var row = new Array(t.cols.width).fill(''), set = function (k, v) { row[m[k] - 1] = v; };
    set('PurchaseNo', last + 1); set('Date', date_(p.Date) || new Date()); set('Seller', seller); set('Commodity', p.Commodity); set('CropYear', Number(p.CropYear));
    set('Bushels', bu); set('PricePerBu', price); set('Amount', price === '' ? '' : Math.round(bu * price * 100) / 100);
    set('Note', p.Note || ''); set('By', String(p.By).trim()); set('CreatedAt', new Date()); set('Status', 'Active');
    sh.getRange(sh.getLastRow() + 1, 1, 1, t.cols.width).setValues([row]);
    return { purchaseNo: last + 1 };
  } finally { lock.releaseLock(); }
}

function voidPurchase_(ss, no, by) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = tab_(ss, 'Purchases'), m = ensureColumns_(sh, PURCHASE_COLUMNS).map, v = sh.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) if (Number(v[i][m.PurchaseNo - 1]) === Number(no)) {
      sh.getRange(i + 1, m.Status).setValue('Void');
      sh.getRange(i + 1, m.Note).setValue(String(v[i][m.Note - 1] || '') + ' [voided by ' + (by || '?') + ' ' + new Date().toLocaleDateString() + ']');
      return { purchaseNo: Number(no) };
    }
    throw new Error('Purchase ' + no + ' was not found');
  } finally { lock.releaseLock(); }
}


/* ---- contract pricing ---- */
var PRICING_COLUMNS = ['PricingNo', 'ContractNo', 'Date', 'Bushels', 'FuturesMonth', 'Futures', 'Basis', 'Fees', 'FlatPrice', 'Note', 'By', 'CreatedAt', 'Status'];
function price_(v, what) {
  if (v === '' || v == null) return '';
  var n = Math.round(Number(v) * 10000) / 10000;
  if (isNaN(n)) throw new Error(what + ' must be a number, or blank');
  return n;
}
/**
 * One pricing line on a contract. Futures + basis − fees = flat. A line can carry only the basis
 * (futures set later) or only the futures (basis set later); fill in the rest by saving the same
 * PricingNo again. A flat price can also be entered on its own.
 */
function savePricing_(ss, p) {
  var no = String(p.ContractNo || '').trim();
  var c = rows_(tab_(ss, 'Contracts')).filter(function (x) { return String(x.ContractNo) === no; })[0];
  if (!c) throw new Error('Contract ' + no + ' was not found');
  var bu = Math.round(Number(p.Bushels) * 100) / 100;
  if (!(bu > 0)) throw new Error('Bushels must be more than 0');
  var fut = price_(p.Futures, 'Futures'), basis = price_(p.Basis, 'Basis'), fees = price_(p.Fees, 'Fees'), flat = price_(p.FlatPrice, 'Flat price');
  if (fut !== '' && basis !== '') flat = Math.round((fut + basis - (fees === '' ? 0 : fees)) * 10000) / 10000;
  if (fut === '' && basis === '' && flat === '') throw new Error('Enter futures, basis, or a flat price');
  if (!String(p.By || '').trim()) throw new Error('Enter who is recording the pricing');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var t = sheetOrNew_(ss, 'Pricing', PRICING_COLUMNS), sh = t.sh, m = t.cols.map, v = sh.getDataRange().getValues();
    var at = -1, last = 0, other = 0;
    for (var i = 1; i < v.length; i++) {
      var pn = Number(v[i][m.PricingNo - 1]) || 0; last = Math.max(last, pn);
      if (p.PricingNo && pn === Number(p.PricingNo)) { at = i + 1; continue; }
      if (String(v[i][m.ContractNo - 1]) === no && String(v[i][m.Status - 1]) !== 'Void') other += Number(v[i][m.Bushels - 1]) || 0;
    }
    if (p.PricingNo && at < 0) throw new Error('Pricing line ' + p.PricingNo + ' was not found');
    if (other + bu > Number(c.Bushels) + 0.005) throw new Error('That prices ' + (Math.round((other + bu) * 100) / 100) + ' bu on a ' + c.Bushels + ' bu contract. Only ' + (Math.round((Number(c.Bushels) - other) * 100) / 100) + ' bu are left to price.');
    var row = at > 0 ? v[at - 1].slice() : new Array(t.cols.width).fill('');
    while (row.length < t.cols.width) row.push('');
    var set = function (k, val) { row[m[k] - 1] = val; };
    if (at < 0) { set('PricingNo', last + 1); set('CreatedAt', new Date()); set('Status', 'Active'); }
    set('ContractNo', no); set('Date', date_(p.Date) || new Date()); set('Bushels', bu); set('FuturesMonth', String(p.FuturesMonth || '').trim());
    set('Futures', fut); set('Basis', basis); set('Fees', fees); set('FlatPrice', flat); set('Note', p.Note || ''); set('By', String(p.By).trim());
    if (at > 0) sh.getRange(at, 1, 1, t.cols.width).setValues([row]); else sh.getRange(sh.getLastRow() + 1, 1, 1, t.cols.width).setValues([row]);
    return { pricingNo: at > 0 ? Number(p.PricingNo) : last + 1, flatPrice: flat };
  } finally { lock.releaseLock(); }
}
function voidPricing_(ss, no, by) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = tab_(ss, 'Pricing'), m = ensureColumns_(sh, PRICING_COLUMNS).map, v = sh.getDataRange().getValues();
    for (var i = 1; i < v.length; i++) if (Number(v[i][m.PricingNo - 1]) === Number(no)) {
      sh.getRange(i + 1, m.Status).setValue('Void');
      sh.getRange(i + 1, m.Note).setValue(String(v[i][m.Note - 1] || '') + ' [voided by ' + (by || '?') + ' ' + new Date().toLocaleDateString() + ']');
      return { pricingNo: Number(no) };
    }
    throw new Error('Pricing line ' + no + ' was not found');
  } finally { lock.releaseLock(); }
}


/* ---- tickets typed in from paper, and fixing tickets ---- */
var EDIT_COLUMNS = ['TicketNo', 'At', 'By', 'Reason', 'Changes'];
var EDITABLE = { Field: 'Field', Buyer: 'Buyer', ContractNo: 'Contract', Commodity: 'Commodity', CropYear: 'Crop year', Truck: 'Truck', Driver: 'Driver',
  BOLNo: 'BOL', LoadNo: 'Load #', GrossLb: 'Gross', TareLb: 'Tare', MoisturePct: 'Moisture', TestWeight: 'Test weight', GrainTempF: 'Temp', FMPct: 'FM',
  Remarks: 'Remarks', DateTime: 'Date/time', Status: 'Status', PaperTicket: 'Paper ticket #' };

function ticketRow_(ss, no) {
  var sh = tab_(ss, 'Tickets'), c = ensureColumns_(sh, TICKET_COLUMNS.concat(['PaperTicket', 'EditedAt']));
  var v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (Number(v[i][c.map.TicketNo - 1]) === Number(no)) return { sh: sh, c: c, at: i + 1, row: v[i] };
  return { sh: sh, c: c, at: -1 };
}
/** Removes every row of a tab where the TicketNo column matches; rewrites the tab without them. */
function dropTicketRows_(sh, no) {
  var v = sh.getDataRange().getValues(); if (v.length < 2) return;
  var head = v.shift(), col = head.indexOf('TicketNo');
  var keep = v.filter(function (r) { return Number(r[col]) !== Number(no); });
  var gone = v.length - keep.length; if (!gone) return;
  if (keep.length) sh.getRange(2, 1, keep.length, head.length).setValues(keep);
  sh.getRange(2 + keep.length, 1, gone, head.length).setValues(new Array(gone).fill(0).map(function () { return new Array(head.length).fill(''); }));
}
function lbPerBu_(ss, commodity) {
  var c = rows_(tab_(ss, 'Commodities')).filter(function (x) { return x.Commodity === commodity; })[0];
  return (c && Number(c.LbPerBu)) || 56;
}
/** Owner split rows for an inbound ticket, from the field's split for that crop year. */
function writeSplits_(ss, no, field, cropYear, commodity, net) {
  var ssh = tab_(ss, 'TicketSplits'), sc = ensureColumns_(ssh, SPLIT_COLUMNS), warn = '';
  var sh = rows_(tab_(ss, 'Shares')).filter(function (s) { return s.Field === field && String(s.CropYear) === String(cropYear); })
    .map(function (s) { return { owner: s.Owner, pct: Number(s.SharePct) }; });
  var total = sh.reduce(function (a, s) { return a + s.pct; }, 0);
  if (!sh.length || Math.abs(total - 100) > 0.001) { warn = 'Ticket ' + no + ': no complete split for ' + field + ' ' + cropYear + '; recorded as UNASSIGNED.'; sh = [{ owner: 'UNASSIGNED', pct: 100 }]; }
  var out = splitNet_(Number(net) || 0, lbPerBu_(ss, commodity), sh).map(function (s) {
    var r = new Array(sc.width).fill(''); r[sc.map.TicketNo - 1] = no; r[sc.map.Owner - 1] = s.owner; r[sc.map.SharePct - 1] = s.pct; r[sc.map.NetLb - 1] = s.netLb; r[sc.map.WetBu - 1] = s.wetBu; return r;
  });
  if (out.length) ssh.getRange(ssh.getLastRow() + 1, 1, out.length, sc.width).setValues(out);
  return warn;
}
function logEdit_(ss, no, by, reason, changes) {
  var sh = ss.getSheetByName('EditLog'); if (!sh) sh = ss.insertSheet('EditLog');
  var c = ensureColumns_(sh, EDIT_COLUMNS), r = new Array(c.width).fill('');
  r[c.map.TicketNo - 1] = Number(no); r[c.map.At - 1] = new Date(); r[c.map.By - 1] = by; r[c.map.Reason - 1] = reason || ''; r[c.map.Changes - 1] = changes;
  sh.getRange(sh.getLastRow() + 1, 1, 1, c.width).setValues([r]);
}

/**
 * A ticket typed in from a paper (punch) ticket, for when the power or internet was out.
 * It keeps the paper ticket's own number, which must not already be used, and is marked ManualWeight.
 */
function addManualTicket_(ss, t, by) {
  if (!String(by || '').trim()) throw new Error('Enter who is typing in the ticket');
  var no = Number(t.no);
  if (!(no > 0)) throw new Error('Enter the paper ticket number');
  if (t.dir !== 'IN' && t.dir !== 'OUT') throw new Error('Pick inbound or outbound');
  if (!t.commodity || !t.cropYear) throw new Error('Pick the commodity and crop year');
  var gross = Number(t.gross), tare = Number(t.tare);
  if (!(gross > 0) || !(tare >= 0) || gross <= tare) throw new Error('Gross must be more than tare');
  if (t.dir === 'IN' && !t.field) throw new Error('Pick the field');
  if (t.dir === 'OUT' && !t.buyer) throw new Error('Pick the buyer');
  if (ticketRow_(ss, no).at > 0) throw new Error('Ticket ' + no + ' is already in the system');
  var net = gross - tare, bu = Math.round(net / lbPerBu_(ss, t.commodity) * 100) / 100;
  var wire = { no: no, dir: t.dir, status: 'Closed', manual: true, commodity: t.commodity, cropYear: Number(t.cropYear), field: t.dir === 'IN' ? t.field : '',
    buyer: t.dir === 'OUT' ? t.buyer : '', contractNo: t.dir === 'OUT' ? (t.contractNo || 'TBD') : '', truck: t.truck || '', driver: t.driver || '', operator: by,
    gross: gross, tare: tare, net: net, wetBu: bu, moisture: t.moisture === '' ? null : t.moisture, tw: t.tw === '' ? null : t.tw, fm: t.fm === '' ? null : t.fm,
    gradeSource: 'manual', bol: t.bol || '', loadNo: t.loadNo || '', remarks: ('Typed from paper ticket. ' + (t.remarks || '')).trim(),
    timeIn: t.timeIn || t.timeOut, timeOut: t.timeOut || t.timeIn, station: 'Office (paper ticket)', test: !!t.test };
  var r = saveTickets_(ss, [wire], 'Office');
  var x = ticketRow_(ss, no); x.sh.getRange(x.at, x.c.map.PaperTicket).setValue(no);
  logEdit_(ss, no, by, 'Typed in from paper ticket', 'Added by hand: ' + t.dir + ' ' + t.commodity + ' ' + (t.field || t.buyer) + ', ' + net + ' lb net');
  return { ticketNo: no, wetBu: bu, warnings: r.warnings };
}

/**
 * Fixes a ticket: wrong field, buyer, contract, truck, weights, grades... Recomputes net and
 * bushels, redoes the owner split (inbound) and the contract it applies to (outbound), and
 * writes what changed to the EditLog tab. Status 'Void' takes it out of every total.
 */
function editTicket_(ss, no, ch, by, reason) {
  if (!String(by || '').trim()) throw new Error('Enter who is making the change');
  if (!String(reason || '').trim()) throw new Error('Enter why it is being changed');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var x = ticketRow_(ss, no);
    if (x.at < 0) throw new Error('Ticket ' + no + ' was not found');
    var m = x.c.map, row = x.row.slice(); while (row.length < x.c.width) row.push('');
    var get = function (k) { return row[m[k] - 1]; }, set = function (k, v) { row[m[k] - 1] = v; };
    var dir = get('Direction'), changes = [];
    Object.keys(ch).forEach(function (k) {
      if (!EDITABLE[k]) return;
      var nv = ch[k], ov = get(k);
      if (['GrossLb', 'TareLb', 'CropYear', 'LoadNo'].indexOf(k) >= 0 && nv !== '') nv = Number(nv);
      if (['MoisturePct', 'TestWeight', 'GrainTempF', 'FMPct'].indexOf(k) >= 0) nv = nv === '' || nv == null ? '' : Number(nv);
      if (k === 'DateTime') nv = nv ? new Date(nv) : ov;
      var same = (ov instanceof Date && nv instanceof Date) ? ov.getTime() === nv.getTime() : String(ov) === String(nv);
      if (same) return;
      if (k === 'Status' && ['Closed', 'Void'].indexOf(nv) < 0) throw new Error('Status can only be Closed or Void');
      changes.push(EDITABLE[k] + ': ' + (ov instanceof Date ? ov.toLocaleString() : ov) + ' → ' + (nv instanceof Date ? nv.toLocaleString() : nv));
      set(k, nv);
      if (k === 'Buyer') set('Destination', nv);
      if (k === 'GrossLb' || k === 'TareLb') set('ManualWeight', true);
    });
    if (!changes.length) return { ticketNo: Number(no), changed: 0 };
    var gross = Number(get('GrossLb')), tare = Number(get('TareLb'));
    if (!(gross > tare)) throw new Error('Gross must be more than tare');
    set('NetLb', gross - tare); set('WetBu', Math.round((gross - tare) / lbPerBu_(ss, get('Commodity')) * 100) / 100);
    if ('ContractNo' in ch || 'Buyer' in ch) {
      set('RolledFrom', '');
      var k = rows_(tab_(ss, 'Contracts')).filter(function (c) { return String(c.ContractNo) === String(get('ContractNo')); })[0];
      if (dir === 'OUT' && k && k.Buyer !== get('Buyer')) { changes.push('Contract: ' + get('ContractNo') + ' → TBD (it belongs to ' + k.Buyer + ')'); set('ContractNo', 'TBD'); }
    }
    set('EditedAt', new Date());
    x.sh.getRange(x.at, 1, 1, x.c.width).setValues([row]);
    // redo the owner split and the contract it applies to
    var warns = [];
    dropTicketRows_(tab_(ss, 'TicketSplits'), no);
    var tcs = ss.getSheetByName('TicketContracts'); if (tcs) dropTicketRows_(tcs, no);
    if (get('Status') === 'Closed') {
      if (dir === 'IN') { var w = writeSplits_(ss, Number(no), get('Field'), get('CropYear'), get('Commodity'), get('NetLb')); if (w) warns.push(w); }
      else warns = warns.concat(allocatePending_(ss).warnings);
    }
    logEdit_(ss, no, String(by).trim(), String(reason).trim(), changes.join('; '));
    return { ticketNo: Number(no), changed: changes.length, changes: changes, warnings: warns };
  } finally { lock.releaseLock(); }
}

/* ---- discount schedules (one row per commodity on the Commodities tab) ---- */
var COMMODITY_COLUMNS = ['Commodity', 'LbPerBu', 'StdMoisturePct', 'ShrinkMethod', 'ShrinkPerPoint', 'HandlingShrinkPct', 'DryingPerPoint', 'BaseTestWeight', 'TWDiscountPerLb', 'ScheduleNotes'];
function saveCommodity_(ss, c, isNew) {
  var name = String(c.Commodity || '').trim();
  if (!name) throw new Error('Commodity name is required');
  var n = function (k, what, min, max) {
    if (c[k] === '' || c[k] == null) return '';
    var v = Number(c[k]); if (isNaN(v) || v < min || v > max) throw new Error(what + ' must be between ' + min + ' and ' + max);
    return v;
  };
  var rec = { Commodity: name, LbPerBu: n('LbPerBu', 'Lb per bushel', 1, 100), StdMoisturePct: n('StdMoisturePct', 'Standard moisture', 0, 40),
    ShrinkMethod: c.ShrinkMethod === 'PerPoint' ? 'PerPoint' : 'Water', ShrinkPerPoint: n('ShrinkPerPoint', 'Shrink per point', 0, 5),
    HandlingShrinkPct: n('HandlingShrinkPct', 'Handling shrink', 0, 10), DryingPerPoint: n('DryingPerPoint', 'Drying charge', 0, 1),
    BaseTestWeight: n('BaseTestWeight', 'Base test weight', 0, 80), TWDiscountPerLb: n('TWDiscountPerLb', 'Test weight discount', 0, 1), ScheduleNotes: String(c.ScheduleNotes || '').trim() };
  if (rec.LbPerBu === '') throw new Error('Enter lb per bushel');
  if (rec.ShrinkMethod === 'PerPoint' && rec.ShrinkPerPoint === '') throw new Error('Enter the shrink % per point');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try { return { commodity: upsert_(ss, 'Commodities', COMMODITY_COLUMNS, 'Commodity', rec, isNew, 'Commodity') }; }
  finally { lock.releaseLock(); }
}


/* ======================================================================
 * Backups
 *
 * Every night at 11 pm a dated copy of the whole Sheet goes into a Drive folder
 * "Grain Backups" (the last 30 days are kept, plus the copy from the 1st of every
 * month forever). Every Sunday an Excel copy of every tab is emailed to
 * Settings → BackupEmail (or OfficeEmail), so a copy lives outside Google too.
 * The folder is shared with Settings → BackupShareWith. BackupLog tab shows each run.
 *
 * Setup: run setupBackups() once and approve Drive access. It also runs one
 * backup and sends one Excel email right away so you can see they work.
 * ==================================================================== */
var BACKUP_FOLDER = 'Grain Backups';
var BACKUP_PREFIX = 'Blue Barn Grain backup ';

function setupBackups() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'nightlyBackup') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('nightlyBackup').timeBased().atHour(23).nearMinute(0).everyDays(1).inTimezone('America/Chicago').create();
  var r = nightlyBackup(true);
  Logger.log('Backups are on: a copy of the Sheet every night at 11 pm into Drive → ' + BACKUP_FOLDER + ', and an Excel copy emailed every Sunday. ' +
    'Just made "' + r.copy + '"' + (r.emailedTo ? ' and emailed the Excel copy to ' + r.emailedTo : ' (no email: add BackupEmail or OfficeEmail in Settings)') + '.');
}

/** Trigger entry point (also run by setupBackups with sendNow = true). */
function nightlyBackup(sendNow) {
  var id = PROPS.getProperty('SHEET_ID'), ss = SpreadsheetApp.openById(id), live = id !== TEST_SHEET_ID;
  var settings = {}; rows_(tab_(ss, 'Settings')).forEach(function (r) { if (r.Key) settings[r.Key] = r.Value; });
  var now = new Date(), stamp = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  var folder = backupFolder_(settings);
  var name = BACKUP_PREFIX + stamp + (live ? '' : ' (TEST)');
  if (!folder.getFilesByName(name).hasNext()) DriveApp.getFileById(id).makeCopy(name, folder);
  var trashed = pruneBackups_(folder, stamp);
  var to = String(settings.BackupEmail || settings.OfficeEmail || '').trim(), emailed = '';
  var sunday = Utilities.formatDate(now, TZ, 'u') === '7';
  if (to && (sunday || sendNow === true)) { emailExcel_(id, to, stamp, live); emailed = to; }
  var log = ss.getSheetByName('BackupLog'); if (!log) { log = ss.insertSheet('BackupLog'); log.appendRow(['At', 'Copy', 'EmailedTo', 'OldCopiesRemoved']); }
  log.appendRow([now, name, emailed, trashed]);
  return { copy: name, emailedTo: emailed, trashed: trashed };
}

function backupFolder_(settings) {
  var it = DriveApp.getFoldersByName(BACKUP_FOLDER), f = it.hasNext() ? it.next() : DriveApp.createFolder(BACKUP_FOLDER);
  String(settings.BackupShareWith || '').split(/[,\s]+/).filter(Boolean).forEach(function (who) {
    try { if (f.getEditors().map(function (u) { return u.getEmail(); }).indexOf(who) < 0) f.addViewer(who); } catch (e) { /* sharing is best-effort */ }
  });
  return f;
}

/** Which backup copies to remove: older than 30 days, except the copy from the 1st of each month. */
function backupsToRemove_(names, todayStamp) {
  var today = new Date(todayStamp + 'T12:00:00Z').getTime();
  return names.filter(function (n) {
    var m = /^Blue Barn Grain backup (\d{4})-(\d{2})-(\d{2})/.exec(n); if (!m) return false;
    if (m[3] === '01') return false;
    return (today - new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T12:00:00Z').getTime()) / 86400000 > 30;
  });
}
function pruneBackups_(folder, stamp) {
  var files = [], it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  var drop = backupsToRemove_(files.map(function (f) { return f.getName(); }), stamp);
  files.forEach(function (f) { if (drop.indexOf(f.getName()) >= 0) f.setTrashed(true); });
  return drop.length;
}

/** Emails an Excel (.xlsx) copy of every tab — the copy that lives outside Google. */
function emailExcel_(id, to, stamp, live) {
  var url = 'https://docs.google.com/spreadsheets/d/' + id + '/export?format=xlsx';
  var blob = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } }).getBlob()
    .setName('Blue Barn Grain ' + stamp + (live ? '' : ' TEST') + '.xlsx');
  MailApp.sendEmail({ to: to, name: 'BBL&C backup', subject: 'Blue Barn Grain weekly backup ' + stamp + (live ? '' : ' (TEST)'),
    body: 'Attached is an Excel copy of every tab in the Blue Barn Grain Sheet as of ' + stamp + '.\n\n' +
      'Keep these emails: they are the copy of the grain records that lives outside Google. ' +
      'Daily copies are also kept in Google Drive → ' + BACKUP_FOLDER + ' (Bluebarn.grain account).',
    attachments: [blob] });
}


/* ======================================================================
 * Buyer settlements and payments
 *
 * The office uploads a buyer's settlement / remittance (PDF or photos). The backend keeps
 * the original in Drive → "Grain Settlements", and Claude (Anthropic API) reads it into one
 * standard shape whatever the buyer's layout: check and totals, plus one line per load.
 * Google gives each outside request 60 seconds, so the pages are read in groups, all at
 * once, then merged (a load listed in two sections becomes one line) and tied out.
 * The app matches the lines to our tickets, the office reviews, then saveSettlement posts it.
 *
 * Setup: Apps Script → Project Settings (gear) → Script Properties → add
 * ANTHROPIC_API_KEY = your key from console.anthropic.com. Optional ANTHROPIC_MODEL.
 * ==================================================================== */
var SETTLE_FOLDER = 'Grain Settlements';
var SETTLEMENT_COLUMNS = ['SettlementId', 'Buyer', 'StatementNo', 'Voucher', 'StatementDate', 'CheckNo', 'CheckDate', 'Commodity', 'Contracts',
  'LoadCount', 'Bushels', 'GrossAmount', 'Deductions', 'NetAmount', 'CheckAmount', 'FileUrl', 'PostedBy', 'PostedAt', 'Status', 'Notes'];
var SLINE_COLUMNS = ['SettlementId', 'Line', 'BuyerTicket', 'ShipDate', 'Vehicle', 'OtherRef', 'ContractNo', 'WeightLb', 'ApplyPct', 'GrossBu', 'NetBu',
  'Price', 'Amount', 'TestWeight', 'Moisture', 'FM', 'Damage', 'Adjustments', 'TicketNo', 'MatchedBy', 'Status'];
var PAGES_PER_CALL = 3;

var SETTLE_PROMPT = 'This is a grain buyer\'s settlement, remittance or purchase statement for grain sold by a farm (Blue Barn Land & Cattle, also paid as J W Roenbaugh). ' +
  'Read it exactly as printed. Use plain numbers without $ or commas. Dates as YYYY-MM-DD. Leave a field out when it is not printed. Never guess or invent values.';

function anthropic_(content, tool) {
  var key = PROPS.getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('No Anthropic API key yet. In Apps Script: Project Settings → Script Properties → add ANTHROPIC_API_KEY.');
  return {
    url: 'https://api.anthropic.com/v1/messages', method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({ model: PROPS.getProperty('ANTHROPIC_MODEL') || 'claude-sonnet-5-5', max_tokens: 16000,
      tools: [tool], tool_choice: { type: 'tool', name: tool.name }, messages: [{ role: 'user', content: content }] })
  };
}
function toolResult_(resp, what) {
  var code = resp.getResponseCode(), body = resp.getContentText();
  if (code !== 200) {
    var msg = body; try { msg = JSON.parse(body).error.message; } catch (e) {}
    throw new Error('Reading the ' + what + ' failed (' + code + '): ' + String(msg).slice(0, 300));
  }
  var j = JSON.parse(body), use = (j.content || []).filter(function (c) { return c.type === 'tool_use'; })[0];
  if (!use) throw new Error('Reading the ' + what + ' came back empty');
  if (j.stop_reason === 'max_tokens') throw new Error('The ' + what + ' was too long to read in one piece');
  return use.input;
}

var HEADER_TOOL = { name: 'settlement_header', description: 'The statement-level facts: who paid, check, totals and deductions.',
  input_schema: { type: 'object', properties: {
    buyer: { type: 'string', description: 'Company that is paying' }, statement_no: { type: 'string', description: 'Settlement / statement / sheet number' },
    voucher: { type: 'string' }, statement_date: { type: 'string' }, check_no: { type: 'string' }, check_date: { type: 'string' },
    commodity: { type: 'string' }, contracts: { type: 'array', items: { type: 'object', properties: { contract_no: { type: 'string' }, price: { type: 'number' } } } },
    total_bushels: { type: 'number' }, gross_amount: { type: 'number', description: 'Total before deductions' },
    deductions: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, amount: { type: 'number', description: 'Positive number taken off' } } } },
    net_amount: { type: 'number', description: 'Settlement amount after deductions' }, check_amount: { type: 'number' },
    load_count: { type: 'number' }, page_count: { type: 'number' }, notes: { type: 'string' } }, required: ['buyer'] } };

var LINES_TOOL = { name: 'load_lines', description: 'Every load (truck) line printed on the given pages.',
  input_schema: { type: 'object', properties: { lines: { type: 'array', items: { type: 'object', properties: {
    page: { type: 'number' }, buyer_ticket: { type: 'string', description: "Buyer's ticket / scale ticket number, including any -01/-02 suffix" },
    ship_date: { type: 'string' }, vehicle: { type: 'string' }, other_ref: { type: 'string', description: 'Our reference: other ref, BOL, shipper ticket, origin ticket' },
    contract_no: { type: 'string' }, weight_lb: { type: 'number', description: 'Unload / net weight in pounds at their scale' }, apply_pct: { type: 'number', description: 'Percent of the load applied, 100 if not shown' },
    gross_bu: { type: 'number' }, net_bu: { type: 'number', description: 'Bushels paid after their adjustments' }, price: { type: 'number' }, amount: { type: 'number', description: 'Dollar amount for the load' },
    test_weight: { type: 'number' }, moisture: { type: 'number' }, fm: { type: 'number' }, damage: { type: 'number' },
    adjustments: { type: 'string', description: 'Any shrink or discount on this load, as printed' } }, required: ['buyer_ticket'] } } }, required: ['lines'] } };

/** Rough page count of a PDF from its bytes. */
function pdfPages_(bytes) {
  var s = Utilities.newBlob(bytes).getDataAsString('ISO-8859-1');
  var m = s.match(/\/Type\s*\/Page(?!s)/g);
  return m ? m.length : 1;
}

function readSettlement_(ss, p) {
  var files = (p.files || []).filter(function (f) { return f && f.data; });
  if (!files.length) throw new Error('Attach the settlement (PDF or photos)');
  var buyer = String(p.buyer || '').trim(), notes = '';
  if (buyer) { var c = rows_(tab_(ss, 'Customers')).filter(function (x) { return x.Customer === buyer; })[0]; if (c && c.SettlementNotes) notes = String(c.SettlementNotes); }
  // keep the original
  var it = DriveApp.getFoldersByName(SETTLE_FOLDER), folder = it.hasNext() ? it.next() : DriveApp.createFolder(SETTLE_FOLDER);
  var stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HHmm'), urls = [];
  var blocks = files.map(function (f, i) {
    var bytes = Utilities.base64Decode(f.data), type = f.type || 'application/pdf';
    var saved = folder.createFile(Utilities.newBlob(bytes, type, (buyer || 'Settlement') + ' ' + stamp + (files.length > 1 ? ' (' + (i + 1) + ')' : '') + (/pdf/.test(type) ? '.pdf' : '.jpg')));
    urls.push(saved.getUrl());
    return { type: type, data: f.data, pages: /pdf/.test(type) ? pdfPages_(bytes) : 1 };
  });
  var doc = blocks.map(function (b) { return /pdf/.test(b.type) ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b.data } }
    : { type: 'image', source: { type: 'base64', media_type: b.type, data: b.data } }; });
  var pages = blocks.reduce(function (a, b) { return a + b.pages; }, 0);
  var hint = notes ? ' Notes about this buyer\'s statements: ' + notes : '';
  var reqs = [anthropic_(doc.concat([{ type: 'text', text: SETTLE_PROMPT + hint + ' Give the statement-level facts with the settlement_header tool.' }]), HEADER_TOOL)];
  for (var from = 1; from <= pages; from += PAGES_PER_CALL) {
    var to = Math.min(pages, from + PAGES_PER_CALL - 1);
    reqs.push(anthropic_(doc.concat([{ type: 'text', text: SETTLE_PROMPT + hint + ' List every load line printed on page' + (from === to ? ' ' + from : 's ' + from + ' to ' + to) +
      ' (pages counted from 1 across everything attached) with the load_lines tool. If a load appears in more than one section (for example a delivery sheet and a settlement), list it once per section with its page. Skip lines on other pages. Return an empty list if those pages have no load lines.' }]), LINES_TOOL));
  }
  var resps = UrlFetchApp.fetchAll(reqs);
  var header = toolResult_(resps[0], 'check and totals'), raw = [];
  for (var i = 1; i < resps.length; i++) raw = raw.concat(toolResult_(resps[i], 'load lines').lines || []);
  var lines = mergeLines_(raw);
  return { header: header, lines: lines, pages: pages, fileUrls: urls, checks: tieOut_(header, lines) };
}

/** One line per buyer ticket: a load printed in two sections is merged, keeping every value found. */
function mergeLines_(raw) {
  var by = {}, order = [];
  raw.forEach(function (l) {
    var k = String(l.buyer_ticket || '').replace(/\s+/g, '').toUpperCase();
    if (!k) { k = '?' + order.length; }
    if (!by[k]) { by[k] = {}; order.push(k); }
    Object.keys(l).forEach(function (f) { if (l[f] !== '' && l[f] != null && (by[k][f] === undefined || by[k][f] === '')) by[k][f] = l[f]; });
  });
  return order.map(function (k) { var l = by[k]; if (l.apply_pct == null) l.apply_pct = 100; if (l.net_bu == null && l.gross_bu != null) l.net_bu = l.gross_bu; return l; });
}

/** Does it add up? loads vs total, total − deductions vs net, net vs check. */
function tieOut_(h, lines) {
  var r2 = function (x) { return Math.round(x * 100) / 100; }, out = [];
  var amt = r2(lines.reduce(function (a, l) { return a + (Number(l.amount) || 0); }, 0));
  var bu = r2(lines.reduce(function (a, l) { return a + (Number(l.net_bu) || 0); }, 0));
  var ded = r2((h.deductions || []).reduce(function (a, d) { return a + (Number(d.amount) || 0); }, 0));
  if (h.load_count != null) out.push({ check: 'Loads', expected: h.load_count, found: lines.length, ok: Number(h.load_count) === lines.length });
  if (h.total_bushels != null) out.push({ check: 'Bushels', expected: h.total_bushels, found: bu, ok: Math.abs(bu - h.total_bushels) < 0.06 });
  if (h.gross_amount != null) out.push({ check: 'Load amounts add up to the total', expected: h.gross_amount, found: amt, ok: Math.abs(amt - h.gross_amount) < 0.06 });
  var net = h.net_amount != null ? h.net_amount : h.check_amount;
  if (h.gross_amount != null && net != null) out.push({ check: 'Total − deductions = net', expected: net, found: r2(h.gross_amount - ded), ok: Math.abs(h.gross_amount - ded - net) < 0.06 });
  if (h.check_amount != null && h.net_amount != null) out.push({ check: 'Net = check', expected: h.check_amount, found: h.net_amount, ok: Math.abs(h.check_amount - h.net_amount) < 0.06 });
  return out;
}

/** Posts a reviewed settlement: one Settlements row, one SettlementLines row per load (with the ticket it matched). */
function saveSettlement_(ss, st, by) {
  if (!String(by || '').trim()) throw new Error('Enter who is posting it');
  var h = st.header || {}, lines = st.lines || [];
  if (!st.buyer) throw new Error('Pick the buyer');
  if (!lines.length) throw new Error('No load lines to post');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var t = sheetOrNew_(ss, 'Settlements', SETTLEMENT_COLUMNS), sh = t.sh, m = t.cols.map;
    var existing = rows_(sh).filter(function (r) { return String(r.Status) !== 'Void' && r.Buyer === st.buyer &&
      ((h.statement_no && String(r.StatementNo) === String(h.statement_no)) || (h.voucher && String(r.Voucher) === String(h.voucher)) || (h.check_no && String(r.CheckNo) === String(h.check_no))); });
    if (existing.length) throw new Error('This settlement was already posted (' + existing[0].SettlementId + ')');
    var id = 'S' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmmss');
    var ded = (h.deductions || []).map(function (d) { return d.label + ' ' + d.amount; }).join('; ');
    var dedAmt = (h.deductions || []).reduce(function (a, d) { return a + (Number(d.amount) || 0); }, 0);
    var row = new Array(t.cols.width).fill(''), set = function (k, v) { row[m[k] - 1] = v; };
    set('SettlementId', id); set('Buyer', st.buyer); set('StatementNo', h.statement_no || ''); set('Voucher', h.voucher || ''); set('StatementDate', date_(h.statement_date));
    set('CheckNo', h.check_no || ''); set('CheckDate', date_(h.check_date)); set('Commodity', h.commodity || '');
    set('Contracts', (h.contracts || []).map(function (c) { return c.contract_no + (c.price ? ' @ ' + c.price : ''); }).join(', '));
    set('LoadCount', lines.length); set('Bushels', lines.reduce(function (a, l) { return a + (Number(l.net_bu) || 0); }, 0));
    set('GrossAmount', h.gross_amount == null ? '' : h.gross_amount); set('Deductions', ded ? ded + ' (total ' + (Math.round(dedAmt * 100) / 100) + ')' : '');
    set('NetAmount', h.net_amount == null ? '' : h.net_amount); set('CheckAmount', h.check_amount == null ? '' : h.check_amount);
    set('FileUrl', (st.fileUrls || []).join(' ')); set('PostedBy', String(by).trim()); set('PostedAt', new Date()); set('Status', 'Posted'); set('Notes', st.notes || '');
    sh.getRange(sh.getLastRow() + 1, 1, 1, t.cols.width).setValues([row]);
    var lt = sheetOrNew_(ss, 'SettlementLines', SLINE_COLUMNS), lm = lt.cols.map;
    var out = lines.map(function (l, i) {
      var r = new Array(lt.cols.width).fill(''), s2 = function (k, v) { r[lm[k] - 1] = v == null ? '' : v; };
      s2('SettlementId', id); s2('Line', i + 1); s2('BuyerTicket', l.buyer_ticket); s2('ShipDate', date_(l.ship_date)); s2('Vehicle', l.vehicle); s2('OtherRef', l.other_ref);
      s2('ContractNo', l.contract_no); s2('WeightLb', l.weight_lb); s2('ApplyPct', l.apply_pct); s2('GrossBu', l.gross_bu); s2('NetBu', l.net_bu); s2('Price', l.price);
      s2('Amount', l.amount); s2('TestWeight', l.test_weight); s2('Moisture', l.moisture); s2('FM', l.fm); s2('Damage', l.damage); s2('Adjustments', l.adjustments);
      s2('TicketNo', l.ticketNo ? Number(l.ticketNo) : ''); s2('MatchedBy', l.matchedBy || ''); s2('Status', 'Posted');
      return r;
    });
    lt.sh.getRange(lt.sh.getLastRow() + 1, 1, out.length, lt.cols.width).setValues(out);
    // their ticket # on our ticket, for searching
    var tk = ticketRow_(ss, 0), tc = ensureColumns_(tk.sh, TICKET_COLUMNS.concat(['PaperTicket', 'EditedAt', 'BuyerTicket'])), tv = tk.sh.getDataRange().getValues();
    lines.forEach(function (l) {
      if (!l.ticketNo) return;
      for (var i = 1; i < tv.length; i++) if (Number(tv[i][tc.map.TicketNo - 1]) === Number(l.ticketNo)) {
        var cur = String(tv[i][tc.map.BuyerTicket - 1] || ''), add = String(l.buyer_ticket || '');
        if (add && cur.split(', ').indexOf(add) < 0) tk.sh.getRange(i + 1, tc.map.BuyerTicket).setValue(cur ? cur + ', ' + add : add);
      }
    });
    return { settlementId: id, lines: out.length };
  } finally { lock.releaseLock(); }
}

function voidSettlement_(ss, id, by) {
  if (!String(by || '').trim()) throw new Error('Enter who is voiding it');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var found = false;
    [['Settlements', SETTLEMENT_COLUMNS], ['SettlementLines', SLINE_COLUMNS]].forEach(function (x) {
      var sh = ss.getSheetByName(x[0]); if (!sh) return;
      var m = ensureColumns_(sh, x[1]).map, v = sh.getDataRange().getValues();
      for (var i = 1; i < v.length; i++) if (String(v[i][m.SettlementId - 1]) === String(id)) { sh.getRange(i + 1, m.Status).setValue('Void'); found = true; }
    });
    if (!found) throw new Error('Settlement ' + id + ' was not found');
    return { settlementId: id };
  } finally { lock.releaseLock(); }
}
