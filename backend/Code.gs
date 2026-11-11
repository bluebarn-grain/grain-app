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
  'BOLNo', 'Buyer', 'LoadNo', 'TimeIn', 'TimeOut', 'WetBu', 'GradeSource', 'Station', 'TestTicket', 'SyncedAt'];
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
  var trucks = rows_(tab_(ss, 'Trucks')).filter(function (r) { return r.Truck; });
  var settings = {};
  rows_(tab_(ss, 'Settings')).forEach(function (r) { if (r.Key) settings[r.Key] = r.Value; });
  var delivered = {};
  rows_(tab_(ss, 'Tickets')).forEach(function (t) {
    if (t.Direction === 'OUT' && t.Status === 'Closed' && t.ContractNo) {
      delivered[t.ContractNo] = (delivered[t.ContractNo] || 0) + Number(t.WetBu || 0);
    }
  });
  var contracts = rows_(tab_(ss, 'Contracts')).filter(function (r) { return r.ContractNo && String(r.Status) !== 'Closed'; })
    .map(function (r) { r.DeliveredBu = Math.round((delivered[r.ContractNo] || 0) * 100) / 100; return r; });
  return { customers: customers, fields: fields, shares: shares, commodities: commodities, trucks: trucks, settings: settings, contracts: contracts };
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
      set('TimeOut', t.timeOut ? new Date(t.timeOut) : ''); set('Station', t.station || station); set('TestTicket', !!t.test); set('SyncedAt', now);
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
