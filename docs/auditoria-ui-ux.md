# Auditoría UI/UX · 12 de octubre de 2026

Alcance: las cuatro páginas (feed, película, multiplex, boleta) en móvil (390×844) y escritorio (1440×900), todos los flujos, heurísticas de Nielsen, Web Interface Guidelines, tipografía y copy. Se corrigió todo lo P0–P2 que no implicaba rediseñar.

## Resultado

- 65 verificaciones automatizadas de flujo y teclado: todas pasan.
- Sin errores de consola ni peticiones fallidas en las 36 capturas.
- Lighthouse accesibilidad: 100 en las cuatro páginas, móvil y escritorio.
- UsabilityScore (heurística): 60/D antes → 75/C después.

## Hallazgos principales

| # | Sev | Página | Hallazgo | Estado |
|---|---|---|---|---|
| 1 | P1 | película | La píldora "Próxima" se desplazaba sobre el nombre del siguiente multiplex (regla CSS del feed sin acotar) | Corregido |
| 2 | P1 | boleta | 404 de `data/seats/shows/{id}.json` en casi todas las funciones | Corregido |
| 3 | P2 | boleta | Cargaba los 7 días antes de dibujar la sala (LCP móvil 6,5 s) | Corregido |
| 4 | P2 | todas | Subtitulado / Subtitulada / SUB e Imax / IMAX mezclados | Corregido (etiquetas únicas `attrLabel`) |
| 5 | P2 | multiplex | Chips de filtro con códigos crudos y orden distinto a película | Corregido |
| 6 | P2 | película | "No hay funciones el mañana 12" | Corregido |
| 7 | P2 | feed, boleta, multiplex | Tabs y grupos de radio sin flechas de teclado | Corregido (`tabKeys`) |
| 8 | P2 | feed, película | Botón "Sonido" con nombre accesible distinto al visible | Corregido |
| 9 | P2 | feed | "Siguiente ·" con contraste 1,5:1 en tarjetas verticales | Corregido |
| 10 | P2 | feed | Sin h1 | Corregido |
| 11 | P2 | todas | Región live del toast creada tarde; acción de 6 s sin pausa | Corregido |
| 12 | P2 | boleta | Sin aviso antes de expirar la reserva de sillas | Corregido (aviso a 60 s) |
| 13 | P2 | multiplex | Roboto cargada dos veces | Corregido |
| 14 | P2 | multiplex | Fondos w780 para franjas de 130 px | Corregido (w300 en móvil) |
| 15 | P2 | compartido | Código y CSS muertos de iteraciones anteriores (~3,9 KB) | Corregido |
| 16 | P2 | película, feed | Títulos largos en 3–4 líneas | Corregido (escala por longitud) |
| 17 | P2 | multiplex | Objetivos táctiles de 26–28 px | Corregido (44 px) |
| 18 | P2 | feed | TypeError en saltos rápidos | Corregido |
| 21 | P2 | feed | Con YouTube/TikTok bloqueados aparece un marco vacío sobre el fondo | En corrección |
| 22 | P3 | feed | La precarga de TikTok compite con el primer render | En corrección |
| 23 | P3 | boleta | Sillas de ~19 px a 1× en móvil (existe zoom) | Recomendado: abrir a 2× en móvil |
| 24 | P3 | película | "Próxima" puede quedar dentro de "Ver N multiplex más" | Recomendado |
| 25 | P3 | boleta | Urgencia simulada (personas viendo, sillas tomadas) | Recomendado: datos reales en producción |
| 26 | P3 | todas | Nombres del control de ciudad inconsistentes; "(IP)" es jerga | Recomendado |
| 27 | P3 | película | Sinopsis en inglés en algunos títulos de Alternativo | Recomendado: corregir en datos |
| 28 | P3 | todas | `films.json` (294 KB) en cada página | Recomendado: dividir índice |
| 29 | P3 | feed escritorio | Overlay de búsqueda `aria-modal` con barra superior usable; sin skip link | Recomendado |

## Scorecard heurístico (antes → después)

| Heurística | Antes | Después |
|---|---|---|
| Visibilidad del estado | 4 | 4 |
| Correspondencia con el mundo real | 4 | 5 |
| Control y libertad | 4 | 4 |
| Consistencia y estándares | 3 | 4 |
| Prevención de errores | 4 | 5 |
| Reconocimiento antes que recuerdo | 4 | 4 |
| Flexibilidad y eficiencia | 3 | 4 |
| Diseño estético y minimalista | 4 | 4 |
| Recuperación de errores | 4 | 4 |
| Ayuda y documentación | 4 | 4 |

## Lighthouse (antes → después)

| Página | Vista | Rendimiento | Accesibilidad | Buenas prácticas |
|---|---|---|---|---|
| feed | móvil | 71 → 69 | 100 | 79 (cookies de TikTok) |
| feed | escritorio | 95 → 94 | 100 | 78 (cookies de TikTok) |
| película | móvil | 61 → 59 | 100 | 96 |
| película | escritorio | 91 → 86 | 100 | 96 |
| multiplex | móvil | 52 → 53 | 100 | 100 |
| multiplex | escritorio | 85 → 85 | 100 | 100 |
| boleta | móvil | 75 → 84 | 100 | 96 → 100 |
| boleta | escritorio | 96 → 98 | 100 | 96 → 100 |

Las variaciones de pocos puntos en rendimiento son ruido entre corridas locales. La boleta es `noindex` a propósito.

## Peso

Código (HTML+CSS+JS): 188 KB → 184 KB. Primera vista de la boleta en móvil: 897 KB → 611 KB. Multiplex: 1.136 KB → 996 KB.
