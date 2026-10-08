// Local test server. Serves app/ the way Vercel does, including /api/meta
// (the same handler file Vercel runs), so the app can be tried on a computer.
//
//   node recipe-app/dev/server.js          real Supabase, from app/config.js
//   node recipe-app/dev/server.js --fake   pretend database (dev/fake-supabase.js)
//
// --fake swaps supabase-js for a small in-browser stand-in with made-up recipes,
// so everything (sign in, add, edit, repeats) can be tried without a Supabase
// project and without touching Mom's recipes. It keeps its data in the
// browser's localStorage; run fakeDb.reset() in the console to start again.

const fs = require('fs');
const http = require('http');
const path = require('path');
const meta = require('../api/meta.js');

const ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(ROOT, 'app');
const PORT = Number(process.env.PORT || 8787);
const FAKE = process.argv.includes('--fake');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};

/** In --fake mode, point the page at the stand-in instead of the real library and project. */
function fakeify(file, text) {
  const name = path.relative(APP_DIR, file);
  if (name === 'index.html') {
    const out = text.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"]+"[^>]*><\/script>/,
      '<script src="/__dev/fake-supabase.js"></script>');
    if (out === text) throw new Error('Couldn’t find the supabase-js <script> tag in index.html');
    return out;
  }
  if (name === 'config.js') {
    return "const SUPABASE_URL = 'https://fake.supabase.local';\nconst SUPABASE_ANON_KEY = 'fake-anon-key';\n";
  }
  return text;
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/meta') {
    meta(req, res).catch(e => { res.statusCode = 500; res.end(String(e)); });
    return;
  }

  let file = path.join(APP_DIR, decodeURIComponent(url.pathname));
  if (FAKE && url.pathname === '/__dev/fake-supabase.js') file = path.join(__dirname, 'fake-supabase.js');
  else if (!file.startsWith(APP_DIR)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file);
    if (FAKE && (ext === '.html' || ext === '.js')) data = fakeify(file, data.toString('utf8'));
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`Recipe app running at http://localhost:${PORT}`);
  if (FAKE) {
    console.log('Pretend database: sign in as mom@example.com or me@example.com, password "recipes".');
    console.log('stranger@example.com (same password) can sign in but isn’t on the allowed list.');
  }
});
