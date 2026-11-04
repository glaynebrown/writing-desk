/* Sample mode: the same calls as store.js, kept in this browser only, with a
   pretend book and fic. Used while firebase-config.js still says PASTE, so the
   app can be tried (and previewed) without a database. */

const Demo = (() => {
  const KEY = 'qc-demo3';
  const clone = o => JSON.parse(JSON.stringify(o));
  const newId = () => Math.random().toString(36).slice(2, 12);
  let db = null, cb = null, userCb = null;
  const chapterWatchers = new Set();
  const colWatchers = new Set();
  const changedCols = name => { save(); colWatchers.forEach(w => w()); if (name === 'topics') changed(); };

  const P = [
    'The pines behind the cabin had a way of holding their breath before snow. Wren noticed it the way her father had taught her to notice everything out here: the hush first, then the cold, then the sky going the color of an old nickel.',
    'She set the kettle on the woodstove and counted the logs stacked by the door. Eleven. Enough for two nights if she was careful, one if the wind came off the ridge the way it had last winter.',
    'Down the hollow, a branch cracked. Not the sharp snap of ice, but the heavier, settling sound of weight shifting on old wood. Something was walking the deer trail, and it was not in a hurry.',
    'Wren reached for the rifle above the mantel without looking, her hand finding the cool stock the way it found the light switch in a house she no longer lived in.',
    '“You’re being dramatic,” she told the empty room, and the empty room, as usual, said nothing back.',
    'Outside, the first flakes came down slow and fat, catching in the porch light like moths. The tracks in the mud by the woodshed were already softening at the edges. Big. Fresh. Pointed toward the creek.',
    'She thought about the letter in her coat pocket, the one with the county seal, the one she had read four times and still could not make say anything different.',
    'By the time the kettle sang, she had laced her boots.',
  ];
  const para = i => `<p>${P[i % P.length]}</p>`;
  const chapterHtml = (n, breakAt) => Array.from({ length: n }, (_, i) => (i === breakAt ? '<div class="scene" data-s="fleuron">❦</div>' : '') + para(i)).join('');

  // A soft placeholder cover.
  function coverSvg() {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E9DCC4"/><stop offset="1" stop-color="#9DB09A"/></linearGradient></defs><rect width="600" height="900" fill="url(#g)"/><g fill="#3F5747" opacity=".85"><path d="M90 900 150 560 210 900z"/><path d="M180 900 260 480 340 900z"/><path d="M300 900 390 520 480 900z"/><path d="M420 900 490 600 560 900z"/></g><circle cx="430" cy="210" r="60" fill="#FFF6E2" opacity=".8"/><text x="300" y="300" text-anchor="middle" font-family="Georgia" font-size="56" fill="#2F3A2B">The Hollow</text><text x="300" y="365" text-anchor="middle" font-family="Georgia" font-size="56" fill="#2F3A2B">Pines</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function seed() {
    const now = Date.now();
    const out = { settings: { shelfView: 'case', night: { mode: 'toggle', on: false }, author: '' }, projects: {}, chapters: {}, images: {}, ideas: {} };
    out.images.cov1 = { data: coverSvg(), w: 600, h: 900, pid: 'pines' };
    out.projects.pines = { title: 'The Hollow Pines', kind: 'book', look: { preset: 'sage', title: 'fell', body: 'garamond', texture: 'parchment' }, coverId: 'cov1', pageSize: { w: 6, h: 9 }, sceneBreak: 'fleuron', words: 0, createdAt: now - 9e8, updatedAt: now - 3e6 };
    out.projects.fic = { title: 'Snowed In (untitled fic)', kind: 'short', look: { preset: 'rose', title: 'script', body: 'lora', texture: 'plain' }, coverId: '', pageSize: { w: 6, h: 9 }, sceneBreak: 'stars', words: 0, createdAt: now - 5e8, updatedAt: now - 9e6 };
    out.projects.letters = { title: 'Letters to the Lighthouse', kind: 'book', look: { preset: 'mist', title: 'cinzel', body: 'crimson', texture: 'linen' }, coverId: '', pageSize: { w: 6, h: 9 }, sceneBreak: 'asterism', words: 0, createdAt: now - 2e8, updatedAt: now - 2e8 };
    const ch = (pid, order, title, html, extra) => { out.chapters[newId()] = { pid, order, title, html, words: 0, notes: '', mnotes: {}, updatedAt: now, ...extra }; };
    ch('pines', 1, 'Chapter One', chapterHtml(24, 9), { notes: 'Wren finds the tracks. End on the boots — she is going out there.' });
    ch('pines', 2, 'Chapter Two', chapterHtml(30, 14));
    ch('pines', 3, 'Chapter Three', chapterHtml(18, -1));
    ch('fic', 1, 'Chapter 1', chapterHtml(12, 6));
    ch('letters', 1, 'Prologue', chapterHtml(6, -1));
    for (const c of Object.values(out.chapters)) c.words = (c.html.replace(/<[^>]+>/g, ' ').match(/[\p{L}\p{N}’']+/gu) || []).length;
    for (const [pid, p] of Object.entries(out.projects)) p.words = Object.values(out.chapters).filter(c => c.pid === pid).reduce((a, c) => a + c.words, 0);
    const pic = (a, b, emoji) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 ${emoji[1]}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="400" height="${emoji[1]}" fill="url(#g)"/><text x="200" y="${emoji[1] / 2 + 30}" font-size="90" text-anchor="middle">${emoji[0]}</text></svg>`);
    const pics = [['#DCE5D3', '#7F9874', ['🌲', 520]], ['#F2E6D0', '#C9A97E', ['🕯️', 400]], ['#D9E3EA', '#8DA3B5', ['❄️', 600]], ['#EAD9CC', '#A47D62', ['🦌', 460]], ['#E6E1D3', '#9A9273', ['🏚️', 380]], ['#E0E6DA', '#5F7553', ['🪵', 540]]];
    out.chars = {
      wren: { pid: 'pines', order: 1, name: 'Wren Hollis', nick: 'Birdie', age: '27', role: 'Main', photoId: '', traits: 'Dark braid, a scar through her left eyebrow, always in her father’s old coat.', personality: 'Stubborn, dry, talks to empty rooms.', goals: 'Keep the cabin. Find out what is walking the deer trail.', fears: 'Being the one who lets the land go.', backstory: 'Raised in the hollow by her father; left for the city at 18 and came back when he died.', details: [{ label: 'Hometown', value: 'Hollow Pines, VA' }], rels: [{ to: 'eli', label: 'older brother' }], createdAt: now },
      eli: { pid: 'pines', order: 2, name: 'Eli Hollis', nick: '', age: '31', role: 'Side', photoId: '', traits: '', personality: 'Charming, careful with money, careless with promises.', goals: 'Sell the land.', fears: '', backstory: '', details: [], rels: [{ to: 'wren', label: 'little sister' }], createdAt: now },
    };
    out.events = {
      e1: { pid: 'pines', order: 1, title: 'The county letter arrives', when: 'Day 1, morning', text: 'The letter says the land goes to auction unless the taxes are paid by spring.', chapters: [], chars: ['wren'], createdAt: now },
      e2: { pid: 'pines', order: 2, title: 'Wren finds the tracks', when: 'Day 1, first snow', text: '', chapters: [], chars: ['wren'], createdAt: now },
      e3: { pid: 'pines', order: 3, title: 'Eli shows up unannounced', when: 'Day 3', text: 'With a buyer’s card in his pocket.', chapters: [], chars: ['wren', 'eli'], createdAt: now },
    };
    out.pins = {};
    pics.forEach(([a, b, e], i) => { out.images['pic' + i] = { data: pic(a, b, e), w: 400, h: e[1], pid: 'pines' }; out.pins['pin' + i] = { pid: 'pines', order: i + 1, imageId: 'pic' + i, w: 400, h: e[1], caption: i === 0 ? 'The pines in the hollow' : '', chars: i === 3 ? ['wren'] : [], chapters: [], createdAt: now }; });
    out.ideas.i1 = { title: 'Lighthouse keeper’s daughter', note: 'Letters found in the wall of an old lighthouse — written to someone who never answered.', tags: 'mystery, romance', createdAt: now - 4e8 };
    out.ideas.i2 = { title: 'Found-family road trip fic', note: 'Five of them, one van, a wedding they are not invited to.', tags: 'fic', createdAt: now - 1e8 };
    out.pideas = {
      pi1: { pid: 'pines', title: 'Eli lies about the buyer', text: 'He says it’s a family from Richmond. It’s the timber company.', kind: 'Plot', chapters: [], chars: ['eli'], used: false, createdAt: now - 2e6 },
      pi2: { pid: 'pines', title: '“The land remembers who leaves.”', text: '', kind: 'Dialogue', chapters: [], chars: ['wren'], used: false, createdAt: now - 5e6 },
      pi3: { pid: 'pines', title: 'Open on the first snow', text: '', kind: 'Scene', chapters: [], chars: [], used: true, createdAt: now - 9e6 },
    };
    out.topics = {
      t1: { title: 'Field-dressing a deer', html: '<p>Work fast, keep the meat cool.</p><ul><li>Gloves, sharp knife, rope</li><li>Prop the body on its back, hind end downhill</li></ul><p>Hunters call it <i>field dressing</i>, not skinning — skinning comes later at the camp.</p>', links: [{ url: 'https://en.wikipedia.org/wiki/Field_dressing_(hunting)', label: 'Field dressing (Wikipedia)' }], photos: [], pids: ['pines'], createdAt: now - 7e6, updatedAt: now - 7e6 },
      t2: { title: 'Virginia property tax auctions', html: '<p>Delinquent taxes → the county can sell after two years.</p>', links: [], photos: [], pids: ['pines'], createdAt: now - 3e7, updatedAt: now - 3e7 },
      t3: { title: 'Lighthouse keepers’ logs', html: '<p>Daily entries: weather, oil used, ships passed.</p>', links: [], photos: [], pids: ['letters'], createdAt: now - 6e7, updatedAt: now - 6e7 },
    };
    const d = new Date(), key = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    out.settings.writeDays = {};
    [1, 2, 4, 5, 6, 9, 12].forEach(n => { const x = new Date(d); x.setDate(d.getDate() - n); out.settings.writeDays[key(x)] = 1; });
    return out;
  }
  function load() {
    if (db) return db;
    try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; }
    if (!db) { db = seed(); save(); }
    return db;
  }
  let saveT = null;
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.warn('sample save', e); } }, 100);
  }
  const list = obj => Object.entries(obj).map(([id, v]) => ({ id, ...clone(v) }));
  function changed(chapters) {
    save();
    if (cb) setTimeout(() => cb({ me: 'me', loaded: true, settings: clone(db.settings), projects: list(db.projects), ideas: list(db.ideas), topics: list(db.topics || {}) }), 0);
    if (chapters) chapterWatchers.forEach(w => w());
  }

  return {
    configured: true,
    sample: true,
    onUser(f) { userCb = f; load(); setTimeout(() => f({ uid: 'me', email: 'sample@quill', name: 'Writer' }), 0); return () => {}; },
    signIn() { return Promise.resolve(); },
    signOut() { localStorage.removeItem(KEY); db = null; location.reload(); return Promise.resolve(); },
    start(f) { cb = f; changed(); },
    stop() { cb = null; },
    watchChapters(pid, f) {
      const w = () => setTimeout(() => f(list(db.chapters).filter(c => c.pid === pid).sort((a, b) => a.order - b.order), { pending: false }), 0);
      chapterWatchers.add(w);
      w();
      return () => chapterWatchers.delete(w);
    },
    chaptersOf: pid => Promise.resolve(list(load().chapters).filter(c => c.pid === pid).sort((a, b) => a.order - b.order)),
    // (like Firestore's merge: writeDays adds days instead of replacing them)
    saveSettings(patch) { patch = clone(patch); if (patch.writeDays) patch.writeDays = { ...(db.settings.writeDays || {}), ...patch.writeDays }; Object.assign(db.settings, patch); changed(); return Promise.resolve(); },
    createProject(p, firsts) {
      const id = newId(), now = Date.now();
      db.projects[id] = { words: 0, createdAt: now, updatedAt: now, ...clone(p) };
      (firsts || []).forEach((c, i) => { db.chapters[newId()] = { pid: id, order: i + 1, html: '', words: 0, notes: '', mnotes: {}, updatedAt: now, ...clone(c) }; });
      changed(true);
      return id;
    },
    saveProject(pid, patch) { if (db.projects[pid]) Object.assign(db.projects[pid], clone(patch)); changed(); return Promise.resolve(); },
    deleteProject(p) {
      for (const [id, c] of Object.entries(db.chapters)) if (c.pid === p.id) delete db.chapters[id];
      for (const name of ['chars', 'events', 'pins', 'pideas', 'maps', 'places', 'versions']) for (const [id, x] of Object.entries(db[name] || {})) if (x.pid === p.id) delete db[name][id];
      for (const t of Object.values(db.topics || {})) t.pids = (t.pids || []).filter(x => x !== p.id);
      for (const [id, x] of Object.entries(db.images)) if (x.pid === p.id && id !== p.coverId) delete db.images[id];
      if (p.coverId) delete db.images[p.coverId];
      delete db.projects[p.id];
      changed(true);
      return Promise.resolve();
    },
    addChapters(pid, arr) {
      const now = Date.now();
      const ids = arr.map(c => { const id = newId(); db.chapters[id] = { pid, html: '', words: 0, notes: '', mnotes: {}, updatedAt: now, ...clone(c) }; return id; });
      changed(true);
      return ids;
    },
    saveChapter(cid, patch) { if (db.chapters[cid]) Object.assign(db.chapters[cid], clone(patch), { updatedAt: Date.now() }); changed(true); return Promise.resolve(); },
    deleteChapters(cids) { cids.forEach(id => delete db.chapters[id]); changed(true); return Promise.resolve(); },
    orderChapters(arr) { arr.forEach(c => { if (db.chapters[c.id]) db.chapters[c.id].order = c.order; }); changed(true); return Promise.resolve(); },
    putImage(img) { const id = newId(); db.images[id] = clone(img); save(); return id; },
    getImage: id => Promise.resolve((id && load().images[id] && db.images[id].data) || ''),
    deleteImage(id) { delete db.images[id]; save(); return Promise.resolve(); },
    getImageDoc: id => Promise.resolve((id && load().images[id] && clone(db.images[id])) || null),
    saveImage(id, patch) { db.images[id] = clone(patch); save(); return Promise.resolve(); },
    watchCol(name, pid, f) {
      const w = () => setTimeout(() => f(list(load()[name] || {}).filter(x => x.pid === pid).sort((a, b) => (a.order || 0) - (b.order || 0))), 0);
      colWatchers.add(w);
      w();
      return () => colWatchers.delete(w);
    },
    listCol: (name, pid) => Promise.resolve(list(load()[name] || {}).filter(x => x.pid === pid).sort((a, b) => (a.order || 0) - (b.order || 0))),
    addDoc(name, data) { const id = newId(); (db[name] = db[name] || {})[id] = { createdAt: Date.now(), ...clone(data) }; changedCols(name); return id; },
    saveDoc(name, id, patch) { if (db[name] && db[name][id]) Object.assign(db[name][id], clone(patch)); changedCols(name); return Promise.resolve(); },
    setDoc(name, id, data) { (db[name] = db[name] || {})[id] = clone(data); changedCols(name); return Promise.resolve(); },
    deleteDoc(name, id) { if (db[name]) delete db[name][id]; changedCols(name); return Promise.resolve(); },
    orderDocs(name, arr) { arr.forEach(x => { if (db[name] && db[name][x.id]) db[name][x.id].order = x.order; }); changedCols(name); return Promise.resolve(); },
    usage() {
      const size = o => new Blob([JSON.stringify(o)]).size;
      const photos = size(load().images);
      return Promise.resolve({ photos, other: size(db) - photos });
    },
    addIdea(i) { const id = newId(); db.ideas[id] = { createdAt: Date.now(), ...clone(i) }; changed(); return id; },
    saveIdea(id, patch) { if (db.ideas[id]) Object.assign(db.ideas[id], clone(patch)); changed(); return Promise.resolve(); },
    deleteIdea(id) { delete db.ideas[id]; changed(); return Promise.resolve(); },
  };
})();
