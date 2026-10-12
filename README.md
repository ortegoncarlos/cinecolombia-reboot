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

## Promos

Promo cards in the Cartelera feed (currently one TikTok video) come from `data/promos.json`: `after: n` places the card after the n-th film. Edit that file to add, move or remove promos.

## Privacidad

On the first visit the browser asks get.geojs.io for an approximate location based on the IP address, only to pick the nearest city and sort multiplexes by distance; nothing else is sent anywhere, and the city, location and sound choices are stored locally in the browser (localStorage).

## Créditos

- Film metadata, posters and backdrops: [TMDB](https://www.themoviedb.org/). This product uses the TMDB API but is not endorsed or certified by TMDB.
- Trailers: YouTube (privacy-enhanced `youtube-nocookie.com` embeds).
- Logo and brand: Cine Colombia. Typeface: Roboto (Google Fonts).
