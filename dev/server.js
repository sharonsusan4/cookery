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
//
// Test sign-ins for --fake: mom@example.com or me@example.com (allowed),
// stranger@example.com (signs in but isn't allowed), all with the password
// "recipes", at http://localhost:8787/#signin (the plain address shows only
// the guest welcome). Guest mode: open http://localhost:8787/, type any name
// and the pretend family code family-test, and tap Continue as guest. The
// old-style link http://localhost:8787/#join=family-test still works; a bad
// one, e.g. #join=nope, says the link is old and asks for the code. "Change
// code" or "Make a new code" on the Visitors page replaces family-test
// (fakeDb.code() shows it; fakeDb.reset() goes back to family-test).
//
//   node recipe-app/dev/server.js --fake --mine
//
// --mine fills the pretend database with Mom's real recipes instead, built in
// memory from the gitignored files on this computer (dev/fixture.json,
// dev/ingredients-1.txt, -2.txt and dev/ingredients-effort.txt, and
// dev/tags.txt if it's there), so the app can
// be judged with real dishes and real YouTube pictures. Nothing is written to
// disk and nothing goes near Supabase; the page gets it from /__dev/mine.js
// (also readable as /__dev/mine.json) and keeps it under separate localStorage
// keys from the sample data.
//
// Collections: dev/tags.txt (gitignored, optional) has one line per recipe,
// "<id> naadan,onepot" or just "<id> naadan"; "#" starts a comment. A recipe
// without a line is in none. It's read again each time the page loads the
// seed; a saved pretend database takes a recipe's new line from the file the
// next time the page loads, and keeps changes made in the app otherwise.
//
// Her own pictures: a recipe gets the first picture in dev/photos/<id>/
// (gitignored) as its photo_path, "<id>/<file>.jpg", the same value the real
// database has. The pretend Storage's signed links point at
// /__dev/photos/<id>/<file>, served only from that folder and only with --mine.
// The folder is read again each time the page loads the seed, so pictures
// added while the server runs show up after fakeDb.reset() and a reload (or
// in a fresh browser profile; a saved pretend database only gets the photos
// it was missing).

const fs = require('fs');
const http = require('http');
const path = require('path');
const meta = require('../api/meta.js');

const ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(ROOT, 'app');
const PHOTOS_DIR = path.join(__dirname, 'photos');
const TAGS_FILE = path.join(__dirname, 'tags.txt');
const TAG_KEYS = ['naadan', 'onepot']; // COLLECTIONS in app/app.js
const PHOTO_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const PORT = Number(process.env.PORT || 8787);
const MINE = process.argv.includes('--mine');
const FAKE = process.argv.includes('--fake') || MINE; // her data only ever goes to the pretend database

/**
 * Her recipes as fake-supabase.js rows, from the files only this computer has.
 * Recipe id = row number in fixture.json (after the header), as in Supabase.
 */
function mineSeed() {
  const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
  const rows = JSON.parse(read('fixture.json')).slice(1);
  // "<id>[?] item, item, ..." (see make-ingredients.py)
  const ingredients = {};
  for (const name of ['ingredients-1.txt', 'ingredients-2.txt']) {
    for (const line of read(name).split('\n')) {
      const m = !line.startsWith('#') && line.match(/^(\d+)\??\s*(.*)$/);
      if (!m) continue;
      const items = m[2].split(',').map(x => x.trim()).filter(Boolean);
      ingredients[m[1]] = items.length ? items : null;
    }
  }
  // "<id> [quick|gourmet|storage]" (see make-effort.py)
  const effort = {};
  for (const line of read('ingredients-effort.txt').split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue;
    const [id, label] = line.trim().split(/\s+/);
    if (['quick', 'gourmet', 'storage'].includes(label)) effort[id] = label;
  }
  const tags = mineTags().tags;
  return rows.map(([name, category, status, link, source], i) => ({
    id: i + 1, name: name ?? '', category: category ?? '', status: status ?? '', link: link ?? '', source: source ?? '',
    ingredients: ingredients[i + 1] || null, effort: effort[i + 1] || null,
    photo_path: minePhoto(i + 1), tags: tags[i + 1] || [],
  }));
}

/**
 * dev/tags.txt as { tags: { <id>: ['naadan', 'onepot'] }, problems: [...] }.
 * No file (it's optional, and may be half written) is no tags. Words that
 * aren't a collection key are left out and listed in `problems`.
 */
function mineTags() {
  const tags = {}, problems = [];
  let text;
  try { text = fs.readFileSync(TAGS_FILE, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return { tags, problems };
    throw e;
  }
  text.split('\n').forEach((raw, n) => {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) return;
    const m = line.match(/^(\d+)(?:\s+(.*))?$/);
    if (!m) return problems.push(`line ${n + 1}: no recipe id`);
    const words = (m[2] || '').split(/[\s,]+/).map(w => w.toLowerCase()).filter(Boolean);
    for (const w of words) if (!TAG_KEYS.includes(w)) problems.push(`line ${n + 1}: "${w}" isn't naadan or onepot`);
    tags[m[1]] = TAG_KEYS.filter(k => words.includes(k));
  });
  return { tags, problems };
}

/** "<id>/<file>" for the first picture in dev/photos/<id>/, or null. */
function minePhoto(id) {
  let files;
  try { files = fs.readdirSync(path.join(PHOTOS_DIR, String(id))); } catch (e) { return null; }
  const file = files.filter(f => !f.startsWith('.') && PHOTO_TYPES[path.extname(f).toLowerCase()]).sort()[0];
  return file ? `${id}/${file}` : null;
}

/**
 * The file for /__dev/photos/<id>/<file>, or null. Exactly two plain path
 * parts, and it must really be inside dev/photos (no "..", no links out).
 */
function photoFile(pathname) {
  let rest;
  try { rest = decodeURIComponent(pathname.slice('/__dev/photos/'.length)); } catch (e) { return null; }
  const parts = rest.split('/');
  if (parts.length !== 2 || parts.some(p => !p || p.startsWith('.') || /[\\\0]/.test(p))) return null;
  if (!PHOTO_TYPES[path.extname(parts[1]).toLowerCase()]) return null;
  try {
    const root = fs.realpathSync(PHOTOS_DIR);
    const file = fs.realpathSync(path.join(root, ...parts));
    return file.startsWith(root + path.sep) && fs.statSync(file).isFile() ? file : null;
  } catch (e) {
    return null;
  }
}

let mine = null;
if (MINE) {
  try { mine = JSON.stringify(mineSeed()); } catch (e) {
    console.error(`--mine needs Mom's files in dev/ (fixture.json, ingredients-*.txt): ${e.message}`);
    process.exit(1);
  }
}

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
      (MINE ? '<script src="/__dev/mine.js"></script>' : '') + '<script src="/__dev/fake-supabase.js"></script>');
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

  if (mine && (url.pathname === '/__dev/mine.json' || url.pathname === '/__dev/mine.js')) {
    // Built again each time, so photos downloaded since the server started are in.
    try { mine = JSON.stringify(mineSeed()); } catch (e) { /* files mid-edit: keep the last good one */ }
    const js = url.pathname.endsWith('.js');
    res.writeHead(200, { 'Content-Type': TYPES[js ? '.js' : '.json'], 'Cache-Control': 'no-store' });
    return res.end(js ? `window.FAKE_MINE = ${mine};\n` : mine);
  }

  if (mine && url.pathname.startsWith('/__dev/photos/')) {
    const file = photoFile(url.pathname);
    if (!file) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': PHOTO_TYPES[path.extname(file).toLowerCase()], 'Cache-Control': 'private, max-age=600' });
    return fs.createReadStream(file).on('error', () => res.end()).pipe(res);
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
  // With her recipes loaded, only this computer may connect (not the rest of the Wi-Fi).
}).listen(PORT, MINE ? '127.0.0.1' : undefined, () => {
  console.log(`Recipe app running at http://localhost:${PORT}`);
  if (MINE) {
    const rows = JSON.parse(mine);
    console.log(`Pretend database filled with Mom’s ${rows.length} recipes (this computer only), ${rows.filter(r => r.photo_path).length} with a photo from dev/photos/.`);
    const { problems } = mineTags();
    console.log(fs.existsSync(TAGS_FILE)
      ? `Collections from dev/tags.txt: ${rows.filter(r => r.tags.includes('naadan')).length} Naadan, ${rows.filter(r => r.tags.includes('onepot')).length} One pot.`
      : 'No dev/tags.txt yet, so no recipe is in a collection.');
    problems.slice(0, 10).forEach(p => console.log(`  dev/tags.txt ${p}`));
  }
  if (FAKE) {
    console.log(`Pretend database: sign in at http://localhost:${PORT}/#signin as mom@example.com or me@example.com, password "recipes".`);
    console.log('stranger@example.com (same password) can sign in but isn’t on the allowed list.');
    console.log(`Guest mode: http://localhost:${PORT}/ with the family code family-test (or the old link /#join=family-test)`);
  }
});
