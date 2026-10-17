# Architecture

One Cloudflare Worker serves both the React app (as static assets) and the `/api/*` routes.
`wrangler.jsonc` sets `run_worker_first: ["/api/*"]`, so only API calls run Worker code. Everything
else is served straight from the asset store, which costs nothing and doesn't count toward Worker
request limits.

```
repo
├─ src/        React app (Vite, Tailwind v4, Motion, MapLibre GL 6)
├─ worker/     Hono API + UpstreamGate Durable Object
├─ shared/     code used by both: types, normalization, geo, stats, search
├─ scripts/    build-time dataset generation (OurAirports)
├─ brand/      logo system (generated SVG/PNG)
├─ tests/      Vitest unit + integration
└─ e2e/        Playwright
```

## Request path

1. The browser's **feed controller** (`src/data/feed.ts`) picks a region: the viewport centre (or a
   followed aircraft) with a radius that covers the view, clamped to 250 NM.
2. It snaps that region with the same `shared/region.ts` the server uses, so small pans don't
   trigger new requests.
3. It calls `GET /api/aircraft/nearby` every *N* seconds (default 15, minimum 10). Polling pauses
   while the tab is hidden, backs off exponentially on errors and honours `Retry-After`.
4. The **Worker** validates the input, snaps it to a shared regional cell (radius buckets
   25/50/100/150/200/250 NM; grid step ≈ radius ÷ 5) and calls the Durable Object over RPC.
5. **UpstreamGate**, the single Durable Object instance `"global"`, then:
   - returns a cached snapshot if it is younger than the TTL (10 s);
   - otherwise joins any identical in-flight request (coalescing);
   - otherwise reserves the next pacing slot for that host (adsb.fi ≥ 1.1 s apart; AviationWeather
     ≥ 1.5 s apart). If the wait would exceed 4 s it refuses instead of queueing without limit;
   - fetches with an 8 s timeout, validates and normalizes the response, and caches it;
   - on 429, 5xx or a timeout it opens a circuit breaker with exponential back-off (2 s → 120 s, or
     the provider's `Retry-After`) and serves the last good snapshot (≤ 5 min old) marked
     `stale: true` with a `degraded` reason.

A Durable Object runs as exactly one instance per id worldwide, so these limits are **true global
ceilings**, not per-datacenter counters. The Worker also runs a best-effort per-IP token bucket to
stop a single client from flooding the API.

## Honesty rules (enforced in code)

| Rule | Where |
| --- | --- |
| Missing fields stay absent; the UI shows "Not available" | `shared/normalize.ts`, `src/components/ui/Data.tsx` |
| Implausible values (altitude > 80,000 ft, track > 360°, …) are dropped, not fixed | `shared/normalize.ts` |
| Ages are measured on the provider's clock and carried forward with our server clock, so device clock skew can't make data look fresh | `src/state/traffic.ts` |
| Motion interpolates between real reports and stops at the newest one; a hollow ring marks it | `src/state/traffic.ts`, `src/map/aircraftLayer.ts` |
| Trails contain only received positions; gaps over 150 s or jumps over 1,100 kt break the line | `src/state/traffic.ts` |
| Aircraft that vanish inside the queried area become **lost**, then are removed | `src/state/traffic.ts` |
| Symbol classes come only from the ICAO type code or ADS-B emitter category; otherwise the symbol is generic | `shared/classify.ts` |
| Statistics state their population and never claim worldwide totals | `shared/stats.ts`, `AnalyticsPanel` |
| Replay interpolates only between two recorded snapshots of the same aircraft | `aircraftLayer.ts` (`replayFeatures`) |

## Rendering engine (`src/map/aircraftLayer.ts`)

- **No DOM per aircraft.** All aircraft live in one GeoJSON source drawn by GPU symbol layers.
- **SDF icons.** Each silhouette (`src/map/silhouettes.ts`) is rasterized once and converted to a
  signed distance field (exact Felzenszwalb–Huttenlocher transform in `src/map/sdf.ts`).
  `icon-color` (an altitude/speed/V-S expression) and halos are then applied on the GPU at any size.
- **Adaptive update rate.** The main source is rebuilt at about 15 fps from zoom 9 up, then 6, 2.5 and
  1 fps as you zoom out (motion is sub-pixel there). It also slows down for very large fleets.
- **The selected aircraft** has its own tiny source that updates every frame, with an animated
  selection ring, glow, the observed trail with a reveal animation, and the latest-report marker.
- **Hover** uses `feature-state`, so highlighting is instant and doesn't rebuild data.
- **Style swaps** use `setStyle(…, { diff: false })` behind a crossfade veil. Overlays re-install
  idempotently on `style.load`.
- **Low zoom:** below z≈4.5 aircraft are drawn as dots. A density heatmap is available. Small airports
  are clustered.

## State

| Store | Contents |
| --- | --- |
| `traffic` (plain class) | Tracks, trails, freshness, clock offset, session snapshots. React re-renders through a version counter (once per poll), not every frame. |
| `useUI` (Zustand) | Panels, selection, follow, search, measure, replay, toasts |
| `useSettings` (persisted) | Theme, map style, units, motion, polling, camera |
| `useFilters`, `useBookmarks` (persisted) | Filter presets, favourites, saved views, recents |
| TanStack Query | Airport details, METAR/TAF, health and provider lists |

## Performance notes

- The initial JS is about 540 KB gzipped, of which MapLibre is 279 KB. Vendor chunks are split so app
  deploys don't invalidate them, and secondary panels are lazy chunks of 1–4 KB.
- Airports load in tiers: about 6,200 major airports (218 KB gzipped) at startup, and the full 20,600
  only when you search. Per-airport runways and frequencies are 583 static shards fetched on demand.
- API payloads omit absent fields; Cloudflare compresses JSON automatically.
- `reduced` glass effects drop `backdrop-filter` for weaker GPUs. `prefers-reduced-motion` and the
  in-app motion setting disable decorative animation.
