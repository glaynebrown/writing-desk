/* Research: topics with notes, links and photos, inside each project (its
   Research tab). A topic can belong to several stories -- tag it on the topic
   page, or pull one in with "Add from another story".
   Topics are never locked -- they're saved normally even when a project
   they're tagged with is locked.

   Screens (project tab):
     #/p/{pid}/research       the topics tagged with that project
     #/p/{pid}/research/{id}  one topic

   users/{uid}/topics/{id}  { title, html (notes), links [{url, label}], photos [{id, w, h}],
                              pids [project ids], createdAt, updatedAt }
   Topic photos are in images/ as { data, w, h, topic } (no pid, so never locked). */

const Research = (() => {
  const { $, $$, esc, icon, ago, toast, ask, sheet, closeSheet, prepPhoto, pickFile, plural } = UI;

  let search = '';
  const textOf = html => { const d = document.createElement('div'); d.innerHTML = String(html || '').replace(/<\/(p|li)>|<br\s*\/?>/gi, '$& '); return d.textContent.replace(/\s+/g, ' ').trim(); };
  const safe = u => (/^https?:\/\//i.test(u || '') ? u : '');
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } };
  const sorted = list => list.slice().sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));

  // ---------- the list ----------
  function inProject(box, p, sub, ctx) {
    const base = `#/p/${p.id}/research`;
    if (sub) return topicPage(box, ctx, sub, base, p);
    listPage(box, ctx, p);
  }

  function matches(t, ctx, q) {
    if (!q) return true;
    const names = (t.pids || []).map(id => (ctx.projects().find(p => p.id === id) || {}).title || '').join(' ');
    const hay = [t.title, textOf(t.html), ...(t.links || []).map(l => l.label + ' ' + l.url), names].join(' ').toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w));
  }
  function listPage(box, ctx, p) {
    const base = `#/p/${p.id}/research`;
    const all = ctx.topics();
    const mine = all.filter(t => (t.pids || []).includes(p.id));
    const others = all.filter(t => !(t.pids || []).includes(p.id));
    box.innerHTML = `<div class="rs">
      <div class="ps-head"><div><h1>Research</h1><p class="muted">Notes, links and photos for this story.</p></div>
        <div class="head-btns">${others.length ? `<button class="btn quiet" data-r="borrow">${icon('link')} Add from another story</button>` : ''}<button class="btn" data-r="new">${icon('plus')} New topic</button></div></div>
      ${mine.length ? `<div class="rs-search">${icon('search')}<input class="input" id="rs-q" type="search" value="${esc(search)}" placeholder="Search notes, links and topics" autocomplete="off"></div>` : ''}
      <div id="rs-list"></div>
    </div>`;
    const root = $('.rs', box);
    const drawList = () => {
      const list = sorted(mine.filter(t => matches(t, ctx, search)));
      const el = $('#rs-list', root);
      if (!mine.length) { el.innerHTML = `<div class="empty"><img class="empty-candle" src="candle.webp" alt=""><p>No research for this story yet — hunting, herbs, 1920s slang, anything.</p></div>`; return; }
      if (!list.length) { el.innerHTML = '<p class="hint center">Nothing matches.</p>'; return; }
      el.innerHTML = `<div class="rs-grid">${list.map(t => card(t, ctx, base, p)).join('')}</div>`;
      fillImgs(el, ctx);
    };
    drawList();
    root.addEventListener('input', e => { if (e.target.id === 'rs-q') { search = e.target.value; drawList(); } });
    root.addEventListener('click', e => {
      if (e.target.closest('[data-r="new"]')) return newTopic(ctx, p, base);
      if (e.target.closest('[data-r="borrow"]')) return borrowSheet(ctx, p, others);
    });
  }
  // a topic from another story (or one no story has anymore) → this story too
  function borrowSheet(ctx, p, others) {
    const name = t => (t.pids || []).map(id => ctx.projects().find(x => x.id === id)).filter(Boolean).map(x => x.title || 'Untitled').join(', ') || 'Not in any story';
    const el = sheet(`<h2>Add from another story</h2>
      <p class="muted">The topic stays in its other stories too — it’s the same notes, shared.</p>
      <div class="rs-search">${icon('search')}<input class="input" id="rb-q" type="search" placeholder="Search" autocomplete="off"></div>
      <div class="rb-list" id="rb-list"></div>`, { cls: 'small' });
    const draw = q => {
      const list = sorted(others.filter(t => matches(t, ctx, q)));
      $('#rb-list').innerHTML = list.length ? list.map(t => `<button class="pop-item rb-item" data-rb="${t.id}">${icon('research')}<span><b>${esc(t.title || 'Untitled topic')}</b><small>${esc(name(t))}</small></span></button>`).join('') : '<p class="hint center">Nothing matches.</p>';
    };
    draw('');
    el.addEventListener('input', e => { if (e.target.id === 'rb-q') draw(e.target.value); });
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-rb]');
      if (!b) return;
      const t = others.find(x => x.id === b.dataset.rb);
      ctx.api.saveDoc('topics', t.id, { pids: [...(t.pids || []), p.id], updatedAt: Date.now() });
      closeSheet(true);
      toast(`Added “${t.title || 'Untitled topic'}”`);
    });
  }
  function card(t, ctx, base, p) {
    const snip = textOf(t.html);
    const tags = (t.pids || []).map(id => ctx.projects().find(x => x.id === id)).filter(Boolean).filter(x => !p || x.id !== p.id);
    const photo = (t.photos || [])[0];
    return `<a class="rs-card" href="${base}/${t.id}">
      ${photo ? `<span class="rs-thumb"><img data-img="${photo.id}" alt=""></span>` : ''}
      <span class="rs-card-body"><h3>${esc(t.title || 'Untitled topic')}</h3>
        ${snip ? `<p>${esc(snip.length > 160 ? snip.slice(0, 160) + '…' : snip)}</p>` : ''}
        <span class="rs-meta">${[(t.links || []).length ? plural(t.links.length, 'link') : '', (t.photos || []).length ? plural(t.photos.length, 'photo') : '', ago(t.updatedAt || t.createdAt)].filter(Boolean).join(' · ')}</span>
        ${tags.length ? `<span class="tags">${tags.map(x => `<span class="tag">${esc(x.title || 'Untitled')}</span>`).join('')}</span>` : ''}</span>
    </a>`;
  }
  async function newTopic(ctx, p, base) {
    const title = await ask('New research topic', '', 'Create', { input: '', placeholder: 'Hunting, skinning a deer…' });
    if (title == null) return;
    const now = Date.now();
    const id = await ctx.api.addDoc('topics', { title: title.trim() || 'Untitled topic', html: '', links: [], photos: [], pids: p ? [p.id] : [], createdAt: now, updatedAt: now });
    location.hash = `${base}/${id}`;
  }

  // ---------- one topic ----------
  let T = null; // { id, ctx, timer, patch }
  function save(patch, now) {
    if (!T) return;
    T.patch = { ...(T.patch || {}), ...patch };
    clearTimeout(T.timer);
    if (now) flush(); else T.timer = setTimeout(flush, 700);
  }
  function flush() {
    if (!T || !T.patch) return;
    clearTimeout(T.timer);
    T.ctx.api.saveDoc('topics', T.id, { ...T.patch, updatedAt: Date.now() });
    T.patch = null;
  }
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('hashchange', flush);

  function topicPage(box, ctx, id, base, p) {
    const t = ctx.topics().find(x => x.id === id);
    if (!t) { box.innerHTML = `<div class="empty"><p>That topic isn’t here anymore.</p><a class="btn" href="${base}">Back to Research</a></div>`; return; }
    if (!T || T.id !== id) { flush(); T = { id, ctx }; }
    T.ctx = ctx;
    const projects = ctx.projects();
    box.innerHTML = `<div class="rs-topic">
      <a class="sub-back" href="${base}">${icon('back')} Research for this story</a>
      <input class="rs-title" id="rs-title" value="${esc(t.title || '')}" placeholder="Topic">
      <div class="rs-cols">
        <section class="rs-main">
          <div class="rs-notes-bar">
            <button data-fmt="bold" title="Bold"><b>B</b></button><button data-fmt="italic" title="Italic"><i>I</i></button>
            <button data-fmt="insertUnorderedList" title="Bullet list">${icon('list')}</button><button data-fmt="insertOrderedList" title="Numbered list">1.</button>
          </div>
          <div class="rs-notes" id="rs-notes" contenteditable="true" data-ph="Notes — what you learned, steps, words people use, where you found it…">${clean(t.html)}</div>
        </section>
        <aside class="rs-side">
          <div class="rs-block"><h3>${icon('link')} Links</h3>
            <div id="rs-links">${linksHtml(t)}</div>
            <button class="btn quiet small" data-r="link-add">${icon('plus')} Add a link</button></div>
          <div class="rs-block"><h3>${icon('photo')} Photos</h3>
            <div class="rs-photos" id="rs-photos">${(t.photos || []).map(ph => `<button class="rs-photo" data-ph="${ph.id}"><img data-img="${ph.id}" alt=""></button>`).join('')}</div>
            <div class="row"><button class="btn quiet small" data-r="photo-add">${icon('plus')} Add photos</button><button class="btn quiet small" data-r="photo-paste">${icon('copy')} Paste</button></div></div>
          <div class="rs-block"><h3>${icon('book')} For which stories?</h3>
            ${projects.length ? `<div class="chips">${projects.map(x => `<button class="chip ${(t.pids || []).includes(x.id) ? 'on' : ''}" data-rp="${x.id}">${esc(x.title || 'Untitled')}</button>`).join('')}</div>` : '<p class="hint">No projects yet.</p>'}
            <p class="hint">Research is never locked, even for a locked story.</p></div>
          <button class="btn quiet small danger-text" data-r="del">${icon('trash')} Delete topic</button>
        </aside>
      </div>
      <div class="drop-hint" id="rs-drop"><span>${icon('photo')} Drop photos to add them</span></div>
    </div>`;
    const root = $('.rs-topic', box);
    fillImgs(root, ctx);
    const notes = $('#rs-notes');
    $('#rs-title').addEventListener('input', e => save({ title: e.target.value.trim() || 'Untitled topic' }));
    notes.addEventListener('input', () => save({ html: clean(notes.innerHTML) }));
    notes.addEventListener('blur', () => flush());
    $('#rs-title').addEventListener('change', () => flush());
    notes.addEventListener('paste', e => {
      e.preventDefault();
      const cd = e.clipboardData;
      const files = Array.from(cd.files || []).filter(f => /^image\//.test(f.type));
      if (files.length) return addPhotos(files);
      const html = cd.getData('text/html');
      document.execCommand('insertHTML', false, html ? clean(html) : esc(cd.getData('text/plain')).replace(/\n/g, '<br>'));
    });
    $('.rs-notes-bar', root).addEventListener('mousedown', e => e.preventDefault());
    root.addEventListener('click', async e => {
      const f = e.target.closest('[data-fmt]');
      if (f) { notes.focus(); document.execCommand(f.dataset.fmt); save({ html: clean(notes.innerHTML) }); return; }
      const r = e.target.closest('[data-r]');
      const R = r && r.dataset.r;
      const cur = () => ctx.topics().find(x => x.id === id) || t;
      if (R === 'link-add') return linkSheet(cur(), null);
      if (R === 'link-edit') return linkSheet(cur(), +r.dataset.i);
      if (R === 'photo-add') return addPhotos(await pickFile('image/*', true));
      if (R === 'photo-paste') return pastePhotos();
      const ph = e.target.closest('[data-ph]');
      if (ph) return photoSheet(cur(), ph.dataset.ph);
      const pr = e.target.closest('[data-rp]');
      if (pr) {
        const c = cur();
        const pids = (c.pids || []).includes(pr.dataset.rp) ? c.pids.filter(x => x !== pr.dataset.rp) : [...(c.pids || []), pr.dataset.rp];
        c.pids = pids;
        pr.classList.toggle('on');
        return save({ pids }, true);
      }
      if (R === 'del') {
        if (!(await ask('Delete this topic?', `“${esc(t.title)}” — its notes, links and photos — will be gone for good.`, 'Delete', { danger: true }))) return;
        const c = cur();
        T.patch = null;
        (c.photos || []).forEach(x => ctx.api.deleteImage(x.id));
        ctx.api.deleteDoc('topics', id);
        T = null;
        location.hash = base;
      }
    });
    // photos dropped onto the page
    let n = 0;
    const hint = $('#rs-drop');
    const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    root.ondragenter = e => { if (hasFiles(e)) { n++; hint.classList.add('show'); } };
    root.ondragleave = () => { if (--n <= 0) { n = 0; hint.classList.remove('show'); } };
    root.ondragover = e => { if (hasFiles(e)) e.preventDefault(); };
    root.ondrop = e => { if (!hasFiles(e)) return; e.preventDefault(); n = 0; hint.classList.remove('show'); addPhotos(Array.from(e.dataTransfer.files)); };

    async function addPhotos(files) {
      files = (files || []).filter(f => /^image\//.test(f.type));
      if (!files.length) return;
      toast(files.length > 1 ? `Adding ${files.length} photos…` : 'Adding your photo…', 8000);
      const added = [];
      for (const f of files) {
        try {
          const img = await prepPhoto(f, 1400, 600000);
          added.push({ id: await ctx.api.putImage({ data: img.data, w: img.w, h: img.h, topic: id }), w: img.w, h: img.h });
        } catch (err) { UI.oops(err); }
      }
      const c = ctx.topics().find(x => x.id === id) || t;
      c.photos = [...(c.photos || []), ...added];
      save({ photos: c.photos }, true);
      toast(added.length > 1 ? 'Photos added' : 'Photo added');
    }
    async function pastePhotos() {
      try {
        const files = [];
        for (const it of await navigator.clipboard.read()) {
          const type = it.types.find(x => x.startsWith('image/'));
          if (type) files.push(new File([await it.getType(type)], 'pasted', { type }));
        }
        if (!files.length) return toast('No photo copied yet.');
        addPhotos(files);
      } catch (err) { toast('Copy a photo first, then press Paste (or ⌘V in the notes).'); }
    }
  }
  function linksHtml(t) {
    const links = t.links || [];
    if (!links.length) return '<p class="hint">None yet.</p>';
    return links.map((l, i) => `<div class="rs-link"><a href="${esc(safe(l.url))}" target="_blank" rel="noopener">${esc(l.label || host(l.url))}<small>${esc(host(l.url))}</small></a><button class="mini" data-r="link-edit" data-i="${i}" title="Edit">${icon('dots')}</button></div>`).join('');
  }
  function linkSheet(t, i) {
    const l = i == null ? { url: '', label: '' } : t.links[i];
    const el = sheet(`<h2>${i == null ? 'Add a link' : 'Link'}</h2>
      <div class="field"><label for="rl-url">Web address</label><input class="input" id="rl-url" inputmode="url" value="${esc(l.url)}" placeholder="https://…" autofocus></div>
      <div class="field"><label for="rl-label">Name <small>(optional)</small></label><input class="input" id="rl-label" value="${esc(l.label)}" placeholder="Field-dressing guide, video…"></div>
      <div class="row ${i == null ? 'end' : 'between'}">${i == null ? '' : `<button class="btn quiet danger-text" id="rl-del">${icon('trash')} Remove</button>`}
        <span><button class="btn quiet" data-act="close">Cancel</button> <button class="btn" id="rl-save">Save</button></span></div>`, { cls: 'small' });
    el.addEventListener('click', e => {
      const links = [...(t.links || [])];
      if (e.target.closest('#rl-save')) {
        let url = $('#rl-url').value.trim();
        if (!url) return toast('Paste the web address first.');
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        const item = { url, label: $('#rl-label').value.trim() };
        if (i == null) links.push(item); else links[i] = item;
      } else if (e.target.closest('#rl-del')) links.splice(i, 1);
      else return;
      t.links = links;
      save({ links }, true);
      closeSheet(true);
      const box = $('#rs-links');
      if (box) box.innerHTML = linksHtml(t);
    });
  }
  function photoSheet(t, pid) {
    const ph = (t.photos || []).find(x => x.id === pid);
    if (!ph) return;
    const el = sheet(`<div class="pin-view"><img data-img="${ph.id}" alt=""></div>
      <div class="row between"><button class="btn quiet danger-text" id="rph-del">${icon('trash')} Delete photo</button><button class="btn" data-act="close">Done</button></div>`, { cls: 'wide' });
    fillImgs(el, T.ctx);
    $('#rph-del').onclick = async () => {
      if (!(await ask('Delete this photo?', '', 'Delete', { danger: true }))) return;
      t.photos = (t.photos || []).filter(x => x.id !== pid);
      T.ctx.api.deleteImage(pid);
      save({ photos: t.photos }, true);
      closeSheet(true);
      const b = $(`[data-ph="${pid}"]`);
      if (b) b.remove();
    };
  }

  function fillImgs(root, ctx) {
    $$('img[data-img]', root).forEach(img => {
      if (img.dataset.done === img.dataset.img) return;
      img.dataset.done = img.dataset.img;
      ctx.api.getImage(img.dataset.img).then(src => { if (src) { img.src = src; img.classList.add('loaded'); } });
    });
  }

  // Notes keep only simple formatting: paragraphs, bold, italic, underline, lists, line breaks.
  const KEEP = { B: 'b', STRONG: 'b', I: 'i', EM: 'i', U: 'u', UL: 'ul', OL: 'ol', LI: 'li', P: 'p', DIV: 'p', BR: 'br', H1: 'p', H2: 'p', H3: 'p', H4: 'p', BLOCKQUOTE: 'p' };
  function clean(html) {
    const src = document.createElement('div');
    src.innerHTML = String(html || '').replace(/<(script|style)[^]*?<\/\1>/gi, '');
    const out = document.createElement('div');
    (function walk(from, to) {
      for (const n of Array.from(from.childNodes)) {
        if (n.nodeType === 3) { to.appendChild(document.createTextNode(n.nodeValue)); continue; }
        if (n.nodeType !== 1) continue;
        const tag = KEEP[n.tagName];
        if (!tag) { walk(n, to); continue; }
        const el = document.createElement(tag);
        to.appendChild(el);
        if (tag !== 'br') walk(n, el);
      }
    })(src, out);
    return out.innerHTML;
  }

  // is the person typing on a topic page right now? (so it isn't redrawn under them)
  const busy = () => !!document.activeElement && !!document.activeElement.closest('.rs-topic') && document.activeElement.matches('input, [contenteditable]');

  return { inProject, busy, flush };
})();
