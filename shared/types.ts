// Normalized data contracts shared by the Worker and the browser.
//
// UNITS (never mixed, never implicit):
//   altitude*        feet (ft)
//   groundSpeed/ias  knots (kt)
//   verticalRate     feet per minute (ft/min)
//   track/heading    degrees, 0–360, true north unless the name says "mag"
//   lat/lon          WGS-84 decimal degrees
//   *At timestamps   Unix epoch milliseconds (UTC)
//   distances        nautical miles (NM)
//
// A field that the provider did not report is OMITTED (undefined) — never
// zero-filled and never guessed. The UI renders it as "Not available".

/** 'demo' is explicitly simulated traffic, generated in the browser and never mixed with live data. */
export type ProviderId = 'adsbfi' | 'demo';

export type PositionSource = 'adsb' | 'mlat' | 'tisb' | 'adsr' | 'adsc' | 'modes' | 'other';

/** Server-side freshness of the position at the moment the provider answered. */
export type Freshness = 'live' | 'stale';

/** Client-side lifecycle state, which also covers aircraft that dropped out. */
export type TrackState = 'live' | 'stale' | 'lost';

export interface AircraftExtras {
  ias?: number; // kt
  tas?: number; // kt
  mach?: number;
  roll?: number; // deg, +ve right wing down
  magHeading?: number; // deg magnetic
  trueHeading?: number; // deg true
  navAltitudeMcp?: number; // ft, selected altitude on the MCP/FCU
  navAltitudeFms?: number; // ft
  navHeading?: number; // deg, selected heading
  navQnh?: number; // hPa
  windDirection?: number; // deg true (derived on board, reported by provider)
  windSpeed?: number; // kt
  outsideAirTemp?: number; // °C
  nic?: number;
  nacP?: number;
  sil?: number;
  rssi?: number; // dBFS
  messages?: number;
  adsbVersion?: number;
  emitterCategory?: string;
  ownerOperator?: string;
  year?: string;
}

export interface Aircraft {
  id: string; // stable identity: provider address (lowercase hex, '~' prefix for non-ICAO)
  icao24: string;
  callsign?: string;
  registration?: string;
  aircraftType?: string; // ICAO type designator, e.g. B738
  typeDescription?: string; // e.g. "BOEING 737-800"
  category?: string; // ADS-B emitter category A0–D7
  lat: number;
  lon: number;
  altitudeBarometric?: number; // ft (absent when on ground or unknown)
  altitudeGeometric?: number; // ft
  groundSpeed?: number; // kt
  track?: number; // deg true
  verticalRate?: number; // ft/min
  squawk?: string;
  emergency?: string; // e.g. "general", "lifeguard" — only when not "none"
  onGround: boolean;
  military?: boolean; // from the provider's aircraft database flags
  privacy?: 'ladd' | 'pia'; // owner requested limited display (FAA LADD) or uses a privacy address (PIA)
  positionSource: PositionSource;
  observedAt: number; // ms — when the position was last updated
  seenAt: number; // ms — when any message was last received
  receivedAt: number; // ms — when our server received the provider response
  provider: ProviderId;
  freshness: Freshness;
  distanceNm?: number; // from the query centre, as reported by the provider
  ext?: AircraftExtras;
}

export interface RegionQuery {
  lat: number;
  lon: number;
  radiusNm: number;
}

export interface CacheMeta {
  hit: boolean; // served from the shared snapshot rather than a fresh upstream call
  ageMs: number; // age of the snapshot when served
  ttlMs: number;
}

export interface AircraftResponse {
  provider: ProviderId;
  attribution: Attribution;
  query: RegionQuery; // the normalized (snapped) region actually fetched
  providerNow: number; // provider's own clock (ms)
  fetchedAt: number; // when our server fetched upstream (ms)
  servedAt: number; // when this response was produced (ms)
  stale: boolean; // true when the snapshot is older than the configured TTL
  degraded?: string; // human-readable reason when serving an older snapshot
  cache: CacheMeta;
  count: number;
  aircraft: Aircraft[];
}

export interface AircraftLookupResponse {
  provider: ProviderId;
  attribution: Attribution;
  providerNow: number;
  fetchedAt: number;
  servedAt: number;
  cache: CacheMeta;
  count: number;
  aircraft: Aircraft[];
  raw?: unknown[]; // only with ?raw=1, for the Data Inspector
}

export interface Attribution {
  name: string;
  url: string;
  license: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  kind: 'aircraft' | 'weather' | 'airports' | 'map';
  enabled: boolean;
  scope: string; // geographic scope description
  limits: string;
  attribution: Attribution;
  terms: string;
}

export interface ProviderHealth {
  id: string;
  status: 'ok' | 'degraded' | 'down' | 'unknown';
  lastSuccessAt?: number;
  lastErrorAt?: number;
  lastError?: string;
  consecutiveFailures: number;
  circuitOpenUntil?: number;
  upstreamCalls: number; // since the coordinator last started
  cacheHits: number;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    retryAfterSec?: number;
  };
}

// --- Weather -----------------------------------------------------------------

export interface CloudLayer {
  cover: string; // FEW, SCT, BKN, OVC, CLR, SKC, NSC, OVX
  baseFt?: number;
  type?: string; // CB, TCU
}

export interface Metar {
  station: string;
  name?: string;
  observedAt: number; // ms
  raw: string;
  lat?: number;
  lon?: number;
  elevationM?: number;
  tempC?: number;
  dewpointC?: number;
  windDirDeg?: number; // undefined when variable
  windVariable?: boolean;
  windSpeedKt?: number;
  windGustKt?: number;
  visibility?: string; // as reported, statute miles, e.g. "10+", "6+", "1.5"
  altimeterHpa?: number;
  clouds: CloudLayer[];
  flightCategory?: 'VFR' | 'MVFR' | 'IFR' | 'LIFR';
  weather?: string; // present weather string, e.g. "-RA BR"
}

export interface TafPeriod {
  from: number;
  to: number;
  change?: string; // FM, TEMPO, BECMG, PROB
  probability?: number;
  windDirDeg?: number;
  windSpeedKt?: number;
  windGustKt?: number;
  visibility?: string;
  weather?: string;
  clouds: CloudLayer[];
}

export interface Taf {
  station: string;
  name?: string;
  issuedAt: number;
  validFrom: number;
  validTo: number;
  raw: string;
  periods: TafPeriod[];
}

export interface WeatherResponse<T> {
  provider: 'aviationweather';
  attribution: Attribution;
  fetchedAt: number;
  servedAt: number;
  cache: CacheMeta;
  count: number;
  data: T[];
}

// --- Airports (OurAirports, public domain) -------------------------------------

export type AirportType =
  | 'large_airport'
  | 'medium_airport'
  | 'small_airport'
  | 'heliport'
  | 'seaplane_base'
  | 'balloonport'
  | 'closed';

/** Compact index row, shipped as a static asset for instant local search. */
export interface AirportIndexEntry {
  ident: string; // OurAirports ident (usually ICAO)
  icao?: string;
  iata?: string;
  name: string;
  city?: string;
  country: string; // ISO 3166-1 alpha-2
  lat: number;
  lon: number;
  type: AirportType;
  elevationFt?: number;
  scheduled: boolean;
}

export interface Runway {
  leIdent?: string;
  heIdent?: string;
  lengthFt?: number;
  widthFt?: number;
  surface?: string;
  lighted: boolean;
  closed: boolean;
  leHeadingDegT?: number;
  heHeadingDegT?: number;
  leLat?: number;
  leLon?: number;
  heLat?: number;
  heLon?: number;
  leElevationFt?: number;
  heElevationFt?: number;
  leDisplacedThresholdFt?: number;
  heDisplacedThresholdFt?: number;
}

export interface Frequency {
  type: string;
  description?: string;
  mhz: number;
}

export interface AirportDetail extends AirportIndexEntry {
  region?: string;
  continent?: string;
  homeLink?: string;
  wikipedia?: string;
  runways: Runway[];
  frequencies: Frequency[];
}

export interface Country {
  code: string;
  name: string;
  continent: string;
  lat: number; // centroid of the country's airports
  lon: number;
  bbox: [number, number, number, number]; // west, south, east, north
}
