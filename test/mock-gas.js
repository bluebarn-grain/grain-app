// Minimal Google Apps Script stand-in so backend/Code.gs can run under Node for tests.
const fs = require('fs'), vm = require('vm'), path = require('path');
function makeSheet(name, rows) {
  const data = rows.map(r => r.slice());
  const width = () => Math.max(0, ...data.map(r => r.length));
  const pad = () => { const w = width(); data.forEach(r => { while (r.length < w) r.push(''); }); };
  const sh = {
    name, data,
    getName: () => name,
    getLastRow: () => { for (let i = data.length - 1; i >= 0; i--) if (data[i].some(x => x !== '' && x != null)) return i + 1; return 0; },
    getLastColumn: () => width(),
    getDataRange: () => ({ getValues: () => { pad(); return data.slice(0, sh.getLastRow()).map(r => r.slice()); } }),
    getRange: (r, c, nr = 1, nc = 1) => { const rg = {
      getValues: () => { pad(); const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push((data[r - 1 + i] || [])[c - 1 + j] ?? ''); out.push(row); } return out; },
      setValues: v => { for (let i = 0; i < nr; i++) { while (data.length < r + i) data.push([]); for (let j = 0; j < nc; j++) { const row = data[r - 1 + i]; while (row.length < c + j) row.push(''); row[c - 1 + j] = v[i][j]; } } pad(); return rg; },
      setValue: v => { while (data.length < r) data.push([]); const row = data[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v; pad(); },
      setFontWeight: () => rg
    }; return rg; },
    appendRow: row => { data.splice(sh.getLastRow(), 0, row.slice()); pad(); }
  };
  return sh;
}
function makeSS(name, tabs) {
  const sheets = {}; for (const [k, v] of Object.entries(tabs)) sheets[k] = makeSheet(k, v);
  return { getName: () => name, getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = makeSheet(n, [])), sheets };
}
function loadBackend(ss, props) {
  const store = { ...props }, sent = [];
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => store[k] ?? null, setProperty: (k, v) => { store[k] = v; } }) },
    SpreadsheetApp: { openById: () => ss },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ text: s, setMimeType() { return this; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => 'test-key',
      newBlob: (data, type, name) => ({ data, type, name, getDataAsString: () => Buffer.from(data).toString('latin1') }),
      base64Decode: b64 => Array.from(Buffer.from(b64, 'base64')),
      formatDate: (d, tz, pat) => {
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'long', month2: undefined }).formatToParts(d).map(x => [x.type, x.value]));
        const mon = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short' }).format(d);
        return pat.replace('yyyy', p.year).replace('EEEE', p.weekday).replace('MMM', mon).replace('MM', p.month).replace('dd', p.day).replace(/\bd\b/, String(Number(p.day))).replace('HH', p.hour).replace('mm', p.minute).replace('ss', String(d.getSeconds()).padStart(2, '0'));
      }
    },
    MailApp: { sendEmail: m => sent.push(m) },
    // Drive: just enough for saving uploads. UrlFetchApp: Anthropic replies come from ctx.__claude(requestBody).
    DriveApp: (() => { const folders = {}; const mk = n => ({ name: n, files: [], createFile(b) { this.files.push(b); return { getUrl: () => 'https://drive.example/' + encodeURIComponent(b.name) }; } });
      return { getFoldersByName: n => { let done = !folders[n]; return { hasNext: () => !done, next: () => { done = true; return folders[n]; } }; }, createFolder: n => (folders[n] = mk(n)), _folders: folders }; })(),
    UrlFetchApp: { fetchAll: reqs => reqs.map(r => { const body = JSON.parse(r.payload); const out = ctx.__claude(body);
      return { getResponseCode: () => out.code || 200, getContentText: () => JSON.stringify(out.code ? { error: { message: out.error } } : { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: body.tools[0].name, input: out }] }) }; }) },
    Logger: { log: () => {} },
    console, Date, JSON, Math, Number, String, Array, Object
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'backend', 'Code.gs'), 'utf8'), ctx);
  return { ctx, sent, call: body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text) };
}
function testSheet() {
  return makeSS('Blue Barn Grain Sheet – TEST', {
    Tickets: [['TicketNo','DateTime','Direction','Commodity','CropYear','Field','ContractNo','Destination','Truck','Driver','Operator','GrossLb','TareLb','NetLb','ManualWeight','MoisturePct','TestWeight','GrainTempF','FMPct','WeighBillNo','DestNetLb','DestMoisturePct','DestTestWeight','Status','Remarks','CreatedAt']],
    TicketSplits: [['TicketNo','Owner','SharePct','NetLb','WetBu']],
    Customers: [['Customer','Type','PaysAsName','Contact','Phone','Email','Address','Active','Notes'],
      ['Roenbaugh Farms','Operator','J W Roenbaugh','','','','2949 S Rd',true,''],
      ['The Andersons','Buyer','J W Roenbaugh','','913-748-3000','','',true,''],
      ['TEST Landlord A','Landlord','','','','','',true,'Test data'],
      ['TEST Buyer B','Buyer','J W Roenbaugh','','','','',true,'Test data']],
    Fields: [['Field','OpsCenterName','FSAFarm','FSATract','InsuranceUnit','Active','Notes'],['TEST Home Place','','','','',true,''],['TEST Share Quarter','','','','',true,''],['TEST No Split','','','','',true,'']],
    Shares: [['Field','CropYear','Owner','SharePct'],['TEST Home Place',2026,'Roenbaugh Farms',100],['TEST Share Quarter',2026,'Roenbaugh Farms',50],['TEST Share Quarter',2026,'TEST Landlord A',50]],
    Commodities: [['Code','Commodity','LbPerBu','StdMoisturePct'],['C','Corn',56,15.5],['S','Sorghum',56,14]],
    Contracts: [['ContractNo','Buyer','Commodity','CropYear','Bushels','ShipStart','ShipEnd','Status','Notes'],['TEST-C1','The Andersons','Corn',2026,10000,'','','Open',''],['TEST-C2','TEST Buyer B','Sorghum',2026,5000,'','','Open','']],
    Settings: [['Key','Value','Note'],['NextTicketNo',900001,''],['NextBOLNo',9000001,''],['CutoverDate','2026-11-11',''],['FMDefault',0,'']]
  });
}
module.exports = { makeSS, loadBackend, testSheet };
