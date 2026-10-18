# Testing

```bash
npm test             # Vitest: unit + integration (no network) — 106 tests
npm run test:e2e     # Playwright against the local dev server — 22 tests
npm run test:visual  # screenshot regression vs. committed baselines (mocked feed)
npm run budget       # performance budget (after npm run build)
BASE_URL=https://<deployment> npm run test:e2e   # against production
```

## Unit (`tests/unit`)

| Area | Covered |
| --- | --- |
| Geodesy | coordinate validation, antimeridian handling, distance, bearing, destination, angle interpolation, coordinate parsing |
| Units | altitude, speed, distance, vertical rate and temperature conversions |
| Normalization | full field mapping, ground handling, missing values never invented, implausible values dropped, military flag, stale flag, TIS-B ids, envelope variants, de-duplication, empty areas |
| Classification | type-code table, emitter-category fallback, generic symbol, military flag |
| Regions | radius buckets, shared snapping, a 2,000-case property test that the snapped circle always covers the requested one, invalid input |
| Search | aircraft query kinds, airport ranking (codes, names, cities, importance), detail shards |
| Statistics | population summaries, unknown vertical rates, emergencies, empty samples |
| Weather | METAR/TAF normalization, variable wind, present-weather decoding |
| Filters | every filter, unknown-value handling, combinations |
| Traffic engine | interpolation never overshooting the latest report, curved motion following a turn and ending exactly on the report, reset, gap-breaking trails, lost-aircraft lifecycle, clock-skew immunity |
| Airport intelligence | runway ends, approach detection (3° final found; climbing/off-axis/receding/high/ground rejected), observed arrivals/departures |
| Great-circle routes | start/end/midpoint correctness |
| Demo world | every airline hub is a real airport and every fleet type is known; worldwide density (5k–16k airborne); physically consistent legs (no teleporting, altitudes within type limits, arrival at the destination); landing and take-off on the runway in use; legs chain; balanced hub arrivals/departures with a night lull; deterministic seeds |
| Runway in use | approaches outrank wind; headwind choice; no guess in calm/variable wind |
| Day/night | sub-solar point at the solstice and its hourly drift; nested twilight bands; lit/dark sides |
| Airlines & privacy | callsign-prefix extraction; OpenFlights rows; LADD/PIA flags from `dbFlags` |

## Integration (`tests/integration`)

- **UpstreamGate** (the real Durable Object class with a mocked upstream): cache hits, coalescing,
  ≥ 1.1 s pacing, refusal beyond the wait budget, 429 back-off with circuit breaker, last-good
  snapshot on provider failure, malformed data, empty regions, weather 204, raw-record opt-in.
- **Routes** (the Hono app with a stubbed coordinator): validation, region snapping, error mapping
  with `Retry-After`, identifier checks, weather station/bbox bounds, 405 on non-GET, no open proxy,
  per-client rate limiting, airport 404s.

## End-to-end (`e2e`)

Runs at 360, 390, 768, 1280, 1440 and 1920 px:

- the app loads with the map canvas and attribution, and there are no page errors;
- API health and config respond, and invalid input returns 400;
- a live query returns normalized aircraft (tolerates a provider outage);
- search → airport panel → runways → weather;
- deep-linked live aircraft → telemetry → Position tab → follow mode;
- zoom, globe toggle, style switch (URL updated), filters (badge count) and unit settings;
- analytics states its sample;
- mobile: bottom navigation, More sheet, Layers sheet, touch-target size, search overlay;
- no horizontal overflow at any width.

Synthetic fixtures are used only in unit and integration tests and are never shown as live data.

## Visual regression (`e2e/visual.spec.ts`)

Five screenshots (Obsidian radar, Arctic radar, aircraft panel, analytics panel, mobile) against a mocked,
clearly synthetic aircraft feed. Baselines live in `e2e/__screenshots__/<platform>/`; they are
platform-specific (fonts and GPU rasterization differ), so CI does not run them. Refresh with
`npm run test:visual -- --update-snapshots` after intended UI changes.

## Performance budget (`scripts/check-budget.mjs`, runs in CI)

| Budget | Limit | Current |
| --- | --- | --- |
| Initial JS (gzip) | 600 KB | ~514 KB (MapLibre ~280 KB) |
| Initial CSS (gzip) | 32 KB | ~21 KB |
| Largest lazy chunk | 40 KB | ~29 KB (time-zone lookup) |
| Major airport index | 260 KB | ~212 KB |
