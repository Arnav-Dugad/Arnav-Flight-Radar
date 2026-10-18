<p align="center">
  <img src="brand/png/lockup-dark-2x.png" alt="Arnav Flight Radar" width="460">
</p>

<p align="center">
  <b>A premium flight radar for a living, simulated world of air traffic.</b><br>
  230+ real airlines · ~100 aircraft types · real airports, terminals, taxiways and navaids · real weather · every flight simulated.
</p>

---

Arnav Flight Radar is a full-stack flight tracker that runs its own **world simulation**:

- **Fleet:** about 15,000 aircraft from more than 230 real airlines (core and extended lists), flying real aircraft types between real airports.
- **Ground:** at about 220 airports, aircraft park on real stands at the right terminal and taxi along real, named OpenStreetMap taxiways.
- **Weather:** real METAR and TAF weather choose the runway in use and set how much traffic each airport can take, now and in the hours ahead.

The interface is modelled on the best commercial trackers, with flight cards, airport boards,
airline pages, widgets and a 3D view, on an original Apple-style glass design.

> **Simulated, and labelled as such.** Flights, flight numbers, registrations, schedules and positions
> are invented. The site says "Simulated" in the header, on every flight card and on every board, and
> explains what is real and what is not in **About & data**. Don't use it to track a real flight.

## What's simulated

**Gate to gate**
- **Clearance and push-back:** the flight is cleared via a departure procedure, then pushes back off a
  real stand at the terminal its airline really uses (Terminal 5 for British Airways at Heathrow).
- **Taxi** on real, named OpenStreetMap taxiways ("via A, B3 to holding point A1"). Aircraft hold
  short of and cross other runways, and de-ice when the real METAR reports freezing precipitation.
- **Departure queue:** take-offs keep ICAO wake-turbulence spacing (a medium behind a heavy waits two
  minutes). Long queues become gate holds.
- **Departure route:** out over a real VOR or NDB on a procedure-style departure.
- **Climb and cruise:** 250 kt below FL100, then a semicircular flight level, with step climbs on long
  flights and winds aloft that move the arrival estimate.
- **North Atlantic:** transatlantic flights use the day's simulated track system (westbound by day,
  eastbound along the jet stream at night).
- **Arrival:** a procedure-style arrival over a real navaid, holding there when the airport is
  saturated, then radar vectors to an ILS, a CAT III ILS in low visibility, an RNP or a visual approach.
- **Landing and turnaround:** the aircraft leaves the runway at a real, named exit and taxis to its
  stand for the turnaround.

**Weather, disruption and rare events**
- **Live weather:** real METARs set the runway in use and the capacity, and real TAFs set the capacity
  for the hours ahead.
- **Bad weather** (fog, storms, gusts, snow) brings go-arounds, holding, diversions and cancellations.
- **Rare emergencies:** medical diversions (PAN PAN), engine failures and depressurisations (squawk
  7700) divert to the nearest suitable airport. A repaired aircraft positions empty back to base.

**Timetable and fleet**
- **Routes:** flight numbers stay stable per route. Thin and leisure routes run on fixed weekdays,
  shown on the card as e.g. "Mon Wed Fri".
- **Seasons:** IATA seasons apply, with Mediterranean summers, ski winters and winter sun.
- **Weekly and daily patterns:** traffic peaks on Friday and Sunday and dips on Saturday; there is a
  night lull with a morning wave, and cargo flies night banks.
- **Fleet:** about 100 aircraft types with real dimensions, weights and fuel burn. Each card shows a
  typical cabin, an estimated load sheet and the airframe's history.

**Beyond the airlines**
- **General aviation:** daylight flying, busier at weekends, with circuits and touch-and-goes.
- **Military:** transports, tankers, AWACS, maritime patrol and fighter training from real bases.
- **Helicopters and air ambulances:** HEMS helicopters fly from hospital pads to incident scenes, plus
  fixed-wing air ambulances, offshore helicopters to oil and gas platforms, and city shuttles.
- **Gliders:** they thermal up in circles in summer, with tow planes, as a FLARM receiver would show
  them.

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
  - an airport disruption map;
  - the simulated North Atlantic tracks.
- At large airports you see stands (free or occupied), ground-service vehicles and the departure queue on the map.

**Flights**
- A flight card with:
  - a representative photo (the airline's livery on that type when available, always labelled);
  - logo, flight number, alliance and codeshares;
  - the route with a progress bar;
  - scheduled, actual and estimated times in local time and UTC, with terminals and stands;
  - the flight plan: departure and arrival procedures, en-route navaids, the oceanic track, taxi
    clearances, approach type, wake category and days of operation;
  - a **simulated radio** transcript (real airport frequencies) you can listen to;
  - an estimated **load sheet** with a seat map, fuel plan and weights;
  - the airframe's recent **history**, flight data, a graph and a turnaround timeline.
- Follow, a 3D chase view behind the aircraft with a **true-scale 3D model**, a route line (flown and planned), a 3D flight path with an altitude profile, sharing and comparing.
- **Aircraft type pages:** specs, a typical cabin and every simulated example flying now.

**Airports**
- Arrivals and departures boards (delays, holding, diversions, cancellations, codeshares, stands).
- An "On the ground" list and the departure queue.
- The runway in use and an hourly movement chart.
- Sunrise, sunset, moonrise and moonset; METAR and TAF; runway diagrams and an approach explorer.
- **Delays:** seven days of punctuality and a 24-hour disruption forecast built from the real TAF.
- Terminal outlines, numbered stands and 3D buildings when you zoom in; links to public airport webcams.
- Pin up to four airports to the map as mini-boards. Installed apps get home-screen shortcuts for them.

**Discover**
- **Right now** widgets: busiest airports, a disruption index, and the longest, fastest and highest flights.
- Airline pages (fleet, hubs, flights).
- Search for flights, airlines, airports, cities and coordinates.
- Analytics, Timeline playback, Compare, Spotter and Presentation mode.
- **Follow a random flight** (`J`), and clock speeds 1×, 5×, 15× and 30× (`1`–`4`).

**Platform**
- Apple-style glass UI with light and dark styles, high-contrast and reduced-motion modes.
- A purpose-built mobile layout and an installable PWA, with touch gestures tuned for phones and tablets.
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
| `npm run data:ground` | Fetch stands, named taxiways, holding points and terminals from OpenStreetMap (polite, resumable) |
| `npm run data:sim` | Rebuild navaids, real airport frequencies, heliports and gliding sites (OurAirports) |
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
