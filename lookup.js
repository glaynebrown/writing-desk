/* Look up one word: Meaning · Similar · Opposite · Related.

   Only the single word ever leaves the device -- never the sentence around it,
   the chapter, or the project's name. Two free services answer:
     Datamuse (api.datamuse.com)        similar, opposite and related words
     Free Dictionary (dictionaryapi.dev) meanings (Datamuse's short meanings if it has none)
   Requests go out with no referrer, so they don't even say which page asked. */

const Lookup = (() => {
  const { $, esc, icon, popover, closePopover } = UI;

  // one word: letters, with ' or - inside (don't, well-worn). Anything else is refused.
  const ONE = /^[\p{L}][\p{L}'’\-]*$/u;
  const tidy = s => String(s || '').trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  const isWord = s => ONE.test(tidy(s)) && tidy(s).length <= 40;

  const TABS = [['meaning', 'Meaning'], ['similar', 'Similar'], ['opposite', 'Opposite'], ['related', 'Related']];
  const memo = new Map();
  const get = url => fetch(url, { referrerPolicy: 'no-referrer', credentials: 'omit' }).then(r => (r.ok ? r.json() : null));

  async function fetchTab(word, tab) {
    const k = tab + ':' + word.toLowerCase();
    if (memo.has(k)) return memo.get(k);
    const w = encodeURIComponent(word.toLowerCase());
    let out;
    if (tab === 'meaning') {
      const d = await get(`https://api.dictionaryapi.dev/api/v2/entries/en/${w}`).catch(() => null);
      out = [];
      if (Array.isArray(d)) {
        const by = {};
        for (const e of d) for (const m of e.meanings || []) {
          const list = (by[m.partOfSpeech] = by[m.partOfSpeech] || []);
          for (const x of m.definitions || []) if (list.length < 4) list.push({ def: x.definition, ex: x.example || '' });
        }
        out = Object.entries(by).map(([pos, defs]) => ({ pos, defs }));
      }
      if (!out.length) {
        const dm = await get(`https://api.datamuse.com/words?sp=${w}&md=d&max=1`);
        const defs = (dm && dm[0] && dm[0].defs) || [];
        const by = {};
        const POS = { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb' };
        for (const line of defs) { const [p, def] = line.split('\t'); (by[POS[p] || p] = by[POS[p] || p] || []).push({ def, ex: '' }); }
        out = Object.entries(by).map(([pos, list]) => ({ pos, defs: list.slice(0, 4) }));
      }
    } else {
      const rel = { similar: 'ml', opposite: 'rel_ant', related: 'rel_trg' }[tab];
      const d = await get(`https://api.datamuse.com/words?${rel}=${w}&max=40`);
      out = (d || []).map(x => x.word).filter(x => x.toLowerCase() !== word.toLowerCase());
    }
    memo.set(k, out);
    return out;
  }

  // Match the capitals of the word being replaced (Cold → Chilly, COLD → CHILLY).
  function caseLike(from, to) {
    if (from.length > 1 && from === from.toUpperCase()) return to.toUpperCase();
    if (from[0] === from[0].toUpperCase() && from[0] !== from[0].toLowerCase()) return to[0].toUpperCase() + to.slice(1);
    return to;
  }

  /* open({ rect, word, onSwap(newWord) })
     rect: where to show it. onSwap: given when there's a word in the writing to replace. */
  function open(opts) {
    let word = tidy(opts.word || '');
    let tab = 'meaning';
    let asked = 0;
    const anchor = { getBoundingClientRect: () => opts.rect, contains: () => false };
    const pop = popover(anchor, `<div class="lk">
      <form class="lk-head" autocomplete="off"><input class="input lk-in" value="${esc(word)}" placeholder="Type a word" spellcheck="false" autocapitalize="off"><button class="mini" title="Look it up" aria-label="Look it up">${icon('lookup')}</button></form>
      <div class="lk-tabs">${TABS.map(([id, n]) => `<button type="button" data-lt="${id}" class="${id === tab ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="lk-body"></div>
      <p class="pop-hint lk-hint"></p>
    </div>`, () => {});
    pop.classList.add('lk-pop');
    const body = $('.lk-body', pop), input = $('.lk-in', pop);
    const hint = () => { $('.lk-hint', pop).textContent = tab === 'meaning' || !word ? 'Only this one word is sent to look it up.' : opts.onSwap ? 'Tap a word to swap it in.' : 'Tap a word to look it up.'; };

    async function show() {
      $$tabs();
      hint();
      if (!word) { body.innerHTML = '<p class="lk-msg">Type one word above.</p>'; return; }
      if (!isWord(word)) { body.innerHTML = '<p class="lk-msg">One word at a time.</p>'; return; }
      if (!navigator.onLine) { body.innerHTML = '<p class="lk-msg">Needs a connection.</p>'; return; }
      const mine = ++asked;
      body.innerHTML = '<p class="lk-msg">Looking…</p>';
      let res;
      try { res = await fetchTab(word, tab); } catch (e) { res = null; }
      if (mine !== asked || !pop.isConnected) return;
      if (res == null) { body.innerHTML = '<p class="lk-msg">Couldn’t reach the word lookup. Try again in a moment.</p>'; return; }
      if (!res.length) { body.innerHTML = `<p class="lk-msg">Nothing found for “${esc(word)}”.</p>`; return; }
      body.innerHTML = tab === 'meaning'
        ? res.map(g => `<div class="lk-pos"><b>${esc(g.pos)}</b><ol>${g.defs.map(d => `<li>${esc(d.def)}${d.ex ? `<i>“${esc(d.ex)}”</i>` : ''}</li>`).join('')}</ol></div>`).join('')
        : `<div class="lk-words">${res.map(w => `<button type="button" class="chip" data-w="${esc(w)}">${esc(w)}</button>`).join('')}</div>`;
    }
    function $$tabs() { pop.querySelectorAll('[data-lt]').forEach(b => b.classList.toggle('on', b.dataset.lt === tab)); }

    pop.addEventListener('click', e => {
      const t = e.target.closest('[data-lt]');
      if (t) { tab = t.dataset.lt; return show(); }
      const w = e.target.closest('[data-w]');
      if (w) {
        if (opts.onSwap) { closePopover(); opts.onSwap(caseLike(opts.word ? tidy(opts.word) : w.dataset.w, w.dataset.w)); }
        else { word = w.dataset.w; input.value = word; tab = 'meaning'; show(); }
      }
    });
    $('.lk-head', pop).addEventListener('submit', e => {
      e.preventDefault();
      const v = tidy(input.value);
      if (v !== word) { word = v; opts.onSwap = null; } // a different word typed: nothing to swap
      show();
    });
    show();
    if (!word) setTimeout(() => input.focus(), 30);
    return pop;
  }

  return { open, isWord, tidy };
})();
