# API

Every aircraft on the map is **simulated in the browser** (real airlines, aircraft types and
airports; invented flights). The API serves no aircraft data and never contacts a live aircraft
source. It covers airports, weather, the web-app manifest and service metadata.

All endpoints are `GET` and same-origin only (no CORS headers). They return JSON, except the
manifest (`application/manifest+json`). Errors always use this shape:

```json
{ "error": { "code": "invalid_query", "message": "…", "retryAfterSec": 3 } }
```

`retryAfterSec` and the `Retry-After` header appear when waiting will help. Status codes: 400
(validation), 404 (including any unknown route, such as the retired `/api/aircraft/*` and
`/api/analytics/*`), 405 (not GET), 429 (per-client limit), 502 (malformed upstream), 503 (busy,
rate-limited upstream or circuit open).

## Units

| Field | Unit |
| --- | --- |
| `windSpeedKt`, `windGustKt` | knots |
| `windDirDeg` | degrees true (0–360) |
| `tempC`, `dewpointC` | degrees Celsius |
| `altimeterHpa` | hectopascals |
| `baseFt` (cloud layers) | feet |
| `lat`, `lon` | WGS-84 decimal degrees |
| `*At` | Unix epoch **milliseconds**, UTC |

A field the provider did not report is **omitted**. It is never zero-filled.

## Endpoints

### `GET /api/airports/search?q=[&country=GB][&limit=12]`
Ranked search over IATA, ICAO, name and city in the bundled OurAirports index.

### `GET /api/airports/:ident`
Details for one airport, including runways (threshold coordinates, headings, length, surface,
lighting) and frequencies.

### `GET /api/weather/metar?ids=EGLL,KJFK` or `?bbox=south,west,north,east`
Up to 10 stations, or a bounding box of at most 12° × 16° (snapped outward to whole degrees).
Normalized METARs: wind (with `windVariable`), visibility (statute miles, as reported), clouds
(base in ft), temperature and dew point (°C), altimeter (hPa) and flight category. Cached 5 min
(stations) or 10 min (bbox).

### `GET /api/weather/taf?ids=EGLL`
Normalized TAF with change periods. Cached 15 minutes.

Weather responses share one envelope:

```jsonc
{
  "provider": "aviationweather",
  "attribution": { "name": "NOAA Aviation Weather Center", "url": "https://aviationweather.gov", "license": "…" },
  "fetchedAt": 1792269256815,     // our server fetched upstream
  "servedAt": 1792269256815,      // this response
  "degraded": "…",                // present only when serving an older report while the provider fails
  "cache": { "hit": true, "ageMs": 3200, "ttlMs": 300000 },
  "count": 2,
  "data": [Metar | Taf]
}
```

All AviationWeather.gov calls go through one global coordinator (a Durable Object) that paces
them, coalesces identical requests, caches responses and backs off on errors. While the provider
is failing, a report up to 5 minutes past its cache TTL may be served with `degraded` set.

### `GET /api/manifest.webmanifest?pins=EGLL,KJFK`
The web-app manifest (same fields as `/manifest.webmanifest`) plus a `shortcuts` array with one
entry per pinned airport:

```jsonc
{ "name": "EGLL board", "short_name": "EGLL", "url": "/?apt=EGLL",
  "icons": [{ "src": "/brand/icon-192.png", "sizes": "192x192", "type": "image/png" }] }
```

`pins` is split on commas and upper-cased; each identifier must be a valid airport ident
(2–10 of `A–Z`, `0–9`, `-`). Invalid entries are silently dropped (never echoed), duplicates are
removed and at most 4 shortcuts are returned. The response is built from constants only; nothing
is fetched. `Content-Type: application/manifest+json`, `Cache-Control: public, max-age=3600`.

### `GET /api/health`
Coordinator status and weather-provider health (`ok`, `degraded`, `down` or `unknown`), upstream
call and cache-hit counters, last error. `status` is `degraded` (with `coordinator: null`) when the
coordinator cannot be reached.

### `GET /api/providers`
Every data source with its scope, limits, terms and required attribution, including the
`simulation` entry that describes the simulated air traffic.

### `GET /api/config`
App version, unit conventions and source link. `aircraft.source` is always `"simulation"`.
