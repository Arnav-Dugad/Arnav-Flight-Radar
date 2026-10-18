// Provider registry: what each source is, what it may be used for, and how it
// must be credited. Surfaced verbatim at /api/providers and in the UI.

import type { Attribution, ProviderInfo } from '../shared/types';

export const USER_AGENT = 'ArnavFlightRadar/1.0 (+https://github.com/Arnav-Dugad/Arnav-Flight-Radar; personal non-commercial)';

export const ADSBFI_ATTRIBUTION: Attribution = {
  name: 'adsb.fi',
  url: 'https://adsb.fi',
  license: 'adsb.fi open data — personal, non-commercial use',
};

export const AWC_ATTRIBUTION: Attribution = {
  name: 'NOAA Aviation Weather Center',
  url: 'https://aviationweather.gov',
  license: 'U.S. Government work (public domain)',
};

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'adsbfi',
    name: 'adsb.fi open data',
    kind: 'aircraft',
    enabled: true,
    scope: 'Regional queries up to 250 NM radius around a point, plus single-aircraft lookups. Coverage depends on the volunteer feeder network.',
    limits: 'Public API: 1 request per second. This site enforces one global request every ≥ 1.1 s through a single coordinator and shares each regional snapshot between all visitors.',
    attribution: ADSBFI_ATTRIBUTION,
    terms: 'Personal, non-commercial use only. No resale or licensing. Data provided as-is. Global snapshots are not used.',
  },
  {
    id: 'aviationweather',
    name: 'AviationWeather.gov Data API',
    kind: 'weather',
    enabled: true,
    scope: 'Worldwide METAR and TAF reports by station or bounding box.',
    limits: '100 requests per minute (documented). This site paces at ≤ 40/min globally and caches METARs for 5 min, TAFs for 15 min.',
    attribution: AWC_ATTRIBUTION,
    terms: 'Server-side access only (no browser CORS). Not for operational flight planning.',
  },
  {
    id: 'ourairports',
    name: 'OurAirports',
    kind: 'airports',
    enabled: true,
    scope: 'Worldwide airports, runways and radio frequencies (static snapshot bundled with the site).',
    limits: 'Static files — no runtime requests to OurAirports.',
    attribution: { name: 'OurAirports', url: 'https://ourairports.com/data/', license: 'Public Domain' },
    terms: 'Released to the public domain. Community-maintained; not authoritative for navigation.',
  },
  {
    id: 'openfreemap',
    name: 'OpenFreeMap vector tiles',
    kind: 'map',
    enabled: true,
    scope: 'Worldwide vector basemap (OpenMapTiles schema).',
    limits: 'Free public instance with no request limits.',
    attribution: {
      name: 'OpenFreeMap © OpenMapTiles, data © OpenStreetMap contributors',
      url: 'https://www.openstreetmap.org/copyright',
      license: 'ODbL (data), OpenMapTiles (schema)',
    },
    terms: 'Attribution required: OpenMapTiles and OpenStreetMap.',
  },
  {
    id: 'terrain',
    name: 'Terrain Tiles (AWS Open Data)',
    kind: 'map',
    enabled: true,
    scope: 'Worldwide elevation tiles (Terrarium encoding) for hillshade and 3D terrain.',
    limits: 'Public open-data bucket.',
    attribution: {
      name: 'Terrain Tiles — Mapzen / Tilezen and data sources',
      url: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
      license: 'Various open licenses (see link)',
    },
    terms: 'Attribution to the underlying elevation sources required.',
  },
  {
    id: 'rainviewer',
    name: 'RainViewer Weather Maps API',
    kind: 'weather',
    enabled: true,
    scope: 'Worldwide composite precipitation radar where national radars exist; latest frame, max zoom 7.',
    limits: 'Free for personal/educational use; 100 requests/IP/minute. Requested by each viewer’s browser only when the radar layer is on.',
    attribution: { name: 'Weather data by Rain Viewer', url: 'https://www.rainviewer.com/', license: 'Free tier terms; underlying radar data from national agencies' },
    terms: 'Attribution required. Not for operational use.',
  },
  {
    id: 'planespotters',
    name: 'Planespotters.net Photo API',
    kind: 'aircraft',
    enabled: true,
    scope: 'One airframe photo per aircraft (by ICAO hex), when available.',
    limits: 'Free, keyless, reasonable use. Requested by the viewer’s browser when an aircraft is opened.',
    attribution: { name: 'Planespotters.net', url: 'https://www.planespotters.net/photo/api', license: 'Photos © their photographers' },
    terms: 'Photographer credited next to each photo; thumbnail links to the photo page; images never stored, proxied or re-hosted.',
  },
  {
    id: 'adsblol',
    name: 'adsb.lol',
    kind: 'aircraft',
    enabled: false,
    scope: 'Not integrated.',
    limits: 'Operator asks to be contacted before production use.',
    attribution: { name: 'adsb.lol', url: 'https://adsb.lol', license: 'ODbL' },
    terms: 'Disabled until the operator approves production use. Would not be mixed with adsb.fi data.',
  },
  {
    id: 'opensky',
    name: 'OpenSky Network',
    kind: 'aircraft',
    enabled: false,
    scope: 'Not integrated.',
    limits: 'Operational use requires a prior written agreement.',
    attribution: { name: 'OpenSky Network', url: 'https://opensky-network.org', license: 'Custom terms' },
    terms: 'Disabled: no written agreement in place.',
  },
];
