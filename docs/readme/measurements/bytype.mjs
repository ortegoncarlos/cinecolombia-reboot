import fs from 'node:fs';
import { launch, IPHONE, sleep } from './common.mjs';
const b = await launch(); const out = {};
for (const [k, url] of Object.entries({ original_home: 'https://www.cinecolombia.com/', reboot_home: 'https://ortegoncarlos.github.io/cinecolombia-reboot/' })) {
  const ctx = await b.newContext(IPHONE); const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const type = {}, agg = {};
  cdp.on('Network.requestWillBeSent', e => { type[e.requestId] = e.type; });
  cdp.on('Network.loadingFinished', e => { const t = type[e.requestId] || 'Other'; agg[t] = agg[t] || { requests: 0, bytes: 0 }; agg[t].requests++; agg[t].bytes += e.encodedDataLength; });
  await p.goto(url, { waitUntil: 'load', timeout: 60000 }); await sleep(5000);
  const cssLinks = await p.$$eval('link[rel=stylesheet]', s => s.length);
  out[k] = { url, byType: agg, stylesheets: cssLinks };
  await ctx.close();
}
await b.close();
console.log(JSON.stringify(out, null, 1)); fs.writeFileSync(process.argv[2] || 'bytype.json', JSON.stringify({ date: new Date().toISOString(), note: 'one cold load per URL, same settings as browser-load-times.json, bytes on the wire grouped by CDP resource type, counted until 5 s after load', ...out }, null, 2));
