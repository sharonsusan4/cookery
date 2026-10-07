'use strict';

// The "Hi Mom" welcome screen.
//
// The words are built like a structure: a gold floor draws out, two supports
// hold it up, "Hi" arrives on a thin lintel, "MOM" is lowered from that lintel
// onto the floor on two cables, the floor gives under the load and settles
// level, the cables let go, then a pause before the button.
// Tapping the button opens the counter of the O into a hole the app shows through.
//
// Every frame comes from seek(t) alone (no physics that builds up over time),
// so a given moment always looks the same. window.seekWelcome(t) shows any moment.

const Welcome = (() => {
  const W = 1080; // the stage is a 1080×1080 square, scaled to the phone
  const FLOOR_Y = 700;
  const LINTEL_Y = 352; // "Hi" sits on this; MOM hangs from it and never crosses above it
  const FLOOR_H = 14;
  const FLOOR_HALF = 450;
  const SUPPORTS = [200, 880];
  const MOM_WIDTH = 860;
  const CAPTION = 'WHAT SHALL WE COOK TODAY?';

  // Cue sheet, in seconds.
  const T = {
    floor: [0.2, 0.9],
    supports: [0.6, 1.2],
    hi: [1.0, 1.6],
    lower: 1.6, // MOM starts coming down
    contact: 2.45, // MOM meets the floor
    release: [2.9, 3.3], // cables let go
    // 3.3 to 3.7: everything holds still
    caption: [3.7, 4.4],
    button: [4.2, 4.7],
  };
  const END = 4.7;
  const EXIT = 0.65;

  let root, svg, el = {}, momSize = 300, raf = 0, startedAt = 0, done = null;

  // ---- time helpers (all pure functions of t) ----

  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const progress = (t, [a, b]) => clamp((t - a) / (b - a));
  const easeOut = p => 1 - Math.pow(1 - p, 3);
  const easeInOut = p => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const easeIn = p => p * p * p;

  /** Critically damped approach: from `from` to 0 with no overshoot. */
  function settle(t, t0, from, omega) {
    if (t <= t0) return from;
    const s = t - t0;
    const v = from * (1 + omega * s) * Math.exp(-omega * s);
    return Math.abs(v) < 0.05 ? 0 : v; // come to an exact stop rather than creeping forever
  }

  /** The floor's give under the load: a damped bounce that ends perfectly level. */
  function sag(t) {
    if (t <= T.contact || t >= T.release[0]) return 0; // level for good before the cables let go
    const s = t - T.contact;
    const zeta = 0.38, omega = 17;
    const wd = omega * Math.sqrt(1 - zeta * zeta);
    return 13 * Math.exp(-zeta * omega * s) * Math.sin(wd * s);
  }

  // ---- building the scene ----

  function build() {
    const date = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short' }).toUpperCase();
    root = document.createElement('div');
    root.className = 'welcome-overlay';
    root.innerHTML = `
      <svg class="welcome-stage" viewBox="0 0 ${W} ${W}" role="img" aria-label="Hi Mom">
        <defs>
          <clipPath id="w-hi-clip"><rect x="0" y="120" width="${W}" height="${LINTEL_Y - 122}"/></clipPath>
          <clipPath id="w-mom-clip"><rect x="0" y="${LINTEL_Y + 2}" width="${W}" height="${W}"/></clipPath>
        </defs>
        <text id="w-date" class="w-mono" x="90" y="110">${esc(date)}</text>
        <g clip-path="url(#w-hi-clip)"><text id="w-hi" class="w-serif" x="84" y="330">Hi</text></g>
        <line id="w-lintel" class="w-support"/>
        <line id="w-cable-l" class="w-cable"/>
        <line id="w-cable-r" class="w-cable"/>
        <line id="w-sup-l" class="w-support"/>
        <line id="w-sup-r" class="w-support"/>
        <g clip-path="url(#w-mom-clip)"><text id="w-mom" class="w-grot" x="${W / 2}" y="${FLOOR_Y}" text-anchor="middle">MOM</text></g>
        <path id="w-floor" class="w-floor"/>
        <text id="w-caption" class="w-mono" x="${W / 2}" y="800"></text>
      </svg>
      <div class="welcome-actions">
        <button class="welcome-enter" type="button">Let’s cook</button>
      </div>
    `;
    svg = root.querySelector('svg');
    for (const id of ['date', 'hi', 'lintel', 'cable-l', 'cable-r', 'sup-l', 'sup-r', 'mom', 'floor', 'caption']) {
      el[id] = root.querySelector('#w-' + id);
    }
    el.button = root.querySelector('.welcome-enter');
    el.actions = root.querySelector('.welcome-actions');
  }

  /** Size MOM to span the floor and place the caption, once the fonts are in. Done once, before playing. */
  function fitMom() {
    el.mom.setAttribute('font-size', 300);
    const len = el.mom.getComputedTextLength();
    momSize = len > 0 ? 300 * MOM_WIDTH / len : 300;
    el.mom.setAttribute('font-size', momSize.toFixed(1));
    // Pin the caption's left edge where the full line would start, so typing doesn't shift it.
    el.caption.textContent = CAPTION;
    el.caption.setAttribute('x', (W / 2 - el.caption.getComputedTextLength() / 2).toFixed(1));
  }

  const capHeight = () => momSize * 0.72;

  // ---- the renderer: everything on screen is a function of t ----

  function seek(t) {
    t = clamp(t, 0, END);

    // Floor: draws out from the centre, flexes under MOM, ends level.
    const half = FLOOR_HALF * easeOut(progress(t, T.floor));
    const s = sag(t);
    const x0 = W / 2 - half, x1 = W / 2 + half, c = 2 * s; // control point at 2× gives a midpoint dip of s
    el.floor.setAttribute('d', half < 0.5 ? '' :
      `M${x0},${FLOOR_Y} Q${W / 2},${FLOOR_Y + c} ${x1},${FLOOR_Y} L${x1},${FLOOR_Y + FLOOR_H} Q${W / 2},${FLOOR_Y + FLOOR_H + c} ${x0},${FLOOR_Y + FLOOR_H} Z`);

    // Supports: drop from the floor to the bottom edge.
    const supLen = (W - FLOOR_Y - FLOOR_H) * easeOut(progress(t, T.supports));
    SUPPORTS.forEach((x, i) => {
      const line = el[i ? 'sup-r' : 'sup-l'];
      line.setAttribute('x1', x); line.setAttribute('x2', x);
      line.setAttribute('y1', FLOOR_Y + FLOOR_H); line.setAttribute('y2', FLOOR_Y + FLOOR_H + supLen);
    });

    // "Hi": rises up out of its own baseline.
    const hiP = progress(t, T.hi);
    el.hi.setAttribute('transform', `translate(0 ${(190 * (1 - easeOut(hiP))).toFixed(2)})`);

    // Lintel: drawn left to right under "Hi" as it arrives.
    const lintelEnd = 84 + (W - 84 - 84) * easeOut(hiP);
    el.lintel.setAttribute('x1', 84); el.lintel.setAttribute('x2', lintelEnd.toFixed(2));
    el.lintel.setAttribute('y1', LINTEL_Y); el.lintel.setAttribute('y2', LINTEL_Y);
    el.lintel.style.visibility = hiP > 0 ? 'visible' : 'hidden';

    // MOM: lowered out of the slot under the lintel (critically damped), then rides the floor's flex.
    const start = (LINTEL_Y - capHeight()) - (FLOOR_Y - capHeight()) - 12; // fully hidden above the slot
    const drop = settle(t, T.lower, start, 7.5);
    const momY = drop + s * 0.85;
    el.mom.setAttribute('transform', `translate(0 ${momY.toFixed(2)})`);

    // Cables: hang from the lintel to MOM's shoulders, then draw back up into it.
    const top = FLOOR_Y - capHeight() + momY;
    const rel = easeInOut(progress(t, T.release));
    const cableEnd = LINTEL_Y + Math.max(0, top - LINTEL_Y) * (1 - rel);
    [W / 2 - MOM_WIDTH * 0.36, W / 2 + MOM_WIDTH * 0.36].forEach((x, i) => {
      const line = el[i ? 'cable-r' : 'cable-l'];
      line.setAttribute('x1', x); line.setAttribute('x2', x);
      line.setAttribute('y1', LINTEL_Y); line.setAttribute('y2', cableEnd.toFixed(2));
      line.style.visibility = t >= T.lower && rel < 1 ? 'visible' : 'hidden';
    });

    // Date: a quiet fade in at the start.
    el.date.style.opacity = (0.7 * easeOut(progress(t, [0, 0.6]))).toFixed(3);

    // Caption: typed out in reading order after the pause.
    el.caption.textContent = CAPTION.slice(0, Math.round(CAPTION.length * progress(t, T.caption)));

    // Button: rises into place last.
    const bp = easeOut(progress(t, T.button));
    el.actions.style.opacity = bp.toFixed(3);
    el.actions.style.transform = `translateY(${(16 * (1 - bp)).toFixed(2)}px)`;
    el.actions.style.pointerEvents = bp > 0.5 ? 'auto' : 'none';
  }

  // ---- exit: the O's counter opens into the app ----

  function counterCentre() {
    // MOM is centred, so the O sits at the middle; its counter is about halfway up the capitals.
    const pt = svg.createSVGPoint();
    pt.x = W / 2;
    pt.y = FLOOR_Y - capHeight() / 2;
    const p = pt.matrixTransform(svg.getScreenCTM());
    const r = momSize * 0.11 * svg.getScreenCTM().a;
    return { x: p.x, y: p.y, r };
  }

  function exit() {
    cancelAnimationFrame(raf);
    el.button.disabled = true;
    const { x, y, r } = counterCentre();
    const far = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now();
    const frame = now => {
      const p = reduced ? 1 : clamp((now - t0) / 1000 / EXIT);
      const R = r + (far - r) * easeIn(p);
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
    if (done) done();
  }

  // ---- playing ----

  function play() {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return seek(END);
    startedAt = performance.now();
    const tick = now => {
      const t = (now - startedAt) / 1000;
      seek(t);
      if (t < END) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  return {
    /** Shows the welcome screen over the app. `onEnter` runs once it has gone. */
    async show(onEnter) {
      done = onEnter;
      build();
      document.body.appendChild(root);
      document.body.classList.add('welcome-open');
      seek(0);
      try {
        await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]);
      } catch (e) { /* use fallback fonts */ }
      fitMom();
      seek(0);
      el.button.addEventListener('click', exit);
      // Tapping the picture skips to the end.
      svg.addEventListener('click', () => {
        if (performance.now() - startedAt < END * 1000) {
          cancelAnimationFrame(raf);
          startedAt = performance.now() - END * 1000;
          seek(END);
        }
      });
      // For checking frames: pauses playback and shows moment t.
      window.seekWelcome = t => { cancelAnimationFrame(raf); seek(t); };
      play();
    },
  };
})();
