/* The Map tab: one made-up world map per project, with pins for places.

   users/{uid}/maps/{id}    { pid, imageId, w, h, createdAt }   (one per project)
   users/{uid}/places/{id}  { pid, order, x, y (0–1, across and down the map), name, kind,
                              notes, chapters [cid], chars [id], events [id] }
   The map photo is in images/ with the project's pid. A locked project scrambles its places
   like everything else (vault.js); the photo itself stays plain (photos aren't scrambled).

   Moving around: drag to move, pinch (iPhone) or pinch / ⌘-scroll (Mac trackpad) to zoom,
   the + / − / fit buttons, or tap a place in the list to fly to it. */

const WorldMap = (() => {
  const { $, $$, esc, icon, toast, ask, sheet, closeSheet, narrow, prepPhoto, pickFile } = UI;
  const KINDS = [['town', 'Town'], ['castle', 'Castle'], ['forest', 'Forest'], ['water', 'Water'], ['home', 'Home'], ['mountain', 'Mountain'], ['other', 'Other']];
  const kindIcon = k => 'pin-' + (KINDS.some(x => x[0] === k) ? k : 'other');

  let S = null;            // { ctx, p, map, places, chars, chapters, events }
  const views = {};        // pid -> { z, x, y } so a redraw keeps your spot
  let adding = false, hot = '';

  function page(box, state) {
    S = state;
    const { p, map, places } = S;
    box.innerHTML = `<div class="ps-head"><h1>Map</h1>
        <div class="head-btns">${map ? `<button class="btn quiet" data-wm="replace">${icon('photo')} Change map</button><button class="btn ${adding ? 'on-add' : ''}" data-wm="add">${icon('plus')} ${adding ? 'Tap the map…' : 'Add a place'}</button>` : `<button class="btn" data-wm="upload">${icon('plus')} Upload your map</button>`}</div></div>
      ${!map ? `<div class="empty"><img class="empty-candle" src="candle.webp" alt=""><p>No map yet. Make one in Gemini or Canva — or draw it — then upload it here and pin your places.</p></div>` : `
      <div class="wm">
        <div class="wm-view ${adding ? 'adding' : ''}" id="wm-view">
          <div class="wm-stage" id="wm-stage" style="width:${map.w}px;height:${map.h}px"><img class="wm-img" data-img="${map.imageId}" alt="" draggable="false">
            ${places.map(pinHtml).join('')}</div>
          <div class="wm-zoom"><button data-wm="in" title="Zoom in" aria-label="Zoom in">${icon('plus')}</button><button data-wm="out" title="Zoom out" aria-label="Zoom out"><span class="minus"></span></button><button data-wm="fit" title="Show the whole map" aria-label="Show the whole map">${icon('focus')}</button></div>
        </div>
        <aside class="wm-list"><h3>Places</h3>${places.length ? places.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(pl => `<button class="wm-row" data-wgo="${pl.id}"><span class="wm-dot">${icon(kindIcon(pl.kind))}</span><span><b>${esc(pl.name || 'Unnamed place')}</b>${pl.notes ? `<small>${esc(pl.notes.slice(0, 70))}</small>` : ''}</span></button>`).join('') : '<p class="hint">Tap <b>Add a place</b>, then tap the map.</p>'}</aside>
      </div>`}`;
    if (!map) return;
    const img = $('.wm-img', box);
    S.ctx.api.getImage(map.imageId).then(src => { if (src) img.src = src; });
    bindView();
  }
  const pinHtml = pl => `<button class="wm-pin ${hot === pl.id ? 'hot' : ''}" data-pin="${pl.id}" style="left:${pl.x * 100}%;top:${pl.y * 100}%" title="${esc(pl.name || '')}"><span class="wm-mark">${icon(kindIcon(pl.kind))}</span><span class="wm-label">${esc(pl.name || '')}</span></button>`;

  // ---------- moving around ----------
  function fitView() {
    const v = $('#wm-view');
    const r = v.getBoundingClientRect();
    const z = Math.min(r.width / S.map.w, r.height / S.map.h);
    return { z, x: (r.width - S.map.w * z) / 2, y: (r.height - S.map.h * z) / 2, min: z };
  }
  function place() {
    const st = $('#wm-stage');
    if (!st) return;
    const V = views[S.p.id];
    st.style.transform = `translate(${V.x}px, ${V.y}px) scale(${V.z})`;
    st.style.setProperty('--iz', 1 / V.z);
  }
  function clamp(V) {
    const r = $('#wm-view').getBoundingClientRect();
    const f = fitView();
    V.z = Math.max(f.min * 0.9, Math.min(f.min * 8, V.z));
    const w = S.map.w * V.z, h = S.map.h * V.z;
    // keep some of the map on screen
    V.x = Math.min(r.width * 0.6, Math.max(r.width * 0.4 - w, V.x));
    V.y = Math.min(r.height * 0.6, Math.max(r.height * 0.4 - h, V.y));
  }
  function zoomAt(f, cx, cy) {
    const V = views[S.p.id];
    const nz = V.z * f;
    const before = V.z;
    V.z = nz;
    clamp(V);
    const k = V.z / before;
    V.x = cx - (cx - V.x) * k;
    V.y = cy - (cy - V.y) * k;
    clamp(V);
    place();
  }
  function fly(pl) {
    const r = $('#wm-view').getBoundingClientRect();
    const V = views[S.p.id];
    V.z = Math.max(V.z, fitView().min * 2.2);
    V.x = r.width / 2 - pl.x * S.map.w * V.z;
    V.y = r.height / 2 - pl.y * S.map.h * V.z;
    clamp(V);
    const st = $('#wm-stage');
    st.classList.add('glide');
    place();
    setTimeout(() => st && st.classList.remove('glide'), 450);
    hot = pl.id;
    $$('.wm-pin').forEach(b => b.classList.toggle('hot', b.dataset.pin === pl.id));
  }

  function bindView() {
    const view = $('#wm-view');
    if (!views[S.p.id] || views[S.p.id].w !== S.map.w) { views[S.p.id] = { ...fitView(), w: S.map.w }; }
    place();
    const pts = new Map();
    let start = null, moved = false, pinch = null, dragPin = null;
    const local = e => { const r = view.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    view.addEventListener('wheel', e => {
      e.preventDefault();
      const p = local(e);
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.012), p.x, p.y);
      else { const V = views[S.p.id]; V.x -= e.deltaX; V.y -= e.deltaY; clamp(V); place(); }
    }, { passive: false });
    view.addEventListener('pointerdown', e => {
      if (e.target.closest('.wm-zoom')) return;
      try { view.setPointerCapture(e.pointerId); } catch (err) { /* not a real pointer */ }
      pts.set(e.pointerId, local(e));
      moved = false;
      const pin = e.target.closest('.wm-pin');
      dragPin = pin && pts.size === 1 ? { el: pin, id: pin.dataset.pin } : null;
      start = { ...local(e), V: { ...views[S.p.id] } };
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: views[S.p.id].z, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        dragPin = null;
      }
    });
    view.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      const p = local(e);
      pts.set(e.pointerId, p);
      const V = views[S.p.id];
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        zoomAt((pinch.z * d / pinch.d) / V.z, pinch.cx, pinch.cy);
        moved = true;
        return;
      }
      if (!start) return;
      const dx = p.x - start.x, dy = p.y - start.y;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      moved = true;
      if (dragPin) {
        // move a pin
        const x = Math.max(0, Math.min(1, (p.x - V.x) / (S.map.w * V.z)));
        const y = Math.max(0, Math.min(1, (p.y - V.y) / (S.map.h * V.z)));
        dragPin.el.style.left = x * 100 + '%';
        dragPin.el.style.top = y * 100 + '%';
        dragPin.at = { x, y };
        dragPin.el.classList.add('moving');
        return;
      }
      V.x = start.V.x + dx; V.y = start.V.y + dy;
      clamp(V);
      place();
    });
    const up = e => {
      if (!pts.has(e.pointerId)) return;
      const p = local(e);
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size) return;
      const V = views[S.p.id];
      if (dragPin && dragPin.at) {
        const pl = S.places.find(x => x.id === dragPin.id);
        if (pl) { pl.x = dragPin.at.x; pl.y = dragPin.at.y; save(pl); }
      } else if (!moved && dragPin) {
        const pl = S.places.find(x => x.id === dragPin.id);
        if (pl) placeSheet(pl);
      } else if (!moved && adding) {
        const x = (p.x - V.x) / (S.map.w * V.z), y = (p.y - V.y) / (S.map.h * V.z);
        if (x >= 0 && x <= 1 && y >= 0 && y <= 1) { adding = false; placeSheet(null, { x, y }); }
      }
      dragPin = null; start = null;
    };
    view.addEventListener('pointerup', up);
    view.addEventListener('pointercancel', up);
  }
  function onResize() { if (S && S.map && $('#wm-view')) { const V = views[S.p.id]; if (V) { clamp(V); place(); } } }
  window.addEventListener('resize', onResize);

  // ---------- places ----------
  function save(pl) {
    const full = { ...pl };
    delete full.id;
    S.ctx.api.saveDoc('places', pl.id, full);
  }
  function placeSheet(pl, at) {
    const isNew = !pl;
    const it = pl ? { ...pl, chapters: [...(pl.chapters || [])], chars: [...(pl.chars || [])], events: [...(pl.events || [])] }
      : { pid: S.p.id, order: Date.now(), x: at.x, y: at.y, name: '', kind: 'town', notes: '', chapters: [], chars: [], events: [] };
    const chip = (attr, id, n, on) => `<button class="chip ${on ? 'on' : ''}" ${attr}="${esc(id)}">${esc(n)}</button>`;
    const el = sheet(`<h2>${isNew ? 'New place' : 'Place'}</h2>
      <div class="field"><label for="pl-name">Name</label><input class="input" id="pl-name" value="${esc(it.name)}" placeholder="Hollow Pines, the Old Keep…" autofocus></div>
      <div class="field"><label>Kind</label><div class="wm-kinds">${KINDS.map(([k, n]) => `<button class="${it.kind === k ? 'on' : ''}" data-plk="${k}"><span class="wm-mark">${icon(kindIcon(k))}</span>${n}</button>`).join('')}</div></div>
      <div class="field"><label for="pl-notes">Notes</label><textarea class="input" id="pl-notes" rows="4" placeholder="What it’s like, who lives there, what happened here…">${esc(it.notes)}</textarea></div>
      ${S.chapters.length ? `<div class="field"><label>Chapters set here</label><div class="chips">${S.chapters.map((c, i) => chip('data-plh', c.id, c.title || `Chapter ${i + 1}`, it.chapters.includes(c.id))).join('')}</div></div>` : ''}
      ${S.chars.length ? `<div class="field"><label>Characters</label><div class="chips">${S.chars.map(c => chip('data-plc', c.id, c.name, it.chars.includes(c.id))).join('')}</div></div>` : ''}
      ${S.events.length ? `<div class="field"><label>Timeline events here</label><div class="chips">${S.events.map(ev => chip('data-ple', ev.id, ev.title || 'Untitled event', it.events.includes(ev.id))).join('')}</div></div>` : ''}
      <div class="row ${isNew ? 'end' : 'between'}">${isNew ? '' : `<button class="btn quiet danger-text" id="pl-del">${icon('trash')} Delete</button>`}
        <span><button class="btn quiet" data-act="close">Cancel</button> <button class="btn" id="pl-save">Save</button></span></div>`);
    const toggle = (arr, id) => (arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id]);
    el.addEventListener('click', async e => {
      const k = e.target.closest('[data-plk]'), h = e.target.closest('[data-plh]'), c = e.target.closest('[data-plc]'), ev = e.target.closest('[data-ple]');
      if (k) { it.kind = k.dataset.plk; $$('[data-plk]', el).forEach(b => b.classList.toggle('on', b === k)); }
      if (h) { it.chapters = toggle(it.chapters, h.dataset.plh); h.classList.toggle('on'); }
      if (c) { it.chars = toggle(it.chars, c.dataset.plc); c.classList.toggle('on'); }
      if (ev) { it.events = toggle(it.events, ev.dataset.ple); ev.classList.toggle('on'); }
      if (e.target.closest('#pl-save')) {
        it.name = $('#pl-name').value.trim() || 'Unnamed place';
        it.notes = $('#pl-notes').value.trim();
        const full = { ...it };
        delete full.id;
        if (isNew) S.ctx.api.addDoc('places', full); else S.ctx.api.saveDoc('places', it.id, full);
        closeSheet(true);
      }
      if (e.target.closest('#pl-del')) {
        if (!(await ask('Delete this place?', esc(it.name), 'Delete', { danger: true }))) return;
        S.ctx.api.deleteDoc('places', it.id);
        closeSheet(true);
      }
    });
  }

  // ---------- the map photo ----------
  async function upload(replace) {
    if (replace && !(await ask('Change the map?', 'Your places stay at the same spots on the new picture — best when it’s the same map, just updated.', 'Choose a picture'))) return;
    const f = await pickFile('image/*');
    if (!f) return;
    try {
      toast('Adding your map…', 8000);
      // big enough to zoom into, small enough for one database entry (even scrambled)
      const img = await prepPhoto(f, 2400, 700000);
      const imageId = await S.ctx.api.putImage({ ...img, pid: S.p.id });
      if (S.map) {
        const old = S.map.imageId;
        S.ctx.api.saveDoc('maps', S.map.id, { pid: S.p.id, imageId, w: img.w, h: img.h, createdAt: S.map.createdAt || Date.now() });
        if (old) S.ctx.api.deleteImage(old);
      } else S.ctx.api.addDoc('maps', { pid: S.p.id, imageId, w: img.w, h: img.h });
      delete views[S.p.id];
      toast('Map added');
    } catch (err) { UI.oops(err); }
  }

  // clicks from project.js (returns true when it handled one)
  function click(e) {
    const t = e.target;
    const a = t.closest('[data-wm]');
    if (a) {
      const w = a.dataset.wm;
      if (w === 'upload') upload(false);
      if (w === 'replace') upload(true);
      if (w === 'add') { adding = !adding; if (adding) toast('Tap the spot on the map', 2200); S.redraw(); }
      const v = $('#wm-view');
      if (v && (w === 'in' || w === 'out')) { const r = v.getBoundingClientRect(); zoomAt(w === 'in' ? 1.5 : 1 / 1.5, r.width / 2, r.height / 2); }
      if (v && w === 'fit') { views[S.p.id] = { ...fitView(), w: S.map.w }; const st = $('#wm-stage'); st.classList.add('glide'); place(); setTimeout(() => st && st.classList.remove('glide'), 450); }
      return true;
    }
    const g = t.closest('[data-wgo]');
    if (g) { const pl = S.places.find(x => x.id === g.dataset.wgo); if (pl) { fly(pl); if (narrow()) $('#wm-view').scrollIntoView({ behavior: 'smooth', block: 'center' }); } return true; }
    return false;
  }

  return { page, click, KINDS };
})();
