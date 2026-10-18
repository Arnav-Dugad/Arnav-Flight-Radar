<p align="center">
  <img src="brand/png/lockup-dark-2x.png" alt="Arnav Flight Radar" width="460">
</p>

<p align="center">
  <b>A premium flight radar for a living, simulated world of air traffic.</b><br>
  230+ real airlines · real airports, runways, stands and taxiways · real weather · every flight simulated.
</p>

---

Arnav Flight Radar is a full-stack flight tracker that runs its own **world simulation**:

- **Fleet:** about 15,000 aircraft from more than 230 real airlines (core and extended lists), flying real aircraft types between real airports.
- **Ground:** at the busiest hubs, aircraft park on real stands and taxi along real OpenStreetMap taxiways.
- **Weather:** real METAR weather chooses the runway in use and sets how much traffic each airport can take.

The interface is modelled on the best commercial trackers, with flight cards, airport boards,
airline pages, widgets and a 3D view, on an original Apple-style glass design.

> **Simulated, and labelled as such.** Flights, flight numbers, registrations, schedules and positions
> are invented. The site says "Simulated" in the header, on every flight card and on every board, and
> explains what is real and what is not in **About & data**. Don't use it to track a real flight.

## What's simulated

**Gate to gate**
- **Push-back** off the stand with the nose still pointing in.
- **Taxi out** along the airport's real taxiway network to the holding point, where flights **queue for their runway slot**, then line up and take off.
- **Climb** at an odd flight level eastbound and an even one westbound (the semicircular rule).
- **Cruise** through jet-stream winds aloft, with headwinds and tailwinds that move the **estimated arrival time** in flight.
- **Arrival:** descent, then radar vectors onto a 12 NM final over downwind and base legs.
- **Holding** in racetrack patterns when the destination is saturated, with **ground delays** at the origin for long waits.
- **Bad weather** (fog, strong gusts) brings **go-arounds**, **diversions** to an alternate and **cancellations**.
- **Landing:** turn off at a **real runway exit**, taxi in to a free **stand**, then turnaround (deboarding, cleaning, catering, fuelling, boarding) before the next flight.

**Timetable and fleet**
- **Flight numbers** repeat daily and stay stable per route, odd outbound from the hub and even inbound.
- **Codeshares** come only from the operating airline's real alliance.
- **Cargo airlines** fly night banks; most passenger flying pauses overnight and restarts in a morning wave.
- **Wide-bodies** serve large airports only. Helicopters and light aircraft fly local hops.

## Features

**Map**
- WebGL map with six original styles, a globe, and 3D terrain.
- Aircraft icons at every zoom, coloured by altitude, speed or climb rate, or in classic yellow.
- Labels can show the flight number, callsign, registration, type, route or altitude.
- Overlays:
  - day and night with twilight, the Moon and its phase;
  - precipitation radar (RainViewer) and METAR stations;
  - controlled and special-use airspace (FAA, openAIP), in 3D when tilted, with click-for-details;
  - lightning climatology (NASA);
  - an airport disruption map.
- At large airports you see stands (free or occupied), ground-service vehicles and the departure queue on the map.

**Flights**
- A flight card with:
  - a representative photo (the airline's livery on that type when available, always labelled);
  - logo, flight number, alliance and codeshares;
  - the route with a progress bar;
  - scheduled, actual and estimated times in local time and UTC, with stands;
  - flight data, a graph and a turnaround timeline.
- Follow, a 3D chase view behind the aircraft, a route line (flown and planned), a 3D flight path with an altitude profile, sharing and comparing.

**Airports**
- Arrivals and departures boards (delays, holding, diversions, cancellations, codeshares, stands).
- An "On the ground" list and the departure queue.
- The runway in use and an hourly movement chart.
- Sunrise, sunset, moonrise and moonset; METAR and TAF; runway diagrams and an approach explorer.
- Pin up to four airports to the map as mini-boards. Installed apps get home-screen shortcuts for them.

**Discover**
- **Right now** widgets: busiest airports, a disruption index, and the longest, fastest and highest flights.
- Airline pages (fleet, hubs, flights).
- Search for flights, airlines, airports, cities and coordinates.
- Analytics, Timeline playback, Compare, Spotter and Presentation mode.
- **Follow a random flight** (`J`), and clock speeds 1×, 5×, 15× and 30× (`1`–`4`).

**Platform**
- Apple-style glass UI with light and dark styles, high-contrast and reduced-motion modes.
- A purpose-built mobile layout and an installable PWA.
- Keyboard shortcuts (`?`) and screen-reader announcements.

## Quick start

```bash
git clone https://github.com/Arnav-Dugad/Arnav-Flight-Radar.git
cd Arnav-Flight-Radar
npm install
npm run data:airports   # downloads OurAirports + OpenFlights and builds the static datasets
npm run dev             # Vite + the Worker locally (Cloudflare Vite plugin)
```

Open <http://localhost:5173>. No API keys or secrets are needed.

| Command | What it does |
| --- | --- |
| `npm run dev` | Front end and API with hot reload |
| `npm run build` | Builds missing datasets, then the client and Worker bundles |
| `npm run typecheck` / `npm run lint` | Strict TypeScript / ESLint |
| `npm test` | Unit and integration tests (Vitest), including the world simulator |
| `npm run test:e2e` | Playwright end-to-end tests (`BASE_URL=…` targets a deployment) |
| `npm run test:visual` | Screenshot regression tests with a frozen clock (`-- --update-snapshots` to refresh) |
| `npm run budget` | Fails if the first-visit download exceeds the performance budget |
| `npm run data:media` | Rebuild airline logos and representative photos (Wikidata / Commons) |
| `npm run data:ground` | Fetch more stands and taxiways from OpenStreetMap (polite, resumable) |
| `npm run data:airspace` | Rebuild Canada & Europe airspace from openAIP |
| `npm run deploy` | Build and `wrangler deploy` |

## Architecture at a glance

```
Browser
 ├─ World simulator (src/data/sim, lazy-loaded): airframes, legs, slots, stands, winds
 ├─ Traffic engine + MapLibre GPU layers (15,000 aircraft, culled per viewport)
 └─ Static data: airports, runways, airlines, logos, stands/taxiways, airspace
Cloudflare edge
 ├─ static assets (free, not Worker requests)
 └─ /api/*  Worker (Hono): weather (METAR/TAF), airports, health, providers, manifest
              └─ UpstreamGate Durable Object: paces, coalesces and caches AviationWeather.gov
```

Read more:
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): the simulator, the rendering engine and the honesty rules
- [docs/API.md](docs/API.md): endpoints
- [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md): every source, its licence and how it is respected
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): Cloudflare setup
- [docs/TESTING.md](docs/TESTING.md): the test strategy

## Data & licences

The code is MIT-licensed. Data belongs to its providers; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md):
- OurAirports (public domain), OpenFlights (ODbL), OpenStreetMap (ODbL);
- NOAA AviationWeather.gov, FAA airspace, NASA GIBS;
- openAIP (CC BY-NC 4.0), RainViewer, Wikidata (CC0) and Wikimedia Commons (per-file licences, credited in the app).

Airline logos are trademarks of their owners and are shown only to identify the operator. This is an
informational simulation and must not be used for navigation.
