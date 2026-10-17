<p align="center">
  <img src="brand/png/lockup-dark-2x.png" alt="Arnav Flight Radar" width="460">
</p>

<p align="center">
  <b>A free, premium, honest live flight radar.</b><br>
  Real ADS-B positions · original cartography · zero fake data · runs entirely on Cloudflare's free tier.
</p>

---

Arnav Flight Radar is a full-stack aircraft tracker: a React + MapLibre GL front end and a Cloudflare
Worker API with a single Durable Object that coordinates every upstream request worldwide. It is
built around three rules:

1. **Only real, permitted data.** Live positions come from [adsb.fi open data](https://adsb.fi), weather
   from NOAA's [AviationWeather.gov](https://aviationweather.gov), airports from
   [OurAirports](https://ourairports.com/data/). Nothing is simulated to fill gaps.
2. **Say what you know.** Every value carries its freshness (live, stale or lost). Missing fields read
   "Not available". Regional statistics are labelled as regional samples. Origins, destinations and
   schedules are never invented.
3. **Respect the sources.** All visitors share regional snapshots. A global coordinator spaces
   adsb.fi calls at least 1.1 s apart, below its 1 request/second limit, and backs off on errors.

## Current status (October 2026)

> **Live aircraft data on the hosted site is waiting on provider approval.**
> adsb.fi's firewall currently refuses requests from Cloudflare's network (HTTP 403 "Attention Required").
> airplanes.live and adsb.lol also refuse Cloudflare egress, and both ask projects to contact them first.
> This project does not route around those blocks. Until a provider allow-lists the site:
> - the deployed site serves maps, airports, METAR/TAF, search and every tool, and states clearly that
>   live aircraft are unavailable (nothing is simulated);
> - **`npm run dev` shows full live traffic**, because requests then come from your own connection.
>
> Once adsb.fi (or another permitted source) approves access, the hosted site works with no code changes.

## Features

**Radar**
- Full-screen WebGL map with six original styles: Obsidian Radar, Arctic Glass, Midnight Ocean,
  Terrain Explorer (hillshade and 3D terrain), Minimal Aviation and Satellite (EOxCloudless).
- Globe and flat projections with an atmosphere, and ambient rotation on the globe.
- Original top-down aircraft silhouettes (widebody, narrowbody, regional, turboprop, business jet,
  helicopter, light aircraft, glider, military, balloon, drone, ground vehicle, unknown).
  - They are rendered as GPU signed-distance fields, rotated to track and coloured by altitude,
    speed, vertical rate or data age, with a colour-blind-safe palette option.
  - Classification uses only the reported ICAO type code or the ADS-B emitter category.
- Smooth motion that interpolates between real reports and never extrapolates past the newest one.
  A hollow ring marks the latest reported position.

**Tracking**
- Aircraft panel with animated instruments (altitude tape, speed arc, heading compass, VSI),
  identification, position, technical ADS-B fields and the observed trail.
- Follow mode (north-up or heading-up, with adjustable zoom and tilt). Manual pans pause it, and
  "Return to aircraft" resumes.
- Altitude, speed, vertical-rate or time-coloured trails built only from observed positions. Data
  gaps are never bridged.
- Lost-tracking and stale-data banners. A selected aircraft that leaves the live area keeps updating
  through single-aircraft lookups.

**Exploration**
- Spotlight-style search (Ctrl/⌘ + K) across live aircraft, 20,000+ airports, cities, countries and
  coordinates, plus a worldwide lookup by callsign, registration, ICAO hex or squawk.
- Airport explorer:
  - runways (with map overlay and diagram), radio frequencies, local and UTC clocks
  - decoded METAR and TAF
  - nearby observed traffic (never presented as a schedule) and nearby airports
- METAR weather layer showing station flight categories and reported winds.

**Experience modes**
- **Analytics:** histograms, splits and bar lists, each labelled with its sample.
- **Spotter:** where to look in the sky, as azimuth and elevation.
- **Timeline:** replays this session's recorded snapshots, with JSON export.
- **Compare:** two aircraft side by side.
- **Data inspector:** normalized and raw records.
- **Presentation:** cinematic orbit.
- **Hub tour**, **Measure** (distance and bearing), **Learn** (telemetry glossary) and **Data & coverage**
  (provider health, licences, completeness).

**Platform**
- Purpose-built mobile layout (bottom navigation, draggable sheets).
- Keyboard shortcuts (`?`), a reduced-motion setting and a reduced-glass-effects mode.
- Shareable URLs, saved viewpoints, favourites and filter presets, all stored locally with no accounts.

## Quick start

```bash
git clone https://github.com/Arnav-Dugad/Arnav-Flight-Radar.git
cd Arnav-Flight-Radar
npm install
npm run data:airports   # downloads OurAirports and builds the static airport dataset
npm run dev             # Vite + the real Worker + Durable Object locally (workerd)
```

Open <http://localhost:5173>. No API keys or secrets are needed.

| Command | What it does |
| --- | --- |
| `npm run dev` | Front end and API with hot reload (Cloudflare Vite plugin) |
| `npm run build` | Builds the airport data if missing, then the client and Worker bundles |
| `npm run typecheck` | Strict TypeScript across the app, Worker, shared code and tests |
| `npm run lint` | ESLint |
| `npm test` | Unit and integration tests (Vitest) |
| `npm run test:e2e` | Playwright end-to-end tests (`BASE_URL=… ` to target a deployment) |
| `npm run deploy` | Build and `wrangler deploy` |
| `npm run brand` | Regenerate the logo assets in `/brand` |

## Architecture at a glance

```
Browser ──► Cloudflare edge
             ├─ static assets (React app, airport dataset)   ← free, not Worker requests
             └─ /api/*  Worker (Hono): validation, errors, per-client limiter
                          └─ UpstreamGate Durable Object  (exactly one, worldwide)
                               ├─ pacing  adsb.fi ≥ 1.1 s · AWC ≥ 1.5 s
                               ├─ coalescing + shared regional snapshots (10 s)
                               ├─ circuit breaker / Retry-After / stale fallback
                               └─► adsb.fi · aviationweather.gov
```

Read more:
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): data flow, rendering engine, honesty rules
- [docs/API.md](docs/API.md): endpoints and normalized schemas
- [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md): providers, limits and how they are respected
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): Cloudflare setup and free-tier budget
- [docs/TESTING.md](docs/TESTING.md): the test strategy

## Data & licences

The code is MIT-licensed. Data belongs to its providers; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). adsb.fi data is for **personal, non-commercial use
only**, which is how this project uses it. This is an informational tool and must not be used for
navigation.
