# Data sources and how they are respected

| Source | Terms (as verified October 2026) | How this project complies |
| --- | --- | --- |
| **adsb.fi open data** (`opendata.adsb.fi/api`) | Personal, non-commercial use. 1 request/second on public endpoints. Max query radius 250 NM. Attribution with a link. No resale. Repeated 4xx/429 responses can trigger IP restrictions. | Non-commercial personal project with no ads or paywall. One global Durable Object spaces calls **≥ 1.1 s** apart and refuses rather than queueing beyond 4 s. Regional snapshots are shared by all visitors for 10 s, identical requests are coalesced, and inputs are validated server-side so we never send malformed (4xx) requests. A circuit breaker honours `Retry-After`. The radius is clamped to 250 NM. The feeder-only global `/v2/snapshot` endpoint is never used. Credited in the status bar and Data panel. |
| **AviationWeather.gov** | 100 requests/minute, custom User-Agent recommended, no browser CORS, not for operational planning. | Server-side only, paced ≥ 1.5 s (≤ 40/min) globally. METAR cached 5–10 min, TAF 15 min. Bounding boxes limited and snapped to whole degrees. Disclaimer shown with weather. |
| **OurAirports** | Public Domain. | Downloaded **at build time** into static files (no runtime load on OurAirports). Credited. |
| **OpenFreeMap** | Free public instance, no keys or limits. Attribution "OpenFreeMap © OpenMapTiles Data from OpenStreetMap". | Attribution always visible in the status bar. |
| **AWS Terrain Tiles** | Open data, attribution to the listed elevation sources. | Used only by Terrain Explorer and 3D terrain; attribution shown while active. |
| **EOxCloudless 2025** | CC BY-NC-SA 4.0 for non-commercial use, with attribution. | Used only by the Satellite style, labelled as an annual cloud-free mosaic (not live), with the full EOX attribution while active. |

## Why the map is not "worldwide live"

adsb.fi's public API allows regional queries (≤ 250 NM), not global snapshots, and asks for at most
one request per second. Covering the planet would take hundreds of cells polled continuously, which
is exactly the kind of abuse its terms rule out. So:

- the map shows live aircraft for **one region around your view** (outlined as "Live coverage area");
- zooming out past 250 NM shows the outline and says so ("live area clipped to 250 NM");
- every statistic states its sample.

Coverage also depends on volunteer receivers. Some regions (Mumbai, as of this writing) have little
or none. The app then says "No aircraft reported in this area right now" instead of filling the gap.

## Normalization

`shared/normalize.ts` converts adsb.fi's ADSBexchange-v2-compatible JSON:

| adsb.fi | Normalized | Notes |
| --- | --- | --- |
| `hex` | `id`, `icao24` | lower-case; `~` prefix kept for non-ICAO addresses |
| `flight` | `callsign` | trimmed; must match `[A-Z0-9-]{1,8}` |
| `r`, `t`, `desc` | `registration`, `aircraftType`, `typeDescription` | from the provider's aircraft database |
| `alt_baro` | `altitudeBarometric` / `onGround` | `"ground"` → `onGround: true`, altitude omitted |
| `alt_geom`, `gs`, `track` | `altitudeGeometric`, `groundSpeed`, `track` | range-checked |
| `baro_rate` ‖ `geom_rate` | `verticalRate` | barometric preferred |
| `seen_pos`, `seen` | `observedAt`, `seenAt` | `now − seconds × 1000`; no timestamp → record dropped |
| `type` | `positionSource` | `adsb_icao` → adsb, `mlat` → mlat, … |
| `dbFlags & 1` | `military: true` | omitted when not flagged (unknown ≠ false) |
| `emergency` | `emergency` | omitted when `"none"` |

## Registry country

The ICAO 24-bit address block identifies the state that assigned the address (`shared/icaoCountry.ts`).
Only well-established blocks are listed. Unknown blocks return nothing instead of a guess.
