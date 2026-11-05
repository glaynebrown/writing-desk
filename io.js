/* Bringing writing in (a Word file downloaded from Google Drive) and
   sending it out (an EPUB ebook for the Kindle). */

const IO = (() => {
  const { $, $$, esc, icon, num, plural, toast, sheet, closeSheet, ask, loadScript } = UI;
  const MAMMOTH = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js';
  const JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  const MAX_CHAPTER = 800000; // one database entry holds about 1 MB

  // ---------- Word import ----------
  // A line with no letters or numbers (***, #, ~~~, ❦ …) is a scene break.
  const isBreakLine = t => { t = t.trim(); return t.length > 0 && t.length <= 15 && !/[\p{L}\p{N}]/u.test(t); };
  const isChapterLine = t => { t = t.trim(); return t.length > 0 && t.length < 80 && (/^(chapter|ch\.|prologue|epilogue|part|interlude|book)\b/i.test(t) || /^[ivxlcdm]+\.?$/i.test(t) || /^\d{1,3}\.?$/.test(t)); };

  async function readDocx(file) {
    await loadScript(MAMMOTH);
    const buf = await file.arrayBuffer();
    const res = await window.mammoth.convertToHtml({ arrayBuffer: buf }, {
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"],
      convertImage: window.mammoth.images.imgElement(() => Promise.resolve({ src: '' })),
    });
    const d = document.createElement('div');
    d.innerHTML = res.value;
    $$('img', d).forEach(i => i.remove());
    return Array.from(d.children);
  }

  // Three ways to cut the file into chapters.
  function splitBy(blocks, how, fallbackTitle, scene) {
    const out = [];
    let cur = null;
    const start = title => { cur = { title, parts: [] }; out.push(cur); };
    for (const b of blocks) {
      const text = b.textContent || '';
      const isHead = how === 'headings' ? /^H[12]$/.test(b.tagName) : how === 'lines' ? (isChapterLine(text) || /^H[12]$/.test(b.tagName) && isChapterLine(text)) : false;
      if (isHead) { start(text.trim()); continue; }
      if (!text.trim() && b.tagName === 'P') continue;
      if (!cur) start(out.length ? '' : (how === 'one' ? fallbackTitle : 'Opening'));
      if (b.tagName === 'P' && isBreakLine(text)) cur.parts.push(`<div class="scene" data-s="${scene}">${esc(Editor.sceneOf(scene).t)}</div>`);
      else cur.parts.push(b.outerHTML);
    }
    return out
      .map(c => {
        const html = Editor.clean(c.parts.join(''), { dropEmpty: true, scene });
        return { title: c.title, html, words: Editor.countWords(html) };
      })
      .filter((c, i) => c.words || c.title && i > 0);
  }

  // project = add into this one; null = make a new project from the file
  async function importWord(ctx, project) {
    const file = await UI.pickFile('.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) return ask('That isn’t a Word file', 'In Google Docs choose <b>File → Download → Microsoft Word (.docx)</b>, then pick that file here.', 'OK', { cancel: false });
    toast('Reading your file…', 6000);
    let blocks;
    try { blocks = await readDocx(file); } catch (e) { return UI.oops(e); }
    const base = file.name.replace(/\.docx$/i, '').replace(/[_-]+/g, ' ').trim();
    const scene = (project && project.sceneBreak) || 'fleuron';
    const ways = {
      headings: splitBy(blocks, 'headings', base, scene),
      lines: splitBy(blocks, 'lines', base, scene),
      one: splitBy(blocks, 'one', project && project.kind === 'short' ? '' : 'Chapter One', scene),
    };
    const nHead = blocks.filter(b => /^H[12]$/.test(b.tagName)).length;
    const nLines = blocks.filter(b => isChapterLine(b.textContent || '')).length;
    let how = nHead >= 2 ? 'headings' : nLines >= 2 ? 'lines' : 'one';
    const total = ways.one.reduce((a, c) => a + c.words, 0);
    if (!total) return ask('No writing found', 'That file looks empty.', 'OK', { cancel: false });
    toast('');
    const hasWords = project && project.words > 0;

    const el = sheet(`<h2>Bring in “${esc(base)}”</h2>
      <p class="muted">${plural(total, 'word')} found.</p>
      <div class="field"><label>Split into chapters</label>
        <div class="choice" id="im-how">
          <button data-how="headings" ${ways.headings.length < 2 ? 'disabled' : ''}>By headings <small>${ways.headings.length >= 2 ? plural(ways.headings.length, 'chapter') : 'none found'}</small></button>
          <button data-how="lines" ${ways.lines.length < 2 ? 'disabled' : ''}>By “Chapter …” lines <small>${ways.lines.length >= 2 ? plural(ways.lines.length, 'chapter') : 'none found'}</small></button>
          <button data-how="one">Keep as one chapter</button>
        </div>
      </div>
      ${!project ? `<div class="field"><label for="im-title">Project name</label><input class="input" id="im-title" value="${esc(base)}"></div>
        <div class="field"><label>Kind</label><div class="seg" id="im-kind"><button data-k="book" class="on">Book</button><button data-k="short">Short piece</button></div></div>` : ''}
      ${hasWords ? `<div class="field"><label>Where should it go?</label><div class="seg" id="im-where"><button data-w="add" class="on">After my chapters</button><button data-w="replace">Replace all my chapters</button></div></div>` : ''}
      <div class="field"><label>Chapters</label><ol class="im-list" id="im-list"></ol></div>
      <div class="row end"><button class="btn quiet" data-act="close">Cancel</button><button class="btn" id="im-go">Bring it in</button></div>`, { cls: 'wide' });

    const draw = () => {
      $$('#im-how button').forEach(b => b.classList.toggle('on', b.dataset.how === how));
      const list = ways[how];
      $('#im-list').innerHTML = list.slice(0, 200).map(c => `<li><span>${esc(c.title || 'Untitled chapter')}</span><small>${num(c.words)} words</small></li>`).join('') + (list.length > 200 ? `<li class="muted">…and ${list.length - 200} more</li>` : '');
    };
    draw();
    el.addEventListener('click', async e => {
      const h = e.target.closest('#im-how button');
      if (h && !h.disabled) { how = h.dataset.how; draw(); }
      const seg = e.target.closest('.seg button');
      if (seg) { $$('button', seg.parentNode).forEach(b => b.classList.toggle('on', b === seg)); }
      if (!e.target.closest('#im-go')) return;
      const list = ways[how];
      if (list.some(c => c.html.length > MAX_CHAPTER)) return ask('That chapter is too long', 'One chapter is too big to save in one piece. Pick a way to split it into chapters (or add headings in Google Docs first).', 'OK', { cancel: false });
      const where = $('#im-where .on') ? $('#im-where .on').dataset.w : 'add';
      if (where === 'replace') {
        const ok = await ask('Replace all your chapters?', 'Everything already written in this project will be swapped for the file. This can’t be undone.', 'Replace', { danger: true });
        if (!ok) return;
      }
      closeSheet(true);
      let pid = project && project.id;
      if (!pid) {
        const kind = $('#im-kind .on') ? $('#im-kind .on').dataset.k : 'book';
        pid = ctx.api.createProject({ title: ($('#im-title') && $('#im-title').value.trim()) || base, kind, look: { ...Themes.DEFAULT }, coverId: '', pageSize: { w: 6, h: 9 }, sceneBreak: 'fleuron', words: total });
      }
      let order = 0;
      if (project && where === 'add') {
        const have = await ctx.api.chaptersOf(pid);
        // a brand-new empty first chapter gets replaced by the file
        const blanks = have.filter(c => !c.words && !(c.html || '').replace(/<[^>]+>/g, '').trim());
        if (blanks.length === have.length) ctx.api.deleteChapters(blanks.map(c => c.id));
        else order = Math.max(0, ...have.map(c => c.order || 0));
      }
      if (project && where === 'replace') {
        const have = await ctx.api.chaptersOf(pid);
        ctx.api.deleteChapters(have.map(c => c.id));
      }
      ctx.api.addChapters(pid, list.map((c, i) => ({ title: c.title, html: c.html, words: c.words, order: order + i + 1 })));
      if (project) ctx.api.saveProject(pid, { words: (where === 'add' ? project.words || 0 : 0) + total, updatedAt: Date.now() });
      toast(`Brought in ${plural(list.length, 'chapter')} ✨`);
      ctx.go('#/p/' + pid);
    });
  }

  // ---------- EPUB export ----------
  const x = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2));

  // Chapter HTML -> XHTML for the ebook (no highlights or notes).
  // pics: scene-break pictures put in the book ({ arrow: true, own: true })
  function xhtmlBody(html, look, pics = {}) {
    look = Themes.norm(look);
    const d = document.createElement('div');
    d.innerHTML = Editor.clean(html, { plain: true });
    let after = true;
    const out = [];
    const ser = new XMLSerializer();
    for (const b of Array.from(d.children)) {
      if (b.classList.contains('scene')) {
        const s = b.dataset.s;
        out.push(pics[s] ? `<p class="scene"><img class="scene-pic" src="images/scene-${s}.png" alt="${x(b.textContent)}"/></p>` : `<p class="scene">${x(b.textContent)}</p>`);
        after = true; continue;
      }
      if (!b.textContent.trim()) { out.push('<p class="blank">&#160;</p>'); continue; }
      const drop = look.dropcap && !out.length;
      const cls = [['left', 'center', 'right'].find(k => b.classList.contains(k)) || '', drop || (after && look.indent === 'book') ? 'first' : ''].filter(Boolean).join(' ');
      after = false;
      let inner = Array.from(b.childNodes).map(n => ser.serializeToString(n)).join('').replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '');
      // big first letter (with an opening quote mark, if there is one)
      if (drop) inner = inner.replace(/^((?:<[^>]+>)*)([“"‘'(]?[\p{L}\p{N}])/u, '$1<span class="dropcap">$2</span>');
      out.push(`<p${cls ? ` class="${cls}"` : ''}>${inner}</p>`);
    }
    return out.join('\n');
  }
  const page = (title, body, type) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><meta charset="utf-8"/><title>${x(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body${type ? ` epub:type="${type}"` : ''}>
${body}
</body>
</html>`;
  const CSS = `body { margin: 0 5%; }
p { margin: 0; text-indent: 1.4em; line-height: 1.5; text-align: justify; }
p.first, p.center, p.right, p.scene, p.blank { text-indent: 0; }
p.center { text-align: center; }
p.right { text-align: right; }
p.left { text-align: left; }
p.scene { text-align: center; margin: 1.2em 0; letter-spacing: 0.2em; }
img.scene-pic { height: 3em; max-width: 70%; }
span.dropcap { float: left; font-size: 3.4em; line-height: 0.85; margin: 0.05em 0.08em 0 0; }
h1.chapter { text-align: center; font-weight: normal; font-size: 1.6em; margin: 3em 0 2em; page-break-before: always; }
.titlepage { text-align: center; margin-top: 30%; }
.titlepage h1 { font-weight: normal; font-size: 2em; margin: 0 0 0.6em; }
.titlepage p { text-indent: 0; text-align: center; font-size: 1.1em; }
.cover { text-align: center; margin: 0; padding: 0; }
.cover img { max-width: 100%; max-height: 100%; }`;

  // fill: widen the cover to the Paperwhite's 3:4 screen with soft side bands
  // (a blur of the cover's own colors), so nothing in the design gets cut.
  async function toJpeg(dataUrl, fill) {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
    const w = img.naturalWidth || 1600, h = img.naturalHeight || 2400;
    const c = document.createElement('canvas');
    c.width = fill && w / h < 3 / 4 ? Math.round(h * 3 / 4) : w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    const x0 = Math.round((c.width - w) / 2);
    if (x0 > 0) {
      // Shrinking to a tiny canvas and stretching it back = a smooth blur that works in every browser
      const t = document.createElement('canvas');
      t.width = 6; t.height = 8;
      const tg = t.getContext('2d');
      tg.drawImage(img, 0, 0, t.width, t.height);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(t, 0, 0, c.width, c.height);
      g.fillStyle = 'rgba(255, 250, 240, .12)'; g.fillRect(0, 0, c.width, c.height);
      g.save(); g.shadowColor = 'rgba(0, 0, 0, .35)'; g.shadowBlur = Math.round(h / 60);
      g.fillRect(x0, 0, w, h); g.restore();
    }
    g.drawImage(img, x0, 0, w, h);
    const b64 = c.toDataURL('image/jpeg', 0.9).split(',')[1];
    return Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
  }

  async function buildEpub(project, chapters, opts) {
    await loadScript(JSZIP);
    const zip = new window.JSZip();
    const id = project.epubId || uuid();
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
    const O = zip.folder('OEBPS');
    const size = Math.round(((project.look && project.look.size) || 11) / 11 * 100);
    O.file('style.css', (size !== 100 ? `body { font-size: ${size}%; }\n` : '') + CSS);
    const manifest = ['<item id="css" href="style.css" media-type="text/css"/>', '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>', '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'];
    const spine = [];
    const toc = [];
    if (opts.cover) {
      O.file('images/cover.jpg', await toJpeg(opts.cover, opts.fill));
      manifest.push('<item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>');
      O.file('cover.xhtml', page('Cover', `<div class="cover"><img src="images/cover.jpg" alt="${x(project.title)}"/></div>`, 'cover'));
      manifest.push('<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>');
      spine.push('<itemref idref="cover" linear="yes"/>');
    }
    if (opts.titlePage) {
      O.file('title.xhtml', page(project.title, `<div class="titlepage"><h1>${x(project.title)}</h1>${opts.author ? `<p>${x(opts.author)}</p>` : ''}</div>`, 'titlepage'));
      manifest.push('<item id="titlepage" href="title.xhtml" media-type="application/xhtml+xml"/>');
      spine.push('<itemref idref="titlepage"/>');
    }
    // scene-break pictures used in the book (black lines on see-through PNGs)
    const pics = {};
    for (const [id, data] of Object.entries(opts.scenePics || {})) {
      if (!data || !chapters.some(c => (c.html || '').includes(`data-s="${id}"`))) continue;
      O.file(`images/scene-${id}.png`, data.split(',')[1], { base64: true });
      manifest.push(`<item id="scene-${id}" href="images/scene-${id}.png" media-type="image/png"/>`);
      pics[id] = true;
    }
    chapters.forEach((c, i) => {
      const n = String(i + 1).padStart(3, '0');
      const title = c.title || (chapters.length > 1 ? `Chapter ${i + 1}` : project.title);
      O.file(`ch${n}.xhtml`, page(title, `<section epub:type="chapter">\n${c.title || chapters.length > 1 ? `<h1 class="chapter">${x(title)}</h1>\n` : ''}${xhtmlBody(c.html, project.look, pics)}\n</section>`));
      manifest.push(`<item id="ch${n}" href="ch${n}.xhtml" media-type="application/xhtml+xml"/>`);
      spine.push(`<itemref idref="ch${n}"/>`);
      toc.push({ href: `ch${n}.xhtml`, title });
    });
    O.file('nav.xhtml', page('Contents', `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>\n${toc.map(t => `<li><a href="${t.href}">${x(t.title)}</a></li>`).join('\n')}\n</ol></nav>`));
    O.file('toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:uuid:${id}"/></head>
<docTitle><text>${x(project.title)}</text></docTitle><navMap>
${toc.map((t, i) => `<navPoint id="n${i + 1}" playOrder="${i + 1}"><navLabel><text>${x(t.title)}</text></navLabel><content src="${t.href}"/></navPoint>`).join('\n')}
</navMap></ncx>`);
    O.file('content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">urn:uuid:${id}</dc:identifier>
<dc:title>${x(project.title)}</dc:title>
<dc:language>en</dc:language>
${opts.author ? `<dc:creator>${x(opts.author)}</dc:creator>` : ''}
<meta property="dcterms:modified">${now}</meta>
${opts.cover ? '<meta name="cover" content="cover-image"/>' : ''}
</metadata>
<manifest>
${manifest.join('\n')}
</manifest>
<spine toc="ncx">
${spine.join('\n')}
</spine>
</package>`);
    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' });
    return { blob, id };
  }

  const fileAsDataUrl = url => fetch(url).then(r => r.blob()).then(b => new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = () => res(''); f.readAsDataURL(b); })).catch(() => '');
  async function exportEpub(ctx, project, chapters, back) {
    const settings = ctx.settings();
    const cover = project.coverId ? await ctx.api.getImage(project.coverId) : '';
    const canShare = !!(navigator.canShare && navigator.share);
    const el = sheet(`<h2>Export for Kindle</h2>
      <p class="muted">Makes an EPUB ebook of <b>${esc(project.title || 'Untitled')}</b> — ${plural(chapters.length, 'chapter')}, ${plural(chapters.reduce((a, c) => a + (c.words || 0), 0), 'word')}. Highlights and notes are left out.</p>
      <div class="field"><label for="ex-author">Author name <small>(shows on the title page)</small></label><input class="input" id="ex-author" value="${esc(settings.author || '')}" placeholder="Your name or pen name"></div>
      ${cover ? `<label class="check"><input type="checkbox" id="ex-cover" checked> Include my cover</label>
        <label class="check sub" id="ex-fill-row"><input type="checkbox" id="ex-fill" ${settings.kindleFill ? 'checked' : ''}> Fill my Paperwhite screen <small class="muted">— adds soft side bands in your cover’s colors; nothing is cut</small></label>` : ''}
      <label class="check"><input type="checkbox" id="ex-title" checked> Include a title page</label>
      <div class="howto">${icon('kindle')}<div><b>Getting it onto your Kindle</b><br>Open the <b>Send to Kindle</b> app on your Mac (drag the file in) or on your iPhone (share the file to the Kindle app), or email it to your Kindle’s address.</div></div>
      <div class="row end"><button class="btn quiet" data-act="close">Cancel</button>${canShare ? `<button class="btn quiet" id="ex-share">${icon('share')} Share…</button>` : ''}<button class="btn" id="ex-dl">${icon('download')} Save EPUB</button></div>`, { back });
    if ($('#ex-cover')) $('#ex-cover').onchange = () => { $('#ex-fill').disabled = !$('#ex-cover').checked; $('#ex-fill-row').classList.toggle('off', !$('#ex-cover').checked); };
    el.addEventListener('click', async e => {
      const b = e.target.closest('#ex-dl, #ex-share');
      if (!b) return;
      const author = $('#ex-author').value.trim();
      if (author !== (settings.author || '')) ctx.api.saveSettings({ author });
      const fill = !!($('#ex-cover') && $('#ex-cover').checked && $('#ex-fill').checked);
      if ($('#ex-fill') && $('#ex-fill').checked !== !!settings.kindleFill) ctx.api.saveSettings({ kindleFill: $('#ex-fill').checked });
      b.disabled = true;
      const label = b.innerHTML;
      b.textContent = 'Making your ebook…';
      try {
        const scenePics = { arrow: await fileAsDataUrl('scene-arrow.png'), own: project.sceneImg ? await ctx.api.getImage(project.sceneImg) : '' };
        const { blob, id } = await buildEpub(project, chapters, { author, cover: $('#ex-cover') && $('#ex-cover').checked ? cover : '', fill, titlePage: $('#ex-title').checked, scenePics });
        if (!project.epubId) ctx.api.saveProject(project.id, { epubId: id });
        const name = (project.title || 'My book').replace(/[\\/:*?"<>|]+/g, '').trim() + '.epub';
        const file = new File([blob], name, { type: 'application/epub+zip' });
        if (b.id === 'ex-share' && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: project.title }); } catch (err) { if (err.name !== 'AbortError') throw err; }
        } else {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = name;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
          toast('Saved “' + name + '” to your Downloads');
        }
        closeSheet(true);
      } catch (err) { UI.oops(err); b.disabled = false; b.innerHTML = label; }
    });
  }

  return { importWord, exportEpub, buildEpub, splitBy };
})();
