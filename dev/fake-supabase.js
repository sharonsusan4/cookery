// A pretend Supabase for trying the app locally (node dev/server.js --fake).
// It copies just the parts of supabase-js the app uses (sign in/out, the
// session, rpc('is_allowed') and simple queries on "recipes") and follows the
// same rules as supabase/schema.sql: signed-out or not-allowed people get no
// rows and can't add any, and nothing can be deleted.
//
// Everything lives in this browser's localStorage. In the console:
//   fakeDb.reset()         start again from the sample recipes
//   fakeDb.offline = true  make every request fail as if there's no internet
//   fakeDb.log             what the app asked for
//
// The recipes are made up (Mom's real ones must never be committed).

(() => {
  const PASSWORD = 'recipes';
  const USERS = ['mom@example.com', 'me@example.com', 'stranger@example.com'];
  const ALLOWED = ['mom@example.com', 'me@example.com'];
  const DB_KEY = 'fake-db';
  const SESSION_KEY = 'fake-session';

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
    ['Avial', 'Side Dish', 'To try', 'https://youtu.be/AAAAAAAAAA7', 'YouTube', ['mixed vegetables', 'coconut', 'curd', 'green chilli', 'curry leaves']],
    ['Idiyappam', 'Breakfast', '', 'https://www.instagram.com/reel/FakeReel04/?igsh=abc', 'Instagram', null],
    ['Mango lassi', 'Drink/Beverage', 'Tried -okay', 'https://youtu.be/AAAAAAAAAA8', 'YouTube', ['mango', 'curd', 'sugar', 'cardamom']],
    ['', '', 'To Try', 'https://youtu.be/AAAAAAAAAA9', 'YouTube', null],
    ['repeat -ignore', '', 'To Try', 'https://youtu.be/AAAAAAAAAA1?si=again', 'YouTube', null],
    ['Kozhukatta', 'Sweet Snack/Mithai', 'Tried - Skip Next Time', 'https://example.com/kozhukatta-recipe/', 'Other', null],
  ];

  const clone = x => JSON.parse(JSON.stringify(x));
  const read = (key, fallback) => {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  };
  const write = (key, v) => localStorage.setItem(key, JSON.stringify(v));

  function seed() {
    const now = new Date().toISOString();
    return SAMPLE.map(([name, category, status, link, source, ingredients], i) => ({
      id: i + 1, name, category, status, link, link_key: linkKey(link), source, notes: '',
      protein: null, ingredients, created_at: now, updated_at: now,
    }));
  }

  const fakeDb = {
    offline: false,
    log: [],
    rows: () => read(DB_KEY, null) || seed(),
    save: rows => write(DB_KEY, rows),
    reset() { localStorage.removeItem(DB_KEY); localStorage.removeItem(SESSION_KEY); return 'Reset. Reload the page.'; },
  };
  window.fakeDb = fakeDb;

  // Like a real request: a short wait, and it can fail when "offline".
  async function network(what) {
    fakeDb.log.push(what);
    await new Promise(r => setTimeout(r, 120));
    if (fakeDb.offline) throw new TypeError('Failed to fetch');
  }
  const netError = e => ({ message: `${e.name}: ${e.message}`, details: '', hint: '', code: '' });

  const session = () => read(SESSION_KEY, null);
  const allowed = () => { const s = session(); return !!s && ALLOWED.includes(s.user.email.toLowerCase()); };

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
    eq(col, value) { this.filters.push([col, value]); return this; }
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
        await network(`${this.op} ${this.table} ${JSON.stringify(this.filters)}`);
      } catch (e) {
        return { data: null, error: netError(e) };
      }
      if (this.table !== 'recipes') return { data: null, error: { code: '42P01', message: `relation "${this.table}" does not exist` } };
      let rows = fakeDb.rows();
      let out;
      if (this.op === 'insert') {
        if (!allowed()) return { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "recipes"' } };
        if (!this.payload.link && this.payload.link !== '') return { data: null, error: { code: '23502', message: 'null value in column "link"' } };
        const now = new Date().toISOString();
        const row = {
          id: rows.reduce((m, r) => Math.max(m, r.id), 0) + 1,
          name: '', category: '', status: '', link_key: '', source: '', notes: '', protein: null, ingredients: null,
          ...this.payload, created_at: now, updated_at: now,
        };
        rows.push(row);
        fakeDb.save(rows);
        out = [row];
      } else {
        // Same as the RLS rules: nothing visible unless allowed.
        let hit = allowed() ? rows.filter(r => this.filters.every(([c, v]) => String(r[c]) === String(v))) : [];
        if (this.op === 'update') {
          hit.forEach(r => Object.assign(r, this.payload, { updated_at: new Date().toISOString() }));
          fakeDb.save(rows);
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
      const s = { access_token: 'fake', user: { id: e, email: e } };
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
        async rpc(name) {
          try { await network(`rpc ${name}`); } catch (e) { return { data: null, error: netError(e) }; }
          if (name !== 'is_allowed') return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}` } };
          return { data: allowed(), error: null };
        },
      };
    },
  };
})();
