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
  // A family member who came in through the family link (an anonymous
  // sign-in): { id, name }. Null for Mom and Sharon. state.user is then their id.
  guest: store.get('guest', null),
  recipes: store.get('recipes', []),
  loadedAt: 0,
  loading: false,
  extraCategories: store.get('extraCategories', []),
  filters: { q: '', status: 'all', category: '', showRemoved: false },
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
  notice: null, // a message shown instead of the sign-in form: { title, text }
  joinPending: '', // a family code from a link opened while a guest was signed in
  visitors: null, // the Visitors page: { guests, counts, code, fresh, error }
};

/** True when a family member is using the app through the family link. */
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

const COLUMNS = 'id, name, category, status, link, source, notes, ingredients, last_cooked_at, photo_path, effort, meals, owner';
// What a guest asks for on Mom's recipes: everything but her private notes.
// (The rules are per row, so the notes could still be asked for; the app just never does.)
const FAMILY_COLUMNS = COLUMNS.replace(', notes', '');
const EDITABLE = ['name', 'category', 'status', 'notes', 'ingredients', 'last_cooked_at', 'photo_path', 'meals'];
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
    owner: d.owner || null, // null for Mom's recipes; the guest's id for one a guest added
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

/** Every row of a recipes query, a page at a time. `build` adds the select and filters. */
async function allRows(build) {
  const all = [];
  for (let from = 0; ; from += PAGE) {
    const page = await query(build(db().from('recipes')).order('id').range(from, from + PAGE - 1));
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
    allRows(q => q.select(FAMILY_COLUMNS).is('owner', null)),
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
    const same = await query((isGuest()
      ? db().from('recipes').select(FAMILY_COLUMNS)
      : db().from('recipes').select(COLUMNS).is('owner', null)).eq('link_key', key).order('id').limit(1));
    if (same.length) return { duplicate: true, recipe: fromDb(same[0]) };
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
const PHOTO_URL_SECONDS = 6 * 60 * 60;
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
}

function setMember(email) {
  state.user = email;
  state.guest = null;
  state.notice = null;
  store.set('user', state.user);
  store.remove('guest');
}

function setGuest(id, name) {
  state.user = id;
  state.guest = { id, name: name || '' };
  state.notice = null;
  store.set('user', state.user);
  store.set('guest', state.guest);
}

// ---------- guest mode ----------
// Family members open the family link (…/#join=<code>), type their name and
// come in as a Supabase anonymous user: no email, no password. join_family()
// checks the code and puts them on the guest list (supabase/migrations/005).
// The sign-in stays on their phone like anyone else's.

const EXPIRED = { title: 'Welcome!', text: 'This link has expired. Ask Sharon for a new one.' };
const GUEST_ENDED = { title: 'Welcome back', text: 'Guest mode has ended on this phone. Ask Sharon for a new family link.' };

/** The family code in a #join=<code> link, or ''. */
function joinCodeFrom(hash) {
  const m = /^#join=([\w-]{1,64})$/.exec(String(hash || ''));
  return m ? m[1] : '';
}

let joining = false; // checkSession waits while a join is half done
let touched = false; // touch_guest() once per app open

/** Signs in as a new anonymous user and joins with the code. Throws Error('expired') for a bad code. */
async function joinFamily(code, name) {
  joining = true;
  try {
    const { data, error } = await db().auth.signInAnonymously();
    if (error) throw error;
    let ok = false;
    try {
      ok = await query(db().rpc('join_family', { code, name }));
    } catch (e) {
      await db().auth.signOut({ scope: 'local' }).catch(() => {});
      throw e;
    }
    if (!ok) {
      await db().auth.signOut({ scope: 'local' }).catch(() => {});
      throw new Error('expired');
    }
    setGuest(data.user.id, name);
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
  if (e.status === 429 || /rate limit|too many/i.test(text)) return 'Too many people tried just now. Wait a few minutes and try again.';
  if (isNetworkError(e)) return 'Couldn’t reach the server. Check the internet and try again.';
  return e.message || 'Couldn’t let you in. Try again.';
}

/**
 * The guest isn't on the list any more (Sharon removed them): forget them on
 * this phone. With a family link waiting, go straight to its welcome.
 */
async function guestEnded() {
  const code = state.joinPending;
  state.joinPending = '';
  try { await db().auth.signOut({ scope: 'local' }); } catch (e) { /* offline: forget it here anyway */ }
  signedOut();
  state.notice = code ? null : GUEST_ENDED;
  history.replaceState({ idx: nav.idx }, '', location.pathname + (code ? `#join=${code}` : '#today'));
  nav.hashes[nav.idx] = location.hash;
  render();
}

/** "Leave guest mode": their plan, list and recipes go, then they're signed out. */
async function leaveGuest() {
  if (!confirm('Leave guest mode? Your meal plan and any recipes you added on this phone will be gone.')) return;
  const id = guestId();
  try {
    await requireSession();
    // Once signed out there's no way back to these, so tidy them away first.
    await Promise.all([
      query(db().from('meal_plan').delete().eq('guest_id', id)),
      query(db().from('shopping_items').delete().eq('guest_id', id)),
    ]);
    await query(db().from('recipes').delete().eq('owner', id));
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
  state.visitors = null;
  state.mealsOpen = null;
  state.recipes = [];
  state.loadedAt = 0;
  state.suggestion = null;
  state.shopping = [];
  state.plan = [];
  state.lastPlanned = null;
  state.choose = null;
  photoUrls.clear();
  store.remove('user');
  store.remove('guest');
  store.remove('recipes');
  store.remove('shopping');
  store.remove('plan');
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
    return `<a class="picture photo" href="${esc(r.link)}" target="_blank" rel="noopener">${photoImg(r.photo_path, '')}</a>`;
  }
  const src = thumbUrl(r);
  return src
    ? `<a class="picture" href="${esc(r.link)}" target="_blank" rel="noopener"><img src="${esc(src)}" data-thumb alt=""></a>`
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
      <a class="btn primary" href="${esc(r.link)}" target="_blank" rel="noopener">Open recipe</a>
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

    ${signOutHtml()}
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

/**
 * A quiet "Sign out" at the bottom of Today, out of the way of the meal, with
 * "Visitors" next to it for Mom and Sharon. A guest gets "Leave guest mode".
 */
function signOutHtml() {
  if (isGuest()) {
    return `<div class="footer-action">
      <button class="link-btn sign-out" data-action="leave-guest">Leave guest mode</button>
    </div>`;
  }
  return `<div class="footer-action footer-links">
    <button class="link-btn sign-out" data-action="visitors">Visitors</button>
    <button class="link-btn sign-out" data-action="sign-out">Sign out${state.user ? ` (${esc(state.user)})` : ''}</button>
  </div>`;
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
 */
function runSearch() {
  const f = state.filters;
  const list = state.recipes.filter(r => {
    if (f.showRemoved !== isRemoved(r)) return false;
    if (!f.showRemoved && f.status !== 'all' && statusOf(r) !== f.status) return false;
    if (f.category && categoryOf(r) !== f.category) return false;
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
  // Dishes missing just one of her ingredients ("2 of 3 · no cream"). Kept
  // apart and hidden behind a button: she wants exact answers first.
  const close = [];
  for (const r of list) {
    const missing = missingTerms(r, terms);
    if (!missing.length) items.push({ r, match: null });
    else if (several && missing.length === 1) close.push({ r, match: { have: terms.length - 1, of: terms.length, missing: missing[0] } });
  }
  const newestFirst = (a, b) => b.r.row - a.r.row;
  items.sort(newestFirst);
  close.sort(newestFirst);
  return { mode: several ? 'ingredients' : 'text', terms, items, close };
}

// ---------- tap instead of typing ----------
// Chips under the search box put a word in the box's list (or take it out),
// so tapping gives exactly the same results as typing it.

const PROTEINS = ['chicken', 'mutton', 'beef', 'pork', 'fish', 'prawns', 'egg', 'paneer'];
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
    <div class="tags" role="group" aria-label="Ingredients you have">${ingredientChips().map(tagHtml).join('')}
      <button type="button" class="chip clear" data-action="chip-clear" hidden>Clear</button>
    </div>
    <p class="pick-label">Make it</p>
    <div class="segmented style-bar" role="group" aria-label="Kind of dish">${STYLE_CHIPS.map(styleWordHtml).join('')}</div>
  </div>`;
}

/** Lights up the chips whose word is in the box, whether tapped or typed. */
function markChips() {
  const inBox = new Set(searchParts(state.filters.q).map(simplePhrase));
  let any = false;
  document.querySelectorAll('.chip[data-chip]').forEach(c => {
    const on = inBox.has(simplePhrase(c.dataset.chip));
    c.setAttribute('aria-pressed', on);
    any = any || on;
  });
  const clear = $('[data-action=chip-clear]');
  if (clear) clear.hidden = !any;
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

function renderRecipes() {
  const f = state.filters;
  const removedCount = state.recipes.filter(isRemoved).length;
  const counts = {};
  for (const r of state.recipes) if (!isRemoved(r)) counts[categoryOf(r)] = (counts[categoryOf(r)] || 0) + 1;
  const cats = allCategories().filter(c => counts[c]);

  view().innerHTML = `
    ${f.showRemoved ? backHtml('hide-removed') : ''}
    <h1>${f.showRemoved ? 'Removed' : 'Recipes'}</h1>
    <p class="muted">${f.showRemoved ? 'Recipes you removed. They’re still saved.' : isGuest() ? 'Mom’s recipes, and the ones you add.' : 'All the recipes you’ve saved.'}</p>

    <form class="search-row" data-search-form>
      <label class="sr-only" for="search">Search</label>
      <input id="search" type="search" enterkeyhint="search" placeholder="Search, or list what you have: tomato, chicken" value="${esc(f.q)}" autocomplete="off">
      <button class="primary" type="submit">Search</button>
    </form>
    ${f.showRemoved ? '' : `
    ${chipsHtml()}
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

    ${!f.showRemoved && removedCount ? `<button class="link-btn" data-action="show-removed">Show removed (${removedCount})</button>` : ''}

  `;
  renderList();
}

function renderList() {
  const el = $('#list');
  if (!el) return;
  markChips();
  const search = runSearch();
  const list = search.items;
  const showClose = state.closeOpenFor === state.filters.q.trim();
  $('#count').textContent = `${list.length} recipe${list.length === 1 ? '' : 's'}` +
    (search.mode === 'ingredients' && list.length ? ` with ${andList(search.terms)}` : '');

  let html = list.length ? list.map(squareHtml).join('') : `<p class="muted empty">${state.recipes.length
    ? (search.mode === 'ingredients' ? `No recipes have all of ${andList(search.terms)}.` : 'No recipes match.')
    : (state.loading ? 'Loading your recipes…' : 'No recipes yet.')}</p>`;
  if (search.close.length) {
    const n = search.close.length;
    html += showClose
      ? `<h2 class="section close-heading">Close matches <span class="muted small">missing one thing</span></h2>
         ${search.close.map(squareHtml).join('')}
         <button class="link-btn close-toggle" data-action="hide-close">Hide close matches</button>`
      : `<button class="link-btn close-toggle" data-action="show-close">Show ${n} close match${n === 1 ? '' : 'es'} (missing 1 thing)</button>`;
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
    ${match ? `<span class="status close-status">${match.have} of ${match.of} · no ${esc(match.missing)}</span>` : (status ? `<span class="status">${esc(status)}</span>` : '')}
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

      <a class="btn primary block" href="${esc(r.link)}" target="_blank" rel="noopener">${esc(openLabel(r))}</a>
      <div id="r-plan">${recipePlanHtml(r)}</div>

      <h2 class="section">Ingredients</h2>
      ${r.ingredients.length
        ? `<ul class="ingredients">${r.ingredients.map((x, i) => `<li>${ingredientButton(r, x, i)}</li>`).join('')}</ul>`
        : '<p class="muted">No ingredients yet.</p>'}
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
      <p class="muted meals-line">${meals.length ? `Shows in: ${esc(meals.join(', '))}` : 'Not in any meal yet'}</p>
      <div id="r-made">${recipeMadeHtml(r)}</div>

      <a class="btn primary block" href="${esc(r.link)}" target="_blank" rel="noopener">${esc(openLabel(r))}</a>
      <div id="r-plan">${recipePlanHtml(r)}</div>

      <h2 class="section">Ingredients</h2>
      ${r.ingredients.length
        ? `<ul class="ingredients">${r.ingredients.map((x, i) => `<li>${ingredientButton(r, x, i)}</li>`).join('')}</ul>`
        : '<p class="muted">No ingredients yet.</p>'}
      ${String(r.notes).trim() ? `<h2 class="section">Notes</h2><p class="recipe-notes">${esc(r.notes)}</p>` : ''}
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

    <label class="field" for="r-ingredients">Ingredients, one per line</label>
    <textarea id="r-ingredients" placeholder="tomato&#10;chicken&#10;cream">${esc(r.ingredients.join('\n'))}</textarea>

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

/**
 * "Last made 5 days ago", then the two small actions: made it today, and her
 * photo. Guests don't add photos, so on their own recipes it's just the first.
 */
function recipeMadeHtml(r) {
  if (!canEdit(r)) return '';
  // Editing: only the photo (her own photo is part of editing the recipe).
  if (String(state.editing) === String(r.row)) {
    return isGuest() ? '' : `<div class="quick-actions">
      <button class="link-btn" data-action="photo">${r.photo_path ? 'Change photo' : 'Add my photo'}</button>
      <input id="r-photo" type="file" accept="image/*" hidden></div>`;
  }
  const made = madeText(r);
  return `${made ? `<p class="muted made">${esc(made)}</p>` : ''}
    <div class="quick-actions">
      ${daysSinceMade(r) === 0 ? '' : '<button class="link-btn" data-action="made-today">I made this today</button>'}
    </div>`;
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

async function madeToday(r) {
  const before = r;
  const now = new Date().toISOString();
  replaceRecipe({ ...r, last_cooked_at: now });
  refreshRecipeTop(findRecipe(r.row));
  try {
    await updateRecipe(before, { last_cooked_at: now });
    toast('Marked as made today');
  } catch (e) {
    replaceRecipe(before);
    refreshRecipeTop(before);
    toast(offlineMessage(e));
  }
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
  return { link, name: '', category: '', status: STATUS.toTry, notes: '', title: '', force: false, error: '' };
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

// ---------- views: sign in ----------

function renderSignIn() {
  // "This link has expired" and the like, with the usual form a tap away.
  if (state.notice) {
    view().innerHTML = `
      <h1 class="join-title">${esc(state.notice.title)}</h1>
      <p class="join-text">${esc(state.notice.text)}</p>
      <div class="footer-action">
        <button class="link-btn sign-out" data-action="show-sign-in">Sign in with email</button>
      </div>
    `;
    return;
  }
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

/** The family link's welcome: just a name, then in. No email, no password. */
function renderJoin() {
  view().innerHTML = `
    <h1 class="join-title">Welcome!</h1>
    <p class="join-text">Mom’s recipes, on your phone.</p>
    <form id="join" novalidate>
      <label class="field" for="j-name">What’s your name?</label>
      <input id="j-name" type="text" autocomplete="given-name" autocapitalize="words" maxlength="40" enterkeyhint="go">
      <p class="error" id="j-error" hidden></p>
      <button class="primary block" style="margin-top:20px" type="submit">Continue as guest</button>
    </form>
  `;
}

// ---------- views: Visitors (Mom and Sharon only) ----------
// Who came in through the family link and when, the link to send again, and
// a way to make a new one.

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

const familyLink = code => `${location.origin}${location.pathname}#join=${code}`;

let visitorsLoading = false;
async function loadVisitors() {
  if (visitorsLoading || !state.user || isGuest()) return;
  visitorsLoading = true;
  try {
    await requireSession();
    const [guests, code, planned, added] = await Promise.all([
      query(db().from('guests').select('user_id, name, first_seen, last_seen').order('last_seen', { ascending: false })),
      query(db().rpc('get_family_code')),
      query(db().from('meal_plan').select('guest_id').not('guest_id', 'is', null)),
      query(db().from('recipes').select('owner').not('owner', 'is', null)),
    ]);
    const counts = {};
    const count = (id, k) => { counts[id] = counts[id] || { planned: 0, added: 0 }; counts[id][k] += 1; };
    planned.forEach(p => count(p.guest_id, 'planned'));
    added.forEach(r => count(r.owner, 'added'));
    const removing = pendingRemoval && pendingRemoval.guest.user_id;
    state.visitors = { ...(state.visitors || {}), guests: guests.filter(g => g.user_id !== removing), counts, code, error: '' };
  } catch (e) {
    state.visitors = { ...(state.visitors || { guests: [], counts: {} }), error: offlineMessage(e) };
  } finally {
    visitorsLoading = false;
  }
  if (location.hash === '#visitors') renderVisitors();
}

function renderVisitors() {
  if (!state.visitors) loadVisitors();
  view().innerHTML = `
    ${backHtml()}
    <h1>Visitors</h1>
    <p class="muted">Family who came in with the family link. They see Mom’s recipes and plan for themselves; they can’t change hers.</p>
    <div id="v-list">${visitorsListHtml()}</div>
    <h2 class="section">Family link</h2>
    <div id="v-link">${familyLinkHtml()}</div>
  `;
}

function visitorsListHtml() {
  const v = state.visitors;
  if (!v) return '<p class="muted">Loading…</p>';
  if (v.error && !v.guests.length) return `<p class="muted">${esc(v.error)}</p>`;
  if (!v.guests.length) return '<p class="muted empty">Nobody yet. Send the family link below.</p>';
  return `<ul class="visitors">${v.guests.map(g => {
    const c = v.counts[g.user_id] || { planned: 0, added: 0 };
    const did = [
      c.planned ? `${c.planned} dish${c.planned === 1 ? '' : 'es'} planned` : '',
      c.added ? `${c.added} recipe${c.added === 1 ? '' : 's'} added` : '',
    ].filter(Boolean).join(' · ');
    return `<li class="visitor">
      <div class="visitor-text">
        <span class="visitor-name">${esc(g.name)}</span>
        <span class="visitor-sub">Last visit ${esc(timeAgo(g.last_seen))} · First visit ${esc(timeAgo(g.first_seen))}</span>
        ${did ? `<span class="visitor-sub">${esc(did)}</span>` : ''}
      </div>
      <button type="button" class="link-btn danger-link visitor-remove" data-remove-guest="${esc(g.user_id)}" aria-label="Remove ${esc(g.name)}">Remove</button>
    </li>`;
  }).join('')}</ul>`;
}

function familyLinkHtml() {
  const v = state.visitors;
  if (!v) return '';
  if (!v.code) return `<p class="muted">${v.error ? esc(v.error) : 'No family link yet.'}</p>
    <button type="button" class="btn block" data-action="new-link">Make a link</button>`;
  return `<label class="sr-only" for="v-link-text">Family link</label>
    <input id="v-link-text" class="family-link" type="text" readonly value="${esc(familyLink(v.code))}">
    <div class="row link-actions">
      <button type="button" data-action="copy-link">Copy</button>
      ${navigator.share ? '<button type="button" class="primary" data-action="share-link">Share</button>' : ''}
    </div>
    ${v.fresh ? '<p class="muted small link-note">This is a new link. The old one won’t let anyone new in; people already in stay in.</p>' : ''}
    <button type="button" class="link-btn new-link" data-action="new-link">Make a new link</button>`;
}

function refreshVisitors() {
  if (location.hash !== '#visitors') return;
  const list = $('#v-list'), link = $('#v-link');
  if (list) list.innerHTML = visitorsListHtml();
  if (link) link.innerHTML = familyLinkHtml();
}

async function copyLink() {
  const url = familyLink(state.visitors.code);
  try {
    await navigator.clipboard.writeText(url);
  } catch (e) {
    // Older phones: select it and copy the old way.
    const input = $('#v-link-text');
    input.focus();
    input.select();
    if (!document.execCommand('copy')) return toast('Couldn’t copy. Press on the link to copy it.');
  }
  toast('Link copied');
}

async function shareLink() {
  const url = familyLink(state.visitors.code);
  try {
    await navigator.share({ title: 'Mom’s recipes', text: 'Mom’s recipes. Tap to come in:', url });
  } catch (e) {
    if (e && e.name !== 'AbortError') copyLink();
  }
}

async function newLink(btn) {
  btn.disabled = true;
  try {
    await requireSession();
    const code = await query(db().rpc('new_family_code'));
    state.visitors = { ...state.visitors, code, fresh: true };
    refreshVisitors();
    toast('New link made');
  } catch (e) {
    btn.disabled = false;
    toast(offlineMessage(e));
  }
}

// "Remove" takes the guest off the page at once, with Undo in the message;
// the database only hears about it once the message has gone (or she leaves
// the page), so Undo needs nothing from the server.
let pendingRemoval = null; // { guest, index, timer }

function removeGuestSoon(id) {
  const v = state.visitors;
  const index = v ? v.guests.findIndex(g => g.user_id === id) : -1;
  if (index < 0) return;
  flushRemoval();
  const guest = v.guests[index];
  v.guests = v.guests.filter(g => g !== guest);
  const timer = setTimeout(flushRemoval, 6000);
  pendingRemoval = { guest, index, timer };
  refreshVisitors();
  toast(`Removed ${guest.name}`, {
    label: 'Undo',
    run: () => {
      if (!pendingRemoval || pendingRemoval.guest !== guest) return;
      clearTimeout(timer);
      pendingRemoval = null;
      putBackGuest(guest, index);
    },
  });
}

function putBackGuest(guest, index) {
  const v = state.visitors;
  if (!v || v.guests.some(g => g.user_id === guest.user_id)) return;
  v.guests.splice(Math.min(index, v.guests.length), 0, guest);
  refreshVisitors();
}

async function flushRemoval() {
  const p = pendingRemoval;
  if (!p) return;
  pendingRemoval = null;
  clearTimeout(p.timer);
  try {
    await requireSession();
    await query(db().rpc('remove_guest', { guest: p.guest.user_id }));
  } catch (e) {
    putBackGuest(p.guest, p.index);
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
  if (state.user && joinCodeFrom(hash)) {
    // Already signed in (Mom, Sharon, or a guest): the family link isn't needed.
    history.replaceState({ idx: nav.idx }, '', location.pathname + '#today');
    nav.hashes[nav.idx] = hash = '#today';
  }
  const tab = hash.startsWith('#recipe') ? 'recipes' : hash.startsWith('#plan') ? 'plan'
    : hash === '#visitors' ? 'today' : hash.slice(1);
  document.querySelectorAll('.tabs a').forEach(a => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  updateListCount();
  placeTabMark(tab);
  view().dataset.screen = state.user ? hash.slice(1).split('/')[0] : 'signed-out';
  revealIfNew(state.user ? hash : `signed-out ${hash}`);

  if (!configured() || !state.user) {
    document.body.classList.add('no-tabs');
    if (!configured()) return renderNotConfigured();
    // Leave a form alone if it's already up, so nothing she's typed is lost.
    if (joinCodeFrom(hash)) return $('#join') ? undefined : renderJoin();
    if (state.notice) return renderSignIn();
    return $('#sign-in') ? undefined : renderSignIn();
  }
  document.body.classList.remove('no-tabs');

  // Don't wipe out what she's typing when a background refresh lands.
  const active = document.activeElement;
  if (active && view().contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
    if (hash === '#recipes') renderList();
    if (pickerRoute(hash)) renderPickerGrid();
    return;
  }

  if (hash.startsWith('#recipe/')) return renderRecipe(hash.split('/')[1]);
  if (hash === '#recipes') return renderRecipes();
  if (hash === '#add') return renderAdd();
  if (hash === '#list') { if (SHOPPING) return renderShopping(); location.replace('#today'); return; }
  if (hash === '#plan' || hash.startsWith('#plan/')) return renderPlanRoute(hash);
  if (hash === '#visitors' && !isGuest()) return renderVisitors();
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
  flushRemoval(); // a guest removed on the Visitors page, if she leaves before the Undo goes
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
  render();
  window.scrollTo(0, nav.scrolls[nav.idx] || 0);
  // Someone else may have changed the list or the plan on their phone.
  if (SHOPPING && hash === '#list') loadShopping();
  if (hash.startsWith('#plan')) loadPlan();
  if (hash === '#visitors') loadVisitors();
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
  } else if (id === 'r-name' || id === 'r-notes' || id === 'r-ingredients') {
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
  if (ds.chip) return toggleChip(ds.chip);
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
    if (ds.action === 'made-today') return madeToday(r);
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
    if (ds.action === 'save-new') return saveNew(el);
  }

  // Visitors
  if (hash === '#visitors') {
    if (ds.removeGuest) return removeGuestSoon(ds.removeGuest);
    if (ds.action === 'copy-link') return copyLink();
    if (ds.action === 'share-link') return shareLink();
    if (ds.action === 'new-link') return newLink(el);
  }

  if (ds.action === 'visitors') { location.hash = '#visitors'; return; }
  if (ds.action === 'leave-guest') return leaveGuest();
  if (ds.action === 'show-sign-in') { state.notice = null; return render(); }
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
  render();
  if (!sharing) showWelcome();
});

/** "Continue as guest": in with the code from the link, then the first page says hello. */
async function submitJoin(form) {
  const code = joinCodeFrom(location.hash);
  const name = $('#j-name').value.trim().replace(/\s+/g, ' ').slice(0, 40);
  const err = $('#j-error');
  const btn = form.querySelector('button');
  const fail = message => {
    err.textContent = message;
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Continue as guest';
  };
  if (!name) return fail('Type your name first.');
  btn.disabled = true;
  btn.textContent = 'Coming in…';
  try {
    await joinFamily(code, name);
  } catch (ex) {
    if (ex.message !== 'expired') return fail(joinMessage(ex));
    // The code is no good: take it out of the address and say so.
    state.notice = EXPIRED;
    history.replaceState({ idx: nav.idx }, '', location.pathname + '#today');
    nav.hashes[nav.idx] = '#today';
    return render();
  }
  if (document.activeElement) document.activeElement.blur();
  // The code has done its job: out of the address, so it isn't kept or shared on.
  history.replaceState({ idx: nav.idx }, '', location.pathname + '#today');
  nav.hashes[nav.idx] = '#today';
  await loadRecipes();
  loadShopping();
  loadPlan();
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
      }
      loadRecipes({ quiet: state.recipes.length > 0 });
      loadShopping();
      loadPlan();
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
function showWelcome(when = new Date()) {
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
    // "Yo Mom" each time she opens the app, but not when she's sharing a link in.
    if (configured() && state.user) showWelcome();
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
  if (document.visibilityState === 'hidden') flushRemoval();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
