# Arnav Flight Radar — Brand Mark

**The Apex Vector.** The letter **A** is drawn as an aviation heading chevron, and its apex is the radar origin. The crossbar is a **range ring** centred on that apex, drawn as a time-faded flight trail that ends at one **amber aircraft**, the tracked target. Every element is original vector geometry: no fonts, stock icons or third-party artwork.

Open `index.html` (through any static server) to see the full brand sheet.

## Files

| File | Use |
| --- | --- |
| `svg/arnav-mark.svg` | Primary app icon (squircle tile, rings, aircraft). 64 px and up. |
| `svg/favicon.svg` | Small-size icon: thicker strokes, no rings, beacon dot. Below 64 px. |
| `svg/arnav-mark-animated.svg` | Splash/loading mark: ring pings, trail draws in, aircraft flies along the ring. Respects `prefers-reduced-motion`. |
| `svg/arnav-glyph-dark.svg` / `-light.svg` | Glyph without tile, for glass headers on dark or light surfaces. |
| `svg/arnav-glyph-mono.svg` | Single-ink version using `currentColor`. |
| `svg/arnav-lockup-dark.svg` / `-light.svg` | Horizontal icon and wordmark. |
| `svg/arnav-wordmark-dark.svg` / `-light.svg` | Wordmark only. |
| `svg/arnav-og.svg` | Social share card source (1200×630). |
| `png/*` | Raster exports: favicon 16/32, apple-touch 180, PWA 192/512, store 1024, OG image, 2× lockups. |

## Web `<head>`

```html
<link rel="icon" href="/brand/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/brand/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/brand/apple-touch-icon-180.png">
<meta name="theme-color" content="#03060B">
<meta property="og:image" content="/brand/og-image-1200x630.png">
```

## Palette

| Token | Hex | Role |
| --- | --- | --- |
| Obsidian | `#03060B` | Deepest surface |
| Midnight | `#081122` | Tile body |
| Deep Ocean | `#0C1D38` | Tile highlight |
| Ice | `#F4F8FF` | Glyph and wordmark on dark |
| Arctic Silver | `#8DA2BC` | Secondary text |
| Radar Cyan | `#5CE1FF` | Beam, trail head |
| Trail Blue | `#2E8BFF` | Trail body |
| Target Amber | `#FFB547` | The tracked aircraft only. Use sparingly. |

## Rules

- Amber marks the tracked target only. Never use it on the chevron or the wordmark.
- Clear space: keep at least one crossbar height (≈ 0.25 × icon height) around the mark.
- Don't recolour, rotate or outline the glyph, and don't swap in a stock plane icon.
- Wordmark letters are custom stroke geometry. Don't retype "ARNAV" in a font as a replacement.

## Regenerating

All SVGs come from one geometry source:

```sh
node brand/scripts/build-logo.mjs
```

Tune `APEX`, `FOOT_DX`, `RING` and `BLIP_DEG` at the top of the script. Every asset stays in sync. PNGs were rasterized from the SVGs with `@resvg/resvg-js`.
