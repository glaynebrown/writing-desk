/* Looks: the colors, fonts and paper of each project (and of the bookshelf).
   Night mode turns any look into warm sepia -- never a black background.

   A look is { preset, custom {bg, paper, ink, accent, spine} | null,
               title (font key), body (font key), texture } */

const Themes = (() => {
  const PRESETS = [
    { id: 'candle', name: 'Candlelight', bg: '#F5EDDF', paper: '#FFFBF3', ink: '#3B2F25', accent: '#A0663A', spine: '#8C5A3C' },
    { id: 'library', name: 'Old Library', bg: '#ECE2CF', paper: '#FAF4E6', ink: '#33291F', accent: '#6B5236', spine: '#5E4630' },
    { id: 'rose', name: 'Rose Garden', bg: '#F7ECEA', paper: '#FFF9F7', ink: '#3E2B2E', accent: '#B4707A', spine: '#A35F6B' },
    { id: 'sage', name: 'Sage Meadow', bg: '#EEF0E4', paper: '#FBFBF4', ink: '#2F3A2B', accent: '#6E8460', spine: '#5F7553' },
    { id: 'mist', name: 'Morning Mist', bg: '#EBEFF2', paper: '#FAFCFD', ink: '#26323C', accent: '#5B7C99', spine: '#4E6D88' },
    { id: 'lavender', name: 'Lavender Ink', bg: '#F0ECF4', paper: '#FCFAFE', ink: '#33293F', accent: '#8A73A8', spine: '#7A6398' },
    { id: 'autumn', name: 'Autumn Leaves', bg: '#F5E9DA', paper: '#FFF8EE', ink: '#3A2A1E', accent: '#B5653A', spine: '#9E5530' },
    { id: 'peach', name: 'Peach Blossom', bg: '#FAEEE6', paper: '#FFFAF6', ink: '#3D2C25', accent: '#CC8566', spine: '#B9765A' },
    { id: 'forest', name: 'Deep Forest', bg: '#E8EBE1', paper: '#F8F9F2', ink: '#25302A', accent: '#476653', spine: '#3B5745' },
  ];

  // size = how big the font looks next to the others, so they all read the same
  const TITLE_FONTS = [
    { id: 'cormorant', name: 'Cormorant', css: "'Cormorant Garamond', serif", size: 1 },
    { id: 'playfair', name: 'Playfair', css: "'Playfair Display', serif", size: 0.88 },
    { id: 'fell', name: 'Old Press', css: "'IM Fell English', serif", size: 0.95 },
    { id: 'cinzel', name: 'Cinzel', css: "'Cinzel', serif", size: 0.8 },
    { id: 'script', name: 'Script', css: "'Dancing Script', cursive", size: 1.05 },
    { id: 'baskerville', name: 'Baskerville', css: "'Libre Baskerville', serif", size: 0.8 },
    { id: 'josefin', name: 'Modern', css: "'Josefin Sans', sans-serif", size: 0.85 },
    { id: 'arimo', name: 'Arial-style', css: "'Arimo', Arial, sans-serif", size: 0.82 },
    { id: 'vibes', name: 'Great Vibes', css: "'Great Vibes', cursive", size: 1.15 },
    { id: 'pinyon', name: 'Pinyon', css: "'Pinyon Script', cursive", size: 1.0 },
  ];
  const BODY_FONTS = [
    { id: 'garamond', name: 'Garamond', css: "'EB Garamond', serif", size: 1.08 },
    { id: 'lora', name: 'Lora', css: "'Lora', serif", size: 0.96 },
    { id: 'baskerville', name: 'Baskerville', css: "'Libre Baskerville', serif", size: 0.9 },
    { id: 'crimson', name: 'Crimson', css: "'Crimson Pro', serif", size: 1.08 },
    { id: 'literata', name: 'Literata', css: "'Literata', serif", size: 0.94 },
    { id: 'merriweather', name: 'Merriweather', css: "'Merriweather', serif", size: 0.88 },
    { id: 'nunito', name: 'Clean', css: "'Nunito Sans', sans-serif", size: 0.96 },
    { id: 'arimo', name: 'Arial-style', css: "'Arimo', Arial, sans-serif", size: 0.94 },
  ];
  // Papers. Most keep the color theme's own page color; cream, aged and walnut bring their own.
  const TEXTURES = [
    { id: 'plain', name: 'Plain' },
    { id: 'parchment', name: 'Light parchment' },
    { id: 'cream', name: 'Cream ivory' },
    { id: 'aged', name: 'Aged parchment' },
    { id: 'linen', name: 'Linen' },
    { id: 'speckle', name: 'Speckled' },
    { id: 'walnut', name: 'Dark walnut' },
  ];
  // Dark walnut: warm dark brown with cream words -- never black, never stark white.
  // Also the second night-mode style (Settings → Night mode).
  const WALNUT = { bg: '#231C16', paper: '#2E251E', ink: '#DCCAAB', accent: '#C8955A', spine: '#7A5536' };
  const PAPER = { cream: '#FBF2DF', aged: '#EFDBB3' };
  // look.walnut: 'all' (the whole writing screen, the default) | 'page' (just the page)
  const walnutAll = look => look.texture === 'walnut' && look.walnut !== 'page';
  const walnutPage = (look, night) => look.texture === 'walnut' && look.walnut === 'page' && night !== 'walnut';

  // size = the book's text size in points (11 is a normal paperback)
  // indent: 'all' (every paragraph) or 'book' (first one after a heading or break sits flush)
  // dropcap: a big first letter on each chapter
  // align: 'justify' (straight edges both sides, the normal book look) or 'left' (ragged right edge)
  //        -- the whole project's lines; the toolbar's alignment button still changes single paragraphs
  // blurType: blur my words as I type (all but the line I'm on) starts on in this project
  const DEFAULT = { preset: 'candle', custom: null, title: 'cormorant', body: 'garamond', texture: 'parchment', size: 11, indent: 'all', dropcap: false, align: 'justify', blurType: false };
  const APP = DEFAULT; // the bookshelf's own look

  // ---- color math ----
  const hex = h => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const toHex = a => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  // mix(a, b, t): t = how much of b
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return toHex(A.map((v, i) => v + (B[i] - v) * t)); };
  const lum = h => { const [r, g, b] = hex(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const okHex = h => /^#[0-9a-f]{6}$/i.test(h || '');

  const presetOf = id => PRESETS.find(p => p.id === id) || PRESETS[0];
  const titleOf = id => TITLE_FONTS.find(f => f.id === id) || TITLE_FONTS[0];
  const bodyOf = id => BODY_FONTS.find(f => f.id === id) || BODY_FONTS[0];
  const norm = look => ({ ...DEFAULT, ...(look || {}) });

  // The five colors a look really uses.
  function colors(look) {
    look = norm(look);
    const base = presetOf(look.preset);
    const c = look.preset === 'custom' && look.custom ? look.custom : base;
    const out = {};
    for (const k of ['bg', 'paper', 'ink', 'accent', 'spine']) out[k] = okHex(c[k]) ? c[k] : (k === 'spine' && okHex(c.accent) ? c.accent : base[k]);
    return out;
  }

  // Warm sepia, like a Kindle's warm night setting.
  function sepia(c) {
    return {
      bg: mix(c.bg, '#CDB58A', 0.72),
      paper: mix(c.paper, '#E7D5B1', 0.82),
      ink: mix(c.ink, '#3A2816', 0.55),
      accent: mix(c.accent, '#7E5230', 0.35),
      spine: mix(c.spine, '#6E4A2C', 0.3),
    };
  }

  // night: false | true (warm sepia) | 'walnut'
  function vars(look, night) {
    look = norm(look);
    let c = colors(look);
    if (night === 'walnut' || walnutAll(look)) c = { ...WALNUT };
    else {
      if (PAPER[look.texture]) c = { ...c, paper: PAPER[look.texture] };
      if (look.texture === 'aged') c.ink = mix(c.ink, '#3B2914', 0.5);
      if (night) c = sepia(c);
    }
    // the page itself (different from the rest only for a walnut page on a light screen)
    const page = walnutPage(look, night) ? WALNUT : c;
    const t = titleOf(look.title), b = bodyOf(look.body);
    const light = lum(c.accent) > 0.45; // text on an accent button
    return {
      '--bg': c.bg,
      '--paper': c.paper,
      '--ink': c.ink,
      '--ink-soft': mix(c.ink, c.paper, 0.38),
      '--ink-faint': mix(c.ink, c.paper, 0.6),
      '--line': mix(c.ink, c.paper, 0.86),
      '--line-soft': mix(c.ink, c.paper, 0.93),
      '--accent': c.accent,
      '--accent-deep': mix(c.accent, c.ink, 0.35),
      '--accent-soft': mix(c.accent, c.paper, 0.86),
      '--accent-wash': mix(c.accent, c.paper, 0.94),
      '--on-accent': light ? c.ink : '#FFFDF8',
      '--spine': c.spine,
      '--card': mix(c.paper, c.bg, 0.25),
      '--page-paper': page.paper,
      '--page-ink': page.ink,
      '--title-font': t.css,
      '--ts': t.size,
      '--body-font': b.css,
      '--bs': b.size,
      '--bpt': (Number(look.size) || 11) / 11,
    };
  }

  function apply(look, night, el) {
    el = el || document.documentElement;
    const v = vars(look, night);
    for (const k in v) el.style.setProperty(k, v[k]);
    el.dataset.texture = norm(look).texture;
    el.dataset.indent = norm(look).indent === 'book' ? 'book' : 'all';
    el.dataset.dropcap = norm(look).dropcap ? '1' : '';
    el.dataset.align = norm(look).align === 'left' ? 'left' : '';
    el.dataset.night = night && night !== 'walnut' ? '1' : '';
    // dark: the whole screen is walnut; darkpage: just the page is
    const lk = norm(look);
    el.dataset.dark = night === 'walnut' || walnutAll(lk) ? '1' : '';
    el.dataset.darkpage = walnutPage(lk, night) ? '1' : '';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && el === document.documentElement) meta.content = v['--bg'];
  }

  // ---- sunset / sunrise (same math as the SunCalc library) ----
  function sun(date, lat, lng) {
    const rad = Math.PI / 180, day = 864e5, J1970 = 2440588, J2000 = 2451545, J0 = 0.0009;
    const toDays = d => d.valueOf() / day - 0.5 + J1970 - J2000;
    const fromJ = j => new Date((j + 0.5 - J1970) * day);
    const lw = rad * -lng, phi = rad * lat, d = toDays(date);
    const n = Math.round(d - J0 - lw / (2 * Math.PI));
    const transit = (Ht) => J0 + (Ht + lw) / (2 * Math.PI) + n;
    const ds = transit(0);
    const M = rad * (357.5291 + 0.98560028 * ds);
    const L = M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
    const dec = Math.asin(Math.sin(rad * 23.4397) * Math.sin(L));
    const solarJ = (a) => J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    const noon = solarJ(ds);
    const w = Math.acos((Math.sin(rad * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
    const set = solarJ(transit(w));
    return { rise: fromJ(noon - (set - noon)), set: fromJ(set) };
  }
  // Virginia, unless a location was saved in Settings.
  const HOME_SPOT = { lat: 37.54, lng: -77.43 };
  function isDark(spot, now) {
    now = now || new Date();
    const s = spot && isFinite(spot.lat) ? spot : HOME_SPOT;
    const t = sun(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12), s.lat, s.lng);
    return now < t.rise || now >= t.set;
  }

  return { PRESETS, TITLE_FONTS, BODY_FONTS, TEXTURES, WALNUT, PAPER, DEFAULT, APP, presetOf, titleOf, bodyOf, colors, vars, apply, mix, okHex, norm, sun, isDark };
})();
