# Writing Desk

A private writing desk for books and fics: a bookshelf of projects, each with
its own look, a book-style writing page, real 6×9 page previews, Word import
and EPUB export for Kindle. Works offline and syncs later.

Plain HTML/JS + Firebase (Google sign-in + Firestore). No build step: the
files in this folder are the whole site (GitHub Pages).

## Files
- `index.html`, `styles.css`: the page and its looks
- `themes.js`: colors, fonts, paper, night (sepia) mode, sunset times
- `app.js`: bookshelf, story ideas, settings, project menus
- `project.js`: the Characters, Timeline and Board tabs
- `editor.js`: the writing page (chapters, scene breaks, highlights, margin + chapter notes)
- `pages.js`: the Pages pop-up (real book pages)
- `io.js`: Word import, EPUB export
- `ui.js`: shared helpers
- `vault.js`: the true lock (passphrase + recovery key, AES-256-GCM on the device)
- `store.js`: the database (Firebase); `demo.js`: sample mode while `firebase-config.js` says PASTE
- `firestore.rules`: only the owner's Google account (deploy with `firebase deploy --only firestore:rules`)
- `sw.js`, `manifest.json`, icons: Home Screen app + offline

## Phases
1. Bookshelf, writing page, looks, Pages, Word import, EPUB export, story ideas (this version)
2. True lock (passphrase encryption per project) -- done
3. Characters, timeline, vision boards, Pinterest/Canva buttons -- done
4. Word lookup, ideas inside projects, targets, research library
5. Map, moving backgrounds
