/* Blue Barn Grain — office side: contracts, reports and inventory adjustments.
   Reads everything from the backend's officeData (cached on this device so it opens offline),
   does the math in reports.js, and writes contracts and adjustments back to the Sheet. */
(() => {
'use strict';
const R = window.BBR;
const $ = id => document.getElementById(id);
let A;                                  // the scale app's helpers (window.BBG_APP)
const O = { fieldPick: '', tq: '', tdir: '', tvoid: false, ticket: null, comm: null, pricingNo: null, data: null, tab: 'contracts', year: '', open: {}, busy: false, adjType: '', contract: null, customer: null, field: null, shareRows: [] };

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
const D = () => O.data || { editLog: [], tickets: [], splits: [], allocations: [], adjustments: [], purchases: [], pricing: [], contracts: [], customers: [], fields: [], shares: [], commodities: [], settings: {} };
function years() {
  const ys = new Set();
  D().tickets.forEach(t => t.CropYear && ys.add(String(t.CropYear)));
  D().contracts.forEach(c => c.CropYear && ys.add(String(c.CropYear)));
  D().adjustments.forEach(a => a.CropYear && ys.add(String(a.CropYear)));
  (D().purchases || []).forEach(a => a.CropYear && ys.add(String(a.CropYear)));
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
  $('oYear').hidden = ['adjustments', 'customers', 'discounts'].includes(O.tab);
  const fnames = [...new Set(D().tickets.filter(t => t.Direction === 'IN' && t.Field).map(t => t.Field).concat(D().fields.map(f => f.Field)))].sort((a, b) => a.localeCompare(b));
  $('oField').innerHTML = [['', 'All fields'], ...fnames.map(f => [f, f])].map(([v, l]) => `<option value="${e(v)}"${v === O.fieldPick ? ' selected' : ''}>${e(l)}</option>`).join('');
  $('oField').hidden = O.tab !== 'fields';
  status();
  $('oBody').innerHTML = ({ contracts, tickets, customers, fieldsetup, fields, inventory, landlord, discounts, writeoffs, adjustments })[O.tab]();
  wire();
}

// ---------- contracts ----------
function contracts() {
  const applied = R.appliedByContract(D(), opt());
  const pr = R.contractPricing(D(), opt());
  const apps = R.contractApplications(D(), opt());
  const half = (Number(D().settings.TypicalLoadBu) || 1000) / 2;
  const cs = D().contracts.filter(c => !O.year || String(c.CropYear) === String(O.year))
    .sort((a, b) => (a.Status === 'Closed') - (b.Status === 'Closed') || String(a.Buyer).localeCompare(String(b.Buyer)) || new Date(a.ShipStart || 0) - new Date(b.ShipStart || 0));
  const rows = cs.map(c => {
    const no = String(c.ContractNo), shipped = applied[no] || 0, left = Number(c.Bushels || 0) - shipped;
    const state = c.Status === 'Closed' ? 'Closed' : left < half ? 'Filled' : shipped ? 'Shipping' : 'Open';
    const open = O.open['c:' + no], tix = apps[no] || [];
    return `<tr data-copen="${e(no)}" class="${state === 'Closed' || state === 'Filled' ? 'closed' : ''}">
      <td>${open ? '▾' : '▸'} <b>${e(no)}</b></td><td>${e(c.Buyer)}</td><td>${e(c.Commodity)} ${e(c.CropYear)}</td>
      <td class="n">${n0(c.Bushels)}</td><td class="n">${n2(shipped)}</td><td class="n${left < 0 ? ' neg' : ''}">${n2(left)}</td>
      <td>${pricedCell(pr[no])}</td>
      <td>${day(c.ShipStart)}${c.ShipEnd ? ' – ' + day(c.ShipEnd) : ''}</td><td>${state}</td></tr>` +
      (open ? `<tr class="sub"><td colspan="9"><div class="subwrap">
        <div class="ohead"><span class="hint">${tix.length} load${tix.length === 1 ? '' : 's'} applied · ${n2(shipped)} of ${n0(c.Bushels)} bu · ${n2(left)} left</span>
          <div class="rowbtns"><button class="ghost" type="button" data-cprint="${e(no)}">Print report</button><button class="ghost" type="button" data-contract="${e(no)}">Edit contract / pricing</button></div></div>
        ${tix.length ? applicationTable(tix) : '<div class="hint">No loads applied yet.</div>'}
      </div></td></tr>` : '');
  }).join('');
  return `<div class="ohead"><h2>Contracts</h2><button class="big small" type="button" id="cNew">New contract</button></div>
    ${cs.length ? `<div class="tblwrap"><table><thead><tr><th>Contract</th><th>Buyer</th><th>Crop</th><th class="n">Bushels</th><th class="n">Shipped</th><th class="n">Left</th><th>Priced</th><th>Ship window</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint">Tap a contract to see every ticket applied to it (application report), print it, or edit the contract and its pricing. Filled and closed contracts don't show at the scale.</p>` : '<div class="empty">No contracts yet. Tap New contract to add one.</div>'}`;
}
const dtm = v => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`; };
function applicationTable(tix) {
  const tot = tix.reduce((a, t) => ({ gross: a.gross + t.gross, tare: a.tare + t.tare, net: a.net + t.net, bu: a.bu + t.bu }), { gross: 0, tare: 0, net: 0, bu: 0 });
  return `<div class="tblwrap"><table><thead><tr><th>Ticket</th><th>Date / time</th><th>Truck</th><th>BOL</th><th class="n">Gross lb</th><th class="n">Tare lb</th><th class="n">Net lb</th><th class="n">Bushels</th><th class="n">Running bu</th></tr></thead><tbody>
    ${tix.map(t => `<tr><td>${String(t.no).padStart(6, '0')}${t.test ? ' <span class="tag">test</span>' : ''}${t.rolledFrom ? ` <span class="hint">(from ${e(t.rolledFrom)})</span>` : ''}</td><td>${dtm(t.at)}</td><td>${e(t.truck)}</td><td>${e(t.bol)}</td>
      <td class="n">${n0(t.gross)}</td><td class="n">${n0(t.tare)}</td><td class="n">${n0(t.net)}</td><td class="n">${n2(t.bu)}</td><td class="n">${n2(t.running)}</td></tr>`).join('')}
    <tr class="total"><td>Total · ${tix.length} load${tix.length === 1 ? '' : 's'}</td><td></td><td></td><td></td><td class="n">${n0(tot.gross)}</td><td class="n">${n0(tot.tare)}</td><td class="n">${n0(tot.net)}</td><td class="n">${n2(tot.bu)}</td><td></td></tr>
  </tbody></table></div>`;
}
function printContract(no) {
  const c = D().contracts.find(x => String(x.ContractNo) === String(no)); if (!c) return;
  const tix = R.contractApplications(D(), opt())[String(no)] || [];
  const p = R.contractPricing(D(), opt())[String(no)];
  const shipped = tix.reduce((a, t) => a + t.bu, 0);
  let a = $('printArea');
  if (!a) { a = document.createElement('div'); a.id = 'printArea'; document.body.appendChild(a); }
  a.className = 'report';
  a.innerHTML = letterhead('Contract application report', 'Printed ' + new Date().toLocaleString()) + `
    <p><b>Contract ${e(c.ContractNo)}</b> · ${e(c.Buyer)} · ${e(c.Commodity)} ${e(c.CropYear)} · ${n0(c.Bushels)} bu${c.ShipStart ? ' · ship ' + day(c.ShipStart) + (c.ShipEnd ? ' – ' + day(c.ShipEnd) : '') : ''}<br>
    Shipped ${n2(shipped)} bu on ${tix.length} load${tix.length === 1 ? '' : 's'} · ${n2(Number(c.Bushels) - shipped)} bu left
    ${p && (p.priced || p.partial) ? `<br>Priced ${n0(p.priced)} bu${p.avgFlat != null ? ' @ ' + money(p.avgFlat) + ' avg' : ''}${p.partial ? ' · partly priced ' + n0(p.partial) + ' bu' : ''}${p.unpriced ? ' · unpriced ' + n0(p.unpriced) + ' bu' : ''}` : '<br>Not priced'}<br>
    Weights from the Blue Barn scale.</p>` + (tix.length ? applicationTable(tix) : '<p>No loads applied yet.</p>');
  printWhenReady(a);
}
const money = v => v == null || v === '' ? '—' : (Number(v) < 0 ? '−$' : '$') + Math.abs(Number(v)).toFixed(4).replace(/(\.\d\d)00$/, '$1').replace(/(\.\d\d\d)0$/, '$1');
function pricedCell(p) {
  if (!p) return '';
  const parts = [];
  if (p.priced) parts.push(`${n0(p.priced)} @ ${money(p.avgFlat)}`);
  if (p.partial) parts.push(`${n0(p.partial)} part`);
  if (!p.priced && !p.partial) parts.push('<span class="hint">none</span>');
  return parts.join(' · ') + (p.shippedUnpriced ? ` <span class="tag">${n0(p.shippedUnpriced)} shipped unpriced</span>` : '');
}
function drawPricing() {
  const c = O.contract && D().contracts.find(x => String(x.ContractNo) === O.contract);
  $('cPricingBox').hidden = !c;
  if (!c) return;
  const p = R.contractPricing(D(), opt())[O.contract];
  $('cPricing').innerHTML = (p.lines.length ? `<div class="tblwrap"><table><thead><tr><th>Date</th><th class="n">Bushels</th><th>Month</th><th class="n">Futures</th><th class="n">Basis</th><th class="n">Fees</th><th class="n">Flat</th></tr></thead><tbody>
    ${p.lines.map(l => `<tr data-pricing="${e(l.PricingNo)}"><td>${day(l.Date)}</td><td class="n">${n0(l.Bushels)}</td><td>${e(l.FuturesMonth)}</td><td class="n">${money(l.Futures)}</td><td class="n">${money(l.Basis)}</td><td class="n">${money(l.Fees)}</td><td class="n"><b>${l.FlatPrice === '' || l.FlatPrice == null ? '<span class="tag">open</span>' : money(l.FlatPrice)}</b></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="hint">Not priced yet.</div>') +
    `<div class="hint">Priced ${n0(p.priced)}${p.avgFlat != null ? ' @ ' + money(p.avgFlat) + ' avg' : ''} · partly priced ${n0(p.partial)} · unpriced ${n0(p.unpriced)} bu${p.shippedUnpriced ? ` · <b class="neg">${n0(p.shippedUnpriced)} bu shipped with no price</b>` : ''}. Tap a line to change it.</div>`;
  $('cPricing').querySelectorAll('[data-pricing]').forEach(tr => tr.onclick = () => openPricing(tr.dataset.pricing));
  $('pAdd').disabled = p.priced + p.partial >= p.bushels - 0.005;
}
function openPricing(no) {
  const l = no ? D().pricing.find(x => String(x.PricingNo) === String(no)) : null;
  const p = R.contractPricing(D(), opt())[O.contract];
  O.pricingNo = l ? Number(l.PricingNo) : null;
  $('pTitle').textContent = (l ? 'Pricing line' : 'Add pricing') + ` — ${O.contract}`;
  const v = x => x === '' || x == null ? '' : String(x);
  $('pDate').value = l ? isoDay(l.Date) : today(); $('pBu').value = l ? l.Bushels : (p.unpriced || '');
  $('pMonth').value = l ? v(l.FuturesMonth) : ''; $('pFut').value = l ? v(l.Futures) : ''; $('pBasis').value = l ? v(l.Basis) : '';
  $('pFees').value = l ? v(l.Fees) : ''; $('pFlat').value = l && !v(l.Futures) && !v(l.Basis) ? v(l.FlatPrice) : '';
  $('pNote').value = l ? v(l.Note) : ''; $('pBy').value = $('pBy').value || (A.S.config && A.S.config.operator) || '';
  $('pVoid').hidden = !l; $('pVoid').textContent = 'Delete line'; $('pMsg').textContent = '';
  pricePreview(); $('priceDlg').showModal();
}
const numIn = id => { const t = String($(id).value).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1'); return t === '' ? '' : Number(t); };
function pricePreview() {
  const f = numIn('pFut'), b = numIn('pBasis'), fee = numIn('pFees') || 0, flat = numIn('pFlat');
  $('pFlatBox').hidden = f !== '' || b !== '';
  let t = '';
  if (f !== '' && b !== '' && !isNaN(f) && !isNaN(b)) t = `Flat price <b>${money(f + b - fee)}</b> = ${money(f)} ${b < 0 ? '−' : '+'} ${money(Math.abs(b))}${fee ? ' − ' + money(fee) : ''}`;
  else if (f !== '' && !isNaN(f)) t = 'Futures set; basis still open (HTA).';
  else if (b !== '' && !isNaN(b)) t = 'Basis set; futures still open.';
  else if (flat !== '' && !isNaN(flat)) t = `Flat price <b>${money(flat)}</b>`;
  const bu = numIn('pBu');
  if (t && bu > 0 && f !== '' && b !== '') t += ` · ${n0(bu)} bu ≈ $${n2(bu * (f + b - fee))}`;
  else if (t && bu > 0 && flat !== '' && f === '' && b === '') t += ` · ${n0(bu)} bu ≈ $${n2(bu * flat)}`;
  $('pResult').innerHTML = t;
}
async function savePricing() {
  const f = numIn('pFut'), b = numIn('pBasis'), fee = numIn('pFees'), flat = numIn('pFlat'), bu = numIn('pBu');
  if (!(bu > 0)) return msg('pMsg', 'Enter the bushels priced.');
  if ([f, b, fee, flat].some(x => x !== '' && isNaN(x))) return msg('pMsg', 'Prices must be numbers, like 4.4525 or -0.38.');
  if (f === '' && b === '' && flat === '') return msg('pMsg', 'Enter futures, basis, or a flat price.');
  if (!$('pBy').value.trim()) return msg('pMsg', 'Enter who is recording it.');
  $('pSave').disabled = true; msg('pMsg', 'Saving…');
  try {
    await A.api({ action: 'savePricing', pricing: { PricingNo: O.pricingNo || '', ContractNo: O.contract, Date: $('pDate').value, Bushels: bu, FuturesMonth: $('pMonth').value, Futures: f, Basis: b, Fees: fee, FlatPrice: f === '' && b === '' ? flat : '', Note: $('pNote').value.trim(), By: $('pBy').value.trim() } });
    $('priceDlg').close(); A.toast(`Pricing saved on ${O.contract}`);
    await load(true); drawPricing();
  } catch (err) { msg('pMsg', err.message); }
  finally { $('pSave').disabled = false; }
}
async function voidPricing() {
  if ($('pVoid').textContent !== 'Tap again to delete') { $('pVoid').textContent = 'Tap again to delete'; return; }
  try { await A.api({ action: 'voidPricing', pricingNo: O.pricingNo, by: (A.S.config && A.S.config.operator) || '' }); $('priceDlg').close(); A.toast('Pricing line deleted'); await load(true); drawPricing(); }
  catch (err) { msg('pMsg', err.message); }
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
  drawPricing();
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

// ---------- tickets: paper tickets and fixing mistakes ----------
const localDT = v => { if (!v) return ''; const d = new Date(v); if (isNaN(d)) return ''; const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const isoOf = v => v ? new Date(v).toISOString() : '';
function tickets() {
  const q = O.tq.trim().toLowerCase();
  const all = D().tickets.filter(t => (!O.year || String(t.CropYear) === String(O.year)) && (!O.tdir || t.Direction === O.tdir) && (O.tvoid || t.Status !== 'Void') && (testMode() || !(t.TestTicket === true || String(t.TestTicket).toUpperCase() === 'TRUE')))
    .filter(t => !q || [t.TicketNo, t.Truck, t.Field, t.Buyer, t.ContractNo, t.BOLNo, t.Driver].some(v => String(v || '').toLowerCase().includes(q)))
    .sort((a, b) => new Date(b.DateTime) - new Date(a.DateTime) || Number(b.TicketNo) - Number(a.TicketNo));
  const rows = all.slice(0, 300);
  const edited = {}; (D().editLog || []).forEach(x => { if (x.Reason !== 'Typed in from paper ticket') edited[String(x.TicketNo)] = true; });
  return `<div class="ohead"><h2>Tickets</h2><button class="big small" type="button" id="tNew">Add paper ticket</button></div>
    <div class="ofilters"><input id="tq" placeholder="Search ticket #, truck, field, buyer, BOL…" value="${e(O.tq)}" style="max-width:340px">
      <select id="tdirSel"><option value="">In and out</option><option value="IN"${O.tdir === 'IN' ? ' selected' : ''}>Inbound</option><option value="OUT"${O.tdir === 'OUT' ? ' selected' : ''}>Outbound</option></select>
      <label class="chk"><input type="checkbox" id="tvoid"${O.tvoid ? ' checked' : ''}> Show voided</label></div>
    ${rows.length ? `<div class="tblwrap"><table><thead><tr><th>Ticket</th><th>Date / time</th><th>In/out</th><th>Field / buyer · contract</th><th>Truck</th><th>BOL</th><th class="n">Net lb</th><th class="n">Bushels</th><th class="n">Moist</th><th></th></tr></thead><tbody>
    ${rows.map(t => `<tr data-ticket="${e(t.TicketNo)}" class="${t.Status === 'Void' ? 'closed' : ''}"><td><b>${String(t.TicketNo).padStart(6, '0')}</b></td><td>${dtm(t.DateTime)}</td><td>${t.Direction === 'IN' ? 'In' : 'Out'}</td>
      <td>${t.Direction === 'IN' ? e(t.Field) : `${e(t.Buyer)} · ${e(t.ContractNo || 'TBD')}`}</td><td>${e(t.Truck)}</td><td>${e(t.BOLNo)}</td><td class="n">${n0(t.NetLb)}</td><td class="n">${t.Status === 'Void' ? 'Void' : n2(t.WetBu)}</td><td class="n">${t.MoisturePct === '' || t.MoisturePct == null ? '' : t.MoisturePct}</td>
      <td>${[t.ManualWeight === true || String(t.ManualWeight).toUpperCase() === 'TRUE' ? '<span class="tag">paper</span>' : '', edited[String(t.TicketNo)] ? '<span class="chip">edited</span>' : '', t.TestTicket === true || String(t.TestTicket).toUpperCase() === 'TRUE' ? '<span class="tag">test</span>' : ''].join(' ')}</td></tr>`).join('')}
    </tbody></table></div>${all.length > rows.length ? `<p class="hint">Showing the newest 300 of ${all.length}. Search to narrow it down.</p>` : ''}` : '<div class="empty">No tickets match.</div>'}
    <p class="hint">Tap a ticket to fix it (wrong field, customer, contract, weights, grades) or void it. Every change is kept in the EditLog tab with who, when and why. Use <b>Add paper ticket</b> for punch tickets written while the power or internet was out.</p>`;
}
function sel(id, items, v, blank) {
  const list = items.map(x => Array.isArray(x) ? x : [x, x]);
  if (v != null && v !== '' && !list.some(([k]) => String(k) === String(v))) list.push([v, v]);
  $(id).innerHTML = (blank ? `<option value="">${e(blank)}</option>` : '') + list.map(([k, l]) => `<option value="${e(k)}"${String(k) === String(v) ? ' selected' : ''}>${e(l)}</option>`).join('');
}
function ticketContracts(buyer, cur) {
  const cs = D().contracts.filter(c => c.Buyer === buyer && (c.Status !== 'Closed' || String(c.ContractNo) === String(cur))).map(c => [String(c.ContractNo), `${c.ContractNo} · ${c.Commodity} ${c.CropYear}`]);
  sel('tContract', [...cs, ['TBD', 'To be assigned']], cur || (cs[0] ? cs[0][0] : 'TBD'));
}
function openTicket(no) {
  const t = no ? D().tickets.find(x => String(x.TicketNo) === String(no)) : null;
  O.ticket = t;
  const dir = t ? t.Direction : 'IN';
  $('tTitle').textContent = t ? `Ticket ${String(t.TicketNo).padStart(6, '0')}` + (t.Status === 'Void' ? ' (VOID)' : '') : 'Add paper ticket';
  $('tIntro').textContent = t ? 'Change what was wrong and say why. Net, bushels, the owner split and the contract it applies to are redone automatically.' : 'Type in a punch ticket written while the power or internet was out. Use the number printed on the paper ticket.';
  $('tNoLbl').textContent = t ? 'Ticket #' : 'Paper ticket #';
  $('tNo').value = t ? t.TicketNo : ''; $('tNo').readOnly = !!t; $('tDir').value = dir; $('tDir').disabled = !!t;
  $('tIn').value = t ? localDT(t.TimeIn || t.DateTime) : ''; $('tOut').value = t ? localDT(t.DateTime) : '';
  $('tIn').disabled = !!t;
  sel('tComm', commodities(), t ? t.Commodity : 'Corn');
  const y = new Date().getFullYear(); sel('tYear', [y + 1, y, y - 1, y - 2], t ? t.CropYear : y);
  sel('tField', D().fields.filter(f => f.Active !== false || (t && f.Field === t.Field)).map(f => f.Field).sort((a, b) => a.localeCompare(b)), t ? t.Field : '', 'Pick a field…');
  const buyers = D().customers.filter(c => c.Type === 'Buyer').map(c => c.Customer);
  sel('tBuyer', buyers, t ? t.Buyer : buyers[0]); ticketContracts($('tBuyer').value, t ? t.ContractNo : '');
  const v = x => x == null ? '' : String(x);
  $('tLoad').value = t ? v(t.LoadNo) : ''; $('tBol').value = t ? v(t.BOLNo) : ''; $('tTruck').value = t ? v(t.Truck) : ''; $('tDriver').value = t ? v(t.Driver) : '';
  $('tGross').value = t ? v(t.GrossLb) : ''; $('tTare').value = t ? v(t.TareLb) : ''; $('tM').value = t ? v(t.MoisturePct) : ''; $('tTw').value = t ? v(t.TestWeight) : '';
  $('tFm').value = t ? v(t.FMPct) : ''; $('tTemp').value = t ? v(t.GrainTempF) : ''; $('tRm').value = t ? v(t.Remarks) : '';
  $('tReason').value = ''; $('tReasonBox').hidden = !t; $('tBy').value = $('tBy').value || (A.S.config && A.S.config.operator) || '';
  $('tVoid').hidden = !t; $('tVoid').textContent = t && t.Status === 'Void' ? 'Restore ticket' : 'Void ticket'; $('tPrint').hidden = !t || t.Status === 'Void';
  const hist = t ? (D().editLog || []).filter(x => String(x.TicketNo) === String(t.TicketNo)) : [];
  $('tHistory').innerHTML = hist.length ? '<b>Changes</b><br>' + hist.map(x => `${dtm(x.At)} · ${e(x.By)}: ${e(x.Changes)}${x.Reason ? ' — ' + e(x.Reason) : ''}`).join('<br>') : '';
  $('tMsg').textContent = '';
  tDirShow(); tCalc(); $('ticketDlg').showModal();
  if (!t) $('tNo').focus();
}
function tDirShow() { const dir = $('tDir').value; $('ticketDlg').querySelectorAll('[data-tdir]').forEach(el => el.hidden = el.dataset.tdir !== dir); }
function tCalc() {
  const g = Number($('tGross').value), tr = Number($('tTare').value);
  const k = R.schedule(D(), $('tComm').value);
  if (!(g > 0) || !(tr >= 0) || $('tTare').value === '') { $('tCalc').textContent = ''; return; }
  if (g <= tr) { $('tCalc').innerHTML = '<span class="neg">Gross must be more than tare</span>'; return; }
  const bu = (g - tr) / k.lbPerBu;
  $('tCalc').textContent = `Net ${n0(g - tr)} lb = ${n2(bu)} bu at ${k.lbPerBu} lb/bu`;
}
async function saveTicket() {
  const t = O.ticket, dir = $('tDir').value, by = $('tBy').value.trim();
  const num = id => $(id).value.trim() === '' ? '' : Number($(id).value);
  if (!by) return msg('tMsg', 'Enter who is entering this.');
  if (!(num('tGross') > num('tTare'))) return msg('tMsg', 'Gross must be more than tare.');
  if (dir === 'IN' && !$('tField').value) return msg('tMsg', 'Pick the field.');
  $('tSave').disabled = true; msg('tMsg', 'Saving…');
  try {
    if (!t) {
      if (!(num('tNo') > 0)) throw new Error('Enter the paper ticket number.');
      if (!$('tOut').value && !$('tIn').value) throw new Error('Enter when it was weighed.');
      const j = await A.api({ action: 'addManualTicket', by, ticket: { no: num('tNo'), dir, commodity: $('tComm').value, cropYear: Number($('tYear').value),
        field: $('tField').value, loadNo: num('tLoad'), buyer: $('tBuyer').value, contractNo: $('tContract').value, bol: $('tBol').value.trim(),
        truck: $('tTruck').value.trim(), driver: $('tDriver').value.trim(), gross: num('tGross'), tare: num('tTare'),
        moisture: num('tM'), tw: num('tTw'), fm: num('tFm'), temp: num('tTemp'), remarks: $('tRm').value.trim(),
        timeIn: isoOf($('tIn').value || $('tOut').value), timeOut: isoOf($('tOut').value || $('tIn').value), test: testMode() } });
      A.toast(`Paper ticket ${num('tNo')} added · ${n2(j.wetBu)} bu` + (j.warnings && j.warnings.length ? ' · ' + j.warnings.join(' ') : ''), 7000);
    } else {
      if (!$('tReason').value.trim()) throw new Error('Say why it is being changed.');
      const now = { Field: $('tField').value, Buyer: $('tBuyer').value, ContractNo: $('tContract').value, Commodity: $('tComm').value, CropYear: Number($('tYear').value),
        Truck: $('tTruck').value.trim(), Driver: $('tDriver').value.trim(), BOLNo: $('tBol').value.trim(), LoadNo: num('tLoad'), GrossLb: num('tGross'), TareLb: num('tTare'),
        MoisturePct: num('tM'), TestWeight: num('tTw'), FMPct: num('tFm'), GrainTempF: num('tTemp'), Remarks: $('tRm').value.trim() };
      if (dir === 'IN') { delete now.Buyer; delete now.ContractNo; delete now.BOLNo; } else { delete now.Field; delete now.LoadNo; delete now.MoisturePct; delete now.TestWeight; delete now.FMPct; delete now.GrainTempF; }
      const changes = {};
      Object.keys(now).forEach(k => { const a = t[k] == null ? '' : String(t[k]), b = now[k] == null ? '' : String(now[k]); if (a !== b) changes[k] = now[k]; });
      if ($('tOut').value && localDT(t.DateTime) !== $('tOut').value) changes.DateTime = isoOf($('tOut').value);
      if (!Object.keys(changes).length) throw new Error('Nothing was changed.');
      const j = await A.api({ action: 'editTicket', ticketNo: t.TicketNo, changes, by, reason: $('tReason').value.trim() });
      A.toast(`Ticket ${t.TicketNo} fixed: ${j.changes.join('; ')}` + (j.warnings && j.warnings.length ? ' · ' + j.warnings.join(' ') : ''), 8000);
    }
    $('ticketDlg').close(); await load(true); A.refreshLists().catch(() => {});
  } catch (err) { msg('tMsg', err.message); }
  finally { $('tSave').disabled = false; }
}
async function voidTicket() {
  const t = O.ticket; if (!t) return;
  const restore = t.Status === 'Void';
  if (!$('tReason').value.trim()) return msg('tMsg', `Say why it is being ${restore ? 'restored' : 'voided'}.`);
  if (!$('tBy').value.trim()) return msg('tMsg', 'Enter who is doing this.');
  if (!$('tVoid').classList.contains('armed')) { $('tVoid').classList.add('armed'); $('tVoid').textContent = restore ? 'Tap again to restore' : 'Tap again to void'; return; }
  $('tVoid').classList.remove('armed');
  try {
    await A.api({ action: 'editTicket', ticketNo: t.TicketNo, changes: { Status: restore ? 'Closed' : 'Void' }, by: $('tBy').value.trim(), reason: $('tReason').value.trim() });
    $('ticketDlg').close(); A.toast(`Ticket ${t.TicketNo} ${restore ? 'restored' : 'voided'}`); await load(true);
  } catch (err) { msg('tMsg', err.message); }
}
function printOfficeTicket() {
  const t = O.ticket; if (!t || !A.printTicket) return;
  A.printTicket({ no: Number(t.TicketNo), dir: t.Direction, status: t.Status, commodity: t.Commodity, cropYear: t.CropYear, field: t.Field, loadNo: t.LoadNo, buyer: t.Buyer,
    contractNo: t.ContractNo, rolledFrom: t.RolledFrom, truck: t.Truck, driver: t.Driver, bol: t.BOLNo, operator: t.Operator, gross: Number(t.GrossLb), tare: Number(t.TareLb),
    net: Number(t.NetLb), wetBu: Number(t.WetBu), remarks: t.Remarks, test: t.TestTicket === true || String(t.TestTicket).toUpperCase() === 'TRUE',
    first: { at: t.Direction === 'OUT' ? (t.TimeIn || t.DateTime) : (t.TimeIn || t.DateTime) }, second: { at: t.TimeOut || t.DateTime },
    grade: { moisture: t.MoisturePct === '' ? null : t.MoisturePct, tw: t.TestWeight === '' ? null : t.TestWeight, fm: t.FMPct === '' ? null : t.FMPct } });
}

// ---------- discount schedules ----------
function discounts() {
  const cs = D().commodities.length ? D().commodities : A.L().commodities;
  const calcComm = O.calcComm || (cs[0] && cs[0].Commodity) || 'Corn';
  return `<div class="ohead"><h2>Discount schedules</h2><button class="big small" type="button" id="dNew">Add commodity</button></div>
    <div class="inv">${cs.map(c => { const k = R.schedule(D(), c.Commodity); return `<div class="invcard">
      <h3>${e(c.Commodity)}</h3>
      <div class="ledger">
        <span>Lb per bushel</span><span class="n">${k.lbPerBu}</span>
        <span>Standard moisture</span><span class="n">${k.std == null ? '—' : k.std + '%'}</span>
        <span>Moisture shrink</span><span class="n">${k.method === 'PerPoint' ? k.perPoint + '% per point' : 'water shrink'}</span>
        <span>Handling shrink</span><span class="n">${k.handling ? k.handling + '%' : '—'}</span>
        <span>Drying charge</span><span class="n">${k.drying ? '$' + k.drying + '/bu per point' : '—'}</span>
        <span>Test weight</span><span class="n">${k.baseTW != null && k.twPerLb ? `$${k.twPerLb}/bu per lb under ${k.baseTW}` : '—'}</span>
      </div>${k.notes ? `<div class="hint">${e(k.notes)}</div>` : ''}
      <div class="rowbtns"><button class="ghost" type="button" data-comm="${e(c.Commodity)}">Change</button></div></div>`; }).join('')}</div>
    <div class="ohead"><h2>Try the math</h2></div>
    <div class="ofilters"><span class="hint">Commodity</span><select id="cxComm">${cs.map(c => `<option${c.Commodity === calcComm ? ' selected' : ''}>${e(c.Commodity)}</option>`).join('')}</select>
      <span class="hint">Wet bu</span><input id="cxBu" inputmode="decimal" placeholder="Wet bushels" value="${e(O.cxBu ?? '1000')}" style="max-width:130px">
      <span class="hint">Moisture %</span><input id="cxM" inputmode="decimal" placeholder="Moisture %" value="${e(O.cxM ?? '18')}" style="max-width:120px">
      <span class="hint">Test wt</span><input id="cxTw" inputmode="decimal" placeholder="Test weight" value="${e(O.cxTw ?? '')}" style="max-width:120px"></div>
    <div id="cxOut"></div>
    <p class="hint">Dry bushels on the Field report, Inventory and Landlord grain all use these schedules. A change applies to every load already weighed, since dry bushels are worked out from each load's moisture.</p>`;
}
function calcShow() {
  if (!$('cxOut')) return;
  O.calcComm = $('cxComm').value; O.cxBu = $('cxBu').value; O.cxM = $('cxM').value; O.cxTw = $('cxTw').value;
  const m = R.shrinkMath(D(), O.calcComm, Number(O.cxBu) || 0, O.cxM === '' ? '' : Number(O.cxM), O.cxTw === '' ? '' : Number(O.cxTw));
  $('cxOut').innerHTML = `<div class="tblwrap"><table><tbody>${m.steps.map(([a, b]) => `<tr><td>${e(a)}</td><td>${e(b)}</td></tr>`).join('')}
    <tr class="total"><td>Result</td><td>${n2(m.wetBu)} wet bu → <b>${n2(m.dryBu)} dry bu</b> (${m.shrinkPct}% shrink, ${n2(m.shrinkBu)} bu)${m.totalDiscount ? ` · discounts $${n2(m.totalDiscount)}` : ''}</td></tr></tbody></table></div>`;
}
function openComm(name) {
  const c = name ? (D().commodities.find(x => x.Commodity === name) || A.L().commodities.find(x => x.Commodity === name)) : null;
  O.comm = c ? c.Commodity : null;
  const v = x => x == null ? '' : String(x);
  $('dTitle2').textContent = c ? `${c.Commodity} discount schedule` : 'Add commodity';
  $('dName').value = c ? c.Commodity : ''; $('dName').readOnly = !!c;
  $('dLb').value = c ? v(c.LbPerBu) : '56'; $('dStd').value = c ? v(c.StdMoisturePct) : '';
  const k = c ? R.schedule(D(), c.Commodity) : { method: 'Water' };
  $('dMethod').value = k.method; $('dPP').value = c ? v(c.ShrinkPerPoint) : ''; $('dHand').value = c ? v(c.HandlingShrinkPct) : '';
  $('dDry').value = c ? v(c.DryingPerPoint) : ''; $('dTW').value = c ? v(c.BaseTestWeight) : ''; $('dTWd').value = c ? v(c.TWDiscountPerLb) : ''; $('dNotes').value = c ? v(c.ScheduleNotes) : '';
  $('dPPBox').hidden = $('dMethod').value !== 'PerPoint'; $('dMsg').textContent = '';
  $('commDlg').showModal();
}
async function saveComm() {
  const g = id => $(id).value.trim();
  if (!g('dName')) return msg('dMsg', 'Enter the commodity name.');
  $('dSave').disabled = true; msg('dMsg', 'Saving…');
  try {
    await A.api({ action: 'saveCommodity', isNew: !O.comm, commodity: { Commodity: g('dName'), LbPerBu: g('dLb'), StdMoisturePct: g('dStd'), ShrinkMethod: $('dMethod').value,
      ShrinkPerPoint: g('dPP'), HandlingShrinkPct: g('dHand'), DryingPerPoint: g('dDry'), BaseTestWeight: g('dTW'), TWDiscountPerLb: g('dTWd'), ScheduleNotes: g('dNotes') } });
    $('commDlg').close(); A.toast(`${g('dName')} schedule saved`); await load(true); A.refreshLists().catch(() => {});
  } catch (err) { msg('dMsg', err.message); }
  finally { $('dSave').disabled = false; }
}

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
// Land legal, e.g. "S12-T26S-R17W, Kiowa Co."
const legal = f => { const p = [f.Section && 'S' + e(f.Section), f.Township && 'T' + e(f.Township), f.Range && 'R' + e(f.Range)].filter(Boolean).join('-'); return [p, f.County ? e(f.County) + ' Co.' : ''].filter(Boolean).join(', '); };
const splitYear = () => O.year || String(new Date().getFullYear());
const sharesOf = (field, y) => D().shares.filter(s => s.Field === field && String(s.CropYear) === String(y));
function fieldsetup() {
  const y = splitYear();
  const fs = D().fields.slice().sort((a, b) => (a.Active === false) - (b.Active === false) || String(a.Field).localeCompare(String(b.Field)));
  const missing = fs.filter(f => f.Active !== false && !sharesOf(f.Field, y).length).length;
  const totAc = fs.filter(f => f.Active !== false).reduce((a, f) => a + (Number(f.Acres) || 0), 0);
  return `<div class="ohead"><h2>Fields and ${e(y)} splits</h2><button class="big small" type="button" id="fNew">New field</button></div>
    ${missing ? `<div class="banner">${missing} active field${missing === 1 ? ' has' : 's have'} no ${e(y)} split. Loads from ${missing === 1 ? 'it' : 'them'} print "SPLIT NOT SET" until it's added.</div>` : ''}
    ${fs.length ? `<div class="tblwrap"><table><thead><tr><th>Field</th><th class="n">Acres</th><th>${e(y)} split</th><th>Legal</th><th>Insurance unit</th><th>FSA farm / tract</th></tr></thead><tbody>
    ${fs.map(f => { const sh = sharesOf(f.Field, y); return `<tr data-field="${e(f.Field)}" class="${f.Active === false || String(f.Active).toUpperCase() === 'FALSE' ? 'closed' : ''}"><td><b>${e(f.Field)}</b></td><td class="n">${f.Acres ? ac(f.Acres) : '—'}</td>
      <td>${sh.length ? sh.map(s => `${e(s.Owner)} ${Number(s.SharePct)}%`).join(', ') : '<span class="tag">No split</span>'}</td><td>${legal(f)}</td><td>${e(f.InsuranceUnit)}</td><td>${e(f.FSAFarm)}${f.FSATract ? ' / ' + e(f.FSATract) : ''}</td></tr>`; }).join('')}
    <tr class="total"><td>Total active</td><td class="n">${ac(totAc)}</td><td colspan="4"></td></tr>
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
  $('fCounty').value = f ? f.County || '' : ''; $('fSec').value = f ? f.Section || '' : ''; $('fTwp').value = f ? f.Township || '' : ''; $('fRng').value = f ? f.Range || '' : '';
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
      FSAFarm: $('fFarm').value, FSATract: $('fTract').value, Notes: $('fNotes').value, Active: $('fActive').checked,
      County: $('fCounty').value, Section: $('fSec').value, Township: $('fTwp').value.toUpperCase(), Range: $('fRng').value.toUpperCase() } });
    if (before !== after) await A.api({ action: 'saveShares', fieldName: name, cropYear: Number($('fYear').value), shares: rows.map(r => ({ Owner: r.Owner, SharePct: Number(r.SharePct) })) });
    $('fieldDlg').close(); A.toast(`${name} saved`);
    await load(true); A.refreshLists().catch(() => {});
  } catch (err) { msg('fMsg', err.message); }
  finally { $('fSave').disabled = false; }
}

// ---------- fields ----------
function fields() {
  const rows = R.fieldReport(D(), { ...opt(), field: O.fieldPick });
  if (O.fieldPick) rows.forEach(r => { const k = `${r.field}|${r.commodity}|${r.cropYear}`; if (O.open[k] === undefined) O.open[k] = true; });  // one field: show its tickets
  if (!rows.length) return `<div class="ohead"><h2>Field report${O.fieldPick ? ' — ' + e(O.fieldPick) : ''}</h2></div><div class="empty">No inbound loads${O.fieldPick ? ' from ' + e(O.fieldPick) : ''}${O.year ? ' for ' + O.year : ''} yet.</div>`;
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
  const fl = O.fieldPick && D().fields.find(f => f.Field === O.fieldPick);
  return `<div class="ohead"><h2>Field report${O.fieldPick ? ' — ' + e(O.fieldPick) : ''}</h2></div>
    ${fl ? `<p class="hint">${[legal(fl), fl.Acres ? ac(fl.Acres) + ' acres' : '', fl.InsuranceUnit ? 'Insurance unit ' + e(fl.InsuranceUnit) : '', fl.FSAFarm ? 'FSA farm ' + e(fl.FSAFarm) + (fl.FSATract ? ' tract ' + e(fl.FSATract) : '') : ''].filter(Boolean).join(' · ')}</p>` : ''}
    <div class="tblwrap"><table><thead><tr><th>Field</th><th>Crop</th><th class="n">Loads</th><th class="n">Wet bu</th><th class="n">Dry bu</th><th class="n">Moist %</th><th class="n">TW</th>${anyAcres ? '<th class="n">Acres</th><th class="n">Dry bu/ac</th>' : ''}</tr></thead><tbody>${body}</tbody></table></div>
    <p class="hint">Tap a field for each owner's share and the tickets. Dry bushels use each commodity's discount schedule (see the Discounts tab). Moisture and test weight are weighted by bushels.${rows.some(r => r.noMoisture) ? ' * some loads have no moisture reading and are counted as dry.' : ''}${anyAcres ? '' : ' Add an Acres column to the Fields tab to see bushels per acre.'}</p>`;
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
      ${r.landlordHeld ? r.owners.filter(o => o.type !== 'Operator' && o.balance).map(o => line(`&nbsp;&nbsp;Still ${e(o.owner)}'s`, -o.balance)).join('') + line(`&nbsp;&nbsp;Yours`, r.farmOwned, 'tot') : ''}
      ${line('Open contracts to ship', -r.openContracts)}
      ${line('Unsold (yours)', r.unsold, 'tot')}
      ${r.shippedUnpriced ? `<span class="neg">Shipped, not priced yet</span><span class="n neg">${n2(r.shippedUnpriced)}</span>` : ''}
    </div>
    ${r.contracts.length ? `<div class="hint">${r.contracts.map(c => `${e(c.contractNo)} ${e(c.buyer)}: ${n0(c.left)} left`).join(' · ')}</div>` : ''}
    <div class="rowbtns">${r.landlordHeld ? `<button class="ghost" type="button" data-buy="1" data-c="${e(r.commodity)}" data-y="${e(r.cropYear)}">Buy landlord grain</button>` : ''}<button class="ghost" type="button" data-adj="Measured" data-c="${e(r.commodity)}" data-y="${e(r.cropYear)}">Bins measured</button><button class="ghost" type="button" data-adj="BinsEmpty" data-c="${e(r.commodity)}" data-y="${e(r.cropYear)}">Bins empty — zero out</button></div>
  </div>`).join('')}</div>
  <p class="hint">On hand = opening + dry bushels in − bushels out ± adjustments. Landlord grain stays theirs until you buy it on the Landlord grain tab. Unsold = your bushels − what's left to ship on open contracts. "Shipped, not priced yet" is grain already hauled on contract bushels that have no flat price.</p>`;
}

// ---------- landlord grain ----------
function landlord() {
  const held = R.landlordGrain(D(), opt());
  const ps = (D().purchases || []).filter(p => !O.year || String(p.CropYear) === String(O.year)).slice().sort((a, b) => Number(b.PurchaseNo) - Number(a.PurchaseNo));
  const owed = ps.reduce((a, p) => a + (Number(p.Amount) || 0), 0);
  return `<div class="ohead"><h2>Landlord grain in storage</h2><button class="big small" type="button" data-buy="1">Buy landlord grain</button></div>
    ${held.length ? `<div class="tblwrap"><table><thead><tr><th>Landlord</th><th>Crop</th><th class="n">Delivered (dry)</th><th class="n">Bought by you</th><th class="n">Still theirs</th><th></th></tr></thead><tbody>
    ${held.map(h => `<tr><td><b>${e(h.landlord)}</b></td><td>${e(h.commodity)} ${e(h.cropYear)}</td><td class="n">${n2(h.delivered)}</td><td class="n">${n2(h.bought)}</td><td class="n"><b>${n2(h.stillTheirs)}</b></td>
      <td>${h.stillTheirs > 0.004 ? `<button class="ghost" type="button" data-buy="1" data-s="${e(h.landlord)}" data-c="${e(h.commodity)}" data-y="${e(h.cropYear)}">Buy</button>` : '<span class="hint">All bought</span>'}</td></tr>`).join('')}
    </tbody></table></div>` : `<div class="empty">No landlord grain${O.year ? ' for ' + O.year : ''}.</div>`}
    <div class="ohead"><h2>Purchases</h2></div>
    ${ps.length ? `<div class="tblwrap"><table><thead><tr><th>#</th><th>Date</th><th>Landlord</th><th>Crop</th><th class="n">Bushels</th><th class="n">Price</th><th class="n">Amount</th><th>By</th><th>Note</th><th></th></tr></thead><tbody>
    ${ps.map(p => `<tr><td>${e(p.PurchaseNo)}</td><td>${day(p.Date)}</td><td>${e(p.Seller)}</td><td>${e(p.Commodity)} ${e(p.CropYear)}</td><td class="n">${n2(p.Bushels)}</td><td class="n">${p.PricePerBu === '' || p.PricePerBu == null ? '—' : '$' + Number(p.PricePerBu).toFixed(4).replace(/0{1,2}$/, '')}</td><td class="n">${p.Amount === '' || p.Amount == null ? '—' : '$' + n2(p.Amount)}</td><td>${e(p.By)}</td><td>${e(p.Note)}</td><td><button class="ghost bad" type="button" data-unbuy="${e(p.PurchaseNo)}">Undo</button></td></tr>`).join('')}
    ${owed ? `<tr class="total"><td colspan="6">Total</td><td class="n">$${n2(owed)}</td><td colspan="3"></td></tr>` : ''}
    </tbody></table></div>` : '<div class="empty">No purchases yet.</div>'}
    <p class="hint">Landlords' shares come from each field's split. Their grain stays theirs, and doesn't count as yours to sell, until you record buying it here.</p>`;
}
function stillTheirs(seller, c, y) {
  const h = R.landlordGrain(D(), { includeTest: testMode() }).find(x => x.landlord === seller && x.commodity === c && String(x.cropYear) === String(y));
  return h ? h.stillTheirs : 0;
}
function openBuy(seller, c, y) {
  const held = R.landlordGrain(D(), { includeTest: testMode() }).filter(h => h.stillTheirs > 0.004);
  const landlords = D().customers.filter(x => x.Type === 'Landlord').map(x => x.Customer).sort((a, b) => a.localeCompare(b));
  const first = seller || (held[0] && held[0].landlord) || landlords[0] || '';
  const sel = (id, items, v) => { $(id).innerHTML = items.map(i => `<option${String(i) === String(v) ? ' selected' : ''}>${e(i)}</option>`).join(''); };
  sel('bSeller', landlords, first);
  const h0 = held.find(h => h.landlord === first);
  sel('bComm', commodities(), c || (h0 && h0.commodity) || 'Corn');
  const ys = [...new Set([String(new Date().getFullYear()), ...years()])].sort().reverse();
  sel('bYear', ys, y || (h0 && h0.cropYear) || O.year || ys[0]);
  $('bBu').value = ''; $('bPrice').value = ''; $('bNote').value = ''; $('bDate').value = today();
  $('bBy').value = $('bBy').value || (A.S.config && A.S.config.operator) || '';
  $('bMsg').textContent = '';
  buyPreview(); $('buyDlg').showModal();
}
function buyPreview() {
  const held = stillTheirs($('bSeller').value, $('bComm').value, $('bYear').value);
  $('bHeld').textContent = n2(held); $('bAll').hidden = !(held > 0.004);
  const bu = Number(String($('bBu').value).replace(/,/g, '')), price = Number(String($('bPrice').value).replace(/[$,]/g, ''));
  $('bResult').innerHTML = !(bu > 0) ? '' : `${n2(bu)} bu${$('bPrice').value && price >= 0 ? ` × $${price} = <b>$${n2(bu * price)}</b>` : ''} · ${e($('bSeller').value)} keeps ${n2(Math.max(0, held - bu))} bu`;
}
async function saveBuy() {
  const held = stillTheirs($('bSeller').value, $('bComm').value, $('bYear').value);
  const bu = Number(String($('bBu').value).replace(/,/g, '')), priceTxt = String($('bPrice').value).replace(/[$,]/g, '').trim();
  if (!$('bSeller').value) return msg('bMsg', 'Pick the landlord.');
  if (!(bu > 0)) return msg('bMsg', 'Enter the bushels bought.');
  if (bu > held + 0.005) return msg('bMsg', `${$('bSeller').value} only has ${n2(held)} bu of ${$('bComm').value} ${$('bYear').value} in storage.`);
  if (priceTxt && !(Number(priceTxt) >= 0)) return msg('bMsg', 'Price must be a number, or blank.');
  if (!$('bBy').value.trim()) return msg('bMsg', 'Enter who is recording it.');
  $('bSave').disabled = true; msg('bMsg', 'Saving…');
  try {
    await A.api({ action: 'savePurchase', purchase: { Seller: $('bSeller').value, Commodity: $('bComm').value, CropYear: $('bYear').value, Bushels: bu, PricePerBu: priceTxt === '' ? '' : Number(priceTxt), Date: $('bDate').value, By: $('bBy').value.trim(), Note: $('bNote').value.trim() } });
    $('buyDlg').close(); A.toast(`Bought ${n2(bu)} bu from ${$('bSeller').value}`);
    await load(true);
  } catch (err) { msg('bMsg', err.message); }
  finally { $('bSave').disabled = false; }
}
let unbuyArm = { no: null, at: 0 };
async function unbuy(btn) {
  const no = btn.dataset.unbuy;
  if (unbuyArm.no !== no || Date.now() - unbuyArm.at > 4000) { unbuyArm = { no, at: Date.now() }; btn.textContent = 'Tap again to undo'; btn.classList.add('armed'); return; }
  unbuyArm = { no: null, at: 0 };
  try { await A.api({ action: 'voidPurchase', purchaseNo: Number(no), by: (A.S.config && A.S.config.operator) || '' }); A.toast(`Purchase ${no} undone`); await load(true); }
  catch (err) { A.toast(err.message, 6000); }
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
    ${as.map(a => `<tr><td>${e(a.AdjNo)}</td><td>${day(a.Date)}</td><td>${e(a.Commodity)} ${e(a.CropYear)}</td><td>${TYPE_NAME[a.Type] || e(a.Type)}${a.Owner ? ' · ' + e(a.Owner) : ''}</td><td class="n${Number(a.Bushels) < 0 ? ' neg' : ''}">${signed(Number(a.Bushels))}</td><td class="n">${a.BookBefore === '' ? '—' : n2(a.BookBefore)}</td><td class="n">${a.BookAfter === '' ? '—' : n2(a.BookAfter)}</td><td>${e(a.By)}</td><td>${e(a.Note)}</td><td><button class="ghost bad" type="button" data-void="${e(a.AdjNo)}">Undo</button></td></tr>`).join('')}
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
  $('aOwnerBox').hidden = type !== 'Opening';
  const farm = R.operatorName(D());
  $('aOwner').innerHTML = [farm, ...D().customers.filter(x => x.Type === 'Landlord').map(x => x.Customer).sort((a, b) => a.localeCompare(b))].map(o => `<option>${e(o)}</option>`).join('');
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
  if (O.adjType === 'BinsEmpty') {
    const lh = landlordsHolding($('aComm').value, $('aYear').value);
    $('aMsg').textContent = lh.length ? `Landlords still own ${lh.map(h => `${n2(h.stillTheirs)} bu (${h.landlord})`).join(', ')} of this. Buy it first.` : '';
  }
  $('aBook').textContent = n2(book);
  $('aResult').innerHTML = change == null ? '' : O.adjType === 'BinsEmpty'
    ? (Math.abs(change) < 0.005 ? 'The book is already at zero. Saving records the close-out.' : `Write off <b class="${change < 0 ? 'neg' : ''}">${signed(change)} bu</b> → book goes to 0`)
    : `Change <b class="${change < 0 ? 'neg' : ''}">${signed(change)} bu</b> → book becomes ${n2(book + change)} bu`;
}
function landlordsHolding(c, y) {
  return R.landlordGrain(D(), { includeTest: testMode() }).filter(h => h.commodity === c && String(h.cropYear) === String(y) && h.stillTheirs > 0.5);
}
async function saveAdj() {
  const { book, change } = adjChange();
  if (O.adjType === 'BinsEmpty') {
    const lh = landlordsHolding($('aComm').value, $('aYear').value);
    if (lh.length) return msg('aMsg', `Landlords still own grain in this crop: ${lh.map(h => `${h.landlord} ${n2(h.stillTheirs)} bu`).join(', ')}. Record buying it on the Landlord grain tab first, so the write-off only comes out of your bushels.`);
  }
  if (change == null) return msg('aMsg', 'Enter the bushels.');
  if (!$('aBy').value.trim()) return msg('aMsg', 'Enter who is making the adjustment.');
  $('aSave').disabled = true; msg('aMsg', 'Saving…');
  try {
    await A.api({ action: 'saveAdjustment', adjustment: { Type: O.adjType, Commodity: $('aComm').value, CropYear: $('aYear').value, Bushels: change, BookBefore: book, Date: $('aDate').value, By: $('aBy').value.trim(), Note: $('aNote').value.trim(), Owner: O.adjType === 'Opening' ? $('aOwner').value : '' } });
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
// Letterhead on every printed report: logo, business name, address, report title.
function letterhead(title, sub) {
  return `<div class="rhead"><img src="logo.png" alt=""><div><div class="rname">Blue Barn Land &amp; Cattle</div>
    <div class="raddr">2949 S Road · Haviland, KS 67059 · 620-995-4245</div><div class="rtitle">${title}</div>${sub ? `<div class="rsub">${sub}</div>` : ''}</div></div>`;
}
// Waits for the logo so it's on the page before the print window opens.
function printWhenReady(a) {
  const img = a.querySelector('.rhead img');
  const go = () => setTimeout(() => window.print(), 100);
  if (!img || img.complete) return go();
  img.onload = img.onerror = go;
  setTimeout(go, 3000);
}
function printReport() {
  let a = $('printArea');
  if (!a) { a = document.createElement('div'); a.id = 'printArea'; document.body.appendChild(a); }
  const names = { tickets: 'Tickets', discounts: 'Discount schedules', contracts: 'Contracts', customers: 'Customers', fieldsetup: 'Fields and splits', fields: 'Field report', inventory: 'Inventory and sales position', landlord: 'Landlord grain', writeoffs: 'Write-offs', adjustments: 'Inventory adjustments' };
  const body = $('oBody').cloneNode(true);
  body.querySelectorAll('button').forEach(b => b.remove());
  body.querySelectorAll('.ohead h2').forEach(h => h.remove());
  a.className = 'report';
  a.innerHTML = letterhead(names[O.tab] + (O.tab === 'fields' && O.fieldPick ? ' — ' + e(O.fieldPick) : '') + (O.year && O.tab !== 'adjustments' ? ' — ' + O.year : ''), 'Printed ' + new Date().toLocaleString()) + body.innerHTML;
  printWhenReady(a);
}

// ---------------- wiring ----------------
function wire() {
  const b = $('oBody');
  b.querySelectorAll('[data-copen]').forEach(tr => tr.onclick = () => { O.open['c:' + tr.dataset.copen] = !O.open['c:' + tr.dataset.copen]; render(); });
  b.querySelectorAll('[data-contract]').forEach(x => x.onclick = ev => { ev.stopPropagation(); openContract(x.dataset.contract); });
  b.querySelectorAll('[data-cprint]').forEach(x => x.onclick = ev => { ev.stopPropagation(); printContract(x.dataset.cprint); });
  if ($('cNew')) $('cNew').onclick = () => openContract(null);
  b.querySelectorAll('[data-customer]').forEach(tr => tr.onclick = () => openCustomer(tr.dataset.customer));
  b.querySelectorAll('[data-ticket]').forEach(tr => tr.onclick = () => openTicket(tr.dataset.ticket));
  if ($('tNew')) $('tNew').onclick = () => openTicket(null);
  if ($('tq')) { $('tq').oninput = () => { O.tq = $('tq').value; clearTimeout(O.tqT); O.tqT = setTimeout(() => { const pos = $('tq').selectionStart; render(); $('tq').focus(); $('tq').setSelectionRange(pos, pos); }, 300); }; }
  if ($('tdirSel')) $('tdirSel').onchange = () => { O.tdir = $('tdirSel').value; render(); };
  if ($('tvoid')) $('tvoid').onchange = () => { O.tvoid = $('tvoid').checked; render(); };
  b.querySelectorAll('[data-comm]').forEach(x => x.onclick = () => openComm(x.dataset.comm));
  if ($('dNew')) $('dNew').onclick = () => openComm(null);
  for (const id of ['cxComm', 'cxBu', 'cxM', 'cxTw']) if ($(id)) { $(id).oninput = calcShow; $(id).onchange = calcShow; }
  calcShow();
  if ($('kNew')) $('kNew').onclick = () => openCustomer(null);
  b.querySelectorAll('[data-field]').forEach(tr => tr.onclick = () => openField(tr.dataset.field));
  if ($('fNew')) $('fNew').onclick = () => openField(null);
  b.querySelectorAll('[data-open]').forEach(tr => tr.onclick = () => { O.open[tr.dataset.open] = !O.open[tr.dataset.open]; render(); });
  b.querySelectorAll('[data-adj]').forEach(x => x.onclick = () => openAdj(x.dataset.adj, x.dataset.c, x.dataset.y));
  b.querySelectorAll('[data-void]').forEach(x => x.onclick = () => voidAdj(x));
  b.querySelectorAll('[data-buy]').forEach(x => x.onclick = () => openBuy(x.dataset.s, x.dataset.c, x.dataset.y));
  b.querySelectorAll('[data-unbuy]').forEach(x => x.onclick = () => unbuy(x));
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
  $('pAdd').onclick = () => openPricing(null);
  $('pSave').onclick = savePricing; $('pCancel').onclick = () => $('priceDlg').close(); $('pVoid').onclick = voidPricing;
  for (const id of ['pFut', 'pBasis', 'pFees', 'pFlat', 'pBu']) $(id).addEventListener('input', pricePreview);
  $('tSave').onclick = saveTicket; $('tCancel').onclick = () => $('ticketDlg').close(); $('tVoid').onclick = voidTicket; $('tPrint').onclick = printOfficeTicket;
  $('tDir').onchange = () => { tDirShow(); };
  $('tBuyer').onchange = () => ticketContracts($('tBuyer').value, '');
  for (const id of ['tGross', 'tTare', 'tComm']) { $(id).addEventListener('input', tCalc); $(id).addEventListener('change', tCalc); }
  $('dSave').onclick = saveComm; $('dCancel').onclick = () => $('commDlg').close();
  $('dMethod').onchange = () => { $('dPPBox').hidden = $('dMethod').value !== 'PerPoint'; };
  $('oField').onchange = () => { O.fieldPick = $('oField').value; render(); };
  $('kSave').onclick = saveCustomer; $('kCancel').onclick = () => $('custDlg').close();
  $('fSave').onclick = saveField; $('fCancel').onclick = () => $('fieldDlg').close();
  $('bSave').onclick = saveBuy; $('bCancel').onclick = () => $('buyDlg').close();
  $('bAll').onclick = () => { $('bBu').value = stillTheirs($('bSeller').value, $('bComm').value, $('bYear').value).toFixed(2); buyPreview(); };
  for (const id of ['bSeller', 'bComm', 'bYear', 'bBu', 'bPrice']) { $(id).addEventListener('input', buyPreview); $(id).addEventListener('change', buyPreview); }
  $('fYear').onchange = loadShares; $('fCopy').onclick = copyLastYear;
  $('fAddOwner').onclick = () => { O.shareRows.push({ Owner: '', SharePct: O.shareRows.length ? Math.max(0, 100 - O.shareRows.reduce((a, r) => a + (Number(r.SharePct) || 0), 0)) : 100 }); drawShares(); };
  for (const id of ['aComm', 'aYear', 'aBu']) { $(id).addEventListener('input', adjPreview); $(id).addEventListener('change', adjPreview); }
  let v = 'scale'; try { v = localStorage.getItem('bbg-view') || 'scale'; } catch (_) {}
  show(v);
}
if (window.BBG_APP) init(); else window.addEventListener('bbg-ready', init, { once: true });
})();
