// Generates static share pages (s/{id}/index.html) with Open Graph tags for crawlers that don't run JS (WhatsApp, Facebook).
// Run at deploy time by .github/workflows/pages.yml. SITE_URL env overrides the base URL.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const SITE = (process.env.SITE_URL || "https://ortegoncarlos.github.io/cinecolombia-reboot").replace(/\/$/, "");
const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const { films } = JSON.parse(readFileSync("data/films.json", "utf8"));
let n = 0;
for (const f of films) {
  if (f.hidden) continue;
  const img = f.backdrop || (f.poster?.startsWith("http") ? f.poster : `${SITE}/${f.poster}`);
  const [w, h] = f.backdrop ? [1280, 720] : [780, 1170];
  const title = f.title + (f.titleEs && f.titleEs !== f.title ? ` · ${f.titleEs}` : "");
  const desc = f.shortSynopsis || f.synopsis || "Horarios y boletas en Cine Colombia.";
  const url = `${SITE}/s/${f.id}/`, target = `../../pelicula.html?id=${f.id}`;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Cine Colombia</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${url}">
<meta property="og:site_name" content="Cine Colombia"><meta property="og:type" content="video.movie"><meta property="og:locale" content="es_CO">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${url}">
<meta property="og:image" content="${esc(img)}"><meta property="og:image:width" content="${w}"><meta property="og:image:height" content="${h}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(img)}">
<meta http-equiv="refresh" content="0;url=${target}"><script>location.replace("${target}")</script>
<style>body{margin:0;background:#000;color:#fff;font:16px Roboto,Arial,sans-serif;display:grid;place-items:center;height:100vh}a{color:#0070bd}</style></head>
<body><a href="${target}">Ver ${esc(f.title)}</a></body></html>\n`;
  mkdirSync(`s/${f.id}`, { recursive: true }); writeFileSync(`s/${f.id}/index.html`, html); n++;
}
console.log(`share pages: ${n}`);
