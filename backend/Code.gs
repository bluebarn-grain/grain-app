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
      maxNo = Math.max(maxNo, no); if (t.bol) maxBol = Math.max(maxBol, Number(t.bol));
      if (existing[no]) { saved.push(no); return; }
      var row = new Array(tc.width).fill('');
      var set = function (k, v) { if (tc.map[k]) row[tc.map[k] - 1] = (v === null || v === undefined) ? '' : v; };
      set('TicketNo', no); set('DateTime', t.timeOut ? new Date(t.timeOut) : (t.timeIn ? new Date(t.timeIn) : now));
      set('Direction', t.dir); set('Commodity', t.commodity); set('CropYear', t.cropYear); set('Field', t.field);
      set('ContractNo', t.contractNo); set('Destination', t.buyer); set('Buyer', t.buyer);
      set('Truck', t.truck); set('Driver', t.driver); set('Operator', t.operator);
      set('GrossLb', t.gross); set('TareLb', t.tare); set('NetLb', t.net); set('WetBu', t.wetBu); set('ManualWeight', false);
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
    if (maxBol) bumpSetting_(ss, 'NextBOLNo', maxBol + 1);
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
  var ss = SpreadsheetApp.openById(PROPS.getProperty('SHEET_ID'));
  return nightlyEmails_(ss, new Date(), false);
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

function nightlyEmails_(ss, now, preview) {
  var today = day_(now), dayNo = Math.floor(new Date(today + 'T12:00:00Z').getTime() / 86400000);
  var settings = {}; rows_(tab_(ss, 'Settings')).forEach(function (r) { if (r.Key) settings[r.Key] = r.Value; });
  var office = String(settings.OfficeEmail || '').trim();
  var emails = {}; rows_(tab_(ss, 'Customers')).forEach(function (c) { if (c.Customer) emails[c.Customer] = String(c.Email || '').trim(); });
  var contracts = {}; rows_(tab_(ss, 'Contracts')).forEach(function (c) { if (c.ContractNo) contracts[String(c.ContractNo)] = c; });
  var banter = banter_(ss);
  var halfLoad = (Number(settings.TypicalLoadBu) || 1000) / 2;

  var out = rows_(tab_(ss, 'Tickets')).filter(function (t) {
    return t.Direction === 'OUT' && t.Status === 'Closed' && (preview || !isTrue_(t.TestTicket));
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

  var sent = [];
  Object.keys(byBuyer).forEach(function (key) {
    var g = byBuyer[key];
    if (!g.to) { problems.push(g.buyer + ' shipped today but has no email on the Customers tab. Nothing was sent to them.'); return; }
    var msg = buildEmail_(g, contracts, toDate, loadsToDate, truckBu, banter, dayNo, now, halfLoad);
    var to = preview ? office : g.to;
    if (!to) return;
    MailApp.sendEmail({
      to: to, name: 'BBL&C', replyTo: office || undefined,
      subject: (preview ? '[PREVIEW for ' + g.to + '] ' : '') + msg.subject,
      body: msg.text, htmlBody: msg.html,
      attachments: [Utilities.newBlob(msg.csv, 'text/csv', 'BBLC tickets ' + today + ' ' + g.buyer + '.csv')]
    });
    if (!preview) sentLog.appendRow([today, g.buyer, g.to, Object.keys(g.contracts).join(', '), msg.ticketNos.join(', '), new Date()]);
    sent.push({ buyer: g.buyer, to: to, subject: msg.subject });
  });

  if (problems.length && office) {
    MailApp.sendEmail({ to: office, name: 'BBL&C scale', subject: (preview ? '[PREVIEW] ' : '') + 'Buyer emails for ' + today + ': ' + problems.length + ' thing(s) to fix', body: problems.join('\n\n') });
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
var ADJ_COLUMNS = ['AdjNo', 'Date', 'Commodity', 'CropYear', 'Type', 'Bushels', 'BookBefore', 'BookAfter', 'Note', 'By', 'CreatedAt', 'Status'];
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
  var keep = ['TicketNo', 'DateTime', 'Direction', 'Status', 'Commodity', 'CropYear', 'Field', 'ContractNo', 'Buyer', 'Truck', 'LoadNo',
    'GrossLb', 'TareLb', 'NetLb', 'WetBu', 'MoisturePct', 'TestWeight', 'FMPct', 'BOLNo', 'TestTicket', 'RolledFrom'];
  var tickets = rows_(tab_(ss, 'Tickets')).filter(function (t) { return t.TicketNo !== '' && t.Status === 'Closed'; })
    .map(function (t) { var o = {}; keep.forEach(function (k) { o[k] = t[k]; }); return o; });
  var opt = function (name) { var sh = ss.getSheetByName(name); return sh ? rows_(sh) : []; };
  var settings = {}; rows_(tab_(ss, 'Settings')).forEach(function (r) { if (r.Key) settings[r.Key] = r.Value; });
  return {
    tickets: tickets,
    splits: rows_(tab_(ss, 'TicketSplits')),
    allocations: opt('TicketContracts'),
    adjustments: opt('Adjustments').filter(function (a) { return String(a.Status) !== 'Void'; }),
    contracts: rows_(tab_(ss, 'Contracts')).filter(function (c) { return c.ContractNo; }),
    customers: rows_(tab_(ss, 'Customers')).filter(function (c) { return c.Customer; }),
    fields: rows_(tab_(ss, 'Fields')).filter(function (f) { return f.Field; }),
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
