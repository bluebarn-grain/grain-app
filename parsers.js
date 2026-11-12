/* Blue Barn Grain — device line parsers and shared math.
   Loaded in the browser (window.BBG) and in Node tests (module.exports). */
(function (root) {
  'use strict';

  function clean(line) {
    return String(line).replace(/[\x00-\x1f\x7f]/g, '').trim();
  }

  // Rice Lake 720i continuous output, e.g. "10480LG", "  31200LG M", "-20LG", "10480LGM"
  // weight, unit (L=lb, K=kg), mode (G=gross, N=net), status (M=motion, O=over/under, I=invalid)
  function parseScale(line) {
    const s = clean(line);
    const m = s.match(/^([+-])?\s*(\d+(?:\.\d+)?)\s*([LKT])?\s*([GN])\s*([MOIZ\s]*)$/i);
    if (!m) return null;
    const w = parseFloat(m[2]) * (m[1] === '-' ? -1 : 1);
    const st = (m[5] || '').toUpperCase();
    return {
      weight: w,
      unit: (m[3] || 'L').toUpperCase(),
      mode: m[4].toUpperCase(),
      motion: st.includes('M'),
      overload: st.includes('O') || st.includes('I'),
      raw: s
    };
  }

  // Moisture tester CSV, e.g.
  // 03/03/2010,22:33,Sorghum,20230412N,27,GUEST,,13.9,54.5,59.6
  // date, time, grain, calibration, LOAD #, operator, sample id, moisture, test weight, temp F
  function parseMoisture(line) {
    const s = clean(line);
    if (!s) return null;
    const f = s.split(',').map(x => x.trim());
    if (f.length < 10) return null;
    const num = x => { const v = parseFloat(x); return isFinite(v) ? v : null; };
    const load = parseInt(f[4], 10);
    const r = {
      grain: f[2],
      calibration: f[3],
      loadNo: isFinite(load) ? load : null,
      operator: f[5],
      sampleId: f[6],
      moisture: num(f[7]),
      testWeight: num(f[8]),
      tempF: num(f[9]),
      raw: s
    };
    return r.moisture == null ? null : r;
  }

  // Turns a stream of text chunks into whole lines.
  function lineSplitter(onLine) {
    let buf = '';
    return function (chunk) {
      buf += chunk;
      let i;
      while ((i = buf.search(/[\r\n]/)) >= 0) {
        const l = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (l.trim()) onLine(l);
      }
      if (buf.length > 1000) buf = buf.slice(-200);
    };
  }

  // Next inbound load number, 1..100, skipping numbers still on the yard.
  function nextLoadNo(last, inUse) {
    const used = new Set(inUse);
    let n = last || 0;
    for (let i = 0; i < 100; i++) {
      n = (n % 100) + 1;
      if (!used.has(n)) return n;
    }
    return null;
  }

  // Splits net pounds by share %, rounding so the parts always add back to the net.
  function splitNet(netLb, lbPerBu, shares) {
    let left = netLb;
    return shares.map((s, i) => {
      const lb = i === shares.length - 1 ? left : Math.round(netLb * s.pct / 100);
      left -= lb;
      return { owner: s.owner, pct: s.pct, netLb: lb, wetBu: Math.round(lb / lbPerBu * 100) / 100 };
    });
  }

  // ---- contract allocation (keep identical to the copy in backend/Code.gs) ----
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
  // Applies a load's bushels: fills the chosen contract, rolls the rest into the next one(s).
  // If every contract is full, the leftover stays on the chosen contract and comes back as "over".
  function applyToContracts(bu, chosen, contracts, applied) {
    const chain = contractChain(chosen, contracts);
    if (!chain.length) return { parts: [], over: 0 };
    let left = Math.round(Number(bu || 0) * 100); const parts = [];
    for (const c of chain) {
      if (left <= 0) break;
      const room = Math.round(Number(c.Bushels || 0) * 100) - Math.round(Number(applied[String(c.ContractNo)] || 0) * 100);
      if (room <= 0) continue;
      const take = Math.min(left, room);
      parts.push({ contractNo: String(c.ContractNo), bu: take / 100, rolled: c !== chain[0] });
      left -= take;
    }
    let over = 0;
    if (left > 0) {
      over = left / 100;
      const no = String(chain[0].ContractNo), p = parts.find(x => x.contractNo === no);
      if (p) p.bu = (Math.round(p.bu * 100) + left) / 100; else parts.unshift({ contractNo: no, bu: left / 100, rolled: false });
    }
    return { parts, over };
  }

  const api = { parseScale, parseMoisture, lineSplitter, nextLoadNo, splitNet, contractChain, applyToContracts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BBG = api;
})(typeof window !== 'undefined' ? window : globalThis);
