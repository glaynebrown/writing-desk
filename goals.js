/* The writing goal panel: how often she writes.

   Opened by the flame button next to the moon (My Library, Story Ideas,
   Settings and every project). On the Mac it slides in on the right and the
   page moves over to make room; on the iPhone it's a pop-up.

   A writing day = any writing or editing on a story's pages (editor.js tells
   app.js, which adds the date to settings.writeDays {"2026-11-04": 1}).
   settings.goal = { kind: 'row' (days in a row) | 'week' (days per week), n }
   Weeks start on Sunday. */

const Goals = (() => {
  const { $, $$, esc, icon, plural, narrow, sheet, closeSheet, sheetOpen, dayKey } = UI;
  let C = null;       // { settings(), save(patch) }
  let panel = null;
  let mode = '';      // '' | 'panel' | 'sheet'
  let month = null;   // first day of the month the calendar shows

  const days = () => (C && C.settings().writeDays) || {};
  const goal = () => (C && C.settings().goal) || null;
  const dayOf = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const weekStart = (d = new Date()) => { const x = dayOf(d, -d.getDay()); x.setHours(0, 0, 0, 0); return x; };

  // ---------- counting ----------
  function streak() {
    const w = days();
    let d = new Date();
    if (!w[dayKey(d)]) d = dayOf(d, -1); // today isn't over yet
    let n = 0;
    while (w[dayKey(d)]) { n++; d = dayOf(d, -1); }
    return n;
  }
  function thisWeek() {
    const w = days(), s = weekStart();
    let n = 0;
    for (let i = 0; i < 7; i++) if (w[dayKey(dayOf(s, i))]) n++;
    return n;
  }
  function best() {
    const list = Object.keys(days()).filter(k => days()[k]).sort();
    let top = 0, run = 0, prev = null;
    for (const k of list) {
      const d = new Date(k + 'T12:00:00');
      run = prev && Math.round((d - prev) / 864e5) === 1 ? run + 1 : 1;
      top = Math.max(top, run);
      prev = d;
    }
    return top;
  }
  function thisMonth() {
    const pre = dayKey().slice(0, 7);
    return Object.keys(days()).filter(k => days()[k] && k.startsWith(pre)).length;
  }
  const total = () => Object.keys(days()).filter(k => days()[k]).length;
  // { have, of, label, met }
  function progress() {
    const g = goal();
    if (g && g.kind === 'row') { const n = streak(); return { have: n, of: g.n, label: `${n === 1 ? 'day' : 'days'} in a row`, met: n >= g.n }; }
    if (g && g.kind === 'week') { const n = thisWeek(); return { have: n, of: g.n, label: 'days this week', met: n >= g.n }; }
    const n = thisWeek();
    return { have: n, of: 7, label: 'days this week', met: false, none: true };
  }
  // one line, for Settings
  function summary() {
    const g = goal(), p = progress();
    if (!g) return 'No goal yet.';
    return g.kind === 'row' ? `${plural(p.have, 'day')} in a row · goal ${g.n}${p.met ? ' — met' : ''}` : `This week: ${p.have} of ${g.n} days${p.met ? ' — met' : ''}`;
  }

  // ---------- drawing ----------
  function ring(p) {
    const R = 52, L = 2 * Math.PI * R, f = Math.min(1, p.of ? p.have / p.of : 0);
    return `<div class="gp-ring ${p.met ? 'met' : ''}">
      <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="${R}" class="gp-track"/><circle cx="60" cy="60" r="${R}" class="gp-fill" stroke-dasharray="${L}" stroke-dashoffset="${L * (1 - f)}" transform="rotate(-90 60 60)"/></svg>
      <div class="gp-ring-text"><b>${p.have}<small> of ${p.of}</small></b><span>${p.label}</span></div>
    </div>`;
  }
  function html() {
    const w = days(), g = goal() || { kind: '', n: 3 };
    const p = progress();
    const today = dayKey();
    const ws = weekStart();
    // this week
    const week = Array.from({ length: 7 }, (_, i) => { const d = dayOf(ws, i), k = dayKey(d); return `<span class="gp-dot ${w[k] ? 'wrote' : ''} ${k === today ? 'today' : ''} ${k > today ? 'later' : ''}"><i></i>${'SMTWTFS'[i]}</span>`; }).join('');
    // the month
    if (!month) { month = new Date(); month.setDate(1); }
    const y = month.getFullYear(), m = month.getMonth();
    const count = new Date(y, m + 1, 0).getDate();
    const cells = [...Array(month.getDay()).fill(''), ...Array.from({ length: count }, (_, i) => i + 1)];
    const max = g.kind === 'week' ? 7 : 365;
    return `<div class="gp-head"><h2>Writing goal</h2>
        <button class="gp-btn" data-gp="lockin" title="Lock in" aria-label="Lock in">${icon('hourglass')}</button>
        <button class="gp-btn" data-gp="close" title="Close" aria-label="Close">${icon('x')}</button></div>
      ${ring(p)}
      <p class="gp-note">${p.none ? 'No goal set — pick one below.' : p.met ? 'Goal met. Lovely.' : g.kind === 'row' && p.have && !w[today] ? 'Write today to keep it going.' : g.kind === 'row' ? `${g.n - p.have} more ${g.n - p.have === 1 ? 'day' : 'days'} to your goal.` : `${g.n - p.have} more ${g.n - p.have === 1 ? 'day' : 'days'} this week.`}</p>
      <div class="gp-sec"><h3>This week</h3><div class="gp-week">${week}</div></div>
      <div class="gp-sec"><div class="cal-head"><button class="mini" data-gm="-1" aria-label="Last month">${icon('back')}</button><b>${month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</b><button class="mini flip" data-gm="1" aria-label="Next month">${icon('back')}</button></div>
        <div class="cal-grid">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<span class="cal-dow">${d}</span>`).join('')}
          ${cells.map(d => { if (!d) return '<span></span>'; const k = dayKey(new Date(y, m, d)); return `<span class="cal-day ${w[k] ? 'wrote' : ''} ${k === today ? 'today' : ''}">${d}</span>`; }).join('')}</div></div>
      <div class="gp-nums"><div><b>${best()}</b><span>best streak</span></div><div><b>${thisMonth()}</b><span>days this month</span></div><div><b>${total()}</b><span>writing days</span></div></div>
      <div class="gp-sec gp-set"><h3>Your goal</h3>
        <div class="seg gp-kind" id="gl-kind"><button data-k="" class="${!g.kind ? 'on' : ''}">None</button><button data-k="row" class="${g.kind === 'row' ? 'on' : ''}">In a row</button><button data-k="week" class="${g.kind === 'week' ? 'on' : ''}">Per week</button></div>
        ${g.kind ? `<div class="gl-n"><span>Write</span><div class="sizer"><button data-n="-1" aria-label="Fewer">−</button><input id="gl-n" inputmode="numeric" value="${Math.min(g.n, max)}" aria-label="Days"><button data-n="1" aria-label="More">+</button></div><span>${g.kind === 'row' ? 'days in a row' : 'days a week'}</span></div>` : ''}
        <p class="hint">Any writing or editing on your story pages counts as a writing day — however long.</p></div>`;
  }

  // ---------- open / close ----------
  function init(ctx) {
    C = ctx;
    panel = document.createElement('aside');
    panel.className = 'gpanel';
    panel.id = 'gpanel';
    panel.setAttribute('aria-label', 'Writing goal');
    document.body.appendChild(panel);
    bind(panel);
    document.addEventListener('click', e => { if (e.target.closest('[data-act="goal"]')) toggle(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && mode === 'panel' && !sheetOpen() && $('#dialog-wrap').hidden) close(); });
    window.addEventListener('resize', () => { if (mode === 'panel' && narrow()) close(); });
  }
  // (a sheet closed by moving to another screen doesn't say so)
  const stale = () => { if (mode === 'sheet' && !sheetOpen()) mode = ''; };
  function toggle() { stale(); if (mode) close(); else open(); }
  function open() {
    month = null;
    if (narrow()) {
      mode = 'sheet';
      const el = sheet(`<div class="gp-body">${html()}</div>`, { cls: 'small goal-sheet', onClose: () => { mode = ''; paintButtons(); } });
      bind(el);
    } else {
      mode = 'panel';
      panel.innerHTML = `<div class="gp-body">${html()}</div>`;
      document.body.classList.add('gpanel-open');
      window.dispatchEvent(new Event('resize')); // the page moves over to make room
    }
    paintButtons();
  }
  function close() {
    if (mode === 'sheet') { mode = ''; closeSheet(true); }
    else if (mode === 'panel') {
      mode = '';
      document.body.classList.remove('gpanel-open');
      window.dispatchEvent(new Event('resize'));
    }
    paintButtons();
  }
  function redraw() {
    const box = mode === 'panel' ? panel : mode === 'sheet' ? $('#sheet') : null;
    const body = box && box.querySelector('.gp-body');
    if (!body || (document.activeElement && document.activeElement.id === 'gl-n')) return;
    const top = body.scrollTop;
    body.innerHTML = html();
    body.scrollTop = top;
  }
  function bind(root) {
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-gp]');
      if (b && b.dataset.gp === 'close') return close();
      if (b && b.dataset.gp === 'lockin') return Lockin.menu(b);
      const mm = e.target.closest('[data-gm]');
      if (mm) { month.setMonth(month.getMonth() + Number(mm.dataset.gm)); return redraw(); }
      const k = e.target.closest('[data-k]');
      const g = { kind: '', n: 3, ...(goal() || {}) };
      if (k) { g.kind = k.dataset.k; if (g.kind === 'week') g.n = Math.min(g.n, 7); return setGoal(g); }
      const n = e.target.closest('[data-n]');
      if (n) { g.n = Math.max(1, Math.min(g.kind === 'week' ? 7 : 365, g.n + Number(n.dataset.n))); return setGoal(g); }
    });
    root.addEventListener('change', e => {
      if (e.target.id !== 'gl-n') return;
      const g = { kind: '', n: 3, ...(goal() || {}) };
      const v = Math.round(Number(e.target.value));
      if (isFinite(v) && v > 0) g.n = Math.min(g.kind === 'week' ? 7 : 365, v);
      e.target.blur();
      setGoal(g);
    });
  }
  function setGoal(g) {
    C.save({ goal: g.kind ? { kind: g.kind, n: g.n } : null });
    redraw();
    paintButtons();
  }
  // the flame glows once the goal is met; it's "on" while the panel is open
  function paintButtons() {
    const met = !!goal() && progress().met;
    $$('[data-act="goal"]').forEach(b => { b.classList.toggle('met', met); b.classList.toggle('on', !!mode); });
  }
  // after the data or the screen changes
  function refresh() { stale(); if (mode) redraw(); paintButtons(); }

  return { init, open, close, refresh, summary };
})();
