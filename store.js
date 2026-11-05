/* All database access lives here (and in demo.js, its stand-in for sample
   mode), so the screens only deal in plain objects.

   Firestore layout -- everything is under the one writer's own account:
     users/{uid}                    settings: { shelfView, night {mode, on}, spot, author, textSize }
     users/{uid}/projects/{pid}     { title, kind 'book'|'short', look, coverId, coverLink, pinterest,
                                      pageSize {w, h} (inches), sceneBreak, words, createdAt, updatedAt }
     users/{uid}/chapters/{cid}     { pid, title, order, html, words, notes (chapter notes),
                                      mnotes {id: {text, at}} (margin notes), updatedAt }
     users/{uid}/images/{iid}       { data (a compressed photo as a data URL) | enc (locked), w, h, pid }
     users/{uid}/chars/{id}         a character: { pid, order, name, nick, age, role, photoId, traits, personality,
                                      goals, fears, backstory, details [{label, value}], rels [{to, label}] }
     users/{uid}/events/{id}        a timeline event: { pid, order, title, when, text, chapters [cid], chars [id] }
     users/{uid}/pins/{id}          a vision-board photo: { pid, order, imageId, w, h, caption, chapters [cid], chars [id] }
                                    (locked projects: chars/events/pins are { pid, order, enc } -- see vault.js)
     users/{uid}/ideas/{id}         story ideas: { title, note, tags, pid (once started), createdAt }
     users/{uid}/pideas/{id}        ideas inside one project: { pid, title, text, kind, chapters [cid], chars [id], used, createdAt }
                                    (locked projects: { pid, createdAt, enc })
     users/{uid}/versions/{id}      chapter history (7 days) -- see editor.js
     users/{uid}/maps/{id}, places/{id}   the world map + its pins -- see worldmap.js
     users/{uid}/topics/{id}        research topics, shared by every project (never locked) -- see research.js
   settings also hold: writeDays {"2026-11-04": 1} (days she wrote), goal {kind, n}, lockin (see lockin.js)

   Writes are never awaited by the screens: with no internet they wait in the
   device's copy and go up on their own later. firestore.rules keeps it all
   to the one allowed Google account. */

const Store = (() => {
  const configured = typeof firebaseConfig !== 'undefined' && !/PASTE/.test(firebaseConfig.apiKey);
  if (!configured) return { configured: false };

  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();
  db.enablePersistence({ synchronizeTabs: true }).catch(e => console.warn('offline copy', e.code));

  const uid = () => auth.currentUser && auth.currentUser.uid;
  const U = () => db.collection('users').doc(uid());
  const col = name => U().collection(name);
  const docs = s => s.docs.map(d => ({ id: d.id, ...d.data() }));
  const quiet = p => p.catch(e => { console.error(e); if (Store.onError) Store.onError(e); });

  // ---- account ----
  const onUser = cb => auth.onAuthStateChanged(u => cb(u ? { uid: u.uid, email: u.email, name: u.displayName || '' } : null));
  async function signIn() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await auth.signInWithPopup(provider);
    } catch (e) {
      if (/popup-blocked|operation-not-supported/.test(e.code || '')) return auth.signInWithRedirect(provider);
      throw e;
    }
  }
  auth.getRedirectResult().catch(e => console.warn('redirect', e.code));
  const signOut = () => { stop(); return auth.signOut(); };

  // ---- live data ----
  // start(cb) keeps cb fed with { me, loaded, settings, projects [], ideas [], topics [] }
  let S = null, subs = [], cb = null, emitT = null;
  const emit = () => { clearTimeout(emitT); emitT = setTimeout(() => cb && cb(S), 15); };
  function start(onState) {
    stop();
    cb = onState;
    S = { me: uid(), loaded: false, settings: {}, projects: [], ideas: [], topics: [] };
    let got = 0;
    const done = () => { if (++got >= 4) S.loaded = true; };
    const fail = key => e => { console.warn('listen', key, e.code); if (Store.onError) Store.onError(e); };
    subs.push(U().onSnapshot(s => { S.settings = (s.exists && s.data()) || {}; if (!S._s) { S._s = 1; done(); } emit(); }, fail('me')));
    subs.push(col('projects').onSnapshot(s => { S.projects = docs(s); if (!S._p) { S._p = 1; done(); } emit(); }, fail('projects')));
    subs.push(col('ideas').onSnapshot(s => { S.ideas = docs(s); if (!S._i) { S._i = 1; done(); } emit(); }, fail('ideas')));
    subs.push(col('topics').onSnapshot(s => { S.topics = docs(s); if (!S._t) { S._t = 1; done(); } emit(); }, fail('topics')));
  }
  function stop() { subs.forEach(u => u()); subs = []; cb = null; }

  // The chapters of one project, while it's open. meta.pending = still waiting to go up.
  function watchChapters(pid, onChapters) {
    return col('chapters').where('pid', '==', pid).onSnapshot({ includeMetadataChanges: true }, s => {
      onChapters(docs(s).sort((a, b) => (a.order || 0) - (b.order || 0)), { pending: s.metadata.hasPendingWrites, cache: s.metadata.fromCache });
    }, e => { console.warn('chapters', e.code); if (Store.onError) Store.onError(e); });
  }
  // One-time read of every chapter of a project (for export).
  const chaptersOf = pid => col('chapters').where('pid', '==', pid).get().then(s => docs(s).sort((a, b) => (a.order || 0) - (b.order || 0)));

  // ---- settings ----
  const saveSettings = patch => quiet(U().set(patch, { merge: true }));

  // ---- projects ----
  function createProject(p, firstChapters) {
    const ref = col('projects').doc();
    const now = Date.now();
    const batch = db.batch();
    batch.set(ref, { words: 0, createdAt: now, updatedAt: now, ...p });
    (firstChapters || []).forEach((c, i) => batch.set(col('chapters').doc(), { pid: ref.id, order: i + 1, html: '', words: 0, notes: '', mnotes: {}, updatedAt: now, ...c }));
    quiet(batch.commit());
    return ref.id;
  }
  const saveProject = (pid, patch) => quiet(col('projects').doc(pid).update(patch));
  async function deleteProject(p) {
    const chs = await chaptersOf(p.id);
    const refs = chs.map(c => col('chapters').doc(c.id));
    for (const name of ['chars', 'events', 'pins', 'pideas', 'maps', 'places', 'versions']) {
      const s = await col(name).where('pid', '==', p.id).get();
      s.docs.forEach(d => refs.push(d.ref));
    }
    // research stays (it's shared) -- it just loses this project's tag
    const tagged = await col('topics').where('pids', 'array-contains', p.id).get();
    tagged.docs.forEach(d => quiet(d.ref.update({ pids: firebase.firestore.FieldValue.arrayRemove(p.id) })));
    const imgs = await col('images').where('pid', '==', p.id).get();
    imgs.docs.forEach(d => { if (d.id !== p.coverId) refs.push(d.ref); });
    if (p.coverId) refs.push(col('images').doc(p.coverId));
    refs.push(col('projects').doc(p.id));
    for (let i = 0; i < refs.length; i += 400) {
      const batch = db.batch();
      refs.slice(i, i + 400).forEach(r => batch.delete(r));
      quiet(batch.commit());
    }
  }

  // ---- chapters ----
  function addChapters(pid, list) {
    const now = Date.now();
    const ids = [];
    for (let i = 0; i < list.length; i += 400) {
      const batch = db.batch();
      list.slice(i, i + 400).forEach(c => {
        const ref = col('chapters').doc();
        ids.push(ref.id);
        batch.set(ref, { pid, html: '', words: 0, notes: '', mnotes: {}, updatedAt: now, ...c });
      });
      quiet(batch.commit());
    }
    return ids;
  }
  const saveChapter = (cid, patch) => quiet(col('chapters').doc(cid).update({ ...patch, updatedAt: Date.now() }));
  const deleteChapters = cids => {
    const batch = db.batch();
    cids.forEach(id => batch.delete(col('chapters').doc(id)));
    return quiet(batch.commit());
  };
  // [{id, order}] in one go
  const orderChapters = list => {
    const batch = db.batch();
    list.forEach(c => batch.update(col('chapters').doc(c.id), { order: c.order }));
    return quiet(batch.commit());
  };

  // ---- photos ----
  const imgCache = {};
  function putImage(img) {
    const ref = col('images').doc();
    imgCache[ref.id] = img.data;
    quiet(ref.set(img));
    return ref.id;
  }
  // The copy already saved on this device first (no waiting on the internet), then a quiet check
  // with the database in the background that refreshes the device copy. Only a photo this device
  // has never seen waits for the download. (A changed photo is always saved as a new one.)
  function imageSnap(id) {
    const ref = col('images').doc(id);
    return ref.get({ source: 'cache' })
      .then(s => { if (!s.exists) throw new Error('not here'); ref.get({ source: 'server' }).catch(() => {}); return s; })
      .catch(() => ref.get());
  }
  function getImage(id) {
    if (!id) return Promise.resolve('');
    if (imgCache[id]) return Promise.resolve(imgCache[id]);
    return imageSnap(id).then(s => (imgCache[id] = (s.exists && s.data().data) || '')).catch(() => '');
  }
  const deleteImage = id => { delete imgCache[id]; return quiet(col('images').doc(id).delete()); };
  // the whole entry (a locked photo has enc instead of data)
  const getImageDoc = id => (id ? imageSnap(id).then(s => (s.exists ? s.data() : null)).catch(() => null) : Promise.resolve(null));
  const saveImage = (id, patch) => { delete imgCache[id]; return quiet(col('images').doc(id).set(patch)); };

  // ---- characters, timeline events, board photos (one project at a time) ----
  function watchCol(name, pid, cb) {
    return col(name).where('pid', '==', pid).onSnapshot(s => cb(docs(s).sort((a, b) => (a.order || 0) - (b.order || 0))), e => { console.warn(name, e.code); if (Store.onError) Store.onError(e); });
  }
  const listCol = (name, pid) => col(name).where('pid', '==', pid).get().then(s => docs(s).sort((a, b) => (a.order || 0) - (b.order || 0)));
  const addDoc = (name, data) => { const ref = col(name).doc(); quiet(ref.set({ createdAt: Date.now(), ...data })); return ref.id; };
  const saveDoc = (name, id, patch) => quiet(col(name).doc(id).update(patch));
  const setDoc = (name, id, data) => quiet(col(name).doc(id).set(data)); // replaces the whole entry
  const deleteDoc = (name, id) => quiet(col(name).doc(id).delete());
  const orderDocs = (name, list) => { const b = db.batch(); list.forEach(x => b.update(col(name).doc(x.id), { order: x.order })); return quiet(b.commit()); };

  // ---- story ideas ----
  const addIdea = i => { const ref = col('ideas').doc(); quiet(ref.set({ createdAt: Date.now(), ...i })); return ref.id; };
  const saveIdea = (id, patch) => quiet(col('ideas').doc(id).update(patch));
  const deleteIdea = id => quiet(col('ideas').doc(id).delete());

  // ---- storage used (Settings) ----
  // Firestore doesn't report it to the app, so this adds up every entry's size the way
  // Firestore counts it (the text of the entry + its name + a little overhead), about.
  // Photos are read 100 at a time so a big library doesn't fill the phone's memory.
  const COLS = ['projects', 'chapters', 'images', 'ideas', 'chars', 'events', 'pins', 'pideas', 'topics', 'maps', 'places', 'versions'];
  const sizeOf = (id, data) => new Blob([JSON.stringify(data)]).size + id.length + 48;
  async function usage() {
    let photos = 0, other = 0;
    const me = await U().get();
    other += me.exists ? sizeOf(me.id, me.data()) : 0;
    for (const name of COLS) {
      let last = null;
      for (;;) {
        let q = col(name).orderBy(firebase.firestore.FieldPath.documentId()).limit(100);
        if (last) q = q.startAfter(last);
        const snap = await q.get({ source: 'server' });
        snap.docs.forEach(d => { const n = sizeOf(d.id, d.data()); if (name === 'images') photos += n; else other += n; });
        if (snap.size < 100) break;
        last = snap.docs[snap.docs.length - 1];
      }
    }
    return { photos, other };
  }

  return {
    configured: true, usage, onUser, signIn, signOut, start, stop, watchChapters, chaptersOf, saveSettings,
    createProject, saveProject, deleteProject, addChapters, saveChapter, deleteChapters, orderChapters,
    putImage, getImage, deleteImage, getImageDoc, saveImage, watchCol, listCol, addDoc, saveDoc, setDoc, deleteDoc, orderDocs, addIdea, saveIdea, deleteIdea,
  };
})();
