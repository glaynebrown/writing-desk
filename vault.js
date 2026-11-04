/* The true lock. Locked projects are scrambled on this device (AES-256-GCM)
   before anything is saved, so the database only ever holds gibberish.

   How the keys fit together:
     - one random "master key" scrambles every locked project
     - the master key itself is stored scrambled twice in settings.lock:
         passWrap -- opened by the passphrase
         recWrap  -- opened by the recovery key (shown once, at set-up)
     - the passphrase and recovery key are never saved anywhere
   While unlocked, the master key lives only in this page's memory; locking
   (or closing the app) forgets it.

   A locked chapter is saved as { pid, order, enc: "q1:<iv>:<data>" } where
   the scrambled data holds { title, html, words, notes, mnotes }. Characters,
   timeline events, board photos and project ideas are saved as { pid, order, createdAt, enc }
   with everything else inside enc; a locked photo is { pid, w, h, enc }.
   (The cover stays readable -- it shows on the library shelf.)

   Vault.wrap(api) gives the screens the same database calls as store.js,
   scrambling and unscrambling locked chapters on the way through. */

const Vault = (() => {
  const ITER = 600000;
  const enc = new TextEncoder(), dec = new TextDecoder();
  // (in pieces: spreading a whole photo's bytes at once is too much for the browser)
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const rand = n => crypto.getRandomValues(new Uint8Array(n));

  let key = null;     // the master key, while unlocked
  let raw = null;     // its bytes (to re-scramble it when the passphrase changes)
  let info = null;    // settings.lock
  const listeners = new Set();
  const before = new Set();
  const changed = () => listeners.forEach(f => f(!!key));

  // ---- key helpers ----
  async function kek(secret, salt, iter) {
    const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function wrapWith(secret, bytes, iter) {
    const salt = rand(16), iv = rand(12);
    const k = await kek(secret, salt, iter);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, bytes));
    return { salt: b64(salt), iv: b64(iv), ct: b64(ct), iter };
  }
  async function unwrapWith(secret, w) {
    const k = await kek(secret, unb64(w.salt), w.iter || ITER);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(w.iv) }, k, unb64(w.ct)));
  }
  async function useRaw(bytes) {
    raw = bytes;
    key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
    poke();
    changed();
  }

  // Recovery key: 20 random bytes as 8 groups of 4 letters/numbers.
  const ABC = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  function makeCode() {
    const bytes = rand(20);
    let bits = '', out = '';
    for (const b of bytes) bits += b.toString(2).padStart(8, '0');
    for (let i = 0; i < bits.length; i += 5) out += ABC[parseInt(bits.slice(i, i + 5), 2)];
    return out.match(/.{4}/g).join('-');
  }
  const cleanCode = s => String(s || '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V').replace(/[^0-9A-Z]/g, '');

  // ---- public: set up, unlock, lock ----
  const isSetUp = () => !!(info && info.passWrap);
  const isOpen = () => !!key;
  function setInfo(lock) { info = lock || null; }

  // -> { lock (save it in settings), code (show it once) }
  async function setup(pass) {
    const bytes = rand(32);
    const code = makeCode();
    const lock = { v: 1, passWrap: await wrapWith(pass, bytes, ITER), recWrap: await wrapWith(cleanCode(code), bytes, 100000), at: Date.now() };
    info = lock;
    await useRaw(bytes);
    return { lock, code };
  }
  async function unlock(pass) {
    if (!isSetUp()) return false;
    try { await useRaw(await unwrapWith(pass, info.passWrap)); return true; } catch (e) { return false; }
  }
  // forgot the passphrase: the recovery key opens it, and a new passphrase replaces the old
  async function recover(code, newPass) {
    if (!isSetUp() || !info.recWrap) return null;
    let bytes;
    try { bytes = await unwrapWith(cleanCode(code), info.recWrap); } catch (e) { return null; }
    const lock = { ...info, passWrap: await wrapWith(newPass, bytes, ITER), at: Date.now() };
    info = lock;
    await useRaw(bytes);
    return lock;
  }
  async function changePass(oldPass, newPass) {
    let bytes;
    try { bytes = await unwrapWith(oldPass, info.passWrap); } catch (e) { return null; }
    const lock = { ...info, passWrap: await wrapWith(newPass, bytes, ITER), at: Date.now() };
    info = lock;
    await useRaw(bytes);
    return lock;
  }
  function lock() {
    if (!key) return;
    // save anything unsaved while the key is still here
    before.forEach(f => { try { f(); } catch (e) { console.error(e); } });
    key = null;
    if (raw) raw.fill(0);
    raw = null;
    memo.clear();
    changed();
  }
  const onChange = f => { listeners.add(f); return () => listeners.delete(f); };
  const onBeforeLock = f => { before.add(f); return () => before.delete(f); };

  // ---- auto-lock ----
  let idleMin = 0, last = Date.now(), hiddenAt = 0;
  const poke = () => { last = Date.now(); };
  function setIdle(min) { idleMin = Number(min) || 0; poke(); }
  ['keydown', 'pointerdown', 'input', 'scroll'].forEach(ev => window.addEventListener(ev, poke, { passive: true, capture: true }));
  setInterval(() => { if (key && idleMin && Date.now() - last > idleMin * 60000) lock(); }, 10000);
  // Leaving the app (closing it, or switching away for more than half a minute) locks it.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (key && hiddenAt && Date.now() - hiddenAt > 30000) lock();
  });
  window.addEventListener('pagehide', lock);

  // ---- scrambling ----
  async function seal(obj, k = key) {
    if (!k) throw new Error('Locked — enter your passphrase first.');
    const iv = rand(12);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(JSON.stringify(obj))));
    return 'q1:' + b64(iv) + ':' + b64(ct);
  }
  const memo = new Map();
  async function open(str) {
    if (memo.has(str)) return memo.get(str);
    const k = key;
    if (!k) throw new Error('Locked');
    const [, iv, ct] = str.split(':');
    const obj = JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, k, unb64(ct))));
    memo.set(str, obj);
    return obj;
  }

  // ---- the database calls, with locked chapters scrambled ----
  const SECRET = ['title', 'html', 'words', 'notes', 'mnotes', 'special'];
  const BLANK = { title: '', html: '', words: 0, notes: '', mnotes: {}, special: '' };
  const pick = c => ({ title: c.title || '', html: c.html || '', words: c.words || 0, notes: c.notes || '', mnotes: c.mnotes || {}, special: c.special || '' });
  const sealed = async (c, k) => ({ ...BLANK, enc: await seal(pick(c), k) });

  function wrap(api, isLocked) {
    const plain = {}; // cid -> the chapter as I last knew it, unscrambled
    async function unpack(doc) {
      if (!doc.enc) return doc;
      const s = await open(doc.enc);
      const out = { ...doc, ...s };
      delete out.enc;
      return out;
    }
    const chains = {};
    const busy = {}; // cid -> saves still being scrambled (the database copy is older than mine)
    const W = Object.create(api);
    W.watchChapters = (pid, cb) => {
      if (!isLocked(pid)) return api.watchChapters(pid, cb);
      let n = 0;
      return api.watchChapters(pid, async (list, meta) => {
        const mine = ++n;
        if (!key) return;
        try {
          let out = await Promise.all(list.map(unpack));
          if (mine !== n) return; // a newer list arrived meanwhile
          // a chapter still being scrambled: keep my newer copy, not the older saved one
          out = out.map(c => (busy[c.id] && plain[c.id] ? { ...c, ...plain[c.id] } : c));
          out.forEach(c => { if (!busy[c.id]) plain[c.id] = { ...c }; });
          cb(out, meta);
        } catch (e) { console.warn('unlock chapter', e); }
      });
    };
    W.chaptersOf = async pid => {
      const list = await api.chaptersOf(pid);
      if (!isLocked(pid)) return list;
      const out = await Promise.all(list.map(unpack));
      out.forEach(c => { plain[c.id] = { ...c }; });
      return out;
    };
    // returns the new ids (a Promise when the project is locked)
    W.addChapters = (pid, list) => {
      if (!isLocked(pid)) return api.addChapters(pid, list);
      return Promise.all(list.map(async c => ({ ...c, ...(await sealed(c)) }))).then(rows => {
        const ids = api.addChapters(pid, rows.map(r => { const o = { ...r }; SECRET.forEach(k => { o[k] = BLANK[k]; }); return o; }));
        ids.forEach((id, i) => { plain[id] = { ...list[i], id, pid }; });
        return ids;
      });
    };
    W.saveChapter = (cid, patch) => {
      const cur = plain[cid];
      if (!cur || !isLocked(cur.pid)) return api.saveChapter(cid, patch);
      Object.assign(cur, patch);
      const k = key; // taken now, so a save made just before locking still goes through
      const others = Object.fromEntries(Object.entries(patch).filter(([k]) => !SECRET.includes(k)));
      // one at a time per chapter, so an older save never lands after a newer one
      // (the scrambling waits its turn; the save itself isn't awaited, so it works offline)
      busy[cid] = (busy[cid] || 0) + 1;
      chains[cid] = (chains[cid] || Promise.resolve())
        .then(async () => { api.saveChapter(cid, { ...others, ...(await sealed(cur, k)) }); })
        .catch(e => console.error(e))
        .then(() => { busy[cid]--; });
      return chains[cid];
    };
    // ---- characters, events, board photos ----
    const OPEN = ['pid', 'order', 'createdAt'];
    async function unpackDoc(d) {
      if (!d.enc) return d;
      const s = await open(d.enc);
      return { ...s, id: d.id, pid: d.pid, order: d.order, createdAt: d.createdAt };
    }
    async function packDoc(d, k) {
      const inside = Object.fromEntries(Object.entries(d).filter(([key]) => key !== 'id' && !OPEN.includes(key)));
      const out = { enc: await seal(inside, k) };
      OPEN.forEach(key => { if (d[key] != null) out[key] = d[key]; });
      return out;
    }
    W.watchCol = (name, pid, cb) => {
      if (!isLocked(pid)) return api.watchCol(name, pid, cb);
      let n = 0;
      return api.watchCol(name, pid, async list => {
        const mine = ++n;
        if (!key) return;
        try { const out = await Promise.all(list.map(unpackDoc)); if (mine === n) cb(out); } catch (e) { console.warn('unlock', name, e); }
      });
    };
    W.listCol = async (name, pid) => {
      const list = await api.listCol(name, pid);
      return isLocked(pid) ? Promise.all(list.map(unpackDoc)) : list;
    };
    // data must hold pid. Returns the id (a Promise when locked).
    W.addDoc = (name, data) => {
      if (!isLocked(data.pid)) return api.addDoc(name, data);
      const k = key;
      return packDoc({ createdAt: Date.now(), ...data }, k).then(p => api.addDoc(name, p));
    };
    // full: the whole entry (with pid), not just what changed
    const docChains = {};
    W.saveDoc = (name, id, full) => {
      if (!isLocked(full.pid)) return api.saveDoc(name, id, full);
      const k = key, c = name + id;
      docChains[c] = (docChains[c] || Promise.resolve()).then(async () => { api.setDoc(name, id, await packDoc(full, k)); }).catch(e => console.error(e));
      return docChains[c];
    };
    // photos: data URLs scrambled when the project is locked (never the cover)
    const pics = {};
    W.putImage = img => {
      if (!img.pid || !isLocked(img.pid) || img.cover) { const o = { ...img }; delete o.cover; return api.putImage(o); }
      const k = key;
      return seal(img.data, k).then(enc => { const id = api.putImage({ pid: img.pid, w: img.w || 0, h: img.h || 0, enc }); pics[id] = img.data; return id; });
    };
    W.getImage = async id => {
      if (!id) return '';
      if (pics[id]) return pics[id];
      const d = await api.getImageDoc(id);
      if (!d) return '';
      if (!d.enc) return d.data || '';
      if (!key) return '';
      try { return (pics[id] = await open(d.enc)); } catch (e) { return ''; }
    };
    onChange(isOpenNow => { if (!isOpenNow) Object.keys(pics).forEach(k => delete pics[k]); });

    // wait for scrambled saves still in progress
    W.settle = () => Promise.all([...Object.values(chains), ...Object.values(docChains)]);
    W.saveProject = (pid, patch) => {
      if (isLocked(pid) && 'words' in patch) patch = { ...patch, words: 0 };
      return api.saveProject(pid, patch);
    };
    // Lock or unlock a whole project's chapters (the project doc is changed by the caller).
    // extra: other photo ids of the project (an uploaded background)
    W.sealProject = async (pid, coverId, extra = []) => {
      const list = await api.chaptersOf(pid);
      for (const c of list) {
        if (c.enc) continue;
        api.saveChapter(c.id, await sealed(c)); // not awaited: offline it waits on the device and syncs later
      }
      for (const name of ['chars', 'events', 'pins', 'pideas', 'maps', 'places', 'versions']) {
        for (const d of await api.listCol(name, pid)) if (!d.enc) api.setDoc(name, d.id, await packDoc(d, key));
      }
      for (const id of await imageIds(pid, coverId, extra)) {
        const d = await api.getImageDoc(id);
        if (d && d.data && !d.enc) api.saveImage(id, { pid, w: d.w || 0, h: d.h || 0, enc: await seal(d.data) });
      }
    };
    // photos that belong to a project: board, character and map photos, and an uploaded background (not the cover)
    async function imageIds(pid, coverId, extra = []) {
      const ids = new Set(extra.filter(Boolean));
      for (const p of await W.listCol('pins', pid)) if (p.imageId) ids.add(p.imageId);
      for (const c of await W.listCol('chars', pid)) if (c.photoId) ids.add(c.photoId);
      for (const m of await W.listCol('maps', pid)) if (m.imageId) ids.add(m.imageId);
      ids.delete(coverId);
      return [...ids];
    }
    W.unsealProject = async (pid, coverId, extra = []) => {
      const list = await api.chaptersOf(pid);
      let words = 0;
      for (const c of list) {
        if (!c.enc) { words += c.words || 0; continue; }
        const s = await open(c.enc);
        words += s.words || 0;
        api.saveChapter(c.id, { ...pick(s), enc: '' });
      }
      const ids = await imageIds(pid, coverId, extra);
      for (const name of ['chars', 'events', 'pins', 'pideas', 'maps', 'places', 'versions']) {
        for (const d of await api.listCol(name, pid)) {
          if (!d.enc) continue;
          const plainDoc = await unpackDoc(d);
          const out = { ...plainDoc };
          delete out.id;
          api.setDoc(name, d.id, out);
        }
      }
      for (const id of ids) {
        const d = await api.getImageDoc(id);
        if (d && d.enc) api.saveImage(id, { pid, w: d.w || 0, h: d.h || 0, data: await open(d.enc) });
      }
      return words;
    };
    return W;
  }

  return { isSetUp, isOpen, setInfo, setup, unlock, recover, changePass, lock, onChange, onBeforeLock, setIdle, seal, open, wrap };
})();
