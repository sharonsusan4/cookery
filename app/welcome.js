'use strict';

// The "Yo Mom" first page, landing like a game of noughts and crosses (XO).
//
// Calm on purpose: Mom found flipping cards too fast. The squares are
// coloured like an XO board, in two colours: X (warm) on the corners and
// centre, O (green) on the rest. The nine dishes are "played" into them one
// at a time, X and O taking turns as in a game: each square settles into
// place and its line icon draws itself, then its name fades in. Meanwhile, under
// "Yo Mom", "Let’s cook…" and a meal word changes slowly (Dinner, Desserts…)
// and settles on the meal for now; the dishes are that meal's, to give her
// ideas. Two buttons: Quick & easy or Gourmet, which open Today for that
// meal; a dish, once it's played, opens its recipe. Tapping during the
// animation skips to the end.
//
// Every frame comes from seek(t) alone, so a given moment always looks the
// same. window.seekWelcome(t) shows any moment.

const Welcome = (() => {
  const T = {
    title: [0.1, 0.8], // "Yo Mom" and "Let's cook…"
    moves: 0.45, moveGap: 0.28, // one dish played every 0.28s
    place: 0.35, // a square settling into place
    drawTime: 0.7, // its icon drawing itself; the name fades in from halfway
    first: 0.7, // the first meal word
    // Time between words, slowing down as it settles. With fewer words, the
    // last (slowest) ones are used, so it always lands gently.
    gaps: [0.6, 0.7, 0.85],
    word: 0.4, // a word sliding into place
    buttons: 0.5, // the buttons fading in, once the word has landed
  };
  // Orders a game might be played in, X (even squares) and O (odd) taking
  // turns; square 0 is top left, 4 the centre. One is picked each time, so it
  // doesn't always go the same way.
  const GAMES = [
    [4, 1, 0, 5, 8, 3, 2, 7, 6],
    [0, 3, 4, 1, 8, 7, 2, 5, 6],
    [4, 7, 2, 3, 6, 1, 8, 5, 0],
    [2, 5, 4, 1, 6, 3, 0, 7, 8],
  ];
  // The two colours: X on the corners and centre, O on the edges.
  const XO = i => (i % 2 === 0 ? 'orange' : 'green');
  const WORDS = 4; // at most this many meal words, the last being now's
  const EXIT = 0.35;

  let root, el = {}, raf = 0, done = null, meals = [], words = [], starts = [], land = 0, END = 1, now = 0, turn = [], who = 'Mom';

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const progress = (t, [a, b]) => clamp((t - a) / (b - a));
  const easeOut = p => 1 - Math.pow(1 - p, 3);
  const easeIn = p => p * p * p;
  const easeInOut = p => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /** The meal it lands on. */
  const landed = () => meals[meals.length - 1];

  /** One dish: the same tinted square as on Today; a plain one where the meal has fewer than nine. */
  function card(i) {
    const r = landed().tiles[i];
    // A meal with fewer than nine dishes still fills the board, with plain squares.
    if (!r) return `<div class="card square empty tint-${XO(i)}"></div>`;
    // r.icon is an <svg> made by app.js (iconSvg); pathLength lets each line be drawn from 0 to 1.
    const icon = r.icon.replace(/<path /g, '<path pathLength="1" ');
    return `<div class="card square tint-${XO(i)}" data-i="${i}">${icon}<span class="name">${esc(r.name)}</span></div>`;
  }

  function build() {
    const cards = landed().tiles.length ? 9 : 0;
    root = document.createElement('div');
    root.className = 'welcome-overlay';
    root.innerHTML = `
      ${cards ? `<div class="welcome-grid" aria-hidden="true">
        ${Array.from({ length: cards }, (_, i) => card(i)).join('')}
      </div>` : ''}
      <h1 class="welcome-title"><span class="hi">Yo</span> <span class="mom">${esc(who)}</span></h1>
      <p class="welcome-lead">Let’s cook…<span class="sr-only"> ${esc(landed().meal)}</span></p>
      <div class="welcome-meal" aria-hidden="true">
        ${words.map(w => `<span class="word">${esc(w)}</span>`).join('')}
      </div>
      <div class="welcome-actions">
        <button class="primary" type="button" data-go="quick">Quick &amp; easy</button>
        <button type="button" data-go="gourmet">Gourmet</button>
      </div>
    `;
    el.cards = [...root.querySelectorAll('.welcome-grid .card')];
    el.lines = el.cards.map(c => [...c.querySelectorAll('path')]);
    el.names = el.cards.map(c => c.querySelector('.name'));
    el.title = root.querySelector('.welcome-title');
    el.lead = root.querySelector('.welcome-lead');
    el.words = [...root.querySelectorAll('.welcome-meal .word')];
    el.actions = root.querySelector('.welcome-actions');
  }

  /** When each word comes in, when it lands, and when it has all settled. */
  function timeline() {
    const gaps = T.gaps.slice(Math.max(0, T.gaps.length - (words.length - 1)));
    starts = [T.first];
    gaps.forEach(g => starts.push(starts[starts.length - 1] + g));
    land = starts[starts.length - 1] + T.word;
    const played = el.cards.length ? T.moves + (el.cards.length - 1) * T.moveGap + T.drawTime : 0;
    END = Math.max(played, land + T.buttons);
  }

  // ---- the renderer: everything on screen is a function of t ----

  function seek(t) {
    t = clamp(t, 0, END);
    now = t;

    el.cards.forEach((card, i) => {
      // Its turn: the square settles into place, a fade and a slight grow.
      const at = T.moves + turn[i] * T.moveGap;
      const a = easeOut(clamp((t - at) / T.place));
      card.style.opacity = a.toFixed(3);
      card.style.transform = `scale(${(0.9 + 0.1 * a).toFixed(3)})`;
      // Then each line of its icon draws from nothing to whole.
      const d = easeInOut(clamp((t - at - 0.1) / T.drawTime));
      el.lines[i].forEach(p => {
        p.style.strokeDashoffset = (1 - d).toFixed(3);
        // A line of length 0 still shows its round end as a dot; hide it until it starts.
        p.style.visibility = d > 0 ? 'visible' : 'hidden';
      });
      const name = el.names[i];
      if (name) name.style.opacity = easeOut(clamp((d - 0.5) * 2)).toFixed(3);
    });

    const tp = progress(t, T.title);
    el.title.style.opacity = easeOut(tp).toFixed(3);
    el.title.style.transform = `translateY(${(10 * (1 - easeOut(tp))).toFixed(2)}px)`;
    el.lead.style.opacity = easeOut(clamp(tp * 1.3 - 0.2)).toFixed(3);

    // The meal word: each one rises gently into place as the one before
    // fades away quickly, so two words never sit on top of each other.
    el.words.forEach((w, k) => {
      const enter = easeOut(clamp((t - starts[k] - T.word * 0.3) / (T.word * 0.7)));
      const leave = k + 1 < starts.length ? easeOut(clamp((t - starts[k + 1]) / (T.word * 0.4))) : 0;
      w.style.opacity = (enter * (1 - leave)).toFixed(3);
      w.style.transform = `translateY(${((1 - enter) * 30 - leave * 20).toFixed(1)}%)`;
    });

    const bp = easeOut(progress(t, [land, land + T.buttons]));
    el.actions.style.opacity = bp.toFixed(3);
    el.actions.style.transform = `translateY(${(8 * (1 - bp)).toFixed(2)}px)`;
    el.actions.style.pointerEvents = bp > 0.3 ? 'auto' : 'none';
  }

  // ---- exit: a circle opens out of the button or card she tapped ----

  function exit(from, choice) {
    cancelAnimationFrame(raf);
    el.actions.querySelectorAll('button').forEach(b => { b.disabled = true; });
    root.style.pointerEvents = 'none';
    const b = from.getBoundingClientRect();
    const x = b.left + b.width / 2, y = b.top + b.height / 2;
    const far = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Show the app underneath before the circle opens.
    if (done) done(choice);
    const t0 = performance.now();
    const frame = now => {
      const p = reduced ? 1 : clamp((now - t0) / 1000 / EXIT);
      const R = far * easeIn(p);
      const mask = `radial-gradient(circle at ${x}px ${y}px, transparent ${R}px, #000 ${R + 1}px)`;
      root.style.webkitMaskImage = mask;
      root.style.maskImage = mask;
      if (p < 1) raf = requestAnimationFrame(frame);
      else finish();
    };
    raf = requestAnimationFrame(frame);
  }

  function finish() {
    cancelAnimationFrame(raf);
    root.remove();
    document.body.classList.remove('welcome-open');
    delete window.seekWelcome;
  }

  function play() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return seek(END);
    const startedAt = performance.now();
    const tick = now => {
      const t = (now - startedAt) / 1000;
      seek(t);
      if (t < END) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  return {
    /**
     * Shows the first page over the app.
     * list: the meals to go through, the last one being where it stops, as
     *   [{ meal: 'Lunch', tiles: [{ row, name, tint, icon }, …up to 9] }],
     *   icon being an <svg>.
     * name: who it says "Yo" to: 'Mom', or a guest's first name.
     * onEnter(choice) runs as she goes in: 'quick' or 'gourmet' from the
     *   buttons, or { row } when she taps one of the dishes it landed on.
     */
    show(list, name, onEnter) {
      meals = list && list.length ? list : [{ meal: 'Lunch', tiles: [] }];
      who = String(name || 'Mom');
      words = meals.slice(-WORDS).map(m => m.meal);
      const game = GAMES[Math.floor(Math.random() * GAMES.length)];
      turn = Array.from({ length: 9 }, (_, i) => game.indexOf(i));
      done = onEnter;
      build();
      document.body.appendChild(root);
      document.body.classList.add('welcome-open');
      timeline();
      seek(0);
      el.actions.addEventListener('click', e => {
        const b = e.target.closest('button[data-go]');
        if (b) exit(b, b.dataset.go);
      });
      // Once it has landed, tapping a dish opens it. Tapping anywhere during
      // the animation skips to the end.
      root.addEventListener('click', e => {
        if (e.target.closest('button')) return;
        const card = e.target.closest('.card');
        const dish = card && landed().tiles[card.dataset.i];
        if (now >= END && dish) return exit(card, { row: dish.row });
        cancelAnimationFrame(raf);
        seek(END);
      });
      window.seekWelcome = t => { cancelAnimationFrame(raf); seek(t); };
      play();
    },
  };
})();
