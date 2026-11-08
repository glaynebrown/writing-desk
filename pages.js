/* The Pages pop-up: the project laid out as real printed pages (6×9 unless
   the project says otherwise), small pages down the left, the chosen page big
   on the right, and "Go to this page" to jump there in the writing.

   Each page remembers where it starts: { cid, block (paragraph number),
   offset (letters into that paragraph) }. */

const Pages = (() => {
  const { $, $$, icon, plural, narrow } = UI;
  const DPI = 96;
  let run = 0; // bumps when the pop-up closes, so an old layout stops

  function open({ project, chapters, at, onGo }) {
    const my = ++run;
    const size = project.pageSize && project.pageSize.w ? project.pageSize : { w: 6, h: 9 };
    const W = Math.round(size.w * DPI), H = Math.round(size.h * DPI);
    const el = UI.sheet(`<div class="pages-head"><h2>Pages</h2><span class="pages-count" id="pg-count">Laying out pages…</span></div>
      <div class="pages-wrap" style="--pw:${W}px;--ph:${H}px">
        <div class="pages-list" id="pg-list"><div class="pg-progress"><div class="bar"><span id="pg-bar"></span></div></div></div>
        <div class="pages-view" id="pg-view">
          <div class="pv-stage" id="pg-stage"></div>
          <div class="pv-foot"><span id="pg-where"></span><button class="btn" id="pg-go" disabled>Go to this page</button></div>
        </div>
      </div>`, { cls: 'pages', onClose: () => { run++; } });

    const pages = [];
    let sel = -1;
    const list = $('#pg-list');
    const listen = () => {
      list.addEventListener('click', e => {
        const t = e.target.closest('.pthumb');
        if (!t) return;
        pick(+t.dataset.i);
        if (narrow()) $('.pages-wrap').classList.add('viewing');
      });
      list.addEventListener('dblclick', e => { const t = e.target.closest('.pthumb'); if (t) go(+t.dataset.i); });
      $('#pg-go').addEventListener('click', () => go(sel));
      el.addEventListener('click', e => { if (e.target.closest('[data-a="back"]')) $('.pages-wrap').classList.remove('viewing'); });
      list.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); pick(Math.min(pages.length - 1, sel + 1), true); }
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); pick(Math.max(0, sel - 1), true); }
        if (e.key === 'Enter') go(sel);
      });
    };
    function pick(i, scroll) {
      if (!pages[i]) return;
      sel = i;
      $$('.pthumb.on', list).forEach(t => t.classList.remove('on'));
      const t = list.querySelector(`.pthumb[data-i="${i}"]`);
      if (t) { t.classList.add('on'); if (scroll) t.scrollIntoView({ block: 'nearest' }); }
      const stage = $('#pg-stage');
      stage.innerHTML = `<button class="pv-back only-narrow" data-a="back">${icon('back')} All pages</button><div class="pv-page"></div>`;
      const holder = stage.querySelector('.pv-page');
      const page = pages[i].el.cloneNode(true);
      holder.appendChild(page);
      const fit = () => {
        const avail = stage.getBoundingClientRect();
        const s = Math.min((avail.width - 24) / W, (avail.height - (narrow() ? 64 : 24)) / H, 1.3);
        holder.style.width = W * s + 'px';
        holder.style.height = H * s + 'px';
        page.style.transform = `scale(${s})`;
      };
      fit();
      requestAnimationFrame(fit);
      $('#pg-where').textContent = `Page ${i + 1} of ${pages.length}${pages[i].chapter ? ' · ' + pages[i].chapter : ''}`;
      $('#pg-go').disabled = false;
    }
    function go(i) {
      if (!pages[i]) return;
      UI.closeSheet();
      setTimeout(() => onGo(pages[i].start), 30);
    }

    layout(project, chapters, W, H, () => my === run, (page, done, frac) => {
      if (my !== run) return;
      if (page) {
        pages.push(page);
        const i = pages.length - 1;
        const th = document.createElement('button');
        th.className = 'pthumb';
        th.dataset.i = i;
        th.innerHTML = `<span class="pt-page"></span><span class="pt-num">${i + 1}</span>`;
        const clone = page.el.cloneNode(true);
        th.firstChild.appendChild(clone);
        const prog = list.querySelector('.pg-progress');
        if (page.chapterStart) {
          const lab = document.createElement('div');
          lab.className = 'pt-chapter';
          lab.textContent = page.chapter || 'Untitled chapter';
          list.insertBefore(lab, prog);
        }
        list.insertBefore(th, prog);
      }
      if (frac != null) { const b = $('#pg-bar'); if (b) b.style.width = Math.round(frac * 100) + '%'; }
      if (done) {
        const prog = list.querySelector('.pg-progress');
        if (prog) prog.remove();
        $('#pg-count').textContent = plural(pages.length, 'page') + ` · ${project.pageSize && project.pageSize.w ? project.pageSize.w + '×' + project.pageSize.h : '6×9'} in`;
        list.tabIndex = 0;
        listen();
        // start on the page I was reading
        let i = 0;
        if (at) {
          const order = Object.fromEntries(chapters.map((c, k) => [c.id, k]));
          const key = s => [order[s.cid] || 0, s.block, s.offset];
          const cmp = (a, b) => { for (let k = 0; k < 3; k++) if (a[k] !== b[k]) return a[k] - b[k]; return 0; };
          const want = key(at);
          pages.forEach((p, k) => { if (cmp(key(p.start), want) <= 0) i = k; });
        }
        if (!narrow()) pick(i, true);
        else { const t = list.querySelector(`.pthumb[data-i="${i}"]`); if (t) { t.classList.add('on'); t.scrollIntoView({ block: 'center' }); } sel = i; }
      }
    });
  }

  // ---------- laying out the book ----------
  // Calls each(page) as pages are made, then each(null, true) at the end.
  // alive() turns false when nobody wants the pages anymore (the pop-up or book closed).
  // margins: the book's own unless given (the iPhone book view uses phone-sized pages)
  async function layout(project, chapters, W, H, alive, each, margins) {
    const M = margins || { top: 0.75 * DPI, bottom: 0.8 * DPI, side: 0.7 * DPI };
    const host = document.createElement('div');
    host.className = 'page-measure';
    document.body.appendChild(host);
    const CW = W - 2 * M.side, CH = H - M.top - M.bottom;
    let pageNo = 0;
    let cur = null;
    const total = chapters.reduce((a, c) => a + c.html.length, 0) || 1;
    let doneChars = 0;
    let made = 0;

    function newPage(start, chapterTitle, chapterStart) {
      if (cur) finish();
      pageNo++;
      const el = document.createElement('div');
      el.className = 'bpage';
      el.style.width = W + 'px';
      el.style.height = H + 'px';
      el.innerHTML = `<div class="bcontent" style="left:${M.side}px;top:${M.top}px;width:${CW}px;height:${CH}px"></div><div class="bnum" style="bottom:${M.bottom * 0.45}px">${pageNo}</div>`;
      host.appendChild(el);
      cur = { el, content: el.firstChild, start, chapter: chapterTitle, chapterStart };
    }
    function finish() {
      host.removeChild(cur.el);
      each({ el: cur.el, start: cur.start, chapter: cur.chapter, chapterStart: cur.chapterStart }, false);
      made++;
      cur = null;
    }
    const fits = () => cur.content.scrollHeight <= cur.content.clientHeight + 1;
    const empty = () => !cur.content.childNodes.length || (cur.content.childNodes.length === 1 && cur.content.firstChild.classList.contains('bhead'));

    // A copy of letters [a, b) of paragraph `src`, keeping bold/italic.
    function piece(src, a, b, cls) {
      const r = document.createRange();
      const at = (off) => {
        const w = document.createTreeWalker(src, NodeFilter.SHOW_TEXT);
        let n, left = off, last = null;
        while ((n = w.nextNode())) { last = n; if (left <= n.nodeValue.length) return [n, left]; left -= n.nodeValue.length; }
        return last ? [last, last.nodeValue.length] : [src, src.childNodes.length];
      };
      const s = at(a), e = at(b);
      r.setStart(s[0], s[1]);
      r.setEnd(e[0], e[1]);
      const p = document.createElement('p');
      p.className = cls;
      p.appendChild(r.cloneContents());
      return p;
    }

    for (let ci = 0; ci < chapters.length; ci++) {
      const ch = chapters[ci];
      const title = ch.title || '';
      newPage({ cid: ch.id, block: 0, offset: 0 }, title || `Chapter ${ci + 1}`, true);
      cur.el.classList.add('first');
      if (title) {
        const h = document.createElement('div');
        h.className = 'bhead';
        h.textContent = title;
        cur.content.appendChild(h);
      } else {
        const sp = document.createElement('div');
        sp.className = 'bhead blank';
        cur.content.appendChild(sp);
      }
      const src = document.createElement('div');
      src.innerHTML = Editor.clean(ch.html, { plain: true });
      const blocks = Array.from(src.children);
      const L = Themes.norm(project.look);
      let afterBreak = true;
      for (let bi = 0; bi < blocks.length; bi++) {
        const b = blocks[bi];
        if (b.classList.contains('scene')) {
          const d = document.createElement('div');
          d.className = 'bscene';
          d.dataset.s = b.dataset.s || '';
          d.textContent = b.textContent;
          cur.content.appendChild(d);
          if (!fits()) { cur.content.removeChild(d); newPage({ cid: ch.id, block: bi, offset: 0 }, title); cur.content.appendChild(d); }
          afterBreak = true;
          continue;
        }
        // the paragraph's own alignment, or the project's (Appearance → Paragraphs); justified = no class
        const own = ['left', 'center', 'right', 'justify'].find(k => b.classList.contains(k)) || (L.align === 'left' ? 'left' : '');
        const al = own && own !== 'justify' ? own + ' ' : '';
        // the big first letter goes on the chapter's first paragraph
        const drop = L.dropcap && bi === 0 && !!b.textContent.trim();
        const cls = al + (drop ? 'drop noind' : afterBreak && L.indent === 'book' ? 'noind' : '');
        afterBreak = false;
        const p = b.cloneNode(true);
        p.className = cls;
        cur.content.appendChild(p);
        if (fits()) continue;
        cur.content.removeChild(p);
        // split the paragraph across pages
        const text = b.textContent;
        const N = text.length;
        let s = 0;
        let first = true;
        while (s < N) {
          const c = (first ? cls : al + 'noind cont');
          const whole = piece(b, s, N, c);
          cur.content.appendChild(whole);
          if (fits()) break;
          cur.content.removeChild(whole);
          // word ends after s
          const ends = [];
          const re = /\s+/g;
          let m;
          re.lastIndex = s;
          while ((m = re.exec(text))) if (m.index > s) ends.push(m.index);
          let lo = 0, hi = ends.length - 1, best = -1;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const part = piece(b, s, ends[mid], c);
            cur.content.appendChild(part);
            const ok = fits();
            cur.content.removeChild(part);
            if (ok) { best = mid; lo = mid + 1; } else hi = mid - 1;
          }
          if (best < 0) {
            if (empty()) { // not even one word fits on an empty page: just put it here
              cur.content.appendChild(whole);
              break;
            }
            newPage({ cid: ch.id, block: bi, offset: s }, title);
            continue;
          }
          cur.content.appendChild(piece(b, s, ends[best], c));
          let next = ends[best];
          while (next < N && /\s/.test(text[next])) next++;
          s = next;
          first = false;
          if (s < N) newPage({ cid: ch.id, block: bi, offset: s }, title);
        }
        if (made % 12 === 0) {
          // let the screen breathe on long books
          await new Promise(r => setTimeout(r, 0));
          if (!alive()) { host.remove(); return; }
        }
      }
      doneChars += ch.html.length;
      each(null, false, doneChars / total);
      await new Promise(r => setTimeout(r, 0));
      if (!alive()) { host.remove(); return; }
    }
    if (cur) finish();
    host.remove();
    each(null, true, 1);
  }

  // the page size of a project, in screen pixels
  const sizeOf = project => { const s = project.pageSize && project.pageSize.w ? project.pageSize : { w: 6, h: 9 }; return { W: Math.round(s.w * DPI), H: Math.round(s.h * DPI) }; };
  return { open, layout, sizeOf };
})();
