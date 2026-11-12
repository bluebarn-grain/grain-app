/* Blue Barn Grain — office side: contracts, reports and inventory adjustments.
   Reads everything from the backend's officeData (cached on this device so it opens offline),
   does the math in reports.js, and writes contracts and adjustments back to the Sheet. */
(() => {
'use strict';
const R = window.BBR;
const $ = id => document.getElementById(id);
let A;                                  // the scale app's helpers (window.BBG_APP)
const O = { data: null, tab: 'contracts', year: '', open: {}, busy: false, adjType: '', contract: null, customer: null, field: null, shareRows: [] };

const n0 = v => A.fmt0(v), n2 = v => A.fmt2(v), e = v => A.esc(v);
const day = v => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`; };
const isoDay = v => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const today = () => isoDay(new Date());
const testMode = () => !!(A.S.config && A.S.config.test);
const opt = () => ({ includeTest: testMode(), cropYear: O.year });
const ac = v => Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
const signed = v => (v > 0 ? '+' : '') + n2(v);

// ---------------- data ----------------
async function load(force) {
  if (!O.data) O.data = await A.DB.get('kv', 'office') || null;
  render();
  if (!A.configured()) { status('Connect the backend in Settings to load the office data.'); return; }
  if (O.busy) return;
  if (!force && O.data && Date.now() - new Date(O.data.at).getTime() < 60000) return;
  O.busy = true; status('Loading from the Sheet…');
  try {
    const j = await A.api({ action: 'officeData' });
    delete j.ok; O.data = j;
    await A.DB.put('kv', j, 'office');
  } catch (err) {
    status(`Couldn't reach the Sheet (${err.message}). ` + (O.data ? 'Showing the last copy.' : ''));
    O.busy = false; return;
  }
  O.busy = false; render();
}
function status(msg) {
  const d = O.data;
  $('oStatus').textContent = msg || (d ? `Updated ${new Date(d.at).toLocaleString([], { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` + (testMode() ? ' · TEST MODE: test tickets included' : '') : '');
}
const D = () => O.data || { tickets: [], splits: [], allocations: [], adjustments: [], contracts: [], customers: [], fields: [], shares: [], commodities: [], settings: {} };
function years() {
  const ys = new Set();
  D().tickets.forEach(t => t.CropYear && ys.add(String(t.CropYear)));
  D().contracts.forEach(c => c.CropYear && ys.add(String(c.CropYear)));
  D().adjustments.forEach(a => a.CropYear && ys.add(String(a.CropYear)));
  const y = new Date().getFullYear(); ys.add(String(y));
  return [...ys].sort().reverse();
}
const commodities = () => (D().commodities.length ? D().commodities : A.L().commodities).map(c => c.Commodity);

// ---------------- screen ----------------
function show(view) {
  const office = view === 'office';
  $('scaleView').hidden = office; $('officeView').hidden = !office;
  $('navScale').setAttribute('aria-pressed', String(!office)); $('navOffice').setAttribute('aria-pressed', String(office));
  for (const id of ['pScale', 'pMoist', 'btnPort']) $(id).hidden = office;
  try { localStorage.setItem('bbg-view', view); } catch (_) {}
  if (office) load(false);
}
function render() {
  const ys = years();
  $('oYear').innerHTML = [['', 'All crop years'], ...ys.map(y => [y, y])].map(([v, l]) => `<option value="${v}"${String(v) === String(O.year) ? ' selected' : ''}>${l}</option>`).join('');
  document.querySelectorAll('#officeView .tabs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tab === O.tab)));
  $('oYear').hidden = O.tab === 'adjustments' || O.tab === 'customers';
  status();
  $('oBody').innerHTML = ({ contracts, customers, fieldsetup, fields, inventory, writeoffs, adjustments })[O.tab]();
  wire();
}

// ---------- contracts ----------
function contracts() {
  const applied = R.appliedByContract(D(), opt());
  const half = (Number(D().settings.TypicalLoadBu) || 1000) / 2;
  const cs = D().contracts.filter(c => !O.year || String(c.CropYear) === String(O.year))
    .sort((a, b) => (a.Status === 'Closed') - (b.Status === 'Closed') || String(a.Buyer).localeCompare(String(b.Buyer)) || new Date(a.ShipStart || 0) - new Date(b.ShipStart || 0));
  const rows = cs.map(c => {
    const shipped = applied[String(c.ContractNo)] || 0, left = Number(c.Bushels || 0) - shipped;
    const state = c.Status === 'Closed' ? 'Closed' : left < half ? 'Filled' : shipped ? 'Shipping' : 'Open';
    return `<tr data-contract="${e(c.ContractNo)}" class="${state === 'Closed' || state === 'Filled' ? 'closed' : ''}">
      <td><b>${e(c.ContractNo)}</b></td><td>${e(c.Buyer)}</td><td>${e(c.Commodity)} ${e(c.CropYear)}</td>
      <td class="n">${n0(c.Bushels)}</td><td class="n">${n2(shipped)}</td><td class="n${left < 0 ? ' neg' : ''}">${n2(left)}</td>
      <td>${day(c.ShipStart)}${c.ShipEnd ? ' – ' + day(c.ShipEnd) : ''}</td><td>${state}</td></tr>`;
  }).join('');
  return `<div class="ohead"><h2>Contracts</h2><button class="big small" type="button" id="cNew">New contract</button></div>
    ${cs.length ? `<div class="tblwrap"><table><thead><tr><th>Contract</th><th>Buyer</th><th>Crop</th><th class="n">Bushels</th><th class="n">Shipped</th><th class="n">Left</th><th>Ship window</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint">Tap a contract to change it. Filled and closed contracts don't show at the scale.</p>` : '<div class="empty">No contracts yet. Tap New contract to add one.</div>'}`;
}
function openContract(no) {
  const c = no ? D().contracts.find(x => String(x.ContractNo) === String(no)) : null;
  O.contract = c ? String(c.ContractNo) : null;
  const buyers = D().customers.filter(x => x.Type === 'Buyer').map(x => x.Customer);
  const sel = (id, items, v) => { $(id).innerHTML = items.map(i => `<option${String(i) === String(v) ? ' selected' : ''}>${e(i)}</option>`).join(''); };
  $('cTitle').textContent = c ? `Contract ${c.ContractNo}` : 'New contract';
  $('cNo').value = c ? c.ContractNo : ''; $('cNo').readOnly = !!c;
  sel('cBuyer', buyers, c ? c.Buyer : buyers[0]);
  sel('cComm', commodities(), c ? c.Commodity : 'Corn');
  const y = new Date().getFullYear();
  sel('cYear', [y + 1, y, y - 1, y - 2], c ? c.CropYear : y);
  $('cBu').value = c ? c.Bushels : ''; $('cStatus').value = c && c.Status === 'Closed' ? 'Closed' : 'Open';
  $('cStart').value = c ? isoDay(c.ShipStart) : ''; $('cEnd').value = c ? isoDay(c.ShipEnd) : '';
  $('cEmail').value = c ? (c.Email || '') : ''; $('cNotes').value = c ? (c.Notes || '') : '';
  const shipped = c ? (R.appliedByContract(D(), opt())[String(c.ContractNo)] || 0) : 0;
  $('cShipped').textContent = c ? `${n2(shipped)} bu shipped so far` : '';
  $('cMsg').textContent = '';
  $('contractDlg').showModal();
  if (!c) $('cNo').focus();
}
async function saveContract() {
  const c = { ContractNo: $('cNo').value.trim(), Buyer: $('cBuyer').value, Commodity: $('cComm').value, CropYear: $('cYear').value,
    Bushels: Number(String($('cBu').value).replace(/,/g, '')), Status: $('cStatus').value, ShipStart: $('cStart').value, ShipEnd: $('cEnd').value,
    Email: $('cEmail').value.trim(), Notes: $('cNotes').value.trim() };
  if (!c.ContractNo) return msg('cMsg', 'Enter the contract #.');
  if (!(c.Bushels > 0)) return msg('cMsg', 'Enter the contract bushels.');
  if (c.ShipStart && c.ShipEnd && c.ShipEnd < c.ShipStart) return msg('cMsg', 'Ship end is before ship start.');
  $('cSave').disabled = true; msg('cMsg', 'Saving…');
  try {
    await A.api({ action: 'saveContract', isNew: !O.contract, contract: c });
    $('contractDlg').close(); A.toast(`Contract ${c.ContractNo} saved`);
    await load(true); A.refreshLists().catch(() => {});
  } catch (err) { msg('cMsg', err.message); }
  finally { $('cSave').disabled = false; }
}
const msg = (id, t) => { $(id).textContent = t; };

// ---------- customers ----------
function customers() {
  const cs = D().customers.slice().sort((a, b) => (a.Active === false) - (b.Active === false) || String(a.Type).localeCompare(String(b.Type)) || String(a.Customer).localeCompare(String(b.Customer)));
  return `<div class="ohead"><h2>Customers</h2><button class="big small" type="button" id="kNew">New customer</button></div>
    ${cs.length ? `<div class="tblwrap"><table><thead><tr><th>Name</th><th>Type</th><th>Pays as</th><th>Contact</th><th>Phone</th><th>Email</th></tr></thead><tbody>
    ${cs.map(c => `<tr data-customer="${e(c.Customer)}" class="${c.Active === false || String(c.Active).toUpperCase() === 'FALSE' ? 'closed' : ''}"><td><b>${e(c.Customer)}</b></td><td>${e(c.Type)}</td><td>${e(c.PaysAsName)}</td><td>${e(c.Contact)}</td><td>${e(c.Phone)}</td><td>${e(c.Email)}</td></tr>`).join('')}
    </tbody></table></div><p class="hint">Buyers, landlords and the farm itself (Operator). Tap one to change it. The buyer's email is where the nightly shipment emails go. Inactive customers are grayed out and don't show at the scale.</p>` : '<div class="empty">No customers yet.</div>'}`;
}
function openCustomer(name) {
  const c = name ? D().customers.find(x => x.Customer === name) : null;
  O.customer = c ? c.Customer : null;
  $('kTitle').textContent = c ? c.Customer : 'New customer';
  $('kName').value = c ? c.Customer : ''; $('kName').readOnly = !!c;
  $('kType').value = c ? c.Type : 'Landlord';
  $('kPays').value = c ? c.PaysAsName || '' : ''; $('kContact').value = c ? c.Contact || '' : ''; $('kPhone').value = c ? c.Phone || '' : '';
  $('kEmail').value = c ? c.Email || '' : ''; $('kAddr').value = c ? c.Address || '' : ''; $('kNotes').value = c ? c.Notes || '' : '';
  $('kActive').checked = !c || !(c.Active === false || String(c.Active).toUpperCase() === 'FALSE');
  $('kMsg').textContent = '';
  $('custDlg').showModal(); if (!c) $('kName').focus();
}
async function saveCustomer() {
  const c = { Customer: $('kName').value.trim(), Type: $('kType').value, PaysAsName: $('kPays').value, Contact: $('kContact').value, Phone: $('kPhone').value,
    Email: $('kEmail').value, Address: $('kAddr').value, Notes: $('kNotes').value, Active: $('kActive').checked };
  if (!c.Customer) return msg('kMsg', 'Enter the name.');
  $('kSave').disabled = true; msg('kMsg', 'Saving…');
  try {
    await A.api({ action: 'saveCustomer', isNew: !O.customer, customer: c });
    $('custDlg').close(); A.toast(`${c.Customer} saved`);
    await load(true); A.refreshLists().catch(() => {});
  } catch (err) { msg('kMsg', err.message); }
  finally { $('kSave').disabled = false; }
}

// ---------- fields and splits ----------
const splitYear = () => O.year || String(new Date().getFullYear());
const sharesOf = (field, y) => D().shares.filter(s => s.Field === field && String(s.CropYear) === String(y));
function fieldsetup() {
  const y = splitYear();
  const fs = D().fields.slice().sort((a, b) => (a.Active === false) - (b.Active === false) || String(a.Field).localeCompare(String(b.Field)));
  const missing = fs.filter(f => f.Active !== false && !sharesOf(f.Field, y).length).length;
  const totAc = fs.filter(f => f.Active !== false).reduce((a, f) => a + (Number(f.Acres) || 0), 0);
  return `<div class="ohead"><h2>Fields and ${e(y)} splits</h2><button class="big small" type="button" id="fNew">New field</button></div>
    ${missing ? `<div class="banner">${missing} active field${missing === 1 ? ' has' : 's have'} no ${e(y)} split. Loads from ${missing === 1 ? 'it' : 'them'} print "SPLIT NOT SET" until it's added.</div>` : ''}
    ${fs.length ? `<div class="tblwrap"><table><thead><tr><th>Field</th><th class="n">Acres</th><th>${e(y)} split</th><th>Insurance unit</th><th>FSA farm / tract</th></tr></thead><tbody>
    ${fs.map(f => { const sh = sharesOf(f.Field, y); return `<tr data-field="${e(f.Field)}" class="${f.Active === false || String(f.Active).toUpperCase() === 'FALSE' ? 'closed' : ''}"><td><b>${e(f.Field)}</b></td><td class="n">${f.Acres ? ac(f.Acres) : '—'}</td>
      <td>${sh.length ? sh.map(s => `${e(s.Owner)} ${Number(s.SharePct)}%`).join(', ') : '<span class="tag">No split</span>'}</td><td>${e(f.InsuranceUnit)}</td><td>${e(f.FSAFarm)}${f.FSATract ? ' / ' + e(f.FSATract) : ''}</td></tr>`; }).join('')}
    <tr class="total"><td>Total active</td><td class="n">${ac(totAc)}</td><td colspan="3"></td></tr>
    </tbody></table></div><p class="hint">Pick a crop year at the top to see or set that year's splits. Tap a field to change its acres, details or split.</p>` : '<div class="empty">No fields yet.</div>'}`;
}
function ownerOptions(cur) {
  const os = D().customers.filter(c => (c.Type === 'Landlord' || c.Type === 'Operator') && (c.Active !== false || c.Customer === cur)).map(c => c.Customer).sort((a, b) => a.localeCompare(b));
  if (cur && !os.includes(cur)) os.push(cur);
  return ['', ...os].map(o => `<option value="${e(o)}"${o === cur ? ' selected' : ''}>${o ? e(o) : 'Pick an owner…'}</option>`).join('');
}
function drawShares() {
  $('fShares').innerHTML = O.shareRows.map((r, i) => `<div class="share"><select data-si="${i}" data-k="Owner">${ownerOptions(r.Owner)}</select>
    <span class="pct"><input data-si="${i}" data-k="SharePct" inputmode="decimal" value="${e(r.SharePct)}">%</span><button class="ghost bad" type="button" data-rm="${i}">Remove</button></div>`).join('') ||
    '<div class="hint">No owners yet for this year. Add one, or use Same as last year.</div>';
  $('fShares').querySelectorAll('[data-si]').forEach(x => x.oninput = x.onchange = () => { O.shareRows[x.dataset.si][x.dataset.k] = x.value; $('fMsg').textContent = ''; shareTotal(); });
  $('fShares').querySelectorAll('[data-rm]').forEach(x => x.onclick = () => { O.shareRows.splice(Number(x.dataset.rm), 1); drawShares(); });
  shareTotal();
}
function shareTotal() {
  const t = O.shareRows.reduce((a, r) => a + (Number(r.SharePct) || 0), 0);
  const good = !O.shareRows.length || Math.abs(t - 100) < 0.001;
  $('fTotal').innerHTML = O.shareRows.length ? `Total <b class="${good ? 'ok' : 'neg'}">${Math.round(t * 1000) / 1000}%</b>${good ? '' : ' — must be 100%'}` : '';
}
function loadShares() {
  const y = $('fYear').value, name = O.field;
  O.shareRows = name ? sharesOf(name, y).map(s => ({ Owner: s.Owner, SharePct: Number(s.SharePct) })) : [];
  if (!O.shareRows.length && !name) { const op = D().customers.find(c => c.Type === 'Operator'); if (op) O.shareRows = [{ Owner: op.Customer, SharePct: 100 }]; }
  const loads = name ? D().tickets.filter(t => t.Direction === 'IN' && t.Field === name && String(t.CropYear) === String(y)).length : 0;
  $('fSplitNote').textContent = loads ? `${loads} load${loads === 1 ? ' was' : 's were'} already weighed from this field for ${y}. They keep the split they were saved with; a change here applies to new loads.` : '';
  drawShares();
}
function openField(name) {
  const f = name ? D().fields.find(x => x.Field === name) : null;
  O.field = f ? f.Field : null;
  $('fTitle').textContent = f ? f.Field : 'New field';
  $('fName').value = f ? f.Field : ''; $('fName').readOnly = !!f;
  $('fAcres').value = f && f.Acres !== '' && f.Acres != null ? f.Acres : '';
  $('fOps').value = f ? f.OpsCenterName || '' : ''; $('fUnit').value = f ? f.InsuranceUnit || '' : '';
  $('fFarm').value = f ? f.FSAFarm || '' : ''; $('fTract').value = f ? f.FSATract || '' : ''; $('fNotes').value = f ? f.Notes || '' : '';
  $('fActive').checked = !f || !(f.Active === false || String(f.Active).toUpperCase() === 'FALSE');
  const y = Number(splitYear());
  $('fYear').innerHTML = [y + 1, y, y - 1, y - 2].map(v => `<option${String(v) === String(y) ? ' selected' : ''}>${v}</option>`).join('');
  $('fMsg').textContent = '';
  loadShares();
  $('fieldDlg').showModal(); if (!f) $('fName').focus();
}
function copyLastYear() {
  const y = Number($('fYear').value), name = O.field || $('fName').value.trim();
  const prev = D().shares.filter(s => s.Field === name && Number(s.CropYear) < y).reduce((m, s) => Math.max(m, Number(s.CropYear)), 0);
  if (!prev) return msg('fMsg', `No earlier split for ${name || 'this field'} to copy.`);
  O.shareRows = sharesOf(name, prev).map(s => ({ Owner: s.Owner, SharePct: Number(s.SharePct) }));
  msg('fMsg', `Copied the ${prev} split. Save to keep it for ${y}.`); drawShares();
}
async function saveField() {
  const name = $('fName').value.trim(), acresTxt = String($('fAcres').value).replace(/,/g, '').trim();
  if (!name) return msg('fMsg', 'Enter the field name.');
  if (acresTxt && !(Number(acresTxt) > 0)) return msg('fMsg', 'Acres must be a number more than 0, or blank.');
  const rows = O.shareRows.filter(r => r.Owner || r.SharePct);
  if (rows.some(r => !r.Owner)) return msg('fMsg', 'Pick an owner on every split line, or remove the empty line.');
  const total = rows.reduce((a, r) => a + (Number(r.SharePct) || 0), 0);
  if (rows.length && Math.abs(total - 100) > 0.001) return msg('fMsg', `The split adds to ${Math.round(total * 1000) / 1000}%. It has to be 100%.`);
  const before = O.field ? sharesOf(O.field, $('fYear').value).map(s => s.Owner + Number(s.SharePct)).sort().join() : '';
  const after = rows.map(r => r.Owner + Number(r.SharePct)).sort().join();
  $('fSave').disabled = true; msg('fMsg', 'Saving…');
  try {
    await A.api({ action: 'saveField', isNew: !O.field, field: { Field: name, Acres: acresTxt === '' ? '' : Number(acresTxt), OpsCenterName: $('fOps').value, InsuranceUnit: $('fUnit').value,
      FSAFarm: $('fFarm').value, FSATract: $('fTract').value, Notes: $('fNotes').value, Active: $('fActive').checked } });
    if (before !== after) await A.api({ action: 'saveShares', fieldName: name, cropYear: Number($('fYear').value), shares: rows.map(r => ({ Owner: r.Owner, SharePct: Number(r.SharePct) })) });
    $('fieldDlg').close(); A.toast(`${name} saved`);
    await load(true); A.refreshLists().catch(() => {});
  } catch (err) { msg('fMsg', err.message); }
  finally { $('fSave').disabled = false; }
}

// ---------- fields ----------
function fields() {
  const rows = R.fieldReport(D(), opt());
  if (!rows.length) return `<div class="ohead"><h2>Field report</h2></div><div class="empty">No inbound loads${O.year ? ' for ' + O.year : ''} yet.</div>`;
  const groups = {};
  rows.forEach(r => { (groups[r.commodity + ' ' + r.cropYear] = groups[r.commodity + ' ' + r.cropYear] || []).push(r); });
  const anyAcres = rows.some(r => r.acres);
  const body = Object.entries(groups).map(([g, rs]) => {
    const tot = rs.reduce((a, r) => ({ loads: a.loads + r.loads, wet: a.wet + r.wetBu, dry: a.dry + r.dryBu, ac: a.ac + (r.acres || 0) }), { loads: 0, wet: 0, dry: 0, ac: 0 });
    return rs.map(r => {
      const k = `${r.field}|${r.commodity}|${r.cropYear}`, open = O.open[k];
      return `<tr data-open="${e(k)}"><td>${open ? '▾' : '▸'} <b>${e(r.field)}</b></td><td>${e(r.commodity)} ${e(r.cropYear)}</td><td class="n">${r.loads}</td><td class="n">${n2(r.wetBu)}</td><td class="n">${n2(r.dryBu)}</td>
        <td class="n">${r.moisture == null ? '—' : r.moisture.toFixed(1)}${r.noMoisture ? ' *' : ''}</td><td class="n">${r.tw == null ? '—' : r.tw.toFixed(1)}</td>
        ${anyAcres ? `<td class="n">${r.acres ? n0(r.acres) : '—'}</td><td class="n">${r.dryBuPerAcre == null ? '—' : r.dryBuPerAcre.toFixed(1)}</td>` : ''}</tr>` +
        (open ? `<tr class="sub"><td colspan="${anyAcres ? 9 : 7}"><div class="subwrap">
          <div class="chips">${r.owners.map(o => `<span class="chip"><b>${e(o.owner)}</b> ${o.pct}% · ${n2(o.dryBu)} dry bu (${n2(o.wetBu)} wet)</span>`).join('')}</div>
          <div class="tblwrap"><table><thead><tr><th>Ticket</th><th>Date</th><th>Load</th><th>Truck</th><th class="n">Net lb</th><th class="n">Wet bu</th><th class="n">Moist</th><th class="n">TW</th><th class="n">Dry bu</th><th>Split</th></tr></thead><tbody>
          ${r.tickets.map(t => `<tr><td>${String(t.no).padStart(6, '0')}</td><td>${day(t.at)}</td><td>${e(t.loadNo)}</td><td>${e(t.truck)}</td><td class="n">${n0(t.netLb)}</td><td class="n">${n2(t.wetBu)}</td><td class="n">${t.moisture == null ? '—' : t.moisture}</td><td class="n">${t.tw == null ? '—' : t.tw}</td><td class="n">${n2(t.dryBu)}</td><td>${e(t.split)}</td></tr>`).join('')}
          </tbody></table></div></div></td></tr>` : '');
    }).join('') + `<tr class="total"><td>Total ${e(g)}</td><td></td><td class="n">${tot.loads}</td><td class="n">${n2(tot.wet)}</td><td class="n">${n2(tot.dry)}</td><td></td><td></td>${anyAcres ? `<td class="n">${tot.ac ? n0(tot.ac) : ''}</td><td></td>` : ''}</tr>`;
  }).join('');
  const std = D().commodities.map(c => `${c.Commodity} ${c.StdMoisturePct}%`).join(', ');
  return `<div class="ohead"><h2>Field report</h2></div>
    <div class="tblwrap"><table><thead><tr><th>Field</th><th>Crop</th><th class="n">Loads</th><th class="n">Wet bu</th><th class="n">Dry bu</th><th class="n">Moist %</th><th class="n">TW</th>${anyAcres ? '<th class="n">Acres</th><th class="n">Dry bu/ac</th>' : ''}</tr></thead><tbody>${body}</tbody></table></div>
    <p class="hint">Tap a field for each owner's share and the tickets. Dry bushels are shrunk to standard moisture (${e(std)})${D().settings.ShrinkPerPoint ? ` at ${e(D().settings.ShrinkPerPoint)}% per point` : ''}. Moisture and test weight are weighted by bushels.${rows.some(r => r.noMoisture) ? ' * some loads have no moisture reading and are counted as dry.' : ''}${anyAcres ? '' : ' Add an Acres column to the Fields tab to see bushels per acre.'}</p>`;
}

// ---------- inventory ----------
function inventory() {
  const rows = R.inventory(D(), opt());
  if (!rows.length) return `<div class="ohead"><h2>Inventory</h2><div class="rowbtns"><button class="ghost" type="button" data-adj="Opening">Opening balance</button></div></div><div class="empty">Nothing on the books${O.year ? ' for ' + O.year : ''} yet.</div>`;
  const line = (l, v, cls = '') => (v = v || 0, `<span class="${cls}">${l}</span><span class="n ${cls}${v < 0 ? ' neg' : ''}">${n2(v)}</span>`);
  return `<div class="ohead"><h2>Inventory and sales position</h2><div class="rowbtns"><button class="ghost" type="button" data-adj="Opening">Opening balance</button></div></div>
  <div class="inv">${rows.map(r => `<div class="invcard">
    <h3>${e(r.commodity)} ${e(r.cropYear)}</h3>
    <div class="ledger">
      ${r.opening ? line('Opening balance', r.opening) : ''}
      ${line(`In from fields (dry) · ${r.loadsIn} load${r.loadsIn === 1 ? '' : 's'}`, r.inDry)}
      ${line(`Out to buyers · ${r.loadsOut} load${r.loadsOut === 1 ? '' : 's'}`, -r.out)}
      ${r.adjust ? line('Adjustments', r.adjust) : ''}
      ${line('On hand', r.onHand, 'tot big3')}
      ${line('Open contracts to ship', -r.openContracts)}
      ${line('Unsold', r.unsold, 'tot')}
    </div>
    ${r.contracts.length ? `<div class="hint">${r.contracts.map(c => `${e(c.contractNo)} ${e(c.buyer)}: ${n0(c.left)} left`).join(' · ')}</div>` : ''}
    <div class="rowbtns"><button class="ghost" type="button" data-adj="Measured" data-c="${e(r.commodity)}" data-y="${e(r.cropYear)}">Bins measured</button><button class="ghost" type="button" data-adj="BinsEmpty" data-c="${e(r.commodity)}" data-y="${e(r.cropYear)}">Bins empty — zero out</button></div>
  </div>`).join('')}</div>
  <p class="hint">On hand = opening + dry bushels in − bushels out ± adjustments. Unsold = on hand − what's left to ship on open contracts.</p>`;
}

// ---------- write-offs ----------
function writeoffs() {
  const rows = R.writeOffs(D(), { ...opt(), cropYear: '' }).filter(r => !O.year || String(r.cropYear) === String(O.year));
  if (!rows.length) return `<div class="ohead"><h2>Write-offs</h2></div><div class="empty">No bins-empty close-outs yet. When the bins are empty, use Inventory → Bins empty to zero the book; the shrink shows up here.</div>`;
  return `<div class="ohead"><h2>Write-offs (shrink)</h2></div>
    <div class="tblwrap"><table><thead><tr><th>Crop</th><th class="n">Opening</th><th class="n">In (dry)</th><th class="n">Out</th><th class="n">Measured adj.</th><th class="n">Written off</th><th class="n">Shrink %</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><b>${e(r.commodity)} ${e(r.cropYear)}</b></td><td class="n">${n2(r.opening)}</td><td class="n">${n2(r.inDry)}</td><td class="n">${n2(r.out)}</td><td class="n">${r.measured ? signed(r.measured) : '—'}</td><td class="n${r.writeOff < 0 ? ' neg' : ''}">${signed(r.writeOff)}</td><td class="n">${r.shrinkPct == null ? '—' : r.shrinkPct.toFixed(2) + '%'}</td></tr>
      <tr class="sub"><td colspan="7" class="hint">${r.entries.map(a => `${day(a.Date)} ${a.Type === 'BinsEmpty' ? 'Bins empty' : e(a.Type)} ${signed(Number(a.Bushels))} bu by ${e(a.By)}${a.Note ? ' — ' + e(a.Note) : ''}`).join('<br>')}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="hint">Shrink % = bushels lost (written off plus measured adjustments) ÷ (opening + dry bushels in). A minus write-off is grain lost; a plus means more went out than the book showed.</p>`;
}

// ---------- adjustments ----------
const TYPE_NAME = { Opening: 'Opening balance', Measured: 'Bins measured', BinsEmpty: 'Bins empty', Other: 'Other' };
function adjustments() {
  const as = D().adjustments.slice().sort((a, b) => Number(b.AdjNo) - Number(a.AdjNo));
  return `<div class="ohead"><h2>Inventory adjustments</h2><div class="rowbtns">
      <button class="ghost" type="button" data-adj="Opening">Opening balance</button><button class="ghost" type="button" data-adj="Measured">Bins measured</button>
      <button class="ghost" type="button" data-adj="BinsEmpty">Bins empty</button><button class="ghost" type="button" data-adj="Other">Other</button></div></div>
    ${as.length ? `<div class="tblwrap"><table><thead><tr><th>#</th><th>Date</th><th>Crop</th><th>Type</th><th class="n">Change bu</th><th class="n">Book before</th><th class="n">After</th><th>By</th><th>Note</th><th></th></tr></thead><tbody>
    ${as.map(a => `<tr><td>${e(a.AdjNo)}</td><td>${day(a.Date)}</td><td>${e(a.Commodity)} ${e(a.CropYear)}</td><td>${TYPE_NAME[a.Type] || e(a.Type)}</td><td class="n${Number(a.Bushels) < 0 ? ' neg' : ''}">${signed(Number(a.Bushels))}</td><td class="n">${a.BookBefore === '' ? '—' : n2(a.BookBefore)}</td><td class="n">${a.BookAfter === '' ? '—' : n2(a.BookAfter)}</td><td>${e(a.By)}</td><td>${e(a.Note)}</td><td><button class="ghost bad" type="button" data-void="${e(a.AdjNo)}">Undo</button></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">No adjustments yet. Start with an opening balance for anything in the bins at cutover.</div>'}
    <p class="hint">Undo keeps the line in the Sheet marked Void, so there's always a record.</p>`;
}
function bookBalance(c, y) {
  const r = R.inventory(D(), { includeTest: testMode() }).find(x => x.commodity === c && String(x.cropYear) === String(y));
  return r ? r.onHand : 0;
}
function openAdj(type, c, y) {
  O.adjType = type;
  const sel = (id, items, v) => { $(id).innerHTML = items.map(i => `<option${String(i) === String(v) ? ' selected' : ''}>${e(i)}</option>`).join(''); };
  sel('aComm', commodities(), c || 'Corn');
  const ys = [...new Set([String(new Date().getFullYear()), ...years()])].sort().reverse();
  sel('aYear', ys, y || O.year || ys[0]);
  $('aTitle').textContent = TYPE_NAME[type];
  $('aIntro').textContent = {
    Opening: 'Bushels already in the bins when the system started, or carried in from another place. Adds to the book.',
    Measured: 'Enter what you measured in the bins. The book is changed to match, and the difference is recorded.',
    BinsEmpty: 'The bins are empty. Whatever the book still shows is written off to zero and shows on the Write-offs report as shrink.',
    Other: 'Any other correction. Use a minus for bushels to take off the book.'
  }[type];
  $('aBuLbl').textContent = { Opening: 'Bushels in the bins', Measured: 'Measured bushels in the bins', Other: 'Change in bushels (+ or −)' }[type] || '';
  $('aBuBox').hidden = type === 'BinsEmpty';
  $('aBu').value = ''; $('aDate').value = today(); $('aNote').value = '';
  $('aBy').value = $('aBy').value || (A.S.config && A.S.config.operator) || '';
  $('aMsg').textContent = '';
  adjPreview();
  $('adjDlg').showModal();
}
function adjChange() {
  const book = bookBalance($('aComm').value, $('aYear').value), v = Number(String($('aBu').value).replace(/,/g, ''));
  switch (O.adjType) {
    case 'BinsEmpty': return { book, change: Math.round(-book * 100) / 100 };
    case 'Measured': return { book, change: $('aBu').value === '' || isNaN(v) ? null : Math.round((v - book) * 100) / 100 };
    default: return { book, change: $('aBu').value === '' || isNaN(v) ? null : v };
  }
}
function adjPreview() {
  const { book, change } = adjChange();
  $('aBook').textContent = n2(book);
  $('aResult').innerHTML = change == null ? '' : O.adjType === 'BinsEmpty'
    ? (Math.abs(change) < 0.005 ? 'The book is already at zero. Saving records the close-out.' : `Write off <b class="${change < 0 ? 'neg' : ''}">${signed(change)} bu</b> → book goes to 0`)
    : `Change <b class="${change < 0 ? 'neg' : ''}">${signed(change)} bu</b> → book becomes ${n2(book + change)} bu`;
}
async function saveAdj() {
  const { book, change } = adjChange();
  if (change == null) return msg('aMsg', 'Enter the bushels.');
  if (!$('aBy').value.trim()) return msg('aMsg', 'Enter who is making the adjustment.');
  $('aSave').disabled = true; msg('aMsg', 'Saving…');
  try {
    await A.api({ action: 'saveAdjustment', adjustment: { Type: O.adjType, Commodity: $('aComm').value, CropYear: $('aYear').value, Bushels: change, BookBefore: book, Date: $('aDate').value, By: $('aBy').value.trim(), Note: $('aNote').value.trim() } });
    $('adjDlg').close(); A.toast(`${TYPE_NAME[O.adjType]} saved for ${$('aComm').value} ${$('aYear').value}`);
    await load(true);
  } catch (err) { msg('aMsg', err.message); }
  finally { $('aSave').disabled = false; }
}
let voidArm = { no: null, at: 0 };
async function voidAdj(btn) {
  const no = btn.dataset.void;
  if (voidArm.no !== no || Date.now() - voidArm.at > 4000) { voidArm = { no, at: Date.now() }; btn.textContent = 'Tap again to undo'; btn.classList.add('armed'); return; }
  voidArm = { no: null, at: 0 };
  try { await A.api({ action: 'voidAdjustment', adjNo: Number(no), by: (A.S.config && A.S.config.operator) || '' }); A.toast(`Adjustment ${no} undone`); await load(true); }
  catch (err) { A.toast(err.message, 6000); }
}

// ---------------- print ----------------
function printReport() {
  let a = $('printArea');
  if (!a) { a = document.createElement('div'); a.id = 'printArea'; document.body.appendChild(a); }
  const names = { contracts: 'Contracts', customers: 'Customers', fieldsetup: 'Fields and splits', fields: 'Field report', inventory: 'Inventory and sales position', writeoffs: 'Write-offs', adjustments: 'Inventory adjustments' };
  const body = $('oBody').cloneNode(true);
  body.querySelectorAll('button').forEach(b => b.remove());
  body.querySelectorAll('.ohead h2').forEach(h => h.remove());
  a.className = 'report';
  a.innerHTML = `<h1>Blue Barn Land &amp; Cattle — ${names[O.tab]}${O.year && O.tab !== 'adjustments' ? ' — ' + O.year : ''}</h1><p>Printed ${new Date().toLocaleString()}</p>` + body.innerHTML;
  setTimeout(() => window.print(), 100);
}

// ---------------- wiring ----------------
function wire() {
  const b = $('oBody');
  b.querySelectorAll('[data-contract]').forEach(tr => tr.onclick = () => openContract(tr.dataset.contract));
  if ($('cNew')) $('cNew').onclick = () => openContract(null);
  b.querySelectorAll('[data-customer]').forEach(tr => tr.onclick = () => openCustomer(tr.dataset.customer));
  if ($('kNew')) $('kNew').onclick = () => openCustomer(null);
  b.querySelectorAll('[data-field]').forEach(tr => tr.onclick = () => openField(tr.dataset.field));
  if ($('fNew')) $('fNew').onclick = () => openField(null);
  b.querySelectorAll('[data-open]').forEach(tr => tr.onclick = () => { O.open[tr.dataset.open] = !O.open[tr.dataset.open]; render(); });
  b.querySelectorAll('[data-adj]').forEach(x => x.onclick = () => openAdj(x.dataset.adj, x.dataset.c, x.dataset.y));
  b.querySelectorAll('[data-void]').forEach(x => x.onclick = () => voidAdj(x));
}
function init() {
  A = window.BBG_APP;
  $('navScale').onclick = () => show('scale');
  $('navOffice').onclick = () => show('office');
  document.querySelectorAll('#officeView .tabs button').forEach(b => b.onclick = () => { O.tab = b.dataset.tab; render(); });
  $('oYear').onchange = () => { O.year = $('oYear').value; render(); };
  $('oRefresh').onclick = () => load(true);
  $('oPrint').onclick = printReport;
  $('cSave').onclick = saveContract; $('cCancel').onclick = () => $('contractDlg').close();
  $('aSave').onclick = saveAdj; $('aCancel').onclick = () => $('adjDlg').close();
  $('kSave').onclick = saveCustomer; $('kCancel').onclick = () => $('custDlg').close();
  $('fSave').onclick = saveField; $('fCancel').onclick = () => $('fieldDlg').close();
  $('fYear').onchange = loadShares; $('fCopy').onclick = copyLastYear;
  $('fAddOwner').onclick = () => { O.shareRows.push({ Owner: '', SharePct: O.shareRows.length ? Math.max(0, 100 - O.shareRows.reduce((a, r) => a + (Number(r.SharePct) || 0), 0)) : 100 }); drawShares(); };
  for (const id of ['aComm', 'aYear', 'aBu']) { $(id).addEventListener('input', adjPreview); $(id).addEventListener('change', adjPreview); }
  let v = 'scale'; try { v = localStorage.getItem('bbg-view') || 'scale'; } catch (_) {}
  show(v);
}
if (window.BBG_APP) init(); else window.addEventListener('bbg-ready', init, { once: true });
})();
