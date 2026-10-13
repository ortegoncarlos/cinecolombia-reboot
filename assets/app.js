'use strict';
const DEMO_NOW = '2026-10-11T22:00:00-05:00'; // demo clock; set to null for the real time
function appNow() { return DEMO_NOW ? new Date(DEMO_NOW) : new Date(); }
window.appNow = appNow;
/* Cine Colombia: shared helpers + Alpine stores/components for the three pages. */

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* blocked storage: city just isn't remembered */ } }
};

const memo = {};
// Memoized; any failure (404, offline, bad JSON) resolves to {} so missing showtime days read as empty.
function loadJSON(url) {
  return memo[url] || (memo[url] = fetch(url).then(r => (r.ok ? r.json() : {})).catch(() => ({})));
}

function getQueryParam(k) { return new URLSearchParams(location.search).get(k); }

/* i18n: t(key, vars) over data/i18n/{lang}.json; Spanish (es.json) is the source and the fallback (missing key → Spanish → key).
   Language: ?lang= (saved), then the saved choice, then the browser; Alpine.start waits for the dictionaries (no flash of Spanish).
   {name} interpolates vars; a numeric vars.n picks key_one / key_other via Intl.PluralRules. */
const LOCALE = { es: 'es-CO', en: 'en-US', fr: 'fr-FR', pt: 'pt-BR', zh: 'zh-CN' };
const LANGS = [['es', 'Español'], ['en', 'English'], ['fr', 'Français'], ['pt', 'Português'], ['zh', '中文']];
if (LOCALE[getQueryParam('lang')]) ls.set('cineco.lang', getQueryParam('lang'));
const I18N = { d: {}, es: {}, lang: [ls.get('cineco.lang'), ...(navigator.languages || [navigator.language])].map(l => String(l || '').slice(0, 2).toLowerCase()).find(l => LOCALE[l]) || 'es' };
const rev = () => window.Alpine && Alpine.store('i18n') && Alpine.store('i18n').rev; // read in t(): Alpine effects re-render on a language swap
function t(k, v = {}) {
  rev();
  const sfx = typeof v.n === 'number' ? ['_' + new Intl.PluralRules(LOCALE[I18N.lang]).select(v.n), '_other', ''] : [''];
  let s;
  [I18N.d, I18N.es].some(D => sfx.some(x => (s = D[k + x]) != null));
  return String(s ?? k).replace(/\{(\w+)\}/g, (m, x) => v[x] ?? m);
}
const tOr = (k, fb) => { const s = t(k); return s === k ? fb : s; }; // data labels: unknown value → shown as is
const loc = () => (rev(), LOCALE[I18N.lang]);
// Static markup: data-i18n="…" (text) and data-i18n-a="attr:…" (attribute).
function i18nStatic() {
  document.documentElement.lang = LOCALE[I18N.lang];
  document.querySelectorAll('[data-i18n]').forEach(e => { e.textContent = t(e.dataset.i18n); });
  document.querySelectorAll('[data-i18n-a]').forEach(e => { const [a, k] = e.dataset.i18nA.split(':'); e.setAttribute(a, t(k)); });
}
// A page that sets its own <title>/description (film, multiplex, show) takes them out of the language swap.
const ownTitle = () => ['title', 'meta[name=description]'].forEach(q => { const e = document.querySelector(q); if (e) { e.removeAttribute('data-i18n'); e.removeAttribute('data-i18n-a'); } });
const dict = l => loadJSON('data/i18n/' + l + '.json');
const I18N_READY = Promise.all([dict('es'), dict(I18N.lang)]).then(([es, d]) => { I18N.es = es; I18N.d = d; i18nStatic(); });
// Alpine (the next deferred script) assigns window.Alpine and starts on a microtask: hold start() until the dictionaries are in.
// The page stays hidden until then (app.css html:not(.rdy)); 4 s safety in case Alpine never loads.
const shown = () => document.documentElement.classList.add('rdy');
setTimeout(shown, 4000);
Object.defineProperty(window, 'Alpine', { configurable: true, set(A) {
  const s = A.start.bind(A); A.start = () => I18N_READY.then(() => { s(); shown(); });
  Object.defineProperty(window, 'Alpine', { value: A, writable: true, configurable: true });
} });
// Live swap from the city sheet: new dictionary, static markup, then every Alpine binding that called t() re-renders.
async function setLang(l) {
  if (!LOCALE[l]) return;
  I18N.d = await dict(l); I18N.lang = l; ls.set('cineco.lang', l);
  const u = new URL(location.href);
  if (u.searchParams.has('lang')) { u.searchParams.set('lang', l); history.replaceState(history.state, '', u); }
  i18nStatic();
  const st = Alpine.store('i18n'); st.lang = l; st.rev++;
  dispatchEvent(new Event('langchange')); // non-reactive bits (boleta's seat map)
}

function isoDateInBogota(offsetDays = 0) {
  // Bogotá has no DST, so adding whole days in ms is safe.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(appNow().getTime() + offsetDays * 864e5));
}

const TODAY = isoDateInBogota(0);
const WEEK = [0, 1, 2, 3, 4, 5, 6].map(isoDateInBogota); // showtime window: today + 0…6
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const NC = navigator.connection, NOAUTO = RM || NC && (NC.saveData || /2g/.test(NC.effectiveType)); // no trailer autoplay/preload
const BD = innerWidth < 768 ? 'w780' : 'w1280'; // backdrops
const utc = iso => new Date(iso + 'T12:00:00Z');
const cap = s => s[0].toUpperCase() + s.slice(1);

const dtf = (iso, o) => new Intl.DateTimeFormat(loc(), { timeZone: 'UTC', ...o }).format(utc(iso));
// label "Hoy"/"Mié" (strip), low "hoy"/"mié" (inside sentences), day 14
function fmtDate(iso) {
  const i = WEEK.indexOf(iso), wd = i > 1 || i < 0 ? dtf(iso, { weekday: 'short' }).replace(/\.$/, '') : '';
  return { label: wd ? cap(wd) : t(i ? 'date.tomorrow' : 'date.today'), low: wd || t(i ? 'date.tomorrow_l' : 'date.today_l'), day: utc(iso).getUTCDate() };
}
// "14 de octubre" / short "14 oct"
function fmtRelease(iso, short) { return short ? dtf(iso, { day: 'numeric', month: 'short' }).replace(' de ', ' ') : dtf(iso, { day: 'numeric', month: 'long' }); }
function fmtRuntime(m) {
  if (!m) return '';
  const h = Math.floor(m / 60), r = m % 60;
  return t(h ? r ? 'fmt.hm' : 'fmt.h' : 'fmt.m', { h, m: r });
}
const cop = n => new Intl.NumberFormat(loc(), { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
function rateLabel(r) { return r.minAge ? '+' + r.minAge : r.text === 'Pendiente' ? '' : r.text === 'Todos' ? t('rating.all') : r.text; }
// One tag at a time: Preventa wins over Estreno (released within the last 7 days).
function filmTag(f) {
  if (f.status === 'preventa') return t('tag.presale');
  const ago = (utc(TODAY) - utc(f.releaseDate)) / 864e5;
  return f.status === 'cartelera' && ago >= 0 && ago <= 7 ? t('tag.new') : '';
}
// Hidden films (data flag) never show anywhere: feed, search, detail, multiplex schedules. Filter every film list through this.
const listed = f => !!f && !f.hidden;
// One spelling per format/language everywhere: the data mixes "Subtitulado" (films) with SUB/DOB codes (showtimes).
// Language codes → localised label (attrLabel) or short code (attrShort, showtime chips); brands stay.
const ATTR = { Subtitulado: 'sub', SUB: 'sub', Doblada: 'dob', DOB: 'dob', Español: 'esp', ESP: 'esp' }, BRAND = { Imax: 'IMAX', IFV: 'Infinity Vision' };
const attrLabel = a => ATTR[a] ? t('attr.' + ATTR[a]) : BRAND[a] || a;
const attrShort = a => ATTR[a] ? t('attr.' + ATTR[a] + '_s') : a === 'Imax' ? 'IMAX' : a;
const genres = (f, n = 9) => f.genres.slice(0, n).map(g => tOr('genre.' + g, g)).join(t('fmt.sep'));
function metaLine(f) { return [fmtRuntime(f.runtime), genres(f)].filter(Boolean).join(' · '); }
// TMDB sizes differ per image type: a poster used as hero (stored at w780) has no w1280 rendition.
function imgSize(url, size) { return url && url.replace(/(image\.tmdb\.org\/t\/p\/)w\d+/, '$1' + (size === 'w1280' && /\/w780\//.test(url) ? 'w780' : size)); }
function heroImg(f) { return f.hero || f.backdrop; } // hand-picked portrait-friendly still, else the TMDB backdrop
// Background embeds start muted (so autoplay is allowed); sound is toggled via the iframe API (ytCmd).
// No loop=1&playlist: that turns on YouTube's playlist chrome (prev/pause/next) at start; the feed loops on `ended` instead.
function ytSrc(key, bg, auto = 1) {
  return 'https://www.youtube-nocookie.com/embed/' + key + '?autoplay=' + auto + '&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3' +
    (bg ? '&mute=1&controls=0&disablekb=1&fs=0&enablejsapi=1&origin=' + encodeURIComponent(location.origin) : '&fs=1');
}
const TK = { playVideo: 'play', pauseVideo: 'pause', mute: 'mute', unMute: 'unMute', seekTo: 'seekTo' };
// Commands only once the player answered (el.rdy); earlier ones throw in the embed. TikTok players get their own message format.
function ytCmd(el, func, args = []) {
  if (!el || !el.contentWindow || !el.rdy && func !== 'listening') return;
  if (func !== 'listening') dbg('cmd', di(el), func, args.join(','));
  if (window.__cmds) window.__cmds.push([di(el), func, ...args]); // pelicula.html trailer; recorded when a test defines __cmds
  if (func === 'pauseVideo') el.ut = 0, el.op = 1; // our (or the visitor's) pause: not an iOS unmute refusal, not resumed on tab return
  if (func === 'playVideo') el.op = 0;
  if (el.tk) return TK[func] && el.contentWindow.postMessage({ type: TK[func], value: args[0], 'x-tiktok-player': true }, '*');
  el.contentWindow.postMessage(JSON.stringify(func === 'listening' ? { event: 'listening' } : { event: 'command', func, args }), '*');
}
// ?debug=1 / #debug: on-screen player log for real-device autoplay debugging; no-op otherwise.
const DBG = /[?&#]debug/.test(location.href), T0 = performance.now();
let dbgEl;
function dbg(...parts) {
  if (!DBG) return;
  const line = '+' + ((performance.now() - T0) / 1000).toFixed(2) + ' ' + parts.join(' ');
  console.log(line);
  if (!dbgEl) { dbgEl = document.createElement('pre'); dbgEl.id = 'dbg'; document.documentElement.append(dbgEl); }
  dbgEl.textContent = (dbgEl.textContent + line + '\n').split('\n').slice(-81).join('\n');
  dbgEl.scrollTop = 1e9;
}
const di = el => { const c = el && el.closest('[data-i]'); return c ? c.dataset.i : el && el.sg ? 'S' : '?'; };
if (DBG) {
  const ua = navigator.userAgent, ua2 = (ua.match(/OS [\d_]+|CriOS\/[\d.]+|Version\/[\d.]+|Chrome\/[\d.]+/g) || [ua.slice(0, 40)]).join(' ');
  dbg('ua', ua2, 'vis=' + document.visibilityState, 'rm=' + RM, 'noauto=' + !!NOAUTO, 'ua-act=' + !!(navigator.userActivation && navigator.userActivation.isActive), innerWidth + 'x' + innerHeight);
  const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.setAttribute('playsinline', '');
  v.src = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
  v.play().then(() => dbg('probe ok'), x => dbg('probe', x.name)).finally(() => { v.pause(); v.removeAttribute('src'); v.load(); });
  document.addEventListener('visibilitychange', () => dbg('vis', document.visibilityState));
  ['pagehide', 'pageshow'].forEach(t => addEventListener(t, e => dbg(t, e.persisted ? 'persisted' : '')));
}
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function haversineKm(a, b) {
  const r = x => x * Math.PI / 180, dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
const fmtKm = k => k.toLocaleString(loc(), { maximumFractionDigits: k < 10 ? 1 : 0 }) + ' km';
const mapsUrl = s => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'https://maps.apple.com/?q=' : 'https://www.google.com/maps/search/?api=1&query=') + s.lat + ',' + s.lng;
// One day of showtimes for a city ({filmId: {siteId: [showings]}}), memoized; i = index in WEEK.
// ponytail: snapshot ends 2026-10-17 (see README); later days read as empty without a 404. Update with the data.
const LAST_DAY = '2026-10-17';
const loadDay = (city, i) => WEEK[i] > LAST_DAY ? Promise.resolve({}) : loadJSON('data/showtimes/' + city + '/' + WEEK[i] + '.json');
// Preventa released after the snapshot: its release week instead of this week, simulated in data/showtimes/preventa/{film}/{city}.json ({from, days: {iso: {siteId: [showings]}}}).
const relWeek = f => f.status === 'preventa' && f.releaseDate > LAST_DAY ? WEEK.map((x, k) => new Date(utc(f.releaseDate).getTime() + k * 864e5).toISOString().slice(0, 10)) : null;
const loadPv = (film, city) => loadJSON('data/showtimes/preventa/' + film + '/' + city + '.json').then(d => d.days || {});
// New day in Bogotá: TODAY/WEEK are stale.
if (!DEMO_NOW) document.addEventListener('visibilitychange', () => document.hidden || isoDateInBogota() === TODAY || location.reload());

// The live region exists before the first message (screen readers skip text injected with the region); hover/focus keeps it open.
const toastEl = Object.assign(document.createElement('div'), { id: 'toast', className: 'toast' });
toastEl.setAttribute('role', 'status');
document.body.append(toastEl);
const toastOff = () => { toastEl.classList.remove('on'); const b = toastEl.querySelector('button'); if (b) b.remove(); }; // no invisible focusable action
['pointerenter', 'focusin'].forEach(k => toastEl.addEventListener(k, () => clearTimeout(toast.t)));
['pointerleave', 'focusout'].forEach(k => toastEl.addEventListener(k, () => { toast.t = setTimeout(toastOff, 2000); }));
function toast(msg, action, ms = 2200) {
  const t = toastEl;
  t.textContent = msg; delete t.dataset.sim;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action[0]; b.onclick = () => { toastOff(); action[1](); };
    t.append(' · ', b);
  }
  t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(toastOff, ms);
}
// Session recording for the demo (Smartlook). Empty key: nothing loads. The IP-level city and coordinates from
// guessCity() are attached to the session as properties and as a 'geo' event; the exact GPS position is never sent.
const SMARTLOOK_KEY = '28bd4201d0b84cafe2223460d29a285989bfff3a', SMARTLOOK_REGION = 'eu';
if (SMARTLOOK_KEY) {
  window.smartlook || (function (d) { const o = window.smartlook = function () { o.api.push(arguments); }, c = d.createElement('script'); o.api = []; c.async = true; c.src = 'https://web-sdk.smartlook.com/recorder.js'; d.head.appendChild(c); })(document);
  smartlook('init', SMARTLOOK_KEY, { region: SMARTLOOK_REGION });
}
const track = (e, p) => window.smartlook && smartlook('track', e, p); // custom Smartlook event (no-op without the recorder)
const geoLog = (slug, me) => { if (!window.smartlook) return; const p = { city: slug, lat: me.lat, lng: me.lng, geo: 'ip', ua: navigator.userAgent }; smartlook('properties', p); smartlook('track', 'geo', p); };
// Nearest city to the visitor's IP location (kept to sort multiplex); Bogotá when the lookup fails, takes > 3 s, or nothing is within 150 km.
async function guessCity(list) {
  try {
    const g = await fetch('https://get.geojs.io/v1/ip/geo.json', { signal: AbortSignal.timeout(3000) }).then(r => r.json());
    const me = { lat: +g.latitude, lng: +g.longitude, src: 'ip', t: Date.now() };
    if (isNaN(me.lat) || isNaN(me.lng)) throw 0;
    Alpine.store('geo').set(me);
    let best = null, bestKm = Infinity;
    list.forEach(c => c.sites.forEach(s => { const k = haversineKm(me, s); if (k < bestKm) { bestKm = k; best = c; } }));
    geoLog(best && bestKm <= 150 ? best.slug : 'bogota', me);
    if (best && bestKm <= 150) return best.slug;
  } catch (e) { /* offline, blocked or slow: fall back */ }
  return 'bogota';
}
const SITE_URL = 'https://ortegoncarlos.github.io/cinecolombia-reboot'; // share links use the static OG pages at /s/{id}/ (generated at deploy)
async function shareFilm(f, url = SITE_URL + '/s/' + f.id + '/') {
  if (navigator.share) { try { await navigator.share({ title: f.title, text: f.shortSynopsis || f.title, url }); } catch (e) { /* cancelled */ } return; }
  try { await navigator.clipboard.writeText(url); toast(t('toast.copied')); } catch (e) { toast(url); }
}

// Tablists (feed sections, search chips, day strips) and radio groups (payment): arrows/Home/End move and select;
// only the selected item is tabbable (roving tabindex in the markup).
// Menus: arrows/Home/End move focus only (picking is a click).
function menuKeys(e) {
  const b = [...e.currentTarget.querySelectorAll('button')], i = b.indexOf(document.activeElement);
  const n = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: b.length - 1 }[e.key];
  if (n == null) return;
  e.preventDefault(); b[(n + b.length) % b.length].focus();
}
function tabKeys(e) {
  const tabs = [...e.currentTarget.querySelectorAll('[role=tab],[role=radio]')], i = tabs.indexOf(document.activeElement), r = tabs.length && tabs[0].getAttribute('role') === 'radio';
  const n = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1, ...(r && { ArrowDown: i + 1, ArrowUp: i - 1 }) }[e.key];
  if (i < 0 || n == null || !tabs[n]) return;
  e.preventDefault(); tabs[n].focus(); tabs[n].click();
}

// City sheet: page behind is inert, focus goes to the current city and back to the opener on close.
let opener;
function citySheet(el, on) {
  on = !!on;
  if (citySheet.on === on) return;
  citySheet.on = on;
  document.querySelectorAll('body>:not(.sheet,.sheet-bg)').forEach(e => { e.inert = on; });
  if (on) { opener = document.activeElement; setTimeout(() => (el.querySelector('[aria-current=true]') || el.querySelector('button')).focus()); }
  else if (opener) opener.focus();
}

// Language chips, one template: the city sheet's radio group and the top-right globe menu (menuitemradio).
const langChips = (role, attrs) => `<template x-for="[k, n] in LANGS" :key="k"><button type="button" role="${role}" :lang="k" :aria-checked="$store.i18n.lang === k" ${attrs} x-text="n"></button></template>`;
const LANG_BADGE = { es: 'ES', en: 'EN', fr: 'FR', pt: 'PT', zh: '中' };
// Translate (文A) button + anchored menu; pages mark its spot with <span data-lang></span> (the desktop bar includes it).
// Outside tap, Escape or picking closes it; focus goes back to the button.
const LANG_MENU = `<div class="lmenu" x-data="{ open: false }" @keydown.escape="if (open) { open = false; $refs.b.focus() }" @click.outside="open = false" @focusout="$el.contains($event.relatedTarget) || (open = false)">
  <button type="button" class="icon-btn lbtn" x-ref="b" aria-haspopup="menu" :aria-expanded="open + ''" :aria-label="$t('lang.label')" @click="open = !open; open && $nextTick(() => $refs.m.querySelector('[aria-checked=true]').focus())"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg><b class="lbadge" aria-hidden="true" x-text="LANG_BADGE[$store.i18n.lang]"></b></button>
  <div class="lpop" role="menu" x-ref="m" x-show="open" x-cloak :aria-label="$t('lang.label')" @keydown="menuKeys($event)">${langChips('menuitemradio', 'tabindex="-1" @click="setLang(k); open = false; $refs.b.focus()"')}</div>
</div>`;
document.querySelectorAll('[data-lang]').forEach(e => { e.outerHTML = LANG_MENU; });

// City bottom sheet, injected once per page.
document.body.insertAdjacentHTML('beforeend', `
<div class="sheet-bg" x-data x-show="$store.city.open" x-transition.opacity @click="$store.city.open=false" x-cloak></div>
<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-t" x-data x-show="$store.city.open" x-cloak
  @keydown.escape.window="$store.city.open=false"
  x-effect="citySheet($el, $store.city.open && $store.city.list.length)">
  <h2 id="sheet-l" class="sheet-l" x-text="$t('lang.title')"></h2>
  <div class="chips langs" role="radiogroup" aria-labelledby="sheet-l" @keydown="tabKeys($event)">
    ${langChips('radio', ':tabindex="$store.i18n.lang === k ? 0 : -1" @click="setLang(k)"')}
  </div>
  <h2 id="sheet-t" x-text="$t('city.choose')"></h2>
  <ul><template x-for="c in $store.city.list" :key="c.slug"><li>
    <button class="city-row" :aria-current="c.slug === $store.city.slug" @click="$store.city.pick(c.slug)">
      <span x-text="c.name"></span><small x-text="$t('city.n_sites', { n: c.sites.length })"></small></button>
  </li></template></ul>
</div>`);

document.addEventListener('alpine:init', () => {
  Alpine.store('city', {
    list: [], slug: ls.get('cineco.city'), open: false,
    get cur() { return this.list.find(c => c.slug === this.slug) || null; },
    async init() {
      const l = await loadJSON('data/cities.json');
      this.list = Array.isArray(l) ? l : [];
      if (this.cur || !this.list.length) return void (this.cur && !Alpine.store('geo').pos && guessCity(this.list));
      this.slug = null;
      const slug = await guessCity(this.list);
      if (this.slug) return; // picked by hand while we were guessing
      this.pick(this.list.some(c => c.slug === slug) ? slug : this.list[0].slug);
      toast(t('toast.city_guess', { city: this.cur.name }), [t('toast.change'), () => { this.open = true; }], 6000);
    },
    pick(slug) { this.slug = slug; ls.set('cineco.city', slug); this.open = false; }
  });

  Alpine.store('i18n', { lang: I18N.lang, rev: 0 });
  Alpine.magic('t', () => t);
  Alpine.store('shell', { cur: document.body.dataset.nav || '' }); // desktop app bar: current section

  Alpine.store('geo', {
    pos: null, busy: false,
    init() { try { this.pos = JSON.parse(ls.get('cineco.geo')); } catch (e) { /* corrupt */ } },
    set(p) { this.pos = p; ls.set('cineco.geo', JSON.stringify(p)); },
    ask() {
      if (!navigator.geolocation) return toast(t('toast.geo_unsupported'));
      this.busy = true;
      navigator.geolocation.getCurrentPosition(
        p => { this.set({ lat: p.coords.latitude, lng: p.coords.longitude, src: 'gps', t: Date.now() }); this.busy = false; },
        () => { this.busy = false; toast(t('toast.geo_failed')); },
        { timeout: 10000, maximumAge: 600000 });
    },
    // Within 150 km only; otherwise data order, no distance.
    d(s) { const k = this.pos ? haversineKm(this.pos, s) : 1e9; return k <= 150 ? k : null; },
    km(s) { const k = this.d(s); return k == null ? '' : this.pos.src === 'ip' ? t('geo.km_ip', { km: fmtKm(k) }) : fmtKm(k); },
    sort(sites) { return sites.some(s => this.d(s) != null) ? [...sites].sort((a, b) => this.d(a) - this.d(b)) : sites; }
  });
});

/* ---------- Feed ---------- */
// Feed sections; names and blurbs are t('sec.' + key) / t('sec.' + key + '_d').
const SECTIONS = { cartelera: 1, preventa: 1, pronto: 1, alternativo: 1 };
// City pill (feed, multiplex, desktop bar): current city or the prompt.
const cityName = () => { const c = Alpine.store('city').cur; return c ? c.name : t('city.choose'); };
const cityAria = () => { const c = Alpine.store('city').cur; return c ? t('city.choose_cur', { city: c.name }) : t('city.choose'); };
const altLabel = f => 'Cineco Alternativo' + (f.event ? ' · ' + f.event : '');

// Desktop app bar (≥1024px; display:none below, so the mobile pages are untouched). On the feed, the section links
// only change the hash (feed() listens) and search opens the browse overlay; elsewhere they open index.html#….
const DESK = matchMedia('(min-width:1024px)');
document.body.insertAdjacentHTML('afterbegin', `
<header class="dbar" x-data><div class="dbar-in">
  <a class="dbar-logo" href="index.html"><img class="logo" src="assets/logo-blanco.png" alt="Cine Colombia" width="108" height="28" loading="lazy"></a>
  <nav class="dnav" :aria-label="$t('nav.main')">${[...Object.keys(SECTIONS), 'multiplex'].map(k =>
    `<a href="${k === 'multiplex' ? 'multiplex.html' : 'index.html#' + k}" :aria-current="$store.shell.cur === '${k}' && 'page'"${k === 'multiplex' ? '>Multiplex' : ` x-text="$t('sec.${k}')">`}</a>`).join('')}</nav>
  <button class="pill" @click="$store.city.open = true" :aria-label="cityAria()">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>
    <span x-text="cityName()"></span>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg></button>
  <a class="icon-btn" href="index.html#buscar" data-search :aria-label="$t('search.open')"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg></a>
  ${LANG_MENU}
</div></header>`);

function feed() {
  // Observers, timers and the two <video> elements live outside Alpine's reactive proxy (native objects break when proxied).
  // timer: deferred load on a from-scratch card (flick-scrolling), pt: preload fallback, ck: 10 s no-playback check, dk: clear-mode dim.
  // ht/nt: first-visit coach mark and nudge timers; ?fresh=1 forgets the first swipe (testing on the phone).
  let io, more, timer, pt, ck, dk, ht, nt, V = [], cur = 0, told, via = ''; // via: how the next activation was asked for (card_view)
  // The flag lives in localStorage plus a 1-year cookie (private mode / blocked storage). ?fresh=1 is one-shot: it clears both and
  // drops itself from the URL, so a refresh keeps the newly saved flag.
  if (/[?&]fresh=1/.test(location.search)) {
    ls.set('cineco.swiped', ''); document.cookie = 'cineco_swiped=; max-age=0; path=/';
    const u = new URL(location.href); u.searchParams.delete('fresh'); history.replaceState(history.state, '', u.pathname + u.search + u.hash);
  }
  let swiped = !!ls.get('cineco.swiped') || /(?:^|; )cineco_swiped=1/.test(document.cookie);
  return {
    desk: DESK.matches, // desktop stage: same queue, one card shown, next-up rail (index.html)
    films: [], tab: SECTIONS[location.hash.slice(1)] ? location.hash.slice(1) : 'cartelera', q: '', bsec: 'todas', searching: false, queue: [], n: 6, gen: 0,
    // Two native players inside the .feed scroller, placed over a card's media box so they scroll with it: V[cur] holds the active
    // card, the other one preloads the next clip in the swipe direction (roles swap on activation: instant start). Once Sonido
    // set muted=false inside a tap, both elements stay unlocked for the session (Shorts mechanism): every later card has sound.
    // playing: active clip renders (reveals it); pm: muted; wait: ▶ control when even muted playback was refused.
    active: -1, nxt: -1, playing: false, pm: true, fs: false, dim: false, wait: 0, soundOn: ls.get('cineco.sound') === '1', unl: false,
    hint: false, hintPos: '', // first-visit coach mark ("swipe up" / "wheel or arrows") and its fixed position over the first card
    get snd() { return this.soundOn && !this.pm; },

    async init() {
      const root = this.$refs.feed;
      io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && !this.desk && this.setActive(+e.target.dataset.i)), { root, threshold: 0.6 });
      more = new IntersectionObserver(es => { if (es[0].isIntersecting && this.n < this.queue.length) this.n += 6; }, { root, rootMargin: '0px 0px 150% 0px' });
      more.observe(this.$refs.sentinel);
      V = [this.$refs.v0, this.$refs.v1];
      V.forEach((v, n) => {
        v.n = n; v.i = -1;
        v.addEventListener('playing', () => { dbg('playing', v.n, v.i); if (v === V[cur] && v.i === this.active) { this.playing = true; this.wait = 0; this.wake(); this.place(v); if (v.i === 0 && !swiped && !nt && !this.desk && !RM) nt = setTimeout(() => this.nudge(), 6000); } });
        v.addEventListener('pause', () => dbg('pause', v.n, v.i, 'ended=' + v.ended));
        v.addEventListener('error', () => dbg('error', v.n, v.i, v.error && v.error.code));
        v.addEventListener('loadeddata', () => { dbg('loaded', v.n, v.i); if (v !== V[cur] || !this.playing) { if (v === V[cur]) this.preload(); } else this.preload(); });
        v.addEventListener('timeupdate', () => { if (v === V[cur] && v.duration) [root.querySelector('.card.on'), root.querySelector('.up')].forEach(n => n && n.style.setProperty('--t', Math.min(v.currentTime / v.duration, 1))); });
        v.addEventListener('webkitendfullscreen', () => { this.fs = false; v.play().catch(() => {}); });
      });
      // Tab back: resume the active clip if the browser paused it (not the visitor or us).
      document.addEventListener('visibilitychange', () => { const v = V[cur]; if (document.visibilityState === 'visible' && v.i === this.active && v.paused && !v.op && !this.searching) v.play().catch(() => {}); });
      document.addEventListener('fullscreenchange', () => document.fullscreenElement || (this.fs = false));
      addEventListener('resize', () => V.forEach(v => this.place(v)));
      root.addEventListener('scroll', () => { if (!swiped && root.scrollTop > 0) this.swipedOnce(); }, { passive: true }); // any real scroll counts as the first swipe
      this.films = ((await loadJSON('data/films.json')).films || []).filter(listed);
      const pr = await loadJSON('data/promos.json');
      this.promos = Array.isArray(pr) ? pr : [];
      ['tab', '$store.city.slug', '$store.city.list'].forEach(k => this.$watch(k, () => this.build()));
      addEventListener('popstate', () => this.searching && this.browse(false));
      this.desktop(root);
      this.build();
      if (location.hash === '#buscar') { history.replaceState(null, '', location.pathname + location.search); this.browse(true); }
    },
    // Desktop: wheel / ↑↓ / rail clicks step through the queue; crossing 1024px re-renders once.
    desktop(root) {
      let wl = 0, lock = 0, acc = 0;
      const free = () => this.desk && !this.searching && !this.$store.city.open;
      DESK.addEventListener('change', e => { this.desk = e.matches; this.build(); });
      addEventListener('hashchange', () => { const h = location.hash.slice(1); if (SECTIONS[h]) this.tab = h; else if (h === 'buscar') this.browse(true); });
      this.$watch('tab', t => { this.$store.shell.cur = t; });
      this.$store.shell.cur = this.tab;
      document.querySelector('.dbar [data-search]').addEventListener('click', e => { e.preventDefault(); this.searching ? this.close() : this.browse(true); });
      // one step per gesture: trackpad inertia keeps firing, so stay locked until the wheel is quiet for 250 ms (max 1 s)
      addEventListener('wheel', e => {
        if (!free() || e.ctrlKey) return;
        const t = e.timeStamp, quiet = t - wl > 250; wl = t;
        if (lock && !quiet && t - lock < 1000) return;
        lock = 0; acc += e.deltaY;
        if (Math.abs(acc) >= 40) { this.go(this.active + Math.sign(acc), 'wheel'); acc = 0; lock = t; }
      }, { passive: true });
      addEventListener('keydown', e => {
        const d = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1 }[e.key];
        if (!d || !free() || e.altKey || e.metaKey || e.ctrlKey || (e.target.closest && e.target.closest('input,textarea,select,[role=tablist]'))) return;
        e.preventDefault(); this.go(this.active + d, 'key');
      });
    },
    go(i, how = 'tap') {
      i = Math.max(0, Math.min(i, this.queue.length - 1));
      if (i === this.active) return;
      via = how;
      this.n = Math.max(this.n, i + 8);
      this.$nextTick(() => this.setActive(i));
    },
    get upFrom() { return Math.max(0, Math.min(this.active - 1, this.queue.length - 6)); },
    upKick(it) {
      if (it.f) return [filmTag(it.f) || (it.f.alt ? t('sec.alternativo') : ''), fmtRuntime(it.f.runtime)].filter(Boolean).join(' · ');
      return it.p ? 'TikTok' : it.type === 'div' ? t('feed.section') + ' · ' + t('feed.n_films', { n: it.count }) : '';
    },
    upTitle(it) { return (it.f || it.p || {}).title || (it.sec ? t('sec.' + it.sec) : it.type === 'end' ? t('feed.end_short') : this.emptyText()[0]); },
    obs(el) { io.observe(el); },

    build() {
      const c = this.$store.city.cur, ids = new Set(c ? c.nowShowingFilmIds : []);
      // ponytail: Preventa and Pronto are national lists; 30 of 35 preventa films have no showtimes in this week's snapshot,
      // so filtering them by city would empty the tab. Filter by city once preventa showtimes cover the release dates.
      // Alternativo is national and stands alone; the status tabs chain Cartelera → Preventa → Pronto.
      const O = ['cartelera', 'preventa', 'pronto'], alt = this.tab === 'alternativo', out = [];
      // Cartelera: featured films pinned first (any city/status, not repeated below), promos after their `after`-th film.
      const cart = this.tab === 'cartelera', feat = cart ? this.films.filter(f => f.featured) : [];
      feat.forEach(f => out.push({ type: 'film', key: f.id, f }));
      (alt ? [this.tab] : O.slice(O.indexOf(this.tab))).forEach((t, k) => {
        const list = this.films.filter(f => (alt ? f.alt : f.status === t) && (t !== 'cartelera' || ids.has(f.id)) && !feat.includes(f));
        if (alt) list.sort((a, b) => O.indexOf(a.status) - O.indexOf(b.status) || a.releaseDate.localeCompare(b.releaseDate));
        if (!list.length) { if (!out.length) out.push({ type: 'empty', key: 'empty' }); return; }
        if (k) out.push({ type: 'div', key: 'd' + t, sec: t, count: list.length });
        list.forEach(f => out.push({ type: 'film', key: f.id, f }));
      });
      if (cart) {
        this.promos.forEach(p => { const at = out.filter(o => o.f)[p.after - 1]; if (at) out.splice(out.indexOf(at) + 1, 0, { type: 'promo', key: 'p' + p.id, p }); });
        // feedOrder: 1-based position among all Cartelera cards; the rest keep their order.
        out.filter(o => o.f && o.f.feedOrder).forEach(o => { out.splice(out.indexOf(o), 1); out.splice(o.f.feedOrder - 1, 0, o); });
      }
      if (out.some(o => o.f)) out.push({ type: 'end', key: 'end' });
      io.disconnect(); clearTimeout(timer); clearTimeout(pt); clearTimeout(ck);
      V.forEach(v => { v.pause(); v.i = -1; v.classList.remove('on'); });
      this.gen++; this.active = -1; this.playing = false; this.wait = 0; this.wake(); this.n = 6; this.queue = out;
      this.$refs.feed.scrollTop = 0;
      if (this.desk) this.$nextTick(() => this.go(0));
    },

    // Clip of a card: the promo's or the film's self-hosted trailer (media/trailers); none → the hero image with its Ken Burns move.
    clip(i) { const it = this.queue[i], o = it && (it.p || it.f); return o && o.clip || ''; },
    vert(i) { const it = this.queue[i], o = it && (it.p || it.f); return !!(o && o.vertical); },
    nb(i, d) { let k = i + d; while (this.queue[k] && !this.clip(k)) k += d; return this.clip(k) ? k : -1; }, // next card with a clip in direction d
    vid() { return V[cur]; }, // the active card's player (tests, fullscreen)
    // One state per card: no clip → loading (src set) → loaded → playing (`playing` event); check() watches it.
    setActive(i) {
      if (i === this.active) return;
      clearTimeout(timer); clearTimeout(pt); clearTimeout(ck); if (this.fs) this.fsOff();
      const prev = this.active, clip = this.clip(i), first = prev < 0, o = V[1 - cur];
      // Preload in the direction of travel (swiping back is as common as forward), skipping a divider card; the other way at the ends.
      const dir = i < prev ? -1 : 1; let k = this.nb(i, dir); if (k < 0) k = this.nb(i, -dir);
      this.active = i; this.playing = false; this.wait = 0; this.nxt = k; this.wake();
      const it = this.queue[i] || {}, film = it.f || it.p || {};
      track('card_view', { id: film.id || it.key, title: film.title || it.type, index: i, via: first ? 'initial' : via || 'swipe', muted: !(this.soundOn && this.unl) }); via = '';
      if (!swiped) { if (!first) this.swipedOnce(); else if (i === 0) { clearTimeout(ht); ht = setTimeout(() => this.showHint(), 1500); } }
      if (window.zombies) { const f = this.queue[i] && this.queue[i].f; f && /resident evil/i.test(f.title) ? zombies.start(this.$refs.feed.querySelector('.card[data-i="' + i + '"]'), 4000) : zombies.stop(); } // easter egg
      const up = this.$refs.feed.querySelector('.up'); if (up) up.style.setProperty('--t', 0);
      dbg('active', i, (this.queue[i] && (this.queue[i].f || this.queue[i].p || this.queue[i]).title || '').slice(0, 20), 'clip=' + !!clip, 'pre=' + (o.i === i), 'next=' + this.nxt);
      if (NOAUTO) return;
      // Roles swap when the card was preloaded (instant start), or when the card just left is the next one to preload (swiping
      // back): its player is kept paused and the free one loads the new card.
      if (o.i === i || V[cur].i === prev && prev === k) cur = 1 - cur;
      const v = V[cur], p = V[1 - cur];
      p.pause(); p.op = 1;
      if (!clip) { v.pause(); v.op = 1; V.forEach(x => x.classList.remove('on')); this.preload(); return; }
      if (v.i === i) this.start(v); // preloaded (or kept): instant
      else timer = setTimeout(() => { this.load(v, i); this.start(v); }, first ? 0 : 600); // from scratch; 600 ms absorbs flick-scrolling
      if (v.readyState >= 2) this.preload(); else pt = setTimeout(() => this.preload(), 1500); // the next card: now if this one has data, else at loadeddata or 1.5 s
      ck = setTimeout(() => this.check(i), 10000);
    },
    load(v, i) { v.i = i; v.op = 0; v.classList.toggle('vert', this.vert(i)); v.src = this.clip(i); v.load(); this.place(v); dbg('load', v.n, i); },
    // Hidden preload of `next` in the free player (muted, paused at the first frame, placed under its card).
    preload() { const k = this.nxt, p = V[1 - cur]; if (k < 0 || p.i === k || k === this.active) return; p.pause(); p.muted = true; this.load(p, k); dbg('preload', k); },
    // Plays the active card's clip from the top; sound once the elements are unlocked (Sonido) and the preference is on. A refused
    // play() (iOS Low Power Mode, thermal state) is retried muted; refused muted too → our ▶ control.
    start(v) {
      v.op = 0; v.muted = !(this.soundOn && this.unl); this.pm = v.muted; v.classList.toggle('vert', this.vert(v.i)); this.place(v);
      if (v.currentTime > 0.5) v.currentTime = 0;
      dbg('play', v.n, v.i, 'muted=' + v.muted);
      v.play().catch(e => { dbg('refused', e.name, 'muted=' + v.muted); if (e.name === 'AbortError') return; if (!v.muted) { v.muted = true; this.pm = true; v.play().catch(() => this.refused()); } else this.refused(); }); // AbortError: superseded by a newer load (rebuild)
    },
    refused() { if (V[cur].i !== this.active) return; this.wait = 1; dbg('wait'); if (!told) told = toast(t('feed.tap_play'), null, 5000) || 1; },
    // 10 s without `playing` on a card with a clip: one more muted play(); still nothing → ▶ (never while the file is still loading).
    check(i) { const v = V[cur]; if (this.active !== i || this.playing || v.i !== i) return; dbg('check', 'rs=' + v.readyState, 'paused=' + v.paused); if (v.readyState < 2) return; v.muted = true; this.pm = true; v.play().catch(() => this.refused()); ck = setTimeout(() => { if (!this.playing && this.active === i) this.refused(); }, 3000); },
    tapPlay() { const v = V[cur]; this.wait = 2; dbg('tap'); this.unl = true; v.muted = !this.soundOn; this.pm = v.muted; v.play().catch(() => { this.wait = 1; }); },
    // Players sit in the feed's scroll content over their card's media box (offsets within .feed), so they scroll with the card.
    place(v) {
      const card = this.$refs.feed.querySelector('[data-i="' + v.i + '"]'), m = card && card.querySelector('.media');
      if (!m) return;
      v.style.cssText = 'top:' + (card.offsetTop + m.offsetTop) + 'px;left:' + (card.offsetLeft + m.offsetLeft) + 'px;width:' + m.offsetWidth + 'px;height:' + m.offsetHeight + 'px';
    },
    // Clear mode: 3 s after playback the UI over the video dims (CSS, mobile); any touch/focus/scroll restores and restarts.
    wake() {
      this.dim = false; clearTimeout(dk);
      const tick = () => { if (this.searching || this.$store.city.open) dk = setTimeout(tick, 3000); else { this.dim = true; dbg('dim'); } };
      if (this.playing) dk = setTimeout(tick, 3000);
    },
    // Sonido, inside the tap: muted=false on the active player and a silent play()+pause() on the preload one, so both elements
    // drop WebKit's gesture restriction for the rest of the session; later cards then start with sound without a gesture.
    toggleSound() {
      this.soundOn = !this.snd; this.wake(); ls.set('cineco.sound', +this.soundOn); track(this.soundOn ? 'sound_on' : 'sound_off', { index: this.active });
      const v = V[cur], p = V[1 - cur];
      if (this.soundOn) {
        if (!this.unl) { this.unl = true; const m = p.muted; p.muted = false; p.play().then(() => { p.pause(); p.muted = m; }, () => { p.muted = m; }); dbg('unlock'); }
        v.muted = false; this.pm = false; if (v.paused && v.i === this.active) v.play().catch(() => {});
      } else { v.muted = true; this.pm = true; }
      dbg('sound', this.soundOn);
    },
    // Native fullscreen of the active clip (iPhone: webkitEnterFullscreen with the system controls; elsewhere requestFullscreen).
    fsOn() { const v = V[cur]; if (v.i !== this.active) return; this.fs = true; this.wake(); if (v.webkitEnterFullscreen && !document.fullscreenEnabled) v.webkitEnterFullscreen(); else if (v.requestFullscreen) v.requestFullscreen().catch(() => { this.fs = false; }); },
    fsOff() { this.fs = false; if (document.fullscreenElement) document.exitFullscreen(); },
    // First visit: coach mark 1.5 s into the first card. Phone: right above the "Siguiente" row, and the info block slides up by
    // the coach's height (.hinting) so the CTA stays clear; desktop: inside the stage's bottom edge.
    showHint() {
      const c = this.$refs.feed.querySelector('.card.on'), m = c && c.querySelector('.media'), nx = c && c.querySelector(':scope>.next');
      if (swiped || this.active !== 0 || !m || this.searching) return;
      const r = m.getBoundingClientRect(), y = this.desk ? r.bottom - 24 : (nx && nx.offsetParent ? nx : document.querySelector('.tabbar')).getBoundingClientRect().top - 4;
      this.hintPos = 'bottom:' + Math.round(innerHeight - y) + 'px;left:' + Math.round(r.left + r.width / 2) + 'px';
      this.hint = true; track('swipe_hint_shown', { desk: this.desk });
      this.$nextTick(() => this.$root.style.setProperty('--coach-h', this.$root.querySelector('.coach').offsetHeight + 12 + 'px'));
    },
    // One gentle lift of the feed's content (40 px up, eased back) 6 s into the first clip if nobody has swiped yet (phones only).
    nudge() {
      if (swiped || this.active !== 0) return;
      [...this.$refs.feed.children, this.$root.querySelector('.coach')].forEach(el => el.animate([{ transform: 'none', easing: 'cubic-bezier(.3,0,.2,1)' }, { transform: 'translateY(-40px)', offset: .37, easing: 'cubic-bezier(.4,0,.2,1)' }, { transform: 'none' }], 950));
    },
    swipedOnce() { swiped = true; ls.set('cineco.swiped', '1'); document.cookie = 'cineco_swiped=1; max-age=31536000; path=/; SameSite=Lax'; clearTimeout(ht); clearTimeout(nt); track('first_swipe', { hint: this.hint, desk: this.desk }); this.hint = false; },
    goNext(i) { if (this.desk) this.go(i + 1); else { via = 'tap'; this.$refs.feed.scrollTo({ top: (i + 1) * this.$refs.feed.clientHeight, behavior: RM ? 'auto' : 'smooth' }); } },
    nextPoster(i) { const n = this.queue[i + 1]; return n && n.f ? imgSize(n.f.poster, 'w92') : ''; },
    next(i) { const n = this.queue[i + 1]; return !n ? '' : (n.f || n.p) ? (n.f || n.p).title : n.sec ? t('sec.' + n.sec) : ''; },
    emptyText() {
      const c = this.$store.city.cur;
      if (!c) return [t('city.choose'), t('feed.empty_nocity')];
      return [t('feed.empty_t', { city: c.name }), t('feed.empty_d')];
    },
    // Search = full-screen browse of every film for the city (history entry, so the back gesture closes it).
    browse(on) {
      this.searching = on; this.$refs.feed.inert = this.$refs.top.inert = document.querySelector('.tabbar').inert = on;
      const v = V[cur]; if (v && v.i === this.active) { if (on) { v.pause(); v.op = 1; } else { v.op = 0; v.play().catch(() => {}); } }
      if (on) { history.pushState({ browse: 1 }, ''); this.$nextTick(() => this.$refs.q.focus()); } else (this.desk ? document.querySelector('.dbar [data-search]') : this.$refs.sb).focus();
    },
    close() { history.state && history.state.browse ? history.back() : this.browse(false); },
    get results() {
      const c = this.$store.city.cur, ids = new Set(c ? c.nowShowingFilmIds : []), qn = norm(this.q), O = Object.keys(SECTIONS), s = this.bsec;
      return this.films.filter(f => (f.status !== 'cartelera' || f.alt || ids.has(f.id)) &&
          (s === 'todas' || (s === 'alternativo' ? f.alt : f.status === s)) && (!qn || norm(f.title + ' ' + (f.titleEs || '')).includes(qn)))
        .sort((a, b) => O.indexOf(a.status) - O.indexOf(b.status) || a.priority - b.priority);
    },
    top() { if (this.desk) this.go(0); else { via = 'tap'; this.$refs.feed.scrollTo({ top: 0, behavior: RM ? 'auto' : 'smooth' }); } }
  };
}
