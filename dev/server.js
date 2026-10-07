// Local test server. Serves the app and runs the real apps-script/Code.gs
// against a fake Google Sheet built from dev/fixture.json, so the whole app can
// be tried without touching Mom's sheet. Changes are saved to dev/test-sheet.json.
//
//   node dev/server.js            (then open http://localhost:8787/#setup=...)
//   node dev/server.js --reset    (start again from a fresh copy of the fixture)

const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(ROOT, 'app');
const DATA = path.join(__dirname, 'test-sheet.json');
const PORT = Number(process.env.PORT || 8787);
const KEY = 'dev-key';

if (process.argv.includes('--reset') || !fs.existsSync(DATA)) {
  fs.copyFileSync(path.join(__dirname, 'fixture.json'), DATA);
}

// ---- fake Apps Script services ----

let grid = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const save = () => fs.writeFileSync(DATA, JSON.stringify(grid));
const width = () => grid.reduce((w, r) => Math.max(w, r.length), 0);
const pad = () => grid.forEach(r => { while (r.length < width()) r.push(''); });

const sheet = {
  getLastRow: () => grid.length,
  getLastColumn: () => width(),
  getDataRange: () => sheet.getRange(1, 1, grid.length, width()),
  appendRow: row => { grid.push(row.map(String)); pad(); save(); },
  getRange: (r, c, nr = 1, nc = 1) => ({
    getValues: () => Array.from({ length: nr }, (_, i) =>
      Array.from({ length: nc }, (_, j) => (grid[r - 1 + i] || [])[c - 1 + j] ?? '')),
    getValue: () => (grid[r - 1] || [])[c - 1] ?? '',
    setValue: v => {
      while (grid.length < r) grid.push([]);
      grid[r - 1][c - 1] = String(v);
      pad();
      save();
    },
  }),
};

const context = vm.createContext({
  // One tab, named like the one in "Recepies 2.0.xlsx".
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({ getSheetByName: name => (name === 'Sheet1' ? sheet : null), getSheets: () => [sheet] }),
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => KEY, setProperty: () => {} }) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  Utilities: { getUuid: () => KEY },
  Logger: { log: console.log },
  ContentService: {
    MimeType: { JSON: 'application/json' },
    createTextOutput: text => ({ text, setMimeType() { return this; } }),
  },
  UrlFetchApp: {
    fetch: url => {
      // Real request via curl so YouTube titles work locally too.
      let body = '';
      let code = 500;
      try {
        const out = execFileSync('curl', ['-s', '-m', '8', '-w', '\n%{http_code}', url], { encoding: 'utf8' });
        const i = out.lastIndexOf('\n');
        body = out.slice(0, i);
        code = Number(out.slice(i + 1));
      } catch (e) { /* offline */ }
      return { getResponseCode: () => code, getContentText: () => body };
    },
  },
});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script', 'Code.gs'), 'utf8'), context);
context.setup(); // same one-time step as in the real sheet: adds the Notes column

// ---- http ----

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api') {
    const respond = out => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(out.text);
    };
    if (req.method === 'POST') {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => respond(context.doPost({ postData: { contents: body } })));
    } else {
      respond(context.doGet({ parameter: Object.fromEntries(url.searchParams) }));
    }
    return;
  }

  let file = path.join(APP_DIR, decodeURIComponent(url.pathname));
  if (!file.startsWith(APP_DIR)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`Recipe app running at http://localhost:${PORT}`);
  console.log(`First time, open: http://localhost:${PORT}/#setup=${encodeURIComponent(`http://localhost:${PORT}/api`)}&key=${KEY}`);
});
