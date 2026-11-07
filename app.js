/* Writing Desk screens (the app was first called Quill & Candle). Data comes from store.js (Firebase) or demo.js
   (sample mode) as one state object S; the shelf re-draws when it changes.
   The writing page itself lives in editor.js.

   Screens (hash routes):
     #/shelf        My Library: every project as a cover, most recent first
     #/ideas        story ideas -- stories to write someday
     #/settings     night mode, text size, writing goal, account
     #/p/{pid}      one project: the writing page
     #/p/{pid}/chars | /chars/{id} | /timeline | /board | /ideas | /research[/id] | /map   its other tabs (project.js) */

(() => {
  const API = Store.configured ? Store : Demo;
  const SAMPLE = !!API.sample;
  const { $, $$, esc, icon, ls, num, plural, ago, toast, oops, ask, sheet, closeSheet, popover, prepPhoto, pickFile } = UI;
  const view = $('#view');
  // Only this Google account can open the desk (firestore.rules says the same).
  const OWNER = ['gabriella.layne.brown@gmail.com'];

  let user = null;
  let S = null;
  let route = '';
  let lookPreview = null; // a look being tried on in the Look sheet

  // ---------- night mode ----------
  const settings = () => (S && S.settings) || {};
  function nightNow() {
    const n = settings().night || {};
    if (n.mode === 'sunset') return Themes.isDark(settings().spot);
    return !!n.on;
  }
  // false | true (warm sepia) | 'walnut' (Settings → Night mode → style)
  const nightLook = () => (nightNow() ? ((settings().night || {}).style === 'walnut' ? 'walnut' : true) : false);
  let painted = ''; // the look last applied (see paint)
  function paint() {
    const night = nightLook();
    const p = currentProject();
    const look = lookPreview || (p ? p.look : Themes.APP);
    // a background photo / effect behind every tab of a project (backdrop.js)
    const inProject = !!p && !(isLockedPid(p.id) && !Vault.isOpen());
    // only when something in the look changed: re-applying it for nothing (every word-count save)
    // made the Mac redraw the background photo, which flashed white now and then
    const sig = JSON.stringify([look, night, inProject, UI.narrow(), settings().textSize || 'm']);
    if (sig !== painted) {
      painted = sig;
      Themes.apply(look, night);
      Backdrop.apply(look, night, { on: inProject, getImage: id => LAPI.getImage(id) });
      document.documentElement.style.setProperty('--fs-user', { s: 0.92, m: 1, l: 1.1, xl: 1.2 }[settings().textSize || 'm']);
      ls.set('qc-paint', JSON.stringify({ look, night }));
    }
    $$('[data-act="night"]').forEach(b => {
      b.classList.toggle('on', !!night);
      b.hidden = (settings().night || {}).mode === 'sunset';
      b.innerHTML = icon(night ? 'sun' : 'moon');
      b.title = night ? 'Day mode' : 'Night mode';
    });
  }
  function toggleNight() {
    const n = { mode: 'toggle', ...(settings().night || {}) };
    n.on = !nightNow();
    S.settings.night = n;
    API.saveSettings({ night: n });
    paint();
  }
  setInterval(() => { if (S && (settings().night || {}).mode === 'sunset') paint(); }, 60000);

  // ---------- routing ----------
  const currentProject = () => { const m = route.match(/^#\/p\/([^/]+)/); return m && S ? S.projects.find(p => p.id === m[1]) : null; };
  const go = h => { if (location.hash === h) render(); else location.hash = h; };
  window.addEventListener('hashchange', () => { UI.closeSheet(true); UI.closePopover(); render(); Goals.refresh(); });

  // Locked projects are scrambled/unscrambled on the way to and from the database.
  // (lockNow covers the moment between locking a project and the database telling us)
  const lockNow = {};
  const isLockedPid = pid => (pid in lockNow ? lockNow[pid] : !!(S && (S.projects.find(p => p.id === pid) || {}).locked));
  const LAPI = Vault.wrap(API, isLockedPid);
  const ctx = {
    api: LAPI,
    settings,
    go,
    toggleNight,
    projectMenu: p => projectMenu(p),
    tabs: (p, cur) => Project.tabs(p, cur),
    topics: () => (S && S.topics) || [],
    projects: () => (S && S.projects) || [],
    wroteToday,
  };

  // ---------- the writing goal ----------
  // A writing day = any writing or editing on a story's pages. Only the dates are kept
  // (settings.writeDays {"2026-11-04": 1}) -- no word counts, nothing about which story.
  // settings.goal = { kind: 'row' (days in a row) | 'week' (days per week), n }
  function wroteToday() {
    const d = UI.dayKey();
    const days = settings().writeDays || {};
    if (days[d] || !S) return;
    S.settings.writeDays = { ...days, [d]: 1 };
    API.saveSettings({ writeDays: { [d]: 1 } });
  }
  // the goal panel (goals.js)
  Goals.init({ settings, save: patch => { if (!S) return; Object.assign(S.settings, patch); API.saveSettings(patch); } });

  // ---------- lock in (lockin.js) ----------
  Lockin.init({
    settings,
    signedIn: () => !!(S && S.loaded),
    save: patch => { if (!S) return; Object.assign(S.settings, patch); API.saveSettings(patch); },
    pid: () => { const p = currentProject(); return p ? p.id : ''; },
    go,
    focus: on => Editor.lockFocus(on),
  });

  // ---------- start ----------
  Store.onError = e => { if (e && /permission/i.test(e.code || e.message || '')) toast('This account can’t open the desk.'); };
  API.onUser(u => {
    user = u;
    if (!u) { S = null; API.stop(); Editor.close(); welcome(); return; }
    if (!SAMPLE && !OWNER.includes((u.email || '').toLowerCase())) { notYours(u); return; }
    API.start(state => {
      const first = !S || !S.loaded;
      S = state;
      Vault.setInfo(S.settings.lock);
      Vault.setIdle(S.settings.lockIdle || 0);
      if (first && !S.loaded) return;
      paint();
      render(true);
      Lockin.sync();
      Goals.refresh();
    });
  });

  function welcome() {
    Themes.apply(Themes.APP, false);
    painted = '';
    $('#top').hidden = true;
    view.innerHTML = `<div class="welcome">
      <img class="welcome-mark" src="candle.webp" alt="">
      <h1>Writing Desk</h1>
      <p>A private place to write.</p>
      <button class="btn big" id="signin">${icon('google')} Sign in with Google</button>
      <p class="fine">Only you can open it.</p>
    </div>`;
    $('#signin').onclick = () => API.signIn().catch(e => { if (!/popup-closed|cancelled-popup/.test(e.code || '')) oops(e); });
  }
  function notYours(u) {
    $('#top').hidden = true;
    view.innerHTML = `<div class="welcome">
      <img class="welcome-mark" src="candle.webp" alt="">
      <h1>This desk is private</h1>
      <p>${esc(u.email)} can’t open it.</p>
      <button class="btn" id="signout">Use a different account</button>
    </div>`;
    $('#signout').onclick = () => API.signOut();
  }

  // Leaving a locked project (to the library, Story Ideas or another project) locks again right away,
  // unless she turned that off in Settings → Lock. Moving between its own tabs doesn't.
  let inLockedPid = null;
  function render(fromData) {
    if (!S || !S.loaded) return;
    route = location.hash || '#/shelf';
    const m = route.match(/^#\/p\/([^/]+)(?:\/(chars|timeline|board|ideas|research|map)(?:\/([^/]+))?)?$/);
    if (inLockedPid && inLockedPid !== (m && m[1]) && settings().lockLeave !== false && Vault.isOpen()) Vault.lock();
    inLockedPid = m && isLockedPid(m[1]) ? m[1] : null;
    if (m) {
      const p = S.projects.find(x => x.id === m[1]);
      if (!p) { if (!fromData) go('#/shelf'); return; }
      $('#top').hidden = true;
      document.body.classList.toggle('in-project', true); // (toggle: no restyle when it's already on)
      if (isLockedPid(p.id) && !Vault.isOpen()) { Editor.close(); Project.close(); paint(); if (!fromData || !$('#unlock-pass')) unlockScreen(p); return; }
      const tab = m[2] || 'write';
      if (tab !== 'write') {
        // (a short piece without characters/timeline turned on only has Write + Board)
        if (tab !== 'board' && !Project.showsAll(p)) { go('#/p/' + p.id); return; }
        Editor.close();
        paint();
        if (Project.isOpen(p.id, tab, m[3])) Project.update(p);
        else Project.open(view, p, tab, m[3], ctx);
        Lockin.sync();
        return;
      }
      Project.close();
      if (Editor.isOpen(p.id)) { Editor.update(p); paint(); Lockin.sync(); return; }
      paint();
      Editor.open(view, p, ctx);
      window.scrollTo(0, 0);
      Lockin.sync();
      return;
    }
    Editor.close();
    Project.close();
    document.body.classList.remove('in-project', 'focus-mode');
    $('#top').hidden = false;
    paint();
    // don't redraw under someone typing in a form on these screens
    if (fromData && (UI.sheetOpen() || Research.busy())) { tabs(); return; }
    const y = window.scrollY;
    if (route.startsWith('#/ideas')) ideasScreen();
    else if (route.startsWith('#/settings')) settingsScreen();
    else shelfScreen();
    tabs();
    if (fromData) window.scrollTo(0, y);
  }
  function tabs() {
    const r = route.startsWith('#/ideas') ? 'ideas' : route.startsWith('#/settings') ? 'settings' : 'shelf';
    $$('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === r));
    $('#offline').hidden = navigator.onLine;
  }
  window.addEventListener('online', tabs);
  window.addEventListener('offline', tabs);

  // ---------- covers ----------
  // Fills <img data-img="id"> once the photo is loaded.
  function fillImages(root) {
    $$('img[data-img]', root).forEach(img => {
      API.getImage(img.dataset.img).then(src => { if (src) { img.src = src; img.closest('.has-img') && img.closest('.has-img').classList.add('loaded'); } });
    });
  }
  // most recently written in or opened first
  const recent = p => Math.max(p.updatedAt || 0, p.openedAt || 0);
  const sorted = () => S.projects.slice().sort((a, b) => recent(b) - recent(a));

  // ---------- my library ----------
  // Covers take the project's page shape (6×9 → 2:3)
  const pageOf = p => p.pageSize && p.pageSize.w ? p.pageSize : { w: 6, h: 9 };
  const coverPx = s => `1600 × ${Math.round(1600 * s.h / s.w)}`;
  const candle = cls => `<img class="${cls}" src="candle.webp" alt="" draggable="false">`;
  function shelfScreen() {
    const all = sorted();
    const cover = p => {
      const c = Themes.colors(p.look);
      const tf = Themes.titleOf((p.look || {}).title);
      return `<a class="cover-card" href="#/p/${p.id}">
        <div class="cover ${p.coverId ? 'has-img' : ''}" style="--ar:${pageOf(p).w} / ${pageOf(p).h};--sp:${c.spine};--cp:${c.paper};--ci:${c.ink};--tf:${tf.css};--tsz:${tf.size}">
          ${p.coverId ? `<img data-img="${p.coverId}" alt="">` : ''}
          ${p.locked ? `<span class="lock-badge" title="Locked">${icon('lock')}</span>` : ''}
          <div class="cover-made"><span class="cm-title">${esc(p.title || 'Untitled')}</span></div>
        </div>
        <div class="cover-meta"><b>${esc(p.title || 'Untitled')}</b><span>${p.kind === 'short' ? 'Short piece' : 'Book'} · ${p.locked ? `${icon('lock', 'inline')} Locked` : plural(p.words || 0, 'word')}</span><span class="when">Last written ${ago(p.updatedAt)}</span></div>
      </a>`;
    };
    view.innerHTML = `<div class="shelf-page">
      <div class="page-head">
        <div class="title-row">${candle('title-candle')}<div class="title-text">
          <div class="title-line"><h1>My Library</h1><div class="head-btns"><button class="btn" data-new="">${icon('plus')} New</button></div></div>
          <p class="muted">${all.length ? plural(all.length, 'project') + ' · ' + plural(all.reduce((a, p) => a + (p.words || 0), 0), 'word') + ' written' : 'Start your first story.'}</p></div></div>
      </div>
      ${all.length ? `<div class="covers all">${all.map(cover).join('')}</div>`
        : `<div class="empty">${candle('empty-candle')}<p>Your library is empty — for now.</p></div>`}
    </div>`;
    fillImages(view);
    view.onclick = e => {
      const n = e.target.closest('[data-new]');
      if (n) newProject({ kind: n.dataset.new || 'book' });
    };
  }

  // ---------- new project ----------
  function lookSwatches(cur) {
    return `<div class="swatches">${Themes.PRESETS.map(p => `<button class="swatch ${cur === p.id ? 'on' : ''}" data-preset="${p.id}" title="${esc(p.name)}" style="--a:${p.bg};--b:${p.paper};--c:${p.accent}"><span></span><small>${esc(p.name)}</small></button>`).join('')}</div>`;
  }
  function newProject(pre = {}) {
    let kind = pre.kind || 'book';
    let preset = 'candle';
    const el = sheet(`<h2>New project</h2>
      <div class="field"><label for="np-title">Title</label><input class="input" id="np-title" value="${esc(pre.title || '')}" placeholder="Working title is fine" autofocus></div>
      <div class="field"><label>Kind</label>
        <div class="kinds" id="np-kind">
          <button data-k="book" class="${kind === 'book' ? 'on' : ''}">${icon('book-solid')}<b>Book</b><span>Chapters, characters, a timeline, a cover</span></button>
          <button data-k="short" class="${kind === 'short' ? 'on' : ''}">${icon('quill-solid')}<b>Short piece</b><span>A fic or one-off · one or two chapters</span></button>
        </div></div>
      <div class="field"><label>Look <small>(you can change everything later)</small></label>${lookSwatches(preset)}</div>
      <div class="row between">
        <button class="btn quiet" id="np-import">${icon('word')} Bring in a Word file instead</button>
        <span><button class="btn quiet" data-act="close">Cancel</button> <button class="btn" id="np-go">Create</button></span>
      </div>`);
    el.addEventListener('click', e => {
      const k = e.target.closest('#np-kind button');
      if (k) { kind = k.dataset.k; $$('#np-kind button').forEach(b => b.classList.toggle('on', b === k)); }
      const sw = e.target.closest('[data-preset]');
      if (sw) { preset = sw.dataset.preset; $$('.swatch', el).forEach(b => b.classList.toggle('on', b === sw)); }
      if (e.target.closest('#np-import')) { closeSheet(true); IO.importWord(ctx, null); }
      if (e.target.closest('#np-go')) create();
    });
    $('#np-title').addEventListener('keydown', e => { if (e.key === 'Enter') create(); });
    function create() {
      const title = $('#np-title').value.trim() || 'Untitled';
      const look = { ...Themes.DEFAULT, preset };
      const pid = API.createProject({ title, kind, look, coverId: '', pageSize: { w: 6, h: 9 }, sceneBreak: 'fleuron' },
        [{ title: kind === 'short' ? '' : 'Chapter One', notes: pre.notes || '' }]);
      if (pre.ideaId) API.saveIdea(pre.ideaId, { pid });
      closeSheet(true);
      go('#/p/' + pid);
    }
  }

  // ---------- project menu ----------
  function projectMenu(p, start) {
    const writing = Editor.isOpen(p.id);
    // what opens from here gets a "‹ back" link to this menu (or to History & deleting)
    const backTo = where => ({ label: where === 'hist' ? 'History & deleting' : p.title || 'Untitled', go: () => projectMenu(p, where) });
    const main = () => `<h2>${esc(p.title || 'Untitled')}</h2>
      <div class="menu">
        <button data-m="details">${icon('book')}<span><b>Details &amp; cover</b><small>Title, kind, page size, cover from Canva</small></span></button>
        <button data-m="look">${icon('palette')}<span><b>Appearance</b><small>Colors, fonts, background, scene breaks</small></span></button>
        <button data-m="import">${icon('word')}<span><b>Bring in a Word file</b><small>From Google Drive: File → Download → Word</small></span></button>
        <button data-m="export">${icon('kindle')}<span><b>Export for Kindle</b><small>An EPUB ebook</small></span></button>
        ${p.locked ? `<button data-m="unlockgood">${icon('lock')}<span><b>Unlock for good</b><small>Take the lock off this project</small></span></button>`
          : `<button data-m="lock">${icon('lock')}<span><b>Lock this project</b><small>Scrambled with your passphrase — no one else can read it</small></span></button>`}
        <button data-m="hist">${icon('undo')}<span><b>History &amp; deleting</b><small>Earlier versions, deleted chapters, delete</small></span>${icon('back', 'ap-chev')}</button>
      </div>`;
    // the bring-it-back options first; the ones that can't be undone last, below a line
    const hist = () => `<button class="ap-back" data-m="main">${icon('back')} ${esc(p.title || 'Untitled')}</button><h2>History &amp; deleting</h2>
      <div class="menu">
        ${writing ? `<button data-m="history">${icon('undo')}<span><b>Earlier versions of this chapter</b><small>The last 7 days</small></span></button>` : ''}
        <button data-m="deleted">${icon('undo')}<span><b>Deleted chapters</b><small>Bring one back (7 days)</small></span></button>
        <hr class="menu-div">
        ${writing ? `<button data-m="delch">${icon('trash')}<span><b>Delete this chapter</b><small>The one your cursor is in</small></span></button>` : ''}
        <button data-m="delete" class="danger">${icon('trash')}<span><b>Delete project</b><small>Everything in it, for good</small></span></button>
      </div>`;
    const el = sheet(`<div id="pm-body">${start === 'hist' ? hist() : main()}</div>`, { cls: 'small' });
    const show = html => { const b = $('#pm-body'); b.innerHTML = html; b.classList.remove('ap-in', 'ap-out'); void b.offsetWidth; b.classList.add(html === hist() ? 'ap-in' : 'ap-out'); };
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      const m = b.dataset.m;
      if (m === 'hist') return show(hist());
      if (m === 'main') return show(main());
      closeSheet(true);
      if (m === 'details') detailsSheet(p, backTo('main'));
      if (m === 'look') lookSheet(p, backTo('main'));
      if (m === 'import') IO.importWord(ctx, p);
      if (m === 'export') {
        if (p.locked && !(await ask('Export a locked project?', 'The ebook file itself is <b>not</b> locked — anyone with the file (or your Kindle) can read it.', 'Export anyway'))) return;
        IO.exportEpub(ctx, p, Editor.isOpen(p.id) ? Editor.liveChapters() : await LAPI.chaptersOf(p.id), backTo('main'));
      }
      if (m === 'lock') lockProject(p);
      if (m === 'unlockgood') unlockForGood(p);
      if (m === 'delch') Editor.deleteCurrentChapter();
      if (m === 'history') Editor.historySheet(backTo('hist'));
      if (m === 'deleted') {
        // (deleted chapters come back into the writing page, so open it first when on another tab)
        if (Editor.isOpen(p.id)) Editor.deletedSheet(backTo('hist'));
        else { go('#/p/' + p.id); setTimeout(() => Editor.isOpen(p.id) && Editor.deletedSheet(backTo('hist')), 600); }
      }
      if (m === 'delete') {
        const typed = await ask(`Delete “${p.title}”?`, `All ${plural(p.words || 0, 'word')}, every chapter and its notes will be gone for good. Type <b>delete</b> to be sure.`, 'Delete forever', { danger: true, input: '', placeholder: 'delete' });
        if (typed == null) return;
        if (typed.trim().toLowerCase() !== 'delete') return toast('Not deleted.');
        Editor.close();
        await API.deleteProject(p);
        toast('Deleted.');
        go('#/shelf');
      }
    });
  }

  // ---------- details & cover ----------
  const SIZES = [{ w: 6, h: 9, name: '6 × 9', note: 'standard paperback' }, { w: 5.5, h: 8.5, name: '5.5 × 8.5', note: 'digest' }, { w: 5, h: 8, name: '5 × 8', note: 'small paperback' }, { w: 4.25, h: 6.87, name: '4.25 × 6.87', note: 'pocket' }];
  function detailsSheet(p, back) {
    let kind = p.kind || 'book';
    let size = pageOf(p);
    let coverId = p.coverId || '';
    let newCover = null; // { data, w, h } not saved yet
    let dropCover = false;
    const el = sheet(`<h2>Details &amp; cover</h2>
      <div class="details">
        <div class="det-cover">
          <div class="cover big ${coverId ? 'has-img' : ''}" id="dt-cover" style="--ar:${size.w} / ${size.h}">${coverId ? `<img data-img="${coverId}" alt="">` : `<div class="cover-made"><span class="cm-title">No cover yet</span></div>`}</div>
          <button class="btn quiet" id="dt-up">${icon('photo')} ${coverId ? 'Change cover' : 'Add a cover'}</button>
          <button class="btn quiet small danger-text" id="dt-rm" ${coverId ? '' : 'hidden'}>Remove cover</button>
          <p class="hint">Design it in Canva, then <b>Share → Download → PNG or JPG</b> and pick that file here. Make it the same shape as the page: <b id="dt-px">${coverPx(size)}</b> pixels.</p>
        </div>
        <div class="det-fields">
          <div class="field"><label for="dt-title">Title</label><input class="input" id="dt-title" value="${esc(p.title || '')}"></div>
          <div class="field"><label>Kind</label><div class="seg" id="dt-kind"><button data-k="book" class="${kind === 'book' ? 'on' : ''}">Book</button><button data-k="short" class="${kind === 'short' ? 'on' : ''}">Short piece</button></div>
            <p class="hint">A short piece can grow into a book any time — nothing is lost.</p></div>
          <div class="field"><label for="dt-pin">Pinterest board for this project <small>(optional)</small></label><input class="input" id="dt-pin" inputmode="url" value="${esc(p.pinterest || '')}" placeholder="https://www.pinterest.com/…"></div>
          <div class="field"><label for="dt-canva">Canva design (like the cover) <small>(optional)</small></label><input class="input" id="dt-canva" inputmode="url" value="${esc(p.canva || '')}" placeholder="https://www.canva.com/design/…"></div>
          ${p.kind === 'short' ? `<label class="check"><input type="checkbox" id="dt-extras" ${p.extras ? 'checked' : ''}> Show Characters, Timeline, Ideas and Research for this short piece</label>` : ''}
          <div class="field"><label>Page size <small>(for Pages and the cover)</small></label><div class="sizes" id="dt-size">${SIZES.map(s => `<button data-w="${s.w}" data-h="${s.h}" class="${size.w === s.w && size.h === s.h ? 'on' : ''}"><b>${s.name}</b><small>${s.note}</small></button>`).join('')}</div></div>
        </div>
      </div>
      <div class="row end"><button class="btn quiet" data-act="close">Cancel</button><button class="btn" id="dt-save">Save</button></div>`, { cls: 'wide', back: back && { ...back, dirty: () => fields() !== startFields } });
    // (for "Leave without saving?" on the back link)
    const fields = () => JSON.stringify([$('#dt-title') && $('#dt-title').value, kind, size, $('#dt-pin') && $('#dt-pin').value, $('#dt-canva') && $('#dt-canva').value, $('#dt-extras') ? $('#dt-extras').checked : null, !!newCover, dropCover]);
    const startFields = fields();
    fillImages(el);
    el.addEventListener('click', async e => {
      const k = e.target.closest('#dt-kind button');
      if (k) { kind = k.dataset.k; $$('#dt-kind button').forEach(b => b.classList.toggle('on', b === k)); }
      const s = e.target.closest('#dt-size button');
      if (s) { size = { w: +s.dataset.w, h: +s.dataset.h }; $$('#dt-size button').forEach(b => b.classList.toggle('on', b === s)); $('#dt-cover').style.setProperty('--ar', `${size.w} / ${size.h}`); $('#dt-px').textContent = coverPx(size); }
      if (e.target.closest('#dt-up')) {
        const f = await pickFile('image/*');
        if (!f) return;
        try {
          newCover = await prepPhoto(f, 1800, 760000);
          dropCover = false;
          $('#dt-cover').classList.add('has-img', 'loaded');
          $('#dt-cover').innerHTML = `<img src="${newCover.data}" alt="">`;
          $('#dt-rm').hidden = false;
        } catch (err) { oops(err); }
      }
      if (e.target.closest('#dt-rm')) {
        newCover = null; dropCover = true;
        $('#dt-cover').classList.remove('has-img');
        $('#dt-cover').innerHTML = '<div class="cover-made"><span class="cm-title">No cover yet</span></div>';
        $('#dt-rm').hidden = true;
      }
      if (e.target.closest('#dt-save')) {
        const link = v => { v = v.trim(); return !v ? '' : /^https?:\/\//i.test(v) ? v : 'https://' + v; };
        const patch = { title: $('#dt-title').value.trim() || 'Untitled', kind, pageSize: size, pinterest: link($('#dt-pin').value), canva: link($('#dt-canva').value) };
        if ($('#dt-extras')) patch.extras = $('#dt-extras').checked;
        if (newCover) {
          patch.coverId = API.putImage({ ...newCover, pid: p.id });
          if (p.coverId) API.deleteImage(p.coverId);
        } else if (dropCover && p.coverId) { patch.coverId = ''; API.deleteImage(p.coverId); }
        API.saveProject(p.id, patch);
        closeSheet(true);
        toast('Saved');
      }
    });
  }

  // ---------- look ----------
  function lookSheet(p, back) {
    const start = Themes.norm(p.look);
    let look = JSON.parse(JSON.stringify(start));
    let scene = p.sceneBreak || 'fleuron';
    let sceneImg = p.sceneImg || ''; // her own scene-break picture (an image id)
    const sceneUps = [];             // pictures uploaded in this sheet (removed again if not kept)
    let saved = false;
    const tryOn = () => { lookPreview = look; paint(); Editor.relayout(); };
    const colorsNow = () => Themes.colors(look);
    const COLOR_NAMES = [['bg', 'Background'], ['paper', 'Page'], ['ink', 'Text'], ['accent', 'Accent'], ['spine', 'Book spine']];
    // The pop-up is a short list (what's chosen now); tapping a row slides in its choices.
    let pg = '';           // '' = the list, or which option is open
    const PAGES = { colors: 'Colors', title: 'Title font', body: 'Writing font', para: 'Paragraphs', paper: 'Paper', bg: 'Background', scene: 'Scene breaks' };
    const nameOf = (list, id) => (list.find(x => x.id === id) || list[0]);
    const listHtml = () => {
      const c = colorsNow(), bg = bgNow();
      const tf = Themes.titleOf(look.title), bf = Themes.bodyOf(look.body);
      const preset = look.preset === 'custom' ? 'My own colors' : (Themes.PRESETS.find(x => x.id === look.preset) || {}).name || '';
      const photo = bg.photo && bg.photo.starter ? (Backdrop.STARTERS.find(x => x.id === bg.photo.starter) || {}).name : bg.photo && bg.photo.imageId ? 'Your photo' : '';
      const thumb = bg.style === 'none' ? '' : bg.video ? `<img class="ap-thumb" src="${Backdrop.videoThumb(bg.video.id)}" alt="">` : !bg.photo ? '' : bg.photo.starter ? `<img class="ap-thumb" src="${Backdrop.starterUrl(bg.photo.starter, 120)}" alt="">` : `<img class="ap-thumb" data-img="${bg.photo.imageId}" alt="">`;
      const bgText = bg.style === 'none' ? (bg.effect ? Backdrop.EFFECTS.find(x => x[0] === bg.effect)[1] : 'None') : `${bg.video ? 'YouTube video' : photo} · ${Backdrop.STYLES.find(x => x[0] === bg.style)[1]}`;
      const row = (id, value) => `<button class="ap-row" data-pg="${id}"><span class="ap-label">${PAGES[id]}</span><span class="ap-val">${value}</span>${icon('back', 'ap-chev')}</button>`;
      return `<div class="ap-list">
        ${row('colors', `<span class="ap-dots"><i style="background:${c.bg}"></i><i style="background:${c.paper}"></i><i style="background:${c.accent}"></i></span>${esc(preset)}`)}
        ${row('title', `<span style="font-family:${tf.css};font-size:${Math.round(20 * tf.size)}px">${esc(tf.name)}</span>`)}
        ${row('body', `<span style="font-family:${bf.css};font-size:${Math.round(16 * bf.size)}px">${esc(bf.name)}</span>`)}
        <div class="ap-row static"><span class="ap-label">Text size <small>points · 11 is a normal paperback</small></span><div class="sizer"><button data-size="-1" aria-label="Smaller">−</button><input id="lk-size" inputmode="numeric" value="${look.size || 11}" aria-label="Text size"><button data-size="1" aria-label="Bigger">+</button></div></div>
        ${row('para', `${look.indent === 'book' ? 'Book style' : 'Indent every paragraph'}${look.dropcap ? ' · big first letter' : ''}`)}
        ${row('paper', esc(nameOf(Themes.TEXTURES, look.texture).name) + (look.texture === 'walnut' ? (look.walnut === 'page' ? ' · just the page' : ' · whole screen') : ''))}
        ${row('bg', `${thumb}${esc(bgText)}`)}
        ${row('scene', `<span class="ap-orn">${Editor.sceneTile(scene)}</span>`)}
      </div>`;
    };
    const pageHtml = () => {
      if (pg === 'colors') return `${lookSwatches(look.preset === 'custom' ? '' : look.preset)}
        <details class="custom" ${look.preset === 'custom' ? 'open' : ''}><summary>${icon('palette')} My own colors</summary>
          <div class="colors">${COLOR_NAMES.map(([k, n]) => `<label class="color"><input type="color" data-color="${k}" value="${colorsNow()[k]}"><span>${n}</span></label>`).join('')}</div>
        </details>`;
      if (pg === 'title') return `<div class="fonts titles">${Themes.TITLE_FONTS.map(f => `<button class="${look.title === f.id ? 'on' : ''}" data-title="${f.id}" style="font-family:${f.css};font-size:${Math.round(22 * f.size)}px">${esc(p.title && p.title.length < 22 ? p.title : 'Chapter One')}</button>`).join('')}</div>`;
      if (pg === 'body') return `<div class="fonts body">${Themes.BODY_FONTS.map(f => `<button class="${look.body === f.id ? 'on' : ''}" data-body="${f.id}" style="font-family:${f.css};font-size:${Math.round(16 * f.size)}px"><b>${esc(f.name)}</b> The pines held their breath before snow.</button>`).join('')}</div>`;
      if (pg === 'para') return `<div class="seg wrap" id="lk-ind"><button data-ind="all" class="${look.indent !== 'book' ? 'on' : ''}">Indent every paragraph</button><button data-ind="book" class="${look.indent === 'book' ? 'on' : ''}">Book style <small>(first one flush)</small></button></div>
        <label class="check"><input type="checkbox" id="lk-drop" ${look.dropcap ? 'checked' : ''}> Big first letter on each chapter</label>`;
      if (pg === 'paper') {
        const own = colorsNow();
        const sample = id => id === 'walnut' ? Themes.WALNUT : { paper: Themes.PAPER[id] || own.paper, ink: own.ink };
        return `<div class="paper-tiles">${Themes.TEXTURES.map(t => `<button class="paper-tile ${look.texture === t.id ? 'on' : ''}" data-tex="${t.id}"><span class="pt-sample" data-tex="${t.id}" style="--pp:${sample(t.id).paper};--pi:${sample(t.id).ink}">Aa</span>${esc(t.name)}</button>`).join('')}</div>
          ${look.texture === 'walnut' ? `<div class="field walnut-where"><label>Dark walnut on…</label><div class="seg" id="lk-wal"><button data-wal="all" class="${look.walnut !== 'page' ? 'on' : ''}">The whole screen</button><button data-wal="page" class="${look.walnut === 'page' ? 'on' : ''}">Just the page</button></div></div>` : ''}`;
      }
      if (pg === 'bg') return bgField();
      if (pg === 'scene') return `<p class="hint">What the scene-break button puts in.</p>
        <div class="scene-grid big">${Editor.SCENES.map(x => x.id === 'own' && !sceneImg
          ? `<button class="scene-opt add" data-sceneup>${icon('plus')}<small>Your own picture</small></button>`
          : `<button class="scene-opt ${x.id === scene ? 'on' : ''}" data-scene="${x.id}"><span>${Editor.sceneTile(x.id)}</span>${x.id === 'own' ? '<small>Your picture</small>' : ''}</button>`).join('')}</div>
        ${sceneImg ? `<p class="hint">Your picture: <button class="link" data-sceneup>Use a different picture</button></p>` : `<p class="hint">Your own picture: a drawing or ornament on a white or see-through background works best. It’s shown in your text color.</p>`}
        <p class="hint">Changing it updates the breaks already in the book — except any you changed one at a time by clicking them on the page.</p>`;
      return '';
    };
    const draw = () => (pg ? `<div class="ap-page">${pageHtml()}</div>` : listHtml());
    const head = () => (pg ? `<button class="ap-back" data-pg="">${icon('back')} Appearance</button><h2>${PAGES[pg]}</h2>` : `<h2>Appearance</h2><p class="muted">Try things on — the page behind changes as you go.</p>`);
    // ---- background (backdrop.js) ----
    const startBg = JSON.stringify(Backdrop.norm(start.bg));
    const uploaded = []; // photos uploaded in this sheet (removed again if not kept)
    let boardPics = null;
    const bgNow = () => Backdrop.norm(look.bg);
    const setBg = patch => { look.bg = { ...bgNow(), ...patch }; };
    const bgField = () => {
      const bg = bgNow();
      const photoOn = bg.style !== 'none';
      const on = x => (x ? 'on' : '');
      return `<div class="field"><p class="hint">Behind the page on the Mac — faded on the iPhone.</p>
        <div class="seg wrap" id="lk-bgs">${Backdrop.STYLES.map(([id, n]) => `<button data-bgs="${id}" class="${on(bg.style === id)}">${n}</button>`).join('')}</div>
        ${photoOn ? `<div class="bg-pics">
            ${Backdrop.STARTERS.map(x => `<button class="bg-pic ${on(bg.photo && bg.photo.starter === x.id)}" data-bgp="${x.id}" title="${esc(x.name)}"><img src="${Backdrop.starterUrl(x.id, 360)}" alt="" loading="lazy"><span>${esc(x.name)}</span></button>`).join('')}
            ${bg.photo && bg.photo.imageId ? `<button class="bg-pic on"><img data-img="${bg.photo.imageId}" alt=""><span>Your photo</span></button>` : ''}
            <button class="bg-pic add" data-bgup>${icon('plus')}<span>Upload a photo</span></button>
            <button class="bg-pic add" data-bgboard>${icon('photo')}<span>From the board</span></button>
            ${bg.video ? `<button class="bg-pic on" data-bgyt title="Change the video"><img src="${Backdrop.videoThumb(bg.video.id)}" alt=""><span>${icon('youtube', 'inline')} YouTube video</span></button>`
              : `<button class="bg-pic add" data-bgyt>${icon('youtube')}<span>YouTube video</span></button>`}
          </div>
          ${bg.video ? `<p class="hint">The video plays on the Mac, muted — the speaker button at the top turns sound on. On the iPhone (and offline) the photo shows instead: <b>${esc(bg.photo && bg.photo.starter ? (Backdrop.STARTERS.find(x => x.id === bg.photo.starter) || {}).name : 'your photo')}</b>. <button class="link" data-bgytx>Stop using the video</button></p>` : ''}
          ${boardPics ? `<div class="bg-pics board">${boardPics.length ? boardPics.map(b => `<button class="bg-pic ${on(bg.photo && bg.photo.imageId === b.imageId)}" data-bgpin="${b.imageId}"><img data-img="${b.imageId}" alt=""></button>`).join('') : '<p class="hint">No board photos yet.</p>'}</div>` : ''}
          <div class="bg-sliders"><label>Darker<input type="range" min="0" max="80" step="5" value="${Math.round(bg.dim * 100)}" data-bgr="dim"></label><label>Blur<input type="range" min="0" max="20" step="1" value="${bg.blur || 0}" data-bgr="blur"></label></div>` : ''}
        <label class="sub-label">Moving effect <small>(on the photo, or on plain paper)</small></label>
        <div class="chips">${Backdrop.EFFECTS.map(([id, n]) => `<button class="chip ${on(bg.effect === id)}" data-fx="${id}">${n}</button>`).join('')}</div>
      </div>`;
    };
    const fillBg = root => $$('img[data-img]', root).forEach(i => LAPI.getImage(i.dataset.img).then(src => { if (src) i.src = src; }));
    const dropUnused = keep => uploaded.filter(id => id !== keep).forEach(id => API.deleteImage(id));

    const el = sheet(`<div id="lk-head">${head()}</div><div id="lk-body">${draw()}</div>
      <div class="row end"><button class="btn quiet" data-act="close">Cancel</button><button class="btn" id="lk-save">Save</button></div>`, {
      cls: 'wide look-sheet',
      back: back && { ...back, dirty: () => !saved && (JSON.stringify(look) !== JSON.stringify(start) || scene !== (p.sceneBreak || 'fleuron') || sceneImg !== (p.sceneImg || '')) },
      onClose: () => {
        lookPreview = null; paint(); Editor.relayout();
        if (!saved) { dropUnused(null); sceneUps.forEach(id => API.deleteImage(id)); Editor.ownScene(p, LAPI); }
      },
    });
    fillBg(el);
    const redraw = () => { el.classList.toggle('in-page', !!pg); const open = $('details.custom', el) && $('details.custom', el).open; const y = el.scrollTop; $('#lk-head').innerHTML = head(); $('#lk-body').innerHTML = draw(); if (open) $('details.custom', el).open = true; el.scrollTop = y; fillBg(el); tryOn(); };
    // open one option (or go back to the list): slides in, from the top
    const go = to => { pg = to; el.classList.toggle('in-page', !!pg); $('#lk-head').innerHTML = head(); $('#lk-body').innerHTML = draw(); fillBg(el); el.scrollTop = 0; const b = $('#lk-body'); b.classList.remove('ap-in', 'ap-out'); void b.offsetWidth; b.classList.add(to ? 'ap-in' : 'ap-out'); };
    el.addEventListener('click', async e => {
      const t = e.target;
      const pgb = t.closest('[data-pg]');
      if (pgb) return go(pgb.dataset.pg);
      const bs = t.closest('[data-bgs]');
      if (bs) { setBg({ style: bs.dataset.bgs }); if (bs.dataset.bgs !== 'none' && !bgNow().photo) setBg({ photo: { starter: Backdrop.STARTERS[0].id } }); return redraw(); }
      const bp = t.closest('[data-bgp]');
      if (bp) { setBg({ photo: { starter: bp.dataset.bgp }, video: null }); return redraw(); }
      const bpin = t.closest('[data-bgpin]');
      if (bpin) { setBg({ photo: { imageId: bpin.dataset.bgpin }, video: null }); return redraw(); }
      if (t.closest('[data-bgytx]')) { setBg({ video: null }); return redraw(); }
      if (t.closest('[data-bgyt]')) {
        const cur = bgNow().video;
        const link = await ask('A YouTube video', 'Paste the link to a video — long ambient ones (rain, a fireplace, a forest) work best. It plays muted behind your page on the Mac.', 'Use this video', { input: cur ? `https://youtu.be/${cur.id}${cur.start ? '?t=' + cur.start : ''}` : '', placeholder: 'https://www.youtube.com/watch?v=…' });
        if (link == null || !link.trim()) return;
        const v = Backdrop.parseYouTube(link);
        if (!v) return toast('That doesn’t look like a YouTube video link.');
        setBg({ video: v });
        if (!bgNow().photo) setBg({ photo: { starter: Backdrop.STARTERS[0].id } }); // the stand-in on the iPhone / offline
        return redraw();
      }
      if (t.closest('[data-bgboard]')) { boardPics = (await LAPI.listCol('pins', p.id)).filter(x => x.imageId); return redraw(); }
      if (t.closest('[data-bgup]')) {
        const f = await pickFile('image/*');
        if (!f) return;
        try {
          const img = await prepPhoto(f, 2400, 700000);
          const id = await LAPI.putImage({ ...img, pid: p.id });
          uploaded.push(id);
          setBg({ photo: { imageId: id, own: true }, video: null });
          redraw();
        } catch (err) { oops(err); }
        return;
      }
      const fx = t.closest('[data-fx]');
      if (fx) { setBg({ effect: fx.dataset.fx }); return redraw(); }
      const pr = t.closest('[data-preset]');
      if (pr) { look.preset = pr.dataset.preset; look.custom = null; return redraw(); }
      const tf = t.closest('[data-title]');
      if (tf) { look.title = tf.dataset.title; return redraw(); }
      const bf = t.closest('[data-body]');
      if (bf) { look.body = bf.dataset.body; return redraw(); }
      const sz = t.closest('[data-size]');
      if (sz) { look.size = Math.max(8, Math.min(18, (Number(look.size) || 11) + Number(sz.dataset.size))); $('#lk-size').value = look.size; return tryOn(); }
      const ind = t.closest('[data-ind]');
      if (ind) { look.indent = ind.dataset.ind; return redraw(); }
      if (t.id === 'lk-drop') { look.dropcap = t.checked; return tryOn(); }
      const wl = t.closest('[data-wal]');
      if (wl) { look.walnut = wl.dataset.wal; return redraw(); }
      const tx = t.closest('[data-tex]');
      if (tx) { look.texture = tx.dataset.tex; return redraw(); }
      if (t.closest('[data-sceneup]')) {
        const f = await pickFile('image/*');
        if (!f) return;
        try {
          const img = await UI.prepLineArt(f);
          const id = await LAPI.putImage({ ...img, pid: p.id });
          sceneUps.push(id);
          sceneImg = id;
          scene = 'own';
          Editor.ownScene({ sceneImg }, LAPI);
          redraw();
        } catch (err) { oops(err); }
        return;
      }
      const sc = t.closest('[data-scene]');
      if (sc) { scene = sc.dataset.scene; $$('[data-scene]', el).forEach(b => b.classList.toggle('on', b === sc)); return; }
      if (t.closest('#lk-save')) {
        saved = true;
        // a photo uploaded for this background earlier and now replaced isn't needed anymore
        const was = Backdrop.norm(JSON.parse(startBg)).photo, now = bgNow().photo;
        if (was && was.own && was.imageId && !(now && now.imageId === was.imageId)) API.deleteImage(was.imageId);
        dropUnused(now && now.imageId);
        const oldScene = p.sceneBreak || 'fleuron';
        // her own scene-break picture: an older one that was replaced, and ones tried and not kept, go
        if (p.sceneImg && p.sceneImg !== sceneImg) API.deleteImage(p.sceneImg);
        sceneUps.filter(id => id !== sceneImg).forEach(id => API.deleteImage(id));
        API.saveProject(p.id, { look, sceneBreak: scene, sceneImg });
        p.look = look; p.sceneBreak = scene; p.sceneImg = sceneImg;
        lookPreview = null;
        closeSheet(true);
        paint();
        Editor.refreshLook(p);
        if (scene !== oldScene) {
          if (Editor.isOpen(p.id)) Editor.setAllScenes(scene, oldScene);
          else LAPI.chaptersOf(p.id).then(list => list.forEach(c => { const html = Editor.scenesIn(c.html, scene, oldScene); if (html) LAPI.saveChapter(c.id, { html }); })).catch(oops);
        }
        toast('Appearance saved');
      }
    });
    el.addEventListener('change', e => {
      if (e.target.id !== 'lk-size') return;
      const v = Math.round(Number(e.target.value));
      look.size = isFinite(v) && v ? Math.max(8, Math.min(18, v)) : (look.size || 11);
      e.target.value = look.size;
      tryOn();
    });
    el.addEventListener('input', e => {
      const r = e.target.closest('[data-bgr]');
      if (r) { setBg(r.dataset.bgr === 'dim' ? { dim: Number(r.value) / 100 } : { blur: Number(r.value) }); return tryOn(); }
      const c = e.target.closest('[data-color]');
      if (!c) return;
      if (look.preset !== 'custom') { look.custom = colorsNow(); look.preset = 'custom'; $$('.swatch', el).forEach(b => b.classList.remove('on')); }
      look.custom[c.dataset.color] = c.value;
      tryOn();
    });
    tryOn();
  }

  // ---------- the lock ----------
  Vault.onBeforeLock(() => { Editor.flushAll(); });
  Vault.onChange(open => {
    const p = currentProject();
    if (!open && p && p.locked) { Editor.close(); render(); toast('Locked'); }
    if (route.startsWith('#/settings')) render();
  });

  // Passphrase boxes: dots on screen, but not a "password" to the browser, so
  // Chrome/Safari never offer to save or fill it -- and no spellcheck,
  // autocorrect or keyboard learning, so it never turns up anywhere else.
  // (A browser that can't draw the dots on a text box gets a normal password box.)
  const DOTS = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('-webkit-text-security', 'disc');
  const secret = (id, extra = '') => `<input class="input secret" id="${id}" type="${DOTS ? 'text' : 'password'}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore data-form-type="other" ${extra}>`;
  function passFields(id, label) {
    return `<div class="field"><label for="${id}">${label}</label>${secret(id)}</div>`;
  }
  const pmName = '';

  // First time: make the passphrase, then show the recovery key once. Resolves true when done.
  function setupSheet() {
    return new Promise(res => {
      let done = false;
      const el = sheet(`<h2>Set up your lock</h2>
        <p class="muted">One passphrase locks all your private projects. It never leaves this device and isn’t saved anywhere — if it’s forgotten, only your recovery key can get the writing back.</p>
        <form id="lk-form" autocomplete="off">${pmName}
          ${passFields('lk-p1', 'Passphrase <small>(at least 8 characters — a few words is great)</small>', 'new-password')}
          ${passFields('lk-p2', 'Type it again', 'new-password')}
          <div class="row end"><button type="button" class="btn quiet" data-act="close">Cancel</button><button class="btn" id="lk-make">Create lock</button></div>
        </form>`, { cls: 'small', onClose: () => res(done) });
      setTimeout(() => $('#lk-p1') && $('#lk-p1').focus(), 80);
      $('#lk-form').addEventListener('submit', async e => {
        e.preventDefault();
        const a = $('#lk-p1').value, b = $('#lk-p2').value;
        if (a.length < 8) return toast('Use at least 8 characters.');
        if (a !== b) return toast('Those two don’t match.');
        $('#lk-make').disabled = true;
        $('#lk-make').textContent = 'Setting up…';
        const { lock, code } = await Vault.setup(a);
        S.settings.lock = lock;
        API.saveSettings({ lock });
        el.innerHTML = `<h2>Your recovery key</h2>
          <p class="muted">If you ever forget your passphrase, this key is the <b>only</b> way back in. Save it in your password manager or write it down somewhere safe. It won’t be shown again.</p>
          <div class="rkey" id="rkey">${esc(code)}</div>
          <div class="row"><button class="btn quiet" id="rk-copy">${icon('copy')} Copy</button></div>
          <label class="check"><input type="checkbox" id="rk-ok"> I saved my recovery key somewhere safe</label>
          <div class="row end"><button class="btn" id="rk-done" disabled>Done</button></div>`;
        $('#rk-copy').onclick = () => navigator.clipboard.writeText(code).then(() => toast('Copied')).catch(() => toast('Select the key and copy it'));
        $('#rk-ok').onchange = e2 => { $('#rk-done').disabled = !e2.target.checked; };
        $('#rk-done').onclick = () => { done = true; closeSheet(); };
      });
    });
  }
  function askPassSheet(title) {
    return new Promise(res => {
      let ok = false;
      sheet(`<h2>${esc(title)}</h2><form id="up-form" autocomplete="off">${pmName}${passFields('up-pass', 'Passphrase', 'current-password')}
        <div class="row between"><button type="button" class="link" id="up-forgot">Forgot it?</button><span><button type="button" class="btn quiet" data-act="close">Cancel</button> <button class="btn">Unlock</button></span></div></form>`, { cls: 'small', onClose: () => res(ok) });
      setTimeout(() => $('#up-pass') && $('#up-pass').focus(), 80);
      $('#up-forgot').onclick = () => { closeSheet(true); recoverSheet().then(res); };
      $('#up-form').addEventListener('submit', async e => {
        e.preventDefault();
        if (await Vault.unlock($('#up-pass').value)) { ok = true; closeSheet(); }
        else { toast('That passphrase isn’t right.'); $('#up-pass').select(); }
      });
    });
  }
  function recoverSheet() {
    return new Promise(res => {
      let ok = false;
      sheet(`<h2>Use your recovery key</h2><p class="muted">Type your recovery key, then choose a new passphrase. Your recovery key keeps working afterward.</p>
        <form id="rc-form" autocomplete="off">${pmName}<div class="field"><label for="rc-code">Recovery key</label><input class="input mono" id="rc-code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-…"></div>
        ${passFields('rc-p1', 'New passphrase', 'new-password')}${passFields('rc-p2', 'Type it again', 'new-password')}
        <div class="row end"><button type="button" class="btn quiet" data-act="close">Cancel</button><button class="btn" id="rc-go">Unlock</button></div></form>`, { cls: 'small', onClose: () => res(ok) });
      $('#rc-form').addEventListener('submit', async e => {
        e.preventDefault();
        const a = $('#rc-p1').value, b = $('#rc-p2').value;
        if (a.length < 8) return toast('Use at least 8 characters.');
        if (a !== b) return toast('Those two don’t match.');
        $('#rc-go').disabled = true;
        const lock = await Vault.recover($('#rc-code').value, a);
        $('#rc-go').disabled = false;
        if (!lock) return toast('That recovery key isn’t right.');
        S.settings.lock = lock;
        API.saveSettings({ lock });
        ok = true;
        closeSheet();
        toast('Unlocked — new passphrase saved');
      });
    });
  }
  function changePassSheet() {
    const el = sheet(`<h2>Change passphrase</h2><form id="cp-form" autocomplete="off">${pmName}${passFields('cp-old', 'Current passphrase', 'current-password')}${passFields('cp-p1', 'New passphrase', 'new-password')}${passFields('cp-p2', 'Type it again', 'new-password')}
      <div class="row end"><button type="button" class="btn quiet" data-act="close">Cancel</button><button class="btn" id="cp-go">Change it</button></div></form>`, { cls: 'small' });
    $('#cp-form').addEventListener('submit', async e => {
      e.preventDefault();
      const a = $('#cp-p1').value, b = $('#cp-p2').value;
      if (a.length < 8) return toast('Use at least 8 characters.');
      if (a !== b) return toast('Those two don’t match.');
      $('#cp-go').disabled = true;
      const lock = await Vault.changePass($('#cp-old').value, a);
      $('#cp-go').disabled = false;
      if (!lock) return toast('Your current passphrase isn’t right.');
      S.settings.lock = lock;
      API.saveSettings({ lock });
      closeSheet(true);
      toast('Passphrase changed');
    });
  }
  // the page you see when opening a locked project
  function unlockScreen(p) {
    view.innerHTML = `<div class="unlock">
      <a class="back" href="#/shelf" title="Library" aria-label="Back to Library">${icon('back')}</a>
      <form class="unlock-card" id="ul-form" autocomplete="off">${pmName}
        <span class="unlock-icon">${icon('lock')}</span>
        <h1>${esc(p.title || 'Untitled')}</h1>
        <p class="muted">This project is locked.</p>
        ${secret('unlock-pass', 'placeholder="Passphrase"')}
        <button class="btn big" id="ul-go">Unlock</button>
        <button type="button" class="link" id="ul-forgot">Forgot your passphrase?</button>
      </form>
    </div>`;
    setTimeout(() => $('#unlock-pass') && $('#unlock-pass').focus(), 60);
    $('#ul-forgot').onclick = () => recoverSheet().then(ok => { if (ok) render(); });
    $('#ul-form').addEventListener('submit', async e => {
      e.preventDefault();
      const b = $('#ul-go');
      b.disabled = true; b.textContent = 'Unlocking…';
      const ok = await Vault.unlock($('#unlock-pass').value);
      if (!ok) { b.disabled = false; b.textContent = 'Unlock'; toast('That passphrase isn’t right.'); $('#unlock-pass').select(); return; }
      render();
    });
  }
  // a background photo she uploaded for this project is locked along with it
  // (and so is her own scene-break picture)
  const bgPhotoIds = p => { const ph = Backdrop.norm((p.look || {}).bg).photo; return [ph && ph.imageId, p.sceneImg].filter(Boolean); };
  async function lockProject(p) {
    if (!Vault.isSetUp()) { if (!(await setupSheet())) return; }
    else if (!Vault.isOpen() && !(await askPassSheet('Enter your passphrase'))) return;
    Editor.flushAll();
    Editor.close();
    p.locked = true;
    lockNow[p.id] = true;
    API.saveProject(p.id, { locked: true, words: 0 });
    Project.close();
    await LAPI.sealProject(p.id, p.coverId, bgPhotoIds(p));
    toast('Locked 🔒 Only your passphrase opens it.');
    render();
  }
  async function unlockForGood(p) {
    if (!(await ask('Take the lock off?', `“${esc(p.title)}” will be saved normally again, without scrambling.`, 'Unlock for good'))) return;
    if (!Vault.isOpen() && !(await askPassSheet('Enter your passphrase'))) return;
    Editor.flushAll();
    await LAPI.settle();
    Editor.close();
    Project.close();
    const words = await LAPI.unsealProject(p.id, p.coverId, bgPhotoIds(p));
    p.locked = false;
    lockNow[p.id] = false;
    API.saveProject(p.id, { locked: false, words });
    toast('The lock is off');
    render();
  }

  // ---------- story ideas ----------
  function ideasScreen() {
    const list = S.ideas.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const open = list.filter(i => !i.pid || !S.projects.some(p => p.id === i.pid));
    const started = list.filter(i => i.pid && S.projects.some(p => p.id === i.pid));
    const card = i => {
      const proj = i.pid && S.projects.find(p => p.id === i.pid);
      return `<article class="idea" data-id="${i.id}">
        <h3>${esc(i.title || 'Untitled idea')}</h3>
        ${i.note ? `<p>${esc(i.note)}</p>` : ''}
        ${i.tags ? `<div class="tags">${i.tags.split(',').map(t => t.trim()).filter(Boolean).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
        <div class="idea-foot">
          <span class="when">${ago(i.createdAt)}</span>
          ${proj ? `<a class="btn quiet small" href="#/p/${proj.id}">${icon('book')} Open “${esc(proj.title)}”</a>` : `<button class="btn quiet small" data-start="${i.id}">${icon('quill-solid')} Start writing</button>`}
        </div>
      </article>`;
    };
    view.innerHTML = `<div class="ideas-page">
      <div class="page-head">
        <div><h1>Story Ideas</h1><p class="muted">Stories to write someday.</p></div>
        <div class="head-btns"><button class="btn" id="idea-new">${icon('plus')} New idea</button></div>
      </div>
      ${open.length ? `<div class="ideas">${open.map(card).join('')}</div>` : `<div class="empty">${candle('empty-candle')}<p>No ideas jotted down yet.</p></div>`}
      ${started.length ? `<h2 class="sec-title">Started</h2><div class="ideas started">${started.map(card).join('')}</div>` : ''}
    </div>`;
    view.onclick = e => {
      if (e.target.closest('#idea-new, #idea-new2')) return ideaSheet(null);
      const st = e.target.closest('[data-start]');
      if (st) {
        const i = S.ideas.find(x => x.id === st.dataset.start);
        return newProject({ title: i.title, notes: [i.note, i.tags ? 'Tags: ' + i.tags : ''].filter(Boolean).join('\n\n'), ideaId: i.id, kind: /fic/i.test(i.tags || '') ? 'short' : 'book' });
      }
      if (e.target.closest('a,button')) return;
      const c = e.target.closest('.idea');
      if (c) ideaSheet(S.ideas.find(x => x.id === c.dataset.id));
    };
  }
  function ideaSheet(i) {
    const el = sheet(`<h2>${i ? 'Story idea' : 'New story idea'}</h2>
      <div class="field"><label for="id-title">Idea</label><input class="input" id="id-title" value="${esc(i ? i.title : '')}" placeholder="A few words to remember it by" autofocus></div>
      <div class="field"><label for="id-note">Notes</label><textarea class="input" id="id-note" rows="7" placeholder="Characters, the hook, a scene you can already see…">${esc(i ? i.note : '')}</textarea></div>
      <div class="field"><label for="id-tags">Tags <small>(separate with commas)</small></label><input class="input" id="id-tags" value="${esc(i ? i.tags || '' : '')}" placeholder="fic, romance, fantasy"></div>
      <div class="row ${i ? 'between' : 'end'}">${i ? `<button class="btn quiet danger-text" id="id-del">${icon('trash')} Delete</button>` : ''}
        <span><button class="btn quiet" data-act="close">Cancel</button> <button class="btn" id="id-save">Save</button></span></div>`);
    el.addEventListener('click', async e => {
      if (e.target.closest('#id-save')) {
        const data = { title: $('#id-title').value.trim() || 'Untitled idea', note: $('#id-note').value.trim(), tags: $('#id-tags').value.trim() };
        if (i) API.saveIdea(i.id, data); else API.addIdea(data);
        closeSheet(true);
        render();
      }
      if (e.target.closest('#id-del')) {
        if (!(await ask('Delete this idea?', esc(i.title), 'Delete', { danger: true }))) return;
        API.deleteIdea(i.id);
        closeSheet(true);
        render();
      }
    });
  }

  // ---------- settings ----------
  function settingsScreen() {
    const st = settings();
    const n = { mode: 'toggle', ...(st.night || {}) };
    let sunLine = '';
    if (n.mode === 'sunset') {
      const spot = st.spot && isFinite(st.spot.lat) ? st.spot : { lat: 37.54, lng: -77.43 };
      const t = Themes.sun(new Date(), spot.lat, spot.lng);
      const f = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      sunLine = `<p class="hint">Today: sunrise ${f(t.rise)} · sunset ${f(t.set)} ${st.spot ? '(your location)' : '(Virginia)'}. <button class="link" id="st-spot">${st.spot ? 'Update my location' : 'Use my location instead'}</button></p>`;
    }
    view.innerHTML = `<div class="settings-page">
      <div class="page-head"><div><h1>Settings</h1></div></div>
      <section class="card">
        <h2>${icon('moon')} Night mode</h2>
        <p class="muted">Warm sepia or dark walnut — never black.</p>
        <div class="night-tiles">${[['sepia', 'Warm sepia', '#E9D8B6', '#3A2816'], ['walnut', 'Dark walnut', Themes.WALNUT.paper, Themes.WALNUT.ink]].map(([id, name, pp, pi]) =>
          `<button class="paper-tile ${(n.style === 'walnut') === (id === 'walnut') ? 'on' : ''}" data-ns="${id}"><span class="pt-sample" data-tex="${id === 'walnut' ? 'walnut' : 'cream'}" style="--pp:${pp};--pi:${pi}">Aa</span>${name}</button>`).join('')}</div>
        <label class="check"><input type="checkbox" id="st-sunset" ${n.mode === 'sunset' ? 'checked' : ''}> Turn on automatically at sunset</label>
        ${n.mode === 'sunset' ? sunLine : `<p class="hint">Or tap the ${icon('moon', 'inline')} at the top of any screen. Night mode is <b>${n.on ? 'on' : 'off'}</b>.</p>`}
      </section>
      <section class="card">
        <h2>${icon('read')} Reading</h2>
        <p class="muted">The <b>Read</b> button at the start of the writing toolbar opens your story as a real book. The ‹ › buttons and arrow keys always turn the page; you can also turn it by…</p>
        <label class="check"><input type="checkbox" id="st-rtap" ${(st.reading || {}).tap !== false ? 'checked' : ''}> Tapping the edges <small class="muted">— right side forward, left side back</small></label>
        <label class="check"><input type="checkbox" id="st-rswipe" ${(st.reading || {}).swipe !== false ? 'checked' : ''}> Swiping <small class="muted">— the page follows your finger (two fingers on a Mac trackpad)</small></label>
      </section>
      <section class="card">
        <h2>${icon('text')} Page zoom</h2>
        <p class="muted">How big the pages look on this screen. It doesn’t change your book — each project’s text size is in its Appearance (⋯ in the project).</p>
        <div class="seg" id="st-size">${[['s', 'Smaller'], ['m', 'Normal'], ['l', 'Bigger'], ['xl', 'Biggest']].map(([k, l]) => `<button data-s="${k}" class="${(st.textSize || 'm') === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      </section>
      <section class="card">
        <h2>${icon('photo')} Your links</h2>
        <p class="muted">The Pinterest button on a vision board opens this (unless the project has its own).</p>
        <div class="field"><label for="st-pin">Pinterest</label><input class="input" id="st-pin" inputmode="url" value="${esc(st.pinterest || '')}" placeholder="https://www.pinterest.com/yourname"></div>
        <div class="field"><label for="st-canva">Canva</label><input class="input" id="st-canva" inputmode="url" value="${esc(st.canva || '')}" placeholder="https://www.canva.com/"></div>
      </section>
      <section class="card">
        <h2>${icon('flame')} Writing goal</h2>
        <p class="muted">How often you write — days in a row, or days per week.</p>
        <div class="row"><span class="goal-sum">${esc(Goals.summary())}</span><button class="btn quiet small" data-act="goal">${icon('flame')} Open</button></div>
      </section>
      <section class="card">
        <h2>${icon('quill-solid')} Author name</h2>
        <p class="muted">Goes on the title page when you export for Kindle.</p>
        <input class="input" id="st-author" value="${esc(st.author || '')}" placeholder="Your name or pen name">
      </section>
      <section class="card">
        <h2>${icon('lock')} Lock</h2>
        ${!Vault.isSetUp() ? `<p class="muted">Not set up yet. It’s set up the first time you choose <b>⋯ → Lock this project</b> in a project.</p>` : `
        <p class="muted">Locked projects lock again when you leave the app. ${Vault.isOpen() ? 'They’re <b>unlocked</b> right now.' : 'They’re locked right now.'}</p>
        <label class="check"><input type="checkbox" id="st-lockleave" ${st.lockLeave !== false ? 'checked' : ''}> Lock as soon as I leave a locked project <small class="muted">— going back to My Library or into another project</small></label>
        <div class="field"><label>Also lock after this long without typing</label>
          <div class="seg" id="st-idle">${[[0, 'Off'], [5, '5 min'], [15, '15 min'], [30, '30 min'], [60, '60 min']].map(([v, l]) => `<button data-idle="${v}" class="${(st.lockIdle || 0) === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div class="row">${Vault.isOpen() ? `<button class="btn quiet" id="st-locknow">${icon('lock')} Lock now</button>` : ''}<button class="btn quiet" id="st-chpass">Change passphrase</button><button class="btn quiet" id="st-recover">Forgot passphrase</button></div>`}
      </section>
      <section class="card">
        <h2>${icon('storage')} Storage</h2>
        <p class="muted">How much of your free 1 GB is used. Photos take almost all of it.</p>
        <div id="st-store">${storageLine()}</div>
      </section>
      <section class="card">
        <h2>${icon('lock')} Account</h2>
        ${SAMPLE ? `<p class="muted">Sample mode — nothing is saved online. <button class="link" id="st-reset">Start the sample over</button></p>` : `<p class="muted">Signed in as <b>${esc(user.email)}</b>. Your writing saves on this device first and syncs when you’re online.</p>
        <button class="btn quiet" id="st-out">Sign out</button>`}
      </section>
      <p class="fine center">Writing Desk</p>
    </div>`;
    view.onclick = e => {
      if (e.target.id === 'st-sunset') { const night = { ...n, mode: e.target.checked ? 'sunset' : 'toggle' }; S.settings.night = night; API.saveSettings({ night }); paint(); settingsScreen(); return; }
      const ns = e.target.closest('.night-tiles [data-ns]');
      if (ns) { const night = { ...n, style: ns.dataset.ns }; S.settings.night = night; API.saveSettings({ night }); paint(); settingsScreen(); return; }
      const sb = e.target.closest('#st-size button');
      if (sb) { S.settings.textSize = sb.dataset.s; API.saveSettings({ textSize: sb.dataset.s }); paint(); settingsScreen(); return; }
      if (e.target.closest('#st-spot')) {
        if (!navigator.geolocation) return toast('This device can’t share its location.');
        navigator.geolocation.getCurrentPosition(pos => {
          const spot = { lat: Math.round(pos.coords.latitude * 100) / 100, lng: Math.round(pos.coords.longitude * 100) / 100 };
          S.settings.spot = spot; API.saveSettings({ spot }); paint(); settingsScreen(); toast('Using your location for sunset');
        }, () => toast('Location wasn’t allowed — still using Virginia.'));
      }
      const ib = e.target.closest('#st-idle button');
      if (ib) { const v = Number(ib.dataset.idle); S.settings.lockIdle = v; Vault.setIdle(v); API.saveSettings({ lockIdle: v }); settingsScreen(); return; }
      if (e.target.closest('#st-locknow')) { Vault.lock(); settingsScreen(); return; }
      if (e.target.id === 'st-lockleave') { S.settings.lockLeave = e.target.checked; API.saveSettings({ lockLeave: e.target.checked }); return; }
      if (e.target.closest('#st-chpass')) return changePassSheet();
      if (e.target.closest('#st-recover')) return recoverSheet().then(() => settingsScreen());
      if (e.target.closest('#st-check')) return checkStorage();
      if (e.target.closest('#st-out')) API.signOut();
      if (e.target.closest('#st-reset')) API.signOut();
    };
    for (const [id, k] of [['#st-pin', 'pinterest'], ['#st-canva', 'canva']]) {
      $(id).addEventListener('change', e => {
        let v = e.target.value.trim();
        if (v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
        e.target.value = v;
        S.settings[k] = v;
        API.saveSettings({ [k]: v });
        toast('Saved');
      });
    }
    const last = (st.storage || {}).at || 0;
    if (Date.now() - last > 7 * 864e5 && navigator.onLine) checkStorage();
    for (const [id, k] of [['#st-rtap', 'tap'], ['#st-rswipe', 'swipe']]) {
      $(id).addEventListener('change', e => { const reading = { ...(S.settings.reading || {}), [k]: e.target.checked }; S.settings.reading = reading; API.saveSettings({ reading }); });
    }
    $('#st-author').addEventListener('change', e => { S.settings.author = e.target.value.trim(); API.saveSettings({ author: S.settings.author }); toast('Saved'); });
  }

  // ---------- storage used ----------
  // settings.storage = { photos, other (bytes), at } -- from the last check
  const GB = 1024 ** 3;
  const mb = b => (b < 1024 ** 2 ? `${Math.max(1, Math.round(b / 1024))} KB` : b < GB ? `${Math.round(b / 1024 ** 2)} MB` : `${(b / GB).toFixed(2)} GB`);
  let checking = false;
  function storageLine() {
    const st = settings().storage;
    if (checking) return '<p class="hint">Adding it up…</p>';
    if (!st) return `<button class="btn quiet small" id="st-check">Check now</button>`;
    const used = st.photos + st.other, pct = used / GB * 100;
    return `<div class="store-bar"><span style="width:${Math.max(1, Math.min(100, pct))}%"></span></div>
      <p class="store-line"><b>About ${mb(used)} of 1 GB</b> (${pct < 1 ? 'under 1' : Math.round(pct)}%) · photos ${mb(st.photos)} · writing and the rest ${mb(st.other)}</p>
      <p class="hint">Checked ${ago(st.at)}. <button class="link" id="st-check">Check again</button></p>`;
  }
  async function checkStorage() {
    if (checking) return;
    if (!navigator.onLine) return toast('Needs a connection to check.');
    checking = true;
    const box = () => $('#st-store');
    if (box()) box().innerHTML = storageLine();
    try {
      const u = await API.usage();
      const storage = { photos: u.photos, other: u.other, at: Date.now() };
      S.settings.storage = storage;
      API.saveSettings({ storage });
    } catch (e) { oops(e); }
    checking = false;
    if (box()) box().innerHTML = storageLine();
  }

  // ---------- header ----------
  $('#top').addEventListener('click', e => {
    if (e.target.closest('[data-act="night"]')) toggleNight();
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
