/* Blue Barn Grain — report math for the office screens. Pure functions, no screen code,
   so the same numbers can be checked under Node (test/reports.test.js).
   Input is the backend's officeData: tickets, splits, allocations, adjustments, contracts, fields, commodities, settings. */
(function (root) {
  const num = v => (v === '' || v == null || isNaN(Number(v))) ? 0 : Number(v);
  const has = v => v !== '' && v != null && !isNaN(Number(v));
  const r2 = x => Math.round(x * 100) / 100;
  const isTrue = v => v === true || String(v).toUpperCase() === 'TRUE';
  const key = (...a) => a.join('|');

  // Discount schedule for a commodity (Commodities tab). ShrinkMethod 'Water' shrinks out only the
  // water: dry = wet × (100 − M) / (100 − std). 'PerPoint' takes a flat % per point over standard
  // (pencil shrink). Handling shrink % is added on top when the grain is over standard.
  function schedule(data, commodity) {
    const c = (data.commodities || []).find(x => x.Commodity === commodity) || {};
    const legacy = data.settings && data.settings.ShrinkPerPoint;   // older Settings-wide switch
    const method = c.ShrinkMethod === 'PerPoint' || (!c.ShrinkMethod && has(legacy) && num(legacy) > 0) ? 'PerPoint' : 'Water';
    return { commodity, lbPerBu: num(c.LbPerBu) || 56, std: has(c.StdMoisturePct) ? num(c.StdMoisturePct) : null, method,
      perPoint: has(c.ShrinkPerPoint) ? num(c.ShrinkPerPoint) : (has(legacy) ? num(legacy) : 0), handling: num(c.HandlingShrinkPct),
      drying: num(c.DryingPerPoint), baseTW: has(c.BaseTestWeight) ? num(c.BaseTestWeight) : null, twPerLb: num(c.TWDiscountPerLb), notes: c.ScheduleNotes || '' };
  }
  function shrinkFactor(moisture, std, perPoint, handling, method) {
    if (!has(moisture) || !has(std) || !num(std)) return 1;
    const m = num(moisture), s = num(std);
    if (m <= s) return 1;
    const usePP = method ? method === 'PerPoint' : num(perPoint) > 0;
    const f = usePP ? 1 - (m - s) * num(perPoint) / 100 : (100 - m) / (100 - s);
    return Math.max(0, f - num(handling) / 100);
  }
  // The math for one load, step by step, so it can be shown and checked.
  function shrinkMath(data, commodity, wetBu, moisture, tw) {
    const k = schedule(data, commodity), wet = num(wetBu), steps = [];
    const f2 = x => (Math.round(x * 100) / 100).toFixed(2), f4 = x => (Math.round(x * 10000) / 10000).toString();
    const over = has(moisture) && k.std != null ? Math.max(0, num(moisture) - k.std) : 0;
    let moistShrinkPct = 0;
    if (!has(moisture)) steps.push(['No moisture reading', 'counted as dry; no shrink']);
    else if (k.std == null) steps.push(['No standard moisture set for ' + commodity, 'no shrink']);
    else if (over <= 0) steps.push([`Moisture ${num(moisture)}% is at or under the ${k.std}% standard`, 'no shrink']);
    else if (k.method === 'PerPoint') {
      moistShrinkPct = over * k.perPoint;
      steps.push([`Points over standard`, `${num(moisture)}% − ${k.std}% = ${f4(over)} points`]);
      steps.push([`Moisture shrink at ${k.perPoint}% per point`, `${f4(over)} × ${k.perPoint}% = ${f4(moistShrinkPct)}%`]);
    } else {
      moistShrinkPct = (1 - (100 - num(moisture)) / (100 - k.std)) * 100;
      steps.push([`Water shrink to ${k.std}%`, `1 − (100 − ${num(moisture)}) ÷ (100 − ${k.std}) = 1 − ${f4(100 - num(moisture))} ÷ ${f4(100 - k.std)} = ${f4(moistShrinkPct)}%`]);
    }
    const handling = over > 0 ? k.handling : 0;
    if (handling) steps.push(['Handling shrink', `+ ${handling}%`]);
    const totalPct = Math.min(100, moistShrinkPct + handling);
    if (totalPct) steps.push(['Total shrink', `${f4(totalPct)}%`]);
    const shrinkBu = wet * totalPct / 100, dry = wet - shrinkBu;
    steps.push(['Dry bushels', `${f2(wet)} wet bu − ${f2(wet)} × ${f4(totalPct)}% = ${f2(wet)} − ${f2(shrinkBu)} = ${f2(dry)} dry bu`]);
    const drying = over > 0 && k.drying ? over * k.drying * wet : 0;
    if (drying) steps.push(['Drying charge', `${f4(over)} points × $${k.drying} × ${f2(wet)} wet bu = $${f2(drying)}`]);
    const twShort = has(tw) && k.baseTW != null ? Math.max(0, k.baseTW - num(tw)) : 0;
    const twDisc = twShort && k.twPerLb ? twShort * k.twPerLb * dry : 0;
    if (twDisc) steps.push(['Test weight discount', `${k.baseTW} − ${num(tw)} = ${f4(twShort)} lb under × $${k.twPerLb} × ${f2(dry)} dry bu = $${f2(twDisc)}`]);
    return { schedule: k, steps, wetBu: r2(wet), shrinkPct: Math.round(totalPct * 10000) / 10000, shrinkBu: r2(shrinkBu), dryBu: r2(dry),
      dryingCharge: r2(drying), twDiscount: r2(twDisc), totalDiscount: r2(drying + twDisc) };
  }

  function prep(data, opt = {}) {
    const lbBu = {}, sched = {};
    (data.commodities || []).forEach(c => { lbBu[c.Commodity] = num(c.LbPerBu) || 56; });
    const S = c => sched[c] = sched[c] || schedule(data, c);
    const tickets = (data.tickets || []).filter(t => t.Status === 'Closed' && (opt.includeTest || !isTrue(t.TestTicket)))
      .filter(t => !opt.cropYear || String(t.CropYear) === String(opt.cropYear))
      .filter(t => !opt.commodity || t.Commodity === opt.commodity)
      .filter(t => !opt.field || t.Field === opt.field);
    const dry = t => { const k = S(t.Commodity); return r2(num(t.WetBu) * shrinkFactor(t.MoisturePct, k.std, k.perPoint, k.handling, k.method)); };
    return { tickets, dry, lbBu };
  }

  // One row per field, commodity and crop year, with each owner's share and the tickets behind it.
  function fieldReport(data, opt = {}) {
    const { tickets, dry } = prep(data, opt);
    const splits = {};
    (data.splits || []).forEach(s => { (splits[String(s.TicketNo)] = splits[String(s.TicketNo)] || []).push(s); });
    const acres = {};
    (data.fields || []).forEach(f => { if (has(f.Acres) && num(f.Acres) > 0) acres[f.Field] = num(f.Acres); });
    const rows = {};
    tickets.filter(t => t.Direction === 'IN').forEach(t => {
      const k = key(t.Field, t.Commodity, t.CropYear);
      const r = rows[k] = rows[k] || { field: t.Field || '(no field)', commodity: t.Commodity, cropYear: t.CropYear, loads: 0, netLb: 0, wetBu: 0, dryBu: 0,
        mSum: 0, mBu: 0, twSum: 0, twBu: 0, noMoisture: 0, owners: {}, tickets: [] };
      const wet = num(t.WetBu), d = dry(t);
      r.loads++; r.netLb += num(t.NetLb); r.wetBu += wet; r.dryBu += d;
      if (has(t.MoisturePct)) { r.mSum += num(t.MoisturePct) * wet; r.mBu += wet; } else r.noMoisture++;
      if (has(t.TestWeight)) { r.twSum += num(t.TestWeight) * wet; r.twBu += wet; }
      const sp = splits[String(t.TicketNo)] || [{ Owner: 'UNASSIGNED', SharePct: 100, WetBu: wet }];
      sp.forEach(s => {
        const o = r.owners[s.Owner] = r.owners[s.Owner] || { owner: s.Owner, pct: num(s.SharePct), wetBu: 0, dryBu: 0 };
        const share = has(s.WetBu) ? num(s.WetBu) : wet * num(s.SharePct) / 100;
        o.wetBu += share; o.dryBu += wet ? d * share / wet : 0;
      });
      r.tickets.push({ no: t.TicketNo, at: t.DateTime, loadNo: t.LoadNo, truck: t.Truck, netLb: num(t.NetLb), wetBu: wet, dryBu: d,
        moisture: has(t.MoisturePct) ? num(t.MoisturePct) : null, tw: has(t.TestWeight) ? num(t.TestWeight) : null,
        split: sp.map(s => `${s.Owner} ${num(s.SharePct)}%`).join(', ') });
    });
    return Object.values(rows).map(r => ({
      field: r.field, commodity: r.commodity, cropYear: r.cropYear, loads: r.loads, netLb: r.netLb,
      wetBu: r2(r.wetBu), dryBu: r2(r.dryBu),
      moisture: r.mBu ? r2(r.mSum / r.mBu) : null, tw: r.twBu ? r2(r.twSum / r.twBu) : null, noMoisture: r.noMoisture,
      acres: acres[r.field] || null, dryBuPerAcre: acres[r.field] ? r2(r.dryBu / acres[r.field]) : null,
      owners: Object.values(r.owners).map(o => ({ ...o, wetBu: r2(o.wetBu), dryBu: r2(o.dryBu) })).sort((a, b) => b.dryBu - a.dryBu),
      tickets: r.tickets.sort((a, b) => num(a.no) - num(b.no))
    })).sort((a, b) => String(b.cropYear).localeCompare(String(a.cropYear)) || String(a.commodity).localeCompare(String(b.commodity)) || String(a.field).localeCompare(String(b.field)));
  }

  // Bushels applied to each contract (from the TicketContracts tab).
  function appliedByContract(data, opt = {}) {
    const keepNo = {};
    (data.tickets || []).forEach(t => { if (opt.includeTest || !isTrue(t.TestTicket)) keepNo[String(t.TicketNo)] = true; });
    const a = {};
    (data.allocations || []).forEach(x => { if (keepNo[String(x.TicketNo)]) a[String(x.ContractNo)] = (a[String(x.ContractNo)] || 0) + num(x.Bushels); });
    return a;
  }

  // Who owns what's in the bins. Each load's dry bushels go to its owners by the split.
  // Buying landlord grain moves bushels from the landlord to the farm. Sales, shrink and
  // adjustments are the farm's. Landlords' stored grain is theirs until bought.
  function operatorName(data) {
    const ops = (data.customers || []).filter(c => c.Type === 'Operator');
    const op = ops.find(c => !(c.Active === false || String(c.Active).toUpperCase() === 'FALSE')) || ops[0];  // the active one, if there are two
    return op ? op.Customer : 'Farm';
  }
  function custType(data) { const t = {}; (data.customers || []).forEach(c => { t[c.Customer] = c.Type; }); return t; }

  // Book inventory and sales position per commodity and crop year.
  // On hand = opening + dry bushels in − bushels out ± adjustments.
  // Open contracts = what's left to ship on contracts that aren't closed or filled.
  function inventory(data, opt = {}) {
    const { tickets, dry } = prep(data, { ...opt, cropYear: '', commodity: '' });
    const halfLoad = (num(data.settings && data.settings.TypicalLoadBu) || 1000) / 2;
    const farm = operatorName(data), types = custType(data);
    const splits = {};
    (data.splits || []).forEach(x => { (splits[String(x.TicketNo)] = splits[String(x.TicketNo)] || []).push(x); });
    const rows = {};
    const row = (c, y) => rows[key(c, y)] = rows[key(c, y)] || { commodity: c, cropYear: y, opening: 0, inDry: 0, inWet: 0, out: 0, adjust: 0, writeOff: 0, purchased: 0, loadsIn: 0, loadsOut: 0, openContracts: 0, contracts: [], own: {} };
    const own = (r, who) => r.own[who] = r.own[who] || { owner: who, type: who === farm ? 'Operator' : (types[who] || (who === 'UNASSIGNED' ? 'Unassigned' : 'Landlord')), opening: 0, inDry: 0, bought: 0, sold: 0, balance: 0 };
    tickets.forEach(t => {
      const r = row(t.Commodity, t.CropYear);
      if (t.Direction === 'IN') {
        const d = dry(t), wet = num(t.WetBu);
        r.inDry += d; r.inWet += wet; r.loadsIn++;
        const sp = splits[String(t.TicketNo)] || [{ Owner: 'UNASSIGNED', SharePct: 100, WetBu: wet }];
        sp.forEach(x => { const share = has(x.WetBu) ? num(x.WetBu) : wet * num(x.SharePct) / 100; own(r, x.Owner).inDry += wet ? d * share / wet : 0; });
      } else if (t.Direction === 'OUT') { r.out += num(t.WetBu); r.loadsOut++; }
    });
    (data.adjustments || []).forEach(a => {
      if (String(a.Status) === 'Void') return;
      const r = row(a.Commodity, a.CropYear);
      if (a.Type === 'Opening') { r.opening += num(a.Bushels); own(r, a.Owner || farm).opening += num(a.Bushels); }
      else { r.adjust += num(a.Bushels); if (a.Type === 'BinsEmpty') r.writeOff += num(a.Bushels); }
    });
    (data.purchases || []).forEach(p => {
      if (String(p.Status) === 'Void') return;
      const r = row(p.Commodity, p.CropYear);
      r.purchased += num(p.Bushels);
      own(r, p.Seller).sold += num(p.Bushels); own(r, farm).bought += num(p.Bushels);
    });
    const applied = appliedByContract(data, opt);
    (data.contracts || []).forEach(c => {
      if (String(c.Status) === 'Closed') return;
      const left = num(c.Bushels) - (applied[String(c.ContractNo)] || 0);
      if (left < halfLoad) return;  // filled: no more trucks go on it
      const r = row(c.Commodity, c.CropYear);
      r.openContracts += left;
      r.contracts.push({ contractNo: String(c.ContractNo), buyer: c.Buyer, bushels: num(c.Bushels), shipped: r2(applied[String(c.ContractNo)] || 0), left: r2(left) });
    });
    const cp = contractPricing(data, opt);
    (data.contracts || []).forEach(c => { const p = cp[String(c.ContractNo)]; if (p && p.shippedUnpriced) { const r = row(c.Commodity, c.CropYear); r.shippedUnpriced = (r.shippedUnpriced || 0) + p.shippedUnpriced; } });
    return Object.values(rows).map(r => {
      const onHand = r.opening + r.inDry - r.out + r.adjust;
      const f = own(r, farm);
      Object.values(r.own).forEach(o => { o.balance = r2(o.opening) + r2(o.inDry) + r2(o.bought) - r2(o.sold); });  // rounded the way they're shown, so "buy all" leaves exactly 0
      f.balance += -r.out + r.adjust;   // sales, shrink and adjustments are the farm's
      const owners = Object.values(r.own).map(o => ({ owner: o.owner, type: o.type, opening: r2(o.opening), inDry: r2(o.inDry), bought: r2(o.bought), sold: r2(o.sold), balance: r2(o.balance) }))
        .filter(o => o.type === 'Operator' || Math.abs(o.balance) >= 0.005 || o.inDry || o.sold)
        .sort((a, b) => (a.type !== 'Operator') - (b.type !== 'Operator') || b.balance - a.balance);
      const landlordHeld = owners.filter(o => o.type !== 'Operator').reduce((a, o) => a + Math.max(0, o.balance), 0);
      // The farm's share is whatever isn't someone else's, so the owners always add back to on hand exactly.
      const others = owners.filter(o => o.type !== 'Operator').reduce((a, o) => a + o.balance, 0);
      const fo = owners.find(o => o.type === 'Operator'); fo.balance = r2(r2(onHand) - r2(others));
      const farmOwned = fo.balance;
      return { commodity: r.commodity, cropYear: r.cropYear, opening: r2(r.opening), inDry: r2(r.inDry), inWet: r2(r.inWet), out: r2(r.out), adjust: r2(r.adjust), writeOff: r2(r.writeOff),
        purchased: r2(r.purchased), loadsIn: r.loadsIn, loadsOut: r.loadsOut, contracts: r.contracts,
        onHand: r2(onHand), owners, landlordHeld: r2(landlordHeld), farmOwned: r2(farmOwned),
        openContracts: r2(r.openContracts), unsold: r2(farmOwned - r.openContracts), shippedUnpriced: r2(r.shippedUnpriced || 0) };
    }).filter(r => !opt.cropYear || String(r.cropYear) === String(opt.cropYear))
      .sort((a, b) => String(b.cropYear).localeCompare(String(a.cropYear)) || String(a.commodity).localeCompare(String(b.commodity)));
  }

  // Each landlord's grain per commodity and crop year: delivered, bought by the farm, still theirs in storage.
  function landlordGrain(data, opt = {}) {
    const out = [];
    inventory(data, opt).forEach(r => r.owners.filter(o => o.type !== 'Operator').forEach(o =>
      out.push({ landlord: o.owner, type: o.type, commodity: r.commodity, cropYear: r.cropYear, delivered: r2(o.inDry + o.opening), bought: o.sold, stillTheirs: o.balance })));
    return out.sort((a, b) => b.stillTheirs - a.stillTheirs || String(a.landlord).localeCompare(String(b.landlord)));
  }

  // Pricing per contract: priced (flat known), partly priced (basis or futures only), unpriced,
  // bushel-weighted average flat price, and bushels shipped that have no price yet.
  function contractPricing(data, opt = {}) {
    const applied = appliedByContract(data, opt), out = {};
    (data.contracts || []).forEach(c => {
      const no = String(c.ContractNo);
      const lines = (data.pricing || []).filter(p => String(p.ContractNo) === no && String(p.Status) !== 'Void');
      let priced = 0, partial = 0, dollars = 0;
      lines.forEach(p => { if (has(p.FlatPrice)) { priced += num(p.Bushels); dollars += num(p.Bushels) * num(p.FlatPrice); } else partial += num(p.Bushels); });
      const shipped = applied[no] || 0;
      out[no] = { contractNo: no, bushels: num(c.Bushels), priced: r2(priced), partial: r2(partial), unpriced: r2(Math.max(0, num(c.Bushels) - priced - partial)),
        avgFlat: priced ? Math.round(dollars / priced * 10000) / 10000 : null, shipped: r2(shipped), shippedUnpriced: r2(Math.max(0, shipped - priced)),
        lines: lines.slice().sort((a, b) => num(a.PricingNo) - num(b.PricingNo)) };
    });
    return out;
  }

  // Application report: every ticket applied to each contract, oldest first, with a running total.
  function contractApplications(data, opt = {}) {
    const tk = {};
    (data.tickets || []).forEach(t => { if (opt.includeTest || !isTrue(t.TestTicket)) tk[String(t.TicketNo)] = t; });
    const out = {};
    (data.allocations || []).forEach(a => {
      const t = tk[String(a.TicketNo)]; if (!t) return;
      (out[String(a.ContractNo)] = out[String(a.ContractNo)] || []).push({ no: num(t.TicketNo), at: t.DateTime, truck: t.Truck, driver: t.Driver, bol: t.BOLNo,
        gross: num(t.GrossLb), tare: num(t.TareLb), net: num(t.NetLb), bu: num(a.Bushels), rolledFrom: t.RolledFrom || '', test: isTrue(t.TestTicket) });
    });
    Object.values(out).forEach(rows => {
      rows.sort((a, b) => new Date(a.at) - new Date(b.at) || a.no - b.no);
      let run = 0; rows.forEach(r => { run += r.bu; r.running = r2(run); });
    });
    return out;
  }

  // Shrink written off when the bins were emptied, per commodity and crop year.
  function writeOffs(data, opt = {}) {
    return inventory(data, opt).filter(r => (data.adjustments || []).some(a => String(a.Status) !== 'Void' && a.Type === 'BinsEmpty' && a.Commodity === r.commodity && String(a.CropYear) === String(r.cropYear)))
      .map(r => {
        const handled = r.opening + r.inDry;
        const measured = r2(r.adjust - r.writeOff);
        return { commodity: r.commodity, cropYear: r.cropYear, opening: r.opening, inDry: r.inDry, out: r.out, measured,
          writeOff: r.writeOff, shrinkPct: handled ? r2(-(r.writeOff + measured) / handled * 100) : null,
          entries: (data.adjustments || []).filter(a => String(a.Status) !== 'Void' && a.Commodity === r.commodity && String(a.CropYear) === String(r.cropYear) && a.Type !== 'Opening') };
      });
  }

  const api = { shrinkFactor, shrinkMath, schedule, fieldReport, inventory, landlordGrain, writeOffs, appliedByContract, operatorName, contractPricing, contractApplications };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BBR = api;
})(typeof window !== 'undefined' ? window : globalThis);
