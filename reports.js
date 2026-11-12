/* Blue Barn Grain — report math for the office screens. Pure functions, no screen code,
   so the same numbers can be checked under Node (test/reports.test.js).
   Input is the backend's officeData: tickets, splits, allocations, adjustments, contracts, fields, commodities, settings. */
(function (root) {
  const num = v => (v === '' || v == null || isNaN(Number(v))) ? 0 : Number(v);
  const has = v => v !== '' && v != null && !isNaN(Number(v));
  const r2 = x => Math.round(x * 100) / 100;
  const isTrue = v => v === true || String(v).toUpperCase() === 'TRUE';
  const key = (...a) => a.join('|');

  // Dry bushels. Water shrink to the commodity's standard moisture by default:
  // dry = wet × (100 − M) / (100 − std). Settings → ShrinkPerPoint (e.g. 1.4) switches to a
  // flat % per point over standard instead. Grain at or under standard isn't credited.
  function shrinkFactor(moisture, std, perPoint) {
    if (!has(moisture) || !has(std) || !num(std)) return 1;
    const m = num(moisture), s = num(std);
    if (m <= s) return 1;
    if (num(perPoint) > 0) return Math.max(0, 1 - (m - s) * num(perPoint) / 100);
    return (100 - m) / (100 - s);
  }

  function prep(data, opt = {}) {
    const std = {}, lbBu = {};
    (data.commodities || []).forEach(c => { std[c.Commodity] = c.StdMoisturePct; lbBu[c.Commodity] = num(c.LbPerBu) || 56; });
    const perPoint = data.settings && data.settings.ShrinkPerPoint;
    const tickets = (data.tickets || []).filter(t => t.Status === 'Closed' && (opt.includeTest || !isTrue(t.TestTicket)))
      .filter(t => !opt.cropYear || String(t.CropYear) === String(opt.cropYear))
      .filter(t => !opt.commodity || t.Commodity === opt.commodity);
    const dry = t => r2(num(t.WetBu) * shrinkFactor(t.MoisturePct, std[t.Commodity], perPoint));
    return { tickets, dry, std, lbBu, perPoint };
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
    const op = (data.customers || []).find(c => c.Type === 'Operator');
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
        openContracts: r2(r.openContracts), unsold: r2(farmOwned - r.openContracts) };
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

  const api = { shrinkFactor, fieldReport, inventory, landlordGrain, writeOffs, appliedByContract, operatorName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BBR = api;
})(typeof window !== 'undefined' ? window : globalThis);
