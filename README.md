# Cine Colombia reboot

Mobile-first static redesign of cinecolombia.com: a Shorts-style vertical feed (Cartelera · Preventa · Pronto) with muted trailer autoplay, a movie detail page with showtimes by multiplex, and a multiplex page. Plain HTML, hand-written CSS and Alpine.js 3.14 from cdnjs. No build step, no dependencies.

- `index.html` feed
- `pelicula.html?id=HO00000666` movie detail
- `multiplex.html` (list) / `multiplex.html?id=6871` (one multiplex)
- `assets/app.css`, `assets/app.js` shared styles, helpers and Alpine components

## Run

```sh
npx serve .
```

Any static server works (`python3 -m http.server`). Opening the files with `file://` will not work because the pages `fetch()` the JSON in `data/`.

## Datos

The film, cinema and showtime data is a one-time snapshot of Cine Colombia's public web API (`digital-api.cinecolombia.com/ocapi/v1`), taken on 11 October 2026 with the guest token embedded in the cinecolombia.com home page. We downloaded the full film catalogue, film availability, the list of 50 sites, and seven days of showtimes for every city. The city and cinema names come from the home page's own `cinemaGroups` list. A small throwaway Node script turned these raw responses into the static JSON files in `data/`: one films file, one cities file, and one showtimes file per city per day, with time, format and a direct ticket link for each showing. Poster, backdrop and trailer data come from TMDB (this product uses the TMDB API but is not endorsed or certified by TMDB). The few films without a TMDB match use the distributor poster from the Moviexchange CDN, stored in `media/`. The data does not update itself: showtimes are only accurate for the week of 11–17 October 2026, and no build step or API key is needed to serve the site.

The demo clock is frozen at 11 October 2026 22:00 (Bogotá) to match the snapshot; set `DEMO_NOW` in `assets/app.js` to `null` for live time.

Preventa films that open after 17 October have no real showtimes yet, so their release week (release date + 6 days) is simulated from this week's schedule: one file per film and city under `data/showtimes/preventa/`, cloned from each city's busiest cartelera film (same multiplex, times and rooms, so seat maps work), with show ids `pv-{filmId}-{n}`. Opera, theatre and concerts get only a few special screenings.

The Confitería step of the ticket flow reads `data/food.json`: the menu (names, descriptions, prices) and product photos (`media/food/`, resized) come from Cine Colombia's public food page, Confitería tab, with prices as of 12 Oct 2026.

## Promos

Promo cards in the Cartelera feed (currently one TikTok video) come from `data/promos.json`: `after: n` places the card after the n-th film. Edit that file to add, move or remove promos.

## Privacidad

On the first visit the browser asks get.geojs.io for an approximate location based on the IP address, only to pick the nearest city and sort multiplexes by distance; nothing else is sent anywhere, and the city, location and sound choices are stored locally in the browser (localStorage).

The demo can record sessions with [Smartlook](https://www.smartlook.com/) for the product team's review: set `SMARTLOOK_KEY` (and the project region) in `assets/app.js`. When enabled, the approximate IP-based city and coordinates are attached to the session; the exact GPS position used to sort multiplexes is never sent.

## Créditos

- Film metadata, posters and backdrops: [TMDB](https://www.themoviedb.org/). This product uses the TMDB API but is not endorsed or certified by TMDB.
- Trailers: YouTube (privacy-enhanced `youtube-nocookie.com` embeds).
- Logo and brand: Cine Colombia. Typeface: Roboto (Google Fonts).

## Pruebas

`npm i && npm test` corre `tests/feed-sound.mjs`: 19 casos del orquestador de tráilers del feed (arranque de la primera tarjeta, precarga y activación de la siguiente, control ▶ a los 10 s, reintento de un player mudo, preferencia de sonido y activación del navegador, Sonido, remute de iOS, TikTok, pestaña oculta, escritorio) con mensajes sintéticos de los reproductores en Chrome (emulación iPhone 13), sin red. `ONLY=16 npm test` corre un caso. El diseño y las mediciones en el iPhone están en `docs/auditoria-player.md`. Necesita Google Chrome instalado; el sitio en sí sigue sin dependencias.

## Publicar

El sitio se publica en GitHub Pages con GitHub Actions (`.github/workflows/pages.yml`) en cada push a `main`: https://ortegoncarlos.github.io/cinecolombia-reboot/

En el despliegue se generan páginas estáticas de compartir en `s/{id}/` (`scripts/share-pages.mjs`) con etiquetas Open Graph por película, para que WhatsApp y Facebook muestren título, sinopsis e imagen. El botón Compartir enlaza a esas páginas. Si el sitio cambia de dominio, actualiza `SITE_URL` en `assets/app.js` y la variable `SITE_URL` del workflow (o el valor por defecto del script).
