// Cold loads in real Chrome, iPhone emulation, cache disabled, no throttling. Usage: node measure.mjs out.json
import fs from 'node:fs';
import { launch, IPHONE, UA, sleep } from './common.mjs';
const URLS = {
  original_home: 'https://www.cinecolombia.com/',
  reboot_home: 'https://ortegoncarlos.github.io/cinecolombia-reboot/',
  original_movie: 'https://www.cinecolombia.com/peliculas/avengers-doomsday',
  reboot_movie: 'https://ortegoncarlos.github.io/cinecolombia-reboot/pelicula.html?id=HO00000878',
};
const RUNS = 5, SETTLE = 5000;
const OBS = () => {
  const m = window.__m = { lcp: null, cls: 0, fcp: null, longTasks: [] };
  new PerformanceObserver(l => { for (const e of l.getEntries()) m.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) m.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') m.fcp = e.startTime; }).observe({ type: 'paint', buffered: true });
  new PerformanceObserver(l => { for (const e of l.getEntries()) m.longTasks.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
};
const browser = await launch();
const out = { date: new Date().toISOString(), tool: 'Google Chrome (channel chrome, headless) driven by playwright-core 1.57.0 + CDP',
  settings: { viewport: '390x844', deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA, cache: 'disabled (CDP Network.setCacheDisabled), fresh browser context per run',
    throttling: 'none (home connection, Bogota, unthrottled network and CPU)', runs: RUNS,
    window: `requests and bytes counted from navigation until ${SETTLE / 1000} s after the load event (or 60 s cap if load never fires)`,
    bytes: 'sum of CDP Network.loadingFinished encodedDataLength (bytes on the wire, all origins)',
    tbt: 'sum of (longtask duration - 50 ms) for long tasks after FCP, observed in page (not Lighthouse TBT)' },
  urls: URLS, runs: {}, median: {} };
const med = a => { const v = a.filter(x => x != null).sort((x, y) => x - y); return v.length ? v[Math.floor(v.length / 2)] : null; };
for (const [key, url] of Object.entries(URLS)) {
  out.runs[key] = [];
  for (let i = 0; i < RUNS; i++) {
    const ctx = await browser.newContext(IPHONE); await ctx.addInitScript(OBS);
    const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
    await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    let reqs = 0, bytes = 0; const hosts = {};
    cdp.on('Network.requestWillBeSent', e => { if (!e.redirectResponse) reqs++; try { const h = new URL(e.request.url).host; hosts[h] = (hosts[h] || 0) + 1; } catch {} });
    cdp.on('Network.loadingFinished', e => { bytes += e.encodedDataLength; });
    let loadOk = true;
    try { await p.goto(url, { waitUntil: 'load', timeout: 60000 }); } catch (e) { loadOk = false; }
    await sleep(SETTLE);
    const r = await p.evaluate(() => { const n = performance.getEntriesByType('navigation')[0] || {}; const m = window.__m;
      const tbt = m.longTasks.filter(([s]) => m.fcp != null && s >= m.fcp).reduce((a, [, d]) => a + Math.max(0, d - 50), 0);
      return { finalUrl: location.href, ttfb: n.responseStart, domContentLoaded: n.domContentLoadedEventEnd, load: n.loadEventEnd || null, fcp: m.fcp, lcp: m.lcp, cls: +m.cls.toFixed(4), tbtApprox: Math.round(tbt), longTasks: m.longTasks.length }; });
    Object.assign(r, { loadEventFired: loadOk, requests: reqs, transferredBytes: bytes, hosts: Object.keys(hosts).length });
    out.runs[key].push(r); console.log(key, i, JSON.stringify(r));
    await ctx.close();
  }
  const fields = ['ttfb', 'domContentLoaded', 'load', 'fcp', 'lcp', 'cls', 'tbtApprox', 'requests', 'transferredBytes', 'hosts'];
  out.median[key] = Object.fromEntries(fields.map(f => [f, med(out.runs[key].map(r => r[f]))]));
  out.median[key].finalUrl = out.runs[key][0].finalUrl;
}
await browser.close();
fs.writeFileSync(process.argv[2] || 'browser.json', JSON.stringify(out, null, 2));
