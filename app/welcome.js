'use strict';

// The "Yo Mom" welcome screen picks today's dish.
//
// Nine of her recipes are dealt face down from a stack into a grid, flip over
// one by one, then a highlight hops between them, slowing down like a roulette
// wheel, and lands on one. It pops forward, the rest dim, and "Yo Mom" asks
// "How about … today?". "Let's cook" opens the app with that dish suggested.
// About 2.2 seconds; tapping skips to the end.
//
// Every frame comes from seek(t) alone, so a given moment always looks the
// same. window.seekWelcome(t) shows any moment.

const Welcome = (() => {
  const T = {
    deal: 0.0, dealGap: 0.04, dealTime: 0.42, // cards fly out of the stack
    flip: 0.38, flipGap: 0.045, flipTime: 0.32, // and turn over in reading order
    spin: [0.95, 1.75], // highlight hops, slowing down
    pop: [1.75, 2.0], // chosen card comes forward
    words: [1.8, 2.2],
  };
  const END = 2.2;
  const EXIT = 0.35;
  const GAP = 8;
  // The highlight goes round the grid in a ring, like a wheel.
  const RING = [0, 1, 2, 5, 8, 7, 6, 3, 4];
  // Small fixed tilts for the dealt cards, so the stack looks hand-dealt.
  const TILT = [-7, 5, -3, 8, -6, 3, -9, 6, -4];

  let root, el = {}, raf = 0, done = null, tiles = [], pick = 0, hops = [];

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const progress = (t, [a, b]) => clamp((t - a) / (b - a));
  const easeOut = p => 1 - Math.pow(1 - p, 3);
  const easeIn = p => p * p * p;
  const easeInOut = p => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const easeOutBack = p => { const c = 1.7; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function build() {
    root = document.createElement('div');
    root.className = 'welcome-overlay';
    const chosen = tiles[pick];
    root.innerHTML = `
      ${tiles.length ? `<div class="welcome-grid" aria-hidden="true">
        ${tiles.map(r => `
          <div class="card">
            <div class="face back tint-${esc(r.tint)}"></div>
            <div class="face front square tint-${esc(r.tint)}"><span class="cat">${esc(r.category)}</span><span class="name">${esc(r.name)}</span></div>
          </div>`).join('')}
      </div>` : ''}
      <h1 class="welcome-title"><span class="hi">Yo</span> <span class="mom">Mom</span></h1>
      <p class="welcome-caption">${chosen ? `How about <b>${esc(chosen.name)}</b> today?` : 'What shall we cook today?'}</p>
      <div class="welcome-actions"><button class="primary block welcome-enter" type="button">Let’s cook</button></div>
    `;
    el.cards = [...root.querySelectorAll('.welcome-grid .card')];
    el.title = root.querySelector('.welcome-title');
    el.caption = root.querySelector('.welcome-caption');
    el.actions = root.querySelector('.welcome-actions');
    el.button = root.querySelector('.welcome-enter');

    // Highlight hop times: at least one full lap, ending on the chosen card,
    // with the gaps growing so it slows down like a wheel.
    const n = tiles.length;
    const ring = RING.filter(i => i < n);
    const stops = ring.length + ring.indexOf(pick) + 1;
    hops = Array.from({ length: stops }, (_, k) => ({
      card: ring[k % ring.length],
      at: T.spin[0] + (T.spin[1] - T.spin[0]) * Math.pow(k / (stops - 1), 1.8),
    }));
  }

  /** Where each card sits relative to the middle of the grid, to deal from there. */
  function offsets() {
    const size = el.cards[0] ? el.cards[0].offsetWidth : 0;
    return el.cards.map((_, i) => {
      const col = i % 3, row = Math.floor(i / 3);
      return { x: (1 - col) * (size + GAP), y: (1 - row) * (size + GAP) + 40 };
    });
  }

  // ---- the renderer: everything on screen is a function of t ----

  function seek(t) {
    t = clamp(t, 0, END);
    const from = offsets();

    // Which card the highlight is on right now.
    let lit = -1;
    for (const h of hops) if (t >= h.at) lit = h.card;
    const landed = t >= T.spin[1];
    const pop = easeOutBack(progress(t, T.pop));

    el.cards.forEach((card, i) => {
      // Deal: from the stack in the middle, tilted, to its place.
      const d = easeOut(clamp((t - T.deal - i * T.dealGap) / T.dealTime));
      const x = from[i].x * (1 - d), y = from[i].y * (1 - d);
      const tilt = TILT[i] * (1 - d);
      // Flip: face down to face up.
      const f = easeInOut(clamp((t - T.flip - i * T.flipGap) / T.flipTime));
      const turn = 180 - 180 * f;
      // After the pick: the chosen card comes forward, the others step back.
      const chosen = i === pick && landed;
      const scale = chosen ? 1 + 0.08 * pop : 1 - 0.04 * (landed ? pop : 0);
      card.style.transform = `perspective(700px) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${tilt.toFixed(2)}deg) scale(${scale.toFixed(3)}) rotateY(${turn.toFixed(1)}deg)`;
      card.style.opacity = (d > 0 ? 1 : 0) * (landed && !chosen ? 1 - 0.55 * clamp(pop) : 1);
      card.style.zIndex = chosen ? 2 : (d < 1 ? 1 + i : 0);
      card.classList.toggle('lit', i === lit && f >= 1);
    });

    const wp = progress(t, T.words);
    el.title.style.opacity = easeOut(wp).toFixed(3);
    el.title.style.transform = `translateY(${(14 * (1 - easeOutBack(wp))).toFixed(2)}px)`;
    el.caption.style.opacity = easeOut(clamp(wp * 1.3 - 0.15)).toFixed(3);
    const bp = easeOut(clamp(wp * 1.4 - 0.3));
    el.actions.style.opacity = bp.toFixed(3);
    el.actions.style.transform = `translateY(${(10 * (1 - bp)).toFixed(2)}px)`;
    el.actions.style.pointerEvents = bp > 0.3 ? 'auto' : 'none';
  }

  // ---- exit: a circle opens out of the button ----

  function exit() {
    cancelAnimationFrame(raf);
    el.button.disabled = true;
    const b = el.button.getBoundingClientRect();
    const x = b.left + b.width / 2, y = b.top + b.height / 2;
    const far = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Show the app (with today's pick) underneath before the circle opens.
    if (done) done(tiles[pick] || null);
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
     * Shows the welcome screen over the app.
     * list: up to 9 of her recipes as { row, name, category, tint }.
     * chosen: index of today's pick. onEnter(pick) runs as she goes in.
     */
    show(list = [], chosen = 0, onEnter) {
      tiles = list.slice(0, 9);
      pick = tiles.length ? clamp(chosen, 0, tiles.length - 1) : 0;
      done = onEnter;
      build();
      document.body.appendChild(root);
      document.body.classList.add('welcome-open');
      seek(0);
      el.button.addEventListener('click', exit);
      // Tapping during the animation skips to the end.
      root.addEventListener('click', e => {
        if (e.target.closest('button')) return;
        cancelAnimationFrame(raf);
        seek(END);
      });
      window.seekWelcome = t => { cancelAnimationFrame(raf); seek(t); };
      play();
    },
  };
})();
