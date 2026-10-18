# Testing

```bash
npm test             # Vitest: unit + integration (no network) — 111 tests in 8 files
npm run test:e2e     # Playwright against the local dev server — 24 tests (desktop + mobile projects)
npm run test:visual  # screenshot regression vs. committed baselines (frozen clock) — 5 tests
npm run budget       # performance budget (after npm run build)
BASE_URL=https://<deployment> npm run test:e2e   # against production
```

## Unit (`tests/unit`)

| Area | File | Covered |
| --- | --- | --- |
| World simulator | `simWorld.test.ts` | every airline hub is a real airport and every fleet type is known; realistic worldwide fleet; physically consistent legs (no teleporting, altitudes within type limits, arrival at the destination); landing and take-off on the runway in use; legs chain from where the last one arrived; balanced hub arrivals/departures with a night lull; repeating timetable (same route, same number; odd outbound, even inbound); alliance-only codeshares; arrival sequencing (rare, short holds) and fog diversions; real stands and taxi routing on a supplied graph; jet streams (mid-latitude westerlies, tropical easterlies); ETAs that move with the wind; semicircular cruise levels; push-back with the nose fixed, hold short, line up; go-arounds and a circuit in gusty weather; cargo operators mostly at night; bad-weather cancellations that stay on the stand; runway exits at real taxiways; deterministic seeds |
| Overlays & sky | `overlays.test.ts` | runway in use (approaches outrank wind, headwind choice, no guess in calm/variable wind); sub-solar point at the solstice and its hourly drift; nested twilight bands on the dark side only; Moon full/new on known dates and its declination range; FAA airspace validation (malformed features dropped, non-collections rejected); airline from callsign and OpenFlights rows |
| Domain | `domain.test.ts` | symbol classification (type code, emitter-category fallback, generic, military flag); search query kinds; registry country from ICAO address blocks; airport search ranking and detail shards; statistics that never invent values; METAR/TAF normalization, variable wind, present-weather decoding |
| Airport geometry | `features.test.ts` | runway ends, approach detection (3° final found; climbing/off-axis/receding/high rejected), observed movements, great-circle interpolation, curved motion ending exactly on the newest position, reset |
| Client | `client.test.ts` | every filter with unknown-value handling and combinations; "Not available" formatting and units; traffic engine interpolation without overshoot, trail breaking, lifecycle and clock-skew immunity |
| Geodesy & units | `geo-units.test.ts` | coordinate validation and parsing, antimeridian handling, distance, bearing, destination, angle interpolation; altitude, speed, distance, vertical-rate and temperature conversions |

## Integration (`tests/integration`)

- **UpstreamGate** (the real Durable Object class with a mocked upstream): exposes no aircraft RPC
  methods and never contacts an aircraft source; METAR fetch, normalization and cache hits; bbox
  METAR and TAF URLs from fixed templates; coalescing; pacing; refusal beyond the wait budget; 429
  back-off with circuit breaker; 403 cool-down without retrying; last good report flagged
  `degraded`, but never one that is too old; malformed data; weather 204 as empty.
- **Routes** (the Hono app with a stubbed coordinator): health (weather provider only, graceful
  degradation); config and providers carry no live-aircraft settings or sources; retired aircraft
  routes return 404 without reaching the coordinator; error mapping with `Retry-After`; weather
  station/bbox validation; **manifest** (valid pins become shortcuts, invalid pins are dropped and
  never echoed, duplicates removed, capped at four); 405 on non-GET, unknown routes, no open proxy;
  per-client rate limiting; airport identifier validation and 404s.

Synthetic fixtures are used only in unit and integration tests.

## End-to-end (`e2e`)

`app.spec.ts` (desktop project):

- the simulated world loads with the map canvas, "Simulated" in the header and status bar,
  attribution, and no page errors;
- API: health, providers (with `simulation`, without live sources), the pinned-airport manifest,
  and 404 for the retired aircraft endpoints;
- clock controls change the simulation speed;
- search finds a flight, an airline and an airport;
- airports show arrivals/departures boards, the departure queue, runway in use, the movement chart
  and sun & moon times;
- an aircraft opens a full flight card with route, times and the 3D view;
- the airline page lists its fleet and flights;
- map controls: zoom, globe, theme switch, filters, settings;
- pins airports to the map, reorders and unpins them;
- widgets show busiest airports and notable flights;
- keyboard cycling selects aircraft and announces them; vertical profile and range rings toggle;
- analytics labels its sample as simulated;
- no horizontal overflow at 1280, 1440 and 1920 px.

`mobile.spec.ts` (desktop and mobile projects): the purpose-built mobile layout at 360, 390 and
768 px (no overflow, bottom navigation, More and Layers sheets, touch targets ≥ 36 px) and the
mobile search overlay.

## Visual regression (`e2e/visual.spec.ts`)

Five screenshots (Obsidian radar, Arctic radar, aircraft panel, analytics panel, mobile radar). The
simulation is seeded from the date and driven by `Date.now()`, so each test freezes the clock with
`page.clock.setFixedTime` and blocks weather and radar requests: every run builds the same world in
the same state. The live clock and status areas are masked. The suite runs only with `VISUAL=1`
(`npm run test:visual`). Baselines live in `e2e/__screenshots__/<platform>/`; they are
platform-specific (fonts and GPU rasterization differ), so CI does not run them. Refresh with
`npm run test:visual -- --update-snapshots` after intended UI changes.

## Performance budget (`scripts/check-budget.mjs`, runs in CI)

| Budget | Limit | Current (approximate) |
| --- | --- | --- |
| Initial JS (gzip) | 600 KB | ~532 KB (MapLibre ~280 KB) |
| Initial CSS (gzip) | 32 KB | ~22 KB |
| Largest lazy chunk | 40 KB | ~29 KB (time-zone lookup) |
| Major airport index | 260 KB | ~212 KB |
