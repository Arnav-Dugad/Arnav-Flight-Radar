# Third-party data, services and software

Arnav Flight Radar shows data from the sources below. Each is credited in the app's status bar,
in the panels that use it, and in **Data & coverage**. No source is mixed with another in a way
its licence does not allow.

## Live data and services

| Source | Used for | Licence / terms | Attribution shown |
| --- | --- | --- | --- |
| [adsb.fi open data](https://github.com/adsbfi/opendata) | Live aircraft positions (regional queries ≤ 250 NM, single-aircraft lookups) | **Personal, non-commercial use only.** No resale or licensing. Public API limit 1 request/second. Provided as-is. | "adsb.fi" with link to <https://adsb.fi> |
| [AviationWeather.gov Data API](https://aviationweather.gov/data/api/) (NOAA) | METAR and TAF reports | U.S. Government work. Documented limit 100 requests/minute; server-side only (no browser CORS). Not for operational flight planning. | "NOAA Aviation Weather Center" |
| [OurAirports](https://ourairports.com/data/) | Airports, runways, radio frequencies (static snapshot built at deploy time) | Public Domain | "OurAirports" |
| [OpenFreeMap](https://openfreemap.org) | Vector basemap tiles, fonts | Free public instance; data © OpenStreetMap contributors (ODbL); schema © OpenMapTiles | "OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors" |
| [Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/) (Mapzen/Tilezen) | Hillshade and 3D terrain (Terrain Explorer style, 3D terrain toggle) | Open data; requires attribution to the underlying sources | Link to the [Tilezen attribution list](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) |
| [RainViewer Weather Maps API](https://www.rainviewer.com/api.html) | Precipitation radar overlay (latest frame, max zoom 7) | Free for personal/educational use; 100 requests/IP/minute; attribution required. Tiles requested by each viewer's browser only when the layer is on. | "Weather data by Rain Viewer" with link |
| [Planespotters.net Photo API](https://www.planespotters.net/photo/api) | One airframe photo in the aircraft panel | Free, keyless. Photographer credited next to the photo; thumbnail is a plain link to the photo page; images never stored, proxied or re-hosted; JSON kept in memory only. | "Photo © *photographer* via Planespotters.net" |
| [OpenFlights airline database](https://openflights.org/data.php) | Airline names, IATA codes and telephony designators (operator inferred from callsign prefix; demo airline names) | [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/) — derived database `public/data/airlines.json` is offered under the same licence | "OpenFlights (ODbL)" next to the operator |
| [FAA Aeronautical Data Delivery Service — Class Airspace](https://adds-faa.opendata.arcgis.com/) | US Class B/C/D airspace overlay (from zoom 6, viewport queries from the browser when the layer is on) | U.S. Government work (public domain). Not for navigation. | "Source: FAA Aeronautical Data Delivery Service" in the Layers panel |
| [Wikidata](https://www.wikidata.org) | Airline logo and aircraft-model image references | CC0 | — |
| [Wikimedia Commons](https://commons.wikimedia.org) | Airline logos (copied at build time into `public/media/logos`) and representative aircraft/livery photos (hotlinked at standard thumbnail sizes) | Each file's own free licence or public domain (licence and author stored in `public/data/media.json` and shown next to every image). Logos are trademarks of their owners, used only to identify the operator. | "Photo © *author* · *licence* · Wikimedia Commons" with a link to the file page; logo licence in its tooltip |
| [openAIP](https://www.openaip.net) | Controlled airspace (CTR/TMA/CTA, classes A–E) for Canada and 30 European countries | CC BY-NC 4.0 (non-commercial, attribution) | "openAIP (CC BY-NC 4.0)" in the map attribution and Layers panel |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) via Overpass | Stands (parking positions) and taxiway networks at the busiest demo hubs | ODbL 1.0 — the derived files in `public/data/ground` are offered under the ODbL | "© OpenStreetMap contributors" (status bar) |
| [NASA GIBS](https://earthdata.nasa.gov/gibs) — LIS Very High Resolution Lightning Full Climatology | Lightning **climatology** overlay (long-term mean flash rate; not live strikes) | NASA data, no restrictions on use; acknowledgement requested | "NASA GIBS lightning climatology (LIS)" in the map attribution and Layers panel |
| [EOxCloudless 2025](https://cloudless.eox.at) by EOX IT Services GmbH | "Satellite" map style (annual cloud-free Sentinel-2 mosaic, not live imagery) | CC BY-NC-SA 4.0 (non-commercial) — contains modified Copernicus Sentinel data 2025 | Full EOX attribution string while the style is active |

### Sources deliberately **not** used

| Source | Status |
| --- | --- |
| adsb.lol | Not integrated. The operator asks to be contacted before production use. |
| OpenSky Network | Not integrated. Operational REST use requires a prior written agreement. |
| Flightradar24, FlightAware and other proprietary trackers | Never scraped. |
| adsbdb / ADS-B route databases | Not integrated. Live origin/destination data cannot be republished without the maintainers' permission, so live flights show no route. |
| Blitzortung.org (live lightning) | Not integrated. Its data may be used only with the project's approval. |
| Scraped logo collections (e.g. repositories copied from FlightAware/Flightradar24) | Not used. Logos come only from Wikimedia Commons, with licences recorded. |
| National airspace datasets (DFS, NAV CANADA, NATS, Eurocontrol EAD) | Not used: no open licence, or an account is required. |

## Software

All runtime dependencies are open source:

| Package | Licence |
| --- | --- |
| MapLibre GL JS | BSD-3-Clause |
| React, React DOM | MIT |
| Hono | MIT |
| Zod | MIT |
| Zustand | MIT |
| TanStack Query | MIT |
| Motion | MIT |
| Lucide React | ISC |
| Inter (via @fontsource-variable/inter) | SIL Open Font License 1.1 |
| @photostructure/tz-lookup | CC0-1.0 |

Development tooling (Vite, Vitest, Playwright, Tailwind CSS, Wrangler, TypeScript, ESLint) is MIT or Apache-2.0.

The aviation icon set, aircraft silhouettes, map styles and the Apex Vector logo are original work for this project.
