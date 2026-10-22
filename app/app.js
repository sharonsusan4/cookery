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

// The meals on Today and Yo Mom, in the order Yo Mom goes round them.
// `main` is what a suggestion (and the meal's list) can be. `side` is the
// smaller "On the side" row, so drinks, chutneys and snacks follow the time of
// day too, as she asked. `dishes` is how the meal reads in a sentence
// ("All gourmet lunch dishes", "No quick & easy snacks yet").
const MEALS = {
  Breakfast: { main: ['Breakfast'], side: ['Sauce/Condiment', 'Drink/Beverage'], dishes: 'breakfast dishes' },
  Lunch: { main: ['Lunch', 'Main Course', 'Side Dish'], side: ['Sauce/Condiment', 'Drink/Beverage'], dishes: 'lunch dishes' },
  Snacks: { main: ['Appetizer/Snack', 'Sweet Snack/Mithai'], side: ['Drink/Beverage'], dishes: 'snacks' },
  Dinner: { main: ['Dinner', 'Main Course', 'Side Dish'], side: ['Sauce/Condiment', 'Bread/Baking'], dishes: 'dinner dishes' },
  Desserts: { main: ['Dessert', 'Sweet Snack/Mithai', 'Bread/Baking'], side: ['Drink/Beverage'], dishes: 'desserts' },
  Drinks: { main: ['Drink/Beverage'], side: ['Appetizer/Snack'], dishes: 'drinks' },
};
const MEAL_NAMES = Object.keys(MEALS);

// The shopping list (List tab, "+" on ingredients, "Add ingredients to list"
// on Plan). Mom asked for it to go, so it's switched off; the code and the
// shopping_items table stay, and true brings it all back.
const SHOPPING = false;

// The two kinds of meal she picks between (recipes.effort). Her other labels:
// 'storage' (pickles, pastes, batters: never shown as a meal) and none at all
// (an everyday dish).
const EFFORTS = { quick: 'Quick & easy', gourmet: 'Gourmet' };

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
  admin: store.get('admin', false), // Sharon: the only one who sees Visitors and the family code
  // A family member who came in with the family code (an anonymous
  // sign-in): { id, name }. Null for Mom and Sharon. state.user is then their id.
  guest: store.get('guest', null),
  recipes: store.get('recipes', []),
  loadedAt: 0,
  loading: false,
  extraCategories: store.get('extraCategories', []),
  // The Recipes tab. collection (a COLLECTIONS key) and status are set by the
  // shortcut row, one at a time; '' and 'all' mean everything. category is no
  // longer chosen on screen and stays ''.
  filters: { q: '', status: 'all', category: '', collection: '', showRemoved: false },
  haveOpen: false, // the "What do you have?" chips are open on the Recipes tab
  // Today's meal and Quick & easy / Gourmet. mealSlot is the time-of-day meal
  // when `meal` was set, so it moves on by itself when lunchtime becomes dinner.
  meal: null,
  mealSlot: null,
  effort: 'quick',
  suggestion: null,
  draft: null,
  // Her shopping list (shopping_items), kept here too so the List count shows
  // straight away. The database copy is the one both phones share.
  shopping: store.get('shopping', []),
  // Her meal plan from today on (meal_plan), kept here too so the Plan tab and
  // Today's "On your plan" line show straight away.
  plan: store.get('plan', []),
  planDay: null, // the day the Plan tab is showing ('yyyy-mm-dd'), today when null
  planExtras: false, // she tapped "Add desserts or drinks" on this day
  // The recipe page she's on and the meal she was browsing on Today before it
  // (for "Add to plan"), or meal: null when she came from somewhere else.
  recipeCtx: null,
  lastPlanned: null, // { row, day, meal, entry }: the copy "Add to plan" last put on the plan
  choose: null, // the "Change" chooser on a recipe page: { row, day, meal, entry, pickDay }
  pickQ: '', // what's in the add-dish picker's search box
  fromWelcomeRow: null, // the dish she tapped on the first page, until its page opens
  mealsOpen: null, // the recipe whose "Shows in" meal toggles are open
  editing: null, // the recipe whose Edit form is open; otherwise its page is read-only
  notice: null, // a message shown at the top of the welcome screen instead of its usual words: { title, text }
  joinPending: '', // a family code from a link opened while a guest was signed in
  visitors: null, // the Visitors page: { guests, counts, code, error, changing (the Change code box is open), codeError }
  // The signed-in person's user id (a guest's is also state.user), to know
  // which "I cooked this" posts are theirs.
  uid: store.get('uid', null),
  // Everyone's "I cooked this" posts (the cooked table, migration 012), newest first.
  cooked: store.get('cooked', []),
  cookedWho: 'all', // the Cooked tab: 'all' (everyone's photos) or 'mine' (everything I cooked)
  cookDraft: null, // "I cooked this" being written: { row, blob, url, text, posting }
  likes: store.get('likes', []), // likes on posts (cooked_likes, migration 013): { post, user, name, at }
  // When this person last looked at the likes on their posts (notice_marks,
  // migration 016): likes after it are new (the dot on the round initial).
  likesSeenAt: store.get('likesSeenAt', null),
  // The name the app shows for whoever is signed in (my_name(), migration 013):
  // "Mom", "Sharon", or a guest's own name.
  myName: store.get('myName', ''),
  renaming: false, // the "Change my name" box is open on the You page
  switching: false, // the "Not Mom?" box is open on the You page
};

/** True when a family member is using the app as a guest (came in with the family code). */
const isGuest = () => !!(state.guest && state.guest.id);
const guestId = () => (state.guest ? state.guest.id : null);
/** A recipe this guest added themselves (Mom's have no owner). */
const isMine = r => isGuest() && !!r.owner && r.owner === guestId();
/** Whether the person can change this recipe: Mom and Sharon any family recipe, a guest only their own. */
const canEdit = r => (isGuest() ? isMine(r) : !r.owner);

// ---------- database ----------
// Recipes live in Supabase (supabase/schema.sql). Each recipe keeps its
// database id in `row`: that used to be the sheet row number, and keeping the
// name means the screens, the welcome tiles and #recipe/<row> links didn't
// have to change. Ids never shift, unlike sheet rows.

const COLUMNS = 'id, name, category, status, link, source, notes, ingredients, last_cooked_at, photo_path, effort, meals, tags, owner, steps, steps_source';
// What a guest gets of Mom's recipes: everything but her private notes. Guests
// read them through family_recipes() (migration 011), which has no notes column
// at all, so the notes stay private in the database, not just on screen.
const FAMILY_COLUMNS = COLUMNS.replace(', notes', '');
const familyRecipes = () => db().rpc('family_recipes');
const EDITABLE = ['name', 'category', 'status', 'notes', 'ingredients', 'last_cooked_at', 'photo_path', 'meals', 'tags', 'steps', 'steps_source'];

// The collections she can browse on the Recipes tab (recipes.tags, migration
// 008). A dish can be in either, both or neither. `key` is what's saved.
const COLLECTIONS = [
  { key: 'naadan', name: 'Naadan', heading: 'Naadan dishes', about: 'Kerala home-style', toggle: 'Naadan', icon: 'leaf', tint: 'green' },
  { key: 'onepot', name: 'One pot', heading: 'One pot meals', about: 'Easy, one-pot meals', toggle: 'One pot / bachelor', icon: 'soup', tint: 'yellow' },
];
const collectionOf = key => COLLECTIONS.find(c => c.key === key) || null;

/** Lowercase, no repeats, known collections first in their usual order; unknown keys are kept. */
function tidyTags(list) {
  const keys = [...new Set((Array.isArray(list) ? list : []).map(t => String(t ?? '').trim().toLowerCase()).filter(Boolean))];
  const known = COLLECTIONS.map(c => c.key).filter(k => keys.includes(k));
  return [...known, ...keys.filter(k => !collectionOf(k))];
}
/** A recipe's collection keys (a copy saved on the phone by an older version has none). */
const tagsOf = r => (r && Array.isArray(r.tags) ? r.tags : []);
const inCollection = (r, key) => tagsOf(r).includes(key);
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
    // Same names as the columns, so saveFields can show a change straight away.
    last_cooked_at: d.last_cooked_at || null, // when she last made it, or null
    photo_path: d.photo_path || '', // her own photo in the dish-photos bucket
    effort: d.effort || '', // 'quick', 'gourmet', 'storage', or '' for everyday; not editable yet
    // The meals it shows in, when chosen on its page; null follows the category (mealsOf).
    meals: Array.isArray(d.meals) && d.meals.length ? d.meals : null,
    tags: tidyTags(d.tags), // its collections ('naadan', 'onepot'), or [] for none
    owner: d.owner || null, // null for Mom's recipes; the guest's id for one a guest added
    // The method, one step each (migration 017); 'video' when written from the
    // video's description, 'mom' once she typed or changed it.
    steps: Array.isArray(d.steps) ? d.steps.map(x => String(x || '').trim()).filter(Boolean) : [],
    steps_source: d.steps_source || '',
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

/**
 * Every row of a recipes query, a page at a time. `build` adds the select and
 * filters; `source` is the recipes table, or family_recipes() for a guest.
 */
async function allRows(build, source = () => db().from('recipes')) {
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const page = await query(build(source()).order('id').range(from, from + PAGE - 1));
    all.push(...page);
    if (page.length < PAGE) return all;
  }
}

/**
 * Mom and Sharon get the family's recipes (owner is null), never the ones
 * guests added. A guest gets Mom's (without her notes, and without the ones
 * she removed) and their own.
 */
async function listRecipes() {
  await requireSession();
  if (!isGuest()) return (await allRows(q => q.select(COLUMNS).is('owner', null))).map(fromDb);
  const [family, own] = await Promise.all([
    allRows(q => q.select(FAMILY_COLUMNS), familyRecipes),
    allRows(q => q.select(COLUMNS).eq('owner', guestId())),
  ]);
  return [...family.map(fromDb).filter(r => !isRemoved(r)), ...own.map(fromDb)].sort((a, b) => a.row - b.row);
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
    // Mom and Sharon only look among the family's; a guest among Mom's and their own.
    const first = q => q.eq('link_key', key).order('id').limit(1);
    const [same, own] = await Promise.all([
      query(first(isGuest() ? familyRecipes().select(FAMILY_COLUMNS) : db().from('recipes').select(COLUMNS).is('owner', null))),
      isGuest() ? query(first(db().from('recipes').select(COLUMNS).eq('owner', guestId()))) : [],
    ]);
    const found = same[0] || own[0];
    if (found) return { duplicate: true, recipe: fromDb(found) };
  }
  const row = {
    ...(isGuest() ? { owner: guestId() } : {}),
    name: clean(recipe.name),
    category: clean(recipe.category),
    status: Object.values(STATUS).includes(recipe.status) ? recipe.status : STATUS.toTry,
    link,
    link_key: key,
    source: sourceFor(link),
    notes: clean(recipe.notes),
    ...(tidyTags(recipe.tags).length ? { tags: tidyTags(recipe.tags) } : {}),
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

/** Changes some of the EDITABLE fields on one recipe, sending only those. */
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
    if (f === 'last_cooked_at') {
      const when = fields[f] ? new Date(fields[f]) : null;
      changes[f] = when && !isNaN(when) ? when.toISOString() : null;
      continue;
    }
    if (f === 'photo_path') {
      changes[f] = clean(fields[f]) || null;
      continue;
    }
    if (f === 'tags') {
      // Collection keys; none is saved as null, like meals.
      const list = tidyTags(fields[f]);
      changes[f] = list.length ? list : null;
      continue;
    }
    if (f === 'steps') {
      // One step per item; none is saved as "no method yet".
      const list = (fields[f] || []).map(clean).filter(Boolean);
      changes[f] = list.length ? list : null;
      continue;
    }
    if (f === 'steps_source') {
      changes[f] = clean(fields[f]) || null;
      continue;
    }
    if (f === 'meals') {
      // Meal names in MEAL_NAMES order; none means "follow the category".
      const list = MEAL_NAMES.filter(m => (fields[f] || []).includes(m));
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

// ---------- shopping list ----------
// One row per thing to buy (shopping_items). recipe_id says which dish it was
// for, or is null for things she typed herself ("milk"). It lives in the
// database rather than on the phone so you can see her list on your own phone.

const SHOP_COLUMNS = 'id, item, recipe_id, done, created_at';

function fromShopDb(d) {
  return { id: d.id, item: d.item ?? '', recipe_id: d.recipe_id ?? null, done: !!d.done };
}

// The household's list and plan have no guest_id; a guest's have their id.
// Mom and Sharon could read guests' rows, so they ask for guest_id is null.
const ownRows = q => (isGuest() ? q.eq('guest_id', guestId()) : q.is('guest_id', null));
const ownMark = () => (isGuest() ? { guest_id: guestId() } : {});

function setShopping(items) {
  state.shopping = items;
  store.set('shopping', items.filter(s => s.id > 0)); // never remember half-saved ones
  updateListCount();
}

async function loadShopping({ quiet = true } = {}) {
  if (!SHOPPING || !state.user) return;
  try {
    await requireSession();
    const rows = await query(ownRows(db().from('shopping_items').select(SHOP_COLUMNS)).order('id'));
    // Keep any that are still being saved, so they don't blink out and back.
    setShopping([...rows.map(fromShopDb), ...state.shopping.filter(s => s.id < 0)]);
    refreshShopping();
  } catch (e) {
    if (!quiet && state.user) toast(offlineMessage(e));
  }
}

let tempId = 0;

/** Adds one thing to the list. Shows it straight away and takes it off again if saving fails. */
async function addShopping(item, recipeId) {
  const temp = { id: --tempId, item, recipe_id: recipeId ?? null, done: false };
  setShopping([...state.shopping, temp]);
  try {
    await requireSession();
    const row = fromShopDb(await query(db().from('shopping_items')
      .insert({ item, recipe_id: temp.recipe_id, ...ownMark() }).select(SHOP_COLUMNS).single()));
    if (!state.shopping.includes(temp)) {
      // She took it off again while it was still saving.
      db().from('shopping_items').delete().eq('id', row.id).then(() => {}, () => {});
      return true;
    }
    setShopping(state.shopping.map(s => (s === temp ? row : s)));
    return true;
  } catch (e) {
    setShopping(state.shopping.filter(s => s !== temp));
    toast(offlineMessage(e));
    return false;
  }
}

/** Takes items off the list (deleting list items is fine; recipes never are). */
async function removeShopping(items) {
  const ids = items.map(s => s.id).filter(id => id > 0);
  setShopping(state.shopping.filter(s => !items.includes(s)));
  if (!ids.length) return true;
  try {
    await requireSession();
    await query(db().from('shopping_items').delete().in('id', ids));
    return true;
  } catch (e) {
    setShopping([...state.shopping, ...items].sort((a, b) => a.id - b.id));
    toast(offlineMessage(e));
    return false;
  }
}

async function tickShopping(item) {
  const done = !item.done;
  const swap = to => setShopping(state.shopping.map(s => (s.id === item.id ? to : s)));
  const ticked = { ...item, done };
  swap(ticked);
  try {
    await requireSession();
    await query(db().from('shopping_items').update({ done }).eq('id', item.id).select('id'));
  } catch (e) {
    swap(item);
    toast(offlineMessage(e));
  }
}

/** The undone list item for this ingredient of this dish, if it's on the list. */
function onList(r, ingredient) {
  const key = ingredient.trim().toLowerCase();
  return state.shopping.find(s => !s.done && String(s.recipe_id) === String(r.row) && s.item.trim().toLowerCase() === key);
}

function updateListCount() {
  const tab = document.querySelector('.tabs [data-tab=list]');
  if (tab) tab.hidden = !SHOPPING;
  const el = tab && tab.querySelector('.count');
  if (!el) return;
  const n = state.shopping.filter(s => !s.done).length;
  el.textContent = n;
  el.hidden = !n;
}

// ---------- meal plan ----------
// One row per dish she's planned (meal_plan): a day, a meal and a recipe. Days
// are her own calendar dates ('yyyy-mm-dd' on the phone's clock, which is in
// India), never worked out through UTC, so tonight's dinner never slips to
// yesterday. Rows are never changed, only added and taken off; moving a dish
// is adding it in the new place and taking it off the old one. The same dish
// can be planned more than once, even in the same meal (two lots of chapati):
// each copy is its own row, shown as one line with "×2", and taking one off
// removes just that row, by its id.

const PLAN_COLUMNS = 'id, day, meal, recipe_id';
const PLAN_DAYS = 7; // the day strip: today and the six days after
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ALWAYS_PLANNED = ['Breakfast', 'Lunch', 'Snacks', 'Dinner']; // Desserts and Drinks show once they have dishes

const pad2 = n => String(n).padStart(2, '0');

/** A date's day on the phone's own calendar, 'yyyy-mm-dd'. */
function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 'yyyy-mm-dd' as a local Date at midnight, or null if it isn't a real day. */
function parseDay(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return dayKey(d) === key ? d : null;
}

function addDays(key, n) {
  const d = parseDay(key);
  return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

/** The days on the strip, today first. */
function planDays() {
  const today = dayKey();
  return Array.from({ length: PLAN_DAYS }, (_, i) => addDays(today, i));
}

// Further ahead than the strip: "Pick a date" lets her choose any day from
// today up to a year away.
const PLAN_AHEAD_DAYS = 366;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A day she can plan for: today up to a year ahead. */
function plannable(key) {
  const today = dayKey();
  return !!parseDay(key) && key >= today && key <= addDays(today, PLAN_AHEAD_DAYS);
}

/** "Today", "Tomorrow", "Sat 11", or "Sat 24 Oct" beyond the week. */
function dayShort(key) {
  const i = planDays().indexOf(key);
  if (i === 0) return 'Today';
  if (i === 1) return 'Tomorrow';
  const d = parseDay(key);
  return `${WEEKDAYS[d.getDay()].slice(0, 3)} ${d.getDate()}${i < 0 ? ` ${MONTHS[d.getMonth()]}` : ''}`;
}

/** "today", "tomorrow", "Thursday", or "Sat 24 Oct" beyond the week. */
function dayWord(key) {
  const i = planDays().indexOf(key);
  if (i === 0) return 'today';
  if (i === 1) return 'tomorrow';
  if (i < 0) return dayShort(key);
  return WEEKDAYS[parseDay(key).getDay()];
}

/** "today's lunch", "tomorrow's dinner", "Thursday dinner". */
function mealPhrase(day, meal) {
  const w = dayWord(day);
  return `${w}${w === 'today' || w === 'tomorrow' ? '’s' : ''} ${meal.toLowerCase()}`;
}

const capital = s => s.charAt(0).toUpperCase() + s.slice(1);

/** The day the Plan tab shows: the one she picked, if it's still on the strip. */
function currentPlanDay() {
  if (!plannable(state.planDay)) state.planDay = dayKey();
  return state.planDay;
}

function fromPlanDb(d) {
  return { id: d.id, day: String(d.day).slice(0, 10), meal: d.meal, recipe_id: d.recipe_id };
}

function setPlan(rows) {
  state.plan = rows;
  store.set('plan', rows.filter(p => p.id > 0));
}

/** Planned dishes for a day (and meal), in the order she added them, leaving out any recipe not loaded. */
function plannedFor(day, meal) {
  return state.plan.filter(p => p.day === day && (!meal || p.meal === meal) && findRecipe(p.recipe_id));
}

/** Every planned copy of a dish in one meal, oldest first. */
function planCopies(day, meal, row) {
  return state.plan.filter(p => p.day === day && p.meal === meal && String(p.recipe_id) === String(row));
}

/**
 * Planned rows grouped by dish, in the order each dish was first added:
 * [{ r, copies }]. One line per dish, with "×2" when it's on more than once.
 */
function groupByDish(rows) {
  const groups = new Map();
  for (const p of rows) {
    const k = String(p.recipe_id);
    if (!groups.has(k)) groups.set(k, { r: findRecipe(p.recipe_id), copies: [] });
    groups.get(k).copies.push(p);
  }
  return [...groups.values()].filter(g => g.r);
}

/** " ×2" for a dish planned twice, nothing for once. */
const timesText = n => (n > 1 ? ` ×${n}` : '');

/** A copy as it is now: the saved row once a just-added one has saved, or null if it's gone. */
function currentCopy(entry) {
  let e = entry;
  while (e && e.savedAs) e = e.savedAs;
  return e && state.plan.includes(e) ? e : null;
}

async function loadPlan({ quiet = true } = {}) {
  if (!state.user) return;
  try {
    await requireSession();
    const rows = await query(ownRows(db().from('meal_plan').select(PLAN_COLUMNS)).gte('day', dayKey()).order('id'));
    setPlan([...rows.map(fromPlanDb), ...state.plan.filter(p => p.id < 0)]);
    planChanged();
  } catch (e) {
    if (!quiet && state.user) toast(offlineMessage(e));
  }
}

/**
 * Puts one more of a dish on the plan, even if it's already there. Shows it
 * straight away and takes it off again if saving fails. Returns the new copy
 * (follow it with currentCopy once it saves) and `done`, true once it's saved.
 */
function planOneMore(day, meal, row) {
  const temp = { id: --tempId, day, meal, recipe_id: row };
  setPlan([...state.plan, temp]);
  planChanged();
  const done = (async () => {
    try {
      await requireSession();
      let saved;
      try {
        saved = fromPlanDb(await query(db().from('meal_plan')
          .insert({ day, meal, recipe_id: row, ...ownMark() }).select(PLAN_COLUMNS).single()));
      } catch (e) {
        // The database still has the old once-per-meal rule (007_plan_repeats.sql not run yet).
        if (e && e.code === '23505') {
          setPlan(state.plan.filter(p => p !== temp));
          planChanged();
          toast('It’s already on that meal');
          loadPlan();
          return false;
        }
        throw e;
      }
      temp.savedAs = saved;
      if (!state.plan.includes(temp)) {
        // She took it off again while it was still saving (a reload may have brought it in).
        setPlan(state.plan.filter(p => p.id !== saved.id));
        planChanged();
        db().from('meal_plan').delete().eq('id', saved.id).then(() => {}, () => {});
        return true;
      }
      // A reload while it was saving may already have brought the saved row in.
      setPlan(state.plan.filter(p => p === temp || p.id !== saved.id).map(p => (p === temp ? saved : p)));
      planChanged();
      return true;
    } catch (e) {
      setPlan(state.plan.filter(p => p !== temp));
      planChanged();
      toast(offlineMessage(e));
      return false;
    }
  })();
  return { entry: temp, done };
}

function addPlan(day, meal, row) {
  return planOneMore(day, meal, row).done;
}

/** Takes one copy of a dish off the plan: that row only, by its id. */
async function removePlan(entry) {
  setPlan(state.plan.filter(p => p !== entry));
  planChanged();
  if (entry.id < 0) return true; // addPlan deletes it once it's saved
  try {
    await requireSession();
    await query(db().from('meal_plan').delete().eq('id', entry.id));
    return true;
  } catch (e) {
    setPlan([...state.plan, entry].sort((a, b) => a.id - b.id));
    planChanged();
    toast(offlineMessage(e));
    return false;
  }
}

/**
 * Moves one planned copy to another day or meal: added there first, then that
 * copy taken off here. Returns the new copy and `done`, like planOneMore.
 */
function movePlan(entry, day, meal) {
  const added = planOneMore(day, meal, entry.recipe_id);
  const done = (async () => {
    if (!(await added.done)) return false;
    const now = currentCopy(entry); // the saved copy, if it was still saving
    return now ? removePlan(now) : true;
  })();
  return { entry: added.entry, done };
}

/** Redraws whatever on screen shows the plan, without losing her place. */
function planChanged() {
  if (!state.user) return;
  const hash = location.hash || '#today';
  if (hash === '#today') {
    const box = $('#today-plan');
    if (box) box.innerHTML = todayPlanHtml();
  } else if (hash.startsWith('#plan')) {
    if ($('#plan-search')) refreshPickerTiles();
    else if ($('.plan')) refreshPlan();
  } else if (hash.startsWith('#recipe/')) {
    const r = findRecipe(hash.split('/')[1]);
    const box = $('#r-plan');
    if (r && box) box.innerHTML = recipePlanHtml(r);
  }
}

// ---------- her photos ----------
// Photos she takes go in the private "dish-photos" bucket, so they can only be
// shown through signed links that run out. Links are asked for in batches for
// whatever is on screen and kept in memory until they're about to expire.
// Pictures never hold up the screen: they're filled in when their link arrives.

const PHOTO_BUCKET = 'dish-photos';
const PHOTO_URL_SECONDS = 60 * 60; // an hour: a forwarded photo link soon stops working
const PHOTO_MAX = 1080; // longest side, in pixels: plenty for a phone screen
const photoUrls = new Map(); // path -> { url, until }
const photoMissing = new Map(); // path -> time to stop skipping it
const photoAsking = new Set();

function photoUrl(path) {
  const hit = path && photoUrls.get(path);
  if (hit && hit.until > Date.now()) return hit.url;
  if (hit) photoUrls.delete(path);
  return '';
}

/** An <img> for one of her photos, filled in by loadPhotos() when it isn't cached yet. */
function photoImg(path, cls) {
  const url = photoUrl(path);
  return `<img class="${cls}" data-photo="${esc(path)}"${url ? ` src="${esc(url)}"` : ''} alt="" loading="lazy" decoding="async">`;
}

/** Fills in every photo on screen (the big one on a recipe) that's still waiting for its link. */
let photosQueued = false;
function loadPhotos() {
  if (photosQueued) return;
  photosQueued = true;
  // After the current render has finished, so one batch covers the whole screen.
  setTimeout(async () => {
    photosQueued = false;
    const imgs = [...document.querySelectorAll('img[data-photo]:not([src])')];
    const now = Date.now();
    const want = [...new Set(imgs.map(i => i.dataset.photo))]
      .filter(p => !photoUrl(p) && !photoAsking.has(p) && !((photoMissing.get(p) || 0) > now));
    const unasked = new Set(); // couldn't even ask (offline or signed out)
    for (let i = 0; i < want.length; i += 100) {
      const batch = want.slice(i, i + 100);
      batch.forEach(p => photoAsking.add(p));
      try {
        const { data, error } = await db().storage.from(PHOTO_BUCKET).createSignedUrls(batch, PHOTO_URL_SECONDS);
        if (error) throw error;
        // Refresh a little before the link actually stops working.
        const until = Date.now() + (PHOTO_URL_SECONDS - 600) * 1000;
        for (const d of data || []) {
          if (d.signedUrl) photoUrls.set(d.path, { url: d.signedUrl, until });
          else if (d.path) photoMissing.set(d.path, Date.now() + 5 * 60 * 1000);
        }
      } catch (e) {
        // Offline or signed out: treated as a picture that didn't load, tried again in a while.
        batch.forEach(p => unasked.add(p));
      } finally {
        batch.forEach(p => photoAsking.delete(p));
      }
    }
    const later = Date.now();
    for (const img of document.querySelectorAll('img[data-photo]:not([src])')) {
      const path = img.dataset.photo;
      const url = photoUrl(path);
      if (url) img.src = url;
      else if ((photoMissing.get(path) || 0) > later || unasked.has(path)) picFailed(img);
    }
  }, 0);
}

// A photo that won't load most likely has an expired link: get a new one, once.
document.addEventListener('error', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.photo) return;
  photoUrls.delete(img.dataset.photo);
  img.removeAttribute('src');
  if (img.dataset.retried) return picFailed(img);
  img.dataset.retried = '1';
  loadPhotos();
}, true);

/** Makes a phone photo small enough to upload quickly: at most 1080px, as a JPEG. */
async function shrinkPhoto(file) {
  let img;
  try {
    // from-image turns it the right way up, as the camera held it.
    img = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('unreadable'));
      el.src = URL.createObjectURL(file);
    });
  }
  const w = img.width, h = img.height;
  if (!w || !h) throw new Error('unreadable');
  const scale = Math.min(1, PHOTO_MAX / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // JPEG has no see-through parts
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  if (img.close) img.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  if (!blob) throw new Error('unreadable');
  return blob;
}

/** Uploads a new photo for a recipe, then removes the one it replaces. */
async function savePhoto(r, file, btn) {
  btn.disabled = true;
  btn.textContent = 'Saving photo…';
  let path = '';
  try {
    await requireSession();
    let blob;
    try { blob = await shrinkPhoto(file); } catch (e) { throw new Error('Couldn’t read that photo. Try another one.'); }
    path = `${r.row}/${Date.now()}.jpg`;
    const bucket = db().storage.from(PHOTO_BUCKET);
    const up = await bucket.upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
    if (up.error) throw up.error;
    const old = r.photo_path;
    let updated;
    try {
      updated = await updateRecipe(r, { photo_path: path });
    } catch (e) {
      bucket.remove([path]).catch(() => {}); // don't leave a photo nothing points to
      throw e;
    }
    // Show it from the phone's own copy; no need to download what was just taken.
    photoUrls.set(path, { url: URL.createObjectURL(blob), until: Infinity });
    if (old && old !== path) bucket.remove([old]).catch(() => {});
    toast('Photo saved');
    if (location.hash === `#recipe/${r.row}`) refreshRecipeTop(updated);
  } catch (e) {
    toast(offlineMessage(e));
    btn.disabled = false;
    btn.textContent = r.photo_path ? 'Change photo' : 'Add my photo';
  }
}

// ---------- "I cooked this" and the Cooked tab ----------
// Anyone in the app (Mom, Sharon, guests) can say they cooked one of Mom's
// recipes, with a comment, a photo, both or neither (the cooked table,
// migration 012). The database fills in their name and the time. A recipe's
// page lists what people said; the Cooked tab shows everyone's photos, or
// everything I cooked ("Mine"); tapping a photo opens it large (#photo/<id>)
// with "Go to recipe". For Mom and Sharon a post also marks the dish as made
// today, in place of the old "I made this today".

const COOKED_COLUMNS = 'id, recipe_id, user_id, name, member, comment, photo_path, created_at';

function fromCookedDb(d) {
  return {
    id: d.id,
    row: d.recipe_id,
    user: d.user_id || null,
    name: String(d.name || '').trim(),
    member: !!d.member,
    comment: String(d.comment || '').trim(),
    photo: d.photo_path || '',
    at: d.created_at,
  };
}

/** Everyone's posts, newest first (the last 500, far more than the family will make). */
async function loadCooked() {
  if (!state.user) return;
  try {
    await requireSession();
    const [rows, likes, marks] = await Promise.all([
      query(db().from('cooked').select(COOKED_COLUMNS).order('created_at', { ascending: false }).limit(500)),
      // Before migration 013 there are no likes yet: the posts still show.
      query(db().from('cooked_likes').select('post_id, user_id, name, created_at').limit(5000)).catch(() => null),
      // Before migration 016 there's no record of what was seen: nothing shows as new.
      query(db().from('notice_marks').select('likes_seen_at').limit(1)).catch(() => null),
    ]);
    const deleting = pendingPostDelete && pendingPostDelete.post.id;
    state.cooked = rows.map(fromCookedDb).filter(p => p.id !== deleting);
    store.set('cooked', state.cooked);
    if (likes) {
      state.likes = likes.map(l => ({ post: l.post_id, user: l.user_id, name: String(l.name || '').trim(), at: l.created_at || null }));
      store.set('likes', state.likes);
    }
    if (marks) {
      // Never looked yet: everything so far counts as seen, so nobody starts with a pile of old likes.
      state.likesSeenAt = marks[0] ? marks[0].likes_seen_at : (state.likesSeenAt || new Date(0).toISOString());
      if (!marks[0] && !store.get('likesSeenAt', null)) markLikesSeen();
      store.set('likesSeenAt', state.likesSeenAt);
    }
    refreshMeButtons();
    const hash = location.hash || '#today';
    if (hash === '#cooked' || hash.startsWith('#photo/') || hash === '#me') render();
    else if (hash.startsWith('#recipe/')) refreshCookedSection();
  } catch (e) { /* offline, or before migration 012: keep what this phone has */ }
}

/** The posts on one recipe (its page shows all of them, however many others there are). */
async function loadRecipePosts(row) {
  if (!state.user || !row) return;
  try {
    const rows = await query(db().from('cooked').select(COOKED_COLUMNS).eq('recipe_id', row).order('created_at', { ascending: false }).limit(200));
    const deleting = pendingPostDelete && pendingPostDelete.post.id;
    const have = new Set(state.cooked.map(p => p.id));
    const fresh = rows.map(fromCookedDb).filter(p => !have.has(p.id) && p.id !== deleting);
    if (!fresh.length) return;
    state.cooked = [...state.cooked, ...fresh].sort((a, b) => String(b.at).localeCompare(String(a.at)));
    if (location.hash === `#recipe/${row}`) refreshCookedSection();
  } catch (e) { /* offline: what this phone has */ }
}

/** Who the app says is signed in ("Mom", "Sharon", a guest's name), from my_name(). */
async function loadMyName() {
  if (!state.user) return;
  try {
    const name = String((await query(db().rpc('my_name'))) || '').trim();
    if (!name || name === state.myName) return;
    state.myName = name;
    store.set('myName', name);
    const hash = location.hash || '#today';
    if (hash === '#today' || hash === '#me' || hash === '#cooked' || hash.startsWith('#cook/')) render();
  } catch (e) { /* offline, or before migration 013: keep what this phone knew */ }
}

/** The signed-in account's name: "Mom", "Sharon", or a guest's own. */
function myDisplayName() {
  return state.myName || (isGuest() ? String(state.guest.name || '').trim() : '') || 'You';
}



/** The round initial at the top of Today and Cooked that opens the You page. */
function meButtonHtml() {
  const name = myDisplayName();
  const initial = name === 'You' ? '' : [...name][0].toUpperCase();
  const news = newLikeCount();
  return `<a class="me-btn${news ? ' has-news' : ''}" href="#me" aria-label="You: ${esc(name)}${news ? `, ${news} new like${news === 1 ? '' : 's'}` : ''}">${initial ? esc(initial) : iconSvg('chef-hat')}</a>`;
}

// ---- likes ----

const likesOf = id => state.likes.filter(l => String(l.post) === String(id));
const iLike = id => likesOf(id).some(l => l.user && l.user === (state.uid || guestId()));

/** "Liked by Mom", "Liked by Mom and you", "Liked by Mom, Anu and 2 others". */
function likedByText(id) {
  const me = state.uid || guestId();
  const names = likesOf(id).map(l => (l.user === me ? 'you' : l.name || 'someone'));
  if (!names.length) return '';
  names.sort((a, b) => (a === 'you') - (b === 'you')); // "you" last reads best
  if (names.length <= 2) return `Liked by ${names.join(' and ')}`;
  const rest = names.length - 2;
  return `Liked by ${names.slice(0, 2).join(', ')} and ${rest} other${rest === 1 ? '' : 's'}`;
}

function likeHtml(p) {
  const n = likesOf(p.id).length, mine = iLike(p.id);
  return `<div class="like-row" data-like-row="${p.id}">
    <button type="button" class="like-btn" data-like="${p.id}" aria-pressed="${mine}" aria-label="${mine ? 'Liked' : 'Like'}${n ? `, ${n} like${n === 1 ? '' : 's'}` : ''}">${iconSvg('heart')}${n ? `<span>${n}</span>` : ''}</button>
    ${n ? `<span class="liked-by">${esc(likedByText(p.id))}</span>` : ''}
  </div>`;
}

/** Tap the heart: liked at once on screen, then saved; put back if it can't be. */
async function toggleLike(id) {
  const me = state.uid || guestId();
  const post = findPost(id);
  if (!post || !me) return;
  const was = iLike(id);
  const before = state.likes;
  state.likes = was ? state.likes.filter(l => !(String(l.post) === String(id) && l.user === me))
    : [...state.likes, { post: post.id, user: me, name: myDisplayName() }];
  redrawLikes(id);
  try {
    await requireSession();
    if (was) await query(db().from('cooked_likes').delete().eq('post_id', post.id).eq('user_id', me));
    else {
      const { error } = await db().from('cooked_likes').insert({ post_id: post.id });
      if (error && error.code !== '23505') throw error; // already liked on another phone: fine
    }
    store.set('likes', state.likes);
  } catch (e) {
    state.likes = before;
    redrawLikes(id);
    toast(e && (e.code === '42P01' || e.code === 'PGRST205') ? 'Likes aren’t switched on yet. Ask Sharon.' : offlineMessage(e));
  }
}

// ---- like notices ----

/** Likes by other people on my posts, newest first; `fresh` = since I last looked. */
function likesOnMine() {
  const me = state.uid || guestId();
  if (!me) return [];
  return state.likes
    .map(l => ({ ...l, post: findPost(l.post) }))
    .filter(l => l.post && myPost(l.post) && l.user !== me)
    .map(l => ({ ...l, fresh: !!(l.at && state.likesSeenAt && l.at > state.likesSeenAt) }))
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}
const newLikeCount = () => likesOnMine().filter(l => l.fresh).length;

/** The round initial, with its dot, wherever it's on screen. */
function refreshMeButtons() {
  document.querySelectorAll('.me-btn').forEach(el => { el.outerHTML = meButtonHtml(); });
}

/** Opening the You page: the likes shown there are seen (on every phone). */
async function markLikesSeen() {
  const now = new Date().toISOString();
  state.likesSeenAt = now;
  store.set('likesSeenAt', now);
  try {
    await requireSession();
    const seen = await query(db().rpc('mark_likes_seen'));
    if (seen) { state.likesSeenAt = seen; store.set('likesSeenAt', seen); }
  } catch (e) { /* offline, or before migration 016: this phone remembers */ }
}

/** "Likes on your posts" on the You page: the newest ten, new ones marked. */
function likesNoticeHtml(list) {
  if (!list.length) return '';
  const fresh = list.filter(l => l.fresh).length;
  return `<section class="me-section me-likes">
    <h2 class="section">Likes on your posts${fresh ? ` <span class="count">${fresh} new</span>` : ''}</h2>
    <ul class="notices">${list.slice(0, 10).map(l => {
      const r = findRecipe(l.post.row);
      const dish = r ? displayName(r) : 'a dish';
      const href = l.post.photo ? `#photo/${l.post.id}` : r ? `#recipe/${r.row}` : '#cooked';
      return `<li><a class="notice${l.fresh ? ' fresh' : ''}" href="${href}">
        <span class="notice-icon" aria-hidden="true">${iconSvg('heart')}</span>
        <span class="notice-text"><b>${esc(l.name || 'Someone')}</b> liked your ${esc(dish)}<span class="notice-when">${esc(l.at ? timeAgo(l.at) : '')}</span></span>
        ${l.fresh ? '<span class="sr-only">New</span>' : ''}
      </a></li>`;
    }).join('')}</ul>
  </section>`;
}

function redrawLikes(id) {
  const p = findPost(id);
  document.querySelectorAll(`[data-like-row="${id}"]`).forEach(el => { if (p) el.outerHTML = likeHtml(p); });
}

const findPost = id => state.cooked.find(p => String(p.id) === String(id)) || null;
const myPost = p => !!p.user && p.user === (state.uid || guestId());
const canDeletePost = p => myPost(p) || (state.admin && !isGuest());
/** Posts with something to show (a comment or a photo); a bare "I cooked this" only counts as made. */
const shownPost = p => !!(p.comment || p.photo);
/** Only Mom's recipes have posts, never a guest's own. */
const cookable = r => !!r && !r.owner;

/** "today", "yesterday", "3 days ago", "last week", "2 months ago". */
function agoText(iso) {
  const then = new Date(iso);
  if (isNaN(then)) return '';
  const day = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const d = Math.max(0, Math.round((day(new Date()) - day(then)) / 86400000));
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  if (d < 14) return 'last week';
  if (d < 60) return `${Math.floor(d / 7)} weeks ago`;
  if (d < 365) return `${Math.max(2, Math.floor(d / 30))} months ago`;
  const years = Math.floor(d / 365);
  return years === 1 ? 'a year ago' : `${years} years ago`;
}

const posterName = p => p.name || 'Someone';

/** "Cooked it" on a recipe page: the button, then what people said, newest first. */
function cookedSectionHtml(r) {
  if (!cookable(r)) return '';
  const posts = state.cooked.filter(p => String(p.row) === String(r.row) && shownPost(p));
  const people = new Set(posts.map(p => p.user || p.name)).size;
  return `
    <div class="cooked-head"><h2 class="section">Cooked it</h2>${people ? `<span class="muted">${people} ${people === 1 ? 'person' : 'people'}</span>` : ''}</div>
    <a class="btn block cook-btn" href="#cook/${r.row}">${iconSvg('camera')}I cooked this</a>
    ${posts.length ? `<ul class="posts">${posts.map(postHtml).join('')}</ul>`
      : '<p class="muted small cooked-empty">Made this? Tap above to say how it turned out, and add a photo if you like.</p>'}`;
}

function postHtml(p) {
  return `<li class="post">
    <p class="post-by"><b class="${p.member ? 'member' : ''}">${esc(posterName(p))}</b> ${esc(agoText(p.at))}</p>
    ${p.comment ? `<p class="say">${esc(p.comment)}</p>` : ''}
    ${p.photo ? `<a class="post-photo" href="#photo/${p.id}" aria-label="Open the photo">${photoImg(p.photo, '')}</a>` : ''}
    <div class="post-foot">
      ${likeHtml(p)}
      ${canDeletePost(p) ? `<button type="button" class="link-btn post-delete" data-action="delete-post" data-post="${p.id}">Delete</button>` : ''}
    </div>
  </li>`;
}

/** Redraws the recipe page's "Cooked it" part only (new posts arrived, one was deleted). */
function refreshCookedSection() {
  const box = $('#r-cooked');
  const r = findRecipe(location.hash.split('/')[1]);
  if (!box || !r) return;
  box.innerHTML = cookedSectionHtml(r);
  loadPhotos();
}

// ---- "I cooked this" (#cook/<row>) ----

function renderCook(row) {
  const r = findRecipe(row);
  if (!cookable(r)) {
    view().innerHTML = `${backHtml()}<h1>Not found</h1><p class="muted">${state.loading ? 'Loading…' : 'That recipe isn’t in the list any more.'}</p>`;
    return;
  }
  if (!state.cookDraft || String(state.cookDraft.row) !== String(r.row)) state.cookDraft = { row: String(r.row), blob: null, url: '', text: '', posting: false };
  const d = state.cookDraft;
  view().innerHTML = `
    ${backHtml()}
    <p class="meal-kicker">${esc(displayName(r))}</p>
    <h1 class="cook-title">I cooked this</h1>
    <div class="add-photo">
      ${d.url
        ? `<img class="cook-preview" src="${esc(d.url)}" alt="Your photo">
           <div class="cook-photo-links">
             <button type="button" class="link-btn" data-action="cook-photo">Change photo</button>
             <button type="button" class="link-btn quiet-link" data-action="cook-photo-out">Take out photo</button>
           </div>`
        : `<button type="button" class="btn block add-photo-btn" data-action="cook-photo">${iconSvg('camera')}Add a photo</button>`}
      <input id="cook-file" type="file" accept="image/*" hidden>
    </div>
    <label class="field" for="cook-say">How did it turn out?</label>
    <textarea id="cook-say" class="say" maxlength="1000" rows="3" placeholder="You can leave this empty">${esc(d.text)}</textarea>
    <button type="button" class="btn primary block cook-post" data-action="cook-post"${d.posting ? ' disabled' : ''}>${d.posting ? 'Posting…' : 'Post'}</button>
    <div id="cook-who">${cookWhoHtml()}</div>`;
}

/**
 * "Posting as Mom". On Mom's or Sharon's account, "Not Mom?" opens the You
 * page's switch: someone else using that account on their own phone makes the
 * phone their own in one tap.
 */
function cookWhoHtml() {
  const member = !isGuest();
  return `<p class="muted who-sees">Posting as <b>${esc(myDisplayName())}</b>${member ? ` · <button type="button" class="inline-link" data-action="not-me">Not ${esc(myDisplayName())}?</button>` : ''}.
    Everyone who uses the app can see it.${member ? ' It also marks the dish as made today.' : ''}</p>`;
}

async function pickCookPhoto(file) {
  const d = state.cookDraft;
  if (!d || !file) return;
  let blob;
  try { blob = await shrinkPhoto(file); } catch (e) { return toast('Couldn’t read that photo. Try another one.'); }
  if (d.url) URL.revokeObjectURL(d.url);
  d.blob = blob;
  d.url = URL.createObjectURL(blob);
  if (location.hash === `#cook/${d.row}`) renderCook(d.row);
}

function dropCookPhoto() {
  const d = state.cookDraft;
  if (!d) return;
  if (d.url) URL.revokeObjectURL(d.url);
  d.blob = null;
  d.url = '';
  renderCook(d.row);
}

async function postCooked() {
  const d = state.cookDraft;
  const r = d && findRecipe(d.row);
  if (!d || d.posting || !cookable(r)) return;
  d.text = ($('#cook-say') || {}).value ?? d.text;
  d.posting = true;
  renderCook(d.row);
  const bucket = db().storage.from(PHOTO_BUCKET);
  let path = '';
  try {
    const session = await requireSession();
    const uid = session.user.id;
    setUid(uid);
    if (d.blob) {
      path = `cooked/${uid}/${Date.now()}.jpg`;
      const up = await bucket.upload(path, d.blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
      if (up.error) throw up.error;
    }
    let saved;
    try {
      saved = fromCookedDb(await query(db().from('cooked')
        .insert({ recipe_id: r.row, comment: d.text.trim().slice(0, 1000), photo_path: path || null })
        .select(COOKED_COLUMNS).single()));
    } catch (e) {
      if (path) bucket.remove([path]).catch(() => {}); // don't leave a photo nothing points to
      throw e;
    }
    // Show it from the phone's own copy; no need to download what was just taken.
    if (path) photoUrls.set(path, { url: URL.createObjectURL(d.blob), until: Infinity });
    state.cooked = [saved, ...state.cooked.filter(p => p.id !== saved.id)];
    store.set('cooked', state.cooked);
    if (d.url) URL.revokeObjectURL(d.url);
    state.cookDraft = null;
    // Mom and Sharon: it's made today, as "I made this today" used to say.
    if (!isGuest()) {
      const now = new Date().toISOString();
      updateRecipe(r, { last_cooked_at: now }).catch(() => {});
      replaceRecipe({ ...r, last_cooked_at: now });
    }
    toast(shownPost(saved) ? 'Posted' : 'Marked as made today');
    if (location.hash === `#cook/${r.row}`) goBack();
  } catch (e) {
    d.posting = false;
    if (location.hash === `#cook/${d.row}`) renderCook(d.row);
    toast(cookedMessage(e));
  }
}

function cookedMessage(e) {
  if (e && (e.code === '42P01' || e.code === 'PGRST205' || /cooked/i.test(e.message || '') && /does not exist|schema cache/i.test(e.message || ''))) {
    return 'Posting isn’t switched on yet. Ask Sharon.';
  }
  return offlineMessage(e);
}

// ---- the Cooked tab (#cooked) ----

function renderCookedTab() {
  const mine = state.cookedWho === 'mine';
  const posts = mine ? state.cooked.filter(myPost) : state.cooked.filter(p => p.photo);
  view().innerHTML = `
    <div class="tab-head"><h1>Cooked</h1>${meButtonHtml()}</div>
    <p class="muted">${mine ? 'Everything you said you cooked' : 'What everyone made from these recipes'}</p>
    <div class="segmented cooked-who" role="group" aria-label="Whose">
      <button type="button" data-cooked-who="all" aria-pressed="${!mine}">Everyone</button>
      <button type="button" data-cooked-who="mine" aria-pressed="${mine}">Mine</button>
    </div>
    ${posts.length ? `<div class="wall">${posts.map(wallItemHtml).join('')}</div>`
      : `<p class="muted cooked-none">${mine
        ? 'Nothing yet. When you cook a dish from the app, open it and tap <b>I cooked this</b>. It’ll show here.'
        : 'No photos yet. When you cook something from the app, open it, tap <b>I cooked this</b> and add a photo.'}</p>`}`;
  loadPhotos();
}

function wallItemHtml(p) {
  const r = findRecipe(p.row);
  const dish = r ? displayName(r) : 'A recipe';
  const by = state.cookedWho === 'mine' ? agoText(p.at) : `${posterName(p)} · ${agoText(p.at)}`;
  // Mine also lists dishes posted without a photo: their tile, and a tap opens the recipe.
  const pic = p.photo ? `<span class="wall-pic">${photoImg(p.photo, '')}</span>`
    : `<span class="wall-pic wall-tile tint-${r ? tileTint(r) : 'gray'}">${iconSvg(r ? iconFor(r) : 'bowl')}</span>`;
  const href = p.photo ? `#photo/${p.id}` : r ? `#recipe/${r.row}` : '#cooked';
  return `<a class="wall-item" href="${href}">${pic}<span class="dish">${esc(dish)}</span><span class="by">${esc(by)}</span></a>`;
}

// ---- one photo, large (#photo/<id>) ----

function renderPhoto(id) {
  const p = findPost(id);
  if (!p || !p.photo) {
    view().innerHTML = `${backHtml()}<h1>Not found</h1><p class="muted">That photo isn’t here any more.</p>`;
    return;
  }
  const r = findRecipe(p.row);
  view().innerHTML = `
    <div class="viewer" role="dialog" aria-label="Photo">
      <div class="viewer-top"><button type="button" class="viewer-close" data-action="back" aria-label="Close">${iconSvg('x')}</button></div>
      <div class="viewer-photo">${photoImg(p.photo, '')}</div>
      <h2>${esc(r ? displayName(r) : 'A recipe')}</h2>
      <p class="by">${esc(posterName(p))} · ${esc(agoText(p.at))}</p>
      ${p.comment ? `<p class="say">${esc(p.comment)}</p>` : ''}
      ${likeHtml(p)}
      ${r ? `<button type="button" class="btn primary block" data-action="go-recipe" data-row="${r.row}">Go to recipe</button>` : ''}
      ${canDeletePost(p) ? `<button type="button" class="link-btn block viewer-delete" data-action="delete-post" data-post="${p.id}">Delete</button>` : ''}
    </div>`;
  loadPhotos();
}

/**
 * "Go to recipe": back to it when that's where she came from, otherwise it
 * opens in place of the photo, so Back from the recipe goes to the wall.
 */
function goToRecipe(row) {
  const behind = nav.idx > 0 ? nav.hashes[nav.idx - 1] : '';
  if (behind === `#recipe/${row}`) return history.back();
  navReplace(`#recipe/${row}`);
}

// ---- deleting a post ----
// Like removing a guest: it goes from the screen at once, with Undo in the
// message; the database (and the photo) only hear about it once the message
// has gone, or the app is put away. Not when the screen changes: deleting
// from a photo opened large goes back to the wall, and Undo must still work.
let pendingPostDelete = null; // { post, timer }

function deletePostSoon(id) {
  const post = findPost(id);
  if (!post || !canDeletePost(post)) return;
  flushPostDelete();
  state.cooked = state.cooked.filter(p => p !== post);
  const timer = setTimeout(flushPostDelete, 6000);
  pendingPostDelete = { post, timer };
  if (location.hash === `#photo/${post.id}`) goBack();
  else redrawCooked();
  toast('Deleted', {
    label: 'Undo',
    run: () => {
      if (!pendingPostDelete || pendingPostDelete.post !== post) return;
      clearTimeout(timer);
      pendingPostDelete = null;
      putBackPost(post);
    },
  });
}

function putBackPost(post) {
  if (state.cooked.some(p => p.id === post.id)) return;
  state.cooked = [...state.cooked, post].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  redrawCooked();
}

function redrawCooked() {
  const hash = location.hash || '#today';
  if (hash === '#cooked') renderCookedTab();
  else if (hash.startsWith('#recipe/')) refreshCookedSection();
}

async function flushPostDelete() {
  const p = pendingPostDelete;
  if (!p) return;
  pendingPostDelete = null;
  clearTimeout(p.timer);
  try {
    await requireSession();
    await query(db().from('cooked').delete().eq('id', p.post.id));
    store.set('cooked', state.cooked);
    if (p.post.photo) db().storage.from(PHOTO_BUCKET).remove([p.post.photo]).catch(() => {});
  } catch (e) {
    putBackPost(p.post);
    toast(offlineMessage(e));
  }
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
  setMember(data.user.email);
  setUid(data.user.id);
}

function setUid(id) {
  if (state.uid === id) return;
  state.uid = id || null;
  store.set('uid', state.uid);
}

function setMember(email) {
  state.user = email;
  state.guest = null;
  state.notice = null;
  store.set('user', state.user);
  store.remove('guest');
  refreshAdmin();
}

/**
 * Asks the database whether the signed-in person is Sharon (allowed_users.admin).
 * Only she sees Visitors and the family code; Mom doesn't. Offline, or before
 * migration 010, the phone keeps what it last knew.
 */
async function refreshAdmin() {
  if (!state.user || isGuest()) return;
  try {
    const admin = !!(await query(db().rpc('is_admin')));
    if (admin === state.admin) return;
    state.admin = admin;
    store.set('admin', admin);
    state.visitors = null; // what the page may show has changed
    if (location.hash === '#today' || location.hash === '' || location.hash === '#me') render();
  } catch (e) { /* keep what this phone knew */ }
}

function setGuest(id, name) {
  state.user = id;
  state.guest = { id, name: name || '' };
  state.notice = null;
  store.set('user', state.user);
  store.set('guest', state.guest);
}

// ---------- guest mode ----------
// Family members open the plain address, type their name and the secret
// family code, and come in as a Supabase anonymous user: no email, no
// password. join_family() checks the code and puts them on the guest list
// (supabase/migrations/005 and 009). The sign-in stays on their phone like
// anyone else's. Old family links (…/#join=<code>) still work: the code comes
// from the link and they only type their name.

const GUEST_ENDED = { title: 'Welcome back', text: 'Guest mode has ended on this phone. Ask Sharon for the family code.' };
const WRONG_CODE = 'That family code isn’t right. Ask Sharon for it.';
const OLD_LINK = 'This family link is old. Ask Sharon for the family code.';
const CODE_MIN = 6, CODE_MAX = 40; // what set_family_code() accepts (009_family_code.sql)

/** The family code in a #join=<code> link, or ''. */
function joinCodeFrom(hash) {
  const m = /^#join=([\w-]{1,64})$/.exec(String(hash || ''));
  return m ? m[1] : '';
}

/** A family code the way the database compares it: lowercase, no spaces at the ends, single spaces inside. */
const cleanCode = code => String(code || '').toLowerCase().replace(/\s+/g, ' ').trim();

let joining = false; // checkSession waits while a join is half done
let touched = false; // touch_guest() once per app open

/** Signs in as a new anonymous user and joins with the code. Throws Error('wrong-code') for a bad code. */
async function joinFamily(code, name) {
  joining = true;
  try {
    const { data, error } = await db().auth.signInAnonymously();
    if (error) throw error;
    let ok = false;
    try {
      ok = await query(db().rpc('join_family', { code: cleanCode(code), name }));
    } catch (e) {
      await db().auth.signOut({ scope: 'local' }).catch(() => {});
      throw e;
    }
    if (!ok) {
      await db().auth.signOut({ scope: 'local' }).catch(() => {});
      throw new Error('wrong-code');
    }
    setGuest(data.user.id, name);
    setUid(data.user.id);
    touched = true; // joining counts as this open's visit
  } finally {
    joining = false;
  }
}

function joinMessage(e) {
  const text = `${e.code || ''} ${e.message || ''}`;
  // Anonymous sign-ins switched off, or blocked by "Allow new users to sign up" being off.
  if ((/anonymous/i.test(text) && /disabled|not enabled/i.test(text)) || /signups? not allowed|signup_disabled/i.test(text)) {
    return 'Guest mode isn’t switched on yet. Ask Sharon.';
  }
  if (/from this phone/i.test(text)) return 'Too many wrong codes from this phone. Try again in an hour.';
  if (e.status === 429 || /rate limit|too many/i.test(text)) return 'Too many people tried just now. Wait a few minutes and try again.';
  if (isNetworkError(e)) return 'Couldn’t reach the server. Check the internet and try again.';
  return e.message || 'Couldn’t let you in. Try again.';
}

/**
 * The guest isn't on the list any more (Sharon removed them): forget them on
 * this phone and say so on the welcome screen. With a family link waiting,
 * go straight to its welcome instead.
 */
async function guestEnded() {
  const code = state.joinPending;
  state.joinPending = '';
  try { await db().auth.signOut({ scope: 'local' }); } catch (e) { /* offline: forget it here anyway */ }
  state.notice = code ? null : GUEST_ENDED; // before signedOut(), which draws the welcome
  signedOut();
  history.replaceState({ idx: nav.idx }, '', location.pathname + (code ? `#join=${code}` : '#today'));
  nav.hashes[nav.idx] = location.hash;
  render();
}

/** "Leave guest mode": their plan, list and recipes go, then they're signed out. */
async function leaveGuest() {
  if (!confirm('Leave guest mode? Your meal plan and any recipes you added on this phone will be gone. What you posted on Cooked stays.')) return;
  const id = guestId();
  try {
    await requireSession();
    // Once signed out there's no way back to these, so tidy them away first.
    await Promise.all([
      query(db().from('meal_plan').delete().eq('guest_id', id)),
      query(db().from('shopping_items').delete().eq('guest_id', id)),
    ]);
    await query(db().from('recipes').delete().eq('owner', id));
    await query(db().rpc('leave_guest')).catch(() => {}); // off the guest list (014)
  } catch (e) { /* offline: nobody else can see them anyway */ }
  await signOut();
  toast('You’ve left guest mode');
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
  // The first page may still be up (signed in, never tapped through).
  const welcome = document.querySelector('.welcome-overlay');
  if (welcome) { welcome.remove(); document.body.classList.remove('welcome-open'); }
  const was = state.user;
  state.user = null;
  state.guest = null;
  state.admin = false;
  store.remove('admin');
  state.visitors = null;
  state.mealsOpen = null;
  state.recipes = [];
  state.loadedAt = 0;
  state.suggestion = null;
  state.shopping = [];
  state.plan = [];
  state.lastPlanned = null;
  state.choose = null;
  state.uid = null;
  state.myName = '';
  state.switching = false;
  state.renaming = false;
  state.likes = [];
  store.remove('myName');
  store.remove('likes');
  state.likesSeenAt = null;
  store.remove('likesSeenAt');
  state.cooked = [];
  state.cookedWho = 'all';
  state.cookDraft = null;
  pendingPostDelete = null;
  photoUrls.clear();
  store.remove('uid');
  store.remove('cooked');
  store.remove('user');
  store.remove('guest');
  store.remove('recipes');
  store.remove('shopping');
  store.remove('plan');
  store.remove('cooking');
  store.remove('recentSuggestions');
  store.remove('extraCategories');
  state.extraCategories = [];
  state.draft = null;
  state.removing = null;
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

/**
 * A picture that couldn’t load. Pictures are only on a recipe’s own page
 * (and the Add screen's preview), so the big picture is simply taken away.
 */
function picFailed(img) {
  if (!img.isConnected) return; // from a screen that's already gone
  const big = img.closest('.picture');
  if (big) big.remove();
  else img.remove();
}

// A YouTube thumbnail for a video that's gone still "loads": it's YouTube's
// 120×90 grey placeholder. Real ones are at least 320 wide.
document.addEventListener('load', e => {
  const img = e.target;
  if (img instanceof HTMLImageElement && img.hasAttribute('data-thumb') && img.naturalWidth <= 120) picFailed(img);
}, true);
document.addEventListener('error', e => {
  const img = e.target;
  if (img instanceof HTMLImageElement && img.hasAttribute('data-thumb')) picFailed(img);
}, true);

function findRecipe(row) {
  return state.recipes.find(r => String(r.row) === String(row));
}

function findByLink(link) {
  const key = linkKey(link);
  return state.recipes.find(r => r.link && linkKey(r.link) === key);
}

// ---------- last made ----------

// Suggestions leave out what she made in the last two weeks.
const RECENT_DAYS = 14;

/** Whole days since she last made it, by the calendar (made last night = 1), or null. */
function daysSinceMade(r) {
  if (!r.last_cooked_at) return null;
  const then = new Date(r.last_cooked_at);
  if (isNaN(then)) return null;
  const day = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.max(0, Math.round((day(new Date()) - day(then)) / 86400000));
}

function recentlyMade(r) {
  const days = daysSinceMade(r);
  return days != null && days < RECENT_DAYS;
}

/** Leaves out what she made recently, unless that would leave nothing. */
function notRecent(list) {
  const fresh = list.filter(r => !recentlyMade(r));
  return fresh.length ? fresh : list;
}

/** "Made today", "Last made 5 days ago", "Last made 2 months ago"; '' when never made. */
function madeText(r) {
  const d = daysSinceMade(r);
  if (d == null) return '';
  if (d === 0) return 'Made today';
  if (d === 1) return 'Made yesterday';
  const ago = (n, unit) => `Last made ${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (d < 14) return ago(d, 'day');
  if (d < 60) return ago(Math.floor(d / 7), 'week');
  if (d < 365) return ago(Math.floor(d / 30), 'month');
  const years = Math.floor(d / 365);
  return years === 1 ? 'Last made a year ago' : ago(years, 'year');
}

// ---------- helpers ----------

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const $ = sel => document.querySelector(sel);
const view = () => $('#view');

let toastTimer;
/**
 * A short message at the bottom. With `action` ({ label, run }) it ends in a
 * quiet link ("Removed Fish curry · Undo") and stays a little longer.
 */
function toast(msg, action) {
  const t = $('#toast');
  t.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-action';
    b.textContent = action.label;
    b.addEventListener('click', () => {
      t.hidden = true;
      clearTimeout(toastTimer);
      action.run();
    });
    t.append(document.createTextNode(' · '), b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 6000 : 3200);
}

/**
 * "‹ Back" at the top left of every screen that isn't a tab. `action` is what
 * it does; plain "back" goes back the way she came (see goBack).
 */
function backHtml(action = 'back') {
  return `<button type="button" class="back-btn" data-action="${action}">
    <svg class="back-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7"/></svg>Back</button>`;
}

/** A recipe's link for an href: only web addresses, never javascript: or the like. */
function webLink(url) {
  const u = String(url || '').trim();
  return /^https?:\/\//i.test(u) ? u : '#';
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

/**
 * Big picture: her own photo when she's added one, otherwise the YouTube
 * thumbnail, otherwise nothing (Instagram and Facebook don't share one).
 */
function pictureHtml(r) {
  if (r.photo_path) {
    return `<a class="picture photo" href="${esc(webLink(r.link))}" target="_blank" rel="noopener">${photoImg(r.photo_path, '')}</a>`;
  }
  const src = thumbUrl(r);
  return src
    ? `<a class="picture" href="${esc(webLink(r.link))}" target="_blank" rel="noopener"><img src="${esc(src)}" data-thumb alt=""></a>`
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

// ---------- views: Today ----------
// One meal at a time: a single idea for it, then every dish of that kind,
// then a few things to have with it. The meal follows the clock unless she
// picks another, and the first page (Yo Mom) sets it and Quick & easy / Gourmet.

/** The meal for a time of day. Drinks never come from the clock, only from the dropdown. */
function mealAt(when = new Date()) {
  const h = when.getHours();
  if (h >= 5 && h < 11) return 'Breakfast';
  if (h >= 11 && h < 15) return 'Lunch';
  if (h >= 15 && h < 18) return 'Snacks';
  if (h >= 18 && h < 22) return 'Dinner';
  return 'Desserts';
}

/** Her label, read forgivingly like the other columns: 'quick', 'gourmet', 'storage' or ''. */
function effortOf(r) {
  return String(r.effort || '').trim().toLowerCase();
}

/**
 * What Today and Yo Mom may show at all: named, not removed, and not a
 * storage idea (those are only for the Recipes tab).
 */
function mealRecipes() {
  return state.recipes.filter(r => String(r.name).trim() && !isRemoved(r) && effortOf(r) !== 'storage');
}

/**
 * A meal's main dishes, newest first. With an effort, only that kind: Gourmet
 * is only what she labelled gourmet, while Quick & easy also takes her
 * everyday dishes (no label), which are about half of them.
 */
function mainDishes(meal, effort) {
  const kind = r => effortOf(r) || 'quick';
  return mealRecipes()
    .filter(r => placeIn(r, meal) === 'main' && (!effort || kind(r) === effort))
    .sort((a, b) => b.row - a.row);
}

// ---------- which meals a dish shows in ----------
// Normally its category decides (MEALS): a Main Course is a Lunch and Dinner
// dish, a drink is in Drinks and on the side of most meals. On a recipe's page
// she can choose the meals herself ("Shows in: Lunch · Change"), kept in
// recipes.meals. Whether it's a main dish or "On the side" for a meal still
// follows the category; a meal its category has nothing to do with takes it
// as a main dish.

/** The meals a category belongs to, as a main dish or on the side. */
function categoryMeals(category) {
  return MEAL_NAMES.filter(m => MEALS[m].main.includes(category) || MEALS[m].side.includes(category));
}

/** True when the meals were chosen on the recipe's page rather than by its category. */
function mealsChosen(r) {
  return Array.isArray(r.meals) && MEAL_NAMES.some(m => r.meals.includes(m));
}

/** The meals a dish shows in, in MEAL_NAMES order. */
function mealsOf(r, category = categoryOf(r)) {
  return mealsChosen(r) ? MEAL_NAMES.filter(m => r.meals.includes(m)) : categoryMeals(category);
}

/** How a dish shows in a meal: 'main', 'side', or '' when it doesn't. */
function placeIn(r, meal) {
  const category = categoryOf(r);
  if (!mealsOf(r, category).includes(meal)) return '';
  return MEALS[meal].side.includes(category) ? 'side' : 'main';
}

/** A number from a string that stays the same all day, for an order that changes daily, not on every redraw. */
function dailyNumber(text) {
  let h = 2166136261;
  for (const c of `${new Date().toDateString()} ${text}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Up to nine things to have with the meal (any kind but storage): Loved first, then a different few each day. */
function sideDishes(meal) {
  const rank = r => (recentlyMade(r) ? 2 : 0) + (statusOf(r) === STATUS.loved ? 0 : 1);
  return mealRecipes()
    .filter(r => placeIn(r, meal) === 'side')
    .map(r => ({ r, rank: rank(r), n: dailyNumber(`${meal} ${r.row}`) }))
    .sort((a, b) => a.rank - b.rank || a.n - b.n)
    .slice(0, 9)
    .map(x => x.r);
}

// How likely each is to be suggested: Loved a little more than the rest.
// "Skip next time" is never suggested (it still shows in the list).
const SUGGEST_WEIGHT = { [STATUS.loved]: 3, [STATUS.toTry]: 2, [STATUS.okay]: 1 };

/** What the idea can be: the meal's dishes with a link, except "Skip next time". */
function suggestionPool() {
  return mainDishes(state.meal, state.effort).filter(r => r.link && SUGGEST_WEIGHT[statusOf(r)]);
}

function weightedPick(list) {
  const total = list.reduce((sum, r) => sum + SUGGEST_WEIGHT[statusOf(r)], 0);
  let x = Math.random() * total;
  for (const r of list) {
    x -= SUGGEST_WEIGHT[statusOf(r)];
    if (x < 0) return r;
  }
  return list[list.length - 1];
}

/** Picks one idea for the meal, different from the one showing. */
function suggest() {
  const pool = suggestionPool();
  const showing = state.suggestion && state.suggestion.row;
  state.suggestion = { meal: state.meal, effort: state.effort };
  if (!pool.length) {
    state.suggestion.none = true;
    return;
  }
  const recent = store.get('recentSuggestions', []);
  // Nothing she made in the last two weeks (unless that's all there is), and
  // not the same ideas over and over.
  const fresh = notRecent(pool).filter(r => r.row !== showing);
  let choices = fresh.filter(r => !recent.includes(linkKey(r.link)));
  if (!choices.length) choices = fresh;
  // She asked for another, so something made lately beats the same one again.
  if (!choices.length) choices = pool.filter(r => r.row !== showing);
  if (!choices.length) choices = pool;
  const pick = weightedPick(choices);
  state.suggestion.row = pick.row;
  store.set('recentSuggestions', [linkKey(pick.link), ...recent].slice(0, 40));
}

/**
 * Keeps the idea she's looking at through redraws, and picks a new one when
 * the meal or Quick & easy / Gourmet changed, or her recipes have just arrived.
 */
function ensureSuggestion() {
  const s = state.suggestion;
  const pool = suggestionPool();
  const stale = !s || s.meal !== state.meal || s.effort !== state.effort ||
    (s.none ? pool.length > 0 : !pool.some(r => r.row === s.row));
  if (stale) suggest();
}

/**
 * The one idea: a soft tinted panel with the dish's icon and its name, then
 * Open recipe / Show another. The panel opens the dish's page (where her
 * photo or the video's picture is); Open recipe opens the video.
 */
function suggestionHtml() {
  const s = state.suggestion;
  const r = s && !s.none && findRecipe(s.row);
  if (!r) return `<p class="muted">Nothing to suggest right now.</p>`;
  // A guest sees "Mom loved this" on her recipes, never when she last made one.
  const family = isGuest() && !isMine(r);
  const about = [
    isMine(r) ? 'Yours' : '',
    statusOf(r) === STATUS.loved ? (family ? 'Mom loved this' : 'Loved') : '',
    family ? '' : madeText(r),
    sourceOf(r),
  ].filter(Boolean).join(' · ');
  return `<a class="hero-card tint-${tileTint(r)}" href="#recipe/${r.row}">
      ${iconSvg(iconFor(r), 'hero-icon')}
      <span class="hero-text">
        <span class="hero-kicker">Try this</span>
        <span class="hero-name">${esc(displayName(r))}</span>
      </span>
    </a>
    <p class="hero-about">${esc(about)}</p>
    ${r.notes ? `<p class="hero-note">Your note: ${esc(r.notes)}</p>` : ''}
    <div class="hero-actions">
      <a class="btn primary" href="${esc(webLink(r.link))}" target="_blank" rel="noopener">Open recipe</a>
      ${suggestionPool().length > 1 ? '<button type="button" data-action="another">Show another</button>' : ''}
    </div>`;
}

function renderToday() {
  // Follow the clock, unless she (or Yo Mom) picked a meal during this part of the day.
  const now = mealAt();
  if (!state.meal || state.mealSlot !== now) {
    state.meal = now;
    state.mealSlot = now;
  }
  if (!EFFORTS[state.effort]) state.effort = 'quick';
  const meal = state.meal, effort = state.effort;
  const what = `${EFFORTS[effort].toLowerCase()} ${MEALS[meal].dishes}`; // "quick & easy lunch dishes"
  const all = mainDishes(meal, effort);
  const sides = sideDishes(meal);
  if (all.length) ensureSuggestion();

  // The heading is the meal picker: the date in small capitals over a big
  // "Lunch ⌄", with the phone's own list of meals behind it. Under it, a
  // two-way switch.
  const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  view().innerHTML = `
    <h1 class="sr-only">${esc(EFFORTS[effort])} ${esc(meal.toLowerCase())}</h1>
    <header class="meal-head">
      ${meButtonHtml()}
      <p class="meal-kicker" aria-hidden="true">${esc(date)}</p>
      <label class="meal-pick">
        <span class="meal-name" aria-hidden="true">${esc(meal)}</span>
        <span class="meal-chevron" aria-hidden="true"></span>
        <select id="meal" aria-label="Meal">
          ${MEAL_NAMES.map(m => `<option${m === meal ? ' selected' : ''}>${m}</option>`).join('')}
        </select>
      </label>
      <div class="effort-switch" role="group" aria-label="Quick and easy, or gourmet">
        ${Object.entries(EFFORTS).map(([k, label]) => `<button type="button" data-effort="${k}" aria-pressed="${k === effort}">${esc(label)}</button>`).join('')}
      </div>
    </header>

    <div id="today-plan">${todayPlanHtml()}</div>

    ${all.length ? `
      <section class="hero" id="suggestion">${suggestionHtml()}</section>
      <h2 class="section meal-all">All ${esc(what)} <span class="count">${all.length}</span></h2>
      <div class="squares meal-grid">${all.map(r => squareHtml({ r, match: null }, { status: false })).join('')}</div>
    ` : `<p class="muted meal-empty">${state.recipes.length || !state.loading ? `No ${esc(what)} yet.` : 'Loading your recipes…'}</p>`}

    ${sides.length ? `
      <h2 class="section side-heading">On the side</h2>
      <div class="side-row">${sides.map(r => squareHtml({ r, match: null }, { status: false })).join('')}</div>
    ` : ''}
  `;
}

/** "On your plan: Fish curry, Chapati ×2" for the meal on show, when today's plan has any. Each dish once. */
function todayPlanHtml() {
  const groups = groupByDish(plannedFor(dayKey(), state.meal));
  if (!groups.length) return '';
  const names = groups.map(({ r, copies }) =>
    `<a href="#recipe/${r.row}">${esc(displayName(r))}</a>${copies.length > 1 ? `<span class="times">${esc(timesText(copies.length))}</span>` : ''}`);
  return `<p class="plan-line">On your plan: ${names.join(', ')}</p>`;
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

// ---------- dish icons ----------
// Every tile shows a thin line icon for the kind of dish (app/icons.js) instead
// of a picture, so the tiles all look alike. The real picture is on the
// dish's own page.

/**
 * Which icon a dish name gets: the first rule with a word in the name wins, so
 * the order matters. Drinks, pickles and sweets come first (a pickle made with
 * fish is a pickle, a cake made with semolina a cake), then the shape of the
 * dish (rice, bread), then what it's made of (chicken, fish, paneer), then the
 * kind of dish (curry, thoran).
 * Words are in simpleWord's form (lowercase, singular, Malayalam / Hindi names
 * in English: kozhi is chicken, meen fish, chemmeen prawn, mutta egg). A word
 * ending in * matches the start of a word ("biriyani", "kozhikari"); several
 * words must be next to each other. `not` words stop a rule matching.
 */
const ICON_RULES = [
  // Drinks
  { icon: 'coffee', words: ['coffee', 'cappuccino', 'latte'], not: ['cake', 'cookie', 'cooky', 'biscuit'] },
  { icon: 'teapot', words: ['tea', 'chai'], not: ['cake', 'cookie', 'cooky', 'biscuit'] },
  { icon: 'lemon', words: ['lemonade', 'nimbu', 'shikanji', 'lemon juice', 'lime juice', 'lemon soda', 'lime soda', 'lemon and mint', 'lemon mint'] },
  { icon: 'glass-cocktail', words: ['mojito', 'mocktail', 'cocktail', 'kulukki', 'soda'] },
  { icon: 'milkshake', words: ['shake', 'milkshake', 'smoothie', 'smoothy', 'falooda', 'faluda', 'badam milk', 'almond milk', 'rose milk'] },
  { icon: 'glass-full', words: ['juice', 'sharbat', 'sharbath', 'sherbet', 'lassi', 'buttermilk', 'sambharam', 'drink', 'wine', 'punch', 'concentrate', 'squash'] },
  // Pickles, chutneys, powders and sauces: kept in a jar or a bottle
  { icon: 'salt', words: ['podi', 'powder', 'premix', 'spice mix'] },
  { icon: 'bottle', words: ['sauce', 'ketchup', 'mayonnaise', 'mayo', 'spread', 'dressing', 'dip', 'syrup'], not: ['white sauce'] },
  { icon: 'milk', words: ['pickle', 'achar', 'achaar', 'chutney', 'chammanthi', 'chammandi', 'thokku', 'puli', 'paste', 'cube', 'jam', 'storage', 'preserve'] },
  // Sweets
  { icon: 'bowl-spoon', words: ['payasam', 'pradhaman', 'kheer', 'pudding', 'custard', 'shrikhand', 'shrikand', 'phirni', 'double ka meeta', 'sevai', 'semiya', 'vermicelli', 'rabri'] },
  { icon: 'ice-cream', words: ['kulfi', 'popsicle', 'kulfy'] },
  { icon: 'ice-cream-2', words: ['icecream', 'ice cream', 'gelato', 'sundae'] },
  { icon: 'cookie', words: ['cookie', 'cooky', 'biscuit', 'nankhatai', 'achappam', 'diamond', 'shakarpara', 'khari', 'rusk'] },
  { icon: 'cake-roll', words: ['fruit roll', 'pista roll', 'swiss roll', 'cake roll'] },
  { icon: 'cake', words: ['cake', 'cheesecake', 'cupcake', 'muffin', 'brownie', 'browny', 'lava', 'kunafa', 'kalathappam', 'vattappam', 'tart', 'pie'] },
  { icon: 'candy', words: ['laddu', 'ladoo', 'ladu', 'halwa', 'barfi', 'burfi', 'katli', 'kalakand', 'peda', 'mysore pak', 'soan', 'papdi', 'jamun', 'jalebi', 'chikki', 'ghevar', 'khaja', 'chandrakala', 'mithai', 'rasgulla', 'rasmalai', 'meeta', 'sweet', 'unniappam', 'neyyappam'], not: ['sweet and spicy', 'sweet corn', 'sweet potato'] },
  // Crunchy and fried snacks
  { icon: 'cookie', words: ['mixture', 'chivda', 'namkeen', 'bhujia', 'murukku', 'chakli', 'chip', 'punugulu', 'sukhiyan', 'sukhiyen', 'munthirikothu', 'kuzhalappam', 'cheeseling', 'pani puri', 'vada', 'vadai', 'bonda', 'bajji', 'bhaji', 'pakoda', 'pakora', 'kachori'], not: ['vada pav'] },
  // The shape of the dish
  { icon: 'soup', words: ['soup', 'rasam', 'shorba'] },
  { icon: 'bread', words: ['dosa', 'dosai', 'appam', 'palappam', 'idli', 'chapati', 'chapathi', 'roti', 'phulka', 'paratha', 'parotta', 'porotta', 'paratta', 'parota', 'puri', 'poori', 'naan', 'kulcha', 'bhatura', 'pathiri', 'pancake', 'uttapam', 'pesarattu', 'pessaratu', 'adai', 'poli', 'boli', 'crepe', 'quesadilla', 'frankie', 'pita', 'wrap', 'toast', 'sandwich*', 'sandwish*'] },
  { icon: 'bowl', words: ['rice', 'biryani', 'biriyani', 'briyani', 'biriani', 'pulao', 'pulav', 'pilaf', 'pongal', 'khichdi', 'khichadi', 'upma', 'uppumavu', 'poha', 'aval', 'daliya', 'kanji', 'porridge', 'oats', 'mudde', 'puttu'] },
  { icon: 'bowl-chopsticks', words: ['pasta', 'spaghetti', 'macaroni', 'noodle', 'idiyappam', 'idiappam', 'nool puttu', 'maggi', 'chowmein', 'ramen'] },
  { icon: 'dumpling', words: ['kozhukatta', 'kozhukattai', 'kozhukottai', 'modak', 'momo', 'dumpling', 'kumbil', 'pidi*', 'paniyaram', 'appe', 'ela ada'] },
  { icon: 'pizza', words: ['pizza', 'samosa', 'triangle'] },
  { icon: 'baguette', words: ['bread', 'bun', 'pav', 'loaf', 'croissant', 'focaccia', 'baguette'] },
  // What it's made of
  { icon: 'sausage', words: ['sausage', 'hot dog'] },
  { icon: 'grill', words: ['kebab', 'kabab', 'tandoori', 'grill', 'grilled', 'seekh', 'sheek', 'tangdi', 'bbq', 'barbecue', 'tikka'], not: ['tikka masala'] },
  { icon: 'meat', words: ['chicken*', 'beef', 'mutton', 'pork', 'duck', 'lamb', 'goat', 'kheema', 'keema', 'kozhi*', 'murg', 'murgh', 'shawarma', 'sharwama', 'meatball', 'chop', 'liver', 'boti'] },
  { icon: 'fish', words: ['fish', 'meen*', 'prawn', 'chemmeen*', 'konju', 'ayala', 'mathi', 'sardine', 'karimeen', 'neymeen', 'nemeen', 'seer', 'pomfret', 'tuna', 'salmon', 'mackerel', 'squid', 'koonthal', 'kanava', 'crab', 'njandu', 'kakka', 'clam', 'mussel', 'kallummakaya', 'anchovy', 'netholi', 'nethili', 'seafood'] },
  { icon: 'eggs', words: ['egg', 'mutta*', 'omelette', 'omelet', 'bull eye', 'bulls eye', 'anda'] },
  { icon: 'cheese', words: ['paneer', 'cheese', 'tofu'] },
  { icon: 'mushroom', words: ['mushroom', 'koon'] },
  // Snacks that go by what they're made of when the name says (a cutlet made with chicken is meat)
  { icon: 'cookie', words: ['cutlet', 'falafel', 'manchurian', 'spring roll', 'popcorn', 'nugget', 'bites', 'puff', 'crispy', 'crisp'] },
  // The kind of dish
  { icon: 'salad', words: ['salad', 'kosambari', 'thoran', 'mezhukkupuratti', 'poriyal', 'upperi', 'avial', 'aviyal'] },
  { icon: 'soup', words: ['curry', 'kari', 'gravy', 'sambar', 'sambhar', 'stew', 'ishtu', 'dal', 'kurma', 'korma', 'salan', 'salna', 'kadhi', 'kolambu', 'kulambu', 'kuzhambu', 'theeyal', 'pulissery', 'pulisseri', 'moru', 'olan', 'molly', 'moilee', 'molee', 'handi', 'kofta', 'makhani', 'kootu', 'kootan', 'erissery', 'thambuli', 'pachadi', 'kichadi', 'rajma', 'chole', 'chana masala'] },
  { icon: 'pepper', words: ['chilli', 'mirchi', 'capsicum', 'pepper', 'bhindi', 'okra', 'vendakka', 'pavakk*', 'kovakk*', 'bitter gourd'] },
  { icon: 'leaf', words: ['spinach', 'cheera', 'fenugreek', 'moringa', 'muringa', 'leaf', 'leave', 'green', 'mint', 'coriander', 'saag', 'sarson'] },
  { icon: 'salad', words: ['stir fry', 'jalfrezi', 'veg', 'vegetable', 'brinjal', 'cabbage', 'beans', 'bean', 'cucumber', 'broccoli', 'cauliflower', 'sprout'] },
  { icon: 'carrot', words: ['carrot', 'potato', 'beetroot', 'tapioca', 'yam', 'chena', 'colocasia', 'chembu', 'plantain', 'ethakya', 'pumpkin', 'radish'] },
];

// What her ingredient lists can add when the name says nothing: only what
// the dish is mainly made of (most lists have onion, chilli and coriander).
const INGREDIENT_ICON_RULES = ICON_RULES.filter(rule => ['sausage', 'meat', 'fish', 'eggs', 'cheese', 'mushroom'].includes(rule.icon));

// Last of all, the kind of dish she filed it under. Main dishes don't say
// which, so they keep the plain kitchen icon.
const CATEGORY_ICONS = {
  'Breakfast': 'bread', 'Side Dish': 'salad', 'Appetizer/Snack': 'cookie',
  'Sweet Snack/Mithai': 'candy', 'Dessert': 'cake', 'Bread/Baking': 'baguette', 'Soup': 'soup',
  'Salad': 'salad', 'Drink/Beverage': 'glass-full', 'Sauce/Condiment': 'milk',
};
const FALLBACK_ICON = 'tools-kitchen-2';

/** Each rule's words as simpleWord phrases, worked out once. */
const iconRuleWords = new Map();
function ruleWords(rule) {
  if (!iconRuleWords.has(rule)) {
    const prep = w => (w.endsWith('*') ? { prefix: simplePhrase(w.slice(0, -1)) } : { phrase: simplePhrase(w) });
    iconRuleWords.set(rule, { words: rule.words.map(prep), not: (rule.not || []).map(prep) });
  }
  return iconRuleWords.get(rule);
}

/** True when `text` (a simplePhrase) has the word, phrase or word start. */
function hasIconWord(text, w) {
  if (w.phrase) return hasPhrase(text, w.phrase);
  return (' ' + text).includes(' ' + w.prefix);
}

function iconFromRules(rules, text) {
  for (const rule of rules) {
    const { words, not } = ruleWords(rule);
    if (words.some(w => hasIconWord(text, w)) && !not.some(w => hasIconWord(text, w))) return rule.icon;
  }
  return '';
}

/**
 * A dish name with the parts that aren't the dish taken off: what it goes
 * with ("… for rice", "… with peas") and what it's made without ("… without
 * rice", "no egg").
 */
function dishWords(name) {
  return simplePhrase(String(name).toLowerCase()
    .replace(/\s(for|with)\s.*$/, ' ')
    .replace(/\b(without|no)\s+[\p{L}-]+/gu, ' '));
}

/** The icon for a dish: from its name, else its main ingredient, else its category. */
const iconCache = new Map();
function iconFor(r) {
  const key = `${r.name}\u0000${r.category}\u0000${r.ingredients.join(',')}`;
  if (!iconCache.has(key)) {
    iconCache.set(key, iconFromRules(ICON_RULES, dishWords(r.name)) ||
      iconFromRules(INGREDIENT_ICON_RULES, simplePhrase(r.ingredients.join(' , '))) ||
      CATEGORY_ICONS[categoryOf(r)] || FALLBACK_ICON);
  }
  return iconCache.get(key);
}

// The tile's colour follows the kind of dish too: warm for meat and curries,
// green for rice and vegetables, red for fish and pickles, pink for sweets,
// teal for drinks. The plain kitchen icon keeps its category's colour.
const ICON_TINTS = {
  meat: 'orange', grill: 'orange', sausage: 'orange', soup: 'yellow',
  fish: 'red', milk: 'red', bottle: 'red', salt: 'red',
  bowl: 'green', salad: 'green', leaf: 'green',
  carrot: 'olive', pepper: 'olive', mushroom: 'olive',
  eggs: 'yellow', bread: 'yellow', 'bowl-chopsticks': 'yellow',
  baguette: 'brown', cookie: 'brown', dumpling: 'brown', pizza: 'brown',
  cheese: 'plum',
  cake: 'pink', 'cake-roll': 'pink', candy: 'pink', 'ice-cream': 'pink', 'ice-cream-2': 'pink', 'bowl-spoon': 'pink',
  coffee: 'teal', teapot: 'teal', lemon: 'teal', 'glass-cocktail': 'teal', milkshake: 'teal', 'glass-full': 'teal',
};

function tileTint(r) {
  return ICON_TINTS[iconFor(r)] || tintFor(categoryOf(r));
}

/** One of the line icons from app/icons.js, in the colour of the text around it. */
function iconSvg(name, cls = 'icon') {
  const paths = (typeof ICONS === 'object' && (ICONS[name] || ICONS[FALLBACK_ICON])) || [];
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths.map(d => `<path d="${d}"/>`).join('')}</svg>`;
}

// ---------- ingredient search ----------
// She types what she has ("chicken, cream, cashew") and sees only the recipes
// that use every one of them: no near-misses, no "2 of 3". That's what she
// asked for; a different set of ingredients is a new search. Words are compared in a simple form (lowercase,
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
  else if (w.length > 5 && w.endsWith('llies')) w = w.slice(0, -2); // chillies
  else if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y'; // curries
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

// She searches by style ("chicken gravy", "chicken fry"), but most dish names
// don't say "gravy": they say curry, handi, korma... So a style word also
// matches any of the names that mean it. Checked against the dish name only.
const STYLES = {
  gravy: ['gravy', 'curry', 'masala', 'handi', 'korma', 'kurma', 'stew', 'salna', 'makhani', 'kolambu', 'kulambu',
    'theeyal', 'moru', 'pulissery', 'malai', 'kofta', 'kadai', 'molly', 'mughlai', 'afghani', 'butter chicken', 'kali mirch'],
  roast: ['roast', 'perattu', 'varattiyathu', 'ularthiyathu', 'chukka'],
  fry: ['fry', 'fried', 'perattu', 'chukka', '65', 'kondattam', 'kondatam', 'pollichathu'],
  kebab: ['kebab', 'kabab', 'tikka', 'tandoori'],
  curry: ['curry', 'gravy', 'masala', 'stew', 'kolambu', 'kulambu', 'theeyal', 'moru', 'pulissery'],
};

/**
 * Does a recipe have this search term? Style words ("gravy", "fry") look at the
 * kind of dish in its name only, so "curry" doesn't match "curry leaves".
 * Anything else looks in the name and ingredients. A phrase that isn't found
 * as it is ("chicken gravy") needs each of its words instead.
 */
function termMatches(text, name, term) {
  const styles = STYLES[term];
  if (styles) return styles.some(v => hasPhrase(name, simplePhrase(v)));
  if (hasPhrase(text, term)) return true;
  const words = term.split(' ');
  return words.length > 1 && words.every(w => termMatches(text, name, w));
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

/** The search box's words to look for: one name or word, or each ingredient of a list. */
function searchTerms(q) {
  const search = readSearch(String(q).trim());
  return search.mode === 'ingredients' ? search.terms : (search.text ? [search.text] : []);
}

/**
 * The search terms a recipe doesn't have. One word or a name looks in the
 * name, notes, category and ingredients; several look in the name and
 * ingredients only, and each must be there.
 */
function missingTerms(r, terms) {
  const text = simplePhrase(terms.length > 1
    ? [r.name, ...r.ingredients].join(' , ')
    : `${r.name} ${r.notes} ${r.category} ${r.ingredients.join(' ')}`);
  const name = simplePhrase(r.name);
  return terms.filter(t => !termMatches(text, name, t));
}

/**
 * The recipes to show for the current filters and search box, with how well
 * each matches when it's an ingredient search: { mode, terms, items: [{ r, match }] }.
 * `f` is the filters to follow (the Recipes tab passes shownFilters()).
 */
function runSearch(f = state.filters) {
  const list = state.recipes.filter(r => {
    if (f.showRemoved !== isRemoved(r)) return false;
    if (!f.showRemoved && f.status !== 'all' && statusOf(r) !== f.status) return false;
    if (f.category && categoryOf(r) !== f.category) return false;
    if (!f.showRemoved && f.collection && !inCollection(r, f.collection)) return false;
    return true;
  });

  // One word or a dish name: look in names, notes, categories and ingredients.
  // A list ("chicken, cream, cashew") or several words ("chicken cream
  // cashew"): only dishes that have every one of them, in the name or ingredients.
  // A phrase without commas ("curry leaves", "chicken gravy") is tried whole
  // first; termMatches falls back to its separate words when that finds nothing.
  const terms = searchTerms(f.q);
  const several = terms.length > 1;
  const items = [];
  // Dishes missing just one thing she asked for, kept apart and hidden behind
  // a button: she wants exact answers first. Never a dish that needs a protein
  // she didn't list: if she has prawns and no chicken, "chicken roast" is no
  // help however close it is. So a close match misses the style ("prawns,
  // roast" -> her other prawns dishes), a smaller ingredient ("no cream"), or
  // one of two proteins she has (prawns and chicken -> a prawns-only dish).
  const close = [];
  const hasProteins = terms.filter(isProtein);
  // With proteins in her list, a close match uses at least one of them and no other.
  const proteinsOk = r => {
    if (!hasProteins.length) return true;
    const uses = dishProteins(r);
    return uses.length > 0 && uses.every(p => hasProteins.includes(p));
  };
  for (const r of list) {
    const missing = missingTerms(r, terms);
    if (!missing.length) items.push({ r, match: null });
    else if (several && missing.length === 1 && proteinsOk(r)) {
      close.push({ r, match: { have: terms.length - 1, of: terms.length, missing: missing[0], style: !!STYLES[missing[0]] } });
    }
  }
  const newestFirst = (a, b) => b.r.row - a.r.row;
  items.sort(newestFirst);
  // The same ingredients in another style first ("other prawns dishes"), then the rest.
  close.sort((a, b) => (b.match.style - a.match.style) || newestFirst(a, b));
  return { mode: several ? 'ingredients' : 'text', terms, items, close };
}

// ---------- tap instead of typing ----------
// Chips under the search box put a word in the box's list (or take it out),
// so tapping gives exactly the same results as typing it.

const PROTEINS = ['chicken', 'mutton', 'beef', 'pork', 'fish', 'prawns', 'egg', 'paneer'];

/** A search term that's one of the proteins (in its simple form, so "prawns" and "chemmeen" count). */
function isProtein(term) {
  return PROTEINS.some(p => simpleWord(p) === term);
}

/** The proteins a dish uses, from its name and ingredients, in their simple form ("prawn"). */
function dishProteins(r) {
  const text = simplePhrase([r.name, ...r.ingredients].join(' , '));
  return PROTEINS.map(simpleWord).filter(p => hasPhrase(text, p));
}
const STYLE_CHIPS = ['gravy', 'roast', 'fry', 'kebab'];
const CHIP_EXTRAS = ['cream', 'cashew', 'coconut', 'tomato'];

/** Ingredient words for the chips: her proteins first, then the few extras she searches with. */
function ingredientChips() {
  const recipes = state.recipes.filter(r => !isRemoved(r));
  const texts = recipes.map(r => ({ text: simplePhrase([r.name, ...r.ingredients].join(' , ')), name: simplePhrase(r.name) }));
  const used = word => texts.some(t => termMatches(t.text, t.name, simplePhrase(word)));
  // Her proteins, then the few things she searches with for main dishes.
  // A short fixed list reads better than "most used", which brings in sugar and ghee.
  return [...PROTEINS, ...CHIP_EXTRAS].filter(used);
}

/** The words in the search box's list, as she wrote them. */
function searchParts(q) {
  return q.split(/,|\band\b|&|\+/i).map(x => x.trim()).filter(Boolean);
}

const title = w => w[0].toUpperCase() + w.slice(1);

/** An ingredient she has: a plain label. */
function tagHtml(term) {
  return `<button type="button" class="chip tag" data-chip="${esc(term)}" aria-pressed="false">${esc(title(term))}</button>`;
}

/** A kind of dish: one part of the "Make it" bar. */
function styleWordHtml(term) {
  return `<button type="button" class="chip style-seg" data-chip="${esc(term)}" aria-pressed="false">${esc(title(term))}</button>`;
}

/**
 * Two groups that look different on purpose: plain labels for what she has,
 * and a single split bar (like "Something new | An old favourite") for the
 * kind of dish.
 */
function chipsHtml() {
  return `<div class="pick">
    <p class="pick-label">I have</p>
    <div class="tags" role="group" aria-label="Ingredients you have">${ingredientChips().map(tagHtml).join('')}</div>
    <p class="pick-label">Make it</p>
    <div class="segmented style-bar" role="group" aria-label="Kind of dish">${STYLE_CHIPS.map(styleWordHtml).join('')}</div>
  </div>`;
}

/** Lights up the chips whose word is in the box, whether tapped or typed, and says what's picked under "What do you have?". */
function markChips() {
  const inBox = new Set(searchParts(state.filters.q).map(simplePhrase));
  document.querySelectorAll('.chip[data-chip]').forEach(c => {
    c.setAttribute('aria-pressed', inBox.has(simplePhrase(c.dataset.chip)));
  });
  const line = $('#have-summary');
  if (!line) return;
  const text = haveSummary();
  if (line.dataset.text === text) return;
  line.dataset.text = text;
  line.hidden = !text;
  line.innerHTML = text ? `<span class="have-picked">${esc(text)}</span><button type="button" class="link-btn have-clear" data-action="chip-clear">Clear</button>` : '';
}

/** Puts a chip's word in the search box's list, or takes it out if it's there. */
function toggleChip(term) {
  const key = simplePhrase(term);
  let parts = searchParts(state.filters.q);
  const kept = parts.filter(p => simplePhrase(p) !== key);
  if (kept.length === parts.length && STYLE_CHIPS.includes(term)) {
    // The "Make it" bar is a switch: picking Roast replaces Gravy, since no dish is both.
    const styles = STYLE_CHIPS.map(simplePhrase);
    parts = parts.filter(p => !styles.includes(simplePhrase(p)));
  }
  state.filters.q = (kept.length < searchParts(state.filters.q).length ? kept : [...parts, term]).join(', ');
  $('#search').value = state.filters.q;
  renderList();
}

/** "chicken, cream and cashew" */
function andList(items) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// ---------- the Recipes tab ----------
// Top to bottom: one search box, one row of shortcuts (All · Naadan · One pot
// · Loved · To try), one "What do you have?" button that opens the chips, and
// the dishes. With nothing searched, the dishes sit under quiet headings by
// kind of meal. Mom found the old screen (cards, chips, a bar and two
// dropdowns before a single dish) too much.

/** The shortcut row: one at a time, a collection, a status, or All. */
const SHORTCUTS = [
  { key: 'all', name: 'All', empty: 'No recipes yet.' },
  { key: 'naadan', name: 'Naadan', collection: 'naadan', empty: 'Nothing in Naadan yet.' },
  { key: 'onepot', name: 'One pot', collection: 'onepot', empty: 'Nothing in One pot yet.' },
  { key: 'loved', name: 'Loved', status: STATUS.loved, empty: 'No loved recipes yet.' },
  { key: 'totry', name: 'To try', status: STATUS.toTry, empty: 'Nothing waiting to try.' },
];
// Typed on its own in the search box, one of these picks its shortcut instead
// of searching for the word.
const SHORTCUT_WORDS = {
  naadan: 'naadan', 'one pot': 'onepot', onepot: 'onepot', bachelor: 'onepot',
  loved: 'loved', 'to try': 'totry', totry: 'totry',
};

/** The shortcut the search box holds ("One pot", "to try"), or '' when it's a search. */
function typedShortcut(q) {
  return SHORTCUT_WORDS[String(q).toLowerCase().replace(/[^a-z]+/g, ' ').trim()] || '';
}

/** The filters a shortcut stands for. */
function shortcutFilters(key) {
  const s = SHORTCUTS.find(x => x.key === key) || SHORTCUTS[0];
  return { collection: s.collection || '', status: s.status || 'all' };
}

/** The shortcut the filters are on. */
function shortcutOf(f) {
  if (f.collection) return f.collection;
  return f.status === STATUS.loved ? 'loved' : f.status === STATUS.toTry ? 'totry' : 'all';
}

/**
 * The filters the list follows. While the box holds a shortcut word, the list
 * already shows that shortcut, with nothing searched; it moves to the row
 * when she's done typing (takeTypedShortcut).
 */
function shownFilters() {
  const f = state.filters;
  const typed = !f.showRemoved && typedShortcut(f.q);
  return typed ? { ...f, q: '', ...shortcutFilters(typed) } : f;
}

/** The box holds a shortcut word and she's done typing: the row takes it and the box empties. */
function takeTypedShortcut() {
  const typed = !state.filters.showRemoved && typedShortcut(state.filters.q);
  if (!typed) return false;
  Object.assign(state.filters, shortcutFilters(typed), { q: '' });
  const box = $('#search');
  if (box) box.value = '';
  markShortcuts();
  return true;
}

/**
 * All · Naadan · One pot · Loved · To try, as plain words. No counts here, so
 * all five fit across a phone; the headings in the list have them. Only the
 * row scrolls sideways if it ever needs to.
 */
function shortcutsHtml() {
  return `<div class="shortcuts" role="group" aria-label="Show">${SHORTCUTS.map(s =>
    `<button type="button" data-shortcut="${s.key}" aria-pressed="false">${esc(s.name)}</button>`).join('')}</div>`;
}

/** Underlines the shortcut the list is showing, typed or tapped. */
function markShortcuts() {
  const on = shortcutOf(shownFilters());
  document.querySelectorAll('.shortcuts [data-shortcut]').forEach(b => b.setAttribute('aria-pressed', b.dataset.shortcut === on));
}

function pickShortcut(key) {
  // A shortcut word still in the box gives way to the one she tapped.
  if (typedShortcut(state.filters.q)) {
    state.filters.q = '';
    const box = $('#search');
    if (box) box.value = '';
  }
  Object.assign(state.filters, shortcutFilters(key));
  renderList();
  showChosenDay($('.shortcuts'));
}

/**
 * "What do you have?": an outlined button that opens the chips under it (no
 * pop-up). What she's picked shows on one line under the button, open or shut.
 */
function haveHtml() {
  const open = !!state.haveOpen;
  return `<div class="have">
    <button type="button" class="have-btn" data-action="have-toggle" aria-expanded="${open}" aria-controls="have-panel">What do you have?<svg class="have-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 9l6 6l6 -6"/></svg></button>
    <p class="have-summary" id="have-summary" hidden></p>
    <div class="have-panel" id="have-panel"${open ? '' : ' hidden'}>${chipsHtml()}</div>
  </div>`;
}

function toggleHave() {
  state.haveOpen = !state.haveOpen;
  const b = $('[data-action=have-toggle]');
  if (b) b.setAttribute('aria-expanded', state.haveOpen);
  const panel = $('#have-panel');
  if (panel) panel.hidden = !state.haveOpen;
}

/** "With prawns, coconut · roast": what she picked from the chips, or '' for nothing. */
function haveSummary() {
  const on = sel => [...document.querySelectorAll(`${sel}[aria-pressed=true]`)].map(c => c.dataset.chip);
  const has = on('.chip.tag'), style = on('.chip.style-seg')[0];
  if (!has.length) return style ? `${title(style)} dishes` : '';
  return `With ${has.join(', ')}${style ? ` · ${style}` : ''}`;
}

// The headings over the list when nothing is searched: her categories, put
// together by kind of meal. Anything else goes under Other.
const RECIPE_GROUPS = [
  { name: 'Breakfast', cats: ['Breakfast'] },
  { name: 'Curries and mains', cats: ['Main Course', 'Lunch', 'Dinner', 'Soup'] },
  { name: 'Sides and chutneys', cats: ['Side Dish', 'Sauce/Condiment', 'Salad'] },
  { name: 'Snacks', cats: ['Appetizer/Snack'] },
  { name: 'Sweets and desserts', cats: ['Sweet Snack/Mithai', 'Dessert'] },
  { name: 'Breads and baking', cats: ['Bread/Baking', 'Bread', 'Baking'] },
  { name: 'Drinks', cats: ['Drink/Beverage', 'Drink', 'Beverage'] },
  { name: 'Other', cats: [] },
];

function groupOf(r) {
  const c = categoryOf(r).toLowerCase();
  return RECIPE_GROUPS.find(g => g.cats.some(k => k.toLowerCase() === c)) || RECIPE_GROUPS[RECIPE_GROUPS.length - 1];
}

function renderRecipes() {
  const f = state.filters;
  const removedCount = state.recipes.filter(isRemoved).length;

  view().innerHTML = `
    ${f.showRemoved ? backHtml('hide-removed') : ''}
    <h1>${f.showRemoved ? 'Removed' : 'Recipes'}</h1>
    ${f.showRemoved ? '<p class="muted">Recipes you removed. They’re still saved.</p>' : ''}

    <form class="search-box" data-search-form role="search">
      <label class="sr-only" for="search">Search</label>
      ${iconSvg('search', 'search-icon')}
      <input id="search" type="search" enterkeyhint="search" placeholder="${f.showRemoved ? 'Search removed recipes' : 'Search a dish, or type what you have'}" value="${esc(f.q)}" autocomplete="off">
    </form>
    ${f.showRemoved ? '' : shortcutsHtml() + haveHtml()}

    <div id="list-head"></div>
    <div id="list" class="squares"></div>

    ${!f.showRemoved && removedCount ? `<button class="link-btn" data-action="show-removed">Show removed (${removedCount})</button>` : ''}

  `;
  renderList();
  showChosenDay($('.shortcuts'));
}

function renderList() {
  const el = $('#list');
  if (!el) return;
  markChips();
  markShortcuts();
  const f = shownFilters();
  const search = runSearch(f);
  const list = search.items;
  const sc = !f.showRemoved && SHORTCUTS.find(s => s.key === shortcutOf(f));
  const inShortcut = sc && sc.key !== 'all';

  // Nothing searched: the dishes under quiet headings by kind of meal, newest first in each.
  if (!f.showRemoved && !f.q.trim()) {
    $('#list-head').innerHTML = '';
    if (!list.length) {
      el.innerHTML = `<p class="muted empty">${state.recipes.length ? esc(sc.empty) : (state.loading ? 'Loading your recipes…' : 'No recipes yet.')}</p>`;
      return;
    }
    const groups = new Map(RECIPE_GROUPS.map(g => [g, []]));
    for (const item of list) groups.get(groupOf(item.r)).push(item);
    el.innerHTML = [...groups].filter(([, items]) => items.length).map(([g, items]) =>
      `<h2 class="group-head">${esc(g.name)} <span class="count">${items.length}<span class="sr-only"> recipe${items.length === 1 ? '' : 's'}</span></span></h2>
      ${items.map(squareHtml).join('')}`).join('');
    return;
  }

  // A search or picked ingredients: one flat list, then the close matches as before.
  const showClose = state.closeOpenFor === state.filters.q.trim();
  // Her words as she wrote them ("prawns", "chemmeen"), not the simple form the search compares.
  const said = t => (searchParts(f.q).find(x => simplePhrase(x) === t) || t).toLowerCase();
  const withWhat = search.mode === 'ingredients' && list.length ? ` with ${andList(search.terms.map(said))}` : '';
  $('#list-head').innerHTML = `<p class="muted small" id="count">${list.length} recipe${list.length === 1 ? '' : 's'}${esc(withWhat)}${inShortcut ? ` · ${esc(sc.name)}` : ''}</p>`;

  let html = list.length ? list.map(squareHtml).join('') : `<p class="muted empty">${state.recipes.length
    ? (search.mode === 'ingredients' ? `No recipes have all of ${esc(andList(search.terms.map(said)))}.` : 'No recipes match.')
    : (state.loading ? 'Loading your recipes…' : 'No recipes yet.')}</p>${list.length || !inShortcut ? ''
    : '<button type="button" class="link-btn look-all" data-shortcut="all">Look in all recipes</button>'}`;
  if (search.close.length) {
    const n = search.close.length;
    // Only the style is missing ("prawns, roast"): say plainly they're her other prawns dishes.
    const styleOnly = search.close.every(c => c.match.style);
    const have = andList(search.terms.filter(t => !STYLES[t]).map(said));
    const title = styleOnly ? `Other ${have} dishes` : 'Close matches';
    html += showClose
      ? `<h2 class="section close-heading">${esc(title)} <span class="muted small">${styleOnly ? 'in another style' : 'missing one thing'}</span></h2>
         ${search.close.map(squareHtml).join('')}
         <button class="link-btn close-toggle" data-action="hide-close">Hide ${styleOnly ? 'these' : 'close matches'}</button>`
      : `<button class="link-btn close-toggle" data-action="show-close">${styleOnly
          ? `Show ${n} other ${esc(have)} dish${n === 1 ? '' : 'es'}`
          : `Show ${n} close match${n === 1 ? '' : 'es'} (missing 1 thing)`}</button>`;
  }
  el.innerHTML = html;
}

/**
 * One recipe square: a soft tint for the kind of dish, its line icon, and the
 * name under it. `match` is set for a close match: "2 of 3" and what's missing.
 * On the Recipes tab her status shows quietly at the bottom when it isn't
 * "To try"; Today leaves it off (`status: false`).
 */
function squareHtml({ r, match }, { status: showStatus = true } = {}) {
  // A guest's own recipes say so, quietly, where the status would be.
  const status = !showStatus ? '' : isMine(r) ? 'Yours'
    : (statusOf(r) === STATUS.toTry && !isRemoved(r)) ? '' : statusLabel(r);
  return `<a class="square tint-${tileTint(r)}${match ? ' close-match' : ''}" href="#recipe/${r.row}">
    ${iconSvg(iconFor(r))}
    <span class="name${String(r.name).trim() ? '' : ' untitled'}">${esc(displayName(r))}</span>
    ${match ? `<span class="status close-status">${match.style ? `not a ${esc(match.missing)}` : `${match.have} of ${match.of} · no ${esc(match.missing)}`}</span>` : (status ? `<span class="status">${esc(status)}</span>` : '')}
  </a>`;
}

// ---------- views: one recipe ----------

function renderRecipe(row) {
  const r = findRecipe(row);
  if (!r) {
    view().innerHTML = `${backHtml()}
      <h1>Not found</h1>
      <p class="muted">${state.loading ? 'Loading…' : 'That recipe isn’t in your list any more.'}</p>`;
    return;
  }
  const status = statusOf(r);
  const category = categoryOf(r);
  if (String(state.mealsOpen) !== String(r.row)) state.mealsOpen = null;
  // A guest looking at one of Mom's recipes: to read and cook from, with
  // nothing that changes hers (and never her notes).
  if (!canEdit(r)) {
    view().innerHTML = `
      ${backHtml()}
      <div id="r-picture">${pictureHtml(r)}</div>
      <h1 class="dish-title">${esc(displayName(r))}</h1>
      <p class="muted">${esc(category || 'No category')} · ${esc(momSays(r))}</p>
      ${collectionsLine(r)}

      <a class="btn primary block" href="${esc(webLink(r.link))}" target="_blank" rel="noopener">${esc(openLabel(r))}</a>
      <div id="r-plan">${recipePlanHtml(r)}</div>

      <h2 class="section">Ingredients</h2>
      ${r.ingredients.length
        ? `<ul class="ingredients">${r.ingredients.map((x, i) => `<li>${ingredientButton(r, x, i)}</li>`).join('')}</ul>`
        : '<p class="muted">No ingredients yet.</p>'}
      ${methodHtml(r)}
      <div id="r-cooked">${cookedSectionHtml(r)}</div>
    `;
    delete view().dataset.category;
    loadPhotos();
    return;
  }
  // Read-only until she taps Edit, so nothing changes by accident.
  if (String(state.editing) !== String(r.row)) {
    const meals = mealsOf(r);
    view().innerHTML = `
      <div class="recipe-top">${backHtml()}
        <button type="button" class="edit-btn" data-action="edit-recipe">${iconSvg('pencil')}Edit</button>
      </div>
      <div id="r-picture">${pictureHtml(r)}</div>
      <h1 class="dish-title">${esc(displayName(r))}</h1>
      <p class="muted">${isMine(r) ? 'Yours · ' : ''}${esc(category || 'No category')} · ${esc(statusLabel(r))}</p>
      ${collectionsLine(r)}
      <p class="muted meals-line">${meals.length ? `Shows in: ${esc(meals.join(', '))}` : 'Not in any meal yet'}</p>
      <div id="r-made">${recipeMadeHtml(r)}</div>

      <a class="btn primary block" href="${esc(webLink(r.link))}" target="_blank" rel="noopener">${esc(openLabel(r))}</a>
      <div id="r-plan">${recipePlanHtml(r)}</div>

      <h2 class="section">Ingredients</h2>
      ${r.ingredients.length
        ? `<ul class="ingredients">${r.ingredients.map((x, i) => `<li>${ingredientButton(r, x, i)}</li>`).join('')}</ul>`
        : '<p class="muted">No ingredients yet.</p>'}
      ${methodHtml(r)}
      ${String(r.notes).trim() ? `<h2 class="section">Notes</h2><p class="recipe-notes">${esc(r.notes)}</p>` : ''}
      <div id="r-cooked">${cookedSectionHtml(r)}</div>
      ${isRemoved(r) ? `<div class="footer-action">${status === STATUS.removed
        ? '<button class="link-btn" data-action="restore">Put back in my recipes</button>'
        : '<p class="muted small">Hidden because the name says “ignore”. Change the name to show it again.</p>'}</div>` : ''}
    `;
    view().dataset.category = category;
    loadPhotos();
    return;
  }
  view().innerHTML = `
    ${backHtml('edit-cancel')}
    <p class="meal-kicker">Editing</p>
    <h1 class="dish-title">${esc(displayName(r))}</h1>
    <div id="r-picture">${pictureHtml(r)}</div>
    <div id="r-made">${recipeMadeHtml(r)}</div>

    <label class="field" for="r-name">Name</label>
    <input id="r-name" type="text" value="${esc(r.name)}" placeholder="Kappa biryani">

    <label class="field" for="r-status">Status</label>
    <select id="r-status">${statusOptions(status)}</select>

    <label class="field" for="r-category">Category</label>
    <select id="r-category">${categoryOptions(category)}</select>

    <div id="r-meals" class="edit-meals">${mealsHtml(r)}</div>

    ${collectionTogglesHtml(tagsOf(r), 'r-tags-label', 'Collections')}

    <label class="field" for="r-ingredients">Ingredients, one per line</label>
    <textarea id="r-ingredients" placeholder="tomato&#10;chicken&#10;cream">${esc(r.ingredients.join('\n'))}</textarea>

    <label class="field" for="r-steps">Method, one step per line</label>
    <textarea id="r-steps" class="steps-box" placeholder="Fry the onions till golden&#10;Add the masala and cook 2 minutes">${esc((r.steps || []).join('\n'))}</textarea>

    <label class="field" for="r-notes">Notes</label>
    <textarea id="r-notes" placeholder="Use less sugar next time">${esc(r.notes)}</textarea>

    <div class="edit-actions">
      <button class="primary" data-action="save-recipe">Save</button>
      <button type="button" data-action="edit-cancel">Cancel</button>
    </div>

    <div class="footer-action">
      ${!isRemoved(r)
        ? '<button class="link-btn danger-link" data-action="remove">Remove from my recipes</button>'
        : status === STATUS.removed
          ? '<button class="link-btn" data-action="restore">Put back in my recipes</button>'
          : '<p class="muted small">Hidden because the name says “ignore”. Change the name to show it again.</p>'}
    </div>
  `;
  view().dataset.category = category;
  loadPhotos();
}

/** "Naadan · One pot": the collections a dish is in, quietly, or '' for none. */
function collectionsLine(r) {
  const names = tagsOf(r).map(collectionOf).filter(Boolean).map(c => c.name);
  return names.length ? `<p class="muted collections-line"><span class="sr-only">Collections: </span>${esc(names.join(' · '))}</p>` : '';
}

/** The two collection toggles on the Edit and Add screens; `id` names the group's label. */
function collectionTogglesHtml(tags, id, label) {
  return `<p class="field field-label" id="${id}">${esc(label)}</p>
    <div class="meal-buttons tag-buttons" role="group" aria-labelledby="${id}">
      ${COLLECTIONS.map(c => `<button type="button" data-tag-toggle="${c.key}" aria-pressed="${tags.includes(c.key)}">${esc(c.toggle)}</button>`).join('')}
    </div>`;
}

/** Turns a toggle button on or off on screen; returns whether it's now on. */
function flipToggle(el) {
  const on = el.getAttribute('aria-pressed') !== 'true';
  el.setAttribute('aria-pressed', on);
  return on;
}

/**
 * "Method": the numbered steps in large type, after the ingredients. Steps
 * written from the video say so, with a nudge to check quantities. Without
 * steps, Mom gets a way to add them; guests see nothing.
 */
function methodHtml(r) {
  const steps = r.steps || [];
  if (!steps.length) {
    return canEdit(r) && !isGuest()
      ? `<h2 class="section">Method</h2><p class="muted method-empty">No steps yet. <button type="button" class="inline-link" data-action="edit-recipe">Add them</button> or follow the video.</p>`
      : '';
  }
  return `<h2 class="section">Method</h2>
    <ol class="method">${steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
    ${r.steps_source === 'video' ? '<p class="muted small method-note">Steps written from the video. Check quantities with the video if unsure.</p>' : ''}`;
}

/**
 * "Last made 5 days ago"; while editing, her photo button instead. Guests don't
 * add photos, so on their own recipes it's just the first.
 */
function recipeMadeHtml(r) {
  if (!canEdit(r)) return '';
  // Editing: only the photo (her own photo is part of editing the recipe).
  if (String(state.editing) === String(r.row)) {
    return isGuest() ? '' : `<div class="quick-actions">
      <button class="link-btn" data-action="photo">${r.photo_path ? 'Change photo' : 'Add my photo'}</button>
      <input id="r-photo" type="file" accept="image/*" hidden></div>`;
  }
  // "I cooked this" further down marks it as made (it replaced "I made this today").
  const made = madeText(r);
  return made ? `<p class="muted made">${esc(made)}</p>` : '';
}

/** Mom's rating, the way a guest reads it on her recipe. */
function momSays(r) {
  switch (statusOf(r)) {
    case STATUS.loved: return 'Mom loved this';
    case STATUS.okay: return 'Mom thought it was okay';
    case STATUS.skip: return 'Mom would skip it next time';
    default: return 'Mom hasn’t tried it yet';
  }
}

/**
 * "Shows in: Lunch, Dinner · Change". Change opens the six meals as toggles
 * (the same quiet buttons as "Move to"); each tap saves straight away.
 */
function mealsHtml(r) {
  const meals = mealsOf(r);
  const open = String(state.mealsOpen) === String(r.row);
  const line = `<p class="muted meals-line">${meals.length ? `Shows in: ${esc(meals.join(', '))}` : 'Not in any meal yet'} · <button type="button" class="inline-link" data-action="${open ? 'meals-close' : 'meals-open'}" aria-expanded="${open}">${open ? 'Done' : 'Change'}</button></p>`;
  if (!open) return line;
  return `${line}
    <div class="meals-edit">
      <p class="chooser-label">Show this dish in</p>
      <div class="meal-buttons" role="group" aria-label="Meals this dish shows in">
        ${MEAL_NAMES.map(m => `<button type="button" data-meal-toggle="${m}" aria-pressed="${meals.includes(m)}">${m}</button>`).join('')}
      </div>
      ${mealsChosen(r) ? `<button type="button" class="link-btn meals-reset" data-action="meals-reset">Reset to category${categoryMeals(categoryOf(r)).length ? ` (${esc(categoryMeals(categoryOf(r)).join(', '))})` : ''}</button>` : ''}
    </div>`;
}

function refreshMeals(r) {
  const box = $('#r-meals');
  if (box && location.hash === `#recipe/${r.row}`) box.innerHTML = mealsHtml(r);
}

// Meal changes are saved one after another, so a quick second tap can't be
// overtaken by the first one's answer.
let mealsSaving = Promise.resolve();
let mealsSaveCount = 0;

/** Shows the new meals straight away and saves them; null goes back to the category's. */
function saveMeals(r, meals, message) {
  // Choosing exactly what the category gives is the same as not choosing.
  const same = meals && meals.join() === categoryMeals(categoryOf(r)).join();
  const value = !meals || same ? null : meals;
  const before = r.meals;
  const row = r.row;
  const n = ++mealsSaveCount;
  replaceRecipe({ ...r, meals: value });
  refreshMeals(findRecipe(row));
  mealsSaving = mealsSaving.then(async () => {
    try {
      await updateRecipe(findRecipe(row) || r, { meals: value });
      if (n === mealsSaveCount) toast(message);
      // A later tap is still on its way: keep showing that one.
      else replaceRecipe({ ...findRecipe(row), meals: latestMeals });
    } catch (e) {
      if (n !== mealsSaveCount) return;
      replaceRecipe({ ...findRecipe(row), meals: before });
      refreshMeals(findRecipe(row));
      toast(offlineMessage(e));
    }
  });
  latestMeals = value;
  return mealsSaving;
}
let latestMeals = null;

/** Turns one meal on or off for a dish. At least one meal stays on. */
function toggleMeal(r, meal) {
  const now = mealsOf(r);
  const on = !now.includes(meal);
  const next = on ? MEAL_NAMES.filter(m => now.includes(m) || m === meal) : now.filter(m => m !== meal);
  if (!next.length) return toast('Keep at least one meal');
  return saveMeals(r, next, `Now shows in ${andList(next)}`);
}

/** One ingredient: tap to put it on the shopping list, tap again to take it off. */
function ingredientButton(r, x, i) {
  if (!SHOPPING) return esc(x);
  const on = !!onList(r, x);
  return `<button class="ing" data-ing="${i}" aria-pressed="${on}">
    <span>${esc(x)}</span><span class="mark" aria-hidden="true">${on ? '✓ On list' : '+'}</span>
  </button>`;
}

/**
 * Redraws just the picture and "last made" parts of the recipe screen, so
 * anything she's typed in the fields below isn't lost.
 */
function refreshRecipeTop(r) {
  const pic = $('#r-picture'), made = $('#r-made');
  if (!pic || !made) return;
  pic.innerHTML = pictureHtml(r);
  made.innerHTML = recipeMadeHtml(r);
  loadPhotos();
}

function refreshIngredients(r) {
  if (location.hash !== `#recipe/${r.row}`) return;
  document.querySelectorAll('.ing[data-ing]').forEach(b => {
    b.outerHTML = ingredientButton(r, r.ingredients[b.dataset.ing], b.dataset.ing);
  });
}

async function toggleIngredient(r, i) {
  const x = String(r.ingredients[i] || '').trim();
  if (!x) return;
  const item = onList(r, x);
  const done = item ? removeShopping([item]) : addShopping(x, r.row);
  refreshIngredients(r);
  if (await done) toast(item ? `Took ${x} off your list` : `Added ${x} to your list`);
  refreshIngredients(r);
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
  // Method: one step per line. Changing it makes it hers ('mom'): no "from the video" note.
  const stepsBox = $('#r-steps');
  if (stepsBox) {
    const steps = stepsBox.value.split('\n').map(x => x.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
    if (steps.join('\n') !== (r.steps || []).join('\n')) {
      changed.steps = steps;
      changed.steps_source = steps.length ? 'mom' : null;
    }
  }
  // Collections: the toggles that are on, plus any key this version doesn't know.
  const on = [...document.querySelectorAll('[data-tag-toggle][aria-pressed=true]')].map(b => b.dataset.tagToggle);
  const tags = tidyTags([...on, ...tagsOf(r).filter(t => !collectionOf(t))]);
  if (tags.join() !== tidyTags(tagsOf(r)).join()) changed.tags = tags;
  return changed;
}

// ---------- views: Plan ----------
// Any of the next seven days: a strip of days at the top, then the meals with
// the dishes she's planned for each. "+ Add dish" opens the picker
// (#plan/<day>/<Meal>), where tapping tiles puts dishes on straight away.

/** Today, Tomorrow, Sat 11…: only this row scrolls sideways. `dots` marks days that have dishes. */
function dayStripHtml(selected, attr, dots) {
  // A day picked from the calendar sits after the week, so it's still on the strip.
  const days = planDays();
  if (plannable(selected) && !days.includes(selected)) days.push(selected);
  return `<div class="day-strip" role="group" aria-label="Day">${days.map(d => `
    <button type="button" data-${attr}="${d}" aria-pressed="${d === selected}">${esc(dayShort(d))}${
      dots && plannedFor(d).length ? '<span class="day-dot" aria-hidden="true"></span>' : ''}</button>`).join('')}
  </div>`;
}

/**
 * "Pick a date": a button that opens the phone's own calendar, for any day up
 * to a year ahead. Kept outside the day row so it's always in sight.
 */
function datePickHtml(selected, attr) {
  const today = dayKey();
  return `<label class="day-pick">${iconSvg('calendar')}<span>Pick a date</span>
    <input type="date" data-pick-date="${attr}" min="${today}" max="${addDays(today, PLAN_AHEAD_DAYS)}" value="${plannable(selected) ? selected : today}" aria-label="Pick a date to plan for">
  </label>`;
}

/** Scrolls a day strip just enough to show its chosen day. */
function showChosenDay(strip) {
  const b = strip && strip.querySelector('[aria-pressed=true]');
  if (!b) return;
  const left = b.offsetLeft - 16, right = b.offsetLeft + b.offsetWidth + 16 - strip.clientWidth;
  if (strip.scrollLeft > left) strip.scrollLeft = left;
  else if (strip.scrollLeft < right) strip.scrollLeft = right;
}

/** One line per dish, with a quiet "×2" when it's on more than once. ✕ takes off one copy (the newest). */
function planDishHtml({ r, copies }) {
  const n = copies.length;
  const name = esc(displayName(r));
  return `<li class="plan-dish">
    <a class="plan-dish-link" href="#recipe/${r.row}">
      <span class="plan-icon tint-${tileTint(r)}">${iconSvg(iconFor(r))}</span>
      <span class="plan-dish-name">${name}</span>${n > 1 ? `<span class="plan-times"><span class="sr-only">, planned </span>×${n}<span class="sr-only"> times</span></span>` : ''}
    </a>
    <button type="button" class="plan-remove" data-plan-remove="${copies[n - 1].id}" aria-label="${n > 1 ? `Take one ${name} off the plan` : `Take ${name} off the plan`}">✕</button>
  </li>`;
}

function planMealHtml(day, meal) {
  const groups = groupByDish(plannedFor(day, meal));
  return `<section class="plan-meal">
    <h2 class="plan-meal-name">${esc(meal)}</h2>
    ${groups.length ? `<ul class="plan-dishes">${groups.map(planDishHtml).join('')}</ul>` : ''}
    <a class="plan-add" href="#plan/${day}/${meal}">+ Add dish</a>
  </section>`;
}

function renderPlan() {
  const day = currentPlanDay();
  const shown = MEAL_NAMES.filter(m => ALWAYS_PLANNED.includes(m) || state.planExtras || plannedFor(day, m).length);
  const more = MEAL_NAMES.filter(m => !shown.includes(m));
  view().innerHTML = `<div class="plan">
    <h1 class="sr-only">Plan for ${esc(dayWord(day))}</h1>
    <div class="plan-head">
      <p class="meal-kicker">Meal plan</p>
      ${datePickHtml(day, 'plan-day')}
    </div>
    <p class="plan-day-word" aria-hidden="true">${esc(capital(dayWord(day)))}</p>
    ${dayStripHtml(day, 'plan-day', true)}
    ${shown.map(m => planMealHtml(day, m)).join('')}
    ${more.length ? `<button type="button" class="link-btn plan-more" data-action="plan-extras">Add ${esc(more.map(m => m.toLowerCase()).join(' or '))}</button>` : ''}
    ${SHOPPING && plannedFor(day).length ? '<button type="button" class="btn block plan-shop" data-action="plan-shop">Add ingredients to list</button>' : ''}
  </div>`;
  showChosenDay($('.day-strip'));
}

/** Redraws the Plan tab where she is: same scroll, same place on the day strip. */
function refreshPlan() {
  const y = window.scrollY;
  const strip = $('.day-strip');
  const x = strip ? strip.scrollLeft : 0;
  renderPlan();
  const now = $('.day-strip');
  if (now) { now.scrollLeft = x; showChosenDay(now); }
  window.scrollTo(0, y);
}

/**
 * Puts every planned dish's ingredients on the shopping list for that dish,
 * the same as tapping them on the recipe, leaving out what's already on the
 * list (and not ticked) for it. A dish planned more than once (×2, or in two
 * meals) only adds its ingredients once.
 */
async function addPlanToList(btn) {
  const planned = plannedFor(currentPlanDay());
  const seen = new Set();
  const adds = [];
  let any = false;
  for (const p of planned) {
    const r = findRecipe(p.recipe_id);
    if (seen.has(r.row)) continue;
    seen.add(r.row);
    const keys = new Set();
    for (const raw of r.ingredients) {
      const x = String(raw).trim();
      const key = x.toLowerCase();
      if (!x) continue;
      any = true;
      if (keys.has(key) || onList(r, x)) continue;
      keys.add(key);
      adds.push(addShopping(x, r.row));
    }
  }
  if (!adds.length) {
    toast(any ? 'Everything’s already on your list' : 'These dishes don’t have ingredients yet');
    return;
  }
  btn.disabled = true;
  const added = (await Promise.all(adds)).filter(Boolean).length;
  btn.disabled = false;
  if (added) toast(`Added ${added} thing${added === 1 ? '' : 's'} to your list`);
}

// ---------- views: the add-dish picker ----------

/** { day, meal } for #plan/<day>/<Meal>, or null. Only days on the strip. */
function pickerRoute(hash = location.hash) {
  const m = /^#plan\/(\d{4}-\d{2}-\d{2})\/([A-Za-z]+)$/.exec(hash);
  if (!m || !plannable(m[1])) return null;
  const meal = MEAL_NAMES.find(n => n.toLowerCase() === m[2].toLowerCase());
  return meal ? { day: m[1], meal } : null;
}

/** "Skip next time" dishes go to the end; she might still want one. */
function skipLast(list) {
  const skip = r => statusOf(r) === STATUS.skip;
  return [...list.filter(r => !skip(r)), ...list.filter(skip)];
}

/**
 * What the picker shows: the meal's own dishes then what goes on the side
 * (from MEALS, never storage ideas), or with something in the search box,
 * any meal dish that matches it.
 */
function pickerGroups(meal, q) {
  const terms = searchTerms(q);
  const newestFirst = (a, b) => b.row - a.row;
  if (terms.length) {
    return [{ title: '', items: skipLast(mealRecipes().filter(r => !missingTerms(r, terms).length).sort(newestFirst)) }];
  }
  const main = mainDishes(meal);
  const inMain = new Set(main.map(r => r.row));
  const side = mealRecipes()
    .filter(r => placeIn(r, meal) === 'side' && !inMain.has(r.row))
    .sort(newestFirst);
  return [
    { title: capital(MEALS[meal].dishes), items: skipLast(main) },
    { title: 'On the side', items: skipLast(side) },
  ].filter(g => g.items.length);
}

/** The badge on a picker tile: ✓ for one, ×2, ×3… for more. */
const pickBadge = n => (n > 1 ? `×${n}` : '✓');
const pickSr = n => (n > 1 ? `, on the plan ${n} times` : n ? ', on the plan' : '');

/**
 * A picker tile: tapping it always adds one more. Once it's on, a count badge
 * shows (✓, ×2, ×3) and a small "−" in the corner takes one off. The "−" sits
 * beside the tile button, not inside it.
 */
function pickTileHtml(r, day, meal) {
  const n = planCopies(day, meal, r.row).length;
  const name = esc(displayName(r));
  return `<div class="pick-tile" data-pick-tile="${r.row}">
    <button type="button" class="square tint-${tileTint(r)}" data-pick="${r.row}" aria-pressed="${n > 0}">
      ${iconSvg(iconFor(r))}
      <span class="name${String(r.name).trim() ? '' : ' untitled'}">${name}</span>
      <span class="picked" aria-hidden="true">${pickBadge(n)}</span>
      <span class="sr-only pick-sr">${pickSr(n)}</span>
    </button>
    <button type="button" class="pick-less" data-pick-less="${r.row}" aria-label="Take one ${name} off"${n ? '' : ' hidden'}><span aria-hidden="true">−</span></button>
  </div>`;
}

function renderPicker(day, meal) {
  view().innerHTML = `
    ${backHtml()}
    <div class="picker-head">
      <h1 class="picker-title">${esc(capital(`Add to ${mealPhrase(day, meal)}`))}</h1>
      <button type="button" class="primary picker-done" data-action="plan-done">Done</button>
    </div>
    <form class="search-row picker-search" data-pick-search>
      <label class="sr-only" for="plan-search">Search</label>
      <input id="plan-search" type="search" enterkeyhint="search" placeholder="Search any dish or ingredient" value="${esc(state.pickQ || '')}" autocomplete="off">
    </form>
    <div id="pick-list"></div>
  `;
  renderPickerGrid();
}

function renderPickerGrid() {
  const el = $('#pick-list');
  const route = pickerRoute();
  if (!el || !route) return;
  const groups = pickerGroups(route.meal, state.pickQ || '');
  const searching = searchTerms(state.pickQ || '').length > 0;
  const n = groups.reduce((sum, g) => sum + g.items.length, 0);
  el.innerHTML = !n
    ? `<p class="muted empty">${state.recipes.length ? (searching ? 'No dishes match.' : 'No dishes for this meal yet. Try the search.') : 'Loading your recipes…'}</p>`
    : groups.map(g => `
      ${g.title ? `<h2 class="section pick-heading">${esc(g.title)} <span class="count">${g.items.length}</span></h2>`
        : `<p class="muted small pick-count">${n} dish${n === 1 ? '' : 'es'}</p>`}
      <div class="squares">${g.items.map(r => pickTileHtml(r, route.day, route.meal)).join('')}</div>`).join('');
}

/** Updates the picker's counts and "−"s, without redrawing (so nothing jumps). */
function refreshPickerTiles() {
  const route = pickerRoute();
  if (!route) return;
  document.querySelectorAll('[data-pick-tile]').forEach(t => {
    const n = planCopies(route.day, route.meal, t.dataset.pickTile).length;
    const b = t.querySelector('[data-pick]');
    b.setAttribute('aria-pressed', n > 0);
    b.querySelector('.picked').textContent = pickBadge(n);
    b.querySelector('.pick-sr').textContent = pickSr(n);
    t.querySelector('[data-pick-less]').hidden = !n;
  });
}

/** Done: back to the plan for that day, the way she came if she came from it. */
function leavePicker() {
  const route = pickerRoute();
  if (route) state.planDay = route.day;
  const prev = nav.hashes[nav.idx - 1];
  if (nav.idx > 0 && prev && /^#plan(\/\d{4}-\d{2}-\d{2})?$/.test(prev)) return history.back();
  navReplace('#plan');
}

// ---------- "Add to plan" on a recipe ----------

/**
 * The meal a dish goes under when she adds it from its page: the meal she was
 * looking at on Today, else the meal its category belongs to (for Main Course,
 * the one for now if it fits), else the meal for the time of day.
 */
function planMealFor(r) {
  const ctx = state.recipeCtx;
  const meals = mealsOf(r);
  // (Unless she has since taken the dish out of that meal.)
  if (ctx && String(ctx.row) === String(r.row) && ctx.meal && meals.includes(ctx.meal)) return ctx.meal;
  const now = mealAt();
  const mains = meals.filter(m => placeIn(r, m) === 'main');
  if (mains.includes(now)) return now;
  if (mains.length) return mains[0];
  // Only ever on the side (chutneys, drinks with a meal): the meal for now,
  // unless she chose meals for it and now isn't one of them.
  if (!mealsChosen(r) || meals.includes(now)) return now;
  return meals[0];
}

/**
 * Where this dish is planned, as far as its page cares: today, else the day
 * "Change" just moved it to. { day, meals: [{ meal, n }] } with the meal it
 * would go under first, or null.
 */
function recipePlanSpot(r) {
  const mine = state.plan.filter(p => String(p.recipe_id) === String(r.row));
  const lp = state.lastPlanned;
  const day = mine.some(p => p.day === dayKey()) ? dayKey()
    : lp && String(lp.row) === String(r.row) && mine.some(p => p.day === lp.day) ? lp.day : null;
  if (!day) return null;
  const first = planMealFor(r);
  const meals = MEAL_NAMES
    .map(meal => ({ meal, n: mine.filter(p => p.day === day && p.meal === meal).length }))
    .filter(m => m.n)
    .sort((a, b) => (b.meal === first) - (a.meal === first));
  return { day, meals };
}

/** "On today’s lunch ×2", "On today’s lunch and dinner". */
function planSpotText({ day, meals }) {
  const parts = meals.map((m, i) => (i ? m.meal.toLowerCase() : mealPhrase(day, m.meal)) + timesText(m.n));
  return `On ${andList(parts)}`;
}

/** "Add to plan" always adds one more; a quiet note under it says where it already is. */
function recipePlanHtml(r) {
  if (isRemoved(r)) return '';
  const spot = recipePlanSpot(r);
  const btn = '<button type="button" class="btn block plan-btn" data-action="add-plan">Add to plan</button>';
  const note = spot
    ? `<button type="button" class="plan-note" data-action="open-plan" data-day="${spot.day}"><span class="plan-tick" aria-hidden="true">✓</span>${esc(planSpotText(spot))}</button>`
    : '';
  const c = state.choose;
  return btn + note + (c && String(c.row) === String(r.row) ? chooserHtml(c) : '');
}

/** "Change": the days, then the meals. Tapping a meal moves the dish there. */
function chooserHtml(c) {
  return `<div class="chooser" id="r-chooser">
    <p class="chooser-label">Move to</p>
    ${dayStripHtml(c.pickDay, 'choose-day', false)}
    ${datePickHtml(c.pickDay, 'choose-day')}
    <div class="meal-buttons" role="group" aria-label="Meal">
      ${MEAL_NAMES.map(m => `<button type="button" data-choose-meal="${m}" aria-pressed="${c.pickDay === c.day && m === c.meal}">${m}</button>`).join('')}
    </div>
    <button type="button" class="link-btn chooser-keep" data-action="choose-close">Leave it on ${esc(mealPhrase(c.day, c.meal))}</button>
  </div>`;
}

function refreshRecipePlan(r) {
  const box = $('#r-plan');
  if (!box) return;
  const strip = box.querySelector('.day-strip');
  const x = strip ? strip.scrollLeft : 0;
  box.innerHTML = recipePlanHtml(r);
  const now = box.querySelector('.day-strip');
  if (now) { now.scrollLeft = x; showChosenDay(now); }
}

/** One tap: one more on today's plan under the meal that fits, with "Change" (for that copy) in the message. */
function addToPlan(r) {
  const day = dayKey(), meal = planMealFor(r);
  state.choose = null;
  const { entry, done } = planOneMore(day, meal, r.row);
  state.lastPlanned = { row: r.row, day, meal, entry };
  toast(`Added to ${mealPhrase(day, meal)}`, { label: 'Change', run: () => openChooser(r.row) });
  return done;
}

function openChooser(row) {
  const lp = state.lastPlanned;
  const e = lp && String(lp.row) === String(row) && currentCopy(lp.entry);
  if (!e) return;
  state.choose = { row: String(row), day: e.day, meal: e.meal, entry: e, pickDay: e.day };
  if (location.hash !== `#recipe/${row}`) { location.hash = `#recipe/${row}`; return; }
  const r = findRecipe(row);
  if (r) refreshRecipePlan(r);
  const box = $('#r-chooser');
  if (box) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function chooseMeal(r, meal) {
  const c = state.choose;
  state.choose = null;
  const e = c && currentCopy(c.entry);
  if (!e || (c.pickDay === c.day && meal === c.meal)) return refreshRecipePlan(r);
  const { entry, done } = movePlan(e, c.pickDay, meal);
  state.lastPlanned = { row: r.row, day: c.pickDay, meal, entry };
  refreshRecipePlan(r);
  toast(`Moved to ${mealPhrase(c.pickDay, meal)}`);
  return done;
}

// ---------- views: List ----------

/** The list grouped by dish, in the order things were added; "Other" (typed by hand) last. */
function shoppingGroups() {
  const groups = new Map();
  for (const s of state.shopping) {
    const r = s.recipe_id != null ? findRecipe(s.recipe_id) : null;
    const name = r ? displayName(r) : 'Other';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(s);
  }
  const other = groups.get('Other');
  groups.delete('Other');
  if (other) groups.set('Other', other);
  return [...groups].map(([name, items]) => ({ name, items }));
}

function renderShopping() {
  const groups = shoppingGroups();
  const ticked = state.shopping.filter(s => s.done).length;
  view().innerHTML = `
    <h1>Shopping list</h1>
    <p class="muted">Tap ingredients on a recipe to add them here.</p>

    <label class="field" for="add-item">Add an item</label>
    <form class="search-row" data-add-item>
      <input id="add-item" type="text" placeholder="Milk" autocomplete="off" enterkeyhint="done">
      <button type="submit">Add</button>
    </form>

    ${groups.length ? groups.map(g => `
      <h2 class="shop-dish">${esc(g.name)}</h2>
      <ul class="shop-items">
        ${g.items.map(s => `<li><button class="shop-item" data-item="${s.id}" aria-pressed="${s.done}">
          <span class="tick" aria-hidden="true">${s.done ? '✓' : ''}</span><span class="text">${esc(s.item)}</span>
        </button></li>`).join('')}
      </ul>`).join('') : '<p class="muted empty">Your list is empty.</p>'}

    ${ticked ? '<button class="link-btn block" style="margin-top:16px" data-action="clear-ticked">Clear ticked</button>' : ''}
  `;
}

/** Redraws the List screen if it's showing, keeping whatever she's typing in "Add an item". */
function refreshShopping() {
  if (location.hash !== '#list' || !state.user) return;
  const input = $('#add-item');
  const typed = input ? input.value : '';
  const focused = input && document.activeElement === input;
  const y = window.scrollY;
  renderShopping();
  $('#add-item').value = typed;
  if (focused) $('#add-item').focus({ preventScroll: true });
  window.scrollTo(0, y);
}

// ---------- views: Add ----------

function newDraft(link = '') {
  return { link, name: '', category: '', status: STATUS.toTry, notes: '', tags: [], title: '', force: false, error: '' };
}

function renderAdd() {
  if (!state.draft) state.draft = newDraft();
  const d = state.draft;
  const dup = d.link && !d.force ? findByLink(d.link) : null;
  const preview = d.link && !dup ? pictureHtml({ link: d.link }) : '';

  view().innerHTML = `
    <h1>Add a recipe</h1>
    <p class="muted">${isGuest()
      ? 'Paste a link, or share one straight from YouTube, Instagram or Facebook. It’s saved for you; Mom’s recipes stay as they are.'
      : 'Paste a link, or share one straight from YouTube, Instagram or Facebook.'}</p>

    <label class="field" for="a-link">Link</label>
    <input id="a-link" type="url" inputmode="url" value="${esc(d.link)}" placeholder="https://youtube.com/…">
    ${d.error ? `<p class="error">${esc(d.error)}</p>` : ''}
    ${dup && isGuest() && !isMine(dup) ? `<p class="warning">Mom already has this: “${esc(displayName(dup))}”.
      <a href="#recipe/${dup.row}">Open it</a> or <button class="inline-link" data-action="save-anyway">save your own copy</button>.</p>`
      : dup ? `<p class="warning">You already saved this as “${esc(displayName(dup))}”.
      <a href="#recipe/${dup.row}">Open it</a> or <button class="inline-link" data-action="save-anyway">save it again</button>.</p>` : ''}
    ${preview ? `<div style="margin-top:12px">${preview}</div>` : ''}

    <label class="field" for="a-name">Name</label>
    <input id="a-name" type="text" value="${esc(d.name)}" placeholder="Kappa biryani" autocomplete="off">
    ${d.title && d.title !== d.name ? `<p class="muted small hint">Video title: ${esc(d.title)}</p>` : ''}

    <label class="field" for="a-category">Category</label>
    <select id="a-category">${categoryOptions(d.category)}</select>

    <label class="field" for="a-status">Status</label>
    <select id="a-status">${statusOptions(d.status)}</select>

    ${collectionTogglesHtml(tagsOf(d), 'a-tags-label', 'Collections (optional)')}

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
      { link: d.link, name: d.name, category: d.category, status: d.status, notes: d.notes, tags: tagsOf(d) },
      d.force,
    );
    // A repeat found in the database is put in the list so "Open it" works,
    // unless it's there already (a guest's copy of one of their own has no notes).
    if (!data.duplicate || !findRecipe(data.recipe.row)) replaceRecipe(data.recipe);
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

// ---------- views: the welcome screen and sign-in (signed out) ----------
// The plain address shows one calm screen: family type their name and the
// family code and come in as guests. Nothing on it points at an email
// sign-in. Mom and Sharon sign in at #signin (…/#signin), once per phone.

/**
 * The signed-out welcome. With an old family link (#join=<code>) the code
 * comes from the link and its field is hidden. `keep` puts back what was
 * typed and an error under the code: { name, error }.
 */
function renderWelcome(keep = {}) {
  const link = joinCodeFrom(location.hash);
  const notice = state.notice;
  view().innerHTML = `
    <h1 class="join-title">${esc(notice ? notice.title : 'Welcome!')}</h1>
    <p class="join-text">${esc(notice ? notice.text : 'Mom’s recipes, on your phone.')}</p>
    <form id="join" class="welcome-family" data-link="${esc(link)}" data-notice="${notice ? 'yes' : ''}" novalidate>
      <label class="field" for="j-name">Your name</label>
      <input id="j-name" type="text" autocomplete="given-name" autocapitalize="words" maxlength="40" enterkeyhint="${link ? 'go' : 'next'}" value="${esc(keep.name || '')}" aria-describedby="j-name-error">
      <p class="error" id="j-name-error" hidden></p>
      ${link ? '' : `<label class="field" for="j-code">Family code</label>
      <input id="j-code" type="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="64" enterkeyhint="go" aria-describedby="j-error">`}
      <p class="error" id="j-error"${keep.error ? '' : ' hidden'} role="alert">${esc(keep.error || '')}</p>
      <button class="primary block join-go" type="submit">Continue as guest</button>
    </form>
  `;
}

/** #signin: the email and password form for Mom and Sharon. */
function renderSignIn() {
  view().innerHTML = `
    <h1 class="join-title">Sign in</h1>
    <p class="join-text">Sign in once and this phone will remember you.</p>
    <form id="sign-in" novalidate>
      <label class="field" for="s-email">Email</label>
      <input id="s-email" type="email" inputmode="email" autocomplete="username" autocapitalize="off" spellcheck="false">
      <label class="field" for="s-password">Password</label>
      <input id="s-password" type="password" autocomplete="current-password">
      <p class="error" id="s-error" hidden></p>
      <button class="primary block" style="margin-top:20px" type="submit">Sign in</button>
    </form>
    <p class="member-ask">Family? <a class="inline-link" href="#today">Continue as guest</a></p>
  `;
}

// ---------- views: Visitors (the guest list for Sharon only, allowed_users.admin; the family code for both) ----------
// Who came in as a guest and when, the family code to send again, a way to
// change it to something easy to remember, and a way to make a random one.

/** "just now", "5 minutes ago", "yesterday", "2 days ago", "3 weeks ago". */
function timeAgo(iso) {
  const then = new Date(iso);
  if (isNaN(then)) return '';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  const ago = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (mins < 1) return 'just now';
  if (mins < 60) return ago(mins, 'minute');
  if (mins < 24 * 60) return ago(Math.floor(mins / 60), 'hour');
  const day = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(new Date()) - day(then)) / 86400000);
  if (days <= 1) return 'yesterday';
  if (days < 14) return ago(days, 'day');
  if (days < 60) return ago(Math.floor(days / 7), 'week');
  if (days < 365) return ago(Math.floor(days / 30), 'month');
  return ago(Math.floor(days / 365), 'year');
}

/** The address family open, as written in the message: "https://cookery-five.vercel.app". */
const appAddress = () => `${location.origin}${location.pathname}`.replace(/\/(index\.html)?$/, '');

/** What Share and Copy send to the family. */
const codeMessage = code => `Open ${appAddress()} and tap Continue as guest. Family code: ${code}`;

let visitorsLoading = false;
async function loadVisitors() {
  if (visitorsLoading || !state.user || isGuest()) return;
  visitorsLoading = true;
  try {
    await requireSession();
    // Mom gets the family code only; who came in is for Sharon (admin) alone.
    const none = Promise.resolve([]);
    // Guests' own plans and recipes are theirs: Sharon gets only how many (guest_counts, 014).
    const [guests, code, totals] = await Promise.all([
      state.admin ? query(db().from('guests').select('user_id, name, first_seen, last_seen').order('last_seen', { ascending: false })) : none,
      query(db().rpc('get_family_code')),
      state.admin ? query(db().rpc('guest_counts')).catch(() => []) : none,
    ]);
    const counts = {};
    (totals || []).forEach(t => { counts[t.user_id] = { planned: Number(t.planned) || 0, added: Number(t.added) || 0 }; });
    state.visitors = { ...(state.visitors || {}), guests, counts, code, error: '' };
  } catch (e) {
    state.visitors = { ...(state.visitors || { guests: [], counts: {} }), error: offlineMessage(e) };
  } finally {
    visitorsLoading = false;
  }
  if (location.hash !== '#me') return;
  if ($('#v-link')) refreshVisitors(); // already up: leave the Change code box alone
  else renderMe();
}

// ---------- the You page (#me) ----------
// One place for who's signed in and the grown-up things, instead of links at
// the bottom of Today: your name at the top (a guest can fix theirs), "What
// I've cooked", then for Sharon the people who came in, for Mom and Sharon the
// family code, and Sign out (or Leave guest mode) at the bottom. #visitors,
// the old address, opens it too.

function renderMe() {
  const guest = isGuest();
  if (!guest && !state.visitors) loadVisitors();
  const name = myDisplayName();
  const posts = state.cooked.filter(myPost).length;
  const people = state.visitors && state.visitors.guests ? state.visitors.guests.length : 0;
  const likes = likesOnMine();
  // Seen now: they stay marked "new" on this visit, and the dot goes.
  if (likes.some(l => l.fresh)) setTimeout(markLikesSeen, 0);
  view().innerHTML = `
    ${backHtml()}
    <header class="me-head">
      <span class="me-avatar" aria-hidden="true">${esc(name === 'You' ? '?' : [...name][0].toUpperCase())}</span>
      <div class="me-who">
        <p class="meal-kicker">Signed in as</p>
        <h1 class="me-name">${esc(name)}</h1>
        <p class="muted small me-sub">${guest ? 'Guest, with the family code' : esc(state.user || '')}</p>
      </div>
    </header>
    ${guest ? `<div id="me-rename">${renameHtml()}</div>` : `<div id="me-switch">${switchHtml()}</div>`}

    <button type="button" class="btn block me-cooked" data-action="my-cooked">${iconSvg('camera')}What I’ve cooked${posts ? ` <span class="count">${posts}</span>` : ''}</button>

    ${likesNoticeHtml(likes)}

    ${state.admin && !guest ? `
      <section class="me-section">
        <h2 class="section">People${people ? ` <span class="count">${people}</span>` : ''}</h2>
        <p class="muted small">Family who came in with the family code. Only you see this.</p>
        <div id="v-list">${visitorsListHtml()}</div>
      </section>` : ''}

    ${guest ? '' : `
      <section class="me-section">
        <h2 class="section">Family code</h2>
        <p class="muted small">Family open the app, tap Continue as guest and type this.</p>
        <div id="v-link">${familyCodeHtml()}</div>
      </section>`}

    <div class="me-out">
      <button type="button" class="btn block" data-action="${guest ? 'leave-guest' : 'sign-out'}">${guest ? 'Leave guest mode' : 'Sign out'}</button>
      ${state.admin && !guest ? `<p class="muted small signin-note">To sign in on a new phone: ${esc(appAddress().replace(/^https?:\/\//, ''))}/#signin</p>` : ''}
    </div>
  `;
}

/** A guest's "Change my name": a quiet link, or the box to type a new one. */
function renameHtml() {
  if (!state.renaming) return '<button type="button" class="link-btn quiet-link me-rename" data-action="rename-open">Change my name</button>';
  const now = myDisplayName() === 'You' ? '' : myDisplayName();
  return `<form id="rename-form" class="code-form" novalidate>
    <label class="field" for="me-new-name">Your name</label>
    <input id="me-new-name" type="text" maxlength="40" autocomplete="name" value="${esc(now)}" enterkeyhint="done">
    <p class="muted small hint">Your posts and likes change to the new name.</p>
    <div class="row link-actions">
      <button type="button" data-action="rename-cancel">Cancel</button>
      <button type="submit" class="primary">Save</button>
    </div>
  </form>`;
}

/**
 * "Not Mom?" on Mom's (or Sharon's) account: someone else in the family who
 * uses that account on their own phone makes the phone their own. One tap:
 * the phone leaves the account and comes back in as a guest under their name
 * (the app knows the family code), and their posts come with them.
 */
function switchHtml() {
  const account = myDisplayName();
  if (!state.switching) {
    return `<button type="button" class="link-btn quiet-link me-rename" data-action="switch-open">Not ${esc(account)}? Make this phone your own</button>`;
  }
  return `<form id="switch-form" class="code-form switch-form" novalidate>
    <label class="field" for="switch-name">Who’s using this phone?</label>
    <input id="switch-name" type="text" maxlength="40" autocomplete="name" enterkeyhint="done" placeholder="Your name">
    <p class="muted small hint">This phone stops using ${esc(account)}’s account and comes back in as you, as a guest: your own plan, your own posts, and ${esc(account)}’s recipes to cook from. Posts already made from here under your name come with you. ${esc(account)}’s own phone isn’t touched.</p>
    <div class="row link-actions">
      <button type="button" data-action="switch-cancel">Cancel</button>
      <button type="submit" class="primary">Switch to me</button>
    </div>
  </form>`;
}

/** The one-tap switch from Mom's account to the phone's own guest. */
async function switchToOwn(form) {
  const input = $('#switch-name');
  const btn = form.querySelector('button[type=submit]');
  const name = input.value.replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!name) { input.focus(); return toast('Type your name first'); }
  if (name.toLowerCase() === myDisplayName().toLowerCase()) { input.focus(); return toast(`Type your own name, not ${myDisplayName()}’s`); }
  btn.disabled = true;
  btn.textContent = 'Switching…';
  let code = '', token = null;
  try {
    await requireSession();
    code = await query(db().rpc('get_family_code'));
    if (!code) throw new Error('There’s no family code yet. Sharon can make one on her You page.');
    // Before migration 013 there's no handover: the switch still works, the posts just stay.
    try { token = await query(db().rpc('start_handover', { name })); } catch (e) {
      if (e && e.code === '22023') throw e; // a name it won't take (the account's own, or Mom's or Sharon's)
      token = null;
    }
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Switch to me';
    return toast(e && e.code === '22023' ? e.message : offlineMessage(e));
  }
  // The account's own sign-in is kept until the guest one has worked: if
  // joining fails (no internet, or joining is paused), the phone goes back to
  // the account as it was.
  const { data: { session: before } } = await db().auth.getSession();
  joining = true; // checkSession waits
  try {
    await joinFamily(code, name);
  } catch (e) {
    let back = false;
    try {
      if (before) back = !(await db().auth.setSession({ access_token: before.access_token, refresh_token: before.refresh_token })).error;
    } catch (err) { back = false; }
    joining = false;
    if (back) {
      setMember(before.user.email);
      setUid(before.user.id);
      state.switching = true;
      history.replaceState({ idx: nav.idx }, '', location.pathname + '#me');
      nav.hashes[nav.idx] = '#me';
      loadRecipes({ quiet: true });
      loadCooked();
      loadMyName();
      render();
      return toast(`Couldn’t switch: ${e.message === 'wrong-code' ? 'the family code has changed' : joinMessage(e)}`);
    }
    // Rare: neither worked. The welcome is up with both boxes filled in; one tap tries again.
    renderWelcome({ name, error: e.message === 'wrong-code' ? WRONG_CODE : joinMessage(e) });
    const box = $('#j-code');
    if (box) box.value = code;
    return;
  }
  joining = false;
  // Now a guest: clear the account's data off this phone, and end its old
  // sign-in on the server (best effort).
  const me = state.guest;
  signedOut();
  setGuest(me.id, me.name);
  setUid(me.id);
  if (before) {
    fetch(`${SUPABASE_URL}/auth/v1/logout?scope=local`, {
      method: 'POST', headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${before.access_token}` },
    }).catch(() => {});
  }
  let moved = 0;
  if (token) { try { moved = Number(await query(db().rpc('finish_handover', { token }))) || 0; } catch (e) { moved = 0; } }
  history.replaceState({ idx: nav.idx }, '', location.pathname + '#today');
  nav.hashes[nav.idx] = '#today';
  await loadRecipes();
  loadShopping();
  loadPlan();
  loadCooked();
  loadMyName();
  render();
  toast(moved ? `This phone is now ${name}’s. Your ${moved} post${moved === 1 ? '' : 's'} came with you.` : `This phone is now ${name}’s`);
}

async function saveMyName(form) {
  const input = $('#me-new-name');
  const btn = form.querySelector('button[type=submit]');
  const name = input.value.replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!name) { input.focus(); return toast('Type your name first'); }
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    await requireSession();
    const saved = await query(db().rpc('rename_me', { name }));
    if (!saved) throw new Error('Only guests can change their name here.');
    state.myName = saved;
    store.set('myName', saved);
    state.guest = { ...state.guest, name: saved };
    store.set('guest', state.guest);
    const me = state.uid || guestId();
    state.cooked = state.cooked.map(p => (p.user === me && !p.member ? { ...p, name: saved } : p));
    state.likes = state.likes.map(l => (l.user === me ? { ...l, name: saved } : l));
    store.set('cooked', state.cooked);
    store.set('likes', state.likes);
    state.renaming = false;
    input.blur();
    renderMe();
    toast('Name saved');
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Save';
    toast(e && e.code === '22023' ? e.message : e && e.code === 'PGRST202' ? 'Changing names isn’t switched on yet. Ask Sharon.' : offlineMessage(e));
  }
}

/** Sharon's list of who came in: one line each, the initial, when, and what they did. */
function visitorsListHtml() {
  const v = state.visitors;
  if (!v) return '<p class="muted">Loading…</p>';
  if (v.error && !v.guests.length) return `<p class="muted">${esc(v.error)}</p>`;
  if (!v.guests.length) return '<p class="muted empty">Nobody yet. Send them the family code below.</p>';
  return `<ul class="visitors">${v.guests.map(g => {
    const c = v.counts[g.user_id] || { planned: 0, added: 0 };
    const posts = state.cooked.filter(p => p.user === g.user_id).length;
    const did = [
      posts ? `${posts} post${posts === 1 ? '' : 's'}` : '',
      c.planned ? `${c.planned} planned` : '',
      c.added ? `${c.added} recipe${c.added === 1 ? '' : 's'} added` : '',
    ].filter(Boolean).join(' · ');
    const asking = state.removing === g.user_id;
    return `<li class="visitor${asking ? ' asking' : ''}">
      <div class="visitor-row">
        <span class="visitor-initial" aria-hidden="true">${esc([...String(g.name || '?')][0].toUpperCase())}</span>
        <div class="visitor-text">
          <span class="visitor-name">${esc(g.name)}</span>
          <span class="visitor-sub">Here ${esc(timeAgo(g.last_seen))}${did ? ` · ${esc(did)}` : ''}</span>
        </div>
        ${asking ? '' : `<button type="button" class="link-btn danger-link visitor-remove" data-remove-guest="${esc(g.user_id)}" aria-label="Remove ${esc(g.name)}">Remove</button>`}
      </div>
      ${asking ? `<div class="remove-ask">
        <p>Remove ${esc(g.name)}? They’re signed out of the app on their phone.</p>
        <button type="button" class="btn block danger-btn" data-remove-confirm="${esc(g.user_id)}" data-with-posts="0">Remove${posts ? ', keep their posts' : ''}</button>
        ${posts ? `<button type="button" class="btn block danger-btn" data-remove-confirm="${esc(g.user_id)}" data-with-posts="1">Remove and delete their ${posts} post${posts === 1 ? '' : 's'}</button>` : ''}
        <button type="button" class="link-btn block" data-action="remove-cancel">Cancel</button>
      </div>` : ''}
    </li>`;
  }).join('')}</ul>`;
}

/** The family code, large, with Copy and Share; "Change code" opens the box (and the random one). */
function familyCodeHtml() {
  const v = state.visitors;
  if (!v) return '<p class="muted">Loading…</p>';
  if (v.changing) {
    return `<form id="code-form" class="code-form" novalidate>
        <label class="field" for="v-new-code">New family code</label>
        <input id="v-new-code" type="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="${CODE_MAX + 20}" enterkeyhint="done" aria-describedby="v-code-hint v-code-error">
        <p class="muted small hint" id="v-code-hint">Use 6 or more letters or numbers that family will remember but strangers won’t guess. People already in stay in; only new people need the new code.</p>
        <p class="error" id="v-code-error" role="alert"${v.codeError ? '' : ' hidden'}>${esc(v.codeError || '')}</p>
        <div class="row link-actions">
          <button type="button" data-action="cancel-code">Cancel</button>
          <button type="submit" class="primary">Save</button>
        </div>
        <button type="button" class="link-btn new-link" data-action="new-link">Or make a random one</button>
      </form>`;
  }
  if (!v.code) {
    return `<p class="muted">${v.error ? esc(v.error) : 'No family code yet.'}</p>
      <button type="button" class="btn block" data-action="change-code">Choose a code</button>`;
  }
  return `<p class="family-code" id="v-code" aria-label="The family code">${esc(v.code)}</p>
    <div class="row link-actions">
      <button type="button" data-action="copy-link">Copy</button>
      ${navigator.share ? '<button type="button" class="primary" data-action="share-link">Share</button>' : ''}
    </div>
    <button type="button" class="link-btn quiet-link change-link" data-action="change-code">Change code</button>`;
}

function refreshVisitors() {
  if (location.hash !== '#me') return;
  const list = $('#v-list'), link = $('#v-link');
  if (list) list.innerHTML = visitorsListHtml();
  // Leave the Change code box alone while she's typing in it.
  if (link && !(link.contains(document.activeElement) && document.activeElement.id === 'v-new-code')) link.innerHTML = familyCodeHtml();
}

async function copyLink() {
  const text = codeMessage(state.visitors.code);
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    // Older phones: copy the old way, from a box that's never seen.
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.className = 'sr-only';
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand('copy');
    box.remove();
    if (!ok) return toast('Couldn’t copy. The code is ' + state.visitors.code);
  }
  toast('Copied');
}

async function shareLink() {
  try {
    await navigator.share({ title: 'Mom’s recipes', text: codeMessage(state.visitors.code) });
  } catch (e) {
    if (e && e.name !== 'AbortError') copyLink();
  }
}

/** "Change code" opens the box; Cancel closes it. */
function openCodeForm(open) {
  state.visitors = { ...state.visitors, changing: open, codeError: '' };
  refreshVisitors();
  if (open) $('#v-new-code').focus();
}

/** Save: Sharon's own code, 6 to 40 characters once tidied (set_family_code). */
async function saveCode(form) {
  const input = $('#v-new-code'), err = $('#v-code-error');
  const btn = form.querySelector('button[type=submit]');
  const code = cleanCode(input.value);
  const fail = message => {
    state.visitors = { ...state.visitors, codeError: message };
    err.textContent = message;
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Save';
    input.focus();
  };
  if (!code) return fail('Type the new code first.');
  if (code.length < CODE_MIN) return fail(`That’s too short. Use at least ${CODE_MIN} letters or numbers.`);
  if (code.length > CODE_MAX) return fail(`That’s too long. Use at most ${CODE_MAX} letters or numbers.`);
  if (code === state.visitors.code) return fail('That’s already the family code.');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    await requireSession();
    const saved = await query(db().rpc('set_family_code', { code }));
    input.blur();
    state.visitors = { ...state.visitors, code: saved || code, changing: false, codeError: '' };
    refreshVisitors();
    toast('New family code saved');
  } catch (e) {
    fail(e && e.code === '22023' ? e.message : offlineMessage(e));
  }
}

async function newLink(btn) {
  if (state.visitors.code && !confirm('Make a new random code? The old one will stop letting new people in.')) return;
  btn.disabled = true;
  try {
    await requireSession();
    const code = await query(db().rpc('new_family_code'));
    state.visitors = { ...state.visitors, code, changing: false, codeError: '' };
    refreshVisitors();
    toast('New family code made');
  } catch (e) {
    btn.disabled = false;
    toast(offlineMessage(e));
  }
}

// "Remove" asks first, in the person's own row: remove them, or remove them
// and delete what they posted and liked. Then it offers a new family code,
// since the old one would let them straight back in.

async function removeGuestNow(id, withPosts) {
  const v = state.visitors;
  const guest = v && v.guests.find(g => g.user_id === id);
  if (!guest) return;
  state.removing = null;
  try {
    await requireSession();
    const photos = await query(db().rpc('remove_guest', { guest: id, with_posts: !!withPosts }));
    v.guests = v.guests.filter(g => g !== guest);
    if (withPosts) {
      state.cooked = state.cooked.filter(p => p.user !== id);
      state.likes = state.likes.filter(l => l.user !== id);
      store.set('cooked', state.cooked);
      store.set('likes', state.likes);
      const paths = (Array.isArray(photos) ? photos : []).filter(Boolean);
      if (paths.length) db().storage.from(PHOTO_BUCKET).remove(paths).catch(() => {});
    }
    refreshVisitors();
    toast(`Removed ${guest.name}. They could come back with the code`, { label: 'Change code', run: () => openCodeForm(true) });
  } catch (e) {
    refreshVisitors();
    toast(offlineMessage(e));
  }
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
  let hash = location.hash || '#today';
  if (state.user && (joinCodeFrom(hash) || (hash === '#signin' && !isGuest()))) {
    // Already signed in (Mom, Sharon, or a guest): the old family link or the sign-in isn't needed.
    // A guest who opens #signin is Mom or Sharon on a phone that joined as a
    // guest by mistake: they get the sign-in form, and signing in replaces the guest.
    history.replaceState({ idx: nav.idx }, '', location.pathname + '#today');
    nav.hashes[nav.idx] = hash = '#today';
  }
  const tab = hash.startsWith('#recipe') || hash.startsWith('#cook/') ? 'recipes' : hash.startsWith('#plan') ? 'plan'
    : hash.startsWith('#photo/') ? 'cooked' : hash === '#me' || hash === '#visitors' ? 'today' : hash.slice(1);
  document.querySelectorAll('.tabs a').forEach(a => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  updateListCount();
  placeTabMark(tab);
  view().dataset.screen = state.user ? hash.slice(1).split('/')[0] : 'signed-out';
  revealIfNew(state.user ? hash : `signed-out ${hash}`);

  if (!configured() || !state.user || (hash === '#signin' && isGuest())) {
    document.body.classList.add('no-tabs');
    if (!configured()) return renderNotConfigured();
    // Leave a form alone if it's already up (the welcome for the same link,
    // or none, and the same notice), so nothing typed is lost.
    if (hash === '#signin') return $('#sign-in') ? undefined : renderSignIn();
    const up = $('#join');
    if (up && up.dataset.link === joinCodeFrom(hash) && up.dataset.notice === (state.notice ? 'yes' : '')) return;
    return renderWelcome();
  }
  // A photo opened large fills the screen, bar and all.
  document.body.classList.toggle('no-tabs', hash.startsWith('#photo/'));

  // Don't wipe out what she's typing when a background refresh lands.
  const active = document.activeElement;
  if (active && view().contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
    if (hash === '#recipes') renderList();
    if (pickerRoute(hash)) renderPickerGrid();
    if (hash.startsWith('#recipe/')) refreshCookedSection();
    return;
  }

  if (hash.startsWith('#recipe/')) return renderRecipe(hash.split('/')[1]);
  if (hash.startsWith('#cook/')) return renderCook(hash.split('/')[1]);
  if (hash === '#cooked') return renderCookedTab();
  if (hash.startsWith('#photo/')) return renderPhoto(hash.split('/')[1]);
  if (hash === '#recipes') return renderRecipes();
  if (hash === '#add') return renderAdd();
  if (hash === '#list') { if (SHOPPING) return renderShopping(); location.replace('#today'); return; }
  if (hash === '#plan' || hash.startsWith('#plan/')) return renderPlanRoute(hash);
  if (hash === '#visitors') { location.replace('#me'); return; } // the old address
  if (hash === '#me') return renderMe();
  return renderToday();
}

// ---------- the bottom bar and screen changes (look only) ----------

/** Draws each tab's line icon from icons.js (before the List count, if any). */
function drawTabIcons() {
  document.querySelectorAll('.tabs [data-icon]').forEach(el => {
    if (!el.querySelector('svg')) el.insertAdjacentHTML('afterbegin', iconSvg(el.dataset.icon));
  });
}

/** Glides the short mark along the top of the bar to the tab she's on. */
function placeTabMark(tab) {
  const bar = $('.tabs');
  if (!bar) return;
  const tabs = [...bar.querySelectorAll('a[data-tab]')].filter(a => !a.hidden);
  const i = tabs.findIndex(a => a.dataset.tab === tab);
  bar.style.setProperty('--tab-n', tabs.length);
  if (i >= 0) bar.style.setProperty('--tab-i', i);
  bar.classList.toggle('no-mark', i < 0);
  // The first placing is instant; after that it moves.
  if (!bar.classList.contains('ready')) requestAnimationFrame(() => requestAnimationFrame(() => bar.classList.add('ready')));
}

let shownScreen = null;
/**
 * A calm fade and rise when a different screen opens, the first few tiles
 * following a moment after one another. Not when the same screen redraws
 * (new data, a tap on a switch), so nothing flickers.
 */
function revealIfNew(screen) {
  if (screen === shownScreen) return;
  shownScreen = screen;
  queueMicrotask(revealScreen);
}

function revealScreen() {
  const v = view();
  if (!v.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const easing = 'cubic-bezier(0.22, 0.7, 0.2, 1)';
  [...v.children].forEach(el => {
    if (el.classList.contains('sr-only')) return;
    el.animate({ opacity: [0, 1], transform: ['translateY(8px)', 'none'] }, { duration: 260, easing, fill: 'backwards' });
  });
  [...v.querySelectorAll('.squares > .square, .side-row > .square')].slice(0, 12).forEach((el, i) => {
    el.animate({ opacity: [0, 1], transform: ['translateY(6px) scale(0.985)', 'none'] },
      { duration: 240, delay: 40 + Math.min(i, 5) * 24, easing, fill: 'backwards' });
  });
}

/** #plan, #plan/<day> (that day's plan) or #plan/<day>/<Meal> (the picker). */
function renderPlanRoute(hash) {
  const pick = pickerRoute(hash);
  if (pick) return renderPicker(pick.day, pick.meal);
  const day = hash.split('/')[1];
  if (plannable(day)) state.planDay = day;
  return renderPlan();
}

// ---------- moving between screens ----------
// Each history entry the app makes is numbered (history.state.idx), so Back
// knows whether there's an app screen to go back to, and each screen's scroll
// is put back when she returns to it. With nothing behind (opened from a
// share, a fresh load), Back goes to the screen above instead.

const nav = { idx: 0, hashes: {}, scrolls: {}, replacing: false };
try { history.scrollRestoration = 'manual'; } catch (e) { /* old browser */ }

function navStart() {
  const s = history.state;
  if (s && Number.isInteger(s.idx)) nav.idx = s.idx;
  else history.replaceState({ ...(s && typeof s === 'object' ? s : {}), idx: 0 }, '', location.href);
  nav.hashes[nav.idx] = location.hash || '#today';
}

/** Goes to a screen in place of this one (no new history entry). */
function navReplace(hash) {
  if ((location.hash || '#today') === hash) return render();
  nav.replacing = true;
  location.replace(hash);
}

/** The screen above this one, for Back when there's nothing behind it. */
function backFallback() {
  const pick = pickerRoute();
  if (pick) { state.planDay = pick.day; return '#plan'; }
  if (location.hash.startsWith('#recipe/')) return state.recipeCtx && state.recipeCtx.fromWelcome ? '#today' : '#recipes';
  if (location.hash.startsWith('#cook/')) return `#recipe/${location.hash.split('/')[1]}`;
  if (location.hash.startsWith('#photo/')) return '#cooked';
  return '#today'; // also the Visitors page, which is reached from Today
}

function goBack() {
  if (nav.idx > 0) return history.back();
  navReplace(backFallback());
}

/** Notes where she came from when she opens a recipe or the picker. */
function entered(hash, from, fresh) {
  // Leaving a recipe closes its Edit form; coming back shows it read-only.
  if (state.editing && hash !== `#recipe/${state.editing}`) state.editing = null;
  if (hash.startsWith('#recipe/')) {
    const row = hash.split('/')[1];
    if (fresh || !state.recipeCtx || state.recipeCtx.row !== row) {
      if (state.choose && state.choose.row !== row) state.choose = null;
      state.recipeCtx = {
        row,
        meal: fresh && from === '#today' ? state.meal : null,
        fromWelcome: state.fromWelcomeRow === row,
      };
    }
    state.fromWelcomeRow = null;
  } else {
    state.choose = null;
  }
  if (fresh && pickerRoute(hash)) state.pickQ = '';
}

window.addEventListener('hashchange', () => {
  if (state.user && isGuest() && joinCodeFrom(location.hash)) state.joinPending = joinCodeFrom(location.hash);
  const from = nav.hashes[nav.idx];
  nav.scrolls[nav.idx] = window.scrollY; // the screen she's leaving
  const s = history.state;
  let fresh = true;
  if (nav.replacing) {
    nav.replacing = false;
    history.replaceState({ idx: nav.idx }, '', location.href);
  } else if (s && Number.isInteger(s.idx)) {
    nav.idx = s.idx; // Back or Forward to a screen she's seen
    fresh = false;
  } else {
    nav.idx += 1;
    history.replaceState({ idx: nav.idx }, '', location.href);
  }
  if (fresh) delete nav.scrolls[nav.idx];
  const hash = location.hash || '#today';
  nav.hashes[nav.idx] = hash;
  entered(hash, from, fresh);
  if (hash === '#me' && fresh) {
    state.renaming = false;
    if (from && !from.startsWith('#cook/')) state.switching = false;
    if (state.visitors) state.visitors = { ...state.visitors, changing: false, codeError: '' };
  }
  render();
  window.scrollTo(0, nav.scrolls[nav.idx] || 0);
  // Someone else may have changed the list or the plan on their phone.
  if (SHOPPING && hash === '#list') loadShopping();
  if (hash.startsWith('#plan')) loadPlan();
  if (hash === '#me') { if (!isGuest()) loadVisitors(); loadMyName(); }
  if (hash === '#cooked' || hash.startsWith('#recipe/')) loadCooked();
  if (hash.startsWith('#recipe/')) loadRecipePosts(hash.split('/')[1]);
});

// ---------- events ----------

document.addEventListener('input', e => {
  const id = e.target.id;
  if (id === 'search') {
    state.filters.q = e.target.value;
    renderList();
  } else if (id === 'plan-search') {
    state.pickQ = e.target.value;
    renderPickerGrid();
  } else if (id === 'a-name') {
    state.draft.name = e.target.value;
  } else if (id === 'a-notes') {
    state.draft.notes = e.target.value;
  } else if (id === 'cook-say') {
    if (state.cookDraft) state.cookDraft.text = e.target.value;
  } else if (id === 'r-name' || id === 'r-notes' || id === 'r-ingredients' || id === 'r-steps') {
    showRecipeSave();
  }
});

document.addEventListener('change', e => {
  const el = e.target;
  // "Pick a date" on the Plan tab or in the recipe page's "Move to" chooser.
  if (el.dataset && el.dataset.pickDate) {
    const day = el.value;
    if (!plannable(day)) return;
    if (el.dataset.pickDate === 'plan-day') {
      if (day !== currentPlanDay()) state.planExtras = false;
      state.planDay = day;
      if (location.hash !== '#plan') return navReplace('#plan');
      return refreshPlan();
    }
    if (el.dataset.pickDate === 'choose-day' && state.choose) {
      const r = findRecipe(state.choose.row);
      state.choose.pickDay = day;
      return r && refreshRecipePlan(r);
    }
    return;
  }
  switch (el.id) {
    case 'meal':
      // Stays her choice until the clock moves on to the next meal.
      state.meal = el.value;
      state.mealSlot = mealAt();
      return renderToday();
    case 'search':
      // Done typing (Enter, or she tapped away): a shortcut word moves to the row.
      takeTypedShortcut();
      return;
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
    case 'cook-file': {
      const file = el.files && el.files[0];
      el.value = '';
      if (file) pickCookPhoto(file);
      return;
    }
    case 'r-photo': {
      const r = findRecipe(location.hash.split('/')[1]);
      const file = el.files && el.files[0];
      el.value = '';
      if (r && file) savePhoto(r, file, $('[data-action=photo]'));
      return;
    }
  }
});

// While editing, Save is always there; nothing to show or hide.
function showRecipeSave() {}

document.addEventListener('click', async e => {
  const el = e.target.closest('button');
  if (!el) return;
  const ds = el.dataset;
  const hash = location.hash || '#today';

  if (ds.action === 'back') return goBack();

  // "I cooked this", the Cooked tab and a photo opened large
  if (ds.like) return toggleLike(ds.like);
  if (ds.action === 'delete-post') return deletePostSoon(ds.post);
  if (ds.action === 'go-recipe') return goToRecipe(ds.row);
  if (ds.cookedWho && hash === '#cooked') { state.cookedWho = ds.cookedWho; return renderCookedTab(); }
  if (hash.startsWith('#cook/')) {
    if (ds.action === 'cook-photo') return $('#cook-file').click();
    if (ds.action === 'cook-photo-out') return dropCookPhoto();
    if (ds.action === 'cook-post') return postCooked();
    if (ds.action === 'not-me') { state.switching = true; location.hash = '#me'; return; }
  }

  // Today
  if (ds.effort && hash === '#today') { state.effort = ds.effort; return renderToday(); }
  if (ds.action === 'another') {
    // Only the idea changes; the lists below stay where they are.
    suggest();
    const box = $('#suggestion');
    if (box) box.innerHTML = suggestionHtml();
    return;
  }

  // Recipes list
  if (ds.shortcut && hash === '#recipes') return pickShortcut(ds.shortcut);
  if (ds.action === 'have-toggle') return toggleHave();
  if (ds.chip) { takeTypedShortcut(); return toggleChip(ds.chip); }
  if (ds.action === 'chip-clear') { state.filters.q = ''; $('#search').value = ''; return renderList(); }
  if (ds.action === 'show-close') { state.closeOpenFor = state.filters.q.trim(); return renderList(); }
  if (ds.action === 'hide-close') { state.closeOpenFor = null; return renderList(); }
  if (ds.action === 'show-removed') { state.filters.showRemoved = true; return renderRecipes(); }
  if (ds.action === 'hide-removed') { state.filters.showRemoved = false; return renderRecipes(); }

  // One recipe
  if (hash.startsWith('#recipe/')) {
    const r = findRecipe(hash.split('/')[1]);
    if (!r) return;
    if (ds.action === 'add-plan') return addToPlan(r);
    if (ds.action === 'open-plan') { state.planDay = ds.day; location.hash = '#plan'; return; }
    if (ds.chooseDay && state.choose) { state.choose.pickDay = ds.chooseDay; return refreshRecipePlan(r); }
    if (ds.chooseMeal) return chooseMeal(r, ds.chooseMeal);
    if (ds.action === 'choose-close') { state.choose = null; return refreshRecipePlan(r); }
    if (ds.ing) return toggleIngredient(r, Number(ds.ing));
    if (!canEdit(r)) return; // a guest on one of Mom's recipes: nothing below is for them
    // Edit form: the collection toggles only change on screen until Save.
    if (ds.tagToggle && String(state.editing) === String(r.row)) { flipToggle(el); return showRecipeSave(); }
    if (ds.action === 'meals-open') { state.mealsOpen = String(r.row); return refreshMeals(r); }
    if (ds.action === 'meals-close') { state.mealsOpen = null; return refreshMeals(r); }
    if (ds.mealToggle) return toggleMeal(r, ds.mealToggle);
    if (ds.action === 'meals-reset') {
      const meals = categoryMeals(categoryOf(r));
      return saveMeals(r, null, meals.length ? `Back to ${andList(meals)}, from its category` : 'Back to its category');
    }
    if (ds.action === 'save-recipe') return saveRecipe(el, r);
    if (ds.action === 'edit-recipe') { state.editing = String(r.row); state.mealsOpen = null; renderRecipe(r.row); window.scrollTo(0, 0); return; }
    if (ds.action === 'edit-cancel') { state.editing = null; state.mealsOpen = null; renderRecipe(r.row); window.scrollTo(0, 0); return; }
    if (ds.action === 'photo') return $('#r-photo').click();
    if (ds.action === 'remove') {
      if (!confirm(`Remove “${displayName(r)}” from your recipes? You can put it back from “Show removed”.`)) return;
      return saveFields(r, { status: STATUS.removed }, 'Removed', '#recipes');
    }
    if (ds.action === 'restore') return saveFields(r, { status: STATUS.toTry }, 'Back in your recipes');
  }

  // Plan and the picker
  if (hash.startsWith('#plan')) {
    if (ds.planDay) {
      if (ds.planDay !== currentPlanDay()) state.planExtras = false;
      state.planDay = ds.planDay;
      if (hash !== '#plan') return navReplace('#plan');
      return refreshPlan();
    }
    if (ds.planRemove) {
      const entry = state.plan.find(p => String(p.id) === ds.planRemove);
      const r = entry && findRecipe(entry.recipe_id);
      if (!r) return;
      const done = removePlan(entry);
      // Undo puts that one copy back (unless taking it off failed and it's already back).
      toast(`Removed ${displayName(r)}`, { label: 'Undo', run: () => { if (!state.plan.includes(entry)) addPlan(entry.day, entry.meal, entry.recipe_id); } });
      return done;
    }
    if (ds.action === 'plan-extras') { state.planExtras = true; return refreshPlan(); }
    if (ds.action === 'plan-shop') return addPlanToList(el);
    if (ds.pick) {
      const route = pickerRoute();
      const r = findRecipe(ds.pick);
      if (!route || !r) return;
      return addPlan(route.day, route.meal, r.row); // always one more
    }
    if (ds.pickLess) {
      const route = pickerRoute();
      const copies = route ? planCopies(route.day, route.meal, ds.pickLess) : [];
      return copies.length ? removePlan(copies[copies.length - 1]) : undefined; // the newest copy only
    }
    if (ds.action === 'plan-done') return leavePicker();
  }

  // List
  if (hash === '#list') {
    if (ds.item) {
      const item = state.shopping.find(s => String(s.id) === ds.item);
      if (!item || item.id < 0) return; // still being saved
      const done = tickShopping(item);
      refreshShopping();
      await done;
      return refreshShopping();
    }
    if (ds.action === 'clear-ticked') {
      const done = removeShopping(state.shopping.filter(s => s.done && s.id > 0));
      refreshShopping();
      await done;
      return refreshShopping();
    }
  }

  // Add
  if (hash === '#add') {
    if (ds.action === 'save-anyway') { state.draft.force = true; return renderAdd(); }
    if (ds.tagToggle) {
      const on = flipToggle(el);
      const tags = tagsOf(state.draft).filter(t => t !== ds.tagToggle);
      state.draft.tags = tidyTags(on ? [...tags, ds.tagToggle] : tags);
      return;
    }
    if (ds.action === 'save-new') return saveNew(el);
  }

  // The You page
  if (hash === '#me') {
    if (ds.action === 'my-cooked') { state.cookedWho = 'mine'; location.hash = '#cooked'; return; }
    if (ds.action === 'rename-open') { state.renaming = true; $('#me-rename').innerHTML = renameHtml(); $('#me-new-name').focus(); return; }
    if (ds.action === 'rename-cancel') { state.renaming = false; $('#me-rename').innerHTML = renameHtml(); return; }
    if (ds.action === 'switch-open') { state.switching = true; $('#me-switch').innerHTML = switchHtml(); $('#switch-name').focus(); return; }
    if (ds.action === 'switch-cancel') { state.switching = false; $('#me-switch').innerHTML = switchHtml(); return; }
    if (ds.removeGuest) { state.removing = ds.removeGuest; return refreshVisitors(); }
    if (ds.action === 'remove-cancel') { state.removing = null; return refreshVisitors(); }
    if (ds.removeConfirm) return removeGuestNow(ds.removeConfirm, ds.withPosts === '1');
    if (ds.action === 'copy-link') return copyLink();
    if (ds.action === 'share-link') return shareLink();
    if (ds.action === 'new-link') return newLink(el);
    if (ds.action === 'change-code') return openCodeForm(true);
    if (ds.action === 'cancel-code') return openCodeForm(false);
  }

  if (ds.action === 'leave-guest') return leaveGuest();
  if (ds.action === 'sign-out') {
    if (!confirm('Sign out of the recipe app on this phone?')) return;
    return signOut();
  }
});

// The welcome: Enter in "Your name" goes on to "Family code" rather than sending a half-filled form.
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.target.id !== 'j-name') return;
  const code = $('#j-code');
  if (code && !code.value.trim() && e.target.value.trim()) {
    e.preventDefault();
    code.focus();
  }
});

document.addEventListener('submit', async e => {
  if (e.target.matches('[data-search-form]')) {
    // The list already updates as she types; Search just closes the keyboard.
    e.preventDefault();
    state.filters.q = $('#search').value;
    takeTypedShortcut();
    $('#search').blur();
    renderList();
    return;
  }
  if (e.target.matches('[data-pick-search]')) {
    e.preventDefault();
    $('#plan-search').blur(); // closes the keyboard; the tiles already follow the box
    return;
  }
  if (e.target.matches('[data-add-item]')) {
    e.preventDefault();
    const input = $('#add-item');
    const item = input.value.trim();
    if (!item) return;
    input.value = '';
    const done = addShopping(item, null);
    refreshShopping();
    $('#add-item').focus(); // ready for the next one
    await done;
    return refreshShopping();
  }
  if (e.target.id === 'join') {
    e.preventDefault();
    return submitJoin(e.target);
  }
  if (e.target.id === 'code-form') {
    e.preventDefault();
    return saveCode(e.target);
  }
  if (e.target.id === 'rename-form') {
    e.preventDefault();
    return saveMyName(e.target);
  }
  if (e.target.id === 'switch-form') {
    e.preventDefault();
    return switchToOwn(e.target);
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
  const sharing = location.hash === '#add';
  if (!sharing) history.replaceState({ idx: nav.idx }, '', location.pathname + '#today');
  nav.hashes[nav.idx] = location.hash || '#today';
  // Fetch her recipes while the button still says "Signing in…", then go
  // straight into Yo Mom (it needs the recipes to deal its cards).
  await loadRecipes();
  loadShopping();
  loadPlan();
  loadCooked();
  loadMyName();
  render();
  if (!sharing) showWelcome();
});

/** "Continue as guest": in with the typed code (or the old link's), then the first page says hello. */
async function submitJoin(form) {
  const link = form.dataset.link || '';
  const codeInput = $('#j-code');
  const code = link || cleanCode(codeInput && codeInput.value);
  const nameInput = $('#j-name');
  const name = nameInput.value.trim().replace(/\s+/g, ' ').slice(0, 40);
  const nameErr = $('#j-name-error'), err = $('#j-error');
  const btn = form.querySelector('button[type=submit]');
  const say = (el, message) => { el.textContent = message; el.hidden = !message; };
  const fail = message => {
    say(err, message);
    btn.disabled = false;
    btn.textContent = 'Continue as guest';
  };
  say(nameErr, name ? '' : 'Type your name first.');
  say(err, code ? '' : 'Type the family code. Ask Sharon if you don’t have it.');
  if (!name) return nameInput.focus();
  if (!code) return codeInput.focus();
  btn.disabled = true;
  btn.textContent = 'Coming in…';
  try {
    await joinFamily(code, name);
  } catch (ex) {
    if (ex.message !== 'wrong-code') return fail(joinMessage(ex));
    if (link) {
      // An old link: take its code out of the address and ask for the code
      // itself, keeping the name they typed.
      history.replaceState({ idx: nav.idx }, '', location.pathname + '#today');
      nav.hashes[nav.idx] = '#today';
      renderWelcome({ name, error: OLD_LINK });
      return $('#j-code').focus();
    }
    fail(WRONG_CODE);
    codeInput.focus();
    return codeInput.select();
  }
  if (document.activeElement) document.activeElement.blur();
  // The code has done its job: out of the address, so it isn't kept or shared on.
  history.replaceState({ idx: nav.idx }, '', location.pathname + '#today');
  nav.hashes[nav.idx] = '#today';
  await loadRecipes();
  loadShopping();
  loadPlan();
  loadCooked();
  loadMyName();
  render();
  showWelcome();
}

async function saveRecipe(btn, r) {
  const fields = recipeChanges(r);
  const done = () => { state.editing = null; state.mealsOpen = null; renderRecipe(r.row); window.scrollTo(0, 0); };
  if (!Object.keys(fields).length) return done();
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    await updateRecipe(r, fields);
    toast('Saved');
    done();
  } catch (e) {
    toast(offlineMessage(e));
    btn.disabled = false;
    btn.textContent = 'Save';
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

// ---------- start ----------

/**
 * Up to nine of a meal's dishes for Yo Mom's cards, different each time: what
 * she hasn't made lately first, then Loved. Dishes already on an earlier
 * meal's cards come last, so Lunch and Dinner (which share Main Course) don't
 * show the same nine.
 */
function welcomeTiles(pool, used) {
  const rank = r => (used.has(r.row) ? 8 : 0) + (recentlyMade(r) ? 2 : 0) + (statusOf(r) === STATUS.loved ? 0 : 1);
  // Her sheet has a few dishes twice; one card each.
  const seen = new Set();
  const picked = pool
    .map(r => ({ r, rank: rank(r), n: Math.random() }))
    .sort((a, b) => a.rank - b.rank || a.n - b.n)
    .map(x => x.r)
    .filter(r => {
      const keys = [`n:${displayName(r).toLowerCase()}`, `l:${linkKey(r.link)}`];
      if (keys.some(k => seen.has(k))) return false;
      keys.forEach(k => seen.add(k));
      return true;
    })
    .slice(0, 9);
  picked.forEach(r => used.add(r.row));
  return { tiles: picked.map(r => ({ row: r.row, name: displayName(r), tint: tileTint(r), icon: iconSvg(iconFor(r)) })) };
}

/**
 * The meals Yo Mom goes through: once round, ending on the meal for now, each
 * with its cards. Meals with no dishes are left out; if the meal for now has
 * none, it lands on the next one that has. `when` is only there for testing.
 */
function welcomeMeals(when = new Date()) {
  const n = MEAL_NAMES.length;
  // Not what she said to skip next time: these are meant to give her ideas.
  const pools = Object.fromEntries(MEAL_NAMES.map(m => [m, mainDishes(m).filter(r => statusOf(r) !== STATUS.skip)]));
  const now = MEAL_NAMES.indexOf(mealAt(when));
  let land = now;
  for (let i = 0; i < n; i++) {
    if (pools[MEAL_NAMES[(now + i) % n]].length) { land = (now + i) % n; break; }
  }
  const round = [];
  for (let i = 1; i <= n; i++) round.push(MEAL_NAMES[(land + i) % n]); // ends on the landing meal
  const used = new Set();
  return round
    .filter((m, i) => pools[m].length || i === n - 1)
    .map(m => ({ meal: m, ...welcomeTiles(pools[m], used) }));
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
  if (joining) return;
  try {
    const { data, error } = await db().auth.getSession();
    if (data.session) {
      const u = data.session.user;
      setUid(u.id);
      if (u.is_anonymous) {
        // A guest: once per app open, say they came (last visit on the
        // Visitors page) and learn whether they're still on the list.
        if (!touched) {
          let name;
          try {
            name = await query(db().rpc('touch_guest'));
            touched = true;
          } catch (e) { /* offline: carry on with what this phone knows */ }
          if (name === null) return guestEnded();
          if (name && (!isGuest() || state.guest.name !== name || state.user !== u.id)) {
            setGuest(u.id, name);
            render();
          }
        }
        if (!isGuest()) return; // offline, and this phone never knew their name: wait
      } else if (state.user !== u.email || isGuest()) {
        setMember(u.email);
        render();
      } else {
        refreshAdmin();
      }
      loadRecipes({ quiet: state.recipes.length > 0 });
      loadShopping();
      loadPlan();
      loadCooked();
      loadMyName();
    } else if (!error) {
      signedOut();
    }
    // With an error she's most likely offline: keep showing the saved list.
  } catch (e) { /* database library didn't load (offline): keep the saved list */ }
}

/**
 * Plays Yo Mom, then opens Today on the meal it landed on, Quick & easy or
 * Gourmet as she tapped. showWelcome(new Date(2026, 0, 1, 19)) in the
 * console plays it as if it were 7pm.
 */
/**
 * True when the app has just been opened, rather than refreshed or brought
 * back with the browser's Back/Forward, and it's opening at the start (not a
 * link to a particular screen). Yo Mom plays once per open, not per reload.
 */
function freshOpen() {
  let how = 'navigate';
  try { how = (performance.getEntriesByType('navigation')[0] || {}).type || 'navigate'; } catch (e) { /* old browser: treat as an open */ }
  let seen = false;
  try { seen = sessionStorage.getItem('welcomed') === '1'; } catch (e) { /* private mode: no memory */ }
  const atStart = !location.hash || location.hash === '#today';
  return how !== 'reload' && how !== 'back_forward' && !seen && atStart;
}

function showWelcome(when = new Date()) {
  try { sessionStorage.setItem('welcomed', '1'); } catch (e) { /* fine without */ }
  const meals = welcomeMeals(when);
  const landed = meals[meals.length - 1].meal;
  // "Yo Mom" for Mom (and Sharon); a guest by their first name, "Yo Anu".
  const who = isGuest() ? (String(state.guest.name).trim().split(/\s+/)[0] || 'there').slice(0, 16) : 'Mom';
  Welcome.show(meals, who, choice => {
    state.meal = landed;
    state.mealSlot = mealAt();
    state.suggestion = null;
    // She tapped one of the dishes: open it, with Today behind it for Back.
    if (typeof choice === 'object') {
      if ((location.hash || '#today') !== '#today') {
        history.replaceState({ idx: nav.idx }, '', location.pathname + '#today');
        nav.hashes[nav.idx] = '#today';
      }
      state.fromWelcomeRow = String(choice.row);
      location.hash = `#recipe/${choice.row}`;
      return;
    }
    state.effort = choice;
    if (location.hash !== '#today') location.hash = '#today';
    else render();
  });
}

function start() {
  drawTabIcons();
  const shared = readShare();
  navStart();
  // A family link opened by someone already signed in: Mom keeps her own
  // sign-in and the link is ignored. A guest keeps it in mind, in case Sharon
  // has removed them and they need it to come back in (see guestEnded).
  const code = joinCodeFrom(location.hash);
  if (code && state.user) {
    if (isGuest()) state.joinPending = code;
    history.replaceState({ idx: nav.idx }, '', location.pathname + '#today');
    nav.hashes[nav.idx] = '#today';
  }
  if (shared) {
    state.draft = newDraft();
    history.replaceState({ idx: nav.idx }, '', location.pathname + '#add');
    nav.hashes[nav.idx] = '#add';
    render();
    setDraftLink(shared);
  } else {
    render();
    // "Yo Mom" each time she opens the app, but not when she's sharing a link
    // in, and not on a refresh: then she stays on the screen she was on.
    if (configured() && state.user && freshOpen()) showWelcome();
  }

  if (configured()) checkSession();
}

// Refresh when she comes back to the app (e.g. after adding a recipe on another device).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && configured() && Date.now() - state.loadedAt > 60000) {
    checkSession();
  }
});

// A guest removed on the Visitors page just before the app is closed.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushPostDelete();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
