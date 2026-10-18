# Architecture

Every aircraft on the map is **simulated in the browser**. The server never serves aircraft data
and never contacts a live aircraft source. Real inputs (airports, runways, airlines, stands and
taxiways, weather, airspace, imagery) shape the simulation; flights, flight numbers, registrations,
schedules and positions are invented, and the site says so.

One Cloudflare Worker serves both the React app (as static assets) and the `/api/*` routes.
`wrangler.jsonc` sets `run_worker_first: ["/api/*"]`, so only API calls run Worker code. Everything
else is served straight from the asset store, which costs nothing and doesn't count toward Worker
request limits.

```
repo
├─ src/        React app (Vite, Tailwind v4, Motion, MapLibre GL 6)
│  ├─ data/sim/   the world simulator (lazy-loaded)
│  ├─ data/       runtime glue (world.ts), airports, airlines, media
│  └─ map/        GPU aircraft layer and map overlays
├─ worker/     Hono API + UpstreamGate Durable Object (weather only)
├─ shared/     code used by both: types, geo, units, weather, stats, classification, search
├─ scripts/    build-time datasets (OurAirports, OpenFlights, openAIP, OpenStreetMap, Wikimedia)
├─ public/     static data: airports, airlines, airspace, ground (stands/taxiways), logos, media
├─ brand/      logo system (generated SVG/PNG)
├─ tests/      Vitest unit + integration
└─ e2e/        Playwright (functional, mobile, visual)
```

## The world simulator

| Part | File | Role |
| --- | --- | --- |
| Engine | `src/data/sim/engine.ts` (`World`) | Airframes, legs, runway slots, stands, taxi routing, winds aloft, holding, diversions, cancellations, trails |
| Fleet | `src/data/sim/fleet.ts`, `fleet-more.ts` | Aircraft types and performance; about 234 airlines (core and extended lists) with hubs, fleet mix, size and registration pattern; general-aviation types |
| Registry | `src/data/sim/airlines.ts` | The full airline list, alliance memberships (Star Alliance, oneworld, SkyTeam) and all-cargo operators |
| Runtime glue | `src/data/world.ts` | Clock, ticks, real-weather application, flight info, boards, departure queue, stands, service vehicles, widgets, search, airline pages |

**Start-up** (`startSim`, once the map is ready): the major-airport index, the runway ends
(`runways-major.json`), the OpenStreetMap stands (`ground/stands.json`) and the engine chunk load in
parallel. The world is seeded from the UTC day, so everyone sees the same world on the same day, and
populated at a density scaled to the device (lighter on phones and low-core machines).

**Clock.** Simulated time runs at 1×, 5×, 15× or 30× (`setSimSpeed`, keys `1`–`4`). The world
advances every 3 s at 1× and 5×, and every 2 s at 15× and above. Each tick turns every airframe's
state into an `Aircraft` record and hands the whole world to the traffic engine as one response.

**Gate to gate.** Each airframe cycles stand → push-back → taxi → departure queue → take-off → climb
→ cruise → descent → vectors (or holding) → final → landing → runway exit → taxi in → turnaround.
Runway slots sequence arrivals and departures; capacity follows each airport's size and weather.
Timetables repeat daily per route; codeshares come only from the operating airline's alliance; cargo
operators fly mostly at night.

**Real weather.** `world.ts` fetches METARs through `/api/weather/metar`: the 40 busiest hubs at
start-up (10 stations per request, 2 s apart), then large airports in view from zoom 6.5 (each
station at most every 20 minutes). A METAR sets the runway in use (best headwind), cuts capacity in
low visibility (low-visibility procedures below ¾ SM), and makes go-arounds, diversions and
cancellations more likely in fog or strong gusts. Without a report the runway comes from the
simulated wind, and the airport panel says which basis was used.

**Ground.** Where OpenStreetMap stands exist, aircraft park on real stands. When you zoom in
(≥ 11) near such an airport, its taxiway network (`ground/<ICAO>.json`) is loaded and taxi routes
and runway exits follow it.

**Trails** are computed from the simulated path (`World.trail`); no position reports are stored.

## Weather path (the only upstream the Worker calls)

1. The browser calls `GET /api/weather/metar` or `/taf` (stations or a bounded box).
2. The **Worker** validates the input and calls the Durable Object over RPC.
3. **UpstreamGate**, the single Durable Object instance `"global"`, then:
   - returns a cached report if it is younger than its TTL (METAR 5–10 min, TAF 15 min);
   - otherwise joins any identical in-flight request (coalescing);
   - otherwise reserves the next pacing slot (AviationWeather calls ≥ 1.5 s apart). If the wait would
     exceed 4 s it refuses instead of queueing without limit;
   - fetches with an 8 s timeout, validates and normalizes the response, and caches it;
   - on 429, 5xx or a timeout it opens a circuit breaker with exponential back-off (2 s → 120 s, or
     the provider's `Retry-After`); a 401/403 means a 15-minute cool-down. Meanwhile it serves the
     last good report (≤ 5 min past its TTL) with a `degraded` reason.

A Durable Object runs as exactly one instance per id worldwide, so these limits are **true global
ceilings**, not per-datacenter counters. The Worker also runs a best-effort per-IP token bucket to
stop a single client from flooding the API. Other routes (airports, health, config, providers,
manifest) are answered from bundled data or constants; see [API.md](API.md).

## Honesty rules (enforced in code)

| Rule | Where |
| --- | --- |
| Every aircraft is marked simulated: provider `sim`, non-ICAO `~` ids, so no real aircraft record or photo can attach to an invented flight | `src/data/world.ts` |
| "Simulated" appears in the header status, status bar, flight cards, airport boards and analytics | `LiveStatus.tsx`, `StatusBar.tsx`, `AircraftPanel.tsx`, `AirportOps.tsx`, `AnalyticsPanel` |
| A first-visit welcome explains the simulation; **About & data** explains what is real and what is invented | `src/features/shell/Welcome.tsx`, `src/features/data/DataPanel.tsx` |
| Representative photos are labelled "Representative — not this simulated aircraft"; captions name the real aircraft pictured, with author and licence | `src/features/aircraft/AircraftPhoto.tsx`, `src/data/media.ts` |
| The Credits panel lists every logo and photo with author, licence and a link to its Commons page | `src/features/data/CreditsPanel.tsx` |
| Airline logos are trademarks of their owners, shown only to identify the operator | `src/data/media.ts` |
| The runway in use says whether it comes from a real METAR or the simulated wind | `src/data/world.ts` (`simRunwayInUse`), `AirportOps.tsx` |
| Simulated squawks never use emergency or special codes | `src/data/sim/engine.ts` |
| Symbol classes come only from the ICAO type code or emitter category; otherwise the symbol is generic | `shared/classify.ts` |
| Statistics state their population (simulated aircraft in view) and never claim worldwide totals | `shared/stats.ts`, `AnalyticsPanel` |
| Missing fields stay absent; the UI shows "Not available" | `src/components/ui/Data.tsx` |
| Timeline playback records only simulated aircraft in view and labels them as such; replay interpolates only between two recorded snapshots | `src/features/timeline/Timeline.tsx`, `aircraftLayer.ts` (`replayFeatures`) |

## Rendering engine (`src/map/aircraftLayer.ts`)

- **No DOM per aircraft.** All aircraft live in one GeoJSON source drawn by GPU symbol layers.
- **SDF icons.** Each silhouette (`src/map/silhouettes.ts`) is rasterized once and converted to a
  signed distance field (exact Felzenszwalb–Huttenlocher transform in `src/map/sdf.ts`).
  `icon-color` (an altitude/speed/V-S expression) and halos are then applied on the GPU at any size.
- **Adaptive update rate.** The main source is rebuilt at about 15 fps from zoom 9 up, then 6, 2.5 and
  1 fps as you zoom out (motion is sub-pixel there). It also slows down for very large fleets.
- **Motion** interpolates between simulator ticks, so icons glide smoothly at every clock speed.
- **The selected aircraft** has its own tiny source that updates every frame, with an animated
  selection ring, glow and its simulated trail.
- **Hover** uses `feature-state`, so highlighting is instant and doesn't rebuild data.
- **Style swaps** use `setStyle(…, { diff: false })` behind a crossfade veil. Overlays re-install
  idempotently on `style.load`.
- **Every zoom:** aircraft icons and large airports are drawn at all zoom levels, scaled down on world
  views. Small airports are clustered. A density heatmap is available.
- **Large fleets:** off-screen aircraft are culled from the source once zoomed in, ground traffic is
  hidden below z5 when more than 3,000 aircraft are tracked, and the rebuild interval adapts to how many aircraft are drawn.
- **3D path:** when the map is tilted, the selected aircraft's trail is extruded (`fill-extrusion`) to its
  altitude.

### Overlays

| File | Overlays |
| --- | --- |
| `src/map/extraOverlays.ts` | Day/night terminator with twilight bands and the Moon (phase drawn locally); airspace (FAA live query in the US, openAIP static files for Canada and Europe, including restricted/danger/prohibited areas), extruded in 3D when tilted, with click-for-details popups; NASA lightning climatology; the selected flight's route line (flown and planned) |
| `src/map/opsOverlays.ts` | Stands (free/occupied, zoom ≥ 14), ground-service vehicles around turnarounds (zoom ≥ 15.5), the airport disruption map |
| `src/map/overlays.ts`, `airportsLayer.ts` | Radar (RainViewer), METAR stations, airports |

## State

| Store | Contents |
| --- | --- |
| `traffic` (plain class) | Tracks fed by the simulator each tick, session snapshots for Timeline playback. React re-renders through a version counter (once per tick), not every frame. |
| `useSim` (Zustand) | Whether the world is running, clock speed, airborne and ground counts |
| `useUI` (Zustand) | Panels, selection, follow, search, measure, replay, toasts |
| `useSettings` (persisted) | Theme, map style, units, motion, camera, layers |
| `useFilters`, `useBookmarks` (persisted) | Filter presets, favourites, pinned airports, saved views, recents |
| TanStack Query | Airport details, METAR/TAF, health and provider lists, media table |

## Performance notes

- The initial JS is about 530 KB gzipped, of which MapLibre is about 280 KB. Vendor chunks are split
  so app deploys don't invalidate them; the simulator engine and secondary panels are lazy chunks.
- Airports load in tiers: about 6,200 major airports at startup, and the full 20,600 only when you
  search. Per-airport runways and frequencies are 583 static shards fetched on demand.
- Taxiway networks load per airport, only when zoomed in on it.
- `reduced` glass effects drop `backdrop-filter` for weaker GPUs. `prefers-reduced-motion` and the
  in-app motion setting disable decorative animation.

## Offline & installability

`public/sw.js` caches the app shell (network-first), hashed assets (cache-first) and airport data
(stale-while-revalidate). `/api/*` is never cached, and third-party requests (tiles, photos, radar)
are never intercepted. `src/lib/pwa.ts` registers it in production, exposes the install prompt in
Settings and shows online/offline toasts. Installed apps get home-screen shortcuts for pinned
airports from `/api/manifest.webmanifest?pins=…`.
