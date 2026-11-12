/* The writing page: every chapter of a project in one long scrolling page,
   like Google Docs. Also: the chapter list, formatting, scene breaks,
   highlights, margin notes, chapter notes, focus mode and saving.

   Chapter text is plain, tidy HTML: <p> paragraphs (justified like a book
   unless class "left", "center" or "right"), <strong> <em> <u>, <div class="scene" data-s="…"> scene breaks,
   <mark class="hl" data-c="y|p|g|b|v"> highlights and
   <span class="mn" data-n="id"> margin notes (the note text is kept in
   chapter.mnotes). Editor.clean() keeps it that way.

   On the Mac the chapters are shown as real 6×9 pages, like Google Docs: a
   short pause after typing, the text is measured and <span class="pgap">
   spacers are slipped in where each page ends, so the words hop over the gap
   to the next page. A paragraph that starts a new page gets the space as padding
   above it instead (data-pgap), so its first line keeps its indent. Spacers are
   never saved. On the iPhone it stays one long page. */

const Editor = (() => {
  const { $, $$, esc, icon, ls, dayKey, num, wordsIn, plural, toast, ask, sheet, closeSheet, popover, closePopover, sortable, narrow, numWord } = UI;

  const SCENES = [
    { id: 'fleuron', t: '❦' },
    { id: 'stars', t: '✦ ✦ ✦' },
    { id: 'asterism', t: '⁂' },
    { id: 'asterisks', t: '* * *' },
    { id: 'dots', t: '•  •  •' },
    { id: 'leaves', t: '☙ ❦ ❧' },
    { id: 'diamonds', t: '◇ ◆ ◇' },
    { id: 'line', t: '—— ✧ ——' },
    { id: 'moons', t: '☾ ✦ ☽' },
    { id: 'hearts', t: '♡ ♡ ♡' },
    { id: 'flower', t: '✿' },
    { id: 'tilde', t: '~ ⁕ ~' },
    // pictures (line art, tinted in the ink color by styles.css); t is the plain-text stand-in
    { id: 'arrow', t: '* * *', pic: true },
    { id: 'own', t: '* * *', pic: true }, // the project's own uploaded picture (project.sceneImg)
  ];
  const sceneOf = id => SCENES.find(s => s.id === id) || SCENES[0];
  // what a scene-break choice looks like on a button or in the chapter end mark
  const sceneTile = id => { const s = sceneOf(id); return s.pic ? `<span class="scene-pic" data-s="${s.id}"></span>` : esc(s.t); };
  // The project's own picture is shown through one CSS variable (--own-scene) on the page.
  let ownFor = null;
  function ownScene(project, api) {
    const id = (project && project.sceneImg) || '';
    if (id === ownFor) return;
    ownFor = id;
    const st = document.documentElement.style;
    if (!id) return st.removeProperty('--own-scene');
    (api || (P && P.ctx.api)).getImage(id).then(src => { if (ownFor === id && src) st.setProperty('--own-scene', `url("${src}")`); });
  }
  const HL = [
    { id: 'y', name: 'Yellow' }, { id: 'p', name: 'Pink' }, { id: 'g', name: 'Green' }, { id: 'b', name: 'Blue' }, { id: 'v', name: 'Purple' },
  ];
  const newId = () => Math.random().toString(36).slice(2, 10);

  // ---------- keeping chapter HTML tidy ----------
  const INLINE = { STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', U: 'u', BR: 'br' };
  function clean(html, opts = {}) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html || '';
    const out = document.createElement('div');
    let para = null;
    const block = align => {
      para = document.createElement('p');
      if (align) para.className = align;
      out.appendChild(para);
      return para;
    };
    const endBlock = () => { para = null; };
    const alignOf = el => {
      const t = (el.getAttribute && (el.getAttribute('style') || '') + ' ' + (el.getAttribute('align') || '') + ' ' + (el.className || '')) || '';
      if (/center/i.test(t)) return 'center';
      if (/right/i.test(t)) return 'right';
      // ragged-left / justify only from our own class (pasted "left" text follows the project)
      return el.classList && el.classList.contains('left') ? 'left' : el.classList && el.classList.contains('justify') ? 'justify' : '';
    };

    // Copy inline content (formatting kept, everything else unwrapped) into `into`.
    function inline(node, into) {
      for (const n of Array.from(node.childNodes)) {
        if (n.nodeType === 3) { into.appendChild(document.createTextNode(n.nodeValue.replace(/​/g, ''))); continue; }
        if (n.nodeType !== 1) continue;
        const tag = n.tagName;
        if (tag === 'BR') { into.appendChild(document.createElement('br')); continue; }
        if (/^(SCRIPT|STYLE|META|LINK|TITLE|IMG|SVG|VIDEO|AUDIO|IFRAME|OBJECT)$/.test(tag)) continue;
        let wrap = null;
        if (INLINE[tag] && tag !== 'BR') wrap = document.createElement(INLINE[tag]);
        else if (tag === 'MARK' && n.classList.contains('hl') && !opts.plain) { wrap = document.createElement('mark'); wrap.className = 'hl'; wrap.dataset.c = /^[ypgbv]$/.test(n.dataset.c) ? n.dataset.c : 'y'; }
        else if (tag === 'SPAN' && n.classList.contains('mn') && n.dataset.n && !opts.plain) { wrap = document.createElement('span'); wrap.className = n.classList.contains('free') ? 'mn free' : 'mn'; wrap.dataset.n = n.dataset.n; }
        else if (tag === 'SPAN' || tag === 'FONT' || tag === 'A' || tag === 'SUP' || tag === 'SUB' || tag === 'S' || tag === 'MARK') {
          // Google Docs pastes bold/italic as styled spans.
          const st = (n.getAttribute('style') || '').toLowerCase();
          let target = into;
          if (/font-weight:\s*(bold|[6-9]00)/.test(st)) { const s = document.createElement('strong'); target.appendChild(s); target = s; }
          if (/font-style:\s*italic/.test(st)) { const s = document.createElement('em'); target.appendChild(s); target = s; }
          if (/text-decoration[^;]*underline/.test(st) && tag !== 'A') { const s = document.createElement('u'); target.appendChild(s); target = s; }
          inline(n, target);
          continue;
        }
        if (wrap) { if (!wrap.classList.contains('free')) inline(n, wrap); if (wrap.childNodes.length || wrap.classList.contains('free')) into.appendChild(wrap); continue; }
        inline(n, into);
      }
    }
    const BLOCKS = /^(P|DIV|H1|H2|H3|H4|H5|H6|LI|BLOCKQUOTE|PRE|SECTION|ARTICLE|HEADER|FOOTER|TABLE|TR|TD|TH|UL|OL|FIGURE|HR)$/;
    function walk(node) {
      for (const n of Array.from(node.childNodes)) {
        if (n.nodeType === 3) {
          if (!n.nodeValue.trim() && !para) continue;
          (para || block('')).appendChild(document.createTextNode(n.nodeValue));
          continue;
        }
        if (n.nodeType !== 1) continue;
        const tag = n.tagName;
        if (tag === 'DIV' && n.classList.contains('scene')) {
          endBlock();
          const d = document.createElement('div');
          d.className = 'scene';
          const s = sceneOf(n.dataset.s);
          d.dataset.s = s.id;
          d.textContent = s.t;
          out.appendChild(d);
          continue;
        }
        if (tag === 'HR') { endBlock(); const d = document.createElement('div'); d.className = 'scene'; d.dataset.s = opts.scene || 'fleuron'; d.textContent = sceneOf(d.dataset.s).t; out.appendChild(d); continue; }
        if (BLOCKS.test(tag)) {
          const hasBlocks = Array.from(n.children).some(c => BLOCKS.test(c.tagName) || c.classList.contains('scene'));
          endBlock();
          if (hasBlocks) { walk(n); endBlock(); continue; }
          const p = block(alignOf(n));
          if (/^H[1-6]$/.test(tag)) { const s = document.createElement('strong'); p.appendChild(s); inline(n, s); }
          else inline(n, p);
          endBlock();
          continue;
        }
        inline({ childNodes: [n] }, para || block(''));
      }
    }
    walk(tpl.content);
    // Tidy each paragraph: no stray <br> at the end, empty ones become a single <br>.
    for (const p of $$('p', out)) {
      while (p.lastChild && p.lastChild.nodeName === 'BR' && p.childNodes.length > 1) p.removeChild(p.lastChild);
      if (!p.textContent.trim() && !p.querySelector('br')) {
        if (opts.dropEmpty) { p.remove(); continue; }
        p.innerHTML = '<br>';
      }
      if (opts.dropEmpty && !p.textContent.trim()) p.remove();
    }
    return out.innerHTML;
  }

  // Text of a chapter, for counting words (scene breaks don't count).
  const textOf = html => {
    const d = document.createElement('div');
    d.innerHTML = String(html || '').replace(/<br\s*\/?>/gi, ' ');
    $$('.scene', d).forEach(s => s.remove());
    // a space between paragraphs, so the last word of one and the first of the next aren't glued together
    return Array.from(d.childNodes).map(n => n.textContent).join(' ');
  };
  const countWords = html => wordsIn(textOf(html).replace(/<[^>]+>/g, ' '));

  // ---------- the open project ----------
  let P = null; // everything about the open project

  function open(root, project, ctx) {
    close();
    P = {
      root, ctx, project, pid: project.id,
      chapters: [], byId: {}, state: {}, // state[cid] = { dirty, timer, lastHtml }
      unsub: null, pending: false, current: null, totalT: null, notesOpen: false, focus: false,
      blur: !!Themes.norm(project.look).blurType, blurDefault: !!Themes.norm(project.look).blurType,
    };
    ownScene(project, ctx.api);
    root.innerHTML = shell(project);
    bind();
    P.unsub = ctx.api.watchChapters(project.id, gotChapters);
    ctx.api.saveProject(project.id, { openedAt: Date.now() });
    loadHistory();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('online', showSync);
    window.addEventListener('offline', showSync);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flushAll);
    document.addEventListener('keydown', onKey);
    document.addEventListener('selectionchange', onSelection);
    if (document.fonts) {
      document.fonts.ready.then(() => { if (P) { paginateAll(); layoutNotes(); } });
      // A font face can arrive later too (the italic or bold of the writing font loads the first time
      // italic or bold text shows). Its letters are a little wider than the stand-in's, so the lines
      // move: lay the pages out again, or text runs past the bottom of a page.
      document.fonts.addEventListener('loadingdone', onFontsDone);
    }
  }
  function onFontsDone() {
    if (!P) return;
    clearTimeout(P.fontT);
    P.fontT = setTimeout(() => { if (P) { paginateAll(); layoutNotes(); } }, 150);
  }

  function close() {
    if (!P) return;
    keepSpot(true);
    clearTimeout(P.spotT);
    Find.close();
    if (P.reading) Book.close(true);
    flushAll();
    saveTotals(true);
    if (P.unsub) P.unsub();
    clearTimeout(P.emptyT);
    clearTimeout(P.resizeT);
    clearTimeout(P.fontT);
    clearTimeout(P.pagesT);
    clearTimeout(P.countT);
    P.countRun = -1;
    if (document.fonts) document.fonts.removeEventListener('loadingdone', onFontsDone);
    Object.values(P.pageT || {}).forEach(clearTimeout);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('online', showSync);
    window.removeEventListener('offline', showSync);
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', flushAll);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('selectionchange', onSelection);
    document.body.classList.remove('focus-mode');
    closePopover();
    clearTimeout(blurRaf);
    closePlot();
    const bb = $('#blurbox');
    if (bb) bb.remove();
    P = null;
  }
  const isOpen = pid => !!P && P.pid === pid;

  // The project doc changed (title, look, kind...).
  function update(project) {
    if (!P) return;
    const size = JSON.stringify(P.project.pageSize || null);
    P.project = project;
    if (size !== JSON.stringify(project.pageSize || null)) setTimeout(paginateAll, 0);
    $('#p-title').textContent = project.title || 'Untitled';
    P.root.querySelector('.proj').classList.toggle('short', project.kind === 'short');
    P.root.querySelector('.proj').classList.toggle('no-extras', !Project.showsAll(project));
    // Appearance → "Blur my words as I type" changed: follow it
    const bd = !!Themes.norm(project.look).blurType;
    if (bd !== P.blurDefault) { P.blurDefault = bd; setBlur(bd); }
  }

  function shell(p) {
    const tb = (act, ic, label, cls = '') => `<button class="tb ${cls}" data-act="${act}" title="${label}" aria-label="${label}">${ic}</button>`;
    return `<div class="proj ${p.kind === 'short' ? 'short' : ''} ${Project.showsAll(p) ? '' : 'no-extras'} ${sideOff(p.id) ? 'side-off' : ''} ${P.blur ? 'blur-type' : ''}">
      <header class="ptop">
        <a class="back" href="#/shelf" title="Library" aria-label="Back to Library">${icon('back')}</a>
        <div class="ptitle"><span id="p-title">${esc(p.title || 'Untitled')}</span><span class="pstat"><span id="p-words"></span><span id="p-sync" class="sync"></span></span></div>
        ${P.ctx.tabs ? P.ctx.tabs(p, 'write') : ''}
        <div class="pbtns">
          <button class="pbtn only-narrow" data-act="chapters">${icon('list')}<span>Chapters</span></button>
          <button class="pbtn icon-only goal-btn" data-act="goal" title="Writing goal" aria-label="Writing goal">${icon('flame')}</button>
          <button class="pbtn icon-only" data-act="night" id="p-night" title="Night mode" aria-label="Night mode">${icon('moon')}</button>
          <button class="pbtn icon-only" data-act="menu" title="More" aria-label="More">${icon('dots')}</button>
        </div>
      </header>
      <div class="tools-bar" id="tools-bar"><div class="tools" id="tools">
        ${tb('undo', icon('undo'), 'Undo (⌘Z)')}${tb('redo', icon('redo'), 'Redo (⇧⌘Z)')}
        <span class="tsep"></span>
        ${tb('bold', '<b>B</b>', 'Bold (⌘B)')}${tb('italic', '<i>I</i>', 'Italic (⌘I)')}${tb('underline', '<u>U</u>', 'Underline (⌘U)')}
        <button class="tb" data-act="align" id="align-btn" title="Line alignment" aria-label="Line alignment">${icon('align-justify')}</button>
        <span class="tsep"></span>
        ${tb('scene', '<span class="scene-mini" id="scene-mini"></span>', 'Insert a scene break (change the design in Appearance — or click one break on the page to change just that one)')}
        ${tb('highlight', icon('marker'), 'Highlight')}
        ${tb('note', icon('note'), 'Margin note — select words to attach it to them, or just put the cursor on a line', 'hide-narrow')}
        <span class="tsep"></span>
        ${tb('find', icon('find'), 'Find and replace (⌘F)')}
        ${tb('lookup', icon('lookup'), 'Look up a word — meaning, similar, opposite, related')}
        ${tb('idea', icon('bulb'), 'Jot down an idea for this story')}
        ${tb('plot', icon('timeline'), 'Plot — your story’s events beside the page')}
        <span class="tsep"></span>
        ${tb('pages', icon('pages'), 'Pages — see it as a printed book')}
        ${tb('focus', icon('focus'), 'Focus mode', 'hide-narrow')}
        ${tb('blur', icon('blur'), 'Blur my words as I type — all but the line I’m on', P.blur ? 'on' : '')}
        <button class="tb read-btn" data-act="read" title="Read it as a book — real pages you turn" aria-label="Read as a book">${icon('read')}</button>
        ${tb('lockin', icon('hourglass'), 'Lock in — 30 minutes or an hour of just writing')}
      </div></div>
      <button class="focus-exit" data-act="focus">${icon('x')} Leave focus</button>
      <div class="pbody">
        <button class="side-show" data-act="side-show" title="Show the chapter list">${icon('list')}<span>Chapters</span></button>
        <aside class="side" id="side">
          <div class="side-head"><button class="side-title" data-act="side-hide" title="Hide the chapter list">${icon('list')}<span>Chapters</span></button><button class="mini" data-act="add-chapter" title="Add a chapter">${icon('plus')}</button></div>
          <ol class="chlist" id="chlist"></ol>
        </aside>
        <div class="desk">
          <div class="writing">
            <article class="paper" id="paper"><p class="loading">Opening…</p></article>
            <div class="margin" id="margin"><button class="madd" id="madd" data-act="madd" title="Add a note here" hidden>${icon('plus')}</button></div>
            <div class="mdots" id="mdots"></div>
          </div>
        </div>
      </div>
    </div>`;
  }

  // ---------- chapters arriving from the database ----------
  function gotChapters(list, meta) {
    if (!P) return;
    const first = !P.chapters.length && !P.loaded;
    P.loaded = true;
    P.pending = !!(meta && meta.pending);
    P.chapters = list;
    P.byId = Object.fromEntries(list.map(c => [c.id, c]));
    if (!list.length) {
      // Every project has at least one chapter. Wait a moment first: a Word
      // import swaps chapters out and in, and can look empty for an instant.
      clearTimeout(P.emptyT);
      P.emptyT = setTimeout(() => {
        if (P && !P.chapters.length) P.ctx.api.addChapters(P.pid, [{ title: P.project.kind === 'short' ? '' : 'Chapter One', order: 1 }]);
      }, 1500);
      return;
    }
    clearTimeout(P.emptyT);
    if (P.retitle && !P.pending) { P.retitle = false; retitle(); }
    renderPaper();
    renderList();
    renderWords();
    showSync();
    if (plotRedraw) plotRedraw();
    if (first) {
      sceneMini();
      setMode();
      countPhonePages(1500);
      setTimeout(() => {
        paginateAll();
        onScroll();
        alignTools();
        layoutNotes();
        if (P && !narrow() && P.chapters.length === 1 && !countWords(P.chapters[0].html)) {
          const b = $('.chap-body');
          if (b) placeCaret(b, false);
          P.spotReady = true;
        } else restoreSpot();
      }, 60);
    } else {
      (P.repage || []).forEach(paginate);
      P.repage = [];
      layoutNotes();
    }
  }

  function chapterSection(c) {
    const sec = document.createElement('section');
    sec.className = 'chap';
    sec.dataset.cid = c.id;
    sec.innerHTML = `<input class="chap-title" type="text" spellcheck="true" placeholder="${P.project.kind === 'short' ? 'Add a chapter title (optional)' : 'Chapter title'}" value="${esc(c.title || '')}">
      <div class="chap-body" contenteditable="true" spellcheck="true" autocapitalize="sentences"></div>
      <div class="chap-end"><span>${sceneTile(P.project.sceneBreak)}</span></div>
      <div class="pcards" aria-hidden="true"></div>`;
    fill(sec.querySelector('.chap-body'), c.html);
    P.state[c.id] = { dirty: false, lastHtml: c.html || '', titleDirty: false };
    return sec;
  }

  function fill(body, html) {
    body.innerHTML = html || '<p><br></p>';
    $$('.scene, .mn.free', body).forEach(s => { s.contentEditable = 'false'; });
  }

  function renderPaper() {
    const paper = $('#paper');
    if (!paper) return;
    const loading = paper.querySelector('.loading');
    if (loading) loading.remove();
    const have = Object.fromEntries($$('section.chap', paper).map(s => [s.dataset.cid, s]));
    let prev = null;
    for (const c of P.chapters) {
      let sec = have[c.id];
      if (!sec) { sec = chapterSection(c); (P.repage = P.repage || []).push(c.id); }
      else {
        delete have[c.id];
        const st = P.state[c.id];
        const body = sec.querySelector('.chap-body');
        // Changes from another device: only when I'm not typing in that chapter.
        if (!st.dirty && document.activeElement !== body && (c.html || '') !== st.lastHtml) {
          fill(body, c.html);
          st.lastHtml = c.html || '';
          (P.repage = P.repage || []).push(c.id);
        }
        const ti = sec.querySelector('.chap-title');
        if (!st.titleDirty && document.activeElement !== ti && ti.value !== (c.title || '')) ti.value = c.title || '';
      }
      const want = prev ? prev.nextSibling : paper.firstChild;
      if (want !== sec) paper.insertBefore(sec, want);
      prev = sec;
    }
    for (const sec of Object.values(have)) sec.remove();
    if (Object.keys(have).length) setTimeout(renumber, 0);
    let add = paper.querySelector('.paper-add');
    if (!add) {
      add = document.createElement('button');
      add.className = 'paper-add';
      add.dataset.act = 'add-chapter';
      add.innerHTML = `${icon('plus')} Add a chapter`;
    }
    if (paper.lastChild !== add) paper.appendChild(add);
  }

  function renderList() {
    const ol = $('#chlist');
    if (!ol) return;
    const nums = numbering();
    const html = P.chapters.map((c, i) => `<li class="chrow ${P.current === c.id ? 'on' : ''}" data-cid="${c.id}">
      ${chnHtml(c, nums[i])}<span class="cht">${esc(c.title || 'Untitled chapter')}</span><span class="chw">${num(c.words || 0)}</span>
      <button class="chnote ${(c.notes || '').trim() ? 'has' : ''}" data-cnote="${c.id}" data-nodrag title="Chapter notes" aria-label="Chapter notes">${icon('notes')}</button>
    </li>`).join('');
    // Rebuilt only when something besides the word counts changed (rebuilding the frosted list over
    // the photo after every save made it blink); new word counts just change those numbers.
    const shape = html.replace(/<span class="chw">[^<]*<\/span>/g, '');
    if (ol._shape !== shape) { ol.innerHTML = html; ol._shape = shape; return; }
    P.chapters.forEach(c => { const w = ol.querySelector(`.chrow[data-cid="${c.id}"] .chw`), t = num(c.words || 0); if (w && w.textContent !== t) w.textContent = t; });
  }

  function renderWords() {
    const total = P.chapters.reduce((a, c) => a + (c.words || 0), 0);
    const pages = P.pages != null ? P.pages : P.project.pages;
    $('#p-words').textContent = plural(total, 'word') + (pages ? ` · ${plural(pages, 'page')}` : '');
  }
  // Total pages = the writing view's pages on the Mac (the book's page size). The iPhone doesn't
  // show those pages, so it works the same number out quietly (Pages.layout, as the Mac's book view
  // does) and, until then, shows the last count saved with the project.
  function setPages(n) {
    if (!P || !n) return;
    P.pages = n;
    renderWords();
    clearTimeout(P.pagesT);
    if (n !== P.project.pages) P.pagesT = setTimeout(() => { if (!P) return; P.project.pages = n; P.ctx.api.saveProject(P.pid, { pages: n }); }, 3000);
  }
  function countPhonePages(wait) {
    if (!P || P.paged) return;
    clearTimeout(P.countT);
    P.countT = setTimeout(() => {
      if (!P || P.paged || P.reading) return;
      const me = P, run = (P.countRun || 0) + 1;
      P.countRun = run;
      const chapters = P.chapters.map(c => { const body = bodyOf(c.id); return { id: c.id, title: c.title || '', html: body ? clean(body.innerHTML) : (c.html || '') }; });
      const sz = Pages.sizeOf(P.project);
      let n = 0;
      Pages.layout(P.project, chapters, sz.W, sz.H, () => P === me && me.countRun === run, (page, done) => { if (page) n++; if (done && P === me) setPages(n); });
    }, wait);
  }

  function showSync() {
    const el = $('#p-sync');
    if (!el || !P) return;
    const dirty = Object.values(P.state).some(s => s.dirty || s.titleDirty);
    let t = 'Saved', cls = '';
    if (dirty) { t = 'Saving…'; cls = 'busy'; }
    else if (P.pending && !navigator.onLine) { t = 'Saved on this device · syncs when online'; cls = 'off'; }
    else if (P.pending) { t = 'Syncing…'; cls = 'busy'; }
    else if (!navigator.onLine) { t = 'Offline · saved on this device'; cls = 'off'; }
    el.textContent = t;
    el.className = 'sync ' + cls;
  }

  // ---------- real pages (Mac) ----------
  const GAP = 28; // space between pages, on screen
  const DPI = 96;
  function metrics() {
    const ps = P.project.pageSize && P.project.pageSize.w ? P.project.pageSize : { w: 6, h: 9 };
    const W = ps.w * DPI, H = ps.h * DPI, MT = 0.75 * DPI, MB = 0.8 * DPI, MS = 0.7 * DPI;
    return { W, H, MT, MB, MS, CW: W - 2 * MS };
  }
  function setMode() {
    if (!P) return;
    const proj = P.root.querySelector('.proj');
    const want = !narrow();
    if (!want) {
      proj.classList.remove('margin-on');
      if (P.paged) { $$('section.chap').forEach(sec => { unspace(sec.querySelector('.chap-body')); sec.style.minHeight = ''; sec.querySelector('.pcards').innerHTML = ''; }); }
      P.paged = false;
      proj.classList.remove('paged');
      requestAnimationFrame(alignTools);
      return;
    }
    const m = metrics();
    const desk = P.root.querySelector('.desk');
    const fs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fs-user')) || 1;
    const full = desk.clientWidth - 40;
    const start = desk.getBoundingClientRect().left + 20; // where the writing area begins
    // The page sits in the middle of the window. The chapter list floats over the left edge,
    // so the page only slides right when the window is too narrow for both.
    const sideOn = !P.focus && P.project.kind !== 'short' && !proj.classList.contains('side-off');
    const minLeft = sideOn ? Math.max(0, 236 + 24 - start) : 0;
    const z = Math.max(0.7, Math.min(1.25 * fs, (full - minLeft) / m.W));
    const pw = m.W * z;
    const vw = $('#view').getBoundingClientRect().right; // the window, minus the goal panel when it's open
    const left = Math.max(minLeft, Math.min(full - pw, (vw - pw) / 2 - start));
    proj.style.setProperty('--pleft', left + 'px');
    // note cards float to the right of the page when there's room for them
    const room = !P.focus && vw - (start + left + pw) >= 26 + 230 + 12;
    proj.classList.toggle('margin-on', room);
    const changed = !P.paged || Math.abs((P.z || 0) - z) > 0.005;
    P.paged = true;
    P.z = z;
    proj.classList.add('paged');
    const paper = proj;
    const v = { '--pz': z, '--pw': m.W * z + 'px', '--ph': m.H * z + 'px', '--pmt': m.MT * z + 'px', '--pms': m.MS * z + 'px', '--pgap': GAP + 'px', '--phead': 0.34 * m.CW * z + 'px', '--phead0': 0.06 * m.CW * z + 'px' };
    for (const k in v) paper.style.setProperty(k, v[k]);
    requestAnimationFrame(alignTools);
    return changed;
  }
  // The toolbar runs across the whole window; its buttons sit centered over the page.
  function alignTools() {
    if (!P) return;
    const t = $('#tools'), paper = $('#paper');
    if (!t || !paper) return;
    t.style.paddingLeft = t.style.paddingRight = '';
    if (narrow()) return;
    const r = paper.getBoundingClientRect(), bar = t.getBoundingClientRect();
    const shift = 2 * (r.left + r.width / 2 - bar.left) - bar.width;
    if (shift > 0) t.style.paddingLeft = shift + 'px'; else t.style.paddingRight = -shift + 'px';
  }
  function relayoutNow() {
    if (!P) return;
    const was = P.paged, z = P.z;
    setMode();
    if (P.paged && (!was || Math.abs(z - P.z) > 0.005)) paginateAll();
    alignTools();
    layoutNotes();
    if (P.blur) placeBlur();
  }
  function onResize() {
    clearTimeout(P.resizeT);
    P.resizeT = setTimeout(relayoutNow, 150);
  }
  function schedulePage(cid) {
    if (!P.paged) return;
    P.pageT = P.pageT || {};
    clearTimeout(P.pageT[cid]);
    P.pageT[cid] = setTimeout(() => { paginate(cid); layoutNotes(); }, 350);
  }
  function paginateAll() { if (P && P.paged) { setMode(); P.chapters.forEach(c => paginate(c.id, true)); renumber(); } }

  function unspace(body) {
    for (const sp of $$('.pgap', body)) { const par = sp.parentNode; sp.remove(); par.normalize(); }
    for (const b of $$('[data-pgap]', body)) { b.style.paddingTop = ''; delete b.dataset.pgap; if (!b.getAttribute('style')) b.removeAttribute('style'); }
  }
  // text nodes of a paragraph with where each one starts
  function textMap(el) {
    const out = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n, at = 0;
    while ((n = w.nextNode())) { out.push({ n, at }); at += n.nodeValue.length; }
    return { list: out, len: at };
  }
  function nodeAt(map, i, preferNext) {
    for (let k = 0; k < map.list.length; k++) {
      const { n, at } = map.list[k];
      const end = at + n.nodeValue.length;
      if (i < end || (i === end && (!preferNext || k === map.list.length - 1))) return [n, i - at];
    }
    return null;
  }
  function charRect(map, i) {
    const [n, o] = nodeAt(map, i, true);
    const r = document.createRange();
    r.setStart(n, o);
    r.setEnd(n, Math.min(o + 1, n.nodeValue.length));
    const rs = r.getClientRects();
    return rs.length ? rs[rs.length - 1] : r.getBoundingClientRect();
  }
  // The first line that runs past `limit` (px from the top of the chapter).
  function lineBelow(body, limit, base) {
    for (const b of body.children) {
      const r = b.getBoundingClientRect();
      if (r.bottom - base <= limit + 0.5) continue;
      const map = textMap(b);
      if (b.classList.contains('scene') || !map.len || r.top - base >= limit - 0.5) return { b, off: 0, top: r.top - base };
      let lo = 0, hi = map.len - 1, hit = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (charRect(map, mid).bottom - base > limit + 0.5) { hit = mid; hi = mid - 1; } else lo = mid + 1;
      }
      if (hit < 0) continue;
      const lineTop = charRect(map, hit).top - base;
      lo = 0; hi = hit;
      let start = hit;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (charRect(map, mid).top - base >= lineTop - 1) { start = mid; hi = mid - 1; } else lo = mid + 1;
      }
      return { b, off: start, top: start === 0 ? r.top - base : lineTop, map };
    }
    return null;
  }
  function spacer(at, h) {
    // a paragraph starting the page: space above it, not a spacer inside it (inside, the spacer would be
    // its "first line" and the real first line would lose its indent)
    if (!at.off && at.b.tagName === 'P') { at.b.style.paddingTop = Math.max(0, h) + 'px'; at.b.dataset.pgap = '1'; return; }
    const sp = document.createElement('span');
    sp.className = 'pgap';
    sp.contentEditable = 'false';
    sp.style.height = Math.max(0, h) + 'px';
    if (!at.off) { at.b.insertBefore(sp, at.b.firstChild); return; }
    let [n, o] = nodeAt(at.map, at.off, true);
    if (o > 0) n = n.splitText(o);
    n.parentNode.insertBefore(sp, n);
  }
  // cursor as (paragraph number, letters in), so it survives the spacers moving
  function spot(body, node, off) {
    if (!body.contains(node)) return null;
    let blk = node === body ? body.children[Math.min(off, body.children.length - 1)] : node;
    while (blk && blk.parentNode !== body) blk = blk.parentNode;
    if (!blk) return null;
    const r = document.createRange();
    r.selectNodeContents(blk);
    if (node !== body) r.setEnd(node, off);
    else r.collapse(off <= Array.prototype.indexOf.call(body.children, blk));
    return { i: Array.prototype.indexOf.call(body.children, blk), c: r.toString().length };
  }
  function place(body, s) {
    const blk = body.children[s.i];
    if (!blk) return null;
    const map = textMap(blk);
    const at = map.len ? nodeAt(map, Math.min(s.c, map.len), true) : null;
    return at || [blk, 0];
  }
  // Are the page breaks already where they belong? Then the text is left alone: rebuilding them after
  // every pause meant rebuilding the text under the cursor, and now and then (with Safari's autocorrect
  // working at the same moment) the cursor landed somewhere else on the page.
  // Each page must end with a spacer before a line that starts exactly at the next page's top margin, and
  // that line mustn't fit back on the page it was pushed off.
  function breaksOk(sec, body, H, G, top, bot) {
    const sps = $$('.pgap, [data-pgap]', body);
    for (let k = 0; k <= sps.length; k++) {
      const base = sec.getBoundingClientRect().top;
      const limit = k * (H + G) + H - bot;
      const at = lineBelow(body, limit, base);
      if (!at) return k === sps.length;
      if (k === sps.length) return false;
      const sp = sps[k];
      // where the pushed line really starts (past the space above a paragraph, or past a spacer at its start)
      let start = at.top;
      if (!at.off) {
        if (at.b !== sp && !at.b.contains(sp)) return false;
        start += at.b === sp ? parseFloat(sp.style.paddingTop) || 0 : sp.getBoundingClientRect().height;
      } else if (!at.b.contains(sp)) return false;
      if (Math.abs(start - ((k + 1) * (H + G) + top)) > 1.5) return false;
      const lh = parseFloat(getComputedStyle(at.b).lineHeight) || 20;
      if (sp.getBoundingClientRect().top - base + lh <= limit + 0.5) return false;
    }
    return false;
  }
  function paginate(cid, quiet) {
    if (!P || !P.paged) return;
    const sec = $(`section.chap[data-cid="${cid}"]`);
    if (!sec) return;
    const body = sec.querySelector('.chap-body');
    const m = metrics(), z = P.z;
    const H = m.H * z, G = GAP, top = m.MT * z, bot = m.MB * z;
    if (sec.querySelector('.pcards').children.length && breaksOk(sec, body, H, G, top, bot)) {
      if (!quiet) renumber();
      if (P.blur) placeBlur();
      return;
    }
    // remember the cursor
    const sel = window.getSelection();
    let keep = null;
    if (sel.rangeCount && body.contains(sel.anchorNode)) {
      const r = sel.getRangeAt(0);
      keep = { a: spot(body, r.startContainer, r.startOffset), b: spot(body, r.endContainer, r.endOffset) };
    }
    unspace(body);
    let k = 0;
    for (; k < 3000; k++) {
      // measured again for every page: adding a spacer can make the browser nudge the scroll
      // (to keep what's on screen steady), and an old measurement would put the next cut in the wrong place
      const base = sec.getBoundingClientRect().top;
      const limit = k * (H + G) + H - bot;
      const at = lineBelow(body, limit, base);
      if (!at) break;
      spacer(at, (k + 1) * (H + G) + top - at.top);
    }
    const pages = k + 1;
    sec.style.minHeight = pages * H + (pages - 1) * G + 'px';
    const box = sec.querySelector('.pcards');
    while (box.children.length < pages) { const c = document.createElement('div'); c.className = 'pcard'; c.innerHTML = '<span class="pnum"></span>'; box.appendChild(c); }
    while (box.children.length > pages) box.lastChild.remove();
    Array.from(box.children).forEach((c, i) => { c.style.top = i * (H + G) + 'px'; c.classList.toggle('first', i === 0); });
    // put the cursor back only if it moved (the browser usually keeps it in place on its own)
    const now = sel.rangeCount && body.contains(sel.anchorNode) ? sel.getRangeAt(0) : null;
    const same = (x, y) => x && y && x.i === y.i && x.c === y.c;
    const moved = !now || !same(spot(body, now.startContainer, now.startOffset), keep && keep.a) || !same(spot(body, now.endContainer, now.endOffset), keep && keep.b);
    if (keep && keep.a && keep.b && moved) {
      const a = place(body, keep.a), b = place(body, keep.b);
      if (a && b) {
        const r = document.createRange();
        try { r.setStart(a[0], a[1]); r.setEnd(b[0], b[1]); sel.removeAllRanges(); sel.addRange(r); } catch (e) {}
      }
    }
    if (!quiet) renumber();
    if (P.blur) placeBlur();
  }
  function renumber() {
    let n = 1;
    $$('#paper .pcard .pnum').forEach(s => { const t = String(n++); if (s.textContent !== t) s.textContent = t; });
    if (P && P.paged) setPages(n - 1);
  }

  // ---------- saving ----------
  function bodyOf(cid) { return $(`section.chap[data-cid="${cid}"] .chap-body`); }
  function markDirty(cid) {
    const st = P.state[cid];
    if (!st) return;
    st.dirty = true;
    clearTimeout(st.timer);
    st.timer = setTimeout(() => flush(cid), 800);
    schedulePage(cid);
    showSync();
  }
  function flush(cid) {
    if (!P) return;
    const st = P.state[cid];
    const body = bodyOf(cid);
    if (!st || !body) return;
    clearTimeout(st.timer);
    if (st.titleDirty) {
      const inp = $(`section.chap[data-cid="${cid}"] .chap-title`);
      let title = inp.value.trim();
      // a book chapter's title cleared (and left): its automatic one comes back
      if (!title && P.project.kind !== 'short' && document.activeElement !== inp && P.byId[cid]) { title = autoTitle(P.byId[cid]); inp.value = title; }
      st.titleDirty = false;
      P.ctx.api.saveChapter(cid, { title });
      if (P.byId[cid]) P.byId[cid].title = title;
      renderList();
    }
    if (!st.dirty) { showSync(); return; }
    st.dirty = false;
    P.wrote = true;
    if (P.ctx.wroteToday) P.ctx.wroteToday(); // a writing day, for the goal
    const html = clean(body.innerHTML);
    const words = countWords(html);
    const c = P.byId[cid] || {};
    // the first change of the day: keep how the chapter looked before it (chapter history)
    if (c.id && c.html && c.html !== html) firstOfDay(c, c.html);
    // Keep only the margin notes whose words are still there.
    const mnotes = { ...(c.mnotes || {}) };
    const live = new Set($$('span.mn', body).map(s => s.dataset.n));
    for (const k of Object.keys(mnotes)) if (!live.has(k)) delete mnotes[k];
    st.lastHtml = html;
    c.html = html; c.words = words; c.mnotes = mnotes;
    P.ctx.api.saveChapter(cid, { html, words, mnotes });
    renderWords();
    countPhonePages(4000);
    const row = $(`.chrow[data-cid="${cid}"] .chw`);
    if (row) row.textContent = num(words);
    saveTotals();
    showSync();
  }
  function flushAll() { if (P) Object.keys(P.state).forEach(flush); }
  function saveTotals(now) {
    if (!P) return;
    clearTimeout(P.totalT);
    const go = () => {
      if (!P) return;
      const words = P.chapters.reduce((a, c) => a + (c.words || 0), 0);
      // updatedAt = last written in (opening a project sets openedAt instead)
      // (a locked project's real count isn't saved -- it stays hidden)
      const prev = P.project.locked ? P.lastWords : P.project.words;
      if (words !== prev || (now && P.wrote)) P.ctx.api.saveProject(P.pid, { words, updatedAt: Date.now() });
      P.lastWords = words;
      P.wrote = false;
      P.project.words = words;
    };
    if (now) go(); else P.totalT = setTimeout(go, 4000);
  }
  function onHide() { if (document.visibilityState === 'hidden') { flushAll(); saveTotals(true); keepSpot(true); } }

  // ---------- events ----------
  function bind() {
    const root = P.root;
    root.addEventListener('input', e => {
      const sec = e.target.closest('section.chap');
      if (!sec) return;
      // Return copies the paragraph -- including the page-top space (data-pgap) of one that starts a page.
      // Only the first of the two keeps it; taken off the copy right away, before it's drawn.
      if (e.inputType === 'insertParagraph') {
        for (const b of $$('.chap-body > [data-pgap]', sec)) {
          const prev = b.previousElementSibling;
          if (prev && prev.dataset.pgap) { b.style.paddingTop = ''; delete b.dataset.pgap; if (!b.getAttribute('style')) b.removeAttribute('style'); }
        }
      }
      if (e.target.classList.contains('chap-title')) { P.state[sec.dataset.cid].titleDirty = true; markDirty(sec.dataset.cid); return; }
      markDirty(sec.dataset.cid);
      schedulePage(sec.dataset.cid);
      Find.refresh();
      if (P.blur) placeBlur();
      clearTimeout(P.noteT);
      P.noteT = setTimeout(layoutNotes, 250);
    });
    root.addEventListener('keydown', onEditKey);
    root.addEventListener('paste', onPaste);
    root.addEventListener('focusout', e => {
      const t = e.target;
      if (t.classList && t.classList.contains('chap-title') && !t.value.trim() && P.project.kind !== 'short') {
        const c = P.byId[t.closest('section.chap').dataset.cid];
        if (c) { t.value = autoTitle(c); P.state[c.id].titleDirty = true; }
      }
      const sec = e.target.closest && e.target.closest('section.chap');
      if (sec) flush(sec.dataset.cid);
    });
    // keep the text selected while pressing toolbar buttons
    $('#tools').addEventListener('mousedown', e => { if (e.target.closest('.tb')) e.preventDefault(); });
    root.addEventListener('click', onClick);
    root.addEventListener('mousemove', onHoverMargin);
    sortable($('#chlist'), '.chrow', {
      key: el => el.dataset.cid,
      onDrop: ids => {
        flushAll();
        const list = ids.map((id, i) => ({ id, order: i + 1 }));
        list.forEach(x => { if (P.byId[x.id]) P.byId[x.id].order = x.order; });
        P.chapters.sort((a, b) => a.order - b.order);
        renderPaper();
        renderList();
        P.ctx.api.orderChapters(list);
        retitle();
      },
    });
  }

  function onClick(e) {
    const a = e.target.closest('[data-act]');
    const cn = e.target.closest('[data-cnote]');
    if (cn) return chapterNotes(cn.dataset.cnote);
    const num = e.target.closest('#chlist .chn');
    if (num && !a) return specialPop(num, num.closest('.chrow').dataset.cid);
    const row = e.target.closest('.chrow');
    if (row && !a) { jumpTo(row.dataset.cid); if (narrow()) closeSheet(); return; }
    const scene = e.target.closest('.chap-body .scene');
    if (scene && !a) return scenePop(scene);
    const mn = e.target.closest('.chap-body span.mn');
    if (mn && !a && !narrow()) { if (!$('#margin').offsetParent) return editNote(mn.dataset.n); focusCard(mn.dataset.n); }
    const card = e.target.closest('.mcard, .mdot');
    if (card) return editNote(card.dataset.n);
    if (e.target.closest('#madd') && P.hoverAt) { const at = P.hoverAt; $('#madd').hidden = true; return freeNote(at.body, at.range); }
    if (!a) return;
    const act = a.dataset.act;
    const fmt = { bold: 'bold', italic: 'italic', underline: 'underline', undo: 'undo', redo: 'redo' };
    if (fmt[act]) { document.execCommand(fmt[act]); showStyles(); return; }
    if (act === 'align') return alignPop(a);
    if (act === 'scene') return pickScene(a);
    if (act === 'highlight') return pickHighlight(a);
    if (act === 'note') return narrow() ? null : addNote();
    if (act === 'read') return setReading(!P.reading);
    if (act === 'add-chapter') return addChapter();
    if (act === 'side-hide' || act === 'side-show') return sideList(act === 'side-show');
    if (act === 'chapters') return chaptersSheet();
    if (act === 'focus') return toggleFocus();
    if (act === 'lookup') return lookupWord();
    if (act === 'find') return Find.isOpen() ? Find.close() : Find.open();
    if (act === 'idea') { flushAll(); return Project.quickIdea(P.ctx, P.project, P.chapters, P.current); }
    if (act === 'lockin') return Lockin.menu(a);
    if (act === 'pages') return openPages();
    if (act === 'night') return P.ctx.toggleNight();
    if (act === 'menu') return P.ctx.projectMenu(P.project);
    if (act === 'blur') return setBlur(!P.blur);
    if (act === 'plot') return plotPanel();
  }

  function onKey(e) {
    if (!P) return;
    if (e.key === 'Escape' && P.focus && !P.locked && !UI.sheetOpen()) toggleFocus();
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); flushAll(); toast('Saved'); }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'f' && !UI.sheetOpen()) { e.preventDefault(); Find.open(); }
    // ⌘B / ⌘I / ⌘U in the writing: done here, so Safari doesn't take them for its menus (⌘I = Email This Page)
    const style = { b: 'bold', i: 'italic', u: 'underline' }[(e.key || '').toLowerCase()];
    if (style && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.target.closest && e.target.closest('.chap-body[contenteditable="true"]')) {
      e.preventDefault();
      document.execCommand(style);
      showStyles();
    }
  }
  // B / I / U light up when the cursor or selection is in bold / italic / underlined text
  function showStyles() {
    const sel = window.getSelection();
    const n = sel.rangeCount && sel.anchorNode;
    const inText = !!(n && (n.nodeType === 1 ? n : n.parentNode).closest && (n.nodeType === 1 ? n : n.parentNode).closest('.chap-body[contenteditable="true"]'));
    ['bold', 'italic', 'underline'].forEach(k => {
      const b = $(`.tb[data-act="${k}"]`);
      if (!b) return;
      let on = false;
      try { on = inText && document.queryCommandState(k); } catch (e) {}
      if (b.classList.contains('on') !== on) { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    });
  }

  // "***" (or # or ~~~) on its own line + Enter = a scene break.
  function onEditKey(e) {
    const body = e.target.closest && e.target.closest('.chap-body');
    if (!body) {
      if (e.target.classList && e.target.classList.contains('chap-title') && e.key === 'Enter') {
        e.preventDefault();
        const b = e.target.closest('section.chap').querySelector('.chap-body');
        placeCaret(b, false);
      }
      return;
    }
    if (e.key !== 'Enter' || e.shiftKey) return;
    const blk = blockAtCaret(body);
    if (!blk || blk.classList.contains('scene')) return;
    const t = blk.textContent.trim();
    if (/^(\*\s*){3,}$|^#$|^~{3,}$/.test(t)) {
      e.preventDefault();
      const d = sceneEl(P.project.sceneBreak);
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      blk.replaceWith(d);
      d.after(p);
      placeCaret(p, false);
      markDirty(body.closest('section.chap').dataset.cid);
    }
  }

  function onPaste(e) {
    const body = e.target.closest && e.target.closest('.chap-body');
    if (!body) return;
    e.preventDefault();
    const cd = e.clipboardData;
    let html = cd.getData('text/html');
    if (html) html = clean(html, { scene: P.project.sceneBreak });
    else {
      const text = cd.getData('text/plain') || '';
      const parts = text.replace(/\r/g, '').split(/\n/);
      html = parts.length === 1 ? esc(parts[0]) : parts.map(l => `<p>${l.trim() ? esc(l) : '<br>'}</p>`).join('');
    }
    // One plain line goes in where the cursor is; anything with paragraphs goes in as paragraphs.
    if (/^<p>[^]*<\/p>$/.test(html) && (html.match(/<p>/g) || []).length === 1) html = html.slice(3, -4);
    document.execCommand('insertHTML', false, html);
  }

  function onSelection() {
    // which chapter has the cursor, for chapter notes
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    // Look up is for one word only: greyed out when more is selected
    const lb = $('.tb[data-act="lookup"]');
    if (lb && P) { const t = sel.isCollapsed ? '' : sel.toString(); lb.disabled = !!t.trim() && !Lookup.isWord(t); }
    if (P) showStyles();
    if (P && P.blur) placeBlur();
    const n = sel.anchorNode;
    const sec = n && (n.nodeType === 1 ? n : n.parentNode).closest && (n.nodeType === 1 ? n : n.parentNode).closest('section.chap');
    if (sec && P && sec.dataset.cid !== P.current) setCurrent(sec.dataset.cid);
    if (sec && P) showAlign();
    if (sec && P) keepSpot();
  }

  // ---------- where am I ----------
  const TOP_OFFSET = () => ($('#tools') ? $('#tools').getBoundingClientRect().bottom + 24 : 140);
  function onScroll() {
    if (!P) return;
    const y = TOP_OFFSET();
    let cur = null;
    for (const sec of $$('section.chap')) {
      const r = sec.getBoundingClientRect();
      if (r.top <= y + 40) cur = sec.dataset.cid;
      else break;
    }
    if (!cur && P.chapters[0]) cur = P.chapters[0].id;
    if (cur !== P.current) setCurrent(cur);
    keepSpot();
  }

  // ---------- where she was writing (project.writeAt, synced like the book view's readAt) ----------
  // { cid, block, offset } = the top of the screen; caret: { cid, i, c } = the cursor, if it's in a chapter.
  // Saved a moment after scrolling or moving the cursor; on opening, the writing view goes back there.
  function spotNow() {
    const top = position();
    if (!top) return null;
    let caret = null;
    const sel = window.getSelection();
    const n = sel.rangeCount && sel.anchorNode;
    const sec = n && (n.nodeType === 1 ? n : n.parentNode).closest('section.chap');
    if (sec) { const sp = spot(sec.querySelector('.chap-body'), n, sel.anchorOffset); if (sp) caret = { cid: sec.dataset.cid, ...sp }; }
    return { ...top, caret };
  }
  function keepSpot(now) {
    if (!P || !P.spotReady || P.reading) return;
    clearTimeout(P.spotT);
    const save = () => {
      if (!P || P.reading) return;
      const at = spotNow();
      if (!at || JSON.stringify(at) === JSON.stringify(P.project.writeAt || null)) return;
      P.project.writeAt = at;
      P.ctx.api.saveProject(P.pid, { writeAt: at });
    };
    if (now) save(); else P.spotT = setTimeout(save, 1200);
  }
  function restoreSpot() {
    const at = P && P.project.writeAt;
    const go = () => {
      if (!P || !at || !$(`section.chap[data-cid="${at.cid}"]`)) return;
      goTo(at, true);
      setCurrent(at.cid);
      const c = at.caret;
      const body = c && bodyOf(c.cid);
      if (c && body && !narrow()) {
        const where = place(body, c);
        if (where) {
          const r = document.createRange();
          try { r.setStart(where[0], where[1]); r.collapse(true); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); } catch (e) {}
        }
      }
    };
    go();
    // once the late fonts have settled the pages, go there again; then start keeping the spot
    setTimeout(() => { if (!P) return; if (!P.spotReady) go(); P.spotReady = true; }, 900);
  }
  function setCurrent(cid) {
    P.current = cid;
    $$('.chrow').forEach(r => r.classList.toggle('on', r.dataset.cid === cid));
  }
  function jumpTo(cid) {
    const sec = $(`section.chap[data-cid="${cid}"]`);
    if (!sec) return;
    window.scrollTo({ top: sec.getBoundingClientRect().top + window.scrollY - TOP_OFFSET() + 10, behavior: 'smooth' });
    setCurrent(cid);
  }

  function blockAtCaret(body) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    let n = sel.getRangeAt(0).startContainer;
    if (n === body) n = body.childNodes[sel.getRangeAt(0).startOffset] || body.lastChild;
    while (n && n.parentNode !== body) n = n.parentNode;
    return n && n.nodeType === 1 ? n : null;
  }
  function placeCaret(el, atEnd) {
    el.focus && el.closest('[contenteditable]') && el.closest('[contenteditable]').focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(!atEnd);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }
  function activeBody() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const n = sel.anchorNode;
    const el = n && (n.nodeType === 1 ? n : n.parentNode);
    return el && el.closest ? el.closest('.chap-body') : null;
  }
  function needBody() {
    const b = activeBody();
    if (!b) toast('Tap into your writing first.');
    return b;
  }

  // ---------- formatting ----------
  // no class = the project's alignment (Appearance → Paragraphs: justified, the normal book look, or left);
  // a paragraph set differently keeps a class (left / center / right / justify)
  const ALIGNS = [{ id: 'left', name: 'Left' }, { id: 'center', name: 'Center' }, { id: 'right', name: 'Right' }, { id: 'justify', name: 'Justify (normal book text)' }];
  const projAlign = () => (P && Themes.norm(P.project.look).align === 'left' ? 'left' : 'justify');
  const alignNow = b => (!b ? projAlign() : ['left', 'center', 'right', 'justify'].find(k => b.classList.contains(k)) || projAlign());
  function alignPop(btn) {
    const body = activeBody();
    if (!body) return toast('Tap into your writing first.');
    const cur = alignNow(blockAtCaret(body));
    popover(btn, `<div class="align-row">${ALIGNS.map(a => `<button class="tb ${a.id === cur ? 'on' : ''}" data-pick="${a.id}" title="${a.name}" aria-label="${a.name}">${icon('align-' + a.id)}</button>`).join('')}</div>`, setAlign);
  }
  function setAlign(kind) {
    const body = needBody();
    if (!body) return;
    const r = window.getSelection().getRangeAt(0);
    const blocks = Array.from(body.children).filter(b => !b.classList.contains('scene') && r.intersectsNode(b));
    if (!blocks.length) return;
    blocks.forEach(b => { b.classList.remove('left', 'center', 'right', 'justify'); if (kind !== projAlign()) b.classList.add(kind); b.style.textAlign = ''; if (!b.className) b.removeAttribute('class'); });
    markDirty(body.closest('section.chap').dataset.cid);
    showAlign();
  }
  // the alignment button shows the line the cursor is on
  function showAlign() {
    const btn = $('#align-btn');
    const body = activeBody();
    if (!btn || !body) return;
    const k = alignNow(blockAtCaret(body));
    if (btn.dataset.k !== k) { btn.dataset.k = k; btn.innerHTML = icon('align-' + k); }
  }

  function sceneEl(id) {
    const d = document.createElement('div');
    const s = sceneOf(id);
    d.className = 'scene';
    d.dataset.s = s.id;
    d.contentEditable = 'false';
    d.textContent = s.t;
    return d;
  }
  function sceneMini() { const m = $('#scene-mini'); if (m && P) m.innerHTML = sceneTile(P.project.sceneBreak); }
  function insertScene(id) {
    const body = needBody();
    if (!body) return;
    const blk = blockAtCaret(body);
    const d = sceneEl(id);
    const p = document.createElement('p');
    p.innerHTML = '<br>';
    if (blk && !blk.textContent.trim() && blk.tagName !== 'DIV') { blk.replaceWith(d); }
    else if (blk) {
      // split the paragraph at the cursor
      const sel = window.getSelection();
      const r = sel.getRangeAt(0);
      const after = document.createRange();
      after.setStart(r.endContainer, r.endOffset);
      after.setEndAfter(blk.lastChild || blk);
      const rest = after.extractContents();
      blk.after(d);
      if (rest.textContent.trim()) { p.innerHTML = ''; p.appendChild(rest); if (p.firstChild && p.firstChild.nodeName === 'P') p.innerHTML = p.firstChild.innerHTML; }
      if (!blk.textContent.trim() && !blk.querySelector('br')) blk.innerHTML = '<br>';
    } else body.appendChild(d);
    d.after(p);
    placeCaret(p, false);
    markDirty(body.closest('section.chap').dataset.cid);
  }
  // usualFirst: the project's usual design goes first (the insert menu)
  const sceneGrid = (cur, usualFirst) => {
    const all = SCENES.filter(s => s.id !== 'own' || (P && P.project.sceneImg));
    const list = usualFirst ? [sceneOf(cur), ...all.filter(s => s.id !== sceneOf(cur).id)] : all;
    return `<div class="scene-grid">${list.map(s => `<button class="scene-opt ${s.id === cur ? 'on' : ''}" data-pick="${s.id}"><span>${sceneTile(s.id)}</span></button>`).join('')}</div>`;
  };
  // The toolbar button puts in the book's design (Appearance → Scene breaks) right away.
  // To use a different one in a single spot, click that break on the page.
  function pickScene() {
    if (!activeBody()) return toast('Tap into your writing where the break should go.');
    insertScene(P.project.sceneBreak);
  }
  function scenePop(el) {
    const body = el.closest('.chap-body');
    const cid = body.closest('section.chap').dataset.cid;
    popover(el, `<div class="pop-title">Change this scene break</div>${sceneGrid(el.dataset.s)}<button class="pop-item danger" data-pick="remove">${icon('trash')} Remove it</button>`, id => {
      if (id === 'remove') el.remove();
      else { const s = sceneOf(id); el.dataset.s = s.id; el.textContent = s.t; }
      markDirty(cid);
    });
  }

  // Wrap the selected words in an element, using the browser's own highlight
  // command (it splits nicely across bold/italic) with a marker color.
  const MARK = 'rgb(1, 2, 3)';
  function wrapSelection(make) {
    const body = activeBody();
    const sel = window.getSelection();
    if (!body || !sel.rangeCount || sel.isCollapsed) return null;
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('hiliteColor', false, MARK);
    document.execCommand('styleWithCSS', false, false);
    const made = [];
    for (const el of $$('[style]', body)) {
      if (el.style.backgroundColor.replace(/\s/g, '') !== MARK.replace(/\s/g, '')) continue;
      el.style.backgroundColor = '';
      const w = make();
      while (el.firstChild) w.appendChild(el.firstChild);
      el.replaceWith(w);
      made.push(w);
    }
    // no leftover empty style attributes
    $$('[style=""]', body).forEach(el => el.removeAttribute('style'));
    return made.length ? { body, made } : null;
  }
  const unwrap = el => { const p = el.parentNode; if (!p) return; while (el.firstChild) p.insertBefore(el.firstChild, el); el.remove(); p.normalize(); };

  function pickHighlight(btn) {
    const body = activeBody();
    if (!body) return toast('Select some words first.');
    popover(btn, `<div class="pop-title">Highlight</div><div class="hl-row">${HL.map(h => `<button class="hl-dot" data-pick="${h.id}" title="${h.name}"><mark class="hl" data-c="${h.id}">Aa</mark></button>`).join('')}</div>
      <button class="pop-item" data-pick="none">${icon('eraser')} Remove highlight</button>`, c => {
      const cid = body.closest('section.chap').dataset.cid;
      if (c === 'none') return removeHighlight(body, cid);
      if (window.getSelection().isCollapsed) return toast('Select some words first.');
      const got = wrapSelection(() => { const m = document.createElement('mark'); m.className = 'hl'; m.dataset.c = c; return m; });
      if (got) {
        // no highlight inside a highlight
        got.made.forEach(m => $$('mark.hl', m).forEach(unwrap));
        window.getSelection().collapseToEnd();
        markDirty(cid);
      }
    });
  }
  function removeHighlight(body, cid) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    const hits = $$('mark.hl', body).filter(m => r.intersectsNode(m));
    const n = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode;
    const inside = n.closest && n.closest('mark.hl');
    if (inside && !hits.includes(inside)) hits.push(inside);
    if (!hits.length) return toast('Put the cursor on a highlight first.');
    hits.forEach(unwrap);
    markDirty(cid);
  }

  // ---------- margin notes ----------
  function addNote() {
    const body = activeBody();
    if (!body) return toast('Put the cursor on a line (or select some words) first.');
    const sel = window.getSelection();
    if (sel.isCollapsed) return freeNote(body, sel.getRangeAt(0));
    const id = newId();
    const got = wrapSelection(() => { const s = document.createElement('span'); s.className = 'mn'; s.dataset.n = id; return s; });
    if (!got) return;
    // a note can't sit inside another note
    got.made.forEach(s => $$('span.mn', s).forEach(unwrap));
    const cid = body.closest('section.chap').dataset.cid;
    window.getSelection().removeAllRanges();
    noteSheet(id, cid, '', true);
  }
  // A note in the margin that isn't tied to any words: an invisible marker at that spot.
  function freeNote(body, range) {
    const id = newId();
    const mark = document.createElement('span');
    mark.className = 'mn free';
    mark.dataset.n = id;
    mark.contentEditable = 'false';
    const r = range.cloneRange();
    r.collapse(true);
    // never inside a page gap or a scene break
    const blk = (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode).closest('.chap-body > *');
    if (!blk || blk.classList.contains('scene')) return toast('Put the cursor on a line of writing first.');
    r.insertNode(mark);
    window.getSelection().removeAllRanges();
    noteSheet(id, body.closest('section.chap').dataset.cid, '', true);
  }
  function editNote(id) {
    const span = $(`span.mn[data-n="${id}"]`);
    if (!span) return;
    const cid = span.closest('section.chap').dataset.cid;
    const c = P.byId[cid] || {};
    noteSheet(id, cid, ((c.mnotes || {})[id] || {}).text || '', false);
  }
  function noteSheet(id, cid, text, isNew) {
    const words = $$(`span.mn[data-n="${id}"]`).map(s => s.textContent).join(' ').trim();
    let saved = false;
    const el = sheet(`<h2>${isNew ? 'Add a margin note' : 'Margin note'}</h2>
      ${words ? `<blockquote class="quote">${esc(words.length > 220 ? words.slice(0, 220) + '…' : words)}</blockquote>` : `<p class="muted">In the margin beside: “${esc(nearText(id))}”</p>`}
      <textarea class="input" id="mn-text" rows="5" placeholder="Your note…" autofocus>${esc(text)}</textarea>
      <div class="row ${isNew ? 'end' : 'between'}">
        ${isNew ? '' : `<button class="btn quiet danger-text" data-a="del">${icon('trash')} Delete note</button>`}
        <span><button class="btn quiet" data-act="close">Cancel</button> <button class="btn" data-a="save">Save note</button></span>
      </div>`, {
      cls: 'small',
      onClose: () => { if (isNew && !saved) { $$(`span.mn[data-n="${id}"]`).forEach(unwrap); } },
    });
    setTimeout(() => $('#mn-text') && $('#mn-text').focus(), 80);
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const c = P.byId[cid];
      if (b.dataset.a === 'save') {
        const t = $('#mn-text').value.trim();
        if (!t) return toast('Write the note first (or Cancel).');
        saved = true;
        c.mnotes = { ...(c.mnotes || {}), [id]: { text: t, at: Date.now() } };
        markDirty(cid);
        closeSheet(true);
        flush(cid);
        layoutNotes();
      } else if (b.dataset.a === 'del') {
        saved = true;
        $$(`span.mn[data-n="${id}"]`).forEach(unwrap);
        if (c.mnotes) delete c.mnotes[id];
        markDirty(cid);
        closeSheet(true);
        flush(cid);
        layoutNotes();
      }
    });
  }

  // Notes beside the page, lined up with their line: cards when there's room,
  // a small note icon in the page's edge when there isn't.
  function noteItems() {
    const box = $('#margin');
    const seen = new Set();
    const items = [];
    for (const span of $$('#paper span.mn')) {
      const id = span.dataset.n;
      if (seen.has(id)) continue;
      seen.add(id);
      const cid = span.closest('section.chap').dataset.cid;
      const note = ((P.byId[cid] || {}).mnotes || {})[id];
      if (!note) continue;
      const r = span.getClientRects()[0] || span.getBoundingClientRect();
      items.push({ id, y: r.top, text: note.text });
    }
    return items;
  }
  function layoutNotes() {
    if (!P) return;
    const box = $('#margin'), dots = $('#mdots');
    if (!box || !dots) return;
    const items = narrow() ? [] : noteItems();
    const cards = !!box.offsetParent;
    // The notes already showing are kept and only moved: taking them all away and drawing them again
    // after every pause in typing made Chrome redraw the frosted cards over the photo (a bright blink).
    const setPx = (el, prop, v) => { if (el.style[prop] !== v + 'px') el.style[prop] = v + 'px'; };
    if (cards) {
      if (dots.firstChild) dots.innerHTML = '';
      const base = box.getBoundingClientRect().top;
      let list = $$('.mcard', box);
      if (!(list.length === items.length && list.every((c, i) => c.dataset.n === items[i].id && c.textContent === items[i].text))) {
        list.forEach(c => c.remove());
        box.insertAdjacentHTML('beforeend', items.map(it => `<button class="mcard" data-n="${it.id}">${esc(it.text)}</button>`).join(''));
        list = $$('.mcard', box);
      }
      let y = -Infinity;
      list.forEach((card, i) => {
        const top = Math.max(items[i].y - base - 4, y + 10);
        setPx(card, 'top', top);
        y = top + card.offsetHeight;
      });
    } else {
      $$('.mcard', box).forEach(c => c.remove());
      const wrap = dots.parentNode.getBoundingClientRect();
      const paper = $('#paper').getBoundingClientRect();
      const left = paper.right - wrap.left - (narrow() ? 24 : 34);
      let y = -Infinity;
      let list = $$('.mdot', dots);
      if (!(list.length === items.length && list.every((d, i) => d.dataset.n === items[i].id && d.title === items[i].text))) {
        dots.innerHTML = items.map(it => `<button class="mdot" data-n="${it.id}" title="${esc(it.text)}">${icon('note')}</button>`).join('');
        list = $$('.mdot', dots);
      }
      list.forEach((d, i) => {
        const top = Math.max(items[i].y - wrap.top, y + 24);
        setPx(d, 'top', top);
        setPx(d, 'left', left);
        y = top;
      });
    }
  }
  // the little + that follows the mouse down the margin
  function onHoverMargin(e) {
    const add = $('#madd');
    if (!add || !$('#margin').offsetParent) return;
    const paper = $('#paper').getBoundingClientRect();
    if (e.clientX < paper.left || e.clientX > paper.right + 240) { add.hidden = true; return; }
    if (e.target.closest && e.target.closest('.mcard')) { add.hidden = true; return; }
    const at = lineAt(e.clientY);
    if (!at) { add.hidden = true; return; }
    const base = $('#margin').getBoundingClientRect().top;
    add.hidden = false;
    add.style.top = (at.rect.top - base) + 'px';
    P.hoverAt = at;
  }
  // the start of the line at height y on the page
  function lineAt(y) {
    const paper = $('#paper').getBoundingClientRect();
    const body = $$('.chap-body').find(b => { const r = b.getBoundingClientRect(); return y >= r.top && y <= r.bottom; });
    if (!body || !document.caretRangeFromPoint) return null;
    const cs = getComputedStyle(body);
    const x = body.getBoundingClientRect().left + 2;
    const cr = document.caretRangeFromPoint(x, y);
    if (!cr || !body.contains(cr.startContainer)) return null;
    const r = cr.getClientRects()[0] || cr.getBoundingClientRect();
    if (!r || !r.height || Math.abs(r.top + r.height / 2 - y) > parseFloat(cs.lineHeight)) return null;
    return { range: cr, rect: r, body };
  }

  // the words just after a free note's spot, so you know where it is
  function nearText(id) {
    const m = $(`span.mn[data-n="${id}"]`);
    if (!m) return '';
    const blk = m.closest('.chap-body > *');
    const r = document.createRange();
    r.setStartAfter(m);
    r.setEnd(blk, blk.childNodes.length);
    const t = r.toString().trim() || blk.textContent.trim();
    return t.length > 60 ? t.slice(0, 60) + '…' : t;
  }
  function focusCard(id) {
    $$('.mcard, .mdot').forEach(c => c.classList.toggle('on', c.dataset.n === id));
    $$('span.mn').forEach(s => s.classList.toggle('on', s.dataset.n === id));
  }

  // ---------- chapter notes (a pop-up from the chapter list) ----------
  function chapterNotes(cid) {
    const c = P.byId[cid];
    if (!c) return;
    const idx = P.chapters.indexOf(c);
    let t = null;
    const save = () => {
      if (!t || !P) return;
      c.notes = t.value;
      P.ctx.api.saveChapter(c.id, { notes: c.notes });
      const b = $(`.chnote[data-cnote="${c.id}"]`);
      if (b) b.classList.toggle('has', !!c.notes.trim());
    };
    const el = sheet(`<div class="cn-head"><span class="eyebrow">Chapter ${idx + 1} · notes</span><h2>${esc(c.title || 'Untitled chapter')}</h2></div>
      <textarea class="cn-text" id="cn-text" placeholder="Plans, reminders, what happens in this chapter… (not part of the story)">${esc(c.notes || '')}</textarea>
      <div class="row end"><button class="btn" data-act="close">Done</button></div>`, { onClose: save });
    t = $('#cn-text');
    t.addEventListener('input', () => { clearTimeout(t._t); t._t = setTimeout(save, 600); });
    setTimeout(() => t.focus(), 80);
  }

  // ---------- special sections (a prologue, epilogue… isn't numbered as a chapter) ----------
  // chapter.special = its word ('Prologue'); '' = a numbered chapter. Book titles in the
  // "Chapter Four" form (or a special word, on a special section) are the app's own: they follow
  // the numbering when chapters move. A title she typed is left alone; clearing one brings it back.
  const SPECIALS = ['Foreword', 'Preface', 'Prologue', 'Interlude', 'Epilogue', 'Afterword'];
  const AUTO = /^chapter\s+([a-z]+(-[a-z]+)?|\d+)$/i;
  // the list number of each chapter (null for a special section)
  function numbering() { let k = 0; return P.chapters.map(c => (c.special ? null : ++k)); }
  // (a special section titled just its word shows the word once: an empty slot here, the title in italics)
  const chnHtml = (c, n) => (!c.special ? `<span class="chn" title="Make this a prologue, epilogue…">${n}</span>`
    : `<span class="chn sp ${(c.title || '').trim() === c.special ? 'same' : ''}" title="${esc(c.special)} — not counted as a chapter. Click to change.">${(c.title || '').trim() === c.special ? '' : esc(c.special)}</span>`);
  function autoTitle(c) {
    if (c.special) return c.special;
    const i = P.chapters.filter(x => !x.special).indexOf(c);
    return `Chapter ${numWord(i + 1)}`;
  }
  function setTitle(c, title) {
    c.title = title;
    P.ctx.api.saveChapter(c.id, { title });
    const inp = $(`section.chap[data-cid="${c.id}"] .chap-title`);
    if (inp && document.activeElement !== inp) inp.value = title;
    if (P.state[c.id]) P.state[c.id].titleDirty = false;
  }
  // put the app's own titles back in step with the order
  function retitle() {
    if (!P || P.project.kind === 'short') return;
    let changed = false;
    for (const c of P.chapters) {
      const t = (c.title || '').trim();
      const own = c.special ? !t || AUTO.test(t) || SPECIALS.includes(t) : AUTO.test(t);
      if (!own) continue;
      const want = autoTitle(c);
      if (t !== want) { setTitle(c, want); changed = true; }
    }
    if (changed) renderList();
  }
  function setSpecial(cid, word) {
    const c = P.byId[cid];
    if (!c || (c.special || '') === word) return;
    flush(cid);
    const was = c.special || '';
    c.special = word;
    P.ctx.api.saveChapter(cid, { special: word });
    // its own title follows: "Prologue" while special; back to "Chapter X" when it isn't
    if (!word && (c.title || '').trim() === was) setTitle(c, 'Chapter One'); // (renumbered next)
    retitle();
    renderList();
  }
  function specialPop(anchor, cid, after) {
    const c = P.byId[cid];
    if (!c) return;
    const cur = c.special || '';
    const other = cur && !SPECIALS.includes(cur) ? cur : '';
    const pop = popover(anchor, `<div class="spec-pop"><div class="pop-title">This section is…</div>
      <button class="pop-item ${cur ? '' : 'on'}" data-pick="">${icon('list')} A chapter <small class="muted">(numbered)</small></button>
      ${SPECIALS.map(w => `<button class="pop-item ${cur === w ? 'on' : ''}" data-pick="${w}">${esc(w)}</button>`).join('')}
      <form class="pop-other"><input class="input" placeholder="Something else, like Dedication" value="${esc(other)}" maxlength="30" aria-label="Something else"><button class="btn small">Use</button></form>
      <p class="pop-hint">Not counted as a chapter: it shows its name in the list instead of a number.</p></div>`, word => { setSpecial(cid, word); if (after) after(); });
    pop.querySelector('.pop-other').addEventListener('submit', e => {
      e.preventDefault();
      const w = e.target.querySelector('input').value.trim();
      if (!w) return;
      closePopover();
      setSpecial(cid, w.charAt(0).toUpperCase() + w.slice(1));
      if (after) after();
    });
  }

  // ---------- chapters ----------
  function addChapter() {
    flushAll();
    const n = P.chapters.length + 1;
    const order = (P.chapters.length ? Math.max(...P.chapters.map(c => c.order || 0)) : 0) + 1;
    const title = P.project.kind === 'short' ? (n > 1 ? `Chapter ${n}` : '') : `Chapter ${numWord(P.chapters.filter(c => !c.special).length + 1)}`;
    const made = P.ctx.api.addChapters(P.pid, [{ title, order }]);
    if (narrow()) closeSheet();
    // wait for it to arrive, then go there
    let tries = 0, id = null;
    Promise.resolve(made).then(ids => { id = ids[0]; go(); });
    const go = () => {
      if (!id) return;
      const sec = $(`section.chap[data-cid="${id}"]`);
      if (sec) { jumpTo(id); setTimeout(() => placeCaret(sec.querySelector('.chap-body'), false), 350); }
      else if (tries++ < 30) setTimeout(go, 100);
    };
    go();
  }
  function chaptersSheet() {
    const nums = numbering();
    const el = sheet(`<h2>Chapters</h2><ol class="chlist in-sheet" id="chlist-s">${P.chapters.map((c, i) => `<li class="chrow ${P.current === c.id ? 'on' : ''}" data-cid="${c.id}">
      ${chnHtml(c, nums[i])}<span class="cht">${esc(c.title || 'Untitled chapter')}</span><span class="chw">${num(c.words || 0)}</span></li>`).join('')}</ol>
      <p class="hint">Press and hold a chapter to drag it to a new spot. Tap its number to make it a prologue, epilogue…</p>
      <button class="btn wide" data-act="add-chapter">${icon('plus')} Add a chapter</button>`);
    el.addEventListener('click', e => {
      const num = e.target.closest('.chn');
      if (num) return specialPop(num, num.closest('.chrow').dataset.cid, () => { closeSheet(); chaptersSheet(); });
      const row = e.target.closest('.chrow');
      if (row) { closeSheet(); jumpTo(row.dataset.cid); }
      if (e.target.closest('[data-act="add-chapter"]')) addChapter();
    });
    sortable($('#chlist-s'), '.chrow', {
      key: x => x.dataset.cid,
      onDrop: ids => {
        flushAll();
        const list = ids.map((id, i) => ({ id, order: i + 1 }));
        list.forEach(x => { if (P.byId[x.id]) P.byId[x.id].order = x.order; });
        P.chapters.sort((a, b) => a.order - b.order);
        renderPaper();
        renderList();
        P.ctx.api.orderChapters(list);
        retitle();
        const nums = numbering();
        $$('#chlist-s .chrow').forEach(r => { const i = P.chapters.findIndex(c => c.id === r.dataset.cid); if (i >= 0) r.querySelector('.chn').outerHTML = chnHtml(P.chapters[i], nums[i]); });
      },
    });
  }
  // From the project menu: delete the chapter the cursor is in.
  async function deleteCurrentChapter() {
    const c = P.byId[P.current];
    if (!c) return;
    if (P.chapters.length < 2) return toast('A project needs at least one chapter.');
    const ok = await ask(`Delete “${c.title || 'this chapter'}”?`, `${plural(c.words || 0, 'word')}. You can bring it back from <b>⋯ → Deleted chapters</b> for ${KEEP_DAYS} days.`, 'Delete chapter', { danger: true });
    if (!ok) return;
    flush(c.id);
    const body = bodyOf(c.id);
    snapshot(c, body ? clean(body.innerHTML) : c.html, { deleted: true, chOrder: c.order || 0, notes: c.notes || '', special: c.special || '' });
    delete P.state[c.id];
    P.retitle = true;
    P.ctx.api.deleteChapters([c.id]);
  }

  // ---------- chapter history: the last 7 days ----------
  // users/{uid}/versions/{id} { pid, cid, title, html, words, day, at, order,
  //   manual (kept by hand: before bringing an old one back, or a Replace all),
  //   deleted + chOrder + notes (a deleted chapter, to bring back) }
  // One automatic copy per chapter per day: how it looked before that day's first change.
  // Locked projects' copies are scrambled like everything else (vault.js).
  const KEEP_DAYS = 7;
  const cutoff = () => Date.now() - KEEP_DAYS * 864e5;
  const when = t => new Date(t).toLocaleString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  async function loadHistory() {
    const pid = P.pid;
    let list;
    try { list = await P.ctx.api.listCol('versions', pid); } catch (e) { console.warn('history', e); return; }
    if (!P || P.pid !== pid) return;
    P.snapped = P.snapped || {};
    const seen = new Set();
    for (const v of list.slice().sort((a, b) => (a.at || 0) - (b.at || 0))) {
      const k = v.cid + '|' + v.day;
      // older than a week, or a second automatic copy of the same chapter on the same day (from another device)
      if ((v.at || 0) < cutoff() || (!v.deleted && !v.manual && seen.has(k))) { P.ctx.api.deleteDoc('versions', v.id); continue; }
      if (!v.deleted && !v.manual) seen.add(k);
      if (!v.deleted) P.snapped[k] = true;
    }
  }
  function snapshot(c, html, extra = {}) {
    if (!html || !textOf(html).trim()) return;
    const now = Date.now();
    P.ctx.api.addDoc('versions', { pid: P.pid, cid: c.id, title: c.title || '', html, words: countWords(html), day: dayKey(), at: now, order: now, ...extra });
  }
  function firstOfDay(c, before) {
    P.snapped = P.snapped || {};
    const k = c.id + '|' + dayKey();
    if (P.snapped[k]) return;
    P.snapped[k] = true;
    snapshot(c, before);
  }
  const versionsOf = async () => (await P.ctx.api.listCol('versions', P.pid)).filter(v => (v.at || 0) >= cutoff());

  // ⋯ → Earlier versions of this chapter
  async function historySheet(back) {
    flushAll();
    const c = P.byId[P.current] || P.chapters[0];
    if (!c) return;
    const list = (await versionsOf()).filter(v => v.cid === c.id && !v.deleted).sort((a, b) => b.at - a.at);
    let pick = list[0];
    const el = sheet(`<h2>Earlier versions</h2><p class="muted">${esc(c.title || 'This chapter')} · kept for ${KEEP_DAYS} days. The first time you change a chapter each day, how it looked before is saved here.</p>
      ${list.length ? `<div class="hist">
        <div class="hist-list">${list.map(v => `<button class="hist-row ${v === pick ? 'on' : ''}" data-v="${v.id}"><b>${esc(when(v.at))}</b><small>${plural(v.words || 0, 'word')}${v.manual ? ' · saved before a change' : ''}</small></button>`).join('')}</div>
        <div class="hist-view" id="hist-view"></div></div>
        <div class="row end"><button class="btn quiet" data-act="close">Close</button><button class="btn" id="hist-go">${icon('undo')} Bring this version back</button></div>`
        : `<div class="empty"><p>No earlier versions of this chapter yet.</p></div>`}`, { cls: 'wide', back });
    const show = () => { const vw = $('#hist-view'); if (vw && pick) { vw.innerHTML = clean(pick.html); vw.scrollTop = 0; } };
    show();
    el.addEventListener('click', async e => {
      const r = e.target.closest('[data-v]');
      if (r) { pick = list.find(v => v.id === r.dataset.v); $$('.hist-row', el).forEach(b => b.classList.toggle('on', b === r)); show(); }
      if (e.target.closest('#hist-go') && pick) {
        if (!(await ask('Bring this version back?', `The chapter goes back to how it was on ${esc(when(pick.at))}. What’s there now is saved as a version first, so you can switch back.`, 'Bring it back'))) return;
        restore(c.id, pick.html);
        closeSheet(true);
        toast('Version brought back');
      }
    });
  }
  function restore(cid, html) {
    const body = bodyOf(cid), c = P.byId[cid];
    if (!body || !c) return;
    snapshot(c, clean(body.innerHTML), { manual: true });
    P.snapped[cid + '|' + dayKey()] = true;
    body.innerHTML = clean(html) || '<p><br></p>';
    markDirty(cid);
    flush(cid);
    jumpTo(cid);
  }
  // ⋯ → Deleted chapters
  async function deletedSheet(back) {
    flushAll();
    const list = (await versionsOf()).filter(v => v.deleted).sort((a, b) => b.at - a.at);
    const el = sheet(`<h2>Deleted chapters</h2><p class="muted">Chapters you deleted in the last ${KEEP_DAYS} days.</p>
      ${list.length ? `<div class="hist-list solo">${list.map(v => `<div class="hist-row static"><span><b>${esc(v.title || 'Untitled chapter')}</b><small>${plural(v.words || 0, 'word')} · deleted ${esc(when(v.at))}</small></span><button class="btn quiet small" data-back="${v.id}">${icon('undo')} Bring back</button></div>`).join('')}</div>`
        : `<div class="empty"><p>Nothing deleted lately.</p></div>`}`, { cls: 'small', back });
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-back]');
      if (!b) return;
      const v = list.find(x => x.id === b.dataset.back);
      const order = (P.chapters.length ? Math.max(...P.chapters.map(c => c.order || 0)) : 0) + 1;
      P.retitle = true;
      P.ctx.api.addChapters(P.pid, [{ title: v.title || '', html: v.html, words: v.words || 0, notes: v.notes || '', special: v.special || '', order }]);
      P.ctx.api.deleteDoc('versions', v.id);
      closeSheet(true);
      toast(`“${v.title || 'Untitled chapter'}” is back, at the end`);
    });
  }

  // ---------- the chapter list (Mac): hide it or bring it back; this device remembers, for each project ----------
  // (a project not set yet follows the old all-projects setting, qc-side, so nothing changes until she toggles it)
  const sideOff = pid => (ls.get('qc-side:' + pid) || ls.get('qc-side')) === 'off';
  function sideList(show) {
    ls.set('qc-side:' + P.pid, show ? 'on' : 'off');
    P.root.querySelector('.proj').classList.toggle('side-off', !show);
    relayoutNow(); // re-center the page right away, in the same moment, so it doesn't jump
  }

  // ---------- the Plot beside the page (toolbar button) ----------
  // The project's plot, sections and all (the Plot tab, project.js), opened at the chapter the cursor is in
  // (or the first point not yet written); tick one off from here. Adding and changing happens on the Plot tab.
  let plotOff = null, plotRedraw = null;
  function closePlot() {
    plotRedraw = null;
    if (plotOff) { plotOff(); plotOff = null; }
    const el = $('#plot-panel');
    if (el) el.remove();
    const b = $('.tb[data-act="plot"]');
    if (b) b.classList.remove('on');
    if (document.body.classList.contains('plot-open')) { document.body.classList.remove('plot-open'); if (P) onResize(); }
  }
  function plotPanel() {
    if ($('#plot-panel')) return closePlot();
    const el = document.createElement('aside');
    el.id = 'plot-panel';
    el.className = 'plot-panel';
    el.innerHTML = `<div class="pp-head"><b>Plot</b><span class="pp-count"></span><button class="pp-x" data-pp="close" title="Close" aria-label="Close">${icon('x')}</button></div>
      <ol class="pp-list"><li class="muted pp-empty">Opening…</li></ol>
      <a class="pp-edit" href="#/p/${P.pid}/timeline">Add or change plot points on the Plot page</a>`;
    document.body.appendChild(el);
    document.body.classList.add('plot-open'); // (the page moves over to make room)
    onResize();
    const b = $('.tb[data-act="plot"]');
    if (b) b.classList.add('on');
    let list = [], first = true;
    const K = Project.plot;
    const draw = () => {
      const ch = P.chapters, pts = list.filter(e => e.kind !== 'section');
      const cur = P.byId[P.current], here = cur ? K.keyOf(cur, ch) : '';
      $('.pp-count', el).textContent = pts.length ? `${pts.filter(e => e.done).length} of ${pts.length} written` : '';
      $('.pp-list', el).innerHTML = list.length ? K.rows(list).map(ev => {
        if (ev.kind === 'section') return `<li class="pp-sec"><b>${esc(ev.title || 'Untitled section')}</b>${ev.range ? `<span>${esc(ev.range)}</span>` : ''}</li>`;
        const st = K.status(ev, ch), l = K.label(ev, ch);
        return `<li class="pp-ev st-${st} ${ev.done ? 'done' : ''} ${ev.ch && ev.ch === here ? 'here' : ''}" data-id="${ev.id}">
          <button class="pl-tick" data-pp="done" title="${K.tickTitle(st)}" aria-pressed="${ev.done ? 'true' : 'false'}">${K.tickHtml(st)}</button>
          <div class="pp-text" data-pp="open"><b>${esc(l.own ? `${l.name} · ${l.own}` : l.name)}</b>${ev.text ? `<p>${esc(ev.text)}</p>` : ''}</div></li>`;
      }).join('')
        : '<li class="muted pp-empty">Nothing planned yet — add plot points on the Plot page.</li>';
      // opened at the chapter being written (or the first point not done yet)
      if (first && list.length) {
        first = false;
        const at = $('.pp-ev.here', el) || $('.pp-ev:not(.done)', el);
        if (at) { const prev = at.previousElementSibling; $('.pp-list', el).scrollTop = (prev && prev.classList.contains('pp-sec') ? prev : at).offsetTop - 8; }
      }
    };
    plotRedraw = draw; // (also when the chapters change: a quill appears once a chapter has words)
    plotOff = P.ctx.api.watchCol('events', P.pid, l => { list = l; draw(); });
    el.addEventListener('click', e => {
      const a = e.target.closest('[data-pp]');
      if (!a) return;
      if (a.dataset.pp === 'close') return closePlot();
      const li = a.closest('.pp-ev');
      if (a.dataset.pp === 'open') return li.classList.toggle('open');
      if (a.dataset.pp === 'done') {
        const ev = list.find(x => x.id === li.dataset.id);
        if (!ev) return;
        ev.done = !ev.done;
        const full = { ...ev };
        delete full.id;
        P.ctx.api.saveDoc('events', ev.id, full); // (the whole entry: a locked project scrambles it as one)
        draw();
      }
    });
  }

  // ---------- blur as I type (toolbar button; Appearance → Paragraphs can turn it on for the project) ----------
  // Every paragraph is blurred but the one with the cursor (CSS, .blur-type / .typing); inside that one, the lines
  // above and below the cursor's line get a blurred pane over them (#blurbox). It stays on until it's turned off.
  // Only the screen changes: the writing, Pages, the book view and exports aren't touched.
  let blurRaf = 0;
  function setBlur(on) {
    if (!P) return;
    P.blur = !!on;
    P.root.querySelector('.proj').classList.toggle('blur-type', P.blur);
    const b = $('.tb[data-act="blur"]');
    if (b) b.classList.toggle('on', P.blur);
    placeBlur();
  }
  function placeBlur() { clearTimeout(blurRaf); blurRaf = setTimeout(placeBlurNow, 16); } // (once per burst of changes)
  function placeBlurNow() {
    if (!P) return;
    let box = $('#blurbox');
    // (all of them: pressing Return copies the class onto the new paragraph)
    const was = $$('.chap-body > .typing');
    if (!P.blur || P.reading) { was.forEach(el => el.classList.remove('typing')); if (box) { box.innerHTML = ''; box._html = ''; } return; }
    if (!box) { box = document.createElement('div'); box.id = 'blurbox'; box.className = 'blurbox'; box.setAttribute('aria-hidden', 'true'); document.body.appendChild(box); }
    const body = activeBody();
    const blk = body && body.isContentEditable ? blockAtCaret(body) : null;
    was.forEach(el => { if (el !== blk) el.classList.remove('typing'); });
    const parts = [];
    if (blk && !blk.classList.contains('scene')) {
      blk.classList.add('typing');
      // the cursor's line: from where the cursor is drawn, one line tall
      const sel = window.getSelection();
      const r = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      if (r) r.collapse(false);
      const rects = r ? Array.from(r.getClientRects()) : [];
      const c = rects[rects.length - 1];
      const br = blk.getBoundingClientRect();
      if (c && c.height) {
        const lh = parseFloat(getComputedStyle(blk).lineHeight) || c.height * 1.5;
        const mid = (c.top + c.bottom) / 2, top = mid - lh / 2, bot = mid + lh / 2;
        if (top - br.top > 3) parts.push([br.left, br.top, br.width, top - br.top]);
        if (br.bottom - bot > 3) parts.push([br.left, bot, br.width, br.bottom - bot]);
      }
    }
    const sx = window.scrollX, sy = window.scrollY;
    const html = parts.map(([l, t, w, h]) => `<div class="blurpart" style="left:${l + sx}px;top:${t + sy}px;width:${w}px;height:${h}px"></div>`).join('');
    if (box._html !== html) { box.innerHTML = html; box._html = html; }
  }

  // ---------- focus mode ----------
  function toggleFocus() {
    if (P.locked) return;
    P.focus = !P.focus;
    document.body.classList.toggle('focus-mode', P.focus);
    if (P.focus) toast('Focus mode · Esc or “Leave focus” to come back', 2200);
    setTimeout(onResize, 50);
  }
  // Lock in turns focus mode on (and Esc / Leave focus off) until it's paused or done.
  function lockFocus(on) {
    if (!P || !!P.locked === on) return;
    P.locked = on;
    P.focus = on;
    document.body.classList.toggle('focus-mode', on);
    document.body.classList.toggle('lockin-on', on);
    setTimeout(onResize, 50);
  }

  // ---------- reading mode: the book view (book.js) ----------
  // Real pages, turned like a book. Where reading stops is saved in project.readAt
  // (Read opens there next time, on any device); Done reading puts the writing there.
  function setReading(on) {
    if (!P || !!P.reading === on) return;
    if (!on) return Book.close();
    flushAll();
    P.reading = true;
    const chapters = P.chapters.map(c => { const body = bodyOf(c.id); return { id: c.id, title: c.title || '', html: body ? clean(body.innerHTML) : (c.html || '') }; });
    let saveT = null;
    Book.open({
      project: P.project, chapters, at: P.project.readAt, settings: P.ctx.settings(),
      onSpot: at => {
        if (!P) return;
        P.project.readAt = at;
        clearTimeout(saveT);
        saveT = setTimeout(() => P && P.ctx.api.saveProject(P.pid, { readAt: at }), 700);
      },
      onClose: at => {
        if (!P) return;
        P.reading = false;
        clearTimeout(saveT);
        if (at) { P.project.readAt = at; P.ctx.api.saveProject(P.pid, { readAt: at }); setTimeout(() => P && goTo(at), 30); }
      },
    });
  }

  // ---------- look up a word ----------
  const WORDCH = /[\p{L}'’\-]/u;
  function lookupWord() {
    const sel = window.getSelection();
    const btn = $('.tb[data-act="lookup"]');
    let range = null, body = null;
    if (sel.rangeCount) {
      const n = sel.anchorNode;
      body = n && (n.nodeType === 1 ? n : n.parentNode).closest && (n.nodeType === 1 ? n : n.parentNode).closest('.chap-body');
      if (body) range = wordRange(sel.getRangeAt(0).cloneRange());
    }
    const word = range ? range.toString() : '';
    if (word && !Lookup.isWord(word)) return toast('Select just one word to look it up.');
    let rect = range && range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) rect = btn.getBoundingClientRect();
    Lookup.open({ rect, word, onSwap: word ? w => swapWord(body, range, w) : null });
  }
  // the selection, or the word the cursor is in, trimmed to just the word
  function wordRange(r) {
    if (r.collapsed) {
      const n = r.startContainer;
      if (n.nodeType !== 3) return null;
      const t = n.nodeValue;
      let a = r.startOffset, b = r.startOffset;
      while (a > 0 && WORDCH.test(t[a - 1])) a--;
      while (b < t.length && WORDCH.test(t[b])) b++;
      if (a === b) return null;
      r.setStart(n, a); r.setEnd(n, b);
    } else if (r.startContainer === r.endContainer && r.startContainer.nodeType === 3) {
      const t = r.startContainer.nodeValue;
      let a = r.startOffset, b = r.endOffset;
      while (a < b && !/\p{L}/u.test(t[a])) a++;
      while (b > a && !/\p{L}/u.test(t[b - 1])) b--;
      r.setStart(r.startContainer, a); r.setEnd(r.startContainer, b);
    }
    return r.toString().trim() ? r : null;
  }
  function swapWord(body, range, w) {
    if (!P || !body.isConnected) return;
    body.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, w); // goes through undo, and saves like typing
  }

  // ---------- pages ----------
  // Where the top of the screen is: { cid, block, offset }
  function position() {
    const y = TOP_OFFSET() + 4;
    const sec = $(`section.chap[data-cid="${P.current}"]`) || $('section.chap');
    if (!sec) return null;
    const body = sec.querySelector('.chap-body');
    const kids = Array.from(body.children);
    let block = 0;
    for (let i = 0; i < kids.length; i++) { if (kids[i].getBoundingClientRect().bottom > y) { block = i; break; } block = i; }
    let offset = 0;
    const el = kids[block];
    if (el && document.caretRangeFromPoint) {
      const r = el.getBoundingClientRect();
      const cr = document.caretRangeFromPoint(r.left + 4, Math.max(y, r.top + 4));
      if (cr && el.contains(cr.startContainer)) {
        const pre = document.createRange();
        pre.selectNodeContents(el);
        pre.setEnd(cr.startContainer, cr.startOffset);
        offset = pre.toString().length;
      }
    }
    return { cid: sec.dataset.cid, block, offset };
  }
  function goTo(pos, quiet) {
    const sec = $(`section.chap[data-cid="${pos.cid}"]`);
    if (!sec) return;
    const body = sec.querySelector('.chap-body');
    const el = body.children[Math.min(pos.block, body.children.length - 1)];
    if (!el) return jumpTo(pos.cid);
    let rect = el.getBoundingClientRect();
    // find the exact spot inside the paragraph
    if (pos.offset) {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let left = pos.offset, n;
      while ((n = w.nextNode())) {
        if (left <= n.nodeValue.length) {
          const r = document.createRange();
          r.setStart(n, Math.min(left, n.nodeValue.length));
          r.collapse(true);
          const rr = r.getClientRects()[0] || r.getBoundingClientRect();
          if (rr && rr.height) rect = rr;
          if (!narrow() && !quiet) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
          break;
        }
        left -= n.nodeValue.length;
      }
    } else {
      if (pos.block === 0) rect = sec.getBoundingClientRect();
      if (!narrow() && !quiet) placeCaret(el, false);
    }
    window.scrollTo({ top: rect.top + window.scrollY - TOP_OFFSET() - 8 });
    if (quiet) return;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1400);
  }
  function openPages() {
    flushAll();
    const chapters = P.chapters.map(c => {
      const body = bodyOf(c.id);
      return { id: c.id, title: c.title || '', html: body ? clean(body.innerHTML) : (c.html || '') };
    });
    Pages.open({ project: P.project, chapters, at: position(), onGo: goTo });
  }

  // Live chapter text (for export), with anything not yet saved.
  function liveChapters() {
    flushAll();
    return P.chapters.map(c => ({ ...c }));
  }

  // The look changed: chapter-end ornament + toolbar button follow the default scene break.
  function refreshLook(project) {
    if (!P) return;
    P.project = project;
    ownScene(project);
    sceneMini();
    $$('.chap-end span').forEach(s => { s.innerHTML = sceneTile(project.sceneBreak); });
    setTimeout(() => { if (!P) return; setMode(); paginateAll(); layoutNotes(); }, 120);
  }
  // The book's design changed (Appearance): the breaks still in the old design follow it.
  // Ones she changed by hand (clicked and picked another) keep theirs.
  function setAllScenes(id, from) {
    if (!P) return;
    const s = sceneOf(id), old = sceneOf(from).id;
    for (const c of P.chapters) {
      const body = bodyOf(c.id);
      if (!body) continue;
      const list = $$('.scene', body).filter(el => sceneOf(el.dataset.s).id === old);
      if (!list.length) continue;
      list.forEach(el => { el.dataset.s = s.id; el.textContent = s.t; });
      markDirty(c.id);
      schedulePage(c.id);
    }
    flushAll();
  }
  // The same for a chapter that isn't open (the writing page is closed): its saved html.
  function scenesIn(html, id, from) {
    const s = sceneOf(id), old = sceneOf(from).id;
    const d = document.createElement('div');
    d.innerHTML = html || '';
    let n = 0;
    $$('.scene', d).forEach(el => { if (sceneOf(el.dataset.s).id === old) { el.dataset.s = s.id; el.textContent = s.t; n++; } });
    return n ? d.innerHTML : null;
  }

  return {
    SCENES, sceneOf, sceneTile, ownScene, clean, countWords, textOf, open, close, isOpen, update, refreshLook, setAllScenes, scenesIn,
    liveChapters, deleteCurrentChapter, flushAll, lockFocus, historySheet, deletedSheet, current: () => P && P.current,
    // for find & replace (find.js)
    bodies: () => (P ? P.chapters.map(c => ({ cid: c.id, body: bodyOf(c.id) })).filter(x => x.body) : []),
    changed: cid => { if (P) markDirty(cid); },
    keepVersion: cid => {
      if (!P || !P.byId[cid] || !bodyOf(cid)) return;
      snapshot(P.byId[cid], clean(bodyOf(cid).innerHTML), { manual: true });
      (P.snapped = P.snapped || {})[cid + '|' + dayKey()] = true; // that covers today's copy too
    },
    relayout: () => { if (!P) return; clearTimeout(P.relayT); P.relayT = setTimeout(() => { paginateAll(); layoutNotes(); }, 200); },
  };
})();
