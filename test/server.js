// Serves the app and a fake backend (the real Code.gs running on a mock Sheet) for browser tests.
const http = require('http'), fs = require('fs'), path = require('path');
const { loadBackend, testSheet } = require('./mock-gas.js');
const ss = testSheet(); const be = loadBackend(ss, { SHEET_ID: 'x', API_KEY: 'k' });
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
