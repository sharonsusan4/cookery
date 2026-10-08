'use strict';

// ---------- constants ----------

// Same order as the dropdown in her sheet, with meal times first.
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
// localStorage only holds conveniences (cached list, setup, last suggestions).
// The sheet is the real copy, so losing any of this is harmless.

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
  config: store.get('config', null),
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

// ---------- api ----------

async function api(action, params = {}) {
  if (!state.config) throw new Error('Not set up');
  let res;
  if (action === 'list' || action === 'meta') {
    const qs = new URLSearchParams({ action, key: state.config.key, ...params });
    res = await fetch(state.config.url + '?' + qs);
  } else {
    // Plain-text body keeps this a "simple" request that Apps Script accepts.
    res = await fetch(state.config.url, {
      method: 'POST',
      body: JSON.stringify({ action, key: state.config.key, ...params }),
    });
  }
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

async function loadRecipes({ quiet = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  try {
    const data = await api('list');
    state.recipes = data.recipes;
    state.loadedAt = Date.now();
    store.set('recipes', state.recipes);
    render();
  } catch (e) {
    if (!quiet) toast(offlineMessage(e));
  } finally {
    state.loading = false;
  }
}

function offlineMessage(e) {
  if (e && e.message === 'Not allowed') return 'This app isn’t connected to your sheet. Open the setup link again.';
  if (e && e.message && e.message !== 'Failed to fetch') return e.message;
  return 'Couldn’t reach your sheet. Check the internet and try again.';
}

function replaceRecipe(updated) {
  const i = state.recipes.findIndex(r => r.row === updated.row);
  if (i >= 0) state.recipes[i] = updated;
  else state.recipes.push(updated);
  store.set('recipes', state.recipes);
}

async function updateRecipe(recipe, fields) {
  const data = await api('update', { row: recipe.row, link: recipe.link, fields });
  replaceRecipe(data.recipe);
  return data.recipe;
}

// ---------- reading her data ----------
// Her sheet is written by hand, so read it forgivingly ("To try", "Main course ")
// without ever rewriting what she typed.

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

function filteredRecipes() {
  const f = state.filters;
  const q = f.q.trim().toLowerCase();
  return state.recipes
    .filter(r => {
      if (f.showRemoved !== isRemoved(r)) return false;
      if (!f.showRemoved && f.status !== 'all' && statusOf(r) !== f.status) return false;
      if (f.category && categoryOf(r) !== f.category) return false;
      if (q && !`${r.name} ${r.notes} ${r.category}`.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => b.row - a.row);
}

function renderRecipes() {
  const f = state.filters;
  const removedCount = state.recipes.filter(isRemoved).length;
  const counts = {};
  for (const r of state.recipes) if (!isRemoved(r)) counts[categoryOf(r)] = (counts[categoryOf(r)] || 0) + 1;
  const cats = allCategories().filter(c => counts[c]);

  view().innerHTML = `
    <h1>${f.showRemoved ? 'Removed' : 'Recipes'}</h1>
    <p class="muted">${f.showRemoved ? 'Recipes you removed. They’re still in your sheet.' : 'Everything in your recipe sheet.'}</p>

    <label class="sr-only" for="search">Search</label>
    <input id="search" type="search" placeholder="Search names and notes" value="${esc(f.q)}" autocomplete="off">
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
  `;
  renderList();
}

function renderList() {
  const el = $('#list');
  if (!el) return;
  const list = filteredRecipes();
  $('#count').textContent = `${list.length} recipe${list.length === 1 ? '' : 's'}`;
  if (!list.length) {
    el.innerHTML = `<p class="muted empty">${state.recipes.length ? 'No recipes match.' : (state.loading ? 'Loading your recipes…' : 'No recipes yet.')}</p>`;
    return;
  }
  el.innerHTML = list.map(r => {
    const category = categoryOf(r);
    const status = statusOf(r) === STATUS.toTry && !isRemoved(r) ? '' : statusLabel(r);
    return `<a class="square tint-${tintFor(category)}" href="#recipe/${r.row}">
      <span class="cat">${esc(category || 'No category')}</span>
      <span class="name${String(r.name).trim() ? '' : ' untitled'}">${esc(displayName(r))}</span>
      ${status ? `<span class="status">${esc(status)}</span>` : ''}
    </a>`;
  }).join('');
}

// ---------- views: one recipe ----------

function renderRecipe(row) {
  const r = findRecipe(row);
  if (!r) {
    view().innerHTML = `<h1>Not found</h1>
      <p class="muted">${state.loading ? 'Loading…' : 'That recipe isn’t in your sheet any more.'}</p>
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
  renderAdd();
  if (!youTubeId(link)) return;
  try {
    const meta = await api('meta', { url: link });
    if (state.draft !== d || d.link !== link) return;
    d.title = meta.title || '';
    if (!d.name.trim()) d.name = nameFromTitle(d.title);
    if (location.hash === '#add') renderAdd();
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
    const data = await api('add', {
      force: d.force,
      recipe: { link: d.link, name: d.name, category: d.category, status: d.status, notes: d.notes },
    });
    replaceRecipe(data.recipe);
    if (data.duplicate) return renderAdd();
    state.draft = null;
    toast('Saved to your sheet');
    location.hash = `#recipe/${data.recipe.row}`;
  } catch (e) {
    toast(offlineMessage(e));
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

// ---------- views: setup ----------

function renderSetup() {
  view().innerHTML = `
    <h1>Connect your recipe sheet</h1>
    <p class="muted">Open the setup link once on this phone and the app will remember it. Or paste the details below.</p>
    <label class="field" for="s-url">Web app URL</label>
    <input id="s-url" type="url" placeholder="https://script.google.com/macros/s/…/exec">
    <label class="field" for="s-key">App key</label>
    <input id="s-key" type="text" autocomplete="off">
    <p class="error" id="s-error" hidden></p>
    <button class="primary block" style="margin-top:20px" data-action="setup">Connect</button>
  `;
}

async function connect(url, key) {
  const before = state.config;
  state.config = { url, key };
  try {
    const data = await api('list');
    state.recipes = data.recipes;
    state.loadedAt = Date.now();
    store.set('recipes', state.recipes);
    store.set('config', state.config);
  } catch (e) {
    state.config = before;
    throw e;
  }
}

// ---------- router ----------

function render() {
  const hash = location.hash || '#today';
  const tab = hash.startsWith('#recipe') ? 'recipes' : hash.slice(1);
  document.querySelectorAll('.tabs a').forEach(a => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });

  if (!state.config) {
    document.body.classList.add('no-tabs');
    return renderSetup();
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

window.addEventListener('hashchange', async () => {
  if (await useSetupLink()) return;
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
  } else if (id === 'r-name' || id === 'r-notes') {
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
    if (ds.action === 'remove') {
      if (!confirm(`Remove “${displayName(r)}” from your recipes? It stays in your sheet as “Not Interested”.`)) return;
      return saveFields(r, { status: STATUS.removed }, 'Removed', '#recipes');
    }
    if (ds.action === 'restore') return saveFields(r, { status: STATUS.toTry }, 'Back in your recipes');
  }

  // Add
  if (hash === '#add') {
    if (ds.action === 'save-anyway') { state.draft.force = true; return renderAdd(); }
    if (ds.action === 'save-new') return saveNew(el);
  }

  // Setup
  if (ds.action === 'setup') {
    const url = $('#s-url').value.trim();
    const key = $('#s-key').value.trim();
    const err = $('#s-error');
    if (!url || !key) { err.textContent = 'Fill in both fields.'; err.hidden = false; return; }
    el.disabled = true;
    try {
      await connect(url, key);
      location.hash = '#today';
      render();
    } catch (ex) {
      err.textContent = 'Couldn’t connect. Check the URL and key.';
      err.hidden = false;
      el.disabled = false;
    }
  }
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

function readSetupLink() {
  // Setup link: …/#setup=<web app url>&key=<key>. Kept in the # part so it never reaches a server.
  if (!location.hash.startsWith('#setup=')) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  return { url: p.get('setup'), key: p.get('key') };
}

async function useSetupLink() {
  const setup = readSetupLink();
  if (!setup || !setup.url || !setup.key) return false;
  history.replaceState(null, '', location.pathname + '#today');
  try {
    await connect(setup.url, setup.key);
    toast('Connected to your recipe sheet');
  } catch (e) {
    toast('Couldn’t connect with that setup link.');
  }
  render();
  return true;
}

function readShare() {
  // Android share sheet opens …/?title=…&text=…&url=…
  const p = new URLSearchParams(location.search);
  if (!p.has('url') && !p.has('text') && !p.has('title')) return '';
  history.replaceState(null, '', location.pathname);
  return findLink(p.get('url'), p.get('text'), p.get('title'));
}

async function start() {
  await useSetupLink();

  const shared = readShare();
  if (shared) {
    state.draft = newDraft();
    history.replaceState(null, '', location.pathname + '#add');
    render();
    setDraftLink(shared);
  } else {
    render();
    // "Hi Mom" each time she opens the app, but not when she's sharing a link in.
    if (state.config) {
      const tiles = welcomeTiles();
      Welcome.show(tiles, Math.floor(Math.random() * tiles.length), usePick);
    }
  }

  if (state.config && !state.loadedAt) loadRecipes({ quiet: state.recipes.length > 0 });
}

// Refresh when she comes back to the app (e.g. after editing the sheet).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.config && Date.now() - state.loadedAt > 60000) {
    loadRecipes({ quiet: true });
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
