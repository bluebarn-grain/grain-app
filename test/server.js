// Serves the app and a fake backend (the real Code.gs running on a mock Sheet) for browser tests.
const http = require('http'), fs = require('fs'), path = require('path');
const { loadBackend, testSheet } = require('./mock-gas.js');
const ss = testSheet();
// ROLLOVER=1: small TEST-C1 plus a later Andersons contract, to try contract roll-over.
if (process.env.ROLLOVER) { ss.sheets.Contracts.data[1][4] = 1400; ss.sheets.Contracts.data.push(['TEST-C3', 'The Andersons', 'Corn', 2026, 5000, new Date('2027-02-01'), '', 'Open', '']); }
const be = loadBackend(ss, { SHEET_ID: 'x', API_KEY: 'k' , ANTHROPIC_API_KEY: 'sk-test', SCALE_KEY: 'scalekey'});
// Stand-in for Claude reading a settlement: an Andersons-style statement for the loads the test made.
be.ctx.__claude = body => {
  const q = body.messages[0].content.find(c => c.type === 'text').text;
  const outs = be.call({ key: 'k', action: 'officeData' }).tickets.filter(t => t.Direction === 'OUT' && t.Status === 'Closed').slice(0, 3);
  const lines = outs.map((t, i) => ({ page: 2, buyer_ticket: 'R0530' + (91 + i) + '-01', ship_date: new Date(t.DateTime).toISOString().slice(0, 10), vehicle: '1004' + i,
    other_ref: i === 0 ? String(t.BOLNo || t.TicketNo) : i === 1 ? String(t.TicketNo) : '', weight_lb: Number(t.NetLb) - (i === 2 ? 40 : 0), apply_pct: 100,
    net_bu: Math.round((Number(t.NetLb) - (i === 2 ? 40 : 0)) / 56 * 100) / 100, price: 4.8675, test_weight: 60.1, moisture: 14.6 }));
  lines.forEach(l => { l.amount = Math.round(l.net_bu * l.price * 100) / 100; });
  lines.push({ page: 2, buyer_ticket: 'S598999-01', ship_date: '2026-10-01', vehicle: '999', weight_lb: 50000, apply_pct: 100, net_bu: 892.86, price: 4.8675, amount: 4346.00 });
  const gross = Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100, bu = Math.round(lines.reduce((a, l) => a + l.net_bu, 0) * 100) / 100, ded = Math.round(bu) / 100;
  if (body.tools[0].name === 'settlement_header') return { buyer: 'THE ANDERSONS, INC.', statement_no: '246-093971', voucher: '758580', check_no: '070611', check_date: '2026-11-04',
    commodity: 'Yellow Corn', contracts: [{ contract_no: '0090504-01', price: 4.8675 }], total_bushels: bu, gross_amount: gross, deductions: [{ label: 'Kansas Grain Assessment', amount: ded }],
    net_amount: Math.round((gross - ded) * 100) / 100, check_amount: Math.round((gross - ded) * 100) / 100, load_count: lines.length };
  return { lines: /page 2|pages 1 to/.test(q) ? lines : [] };
};
let down = false;
const root = path.join(__dirname, '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((req, res) => {
  if (req.url === '/__down') { down = true; return res.end('down'); }
  if (req.url === '/__up') { down = false; return res.end('up'); }
  if (req.url === '/__sheet') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ tickets: ss.sheets.Tickets.data, splits: ss.sheets.TicketSplits.data, settings: ss.sheets.Settings.data })); }
  if (req.url === '/api') {
    if (down) { req.destroy(); return; }
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      const out = be.ctx.doPost({ postData: { contents: b } }).text;
      res.setHeader('content-type', 'application/json'); res.end(out);
    }); return;
  }
  const f = path.join(root, decodeURIComponent(req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]));
  fs.readFile(f, (e, d) => { if (e) { res.statusCode = 404; return res.end('nf'); } res.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); res.end(d); });
});
srv.listen(8123, () => console.log('listening 8123'));
