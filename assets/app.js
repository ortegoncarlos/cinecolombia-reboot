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

function isoDateInBogota(offsetDays = 0) {
  // Bogotá has no DST, so adding whole days in ms is safe.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(appNow().getTime() + offsetDays * 864e5));
}

const TODAY = isoDateInBogota(0);
const WEEK = [0, 1, 2, 3, 4, 5, 6].map(isoDateInBogota); // showtime window: today + 0…6
const DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const NC = navigator.connection, NOAUTO = RM || NC && (NC.saveData || /2g/.test(NC.effectiveType)); // no trailer autoplay/preload
const BD = innerWidth < 768 ? 'w780' : 'w1280'; // backdrops
const utc = iso => new Date(iso + 'T12:00:00Z');
const cap = s => s[0].toUpperCase() + s.slice(1);

function fmtDate(iso) {
  const i = WEEK.indexOf(iso), d = utc(iso);
  return { label: i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : cap(DAYS[d.getUTCDay()]), day: d.getUTCDate() };
}
function fmtRelease(iso, short) {
  const d = utc(iso), m = MONTHS[d.getUTCMonth()];
  return short ? d.getUTCDate() + ' ' + m.slice(0, 3) : d.getUTCDate() + ' de ' + m;
}
function fmtRuntime(m) {
  if (!m) return '';
  return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'min' : '');
}
function rateLabel(r) { return r.minAge ? '+' + r.minAge : r.text === 'Pendiente' ? '' : r.text; }
// One tag at a time: Preventa wins over Estreno (released within the last 7 days).
function filmTag(f) {
  if (f.status === 'preventa') return 'Preventa';
  const ago = (utc(TODAY) - utc(f.releaseDate)) / 864e5;
  return f.status === 'cartelera' && ago >= 0 && ago <= 7 ? 'Estreno' : '';
}
// Hidden films (data flag) never show anywhere: feed, search, detail, multiplex schedules. Filter every film list through this.
const listed = f => !!f && !f.hidden;
// One spelling per format/language everywhere: the data mixes "Subtitulado" (films) with SUB/DOB codes (showtimes).
const ATTR = { Subtitulado: 'Subtitulada', SUB: 'Subtitulada', DOB: 'Doblada', ESP: 'Español', Imax: 'IMAX', IFV: 'Infinity Vision' };
const attrLabel = a => ATTR[a] || a;
function metaLine(f) { return [fmtRuntime(f.runtime), f.genres.join(', ')].filter(Boolean).join(' · '); }
function imgSize(url, size) { return url && url.replace(/(image\.tmdb\.org\/t\/p\/)w\d+/, '$1' + size); }
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
const di = el => { const c = el && el.closest('[data-i]'); return c ? c.dataset.i : '?'; };
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
const fmtKm = k => k.toLocaleString('es-CO', { maximumFractionDigits: k < 10 ? 1 : 0 }) + ' km';
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
  t.textContent = msg;
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
  try { await navigator.clipboard.writeText(url); toast('Enlace copiado'); } catch (e) { toast(url); }
}

// Tablists (feed sections, search chips, day strips) and radio groups (payment): arrows/Home/End move and select;
// only the selected item is tabbable (roving tabindex in the markup).
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

// City bottom sheet, injected once per page.
document.body.insertAdjacentHTML('beforeend', `
<div class="sheet-bg" x-data x-show="$store.city.open" x-transition.opacity @click="$store.city.open=false" x-cloak></div>
<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-t" x-data x-show="$store.city.open" x-cloak
  @keydown.escape.window="$store.city.open=false"
  x-effect="citySheet($el, $store.city.open && $store.city.list.length)">
  <h2 id="sheet-t">Elige tu ciudad</h2>
  <ul><template x-for="c in $store.city.list" :key="c.slug"><li>
    <button class="city-row" :aria-current="c.slug === $store.city.slug" @click="$store.city.pick(c.slug)">
      <span x-text="c.name"></span><small x-text="c.sites.length + ' multiplex'"></small></button>
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
      toast('Según tu ubicación aproximada (IP) te mostramos ' + this.cur.name, ['Cambiar', () => { this.open = true; }], 6000);
    },
    pick(slug) { this.slug = slug; ls.set('cineco.city', slug); this.open = false; }
  });

  Alpine.store('shell', { cur: document.body.dataset.nav || '' }); // desktop app bar: current section

  Alpine.store('geo', {
    pos: null, busy: false,
    init() { try { this.pos = JSON.parse(ls.get('cineco.geo')); } catch (e) { /* corrupt */ } },
    set(p) { this.pos = p; ls.set('cineco.geo', JSON.stringify(p)); },
    ask() {
      if (!navigator.geolocation) return toast('Tu navegador no comparte ubicación');
      this.busy = true;
      navigator.geolocation.getCurrentPosition(
        p => { this.set({ lat: p.coords.latitude, lng: p.coords.longitude, src: 'gps', t: Date.now() }); this.busy = false; },
        () => { this.busy = false; toast('No pudimos obtener tu ubicación'); },
        { timeout: 10000, maximumAge: 600000 });
    },
    // Within 150 km only; otherwise data order, no distance.
    d(s) { const k = this.pos ? haversineKm(this.pos, s) : 1e9; return k <= 150 ? k : null; },
    km(s) { const k = this.d(s); return k == null ? '' : fmtKm(k) + (this.pos.src === 'ip' ? ' aprox.' : ''); },
    sort(sites) { return sites.some(s => this.d(s) != null) ? [...sites].sort((a, b) => this.d(a) - this.d(b)) : sites; }
  });
});

/* ---------- Feed ---------- */
const SECTIONS = {
  cartelera: ['Cartelera', 'En salas esta semana.'],
  preventa: ['Preventa', 'Asegura tu silla antes del estreno.'],
  pronto: ['Pronto', 'Lo que llega a Cine Colombia en las próximas semanas.'],
  alternativo: ['Alternativo', 'Cineco Alternativo: ópera, teatro, conciertos y arte.']
};
const altLabel = f => 'Cineco Alternativo' + (f.event ? ' · ' + f.event : '');

// Desktop app bar (≥1024px; display:none below, so the mobile pages are untouched). On the feed, the section links
// only change the hash (feed() listens) and search opens the browse overlay; elsewhere they open index.html#….
const DESK = matchMedia('(min-width:1024px)');
document.body.insertAdjacentHTML('afterbegin', `
<header class="dbar" x-data><div class="dbar-in">
  <a class="dbar-logo" href="index.html"><img class="logo" src="assets/logo-blanco.png" alt="Cine Colombia" width="108" height="28" loading="lazy"></a>
  <nav class="dnav" aria-label="Principal">${[...Object.keys(SECTIONS), 'multiplex'].map(t =>
    `<a href="${t === 'multiplex' ? 'multiplex.html' : 'index.html#' + t}" :aria-current="$store.shell.cur === '${t}' && 'page'">${t === 'multiplex' ? 'Multiplex' : SECTIONS[t][0]}</a>`).join('')}</nav>
  <button class="pill" @click="$store.city.open = true" :aria-label="'Elige tu ciudad' + ($store.city.cur ? ', actual ' + $store.city.cur.name : '')">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>
    <span x-text="$store.city.cur ? $store.city.cur.name : 'Elige tu ciudad'">Elige tu ciudad</span>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg></button>
  <a class="icon-btn" href="index.html#buscar" data-search aria-label="Buscar"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg></a>
</div></header>`);

function feed() {
  // Observers and timers live outside Alpine's reactive proxy (native objects break when proxied).
  let io, more, timer, dt, pt, dk, bt, told; // dt: 20 s no-playback limit, pt: deferred preload, dk: clear-mode dim, bt: autoplay-blocked check
  return {
    desk: DESK.matches, // desktop stage: same queue, one card shown, next-up rail (index.html)
    films: [], tab: SECTIONS[location.hash.slice(1)] ? location.hash.slice(1) : 'cartelera', q: '', bsec: 'todas', searching: false, queue: [], n: 6, gen: 0,
    // vid/pre: cards with an iframe (active, hidden preload of the next); ps/pm: player state/muted
    active: -1, vid: -1, pre: -1, np: -1, playing: false, ps: -1, pm: false, fs: false, dim: false, blocked: false, wait: 0, soundOn: ls.get('cineco.sound') === '1',
    get snd() { return this.soundOn && !this.pm; },

    async init() {
      const root = this.$refs.feed;
      io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && !this.desk && this.setActive(+e.target.dataset.i)), { root, threshold: 0.6 });
      more = new IntersectionObserver(es => { if (es[0].isIntersecting && this.n < this.queue.length) this.n += 6; }, { root, rootMargin: '0px 0px 150% 0px' });
      more.observe(this.$refs.sentinel);
      // After 'listening' the player reports state, muted, duration, currentTime.
      addEventListener('message', e => {
        if (!/youtube|tiktok/.test(e.origin)) return;
        let d = e.data; try { if (typeof d === 'string') d = JSON.parse(d); } catch (x) { return; }
        const el = [...root.querySelectorAll('.yt')].find(f => f.contentWindow === e.source);
        if (!d || !el) return;
        if (DBG) { const f = d.info || {}, ev = d.event || d.type; if (ev !== 'infoDelivery' && ev !== 'onCurrentTime') dbg('msg', di(el), el.tk ? 'tt' : 'yt', ev, typeof d.info === 'object' ? '' : d.info ?? d.value ?? ''); else if (f.playerState != null || f.muted != null) dbg('msg', di(el), 'yt info state=' + f.playerState, 'muted=' + f.muted); }
        const inf = d.event === 'infoDelivery' && d.info || {},
          st = el.tk ? d.type === 'onStateChange' ? d.value : null : d.event === 'onStateChange' ? d.info : inf.playerState;
        if (el.tk && d.type === 'onMute') inf.muted = d.value;
        if (inf.duration) el.dur = inf.duration;
        if (!el.rdy && (el.rdy = 1) && el.closest('.on')) { this.sound(el); this.arm(el); } // players always autostart; playVideo would bring up YouTube's overlay
        if (st != null) el.st = st;
        if (!el.closest('.on')) { if (el.tk && st === 1) ytCmd(el, 'pauseVideo'); return; } // hidden TikTok preload: buffer, don't play
        if (st != null) { this.ps = st; if (st === 1) { if (this.wait !== 2) this.blocked = false; this.wait = 0; if (!this.playing) { this.playing = true; this.wake(); dbg('playing', this.active, 'preload', this.np); } this.pre = this.np; } } // playing: start the next preload; autoplayed on its own: not blocked
        if (st === 0 && !el.tk) { ytCmd(el, 'seekTo', [0, true]); ytCmd(el, 'playVideo'); } // loop
        if (inf.muted != null) this.pm = inf.muted;
        if (el.dur && inf.currentTime != null) [el.closest('.card'), root.querySelector('.up')].forEach(n => n && n.style.setProperty('--t', Math.min(inf.currentTime / el.dur, 1)));
      });
      // Saved sound may be blocked until a gesture: unmute again then.
      ['pointerdown', 'keydown'].forEach(t => addEventListener(t, () => this.sound(), { once: true }));
      document.addEventListener('fullscreenchange', () => document.fullscreenElement || (this.fs = false));
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
        if (Math.abs(acc) >= 40) { this.go(this.active + Math.sign(acc)); acc = 0; lock = t; }
      }, { passive: true });
      addEventListener('keydown', e => {
        const d = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1 }[e.key];
        if (!d || !free() || e.altKey || e.metaKey || e.ctrlKey || (e.target.closest && e.target.closest('input,textarea,select,[role=tablist]'))) return;
        e.preventDefault(); this.go(this.active + d);
      });
    },
    go(i) {
      i = Math.max(0, Math.min(i, this.queue.length - 1));
      if (i === this.active) return;
      this.n = Math.max(this.n, i + 8);
      this.$nextTick(() => this.setActive(i));
    },
    get upFrom() { return Math.max(0, Math.min(this.active - 1, this.queue.length - 6)); },
    upKick(it) {
      if (it.f) return [filmTag(it.f) || (it.f.alt ? 'Alternativo' : ''), fmtRuntime(it.f.runtime)].filter(Boolean).join(' · ');
      return it.p ? 'TikTok' : it.type === 'div' ? 'Sección · ' + it.count + (it.count === 1 ? ' película' : ' películas') : '';
    },
    upTitle(it) { return (it.f || it.p || it).title || (it.type === 'end' ? 'Fin de la cartelera' : this.emptyText()[0]); },
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
        if (k) out.push({ type: 'div', key: 'd' + t, title: SECTIONS[t][0], text: SECTIONS[t][1], count: list.length });
        list.forEach(f => out.push({ type: 'film', key: f.id, f }));
      });
      if (cart) {
        this.promos.forEach(p => { const at = out.filter(o => o.f)[p.after - 1]; if (at) out.splice(out.indexOf(at) + 1, 0, { type: 'promo', key: 'p' + p.id, p }); });
        // feedOrder: 1-based position among all Cartelera cards; the rest keep their order.
        out.filter(o => o.f && o.f.feedOrder).forEach(o => { out.splice(out.indexOf(o), 1); out.splice(o.f.feedOrder - 1, 0, o); });
      }
      if (out.some(o => o.f)) out.push({ type: 'end', key: 'end' });
      io.disconnect(); clearTimeout(timer); clearTimeout(dt); clearTimeout(pt); clearTimeout(bt);
      this.gen++; this.active = this.vid = this.pre = -1; this.playing = false; this.wait = 0; this.wake(); this.n = 6; this.queue = out;
      this.$refs.feed.scrollTop = 0;
      if (this.desk) this.$nextTick(() => this.go(0));
    },

    // TikTok source of a card: the promo itself or a film's vertical trailer; none once it failed to load (films fall back to YouTube).
    // o.dead: nothing played within 20 s (blocked/slow network): player dropped until the card is shown again.
    tok(i) { const it = this.queue[i], o = it && (it.p || it.f); return o && !o.tkFail && !o.dead && (it.p || o.verticalTrailer); },
    key(i) { const t = this.tok(i), it = this.queue[i]; return t ? t.id : it && it.f && !it.f.dead && it.f.youtubeKey; },
    src(i, auto = 1) {
      const t = this.tok(i);
      return !t ? ytSrc(this.queue[i].f.youtubeKey, true, auto) : 'https://www.tiktok.com/player/v1/' + t.id + '?autoplay=' + auto +
        '&muted=1&loop=1&controls=0&progress_bar=0&play_button=0&volume_control=0&fullscreen_button=0&timestamp=0&description=0&music_info=0&rel=0&native_context_menu=0&closed_caption=0';
    },
    yt(i = this.active) { return this.$refs.feed.querySelector('[data-i="' + i + '"] .yt'); },
    // At most 2 iframes: active card + hidden paused preload of the next film (skipping a divider).
    setActive(i) {
      if (i === this.active) return;
      clearTimeout(timer); clearTimeout(dt); clearTimeout(pt); clearTimeout(bt); if (this.fs) this.fsOff();
      const o = this.queue[i] && (this.queue[i].p || this.queue[i].f); if (o) delete o.dead; // every visit retries
      const old = this.vid, key = this.key(i), ready = key && this.pre === i, first = this.active < 0;
      dbg('active', i, (this.queue[i] && (this.queue[i].f || this.queue[i].p || this.queue[i]).title || '').slice(0, 20), 'key=' + (key || 'none'), 'tk=' + !!this.tok(i), 'ready=' + !!ready, 'pre=' + this.pre);
      let k = i + 1; if (this.queue[k] && this.queue[k].type === 'div') k++;
      this.active = i; this.playing = false; this.ps = -1; this.wait = 0; this.wake();
      const up = this.$refs.feed.querySelector('.up'); if (up) up.style.setProperty('--t', 0);
      if (NOAUTO) return;
      // The next preload starts once this card plays (message handler), or after 8 s (autoplay blocked); at once without a trailer.
      this.vid = ready ? i : -1; this.np = this.key(k) ? k : -1; this.pre = this.np === old ? old : -1;
      if (this.pre === old) ytCmd(this.yt(old), 'pauseVideo'); // scrolled back: old player is now the preload
      pt = setTimeout(() => { this.pre = this.np; dbg('preload', this.np); }, key ? 8000 : 0);
      // Shown only on a real `playing` report (message handler); nothing within 20 s: drop the player for this card.
      // Preloaded YouTube (autoplay=0): switch to the autoplay URL (files cached).
      // ponytail: not playVideo on the paused preload: YouTube then overlays its pause/prev/next controls for ~4 s.
      // Preloaded TikTok (autoplay=1, paused once it plays): seek to 0 + play; still playing hidden: show now.
      // From scratch: create at once for the first card, else after 600 ms (flick-scrolling).
      const el = this.yt(), it = this.queue[i];
      if (key) dt = setTimeout(() => { if (this.active === i && !this.playing && !this.blocked) { (it.p || it.f).dead = true; dbg('dead', i); } }, 20000);
      if (ready && !el) this.vid = i; // preload not rendered yet (fast jumps): create the player now
      else if (ready && el.tk && el.rdy) { ytCmd(el, 'seekTo', [0]); ytCmd(el, 'playVideo'); this.sound(el); if (el.st === 1) { this.playing = true; this.wake(); } else this.arm(el); }
      else if (ready) el.src = this.src(i);
      else if (key) timer = setTimeout(() => { this.vid = i; }, first ? 0 : 600);
    },
    // One player factory for every card (YouTube or TikTok); a TikTok player without `load` in 15 s is dropped.
    mk(el, i) {
      const it = this.queue[i];
      el.tk = !!this.tok(i); el.classList.toggle('tk', el.tk); el.src = this.src(i, +(el.tk || i !== this.pre)); // TikTok preloads autoplay (muted) to buffer
      dbg('mk', i, 'tk=' + el.tk, 'autoplay=' + +(el.tk || i !== this.pre));
      if (el.tk) setTimeout(() => el.ld || !el.isConnected || ((it.p || it.f).tkFail = true), 15000); // a player dropped by a rebuild didn't fail
    },
    // Clear mode: 3 s after playback the UI over the video dims (CSS, mobile); any touch/focus/scroll restores and restarts.
    wake() {
      this.dim = false; clearTimeout(dk);
      const tick = () => { if (this.searching || this.$store.city.open) dk = setTimeout(tick, 3000); else { this.dim = true; dbg('dim'); } };
      if (this.playing) dk = setTimeout(tick, 3000);
    },
    // Autoplay refused (iOS Low Power Mode, browser setting): ready player that never plays/buffers within 2.5 s
    // (at once once seen this session). wait: 1 = our play control shown, 2 = tapped (the player's own button takes taps).
    // TikTok players can stay silent until they play: armed on iframe load too, with a longer wait (slow networks).
    arm(el, ms = 2500) {
      clearTimeout(bt);
      bt = setTimeout(() => {
        if (el !== this.yt() || this.playing || el.st === 1 || el.st === 3) return;
        this.blocked = true; this.wait = 1; dbg('arm -> blocked (st=' + el.st + ')');
        if (!told) told = toast(/iPhone|iPad/.test(navigator.userAgent) || /Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1
          ? 'Modo de bajo consumo: toca ▶ para ver el tráiler' : 'Tu navegador pausa los videos automáticos: toca ▶ para verlos', null, 5000) || 1;
      }, this.blocked ? 0 : ms);
    },
    tapPlay() {
      const el = this.yt(); this.wait = 2; if (el) el.rdy = 1; dbg('tap'); ytCmd(el, 'playVideo'); // a silent TikTok player never marked itself ready
      // ponytail: TikTok ignoring the play message: reload it with its own play button (a tap inside the frame is a valid gesture)
      if (el && el.tk) setTimeout(() => { if (this.wait === 2 && !this.playing && el.isConnected) { el.own = 1; el.src = el.src.replace('autoplay=1', 'autoplay=0').replace('play_button=0', 'play_button=1'); } }, 1500);
    },
    sound(el = this.yt()) { if (this.soundOn) { ytCmd(el, 'unMute'); ytCmd(el, 'setVolume', [100]); } },
    // 'listening' (YouTube) is lost while the player's script is still loading (seconds on a phone): repeat it every
    // 500 ms until the first answer marks the player ready (20 s cap).
    ytLoad(el) {
      el.rdy = 0; el.ld = 1; dbg('load', di(el)); el.closest('.card').style.setProperty('--t', 0);
      clearInterval(el.li); let n = 0;
      el.li = setInterval(() => { if (el.rdy || !el.isConnected || ++n > 40) clearInterval(el.li); else ytCmd(el, 'listening'); }, 500);
      ytCmd(el, 'listening');
      if (el.tk && !el.own && el.closest('.on')) this.arm(el, 6000); // own: reloaded with TikTok's play button, waiting for a tap in the frame
    },
    toggleSound() {
      this.soundOn = !this.snd; this.pm = !this.soundOn; this.wake();
      ls.set('cineco.sound', +this.soundOn);
      if (this.soundOn) this.sound(); else ytCmd(this.yt(), 'mute');
    },
    // .media goes fullscreen, or becomes a fixed overlay without the API (iPhone Safari).
    // Available before the trailer plays (and with autoplay off): creates the player if the card has none yet.
    fsOn() {
      this.fs = true; this.vid = this.active; this.wake();
      if (document.fullscreenEnabled) this.$refs.feed.querySelector('.card.on .media').requestFullscreen().catch(() => {});
    },
    fsOff() { this.fs = false; if (document.fullscreenElement) document.exitFullscreen(); },
    next(i) { const n = this.queue[i + 1]; return n && (n.f || n.p || n).title || ''; },
    emptyText() {
      const c = this.$store.city.cur;
      if (!c) return ['Elige tu ciudad', 'Así te mostramos la cartelera de tus multiplex.'];
      return ['Aún no hay funciones en ' + c.name, 'Prueba con otra ciudad o mira lo que llega pronto.'];
    },
    // Search = full-screen browse of every film for the city (history entry, so the back gesture closes it).
    browse(on) {
      this.searching = on; this.$refs.feed.inert = this.$refs.top.inert = document.querySelector('.tabbar').inert = on;
      ytCmd(this.yt(), on ? 'pauseVideo' : 'playVideo');
      if (on) { history.pushState({ browse: 1 }, ''); this.$nextTick(() => this.$refs.q.focus()); } else (this.desk ? document.querySelector('.dbar [data-search]') : this.$refs.sb).focus();
    },
    close() { history.state && history.state.browse ? history.back() : this.browse(false); },
    get results() {
      const c = this.$store.city.cur, ids = new Set(c ? c.nowShowingFilmIds : []), qn = norm(this.q), O = Object.keys(SECTIONS), s = this.bsec;
      return this.films.filter(f => (f.status !== 'cartelera' || f.alt || ids.has(f.id)) &&
          (s === 'todas' || (s === 'alternativo' ? f.alt : f.status === s)) && (!qn || norm(f.title + ' ' + (f.titleEs || '')).includes(qn)))
        .sort((a, b) => O.indexOf(a.status) - O.indexOf(b.status) || a.priority - b.priority);
    },
    top() { if (this.desk) this.go(0); else this.$refs.feed.scrollTo({ top: 0, behavior: RM ? 'auto' : 'smooth' }); }
  };
}
