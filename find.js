/* Find and replace across every chapter of the book (the writing page).

   ⌘F or the toolbar button opens a small bar under the toolbar. Matches are
   marked with the browser's highlight layer, so the writing itself is never
   touched just by searching. "Replace all" keeps a version of each chapter it
   changes first (chapter history) and offers Undo right in the bar. */

const Find = (() => {
  const { $, $$, esc, icon } = UI;
  const HL = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';
  let bar = null, matches = [], cur = -1, undo = null, t = null;

  function build() {
    bar = document.createElement('div');
    bar.className = 'findbar';
    bar.hidden = true;
    bar.innerHTML = `<div class="fd-row"><input class="input" id="fd-q" placeholder="Find" autocomplete="off" spellcheck="false"><span class="fd-n" id="fd-n"></span>
        <button class="mini" data-fd="prev" title="Previous (⇧ Return)" aria-label="Previous">${icon('down', 'up')}</button><button class="mini" data-fd="next" title="Next (Return)" aria-label="Next">${icon('down')}</button><button class="mini" data-fd="x" title="Close (Esc)" aria-label="Close">${icon('x')}</button></div>
      <div class="fd-row"><input class="input" id="fd-r" placeholder="Replace with" autocomplete="off" spellcheck="false"><button class="btn quiet small" data-fd="one">Replace</button><button class="btn quiet small" data-fd="all">Replace all</button></div>
      <div class="fd-row fd-opts"><label class="check"><input type="checkbox" id="fd-cs"> Match case</label><label class="check"><input type="checkbox" id="fd-ww"> Whole words only</label></div>
      <p class="fd-msg" id="fd-msg"></p>`;
    bar.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
    bar.addEventListener('click', e => {
      const b = e.target.closest('[data-fd]');
      if (!b) return;
      const a = b.dataset.fd;
      if (a === 'x') close();
      if (a === 'next') step(1);
      if (a === 'prev') step(-1);
      if (a === 'one') replaceOne();
      if (a === 'all') replaceAll();
      if (a === 'undo') undoAll();
    });
    bar.addEventListener('input', e => { if (e.target.id === 'fd-q') { msg(''); clearTimeout(t); t = setTimeout(() => run(true), 120); } });
    bar.addEventListener('change', e => { if (e.target.type === 'checkbox') run(true); });
    bar.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      if (e.key === 'Enter') { e.preventDefault(); if (e.target.id === 'fd-r') replaceOne(); else step(e.shiftKey ? -1 : 1); }
    });
  }
  const isOpen = () => !!bar && !bar.hidden;
  function open() {
    if (!bar) build();
    // it lives in the writing page (which knows how tall its top bars are)
    const host = document.querySelector('.proj') || document.body;
    if (bar.parentNode !== host) host.appendChild(bar);
    const sel = window.getSelection().toString().trim();
    if (sel && sel.length < 80 && !/\n/.test(sel)) $('#fd-q').value = sel;
    bar.hidden = false;
    document.body.classList.add('find-on');
    $('#fd-q').focus();
    $('#fd-q').select();
    run(true);
  }
  function close() {
    if (!bar) return;
    bar.hidden = true;
    document.body.classList.remove('find-on');
    matches = []; cur = -1; undo = null;
    msg('');
    paint();
  }
  const msg = h => { const m = $('#fd-msg'); if (m) m.innerHTML = h; };

  // ---------- finding ----------
  function pattern() {
    const q = $('#fd-q').value;
    if (!q) return null;
    const e = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const src = $('#fd-ww').checked ? `(?<![\\p{L}\\p{N}_’'])${e}(?![\\p{L}\\p{N}_])` : e;
    return new RegExp(src, 'gu' + ($('#fd-cs').checked ? '' : 'i'));
  }
  // every match, as { cid, range }, in book order (each paragraph is searched as one piece of text)
  function collect() {
    const re = pattern();
    const out = [];
    if (!re) return out;
    for (const { cid, body } of Editor.bodies()) {
      for (const blk of Array.from(body.children)) {
        if (blk.classList.contains('scene')) continue;
        const segs = [];
        let text = '';
        const w = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) { segs.push({ n, at: text.length }); text += n.nodeValue; }
        if (!text) continue;
        const spot = i => { let k = segs.length - 1; while (k > 0 && segs[k].at > i) k--; return { n: segs[k].n, o: i - segs[k].at }; };
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text))) {
          if (!m[0]) { re.lastIndex++; continue; }
          const a = spot(m.index), b = spot(m.index + m[0].length);
          // an end exactly at a node's end belongs to that node
          const end = b.o === 0 && b.n !== a.n ? (() => { const k = segs.findIndex(s => s.n === b.n); const p = segs[k - 1]; return { n: p.n, o: p.n.nodeValue.length }; })() : b;
          const r = document.createRange();
          r.setStart(a.n, a.o);
          r.setEnd(end.n, end.o);
          out.push({ cid, range: r });
        }
      }
    }
    return out;
  }
  function paint() {
    if (!HL) return;
    CSS.highlights.delete('qc-find');
    CSS.highlights.delete('qc-find-cur');
    if (!matches.length) return;
    CSS.highlights.set('qc-find', new Highlight(...matches.map(m => m.range)));
    if (matches[cur]) CSS.highlights.set('qc-find-cur', new Highlight(matches[cur].range));
  }
  function count() {
    const n = $('#fd-n');
    if (!n) return;
    const q = $('#fd-q').value;
    n.textContent = !q ? '' : matches.length ? `${cur + 1} of ${matches.length}` : 'None';
    n.classList.toggle('none', !!q && !matches.length);
  }
  // fresh: start from the first match below the top of the screen
  function run(fresh) {
    if (!isOpen()) return;
    const was = cur;
    matches = collect();
    if (!matches.length) cur = -1;
    else if (fresh) {
      const top = ($('#tools') ? $('#tools').getBoundingClientRect().bottom : 0) + 10;
      cur = Math.max(0, matches.findIndex(m => m.range.getBoundingClientRect().top >= top));
    } else cur = Math.min(Math.max(0, was), matches.length - 1);
    paint();
    count();
    if (fresh && matches[cur]) show(false);
  }
  function show(always) {
    const r = matches[cur] && matches[cur].range.getBoundingClientRect();
    if (!r) return;
    const top = ($('#tools') ? $('#tools').getBoundingClientRect().bottom : 0) + (bar ? bar.offsetHeight : 0) + 20;
    if (always || r.top < top || r.bottom > window.innerHeight - 40) window.scrollTo({ top: window.scrollY + r.top - top - 40 });
    if (!HL) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(matches[cur].range); }
  }
  function step(d) {
    run(false);
    if (!matches.length) return;
    cur = (cur + d + matches.length) % matches.length;
    paint();
    count();
    show(true);
  }
  // the writing changed while the bar is open: find again (after typing settles)
  function refresh() { if (!isOpen()) return; clearTimeout(t); t = setTimeout(() => run(false), 250); }

  // ---------- replacing ----------
  function replaceOne() {
    run(false);
    const m = matches[cur];
    if (!m) return;
    const body = m.range.startContainer.parentElement.closest('.chap-body');
    if (!body) return;
    body.focus({ preventScroll: true });
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(m.range);
    document.execCommand('insertText', false, $('#fd-r').value); // undoable with ⌘Z, and saves like typing
    s.removeAllRanges();
    run(false);
    show(true);
  }
  function replaceAll() {
    run(false);
    if (!matches.length) return;
    Editor.flushAll();
    const by = {};
    matches.forEach(m => (by[m.cid] = by[m.cid] || []).push(m));
    undo = {};
    const r = $('#fd-r').value;
    let n = 0;
    for (const { cid, body } of Editor.bodies()) {
      if (!by[cid]) continue;
      Editor.keepVersion(cid); // a copy in chapter history first
      undo[cid] = body.innerHTML;
      // last to first, so the earlier spots don't shift
      for (const m of by[cid].slice().reverse()) {
        m.range.deleteContents();
        if (r) m.range.insertNode(document.createTextNode(r));
        n++;
      }
      body.normalize();
      Editor.changed(cid);
    }
    msg(`Replaced ${n} ${n === 1 ? 'time' : 'times'}. <button class="link" data-fd="undo">Undo</button>`);
    run(false);
  }
  function undoAll() {
    if (!undo) return;
    for (const { cid, body } of Editor.bodies()) if (undo[cid] != null) { body.innerHTML = undo[cid]; Editor.changed(cid); }
    undo = null;
    msg('Put back.');
    run(false);
  }

  return { open, close, isOpen, refresh };
})();
