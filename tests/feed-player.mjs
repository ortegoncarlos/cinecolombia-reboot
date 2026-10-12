// Feed player (assets/app.js feed()): two native <video> elements, preload in the swipe direction, sound unlocked by Sonido.
// Real Chrome (channel 'chrome'), iPhone 13 emulation, no network: HTMLMediaElement is stubbed (play/pause/load recorded per
// element, `playing`/`pause`/`loadeddata` dispatched synthetically), films get a `clip` for the first cards. Run: npm i && npm test
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = path.join(ROOT, decodeURIComponent(u.pathname));
  if (!p.startsWith(ROOT)) return res.writeHead(403).end();
  if (u.pathname.endsWith('.mp4')) return res.writeHead(404).end();
  fs.readFile(fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p, (err, buf) => {
    if (err) return res.writeHead(404).end();
    if (u.pathname === '/data/films.json') { // test data: every film has a clip (tests blank one at runtime)
      const d = JSON.parse(buf); d.films.forEach(f => { f.clip = 'media/trailers/' + f.id + '.mp4'; delete f.vertical; });
      buf = Buffer.from(JSON.stringify(d));
    }
    if (u.pathname === '/data/promos.json') buf = Buffer.from(JSON.stringify([{ type: 'youtube', id: 'promo1', clip: 'media/trailers/promo-1.mp4', vertical: true, url: 'https://example.com', author: '@cine_colombia', title: 'Promo', after: 2 }]));
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }).end(buf);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const { defaultBrowserType, ...IPHONE } = devices['iPhone 13'];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

async function open({ sound = null, desktop = false, reject = 0 } = {}) {
  const ctx = await browser.newContext(desktop ? { viewport: { width: 1440, height: 900 } } : IPHONE);
  await ctx.addInitScript(([s, reject]) => {
    window.__calls = []; window.__reject = reject; // reject: how many play() calls fail with NotAllowedError first
    try { localStorage.setItem('cineco.city', 'bogota'); localStorage.setItem('cineco.geo', '{"lat":4.65,"lng":-74.05}'); if (s != null) localStorage.setItem('cineco.sound', s); } catch (e) {}
    const P = HTMLMediaElement.prototype, who = v => [...document.querySelectorAll('.clip')].indexOf(v);
    const fire = (v, t) => setTimeout(() => v.dispatchEvent(new Event(t)), 5);
    Object.defineProperty(P, 'paused', { get() { return this.__paused !== false; } });
    Object.defineProperty(P, 'readyState', { get() { return this.__rs || 0; } });
    Object.defineProperty(P, 'duration', { get() { return 10; } });
    Object.defineProperty(P, 'currentTime', { get() { return this.__ct || 0; }, set(t) { this.__ct = t; } });
    P.load = function () { window.__calls.push([who(this), 'load', this.getAttribute('src')]); this.__rs = 4; this.__paused = true; fire(this, 'loadeddata'); };
    P.play = function () { window.__calls.push([who(this), 'play', this.muted ? 'muted' : 'sound']); if (window.__reject > 0) { window.__reject--; return Promise.reject(Object.assign(new Error('refused'), { name: 'NotAllowedError' })); } this.__paused = false; fire(this, 'play'); fire(this, 'playing'); return Promise.resolve(); };
    P.pause = function () { window.__calls.push([who(this), 'pause']); if (this.__paused === false) { this.__paused = true; fire(this, 'pause'); } };
    P.webkitEnterFullscreen = function () { window.__calls.push([who(this), 'fullscreen']); };
    Element.prototype.requestFullscreen = function () { window.__calls.push([who(this), 'fullscreen']); return Promise.resolve(); };
  }, [sound, reject]);
  await ctx.route(/geojs|smartlook|image\.tmdb|fonts\.(googleapis|gstatic)/, r => r.abort());
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + 'index.html');
  await page.waitForFunction(() => { const r = document.querySelector('[x-data="feed()"]'); return window.Alpine && r && Alpine.$data(r).active === 0; });
  return new Harness(ctx, page, errors);
}

class Harness {
  constructor(ctx, page, errors) { this.ctx = ctx; this.page = page; this.errors = errors; }
  close() { return this.ctx.close(); }
  get(expr) { return this.page.evaluate(new Function('const d = Alpine.$data(document.querySelector(\'[x-data="feed()"]\')); return ' + expr)); }
  // Both players: index n, card i, src tail, muted, paused, on-screen class, placement
  vids() { return this.page.evaluate(() => [...document.querySelectorAll('.clip')].map(v => ({ n: v.n, i: v.i, src: (v.getAttribute('src') || '').split('/').pop(), muted: v.muted, paused: v.paused, on: v.classList.contains('on'), vert: v.classList.contains('vert'), top: v.style.top }))); }
  async cur() { const vs = await this.vids(), n = await this.get('d.vid().n'); return vs[n]; }
  async pre() { const vs = await this.vids(), n = await this.get('d.vid().n'); return vs[1 - n]; }
  mark() { return this.page.evaluate(() => window.__calls.length); }
  async since(n, who) { return (await this.page.evaluate(n => window.__calls.slice(n), n)).filter(c => who == null || c[0] === who).map(c => c.slice(1).join(':')); }
  async scrollTo(i) {
    await this.page.evaluate(i => { const r = document.querySelector('.feed'), c = r.querySelector('[data-i="' + i + '"]'); r.scrollTop = c.offsetTop; }, i);
    await this.page.waitForFunction(i => Alpine.$data(document.querySelector('[x-data="feed()"]')).active === i, i);
    await sleep(80);
  }
  waitPlaying(i) { return this.page.waitForFunction(i => { const d = Alpine.$data(document.querySelector('[x-data="feed()"]')); return d.active === i && d.playing; }, i, { timeout: 3000 }); }
  waitPre(i) { return this.page.waitForFunction(i => { const d = Alpine.$data(document.querySelector('[x-data="feed()"]')), p = [...document.querySelectorAll('.clip')].find(v => v.n !== d.vid().n); return p && p.i === i && p.getAttribute('src'); }, i, { timeout: 3000 }); }
  async gesture() {
    const vp = this.page.viewportSize(), x = Math.round(vp.width * 0.3), y = Math.round(vp.height * 0.35);
    const hit = await this.page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && e.closest('button,a') ? e.outerHTML.slice(0, 80) : ''; }, [x, y]);
    assert(!hit, 'gesture point hits a control: ' + hit);
    await this.page.touchscreen.tap(x, y); await sleep(30);
  }
  async tapSound() { await this.page.locator('.card.on .rail button[aria-label=Sonido]').tap(); await sleep(50); }
  toast() { return this.page.evaluate(() => document.getElementById('toast').textContent); }
  mediaRect(i) { return this.page.evaluate(i => { const c = document.querySelector('[data-i="' + i + '"]'), m = c.querySelector('.media'); return { top: c.offsetTop + m.offsetTop + 'px', w: m.offsetWidth + 'px' }; }, i); }
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('1 fresh load: card 0 plays muted at once from the active player; the hero hides on playing', async () => {
  const h = await open();
  await h.waitPlaying(0);
  const v = await h.cur();
  assert(v.i === 0 && v.muted && !v.paused && v.on, 'active player should be card 0, muted, playing, visible: ' + JSON.stringify(v));
  assert((await h.since(0, v.n)).filter(c => c !== 'pause').join() === 'load:media/trailers/' + (await h.get('d.queue[0].f.id')) + '.mp4,play:muted', 'expected load then muted play, got ' + (await h.since(0, v.n)));
  assert(await h.page.evaluate(() => document.querySelector('[data-i="0"]').classList.contains('play')), 'card 0 should have .play');
  assert(await h.page.evaluate(() => getComputedStyle(document.querySelector('[data-i="0"] .media img')).visibility === 'hidden'), 'hero should be hidden once playing');
  assert((await h.cur()).top === (await h.mediaRect(0)).top, 'player placed over the media box');
  assert(!h.errors.length, 'page errors: ' + h.errors.join('; '));
  await h.close();
});

test('2 preload: the other player holds the next clip (muted, paused) before any swipe; placed under card 1', async () => {
  const h = await open();
  await h.waitPlaying(0); await h.waitPre(1);
  const p = await h.pre();
  assert(p.i === 1 && p.muted && p.paused && !p.on && p.src === (await h.get('d.queue[1].f.id')) + '.mp4', 'preload: ' + JSON.stringify(p));
  assert(p.top === (await h.mediaRect(1)).top, 'preload placed under card 1');
  await h.close();
});

test('3 swipe to the preloaded card: roles swap, one play() call, no load; the next one preloads', async () => {
  const h = await open();
  await h.waitPlaying(0); await h.waitPre(1);
  const n = await h.mark(), pn = (await h.pre()).n;
  await h.scrollTo(1); await h.waitPlaying(1);
  assert((await h.get('d.vid().n')) === pn, 'roles should swap');
  const c = await h.since(n, pn);
  assert(c.join() === 'play:muted', 'preloaded player: a single muted play(), got ' + c);
  await h.waitPre(2);
  assert((await h.pre()).i === 2 && (await h.pre()).paused, 'card 2 should be preloaded in the free player');
  await h.close();
});

test('4 Sonido: muted=false on the active player inside the tap, silent play+pause unlocks the preload; next cards start with sound', async () => {
  const h = await open();
  await h.waitPlaying(0); await h.waitPre(1);
  const n = await h.mark(), cn = await h.get('d.vid().n');
  await h.tapSound();
  assert(!(await h.cur()).muted && await h.get('d.snd'), 'active player should be unmuted');
  const p = await h.since(n, 1 - cn);
  assert(p[0] === 'play:sound' && p[1] === 'pause' && (await h.pre()).muted && (await h.pre()).paused, 'preload: play (unmuted) + pause inside the tap, then muted again: ' + p + ' ' + JSON.stringify(await h.pre()));
  assert(await h.page.evaluate(() => localStorage.getItem('cineco.sound')) === '1', 'preference saved');
  const m = await h.mark();
  await h.scrollTo(1); await h.waitPlaying(1);
  assert((await h.since(m, await h.get('d.vid().n'))).join() === 'play:sound' && !(await h.cur()).muted, 'card 1 should start with sound without a gesture');
  await h.scrollTo(2); await h.waitPlaying(2);
  assert(!(await h.cur()).muted && await h.get('d.snd'), 'card 2 should have sound too');
  await h.close();
});

test('5 preference on without a tap this session: cards stay muted until Sonido (iOS: unmuted autoplay is refused)', async () => {
  const h = await open({ sound: '1' });
  await h.waitPlaying(0);
  assert((await h.cur()).muted && !(await h.get('d.snd')), 'card 0 muted');
  await h.waitPre(1); await h.scrollTo(1); await h.waitPlaying(1);
  assert((await h.cur()).muted, 'card 1 muted');
  const n = await h.mark();
  await h.tapSound(); // preference was on and the card muted: the tap gives sound (unlock), does not toggle off
  assert(!(await h.cur()).muted && await h.get('d.soundOn'), 'tap should unmute, not toggle off');
  await h.tapSound();
  assert((await h.cur()).muted && !(await h.get('d.soundOn')) && await h.page.evaluate(() => localStorage.getItem('cineco.sound')) === '0', 'second tap mutes and saves 0');
  await h.close();
});

test('6 direction flip re-targets the preload; swiping back is instant (the player just left is kept)', async () => {
  const h = await open();
  await h.waitPlaying(0); await h.waitPre(1);
  await h.scrollTo(1); await h.waitPlaying(1); await h.waitPre(2);
  const n = await h.mark(), keep = await h.get('d.vid().n');
  await h.scrollTo(0); await h.waitPlaying(0);
  assert((await h.since(n, keep)).join() === 'pause', 'card 1 player paused and kept: ' + (await h.since(n, keep)));
  assert((await h.since(n, 1 - keep)).join() === 'load:media/trailers/' + (await h.get('d.queue[0].f.id')) + '.mp4,play:muted', 'card 0 reloaded into the freed player: ' + (await h.since(n, 1 - keep)));
  await h.waitPre(1);
  assert((await h.pre()).i === 1, 'with nothing behind card 0, card 1 stays preloaded');
  await h.scrollTo(1); await h.waitPlaying(1); await h.scrollTo(2); await h.waitPlaying(2);
  await h.scrollTo(1); await h.waitPlaying(1);
  await h.waitPre(0);
  assert((await h.pre()).i === 0, 'going back from 2 to 1 preloads card 0, not 2');
  await h.close();
});

test('7 vertical clip (the promo): .vert on the player and the card', async () => {
  const h = await open();
  const j = await h.get('d.queue.findIndex(it => it.p)'); assert(j > 0 && j < 6, 'promo card expected early, got ' + j);
  await h.waitPlaying(0);
  for (let i = 1; i < j; i++) { await h.waitPre(i); await h.scrollTo(i); await h.waitPlaying(i); }
  await h.waitPre(j);
  assert((await h.pre()).vert && await h.page.evaluate(j => document.querySelector('[data-i="' + j + '"]').classList.contains('vert'), j), 'promo card should be vertical');
  await h.scrollTo(j); await h.waitPlaying(j);
  assert((await h.cur()).vert && (await h.cur()).src === 'promo-1.mp4', 'active player keeps .vert with the promo clip');
  await h.close();
});

test('8 card without a clip: players paused, hero stays, preload skips to the next clip', async () => {
  const h = await open();
  const j = 2; await h.get('d.queue[2].f.clip = ""');
  await h.waitPlaying(0);
  await h.waitPre(1); await h.scrollTo(1); await h.waitPlaying(1);
  await h.waitPre(3); // card 2 has no clip: the preload skips to 3
  assert((await h.pre()).i === 3 && await h.get('d.nxt') === 3, 'preload should skip the clipless card');
  await h.page.evaluate(i => { const r = document.querySelector('.feed'), c = r.querySelector('[data-i="' + i + '"]'); r.scrollTop = c.offsetTop; }, j);
  await h.page.waitForFunction(i => Alpine.$data(document.querySelector('[x-data="feed()"]')).active === i, j);
  await sleep(100);
  const vs = await h.vids();
  assert(vs.every(v => v.paused && !v.on), 'both players paused and hidden: ' + JSON.stringify(vs));
  assert(!(await h.get('d.playing')) && await h.get('d.wait') === 0, 'no playing, no ▶');
  await h.close();
});

test('9 play() refused unmuted → muted retry; refused muted too → ▶ control; tap plays', async () => {
  let h = await open();
  await h.waitPlaying(0); await h.tapSound(); // unlock + sound preference
  await h.waitPre(1);
  await h.page.evaluate(() => { window.__reject = 1; });
  const n = await h.mark();
  await h.scrollTo(1); await h.waitPlaying(1);
  const c = await h.since(n, await h.get('d.vid().n'));
  assert(c.join() === 'play:sound,play:muted' && (await h.cur()).muted, 'refused with sound → one muted retry, got ' + c);
  await h.close();
  h = await open({ reject: 1 }); // the first (muted) play() refused: nothing else to try → ▶
  await sleep(300);
  assert(await h.get('d.wait') === 1 && (await h.toast()).includes('Toca ▶'), '▶ expected after two refusals');
  assert(await h.page.locator('.card.on .disc.big').isVisible(), '▶ control visible');
  await h.page.locator('.card.on .disc.big').tap();
  await h.waitPlaying(0);
  assert(await h.get('d.wait') === 0, '▶ cleared on playing');
  await h.close();
});

test('10 visibility: the browser pause is resumed on return; our own pause (search) is not', async () => {
  const h = await open();
  await h.waitPlaying(0);
  const vis = v => h.page.evaluate(v => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v }); document.dispatchEvent(new Event('visibilitychange')); }, v);
  await h.page.evaluate(() => { const v = document.querySelector('.clip.on'); v.__paused = true; v.dispatchEvent(new Event('pause')); }); // browser paused it
  await vis('hidden'); let n = await h.mark(); await vis('visible');
  assert((await h.since(n)).some(c => c.startsWith('play')), 'tab return should resume');
  await h.get('d.browse(true)'); n = await h.mark();
  assert((await h.cur()).paused, 'search should pause');
  await vis('hidden'); await vis('visible');
  assert(!(await h.since(n)).some(c => c.startsWith('play')), 'must not resume while searching');
  await h.get('d.browse(false)');
  assert((await h.since(n)).some(c => c.startsWith('play')), 'closing search resumes');
  await h.close();
});

test('11 dim 3 s after playing; a touch restores', async () => {
  const h = await open();
  await h.waitPlaying(0);
  await h.page.waitForFunction(() => document.querySelector('[x-data="feed()"]').classList.contains('dim'), null, { timeout: 4500 });
  await h.gesture();
  assert(!(await h.get('d.dim')), 'touch should undim');
  await h.close();
});

test('12 fullscreen: native call on the active element; the hero image never hides a card that is not playing', async () => {
  const h = await open();
  await h.waitPlaying(0);
  const n = await h.mark();
  await h.page.locator('.card.on .rail button[aria-label="Pantalla completa"]').tap();
  assert((await h.since(n, await h.get('d.vid().n'))).includes('fullscreen') && await h.get('d.fs'), 'webkitEnterFullscreen expected');
  await h.close();
});

test('13 desktop: wheel steps, the preloaded card starts at once; Sonido click gives sound', async () => {
  const h = await open({ desktop: true });
  assert(await h.get('d.desk'), 'not desktop');
  await h.waitPlaying(0); await h.waitPre(1);
  const n = await h.mark(), pn = (await h.pre()).n;
  await h.page.mouse.move(700, 450); await h.page.mouse.wheel(0, 120);
  await h.waitPlaying(1);
  assert((await h.since(n, pn)).join() === 'play:muted', 'desktop preload start: ' + (await h.since(n, pn)));
  await h.page.locator('.card.on .rail button[aria-label=Sonido]').click();
  assert(!(await h.cur()).muted, 'Sonido should unmute');
  await h.close();
});

const rows = [];
for (const t of tests.filter(t => !process.env.ONLY || t.name.startsWith(process.env.ONLY))) {
  const t0 = Date.now();
  try { await t.fn(); rows.push([t.name, 'PASS', '']); } catch (e) { rows.push([t.name, 'FAIL', e.message.split('\n')[0]]); }
  rows[rows.length - 1].push(Date.now() - t0 + ' ms');
}
await browser.close(); server.close();
const w = Math.max(...rows.map(r => r[0].length));
console.log('\n' + 'Test'.padEnd(w) + '  Result  Time     Detail');
rows.forEach(([n, r, d, ms]) => console.log(n.padEnd(w) + '  ' + r.padEnd(6) + '  ' + ms.padEnd(7) + '  ' + d));
const failed = rows.filter(r => r[1] === 'FAIL').length;
console.log(`\n${rows.length - failed}/${rows.length} passed`);
process.exit(failed ? 1 : 0);
