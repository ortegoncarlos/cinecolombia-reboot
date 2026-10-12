// Feed sound flow (assets/app.js feed()): synthetic YouTube/TikTok player messages, every command we send recorded via
// window.__cmds (ytCmd). Real Chrome (channel 'chrome'), iPhone 13 emulation; player hosts are stubbed with blank pages.
// Run: npm i && npm test
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT)) return res.writeHead(403).end();
  fs.readFile(fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p, (err, buf) => {
    if (err) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }).end(buf);
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const { defaultBrowserType, ...IPHONE } = devices['iPhone 13'];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

async function open({ sound = null, desktop = false } = {}) {
  const ctx = await browser.newContext(desktop ? { viewport: { width: 1440, height: 900 } } : IPHONE);
  await ctx.addInitScript(s => {
    window.__cmds = [];
    // CDP navigations carry a user gesture, so Chrome reports hasBeenActive from the start: shim it with real input only.
    Object.defineProperty(navigator, 'userActivation', { value: { get hasBeenActive() { return !!window.__act; }, get isActive() { return false; } } });
    ['pointerup', 'touchend', 'mouseup', 'keydown', 'click'].forEach(t => addEventListener(t, () => { window.__act = 1; }, true));
    try { localStorage.setItem('cineco.city', 'bogota'); localStorage.setItem('cineco.geo', '{"lat":4.65,"lng":-74.05}'); if (s != null) localStorage.setItem('cineco.sound', s); } catch (e) { /* player stub frames */ }
  }, sound);
  await ctx.route(/youtube|tiktok/, r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title>' }));
  await ctx.route(/geojs|smartlook|image\.tmdb|fonts\.(googleapis|gstatic)/, r => r.abort());
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + 'index.html');
  await page.waitForFunction(() => { const r = document.querySelector('[x-data="feed()"]'); return window.Alpine && r && Alpine.$data(r).active === 0 && document.querySelector('[data-i="0"] .yt'); });
  return new Harness(ctx, page, errors);
}

class Harness {
  constructor(ctx, page, errors) { this.ctx = ctx; this.page = page; this.errors = errors; }
  close() { return this.ctx.close(); }
  get(expr) { return this.page.evaluate(new Function('const d = Alpine.$data(document.querySelector(\'[x-data="feed()"]\')); return ' + expr)); }
  call(expr) { return this.get(expr); }
  // Messages from card i's player; YouTube or TikTok format depending on the frame.
  async send(i, yt, tk) {
    await this.page.evaluate(([i, yt, tk]) => {
      const f = document.querySelector('[data-i="' + i + '"] .yt');
      if (!f) throw new Error('no player on card ' + i);
      window.dispatchEvent(new MessageEvent('message', f.tk
        ? { origin: 'https://www.tiktok.com', source: f.contentWindow, data: { ...tk, 'x-tiktok-player': true } }
        : { origin: 'https://www.youtube-nocookie.com', source: f.contentWindow, data: JSON.stringify(yt) }));
    }, [i, yt, tk]);
    await sleep(30);
  }
  // Ready = first message after the frame's own load (ytLoad resets rdy, so wait for it).
  async ready(i) {
    await this.page.waitForFunction(i => { const f = document.querySelector('[data-i="' + i + '"] .yt'); return f && f.ld && !f.rdy; }, i);
    await this.send(i, { event: 'onReady', info: { muted: true } }, { type: 'onPlayerReady' });
  }
  playing(i) { return this.send(i, { event: 'infoDelivery', info: { playerState: 1 } }, { type: 'onStateChange', value: 1 }); }
  paused(i) { return this.send(i, { event: 'infoDelivery', info: { playerState: 2 } }, { type: 'onStateChange', value: 2 }); }
  async scrollTo(i) {
    await this.page.evaluate(i => { const r = document.querySelector('.feed'), c = r.querySelector('[data-i="' + i + '"]'); r.querySelectorAll('.yt').forEach(f => { if (!f.rdy) f.ld = 0; }); r.scrollTop = c.offsetTop; }, i);
    await this.page.waitForFunction(i => Alpine.$data(document.querySelector('[x-data="feed()"]')).active === i, i);
    await sleep(50);
  }
  // A touch that hits no button or link (the card's media area).
  async gesture() {
    const vp = this.page.viewportSize(), x = Math.round(vp.width * 0.3), y = Math.round(vp.height * 0.35);
    const hit = await this.page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && e.closest('button,a') ? e.outerHTML.slice(0, 80) : ''; }, [x, y]);
    assert(!hit, 'gesture point hits a control: ' + hit);
    await this.page.touchscreen.tap(x, y);
    await sleep(30);
  }
  // A swipe (touch drag, dir 1 = forward): sets gest in our code but is not a browser activation (hasBeenActive stays false).
  async swipe(dir = 1) {
    await this.page.evaluate(dir => {
      const r = document.querySelector('.feed'), t = y => new Touch({ identifier: 1, target: r, clientX: 190, clientY: y });
      r.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, changedTouches: [t(400)], touches: [t(400)] }));
      r.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [t(dir > 0 ? 200 : 600)] }));
    }, dir);
    await sleep(30);
  }
  async noUnmute(i, n) { const c = await this.since(n, i); assert(!c.includes('unMute'), 'unMute outside a gesture on card ' + i + ': ' + c); }
  state(i) { return this.page.evaluate(i => { const f = document.querySelector('[data-i="' + i + '"] .yt'); return f ? { rdy: f.rdy, st: f.st, src: f.src } : null; }, i); }
  async tapSound() { await this.page.locator('.card.on .rail button[aria-label=Sonido]').tap(); await sleep(30); }
  async cmds(i) { return (await this.page.evaluate(() => window.__cmds)).filter(c => c[1] !== 'listening' && (i == null || c[0] === String(i))).map(c => c[1]); }
  mark() { return this.page.evaluate(() => window.__cmds.length); }
  async since(n, i) { return (await this.page.evaluate(n => window.__cmds.slice(n), n)).filter(c => c[1] !== 'listening' && (i == null || c[0] === String(i))).map(c => c[1]); }
  // Next card with sound = unMute + setVolume (+ playVideo) sent to its preloaded player inside the swipe gesture (pick()).
  async startsWithSound(i, n) {
    const c = await this.since(n, i), u = c.indexOf('unMute');
    await this.playing(i);
    assert(!(await this.since(n, i)).slice(c.length).includes('unMute'), 'unMute after playing (outside a gesture) on card ' + i);
    return u >= 0 && c[u + 1] === 'setVolume';
  }
  toast() { return this.page.evaluate(() => document.getElementById('toast').textContent); }
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('1 fresh visit, no preference: never unmutes', async () => {
  const h = await open();
  await h.ready(0); assert(!(await h.cmds(0)).includes('unMute'), 'unMute on ready');
  await h.playing(0); assert(!(await h.cmds(0)).includes('unMute'), 'unMute on playing');
  await h.gesture();
  assert(!(await h.cmds()).includes('unMute'), 'unMute after gesture with sound off');
  await h.close();
});

test('2 preference on, no gesture: stays muted (iOS rule 1)', async () => {
  const h = await open({ sound: '1' });
  await h.ready(0); assert(!(await h.cmds()).includes('unMute'), 'unMute on ready before any gesture');
  await h.playing(0); assert(!(await h.cmds()).includes('unMute'), 'unMute on playing before any gesture');
  assert(await h.get('d.pm') === true, 'pm should be true (icon shows muted)');
  await h.close();
});

test('3 preference on, tap first: card 0 stays muted (ready and playing are outside the gesture)', async () => {
  const h = await open({ sound: '1' });
  await h.gesture();
  await h.ready(0); await h.playing(0);
  assert(!(await h.cmds(0)).includes('unMute'), 'unMute outside a gesture: ' + (await h.cmds(0)));
  assert((await h.state(0)).src.includes('mute=1'), 'player must start muted');
  assert(await h.get('d.pm') === true && !(await h.get('d.snd')), 'icon must show muted');
  await h.close();
});

test('4 preference on, after a tap and a swipe: the next card starts by itself muted; only playVideo is sent, nothing to the card being left', async () => {
  const h = await open({ sound: '1' });
  await h.ready(0); await h.playing(0);
  await h.gesture();
  assert(!(await h.cmds(0)).includes('unMute'), 'tap on the card must not unmute it');
  await h.ready(1); await h.playing(1); await h.paused(1); // preload paused by us
  const n = await h.mark();
  await h.swipe(1); await h.scrollTo(1);
  assert((await h.since(n, 1)).join() === 'playVideo', 'activation of the preload: playVideo only, got ' + (await h.since(n, 1)));
  assert(!(await h.since(n, 0)).length, 'commands to the card being left: ' + (await h.since(n, 0)));
  await h.playing(1);
  assert(!(await h.since(n, 1)).includes('unMute') && await h.get('d.pm') === true, 'next card must stay muted (unMute only inside Sonido)');
  await h.close();
});

test('4b Sonido unmutes a playing card; iOS pauses it → remute + resume, no loop', async () => {
  const h = await open({ sound: '0' });
  await h.ready(0); await h.playing(0);
  await h.tapSound();
  assert((await h.cmds(0)).includes('unMute'), 'Sonido should unmute');
  let n = await h.mark();
  await h.paused(0);
  assert((await h.since(n, 0)).join() === 'mute,playVideo', 'expected mute,playVideo, got ' + (await h.since(n, 0)));
  assert(await h.get('d.pm') === true, 'pm should be true');
  assert((await h.toast()).includes('El sonido se activa con un toque en Sonido'), 'toast missing');
  n = await h.mark();
  await h.playing(0);
  assert(!(await h.since(n, 0)).includes('unMute'), 'unMute again on the remuted card');
  await h.close();
});

test('5 Sonido on a card that keeps playing: no remute', async () => {
  const h = await open({ sound: '0' });
  await h.ready(0); await h.playing(0);
  await h.tapSound();
  const n = await h.mark();
  await h.playing(0); await sleep(300); await h.playing(0);
  assert(!(await h.since(n, 0)).includes('mute'), 'remute without a pause');
  assert(await h.get('d.pm') === false, 'pm should be false');
  await h.close();
});

test('6 toggle off / on: saved and applied to later cards', async () => {
  const h = await open({ sound: '1' });
  await h.ready(0); await h.playing(0);
  let n = await h.mark();
  await h.tapSound(); // the card plays muted: the first tap gives it sound (inside the tap)
  assert((await h.since(n, 0)).join() === 'unMute,setVolume', 'first tap should unmute, got ' + (await h.since(n, 0)));
  n = await h.mark();
  await h.tapSound();
  assert((await h.since(n, 0)).includes('mute'), 'toggle off should mute');
  assert(await h.page.evaluate(() => localStorage.getItem('cineco.sound')) === '0', 'saved should be 0');
  n = await h.mark();
  await h.scrollTo(1);
  if (!(await h.page.evaluate(() => document.querySelector('[data-i="1"] .yt').rdy))) await h.ready(1);
  await h.playing(1);
  assert(!(await h.since(n)).includes('unMute'), 'unMute on next card with sound off');
  n = await h.mark();
  await h.tapSound();
  assert((await h.since(n, 1)).includes('unMute'), 'toggle on should unmute');
  assert(await h.page.evaluate(() => localStorage.getItem('cineco.sound')) === '1', 'saved should be 1');
  // next YouTube card through the hidden preload (autoplays muted, paused by us): on activation unMute, then playVideo
  const j = await h.get('d.queue.findIndex((it, k) => k > 1 && d.key(k) && !d.tok(k))');
  assert(j > 1, 'no YouTube card found');
  await h.scrollTo(j - 1);
  if (!(await h.page.evaluate(i => { const f = document.querySelector('[data-i="' + i + '"] .yt'); return f && f.rdy; }, j - 1))) await h.ready(j - 1);
  await h.playing(j - 1);
  await h.ready(j); // hidden preload ready
  assert(!(await h.cmds(j)).includes('unMute'), 'hidden preload must not unmute');
  await h.playing(j);
  assert((await h.cmds(j)).join() === 'pauseVideo', 'hidden YouTube preload should be paused once it plays: ' + (await h.cmds(j)));
  await h.paused(j);
  n = await h.mark();
  await h.scrollTo(j);
  let c = await h.since(n, j);
  assert(c.join() === 'playVideo', 'activation: playVideo, no reload, no unMute; got ' + c);
  assert((await h.state(j)).src.includes('autoplay=1'), 'YouTube preload src should be autoplay=1');
  await h.playing(j); c = await h.since(n, j);
  assert(c.join() === 'playVideo', 'no unMute outside a gesture (scroll by IntersectionObserver); got ' + c);
  await h.close();
});

// TikTok card 1 preloaded hidden (muted, paused by us), then activated.
async function tkPreloaded(sound) {
  const h = await open({ sound });
  await h.gesture(); await h.ready(0); await h.playing(0);
  assert(await h.get('d.tok(1)'), 'card 1 is expected to be a TikTok card');
  await h.page.waitForFunction(() => { const f = document.querySelector('[data-i="1"] .yt'); return f && f.ld; });
  assert(await h.page.evaluate(() => document.querySelector('[data-i="1"] .yt').src.includes('muted=1')), 'TikTok preload must be muted=1');
  await h.send(1, null, { type: 'onPlayerReady' });
  await h.playing(1);
  assert((await h.cmds(1)).join() === 'pauseVideo', 'hidden preload should be paused by us: ' + (await h.cmds(1)));
  await h.paused(1);
  assert(!(await h.cmds(1)).includes('mute'), 'remute on our own preload pause');
  const n = await h.mark();
  await h.scrollTo(1);
  return [h, await h.since(n, 1)];
}

test('7 TikTok preload activation: playVideo only, no reload, no unMute outside a gesture', async () => {
  let [h, c] = await tkPreloaded('0');
  assert(c.join() === 'playVideo', 'sound off: expected playVideo, got ' + c);
  await h.playing(1);
  assert(!(await h.cmds(1)).includes('unMute'), 'sound off: unMute');
  await h.close();
  [h, c] = await tkPreloaded('1');
  assert(c.join() === 'playVideo', 'sound on, no gesture: expected playVideo only (no muted=0 reload, no unMute), got ' + c);
  const src = await h.page.evaluate(() => document.querySelector('[data-i="1"] .yt').src);
  assert(src.includes('muted=1') && src.includes('autoplay=1'), 'TikTok src must stay muted=1, got ' + src);
  await h.playing(1);
  assert(!(await h.cmds(1)).includes('unMute'), 'unMute outside a gesture: ' + (await h.cmds(1)));
  assert(await h.get('d.playing'), 'not playing');
  await h.send(1, null, { type: 'onMute', value: true }); assert(await h.get('d.pm') === true, 'onMute true not synced');
  await h.send(1, null, { type: 'onMute', value: false }); assert(await h.get('d.pm') === false, 'onMute false not synced');
  await h.close();
});

test('8 our own pause (browse) right after unMute: no remute; browse(false) resumes', async () => {
  const h = await open({ sound: '1' });
  await h.ready(0); await h.playing(0); await h.gesture();
  let n = await h.mark();
  await h.call('d.browse(true)');
  await h.paused(0);
  const c = await h.since(n, 0);
  assert(c.join() === 'pauseVideo', 'expected only pauseVideo, got ' + c);
  assert(!(await h.toast()).includes('Sonido'), 'toast after our own pause');
  n = await h.mark();
  await h.call('d.browse(false)');
  assert((await h.since(n, 0)).join() === 'playVideo', 'browse(false) should play');
  await h.close();
});

test('9 tab return resumes a browser-paused player, not one we paused', async () => {
  const h = await open();
  await h.ready(0); await h.playing(0);
  const vis = v => h.page.evaluate(v => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => v === 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }, v);
  await vis('hidden'); await h.paused(0);
  let n = await h.mark();
  await vis('visible');
  assert((await h.since(n, 0)).includes('playVideo'), 'tab return should play');
  await h.playing(0);
  await h.call('ytCmd(d.yt(), "pauseVideo")'); await h.paused(0); // visitor's pause button
  await vis('hidden');
  n = await h.mark();
  await vis('visible');
  assert(!(await h.since(n, 0)).includes('playVideo'), 'resumed a player we paused');
  await h.close();
});

test('10 desktop: wheel navigates; the preloaded card starts with playVideo only; Sonido click unmutes the current card', async () => {
  const h = await open({ sound: '1', desktop: true });
  assert(await h.get('d.desk'), 'not in desktop mode');
  await h.ready(0); await h.playing(0);
  await h.page.waitForFunction(() => document.querySelector('[data-i="1"] .yt'));
  await h.ready(1); await h.playing(1); await h.paused(1);
  const n = await h.mark();
  await h.page.mouse.move(700, 450);
  await h.page.mouse.wheel(0, 120);
  await h.page.waitForFunction(() => Alpine.$data(document.querySelector('[x-data="feed()"]')).active === 1);
  assert((await h.since(n, 1)).join() === 'playVideo', 'expected playVideo only, got ' + (await h.since(n, 1)));
  await h.playing(1);
  assert(!(await h.since(n)).includes('unMute'), 'unMute outside Sonido');
  const m = await h.mark();
  await h.page.locator('.card.on .rail button[aria-label=Sonido]').click();
  assert((await h.since(m, 1)).join() === 'unMute,setVolume', 'Sonido should unmute, got ' + (await h.since(m, 1)));
  await h.close();
});

test('11 card 0 revealed only once playing', async () => {
  const h = await open();
  await h.ready(0);
  assert(!(await h.page.evaluate(() => document.querySelector('[data-i="0"]').classList.contains('play'))), '.play before playing');
  await h.playing(0);
  await h.page.waitForFunction(() => document.querySelector('[data-i="0"]').classList.contains('play'));
  assert(!h.errors.length, 'page errors: ' + h.errors.join('; '));
  await h.close();
});

test('12 TikTok src is always muted=1', async () => {
  for (const sound of ['0', '1']) {
    const h = await open({ sound });
    await h.gesture(); await h.ready(0); await h.playing(0);
    await h.page.waitForFunction(() => { const f = document.querySelector('[data-i="1"] .yt'); return f && f.ld; });
    const src = await h.page.evaluate(() => document.querySelector('[data-i="1"] .yt').src);
    assert(/tiktok/.test(src) && src.includes('muted=1'), 'sound=' + sound + ': preload src ' + src);
    await h.close();
  }
});

test('13 toggleSound on a playing TikTok card: unMute + setVolume (tap path)', async () => {
  const [h] = await tkPreloaded('0');
  await h.playing(1);
  const n = await h.mark();
  await h.tapSound();
  const c = await h.since(n, 1), u = c.indexOf('unMute');
  assert(u >= 0 && c[u + 1] === 'setVolume', 'expected unMute,setVolume, got ' + c);
  await h.close();
});

test('14 fresh load: card 0 plays on state 1 only; preload created at ready, not at playing', async () => {
  const h = await open();
  assert(await h.get('d.vid') === 0 && await h.get('d.pre') === -1, 'card 0 player at once, no preload yet');
  await h.ready(0);
  assert(!(await h.get('d.playing')), 'playing before state 1');
  await h.page.waitForFunction(() => Alpine.$data(document.querySelector('[x-data="feed()"]')).pre === 1, null, { timeout: 3000 });
  await h.page.waitForFunction(() => document.querySelector('[data-i="1"] .yt'));
  await h.playing(0);
  assert(await h.get('d.playing'), 'not playing after state 1');
  await h.close();
});

test('15 swipe right after the first card is ready: the preload is there and starts (playVideo)', async () => {
  const h = await open();
  await h.ready(0);
  await h.page.waitForFunction(() => document.querySelector('[data-i="1"] .yt'), null, { timeout: 3000 });
  await h.ready(1);
  const n = await h.mark();
  await h.scrollTo(1);
  assert(await h.get('d.vid') === 1, 'preloaded player should become the active one');
  assert((await h.since(n, 1)).join() === 'playVideo', 'expected playVideo, got ' + (await h.since(n, 1)));
  assert((await h.state(1)).src.includes('muted=1') || (await h.state(1)).src.includes('mute=1'), 'no sound without activation');
  await h.close();
});

test('16 no ▶ before 10 s; at 5 s one playVideo; at 10 s unstarted → ▶; state 1 clears it', async () => {
  const h = await open();
  await h.ready(0); // ready, never starts
  await sleep(5500);
  assert(await h.get('d.wait') === 0, '▶ shown too early');
  assert((await h.cmds(0)).includes('playVideo'), 'expected one playVideo retry at 5 s: ' + (await h.cmds(0)));
  await sleep(5000);
  assert(await h.get('d.wait') === 1, '▶ expected after 10 s unstarted');
  assert(await h.page.locator('.card.on .disc.big').isVisible(), '▶ control not visible');
  assert((await h.toast()).includes('Toca ▶'), 'toast missing');
  await h.playing(0);
  assert(await h.get('d.wait') === 0 && await h.get('d.playing'), 'state 1 should clear ▶');
  await h.close();
});

test('17 player that never answers: recreated once at 10 s, no ▶ while loading', async () => {
  const h = await open();
  const f1 = await h.page.evaluate(() => { const f = document.querySelector('[data-i="0"] .yt'); f.__id = 1; return 1; });
  await sleep(10500);
  assert(await h.get('d.wait') === 0, '▶ on a card still loading');
  assert(await h.page.evaluate(() => { const f = document.querySelector('[data-i="0"] .yt'); return f && !f.__id; }), 'player should have been recreated');
  await h.close();
});

test('18 scroll back: old player paused; preload follows the direction of travel', async () => {
  const h = await open();
  await h.ready(0); await h.playing(0);
  await h.page.waitForFunction(() => document.querySelector('[data-i="1"] .yt'));
  await h.scrollTo(1);
  await h.ready(1); await h.playing(1);
  await h.page.waitForFunction(() => Alpine.$data(document.querySelector('[x-data="feed()"]')).pre === 2);
  const n = await h.mark();
  await h.scrollTo(0);
  assert((await h.since(n, 1)).join() === 'pauseVideo', 'card 1 player should be paused: ' + (await h.since(n, 1)));
  assert(!(await h.page.evaluate(() => document.querySelector('[data-i="2"] .yt'))), 'card 2 player should be dropped');
  await h.page.waitForFunction(() => document.querySelector('[data-i="0"] .yt'));
  await h.ready(0); await h.playing(0);
  await h.page.waitForFunction(() => document.querySelector('[data-i="1"] .yt') && Alpine.$data(document.querySelector('[x-data="feed()"]')).pre === 1, null, { timeout: 3000 });
  // direction-aware: from card 2 going back to 1, card 0 is preloaded (not 2)
  await h.scrollTo(1); if (!(await h.state(1)).rdy) await h.ready(1); await h.playing(1); // kept player: already ready
  await h.scrollTo(2); if (!(await h.state(2)) || !(await h.state(2)).rdy) await h.ready(2); await h.playing(2);
  await h.scrollTo(1);
  await h.page.waitForFunction(() => Alpine.$data(document.querySelector('[x-data="feed()"]')).pre === 0, null, { timeout: 3000 });
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
