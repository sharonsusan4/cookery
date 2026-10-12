// A pretend Supabase for trying the app locally (node dev/server.js --fake).
// It copies just the parts of supabase-js the app uses (sign in/out,
// anonymous sign-in, the session, the rpc() functions, simple queries on
// "recipes", "shopping_items", "meal_plan" and "guests", and Storage for the
// "dish-photos" bucket) and follows the same rules as supabase/schema.sql:
// signed-out or not-allowed people get no rows or photos and can't add any,
// family recipes can't be deleted, shopping list items and planned dishes
// can, and planned dishes can't be changed. The same dish can be planned any
// number of times (supabase/migrations/007_plan_repeats.sql), each its own row.
//
// Guest mode: open http://localhost:8787/, type a name and the pretend family
// code family-test (or open the old-style link /#join=family-test). "Change
// code" and "Make a new code" on the Visitors page replace it, and then
// family-test stops working. Mom and Sharon sign in at /#signin. A guest is an anonymous user with a row in
// "guests": they read the family's recipes (owner null) and their own, and
// only see and change shopping/plan rows with their own guest_id. An
// anonymous user who hasn't joined sees nothing. Allowed users read every
// row, as in the real rules; the app itself asks them for owner/guest_id null.
//
// Everything lives in this browser's localStorage (photos as data: URLs, so
// only a handful fit). In the console:
//   fakeDb.reset()         start again from the sample recipes, empty list, no photos
//   fakeDb.offline = true  make every request fail as if there's no internet
//   fakeDb.log             what the app asked for
//   fakeDb.photos()        the stored photo paths
//   fakeDb.code()          the current family code
//
// The recipes are made up (Mom's real ones must never be committed).
// With `server.js --fake --mine` the server adds window.FAKE_MINE (her real
// recipes, built from gitignored files) and that is used instead, kept under
// its own localStorage keys so it never mixes with the sample data. Her rows
// may carry a photo_path ("<id>/<file>.jpg") for a picture in dev/photos/;
// Storage hands those out as links to the server's /__dev/photos/ route, and
// tags (the Naadan / One pot collections) from dev/tags.txt. When a recipe's
// line in that file changes, a saved pretend database takes the new tags on
// the next load; otherwise what was changed in the app stays.

(() => {
  const PASSWORD = 'recipes';
  const USERS = ['mom@example.com', 'me@example.com', 'stranger@example.com'];
  const ALLOWED = ['mom@example.com', 'me@example.com'];
  // allowed_users.admin (migration 010): only "me" (Sharon) sees who came in (the guest list) and removes guests.
  const ADMINS = ['me@example.com'];
  const MINE = Array.isArray(window.FAKE_MINE) ? window.FAKE_MINE : null;
  const PREFIX = MINE ? 'fake-mine-' : 'fake-';
  const DB_KEY = `${PREFIX}db`;
  const SHOP_KEY = `${PREFIX}shopping`;
  const PLAN_KEY = `${PREFIX}plan`;
  const STORAGE_KEY = `${PREFIX}storage`;
  const SESSION_KEY = `${PREFIX}session`;
  const GUESTS_KEY = `${PREFIX}guests`;
  const CODE_KEY = `${PREFIX}family-code`;
  const TAGS_FILE_KEY = `${PREFIX}tags-file`; // --mine: dev/tags.txt as last put into the saved rows
  const FAILS_KEY = `${PREFIX}join-failures`;
  const FIRST_CODE = 'family-test';
  const BUCKET = 'dish-photos';

  // Days since some of the samples were last made, for "Last made" and for the
  // two-week skip in Today's suggestion. By sample name.
  const MADE_DAYS_AGO = { 'Masala dosa': 2, 'Fish curry': 5, 'Tomato soup': 1, 'Beef fry': 20, 'Payasam': 70, 'Avial': 0, 'Lemon rice': 3, 'Lime soda': 1 };

  // Messy on purpose, like her sheet: odd capitals, trailing spaces, blanks,
  // "ignore" rows and the same video twice.
  const SAMPLE = [
    ['Masala dosa', 'Breakfast ', 'Tried - Loved', 'https://youtu.be/AAAAAAAAAA1', 'YouTube', ['rice', 'urad dal', 'potato', 'onion', 'mustard']],
    ['Appam with stew', 'Breakfast', 'Tried - Loved', 'https://www.youtube.com/watch?v=AAAAAAAAAA2', 'YouTube', ['rice flour', 'coconut milk', 'potato', 'chicken', 'onion']],
    ['Fish curry', 'Main course ', 'Tried - Loved', 'https://www.instagram.com/reel/FakeReel01/', 'Instagram', ['fish', 'kudampuli', 'chilli powder', 'shallots', 'garlic']],
    ['Beef fry', 'Main Course', 'Tried - Loved', 'https://www.facebook.com/share/v/FakeVideo1/', 'Facebook', ['beef', 'coconut', 'onion', 'pepper', 'curry leaves']],
    ['Payasam', 'Dessert', 'Tried - Loved', 'https://youtube.com/shorts/AAAAAAAAAA3?feature=share', 'YouTube', ['vermicelli', 'milk', 'sugar', 'cashew', 'ghee']],
    ['Banana bread', 'Bread/Baking', 'Tried - Loved', 'https://www.instagram.com/p/FakePost02/', 'Instagram', ['banana', 'flour', 'sugar', 'butter', 'egg']],
    ['Lemon pickle', 'Sauce/Condiment', 'Tried - Loved', 'https://youtu.be/AAAAAAAAAA4', '', ['lemon', 'chilli powder', 'mustard', 'fenugreek']],
    ['Tomato soup', 'Soup', 'Tried - Loved', 'https://www.facebook.com/share/r/FakeReel03/', 'Facebook', ['tomato', 'onion', 'garlic', 'cream', 'butter']],
    ['Pazham pori', 'Appetizer/Snack', 'Tried - Loved', 'https://youtu.be/AAAAAAAAAA5', 'YouTube', ['ripe plantain', 'maida', 'sugar', 'turmeric']],
    ['Chicken biryani', 'Lunch', 'Tried - Loved', 'https://youtu.be/AAAAAAAAAA6', 'YouTube', ['rice', 'chicken', 'onion', 'tomato', 'curd', 'biryani masala']],
    ['Chicken pepper roast', 'Dinner', 'To try', 'https://youtu.be/AAAAAAAAAB1', 'YouTube', ['chicken', 'onion', 'tomato', 'pepper', 'coconut oil']],
    ['Prawns fry', 'Main Course', 'To try', 'https://youtu.be/AAAAAAAAAB2', 'YouTube', ['prawns', 'chilli powder', 'pepper', 'curry leaves']],
    ['Mutton kurma', 'Dinner', 'To try', 'https://youtu.be/AAAAAAAAAB3', 'YouTube', ['mutton', 'coconut', 'cashew', 'tomato', 'garam masala']],
    ['Paneer tikka', 'Appetizer/Snack', 'To try', 'https://youtu.be/AAAAAAAAAB4', 'YouTube', ['paneer', 'curd', 'capsicum', 'lemon']],
    ['Makhani chicken', 'Dinner', 'Tried - Loved', 'https://youtu.be/AAAAAAAAAB5', 'YouTube', ['chicken', 'butter', 'cream', 'tomato', 'cashew']],
    ['Egg roast', 'Breakfast', 'To try', 'https://youtu.be/AAAAAAAAAB6', 'YouTube', ['egg', 'onion', 'tomato', 'coconut oil']],
    ['Avial', 'Side Dish', 'To try', 'https://youtu.be/AAAAAAAAAA7', 'YouTube', ['mixed vegetables', 'coconut', 'curd', 'green chilli', 'curry leaves']],
    ['Idiyappam', 'Breakfast', '', 'https://www.instagram.com/reel/FakeReel04/?igsh=abc', 'Instagram', null],
    ['Mango lassi', 'Drink/Beverage', 'Tried -okay', 'https://youtu.be/AAAAAAAAAA8', 'YouTube', ['mango', 'curd', 'sugar', 'cardamom']],
    ['', '', 'To Try', 'https://youtu.be/AAAAAAAAAA9', 'YouTube', null],
    ['repeat -ignore', '', 'To Try', 'https://youtu.be/AAAAAAAAAA1?si=again', 'YouTube', null],
    ['Kozhukatta', 'Sweet Snack/Mithai', 'Tried - Skip Next Time', 'https://example.com/kozhukatta-recipe/', 'Other', null],
    // More made-up dishes so every meal on Today has a few quick and gourmet ones.
    ['Bread omelette', 'Breakfast', 'Tried - Loved', 'https://youtu.be/AAAAAAAAAC1', 'YouTube', ['bread', 'egg', 'onion', 'green chilli']],
    ['Rava upma', 'Breakfast', 'To Try', 'https://youtu.be/AAAAAAAAAC2', 'YouTube', ['rava', 'onion', 'mustard', 'curry leaves']],
    ['Ghee roast dosa', 'Breakfast', 'To Try', 'https://www.instagram.com/reel/FakeReel05/', 'Instagram', ['rice', 'urad dal', 'ghee']],
    ['Mushroom shakshuka', 'Breakfast', 'Tried - Loved', 'https://youtu.be/AAAAAAAAAC3', 'YouTube', ['egg', 'mushroom', 'tomato', 'capsicum']],
    ['Idli batter for the week', 'Breakfast', 'To Try', 'https://youtu.be/AAAAAAAAAC4', 'YouTube', ['rice', 'urad dal', 'fenugreek']],
    ['Lemon rice', 'Lunch', 'Tried - Loved', 'https://youtu.be/AAAAAAAAAC5', 'YouTube', ['rice', 'lemon', 'peanut', 'curry leaves']],
    ['Duck roast', 'Main Course', 'To Try', 'https://www.facebook.com/share/v/FakeVideo2/', 'Facebook', ['duck', 'onion', 'pepper', 'coconut milk']],
    ['Beetroot thoran', 'Side Dish', 'Tried - Okay', 'https://youtu.be/AAAAAAAAAC6', 'YouTube', ['beetroot', 'coconut', 'mustard']],
    ['Masala peanuts', 'Appetizer/Snack', 'To Try', 'https://youtu.be/AAAAAAAAAC7', 'YouTube', ['peanut', 'gram flour', 'chilli powder']],
    ['Stuffed mushrooms', 'Appetizer/Snack', 'To Try', 'https://youtu.be/AAAAAAAAAC8', 'YouTube', ['mushroom', 'cheese', 'garlic']],
    ['Onion pakoda', 'Appetizer/Snack', 'Tried - Loved', 'https://youtu.be/AAAAAAAAAC9', 'YouTube', ['onion', 'gram flour', 'green chilli']],
    ['Mug cake', 'Dessert', 'To Try', 'https://youtu.be/AAAAAAAAAD1', 'YouTube', ['flour', 'cocoa', 'milk', 'sugar']],
    ['Rose falooda', 'Dessert', 'Tried - Loved', 'https://www.instagram.com/reel/FakeReel06/', 'Instagram', ['milk', 'rose syrup', 'vermicelli', 'basil seeds']],
    ['Dried mango strips', 'Sweet Snack/Mithai', 'To Try', 'https://youtu.be/AAAAAAAAAD2', 'YouTube', ['mango', 'sugar']],
    ['Lime soda', 'Drink/Beverage', 'Tried - Loved', 'https://youtu.be/AAAAAAAAAD3', 'YouTube', ['lemon', 'soda', 'sugar', 'salt']],
    ['Masala chai', 'Drink/Beverage', 'Tried - Loved', 'https://youtu.be/AAAAAAAAAD4', 'YouTube', ['tea', 'milk', 'ginger', 'cardamom']],
    ['Saffron almond milk', 'Drink/Beverage', 'To Try', 'https://youtu.be/AAAAAAAAAD5', 'YouTube', ['milk', 'almond', 'saffron', 'sugar']],
    ['Watermelon mojito', 'Drink/Beverage', 'To Try', 'https://youtu.be/AAAAAAAAAD6', 'YouTube', ['watermelon', 'mint', 'lemon', 'soda']],
    ['Cucumber raita', 'Sauce/Condiment', 'Tried - Loved', 'https://youtu.be/AAAAAAAAAD7', 'YouTube', ['cucumber', 'curd', 'cumin']],
    ['Ginger garlic paste', 'Sauce/Condiment', 'To Try', 'https://youtu.be/AAAAAAAAAD8', 'YouTube', ['ginger', 'garlic', 'oil']],
    ['Garlic naan', 'Bread/Baking', 'To Try', 'https://youtu.be/AAAAAAAAAD9', 'YouTube', ['maida', 'curd', 'garlic', 'butter']],
  ];

  // recipes.effort: 'quick', 'gourmet', 'storage' (never a meal), or null
  // (everyday, the default for anything not listed). By sample name.
  const EFFORT = {
    'Egg roast': 'quick', 'Bread omelette': 'quick', 'Rava upma': 'quick',
    'Appam with stew': 'gourmet', 'Ghee roast dosa': 'gourmet', 'Mushroom shakshuka': 'gourmet',
    'Prawns fry': 'quick', 'Avial': 'quick', 'Lemon rice': 'quick', 'Beetroot thoran': 'quick', 'Chicken pepper roast': 'quick',
    'Chicken biryani': 'gourmet', 'Beef fry': 'gourmet', 'Duck roast': 'gourmet', 'Mutton kurma': 'gourmet', 'Makhani chicken': 'gourmet',
    'Pazham pori': 'quick', 'Masala peanuts': 'quick', 'Paneer tikka': 'gourmet', 'Stuffed mushrooms': 'gourmet',
    'Banana bread': 'quick', 'Mug cake': 'quick', 'Payasam': 'gourmet', 'Rose falooda': 'gourmet',
    'Mango lassi': 'quick', 'Lime soda': 'quick', 'Saffron almond milk': 'gourmet', 'Watermelon mojito': 'gourmet',
    'Cucumber raita': 'quick', 'Garlic naan': 'gourmet', 'Tomato soup': 'gourmet',
    'Lemon pickle': 'storage', 'Ginger garlic paste': 'storage', 'Idli batter for the week': 'storage', 'Dried mango strips': 'storage',
  };

  // recipes.tags: the collections ('naadan', 'onepot', migration 008), or null. By sample name.
  const TAGS = {
    'Appam with stew': ['naadan'], 'Fish curry': ['naadan'], 'Beef fry': ['naadan'], 'Avial': ['naadan'],
    'Pazham pori': ['naadan'], 'Rava upma': ['naadan', 'onepot'],
    'Chicken biryani': ['onepot'], 'Lemon rice': ['onepot'], 'Mushroom shakshuka': ['onepot'],
  };

  const clone = x => JSON.parse(JSON.stringify(x));
  const read = (key, fallback) => {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  };
  const write = (key, v) => localStorage.setItem(key, JSON.stringify(v));

  function seed() {
    const now = new Date().toISOString();
    if (MINE) {
      return MINE.map(r => ({
        notes: '', protein: null, last_cooked_at: null, photo_path: null, meals: null, tags: null,
        ...r, owner: null, link_key: linkKey(r.link), created_at: now, updated_at: now,
      }));
    }
    const daysAgo = n => (n == null ? null : new Date(Date.now() - n * 86400000).toISOString());
    return SAMPLE.map(([name, category, status, link, source, ingredients], i) => ({
      id: i + 1, name, category, status, link, link_key: linkKey(link), source, notes: '',
      protein: null, ingredients, last_cooked_at: daysAgo(MADE_DAYS_AGO[name]), photo_path: null,
      effort: EFFORT[name] || null, meals: null, tags: TAGS[name] || null, owner: null,
      created_at: now, updated_at: now,
    }));
  }

  // Each table: where it's kept, what a new row starts as, and what may be done to it.
  const TABLES = {
    recipes: {
      key: DB_KEY, seed,
      blank: () => ({ name: '', category: '', status: '', link_key: '', source: '', notes: '', protein: null, ingredients: null, last_cooked_at: null, photo_path: null, effort: null, meals: null, tags: null, owner: null }),
      notNull: ['link'],
      canDelete: true, // only a guest's own (the rules), never a family recipe (the trigger)
    },
    shopping_items: {
      key: SHOP_KEY, seed: () => [],
      blank: () => ({ recipe_id: null, done: false, guest_id: null }),
      notNull: ['item'],
      canDelete: true,
    },
    meal_plan: {
      key: PLAN_KEY, seed: () => [],
      blank: () => ({ guest_id: null }),
      notNull: ['day', 'meal', 'recipe_id'],
      canDelete: true,
      canUpdate: false, // no unique rule: the same dish may be planned again (007)
    },
    // Read by allowed users only; written only by the rpc() functions below.
    guests: {
      key: GUESTS_KEY, seed: () => [],
      readOnly: true,
    },
  };

  const fakeDb = {
    offline: false,
    log: [],
    rows: (table = 'recipes') => {
      const saved = read(TABLES[table].key, null);
      if (!saved) return TABLES[table].seed();
      // Photos downloaded into dev/photos/ after this pretend database was saved.
      if (MINE && table === 'recipes') {
        const photo = new Map(MINE.filter(r => r.photo_path).map(r => [String(r.id), r.photo_path]));
        saved.forEach(r => { if (!r.photo_path && photo.has(String(r.id))) r.photo_path = photo.get(String(r.id)); });
      }
      if (table === 'recipes') syncTags(saved);
      return saved;
    },
    save: (rows, table = 'recipes') => write(TABLES[table].key, rows),
    photos: () => Object.keys(read(STORAGE_KEY, {})),
    code: () => read(CODE_KEY, FIRST_CODE),
    reset() {
      [DB_KEY, SHOP_KEY, PLAN_KEY, STORAGE_KEY, SESSION_KEY, GUESTS_KEY, CODE_KEY, FAILS_KEY, TAGS_FILE_KEY].forEach(k => localStorage.removeItem(k));
      return 'Reset. Reload the page.';
    },
  };
  window.fakeDb = fakeDb;

  /**
   * A pretend database saved before tags existed gets the sample ones (or, with
   * --mine, dev/tags.txt's). With --mine, a recipe whose line in dev/tags.txt
   * has changed since the last load takes the file's tags; the rest keep any
   * change made in the app. Saved straight away, so it happens once.
   */
  let seedTags = null;
  function syncTags(rows) {
    const family = r => r.owner == null;
    let changed = false;
    if (rows.some(r => !('tags' in r))) {
      seedTags = seedTags || new Map(seed().map(r => [String(r.id), r.tags]));
      rows.forEach(r => { if (!('tags' in r)) { r.tags = family(r) ? seedTags.get(String(r.id)) || null : null; changed = true; } });
    }
    if (MINE) {
      const file = Object.fromEntries(MINE.map(r => [String(r.id), (r.tags || []).join(',')]));
      const last = read(TAGS_FILE_KEY, null);
      if (last) {
        rows.forEach(r => {
          const id = String(r.id);
          if (family(r) && id in file && file[id] !== last[id]) { r.tags = file[id] ? file[id].split(',') : null; changed = true; }
        });
      }
      if (JSON.stringify(last) !== JSON.stringify(file)) write(TAGS_FILE_KEY, file);
    }
    if (changed) write(DB_KEY, rows);
  }

  // Like a real request: a short wait, and it can fail when "offline".
  async function network(what) {
    fakeDb.log.push(what);
    await new Promise(r => setTimeout(r, 120));
    if (fakeDb.offline) throw new TypeError('Failed to fetch');
  }
  const netError = e => ({ message: `${e.name}: ${e.message}`, details: '', hint: '', code: '' });

  const session = () => read(SESSION_KEY, null);
  const uid = () => { const s = session(); return s ? s.user.id : null; };
  const allowed = () => { const s = session(); return !!s && ALLOWED.includes(String(s.user.email || '').toLowerCase()); };
  const admin = () => { const s = session(); return !!s && ADMINS.includes(String(s.user.email || '').toLowerCase()); };
  const isGuest = () => !!uid() && fakeDb.rows('guests').some(g => g.user_id === uid());
  const same = (a, b) => String(a ?? null) === String(b ?? null);

  // The Row Level Security rules, per table. `see`: which rows a select can
  // reach; `change` and `del`: which an update or delete can (when they differ
  // from `see`). `add`: whether an insert (or the row after an update) is allowed.
  const RULES = {
    recipes: {
      see: r => allowed() || (isGuest() && (r.owner == null || r.owner === uid())),
      add: r => allowed() || (isGuest() && r.owner === uid()),
      change: r => allowed() || (isGuest() && r.owner === uid()),
      // Allowed users have no delete rule; a guest only their own.
      del: r => isGuest() && r.owner === uid(),
    },
    shopping_items: {
      see: r => allowed() || (isGuest() && r.guest_id === uid()),
      add: r => allowed() || (isGuest() && r.guest_id === uid()),
    },
    meal_plan: {
      see: r => allowed() || (isGuest() && r.guest_id === uid()),
      add: r => allowed() || (isGuest() && r.guest_id === uid()),
    },
    guests: { see: () => admin(), add: () => false },
  };
  const rls = table => ({ code: '42501', message: `new row violates row-level security policy for table "${table}"` });

  // ---------- queries on "recipes" ----------

  class Query {
    constructor(table) {
      this.table = table;
      this.op = 'select';
      this.cols = '*';
      this.filters = [];
      this.sort = null;
      this.start = 0;
      this.end = Infinity;
      this.one = false;
    }
    select(cols = '*') { this.cols = cols; return this; }
    insert(row) { this.op = 'insert'; this.payload = row; return this; }
    update(changes) { this.op = 'update'; this.payload = changes; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(col, value) { this.filters.push([col, v => String(v) === String(value)]); return this; }
    gte(col, value) { this.filters.push([col, v => v != null && String(v) >= String(value)]); return this; }
    in(col, values) { this.filters.push([col, v => values.map(String).includes(String(v))]); return this; }
    is(col, value) { this.filters.push([col, v => (value === null ? v == null : v === value)]); return this; }
    not(col, op, value) {
      if (op !== 'is') throw new Error(`fake-supabase: not(${op}) isn't copied`);
      this.filters.push([col, v => (value === null ? v != null : v !== value)]);
      return this;
    }
    order(col, { ascending = true } = {}) { this.sort = [col, ascending]; return this; }
    range(from, to) { this.start = from; this.end = to; return this; }
    limit(n) { this.end = this.start + n - 1; return this; }
    single() { this.one = true; return this; }
    then(resolve, reject) { return this.run().then(resolve, reject); }

    pick(row) {
      if (this.cols === '*') return clone(row);
      const out = {};
      for (const c of this.cols.split(',').map(s => s.trim())) out[c] = row[c];
      return out;
    }

    async run() {
      try {
        await network(`${this.op} ${this.table} ${JSON.stringify(this.filters.map(f => f[0]))}`);
      } catch (e) {
        return { data: null, error: netError(e) };
      }
      const t = TABLES[this.table];
      if (!t) return { data: null, error: { code: '42P01', message: `relation "${this.table}" does not exist` } };
      let rows = fakeDb.rows(this.table);
      const rule = RULES[this.table];
      let out;
      if (t.readOnly && this.op !== 'select') return { data: null, error: { code: '42501', message: `permission denied for table ${this.table}` } };
      if (this.op === 'insert') {
        if (!rule.add({ ...t.blank(), ...this.payload })) return { data: null, error: rls(this.table) };
        const missing = t.notNull.find(c => this.payload[c] == null);
        if (missing) return { data: null, error: { code: '23502', message: `null value in column "${missing}"` } };
        if ((this.table === 'shopping_items' || this.table === 'meal_plan') && this.payload.recipe_id != null &&
            !fakeDb.rows('recipes').some(r => String(r.id) === String(this.payload.recipe_id))) {
          return { data: null, error: { code: '23503', message: `insert or update on table "${this.table}" violates foreign key constraint` } };
        }
        if (t.unique && rows.some(r => t.unique.every(c => same(r[c], this.payload[c])))) {
          return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${this.table}_${t.unique.join('_')}_key"` } };
        }
        const now = new Date().toISOString();
        const row = {
          id: rows.reduce((m, r) => Math.max(m, r.id), 0) + 1,
          ...t.blank(), ...this.payload, created_at: now,
        };
        if (this.table === 'recipes') row.updated_at = now;
        rows.push(row);
        fakeDb.save(rows, this.table);
        out = [row];
      } else {
        if (this.op === 'update' && t.canUpdate === false) return { data: null, error: { code: '42501', message: `permission denied for table ${this.table}` } };
        if (this.op === 'delete' && !t.canDelete) return { data: null, error: { code: '42501', message: `permission denied for table ${this.table}` } };
        // Same as the RLS rules: only the rows this person may see (and, for a
        // delete, may delete) are touched at all.
        let hit = rows.filter(r => rule.see(r) && this.filters.every(([c, test]) => test(r[c])));
        if (this.op === 'update' && rule.change) hit = hit.filter(rule.change);
        if (this.op === 'delete' && rule.del) hit = hit.filter(rule.del);
        if (this.op === 'update') {
          // The rows as they'd be afterwards must pass the rules too (WITH CHECK).
          if (hit.some(r => !rule.add({ ...r, ...this.payload }))) return { data: null, error: rls(this.table) };
          hit.forEach(r => Object.assign(r, this.payload, this.table === 'recipes' ? { updated_at: new Date().toISOString() } : {}));
          fakeDb.save(rows, this.table);
        }
        if (this.op === 'delete') {
          // The keep_family_recipes trigger.
          if (this.table === 'recipes' && hit.some(r => r.owner == null)) return { data: null, error: { code: '42501', message: 'Family recipes are never deleted' } };
          // What the database does by itself: a deleted recipe leaves the plan
          // and its shopping items move to "Other".
          if (this.table === 'recipes' && hit.length) {
            const gone = new Set(hit.map(r => String(r.id)));
            fakeDb.save(fakeDb.rows('meal_plan').filter(p => !gone.has(String(p.recipe_id))), 'meal_plan');
            fakeDb.save(fakeDb.rows('shopping_items').map(x => (gone.has(String(x.recipe_id)) ? { ...x, recipe_id: null } : x)), 'shopping_items');
          }
          fakeDb.save(rows.filter(r => !hit.includes(r)), this.table);
          // Like supabase-js: no rows back unless .select() was asked for.
          if (this.cols === '*') return { data: null, error: null };
        }
        if (this.sort) {
          const [c, asc] = this.sort;
          hit = [...hit].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1));
        }
        out = hit.slice(this.start, this.end + 1);
      }
      out = out.map(r => this.pick(r));
      if (this.one) {
        if (out.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } };
        return { data: out[0], error: null };
      }
      return { data: out, error: null };
    }
  }

  // ---------- storage ----------
  // Like the storage.objects rules: allowed people and guests can see photos,
  // only allowed people can add, replace or remove them, and only in the
  // dish-photos bucket. Photos are kept as
  // data: URLs and a "signed URL" is just that data: URL. With her recipes
  // (--mine), any other path is one of the pictures in dev/photos/, served by
  // dev/server.js (which answers 404 if the file isn't there).
  const minePhotoUrl = p => `/__dev/photos/${String(p).split('/').map(encodeURIComponent).join('/')}`;

  const toDataUrl = blob => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });

  function bucket(name) {
    const files = () => read(STORAGE_KEY, {});
    const check = async (what, write = true) => {
      await network(`storage ${what} ${name}`);
      if (name !== BUCKET) return { message: 'Bucket not found', statusCode: '404' };
      if (!(allowed() || (!write && isGuest()))) return { message: 'new row violates row-level security policy', statusCode: '403' };
      return null;
    };
    const fail = e => ({ data: null, error: e.statusCode ? e : { message: e.message, statusCode: '' } });
    return {
      async upload(path, file, { upsert = false, contentType } = {}) {
        try {
          const denied = await check(`upload ${path}`);
          if (denied) return fail(denied);
          const all = files();
          if (all[path] && !upsert) return fail({ message: 'The resource already exists', statusCode: '409' });
          all[path] = { url: await toDataUrl(file), type: contentType || file.type, size: file.size, at: new Date().toISOString() };
          write(STORAGE_KEY, all); // throws if the browser's storage is full
          return { data: { path, id: path, fullPath: `${name}/${path}` }, error: null };
        } catch (e) { return fail(e); }
      },
      async remove(paths) {
        try {
          const denied = await check(`remove ${paths.join(' ')}`);
          if (denied) return fail(denied);
          const all = files();
          const gone = paths.filter(p => all[p]);
          gone.forEach(p => delete all[p]);
          write(STORAGE_KEY, all);
          return { data: gone.map(p => ({ name: p, bucket_id: name })), error: null };
        } catch (e) { return fail(e); }
      },
      async createSignedUrls(paths) {
        try {
          const denied = await check(`signedUrls ${paths.length}`, false);
          if (denied) return fail(denied);
          const all = files();
          return {
            data: paths.map(p => (all[p]
              ? { path: p, signedUrl: all[p].url, error: null }
              : MINE ? { path: p, signedUrl: minePhotoUrl(p), error: null }
                : { path: p, signedUrl: null, error: 'Object not found' })),
            error: null,
          };
        } catch (e) { return fail(e); }
      },
      async createSignedUrl(path, expiresIn) {
        const { data, error } = await this.createSignedUrls([path], expiresIn);
        if (error) return { data: null, error };
        if (!data[0].signedUrl) return fail({ message: 'Object not found', statusCode: '404' });
        return { data: { signedUrl: data[0].signedUrl }, error: null };
      },
    };
  }

  // ---------- rpc() functions (supabase/migrations/005_guests.sql, 009_family_code.sql) ----------

  // private.clean_family_code(): lowercase, trimmed, inner spaces made single.
  const cleanCode = code => String(code ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

  const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
  const notAllowed = what => ({ code: '42501', message: `Only allowed users can ${what}` });
  const saveGuests = rows => fakeDb.save(rows, 'guests');

  const RPC = {
    is_allowed: () => allowed(),
    is_admin: () => admin(),
    is_guest: () => isGuest(),
    join_family({ code, name }) {
      const id = uid();
      if (!id || allowed()) return false;
      const fails = read(FAILS_KEY, []).filter(f => f.user_id === id && Date.now() - f.at < 15 * 60000);
      if (fails.length >= 10) return false;
      if (cleanCode(code) !== cleanCode(fakeDb.code())) {
        write(FAILS_KEY, [...read(FAILS_KEY, []).filter(f => Date.now() - f.at < 86400000), { user_id: id, at: Date.now() }]);
        return false;
      }
      const clean = String(name ?? '').replace(/[\s\p{Cc}]+/gu, ' ').trim().slice(0, 40).trim();
      if (!clean) return false;
      const now = new Date().toISOString();
      const rows = fakeDb.rows('guests');
      const g = rows.find(x => x.user_id === id);
      if (g) Object.assign(g, { name: clean, last_seen: now });
      else rows.push({ user_id: id, name: clean, first_seen: now, last_seen: now });
      saveGuests(rows);
      return true;
    },
    touch_guest() {
      const rows = fakeDb.rows('guests');
      const g = rows.find(x => x.user_id === uid());
      if (!g) return null;
      g.last_seen = new Date().toISOString();
      saveGuests(rows);
      return g.name;
    },
    new_family_code() {
      if (!allowed()) throw notAllowed('make a family link');
      const bytes = crypto.getRandomValues(new Uint8Array(64));
      const code = [...bytes].filter(b => b < 248).slice(0, 12).map(b => ALPHABET[b % 31]).join('');
      write(CODE_KEY, code);
      return code;
    },
    set_family_code({ code }) {
      if (!allowed()) throw notAllowed('change the family code');
      const clean = cleanCode(code);
      if (clean.length < 6) throw { code: '22023', message: 'The family code needs at least 6 letters or numbers.' };
      if (clean.length > 40) throw { code: '22023', message: 'The family code can have at most 40 letters or numbers.' };
      write(CODE_KEY, clean);
      return clean;
    },
    get_family_code() {
      if (!allowed()) throw notAllowed('see the family link');
      return fakeDb.code();
    },
    remove_guest({ guest }) {
      if (!admin()) throw notAllowed('remove a guest');
      const rows = fakeDb.rows('guests');
      saveGuests(rows.filter(g => g.user_id !== guest));
      return rows.some(g => g.user_id === guest);
    },
  };

  // ---------- auth ----------

  const listeners = [];
  const notify = (event, s) => listeners.forEach(cb => cb(event, s));

  const auth = {
    async getSession() {
      return { data: { session: session() }, error: null };
    },
    async signInWithPassword({ email, password }) {
      try { await network(`signIn ${email}`); } catch (e) { return { data: { user: null, session: null }, error: { name: 'AuthRetryableFetchError', message: e.message, status: 0 } }; }
      const e = String(email).toLowerCase();
      if (!USERS.includes(e) || password !== PASSWORD) {
        return { data: { user: null, session: null }, error: { name: 'AuthApiError', code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' } };
      }
      const s = { access_token: 'fake', user: { id: e, email: e, is_anonymous: false } };
      write(SESSION_KEY, s);
      notify('SIGNED_IN', s);
      return { data: { user: s.user, session: s }, error: null };
    },
    // A new anonymous user each time, like Supabase's; it's nobody until join_family().
    async signInAnonymously() {
      try { await network('signInAnonymously'); } catch (e) { return { data: { user: null, session: null }, error: { name: 'AuthRetryableFetchError', message: e.message, status: 0 } }; }
      const s = { access_token: 'fake', user: { id: crypto.randomUUID(), email: '', is_anonymous: true } };
      write(SESSION_KEY, s);
      notify('SIGNED_IN', s);
      return { data: { user: s.user, session: s }, error: null };
    },
    async signOut() {
      try { await network('signOut'); } catch (e) { return { error: { message: e.message } }; }
      localStorage.removeItem(SESSION_KEY);
      notify('SIGNED_OUT', null);
      return { error: null };
    },
    onAuthStateChange(cb) {
      listeners.push(cb);
      setTimeout(() => cb('INITIAL_SESSION', session()), 0);
      return { data: { subscription: { unsubscribe() { listeners.splice(listeners.indexOf(cb), 1); } } } };
    },
  };

  window.supabase = {
    createClient(url, key) {
      fakeDb.log.push(`createClient ${url}`);
      return {
        auth,
        from: table => new Query(table),
        storage: { from: bucket },
        async rpc(name, args = {}) {
          try { await network(`rpc ${name}`); } catch (e) { return { data: null, error: netError(e) }; }
          const fn = RPC[name];
          if (!fn) return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}` } };
          try { return { data: fn(args), error: null }; } catch (e) { return { data: null, error: e }; }
        },
      };
    },
  };
})();
