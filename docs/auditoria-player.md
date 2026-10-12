# Auditoría del reproductor del feed (`feed()` en `assets/app.js`)

Punto de partida: commit 495de42 (embeds de YouTube y TikTok por tarjeta). Medido en el iPhone del usuario (iPhone17,3, iOS 18.7, Safari 27.0.1) por USB con Web Inspector (`ios_webkit_debug_proxy`), sitio servido por la LAN y log en pantalla de `?debug=1`.

## Lo que había

| Nombre | Qué hacía | Veredicto |
|---|---|---|
| `timer` | Crear el player 600 ms después de activar una tarjeta (0 ms en la primera) | Se conserva (carga desde cero). |
| `dt` | 20 s sin `playing` → película `dead`, player eliminado | Redundante con `bt`; eliminado. |
| `pt` | Precarga del siguiente a los 8 s si la activa no reproducía | La precarga llegaba tarde: un swipe antes de ~4 s no encontraba nada. Ahora al `loadeddata` del clip activo o a 1.5 s. |
| `bt` / `arm()` | 2.5 s con player listo sin estado → `blocked`, ▶ y toast | Falso positivo medido (▶ sobre tráilers que arrancaban solos a los 2.9 s). Eliminado. |
| `dk` | Atenúa la UI 3 s después de `playing` | Se conserva. |
| `vid`, `pre`, `np` | Tarjeta con iframe activo, precarga, candidata | Sustituidos por dos elementos `<video>` fijos (`V[cur]` y el otro). |
| `playing`, `ps`, `pm`, `wait` | Reproduciendo, último estado, silenciado, ▶ | `ps` sobra con `<video>`; el resto se conserva. |
| `blocked`, `gest`, `dead`, `tkFail`, `el.rdy/st/ut/rm/op/own` | Heurísticas del protocolo `postMessage` y de la pausa de iOS | Todas eliminadas con los embeds. |

## Hallazgos en el dispositivo (por qué se abandonaron los embeds)

1. Autoplay silenciado de YouTube/TikTok: 20+ cargas limpias, con todas las variantes de CSS e inserción, reprodujeron en 1.0–1.7 s; los fallos de la mañana eran intermitentes (una vez reproducido: el player quedó listo y sin estado hasta nuestro `playVideo` a los 5 s). Lo nuestro era el ▶ falso.
2. Sonido en un iframe cross-origin: WebKit sólo acepta un arranque o un `unMute` con audio mientras se procesa un gesto, y el gesto viaja por `postMessage` únicamente dentro del propio evento. Medido tras un toque real en la página: `unMute` al `onReady` → ignorado o `state -1` (tarjeta atascada); URL `mute=0` → `-1`; TikTok `muted=0` → `onMute true`; `unMute` al `state 1` desde el IntersectionObserver → `onMute false` y pausa de iOS 40 ms después (la ráfaga de sonido); `unMute` + `playVideo` dentro del `touchend` del swipe → `unMute` aceptado, `playVideo` ignorado (tarjeta pausada 5 s). Sólo el toque en Sonido (`unMute` síncrono en el `click`) daba sonido, y sólo a esa tarjeta — salvo el player de precarga que hubiera recibido `playVideo` dentro de ese mismo toque: ese quedaba desbloqueado para siempre (regla de WebKit: el elemento que recibió una orden durante un gesto pierde sus restricciones). Un player persistente de YouTube (`loadVideoById`) hereda el desbloqueo, pero un player por tarjeta nunca.
3. Precarga: con el player listo, activación → `state 1` en 0.03–0.3 s; sin precarga 1.7–2.9 s. Un `seekTo 0` hacía rebufferizar 0.8 s. Un iframe de TikTok tarda ~1.6 s en cargar.

Conclusión: con embeds, el sonido automático en la siguiente tarjeta exige un elemento `<video>` que ya haya recibido un gesto. Eso sólo lo da el vídeo nativo propio.

## Diseño final: dos `<video>` nativos

- Clips propios (`clip` en `data/films.json` / `data/promos.json`, `media/trailers/`, `scripts/make-clips.sh`; `vertical: true` para 9:16). Sin `clip`, la tarjeta muestra el hero con su movimiento Ken Burns y no hay reproductor.
- Dos `<video playsinline muted loop preload="auto">` como primeros hijos del scroller `.feed`, posicionados en absoluto sobre la caja `.media` de su tarjeta (`place()`), así el scroll nativo los lleva con la tarjeta. `V[cur]` reproduce la activa; el otro precarga el siguiente clip en la dirección del swipe (silenciado, pausado en el primer frame). Al activar una tarjeta precargada los roles se intercambian: `play()` y ya. Al volver atrás, el player de la tarjeta que se deja queda como precarga y el libre carga la nueva.
- Sonido: Sonido pone `muted=false` en el player activo dentro del toque y hace `play()`+`pause()` silencioso en el de precarga; ambos elementos quedan desbloqueados para la sesión y cada tarjeta siguiente arranca con sonido sin gesto. En una carga nueva todo arranca silenciado (iOS rechaza el arranque con audio sin gesto), aunque la preferencia esté guardada; un toque en Sonido la aplica.
- `play()` rechazado con sonido → reintento silenciado; rechazado silenciado también → ▶ (`wait`), nunca mientras el archivo carga; `check()` a los 10 s reintenta una vez. Pestaña oculta/visible, búsqueda, pantalla completa nativa (`webkitEnterFullscreen`), atenuado, escritorio (rueda/teclas) y `NOAUTO` se conservan.
- La página de detalle sigue con su tráiler de YouTube (`ytSrc`/`ytCmd`).
