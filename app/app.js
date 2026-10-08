'use strict';

// ---------- constants ----------

// Same order as the dropdown in her old sheet, with meal times first.
const CATEGORIES = [
  'Breakfast', 'Lunch', 'Dinner', 'Main Course', 'Side Dish', 'Appetizer/Snack',
  'Sweet Snack/Mithai', 'Dessert', 'Bread/Baking', 'Soup', 'Salad',
  'Drink/Beverage', 'Sauce/Condiment', 'Other',
];

const STATUS = {
  toTry: 'To Try',
  loved: 'Tried - Loved',
  okay: 'Tried - Okay',
  skip: 'Tried - Skip Next Time',
  removed: 'Not Interested',
};

const STATUS_OPTIONS = [
  { value: STATUS.toTry, label: 'To try' },
  { value: STATUS.loved, label: 'Loved' },
  { value: STATUS.okay, label: 'Okay' },
  { value: STATUS.skip, label: 'Skip next time' },
];

// What "What should I cook?" looks at for each meal.
const MEALS = {
  Breakfast: ['Breakfast'],
  Lunch: ['Lunch', 'Main Course', 'Side Dish'],
  Snack: ['Appetizer/Snack', 'Sweet Snack/Mithai', 'Drink/Beverage'],
  Dinner: ['Dinner', 'Main Course', 'Side Dish'],
  Sweet: ['Dessert', 'Sweet Snack/Mithai', 'Bread/Baking'],
  Anything: null,
};

// ---------- storage ----------
// localStorage only holds conveniences (cached list, who's signed in, last
// suggestions). The database is the real copy, so losing any of this is
// harmless. supabase-js keeps its own sign-in in localStorage too.

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* storage full or blocked; fine */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  },
};

const state = {
  // Email of whoever signed in on this phone. Remembered separately from
  // supabase-js's own session so the app (and Yo Mom) can open straight away,
  // even offline, before supabase-js has checked the session.
  user: store.get('user', null),
  recipes: store.get('recipes', []),
  loadedAt: 0,
  loading: false,
  extraCategories: store.get('extraCategories', []),
  filters: { q: '', status: 'all', category: '', showRemoved: false },
  meal: null,
  mode: 'new',
  suggestion: null,
  draft: null,
};

// ---------- database ----------
// Recipes live in Supabase (supabase/schema.sql). Each recipe keeps its
// database id in `row`: that used to be the sheet row number, and keeping the
// name means the screens, the welcome tiles and #recipe/<row> links didn't
// have to change. Ids never shift, unlike sheet rows.

const COLUMNS = 'id, name, category, status, link, source, notes, ingredients';
const EDITABLE = ['name', 'category', 'status', 'notes', 'ingredients'];
const PAGE = 1000; // Supabase sends at most 1000 rows per request.

/** False until app/config.js has the real project URL and key. */
function configured() {
  return typeof SUPABASE_URL === 'string' && typeof SUPABASE_ANON_KEY === 'string' &&
    /^https?:\/\/\S+$/.test(SUPABASE_URL) && !/YOUR-/.test(SUPABASE_URL + SUPABASE_ANON_KEY);
}

let client = null;
function db() {
  if (!client) {
    // The library comes from a CDN; if it didn't load she's offline (and the
    // service worker had no copy yet), so treat it like any other lost connection.
    if (!window.supabase) throw new Error('Offline: couldn’t load the database library');
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true, // sign in once; the session is kept and refreshed on this phone
        autoRefreshToken: true,
        detectSessionInUrl: false, // password sign-in only, so leave the #routes alone
      },
    });
    // Fires if the session ends somewhere else (e.g. it was revoked in Supabase).
    client.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') signedOut();
    });
  }
  return client;
}

/** A database row in the shape the screens use. */
function fromDb(d) {
  return {
    row: d.id,
    name: d.name ?? '',
    category: d.category ?? '',
    status: d.status ?? '',
    link: d.link ?? '',
    source: d.source ?? '',
    notes: d.notes ?? '',
    ingredients: Array.isArray(d.ingredients) ? d.ingredients : [],
  };
}

/** Runs a supabase-js query and returns its data, throwing its error instead. */
async function query(request) {
  const { data, error } = await request;
  if (error) throw error;
  return data;
}

function isNetworkError(e) {
  return /fetch|network|load failed|offline/i.test(String((e && (e.message || e.name)) || ''));
}

/**
 * Checks there's a signed-in session before touching recipes. Without one the
 * database quietly returns no rows (that's how the rules hide them), which
 * would look like an empty recipe list, so show the sign-in screen instead.
 */
async function requireSession() {
  const { data, error } = await db().auth.getSession();
  if (data.session) return data.session;
  if (error && (error.name === 'AuthRetryableFetchError' || isNetworkError(error))) throw error;
  signedOut();
  throw new Error('Please sign in again.');
}

async function listRecipes() {
  await requireSession();
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const page = await query(db().from('recipes').select(COLUMNS).order('id').range(from, from + PAGE - 1));
    all.push(...page);
    if (page.length < PAGE) return all.map(fromDb);
  }
}

const clean = v => (v == null ? '' : String(v).trim());

/**
 * Saves a new recipe. Unless `force` is set, a recipe with the same link
 * (by linkKey, so a different-looking link to the same video counts) is
 * returned instead with duplicate: true, and nothing is saved.
 */
async function addRecipe(recipe, force) {
  await requireSession();
  const link = clean(recipe.link);
  const key = linkKey(link);
  if (!force) {
    const same = await query(db().from('recipes').select(COLUMNS).eq('link_key', key).order('id').limit(1));
    if (same.length) return { duplicate: true, recipe: fromDb(same[0]) };
  }
  const row = {
    name: clean(recipe.name),
    category: clean(recipe.category),
    status: Object.values(STATUS).includes(recipe.status) ? recipe.status : STATUS.toTry,
    link,
    link_key: key,
    source: sourceFor(link),
    notes: clean(recipe.notes),
  };
  return { duplicate: false, recipe: fromDb(await query(db().from('recipes').insert(row).select(COLUMNS).single())) };
}

async function loadRecipes({ quiet = false } = {}) {
  if (state.loading || !state.user) return;
  state.loading = true;
  try {
    state.recipes = await listRecipes();
    state.loadedAt = Date.now();
    store.set('recipes', state.recipes);
    render();
  } catch (e) {
    if (!quiet && state.user) toast(offlineMessage(e));
  } finally {
    state.loading = false;
  }
}

function offlineMessage(e) {
  if (isNetworkError(e)) return 'Couldn’t reach your recipes. Check the internet and try again.';
  if (e && (e.code === '42501' || /row-level security|permission denied/i.test(e.message))) {
    return 'This account isn’t allowed to change recipes.';
  }
  return (e && e.message) || 'Something went wrong. Try again.';
}

function replaceRecipe(updated) {
  const i = state.recipes.findIndex(r => r.row === updated.row);
  if (i >= 0) state.recipes[i] = updated;
  else state.recipes.push(updated);
  store.set('recipes', state.recipes);
}

/** Changes some of name / category / status / notes on one recipe. */
async function updateRecipe(recipe, fields) {
  await requireSession();
  const changes = {};
  for (const f of EDITABLE) {
    if (!(f in fields)) continue;
    if (f === 'ingredients') {
      // An empty list is saved as "no ingredients yet", so it can be filled in later.
      const list = (fields[f] || []).map(clean).filter(Boolean);
      changes[f] = list.length ? list : null;
      continue;
    }
    const v = clean(fields[f]);
    if (f === 'status' && !Object.values(STATUS).includes(v)) continue;
    changes[f] = v;
  }
  if (!Object.keys(changes).length) return recipe;
  const rows = await query(db().from('recipes').update(changes).eq('id', recipe.row).select(COLUMNS));
  if (!rows.length) throw new Error('That recipe isn’t in your list any more.');
  const updated = fromDb(rows[0]);
  replaceRecipe(updated);
  return updated;
}

// ---------- signing in ----------

async function signIn(email, password) {
  const { data, error } = await db().auth.signInWithPassword({ email, password });
  if (error) throw error;
  // The password only proves who it is; allowed_users decides whether they get in.
  let allowed = false;
  try {
    allowed = await query(db().rpc('is_allowed'));
  } catch (e) {
    await db().auth.signOut({ scope: 'local' }).catch(() => {});
    throw e;
  }
  if (!allowed) {
    await db().auth.signOut({ scope: 'local' }).catch(() => {});
    throw new Error('not-allowed');
  }
  state.user = data.user.email;
  store.set('user', state.user);
}

function signInMessage(e) {
  if (e.message === 'not-allowed') return 'This email isn’t on the list of people who can use the app.';
  if (e.code === 'invalid_credentials' || /invalid login/i.test(e.message)) return 'That email and password don’t match.';
  if (e.code === 'email_not_confirmed') return 'This account isn’t confirmed yet.';
  if (isNetworkError(e)) return 'Couldn’t reach the server. Check the internet and try again.';
  return e.message || 'Couldn’t sign in. Try again.';
}

async function signOut() {
  // "local" signs out this phone only, not her other devices.
  try { await db().auth.signOut({ scope: 'local' }); } catch (e) { /* offline: forget it here anyway */ }
  signedOut();
}

/** Forget everything about the signed-in person on this phone. Safe to call twice. */
function signedOut() {
  const was = state.user;
  state.user = null;
  state.recipes = [];
  state.loadedAt = 0;
  state.suggestion = null;
  store.remove('user');
  store.remove('recipes');
  store.remove('cooking');
  if (was) render();
}

// ---------- reading her data ----------
// Her recipes came from a hand-typed sheet and were imported exactly as written,
// so read them forgivingly ("To try", "Main course ") without ever rewriting
// what she typed.

function statusOf(r) {
  const k = String(r.status).toLowerCase().replace(/[^a-z]/g, '');
  if (k.startsWith('triedloved')) return STATUS.loved;
  if (k.startsWith('triedokay')) return STATUS.okay;
  if (k.startsWith('triedskip')) return STATUS.skip;
  if (k.startsWith('notinterested')) return STATUS.removed;
  return STATUS.toTry;
}

function categoryOf(r) {
  const c = String(r.category).trim();
  const known = allCategories().find(k => k.toLowerCase() === c.toLowerCase());
  return known || c;
}

/** Rows she marked "ignore" / "repeat - ignore" in the name. */
function isRemoved(r) {
  return statusOf(r) === STATUS.removed || /\bignore\b/i.test(r.name);
}

function allCategories() {
  const seen = new Set(CATEGORIES.map(c => c.toLowerCase()));
  const extra = [];
  for (const c of [...state.extraCategories, ...state.recipes.map(r => String(r.category).trim())]) {
    if (c && !seen.has(c.toLowerCase())) {
      seen.add(c.toLowerCase());
      extra.push(c);
    }
  }
  return [...CATEGORIES, ...extra];
}

function sourceOf(r) {
  return r.source || sourceFor(r.link);
}

function thumbUrl(r) {
  const id = youTubeId(r.link);
  return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : '';
}

function findRecipe(row) {
  return state.recipes.find(r => String(r.row) === String(row));
}

function findByLink(link) {
  const key = linkKey(link);
  return state.recipes.find(r => r.link && linkKey(r.link) === key);
}

// ---------- helpers ----------

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const $ = sel => document.querySelector(sel);
const view = () => $('#view');

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

function displayName(r) {
  return String(r.name).trim() || 'Untitled recipe';
}

function statusLabel(r) {
  if (isRemoved(r)) return 'Removed';
  return STATUS_OPTIONS.find(o => o.value === statusOf(r)).label;
}

function openLabel(r) {
  const s = sourceOf(r);
  return s === 'Other' ? 'Open recipe' : `Open on ${s}`;
}

/** Big picture for YouTube links; nothing for the others (they don't share one). */
function pictureHtml(r) {
  const src = thumbUrl(r);
  return src
    ? `<a class="picture" href="${esc(r.link)}" target="_blank" rel="noopener"><img src="${esc(src)}" alt="" onerror="this.parentNode.remove()"></a>`
    : '';
}

function categoryOptions(selected) {
  const cats = allCategories();
  if (selected && !cats.includes(selected)) cats.push(selected);
  return `<option value="">No category</option>` +
    cats.map(c => `<option${c === selected ? ' selected' : ''}>${esc(c)}</option>`).join('') +
    `<option value="__new">New category…</option>`;
}

function statusOptions(selected) {
  const opts = [...STATUS_OPTIONS];
  if (selected === STATUS.removed) opts.push({ value: STATUS.removed, label: 'Removed' });
  return opts.map(o => `<option value="${esc(o.value)}"${o.value === selected ? ' selected' : ''}>${o.label}</option>`).join('');
}

/** Handles "New category…" in a category dropdown. Returns the chosen value. */
function pickCategory(select, previous) {
  if (select.value !== '__new') return select.value;
  const name = prompt('Name of the new category');
  const c = name ? addCategory(name) : '';
  select.innerHTML = categoryOptions(c || previous);
  return c || previous;
}

function addCategory(name) {
  const c = name.trim();
  if (!c) return '';
  const existing = allCategories().find(k => k.toLowerCase() === c.toLowerCase());
  if (existing) return existing;
  state.extraCategories.push(c);
  store.set('extraCategories', state.extraCategories);
  return c;
}

// ---------- "cooking now" memory ----------

// Wait a while before asking how it went, so it doesn't ask before she's cooked.
const ASK_AFTER_MS = 20 * 60 * 1000;

function startCooking(r) {
  store.set('cooking', { row: r.row, link: r.link, name: displayName(r), at: Date.now() });
  window.open(r.link, '_blank', 'noopener');
}

function cookingHtml(c) {
  if (!c) return '';
  let body;
  if (!c.asked && Date.now() - (c.at || 0) < ASK_AFTER_MS) {
    body = `<p>Enjoy cooking the ${esc(c.name)}. Come back afterwards to say how it was.</p>
      <button class="link-btn" data-action="cook-skip">Not cooking it</button>`;
  } else if (c.asked) {
    body = `<label class="field" for="cook-note">Anything to remember about the ${esc(c.name)}?</label>
      <textarea id="cook-note" placeholder="Use less chilli next time"></textarea>
      <button class="primary block" style="margin-top:12px" data-action="cook-note">Save note</button>
      <button class="link-btn block" data-action="cook-done">No thanks</button>`;
  } else {
    body = `<p class="lead">How was the ${esc(c.name)}?</p>
      <div class="row">
        <button data-cooked="${esc(STATUS.loved)}">Loved</button>
        <button data-cooked="${esc(STATUS.okay)}">Okay</button>
        <button data-cooked="${esc(STATUS.skip)}">Skip</button>
      </div>
      <button class="link-btn" data-action="cook-skip">Didn’t cook it</button>`;
  }
  return `<section class="prompt">${body}</section>`;
}

// ---------- views: Today ----------

function defaultMeal() {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return 'Breakfast';
  if (h >= 11 && h < 15) return 'Lunch';
  if (h >= 15 && h < 18) return 'Snack';
  return 'Dinner';
}

function suggestionPool() {
  const cats = MEALS[state.meal];
  const want = state.mode === 'new' ? STATUS.toTry : STATUS.loved;
  return state.recipes.filter(r =>
    String(r.name).trim() && r.link && !isRemoved(r) &&
    statusOf(r) === want &&
    (!cats || cats.includes(categoryOf(r)))
  );
}

function suggest() {
  const pool = suggestionPool();
  if (!pool.length) {
    state.suggestion = { none: true };
    return;
  }
  const recent = store.get('recentSuggestions', []);
  let choices = pool.filter(r => !recent.includes(linkKey(r.link)));
  if (!choices.length) choices = pool;
  const pick = choices[Math.floor(Math.random() * choices.length)];
  state.suggestion = { row: pick.row };
  store.set('recentSuggestions', [linkKey(pick.link), ...recent].slice(0, 40));
}

function suggestionHtml() {
  const s = state.suggestion;
  if (!s) return '<button class="primary block" style="margin-top:20px" data-action="suggest">Suggest a recipe</button>';
  if (s.none) {
    const what = state.meal === 'Anything' ? 'recipes' : `${state.meal.toLowerCase()} recipes`;
    return `<div class="result">
      <p class="muted">No ${esc(what)} ${state.mode === 'new' ? 'left to try' : 'marked Loved yet'}. Try another meal, or switch to ${state.mode === 'new' ? 'An old favourite' : 'Something new'}.</p>
    </div>`;
  }
  const r = findRecipe(s.row);
  if (!r) return '';
  return `<div class="result" id="result">
    ${pictureHtml(r)}
    <h2><a href="#recipe/${r.row}">${esc(displayName(r))}</a></h2>
    <p class="muted">${esc(categoryOf(r) || 'No category')} · ${esc(sourceOf(r))}</p>
    ${r.notes ? `<p class="muted">Your note: ${esc(r.notes)}</p>` : ''}
    <button class="primary block" style="margin-top:8px" data-action="cook" data-row="${r.row}">Cook this</button>
    <button class="link-btn block" data-action="another">Show another</button>
  </div>`;
}

function renderToday() {
  if (!state.meal) state.meal = defaultMeal();
  view().innerHTML = `
    ${cookingHtml(store.get('cooking', null))}
    <h1>What should I cook?</h1>
    <p class="muted">One idea at a time, from your own recipes.</p>

    <label class="field" for="meal">Meal</label>
    <select id="meal">
      ${Object.keys(MEALS).map(m => `<option${m === state.meal ? ' selected' : ''}>${m}</option>`).join('')}
    </select>

    <div class="segmented" role="group" aria-label="New or favourite" style="margin-top:16px">
      <button data-mode="new" aria-pressed="${state.mode === 'new'}">Something new</button>
      <button data-mode="fav" aria-pressed="${state.mode === 'fav'}">An old favourite</button>
    </div>

    ${suggestionHtml()}
  `;
}

// ---------- views: Recipes ----------

// Each category gets its own soft colour on the recipe squares.
const TINTS = {
  'Breakfast': 'yellow',
  'Lunch': 'green',
  'Dinner': 'blue',
  'Main Course': 'orange',
  'Side Dish': 'olive',
  'Appetizer/Snack': 'plum',
  'Sweet Snack/Mithai': 'pink',
  'Dessert': 'pink',
  'Bread/Baking': 'brown',
  'Soup': 'teal',
  'Salad': 'green',
  'Drink/Beverage': 'teal',
  'Sauce/Condiment': 'red',
};

function tintFor(category) {
  return TINTS[category] || 'gray';
}

// ---------- ingredient search ----------
// She types what she has ("tomato, chicken, cream") and the recipes using the
// most of it come first. Words are compared in a simple form (lowercase,
// singular) and common Malayalam / Hindi names map to the English ones used
// in the ingredient lists, so "tomatoes", "thakkali" and "tomato" all match.

const SAME_AS = {
  thakkali: 'tomato', ulli: 'onion', savala: 'onion', vellulli: 'garlic', inji: 'ginger',
  mulaku: 'chilli', chili: 'chilli', chilly: 'chilli', thenga: 'coconut', thengapaal: 'coconut milk',
  kozhi: 'chicken', meen: 'fish', chemmeen: 'prawn', shrimp: 'prawn', mutta: 'egg',
  kappa: 'tapioca', cassava: 'tapioca', kathirikka: 'brinjal', eggplant: 'brinjal', aubergine: 'brinjal', baingan: 'brinjal',
  aloo: 'potato', gobi: 'cauliflower', palak: 'spinach', methi: 'fenugreek', matar: 'pea', mutter: 'pea',
  maanga: 'mango', manga: 'mango', parippu: 'dal', lentil: 'dal', dahi: 'curd', yogurt: 'curd', yoghurt: 'curd',
  besan: 'gram flour', suji: 'rava', sooji: 'rava', semolina: 'rava', nendran: 'plantain', ethakka: 'plantain',
  cilantro: 'coriander', dhaniya: 'coriander', pudina: 'mint', 'bell pepper': 'capsicum',
};

/** A word in its simple form: lowercase, singular, local name mapped to English. */
function simpleWord(w) {
  w = w.toLowerCase();
  if (SAME_AS[w]) return SAME_AS[w];
  if (w.length > 4 && w.endsWith('oes')) w = w.slice(0, -2); // tomatoes, potatoes
  else if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -2); // chillies
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1); // onions, prawns
  return SAME_AS[w] || w;
}

/** Words of a phrase in their simple form, e.g. "Green Chillies" -> "green chilli". */
function simplePhrase(text) {
  return String(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(simpleWord).join(' ');
}

/** True when every word of `term` appears as whole words in `text`. */
function hasPhrase(text, term) {
  return (' ' + text + ' ').includes(' ' + term + ' ');
}

/**
 * Reads the search box. A list ("tomato, chicken, cream", or "tomato and
 * chicken") is an ingredient search; a single word or a name is a normal search.
 */
function readSearch(q) {
  const parts = q.split(/,|\band\b|&|\+/i).map(simplePhrase).filter(Boolean);
  if (parts.length > 1) return { mode: 'ingredients', terms: [...new Set(parts)] };
  return { mode: 'text', text: parts[0] || '' };
}

/** Which of her search terms a recipe uses (from its ingredients or its name). */
function ingredientMatch(r, terms) {
  const haystack = simplePhrase([...r.ingredients, r.name].join(' , '));
  const have = [], missing = [];
  for (const t of terms) (hasPhrase(haystack, t) ? have : missing).push(t);
  return { have, missing };
}

/**
 * The recipes to show for the current filters and search box, with how well
 * each matches when it's an ingredient search: { mode, terms, items: [{ r, match }] }.
 */
function runSearch() {
  const f = state.filters;
  let search = readSearch(f.q.trim());
  const list = state.recipes.filter(r => {
    if (f.showRemoved !== isRemoved(r)) return false;
    if (!f.showRemoved && f.status !== 'all' && statusOf(r) !== f.status) return false;
    if (f.category && categoryOf(r) !== f.category) return false;
    return true;
  });

  if (search.mode === 'text') {
    const items = list
      .filter(r => !search.text || hasPhrase(simplePhrase(`${r.name} ${r.notes} ${r.category} ${r.ingredients.join(' ')}`), search.text))
      .sort((a, b) => b.row - a.row)
      .map(r => ({ r, match: null }));
    // "tomato chicken cream" with spaces instead of commas: if no name matches
    // the whole phrase, treat each word as something she has.
    const words = search.text.split(' ');
    if (items.length || words.length < 2) return { ...search, items };
    search = { mode: 'ingredients', terms: [...new Set(words)] };
  }
  const items = list
    .map(r => ({ r, match: ingredientMatch(r, search.terms) }))
    .filter(x => x.match.have.length)
    .sort((a, b) => b.match.have.length - a.match.have.length || b.r.row - a.r.row);
  return { ...search, items };
}

/** The line under a recipe square for an ingredient search, e.g. "2 of 3 · no cream". */
function matchLabel({ have, missing }) {
  if (!missing.length) return have.length === 1 ? 'Has it' : have.length === 2 ? 'Has both' : `Has all ${have.length}`;
  return `${have.length} of ${have.length + missing.length} · no ${missing.join(', ')}`;
}

function renderRecipes() {
  const f = state.filters;
  const removedCount = state.recipes.filter(isRemoved).length;
  const counts = {};
  for (const r of state.recipes) if (!isRemoved(r)) counts[categoryOf(r)] = (counts[categoryOf(r)] || 0) + 1;
  const cats = allCategories().filter(c => counts[c]);

  view().innerHTML = `
    <h1>${f.showRemoved ? 'Removed' : 'Recipes'}</h1>
    <p class="muted">${f.showRemoved ? 'Recipes you removed. They’re still saved.' : 'All the recipes you’ve saved.'}</p>

    <form class="search-row" data-search-form>
      <label class="sr-only" for="search">Search</label>
      <input id="search" type="search" enterkeyhint="search" placeholder="Search, or list what you have: tomato, chicken" value="${esc(f.q)}" autocomplete="off">
      <button class="primary" type="submit">Search</button>
    </form>
    ${f.showRemoved ? '' : `
    <div class="row" style="margin-top:10px">
      <label class="sr-only" for="f-status">Status</label>
      <select id="f-status">
        <option value="all">Any status</option>
        ${STATUS_OPTIONS.map(o => `<option value="${esc(o.value)}"${f.status === o.value ? ' selected' : ''}>${o.label}</option>`).join('')}
      </select>
      <label class="sr-only" for="f-category">Category</label>
      <select id="f-category">
        <option value="">Any category</option>
        ${cats.map(c => `<option value="${esc(c)}"${f.category === c ? ' selected' : ''}>${esc(c)} (${counts[c]})</option>`).join('')}
      </select>
    </div>`}

    <p class="muted small" id="count" style="margin-top:14px"></p>
    <div id="list" class="squares"></div>

    ${f.showRemoved
      ? '<button class="link-btn" data-action="hide-removed">Back to recipes</button>'
      : (removedCount ? `<button class="link-btn" data-action="show-removed">Show removed (${removedCount})</button>` : '')}

    ${f.showRemoved ? '' : `<div class="footer-action">
      <button class="link-btn sign-out" data-action="sign-out">Sign out${state.user ? ` (${esc(state.user)})` : ''}</button>
    </div>`}
  `;
  renderList();
}

function renderList() {
  const el = $('#list');
  if (!el) return;
  const search = runSearch();
  const list = search.items;
  $('#count').textContent = `${list.length} recipe${list.length === 1 ? '' : 's'}` +
    (search.mode === 'ingredients' && list.length ? ` using ${search.terms.join(', ')} · best matches first` : '');
  if (!list.length) {
    el.innerHTML = `<p class="muted empty">${state.recipes.length
      ? (search.mode === 'ingredients' ? 'No recipes use any of those.' : 'No recipes match.')
      : (state.loading ? 'Loading your recipes…' : 'No recipes yet.')}</p>`;
    return;
  }
  el.innerHTML = list.map(({ r, match }) => {
    const category = categoryOf(r);
    const status = match ? matchLabel(match)
      : (statusOf(r) === STATUS.toTry && !isRemoved(r) ? '' : statusLabel(r));
    // For an ingredient search, "2 of 3" and "no cream" go on two lines so the missing part isn't cut off.
    const statusHtml = match ? esc(status).replace(' · ', '<br>') : esc(status);
    return `<a class="square tint-${tintFor(category)}${match ? ' matched' : ''}${match && !match.missing.length ? ' full-match' : ''}" href="#recipe/${r.row}">
      <span class="cat">${esc(category || 'No category')}</span>
      <span class="name${String(r.name).trim() ? '' : ' untitled'}">${esc(displayName(r))}</span>
      ${status ? `<span class="status">${statusHtml}</span>` : ''}
    </a>`;
  }).join('');
}

// ---------- views: one recipe ----------

function renderRecipe(row) {
  const r = findRecipe(row);
  if (!r) {
    view().innerHTML = `<h1>Not found</h1>
      <p class="muted">${state.loading ? 'Loading…' : 'That recipe isn’t in your list any more.'}</p>
      <a class="btn block" href="#recipes">Back to recipes</a>`;
    return;
  }
  const status = statusOf(r);
  const category = categoryOf(r);
  view().innerHTML = `
    <button class="link-btn back" data-action="back">← Back</button>
    ${pictureHtml(r)}
    <h1>${esc(displayName(r))}</h1>
    <p class="muted">${esc(category || 'No category')} · ${esc(statusLabel(r))}</p>

    <button class="primary block" data-action="cook" data-row="${r.row}">Cook this</button>
    <a class="btn block" style="margin-top:8px" href="${esc(r.link)}" target="_blank" rel="noopener">${esc(openLabel(r))}</a>

    <h2 class="section">Ingredients</h2>
    ${r.ingredients.length
      ? `<ul class="ingredients">${r.ingredients.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`
      : '<p class="muted">No ingredients yet.</p>'}
    <button class="link-btn" data-action="edit-ingredients">${r.ingredients.length ? 'Edit ingredients' : 'Add ingredients'}</button>
    <div id="r-ingredients-box" hidden>
      <label class="field" for="r-ingredients">Ingredients, one per line</label>
      <textarea id="r-ingredients" placeholder="tomato&#10;chicken&#10;cream">${esc(r.ingredients.join('\n'))}</textarea>
    </div>

    <label class="field" for="r-name">Name</label>
    <input id="r-name" type="text" value="${esc(r.name)}" placeholder="Kappa biryani">

    <label class="field" for="r-status">Status</label>
    <select id="r-status">${statusOptions(status)}</select>

    <label class="field" for="r-category">Category</label>
    <select id="r-category">${categoryOptions(category)}</select>

    <label class="field" for="r-notes">Notes</label>
    <textarea id="r-notes" placeholder="Use less sugar next time">${esc(r.notes)}</textarea>

    <button class="primary block" style="margin-top:20px" data-action="save-recipe" hidden>Save changes</button>

    <div class="footer-action">
      ${!isRemoved(r)
        ? '<button class="link-btn danger-link" data-action="remove">Remove from my recipes</button>'
        : status === STATUS.removed
          ? '<button class="link-btn" data-action="restore">Put back in my recipes</button>'
          : '<p class="muted small">Hidden because the name says “ignore”. Change the name to show it again.</p>'}
    </div>
  `;
  view().dataset.category = category;
}

/** The fields on the recipe screen that differ from what's saved. */
function recipeChanges(r) {
  const fields = {
    name: $('#r-name').value.trim(),
    status: $('#r-status').value,
    category: $('#r-category').value,
    notes: $('#r-notes').value.trim(),
  };
  const now = { name: String(r.name).trim(), status: statusOf(r), category: categoryOf(r), notes: String(r.notes).trim() };
  const changed = {};
  for (const k of Object.keys(fields)) if (fields[k] !== now[k]) changed[k] = fields[k];
  // Ingredients: one per line (commas work too).
  const list = $('#r-ingredients').value.split(/\n|,/).map(x => x.trim()).filter(Boolean);
  if (list.join('\n') !== r.ingredients.join('\n')) changed.ingredients = list;
  return changed;
}

// ---------- views: Add ----------

function newDraft(link = '') {
  return { link, name: '', category: '', status: STATUS.toTry, notes: '', title: '', force: false, error: '' };
}

function renderAdd() {
  if (!state.draft) state.draft = newDraft();
  const d = state.draft;
  const dup = d.link && !d.force ? findByLink(d.link) : null;
  const preview = d.link && !dup ? pictureHtml({ link: d.link }) : '';

  view().innerHTML = `
    <h1>Add a recipe</h1>
    <p class="muted">Paste a link, or share one straight from YouTube, Instagram or Facebook.</p>

    <label class="field" for="a-link">Link</label>
    <input id="a-link" type="url" inputmode="url" value="${esc(d.link)}" placeholder="https://youtube.com/…">
    ${d.error ? `<p class="error">${esc(d.error)}</p>` : ''}
    ${dup ? `<p class="warning">You already saved this as “${esc(displayName(dup))}”.
      <a href="#recipe/${dup.row}">Open it</a> or <button class="inline-link" data-action="save-anyway">save it again</button>.</p>` : ''}
    ${preview ? `<div style="margin-top:12px">${preview}</div>` : ''}

    <label class="field" for="a-name">Name</label>
    <input id="a-name" type="text" value="${esc(d.name)}" placeholder="Kappa biryani" autocomplete="off">
    ${d.title && d.title !== d.name ? `<p class="muted small hint">Video title: ${esc(d.title)}</p>` : ''}

    <label class="field" for="a-category">Category</label>
    <select id="a-category">${categoryOptions(d.category)}</select>

    <label class="field" for="a-status">Status</label>
    <select id="a-status">${statusOptions(d.status)}</select>

    <label class="field" for="a-notes">Notes</label>
    <textarea id="a-notes" placeholder="From the family WhatsApp group">${esc(d.notes)}</textarea>

    <button class="primary block" style="margin-top:20px" data-action="save-new">Save</button>
  `;

  $('#a-link').addEventListener('change', e => setDraftLink(e.target.value));
  $('#a-link').addEventListener('paste', () => setTimeout(() => setDraftLink($('#a-link').value), 0));
}

async function setDraftLink(raw) {
  const d = state.draft;
  const link = findLink(raw) || raw.trim();
  if (link === d.link) return;
  d.link = link;
  d.force = false;
  d.error = '';
  d.title = '';
  // A link shared in while signed out waits behind the sign-in screen.
  const show = () => { if (state.user && location.hash === '#add') renderAdd(); };
  show();
  if (!youTubeId(link)) return;
  try {
    const meta = await fetchTitle(link);
    if (state.draft !== d || d.link !== link) return;
    d.title = meta.title || '';
    if (!d.name.trim()) d.name = nameFromTitle(d.title);
    show();
  } catch (e) { /* no title is fine */ }
}

async function saveNew(btn) {
  const d = state.draft;
  d.link = findLink($('#a-link').value) || $('#a-link').value.trim();
  if (!/^https?:\/\/\S+\.\S+/i.test(d.link)) {
    d.error = d.link ? 'That doesn’t look like a link. Copy it again from the app.' : 'Paste a link first.';
    renderAdd();
    $('#a-link').focus();
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const data = await addRecipe(
      { link: d.link, name: d.name, category: d.category, status: d.status, notes: d.notes },
      d.force,
    );
    replaceRecipe(data.recipe);
    if (data.duplicate) return renderAdd();
    state.draft = null;
    toast('Saved');
    location.hash = `#recipe/${data.recipe.row}`;
  } catch (e) {
    toast(offlineMessage(e));
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

/** YouTube title for a link, via api/meta.js (YouTube doesn't let the browser ask directly). */
async function fetchTitle(link) {
  const res = await fetch('/api/meta?id=' + encodeURIComponent(youTubeId(link)));
  if (!res.ok) throw new Error('No title');
  return res.json();
}

// ---------- views: sign in ----------

function renderSignIn() {
  view().innerHTML = `
    <h1>Sign in</h1>
    <p class="muted">Sign in once and this phone will remember you.</p>
    <form id="sign-in" novalidate>
      <label class="field" for="s-email">Email</label>
      <input id="s-email" type="email" inputmode="email" autocomplete="username" autocapitalize="off" spellcheck="false">
      <label class="field" for="s-password">Password</label>
      <input id="s-password" type="password" autocomplete="current-password">
      <p class="error" id="s-error" hidden></p>
      <button class="primary block" style="margin-top:20px" type="submit">Sign in</button>
    </form>
  `;
}

/** Shown until app/config.js is filled in, so a fresh deploy says what's missing. */
function renderNotConfigured() {
  view().innerHTML = `
    <h1>Almost ready</h1>
    <p class="muted">The app doesn’t know where the recipes are kept yet. Put the Supabase project URL and anon key into <b>app/config.js</b> (the README says where to find them), then deploy again.</p>
  `;
}

// ---------- router ----------

function render() {
  const hash = location.hash || '#today';
  const tab = hash.startsWith('#recipe') ? 'recipes' : hash.slice(1);
  document.querySelectorAll('.tabs a').forEach(a => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  if (!configured() || !state.user) {
    document.body.classList.add('no-tabs');
    if (!configured()) return renderNotConfigured();
    // Leave the form alone if it's already up, so nothing she's typed is lost.
    return $('#sign-in') ? undefined : renderSignIn();
  }
  document.body.classList.remove('no-tabs');

  // Don't wipe out what she's typing when a background refresh lands.
  const active = document.activeElement;
  if (active && view().contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
    if (hash === '#recipes') renderList();
    return;
  }

  if (hash.startsWith('#recipe/')) return renderRecipe(hash.split('/')[1]);
  if (hash === '#recipes') return renderRecipes();
  if (hash === '#add') return renderAdd();
  return renderToday();
}

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
});

// ---------- events ----------

document.addEventListener('input', e => {
  const id = e.target.id;
  if (id === 'search') {
    state.filters.q = e.target.value;
    renderList();
  } else if (id === 'a-name') {
    state.draft.name = e.target.value;
  } else if (id === 'a-notes') {
    state.draft.notes = e.target.value;
  } else if (id === 'r-name' || id === 'r-notes' || id === 'r-ingredients') {
    showRecipeSave();
  }
});

document.addEventListener('change', e => {
  const el = e.target;
  switch (el.id) {
    case 'meal':
      state.meal = el.value;
      if (state.suggestion) suggest();
      return renderToday();
    case 'f-status':
      state.filters.status = el.value;
      return renderList();
    case 'f-category':
      state.filters.category = el.value;
      return renderList();
    case 'a-category':
      state.draft.category = pickCategory(el, state.draft.category);
      return;
    case 'a-status':
      state.draft.status = el.value;
      return;
    case 'r-category':
      view().dataset.category = pickCategory(el, view().dataset.category);
      return showRecipeSave();
    case 'r-status':
      return showRecipeSave();
  }
});

function showRecipeSave() {
  const r = findRecipe(location.hash.split('/')[1]);
  const btn = $('[data-action=save-recipe]');
  if (r && btn) btn.hidden = !Object.keys(recipeChanges(r)).length;
}

document.addEventListener('click', async e => {
  const el = e.target.closest('button');
  if (!el) return;
  const ds = el.dataset;
  const hash = location.hash || '#today';

  // Today
  if (ds.mode) { state.mode = ds.mode; if (state.suggestion) suggest(); return renderToday(); }
  if (ds.action === 'suggest' || ds.action === 'another') {
    suggest();
    renderToday();
    const result = $('#result');
    if (result) result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (ds.action === 'cook') {
    const r = findRecipe(ds.row);
    if (r) startCooking(r);
    if (hash === '#today') renderToday();
    return;
  }
  if (ds.cooked) return saveCooked(el, ds.cooked);
  if (ds.action === 'cook-skip' || ds.action === 'cook-done') { store.remove('cooking'); return renderToday(); }
  if (ds.action === 'cook-note') return saveCookNote(el);

  // Recipes list
  if (ds.action === 'show-removed') { state.filters.showRemoved = true; return renderRecipes(); }
  if (ds.action === 'hide-removed') { state.filters.showRemoved = false; return renderRecipes(); }

  // One recipe
  if (hash.startsWith('#recipe/')) {
    const r = findRecipe(hash.split('/')[1]);
    if (ds.action === 'back') return history.length > 1 ? history.back() : (location.hash = '#recipes');
    if (!r) return;
    if (ds.action === 'save-recipe') return saveRecipe(el, r);
    if (ds.action === 'edit-ingredients') {
      el.hidden = true;
      $('#r-ingredients-box').hidden = false;
      $('#r-ingredients').focus();
      return;
    }
    if (ds.action === 'remove') {
      if (!confirm(`Remove “${displayName(r)}” from your recipes? You can put it back from “Show removed”.`)) return;
      return saveFields(r, { status: STATUS.removed }, 'Removed', '#recipes');
    }
    if (ds.action === 'restore') return saveFields(r, { status: STATUS.toTry }, 'Back in your recipes');
  }

  // Add
  if (hash === '#add') {
    if (ds.action === 'save-anyway') { state.draft.force = true; return renderAdd(); }
    if (ds.action === 'save-new') return saveNew(el);
  }

  if (ds.action === 'sign-out') {
    if (!confirm('Sign out of the recipe app on this phone?')) return;
    return signOut();
  }
});

document.addEventListener('submit', async e => {
  if (e.target.matches('[data-search-form]')) {
    // The list already updates as she types; Search just closes the keyboard.
    e.preventDefault();
    state.filters.q = $('#search').value;
    $('#search').blur();
    renderList();
    return;
  }
  if (e.target.id !== 'sign-in') return;
  e.preventDefault();
  const email = $('#s-email').value.trim();
  const password = $('#s-password').value;
  const err = $('#s-error');
  const btn = e.target.querySelector('button');
  const fail = message => {
    err.textContent = message;
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Sign in';
  };
  if (!email || !password) return fail('Fill in both fields.');
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    await signIn(email, password);
  } catch (ex) {
    return fail(signInMessage(ex));
  }
  // Close the keyboard; render() won't replace a screen while a field has focus.
  if (document.activeElement) document.activeElement.blur();
  // A link shared in before signing in is still waiting on the Add screen.
  if (location.hash !== '#add') history.replaceState(null, '', location.pathname + '#today');
  render();
  loadRecipes();
});

async function saveRecipe(btn, r) {
  const fields = recipeChanges(r);
  if (!Object.keys(fields).length) return;
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    await updateRecipe(r, fields);
    toast('Saved');
    renderRecipe(r.row);
  } catch (e) {
    toast(offlineMessage(e));
    btn.disabled = false;
    btn.textContent = 'Save changes';
  }
}

async function saveFields(r, fields, message, goTo) {
  // Show the change straight away; put it back if the save fails.
  const before = { ...r };
  replaceRecipe({ ...r, ...fields });
  if (goTo) location.hash = goTo;
  else render();
  try {
    await updateRecipe(before, fields);
    toast(message);
  } catch (e) {
    replaceRecipe(before);
    render();
    toast(offlineMessage(e));
  }
}

async function saveCooked(btn, status) {
  const c = store.get('cooking', null);
  if (!c) return;
  const r = findRecipe(c.row) || findByLink(c.link) || { row: c.row, link: c.link };
  btn.disabled = true;
  try {
    await updateRecipe(r, { status });
    store.set('cooking', { ...c, asked: true });
    renderToday();
  } catch (e) {
    btn.disabled = false;
    toast(offlineMessage(e));
  }
}

async function saveCookNote(btn) {
  const c = store.get('cooking', null);
  const note = $('#cook-note').value.trim();
  if (!c || !note) { store.remove('cooking'); return renderToday(); }
  const r = findRecipe(c.row) || findByLink(c.link) || { row: c.row, link: c.link, notes: '' };
  const notes = r.notes ? `${String(r.notes).trim()}\n${note}` : note;
  btn.disabled = true;
  try {
    await updateRecipe(r, { notes });
    store.remove('cooking');
    toast('Note saved');
    renderToday();
  } catch (e) {
    btn.disabled = false;
    toast(offlineMessage(e));
  }
}

// ---------- start ----------

/** Nine of her Loved recipes for the welcome screen, drawn at random each time she opens the app. */
function welcomeTiles() {
  const named = state.recipes.filter(r => String(r.name).trim() && !isRemoved(r));
  const loved = named.filter(r => statusOf(r) === STATUS.loved);
  const pool = [...(loved.length >= 9 ? loved : named)];
  // Shuffle, then take the first nine.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 9).map(r => ({ row: r.row, name: displayName(r), category: categoryOf(r) || 'Recipe', tint: tintFor(categoryOf(r)) }));
}

/** The welcome screen picked a dish: show it as today's suggestion. */
function usePick(tile) {
  const r = tile && findRecipe(tile.row);
  if (r) {
    state.meal = 'Anything';
    state.mode = statusOf(r) === STATUS.loved ? 'fav' : 'new';
    state.suggestion = { row: r.row };
  }
  if (location.hash !== '#today') location.hash = '#today';
  else render();
}

function readShare() {
  // Android share sheet opens …/?title=…&text=…&url=…
  const p = new URLSearchParams(location.search);
  if (!p.has('url') && !p.has('text') && !p.has('title')) return '';
  history.replaceState(null, '', location.pathname);
  return findLink(p.get('url'), p.get('text'), p.get('title'));
}

/**
 * Confirms the sign-in this phone remembers, in the background so the app
 * opens instantly, then fetches fresh recipes.
 */
async function checkSession() {
  try {
    const { data, error } = await db().auth.getSession();
    if (data.session) {
      if (state.user !== data.session.user.email) {
        state.user = data.session.user.email;
        store.set('user', state.user);
        render();
      }
      loadRecipes({ quiet: state.recipes.length > 0 });
    } else if (!error) {
      signedOut();
    }
    // With an error she's most likely offline: keep showing the saved list.
  } catch (e) { /* database library didn't load (offline): keep the saved list */ }
}

function start() {
  const shared = readShare();
  if (shared) {
    state.draft = newDraft();
    history.replaceState(null, '', location.pathname + '#add');
    render();
    setDraftLink(shared);
  } else {
    render();
    // "Yo Mom" each time she opens the app, but not when she's sharing a link in.
    if (configured() && state.user) {
      const tiles = welcomeTiles();
      Welcome.show(tiles, Math.floor(Math.random() * tiles.length), usePick);
    }
  }

  if (configured()) checkSession();
}

// Refresh when she comes back to the app (e.g. after adding a recipe on another device).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && configured() && Date.now() - state.loadedAt > 60000) {
    checkSession();
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
