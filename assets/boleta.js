'use strict';
/* Boletas: hairline room (seats) → ticket types → confitería (data/food.json) → mock payment. Room shapes are real (data/seats/layouts);
   occupancy, the other buyers and prices are a seeded simulation for the demo. Needs app.js. */

const MAX = 8, HOLD = 420; // seats per order, hold time in s
const CW = 24, RH = 28, TOP = 72; // SVG units: column, row pitch, screen band
const FMTS = ['Onyx', 'Imax', 'Megasala', 'Dinamix', '3D'];
const BASE = { '2D': 12000, '3D': 18000, Dinamix: 18000, Megasala: 24000, Imax: 24000, Onyx: 32000 };
const METHODS = ['Tarjeta', 'PSE', 'Nequi', 'Tarjeta Cineco'];
const cop = n => '$ ' + n.toLocaleString('es-CO');
const and = a => new Intl.ListFormat('es', { type: 'conjunction' }).format(a);
const hash = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
function rng(a) { // mulberry32
  return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const rr = (x, y, w, h, r) => `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 -${r} ${r}h-${w - 2 * r}a${r} ${r} 0 0 1 -${r} -${r}v-${h - 2 * r}a${r} ${r} 0 0 1 ${r} -${r}z`;

// Seat glyph: back + cushion; sofa pieces reach the cell edge so a group reads as one bench.
function glyph(t, cx, cy) {
  const l = t === 'M' || t === 'R' ? 12 : 8, r = t === 'M' || t === 'L' ? 12 : 8, x = cx - l, w = l + r;
  if (t === 'W') return rr(cx - 8, cy - 9, 16, 16, 3) + `M${cx - 1} ${cy - 6}v5h4l2 3M${cx + 1} ${cy + 3}a3.2 3.2 0 1 1 -4.6 -4`;
  const p = rr(x, cy - 10, w, 5, 2) + rr(x, cy - 3, w, 10, 2.5);
  return t === 'C' ? p + `M${cx - 3} ${cy + 5}a3 3 0 0 1 6 0M${cx + 1.4} ${cy}a1.4 1.4 0 1 1 -2.8 0a1.4 1.4 0 1 1 2.8 0` : p;
}

// Layout → rows nearest the screen first. Vista draws the screen at the bottom (sofa ends prove it), so turn it 180°.
function plan(L) {
  const W = Math.max(...L.areas.map(a => a.cols)), key = a => a.rows.map(r => r.label).filter(Boolean).sort((p, q) => p.length - q.length || p.localeCompare(q))[0] || '~';
  const rows = []; let y = 0;
  [...L.areas].sort((a, b) => key(a).length - key(b).length || key(a).localeCompare(key(b))).forEach((a, k) => {
    if (k) y += 0.5;
    const off = Math.floor((W - a.cols) / 2);
    [...a.rows].reverse().forEach(r => {
      if (r.seats.length) rows.push({ label: r.label || '', y, seats: r.seats.map(([id, col, label, type, g]) => ({ id, x: off + a.cols - col, label, type, grp: g ? a.n + '-' + g : '', row: r.label || '', cat: a.cat, area: a.name || '' })) });
      y++;
    });
  });
  return { rows, cols: W, h: y };
}
const GENERIC = { areas: [{ n: 1, cols: 16, rows: [...'LKJIHGFEDCBA'].map((l, r) => ({ label: l, seats: Array.from({ length: 16 }, (_, c) => ['g' + r + '_' + c, c + 1, String(c + 1), 'S', 0]) })) }] };

// Seeded occupancy, ~30-45 %: centre-back fuller, front row emptier, couples in pairs, sofa pairs together.
function simulate(P, id) {
  const R = rng(hash(id)), target = 0.3 + R() * 0.15, all = P.rows.flatMap(r => r.seats.map(s => ({ s, r })));
  const n = P.rows.length, w = all.map(({ s, r }) => {
    const t = n > 1 ? P.rows.indexOf(r) / (n - 1) : 0.5, cx = Math.abs(s.x / Math.max(P.cols - 1, 1) - 0.5) * 2;
    return (0.35 + Math.exp(-(((t - 0.6) / 0.32) ** 2))) * (t === 0 ? 0.3 : 1) * (1.2 - 0.7 * cx);
  });
  const k = target * all.length / w.reduce((a, b) => a + b, 0) / 1.6, sold = new Set();
  all.forEach(({ s, r }, i) => {
    if (sold.has(s.id) || R() > w[i] * k) return;
    sold.add(s.id);
    const nx = r.seats.find(o => o.x === s.x + 1);
    if (nx && R() < 0.6) sold.add(nx.id);
  });
  return sold;
}

function boleta() {
  // Non-reactive: seat objects with their SVG path, button and label; timers.
  const S = new Map(); let svg, lit, cur, pz, Z = { s: 1, x: 0, y: 0 }, moved = false, last = {}, undo = null, fomoT, tickT, viewT, payT;
  return {
    step: 'seats', loading: true, err: '', film: null, site: null, t: null, date: '', fmt: '2D', sala: '', estimated: false,
    prices: [], sel: [], total0: 0, free: 0, viewers: 0, left: 0, zoom: false, hasW: false, method: 'Tarjeta', busy: false, paid: false, qr: '',
    menu: [], food: {}, // food: id → { qty, opts: { label: choice } }

    async init() {
      const id = getQueryParam('show') || '';
      addEventListener('popstate', e => {
        if (this.paid) return void (location.href = 'pelicula.html?id=' + this.film.id);
        this.step = (e.state && e.state.step) || 'seats'; this.focusTop();
      });
      const cities = await loadJSON('data/cities.json'), list = Array.isArray(cities) ? cities : [];
      let site = id.split('-')[0], city = list.find(c => c.sites.some(s => s.id === site));
      if (site === 'pv') { // simulated preventa release week (pv-{film}-{n}): stored city first, then the rest
        const f = id.split('-')[1], cs = [...list].sort((a, b) => (b.slug === this.$store.city.slug) - (a.slug === this.$store.city.slug));
        for (const c of cs) {
          const days = await loadPv(f, c.slug);
          if (Object.entries(days).some(([d, ss]) => Object.entries(ss).some(([k, l]) => { const t = l.find(x => x.id === id); return t && (this.t = t, this.date = d, this.filmId = f, site = k); }))) { city = c; break; }
        }
      }
      if (city) {
        // day by day until the show turns up (usually today or tomorrow: 1-2 files instead of 7)
        for (let i = 0; i < 7 && !this.t; i++) {
          const d = await loadDay(city.slug, i);
          Object.keys(d).some(f => {
            const t = (d[f][site] || []).find(x => x.id === id);
            return t && (this.t = t, this.date = WEEK[i], this.filmId = f);
          });
        }
        this.site = city.sites.find(s => s.id === site);
        if (!this.$store.city.slug) this.$store.city.pick(city.slug); // no IP guess (and its toast) on a deep link
      }
      const films = (await loadJSON('data/films.json')).films || [];
      this.film = this.t && films.find(f => f.id === this.filmId && listed(f)) || null;
      this.loading = false;
      if (!this.film) return void (this.err = 'nf');
      const t = this.t;
      document.title = 'Boletas · ' + this.film.title + ' · Cine Colombia';
      this.fmt = FMTS.find(f => t.attrs.includes(f)) || '2D';
      const [show, PR, menu] = await Promise.all([t.seats ? loadJSON('data/seats/shows/' + id + '.json') : {}, loadJSON('data/seats/prices.json'), loadJSON('data/food.json')]);
      this.menu = Array.isArray(menu) ? menu : []; // only flagged shows have a captured file (no 404s)
      const lay = t.layout || show.layout, L = lay ? await loadJSON('data/seats/layouts/' + lay + '.json') : {};
      const sc = String(t.screen || show.screen || (lay || '').split('-')[1] || '');
      this.sala = sc && (/^\d+$/.test(sc) ? 'Sala ' + sc : sc);
      // prices.json: site → format ("2D Dinamix": attrs minus language) → time bands; last band with from ≤ start.
      const key = t.attrs.filter(a => !/^(DOB|SUB|ESP)$/.test(a)).join(' '), D = PR._default;
      const bands = (PR[site] || {})[key] || (Array.isArray(D) ? D : D && (D[key] || D['2D'])) || [];
      const band = bands.filter(x => x.from <= t.time).pop() || bands[0];
      this.prices = band && band.prices && band.prices.length ? band.prices : [{ name: 'Silla General', price: BASE[this.fmt] }];
      this.estimated = !(L.areas && L.areas.length);
      const P = plan(this.estimated ? GENERIC : L);
      const sold = !this.estimated && Array.isArray(show.sold) ? new Set(show.sold) : simulate(P, id);
      if (t.soldOut) P.rows.forEach(r => r.seats.forEach(s => sold.add(s.id)));
      history.replaceState({ step: 'seats' }, '');
      this.$nextTick(() => this.draw(P, sold));
      const R = rng(hash(id + 'v'));
      this.viewers = 6 + Math.floor(R() * 19);
      if (t.soldOut) return void (this.err = 'sold');
      this.sim(true);
      this.$watch('step', st => this.sim(st === 'seats' && !this.paid));
      addEventListener('pagehide', () => this.destroy());
    },

    // Built once per layout; later changes only patch classes/attributes of one seat.
    draw(P, sold) {
      const VW = (P.cols + 2) * CW, VH = TOP + P.h * RH + 12, el = this.$refs.room;
      let seats = '', tiers = '', labels = '', hits = '';
      const pct = (v, of) => (v / of * 100).toFixed(3) + '%';
      P.rows.forEach(r => {
        const cy = TOP + (r.y + 0.5) * RH, xs = r.seats.map(s => s.x), x0 = (Math.min(...xs) + 1) * CW - 4, x1 = (Math.max(...xs) + 2) * CW + 4;
        tiers += `M${x0} ${cy + 11}H${x1}l3 -3`;
        labels += `<text x="${CW / 2}" y="${cy + 3}">${r.label}</text><text x="${VW - CW / 2}" y="${cy + 3}">${r.label}</text>`;
        r.seats.forEach(s => {
          const cx = (s.x + 1.5) * CW;
          Object.assign(s, { cx, cy, sold: sold.has(s.id), cls: this.cls(s) });
          seats += `<path class="s${s.sold ? ' sold' : ''}" data-id="${s.id}" d="${glyph(s.type, cx, cy)}"/>`;
          hits += `<button type="button" data-id="${s.id}" tabindex="-1" style="left:${pct((s.x + 1) * CW, VW)};top:${pct(TOP + r.y * RH, VH)}"` +
            ` aria-label="Fila ${s.row} silla ${s.label}${s.type === 'W' ? ', silla de ruedas' : s.type === 'C' ? ', acompañante' : ''}"${s.sold ? ' aria-disabled="true"' : ' aria-pressed="false"'}></button>`;
          S.set(s.id, s);
        });
      });
      // grouping: only pairs are sold together (love seats); a 4-seat Dinamix bench is bought seat by seat.
      const G = {}; S.forEach(s => s.grp && (G[s.grp] = G[s.grp] || []).push(s));
      S.forEach(s => { s.mates = s.grp && G[s.grp].length === 2 ? G[s.grp] : [s]; });
      const sx = CW * 1.5, ex = VW - CW * 1.5, fy = TOP + P.h * RH;
      el.style.setProperty('--ar', VW + '/' + VH);
      el.style.setProperty('--cols', P.cols); el.style.setProperty('--bw', pct(CW, VW)); el.style.setProperty('--bh', pct(RH, VH));
      el.innerHTML = `<svg class="room" viewBox="0 0 ${VW} ${VH}" aria-hidden="true">
<defs><radialGradient id="lit" gradientUnits="userSpaceOnUse" cx="-999" cy="-999" r="72"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#c9cdd6" stop-opacity=".62"/></radialGradient>
<linearGradient id="cone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".09"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
<path class="cone" d="M${sx} 22Q${VW / 2} 8 ${ex} 22L${VW - 4} ${fy}H4z" fill="url(#cone)"/>
<path class="floor" d="M4 ${TOP - 14}H${VW - 4}V${fy}H4zM4 ${fy}l6 6H${VW + 2}l-6 -6M${VW - 4} ${TOP - 14}l6 6V${fy + 6}"/>
<path class="screen" d="M${sx} 22Q${VW / 2} 8 ${ex} 22"/><text class="scr" x="${VW / 2}" y="38">PANTALLA</text>
<path class="tier" d="${tiers}"/><g class="rl">${labels}</g><g class="seats">${seats}</g><g class="tags"></g></svg><div class="hits" role="group" aria-label="Sillas">${hits}</div>`;
      svg = el.firstChild; lit = svg.querySelector('#lit');
      el.querySelectorAll('.hits button').forEach(b => { const s = S.get(b.dataset.id); s.btn = b; s.el = svg.querySelector(`[data-id="${s.id}"]`); });
      this.rove([...S.values()].find(s => !s.sold) || S.values().next().value);
      this.free = [...S.values()].filter(s => !s.sold).length; this.total0 = S.size; this.hasW = [...S.values()].some(s => s.type === 'W');
      if (!this.free && !this.err) this.err = 'sold';
      this.panzoom();
    },

    // Pan/zoom (transforms only): pinch, drag/wheel pan when zoomed, ctrl-wheel at cursor, double tap 1×↔2×. 1-3×, no inertia.
    zoomTo(ns, cx, cy, anim) {
      const st = this.$refs.stage, w = st.clientWidth, h = st.clientHeight;
      if (cx == null) { cx = w / 2; cy = h / 2; }
      ns = Math.min(3, Math.max(1, ns));
      this.place(cx - (cx - Z.x) * ns / Z.s, cy - (cy - Z.y) * ns / Z.s, ns, anim);
    },
    place(x, y, s, anim) {
      const st = this.$refs.stage, w = st.clientWidth, h = st.clientHeight;
      Z = { s, x: Math.min(0, Math.max(w - w * s, x)), y: Math.min(0, Math.max(h - h * s, y)) };
      pz.classList.toggle('anim', !!anim && !RM);
      pz.style.transform = `translate(${Z.x}px,${Z.y}px) scale(${Z.s})`;
      this.zoom = Z.s > 1.01;
    },
    panzoom() {
      const st = this.$refs.stage, pts = new Map(), at = e => { const r = st.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      let g = null;
      pz = st.firstElementChild;
      const start = () => {
        const [a, b] = [...pts.values()];
        g = b ? { d: Math.hypot(a[0] - b[0], a[1] - b[1]), m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], ...Z } : { p: a, ...Z };
      };
      st.addEventListener('pointerdown', e => {
        pts.set(e.pointerId, at(e)); if (pts.size === 1) moved = false; pz.classList.add('live'); if (pts.size > 2) return; start();
      });
      st.addEventListener('pointermove', e => {
        if (!pts.has(e.pointerId)) return;
        pts.set(e.pointerId, at(e));
        const [a, b] = [...pts.values()];
        if (b && g.d) { // pinch: the content point under the first midpoint follows the current midpoint
          const ns = Math.min(3, Math.max(1, g.s * Math.hypot(a[0] - b[0], a[1] - b[1]) / g.d)), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          moved = true; this.place(m[0] - (g.m[0] - g.x) * ns / g.s, m[1] - (g.m[1] - g.y) * ns / g.s, ns);
        } else if (g.p) {
          const dx = a[0] - g.p[0], dy = a[1] - g.p[1];
          if (Math.hypot(dx, dy) > 8) moved = true;
          if (moved && Z.s > 1) this.place(g.x + dx, g.y + dy, Z.s);
        }
      });
      const up = e => {
        if (!pts.delete(e.pointerId)) return;
        if (pts.size) return start();
        pz.classList.remove('live');
        if (e.type !== 'pointerup' || moved) return;
        const p = at(e), now = Date.now();
        if (now - (last.t || 0) < 320 && Math.hypot(p[0] - last.p[0], p[1] - last.p[1]) < 30) { // double tap
          moved = true; last = {};
          if (undo && now - undo.t < 400) this.toggle(undo.s);
          undo = null;
          return this.zoomTo(this.zoom ? 1 : 2, p[0], p[1], true);
        }
        last = { t: now, p };
      };
      ['pointerup', 'pointercancel'].forEach(t => st.addEventListener(t, up));
      st.addEventListener('wheel', e => {
        const [cx, cy] = at(e);
        if (e.ctrlKey) { e.preventDefault(); this.zoomTo(Z.s * Math.exp(-e.deltaY * 0.01), cx, cy); }
        else if (Z.s > 1) { e.preventDefault(); this.place(Z.x - e.deltaX, Z.y - e.deltaY, Z.s); }
      }, { passive: false });
      addEventListener('resize', () => this.place(Z.x, Z.y, Z.s));
    },
    reveal(b) { // keep the keyboard-focused seat inside the viewport when zoomed
      const r = b.getBoundingClientRect(), v = this.$refs.stage.getBoundingClientRect();
      const dx = r.left < v.left ? v.left - r.left + 8 : r.right > v.right ? v.right - r.right - 8 : 0, dy = r.top < v.top ? v.top - r.top + 8 : r.bottom > v.bottom ? v.bottom - r.bottom - 8 : 0;
      if (dx || dy) this.place(Z.x + dx, Z.y + dy, Z.s);
    },
    rove(s) { if (!s) return; if (cur) cur.btn.tabIndex = -1; cur = s; s.btn.tabIndex = 0; },
    tap(e) {
      const b = e.target.closest('button[data-id]');
      if (!b || moved && e.detail) return; // a drag or pinch is not a tap (keyboard clicks have detail 0)
      const s = S.get(b.dataset.id), was = this.sel.length; this.toggle(s);
      undo = this.sel.length !== was ? { s, t: Date.now() } : null;
    },
    // Arrow keys walk the room.
    keys(e) {
      const s = cur, d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!s || !d) return;
      e.preventDefault();
      const all = [...S.values()], c = d[0] ? all.filter(o => o.cy === s.cy && Math.sign(o.cx - s.cx) === d[0]).sort((a, b) => Math.abs(a.cx - s.cx) - Math.abs(b.cx - s.cx))[0]
        : all.filter(o => Math.sign(o.cy - s.cy) === d[1]).sort((a, b) => Math.abs(a.cy - s.cy) - Math.abs(b.cy - s.cy) || Math.abs(a.cx - s.cx) - Math.abs(b.cx - s.cx))[0];
      if (c) { this.rove(c); c.btn.focus({ preventScroll: true }); this.reveal(c.btn); this.light(c); }
    },
    // Seats near the pointer brighten; the room tilts a few degrees.
    hover(e) {
      const b = e.target.closest && e.target.closest('button[data-id]');
      if (b) this.light(S.get(b.dataset.id));
      if (RM || e.pointerType === 'touch') return;
      const r = this.$refs.stage.getBoundingClientRect();
      this.$refs.room.style.setProperty('--ry', ((e.clientX - r.left) / r.width - 0.5) * 3 + 'deg');
      this.$refs.room.style.setProperty('--rx', ((e.clientY - r.top) / r.height - 0.5) * -2 + 'deg');
    },
    light(s) { if (lit) { lit.setAttribute('cx', s ? s.cx : -999); lit.setAttribute('cy', s ? s.cy : -999); } },
    unhover() { this.light(null); this.$refs.room.style.removeProperty('--ry'); this.$refs.room.style.removeProperty('--rx'); },

    paint(s) {
      const on = this.sel.includes(s.id);
      s.el.classList.toggle('sel', on); s.el.classList.toggle('sold', s.sold);
      if (s.sold) { s.btn.setAttribute('aria-disabled', 'true'); s.btn.removeAttribute('aria-pressed'); } else s.btn.setAttribute('aria-pressed', on);
      if (on && !s.tag) {
        s.tag = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        s.tag.setAttribute('x', s.cx); s.tag.setAttribute('y', s.cy + 5.5); s.tag.textContent = s.label;
        svg.querySelector('.tags').append(s.tag);
      } else if (!on && s.tag) { s.tag.remove(); s.tag = null; }
    },
    toggle(s) {
      if (!s || s.sold || this.step !== 'seats') return;
      this.rove(s);
      const m = s.mates, on = this.sel.includes(s.id);
      if (on) this.sel = this.sel.filter(id => !m.some(o => o.id === id));
      else if (this.sel.length + m.length > MAX) return toast('Puedes elegir hasta ' + MAX + ' sillas por compra');
      else this.sel = [...this.sel, ...m.map(o => o.id)];
      m.forEach(o => this.paint(o));
      if (m.length > 1 && !on) toast('Silla doble: ' + and(m.map(o => 'Fila ' + o.row + ' ' + o.label)));
      if (this.sel.length && !tickT) this.hold();
      if (!this.sel.length) this.stopHold();
    },

    // Other buyers (simulated): first 1.5 s after the room renders, then every 5-10 s, one to three neighbouring free seats are taken. Never the user's.
    sim(on) {
      clearTimeout(fomoT); clearInterval(viewT); fomoT = viewT = null;
      if (!on) { const t = document.getElementById('toast'); if (t && /tomar la fila/.test(t.textContent)) t.classList.remove('on'); return; }
      viewT = setInterval(() => { this.viewers = Math.min(40, Math.max(3, this.viewers + (Math.random() < 0.5 ? -1 : 1))); }, 7000);
      this.fomo(true);
    },
    fomo(first) {
      fomoT = setTimeout(() => {
        if (!document.hidden) this.take();
        this.fomo();
      }, first ? 1500 : 5000 + Math.random() * 5000);
    },
    take() {
      const free = [...S.values()].filter(s => !s.sold && !this.sel.includes(s.id));
      if (free.length < 4 || this.left && this.left <= 66) return; // quiet during the last-minute warning
      const a = free[Math.floor(Math.random() * free.length)], n = 1 + Math.floor(Math.random() * 3), got = [];
      free.filter(o => o.cy === a.cy && o.cx >= a.cx).sort((p, q) => p.cx - q.cx).some(o => {
        if (got.length && o.cx - got[got.length - 1].cx > CW + 1) return true;
        if (o.mates.some(m => this.sel.includes(m.id))) return true;
        got.push(...o.mates.filter(m => !got.includes(m)));
        return got.length >= n;
      });
      if (!got.length) return;
      got.forEach(o => { o.sold = true; this.paint(o); if (!RM) { o.el.classList.add('taking'); setTimeout(() => o.el.classList.remove('taking'), 800); } });
      this.free -= got.length;
      toast('Alguien acaba de tomar la fila ' + a.row + ' ' + and(got.map(o => o.label).sort((p, q) => parseInt(p) - parseInt(q))), null, 3200);
    },
    get scarce() { return this.free > 0 && this.free < this.total0 * 0.15; },

    hold() {
      this.left = HOLD;
      tickT = setInterval(() => { if (--this.left <= 0) this.expire(); else if (this.left === 60) toast('Queda 1 minuto para terminar tu compra; luego liberamos tus sillas.', null, 6000); }, 1000);
    },
    stopHold() { clearInterval(tickT); tickT = null; this.left = 0; },
    expire() {
      this.stopHold();
      const was = this.sel.map(id => S.get(id)); this.sel = []; was.forEach(s => this.paint(s));
      if (this.step !== 'seats') { this.step = 'seats'; history.replaceState({ step: 'seats' }, ''); }
      toast('Se acabó el tiempo y liberamos tus sillas. Puedes elegirlas de nuevo.', null, 5000);
    },
    get mmss() { return Math.floor(this.left / 60) + ':' + String(this.left % 60).padStart(2, '0'); },

    get chosen() { return this.sel.map(id => S.get(id)).filter(Boolean).sort((a, b) => a.cy - b.cy || parseInt(a.label) - parseInt(b.label)); },
    get seatText() {
      const by = {}; this.chosen.forEach(s => (by[s.row] = by[s.row] || []).push(s.label));
      return Object.keys(by).map(r => 'Fila ' + r + ' ' + by[r].join(', ')).join(' · ');
    },
    // Seat class price: area cat, else Preferencial/General by name, else first.
    cls(s) {
      const P = this.prices, pre = /prefer/i.test(s.area);
      return P.find(p => p.cat && p.cat === s.cat) || P.find(p => /prefer/i.test(p.name) === pre) || P[0];
    },
    get lines() {
      const by = {};
      this.chosen.forEach(s => { const l = by[s.cls.name] = by[s.cls.name] || { name: s.cls.name, price: s.cls.price, seats: [] }; l.seats.push(s); });
      return Object.values(by);
    },
    get total() { return this.chosen.reduce((a, s) => a + s.cls.price, 0) + this.foodTotal; },
    // Confitería: options default to their first choice, so a line is always complete.
    get groups() { return [...new Set(this.menu.map(i => i.group))].map(name => ({ name, items: this.menu.filter(i => i.group === name) })); },
    qty(i) { return (this.food[i.id] || {}).qty || 0; },
    add(i, d) {
      const c = this.food[i.id] || { qty: 0, opts: Object.fromEntries((i.options || []).map(o => [o.label, o.choices[0]])) }, n = Math.min(10, c.qty + d);
      if (n <= 0) { const { [i.id]: _, ...rest } = this.food; this.food = rest; } else this.food = { ...this.food, [i.id]: { ...c, qty: n } };
    },
    get foodLines() { return this.menu.filter(i => this.qty(i)).map(i => ({ ...i, qty: this.qty(i), opts: (i.options || []).map(o => this.food[i.id].opts[o.label]).join(' · ') })); },
    get foodCount() { return this.foodLines.reduce((a, l) => a + l.qty, 0); },
    get foodTotal() { return this.foodLines.reduce((a, l) => a + l.qty * l.price, 0); },
    get sbarText() {
      const n = this.sel.length, m = this.foodCount;
      if (!n) return 'Elige una silla libre para empezar';
      return m ? n + (n === 1 ? ' boleta · ' : ' boletas · ') + m + (m === 1 ? ' producto' : ' productos') : n + (n === 1 ? ' silla' : ' sillas') + ' · ' + this.seatText;
    },
    get when() { if (!this.date) return ''; const d = fmtDate(this.date); return d.label + ' ' + d.day; },
    get line() { return [this.site && this.site.name, this.sala, this.when, this.t && this.t.time, this.t && this.t.attrs.filter(x => x.toLowerCase() !== String(this.sala).toLowerCase()).join(' · ')].filter(Boolean).join(' · '); },

    go(step) {
      if (step === 'tickets' && !this.sel.length) return;
      this.step = step; history.pushState({ step }, ''); this.focusTop();
    },
    focusTop() { this.$nextTick(() => { scrollTo(0, 0); const h = document.querySelector('.bol-step:not([hidden]) h1'); if (h) h.focus({ preventScroll: true }); }); },
    back() {
      if (this.step !== 'seats' && !this.paid) return history.back();
      if (document.referrer && history.length > 1 && !this.paid) return history.back();
      location.href = this.film ? 'pelicula.html?id=' + this.film.id : 'index.html';
    },
    pay() {
      this.busy = true;
      payT = setTimeout(() => {
        this.busy = false; this.paid = true; this.stopHold(); this.sim(false);
        this.qr = this.code(); this.step = 'done'; history.pushState({ step: 'done' }, ''); this.focusTop();
      }, 1100);
    },
    // QR-looking pattern seeded by showtime + seats. Not a real QR.
    code() {
      const R = rng(hash(this.t.id + this.sel.join())), N = 25, f = (x, y) => [[0, 0], [N - 7, 0], [0, N - 7]].find(([a, b]) => x >= a && x < a + 7 && y >= b && y < b + 7);
      let d = '';
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const F = f(x, y);
        const on = F ? (() => { const u = x - F[0], v = y - F[1]; return u === 0 || v === 0 || u === 6 || v === 6 || (u > 1 && u < 5 && v > 1 && v < 5); })() : R() < 0.47;
        if (on) d += `M${x} ${y}h1v1h-1z`;
      }
      return d;
    },
    destroy() { this.sim(false); clearTimeout(payT); clearInterval(tickT); }
  };
}
