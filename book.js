/* Reading mode: the book view. The project laid out as real printed pages
   (the same pages as the Pages pop-up), one page on the iPhone or a two-page
   spread on the Mac, turned like Blue Book's pages. (On the iPhone a whole 6×9 page would be too
   small to read, so -- like a Kindle -- the words are laid out on phone-sized pages instead;
   the reading spot is saved by place in the text, so it matches across devices.)
   Pages turn like Blue Book's: the page lifts and curls
   over, following a finger (or the trackpad), finishing the turn or springing back.

   Turn by: the ‹ › buttons, arrow keys / space, and -- from Settings → Reading --
   tapping the edges and/or swiping. Where you stop is saved (project.readAt) so
   Read opens there next time, on any device; Done reading puts the writing page there. */

const Book = (() => {
  const { $, $$, esc, icon, toast, narrow } = UI;
  let B = null; // the open book

  // ---------- opening & closing ----------
  /* open({ project, chapters, at, settings, onSpot(start), onClose(start) }) */
  function open(o) {
    close(true);
    const el = document.createElement('div');
    el.className = 'book';
    el.innerHTML = `<div class="bk-bar">
        <button class="btn bk-done" data-bk="done">${icon('read')} Done<span class="bk-word">&nbsp;reading</span></button>
        <span class="bk-where" id="bk-where">Opening the book…</span>
        <span class="bk-nav"><button class="mini" data-bk="prev" title="Back (←)" aria-label="Back">${icon('back')}</button><button class="mini flip" data-bk="next" title="Forward (→)" aria-label="Forward">${icon('back')}</button></span>
      </div>
      <div class="bk-room" id="bk-room"><div class="bk-stage" id="bk-stage"></div></div>`;
    (document.querySelector('.proj') || document.body).appendChild(el);
    document.body.classList.add('reading');
    B = { ...o, el, pages: [], i: 0, ready: false, alive: true, busy: null, two: false, s: 1 };
    lay();
    bind();
  }
  // make the pages (again, when an iPhone turns sideways)
  function lay() {
    const me = B;
    me.layId = (me.layId || 0) + 1; // a newer layout makes an older one stop
    const id = me.layId;
    me.phone = narrow();
    let M = null;
    if (me.phone) {
      const room = $('#bk-room', me.el).getBoundingClientRect();
      me.W = Math.floor(room.width - 16);
      me.H = Math.floor(room.height - 12);
      M = { top: 34, bottom: 40, side: 22 };
    } else Object.assign(me, Pages.sizeOf(me.project));
    me.pages = [];
    me.ready = false;
    Pages.layout(me.project, me.chapters, me.W, me.H, () => me.alive && me.layId === id, (page, done) => {
      if (B !== me || me.layId !== id) return;
      if (page) me.pages.push(page);
      if (done) { me.ready = true; start(); }
    }, M);
  }
  function start() {
    // open on the page where reading stopped
    let k = 0;
    if (B.at) {
      const order = Object.fromEntries(B.chapters.map((c, n) => [c.id, n]));
      const key = s => [order[s.cid] || 0, s.block || 0, s.offset || 0];
      const cmp = (a, b) => { for (let n = 0; n < 3; n++) if (a[n] !== b[n]) return a[n] - b[n]; return 0; };
      const want = key(B.at);
      B.pages.forEach((p, n) => { if (cmp(key(p.start), want) <= 0) k = n; });
      if (k && !B.toasted) toast('Back where you stopped reading', 1800);
      B.toasted = true;
    }
    fit();
    B.i = spreadOf(k);
    draw();
  }
  function close(quiet) {
    if (!B) return;
    const b = B;
    B = null;
    b.alive = false;
    unbind();
    if (b.busy) b.busy.done();
    b.el.remove();
    document.body.classList.remove('reading');
    if (!quiet && b.onClose) b.onClose(b.ready && b.pages.length ? firstPage(b, b.i).start : null);
  }
  const isOpen = () => !!B;

  // ---------- spreads ----------
  // One page: spread i = page i. Two pages: like a printed book, page 1 sits alone on the right,
  // then 2–3, 4–5… So spread i holds pages [2i−1, 2i] (−1 = the blank left side of the first spread).
  const pagesOf = (b, i) => (b.two ? [2 * i - 1, 2 * i] : [i]);
  const firstPage = (b, i) => { const ks = pagesOf(b, i).filter(k => b.pages[k]); return b.pages[ks[0] != null ? ks[0] : 0]; };
  const spreadOf = k => (B.two ? Math.ceil(k / 2) : k);
  const lastSpread = () => (B.two ? Math.ceil((B.pages.length - 1) / 2) : B.pages.length - 1);
  function fit() {
    const room = $('#bk-room', B.el).getBoundingClientRect();
    const was = B.two ? pagesOf(B, B.i).find(k => B.pages[k]) || 0 : B.i;
    // two pages when there's room for them side by side at a readable size
    B.two = !B.phone && room.width / room.height > 1.15 && room.width >= 2 * B.W * 0.62;
    const n = B.two ? 2 : 1;
    B.s = B.phone ? 1 : Math.min((room.width - 32) / (n * B.W), (room.height - 28) / B.H, 1.6);
    const st = $('#bk-stage', B.el);
    st.style.width = n * B.W * B.s + 'px';
    st.style.height = B.H * B.s + 'px';
    st.classList.toggle('two', B.two);
    if (B.ready) B.i = Math.min(spreadOf(Math.max(0, was)), lastSpread());
  }
  // a page, sized for the screen (k out of range = a blank page)
  function slot(k, side) {
    const d = document.createElement('div');
    d.className = 'bk-page' + (side ? ' ' + side : '');
    const p = B.pages[k];
    if (p) {
      const pg = p.el.cloneNode(true);
      pg.style.transform = `scale(${B.s})`;
      d.appendChild(pg);
    } else d.classList.add('blank');
    return d;
  }
  function spreadEl(i) {
    const f = document.createElement('div');
    f.className = 'bk-spread';
    if (B.two) { const [l, r] = pagesOf(B, i); f.append(slot(l, 'left'), slot(r, 'right')); }
    else f.append(slot(i));
    return f;
  }
  function draw() {
    const st = $('#bk-stage', B.el);
    st.innerHTML = '';
    st.appendChild(spreadEl(B.i));
    const ks = pagesOf(B, B.i).filter(k => B.pages[k]);
    const p = B.pages[ks[0]];
    $('#bk-where', B.el).textContent = !B.pages.length ? 'No pages yet' : `${ks.map(k => k + 1).join('–')} of ${B.pages.length}${p && p.chapter ? ' · ' + p.chapter : ''}`;
    $('[data-bk="prev"]', B.el).disabled = B.i <= 0;
    $('[data-bk="next"]', B.el).disabled = B.i >= lastSpread();
    if (p && B.onSpot) B.onSpot(p.start);
  }

  // ---------- the page turn (from Blue Book) ----------
  // Builds the turning sheet over the book, from spread a to spread b.
  function makeFlip(dir, a, b, { warm = false } = {}) {
    const st = $('#bk-stage', B.el);
    const layer = document.createElement('div');
    layer.className = 'bk-flip' + (B.two ? ' two' : '');
    const base = document.createElement('div'), sheet = document.createElement('div');
    base.className = 'bk-base'; sheet.className = 'bk-sheet ' + dir;
    const face = (k, cls, side) => { const f = slot(k, side); f.classList.add('bk-face'); if (cls) f.classList.add(cls); return f; };
    if (B.two) {
      const [al, ar] = pagesOf(B, a), [bl, br] = pagesOf(B, b);
      // Next: the right page lifts and lands on the left. Back: the left page lifts and lands on the right.
      base.append(face(dir === 'next' ? al : bl, '', 'left'), face(dir === 'next' ? br : ar, '', 'right'));
      sheet.append(face(dir === 'next' ? ar : al, 'front'), face(dir === 'next' ? bl : br, 'back'));
    } else {
      // Next: this page lifts off its left edge and turns away. Back: the page before swings back over it.
      base.append(face(dir === 'next' ? b : a));
      sheet.append(face(dir === 'next' ? a : b, 'front'));
      const back = document.createElement('div'); back.className = 'bk-page bk-face back blank'; sheet.appendChild(back);
    }
    layer.append(base, sheet);
    st.appendChild(layer);
    const real = st.querySelector('.bk-spread');
    // iPhones and iPads draw a new layer a moment after it's made: on a swipe the real page stays
    // up for two screen refreshes while the turning sheet is drawn, then they swap.
    if (warm) {
      layer.style.opacity = '0.01';
      requestAnimationFrame(() => requestAnimationFrame(() => { if (!layer.isConnected) return; layer.style.opacity = ''; if (real) real.style.visibility = 'hidden'; }));
    } else if (real) real.style.visibility = 'hidden';
    let p = 0;
    // One page: past 90° the sheet is behind the spine, so it only needs to swing that far to be gone.
    const angle = q => (B.two ? (dir === 'next' ? -180 * q : 180 * q) : (dir === 'next' ? -95 * q : -95 * (1 - q)));
    // The front and back swap by hand at exactly 90° (Safari can show the front mirrored past halfway);
    // the hidden side stays nearly see-through rather than hidden, so iPhones keep it drawn.
    const front = sheet.querySelector('.front'), back = sheet.querySelector('.back');
    const set = q => {
      p = Math.max(0, Math.min(1, q));
      const ang = angle(p), past = Math.abs(ang) >= 90;
      sheet.style.transform = `rotateY(${ang}deg)`;
      layer.style.setProperty('--p', p.toFixed(3));
      if (front) front.style.opacity = past ? '0.01' : '';
      if (back) back.style.opacity = past ? '' : '0.01';
    };
    set(0);
    return {
      set,
      get p() { return p; },
      play(to, ms, cb) {
        const from = p, t0 = performance.now(), d = Math.max(120, ms * Math.abs(to - from));
        const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
        const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (still) { set(to); cb && cb(); return; }
        const step = now => { const t = Math.min(1, (now - t0) / d); set(from + (to - from) * ease(t)); if (t < 1) requestAnimationFrame(step); else cb && cb(); };
        requestAnimationFrame(step);
      },
      done() { layer.remove(); if (real && real.isConnected) real.style.visibility = ''; },
    };
  }
  // a whole turn (buttons, keys, taps, the trackpad)
  function turn(d) {
    if (!B || !B.ready || B.busy) return;
    const to = B.i + d;
    if (to < 0 || to > lastSpread()) return;
    const f = makeFlip(d > 0 ? 'next' : 'prev', B.i, to);
    B.busy = f;
    f.play(1, 520, () => { B.i = to; draw(); B.busy = null; requestAnimationFrame(() => f.done()); });
  }

  // ---------- gestures ----------
  let off = [];
  function bind() {
    const st = (B.settings && B.settings.reading) || {};
    const tapOn = st.tap !== false, swipeOn = st.swipe !== false; // both on unless turned off in Settings
    const room = $('#bk-room', B.el);
    const on = (el, ev, f, o) => { el.addEventListener(ev, f, o); off.push(() => el.removeEventListener(ev, f, o)); };
    on(B.el, 'click', e => {
      const b = e.target.closest('[data-bk]');
      if (b) { const a = b.dataset.bk; if (a === 'done') close(); if (a === 'next') turn(1); if (a === 'prev') turn(-1); return; }
      if (!tapOn || !e.target.closest('#bk-room') || sw) return;
      const x = e.clientX / window.innerWidth;
      if (x > 2 / 3) turn(1); else if (x < 1 / 3) turn(-1);
    });
    on(document, 'keydown', e => {
      if (!B || UI.sheetOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey)) { e.preventDefault(); turn(1); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey)) { e.preventDefault(); turn(-1); }
    }, true);
    on(window, 'resize', () => {
      if (!B || B.busy) return;
      // a phone turned sideways (or the window crossed to/from phone size): lay the pages out again, same spot
      if (B.phone || narrow()) {
        clearTimeout(B.relayT);
        B.relayT = setTimeout(() => { if (!B) return; if (B.ready && B.pages.length) B.at = firstPage(B, B.i).start; lay(); }, 250);
        return;
      }
      fit(); if (B.ready) draw();
    });
    // Swipe sideways: the page follows your finger. Past a third (or a quick flick) it turns.
    let sw = null;
    if (swipeOn) {
      on(room, 'touchstart', e => {
        sw = null;
        if (!B.ready || B.busy || e.touches.length !== 1) return;
        sw = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), mode: '' };
      }, { passive: true });
      on(room, 'touchmove', e => {
        if (!sw) return;
        const t = e.touches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y;
        if (!sw.mode) {
          if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
          if (Math.abs(dx) < Math.abs(dy) * 1.2) { sw = null; return; }
          const step = dx < 0 ? 1 : -1, to = B.i + step;
          if (to < 0 || to > lastSpread()) { sw = null; return; }
          sw.to = to; sw.step = step; sw.mode = 'flip';
          sw.flip = makeFlip(step > 0 ? 'next' : 'prev', B.i, to, { warm: true });
          B.busy = sw.flip;
        }
        e.preventDefault();
        sw.dx = dx;
        const w = $('#bk-stage', B.el).offsetWidth / (B.two ? 2 : 1);
        sw.flip.set((sw.step > 0 ? -dx : dx) / (w * 0.95));
      }, { passive: false });
      const end = () => {
        if (!sw || !sw.mode) { sw = null; return; }
        const s = sw;
        const v = (s.dx || 0) / Math.max(1, Date.now() - s.t);
        const flick = Math.abs(v) > 0.45 && Math.sign(s.dx) === -s.step;
        const go = s.flip.p > 0.33 || flick;
        s.flip.play(go ? 1 : 0, 420, () => {
          if (go) { B.i = s.to; draw(); }
          B.busy = null;
          requestAnimationFrame(() => s.flip.done());
          setTimeout(() => { sw = null; }, 50); // (the tap that ends a swipe isn't a tap-to-turn)
        });
      };
      on(room, 'touchend', end);
      on(room, 'touchcancel', end);
      // Mac trackpad: a two-finger swipe sideways turns the page (and never the browser's "go back")
      let acc = 0, quiet = 0;
      on(window, 'wheel', e => {
        if (!B || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
        e.preventDefault();
        if (Date.now() < quiet) return;
        acc += e.deltaX;
        if (Math.abs(acc) > 50) { turn(acc > 0 ? 1 : -1); acc = 0; quiet = Date.now() + 700; }
      }, { passive: false });
    }
  }
  function unbind() { off.forEach(f => f()); off = []; }

  return { open, close, isOpen, turn };
})();
