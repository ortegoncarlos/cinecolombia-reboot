// i18n: (a) every es.json key exists, non-empty, in the other dictionaries; (b) every key the HTML/JS uses exists in es.json;
// (c) each page in each language: no page errors, <html lang>, first tab/step label translated, no leftover Spanish UI words.
// Run: npm test (Chrome via playwright-core, no network).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCALE = { es: 'es-CO', en: 'en-US', fr: 'fr-FR', pt: 'pt-BR', zh: 'zh-CN' };
const D = Object.fromEntries(Object.keys(LOCALE).map(l => [l, JSON.parse(fs.readFileSync(path.join(ROOT, 'data/i18n', l + '.json'), 'utf8'))]));
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

// (a) completeness; Chinese has no plural forms, so *_one may be missing there (t() falls back to *_other).
for (const l of Object.keys(LOCALE).filter(l => l !== 'es'))
  for (const k of Object.keys(D.es)) check(D[l][k] ? true : l === 'zh' && k.endsWith('_one'), `${l}.json: missing or empty "${k}"`);
for (const l of Object.keys(LOCALE)) for (const [k, v] of Object.entries(D[l])) check(typeof v === 'string' && v.trim(), `${l}.json: empty "${k}"`);

// (b) keys used: $t('k') / t('k') / tOr('k', data-i18n="k" / data-i18n-a="attr:k", plus quoted literals inside $t(...) ternaries.
const files = ['index.html', 'pelicula.html', 'multiplex.html', 'boleta.html', 'assets/app.js', 'assets/boleta.js', 'assets/zombies.js'];
const NS = new Set(Object.keys(D.es).filter(k => k.includes('.')).map(k => k.split('.')[0]));
const has = k => k in D.es || k + '_other' in D.es;
for (const f of files) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8'), used = new Set();
  for (const m of src.matchAll(/(?:\$t|\bt|tOr)\('([\w.]+)'\s*[,)]/g)) used.add(m[1]);
  for (const m of src.matchAll(/data-i18n(?:-a)?="(?:[\w-]+:)?([\w.]+)"/g)) used.add(m[1]);
  for (const m of src.matchAll(/'([a-z]+)\.([\w]+)'/g)) if (NS.has(m[1]) && !/^(json|html|js|css|mp4|jpg)$/.test(m[2])) used.add(m[1] + '.' + m[2]);
  for (const k of used) check(has(k), `${f}: key "${k}" not in es.json`);
}

// (c) pages × languages
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = path.join(ROOT, decodeURIComponent(u.pathname));
  if (!p.startsWith(ROOT) || u.pathname.endsWith('.mp4')) return res.writeHead(404).end();
  fs.readFile(p, (err, buf) => err ? res.writeHead(404).end() : res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }).end(buf));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const day = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/showtimes/bogota/2026-10-12.json'), 'utf8'));
const film = Object.keys(day)[0], site = Object.keys(day[film])[0], show = day[film][site][0].id;
const PAGES = [
  ['index.html', '.tabs [role=tab]', 'sec.cartelera'],
  ['pelicula.html?id=' + film, '#h-hor', 'st.title'],
  ['multiplex.html?id=' + site, '#h-hor', 'st.title'],
  ['boleta.html?show=' + show, '.steps li', 'steps.seats']
];
const SPANISH = ['Cartelera', 'Sillas', 'Boletas', 'Continuar', 'Horarios'];
const { defaultBrowserType, ...IPHONE } = devices['iPhone 13'];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext(IPHONE);
await ctx.addInitScript(() => { try { localStorage.setItem('cineco.city', 'bogota'); localStorage.setItem('cineco.geo', '{"lat":4.65,"lng":-74.05}'); } catch (e) {} });
await ctx.route(/geojs|smartlook|image\.tmdb|ytimg|youtube|tiktok|fonts\.(googleapis|gstatic)/, r => r.abort());
let n = 0;
for (const [url, sel, key] of PAGES) for (const l of Object.keys(LOCALE)) {
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + url + (url.includes('?') ? '&' : '?') + 'lang=' + l);
  const tag = `${url.split('?')[0]} [${l}]`;
  try {
    await page.waitForFunction(([sel, want]) => document.documentElement.classList.contains('rdy') && document.querySelector(sel) && document.querySelector(sel).textContent.trim() === want, [sel, D[l][key]], { timeout: 8000 });
  } catch (e) { check(false, `${tag}: "${sel}" never showed "${D[l][key]}" (got "${await page.evaluate(s => document.querySelector(s) && document.querySelector(s).textContent.trim(), sel)}")`); }
  await page.waitForTimeout(400);
  check(await page.evaluate(() => document.documentElement.lang) === LOCALE[l], `${tag}: <html lang> is not ${LOCALE[l]}`);
  check(!errors.length, `${tag}: page errors: ${errors.join('; ')}`);
  check(await page.evaluate(want => [...document.querySelectorAll('.lbtn')].some(b => b.offsetParent && b.getAttribute('aria-label') === want), D[l]['lang.label']), `${tag}: no visible language button labelled "${D[l]['lang.label']}"`);
  if (l !== 'es') {
    // data (film titles, menu, cities) may legitimately contain these words: drop film titles before checking
    const text = await page.evaluate(() => { let s = document.body.innerText; document.querySelectorAll('.title,.bh-f b,.sumc b,.tk-top b,.fr h3,.nx-r span,.dh-t b').forEach(e => { if (e.innerText) s = s.split(e.innerText).join(' '); }); return s; });
    const left = SPANISH.filter(w => !Object.values(D[l]).some(v => v.includes(w))).filter(w => new RegExp('\\b' + w + '\\b').test(text));
    check(!left.length, `${tag}: Spanish left in the page: ${left.join(', ')}`);
  }
  n++;
  await page.close();
}
await browser.close(); server.close();
console.log(`i18n: ${Object.keys(D.es).length} keys × 5 languages, ${n} page loads`);
fails.forEach(f => console.log('FAIL ' + f));
console.log(fails.length ? `${fails.length} i18n failures` : 'i18n: all checks passed');
process.exit(fails.length ? 1 : 0);
