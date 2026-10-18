# Data sources and how they are respected

Arnav Flight Radar uses **no live aircraft data**. Every flight is invented by the simulator in the
browser (see [ARCHITECTURE.md](ARCHITECTURE.md)). The sources below supply the real world that the
simulation runs in: airports, runways, airlines, ground layouts, weather, airspace and imagery.

| Source | Terms (as verified October 2026) | How this project complies |
| --- | --- | --- |
| **OurAirports** | Public Domain. | Downloaded **at build time** (`npm run data:airports`) into static files: airports, runways, frequencies. No runtime load on OurAirports. Credited. |
| **OpenFlights airlines** | ODbL 1.0: attribution, share-alike for derived databases. | Downloaded at build time; the derived `public/data/airlines.json` keeps the ODbL. Credited as "OpenFlights (ODbL)". |
| **AviationWeather.gov** (NOAA) | 100 requests/minute, custom User-Agent recommended, no browser CORS, not for operational planning. | Server-side only, through the `UpstreamGate` Durable Object: paced ≥ 1.5 s (≤ 40/min) globally, identical requests coalesced, METAR cached 5–10 min and TAF 15 min, bounding boxes limited and snapped to whole degrees, back-off on errors and a 15-minute cool-down on 401/403. The browser asks only for the busiest hubs and large airports in view, each at most every 20 minutes. Real METARs set the simulated runway in use, capacity, low-visibility procedures, diversions and cancellations. Disclaimer shown with weather. |
| **RainViewer** | Free for personal/educational use; attribution; 100 req/IP/min; max zoom 7 from 2026. | Browser-side only when the radar layer is on; one index request per 10 minutes plus the tiles in view; latest frame only (animation would exceed the limit). Attribution shown while active. |
| **FAA ADDS Class Airspace** | Public domain U.S. Government data; not for navigation. | Live ArcGIS viewport queries from the browser only while the layer is on, at zoom ≥ 6 and inside the US; responses reused per 1° grid cell; malformed features dropped; labelled not for navigation. |
| **openAIP** | CC BY-NC 4.0 (non-commercial, attribution). | Country exports for Canada and 30 European countries downloaded occasionally by `npm run data:airspace` into static files (no runtime requests to openAIP). Kept: CTR/TMA/CTA in classes A–E plus restricted, danger and prohibited areas; geometry rounded to about 10 m. Credited wherever the layer is shown; labelled not for navigation. |
| **OpenStreetMap (Overpass)** | ODbL; Overpass fair use (sequential queries, modest server time, identifying User-Agent). | `npm run data:ground` fetches the busiest simulated hubs one at a time with an identifying User-Agent, a 5 s pause between queries, a 30 s back-off on 429/504 and a 10-minute budget per run. Already-fetched airports are skipped, so the run is resumable and more airports can be added on later days. Stands and taxiway networks for 58 airports are in `public/data/ground` (as of this writing), offered under the ODbL and credited "© OpenStreetMap contributors". |
| **Wikidata / Wikimedia Commons** | CC0 (Wikidata); free licences or public domain per file (Commons). Wikimedia recommends copying files rather than hotlinking; standard thumbnail widths only. | `npm run data:media` runs occasionally (a few hundred paced API calls with an identifying User-Agent). Airline logos are downloaded at a standard 250 px width and served from this site (`public/media/logos`). Representative photos are hotlinked at the standard 960 px width. Licence and author are shown next to every image, and the Credits panel lists every file with a link to its page. Photos are labelled "Representative — not this simulated aircraft" and the caption names the real aircraft pictured. Logos are trademarks of their owners, used only to identify the operator. |
| **NASA GIBS (LIS lightning climatology)** | Open NASA imagery; acknowledgement requested. | Raster tiles requested by the browser only while the layer is on; labelled as a long-term climatology, never as live lightning. |
| **OpenFreeMap** | Free public instance, no keys or limits. Attribution "OpenFreeMap © OpenMapTiles Data from OpenStreetMap". | Attribution always visible in the status bar. |
| **AWS Terrain Tiles** | Open data, attribution to the listed elevation sources. | Used only by Terrain Explorer and 3D terrain; attribution shown while active. |
| **EOxCloudless 2025** | CC BY-NC-SA 4.0 for non-commercial use, with attribution. | Used only by the Satellite style, labelled as an annual cloud-free mosaic (not live), with the full EOX attribution while active. |

## What is simulated

The simulated world uses real reference data:
- OurAirports airports and runways, and OpenStreetMap stands and taxiways where available;
- airline names, hubs, alliances and representative fleets, curated in `src/data/sim/fleet.ts`,
  `fleet-more.ts` and `airlines.ts`;
- typical performance for each aircraft type;
- real METAR weather for runway choice and capacity.

Every flight, flight number, registration, schedule and position is invented. Simulated aircraft
carry provider `sim` and non-ICAO `~…` ids, so no real aircraft record, registry entry or
exact-airframe photo is ever attached to them. The interface says "Simulated" in the header, status
bar, flight cards, boards and analytics; a first-visit welcome and the **About & data** panel
explain what is real and what is invented.

## Sources deliberately not used

| Source | Why |
| --- | --- |
| Live aircraft feeds (adsb.fi, OpenSky Network, adsb.lol, airplanes.live) | The site is a simulation; no live positions are fetched, relayed or mixed in. |
| Flightradar24, FlightAware and other proprietary trackers | Never scraped. |
| Route databases (adsbdb and similar) | Not used. Simulated routes come from the airline profiles. |
| Scraped logo packs (e.g. repositories copied from FlightAware/Flightradar24) | Not used. Logos come only from Wikimedia Commons, with licences recorded. |
| Blitzortung.org (live lightning) | Not used. Its data may be used only with the project's approval. |
| Closed national airspace datasets (DFS, NAV CANADA, NATS, Eurocontrol EAD) | Not used: no open licence, or an account is required. |

## Registry country

The ICAO 24-bit address block identifies the state that assigns addresses (`shared/icaoCountry.ts`).
The simulator draws each invented address from the airline's country block, so the registry flag
matches the registration prefix. Only well-established blocks are listed; unknown blocks return
nothing instead of a guess.

## Simulator reference files

`npm run data:sim` (`scripts/build-simdata.mjs`) derives four compact files in `public/data/sim`
from the cached OurAirports CSVs (public domain; `navaids.csv` is downloaded once with an
identifying User-Agent and cached like the others). They are generated at build time, so nothing
is requested from OurAirports at runtime.

| File | Contents | Used for |
| --- | --- | --- |
| `navaids.json` | Every VOR, VOR-DME and VORTAC worldwide, plus NDBs within 60 NM of a large airport: ident, name, kind, position, frequency, country. | Procedure-style routes: departure exit fixes, arrival entry and holding fixes, en-route waypoints. These are real beacons, but the routes built on them are invented, not published SIDs/STARs. |
| `frequencies.json` | Published tower, ground, approach, departure, ATIS, delivery and centre frequencies (at most 3 per kind, VHF only) for large and medium airports. | Real frequencies in the simulated radio transcript. The transmissions are invented. |
| `heliports.json` | City heliports (within 40 NM of a large airport, at most 15 per airport), hospital helipads (within 60 NM, at most 30 per airport) and offshore platforms, classified by name and location. | Simulated helicopter, HEMS and offshore-shuttle traffic. |
| `gliding.json` | Gliding sites, found by name ("Segelfluggelände", "Gliding Club", "vol à voile"…) or by OurAirports keywords. | Simulated glider traffic. |

The classification is heuristic and some sites may be in the wrong group. The files are reference
data for the simulation only and must not be used for navigation.
