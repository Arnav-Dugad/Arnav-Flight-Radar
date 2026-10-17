# API

All endpoints are `GET`, return JSON, and are same-origin only (no CORS headers). Errors always use
this shape:

```json
{ "error": { "code": "invalid_region", "message": "…", "retryAfterSec": 3 } }
```

`retryAfterSec` and the `Retry-After` header appear when waiting will help. Status codes: 400
(validation), 404, 405 (not GET), 429 (per-client limit), 502 (malformed upstream), 503 (busy,
rate-limited upstream or circuit open).

## Units

| Field | Unit |
| --- | --- |
| `altitudeBarometric`, `altitudeGeometric`, `navAltitude*` | feet |
| `groundSpeed`, `ias`, `tas`, `windSpeed` | knots |
| `verticalRate` | feet per minute |
| `track`, `trueHeading`, `navHeading`, `windDirection` | degrees true (0–360) |
| `magHeading` | degrees magnetic |
| `lat`, `lon` | WGS-84 decimal degrees |
| `*At`, `providerNow` | Unix epoch **milliseconds**, UTC |
| `distanceNm`, `radiusNm` | nautical miles |

A field the provider did not report is **omitted**. It is never zero-filled.

## Endpoints

### `GET /api/aircraft/nearby?lat=&lon=&radius=`
Live aircraft in a region. `radius` is in NM (default 100). The server snaps the region to a shared
grid and returns the region it actually queried in `query`.

```jsonc
{
  "provider": "adsbfi",
  "attribution": { "name": "adsb.fi", "url": "https://adsb.fi", "license": "…" },
  "query": { "lat": 51.3333, "lon": -0.5335, "radiusNm": 100 },
  "providerNow": 1792269256001,   // provider clock
  "fetchedAt": 1792269256815,     // our server fetched upstream
  "servedAt": 1792269256815,      // this response
  "stale": false,                 // snapshot older than its TTL
  "degraded": "…",                // present only when serving an older snapshot
  "cache": { "hit": true, "ageMs": 3200, "ttlMs": 10000 },
  "count": 121,
  "aircraft": [Aircraft]
}
```

**Aircraft**

```jsonc
{
  "id": "4066b9", "icao24": "4066b9",          // '~' prefix = non-ICAO (TIS-B) address
  "callsign": "EXS92BY", "registration": "G-GDFF",
  "aircraftType": "B738", "typeDescription": "BOEING 737-800", "category": "A3",
  "lat": 51.29, "lon": -0.44,
  "altitudeBarometric": 19000, "altitudeGeometric": 19650,
  "groundSpeed": 361, "track": 22.1, "verticalRate": 0,
  "squawk": "4512", "emergency": "general",     // emergency only when not "none"
  "onGround": false, "military": true,          // military only when flagged in the provider DB
  "positionSource": "adsb",                     // adsb | mlat | tisb | adsr | adsc | modes | other
  "observedAt": 0, "seenAt": 0, "receivedAt": 0,
  "provider": "adsbfi", "freshness": "live",    // live: position ≤ 30 s old at fetch
  "distanceNm": 12.4,
  "ext": { "ias": 278, "tas": 300, "mach": 0.72, "roll": -1.2, "magHeading": 20, "trueHeading": 21,
           "navAltitudeMcp": 20000, "navHeading": 20, "navQnh": 1013.2, "windDirection": 250,
           "windSpeed": 32, "outsideAirTemp": -21, "nic": 8, "nacP": 9, "sil": 3, "rssi": -9.6,
           "messages": 103996, "adsbVersion": 2, "ownerOperator": "…", "year": "2015" }
}
```

### `GET /api/aircraft/:icao[?raw=1]`
Looks up one aircraft by 24-bit ICAO hex, anywhere adsb.fi has it. `raw=1` adds the provider's raw
records (used by the Data Inspector). Same envelope, plus `providerNow`.

### `GET /api/aircraft/search?q=[&type=callsign|registration|hex|sqk]`
Worldwide lookup. The kind is inferred (`4066b9` → hex, `G-ABCD` → registration, `7700` → squawk,
`BAW123` → callsign) unless `type` forces it. The response includes
`"interpretedAs": { "kind", "value" }`.

### `GET /api/analytics/region?lat=&lon=&radius=`
Statistics computed from the same shared snapshot (no extra upstream call). Includes a `population`
sentence that states exactly what was sampled.

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

### `GET /api/health`
Coordinator status and per-provider health (`ok`, `degraded`, `down` or `unknown`), upstream call
and cache-hit counters, last error.

### `GET /api/providers`
Every data source with its scope, limits, terms and required attribution, including sources that are
deliberately disabled.

### `GET /api/config`
Polling bounds, freshness thresholds and unit conventions for clients.
