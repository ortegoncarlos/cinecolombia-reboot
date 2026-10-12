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
function metaLine(f) { return [fmtRuntime(f.runtime), f.genres.join(', ')].filter(Boolean).join(' · '); }
function imgSize(url, size) { return url && url.replace(/(image\.tmdb\.org\/t\/p\/)w\d+/, '$1' + size); }
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
  if (el.tk) return TK[func] && el.contentWindow.postMessage({ type: TK[func], value: args[0], 'x-tiktok-player': true }, '*');
  el.contentWindow.postMessage(JSON.stringify(func === 'listening' ? { event: 'listening' } : { event: 'command', func, args }), '*');
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
// Alpine mixin for detail/multiplex: needs has(i); call first(city) and $watch('sel', i => this.day(i)). Stale cities dropped.
const showDays = {
  week: [], sel: 0, city: null,
  async day(i) {
    const c = this.city, d = await loadDay(c, i);
    if (c === this.city) this.week[i] = d;
  },
  async first(c) { // first day with showtimes: usually 1-2 requests
    this.city = c; this.week = []; this.sel = 0;
    for (let i = 0; c && i < 7; i++) { await this.day(i); if (c !== this.city) return; if (this.has(i)) return void (this.sel = i); }
  }
};
// New day in Bogotá: TODAY/WEEK are stale.
if (!DEMO_NOW) document.addEventListener('visibilitychange', () => document.hidden || isoDateInBogota() === TODAY || location.reload());

function toast(msg, action, ms = 2200) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action[0]; b.onclick = () => { t.classList.remove('on'); action[1](); };
    t.append(' · ', b);
  }
  t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), ms);
}
// Nearest city to the visitor's IP location (kept to sort multiplex); Bogotá when the lookup fails, takes > 3 s, or nothing is within 150 km.
async function guessCity(list) {
  try {
    const g = await fetch('https://get.geojs.io/v1/ip/geo.json', { signal: AbortSignal.timeout(3000) }).then(r => r.json());
    const me = { lat: +g.latitude, lng: +g.longitude, src: 'ip', t: Date.now() };
    if (isNaN(me.lat) || isNaN(me.lng)) throw 0;
    Alpine.store('geo').set(me);
    let best = null, bestKm = Infinity;
    list.forEach(c => c.sites.forEach(s => { const k = haversineKm(me, s); if (k < bestKm) { bestKm = k; best = c; } }));
    if (best && bestKm <= 150) return best.slug;
  } catch (e) { /* offline, blocked or slow: fall back */ }
  return 'bogota';
}
const SITE_URL = 'https://ortegoncarlos.github.io/cinecolombia-reboot'; // share links use the static OG pages at /s/{id}/ (generated at deploy)
async function shareFilm(f, url = SITE_URL + '/s/' + f.id + '/') {
  if (navigator.share) { try { await navigator.share({ title: f.title, text: f.shortSynopsis || f.title, url }); } catch (e) { /* cancelled */ } return; }
  try { await navigator.clipboard.writeText(url); toast('Enlace copiado'); } catch (e) { toast(url); }
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

function feed() {
  // Observers and timers live outside Alpine's reactive proxy (native objects break when proxied).
  let io, more, timer;
  return {
    films: [], tab: 'cartelera', q: '', bsec: 'todas', searching: false, queue: [], n: 6, gen: 0,
    // vid/pre: cards with an iframe (active, hidden preload of the next); ps/pm: player state/muted
    active: -1, vid: -1, pre: -1, playing: false, ps: -1, pm: false, fs: false, soundOn: ls.get('cineco.sound') === '1',
    get snd() { return this.soundOn && !this.pm; },

    async init() {
      const root = this.$refs.feed;
      io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && this.setActive(+e.target.dataset.i)), { root, threshold: 0.6 });
      more = new IntersectionObserver(es => { if (es[0].isIntersecting && this.n < this.queue.length) this.n += 6; }, { root, rootMargin: '0px 0px 150% 0px' });
      more.observe(this.$refs.sentinel);
      // After 'listening' the player reports state, muted, duration, currentTime.
      addEventListener('message', e => {
        if (!/youtube|tiktok/.test(e.origin)) return;
        let d = e.data; try { if (typeof d === 'string') d = JSON.parse(d); } catch (x) { return; }
        const el = [...root.querySelectorAll('.yt')].find(f => f.contentWindow === e.source);
        if (!d || !el) return;
        const inf = d.event === 'infoDelivery' && d.info || {},
          st = el.tk ? d.type === 'onStateChange' ? d.value : null : d.event === 'onStateChange' ? d.info : inf.playerState;
        if (el.tk && d.type === 'onMute') inf.muted = d.value;
        if (inf.duration) el.dur = inf.duration;
        if (!el.rdy && (el.rdy = 1) && el.closest('.on')) this.sound(el); // players always autostart; playVideo would bring up YouTube's overlay
        if (st != null) el.st = st;
        // TikTok: its loading screen stays hidden until state 1 (playing); no state at all: show 2.5 s after onPlayerReady.
        if (el.tk && d.type === 'onPlayerReady') setTimeout(() => { if (el.closest('.on')) this.playing = true; }, 2500);
        if (!el.closest('.on')) { if (el.tk && st === 1) ytCmd(el, 'pauseVideo'); return; } // hidden TikTok preload: buffer, don't play
        if (st != null) { this.ps = st; if (st === 1) this.playing = true; }
        if (st === 0 && !el.tk) { ytCmd(el, 'seekTo', [0, true]); ytCmd(el, 'playVideo'); } // loop
        if (inf.muted != null) this.pm = inf.muted;
        if (el.dur && inf.currentTime != null) el.closest('.card').style.setProperty('--t', Math.min(inf.currentTime / el.dur, 1));
      });
      // Saved sound may be blocked until a gesture: unmute again then.
      ['pointerdown', 'keydown'].forEach(t => addEventListener(t, () => this.sound(), { once: true }));
      document.addEventListener('fullscreenchange', () => document.fullscreenElement || (this.fs = false));
      this.films = ((await loadJSON('data/films.json')).films || []).filter(listed);
      const pr = await loadJSON('data/promos.json');
      this.promos = Array.isArray(pr) ? pr : [];
      ['tab', '$store.city.slug', '$store.city.list'].forEach(k => this.$watch(k, () => this.build()));
      addEventListener('popstate', () => this.searching && this.browse(false));
      this.build();
    },
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
      io.disconnect(); clearTimeout(timer);
      this.gen++; this.active = this.vid = this.pre = -1; this.playing = false; this.n = 6; this.queue = out;
      this.$refs.feed.scrollTop = 0;
    },

    // TikTok source of a card: the promo itself or a film's vertical trailer; none once it failed to load (films fall back to YouTube).
    tok(i) { const it = this.queue[i], o = it && (it.p || it.f); return o && !o.tkFail && (it.p || o.verticalTrailer); },
    key(i) { const t = this.tok(i), it = this.queue[i]; return t ? t.id : it && it.f && it.f.youtubeKey; },
    src(i, auto = 1) {
      const t = this.tok(i);
      return !t ? ytSrc(this.queue[i].f.youtubeKey, true, auto) : 'https://www.tiktok.com/player/v1/' + t.id + '?autoplay=' + auto +
        '&muted=1&loop=1&controls=0&progress_bar=0&play_button=0&volume_control=0&fullscreen_button=0&timestamp=0&description=0&music_info=0&rel=0&native_context_menu=0&closed_caption=0';
    },
    yt(i = this.active) { return this.$refs.feed.querySelector('[data-i="' + i + '"] .yt'); },
    // At most 2 iframes: active card + hidden paused preload of the next film (skipping a divider).
    setActive(i) {
      if (i === this.active) return;
      clearTimeout(timer); if (this.fs) this.fsOff();
      const old = this.vid, key = this.key(i), ready = key && this.pre === i, first = this.active < 0;
      let k = i + 1; if (this.queue[k] && this.queue[k].type === 'div') k++;
      this.active = i; this.playing = false; this.ps = -1;
      if (NOAUTO) return;
      this.vid = ready ? i : -1; this.pre = this.key(k) ? k : -1;
      if (this.pre === old) ytCmd(this.yt(old), 'pauseVideo'); // scrolled back: old player is now the preload
      // Shown as soon as the player reports `playing` (message handler).
      // Preloaded YouTube (autoplay=0): switch to the autoplay URL (files cached); no `playing` within 1.5 s: show anyway.
      // ponytail: not playVideo on the paused preload: YouTube then overlays its pause/prev/next controls for ~4 s.
      // Preloaded TikTok (autoplay=1, paused once it plays): seek to 0 + play; still playing hidden: show now.
      // From scratch: create at once for the first card, else after 600 ms (flick-scrolling); YouTube without answer in 1.2 s: show anyway.
      const el = this.yt(), show = () => { if (this.active === i) this.playing = true; };
      if (ready && el.tk && el.rdy) { ytCmd(el, 'seekTo', [0]); ytCmd(el, 'playVideo'); this.sound(el); if (el.st === 1) show(); else timer = setTimeout(() => this.playing || show(), 2500); }
      else if (ready) { el.src = this.src(i); if (!el.tk) timer = setTimeout(() => this.playing || show(), 1500); }
      else if (key) timer = setTimeout(() => { this.vid = i; timer = setTimeout(() => { const f = this.yt() || {}; f.tk || f.rdy || show(); }, 1200); }, first ? 0 : 600);
    },
    // One player factory for every card (YouTube or TikTok); a TikTok player without `load` in 6 s is dropped.
    mk(el, i) {
      const it = this.queue[i];
      el.tk = !!this.tok(i); el.classList.toggle('tk', el.tk); el.src = this.src(i, +(el.tk || i !== this.pre)); // TikTok preloads autoplay (muted) to buffer
      if (el.tk) setTimeout(() => el.ld || ((it.p || it.f).tkFail = true), 6000);
    },
    sound(el = this.yt()) { if (this.soundOn) { ytCmd(el, 'unMute'); ytCmd(el, 'setVolume', [100]); } },
    // 'listening' (YouTube) may be missed right at `load`: repeat it. The first answer marks the player ready.
    ytLoad(el) {
      el.rdy = 0; el.ld = 1; el.closest('.card').style.setProperty('--t', 0);
      [0, 500, 1500].forEach(ms => setTimeout(() => ytCmd(el, 'listening'), ms));
    },
    toggleSound() {
      this.soundOn = !this.snd; this.pm = !this.soundOn;
      ls.set('cineco.sound', +this.soundOn);
      if (this.soundOn) this.sound(); else ytCmd(this.yt(), 'mute');
    },
    // .media goes fullscreen, or becomes a fixed overlay without the API (iPhone Safari).
    // Available before the trailer plays (and with autoplay off): creates the player if the card has none yet.
    fsOn() {
      this.fs = true; this.vid = this.active;
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
      if (on) { history.pushState({ browse: 1 }, ''); this.$nextTick(() => this.$refs.q.focus()); } else this.$refs.sb.focus();
    },
    close() { history.state && history.state.browse ? history.back() : this.browse(false); },
    get results() {
      const c = this.$store.city.cur, ids = new Set(c ? c.nowShowingFilmIds : []), qn = norm(this.q), O = Object.keys(SECTIONS), s = this.bsec;
      return this.films.filter(f => (f.status !== 'cartelera' || f.alt || ids.has(f.id)) &&
          (s === 'todas' || (s === 'alternativo' ? f.alt : f.status === s)) && (!qn || norm(f.title + ' ' + (f.titleEs || '')).includes(qn)))
        .sort((a, b) => O.indexOf(a.status) - O.indexOf(b.status) || a.priority - b.priority);
    },
    top() { this.$refs.feed.scrollTo({ top: 0, behavior: RM ? 'auto' : 'smooth' }); }
  };
}

/* ---------- Movie detail ---------- */
function detail() {
  return {
    ...showDays, film: null, missing: false, trailer: false, more: false,
    async init() {
      const id = getQueryParam('id');
      this.film = ((await loadJSON('data/films.json')).films || []).find(f => f.id === id && listed(f)) || null;
      if (!this.film) { this.missing = true; return; }
      const f = this.film, set = (sel, v) => { const m = document.querySelector(sel); if (m) m.content = v; };
      document.title = f.title + ' · Cine Colombia';
      set('meta[name=description]', f.shortSynopsis || '');
      set('meta[property="og:title"]', f.title + ' · Cine Colombia');
      set('meta[property="og:description"]', f.shortSynopsis || '');
      set('meta[property="og:image"]', f.backdrop || new URL(f.poster, location.href).href);
      this.$watch('$store.city.slug', c => this.first(c));
      this.$watch('sel', i => this.day(i));
      this.first(this.$store.city.slug);
    },
    has(i) { return !!(this.week[i] || {})[this.film.id]; },
    get groups() {
      const day = (this.week[this.sel] || {})[this.film.id] || {}, c = this.$store.city.cur;
      return c ? this.$store.geo.sort(c.sites.filter(s => day[s.id])).map(s => ({ s, times: day[s.id] })) : [];
    },
    back() { history.length > 1 && document.referrer ? history.back() : (location.href = 'index.html'); }
  };
}
