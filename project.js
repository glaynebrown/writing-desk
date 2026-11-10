/* The other tabs of a project: Characters, Timeline, the vision Board and
   Ideas, plus the tab bar every project tab shares (the Write tab is editor.js;
   the Research tab is research.js).

   Routes:
     #/p/{pid}/chars          characters, grouped by role
     #/p/{pid}/chars/{id}     one character
     #/p/{pid}/timeline       Plot: the story's events in order, each ticked off once written
     #/p/{pid}/board          the vision board
     #/p/{pid}/ideas          ideas to use in this story
     #/p/{pid}/research[/id]  research topics tagged with this project
     #/p/{pid}/map            the world map and its places (worldmap.js)

   Everything goes through ctx.api, so locked projects are scrambled on the way. */

const Project = (() => {
  const { $, $$, esc, icon, toast, ask, sheet, closeSheet, sortable, narrow, prepPhoto, pickFile, plural } = UI;

  const ROLES = ['Main', 'Love interest', 'Side', 'Villain', 'Other'];
  const FIELDS = [
    ['traits', 'Physical traits', 'Hair, eyes, height, scars, how they move…'],
    ['personality', 'Personality', 'How they act, talk, what they’re like on a bad day…'],
    ['habits', 'Habits & quirks', 'Nervous habits, tics, sleep, what they do without thinking…'],
    ['goals', 'Goals', 'What they want — and what they think they want'],
    ['fears', 'Fears', ''],
    ['backstory', 'Backstory', 'Where they come from, what happened before the story'],
    ['remindsOf', 'Reminds me of', 'Characters from books, shows or movies they feel like…'],
  ];

  // ---------- tabs ----------
  // (a short piece shows only Write + Board unless its Details say otherwise)
  const showsAll = p => p.kind !== 'short' || p.extras;
  const EXTRA = [['ideas', 'Ideas', 'bulb'], ['research', 'Research', 'research'], ['map', 'Map', 'map']];
  function tabs(p, cur) {
    const list = [['write', 'Write', 'quill-solid'], ...(showsAll(p) ? [['chars', 'Characters', 'people'], ['timeline', 'Plot', 'timeline']] : []), ['board', 'Board', 'photo']];
    const extra = showsAll(p) ? EXTRA : [];
    const tab = (id, name, ic, cls) => `<a class="ptab ${cls || ''} ${cur === id ? 'on' : ''}" href="#/p/${p.id}${id === 'write' ? '' : '/' + id}" title="${name}">${icon(ic)}<span>${name}</span></a>`;
    // on the iPhone, Ideas and Research sit under More
    return `<nav class="ptabs" aria-label="Project">${list.map(([id, name, ic]) => tab(id, name, ic)).join('')}${extra.map(([id, name, ic]) => tab(id, name, ic, 'more-tab')).join('')}${extra.length ? `<button class="ptab more-btn ${extra.some(x => x[0] === cur) ? 'on' : ''}" data-more="${p.id}" title="More" aria-label="More tabs">${icon('dots')}</button>` : ''}</nav>`;
  }
  document.addEventListener('click', e => {
    const m = e.target.closest('[data-more]');
    if (!m) return;
    UI.popover(m, EXTRA.map(([id, name, ic]) => `<a class="pop-item" href="#/p/${m.dataset.more}/${id}">${icon(ic)} ${name}</a>`).join(''), () => {});
  });
  function top(p, cur, stat) {
    return `<header class="ptop">
      <a class="back" href="#/shelf" title="Library" aria-label="Back to Library">${icon('back')}</a>
      <div class="ptitle"><span id="p-title">${esc(p.title || 'Untitled')}</span><span class="pstat">${esc(stat || '')}</span></div>
      ${tabs(p, cur)}
      <div class="pbtns">
        <button class="pbtn icon-only goal-btn" data-act="goal" title="Writing goal" aria-label="Writing goal">${icon('flame')}</button>
        <button class="pbtn icon-only" data-act="night" title="Night mode" aria-label="Night mode">${icon('moon')}</button>
        <button class="pbtn icon-only" data-act="pmenu" title="More" aria-label="More">${icon('dots')}</button>
      </div>
    </header>`;
  }

  // ---------- the open screen ----------
  let O = null; // { pid, tab, sub, p, ctx, unsubs, chars, events, pins, chapters }
  const key = (pid, tab, sub) => [pid, tab, sub || ''].join('/');
  const isOpen = (pid, tab, sub) => !!O && O.key === key(pid, tab, sub);

  function open(view, p, tab, sub, ctx) {
    close();
    O = { key: key(p.id, tab, sub), pid: p.id, tab, sub, p, ctx, view, unsubs: [], chars: [], events: [], pins: [], pideas: [], maps: [], places: [], chapters: [], loaded: {} };
    const api = ctx.api;
    const got = name => list => { if (!O) return; O[name] = list; O.loaded[name] = true; draw(); };
    O.unsubs.push(api.watchCol('chars', p.id, got('chars')));
    if (tab === 'timeline' || tab === 'map') O.unsubs.push(api.watchCol('events', p.id, got('events')));
    if (tab === 'map') { O.unsubs.push(api.watchCol('maps', p.id, got('maps'))); O.unsubs.push(api.watchCol('places', p.id, got('places'))); }
    if (tab === 'board' || tab === 'chars') O.unsubs.push(api.watchCol('pins', p.id, got('pins')));
    if (tab === 'ideas') O.unsubs.push(api.watchCol('pideas', p.id, got('pideas')));
    if (tab !== 'chars' || sub) O.unsubs.push(api.watchChapters(p.id, list => { if (!O) return; O.chapters = list; O.loaded.chapters = true; draw(); }));
    view.innerHTML = `<div class="proj pscreen-wrap">${top(p, tab, '')}<main class="pscreen" id="pscreen"><p class="loading">Opening…</p></main></div>`;
    view.onclick = onClick;
    view.oninput = onInput;
    window.addEventListener('resize', onResize);
    document.addEventListener('paste', onPaste);
    window.scrollTo(0, 0);
  }
  function close() {
    if (!O) return;
    flushChar();
    O.unsubs.forEach(u => u && u());
    window.removeEventListener('resize', onResize);
    document.removeEventListener('paste', onPaste);
    if (O.view) { O.view.onclick = null; O.view.oninput = null; }
    O = null;
  }
  function update(p) {
    if (!O) return;
    O.p = p;
    const t = $('#p-title');
    if (t) t.textContent = p.title || 'Untitled';
    if (O.tab === 'research') draw(); // research topics live outside the project
  }

  const ready = () => O.loaded.chars && (O.tab !== 'timeline' || O.loaded.events) && (O.tab !== 'board' || O.loaded.pins) && (O.tab !== 'ideas' || O.loaded.pideas) && (O.tab !== 'map' || (O.loaded.maps && O.loaded.places && O.loaded.events));
  function draw(force) {
    if (!O || !ready()) return;
    const box = $('#pscreen');
    if (!box) return;
    // don't redraw a character page under someone typing on it
    if (!force && O.tab === 'chars' && O.sub && box.querySelector('.char-page') && box.contains(document.activeElement) && document.activeElement.matches('input,textarea')) { drawCharSide(); return; }
    if (O.tab === 'chars') O.sub ? charPage(box) : charsPage(box);
    else if (O.tab === 'timeline') timelinePage(box);
    else if (O.tab === 'board') boardPage(box);
    else if (O.tab === 'ideas') ideasPage(box);
    else if (O.tab === 'map') WorldMap.page(box, { ctx: O.ctx, p: O.p, map: O.maps[0] || null, places: O.places, chars: O.chars, chapters: O.chapters, events: O.events, redraw: () => draw(true) });
    else if (O.tab === 'research') { if (!Research.busy()) Research.inProject(box, O.p, O.sub, O.ctx); }
    const stat = $('.pstat');
    if (stat) stat.textContent = O.tab === 'chars' ? plural(O.chars.length, 'character') : O.tab === 'timeline' ? `${O.events.filter(e => e.done).length} of ${plural(O.events.length, 'event')} written` : O.tab === 'board' ? plural(O.pins.length, 'photo') : O.tab === 'ideas' ? plural(O.pideas.filter(i => !i.used).length, 'idea') : O.tab === 'map' ? plural(O.places.length, 'place') : '';
  }

  const charById = id => O.chars.find(c => c.id === id);
  const chapterName = c => c.title || `Chapter ${O.chapters.indexOf(c) + 1}`;
  const initials = n => (String(n || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2) || '?').toUpperCase();
  const nextOrder = (list, first) => list.length ? (first ? Math.min(...list.map(x => x.order || 0)) - 1 : Math.max(...list.map(x => x.order || 0)) + 1) : 1;
  // fill <img data-img> from the (maybe locked) photo store
  function fillImgs(root) {
    $$('img[data-img]', root).forEach(img => {
      if (img.dataset.done === img.dataset.img) return;
      img.dataset.done = img.dataset.img;
      O.ctx.api.getImage(img.dataset.img).then(src => { if (src) { img.src = src; img.classList.add('loaded'); } });
    });
  }
  const photo = (c, cls) => `<span class="cphoto ${cls || ''}">${c.photoId ? `<img data-img="${c.photoId}" alt="">` : `<span>${esc(initials(c.name))}</span>`}</span>`;
  const empty = (msg, btn) => `<div class="empty"><img class="empty-candle" src="candle.webp" alt=""><p>${msg}</p>${btn || ''}</div>`;

  // ---------- ties: a web of who's connected to whom (Characters page) ----------
  // A character's rels [{to, label}]: "<to> is my <label>". One line per pair; the same word both
  // ways (in love, best friends) shows once in the middle, a different word each way (older brother /
  // little sister) shows each word near the person it describes.
  function tiesOf() {
    const out = [], seen = new Set();
    for (const a of O.chars) for (const r of a.rels || []) {
      const b = charById(r.to);
      if (!b || b.id === a.id) continue;
      const key = [a.id, b.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const back = (b.rels || []).find(x => x.to === a.id);
      out.push({ a: a.id, b: b.id, bIs: (r.label || '').trim(), aIs: ((back && back.label) || '').trim() });
    }
    return out;
  }
  // what kind of tie the words describe (line color/style + the legend)
  const TIE_KINDS = [
    ['love', 'Romance', /\b(love|lovers?|crush|dating|married|husband|wife|boyfriend|girlfriend|partners?|engaged|fianc|ex)\b/i],
    ['family', 'Family', /(sister|brother|sibling|mom|mother|dad|father|parent|son|daughter|cousin|aunt|uncle|niece|nephew|grand|twin|family|step)/i],
    ['friends', 'Friends', /(friend|bff|bestie)/i],
  ];
  const tieKind = t => { const w = `${t.aIs} ${t.bIs}`; const k = TIE_KINDS.find(([, , re]) => re.test(w)); return k ? k[0] : 'other'; };
  const unquote = w => String(w || '').trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  // Where everyone sits: the most-connected person in the middle, the people tied to them evenly around
  // a wide oval (half a step round, so nobody sits right on top and looks like the lead), people tied to
  // each other side by side; anyone not tied to the middle person on an outer ring next to who they're
  // tied to. Spaced so photos are at least `gap` apart; only as tall as it needs to be.
  function tieLayout(people, ties, W, padX, padY, gap) {
    const deg = id => ties.filter(t => t.a === id || t.b === id).length;
    const tied = (x, y) => ties.some(t => (t.a === x && t.b === y) || (t.a === y && t.b === x));
    const rank = id => O.chars.findIndex(c => c.id === id);
    const hub = people.slice().sort((x, y) => deg(y.id) - deg(x.id) || rank(x.id) - rank(y.id))[0].id;
    const ring = people.filter(c => c.id !== hub && tied(c.id, hub)).map(c => c.id);
    const outer = people.filter(c => c.id !== hub && !ring.includes(c.id)).map(c => c.id);
    // the order round the ring with the fewest long ties (every order tried for a small cast)
    const n = ring.length;
    const linked = (x, y) => tied(x, y) || outer.some(o => tied(o, x) && tied(o, y));
    const cost = ord => { let c = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (linked(ord[i], ord[j])) { const d = j - i; c += Math.min(d, n - d) - 1; } return c; };
    let best = ring.slice();
    if (n > 2 && n <= 8) {
      let bestC = cost(best);
      const perm = (pre, rest) => {
        if (!rest.length) { const c = cost(pre); if (c < bestC) { bestC = c; best = pre; } return; }
        rest.forEach((x, i) => perm([...pre, x], rest.filter((_, j) => j !== i)));
      };
      perm([ring[0]], ring.slice(1));
    } else if (n > 8) {
      // (a big cast: walk from person to tied person)
      best = [ring[0]];
      while (best.length < n) { const last = best[best.length - 1]; const nx = ring.find(x => !best.includes(x) && linked(last, x)) || ring.find(x => !best.includes(x)); best.push(nx); }
    }
    const A = {}; // angle of each person round the middle
    best.forEach((id, i) => { A[id] = n === 1 ? 0 : -Math.PI / 2 + (i + 0.5) * (2 * Math.PI / n); });
    // the outer ring: next to whoever they're tied to (or into the widest gap), then spread apart
    const placed = () => Object.keys(A);
    for (const id of outer) {
      const nb = placed().filter(x => tied(x, id));
      if (nb.length) { const sx = nb.reduce((v, x) => v + Math.cos(A[x]), 0), sy = nb.reduce((v, x) => v + Math.sin(A[x]), 0); A[id] = Math.atan2(sy, sx); }
      else { const as = placed().map(x => A[x]).sort((p, q) => p - q); let gapA = 0, at = Math.PI / 2; as.forEach((v, i) => { const nx = i + 1 < as.length ? as[i + 1] : as[0] + 2 * Math.PI; if (nx - v > gapA) { gapA = nx - v; at = v + gapA / 2; } }); A[id] = as.length ? at : Math.PI / 2; }
    }
    const minStep = outer.length > 1 ? Math.min(0.9, 2 * Math.PI / outer.length) : 0;
    const os = outer.slice().sort((p, q) => A[p] - A[q]);
    for (let it = 0; it < 6; it++) for (let i = 0; i < os.length; i++) {
      const p = os[i], q = os[(i + 1) % os.length];
      if (p === q) continue;
      let d = A[q] - A[p]; if (d < 0) d += 2 * Math.PI;
      if (d < minStep) { A[p] -= (minStep - d) / 2; A[q] += (minStep - d) / 2; }
    }
    // sizes: the inner ring far enough out that neighbours (and the middle) are `gap` apart
    const R1 = n ? Math.max(gap, n > 1 ? gap / (2 * Math.sin(Math.PI / n)) * 0.8 : gap) : 0;
    const R2 = outer.length ? (n ? R1 : 0) + gap * 1.05 : 0;
    // where everyone lands round the middle (0, 0), before fitting
    const raw = { [hub]: { x: 0, y: 0 } };
    for (const id of best) raw[id] = { x: Math.cos(A[id]) * R1, y: Math.sin(A[id]) * R1 };
    for (const id of outer) raw[id] = { x: Math.cos(A[id]) * R2, y: Math.sin(A[id]) * R2 };
    const all = Object.values(raw);
    const x0 = Math.min(...all.map(q => q.x)), x1 = Math.max(...all.map(q => q.x));
    const y0 = Math.min(...all.map(q => q.y)), y1 = Math.max(...all.map(q => q.y));
    // wider than tall (the page is wide), as far as the box allows; then centered on what's actually there
    const sx = Math.min(1.6, (W - 2 * padX) / ((x1 - x0) || 1));
    const sy = W < 600 ? 1.7 : sx < 1 ? sx : 1; // (a phone: narrow, so taller than wide instead)
    const H = Math.ceil((y1 - y0) * sy + 2 * padY);
    const ox = W / 2 - ((x0 + x1) / 2) * sx, oy = padY - y0 * sy;
    const out = { H };
    for (const id of Object.keys(raw)) out[id] = { x: ox + raw[id].x * sx, y: oy + raw[id].y * sy };
    return out;
  }
  function drawTies() {
    const box = $('#ties');
    if (!box || !O) return;
    const ties = tiesOf().map(t => ({ ...t, aIs: unquote(t.aIs), bIs: unquote(t.bIs) }));
    const ids = new Set(ties.flatMap(t => [t.a, t.b]));
    const people = O.chars.filter(c => ids.has(c.id)); // (only the ones with a tie)
    const W = box.clientWidth, small = narrow();
    const R = small ? 26 : 34;
    const pos = tieLayout(people, ties, W, R + (small ? 20 : 60), R + 34, small ? 2 * R + 64 : 2 * R + 130);
    box.style.height = pos.H + 'px';
    // straight lines; labels sit on them
    const line = (A, B) => ({ A, B, len: Math.hypot(B.x - A.x, B.y - A.y) || 1 });
    const on = (c, t) => ({ x: c.A.x + (c.B.x - c.A.x) * t, y: c.A.y + (c.B.y - c.A.y) * t });
    // (a word near one end, clear of the photo -- and further out when the line leaves downward, past the name)
    const nearT = (c, fromA) => { const dy = (fromA ? c.B.y - c.A.y : c.A.y - c.B.y) / c.len; return Math.min(0.45, Math.max(0.28, (R + 26 + Math.max(0, dy) * 30) / c.len)); };
    const lab = (p, text, t) => `<span class="tie-lab" data-a="${t.a}" data-b="${t.b}" style="left:${p.x}px;top:${p.y}px">${esc(text)}</span>`;
    let paths = '', labels = '';
    const kinds = new Set();
    for (const t of ties) {
      const c = line(pos[t.a], pos[t.b]), kind = tieKind(t);
      kinds.add(kind);
      paths += `<path class="k-${kind}" data-a="${t.a}" data-b="${t.b}" d="M${c.A.x} ${c.A.y} L${c.B.x} ${c.B.y}"/>`;
      const same = !t.aIs || !t.bIs || t.aIs.toLowerCase() === t.bIs.toLowerCase();
      if (same) labels += lab(on(c, 0.5), t.bIs || t.aIs, t);
      else {
        // (bIs describes b, so it sits at the B end; on a short line, one word goes just above it and one below)
        const pb = on(c, 1 - nearT(c, false)), pa = on(c, nearT(c, true));
        if (Math.hypot(pb.x - pa.x, pb.y - pa.y) < 90) {
          const nx = -(c.B.y - c.A.y) / c.len * 11, ny = (c.B.x - c.A.x) / c.len * 11;
          pb.x += nx; pb.y += ny; pa.x -= nx; pa.y -= ny;
        }
        labels += lab(pb, t.bIs, t) + lab(pa, t.aIs, t);
      }
    }
    const legend = TIE_KINDS.filter(([k]) => kinds.has(k)).map(([k, n]) => `<span><svg width="26" height="8" aria-hidden="true"><path class="k-${k}" d="M1 4 H25"/></svg>${n}</span>`).join('');
    box.innerHTML = `<svg aria-hidden="true">${paths}</svg>${labels}${people.map(c => `<button class="tie-node" data-id="${c.id}" style="left:${pos[c.id].x}px;top:${pos[c.id].y}px">${photo(c)}<span>${esc(c.name || 'Unnamed')}</span></button>`).join('')}`;
    let lg = box.nextElementSibling;
    if (!lg || !lg.classList.contains('tie-legend')) { lg = document.createElement('div'); lg.className = 'tie-legend'; box.after(lg); }
    lg.innerHTML = legend;
    fillImgs(box);
    // hover (or tap) someone: just their ties stay bright
    const focus = id => {
      box.classList.toggle('focusing', !!id);
      $$('[data-a]', box).forEach(el => el.classList.toggle('on', !!id && (el.dataset.a === id || el.dataset.b === id)));
      $$('.tie-node', box).forEach(n => n.classList.toggle('on', !!id && (n.dataset.id === id || ties.some(t => (t.a === id && t.b === n.dataset.id) || (t.b === id && t.a === n.dataset.id)))));
    };
    let held = null;
    $$('.tie-node', box).forEach(n => {
      n.onmouseenter = () => { if (!held) focus(n.dataset.id); };
      n.onmouseleave = () => { if (!held) focus(null); };
      n.onclick = () => { held = held === n.dataset.id ? null : n.dataset.id; focus(held); };
    });
  }

  // ---------- characters ----------
  function charsPage(box) {
    const groups = {};
    for (const c of O.chars) (groups[c.role || 'Other'] = groups[c.role || 'Other'] || []).push(c);
    const order = [...ROLES.filter(r => groups[r]), ...Object.keys(groups).filter(r => !ROLES.includes(r))];
    box.innerHTML = `<div class="ps-head"><h1>Characters</h1><button class="btn" data-a="add-char">${icon('plus')} Add a character</button></div>
      ${O.chars.length ? order.map(r => `<section class="role-sec"><h2 class="sec-title">${esc(r)}</h2>
        <div class="char-grid" data-role="${esc(r)}">${groups[r].map(c => `<a class="char-card" href="#/p/${O.pid}/chars/${c.id}" data-id="${c.id}">
          ${photo(c)}<b>${esc(c.name || 'Unnamed')}</b>${c.nick ? `<span class="nick">“${esc(c.nick)}”</span>` : ''}<span class="meta">${[c.age ? 'Age ' + esc(c.age) : ''].filter(Boolean).join(' · ')}</span>
        </a>`).join('')}</div></section>`).join('')
        : empty('No characters yet.')}
      ${O.chars.length > 1 ? `<section class="role-sec ties-sec"><h2 class="sec-title">Ties</h2>${tiesOf().length ? '<div class="ties" id="ties"></div>' : '<p class="muted">Add relationships on a character’s page and they’ll show here as a web.</p>'}</section>` : ''}`;
    fillImgs(box);
    drawTies();
    $$('.char-grid', box).forEach(g => sortable(g, '.char-card', {
      grid: true,
      key: el => el.dataset.id,
      onDrop: () => {
        const ids = $$('.char-card', box).map(el => el.dataset.id);
        const list = ids.map((id, i) => ({ id, order: i + 1 }));
        list.forEach(x => { const c = charById(x.id); if (c) c.order = x.order; });
        O.ctx.api.orderDocs('chars', list);
      },
    }));
  }
  async function addChar() {
    const name = await ask('New character', '', 'Add', { input: '', placeholder: 'Their name' });
    if (name == null) return;
    const id = await O.ctx.api.addDoc('chars', { pid: O.pid, order: nextOrder(O.chars), name: name.trim() || 'Unnamed', nick: '', age: '', role: 'Main', photoId: '', traits: '', personality: '', goals: '', fears: '', backstory: '', details: [], rels: [] });
    location.hash = `#/p/${O.pid}/chars/${id}`;
  }

  // one character's page
  let charT = null, charDirty = null;
  function saveChar(c) {
    charDirty = c;
    clearTimeout(charT);
    charT = setTimeout(flushChar, 600);
  }
  function flushChar() {
    clearTimeout(charT);
    if (!charDirty || !O) return;
    const c = charDirty;
    charDirty = null;
    const full = { ...c };
    delete full.id;
    O.ctx.api.saveDoc('chars', c.id, full);
  }
  const auto = t => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; };
  function charPage(box) {
    const c = charById(O.sub);
    if (!c) { box.innerHTML = empty('That character isn’t here anymore.', `<a class="btn" href="#/p/${O.pid}/chars">All characters</a>`); return; }
    const roles = [...new Set([...ROLES, ...O.chars.map(x => x.role).filter(Boolean)])];
    box.innerHTML = `<a class="sub-back" href="#/p/${O.pid}/chars">${icon('back')} All characters</a>
      <div class="char-page" data-id="${c.id}">
        <div class="cp-side">
          ${photo(c, 'big')}
          <div class="row"><button class="btn quiet small" data-a="char-photo">${icon('photo')} ${c.photoId ? 'Change photo' : 'Add a photo'}</button>
          <button class="btn quiet small" data-a="char-paste" title="Paste a copied photo (or press ⌘V)">${icon('copy')} Paste</button>
          ${c.photoId ? `<button class="btn quiet small danger-text" data-a="char-photo-rm">Remove</button>` : ''}</div>
          <div id="cp-pins"></div>
        </div>
        <div class="cp-main">
          <input class="cp-name" data-f="name" value="${esc(c.name || '')}" placeholder="Name">
          <div class="cp-row">
            <label class="mini-field"><span>Nicknames</span><input class="input" data-f="nick" value="${esc(c.nick || '')}"></label>
            <label class="mini-field small"><span>Age</span><input class="input" data-f="age" value="${esc(c.age || '')}"></label>
            <label class="mini-field"><span>Role</span><input class="input" data-f="role" list="roles" value="${esc(c.role || '')}"><datalist id="roles">${roles.map(r => `<option value="${esc(r)}">`).join('')}</datalist></label>
          </div>
          ${FIELDS.map(([f, label, ph]) => `<label class="cp-field"><span>${label}</span><textarea class="input" data-f="${f}" rows="2" placeholder="${esc(ph)}">${esc(c[f] || '')}</textarea></label>`).join('')}
          <div class="cp-block"><div class="cp-block-head"><span>More details</span></div>
            <div id="cp-details">${(c.details || []).map((d, i) => `<div class="cp-detail" data-i="${i}"><input class="input" data-d="label" value="${esc(d.label)}" placeholder="Detail (e.g. Hometown)"><input class="input" data-d="value" value="${esc(d.value)}" placeholder=""><button class="mini" data-a="detail-rm" title="Remove">${icon('x')}</button></div>`).join('')}</div>
            <button class="btn quiet small" data-a="detail-add">${icon('plus')} Add a detail</button></div>
          <div class="cp-block"><div class="cp-block-head"><span>Relationships</span></div>
            <div id="cp-rels">${relsHtml(c)}</div>
            <button class="btn quiet small" data-a="rel-add">${icon('plus')} Add a relationship</button></div>
          <div class="row"><button class="btn quiet small danger-text" data-a="char-del">${icon('trash')} Delete character</button></div>
        </div>
      </div>`;
    $$('textarea', box).forEach(auto);
    fillImgs(box);
    // a photo dropped anywhere on their page becomes their photo (bound to this page's own element,
    // so it goes away with it)
    const cp = box.querySelector('.char-page');
    const isFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    cp.ondragover = e => { if (isFiles(e)) { e.preventDefault(); cp.classList.add('photo-over'); } };
    cp.ondragleave = e => { if (!cp.contains(e.relatedTarget)) cp.classList.remove('photo-over'); };
    cp.ondrop = e => {
      cp.classList.remove('photo-over');
      const f = isFiles(e) && Array.from(e.dataTransfer.files).find(UI.isPhoto);
      if (f) { e.preventDefault(); e.stopPropagation(); charPhoto(c, f); } // (not also onto the board, if it was open before)
    };
    drawCharSide();
  }
  function relsHtml(c) {
    const rels = (c.rels || []).filter(r => charById(r.to));
    if (!rels.length) return '<p class="hint">None yet.</p>';
    return rels.map((r, i) => { const o = charById(r.to); return `<div class="cp-rel">${photo(o, 'tiny')}<a href="#/p/${O.pid}/chars/${o.id}">${esc(o.name)}</a><span class="rel-label">${esc(r.label || '')}</span><button class="mini" data-a="rel-rm" data-i="${i}" title="Remove">${icon('x')}</button></div>`; }).join('');
  }
  // the board photos tagged with this character
  function drawCharSide() {
    const box = $('#cp-pins');
    if (!box || !O) return;
    const pins = O.pins.filter(p => (p.chars || []).includes(O.sub));
    box.innerHTML = pins.length ? `<div class="cp-pins-head">On the board</div><div class="cp-pins">${pins.slice(0, 9).map(p => `<a href="#/p/${O.pid}/board" class="cp-pin"><img data-img="${p.imageId}" alt=""></a>`).join('')}</div>` : '';
    fillImgs(box);
  }
  // a character's photo: picked (Add a photo), pasted (Paste or ⌘V on their page) or dropped on it
  async function charPhoto(c, file) {
    const f = file || await pickFile('image/*');
    if (!f) return;
    try {
      const img = await prepPhoto(f, 900, 400000);
      const old = c.photoId;
      c.photoId = await O.ctx.api.putImage({ ...img, pid: O.pid });
      saveChar(c);
      flushChar();
      if (old && !O.pins.some(p => p.imageId === old)) O.ctx.api.deleteImage(old);
      draw(true);
    } catch (e) { UI.oops(e); }
  }
  function relSheet(c) {
    const others = O.chars.filter(x => x.id !== c.id);
    if (!others.length) return toast('Add another character first.');
    let pick = null;
    const el = sheet(`<h2>Add a relationship</h2>
      <div class="field"><label>Who?</label><div class="chips">${others.map(o => `<button class="chip" data-to="${o.id}">${esc(o.name)}</button>`).join('')}</div></div>
      <div id="rl-one"><div class="field"><label for="rl-both"><span id="rl-pair">Together they</span> are…</label><input class="input" id="rl-both" placeholder="in love, best friends, rivals…"></div>
        <button type="button" class="link" id="rl-split">Different for each of them? (like older brother / little sister)</button></div>
      <div id="rl-two" hidden>
        <div class="field"><label for="rl-a"><span class="rl-name">They</span> <span id="rl-are">are</span> ${esc(c.name)}’s…</label><input class="input" id="rl-a" placeholder="older brother, mentor, mom…"></div>
        <div class="field"><label for="rl-b">${esc(c.name)} is <span id="rl-who2">their</span>…</label><input class="input" id="rl-b" placeholder="little sister, student, daughter…"></div>
        <button type="button" class="link" id="rl-join">The same for both</button></div>
      <div class="row end"><button class="btn quiet" data-act="close">Cancel</button><button class="btn" id="rl-go">Add</button></div>`, { cls: 'small' });
    el.addEventListener('click', e => {
      const ch = e.target.closest('[data-to]');
      if (ch) {
        pick = ch.dataset.to;
        $$('[data-to]', el).forEach(b => b.classList.toggle('on', b === ch));
        const n = charById(pick).name;
        $$('.rl-name', el).forEach(x => { x.textContent = n; });
        $('#rl-pair').textContent = `${n} and ${c.name}`;
        $('#rl-are').textContent = 'is'; // (“They are…” until someone is picked)
        $('#rl-who2').textContent = n + '’s';
      }
      // one wording for both (the usual: in love, best friends) or a different one each way
      const two = on => {
        $('#rl-one').hidden = on; $('#rl-two').hidden = !on;
        if (on && !$('#rl-a').value) { $('#rl-a').value = $('#rl-both').value; }
        if (!on && !$('#rl-both').value) $('#rl-both').value = $('#rl-a').value;
        setTimeout(() => $(on ? '#rl-a' : '#rl-both').focus(), 30);
      };
      if (e.target.closest('#rl-split')) return two(true);
      if (e.target.closest('#rl-join')) return two(false);
      if (e.target.closest('#rl-go')) {
        if (!pick) return toast('Pick who first.');
        const split = !$('#rl-two').hidden;
        const a = (split ? $('#rl-a') : $('#rl-both')).value.trim(), b = (split && $('#rl-b').value.trim()) || a;
        // each side gets its own wording (the same one when it's the same both ways)
        const o = charById(pick);
        c.rels = [...(c.rels || []).filter(r => r.to !== pick), { to: pick, label: a }];
        o.rels = [...(o.rels || []).filter(r => r.to !== c.id), { to: c.id, label: b }];
        saveChar(o); flushChar();
        saveChar(c); flushChar();
        closeSheet(true);
        $('#cp-rels').innerHTML = relsHtml(c);
        fillImgs($('#cp-rels'));
      }
    });
  }

  // ---------- plot (was Timeline) ----------
  // The story planned ahead, event by event in story order: a title, a summary, and a tick once it's
  // written. (Older events may also hold when / chapters / chars -- kept, just not shown; map places
  // still link to events.) The writing page shows the same list beside the page (editor.js plotPanel).
  function timelinePage(box) {
    const done = O.events.filter(e => e.done).length;
    box.innerHTML = `<div class="ps-head"><h1>Plot</h1><button class="btn" data-a="add-ev">${icon('plus')} Add an event</button></div>
      ${O.events.length ? `<p class="pl-count">${done} of ${plural(O.events.length, 'event')} written</p>
      <ol class="tl pl" id="tl">${O.events.map(ev => `<li class="tl-ev ${ev.done ? 'done' : ''}" data-id="${ev.id}"><button class="pl-tick" data-done="${ev.id}" title="${ev.done ? 'Written — tap to undo' : 'Mark as written'}" aria-label="${ev.done ? 'Written' : 'Mark as written'}" aria-pressed="${ev.done ? 'true' : 'false'}">${icon('check')}</button><button class="tl-card" data-ev="${ev.id}">
        <h3>${esc(ev.title || 'Untitled event')}</h3>${ev.text ? `<p>${esc(ev.text)}</p>` : ''}
      </button></li>`).join('')}</ol><p class="hint center">Drag an event to move it in the story. Tick it once it’s written.</p>`
        : empty('Nothing planned yet. Add the events of your story in the order they happen — a title and a short summary each.')}`;
    const tl = $('#tl');
    if (tl) sortable(tl, '.tl-ev', {
      key: el => el.dataset.id,
      onDrop: ids => {
        const list2 = ids.map((id, i) => ({ id, order: i + 1 }));
        list2.forEach(x => { const ev = O.events.find(e => e.id === x.id); if (ev) ev.order = x.order; });
        O.ctx.api.orderDocs('events', list2);
      },
    });
  }
  // tick / untick "written" (the whole entry is saved: a locked project scrambles it as one)
  function toggleDone(id) {
    const ev = O.events.find(e => e.id === id);
    if (!ev) return;
    ev.done = !ev.done;
    const full = { ...ev };
    delete full.id;
    O.ctx.api.saveDoc('events', id, full);
    draw();
  }
  function evSheet(ev) {
    const isNew = !ev;
    ev = ev ? { ...ev } : { pid: O.pid, order: nextOrder(O.events), title: '', text: '', done: false };
    const el = sheet(`<h2>${isNew ? 'New event' : 'Event'}</h2>
      <div class="field"><label for="ev-title">What happens</label><input class="input" id="ev-title" value="${esc(ev.title || '')}" placeholder="Wren finds the tracks" autofocus></div>
      <div class="field"><label for="ev-text">Summary</label><textarea class="input" id="ev-text" rows="6" placeholder="What happens, who’s there, why it matters…">${esc(ev.text || '')}</textarea></div>
      <label class="check"><input type="checkbox" id="ev-done" ${ev.done ? 'checked' : ''}> Written</label>
      <div class="row ${isNew ? 'end' : 'between'}">${isNew ? '' : `<button class="btn quiet danger-text" id="ev-del">${icon('trash')} Delete</button>`}
        <span><button class="btn quiet" data-act="close">Cancel</button> <button class="btn" id="ev-save">Save</button></span></div>`);
    el.addEventListener('click', async e => {
      if (e.target.closest('#ev-save')) {
        ev.title = $('#ev-title').value.trim() || 'Untitled event';
        ev.text = $('#ev-text').value.trim();
        ev.done = $('#ev-done').checked;
        const full = { ...ev };
        delete full.id;
        if (isNew) O.ctx.api.addDoc('events', full); else O.ctx.api.saveDoc('events', ev.id, full);
        closeSheet(true);
      }
      if (e.target.closest('#ev-del')) {
        if (!(await ask('Delete this event?', esc(ev.title), 'Delete', { danger: true }))) return;
        O.ctx.api.deleteDoc('events', ev.id);
        closeSheet(true);
      }
    });
  }

  // ---------- the vision board ----------
  const COL_GAP = 14;
  function boardPage(box) {
    const p = O.p, st = O.ctx.settings();
    // (one chapter: a chapter filter would just show everything, so only characters then)
    box.innerHTML = `<div class="ps-head"><h1>Vision board</h1>
        <div class="head-btns">
          <a class="btn quiet" href="${esc(safe(p.pinterest) || safe(st.pinterest) || 'https://www.pinterest.com/')}" target="_blank" rel="noopener">${icon('pinterest')} Pinterest</a>
          <button class="btn quiet" data-a="pin-paste" title="Paste a copied photo">${icon('copy')} Paste</button>
          <button class="btn icon-btn" data-a="pin-add" title="Add photos" aria-label="Add photos">${icon('plus')}</button>
        </div></div>
      ${O.pins.length ? `<div class="board" id="board">${O.pins.map(pinHtml).join('')}</div>
        <p class="hint center">${narrow() ? 'Press and hold a photo to drag it.' : 'Drag photos to rearrange them. You can also drop photos here, or copy one (on Pinterest: right-click → Copy image) and press ⌘V.'}</p>`
        : empty('Your board is empty. Add photos, drop them here, or copy one from Pinterest and press Paste.')}
      <div class="drop-hint" id="drop-hint"><span>${icon('photo')} Drop photos to add them</span></div>`;
    fillImgs(box);
    // straight into their spots: the slide (transition) is only for rearranging, not for drawing the board
    const bd = $('#board');
    if (bd) bd.classList.add('placing');
    layoutBoard();
    if (bd) { void bd.offsetHeight; bd.classList.remove('placing'); } // (the spots are set while the slide is off)
    bindDrop(box);
    const b = $('#board');
    if (b) boardDrag(b);
  }
  const safe = u => (/^https?:\/\//i.test(u || '') ? u : '');
  function pinHtml(p) {
    const tags = [...(p.chars || []).map(charById).filter(Boolean).map(c => c.name)];
    return `<div class="pin" data-id="${p.id}" style="--ar:${p.w && p.h ? p.h / p.w : 1.3}">
      <div class="pin-img"><img data-img="${p.imageId}" alt="" draggable="false"></div>
      ${p.caption || tags.length ? `<div class="pin-cap">${p.caption ? esc(p.caption) : ''}${tags.length ? `<span class="pin-tags">${tags.map(esc).join(' · ')}</span>` : ''}</div>` : ''}
    </div>`;
  }
  // Pinterest-style columns: each photo goes in the shortest column.
  function layoutBoard() {
    const b = $('#board');
    if (!b) return;
    const W = b.clientWidth;
    const cols = W < 520 ? 2 : W < 820 ? 3 : W < 1100 ? 4 : 5;
    const cw = (W - COL_GAP * (cols - 1)) / cols;
    const hs = new Array(cols).fill(0);
    const pins = $$('.pin', b);
    pins.forEach(el => { el.style.width = cw + 'px'; });
    pins.forEach(el => {
      if (el.classList.contains('dragging')) return;
      const i = hs.indexOf(Math.min(...hs));
      el.style.transform = `translate(${i * (cw + COL_GAP)}px, ${hs[i]}px)`;
      el._pos = { x: i * (cw + COL_GAP), y: hs[i] };
      hs[i] += el.offsetHeight + COL_GAP;
    });
    b.style.height = Math.max(...hs, 0) + 'px';
  }
  function onResize() { clearTimeout(onResize.t); onResize.t = setTimeout(() => { layoutBoard(); drawTies(); }, 80); }

  // drag a photo to a new spot (mouse: just drag; finger: press and hold)
  function boardDrag(b) {
    b.addEventListener('pointerdown', e => {
      const el = e.target.closest('.pin');
      if (!el || e.button > 0) return;
      const touch = e.pointerType !== 'mouse';
      const start = { x: e.clientX, y: e.clientY };
      let on = false, timer = null, off = null;
      const begin = () => {
        on = true;
        const r = el.getBoundingClientRect();
        off = { x: start.x - r.left, y: start.y - r.top };
        el.classList.add('dragging');
        b.classList.add('sorting');
        if (navigator.vibrate) navigator.vibrate(10);
      };
      if (touch) timer = setTimeout(begin, 380);
      const move = ev => {
        if (!on) {
          const far = Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > 6;
          if (touch && far) { clearTimeout(timer); end(); return; }
          if (!touch && far) begin(); else return;
        }
        ev.preventDefault();
        const br = b.getBoundingClientRect();
        el.style.transform = `translate(${ev.clientX - br.left - off.x}px, ${ev.clientY - br.top - off.y}px)`;
        // which photo is under the pointer?
        const x = ev.clientX - br.left, y = ev.clientY - br.top;
        const over = $$('.pin', b).find(o => o !== el && o._pos && x >= o._pos.x && x <= o._pos.x + o.offsetWidth && y >= o._pos.y && y <= o._pos.y + o.offsetHeight);
        if (over) {
          const kids = $$('.pin', b);
          const before = kids.indexOf(el) > kids.indexOf(over) ? over : over.nextSibling;
          b.insertBefore(el, before);
          layoutBoard();
        }
        if (ev.clientY < 80) window.scrollBy(0, -12);
        if (ev.clientY > window.innerHeight - 60) window.scrollBy(0, 12);
      };
      const up = () => {
        clearTimeout(timer);
        if (on) {
          el.classList.remove('dragging');
          b.classList.remove('sorting');
          const stop = ev => { ev.preventDefault(); ev.stopPropagation(); };
          b.addEventListener('click', stop, { capture: true, once: true });
          setTimeout(() => b.removeEventListener('click', stop, true), 50);
          const ids = $$('.pin', b).map(x => x.dataset.id);
          const list = ids.map((id, i) => ({ id, order: i + 1 }));
          list.forEach(x => { const p = O.pins.find(pp => pp.id === x.id); if (p) p.order = x.order; });
          O.pins.sort((a, c) => a.order - c.order);
          O.ctx.api.orderDocs('pins', list);
          layoutBoard();
        }
        end();
      };
      const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
    b.addEventListener('touchmove', e => { if (b.classList.contains('sorting')) e.preventDefault(); }, { passive: false });
    b.addEventListener('contextmenu', e => { if (b.classList.contains('sorting')) e.preventDefault(); });
  }

  async function addPhotos(files) {
    files = (files || []).filter(UI.isPhoto);
    if (!files.length) return;
    const n = files.length;
    toast(n > 1 ? `Adding ${n} photos…` : 'Adding your photo…', 60000);
    let order = nextOrder(O.pins, true), done = 0, failed = 0;
    for (const f of files) {
      try {
        const img = await prepPhoto(f, 1400, 600000);
        const imageId = await O.ctx.api.putImage({ ...img, pid: O.pid });
        O.ctx.api.addDoc('pins', { pid: O.pid, order: order--, imageId, w: img.w, h: img.h, caption: '', chars: [], chapters: [] });
        done++;
      } catch (e) { console.error(e); failed++; }
      if (n > 1) toast(`Adding photos… ${done + failed} of ${n}`, 60000);
    }
    // say what really happened (not "added" when it wasn't)
    if (!failed) toast(n > 1 ? `${n} photos added` : 'Photo added');
    else if (!done) toast(n > 1 ? `None of those ${n} photos could be opened.` : 'That photo couldn’t be opened.', 6000);
    else toast(`Added ${done} of ${n} photos — ${failed} couldn’t be opened.`, 6000);
  }
  // photos on the clipboard (the Paste buttons)
  async function clipPhotos() {
    const items = await navigator.clipboard.read();
    const files = [];
    for (const it of items) {
      const type = it.types.find(t => t.startsWith('image/'));
      if (type) files.push(new File([await it.getType(type)], 'pasted', { type }));
    }
    return files;
  }
  const NO_PHOTO = 'No photo copied yet. On Pinterest, right-click (or press and hold) a photo → Copy image.';
  async function pasteButton() {
    try {
      const files = await clipPhotos();
      if (!files.length) return toast(NO_PHOTO);
      addPhotos(files);
    } catch (e) { toast('Copy a photo first, then press Paste (or ⌘V).'); }
  }
  async function pasteCharPhoto(c) {
    try {
      const files = await clipPhotos();
      if (!files.length) return toast(NO_PHOTO);
      charPhoto(c, files[0]);
    } catch (e) { toast('Copy a photo first, then press Paste (or ⌘V).'); }
  }
  function onPaste(e) {
    if (!O || UI.sheetOpen()) return;
    const files = Array.from(e.clipboardData && e.clipboardData.files || []).filter(UI.isPhoto);
    if (!files.length) return;
    if (O.tab === 'board') { e.preventDefault(); addPhotos(files); return; }
    // on a character's page (not while typing in one of their boxes): it becomes their photo
    const c = O.tab === 'chars' && O.sub && charById(O.sub);
    if (c && !(e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]'))) { e.preventDefault(); charPhoto(c, files[0]); }
  }
  function bindDrop(box) {
    const hint = $('#drop-hint');
    let n = 0;
    box.ondragenter = e => { if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) { n++; hint.classList.add('show'); } };
    box.ondragleave = () => { if (--n <= 0) { n = 0; hint.classList.remove('show'); } };
    box.ondragover = e => { if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault(); };
    box.ondrop = e => { e.preventDefault(); n = 0; hint.classList.remove('show'); addPhotos(Array.from(e.dataTransfer.files)); };
  }
  function pinSheet(p) {
    p = { ...p, chars: [...(p.chars || [])], chapters: [...(p.chapters || [])] };
    const chip = (attr, id, name, on) => `<button class="chip ${on ? 'on' : ''}" ${attr}="${id}">${esc(name)}</button>`;
    const el = sheet(`<div class="pin-view"><img data-img="${p.imageId}" alt=""></div>
      <div class="field"><label for="pn-cap">Caption</label><textarea class="input" id="pn-cap" rows="2" placeholder="Why this one?">${esc(p.caption || '')}</textarea></div>
      ${O.chars.length ? `<div class="field"><label>Characters <small>(shows on their page)</small></label><div class="chips">${O.chars.map(c => chip('data-pc', c.id, c.name, p.chars.includes(c.id))).join('')}</div></div>` : ''}
      ${O.chapters.length ? `<div class="field"><label>Chapters</label><div class="chips">${O.chapters.map(c => chip('data-ph', c.id, chapterName(c), p.chapters.includes(c.id))).join('')}</div></div>` : ''}
      <div class="row between"><span>
        <button class="btn quiet danger-text" id="pn-del">${icon('trash')} Delete</button>
        ${p.chars.length === 1 ? `<button class="btn quiet" id="pn-face">Use as ${esc(charById(p.chars[0]) ? charById(p.chars[0]).name : '')}’s photo</button>` : ''}</span>
        <span><button class="btn quiet" data-act="close">Cancel</button> <button class="btn" id="pn-save">Save</button></span></div>`, { cls: 'wide' });
    fillImgs(el);
    el.addEventListener('click', async e => {
      const a = e.target.closest('[data-pc]'), h = e.target.closest('[data-ph]');
      if (a) { const id = a.dataset.pc; p.chars = p.chars.includes(id) ? p.chars.filter(x => x !== id) : [...p.chars, id]; a.classList.toggle('on'); }
      if (h) { const id = h.dataset.ph; p.chapters = p.chapters.includes(id) ? p.chapters.filter(x => x !== id) : [...p.chapters, id]; h.classList.toggle('on'); }
      if (e.target.closest('#pn-save')) {
        p.caption = $('#pn-cap').value.trim();
        const full = { ...p };
        delete full.id;
        O.ctx.api.saveDoc('pins', p.id, full);
        closeSheet(true);
      }
      if (e.target.closest('#pn-face')) {
        const c = charById(p.chars[0]);
        if (!c) return;
        c.photoId = p.imageId;
        saveChar(c); flushChar();
        toast(`Now ${c.name}’s photo`);
      }
      if (e.target.closest('#pn-del')) {
        if (!(await ask('Delete this photo?', 'It comes off the board for good.', 'Delete', { danger: true }))) return;
        O.ctx.api.deleteDoc('pins', p.id);
        if (!O.chars.some(c => c.photoId === p.imageId)) O.ctx.api.deleteImage(p.imageId);
        closeSheet(true);
      }
    });
  }

  // ---------- ideas (for this story) ----------
  const KINDS = ['Plot', 'Scene', 'Dialogue', 'Character', 'Other'];
  let ideaFilter = '';
  const ideaOrder = list => [...list.filter(i => !i.used), ...list.filter(i => i.used)].sort((a, b) => (!!a.used - !!b.used) || (b.createdAt || 0) - (a.createdAt || 0));
  function ideasPage(box) {
    const kinds = KINDS.filter(k => O.pideas.some(i => i.kind === k));
    if (ideaFilter && !kinds.includes(ideaFilter)) ideaFilter = '';
    const list = ideaOrder(ideaFilter ? O.pideas.filter(i => i.kind === ideaFilter) : O.pideas);
    box.innerHTML = `<div class="ps-head"><div><h1>Ideas</h1><p class="muted">Ideas to use in this story.</p></div><button class="btn" data-a="add-idea">${icon('plus')} New idea</button></div>
      ${kinds.length ? `<div class="chips filter">${[['', 'All'], ...kinds.map(k => [k, k])].map(([id, n]) => `<button class="chip ${ideaFilter === id ? 'on' : ''}" data-if="${id}">${n}</button>`).join('')}</div>` : ''}
      ${O.pideas.length ? `<div class="ideas">${list.map(ideaCard).join('')}</div>`
        : empty('No ideas yet. Jot them here — or tap the lightbulb while you write.')}`;
  }
  function ideaCard(i) {
    const chs = (i.chapters || []).map(id => O.chapters.find(c => c.id === id)).filter(Boolean);
    const who = (i.chars || []).map(charById).filter(Boolean);
    return `<article class="idea pidea ${i.used ? 'used' : ''}" data-pi="${i.id}">
      <div class="pi-top">${i.kind ? `<span class="tag">${esc(i.kind)}</span>` : '<span></span>'}<button class="used-btn ${i.used ? 'on' : ''}" data-used="${i.id}" title="${i.used ? 'Not used after all' : 'I used this one'}">${icon('check')} ${i.used ? 'Used' : 'Used it'}</button></div>
      <h3>${esc(i.title || 'Untitled idea')}</h3>
      ${i.text ? `<p>${esc(i.text)}</p>` : ''}
      ${chs.length || who.length ? `<div class="tags">${chs.map(c => `<span class="tag ch">${icon('book')}${esc(chapterName(c))}</span>`).join('')}${who.map(c => `<span class="tag">${esc(c.name)}</span>`).join('')}</div>` : ''}
    </article>`;
  }
  // The idea sheet. Also used from the writing page's lightbulb (with that chapter picked).
  function ideaSheet(ctx, p, idea, opts = {}) {
    const chapters = opts.chapters || [], chars = opts.chars || [];
    const isNew = !idea;
    const it = idea ? { ...idea, chapters: [...(idea.chapters || [])], chars: [...(idea.chars || [])] } : { pid: p.id, title: '', text: '', kind: '', used: false, chapters: opts.chapter ? [opts.chapter] : [], chars: [] };
    const name = c => c.title || `Chapter ${chapters.indexOf(c) + 1}`;
    const chip = (attr, id, n, on) => `<button class="chip ${on ? 'on' : ''}" ${attr}="${esc(id)}">${esc(n)}</button>`;
    const el = sheet(`<h2>${isNew ? 'New idea' : 'Idea'}</h2>
      <div class="field"><label for="pi-title">Idea</label><input class="input" id="pi-title" value="${esc(it.title)}" placeholder="A few words to remember it by" autofocus></div>
      <div class="field"><label for="pi-text">More <small>(optional)</small></label><textarea class="input" id="pi-text" rows="5" placeholder="The scene, the line, the twist…">${esc(it.text)}</textarea></div>
      <div class="field"><label>Kind <small>(optional)</small></label><div class="chips" id="pi-kind">${KINDS.map(k => chip('data-pk', k, k, it.kind === k)).join('')}</div></div>
      ${chapters.length ? `<div class="field"><label>For which chapter? <small>(optional)</small></label><div class="chips">${chapters.map(c => chip('data-pch', c.id, name(c), it.chapters.includes(c.id))).join('')}</div></div>` : ''}
      ${chars.length ? `<div class="field"><label>Who’s in it? <small>(optional)</small></label><div class="chips">${chars.map(c => chip('data-pcc', c.id, c.name, it.chars.includes(c.id))).join('')}</div></div>` : ''}
      ${isNew ? '' : `<label class="check"><input type="checkbox" id="pi-used" ${it.used ? 'checked' : ''}> I used this one</label>`}
      <div class="row ${isNew ? 'end' : 'between'}">${isNew ? '' : `<button class="btn quiet danger-text" id="pi-del">${icon('trash')} Delete</button>`}
        <span><button class="btn quiet" data-act="close">Cancel</button> <button class="btn" id="pi-save">Save</button></span></div>`);
    const toggle = (arr, id) => (arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id]);
    el.addEventListener('click', async e => {
      const k = e.target.closest('[data-pk]'), h = e.target.closest('[data-pch]'), c = e.target.closest('[data-pcc]');
      if (k) { it.kind = it.kind === k.dataset.pk ? '' : k.dataset.pk; $$('[data-pk]', el).forEach(b => b.classList.toggle('on', b.dataset.pk === it.kind)); }
      if (h) { it.chapters = toggle(it.chapters, h.dataset.pch); h.classList.toggle('on'); }
      if (c) { it.chars = toggle(it.chars, c.dataset.pcc); c.classList.toggle('on'); }
      if (e.target.closest('#pi-save')) {
        it.title = $('#pi-title').value.trim() || 'Untitled idea';
        it.text = $('#pi-text').value.trim();
        if ($('#pi-used')) it.used = $('#pi-used').checked;
        const full = { ...it };
        delete full.id;
        if (isNew) ctx.api.addDoc('pideas', full); else ctx.api.saveDoc('pideas', it.id, full);
        closeSheet(true);
        toast(isNew ? 'Idea saved' : 'Saved');
      }
      if (e.target.closest('#pi-del')) {
        if (!(await ask('Delete this idea?', esc(it.title), 'Delete', { danger: true }))) return;
        ctx.api.deleteDoc('pideas', it.id);
        closeSheet(true);
      }
    });
  }
  // the lightbulb on the writing page
  async function quickIdea(ctx, p, chapters, cid) {
    const chars = showsAll(p) ? await ctx.api.listCol('chars', p.id).catch(() => []) : [];
    ideaSheet(ctx, p, null, { chapters, chars, chapter: cid });
  }
  function toggleUsed(id) {
    const i = O.pideas.find(x => x.id === id);
    if (!i) return;
    i.used = !i.used;
    const full = { ...i };
    delete full.id;
    O.ctx.api.saveDoc('pideas', id, full);
    draw();
  }

  // ---------- clicks & typing ----------
  async function onClick(e) {
    if (!O) return;
    const t = e.target;
    const act = t.closest('[data-act]');
    if (act && act.dataset.act === 'night') return O.ctx.toggleNight();
    if (act && act.dataset.act === 'pmenu') return O.ctx.projectMenu(O.p);
    if (O.tab === 'map' && WorldMap.click(e)) return;
    const a = t.closest('[data-a]');
    const A = a && a.dataset.a;
    if (A === 'add-char') return addChar();
    if (A === 'add-ev') return evSheet(null);
    if (A === 'pin-add') return addPhotos(await pickFile('image/*', true));
    if (A === 'pin-paste') return pasteButton();
    if (A === 'add-idea') return ideaSheet(O.ctx, O.p, null, { chapters: O.chapters, chars: O.chars });
    const used = t.closest('[data-used]');
    if (used) return toggleUsed(used.dataset.used);
    const ifl = t.closest('[data-if]');
    if (ifl) { ideaFilter = ifl.dataset.if; return draw(); }
    const pi = t.closest('[data-pi]');
    if (pi) return ideaSheet(O.ctx, O.p, O.pideas.find(x => x.id === pi.dataset.pi), { chapters: O.chapters, chars: O.chars });
    const dn = t.closest('[data-done]');
    if (dn) return toggleDone(dn.dataset.done);
    const ev = t.closest('[data-ev]');
    if (ev) return evSheet(O.events.find(x => x.id === ev.dataset.ev));
    const pin = t.closest('.pin');
    if (pin) return pinSheet(O.pins.find(x => x.id === pin.dataset.id));
    // a character's page
    const c = O.sub && charById(O.sub);
    if (!c) return;
    if (A === 'char-photo') return charPhoto(c);
    if (A === 'char-paste') return pasteCharPhoto(c);
    if (A === 'char-photo-rm') { const old = c.photoId; c.photoId = ''; saveChar(c); flushChar(); if (old && !O.pins.some(p => p.imageId === old)) O.ctx.api.deleteImage(old); return draw(true); }
    if (A === 'detail-add') { c.details = [...(c.details || []), { label: '', value: '' }]; saveChar(c); flushChar(); draw(true); setTimeout(() => { const ins = $$('#cp-details [data-d="label"]'); if (ins.length) ins[ins.length - 1].focus(); }, 30); return; }
    if (A === 'detail-rm') { const i = +a.closest('.cp-detail').dataset.i; c.details.splice(i, 1); saveChar(c); flushChar(); return draw(true); }
    if (A === 'rel-add') return relSheet(c);
    if (A === 'rel-rm') {
      const r = (c.rels || []).filter(x => charById(x.to))[+a.dataset.i];
      c.rels = (c.rels || []).filter(x => x !== r);
      const o = charById(r.to);
      if (o) { o.rels = (o.rels || []).filter(x => x.to !== c.id); saveChar(o); flushChar(); }
      saveChar(c); flushChar();
      $('#cp-rels').innerHTML = relsHtml(c);
      return;
    }
    if (A === 'char-del') {
      if (!(await ask(`Delete ${esc(c.name || 'this character')}?`, 'Their page is gone for good. Board photos stay on the board.', 'Delete', { danger: true }))) return;
      charDirty = null;
      O.ctx.api.deleteDoc('chars', c.id);
      for (const o of O.chars) if ((o.rels || []).some(r => r.to === c.id)) { o.rels = o.rels.filter(r => r.to !== c.id); saveChar(o); flushChar(); }
      location.hash = `#/p/${O.pid}/chars`;
    }
  }
  function onInput(e) {
    if (!O || !O.sub) return;
    const c = charById(O.sub);
    if (!c) return;
    const t = e.target;
    if (t.tagName === 'TEXTAREA') auto(t);
    if (t.dataset.f) { c[t.dataset.f] = t.value; saveChar(c); }
    if (t.dataset.d) {
      const i = +t.closest('.cp-detail').dataset.i;
      c.details[i] = { ...c.details[i], [t.dataset.d]: t.value };
      saveChar(c);
    }
  }

  return { tabs, top, open, close, update, isOpen, showsAll, quickIdea };
})();
