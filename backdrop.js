/* Backgrounds behind the writing page (⋯ → Appearance → Background).

   look.bg = { style, photo, dim (0–0.8), blur (px), effect }
     style:  'none'   plain paper -- the cover only shows on My Library
             'around' the photo all around, a solid page in the middle
             'glass'  a frosted, see-through page
             'soft'   the photo faded far back behind a solid page
             'bare'   no page -- the words sit on a darkened photo
     photo:  { starter: id } (the starter set below) | { imageId } (her own upload or a board photo)
     video:  { id, start } -- a YouTube video playing behind the page (Mac only; muted unless
             the speaker button turns sound on). The photo stays as its stand-in on the iPhone,
             offline, or if the video can't play.
     effect: '' | 'snow' | 'rain' | 'fireflies' | 'leaves' | 'fog' | 'glow' -- drawn by the app,
             on a photo or on plain paper
   On the iPhone there's no room around the page, so any photo shows faded (like 'soft').

   The starter photos are free-to-use photos from Unsplash. They load straight from Unsplash
   (nothing to upload); the service worker keeps a copy so they work offline afterward. */

const Backdrop = (() => {
  const STARTERS = [
    { id: 'cabin', name: 'Mountain cabin', u: '1583878594798-c31409c8ab4a' },
    { id: 'peaks', name: 'Golden mountains', u: '1490682143684-14369e18dce8' },
    { id: 'flowers', name: 'Wildflowers', u: '1686866694468-0d452973ce7c' },
    { id: 'beach', name: 'Beach at sunset', u: '1424581342241-2b1aba4d3462' },
    { id: 'pines', name: 'Pine forest', u: '1440581572325-0bea30075d9d' },
    { id: 'rain', name: 'Rainy window', u: '1433863448220-78aaa064ff47' },
    { id: 'candle', name: 'Candlelit table', u: '1642857793583-344f88b21e83' },
    { id: 'mist', name: 'Misty lake', u: '1671485927315-f56c7a65a051' },
    { id: 'autumn', name: 'Autumn woods', u: '1509833214245-2078371af406' },
    { id: 'snow', name: 'Snowy village', u: '1609860200862-280ef414ed6a' },
  ];
  const STYLES = [['none', 'None'], ['around', 'Around the page'], ['glass', 'See-through page'], ['soft', 'Soft and light'], ['bare', 'No page']];
  const EFFECTS = [['', 'None'], ['snow', 'Snow'], ['rain', 'Rain on a window'], ['fireflies', 'Fireflies'], ['leaves', 'Falling leaves'], ['fog', 'Fog'], ['glow', 'Candle glow']];
  const starterUrl = (id, w = 2400) => { const s = STARTERS.find(x => x.id === id); return s ? `https://images.unsplash.com/photo-${s.u}?w=${w}&q=${w > 1000 ? 78 : 60}&auto=format&fit=crop` : ''; };
  const norm = bg => ({ style: 'none', photo: null, dim: 0.2, blur: 0, effect: '', ...(bg || {}) });
  const hasPhoto = bg => bg.style !== 'none' && !!bg.photo;
  // a YouTube link → { id, start } (watch?v=, youtu.be/, /shorts/, /embed/, /live/; t= or start= in seconds or 1h2m3s)
  function parseYouTube(link) {
    let u;
    try { u = new URL(String(link || '').trim().replace(/^(?!https?:)/, 'https://')); } catch (e) { return null; }
    const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
    let id = '';
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/) || [])[1] || '';
    if (!/^[\w-]{11}$/.test(id)) return null;
    const t = u.searchParams.get('t') || u.searchParams.get('start') || '';
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
    const start = m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0;
    return { id, start };
  }
  const videoThumb = id => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

  // ---------- the layer ----------
  let layer = null, img = null, canvas = null, shown = '';
  function ensure() {
    if (layer) return;
    layer = document.createElement('div');
    layer.className = 'backdrop';
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML = '<div class="bd-img"></div><div class="bd-dim"></div><canvas class="bd-fx"></canvas>';
    document.body.prepend(layer);
    img = layer.querySelector('.bd-img');
    canvas = layer.querySelector('.bd-fx');
  }

  /* apply(look, night, { on, getImage }) -- on: one of the project's tabs is showing */
  const CLASSES = ['bg-on', 'bg-photo', 'bg-around', 'bg-glass', 'bg-soft', 'bg-bare', 'bg-none'];
  let last = null;
  function apply(look, night, opts) {
    ensure();
    last = [look, night, opts];
    const bg = norm((look || {}).bg);
    const on = !!opts.on && (bg.style !== 'none' || !!bg.effect);
    // the video plays on the Mac, online, when it hasn't failed; otherwise its photo stands in
    const vid = on && bg.style !== 'none' && bg.video && bg.video.id && !UI.narrow() && navigator.onLine && !Video.failed(bg.video.id) ? bg.video : null;
    const photo = on && (hasPhoto(bg) || !!vid);
    const style = !photo ? 'none' : UI.narrow() ? 'soft' : bg.style;
    document.body.classList.remove(...CLASSES);
    if (on) document.body.classList.add('bg-on', 'bg-' + style);
    if (photo) document.body.classList.add('bg-photo');
    const dim = Math.min(0.85, (style === 'bare' ? Math.max(0.45, bg.dim) : bg.dim) + (night ? 0.2 : 0));
    layer.style.setProperty('--bd-dim', dim);
    layer.style.setProperty('--bd-blur', (Number(bg.blur) || 0) + 'px');
    // the photo
    const key = photo ? JSON.stringify(bg.photo) : '';
    if (key !== shown) {
      shown = key;
      img.style.backgroundImage = '';
      img.classList.remove('ready');
      if (photo) {
        const set = src => {
          if (!src || shown !== key) return;
          const pre = new Image();
          pre.onload = () => { if (shown !== key) return; img.style.backgroundImage = `url("${src}")`; img.classList.add('ready'); };
          pre.src = src;
        };
        if (bg.photo.starter) set(starterUrl(bg.photo.starter));
        else if (bg.photo.imageId && opts.getImage) opts.getImage(bg.photo.imageId).then(set);
      }
    }
    Video.show(vid);
    Effects.run(on ? bg.effect : '', canvas, night);
  }
  const reapply = () => { if (last) apply(...last); };
  window.addEventListener('online', reapply);
  window.addEventListener('offline', reapply);

  // ---------- a YouTube video behind the page (Mac) ----------
  // The player is made small (960×540) and scaled up to fill the screen: YouTube picks its quality
  // from the player's size, so it streams a lighter picture -- plenty, dimmed and blurred behind a page.
  // It stays see-through until it's actually playing, so the photo shows meanwhile (no black flash).
  const Video = (() => {
    let wrap = null, player = null, cur = '', apiP = null;
    const bad = {};
    function api() {
      if (window.YT && window.YT.Player) return Promise.resolve();
      if (!apiP) apiP = new Promise((res, rej) => {
        const prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => { if (prev) prev(); res(); };
        UI.loadScript('https://www.youtube.com/iframe_api').catch(e => { apiP = null; rej(e); });
      });
      return apiP;
    }
    function size() {
      if (!wrap) return;
      const s = Math.max(window.innerWidth / 960, window.innerHeight / 540) * 1.02;
      wrap.style.transform = `translate(-50%, -50%) scale(${s})`;
    }
    window.addEventListener('resize', size);
    function show(v) {
      const key = v ? v.id + '@' + (v.start || 0) : '';
      if (key === cur) return;
      cur = key;
      destroy();
      if (!v) return;
      wrap = document.createElement('div');
      wrap.className = 'bd-video';
      wrap.innerHTML = '<div></div>';
      layer.insertBefore(wrap, layer.querySelector('.bd-dim'));
      size();
      const holder = wrap.firstChild;
      api().then(() => {
        if (cur !== key) return;
        player = new YT.Player(holder, {
          host: 'https://www.youtube-nocookie.com', width: 960, height: 540, videoId: v.id,
          playerVars: { autoplay: 1, mute: 1, controls: 0, loop: 1, playlist: v.id, playsinline: 1, modestbranding: 1, rel: 0, iv_load_policy: 3, disablekb: 1, fs: 0, start: v.start || 0 },
          events: {
            onReady: e => { e.target.mute(); e.target.playVideo(); },
            onStateChange: e => {
              if (e.data === YT.PlayerState.PLAYING && wrap) { wrap.classList.add('playing'); Sound.ready(true); }
              if (e.data === YT.PlayerState.ENDED) { e.target.seekTo(v.start || 0); e.target.playVideo(); }
            },
            onError: () => { bad[v.id] = true; cur = ''; destroy(); reapply(); },
          },
        });
      }).catch(() => { bad[v.id] = true; cur = ''; destroy(); reapply(); });
    }
    function destroy() {
      Sound.ready(false);
      try { if (player) player.destroy(); } catch (e) {}
      player = null;
      if (wrap) wrap.remove();
      wrap = null;
    }
    // while the app is in the background: a muted video pauses (data, battery); one with sound keeps playing
    document.addEventListener('visibilitychange', () => {
      if (!player || !player.getPlayerState) return;
      try {
        if (document.visibilityState === 'hidden' && player.isMuted()) player.pauseVideo();
        if (document.visibilityState === 'visible') player.playVideo();
      } catch (e) {}
    });
    return { show, failed: id => !!bad[id], get player() { return player; } };
  })();

  // ---------- the speaker button (sound for the video, off every time it starts) ----------
  // It sits in the project's top bar, before the goal flame, only while a video is playing.
  // Each project tab draws its own top bar, so it's moved into whichever one is showing.
  const Sound = (() => {
    let btn = null;
    function place() {
      if (!btn || btn.hidden) return;
      const host = document.querySelector('.ptop .pbtns');
      if (host && btn.parentNode !== host) host.prepend(btn);
    }
    const vol = () => Number(UI.ls.get('qc-vol', '40')) || 40;
    function ensureBtn() {
      if (btn) return;
      btn = document.createElement('button');
      btn.className = 'pbtn icon-only bd-sound';
      btn.hidden = true;
      btn.title = 'Sound for the background video';
      btn.setAttribute('aria-label', 'Sound for the background video');
      new MutationObserver(place).observe(document.getElementById('view'), { childList: true, subtree: true });
      btn.addEventListener('click', () => {
        const p = Video.player;
        if (!p) return;
        const muted = p.isMuted();
        const pop = UI.popover(btn, `<p class="pop-title">Background sound</p>
          <button class="pop-item" data-pick="toggle">${UI.icon(muted ? 'sound' : 'mute')} ${muted ? 'Turn sound on' : 'Turn sound off'}</button>
          <label class="bd-vol">${UI.icon('sound')}<input type="range" min="0" max="100" step="5" value="${vol()}" aria-label="Volume"></label>`, pick => {
          if (pick !== 'toggle') return;
          if (muted) { p.unMute(); p.setVolume(vol()); } else p.mute();
          setTimeout(paint, 250); // (YouTube reports the change a moment later)
        });
        pop.querySelector('input').addEventListener('input', e => {
          UI.ls.set('qc-vol', e.target.value);
          p.setVolume(Number(e.target.value));
          if (p.isMuted() && Number(e.target.value) > 0) { p.unMute(); setTimeout(paint, 250); }
        });
      });
    }
    function paint() {
      const p = Video.player;
      const on = !!p && p.isMuted && !p.isMuted();
      btn.innerHTML = UI.icon(on ? 'sound' : 'mute');
      btn.classList.toggle('on', on);
    }
    function ready(yes) {
      ensureBtn();
      btn.hidden = !yes;
      if (yes) { paint(); place(); } else { UI.closePopover(); btn.remove(); }
    }
    return { ready };
  })();

  // ---------- moving effects (drawn on a canvas; no storage) ----------
  const Effects = (() => {
    let kind = '', raf = 0, parts = [], ctx = null, W = 0, H = 0, last = 0, cv = null, t0 = 0, dark = false;
    const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const rnd = (a, b) => a + Math.random() * (b - a);
    function size() {
      if (!cv) return;
      const r = window.devicePixelRatio > 1 ? 1.5 : 1; // a little sharper on Retina, without the cost of 2x
      W = window.innerWidth; H = window.innerHeight;
      cv.width = W * r; cv.height = H * r;
      ctx.setTransform(r, 0, 0, r, 0, 0);
    }
    const make = {
      snow: () => ({ x: rnd(0, W), y: rnd(-H, H), r: rnd(1, 3.2), s: rnd(18, 55), d: rnd(0, 6.28), w: rnd(10, 30) }),
      rain: () => ({ x: rnd(0, W), y: rnd(-H, H), l: rnd(12, 26), s: rnd(500, 900), o: rnd(0.15, 0.35) }),
      drop: () => ({ x: rnd(0, W), y: rnd(0, H), r: rnd(2, 5), s: rnd(0, 1) < 0.25 ? rnd(20, 70) : 0, o: rnd(0.25, 0.5) }),
      fireflies: () => ({ x: rnd(0, W), y: rnd(H * 0.2, H), a: rnd(0, 6.28), s: rnd(8, 22), p: rnd(0, 6.28), r: rnd(1.5, 3) }),
      leaves: () => ({ x: rnd(0, W), y: rnd(-H, 0), s: rnd(30, 70), a: rnd(0, 6.28), sp: rnd(-1.5, 1.5), w: rnd(20, 60), z: rnd(7, 13), c: ['#C46A2C', '#D9922E', '#A8432A', '#B8862F', '#8E5A2A'][Math.floor(rnd(0, 5))] }),
      fog: () => ({ x: rnd(-W * 0.3, W), y: rnd(H * 0.1, H), r: rnd(W * 0.18, W * 0.38), s: rnd(6, 16), o: rnd(0.05, 0.12) }),
    };
    function seed() {
      parts = [];
      const area = W * H / (1440 * 900);
      const n = { snow: 140, rain: 110, fireflies: 34, leaves: 22, fog: 9 }[kind] || 0;
      for (let i = 0; i < Math.round(n * Math.max(0.4, area)); i++) parts.push(make[kind]());
      if (kind === 'rain') for (let i = 0; i < Math.round(60 * Math.max(0.4, area)); i++) parts.push({ ...make.drop(), drop: true });
    }
    function leaf(p) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.fillStyle = p.c;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(0, -p.z);
      ctx.quadraticCurveTo(p.z * 0.75, 0, 0, p.z);
      ctx.quadraticCurveTo(-p.z * 0.75, 0, 0, -p.z);
      ctx.fill();
      ctx.restore();
    }
    function frame(now) {
      raf = 0;
      if (!kind) return;
      const dt = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);
      if (kind === 'glow') {
        const f = 0.85 + 0.08 * Math.sin(t * 2.1) + 0.05 * Math.sin(t * 5.3 + 1) + 0.03 * Math.sin(t * 11.7);
        const g = ctx.createRadialGradient(W * 0.5, H * 1.05, 0, W * 0.5, H * 1.05, Math.max(W, H) * 0.75 * f);
        g.addColorStop(0, `rgba(255, 176, 80, ${0.32 * f})`);
        g.addColorStop(0.45, `rgba(255, 140, 50, ${0.12 * f})`);
        g.addColorStop(1, 'rgba(255, 140, 50, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      for (const p of parts) {
        if (kind === 'snow') {
          p.y += p.s * dt; p.x += Math.sin(t * 0.6 + p.d) * p.w * dt;
          if (p.y > H + 5) { p.y = -5; p.x = rnd(0, W); }
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.29); ctx.fill();
        } else if (kind === 'rain' && p.drop) {
          // drops on the glass, some slowly sliding down
          if (p.s) { p.y += p.s * dt; if (p.y > H + 10) { Object.assign(p, make.drop(), { y: -10 }); } }
          ctx.globalAlpha = p.o;
          ctx.fillStyle = 'rgba(235, 242, 248, .9)';
          ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r * 0.8, p.r, 0, 0, 6.29); ctx.fill();
          ctx.globalAlpha = p.o * 0.9;
          ctx.fillStyle = 'rgba(255,255,255,.9)';
          ctx.beginPath(); ctx.arc(p.x - p.r * 0.3, p.y - p.r * 0.35, p.r * 0.28, 0, 6.29); ctx.fill();
        } else if (kind === 'rain') {
          p.y += p.s * dt; p.x += p.s * 0.12 * dt;
          if (p.y > H + 30) { p.y = rnd(-80, -20); p.x = rnd(-50, W); }
          ctx.globalAlpha = p.o;
          ctx.strokeStyle = 'rgba(220, 230, 240, .9)';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.l * 0.12, p.y + p.l); ctx.stroke();
        } else if (kind === 'fireflies') {
          p.a += rnd(-1, 1) * dt; p.x += Math.cos(p.a) * p.s * dt; p.y += Math.sin(p.a) * p.s * dt;
          if (p.x < -20) p.x = W + 20; if (p.x > W + 20) p.x = -20; if (p.y < H * 0.1) p.a = Math.PI / 2; if (p.y > H + 10) p.a = -Math.PI / 2;
          const glow = Math.max(0, Math.sin(t * 1.3 + p.p));
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 6);
          g.addColorStop(0, `rgba(255, 236, 140, ${0.9 * glow})`);
          g.addColorStop(1, 'rgba(255, 220, 110, 0)');
          ctx.globalAlpha = 1;
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 6, 0, 6.29); ctx.fill();
        } else if (kind === 'leaves') {
          p.y += p.s * dt; p.x += Math.sin(t * 0.8 + p.a) * p.w * dt; p.a += p.sp * dt;
          if (p.y > H + 20) { Object.assign(p, make.leaves(), { y: -20 }); }
          leaf(p);
        } else if (kind === 'fog') {
          p.x += p.s * dt;
          if (p.x - p.r > W) p.x = -p.r;
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
          const c = dark ? '200, 190, 175' : '255, 255, 255';
          g.addColorStop(0, `rgba(${c}, ${p.o})`);
          g.addColorStop(1, `rgba(${c}, 0)`);
          ctx.globalAlpha = 1;
          ctx.fillStyle = g;
          ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
        }
      }
      ctx.globalAlpha = 1;
      // "Reduce motion" on: one still picture, no animation
      if (!still() && document.visibilityState === 'visible') raf = requestAnimationFrame(frame);
    }
    function run(k, c, night) {
      dark = !!night;
      if (k === kind && c === cv) { if (k && !raf && !still() && document.visibilityState === 'visible') raf = requestAnimationFrame(frame); return; }
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      kind = k || '';
      cv = c;
      if (!cv) return;
      ctx = cv.getContext('2d');
      size();
      ctx.clearRect(0, 0, W, H);
      cv.classList.toggle('on', !!kind);
      if (!kind) return;
      seed();
      last = 0; t0 = performance.now();
      raf = requestAnimationFrame(frame);
    }
    window.addEventListener('resize', () => { if (!kind) return; size(); seed(); });
    // effects stop while the app is in the background (battery), and pick up again after
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && kind && !raf) { last = 0; raf = requestAnimationFrame(frame); } });
    return { run };
  })();

  return { STARTERS, STYLES, EFFECTS, starterUrl, norm, apply, parseYouTube, videoThumb };
})();
