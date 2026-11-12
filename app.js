/* Blue Barn Grain — scale house app.
   Works offline: tickets and counters live in IndexedDB on this PC and sync to the
   Google Sheet backend whenever the internet is up. */
(() => {
'use strict';
const P = window.BBG;
const VERSION = '0.1.3';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt0 = n => (n == null || isNaN(n)) ? '—' : Math.round(n).toLocaleString('en-US');
const fmt2 = n => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad6 = n => String(n).padStart(6, '0');
const two = n => String(n).padStart(2, '0');
const hm = iso => { const d = new Date(iso); return d.getHours() + ':' + two(d.getMinutes()); };
const dt = iso => { const d = new Date(iso); return two(d.getMonth() + 1) + '/' + two(d.getDate()) + '/' + d.getFullYear() + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()); };
const isToday = iso => iso && new Date(iso).toDateString() === new Date().toDateString();
const MIN_LOAD_LB = 1000;      // smallest weight treated as "a truck is on the scale"
const STALE_MS = 3000;         // scale reading older than this is not trusted

// ---------------- storage ----------------
const DB = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('bbg-scale', 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('tickets', { keyPath: 'no' }); d.createObjectStore('kv'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const done = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Save aborted')); });
  return {
    async get(store, key) { const d = await open(); return new Promise((res, rej) => { const r = d.transaction(store).objectStore(store).get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
    async all(store) { const d = await open(); return new Promise((res, rej) => { const r = d.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
    async put(store, val, key) { const d = await open(); const t = d.transaction(store, 'readwrite'); key === undefined ? t.objectStore(store).put(val) : t.objectStore(store).put(val, key); return done(t); },
    // Reads counters, builds the ticket and saves both in ONE transaction, so a number is never handed out twice.
    async issue(build) {
      const d = await open(); const t = d.transaction(['tickets', 'kv'], 'readwrite');
      const kv = t.objectStore('kv'), tk = t.objectStore('tickets'); let ticket;
      const g = kv.get('counters');
      g.onsuccess = () => { const r = build(g.result); ticket = r.ticket; kv.put(r.counters, 'counters'); tk.put(r.ticket); };
      await done(t); return ticket;
    }
  };
})();

// ---------------- state ----------------
const S = {
  config: null, counters: null, lists: null, listsAt: 0, tickets: [], unmatched: [],
  sel: null, dir: 'OUT', draft: {},
  weight: { lb: null, motion: false, over: false, at: 0, raw: '' },
  ports: [], net: 'unknown', netErr: '', syncing: false, lastSync: 0,
  diag: { scale: [], moist: [], other: [], sync: [] }
};
const DEFAULT_CONFIG = { backendUrl: '', key: '', station: 'Scale house', operator: '', baud: 9600, test: true, sim: false };
const EMPTY_LISTS = { customers: [], fields: [], shares: [], commodities: [{ Commodity: 'Corn', LbPerBu: 56 }, { Commodity: 'Sorghum', LbPerBu: 56 }, { Commodity: 'Wheat', LbPerBu: 60 }, { Commodity: 'Soybeans', LbPerBu: 60 }], contracts: [], settings: {} };
// Sample lists used only in simulator mode before a backend is connected, so the app can be tried anywhere.
const DEMO_LISTS = {
  ...EMPTY_LISTS,
  customers: [{ Customer: 'Roenbaugh Farms', Type: 'Operator' }, { Customer: 'The Andersons', Type: 'Buyer' }, { Customer: 'TEST Buyer B', Type: 'Buyer' }, { Customer: 'TEST Landlord A', Type: 'Landlord' }],
  fields: [{ Field: 'TEST Home Place' }, { Field: 'TEST Share Quarter' }],
  shares: [{ Field: 'TEST Home Place', CropYear: 2026, Owner: 'Roenbaugh Farms', SharePct: 100 }, { Field: 'TEST Share Quarter', CropYear: 2026, Owner: 'Roenbaugh Farms', SharePct: 50 }, { Field: 'TEST Share Quarter', CropYear: 2026, Owner: 'TEST Landlord A', SharePct: 50 }],
  contracts: [{ ContractNo: 'TEST-C1', Buyer: 'The Andersons', Commodity: 'Corn', CropYear: 2026, Bushels: 10000, DeliveredBu: 0 }, { ContractNo: 'TEST-C2', Buyer: 'TEST Buyer B', Commodity: 'Sorghum', CropYear: 2026, Bushels: 5000, DeliveredBu: 0 }],
  settings: { FMDefault: 0 }
};
const L = () => S.lists || (S.config && S.config.sim && !S.config.backendUrl ? DEMO_LISTS : EMPTY_LISTS);

function toast(msg, ms = 3400) { const e = $('toast'); e.textContent = msg; e.hidden = false; clearTimeout(e._t); e._t = setTimeout(() => e.hidden = true, ms); }
function log(kind, line) { const a = S.diag[kind]; a.unshift(new Date().toLocaleTimeString() + '  ' + line); if (a.length > 40) a.length = 40; if ($('diag').open) renderDiag(); }

const lbPerBu = comm => { const c = L().commodities.find(x => x.Commodity === comm); return Number(c && c.LbPerBu) || 56; };
const sharesFor = (field, cy) => L().shares.filter(s => s.Field === field && String(s.CropYear) === String(cy)).map(s => ({ owner: s.Owner, pct: Number(s.SharePct) }));
const openTickets = () => S.tickets.filter(t => t.status === 'Open').sort((a, b) => a.no - b.no);
const selTicket = () => S.tickets.find(t => t.no === S.sel && t.status === 'Open') || null;
const pending = () => S.tickets.filter(t => !t.synced && t.status !== 'Open');
// Bushels applied per contract: the backend's totals plus this station's unsynced loads,
// rolled over the same way the backend will do it.
function appliedNow() {
  const cs = L().contracts, applied = {};
  cs.forEach(c => { applied[String(c.ContractNo)] = Number(c.DeliveredBu || 0); });
  S.tickets.filter(t => t.dir === 'OUT' && t.status === 'Closed' && !t.synced && t.contractNo && t.contractNo !== 'TBD')
    .sort((a, b) => a.no - b.no)
    .forEach(t => P.applyToContracts(t.wetBu, t.contractNo, cs, applied).parts.forEach(p => { applied[p.contractNo] = (applied[p.contractNo] || 0) + p.bu; }));
  return applied;
}
function contractInfo(no, applied = appliedNow()) {
  const c = L().contracts.find(x => String(x.ContractNo) === String(no)); if (!c) return null;
  const delivered = applied[String(c.ContractNo)] || 0;
  const remaining = Number(c.Bushels || 0) - delivered;
  const next = P.contractChain(no, L().contracts).slice(1).find(x => Number(x.Bushels || 0) - (applied[String(x.ContractNo)] || 0) > 0);
  return { ...c, delivered, remaining, filled: Number(c.Bushels || 0) > 0 && remaining <= 0, next: next ? String(next.ContractNo) : '' };
}

// ---------------- serial ports ----------------
// Ports are opened "unassigned"; the first line that parses tells us whether it's the scale or the moisture tester.
// That way COM numbers and plug order don't matter.
async function openPort(port) {
  if (S.ports.some(p => p.port === port)) return;
  const rec = { port, role: null, bad: 0, lines: 0, info: port.getInfo ? port.getInfo() : {} };
  try { await port.open({ baudRate: Number(S.config.baud) || 9600 }); }
  catch (e) { toast('Could not open a serial port: ' + e.message + '. Is another program (Agtrax, PuTTY) using it?', 6000); return; }
  S.ports.push(rec); render();
  readLoop(rec);
}
async function readLoop(rec) {
  const split = P.lineSplitter(l => onPortLine(rec, l));
  while (rec.port.readable) {
    const reader = rec.port.readable.getReader(); rec.reader = reader;
    const dec = new TextDecoder();
    try {
      for (;;) { const { value, done } = await reader.read(); if (done) break; split(dec.decode(value, { stream: true })); }
    } catch (e) { log('other', 'Port read error: ' + e.message); }
    finally { reader.releaseLock(); }
  }
  S.ports = S.ports.filter(p => p !== rec);
  toast((rec.role === 'scale' ? 'Scale' : rec.role === 'moist' ? 'Moisture tester' : 'A serial port') + ' disconnected');
  render();
}
function onPortLine(rec, line) {
  rec.lines++;
  if (rec.role !== 'moist') {
    const r = P.parseScale(line);
    if (r) { if (!rec.role) { rec.role = 'scale'; render(); } onScale(r); return; }
  }
  if (rec.role !== 'scale') {
    const m = P.parseMoisture(line);
    if (m) { if (!rec.role) { rec.role = 'moist'; render(); } onMoist(m); return; }
  }
  rec.bad++;
  log('other', JSON.stringify(line).slice(0, 120));
  if (rec.bad === 25 && !rec.role) toast('A serial port is sending data this app can’t read. Check the baud rate in Settings.', 7000);
}
let lastScaleLog = '';
let scaleFrame = 0;
function onScale(r) {
  S.weight = { lb: r.weight, motion: r.motion, over: r.overload, at: Date.now(), raw: r.raw, unit: r.unit, mode: r.mode };
  const k = r.weight + (r.motion ? 'M' : '');
  if (k !== lastScaleLog) { lastScaleLog = k; log('scale', r.raw); }
  if (!scaleFrame) scaleFrame = requestAnimationFrame(() => { scaleFrame = 0; renderScale(); });
}
async function onMoist(r) {
  log('moist', r.raw);
  const reading = { moisture: r.moisture, tw: r.testWeight, temp: r.tempF, grain: r.grain, loadNo: r.loadNo, at: new Date().toISOString() };
  const t = openTickets().find(x => x.dir === 'IN' && x.loadNo === r.loadNo);
  if (t) await attachReading(t, reading);
  else {
    S.unmatched.push(reading); await DB.put('kv', S.unmatched, 'unmatched');
    toast(`Moisture reading for load # ${r.loadNo ?? '?'} came in, but no inbound truck on the yard has that number. Assign it under the yard list.`, 7000);
  }
  render();
}
async function attachReading(t, reading) {
  t.readings = t.readings || [];
  t.readings.push(reading);
  t.grade = { moisture: reading.moisture, tw: reading.tw, temp: reading.temp, fm: t.grade?.fm ?? Number(L().settings.FMDefault || 0), source: 'tester' };
  await DB.put('tickets', t);
  const g = (reading.grain || '').toLowerCase(), c = (t.commodity || '').toLowerCase();
  if (g && c && !g.includes(c) && !c.includes(g)) toast(`Check the tester: it's set to ${reading.grain} but load ${t.loadNo} is ${t.commodity}.`, 8000);
  else toast(t.readings.length > 1 ? `Load ${t.loadNo} sampled again. Using the newest reading; the earlier one is kept.` : `Load ${t.loadNo}: ${reading.moisture}% moisture, ${reading.tw} test weight`);
}
async function connectPort() {
  if (!('serial' in navigator)) { toast('This browser can’t reach serial ports. Use Chrome or Edge on the scale PC, or turn on the simulator in Settings.', 7000); return; }
  try { const port = await navigator.serial.requestPort(); await openPort(port); }
  catch (e) { if (e.name !== 'NotFoundError') toast('Could not connect: ' + e.message); }
}
async function reopenKnownPorts() {
  if (!('serial' in navigator)) return;
  try { for (const p of await navigator.serial.getPorts()) await openPort(p); } catch (e) { log('other', 'getPorts: ' + e.message); }
  navigator.serial.addEventListener('connect', e => openPort(e.target || e.port));
}

// ---------------- simulator ----------------
const SIM = { target: 0, cur: 0, timer: null };
function simStart() {
  if (SIM.timer) return;
  const rec = { port: null, role: 'scale', bad: 0, lines: 0, sim: true };
  S.ports.push(rec);
  SIM.timer = setInterval(() => {
    const gap = SIM.target - SIM.cur, far = Math.abs(gap) > 40;
    SIM.cur = far ? SIM.cur + gap * 0.3 + (Math.random() - .5) * Math.min(500, Math.abs(gap) * 0.3) : SIM.target;
    const w = Math.max(0, Math.round(SIM.cur / 20) * 20);
    onPortLine(rec, String(w).padStart(7, ' ') + 'LG' + (far ? 'M' : ''));
  }, 200);
  render();
}
function simStop() { clearInterval(SIM.timer); SIM.timer = null; S.ports = S.ports.filter(p => !p.sim); }
function simMoisture() {
  const n = parseInt($('sLoadNo').value, 10);
  const t = openTickets().find(x => x.dir === 'IN' && x.loadNo === n);
  const grain = t ? t.commodity : 'Corn';
  const d = new Date();
  const line = `${two(d.getMonth() + 1)}/${two(d.getDate())}/${d.getFullYear()},${two(d.getHours())}:${two(d.getMinutes())},${grain},20230412N,${isNaN(n) ? '' : n},GUEST,,${(13 + Math.random() * 3).toFixed(1)},${(55 + Math.random() * 3).toFixed(1)},${(48 + Math.random() * 10).toFixed(1)}`;
  onPortLine({ role: 'moist', bad: 0, lines: 0, sim: true }, line);
}

// ---------------- form ----------------
const FORM_KEYS = { buyer: 'buyer', contract: 'contractNo', field: 'field', comm: 'commodity', cy: 'cropYear', truck: 'truck', driver: 'driver', op: 'operator', rm: 'remarks' };
function readForm() { const o = {}; for (const [id, k] of Object.entries(FORM_KEYS)) o[k] = $(id).value.trim(); return o; }
function setOptions(sel, items, keep) {
  const cur = keep ?? sel.value;
  sel.innerHTML = items.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join('');
  if (items.some(([v]) => String(v) === String(cur))) sel.value = cur;
}
function fillLists() {
  const l = L();
  const buyers = l.customers.filter(c => c.Type === 'Buyer').map(c => [c.Customer, c.Customer]);
  setOptions($('buyer'), [['', 'Pick a buyer…'], ...buyers]);
  fillContracts();
  setOptions($('field'), [['', 'Pick a field…'], ...l.fields.map(f => [f.Field, f.Field])]);
  setOptions($('comm'), l.commodities.map(c => [c.Commodity, c.Commodity]));
  const y = new Date().getFullYear();
  setOptions($('cy'), [y, y - 1, y - 2].map(v => [v, v]), $('cy').value || String(y));
}
function fillContracts(keep) {
  const b = $('buyer').value, applied = appliedNow(), t = selTicket();
  // Filled contracts drop off the list; the open ticket's own contract stays so the form doesn't change under it.
  const cs = L().contracts.filter(c => (!b || c.Buyer === b) && (!contractInfo(c.ContractNo, applied).filled || (t && String(t.contractNo) === String(c.ContractNo))))
    .map(c => [c.ContractNo, `${c.ContractNo} · ${c.Commodity} ${c.CropYear}`]);
  setOptions($('contract'), [...cs, ['TBD', 'Contract to be assigned']], keep);
}
function onContractChange() {
  const c = contractInfo($('contract').value);
  if (c) { $('comm').value = c.Commodity; $('cy').value = String(c.CropYear); }
  renderDetailInfo();
}
async function onFormEdit(e) {
  const t = selTicket();
  if (e && e.target.id === 'buyer') fillContracts();
  if (e && e.target.id === 'contract') onContractChange();
  if (!t) { S.draft = readForm(); renderDetailInfo(); renderScale(); return; }
  Object.assign(t, readForm());
  if (t.dir === 'IN') {
    const num = id => { const v = parseFloat($(id).value); return isFinite(v) ? v : null; };
    const g = { moisture: num('m'), tw: num('tw'), temp: num('tp'), fm: num('fm') };
    const changed = !t.grade || ['moisture', 'tw', 'temp', 'fm'].some(k => t.grade[k] !== g[k]);
    if (changed) t.grade = { ...g, source: e && ['m', 'tw', 'tp'].includes(e.target.id) ? 'manual' : (t.grade?.source || null) };
  }
  await DB.put('tickets', t);
  renderYard(); renderDetailInfo();
}
function loadDetail() {
  const t = selTicket();
  const src = t || S.draft;
  const dir = t ? t.dir : S.dir;
  $('buyer').value = src.buyer || '';
  fillContracts(src.contractNo || '');
  for (const [id, k] of Object.entries(FORM_KEYS)) if (!['buyer', 'contract'].includes(id) && src[k] != null && src[k] !== '') $(id).value = src[k];
  if (!t) { $('driver').value = S.draft.driver || ''; $('rm').value = S.draft.remarks || ''; $('truck').value = S.draft.truck || ''; }
  if (!$('op').value) $('op').value = S.config.operator || '';
  const g = (t && t.grade) || {};
  $('m').value = g.moisture ?? ''; $('tw').value = g.tw ?? ''; $('tp').value = g.temp ?? ''; $('fm').value = g.fm ?? (t ? '' : (L().settings.FMDefault ?? 0));
  $('dOut').setAttribute('aria-pressed', dir === 'OUT'); $('dIn').setAttribute('aria-pressed', dir === 'IN');
  $('dOut').disabled = $('dIn').disabled = !!t;
  document.querySelectorAll('[data-dir]').forEach(el => el.hidden = el.dataset.dir !== dir);
  $('gradeBox').querySelectorAll('input').forEach(i => i.disabled = !t);
  renderDetailInfo();
}

// ---------------- weighing ----------------
function scaleBlock() {
  const w = S.weight;
  if (!w.at || Date.now() - w.at > STALE_MS) return 'No reading from the scale';
  if (w.over) return 'Scale is over range or not ready';
  if (w.motion) return 'Scale in motion · wait for it to settle';
  if (w.lb < MIN_LOAD_LB) return 'Nothing on the scale';
  return '';
}
function weighInBlock() {
  if (!S.counters) return 'Finish setup in Settings first';
  if (selTicket()) return 'A yard truck is selected · tap + New truck';
  const s = scaleBlock(); if (s) return s;
  const d = readForm();
  if (S.dir === 'OUT' && !d.buyer) return 'Pick a buyer';
  if (S.dir === 'IN' && !d.field) return 'Pick a field';
  if (!d.truck) return 'Enter the truck';
  const dup = openTickets().find(t => t.truck.toLowerCase() === d.truck.toLowerCase());
  if (dup) return `${d.truck} is already on the yard (${pad6(dup.no)})`;
  if (S.dir === 'IN' && openTickets().filter(t => t.dir === 'IN').length >= 100) return 'All 100 load numbers are in use';
  return '';
}
function weighOutBlock(t) {
  if (!t) return 'Tap a truck on the yard first';
  const s = scaleBlock(); if (s) return s;
  const w = S.weight.lb;
  if (t.dir === 'OUT' && w < t.first.lb + MIN_LOAD_LB) return `Not above its empty weight (${fmt0(t.first.lb)} lb) · wrong truck?`;
  if (t.dir === 'IN' && w > t.first.lb - MIN_LOAD_LB) return `Not below its loaded weight (${fmt0(t.first.lb)} lb) · dumped yet?`;
  return '';
}
async function weighIn() {
  const why = weighInBlock(); if (why) return toast(why);
  const w = S.weight.lb, dir = S.dir, d = readForm(), now = new Date().toISOString();
  const inUse = openTickets().filter(t => t.dir === 'IN').map(t => t.loadNo);
  const t = await DB.issue(c => {
    const ticket = {
      no: c.nextTicket, dir, status: 'Open', bol: dir === 'OUT' ? c.nextBol : null, loadNo: null,
      ...d, contractNo: dir === 'OUT' ? d.contractNo : '', buyer: dir === 'OUT' ? d.buyer : '', field: dir === 'IN' ? d.field : '',
      first: { lb: w, at: now }, second: null,
      grade: dir === 'IN' ? { moisture: null, tw: null, temp: null, fm: Number(L().settings.FMDefault || 0), source: null } : null,
      readings: [], synced: false, createdAt: now, station: S.config.station, test: !!S.config.test
    };
    const nc = { ...c, nextTicket: c.nextTicket + 1 };
    if (dir === 'OUT') nc.nextBol = c.nextBol + 1;
    if (dir === 'IN') { ticket.loadNo = P.nextLoadNo(c.lastLoad, inUse); nc.lastLoad = ticket.loadNo; }
    return { ticket, counters: nc };
  });
  S.counters = await DB.get('kv', 'counters');
  S.tickets.push(t);
  S.draft = { ...S.draft, truck: '', driver: '', remarks: '' };
  toast(dir === 'IN'
    ? `Ticket ${pad6(t.no)} · LOAD # ${t.loadNo} · ${t.truck} in at ${fmt0(w)} lb. Key ${t.loadNo} into the moisture tester.`
    : `Ticket ${pad6(t.no)} · ${t.truck} in empty at ${fmt0(w)} lb`, 5000);
  render(); loadDetail();
}
async function weighOut() {
  const t = selTicket(); const why = weighOutBlock(t); if (why) return toast(why);
  if (t.dir === 'IN' && (!t.grade || t.grade.moisture == null) && !t._noGradeOk) {
    t._noGradeOk = true; toast(`Load ${t.loadNo} has no moisture reading. Press Weigh Out again to close it without one.`, 6000); return;
  }
  const w = S.weight.lb, now = new Date().toISOString();
  t.second = { lb: w, at: now };
  if (t.dir === 'OUT') { t.tare = t.first.lb; t.gross = w; } else { t.gross = t.first.lb; t.tare = w; }
  t.net = t.gross - t.tare;
  t.wetBu = Math.round(t.net / lbPerBu(t.commodity) * 100) / 100;
  if (t.dir === 'OUT' && t.contractNo && t.contractNo !== 'TBD') t.applied = P.applyToContracts(t.wetBu, t.contractNo, L().contracts, appliedNow()).parts;
  t.status = 'Closed'; t.closedAt = now; delete t._noGradeOk;
  await DB.put('tickets', t);
  S.sel = null;
  printTicket(t);
  toast(`Ticket ${pad6(t.no)} closed · net ${fmt0(t.net)} lb · ${fmt2(t.wetBu)} bu · printing`, 5000);
  render(); loadDetail(); sync();
}
let voidArm = 0;
async function voidTicket() {
  const t = selTicket(); if (!t) return;
  if (Date.now() - voidArm > 4000) { voidArm = Date.now(); $('void').classList.add('armed'); $('void').textContent = 'Tap again to void'; setTimeout(() => { $('void').classList.remove('armed'); $('void').textContent = 'Void ticket'; }, 4000); return; }
  voidArm = 0;
  t.status = 'Void'; t.closedAt = new Date().toISOString();
  await DB.put('tickets', t);
  S.sel = null; toast(`Ticket ${pad6(t.no)} voided · the number stays on record`);
  render(); loadDetail(); sync();
}

// ---------------- printing ----------------
function ticketText(t) {
  // Half-sheet (8.5 x 5.5 in, landscape) layout modeled on the old Agtrax ticket.
  const W = 76, out = [];
  const lr = (a, b = '') => out.push(String(a) + ' '.repeat(Math.max(1, W - String(a).length - String(b).length)) + b);
  const ctr = s => out.push(' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s);
  // weight row: date/time, dotted label, right-aligned value
  const wrow = (when, label, val) => out.push(' '.repeat(22) + (when || '').padEnd(18) + (label + ' ').padEnd(12, '.') + ' : ' + String(val).padStart(15));
  const kind = t.status === 'Void' ? 'VOID' : (t.dir === 'OUT' ? 'OUTBOUND' : 'INBOUND');
  if (t.test) ctr('******** TEST TICKET - NOT VALID ********');
  ctr('BLUE BARN LAND & CATTLE'); ctr('2949 S Road'); ctr('Haviland, KS 67059'); ctr('P: 620-995-4245');
  out.push('');
  lr((t.commodity || '').toUpperCase() + '   CROP YEAR ' + (t.cropYear || ''), kind);
  lr('', pad6(t.no));
  if (t.dir === 'OUT') {
    lr((t.buyer || '').toUpperCase());
    lr('CONTRACT ' + (t.contractNo === 'TBD' || !t.contractNo ? 'TO BE ASSIGNED' : String(t.contractNo)));
  } else {
    lr('FIELD ' + (t.field || '').toUpperCase());
    lr('LOAD # ' + t.loadNo);
  }
  if (t.status === 'Closed') {
    const grossAt = t.dir === 'OUT' ? t.second.at : t.first.at, tareAt = t.dir === 'OUT' ? t.first.at : t.second.at;
    out.push('');
    wrow(dt(grossAt), 'GROSS', fmt0(t.gross) + ' lb');
    wrow(dt(tareAt), 'TARE', fmt0(t.tare) + ' lb');
    wrow('', 'NET', fmt0(t.net) + ' lb');
    wrow('', 'BUSHELS', fmt2(t.wetBu) + '   ');
    if (t.applied && t.applied.length > 1) {
      out.push('');
      t.applied.forEach((p, i) => lr(' '.repeat(40) + (i ? ' '.repeat(11) : 'APPLIED TO ') + p.contractNo + (p.rolled ? ' (ROLLED)' : ''), fmt2(p.bu) + ' bu'));
    }
    if (t.dir === 'IN') {
      const g = t.grade || {};
      out.push('*' + '-'.repeat(30) + ' GRADES ' + '-'.repeat(W - 40) + '*');
      out.push('MOISTURE ' + String(g.moisture ?? '-').padEnd(10) + 'TEST WEIGHT ' + String(g.tw ?? '-').padEnd(10) + (g.fm ? 'FM ' + g.fm : ''));
      const sh = sharesFor(t.field, t.cropYear);
      if (sh.length) P.splitNet(t.net, lbPerBu(t.commodity), sh).forEach(s => lr(`${s.owner.toUpperCase()}   ${s.pct}%`, fmt0(s.netLb) + ' lb   '));
      else out.push('SPLIT: NOT SET FOR THIS FIELD - OFFICE TO FIX');
    }
  }
  out.push('');
  out.push('TRUCK: ' + (t.truck || '').toUpperCase() + (t.driver ? '   DRIVER: ' + t.driver.toUpperCase() : ''));
  if (t.bol) out.push('BILL OF LADING: ' + t.bol);
  if (t.remarks) out.push('REMARKS: ' + t.remarks);
  out.push('', '', '_'.repeat(32) + ' '.repeat(W - 64) + '_'.repeat(32));
  lr('DRIVER', ('WEIGHMASTER ' + (t.operator || '').toUpperCase()).padEnd(32));
  if (t.test) ctr('******** TEST TICKET - NOT VALID ********');
  return out.join('\n');
}
// Prints only the ticket: the page's print stylesheet hides the app and shows #printArea.
// (Printing from a hidden frame printed the whole screen on iPad Safari.)
function printTicket(t) {
  let a = $('printArea');
  if (!a) { a = document.createElement('div'); a.id = 'printArea'; document.body.appendChild(a); }
  a.innerHTML = `<pre>${esc(ticketText(t))}</pre>`;
  setTimeout(() => { try { window.print(); } catch (e) { toast('Printing failed: ' + e.message); } }, 100);
}

// ---------------- sync ----------------
async function api(body) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(S.config.backendUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...body, key: S.config.key }), redirect: 'follow', signal: ctl.signal });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Backend error');
    return j;
  } finally { clearTimeout(tm); }
}
const wire = t => ({
  no: t.no, dir: t.dir, status: t.status, bol: t.bol, loadNo: t.loadNo, commodity: t.commodity, cropYear: t.cropYear,
  field: t.field, buyer: t.buyer, contractNo: t.contractNo, truck: t.truck, driver: t.driver, operator: t.operator, remarks: t.remarks,
  gross: t.gross ?? null, tare: t.tare ?? null, net: t.net ?? null, wetBu: t.wetBu ?? null,
  timeIn: t.first && t.first.at, timeOut: t.second ? t.second.at : null, closedAt: t.closedAt,
  moisture: t.grade?.moisture ?? null, tw: t.grade?.tw ?? null, temp: t.grade?.temp ?? null, fm: t.grade?.fm ?? null, gradeSource: t.grade?.source ?? null,
  readings: (t.readings || []).length, station: t.station, test: t.test
});
async function refreshLists() {
  const j = await api({ action: 'lists' });
  S.lists = { customers: j.customers, fields: j.fields, shares: j.shares, commodities: j.commodities.length ? j.commodities : EMPTY_LISTS.commodities, contracts: j.contracts, settings: j.settings };
  S.listsAt = Date.now();
  await DB.put('kv', S.lists, 'lists'); await DB.put('kv', S.listsAt, 'listsAt');
  fillLists(); loadDetail();
}
async function sync(force) {
  if (S.syncing) return;
  if (!S.config.backendUrl || !S.config.key) { S.net = 'nobackend'; renderPills(); return; }
  S.syncing = true;
  try {
    const p = pending();
    if (p.length) {
      const res = await api({ action: 'saveTickets', station: S.config.station, tickets: p.map(wire) });
      for (const no of res.saved || []) { const t = S.tickets.find(x => x.no === no); if (t) { t.synced = true; t.syncedAt = new Date().toISOString(); await DB.put('tickets', t); } }
      (res.warnings || []).forEach(w => { log('sync', 'Warning: ' + w); toast(w, 7000); });
      log('sync', `Sent ${p.length}, saved ${(res.saved || []).length}`);
    }
    // Refresh lists after any upload so contract balances include the loads just sent.
    if (force || p.length || Date.now() - S.listsAt > 5 * 60e3) await refreshLists();
    S.net = 'online'; S.netErr = ''; S.lastSync = Date.now();
  } catch (e) {
    S.net = 'offline'; S.netErr = e.name === 'AbortError' ? 'timed out' : e.message; log('sync', 'Failed: ' + S.netErr);
  } finally { S.syncing = false; render(); }
}

// ---------------- rendering ----------------
function renderScale() {
  const w = S.weight, stale = !w.at || Date.now() - w.at > STALE_MS;
  $('w').textContent = stale && !w.at ? '—' : fmt0(w.lb);
  $('w').className = 'weight' + (stale ? ' stale' : w.motion ? ' motion' : '');
  const f = $('flag');
  f.textContent = stale ? 'NO DATA' : w.over ? 'OVER/NOT READY' : w.motion ? 'MOTION' : 'STABLE';
  f.className = 'flag' + (stale ? '' : w.over ? ' over' : w.motion ? ' moving' : ' stable');
  $('raw').textContent = w.raw ? 'raw: "' + w.raw + '"' : 'waiting for scale';
  $('wsrc').textContent = 'Live weight · ' + (w.mode === 'N' ? 'Net' : 'Gross') + (S.ports.some(p => p.sim) ? ' · SIMULATOR' : '');
  const t = selTicket();
  const inWhy = weighInBlock(), outWhy = weighOutBlock(t);
  $('wIn').disabled = !!inWhy; $('wInWhy').textContent = inWhy || (S.dir === 'IN' ? 'Loaded · gets a load #' : 'Empty · opens a ticket');
  $('wOut').disabled = !!outWhy; $('wOutWhy').textContent = outWhy || (t ? `Closes ${pad6(t.no)} · ${t.truck}` : '');
  if (t && !stale && !w.motion) {
    const second = w.lb, net = t.dir === 'OUT' ? second - t.first.lb : t.first.lb - second;
    $('vSecond').textContent = fmt0(second); $('vNet').textContent = net > 0 ? fmt0(net) : '—';
    $('vBu').textContent = net > 0 ? fmt2(net / lbPerBu(t.commodity)) : '0.00';
  }
}
function renderPills() {
  const n = pending().length;
  const pNet = $('pNet');
  if (S.net === 'online') { pNet.textContent = n ? `Syncing · ${n} waiting` : 'Online · synced'; pNet.className = 'pill ok'; }
  else if (S.net === 'offline') { pNet.textContent = `Offline · ${n} waiting`; pNet.className = 'pill warn'; pNet.title = S.netErr; }
  else if (S.net === 'nobackend') { pNet.textContent = `No backend set · ${n} waiting`; pNet.className = 'pill warn'; }
  else { pNet.textContent = 'Connecting…'; pNet.className = 'pill'; }
  const sc = S.ports.find(p => p.role === 'scale'), mo = S.ports.find(p => p.role === 'moist');
  const unassigned = S.ports.filter(p => !p.role && !p.sim).length;
  const fresh = S.weight.at && Date.now() - S.weight.at < STALE_MS;
  $('pScale').textContent = sc ? (fresh ? 'Scale ✓' : 'Scale · no data') : 'Scale · not connected';
  $('pScale').className = 'pill ' + (sc && fresh ? 'ok' : 'bad');
  $('pMoist').textContent = (mo ? 'Moisture ✓' : S.config.sim ? 'Moisture · simulator' : 'Moisture · waiting') + (unassigned ? ` · ${unassigned} port listening` : '');
  $('pMoist').className = 'pill ' + (mo || S.config.sim ? 'ok' : '');
  $('pTest').hidden = !S.config.test;
  $('sim').hidden = !S.config.sim;
  const b = $('banner');
  if (!S.counters) { b.hidden = false; b.textContent = 'Finish setup: open Settings and enter the starting ticket and bill of lading numbers.'; }
  else if (S.net === 'offline' && n) { b.hidden = false; b.textContent = `No internet. Keep weighing; ${n} ticket${n > 1 ? 's are' : ' is'} saved on this PC and will upload when it's back. Don't clear this browser's data.`; }
  else b.hidden = true;
}
function renderYard() {
  const l = $('ylist'), open = openTickets();
  $('ycount').textContent = open.length;
  if (!open.length) { l.innerHTML = '<div class="empty">No trucks waiting. Weigh In opens a ticket for each truck.</div>'; return; }
  l.innerHTML = '';
  open.forEach(t => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'yrow'; b.setAttribute('aria-pressed', t.no === S.sel);
    const mins = Math.round((Date.now() - new Date(t.first.at)) / 60000);
    const lead = t.dir === 'IN' ? `<span class="loadbig">#${t.loadNo}</span>` : `<span class="no">${pad6(t.no)}</span>`;
    const what = t.dir === 'IN' ? `${esc(t.field)}${t.grade && t.grade.moisture != null ? ' · ' + t.grade.moisture + '% moist' : ' · no moisture yet'}` : `${esc(t.buyer)} · ${esc(t.contractNo === 'TBD' ? 'contract TBD' : t.contractNo)}`;
    b.innerHTML = `<span class="dir ${t.dir}">${t.dir}</span>${lead}<span class="trk">${esc(t.truck)}</span><span class="wt">${fmt0(t.first.lb)} lb</span><span class="sub">${t.dir === 'IN' ? pad6(t.no) + ' · ' : ''}${esc(t.driver || '')}${t.driver ? ' · ' : ''}in ${hm(t.first.at)} (${mins} min) · ${what}</span>`;
    b.onclick = () => { S.sel = S.sel === t.no ? null : t.no; if (S.sel && t.dir === 'IN') $('sLoadNo').value = t.loadNo; render(); loadDetail(); };
    l.appendChild(b);
  });
}
function renderUnmatched() {
  const box = $('unmatchedBox'), l = $('unmatched');
  box.hidden = !S.unmatched.length;
  const ins = openTickets().filter(t => t.dir === 'IN');
  l.innerHTML = '';
  S.unmatched.forEach((r, i) => {
    const d = document.createElement('div'); d.className = 'um';
    d.innerHTML = `<span><b>Load # ${r.loadNo ?? '?'}</b> · ${esc(r.grain)} · ${r.moisture}% · TW ${r.tw} · ${hm(r.at)}</span>
      <select aria-label="Assign to load">${ins.map(t => `<option value="${t.no}">#${t.loadNo} ${esc(t.truck)}</option>`).join('')}</select>
      <button class="ghost" type="button" data-a="assign"${ins.length ? '' : ' disabled'}>Assign</button><button class="ghost bad" type="button" data-a="drop">Discard</button>`;
    d.querySelector('[data-a=assign]').onclick = async () => { const t = S.tickets.find(x => x.no === Number(d.querySelector('select').value)); if (!t) return; S.unmatched.splice(i, 1); await DB.put('kv', S.unmatched, 'unmatched'); await attachReading(t, r); render(); loadDetail(); };
    d.querySelector('[data-a=drop]').onclick = async () => { S.unmatched.splice(i, 1); await DB.put('kv', S.unmatched, 'unmatched'); render(); };
    l.appendChild(d);
  });
}
function renderDone() {
  const rows = S.tickets.filter(t => t.status !== 'Open' && (isToday(t.closedAt) || !t.synced)).sort((a, b) => b.no - a.no);
  $('done').innerHTML = rows.length ? rows.map(t => `<tr data-no="${t.no}"><td>${pad6(t.no)}</td><td>${t.dir}</td><td>${esc(t.truck)}</td><td>${hm(t.closedAt)}</td><td class="n">${t.status === 'Void' ? 'Void' : fmt2(t.wetBu)}</td><td style="color:var(--${t.synced ? 'ok' : 'warn'})">${t.synced ? 'Synced' : 'Waiting'}</td></tr>`).join('')
    : '<tr><td colspan="6" class="hint">Nothing finished today yet.</td></tr>';
  $('done').querySelectorAll('tr[data-no]').forEach(tr => tr.onclick = () => { const t = S.tickets.find(x => x.no === Number(tr.dataset.no)); if (t) { printTicket(t); toast('Reprinting ' + pad6(t.no)); } });
}
function renderDetailInfo() {
  const t = selTicket(), dir = t ? t.dir : S.dir;
  $('dTitle').textContent = t ? `Ticket ${pad6(t.no)} · ${t.truck}` : 'New truck';
  $('dState').textContent = t ? (t.dir === 'IN' ? 'On the yard · unloading' : 'On the yard · loading') : 'Not weighed';
  $('dState').className = 'state ' + (t ? 'open' : 'new');
  $('vFirstLbl').textContent = dir === 'OUT' ? 'Tare · empty in' : 'Gross · loaded in';
  $('vSecondLbl').textContent = dir === 'OUT' ? 'Gross · loaded out' : 'Tare · empty out';
  $('vFirst').textContent = t ? fmt0(t.first.lb) : '—';
  if (!t) { $('vSecond').textContent = '—'; $('vNet').textContent = '—'; $('vBu').textContent = '0.00'; }
  $('bol').value = t ? (t.bol ?? '') : (S.counters && dir === 'OUT' ? S.counters.nextBol + ' (next)' : '');
  $('loadNo').textContent = t && t.loadNo ? '# ' + t.loadNo : 'Assigned at weigh in';
  $('void').hidden = !t;
  const ci = contractInfo($('contract').value);
  $('cinfo').textContent = $('contract').value === 'TBD' ? 'Office assigns the contract later.' : ci ? `${fmt0(ci.delivered)} of ${fmt0(ci.Bushels)} bu delivered · ${ci.filled ? 'FILLED' : fmt0(ci.remaining) + ' left'}${ci.next ? ` · overflow rolls to ${ci.next}` : ' · no other open contract for this buyer'}${S.net !== 'online' ? ' (as of last sync)' : ''}` : '';
  const sh = sharesFor($('field').value, $('cy').value);
  $('shareInfo').textContent = !$('field').value ? '' : sh.length ? sh.map(s => `${s.owner} ${s.pct}%`).join(' · ') : 'No split set for this field and crop year. Office must fix it.';
  const rd = t && t.readings && t.readings.length ? t.readings : [];
  $('readings').textContent = rd.length > 1 ? `${rd.length} readings: ` + rd.map(r => `${r.moisture}% at ${hm(r.at)}`).join(', ') + ' · using the newest' : (t && t.grade && t.grade.source === 'manual' ? 'Entered by hand' : '');
  $('sum').textContent = t ? (t.dir === 'OUT' ? 'Load the truck, roll it on, then Weigh Out' : `Sample with load # ${t.loadNo}, dump, roll on empty, then Weigh Out`)
    : (S.dir === 'OUT' ? 'Empty truck on the scale? Fill in the details and Weigh In.' : 'Loaded truck on the scale? Pick the field and Weigh In.');
}
function renderDiag() {
  const ports = S.ports.map(p => `${p.sim ? 'simulator' : 'USB ' + (p.info.usbVendorId || '?') + ':' + (p.info.usbProductId || '?')} → ${p.role || 'listening'} · ${p.lines} lines, ${p.bad} unreadable`).join('\n') || 'none';
  const c = S.counters || {};
  $('diagBody').innerHTML = `
    <div><div class="label">Ports</div><pre>${esc(ports)}</pre></div>
    <div><div class="label">Scale lines</div><pre>${esc(S.diag.scale.join('\n'))}</pre></div>
    <div><div class="label">Moisture lines</div><pre>${esc(S.diag.moist.join('\n'))}</pre></div>
    <div><div class="label">Unreadable lines</div><pre>${esc(S.diag.other.join('\n'))}</pre></div>
    <div><div class="label">Sync</div><pre>${esc(`Status: ${S.net} ${S.netErr}\nWaiting: ${pending().length}\nLists: ${S.listsAt ? new Date(S.listsAt).toLocaleString() : 'never'}\n` + S.diag.sync.join('\n'))}</pre></div>
    <div><div class="label">This PC</div><pre>${esc(`App ${VERSION}\nNext ticket ${c.nextTicket ?? '-'} · next BOL ${c.nextBol ?? '-'} · last load # ${c.lastLoad ?? '-'}\nTickets stored here: ${S.tickets.length}\nSerial support: ${'serial' in navigator ? 'yes' : 'NO'}`)}</pre></div>`;
}
function render() { renderPills(); renderScale(); renderYard(); renderUnmatched(); renderDone(); renderDetailInfo(); if ($('diag').open) renderDiag(); }

// ---------------- settings ----------------
function openSettings(first) {
  const c = S.config, k = S.counters || {};
  $('setIntro').textContent = first ? 'First-time setup for this PC. The starting numbers come from the backend if it is connected; check them before saving.' : 'Changing the ticket numbers here affects the next ticket issued on this PC.';
  $('sUrl').value = c.backendUrl; $('sKey').value = c.key; $('sStation').value = c.station; $('sOp').value = c.operator;
  $('sTicket').value = k.nextTicket ?? (L().settings.NextTicketNo || ''); $('sBol').value = k.nextBol ?? (L().settings.NextBOLNo || '');
  $('sBaud').value = String(c.baud || 9600); $('sTest').checked = !!c.test; $('sSim').checked = !!c.sim; $('setMsg').textContent = '';
  $('settings').showModal();
}
async function checkBackend() {
  const prev = { ...S.config };
  S.config.backendUrl = $('sUrl').value.trim(); S.config.key = $('sKey').value.trim();
  $('setMsg').textContent = 'Checking…';
  try {
    const j = await api({ action: 'ping' });
    await refreshLists();
    if (!$('sTicket').value && L().settings.NextTicketNo) $('sTicket').value = L().settings.NextTicketNo;
    if (!$('sBol').value && L().settings.NextBOLNo) $('sBol').value = L().settings.NextBOLNo;
    $('setMsg').textContent = `Connected to "${j.sheet}". ${L().customers.length} customers, ${L().fields.length} fields, ${L().contracts.length} open contracts.`;
  } catch (e) { $('setMsg').textContent = 'Could not connect: ' + e.message; Object.assign(S.config, { backendUrl: prev.backendUrl, key: prev.key }); }
}
async function saveSettings() {
  const nt = parseInt($('sTicket').value, 10), nb = parseInt($('sBol').value, 10);
  if (!(nt > 0) || !(nb > 0)) { $('setMsg').textContent = 'Enter the next ticket number and next bill of lading number.'; return; }
  const maxUsed = Math.max(0, ...S.tickets.map(t => t.no));
  if (nt <= maxUsed) { $('setMsg').textContent = `Ticket ${pad6(maxUsed)} already exists on this PC. The next ticket must be higher.`; return; }
  const wasSim = S.config.sim;
  S.config = { ...S.config, backendUrl: $('sUrl').value.trim(), key: $('sKey').value.trim(), station: $('sStation').value.trim() || 'Scale house', operator: $('sOp').value.trim(), baud: Number($('sBaud').value), test: $('sTest').checked, sim: $('sSim').checked };
  await DB.put('kv', S.config, 'config');
  S.counters = { ...(S.counters || { lastLoad: 0 }), nextTicket: nt, nextBol: nb };
  await DB.put('kv', S.counters, 'counters');
  if (S.config.sim && !wasSim) simStart(); if (!S.config.sim && wasSim) simStop();
  $('settings').close(); toast('Settings saved'); fillLists(); render(); loadDetail(); sync(true);
}

// ---------------- start ----------------
async function init() {
  S.config = { ...DEFAULT_CONFIG, ...(await DB.get('kv', 'config') || {}) };
  S.counters = await DB.get('kv', 'counters') || null;
  S.lists = await DB.get('kv', 'lists') || null;
  S.listsAt = await DB.get('kv', 'listsAt') || 0;
  S.unmatched = await DB.get('kv', 'unmatched') || [];
  S.tickets = await DB.all('tickets');
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(e => log('other', 'Offline cache: ' + e.message));

  $('dOut').onclick = () => { S.dir = 'OUT'; loadDetail(); renderScale(); };
  $('dIn').onclick = () => { S.dir = 'IN'; loadDetail(); renderScale(); };
  $('wIn').onclick = weighIn; $('wOut').onclick = weighOut; $('void').onclick = voidTicket;
  $('newT').onclick = () => { S.sel = null; render(); loadDetail(); $('truck').focus(); };
  $('btnPort').onclick = connectPort; $('btnSettings').onclick = () => openSettings(false);
  $('sCheck').onclick = checkBackend; $('sSave').onclick = saveSettings; $('sCancel').onclick = () => $('settings').close();
  $('sEmpty').onclick = () => { SIM.target = 26000 + Math.round(Math.random() * 250) * 20; };
  $('sLoad').onclick = () => { const t = selTicket(); SIM.target = t && t.dir === 'OUT' ? t.first.lb + 54000 + Math.round(Math.random() * 200) * 20 : 80000 + Math.round(Math.random() * 300) * 20; };
  $('sOff').onclick = () => { SIM.target = 0; };
  $('sMoist').onclick = simMoisture;
  $('diag').addEventListener('toggle', () => { if ($('diag').open) renderDiag(); });
  for (const id of Object.keys(FORM_KEYS).concat(['m', 'tw', 'tp', 'fm'])) { $(id).addEventListener('change', onFormEdit); $(id).addEventListener('input', onFormEdit); }
  window.addEventListener('online', () => sync(true));

  fillLists(); loadDetail(); render();
  if (S.config.sim) simStart();
  reopenKnownPorts();
  if (!S.counters) openSettings(true);
  sync(true);
  setInterval(sync, 15000);
  setInterval(() => { renderPills(); renderScale(); }, 1000);
  setInterval(renderYard, 30000);
}
init().catch(e => { document.body.insertAdjacentHTML('afterbegin', `<div class="banner">The app could not start: ${esc(e.message)}. Browser storage may be blocked.</div>`); });
})();
