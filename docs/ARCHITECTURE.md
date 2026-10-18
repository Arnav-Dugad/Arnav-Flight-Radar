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
| Engine | `src/data/sim/engine.ts` (`World`) | Airframes, legs, wake-separated runway slots, stands by terminal, taxi routing with names and runway crossings, de-icing, gate holds, procedures, oceanic tracks, vertical profiles, emergencies, special operations, history, trails |
| Procedures | `src/data/sim/procedures.ts` | Departure/arrival procedures on real navaids, en-route navaids, the daily North Atlantic track system |
| Timetable | `src/data/sim/schedule.ts` | Days of operation, IATA seasons, leisure/ski/winter-sun seasonality, weekday patterns, load factors, daylight |
| Special operations | `src/data/sim/special.ts` | Military operators and bases, HEMS and fixed-wing air ambulances, offshore and city helicopter operators, gliding |
| Fleet & types | `fleet.ts`, `fleet-more.ts`, `typeSpecs.ts`, `cabin.ts` | ~234 airlines, ~100 aircraft types with real dimensions, weights, fuel burn, wake categories and typical cabins |
| Airlines | `airlines.ts`, `airlineInfo.ts`, `terminals.ts` | Alliances, cargo operators, radiotelephony callsigns, livery colours, real terminal allocations at ~76 airports |
| Load & radio | `loadsheet.ts`, `radio.ts` | Estimated load sheet (passengers, fuel plan, weights, CO₂); simulated ATC transcript in ICAO/FAA phraseology |
| Markets & airspace | `src/data/sim/geoMarkets.ts` | World regions and market affinities (gravity model for destinations), real airspace closures and simulated volcanic-ash advisories, shortest-path re-routing through corridor points |
| Published procedures | `src/data/sim/usProcedures.ts` + `public/data/sim/procedures-us.json` | Real FAA SIDs and STARs (CIFP, public domain) at ~84 US airports |
| Simulation core | `src/data/simCore.ts` (in `src/data/sim.worker.ts`) | Owns the World inside a Web Worker: start-up, ticks packed into typed arrays, and every query (flight info, boards, radio, load sheets, statistics, overlays) |
| Page facade | `src/data/world.ts` | Clock, worker messaging, a query cache refreshed on every tick, traffic ingestion, real weather (METAR and TAF) fed to the worker, emergency alerts |

**Off the main thread.** The whole simulation runs in a Web Worker. Each tick the page posts the
simulated time; the worker advances the world and answers with the transmitting aircraft packed in
typed arrays (transferred, not copied) plus fresh answers to every query the page used in the last
few seconds. Rarely changing fields (flight number, squawk, route codes) are sent only when they
change. The page keeps a small cache: a first-time query returns nothing for a moment while the
worker answers, and components re-render on the `rev` counter.

**Start-up** (`startSim` → worker `coreInit`, once the map is ready): the major-airport index, runway ends, real navaids
(`data/sim/navaids.json`) and the engine chunk load in parallel; OpenStreetMap stands and terminals
(`ground/stands.json`) follow. Helicopter sites and gliding sites (`data/sim/heliports.json`,
`gliding.json`) load in the background and add their traffic a moment later. The world is seeded
from the UTC day, so everyone sees the same world on the same day, at a density scaled to the device.

**Clock.** Simulated time runs at 1×, 5×, 15× or 30× (`setSimSpeed`, keys `1`–`4`). The world
advances every 3 s at 1× and 5×, and every 2 s at 15× and above.

**Gate to gate.** Clearance → stand (at the airline's terminal) → push-back → taxi on named
taxiways, holding short of and crossing runways → de-icing when freezing precipitation is
reported → holding point and departure queue → line-up → take-off → departure procedure over a
real navaid → climb (250 kt below FL100) → cruise at a semicircular level with step climbs on long
flights, or on a North Atlantic track → descent → arrival procedure (holding over its navaid when
the airport is saturated) → radar vectors → final (ILS, CAT III in low visibility, RNP or visual)
→ landing → named runway exit → taxi in → turnaround.

**Runway configuration.** `runwayConfig.ts`: the runway into the wind, segregated mode on
independent parallels (arrivals and departures on different runways; Heathrow alternates at 15:00),
and night curfews (no scheduled take-offs; timetables shifted to arrive after the curfew lifts).
`World.runwaysFor(airport, t)` is pure; `runwaysAt` sets what the page shows for "now".

**Runway capacity.** Each runway stream has a capacity from the airport's size, cut by the METAR
now and by the TAF for later hours (`setForecast`), and every pair of movements keeps ICAO wake
separation (Super/Heavy/Medium/Light). Long departure queues become gate holds; saturated
destinations become ground delays at the origin, then airborne holding.

**Timetable.** Flight numbers are stable per route. Thin and leisure routes operate on fixed
weekdays; leisure, ski and winter-sun destinations follow the season; traffic dips on Saturday
and Tuesday; most passenger flying pauses overnight; cargo flies night banks.

**Markets.** International destinations follow a gravity model with real regional affinities
(South Asia and the Gulf, North America and the Caribbean, intra-Europe and so on), seasonal demand,
Hajj and holiday peaks. Airlines from countries Russia has banned (and those avoiding it) stay out of
Russian airspace; Ukraine and North Korea are avoided by everyone; flights re-route through corridor
points (Caucasus, Central Asia, the Arctic, the Pacific) found by a shortest-path search.

**Track systems.** North Atlantic tracks, Pacific tracks (PACOTS) and Australian flex tracks are
generated daily; a track that would cross airspace an operator avoids is not used.

**Rare events.** Medical diversions, engine failures, depressurisations and bird strikes divert to
the nearest suitable airport; after an engine failure the aircraft is repaired and positioned
empty to base. Weather causes go-arounds, diversions and cancellations.

**Beyond airlines.** General aviation flies in daylight (more at weekends), a third of it circuits
with touch-and-goes; military transports, tankers, AWACS, patrol aircraft and fighters fly from
real bases (US military aircraft in the US military address block); HEMS helicopters fly from
hospital pads to incident scenes and on to hospitals; offshore helicopters shuttle to platforms;
gliders winch-launch and thermal in daylight in the soaring season, with tow planes.

**Real weather.** `world.ts` fetches METARs for the 40 busiest hubs at start-up and for large
airports in view (each station at most every 20 minutes), then TAFs for the 30 busiest hubs. A
METAR sets the runway in use, the capacity, de-icing (temperature and weather), and the odds of
go-arounds, diversions and cancellations.

**Ground.** Stands and terminals come from OpenStreetMap at ~340 airports. When you zoom in near
such an airport, or select a flight to or from one, its taxiway network with names and holding
positions (`ground/<ICAO>.json`) is loaded, and later taxi movements follow it. `taxiGeo.ts` keeps
them strictly on the centre lines: stands, runway exits and holding points join the network at the
nearest point on an edge (not the nearest vertex), only the largest connected part of the network is
used, corners are filleted (capped so the nose wheel stays within ~14 m), push-backs end on the
taxilane facing the route, and departures hold short at the real holding position and line up through
the entry taxiway. Movements planned before the network loaded are re-planned — a taxi already under
way is split at "now". Networks load from zoom 9.5 (up to three airports in view).

**Operations rules.** `opsRules.ts`: overnight A-checks and rare C-checks at the home base, wet-lease
(ACMI) operators flying for airlines in summer and for Hajj, and ETOPS analysis of twin-engine routes
(rule time from the farthest point from an adequate airport, and the en-route alternates).

**Airways.** Domestic US routes use the real published airways (FAA CIFP en-route records,
`usAirways.ts`, A* search with an airway-change penalty); elsewhere navaid to navaid.

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
- **3D aircraft** (`src/map/models3d.ts`, `modelMeshes.ts`, `modelsBridge.ts`, loaded on demand):
  from zoom ~12.5 and in the chase view, every aircraft in view is drawn as a true-scale procedural
  model (18 shape families, real length and span, airline livery colours) in a raw WebGL custom
  layer, pitched from its climb rate and banked from its rate of turn; the 2D icons fade out.
- **Touch:** flick momentum is tuned separately for the map and the globe; two-finger rotate and
  pitch are enabled.

### Overlays

| File | Overlays |
| --- | --- |
| `src/map/extraOverlays.ts` | Day/night terminator with twilight bands and the Moon (phase drawn locally); airspace (FAA live query in the US, openAIP static files for Canada and Europe, including restricted/danger/prohibited areas), extruded in 3D when tilted, with click-for-details popups; NASA lightning climatology; the selected flight's route line (flown and planned) |
| `src/map/opsOverlays.ts` | Stands (free/occupied, zoom ≥ 14), ground-service vehicles around turnarounds (zoom ≥ 15.5), the airport disruption map |
| `src/map/worldOverlays.ts` | The simulated North Atlantic tracks, OpenStreetMap terminal outlines and names, 3D buildings when tilted |
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
