/* Small shared helpers: escaping, icons, toasts, pop-ups, photos, drag-to-reorder. */

const UI = (() => {
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (id, cls) => `<svg class="icon ${cls || ''}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} },
  };
  const num = n => Number(n || 0).toLocaleString('en-US');
  const wordsIn = text => (String(text || '').match(/[\p{L}\p{N}][\p{L}\p{N}’'\-]*/gu) || []).length;
  const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : (many || one + 's')}`;
  const narrow = () => window.matchMedia('(max-width: 760px)').matches;
  // this device's calendar day, like "2026-11-04"
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function ago(t) {
    if (!t) return '';
    const s = (Date.now() - t) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
    const d = Math.round(s / 86400);
    if (d === 1) return 'yesterday';
    if (d < 30) return `${d} days ago`;
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), ms || 2600);
  }
  function oops(e) { console.error(e); toast(e && e.message && e.message.length < 140 ? e.message : 'Something went wrong — try again.'); }

  // ---- small yes/no (or type-something) dialog ----
  function ask(title, body, ok = 'OK', opts = {}) {
    return new Promise(res => {
      const wrap = $('#dialog-wrap');
      $('#dialog').innerHTML = `<h2>${esc(title)}</h2>${body ? `<p>${body}</p>` : ''}
        ${opts.input != null ? `<input class="input" id="dlg-in" type="${opts.type || 'text'}" autocomplete="off" value="${esc(opts.input)}" placeholder="${esc(opts.placeholder || '')}">` : ''}
        <div class="row end">${opts.cancel === false ? '' : `<button class="btn quiet" data-r="0">${esc(opts.cancelLabel || 'Cancel')}</button>`}
        <button class="btn ${opts.danger ? 'danger' : ''}" data-r="1">${esc(ok)}</button></div>`;
      wrap.hidden = false;
      const inp = $('#dlg-in');
      setTimeout(() => (inp || $('#dialog [data-r="1"]')).focus(), 30);
      const done = v => { wrap.hidden = true; wrap.onclick = null; document.removeEventListener('keydown', key, true); res(v); };
      const key = e => {
        if (e.key === 'Escape') { e.stopPropagation(); done(opts.input != null ? null : false); }
        if (e.key === 'Enter' && inp && document.activeElement === inp) { e.preventDefault(); done(inp.value); }
      };
      document.addEventListener('keydown', key, true);
      wrap.onclick = e => {
        const b = e.target.closest('[data-r]');
        if (!b) return;
        if (opts.input != null) done(b.dataset.r === '1' ? inp.value : null);
        else done(b.dataset.r === '1');
      };
    });
  }

  // ---- slide-up sheet (one at a time) ----
  let sheetClose = null;
  function sheet(html, opts = {}) {
    if (sheetClose) closeSheet(true);
    // a fresh box every time, so the last sheet's click handlers (and their Save buttons) are gone
    const wrap = $('#sheet-wrap'), old = $('#sheet'), el = old.cloneNode(false);
    old.replaceWith(el);
    el.className = 'sheet ' + (opts.cls || '');
    el.innerHTML = `<button class="sheet-x" data-act="close" aria-label="Close">${icon('x')}</button>${html}`;
    wrap.hidden = false;
    document.body.classList.add('sheet-open');
    requestAnimationFrame(() => wrap.classList.add('show'));
    sheetClose = opts.onClose || (() => {});
    const onKey = e => { if (e.key === 'Escape' && $('#dialog-wrap').hidden) closeSheet(); };
    document.addEventListener('keydown', onKey);
    wrap._key = onKey;
    wrap.onclick = e => { if (e.target.closest('[data-act="close"]')) closeSheet(); };
    const first = el.querySelector('[autofocus]');
    if (first && !narrow()) setTimeout(() => first.focus(), 60);
    return el;
  }
  function closeSheet(quiet) {
    const wrap = $('#sheet-wrap');
    if (wrap.hidden) return;
    const f = sheetClose;
    sheetClose = null;
    document.removeEventListener('keydown', wrap._key);
    wrap.classList.remove('show');
    wrap.hidden = true;
    $('#sheet').innerHTML = '';
    document.body.classList.remove('sheet-open');
    if (f && !quiet) f();
  }
  const sheetOpen = () => !$('#sheet-wrap').hidden;

  // ---- little pop-over menu next to a button ----
  function popover(anchor, html, onPick) {
    closePopover();
    const pop = document.createElement('div');
    pop.className = 'popover';
    pop.innerHTML = html;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    let top = r.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    pop.addEventListener('mousedown', e => { if (!e.target.closest('input,textarea')) e.preventDefault(); });
    pop.addEventListener('click', e => {
      const b = e.target.closest('[data-pick]');
      if (b) { closePopover(); onPick(b.dataset.pick, b); }
    });
    setTimeout(() => {
      const off = e => { if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closePopover(); };
      document.addEventListener('pointerdown', off, true);
      pop._off = off;
    }, 0);
    return pop;
  }
  function closePopover() {
    $$('.popover').forEach(p => { document.removeEventListener('pointerdown', p._off, true); p.remove(); });
  }

  // ---- photos: shrink to a size the database can hold ----
  function readFile(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  }
  function loadImg(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That photo could not be opened.')); i.src = src; });
  }
  // -> { data (JPEG data URL), w, h }. Kept under ~700 KB so it fits in one database entry.
  async function prepPhoto(src, max = 1600, maxBytes = 700000) {
    if (src instanceof Blob) src = await readFile(src);
    const img = await loadImg(src);
    let w = img.naturalWidth || 1200, h = img.naturalHeight || 1800;
    let scale = Math.min(1, max / Math.max(w, h));
    for (let tries = 0; tries < 6; tries++) {
      const cw = Math.round(w * scale), ch = Math.round(h * scale);
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      const x = c.getContext('2d');
      x.fillStyle = '#ffffff';
      x.fillRect(0, 0, cw, ch);
      x.imageSmoothingQuality = 'high';
      x.drawImage(img, 0, 0, cw, ch);
      for (const q of [0.88, 0.8, 0.72]) {
        const data = c.toDataURL('image/jpeg', q);
        if (data.length < maxBytes) return { data, w: cw, h: ch };
      }
      scale *= 0.8;
    }
    throw new Error('That photo is too big — try a smaller one.');
  }
  // A drawing for a scene break -> { data (PNG data URL), w, h }: the lines only, on a see-through
  // background (light parts fade out), trimmed to the drawing. It's shown as a mask, tinted in the
  // text color, so only how dark each spot is matters.
  async function prepLineArt(src, max = 900) {
    if (src instanceof Blob) src = await readFile(src);
    const img = await loadImg(src);
    let w = img.naturalWidth || 600, h = img.naturalHeight || 200;
    const scale = Math.min(1, max / Math.max(w, h));
    w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, w, h);
    const px = x.getImageData(0, 0, w, h), d = px.data;
    const LO = 40, HI = 225; // darker than LO = solid line, lighter than HI = background
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let i = 0; i < d.length; i += 4) {
      const L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const a = Math.round(d[i + 3] * Math.max(0, Math.min(1, (HI - L) / (HI - LO))));
      d[i] = d[i + 1] = d[i + 2] = 0;
      d[i + 3] = a;
      if (a > 10) { const p = i / 4, px_ = p % w, py = (p - px_) / w; if (px_ < x0) x0 = px_; if (px_ > x1) x1 = px_; if (py < y0) y0 = py; if (py > y1) y1 = py; }
    }
    if (x1 < 0) throw new Error('That picture looks blank — try one with darker lines.');
    x.putImageData(px, 0, 0);
    const pad = 4;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    const data = out.toDataURL('image/png');
    if (data.length > 700000) return prepLineArt(src, Math.round(max * 0.7));
    return { data, w: out.width, h: out.height };
  }
  // many = true -> an array of files
  function pickFile(accept, many) {
    return new Promise(res => {
      const f = $('#file');
      f.value = '';
      f.accept = accept;
      f.multiple = !!many;
      f.onchange = () => res(many ? Array.from(f.files) : f.files[0] || null);
      f.click();
    });
  }

  // ---- drag to reorder ----
  // Mouse: just drag. Finger: press and hold first (so scrolling still works).
  function sortable(box, sel, opts) {
    let drag = null;
    const items = () => $$(sel, box);
    box.addEventListener('pointerdown', e => {
      const it = e.target.closest(sel);
      if (!it || !box.contains(it) || e.button > 0 || e.target.closest('input,textarea,[data-nodrag]')) return;
      const start = { x: e.clientX, y: e.clientY };
      const touch = e.pointerType !== 'mouse';
      let timer = null;
      const begin = () => {
        drag = { it, keys: null, moved: false };
        it.classList.add('dragging');
        box.classList.add('sorting');
        if (navigator.vibrate) navigator.vibrate(10);
      };
      if (touch) timer = setTimeout(begin, 380);
      const move = ev => {
        if (!drag) {
          const far = Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > 6;
          if (touch && far) { clearTimeout(timer); cleanup(); return; }
          if (!touch && far) begin(); else return;
        }
        ev.preventDefault();
        drag.moved = true;
        const others = items().filter(x => x !== drag.it);
        let before = null;
        if (opts.grid) {
          // cards in rows: drop next to whichever card the finger is over
          const over = others.find(o => { const r = o.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom; });
          if (over) {
            const r = over.getBoundingClientRect();
            const after = ev.clientX > r.left + r.width / 2;
            const ref = after ? over.nextSibling : over;
            if (ref !== drag.it && drag.it.nextSibling !== ref) over.parentNode.insertBefore(drag.it, ref);
          }
          return;
        }
        for (const o of others) {
          const r = o.getBoundingClientRect();
          const mid = opts.axis === 'x' ? r.left + r.width / 2 : r.top + r.height / 2;
          const pos = opts.axis === 'x' ? ev.clientX : ev.clientY;
          if (pos < mid) { before = o; break; }
        }
        const parent = drag.it.parentNode;
        if (before) { if (drag.it.nextSibling !== before) parent.insertBefore(drag.it, before); }
        else { const last = others[others.length - 1]; if (last && last.nextSibling !== drag.it) parent.insertBefore(drag.it, last.nextSibling); }
      };
      const up = () => {
        clearTimeout(timer);
        if (drag) {
          drag.it.classList.remove('dragging');
          box.classList.remove('sorting');
          if (drag.moved) {
            const stop = ev => { ev.preventDefault(); ev.stopPropagation(); };
            box.addEventListener('click', stop, { capture: true, once: true });
            setTimeout(() => box.removeEventListener('click', stop, true), 50);
            opts.onDrop(items().map(opts.key));
          }
        }
        drag = null;
        cleanup();
      };
      const cleanup = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
      };
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
    box.addEventListener('touchmove', e => { if (drag) e.preventDefault(); }, { passive: false });
    box.addEventListener('contextmenu', e => { if (drag) e.preventDefault(); });
  }

  // "Chapter Four" for books
  const ONES = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const numWord = n => n < 20 ? ONES[n] : n < 100 ? TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '') : String(n);

  function loadScript(src) {
    return new Promise((res, rej) => {
      if ($$('script').some(s => s.src === src)) return res();
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load a helper — check the internet connection.'));
      document.head.appendChild(s);
    });
  }

  return { $, $$, esc, icon, ls, num, wordsIn, plural, narrow, dayKey, ago, toast, oops, ask, sheet, closeSheet, sheetOpen, popover, closePopover, prepPhoto, prepLineArt, pickFile, sortable, numWord, loadScript };
})();
