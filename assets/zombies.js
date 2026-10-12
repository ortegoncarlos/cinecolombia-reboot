// Resident Evil easter egg: an endless horde of pixel zombies shambles across the hero while it is active; tap one to kill it.
// Sprite (traced from the reference art), 2-frame walk, red flash and blood splat are authored in assets/zombies/index.html
// (HyperFrames, GSAP); here they run on ONE <canvas> per hero: frames pre-rendered once, a pooled array of zombies, one rAF loop
// that only does drawImage (no DOM per zombie, no layout). Hooks: zombies.start(el, ms) / zombies.stop().
window.zombies = (() => {
  const ROWS = '.........KKKK........|........KbaabK.......|.......KbaaaabK......|.......KaabbabK......|.......KcaceaaK......|.......KbabbacK......|.......KadabcKK......|........KrddbcKKK....|.........KbdKcbxyK...|........KKKKcbxwwxK..|..KKKKKKpwwqbpwwwpK..|.KaaaabbwxwxqrwywwxK.|KabKKKKKyKxwrwwxKxqK.|KKK.....K.KwwwpxKqcK.|...........KwwwwxKbK.|..........KqpwpwxKaK.|..........KxwrxxxKaK.|..........KnnnnxnKaK.|..........KnnmnnnKadK|.........KnmnmmnnKcaK|.........KmmnKmmnKKK.|.........KmnKKmmnK...|........KamnKKmmnK...|........KcnK.KmamK...|........KnnK..KmmK...|........KnmK...KmmK..|.........KcK....KcKK.|........KssK....KssK.|.......KsssK...KsssK.|.......KKKKK...KKKK..'.split('|');
  const PAL = { K: '#000', a: '#afc891', b: '#86a072', c: '#5a6d4d', w: '#d9e9e8', x: '#b1c5cb', y: '#9ba5a9', p: '#d4b4ae', r: '#b73c3e', d: '#750811', q: '#9b7d76', n: '#1f2c32', m: '#3a4950', s: '#1f201a', e: '#fafafa' };
  const SPLAT = ['......x.........', '...x..xx...x....', '....xxxxx.xx....', '..x.xxxxxxxx....', '...xxxxxxxxxx.x.', '.xxxxxxxxxxxx...', '...xxxxxxxxxxx..', '..xxxxxxxxxxx...', 'x.xxxxxxxxxxxx.x', '...xxxxxxxxxx...', '..xxxxxxxxxxx...', '....xxxxxxxx.x..', '...x.xx.xxxx....', '.....x..x.x.....', '.....x....x.....'];
  const OFF = typeof NOAUTO !== 'undefined' && NOAUTO; // reduced motion / save-data: no egg
  const S = 6, G = 8, CW = 22, CH = 31; // pre-render scale, glow pad, cell grid (1 spare column/row for the walk shifts)
  const mk = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });
  let F, FL, SP; // F[dir][frame], FL[dir][frame] red-flash versions, SP splat
  // Walk frame k (0-3, 0.25 s each): legs alternate a 1-cell lift, the reaching arm drops a cell, head shifts a cell every 2 frames.
  function cells(k) {
    const c = mk(CW, CH), x = c.getContext('2d');
    ROWS.forEach((row, j) => [...row].forEach((ch, i) => {
      if (ch === '.') return;
      let dx = 0, dy = 0;
      if (j <= 9) dx = k < 2 ? 0 : 1; else if (j <= 13 && i <= 8) dy = k % 2; else if (j >= 20 && i <= 12) dy = k % 2 ? -1 : 0; else if (j >= 20 && i < 17) dy = k % 2 ? 0 : -1;
      x.fillStyle = PAL[ch]; x.fillRect(i + dx, j + dy + 1, 1, 1);
    }));
    return c;
  }
  function frame(src, flip, red) {
    const c = mk(CW * S + 2 * G, CH * S + 2 * G), x = c.getContext('2d');
    x.imageSmoothingEnabled = false;
    if (flip) x.setTransform(-1, 0, 0, 1, c.width, 0);
    x.shadowColor = 'rgba(229,56,59,.45)'; x.shadowBlur = G;
    x.drawImage(src, G, G, CW * S, CH * S);
    if (red) { x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-atop'; x.fillStyle = 'rgba(193,18,31,.8)'; x.fillRect(0, 0, c.width, c.height); }
    return c;
  }
  function prerender() {
    const raw = [0, 1, 2, 3].map(cells);
    F = [0, 1].map(f => raw.map(r => frame(r, f))); FL = [0, 1].map(f => raw.map(r => frame(r, f, 1)));
    SP = mk(16 * S, 15 * S); const x = SP.getContext('2d');
    SPLAT.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== 'x') return; x.fillStyle = j >= 12 ? '#6a040f' : Math.hypot(i - 7.5, j - 7) < 3.6 ? '#e5383b' : '#c1121f'; x.fillRect(i * S, j * S, S, S); }));
  }
  const CSS = '.zl{position:absolute;left:0;right:0;z-index:1;pointer-events:none}.zl canvas{width:100%;height:100%;display:block}'
    + '.zc{position:absolute;left:12px;bottom:8px;padding:4px 10px;border-radius:999px;background:var(--navy);border:1px solid #e5383b;box-shadow:0 0 8px rgba(193,18,31,.45);color:#fff;font-size:13px;font-weight:600}';
  let host, layer, cv, ctx, chipEl, t, raf, W, H, Z, cap, t0, last, kills = 0, swallow = 0, fr = [0, 0, 0];

  function stop() {
    clearTimeout(t); cancelAnimationFrame(raf);
    if (host) { host.removeEventListener('pointerdown', tap, true); host.removeEventListener('click', eat, true); }
    if (layer) layer.remove(); layer = host = null;
  }
  function start(el, ms) { stop(); if (!OFF && el) t = setTimeout(() => go(el), ms); }
  function go(el) {
    if (!F) { prerender(); document.head.append(Object.assign(document.createElement('style'), { textContent: CSS })); }
    const m = el.querySelector('.media') || el, dpr = Math.min(devicePixelRatio || 1, 2);
    W = m.offsetWidth; H = m.offsetHeight; host = el;
    layer = Object.assign(document.createElement('div'), { className: 'zl' }); layer.style.cssText = 'top:' + m.offsetTop + 'px;height:' + H + 'px';
    cv = mk(W * dpr, H * dpr); ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layer.append(cv); chipEl = null; if (kills) chip(); el.append(layer);
    // ponytail: cap by viewport/cores, then halved on the fly if frames run long; tune here if a device struggles
    cap = W < 700 ? (navigator.hardwareConcurrency >= 6 ? 120 : 80) : 200;
    Z = []; t0 = last = performance.now(); fr = [t0, 0, 0];
    el.addEventListener('pointerdown', tap, true); el.addEventListener('click', eat, true);
    raf = requestAnimationFrame(loop);
  }
  // Depth: smaller = higher up and further back (drawn first), slower; a third come up from the bottom edge.
  function spawn(z) {
    const s = z.s, sp = s * (0.35 + Math.random() * 0.5), side = Math.random();
    z.w = s * CW / CH; z.dead = 0; z.ph = Math.random() * 1000;
    if (side < 0.7) {
      const r = side < 0.35; z.x = r ? W : -z.w; z.vx = r ? -sp : sp; z.vy = (Math.random() - 0.5) * sp * 0.15;
      z.y = Math.max(0, Math.min(H - s, (0.08 + 0.62 * (s - 32) / 48 + (Math.random() - 0.5) * 0.3) * (H - s)));
    } else { z.x = Math.random() * (W - z.w); z.y = H; z.vx = (Math.random() < 0.5 ? -1 : 1) * sp * 0.4; z.vy = -sp * 0.5; }
  }
  function add() {
    const z = { s: 32 + 48 * Math.random() ** 1.5 }; spawn(z);
    let i = Z.length; while (i && Z[i - 1].s > z.s) i--; Z.splice(i, 0, z); // kept sorted by size = draw order
  }
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(now - last, 50) / 1000; last = now;
    fr[1]++; fr[2] = Math.max(fr[2], dt);
    if (now - fr[0] > 2000) { // frame budget: shed load below ~50 fps
      const fps = fr[1] * 1000 / (now - fr[0]); stats.fps = Math.round(fps); stats.live = Z.length; stats.cap = cap;
      if (fps < 50 && Z.length > 30) cap = Math.round(Z.length * 0.85);
      if (typeof dbg === 'function' && /debug/.test(location.search)) dbg('zombies', Z.length + '/' + cap, stats.fps + 'fps');
      fr = [now, 0, 0];
    }
    const want = Math.min(cap, 3 + (now - t0) / 1000 * 6); // ramp: a few, then ~6 more per second up to the cap
    for (let k = 0; k < 3 && Z.length < want; k++) add();
    if (Z.length > cap) Z.splice(0, Z.length - cap);
    ctx.clearRect(0, 0, W, H);
    for (const z of Z) {
      const k = z.s / CH / S, dw = F[0][0].width * k, dh = F[0][0].height * k, dir = z.vx > 0 ? 1 : 0;
      if (z.dead) {
        const e = now - z.dead;
        if (e < 240) { const g = 1 + 0.25 * e / 240; ctx.globalAlpha = 1 - e / 240; ctx.drawImage(FL[dir][0], z.x + z.w / 2 - dw * g / 2, z.y + z.s * 0.6 - dh * g * 0.6, dw * g, dh * g); }
        if (e < 360) { const g = (e < 200 ? 0.3 + 0.85 * e / 200 : 1.15) * z.s * 1.4, a = e < 200 ? 1 : 1 - (e - 200) / 160; ctx.globalAlpha = a; ctx.drawImage(SP, z.x + z.w / 2 - g / 2, z.y + z.s * 0.55 - g / 2, g, g * 15 / 16); }
        ctx.globalAlpha = 1; if (e >= 360) spawn(z); continue;
      }
      z.x += z.vx * dt; z.y += z.vy * dt;
      if (z.x < -z.w - 2 || z.x > W + 2 || z.y < -z.s || z.y > H + 2) { spawn(z); continue; }
      ctx.drawImage(F[dir][((now + z.ph) / 250 | 0) % 4], z.x - G * k, z.y - G * k, dw, dh);
    }
  }
  function tap(e) {
    if (e.target.closest('button,a,.rail,.info')) return; // the CTA/rail always win
    const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    for (let i = Z.length; i--;) {
      const z = Z[i], pad = z.s * 0.15;
      if (z.dead || px < z.x - pad || px > z.x + z.w + pad || py < z.y - pad || py > z.y + z.s + pad) continue;
      e.stopPropagation(); swallow = performance.now() + 500;
      z.dead = performance.now(); kills++; chip();
      if (navigator.vibrate) try { navigator.vibrate(25); } catch (x) {}
      if (kills === 10) { let seen; try { seen = sessionStorage.getItem('cineco.zombies'); sessionStorage.setItem('cineco.zombies', '1'); } catch (x) {} if (!seen && typeof toast === 'function') toast('Sobreviviste… por ahora. Resident Evil, en cines.'); }
      return;
    }
  }
  function eat(e) { if (performance.now() < swallow) { e.stopPropagation(); e.preventDefault(); swallow = 0; } } // the click after a kill tap
  function chip() { if (!chipEl) chipEl = layer.appendChild(Object.assign(document.createElement('div'), { className: 'zc' })); chipEl.textContent = '🧟 ' + kills; }
  const stats = { fps: 0, live: 0, cap: 0 };
  return { start, stop, stats, get Z() { return Z; } };
})();
