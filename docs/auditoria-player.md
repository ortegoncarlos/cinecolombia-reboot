# Auditoría del orquestador de tráilers (`feed()` en `assets/app.js`)

Punto de partida: commit 495de42. Medido en el iPhone del usuario (iPhone17,3, iOS 18.7, Safari 27.0.1) por USB con Web Inspector (`ios_webkit_debug_proxy`), con el sitio servido por la LAN y el log en pantalla de `?debug=1`.

## Lo que había: temporizadores y banderas

| Nombre | Qué hacía | Veredicto |
|---|---|---|
| `timer` | Crear el player 600 ms después de activar una tarjeta (0 ms en la primera) | Se conserva. |
| `dt` | 20 s sin `playing` → película `dead`, player eliminado hasta volver | Redundante con `bt`; se disparaba en tarjetas cargando. Eliminado. |
| `pt` | Precarga del siguiente a los 8 s si la activa no reproducía | La precarga empezaba al reproducir o a los 8 s: un swipe antes no encontraba player. Ahora: al primer mensaje del player activo (≈0.5 s) o a los 2 s. |
| `bt` / `arm()` | 2.5 s con player listo sin estado → `blocked`, ▶ y toast | Falso positivo medido (▶ sobre tráilers que arrancaban solos a los 2.9 s); `.card.wait` además mostraba el iframe y le daba eventos. Eliminado. |
| `dk` | Atenúa la UI 3 s después de `playing` | Se conserva. |
| `vid`, `pre`, `np` | Tarjeta con player activo, precarga, candidata | `np` pasa a variable local; quedan `vid` y `pre`. |
| `playing`, `ps`, `pm`, `wait` | Reproduciendo (revela el iframe), último estado, silenciado, ▶ nuestro (1) o tocado (2) | Se conservan: son el estado visible. |
| `blocked` | Autoplay bloqueado | Se arrastraba a las tarjetas siguientes. Eliminado. |
| `gest` | La página ya tuvo un gesto; el primer gesto des-silenciaba la tarjeta activa | Causaba la ráfaga de sonido al abandonar una tarjeta. Eliminado: el sonido sólo lo da Sonido. |
| `dead`, `tkFail` | Película sin player; TikTok sin `load` en 15 s → YouTube | `dead` eliminado (`check()` reintenta una vez); `tkFail` se conserva. |
| `el.rdy/st/ld/li/dur/op` | Player respondió, estado, cargado, intervalo de `listening`, duración, pausa nuestra | Se conservan. |
| `el.ut`, `el.rm`, `el.own` | Re-silenciar si iOS pausa tras un `unMute`; no más des-silenciados; TikTok con su botón | `ut` se conserva (red de seguridad tras Sonido); `rm` eliminado; `own` se conserva sólo en el camino del ▶. |

## Hallazgos en el dispositivo

1. **Autoplay silenciado de YouTube**: 20+ cargas limpias (por script y por el usuario desde la barra de URL y recarga) con todas las variantes de CSS e inserción (`opacity:0`, `visibility:hidden`, `display:none`, `pointer-events:none`, sin `allow`, transformado, 1×1, fuera de pantalla, estático, por JS, `autoplay=0` + `playVideo`) reprodujeron en 1.0–1.7 s. Los fallos vistos por la mañana son intermitentes y ajenos a nuestro marcado; lo que sí era nuestro era el ▶ falso a los 2.5 s. `playVideo` por `postMessage` a un player listo funciona.
2. **Sonido**: en WebKit un player cross-origin sólo arranca o se des-silencia con audio mientras se procesa un gesto, y el gesto viaja por `postMessage` sólo dentro del propio evento. Medido tras un toque real en la página: `unMute` al `onReady` → ignorado (`muted=true`) o aceptado y `state=-1` (tarjeta atascada); URL `mute=0` → `state=-1`; TikTok `muted=0` → `onMute true`; `unMute` al `state=1` desde el IntersectionObserver → `onMute false` y pausa de iOS 40 ms después (la ráfaga); `unMute` + `playVideo` dentro del `touchend` del swipe → `unMute` aceptado pero `playVideo` ignorado (tarjeta pausada 5 s). Sólo el toque en Sonido (`unMute` síncrono en el `click`) da sonido, en YouTube y en TikTok.
3. **Precarga**: con precarga lista, activación → `state 1` en 0.21 s (TikTok) y 0.83 s (YouTube con `seekTo 0`, que rebufferiza; sin él, al instante). Sin precarga (al volver atrás): 1.7–2.9 s. La precarga sólo miraba hacia adelante.

## Diseño final

Un estado por tarjeta: sin player → cargando (iframe creado) → listo (primer mensaje) → reproduciendo (`state 1`). Todo player arranca solo, silenciado (`autoplay=1`, `mute=1`/`muted=1`), también el de precarga, que se pausa en su primer `state 1`; al activarlo basta `playVideo`. La precarga se crea al primer mensaje del player activo (o a los 2 s) en la dirección del swipe, y al volver atrás el player que se deja se conserva como precarga. `check()` a los 5 s reenvía `playVideo` (silenciado) a un player listo que no arrancó; a los 10 s recrea una vez un player que nunca respondió o muestra ▶ si sigue sin arrancar (nunca mientras carga, nunca si está buffering). El sonido sólo sale de Sonido: `unMute` dentro del toque; si iOS lo pausa en 1.5 s se re-silencia y reanuda, con un aviso único. La preferencia guardada sólo decide el estado del botón; en iPhone no existe forma de que la siguiente tarjeta arranque con sonido con embeds de YouTube o TikTok.
