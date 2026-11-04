/* Lock in: 30 minutes or an hour of just writing. Separate from the writing goal.

   While it runs, the writing page is in focus mode (no Esc, no "Leave focus")
   and a quiet countdown sits in the corner with Pause and End. Pausing gives
   the app back; the paused lock-in waits until the end of that day. When the
   time is up it just ends -- no sound, no word count.

   It's kept in settings.lockin, so pausing on the Mac and resuming on the
   iPhone works:
     { mode: 'run',   len, end (when it's over), pid, day }
     { mode: 'pause', len, left (ms still to go), pid, day }
     null -- not locked in */

const Lockin = (() => {
  const { esc, icon, ask, popover, closePopover, dayKey } = UI;
  const LENGTHS = [[30, '30 minutes'], [60, '1 hour']];
  let C = null; // { settings(), save(patch), pid(), go(hash), focus(on) }
  let chip = null, timer = null;

  function init(ctx) {
    C = ctx;
    chip = document.createElement('div');
    chip.className = 'lockin';
    chip.id = 'lockin';
    chip.hidden = true;
    document.body.appendChild(chip);
    chip.addEventListener('click', e => {
      const b = e.target.closest('[data-li]');
      if (!b) return;
      if (b.dataset.li === 'pause') pause();
      if (b.dataset.li === 'resume') resume();
      if (b.dataset.li === 'end') end();
    });
    timer = setInterval(tick, 1000);
  }

  const raw = () => (C && C.settings().lockin) || null;
  // the lock-in as it stands right now (one that ran out, or a paused one from another day, is over)
  function now() {
    const s = raw();
    if (!s || !s.mode) return null;
    if (s.mode === 'run' && Date.now() >= s.end) return null;
    if (s.mode === 'pause' && s.day !== dayKey()) return null;
    return s;
  }
  function set(v) { C.save({ lockin: v }); sync(); }

  function start(min) { set({ mode: 'run', len: min * 60000, end: Date.now() + min * 60000, pid: C.pid() || '', day: dayKey() }); }
  function pause() {
    const s = now();
    if (!s || s.mode !== 'run') return;
    set({ mode: 'pause', len: s.len, left: Math.max(0, s.end - Date.now()), pid: s.pid || '', day: dayKey() });
  }
  function resume() {
    const s = now();
    if (!s || s.mode !== 'pause') return;
    if (s.pid && C.pid() !== s.pid) C.go('#/p/' + s.pid);
    set({ mode: 'run', len: s.len, end: Date.now() + s.left, pid: s.pid || '', day: dayKey() });
  }
  async function end() {
    if (!now()) return;
    if (!(await ask('End your lock-in early?', '', 'End it', { cancelLabel: 'Keep going' }))) return;
    set(null);
  }

  // the toolbar button
  function menu(btn) {
    const s = now();
    let html;
    if (s && s.mode === 'run') html = `<p class="pop-title">Locked in · ${clock(s.end - Date.now())} left</p>
      <button class="pop-item" data-pick="pause">${icon('pause')} Pause</button><button class="pop-item" data-pick="end">${icon('stop')} End</button>`;
    else html = `${s ? `<button class="pop-item" data-pick="resume">${icon('play')} Resume · ${mins(s.left)} left</button><p class="pop-title" style="margin-top:12px">Or start over</p>` : '<p class="pop-title">Lock in for…</p>'}
      ${LENGTHS.map(([m, n]) => `<button class="pop-item" data-pick="${m}">${icon('hourglass')} ${n}</button>`).join('')}
      <p class="pop-hint">Just the page and a quiet timer. You can pause or end it any time.</p>`;
    popover(btn, html, pick => {
      if (pick === 'pause') pause();
      else if (pick === 'end') end();
      else if (pick === 'resume') resume();
      else start(Number(pick));
    });
  }

  const clock = ms => { const t = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  const mins = ms => { const m = Math.max(1, Math.round(ms / 60000)); return m === 1 ? '1 min' : m + ' min'; };

  function render() {
    if (!chip) return;
    const s = C && C.signedIn() ? now() : null;
    chip.hidden = !s;
    chip.classList.toggle('running', !!s && s.mode === 'run');
    if (!s) { chip.innerHTML = ''; return; }
    const html = s.mode === 'run'
      ? `${icon('hourglass')}<span class="li-time">${clock(s.end - Date.now())}</span><button data-li="pause" title="Pause" aria-label="Pause">${icon('pause')}</button><button data-li="end" title="End" aria-label="End">${icon('stop')}</button>`
      : `${icon('hourglass')}<span>Lock in paused · ${mins(s.left)} left</span><button class="li-go" data-li="resume">${icon('play')} Resume</button><button data-li="end" title="End" aria-label="End">${icon('x')}</button>`;
    if (chip.innerHTML !== html) chip.innerHTML = html;
  }
  function tick() {
    const s = raw();
    if (!s) return;
    if (!now()) { set(null); return; } // time's up (or a paused one from yesterday): it just ends, quietly
    if (s.mode === 'run') { const t = chip.querySelector('.li-time'); if (t) t.textContent = clock(s.end - Date.now()); }
  }
  // after the data or the screen changes
  function sync() {
    render();
    const s = now();
    C.focus(!!s && s.mode === 'run');
  }

  return { init, menu, sync };
})();
