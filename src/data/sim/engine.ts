// World flight simulator. Generates an entire planet of simulated traffic, gate to gate:
//
//  • Airline flights push back from real stands (OpenStreetMap) at the terminal their
//    airline really uses, taxi along real named taxiways, hold short and cross runways,
//    de-ice in freezing precipitation, queue at the holding point and line up.
//  • Runway slots are spaced by real capacity and ICAO wake-turbulence separation
//    (Super/Heavy/Medium/Light), cut by real weather (METAR now, TAF later). Busy
//    airports meter departures with gate holds and meter arrivals with ground delays
//    and holding over a real navaid.
//  • Routes leave on procedure-style departures and arrive on procedure-style arrivals
//    built on real navaids, pass real navaids en route, and cross the North Atlantic on
//    the day's simulated track system; profiles respect the 250-knot limit below
//    FL100, the semicircular rule, step climbs and winds aloft.
//  • Rare emergencies (engine failure, depressurisation, medical) divert to the nearest
//    suitable airport; weather causes go-arounds, diversions and cancellations.
//  • Timetables have days of operation, IATA seasons, leisure seasonality, weekday
//    patterns, night curfews, cargo night banks, positioning and delivery flights.
//  • Beyond airlines: general aviation (daylight VFR, weekend peaks, circuits), military
//    transports, tankers, AWACS, patrol and fighter sorties from real bases, air
//    ambulances (HEMS to incident scenes and hospitals), offshore helicopters, city
//    shuttles and gliders soaring in thermals with tow planes.
//
// EVERYTHING produced here is simulated, and the site labels it as such.

import { bearingDeg, destination, distanceNm, intermediatePoint } from '@shared/geo';
import { icaoBlock } from '@shared/icaoCountry';
import type { AirportIndexEntry } from '@shared/types';
import { AIRLINE_EXTRA } from './airlineInfo';
import { ALL_AIRLINES as AIRLINES, ALL_ALLIANCES as ALLIANCES, CARGO } from './airlines';
import { GA_COUNTRIES, GA_TYPES, TYPES, type AirlineProfile, type TypeInfo } from './fleet';
import { ashAdvisory, affinity, crossedZones, detour, pointInZones, REGIONS, regionOf, STANDING_ZONES, type Region, type Zone } from './geoMarkets';
import { assignOts, enroute, fixName, NavDb, natTracks, otsString, sidFor, starFor, type Fix, type NatTrack, type OtsSystem, type OtsTrack, type Procedure } from './procedures';
import type { AirlineModel, Wake } from './refTypes';
import { daylight, hajjWeight, leisureOf, localHour, localWeekday, operatesOn, routeDays, seasonalWeight, weekdayGroundFactor, type RouteDays } from './schedule';
import { AIR_AMBULANCE, DELIVERY_CENTRES, GLIDER_REG, GLIDER_TYPES, HEMS, MIL_MISSION, MILITARY, OFFSHORE, SHUTTLES, TOW_TYPES, type MilOperator, type MilRole } from './special';
import { SCHENGEN, terminalFor } from './terminals';
import { specOf } from './typeSpecs';
import { ALTERNATING as ALTERNATING_IDENTS, curfewEnd, segregatedPair } from './runwayConfig';
import { fillet, pushbackPath, routeOnGraph } from './taxiGeo';
import { acmiFor, etopsFor, maintenanceDue, type AcmiOperator, type EtopsAirport, type EtopsInfo } from './opsRules';
import { airwayString, routeViaAirways, type AirwayLeg, type AirwaysData } from './usAirways';
import { listProcedures, pickSid, pickStar, type ProceduresData, type ProcTrack } from './usProcedures';

export { ALL_ALLIANCES } from './airlines';

// ---------------------------------------------------------------- random

export class Rng {
  constructor(private s: number) {
    if (this.s <= 0) this.s = 1;
  }
  next() {
    this.s = (this.s * 16807) % 2147483647;
    return (this.s - 1) / 2147483646;
  }
  range(a: number, b: number) {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number) {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(list: T[]): T {
    return list[Math.floor(this.next() * list.length)]!;
  }
  weighted<T>(items: [T, number][]): T {
    const total = items.reduce((a, [, w]) => a + w, 0);
    let r = this.next() * total;
    for (const [v, w] of items) {
      r -= w;
      if (r <= 0) return v;
    }
    return items[items.length - 1]![0];
  }
}

/** FNV-1a: stable hashes for timetable numbers. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------- airports

export type Pt = [number, number];

export interface SimRunway {
  ident: string;
  lat: number;
  lon: number;
  hdg: number;
  lengthNm: number;
}

/** A runway as a strip between its two thresholds (for crossing checks). */
export interface Strip {
  a: Pt;
  b: Pt;
  name: string; // "09L/27R"
}

export interface Stand {
  lat: number;
  lon: number;
  ref?: string;
  hdg?: number; // nose direction when parked
  /** Index into the airport's terminal names, or -1. */
  term: number;
  /** 0 contact (terminal), 1 remote, 2 cargo apron, 3 general aviation. */
  kind: number;
  /** Large enough for a wide-body (from the spacing to neighbouring stands). */
  wide?: boolean;
}

export interface SimWeather {
  category?: 'VFR' | 'MVFR' | 'IFR' | 'LIFR';
  /** Prevailing visibility in statute miles (low-visibility procedures below 0.75). */
  visSm?: number;
  windDir?: number;
  windKt?: number;
  gustKt?: number;
  tempC?: number;
  /** Present weather groups, e.g. "-SN BR". */
  wx?: string;
  qnh?: number;
  observedAt?: number;
}

export type SiteKind = 'heliport' | 'hospital' | 'offshore' | 'glider' | 'scene';

export interface SimAirport {
  ident: string;
  iata?: string;
  name: string;
  city?: string;
  country: string;
  lat: number;
  lon: number;
  elev: number;
  large: boolean;
  scheduled: boolean;
  runways: SimRunway[]; // landing directions
  strips: Strip[];
  inUse: SimRunway; // runway direction in use for arrivals (into the wind)
  /** Departure runway when the airport runs segregated parallels; otherwise the arrival runway is used. */
  inUseDep?: SimRunway;
  /** Surface wind direction the runway choice is based on. */
  windDir?: number;
  /** Where the runway choice came from. */
  inUseBasis: 'simulated' | 'metar';
  stands?: Stand[]; // OpenStreetMap parking positions / gates
  terminals?: string[]; // OpenStreetMap terminal names
  weather?: SimWeather;
  /** Hourly arrival-capacity factors from the TAF (1 = normal). */
  forecast?: { t: number; capacity: number }[];
  /** Runway closures (snow clearing, inspections, night maintenance): no movements in the window. */
  closures?: { from: number; to: number; reason: string }[];
  /** Not an airport: a heliport, hospital pad, platform, gliding site or incident scene. */
  site?: SiteKind;
}

export interface TaxiGraph {
  nodes: Pt[];
  adj: number[][];
  /** Taxiway name of each edge, keyed "a-b" with a < b. */
  edgeNames?: Map<string, string>;
  /** OpenStreetMap runway holding positions with their names ("A1"). */
  holds?: { pt: Pt; ref: string }[];
}

type RunwayRow = [string, number, number, number, string, number, number, number, number];

class WeightedPool {
  private cum: number[] = [];
  private total = 0;
  constructor(
    readonly items: SimAirport[],
    weight: (a: SimAirport) => number,
  ) {
    for (const a of items) {
      this.total += weight(a);
      this.cum.push(this.total);
    }
  }
  pick(rng: Rng): SimAirport | undefined {
    if (!this.items.length) return undefined;
    const r = rng.next() * this.total;
    let lo = 0;
    let hi = this.cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid]! < r) lo = mid + 1;
      else hi = mid;
    }
    return this.items[lo];
  }
}

// ---------------------------------------------------------------- flights

export type Phase = 'parked' | 'pushback' | 'taxi' | 'takeoff' | 'climb' | 'cruise' | 'descent' | 'holding' | 'approach' | 'goaround' | 'landing' | 'orbit' | 'soaring';

export interface Seg {
  t0: number;
  t1: number;
  phase: Phase;
  kind: 'line' | 'gc' | 'path';
  a: Pt;
  b: Pt;
  pts?: Pt[]; // kind 'path'
  cum?: number[]; // cumulative NM along pts
  alt0: number; // ft MSL (NaN = on ground)
  alt1: number;
  spd0: number; // ground speed, kt
  spd1: number;
  ease?: 'accel' | 'decel';
  /** Fixed nose direction (push-back, holding short, lined up). */
  nose?: number;
  /** Moving tail-first (a push-back along a curved path). */
  reverse?: boolean;
  /** Wind on this segment (direction it blows FROM, speed) and its along-track component. */
  wind?: { dir: number; kt: number; comp: number };
}

export interface StandRef {
  pt: Pt;
  ref?: string;
  hdg?: number;
  terminal?: string;
  kind?: number;
}

export type LegKind =
  | 'scheduled'
  | 'cargo'
  | 'positioning'
  | 'delivery'
  | 'ga'
  | 'circuits'
  | 'bizjet'
  | 'military'
  | 'tanker'
  | 'awacs'
  | 'patrol'
  | 'training'
  | 'ambulance'
  | 'hems'
  | 'offshore'
  | 'shuttle'
  | 'glider'
  | 'tow';

export type EventKind =
  | 'clearance'
  | 'edct'
  | 'gatehold'
  | 'pushback'
  | 'taxi'
  | 'deice'
  | 'cross'
  | 'holdshort'
  | 'lineup'
  | 'takeoff'
  | 'departure'
  | 'climb'
  | 'pos'
  | 'cruise'
  | 'step'
  | 'oceanic'
  | 'oceanicExit'
  | 'descent'
  | 'star'
  | 'hold'
  | 'approach'
  | 'final'
  | 'goaround'
  | 'land'
  | 'vacate'
  | 'taxiIn'
  | 'onblock'
  | 'emergency'
  | 'divert'
  | 'orbit'
  | 'scene'
  | 'release'
  | 'circuit'
  | 'crew'
  | 'birdstrike'
  | 'returnhold'
  | 'improve'
  | 'canceled';

export interface LegEvent {
  t: number;
  k: EventKind;
  /** Free-form parameters (fix names, levels, runways, headings…). */
  a?: string;
  b?: string;
  n?: number;
  lat?: number;
  lon?: number;
}

export interface RouteInfo {
  sid?: Procedure;
  star?: Procedure;
  via: Fix[];
  nat?: { system: OtsSystem; letter: string; text: string; fl: number; mach: number; entry: number; exit: number };
  /** Detour around closed airspace or volcanic ash (zone names). */
  avoids?: string[];
  /** Flown on real published airways (source and cycle, e.g. "FAA CIFP 2610"). */
  airways?: string;
  /** Flight-plan style route string ("DET2F DET DCT REM DCT LAM LAM1Z"). */
  text: string;
}

export interface TaxiInfo {
  via: string[];
  hold?: string; // holding point name
  exit?: string; // runway exit used after landing
  crossings: string[];
  runway: string;
}

export interface Emergency {
  t: number;
  kind: 'engine' | 'pressurisation' | 'medical' | 'birdstrike';
  squawk?: string;
  divertTo: SimAirport;
}

export interface Leg {
  kind: LegKind;
  /** The aircraft was out of service for maintenance before this flight. */
  maint?: { check: string; from: number; until: number };
  flight: string; // ICAO callsign
  flightIata?: string;
  codeshares: string[];
  from: SimAirport;
  to: SimAirport; // where it actually lands
  divertedFrom?: SimAirport; // original destination when diverted
  /** Canceled flight: the aircraft stays on its stand; this was the planned destination. */
  canceledTo?: SimAirport;
  canceled?: boolean;
  std: number; // scheduled off-block (sim ms)
  sta: number; // scheduled on-block
  tOff: number; // actual off-block
  tTakeoff: number;
  tLand: number;
  tOn: number;
  holdMs: number;
  gateHoldMs: number;
  deiceMs: number;
  cruiseFt: number;
  segs: Seg[];
  stand: StandRef;
  standTo: StandRef;
  events: LegEvent[];
  route?: RouteInfo;
  taxiOut?: TaxiInfo;
  taxiIn?: TaxiInfo;
  approach?: string;
  emergency?: Emergency;
  wake: Wake;
  days?: RouteDays;
  /** Ground time after this leg before the next departure. */
  turnAfter: number;
  /** Where the airframe is planned to fly next (rotation). */
  plannedNext?: SimAirport;
  /** Delay from crew duty-time limits (waiting for a fresh crew), ms. */
  crewDelayMs?: number;
}

/** Compact record of a completed flight (aircraft history). */
export interface LegSummary {
  flight: string;
  flightIata?: string;
  kind: LegKind;
  from: SimAirport;
  to: SimAirport;
  divertedFrom?: SimAirport;
  std: number;
  sta: number;
  tOff: number;
  tOn: number;
  canceled?: boolean;
  emergency?: Emergency['kind'];
}

export type Role = 'airline' | 'ga' | 'mil' | 'hems' | 'ambulance' | 'offshore' | 'shuttle' | 'glider' | 'tow';

export interface Operator {
  icao: string;
  tel: string;
  name: string;
  country: string;
}

export interface Airframe {
  n: number;
  hex: string;
  reg: string;
  type: TypeInfo;
  airline?: AirlineProfile;
  /** Non-airline operator (military, air ambulance, helicopter operator). */
  op?: Operator;
  role: Role;
  milRole?: MilRole;
  home?: SimAirport;
  ga?: { squawk: string };
  squawk: string;
  leg: Leg;
  prev?: Leg;
  turnMs: number;
  history: LegSummary[];
  /** Earlier (pre-simulation) history has been reconstructed. */
  historyBuilt?: boolean;
  /** Flight-number counter for operators without a timetable. */
  seq: number;
  /** When the current crew's duty period began (sim ms). */
  dutyStart?: number;
  /** Wet-leased (ACMI): the operator flying this aircraft for the airline, with its crew. */
  acmi?: AcmiOperator;
  /** Day number of the last maintenance check started. */
  maintDay?: number;
}

export interface SimState {
  lat: number;
  lon: number;
  alt?: number; // ft MSL; undefined on ground
  gs: number;
  trk: number;
  vr: number;
  onGround: boolean;
  phase: Phase;
  emit: boolean; // transponder on
  wind?: { dir: number; kt: number; comp: number };
}

const H = 3_600_000;
const MIN = 60_000;
const ground = NaN;

function segDuration(distNm: number, avgKt: number) {
  return (distNm / Math.max(1, avgKt)) * H;
}

const round5 = (ms: number) => Math.round(ms / 300_000) * 300_000;
const norm = (d: number) => ((d % 360) + 360) % 360;
function angle(a: number, b: number) {
  return ((b - a + 540) % 360) - 180;
}

/** A point `along` NM in direction `hdg` from `o`, then `cross` NM to the right. */
function fromLocal(o: Pt, hdg: number, along: number, cross: number): Pt {
  const p = along === 0 ? o : destination(o[0], o[1], hdg, along);
  return cross === 0 ? p : destination(p[0], p[1], hdg + (cross > 0 ? 90 : -90), Math.abs(cross));
}

/** Chaikin corner cutting: turns a polyline into a flyable curve (endpoints kept). */
function smooth(pts: Pt[], iterations = 2): Pt[] {
  let p = pts;
  for (let k = 0; k < iterations; k++) {
    if (p.length < 3) return p;
    const out: Pt[] = [p[0]!];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i]!;
      const b = p[i + 1]!;
      if (i > 0) out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      if (i < p.length - 2) out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(p[p.length - 1]!);
    p = out;
  }
  return p;
}

function cumulative(pts: Pt[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + distanceNm(pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1]));
  return cum;
}

/** Point at distance `d` NM along a polyline with cumulative distances `cum`. */
function along(pts: Pt[], cum: number[], d: number): Pt {
  if (d <= 0) return pts[0]!;
  const total = cum[cum.length - 1]!;
  if (d >= total) return pts[pts.length - 1]!;
  let lo = 1;
  while (lo < cum.length - 1 && cum[lo]! < d) lo++;
  const a = pts[lo - 1]!;
  const b = pts[lo]!;
  const span = cum[lo]! - cum[lo - 1]!;
  const k = span > 0 ? (d - cum[lo - 1]!) / span : 0;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

/** Like `along`, but follows the great circle between route points (long oceanic legs). */
function alongGc(pts: Pt[], cum: number[], d: number): Pt {
  if (d <= 0) return pts[0]!;
  const total = cum[cum.length - 1]!;
  if (d >= total) return pts[pts.length - 1]!;
  let lo = 1;
  while (lo < cum.length - 1 && cum[lo]! < d) lo++;
  const a = pts[lo - 1]!;
  const b = pts[lo]!;
  const span = cum[lo]! - cum[lo - 1]!;
  return span > 0 ? intermediatePoint(a[0], a[1], b[0], b[1], (d - cum[lo - 1]!) / span) : a;
}

/** Sub-polyline between distances d0 and d1. */
function slice(pts: Pt[], cum: number[], d0: number, d1: number): Pt[] {
  const out: Pt[] = [along(pts, cum, d0)];
  for (let i = 1; i < pts.length - 1; i++) if (cum[i]! > d0 && cum[i]! < d1) out.push(pts[i]!);
  out.push(along(pts, cum, d1));
  return out;
}

/** Distance along a polyline (NM) of the point on it nearest to `p` (flat approximation). */
function nearestAlong(pts: Pt[], cum: number[], p: Pt): number {
  const k = Math.cos((p[0] * Math.PI) / 180);
  let best = Infinity;
  let at = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const ax = (a[1] - p[1]) * k;
    const ay = a[0] - p[0];
    const dx = (b[1] - a[1]) * k;
    const dy = b[0] - a[0];
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
    const d = (ax + dx * t) ** 2 + (ay + dy * t) ** 2;
    if (d < best) {
      best = d;
      at = cum[i]! + (cum[i + 1]! - cum[i]!) * t;
    }
  }
  return at;
}

/**
 * Racetrack pattern (right turns) starting and ending at `fix`. `legNm` 0 gives the
 * standard 1-minute holding legs; tankers and AWACS fly long orbit legs.
 */
function racetrack(fix: Pt, inboundCrs: number, kt: number, laps: number, legNm = 0): Pt[] {
  const L = legNm || kt / 60; // NM in one minute
  const r = kt / (60 * Math.PI); // standard-rate 180° turn takes one minute
  const c = (inboundCrs * Math.PI) / 180;
  const u = [Math.sin(c), Math.cos(c)]; // inbound direction (x east, y north)
  const v = [Math.cos(c), -Math.sin(c)]; // to the right of inbound
  const k = Math.cos((fix[0] * Math.PI) / 180) || 1e-6;
  const toLL = (x: number, y: number): Pt => [fix[0] + y / 60, fix[1] + x / (60 * k)];
  const lap: Pt[] = [];
  const N = 8;
  for (let i = 0; i <= N; i++) {
    const t = (Math.PI * i) / N;
    lap.push(toLL(r * v[0]! - r * v[0]! * Math.cos(t) + r * u[0]! * Math.sin(t), r * v[1]! - r * v[1]! * Math.cos(t) + r * u[1]! * Math.sin(t)));
  }
  for (let i = 0; i <= N; i++) {
    const t = (Math.PI * i) / N;
    const cx = r * v[0]! - L * u[0]!;
    const cy = r * v[1]! - L * u[1]!;
    lap.push(toLL(cx + r * v[0]! * Math.cos(t) - r * u[0]! * Math.sin(t), cy + r * v[1]! * Math.cos(t) - r * u[1]! * Math.sin(t)));
  }
  lap.push(fix);
  const out: Pt[] = [fix];
  for (let n = 0; n < laps; n++) out.push(...lap.slice(1));
  return out;
}

/** Circle of radius r NM around a centre (for thermalling), starting at `start` bearing. */
function circle(c: Pt, r: number, start: number, turns: number, drift: Pt = [0, 0]): Pt[] {
  const out: Pt[] = [];
  const steps = Math.max(8, Math.round(turns * 12));
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const b = start + f * turns * 360;
    const p = destination(c[0] + drift[0] * f, c[1] + drift[1] * f, b, r);
    out.push(p);
  }
  return out;
}

/** Turn from `p` (heading `hdg`) towards `target` with radius `r`; returns the arc points. */
function turnTowards(p: Pt, hdg: number, target: Pt, r: number): Pt[] {
  const out: Pt[] = [p];
  let h = hdg;
  let cur = p;
  const step = 15;
  for (let i = 0; i < 24; i++) {
    const want = bearingDeg(cur[0], cur[1], target[0], target[1]);
    const d = angle(h, want);
    if (Math.abs(d) <= step) break;
    h = norm(h + Math.sign(d) * step);
    cur = destination(cur[0], cur[1], h, (2 * Math.PI * r * step) / 360);
    out.push(cur);
  }
  return out;
}

// ---------------------------------------------------------------- winds aloft

/**
 * Illustrative winds aloft: mid-latitude westerly jet streams (strongest near 40°,
 * stronger in the winter hemisphere) and light easterly trade winds in the tropics.
 */
export function windAloft(lat: number, lon: number, t: number, seed: number): { dir: number; kt: number } {
  const month = new Date(t).getUTCMonth();
  const northWinter = month <= 2 || month >= 10 ? 1.25 : month >= 5 && month <= 8 ? 0.75 : 1;
  const season = lat >= 0 ? northWinter : 2 - northWinter;
  const a = Math.abs(lat);
  if (a < 20) return { dir: norm(85 + 20 * Math.sin((lon + seed) / 37)), kt: 12 + 6 * Math.sin((lon + seed) / 23) };
  const jet = 95 * season * Math.exp(-(((a - 40) / 13) ** 2));
  const wave = Math.sin(((lon + seed * 7) * Math.PI) / 60);
  return { dir: norm(270 + 22 * wave), kt: Math.max(8, jet * (0.75 + 0.25 * Math.cos(((lon + seed) * Math.PI) / 45)) + 10) };
}

const tailwind = (w: { dir: number; kt: number }, trk: number) => w.kt * Math.cos((angle(trk, w.dir + 180) * Math.PI) / 180);

/** True airspeed (kt) at an altitude for a type cruising at `tas`: 250 KIAS below FL100. */
function tasAt(alt: number, cruiseFt: number, tas: number, light: boolean): number {
  if (light) return tas;
  if (alt <= 10_000) return 250 * (1 + (alt / 1000) * 0.017);
  const f = Math.min(1, (alt - 10_000) / Math.max(1000, cruiseFt - 10_000));
  return 293 + (tas - 293) * f;
}

// ---------------------------------------------------------------- wake separation

/** ICAO wake-turbulence minima on final, NM (leader → follower). */
const WAKE_ARR_NM: Record<Wake, Record<Wake, number>> = {
  J: { J: 4, H: 6, M: 7, L: 8 },
  H: { J: 4, H: 4, M: 5, L: 6 },
  M: { J: 3, H: 3, M: 3, L: 5 },
  L: { J: 3, H: 3, M: 3, L: 3 },
};
/** Departure wake minima, seconds (same runway). */
const WAKE_DEP_S: Record<Wake, Record<Wake, number>> = {
  J: { J: 120, H: 120, M: 180, L: 180 },
  H: { J: 60, H: 60, M: 120, L: 120 },
  M: { J: 60, H: 60, M: 60, L: 120 },
  L: { J: 60, H: 60, M: 60, L: 60 },
};

interface Slot {
  t: number;
  w: Wake;
}

// ---------------------------------------------------------------- leg builder

class Builder {
  segs: Seg[] = [];
  events: LegEvent[] = [];
  constructor(public time: number) {}
  push(s: Omit<Seg, 't0' | 't1'>, dur: number) {
    const d = Math.max(1, dur);
    this.segs.push({ ...s, t0: this.time, t1: this.time + d });
    this.time += d;
  }
  path(phase: Phase, pts: Pt[], alt0: number, alt1: number, spd0: number, spd1: number, dur?: number) {
    const cum = cumulative(pts);
    const len = cum[cum.length - 1]!;
    this.push({ phase, kind: 'path', a: pts[0]!, b: pts[pts.length - 1]!, pts, cum, alt0, alt1, spd0, spd1 }, dur ?? segDuration(len, (spd0 + spd1) / 2));
  }
  line(phase: Phase, a: Pt, b: Pt, alt0: number, alt1: number, spd0: number, spd1: number, dur?: number, extra: Partial<Seg> = {}) {
    this.push({ phase, kind: 'line', a, b, alt0, alt1, spd0, spd1, ...extra }, dur ?? segDuration(Math.max(0.01, distanceNm(a[0], a[1], b[0], b[1])), Math.max(1, (spd0 + spd1) / 2)));
  }
  /** The last segment is flown tail-first (push-back): the nose faces against the motion. */
  reverseLast() {
    const s = this.segs[this.segs.length - 1];
    if (s) s.reverse = true;
  }
  wait(phase: Phase, pt: Pt, dur: number, nose?: number, alt = ground) {
    const s: Omit<Seg, 't0' | 't1'> = { phase, kind: 'line', a: pt, b: pt, alt0: alt, alt1: alt, spd0: 0, spd1: 0 };
    if (nose !== undefined) s.nose = nose;
    this.push(s, dur);
  }
  ev(k: EventKind, data: Omit<LegEvent, 't' | 'k'> = {}, t = this.time) {
    this.events.push({ t, k, ...data });
  }
}

interface TaxiPlan {
  pts: Pt[];
  cum: number[];
  via: string[];
  hold?: string;
  exit?: string;
  crossings: { s: number; runway: string; active: boolean }[];
}

/** 2D segment intersection parameter along p (0..1), or null. Points in local NM. */
function intersect(p0: [number, number], p1: [number, number], q0: [number, number], q1: [number, number]): number | null {
  const rx = p1[0] - p0[0];
  const ry = p1[1] - p0[1];
  const sx = q1[0] - q0[0];
  const sy = q1[1] - q0[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qpx = q0[0] - p0[0];
  const qpy = q0[1] - p0[1];
  const t = (qpx * sy - qpy * sx) / den;
  const u = (qpx * ry - qpy * rx) / den;
  // Shallow crossings are taxiing along the runway, not across it.
  const sin = Math.abs(den) / (Math.hypot(rx, ry) * Math.hypot(sx, sy) || 1);
  return t >= 0 && t <= 1 && u >= 0.02 && u <= 0.98 && sin > 0.35 ? t : null;
}

// ---------------------------------------------------------------- world

/** Destinations under sanctions or in conflict zones (few foreign airlines fly there). */
const RESTRICTED = new Set(['IR', 'SY', 'YE', 'AF', 'KP', 'LY', 'SD', 'SO', 'SS']);

/** Region pairs too close for typical long-haul (wide-body) flying. */
const NEAR_REGIONS = new Set(['WEUEEU', 'EEUWEU', 'WEUNAF', 'NAFWEU', 'NAMCAM', 'CAMNAM', 'MEASAS', 'SASMEA', 'SEAEAS', 'EASSEA', 'EEUMEA', 'MEAEEU', 'MEANAF', 'NAFMEA', 'CAMSAM', 'SAMCAM']);

export interface MissionPlan {
  role: MilRole | 'circuits' | 'tow';
  area: Pt;
  ft: number;
  durMs: number;
  legNm: number;
  crs: number;
}

export class World {
  readonly rng: Rng;
  airports = new Map<string, SimAirport>();
  private scheduledPool!: WeightedPool;
  private byCountry = new Map<string, WeightedPool>();
  private gaPools = new Map<string, WeightedPool>();
  airframes: Airframe[] = [];
  private usedHex = new Set<number>();
  private counter = 0;
  private slots = new Map<string, Slot[]>();
  private standBusy = new Map<string, number>();
  private standPools = new Map<string, number[]>();
  private ground = new Map<string, TaxiGraph>();
  private alternates = new Map<string, SimAirport | null>();
  private emergencyFields: SimAirport[] | null = null;
  /** Scheduled airports by world region (international destination choice). */
  private regionPools = new Map<Region, WeightedPool>();
  /** Large airports by region, weighted towards the big gateways (long-haul destinations). */
  private longPools = new Map<Region, WeightedPool>();
  /** Airports inside airspace closed to all civil traffic (never served). */
  private closedAirports = new Set<SimAirport>();
  private ashCache = new Map<number, Zone | null>();
  nav: NavDb | null = null;
  /** Published US procedures (FAA CIFP), when loaded. */
  usProcs: ProceduresData | null = null;
  /** Hospital helipads, offshore platforms and city heliports (pseudo airports). */
  sites: SimAirport[] = [];
  readonly windSeed: number;
  readonly seed: number;

  constructor(seed: number, airports: AirportIndexEntry[], runways: Record<string, RunwayRow[]>) {
    this.rng = new Rng(seed);
    this.seed = seed;
    this.windSeed = seed % 360;
    for (const a of airports) {
      if (a.type !== 'large_airport' && a.type !== 'medium_airport') continue;
      const rows = runways[a.ident] ?? [];
      const ends: SimRunway[] = [];
      const strips: Strip[] = [];
      for (const r of rows) {
        const len = Math.max(0.6, (r[8] || 8000) / 6076);
        if (r[0]) ends.push({ ident: r[0], lat: r[1], lon: r[2], hdg: r[3], lengthNm: len });
        if (r[4]) ends.push({ ident: r[4], lat: r[5], lon: r[6], hdg: r[7], lengthNm: len });
        if (r[0] && r[4] && (r[1] || r[2]) && (r[5] || r[6])) strips.push({ a: [r[1], r[2]], b: [r[5], r[6]], name: `${r[0]}/${r[4]}` });
      }
      const wind = this.rng.range(0, 360);
      let inUse: SimRunway;
      if (ends.length) inUse = bestRunway(ends, wind);
      else {
        const hdg = Math.round(wind / 10) * 10;
        const [tl, to] = destination(a.lat, a.lon, hdg + 180, 0.8);
        inUse = { ident: String(Math.round(hdg / 10) || 36).padStart(2, '0'), lat: tl, lon: to, hdg, lengthNm: 1.5 };
      }
      const sa: SimAirport = {
        ident: a.ident,
        name: a.name,
        country: a.country,
        lat: a.lat,
        lon: a.lon,
        elev: a.elevationFt ?? 0,
        large: a.type === 'large_airport',
        scheduled: a.scheduled,
        runways: ends,
        strips,
        inUse,
        inUseBasis: 'simulated',
        windDir: wind,
      };
      if (a.iata) sa.iata = a.iata;
      if (a.city) sa.city = a.city;
      this.airports.set(a.ident, sa);
    }
    const scheduled = [...this.airports.values()].filter((a) => a.scheduled || a.large);
    // Busy gateways attract far more flights than an average large airport: weight each
    // airport by the airline fleets based there (JFK, LHR, DXB… draw trunk routes).
    const hubScore = new Map<string, number>();
    for (const al of AIRLINES) for (const h of al.hubs) hubScore.set(h, (hubScore.get(h) ?? 0) + al.size / al.hubs.length);
    const weight = (a: SimAirport) => (a.large ? 10 : 1.5) * (1 + Math.sqrt((hubScore.get(a.ident) ?? 0) / 15));
    // Long-haul concentrates on a few dozen gateways: strongly hub-weighted, large airports only.
    const longWeight = (a: SimAirport) => (10 * (1 + (hubScore.get(a.ident) ?? 0) / 20)) ** 1.6;
    this.scheduledPool = new WeightedPool(scheduled, weight);
    const byC = new Map<string, SimAirport[]>();
    for (const a of scheduled) byC.set(a.country, [...(byC.get(a.country) ?? []), a]);
    for (const [c, list] of byC) this.byCountry.set(c, new WeightedPool(list, weight));
    for (const a of scheduled) if (pointInZones([a.lat, a.lon], STANDING_ZONES.filter((z) => z.avoidBy === 'all'), undefined)) this.closedAirports.add(a);
    const byR = new Map<Region, SimAirport[]>();
    for (const a of scheduled) {
      if (this.closedAirports.has(a)) continue;
      const r = regionOf(a.country);
      byR.set(r, [...(byR.get(r) ?? []), a]);
    }
    for (const [r, list] of byR) {
      this.regionPools.set(r, new WeightedPool(list, weight));
      this.longPools.set(r, new WeightedPool(list.filter((a) => a.large), longWeight));
    }
    const ga = new Map<string, SimAirport[]>();
    for (const a of this.airports.values()) if (!a.large) ga.set(a.country, [...(ga.get(a.country) ?? []), a]);
    for (const [c, list] of ga) this.gaPools.set(c, new WeightedPool(list, () => 1));
  }

  // -------------------------------------------------------------- external data

  /** OpenStreetMap stands and terminals (v2) or plain stand rows (v1). */
  setStands(data: Record<string, { c?: [number, number]; t: string[]; s: [number, number, string, number | null, number?, number?][] } | [number, number, string, number | null][]>) {
    for (const [ident, entry] of Object.entries(data)) {
      const a = this.airports.get(ident);
      if (!a) continue;
      // v1: plain rows; v2: absolute positions; v3: offsets (1e-5°) from the reference point `c`.
      const c = Array.isArray(entry) ? undefined : entry.c;
      const rows = Array.isArray(entry)
        ? entry.map((r) => [...r, -1, 0] as [number, number, string, number | null, number, number])
        : c
          ? entry.s.map(([dla, dlo, ...rest]) => [c[0] + dla / 1e5, c[1] + dlo / 1e5, ...rest] as [number, number, string, number | null, number?, number?])
          : entry.s;
      if (!rows.length) continue;
      if (!Array.isArray(entry)) a.terminals = entry.t;
      a.stands = rows.map(([lat, lon, ref, hdg, term, kind]) => {
        const s: Stand = { lat, lon, term: term ?? -1, kind: kind ?? 0 };
        if (ref) s.ref = ref;
        if (hdg !== null) s.hdg = hdg;
        return s;
      });
      markWideStands(a.stands);
    }
    this.standPools.clear();
  }

  setUsProcedures(d: ProceduresData) {
    this.usProcs = d;
  }

  usAwys: AirwaysData | null = null;
  /** Real US airways (FAA CIFP, public domain) for domestic US routes. */
  setUsAirways(d: AirwaysData) {
    this.usAwys = d;
  }

  /** A published FAA procedure as the simulator's procedure shape. */
  private published(tr: ProcTrack | null, kind: 'sid' | 'star'): Procedure | undefined {
    if (!tr || tr.fixes.length < 2) return undefined;
    const fixes: Fix[] = tr.fixes.map((f) => {
      const x: Fix = { ident: f.ident, lat: f.lat, lon: f.lon, real: true };
      if (f.altMin !== undefined) x.altMin = f.altMin;
      if (f.altMax !== undefined) x.altMax = f.altMax;
      return x;
    });
    const fix = kind === 'sid' ? fixes[fixes.length - 1]! : fixes[0]!;
    return { name: tr.name, fix, fixes, published: `FAA CIFP ${this.usProcs?.cycle ?? ''}`.trim() };
  }

  /**
   * Departure and arrival procedures for the runways in use: the published FAA ones at US
   * airports, otherwise the simulator's procedure-style ones (one per direction).
   */
  airportProcedures(a: SimAirport, t: number): { arrRunway: string; depRunway: string; sids: Procedure[]; stars: Procedure[]; published: boolean } {
    this.runwaysAt(a, t);
    const arr = a.inUse.ident;
    const dep = (a.inUseDep ?? a.inUse).ident;
    if (this.usProcs && a.country === 'US') {
      const sids = listProcedures(this.usProcs, a.ident, dep, 'sid').map((tr) => this.published(tr, 'sid')).filter((p): p is Procedure => !!p);
      const stars = listProcedures(this.usProcs, a.ident, arr, 'star').map((tr) => this.published(tr, 'star')).filter((p): p is Procedure => !!p);
      if (sids.length || stars.length) return { arrRunway: arr, depRunway: dep, sids, stars, published: true };
    }
    const sids: Procedure[] = [];
    const stars: Procedure[] = [];
    for (let c = 0; c < 360; c += 45) {
      const p = sidFor(this.nav, a, dep, c);
      if (!sids.some((x) => x.name === p.name)) sids.push(p);
    }
    for (let q = 0; q < 360; q += 90) {
      const p = starFor(this.nav, a, arr, q);
      if (!stars.some((x) => x.name === p.name)) stars.push(p);
    }
    return { arrRunway: arr, depRunway: dep, sids, stars, published: false };
  }

  private adequate: EtopsAirport[] | null = null;
  private etopsCache = new WeakMap<Leg, EtopsInfo | null>();

  /**
   * ETOPS for a twin-engine flight: the diversion time it needs and its en-route alternates
   * (adequate airports: large, with a runway of at least ~7,500 ft). Null for 3/4-engine
   * aircraft and for routes that never go beyond 60 minutes from an adequate airport.
   */
  etops(af: Airframe): EtopsInfo | null {
    const leg = af.leg;
    if (this.etopsCache.has(leg)) return this.etopsCache.get(leg)!;
    let out: EtopsInfo | null = null;
    const spec = specOf(af.type.code);
    if (spec?.engines.count === 2 && spec.engines.kind === 'jet' && distanceNm(leg.from.lat, leg.from.lon, leg.to.lat, leg.to.lon) > 400) {
      this.adequate ??= [...this.airports.values()]
        .filter((a) => a.large && !a.site && a.runways.some((r) => r.lengthNm >= 1.23))
        .map((a) => ({ ident: a.ident, name: a.name, lat: a.lat, lon: a.lon, ...(a.iata ? { iata: a.iata } : {}) }));
      const pts: [number, number][] = [];
      for (const s of leg.segs) {
        if (Number.isNaN(s.alt0)) continue;
        if (s.kind === 'path' && s.pts) for (const p of s.pts) pts.push(p);
        else pts.push(s.a, s.b);
      }
      out = etopsFor(pts, this.adequate, af.type.cls === 'wide' ? 410 : 380);
    }
    this.etopsCache.set(leg, out);
    return out;
  }

  /** Real navaids (OurAirports) used for procedure-style routes. */
  setNavaids(rows: [string, string, number, number, number, number, string][]) {
    this.nav = new NavDb(rows);
  }

  /** OpenStreetMap taxiway network for one airport; future taxi movements follow it. */
  setTaxiGraph(ident: string, g: TaxiGraph, now: number) {
    this.ground.set(ident, g);
    const a = this.airports.get(ident);
    if (!a) return;
    // Movements planned before the network was known were straight lines: put them on the
    // taxiway centre lines (timing kept). A taxi already under way is split at "now" so the
    // aircraft continues from where it is; departures are re-planned to the holding point
    // and line up through the entry taxiway.
    const same = (p: Pt, q: Pt) => p === q || (p[0] === q[0] && p[1] === q[1]);
    for (const af of this.airframes) {
      const leg = af.leg;
      if (leg.from !== a && leg.to !== a) continue;
      const turn = af.type.cls === 'wide' ? 0.024 : 0.016;
      for (let i = 0; i < leg.segs.length; i++) {
        const s = leg.segs[i]!;
        if (s.phase !== 'taxi' || s.kind !== 'line' || s.t1 <= now || distanceNm(s.a[0], s.a[1], s.b[0], s.b[1]) < 0.15) continue;
        const out = s.t0 < leg.tTakeoff;
        if ((out ? leg.from : leg.to) !== a) continue;
        const rwy = out ? (leg.taxiOut?.runway ?? (a.inUseDep ?? a.inUse).ident) : (leg.taxiIn?.runway ?? a.inUse.ident);
        const started = s.t0 <= now;
        const f = started ? (now - s.t0) / Math.max(1, s.t1 - s.t0) : 0;
        const from: Pt = started ? [s.a[0] + (s.b[0] - s.a[0]) * f, s.a[1] + (s.b[1] - s.a[1]) * f] : s.a;
        const rw = out ? a.runways.find((r) => r.ident === rwy) : undefined;
        const entry = rw ? this.runwayEntry(a, rw) : null;
        const plan = this.taxiPlan(a, from, entry?.entry ?? s.b, out ? 'out' : 'in', rwy, turn);
        if (!plan || plan.pts.length < 2) continue;
        const total = plan.cum[plan.cum.length - 1]!;
        let pts = plan.pts;
        let upTo = total;
        if (entry) {
          upTo = Math.max(0, total - 0.05);
          if (entry.hold) {
            const h = nearestAlong(plan.pts, plan.cum, entry.hold.pt);
            if (h > total - 0.15 && h < total - 0.01) upTo = h;
            else delete entry.hold;
          }
          pts = slice(plan.pts, plan.cum, 0, upTo);
          // Holding-point waits move to the new holding point; the line-up follows the entry.
          const oldEnd = s.b;
          const newEnd = pts[pts.length - 1]!;
          const thr: Pt = [rw!.lat, rw!.lon];
          for (let j = i + 1; j < leg.segs.length; j++) {
            const n = leg.segs[j]!;
            if (n.phase !== 'taxi') break;
            if (same(n.a, oldEnd) && same(n.b, oldEnd)) {
              n.a = n.b = newEnd;
            } else if (same(n.a, oldEnd)) {
              const lp = fillet([...slice(plan.pts, plan.cum, upTo, total), entry.lineup, ...(same(entry.lineup, thr) ? [] : [thr])], turn);
              n.kind = 'path';
              n.a = lp[0]!;
              n.pts = lp;
              n.cum = cumulative(lp);
              n.b = lp[lp.length - 1]!;
              break;
            }
          }
        }
        const cum = cumulative(pts);
        const t0 = started ? now : s.t0;
        const kt = Math.min(25, cum[cum.length - 1]! / Math.max(1e-6, (s.t1 - t0) / H));
        const seg: Seg = { ...s, kind: 'path', a: pts[0]!, b: pts[pts.length - 1]!, pts, cum, t0, spd0: kt, spd1: kt };
        if (started) {
          // Keep the part already driven; continue on the network from here.
          leg.segs.splice(i, 1, { ...s, b: from, t1: now }, seg);
          i++;
        } else leg.segs[i] = seg;
        const info: TaxiInfo = { via: plan.via, crossings: plan.crossings.filter((c) => c.s < upTo).map((c) => c.runway), runway: rwy };
        if (entry?.hold) info.hold = entry.hold.ref;
        else if (plan.hold) info.hold = plan.hold;
        if (out) leg.taxiOut = info;
        else leg.taxiIn = { ...info, ...(leg.taxiIn?.exit ? { exit: leg.taxiIn.exit } : {}) };
      }
    }
  }

  hasTaxiGraph(ident: string) {
    return this.ground.has(ident);
  }

  /** Real weather (METAR) for an airport: sets the runway in use and capacity. */
  setWeather(ident: string, w: SimWeather) {
    const a = this.airports.get(ident);
    if (!a) return;
    a.weather = w;
    if (a.runways.length && w.windDir !== undefined && (w.windKt ?? 0) >= 3) {
      a.windDir = w.windDir;
      a.inUseBasis = 'metar';
      this.rwyAt.delete(a.ident);
      this.runwaysAt(a, w.observedAt ?? this.lastNow);
    }
  }

  private rwyAt = new Map<string, number>();
  private lastNow = 0;
  /** Airports whose runway use changes with the time of day (alternation). */
  private alternating = new Set<SimAirport>();

  /**
   * Arrival and departure runways at time `t`: into the wind, segregated on independent
   * parallels (with Heathrow-style alternation). Pure: does not change the airport.
   */
  runwaysFor(a: SimAirport, t: number): { arr: SimRunway; dep: SimRunway; segregated: boolean } {
    if (!a.runways.length || a.windDir === undefined) return { arr: a.inUse, dep: a.inUseDep ?? a.inUse, segregated: !!a.inUseDep };
    const base = bestRunway(a.runways, a.windDir);
    const pair = a.large ? segregatedPair(a.runways, base, a.ident, t, a.lon) : undefined;
    return pair ? { ...pair, segregated: true } : { arr: base, dep: base, segregated: false };
  }

  /** Sets the airport's runways in use for "now" (what boards, radio and the map show). */
  runwaysAt(a: SimAirport, t: number) {
    if (!a.runways.length || a.windDir === undefined) return;
    const bucket = Math.floor(t / (5 * MIN));
    if (this.rwyAt.get(a.ident) === bucket) return;
    this.rwyAt.set(a.ident, bucket);
    const r = this.runwaysFor(a, t);
    a.inUse = r.arr;
    if (r.segregated) a.inUseDep = r.dep;
    else delete a.inUseDep;
    if (r.segregated && ALTERNATING_IDENTS.has(a.ident)) this.alternating.add(a);
  }

  /** Real forecast (TAF): hourly capacity factors used for slots further ahead. */
  setForecast(ident: string, hours: { t: number; capacity: number }[]) {
    const a = this.airports.get(ident);
    if (a) a.forecast = hours;
  }

  /** The day's simulated North Atlantic tracks. */
  natTracks(t: number): NatTrack[] {
    return natTracks(t, this.seed);
  }

  /** The day's simulated volcanic-ash advisory, if any. */
  ash(t: number): Zone | null {
    const day = Math.floor(t / 86_400_000);
    if (!this.ashCache.has(day)) this.ashCache.set(day, ashAdvisory(t, this.seed));
    return this.ashCache.get(day) ?? null;
  }

  /** Airspace an operator must avoid at time `t`: standing closures plus any ash advisory. */
  zonesAt(t: number): Zone[] {
    const a = this.ash(t);
    return a ? [...STANDING_ZONES, a] : STANDING_ZONES;
  }

  /** Daily runway closures: snow clearing when it snows, occasional inspections. */
  private closuresFor(a: SimAirport, t: number) {
    if (!a.large) return;
    const day = Math.floor(t / 86_400_000);
    const list = a.closures ?? (a.closures = []);
    const key = day * 86_400_000;
    if (list.some((c) => c.from >= key && c.from < key + 86_400_000)) return;
    const rng = new Rng((hash(`${a.ident}${day}`) % 2147483646) + 1);
    // Runway inspection or bird dispersal: about one airport in six on a given day, 15–30 minutes.
    if (rng.next() < 0.16) {
      const from = key + rng.range(6, 21) * H - (a.lon / 15) * H;
      list.push({ from, to: from + rng.range(15, 30) * MIN, reason: rng.next() < 0.5 ? 'Runway inspection' : 'Bird dispersal on the runway' });
    }
    // Snow: the runway is closed for 20–30 minutes every couple of hours for clearing.
    if (a.weather?.wx && /SN/.test(a.weather.wx) && (a.weather.tempC ?? 5) <= 1) {
      for (let h0 = 0; h0 < 24; h0 += rng.range(1.8, 2.6)) {
        const from = key + h0 * H;
        list.push({ from, to: from + rng.range(20, 30) * MIN, reason: 'Snow clearing' });
      }
    }
    if (list.length > 40) list.splice(0, list.length - 40);
  }

  // -------------------------------------------------------------- identity

  private hexFor(iso: string, block?: [number, number]): string {
    const b = block ?? icaoBlock(iso) ?? icaoBlock('US')!;
    for (let i = 0; i < 50; i++) {
      const v = b[0] + Math.floor(this.rng.next() * (b[1] - b[0]));
      if (!this.usedHex.has(v)) {
        this.usedHex.add(v);
        return v.toString(16).padStart(6, '0');
      }
    }
    return (b[0] + ++this.counter).toString(16).padStart(6, '0');
  }

  private regFor(pattern: string): string {
    const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
    return pattern.replace(/[L#]/g, (c) => (c === 'L' ? L[Math.floor(this.rng.next() * L.length)]! : String(Math.floor(this.rng.next() * 10))));
  }

  private squawkFor(): string {
    for (;;) {
      const s = Array.from({ length: 4 }, () => this.rng.int(0, 7)).join('');
      if (!['7500', '7600', '7700', '7000', '1200', '0000', '0020', '2000'].includes(s)) return s;
    }
  }

  private newAirframe(type: TypeInfo, hex: string, reg: string, role: Role, squawk: string): Airframe {
    return { n: this.airframes.length + 1, hex, reg, type, role, squawk, turnMs: 0, leg: undefined as unknown as Leg, history: [], seq: this.rng.int(1, 89) };
  }

  // -------------------------------------------------------------- population

  populate(now: number, scale: number) {
    for (const al of AIRLINES) {
      const hubs = al.hubs.map((h) => this.airports.get(h)).filter((a): a is SimAirport => !!a);
      if (!hubs.length) continue;
      const count = Math.max(2, Math.round(al.size * scale));
      for (let i = 0; i < count; i++) {
        const type = TYPES[this.rng.weighted(al.fleet)]!;
        const hub = this.rng.pick(hubs);
        const af = this.newAirframe(type, this.hexFor(al.country), this.regFor(al.reg), 'airline', this.squawkFor());
        af.airline = al;
        const acmi = acmiFor(al.icao, type.code, type.cls, now, hajjWeight(now, 'OEJN', al.country), (hash(`${af.hex}acmi`) % 100_000) / 100_000);
        if (acmi) {
          // Wet lease: the lessor's aircraft, registration and crew; the airline's flight numbers.
          af.acmi = acmi;
          af.hex = this.hexFor(acmi.country);
          af.reg = acmi.prefix + this.regFor(acmi.reg);
        }
        af.turnMs = this.turnaround(af, now, hub);
        // A handful of brand-new aircraft are on their delivery flight from the factory.
        const centre = this.rng.next() < 0.0015 ? DELIVERY_CENTRES.find((c) => c.maker.test(type.code)) : undefined;
        const factory = centre ? this.airports.get(centre.airport) : undefined;
        if (factory && factory !== hub) {
          af.leg = this.buildLeg(af, factory, hub, this.startTime(af, factory, hub, now), undefined, { kind: 'delivery' });
        } else {
          const dest = this.chooseDestination(af, hub, now);
          // Half the fleet starts on an inbound leg so hubs see arrivals as well as departures.
          const [from, to] = this.rng.next() < 0.5 && dest !== hub ? [dest, hub] : [hub, dest];
          af.leg = this.buildLeg(af, from, to, this.startTime(af, from, to, now));
        }
        this.airframes.push(af);
      }
    }
    // General aviation & helicopters: local hops and circuits between nearby airfields.
    const gaCount = Math.round(1600 * scale);
    for (let i = 0; i < gaCount; i++) {
      const c = this.rng.weighted(GA_COUNTRIES.map((g) => [g, g.share] as [(typeof GA_COUNTRIES)[number], number]));
      const pool = this.gaPools.get(c.iso) ?? this.byCountry.get(c.iso);
      const home = pool?.pick(this.rng);
      if (!home) continue;
      const type = TYPES[this.rng.weighted(GA_TYPES)]!;
      const af = this.newAirframe(type, this.hexFor(c.iso), this.regFor(c.reg), 'ga', c.squawk);
      af.ga = { squawk: c.squawk };
      af.home = home;
      af.turnMs = this.turnaround(af, now, home);
      const to = this.chooseDestination(af, home, now);
      af.leg = this.buildLeg(af, home, to, this.startTime(af, home, to, now));
      this.airframes.push(af);
    }
    this.populateMilitary(now, scale);
    this.populateAirAmbulance(now, scale);
  }

  private populateMilitary(now: number, scale: number) {
    for (const op of MILITARY) {
      const bases = op.bases.map((b) => this.airports.get(b)).filter((a): a is SimAirport => !!a);
      if (!bases.length) continue;
      const count = Math.max(1, Math.round(op.size * Math.min(1, scale * 1.2)));
      for (let i = 0; i < count; i++) {
        const [code, , role] = this.rng.weighted(op.fleet.map((f) => [f, f[1]] as [[string, number, MilRole], number]));
        const type = TYPES[code];
        if (!type) continue;
        const af = this.newAirframe(type, this.hexFor(op.country, op.hex), this.regFor(op.reg), 'mil', this.squawkFor());
        af.op = { icao: op.icao, tel: op.tel, name: op.name, country: op.country };
        af.milRole = role;
        af.home = this.rng.pick(bases);
        af.turnMs = this.turnaround(af, now, af.home);
        const [from, to, plan] = this.milNext(af, op, af.home, now);
        af.leg = this.buildLeg(af, from, to, this.startTime(af, from, to, now), undefined, { kind: plan ? (role === 'tanker' ? 'tanker' : role === 'awacs' ? 'awacs' : role === 'patrol' ? 'patrol' : 'training') : 'military', mission: plan });
        this.airframes.push(af);
      }
    }
  }

  private populateAirAmbulance(now: number, scale: number) {
    for (const op of AIR_AMBULANCE) {
      const bases = op.bases.map((b) => this.airports.get(b)).filter((a): a is SimAirport => !!a);
      if (!bases.length) continue;
      for (let i = 0; i < Math.max(1, Math.round(op.count * Math.min(1, scale * 1.3))); i++) {
        const type = TYPES[this.rng.weighted(op.types)]!;
        const af = this.newAirframe(type, this.hexFor(op.country), this.regFor(op.reg), 'ambulance', this.squawkFor());
        af.op = { icao: op.icao, tel: op.tel, name: op.name, country: op.country };
        af.home = this.rng.pick(bases);
        af.turnMs = this.turnaround(af, now, af.home);
        const to = this.ambulanceDestination(af.home, type);
        af.leg = this.buildLeg(af, af.home, to, this.startTime(af, af.home, to, now), undefined, { kind: 'ambulance' });
        this.airframes.push(af);
      }
    }
  }

  /**
   * Helicopter and glider operations that need the heliport / gliding-site datasets
   * (loaded after the world starts). Rows: [ident, name, lat, lon, country, kind, elev].
   */
  populateExtra(now: number, scale: number, heli: [string, string, number, number, string, number, number | null][], gliding: [string, string, number, number, string, number | null][]) {
    const mk = (ident: string, name: string, lat: number, lon: number, country: string, elev: number | null, site: SiteKind): SimAirport => {
      const rw: SimRunway = { ident: 'H', lat, lon, hdg: 0, lengthNm: 0.05 };
      return { ident, name, lat, lon, country, elev: elev ?? 0, large: false, scheduled: false, runways: [], strips: [], inUse: rw, inUseBasis: 'simulated', site };
    };
    const hospitals = heli.filter((r) => r[5] === 1).map((r) => mk(r[0], r[1], r[2], r[3], r[4], r[6], 'hospital'));
    const platforms = heli.filter((r) => r[5] === 2).map((r) => mk(r[0], r[1], r[2], r[3], r[4], r[6], 'offshore'));
    const cityPads = heli.filter((r) => r[5] === 0).map((r) => mk(r[0], r[1], r[2], r[3], r[4], r[6], 'heliport'));
    this.sites = [...hospitals, ...platforms, ...cityPads];
    const near = (list: SimAirport[], p: { lat: number; lon: number }, maxNm: number) => list.filter((s) => Math.abs(s.lat - p.lat) < maxNm / 60 + 0.1 && distanceNm(s.lat, s.lon, p.lat, p.lon) <= maxNm);

    // HEMS: helicopters based at hospital pads; each mission flies to a scene, then to a hospital.
    for (const op of HEMS) {
      const pads = hospitals.filter((h) => h.country === op.country);
      if (pads.length < 3) continue;
      const n = Math.max(2, Math.round(op.count * Math.min(1, scale * 1.3)));
      for (let i = 0; i < n; i++) {
        const base = this.rng.pick(pads);
        const type = TYPES[this.rng.weighted(op.types)]!;
        const af = this.newAirframe(type, this.hexFor(op.country), this.regFor(op.reg), 'hems', op.squawk);
        af.op = { icao: op.icao, tel: op.tel, name: op.name, country: op.country };
        af.home = base;
        af.seq = this.rng.int(1, 80);
        af.turnMs = this.rng.range(30, 240) * MIN;
        const scene = this.sceneNear(base);
        af.leg = this.buildHeliLeg(af, base, scene, now - this.rng.range(-2, 0.6) * H, 'hems');
        this.airframes.push(af);
      }
    }
    // Offshore shuttles from the real base airports to platforms in the region.
    for (const op of OFFSHORE) {
      const base = this.airports.get(op.base);
      const [s, w, nN, e] = op.region;
      const rigs = platforms.filter((p) => p.lat >= s && p.lat <= nN && p.lon >= w && p.lon <= e && distanceNm(p.lat, p.lon, base?.lat ?? 0, base?.lon ?? 0) < 260);
      if (!base || !rigs.length) continue;
      for (let i = 0; i < Math.max(1, Math.round(op.count * Math.min(1, scale * 1.3))); i++) {
        const type = TYPES[this.rng.weighted(op.types)]!;
        const af = this.newAirframe(type, this.hexFor(op.country), this.regFor(op.reg), 'offshore', this.squawkFor());
        af.op = { icao: op.icao, tel: op.tel, name: `${op.tel[0]}${op.tel.slice(1).toLowerCase()} offshore`, country: op.country };
        af.home = base;
        af.turnMs = this.rng.range(60, 200) * MIN;
        const rig = this.rng.pick(rigs);
        af.leg = this.buildHeliLeg(af, base, rig, now - this.rng.range(-1.5, 1.5) * H, 'offshore');
        this.airframes.push(af);
      }
    }
    // City shuttles between heliports and the nearby airport.
    for (const op of SHUTTLES) {
      const ap = this.airports.get(op.airport);
      if (!ap) continue;
      const pads = near(cityPads, ap, 30);
      if (!pads.length) continue;
      for (let i = 0; i < Math.max(1, Math.round(op.count * Math.min(1, scale * 1.3))); i++) {
        const type = TYPES[this.rng.weighted(op.types)]!;
        const af = this.newAirframe(type, this.hexFor(op.country), this.regFor(op.reg), 'shuttle', this.squawkFor());
        af.op = { icao: op.icao, tel: op.tel, name: `${op.tel[0]}${op.tel.slice(1).toLowerCase()} helicopter shuttle`, country: op.country };
        af.home = ap;
        af.turnMs = this.rng.range(15, 60) * MIN;
        const pad = this.rng.pick(pads);
        const out = this.rng.next() < 0.5;
        af.leg = this.buildHeliLeg(af, out ? pad : ap, out ? ap : pad, now - this.rng.range(-1, 0.4) * H, 'shuttle');
        this.airframes.push(af);
      }
    }
    // Gliding clubs: gliders and a tow plane at each active site.
    const sites = gliding.map((r) => mk(r[0], r[1], r[2], r[3], r[4], r[5], 'glider'));
    const active = sites.filter(() => this.rng.next() < Math.min(1, 0.55 * scale + 0.2));
    for (const site of active) {
      const n = this.rng.int(1, 4);
      const reg = GLIDER_REG[site.country] ?? 'D-####';
      for (let i = 0; i <= n; i++) {
        const tow = i === 0;
        const type = TYPES[this.rng.weighted(tow ? TOW_TYPES : GLIDER_TYPES)]!;
        const af = this.newAirframe(type, this.hexFor(site.country), this.regFor(tow ? reg.replace(/#{4}/, 'ELLL') : reg), tow ? 'tow' : 'glider', '7000');
        af.home = site;
        af.turnMs = this.rng.range(10, 40) * MIN;
        const t0 = this.releaseTime(af, site, now - this.rng.range(0, 3) * H);
        af.leg = tow ? this.buildTowLeg(af, site, t0) : this.buildGliderLeg(af, site, t0);
        this.airframes.push(af);
      }
    }
  }

  /** An incident scene for an air ambulance: a random point 5–30 NM from base (on land, near roads). */
  private sceneNear(base: SimAirport): SimAirport {
    const [lat, lon] = destination(base.lat, base.lon, this.rng.range(0, 360), this.rng.range(5, 30));
    return { ident: 'SCENE', name: 'Incident scene', lat, lon, country: base.country, elev: base.elev, large: false, scheduled: false, runways: [], strips: [], inUse: base.inUse, inUseBasis: 'simulated', site: 'scene' };
  }

  /** Nearest hospital pad to a point (other than `not`). */
  private hospitalNear(p: { lat: number; lon: number }, country: string, not?: SimAirport): SimAirport | undefined {
    let best: SimAirport | undefined;
    let bd = 60;
    for (const s of this.sites) {
      if (s.site !== 'hospital' || s.country !== country || s === not || Math.abs(s.lat - p.lat) > 1) continue;
      const d = distanceNm(p.lat, p.lon, s.lat, s.lon);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  /** Start each airframe at a random point of its cycle so the world begins "mid-day". */
  private startTime(af: Airframe, from: SimAirport, to: SimAirport, now: number) {
    const dist = distanceNm(from.lat, from.lon, to.lat, to.lon);
    const dur = (dist / (af.type.kt * 0.88)) * H + 30 * MIN;
    const u = this.rng.range(-af.turnMs / (dur + af.turnMs), 1);
    return this.releaseTime(af, from, now - u * dur);
  }

  /**
   * When a departure planned for `tOff` may actually leave:
   *  • most scheduled flying stops overnight (00:00–05:00 local): released into the morning wave;
   *  • all-cargo operators fly night banks;
   *  • light aircraft and gliders fly VFR in daylight only (gliders: in the soaring season);
   *  • fighter training happens on weekdays in daytime.
   */
  private releaseTime(af: Airframe, from: SimAirport, tOff: number): number {
    const localH = localHour(tOff, from.lon);
    const t = af.type;
    if (af.role === 'glider' || af.role === 'tow' || (af.role === 'ga' && (t.cls === 'light' || t.cls === 'glider'))) {
      const { rise, set } = daylight(tOff, from.lat);
      const glide = af.role === 'glider' || af.role === 'tow';
      const open = glide ? Math.max(rise + 2.5, 9.5) : rise + 0.5;
      const close = glide ? Math.min(set - 1, 18.5) : set - 1;
      // Gliding is a summer sport: in the off-season clubs fly mostly at weekends.
      const m = new Date(tOff).getUTCMonth();
      const summer = from.lat >= 0 ? m >= 3 && m <= 8 : m <= 2 || m >= 9;
      const wd = localWeekday(tOff, from.lon);
      const weekend = wd === 0 || wd === 6;
      if (glide && !summer && !weekend) return tOff + (24 - localH + open + this.rng.range(0, 3)) * H + (wd === 5 ? 0 : (6 - wd) * 24 * H * 0.0);
      if (close <= open) return tOff + (24 - localH + 9) * H;
      if (localH < open) return tOff + (open - localH + this.rng.range(0, 2)) * H;
      if (localH > close) return tOff + (24 - localH + open + this.rng.range(0, 3)) * H;
      return tOff;
    }
    if (af.role === 'mil' && af.milRole === 'fighter') {
      const wd = localWeekday(tOff, from.lon);
      if (wd === 0 || wd === 6) return tOff + (24 - localH + 8 + this.rng.range(0, 2)) * H + (wd === 6 ? 24 * H : 0);
      if (localH < 8) return tOff + (8 - localH + this.rng.range(0, 1.5)) * H;
      if (localH > 17) return tOff + (24 - localH + 8 + this.rng.range(0, 1.5)) * H;
      return tOff;
    }
    if (af.role !== 'airline') return tOff;
    if (af.airline && CARGO.has(af.airline.icao)) {
      if (localH >= 6 && localH < 18 && this.rng.next() < 0.75) return tOff + (19 - localH + this.rng.range(0, 7)) * H;
      return tOff;
    }
    const night = t.cls === 'wide' || af.airline?.fleet.every(([c]) => TYPES[c]?.cls === 'wide') ? 0.3 : 0.9;
    if (localH < 5 && this.rng.next() <= night) {
      // Released into the morning bank, spread over about three hours.
      return tOff + (5 - localH) * H + this.rng.range(0, 1) ** 1.6 * 180 * MIN;
    }
    // Network carriers run connecting banks at their hubs: departures leave in waves.
    const al = af.airline;
    // About six in ten of their hub departures keep to the bank structure; the rest fly when ready.
    if (al && this.airlineModel(al) === 'full' && al.hubs.includes(from.ident) && from.large && this.rng.next() < 0.6) {
      const period = al.size > 150 ? 2 : 3; // hours between banks
      const offset = (hash(al.icao + from.ident) % 60) / 60;
      const phase = (((localH - offset) % period) + period) % period;
      const window = period * 0.6; // each bank's departures spread over 70–110 minutes
      if (phase > window) return tOff + (period - phase + this.rng.range(0, window * 0.5)) * H;
    }
    return tOff;
  }

  /** Ground time after arriving at `at` at time `t` (weekday patterns included). */
  private turnaround(af: Airframe, t: number, at: SimAirport) {
    const c = af.type.cls;
    let min = c === 'wide' ? 100 : c === 'narrow' ? 45 : c === 'regional' || c === 'turboprop' ? 35 : c === 'bizjet' ? 120 : c === 'glider' ? 20 : 60;
    let kind: 'airline' | 'cargo' | 'ga' | 'bizjet' = 'airline';
    if (af.role === 'ga') kind = c === 'bizjet' ? 'bizjet' : 'ga';
    else if (af.airline && CARGO.has(af.airline.icao)) kind = 'cargo';
    if (af.airline) {
      // Airline business model: low-cost carriers turn narrow-bodies in 25–35 minutes.
      const model = this.airlineModel(af.airline);
      if (model === 'low') min = c === 'wide' ? 75 : 25;
      else if (model === 'regional') min = 25;
      else if (model === 'leisure' || model === 'charter') min = c === 'wide' ? 90 : 40;
      else if (model === 'cargo') min = c === 'wide' ? 150 : 70;
    }
    if (af.role === 'mil') min = af.milRole === 'fighter' ? 150 : af.milRole === 'transport' ? 240 : 360;
    if (af.role === 'ambulance') min = 90;
    const f = af.role === 'airline' || af.role === 'ga' ? weekdayGroundFactor(localWeekday(t, at.lon), kind) : 1;
    return this.rng.range(min, min * 2) * MIN * f;
  }

  private airlineModel(al: AirlineProfile | undefined): AirlineModel {
    if (!al) return 'bizjet';
    return AIRLINE_EXTRA[al.icao]?.model ?? (CARGO.has(al.icao) ? 'cargo' : 'full');
  }

  private chooseDestination(af: Airframe, from: SimAirport, tOff: number): SimAirport {
    const t = af.type;
    if (af.ga) {
      const light = t.cls === 'light';
      // A third of light-aircraft flights are circuits (touch-and-go practice) at home.
      if (light && this.rng.next() < 0.33) return from;
      const pool = this.gaPools.get(from.country) ?? this.byCountry.get(from.country);
      for (let i = 0; i < 25; i++) {
        const a = pool?.pick(this.rng);
        if (!a || a === from) continue;
        const d = distanceNm(from.lat, from.lon, a.lat, a.lon);
        if (d >= 15 && d <= (t.cls === 'heli' ? 80 : t.cls === 'turboprop' ? 400 : 180)) return a;
      }
      return from; // local flight
    }
    const al = af.airline!;
    const model = this.airlineModel(al);
    const atHub = al.hubs.includes(from.ident);
    if (!atHub && this.rng.next() < 0.85) {
      const hub = this.airports.get(this.rng.pick(al.hubs));
      if (hub && hub !== from && distanceNm(from.lat, from.lon, hub.lat, hub.lon) <= t.range) return hub;
    }
    const min = t.cls === 'wide' ? 700 : t.cls === 'turboprop' ? 60 : 120;
    const max = t.range * 0.92;
    // Wide-bodies serve large airports only (no A380s into regional fields).
    const fits = (a: SimAirport) => t.cls !== 'wide' || a.large;
    const weekday = localWeekday(tOff, from.lon);
    // Days of operation and seasonal demand (leisure, ski, winter sun).
    const accept = (a: SimAirport, d: number) => {
      const leisure = leisureOf(a.ident, a.lat, a.lon);
      const w = seasonalWeight(leisure, tOff, model);
      if (this.rng.next() > Math.min(1, w / 1.9)) return false;
      const days = routeDays(al.icao, from.ident, a.ident, { distNm: d, hubEnd: atHub || al.hubs.includes(a.ident), bothLarge: from.large && a.large, leisure, model });
      return operatesOn(days, weekday);
    };
    const domestic = this.rng.next() < al.dom;
    // International flying follows world markets (gravity model with regional affinities).
    const ok = (a: SimAirport) => !this.closedAirports.has(a) && this.servable(al.country, a.country);
    for (let i = 0; i < 90; i++) {
      let pool: WeightedPool | undefined = domestic ? this.byCountry.get(from.country) : undefined;
      if (!pool) {
        const fromR = regionOf(from.country);
        // Long-haul aircraft serve far-away markets: nearby regions count for little.
        const longHaul = t.cls === 'wide';
        pool =
          (longHaul ? this.longPools : this.regionPools).get(
            this.rng.weighted(
              REGIONS.filter((r) => this.regionPools.has(r)).map((r) => [r, affinity(fromR, r) * (longHaul && (r === fromR || NEAR_REGIONS.has(`${fromR}${r}`)) ? 0.15 : 1)] as [Region, number]),
            ),
          ) ?? this.scheduledPool;
      }
      const a = pool.pick(this.rng);
      if (!a || a === from || !fits(a) || !ok(a)) continue;
      if (!domestic && a.country === from.country && this.rng.next() < 0.85) continue;
      const d = distanceNm(from.lat, from.lon, a.lat, a.lon);
      if (d >= min && d <= max && this.rng.next() < Math.min(1, hajjWeight(tOff, a.ident, al.country) / 2) * 2 && accept(a, d)) return a;
    }
    for (let i = 0; i < 80; i++) {
      const a = this.scheduledPool.pick(this.rng);
      if (!a || a === from || !fits(a) || !ok(a)) continue;
      const d = distanceNm(from.lat, from.lon, a.lat, a.lon);
      if (d >= 80 && d <= max) return a;
    }
    return this.airports.get(al.hubs[0]!) ?? from;
  }

  /**
   * Whether an airline from one country may serve another: Russian airlines are banned
   * from the EU, UK and North America (and vice versa); Belarusian airlines likewise.
   */
  private servable(airlineCountry: string, destCountry: string): boolean {
    const west = (c: string) => STANDING_ZONES.find((z) => z.id === 'RU')!.avoidBy !== 'all' && (STANDING_ZONES.find((z) => z.id === 'RU')!.avoidBy as Set<string>).has(c);
    if ((airlineCountry === 'RU' || airlineCountry === 'BY') && west(destCountry)) return false;
    if ((destCountry === 'RU' || destCountry === 'BY') && west(airlineCountry)) return false;
    // Countries under sanctions or conflict are served almost only by airlines of the region.
    if (RESTRICTED.has(destCountry) && airlineCountry !== destCountry) {
      const r = regionOf(airlineCountry);
      if (!(r === 'MEA' || r === 'CAS' || ['TR', 'RU', 'QA', 'AE', 'IQ', 'EG', 'ET', 'KE', 'PK', 'CN'].includes(airlineCountry))) return false;
    }
    return true;
  }

  /** Air-ambulance transfer: another airport 60–600 NM away in the same country. */
  private ambulanceDestination(from: SimAirport, t: TypeInfo): SimAirport {
    const pool = this.byCountry.get(from.country) ?? this.scheduledPool;
    for (let i = 0; i < 40; i++) {
      const a = pool.pick(this.rng);
      if (!a || a === from) continue;
      const d = distanceNm(from.lat, from.lon, a.lat, a.lon);
      if (d >= 60 && d <= Math.min(600, t.range * 0.7)) return a;
    }
    return from;
  }

  /** Next military sortie: transport between bases, or a mission (orbit / training area). */
  private milNext(af: Airframe, op: MilOperator, at: SimAirport, tOff: number): [SimAirport, SimAirport, MissionPlan | undefined] {
    const role = af.milRole ?? 'transport';
    const home = af.home ?? at;
    if (role === 'transport') {
      const bases = op.bases.map((b) => this.airports.get(b)).filter((a): a is SimAirport => !!a && a !== at);
      const reach = bases.filter((b) => distanceNm(at.lat, at.lon, b.lat, b.lon) <= af.type.range * 0.9);
      const to = at !== home && this.rng.next() < 0.6 ? home : reach.length ? this.rng.pick(reach) : home;
      return [at, to === at ? home : to, undefined];
    }
    if (at !== home) return [at, home, undefined];
    const m = MIL_MISSION[role];
    const crs = this.rng.range(0, 360);
    const area = destination(home.lat, home.lon, crs, this.rng.range(m.offNm[0], m.offNm[1]));
    const plan: MissionPlan = { role, area, ft: m.ft + this.rng.int(-3, 3) * 1000, durMs: this.rng.range(m.orbitMin[0], m.orbitMin[1]) * MIN, legNm: m.legNm, crs: this.rng.range(0, 360) };
    void tOff;
    return [home, home, plan];
  }

  // -------------------------------------------------------------- stands & slots

  /** Stand candidates for an operator at an airport: its terminal, cargo apron or GA apron. */
  private standPool(a: SimAirport, af: Airframe, other: SimAirport): number[] {
    const al = af.airline;
    const cargo = !!al && CARGO.has(al.icao);
    const model = this.airlineModel(al);
    const domestic = other.country === a.country;
    const schengen = SCHENGEN.has(other.country) && SCHENGEN.has(a.country);
    const key = `${a.ident}|${al?.icao ?? af.role}|${domestic ? 1 : 0}${schengen ? 1 : 0}|${af.type.cls === 'wide' ? 'w' : ''}`;
    const hit = this.standPools.get(key);
    if (hit) return hit;
    const stands = a.stands ?? [];
    const idx = (f: (s: Stand) => boolean) => stands.map((s, i) => (f(s) ? i : -1)).filter((i) => i >= 0);
    let pool: number[] = [];
    if (!al) pool = idx((s) => s.kind === 3);
    else if (cargo) pool = idx((s) => s.kind === 2);
    else {
      const alliance = ALLIANCES.find((x) => x.members.includes(al.icao))?.name;
      const who: Parameters<typeof terminalFor>[2] = { icao: al.icao, domestic, schengen, lowCost: model === 'low', cargo };
      if (alliance) who.alliance = alliance;
      let term = a.terminals?.length ? terminalFor(a.ident, a.terminals, who) : -1;
      // No published allocation: the same alliance or airline always shares a terminal.
      if (term < 0 && a.terminals?.length) {
        const real = a.terminals.map((n, i) => [n, i] as const).filter(([n]) => /terminal/i.test(n));
        if (real.length) term = real[hash(alliance ?? al.icao) % real.length]![1];
      }
      if (term >= 0) pool = idx((s) => s.term === term && (s.kind === 0 || (model === 'low' && s.kind === 1)));
      if (pool.length < 3) pool = idx((s) => s.kind === 0 || s.kind === 1);
    }
    if (pool.length < 2) pool = idx((s) => s.kind !== 3 || !al);
    // Wide-bodies need wide-body stands where the airport has them.
    if (af.type.cls === 'wide') {
      const wide = pool.filter((i) => stands[i]!.wide);
      if (wide.length >= 2) pool = wide;
    }
    this.standPools.set(key, pool);
    return pool;
  }

  /** A free stand (OpenStreetMap) or a plausible apron position. */
  private takeStand(a: SimAirport, from: number, until: number, af: Airframe, other: SimAirport): StandRef {
    const ok = !!a.stands?.length && (af.role === 'airline' || af.type.cls === 'bizjet' || af.role === 'mil' || af.role === 'ambulance');
    if (ok) {
      const pool = this.standPool(a, af, other);
      for (let i = 0; i < 14 && pool.length; i++) {
        const k = pool[Math.floor(this.rng.next() * pool.length)]!;
        const key = `${a.ident}|${k}`;
        if ((this.standBusy.get(key) ?? 0) <= from) {
          this.standBusy.set(key, until);
          const s = a.stands![k]!;
          const r: StandRef = { pt: [s.lat, s.lon], hdg: s.hdg ?? bearingDeg(s.lat, s.lon, a.lat, a.lon), kind: s.kind };
          if (s.ref) r.ref = s.ref;
          if (s.term >= 0 && a.terminals?.[s.term]) r.terminal = a.terminals[s.term]!;
          return r;
        }
      }
    }
    const pt = destination(a.lat, a.lon, a.inUse.hdg + 90 + this.rng.range(-50, 50), this.rng.range(0.15, 0.55));
    return { pt, hdg: bearingDeg(pt[0], pt[1], a.lat, a.lon) };
  }

  private holdStand(a: SimAirport, s: StandRef, until: number) {
    if (!a.stands) return;
    const k = a.stands.findIndex((x) => x.lat === s.pt[0] && x.lon === s.pt[1]);
    if (k >= 0) this.standBusy.set(`${a.ident}|${k}`, Math.max(until, this.standBusy.get(`${a.ident}|${k}`) ?? 0));
  }

  /** Weather factor on runway capacity at time `t` (METAR now, TAF beyond the next half hour). */
  private weatherFactor(a: SimAirport, t: number): number {
    const ash = this.ash(t);
    if (ash && pointInZones([a.lat, a.lon], [ash], undefined)) return 0.25;
    const fc = a.forecast;
    const obs = a.weather?.observedAt ?? 0;
    if (fc?.length && t > Math.max(obs, Date.now()) + 45 * MIN) {
      const h = fc.find((x) => t >= x.t && t < x.t + H);
      if (h) return h.capacity;
    }
    const w = a.weather;
    let f = 1;
    if (w?.visSm !== undefined && w.visSm < 0.75) f *= 0.55; // low-visibility procedures: wider spacing
    else if (w?.category === 'IFR') f *= 0.85;
    else if (w?.category === 'LIFR') f *= 0.62;
    if ((w?.gustKt ?? 0) >= 30) f *= 0.8;
    if (w?.wx && /TS/.test(w.wx)) f *= 0.6;
    if (w?.wx && /SN|FZ/.test(w.wx)) f *= 0.75;
    return f;
  }

  /**
   * Runway capacity (movements/hour). Simulated hubs carry roughly real-world peak
   * traffic, so real-world capacities apply; weather reduces them.
   */
  private capacity(a: SimAirport, kind: 'arr' | 'dep', t: number) {
    const runways = Math.max(1, Math.round(a.runways.length / 2));
    let cap = a.large ? (runways >= 3 ? 60 : runways === 2 ? 44 : 32) : 22;
    cap *= this.weatherFactor(a, t);
    if (kind === 'dep') cap *= 1.15;
    return Math.max(4, cap);
  }

  /** Required time between a leader and a follower on the same runway stream. */
  private separation(a: SimAirport, kind: 'arr' | 'dep', t: number, lead: Wake, follow: Wake) {
    const base = H / this.capacity(a, kind, t);
    const streams = a.large && a.runways.length >= 6 ? 2 : 1;
    const wakeMs = kind === 'arr' ? (WAKE_ARR_NM[lead][follow] * 24 + 10) * 1000 : WAKE_DEP_S[lead][follow] * 1000;
    // Wake spacing grows in low visibility (no visual separation).
    const lvp = (a.weather?.visSm ?? 10) < 0.75 ? 1.25 : 1;
    return Math.max(base, (wakeMs * lvp) / streams);
  }

  private findSlot(list: Slot[], a: SimAirport, kind: 'arr' | 'dep', t: number, w: Wake, planning = false): { t: number; i: number } {
    let cand = t;
    this.closuresFor(a, t);
    for (let guard = 0; guard < 600; guard++) {
      const closed = a.closures?.find((c) => cand >= c.from && cand < c.to);
      if (closed) {
        cand = closed.to;
        continue;
      }
      // Night curfew: no scheduled departures, and arrivals are planned to land after it lifts.
      if (kind === 'dep' || planning) {
        const lift = curfewEnd(a.ident, cand, a.lon);
        if (lift !== null) {
          cand = lift;
          continue;
        }
      }
      let i = list.length;
      while (i > 0 && list[i - 1]!.t > cand) i--;
      const p = list[i - 1];
      const n = list[i];
      if (p && cand < p.t + this.separation(a, kind, cand, p.w, w)) {
        cand = p.t + this.separation(a, kind, cand, p.w, w);
        continue;
      }
      if (n && n.t < cand + this.separation(a, kind, cand, w, n.w)) {
        cand = n.t + this.separation(a, kind, cand, n.w, w);
        continue;
      }
      return { t: cand, i };
    }
    return { t: cand, i: list.length };
  }

  /** Earliest free slot at or after `t`, without reserving it. */
  private peekSlot(a: SimAirport, kind: 'arr' | 'dep', t: number, w: Wake = 'M'): number {
    return this.findSlot(this.slots.get(`${a.ident}:${kind}`) ?? [], a, kind, t, w, true).t;
  }

  /** Earliest slot at or after `t` with capacity and wake separation; reserves it. */
  private reserveSlot(a: SimAirport, kind: 'arr' | 'dep', t: number, w: Wake = 'M'): number {
    const key = `${a.ident}:${kind}`;
    let list = this.slots.get(key);
    if (!list) this.slots.set(key, (list = []));
    if (list.length > 220) list.splice(0, list.length - 170);
    const s = this.findSlot(list, a, kind, t, w);
    list.splice(s.i, 0, { t: s.t, w });
    return s.t;
  }

  private alternateFor(a: SimAirport): SimAirport | undefined {
    if (!this.alternates.has(a.ident)) {
      let best: SimAirport | null = null;
      let bd = Infinity;
      for (const b of this.airports.values()) {
        if (!b.large || b === a) continue;
        const d = distanceNm(a.lat, a.lon, b.lat, b.lon);
        if (d >= 40 && d < 320 && d < bd && (b.weather?.category ?? 'VFR') !== 'LIFR') {
          bd = d;
          best = b;
        }
      }
      this.alternates.set(a.ident, best);
    }
    return this.alternates.get(a.ident) ?? undefined;
  }

  /** Nearest airport able to take an emergency diversion of this type. */
  private nearestSuitable(p: Pt, t: TypeInfo, not?: SimAirport): SimAirport | undefined {
    this.emergencyFields ??= [...this.airports.values()].filter((a) => a.runways.some((r) => r.lengthNm >= 1.25));
    const need = t.cls === 'wide' ? 1.6 : 1.25;
    let best: SimAirport | undefined;
    let bd = Infinity;
    for (const a of this.emergencyFields) {
      if (a === not || !a.runways.some((r) => r.lengthNm >= need) || (t.cls === 'wide' && !a.large)) continue;
      if (Math.abs(a.lat - p[0]) > 20) continue;
      const d = distanceNm(p[0], p[1], a.lat, a.lon);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  // -------------------------------------------------------------- taxi routing

  /**
   * First real taxiway (OpenStreetMap) leaving the runway beyond the minimum roll-out:
   * returns the point on the centreline where the aircraft turns off, and its name.
   */
  private runwayExit(ident: string, thr: Pt, hdg: number, lengthNm: number, minRoll: number): { pt: Pt; name?: string } | null {
    const g = this.ground.get(ident);
    if (!g) return null;
    const k = Math.cos((thr[0] * Math.PI) / 180);
    const h = (hdg * Math.PI) / 180;
    const ux = Math.sin(h);
    const uy = Math.cos(h);
    let best = Infinity;
    let bi = -1;
    for (let i = 0; i < g.nodes.length; i++) {
      const n = g.nodes[i]!;
      const x = (n[1] - thr[1]) * 60 * k;
      const y = (n[0] - thr[0]) * 60;
      const al = x * ux + y * uy;
      const cross = Math.abs(x * uy - y * ux);
      if (cross < 0.07 && al >= minRoll && al <= lengthNm * 0.95 && al < best) {
        best = al;
        bi = i;
      }
    }
    if (!Number.isFinite(best)) return null;
    const out: { pt: Pt; name?: string } = { pt: destination(thr[0], thr[1], hdg, best) };
    for (const v of g.adj[bi] ?? []) {
      const nm = g.edgeNames?.get(bi < v ? `${bi}-${v}` : `${v}-${bi}`);
      if (nm) {
        out.name = nm;
        break;
      }
    }
    return out;
  }

  private taxiRoute(ident: string, from: Pt, to: Pt, turnNm = 0.016): { pts: Pt[]; via: string[] } | null {
    const g = this.ground.get(ident);
    if (!g || g.nodes.length < 2) return null;
    const r = routeOnGraph(g, from, to);
    if (!r) return null;
    return { pts: fillet(r.pts, turnNm), via: r.via };
  }

  /**
   * Where a departure enters its runway: the taxiway node on the centre line nearest the
   * threshold (a full-length departure), the line-up point on the centre line, and the
   * runway holding position before it (OSM's named one when present).
   */
  private runwayEntry(a: SimAirport, rw: SimRunway): { entry: Pt; lineup: Pt; hold?: { pt: Pt; ref: string } } | null {
    const g = this.ground.get(a.ident);
    if (!g || g.nodes.length < 2) return null;
    const thr: Pt = [rw.lat, rw.lon];
    const k = Math.cos((rw.lat * Math.PI) / 180);
    const h = (rw.hdg * Math.PI) / 180;
    const ux = Math.sin(h);
    const uy = Math.cos(h);
    let best = Infinity;
    let bi = -1;
    for (let i = 0; i < g.nodes.length; i++) {
      const n = g.nodes[i]!;
      const x = (n[1] - rw.lon) * 60 * k;
      const y = (n[0] - rw.lat) * 60;
      const al = x * ux + y * uy;
      const cross = Math.abs(x * uy - y * ux);
      if (cross > 0.035 || al < -0.12 || al > Math.max(0.3, rw.lengthNm * 0.22)) continue;
      // Prefer the entry closest to the threshold; nodes before it (a starter extension) win ties.
      const score = Math.abs(al) + cross * 2;
      if (score < best) {
        best = score;
        bi = i;
      }
    }
    if (bi < 0) return null;
    const n = g.nodes[bi]!;
    const x = (n[1] - rw.lon) * 60 * k;
    const y = (n[0] - rw.lat) * 60;
    const al = Math.max(0, x * ux + y * uy);
    const lineup = al < 0.02 ? thr : destination(thr[0], thr[1], rw.hdg, al);
    const out: { entry: Pt; lineup: Pt; hold?: { pt: Pt; ref: string } } = { entry: n, lineup };
    let bd = 0.13;
    for (const hp of g.holds ?? []) {
      const d = distanceNm(n[0], n[1], hp.pt[0], hp.pt[1]);
      if (d < bd && d > 0.02) {
        bd = d;
        out.hold = hp;
      }
    }
    return out;
  }

  /** The old vertex-to-vertex router (kept for graphs too small for edge attachment). */
  private taxiRouteNodes(ident: string, from: Pt, to: Pt): { pts: Pt[]; nodes: number[] } | null {
    const g = this.ground.get(ident);
    if (!g || g.nodes.length < 2) return null;
    const nearest = (p: Pt) => {
      let bi = -1;
      let bd = Infinity;
      const k = Math.cos((p[0] * Math.PI) / 180);
      for (let i = 0; i < g.nodes.length; i++) {
        const n = g.nodes[i]!;
        const d = (n[0] - p[0]) ** 2 + ((n[1] - p[1]) * k) ** 2;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      return bi;
    };
    const s = nearest(from);
    const e = nearest(to);
    if (s < 0 || e < 0) return null;
    // Dijkstra with a binary heap.
    const dist = new Float64Array(g.nodes.length).fill(Infinity);
    const prev = new Int32Array(g.nodes.length).fill(-1);
    const heap: [number, number][] = [[0, s]];
    dist[s] = 0;
    const push = (x: [number, number]) => {
      heap.push(x);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p]![0] <= heap[i]![0]) break;
        [heap[p], heap[i]] = [heap[i]!, heap[p]!];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0]!;
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
          if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i]!, heap[m]!];
          i = m;
        }
      }
      return top;
    };
    while (heap.length) {
      const [d, u] = pop();
      if (u === e) break;
      if (d > dist[u]!) continue;
      const nu = g.nodes[u]!;
      for (const v of g.adj[u]!) {
        const nv = g.nodes[v]!;
        const nd = d + distanceNm(nu[0], nu[1], nv[0], nv[1]);
        if (nd < dist[v]!) {
          dist[v] = nd;
          prev[v] = u;
          push([nd, v]);
        }
      }
    }
    if (!Number.isFinite(dist[e]!)) return null;
    const nodes: number[] = [];
    for (let v = e; v !== -1; v = prev[v]!) nodes.push(v);
    nodes.reverse();
    return { pts: [from, ...nodes.map((i) => g.nodes[i]!), to], nodes };
  }

  /** Taxi route with taxiway names, the holding point and every runway crossing. */
  private taxiPlan(a: SimAirport, from: Pt, to: Pt, mode: 'out' | 'in', runway: string, turnNm = 0.016): TaxiPlan | null {
    const r = this.taxiRoute(a.ident, from, to, turnNm) ?? this.taxiRouteNodes(a.ident, from, to);
    if (!r) return null;
    const g = this.ground.get(a.ident)!;
    let via: string[];
    if ('via' in r) via = r.via;
    else {
      via = [];
      for (let i = 1; i < r.nodes.length; i++) {
        const x = r.nodes[i - 1]!;
        const y = r.nodes[i]!;
        const nm = g.edgeNames?.get(x < y ? `${x}-${y}` : `${y}-${x}`);
        if (nm && via[via.length - 1] !== nm) via.push(nm);
      }
    }
    const cum = cumulative(r.pts);
    const plan: TaxiPlan = { pts: r.pts, cum, via: via.slice(0, 8), crossings: [] };
    if (mode === 'out' && g.holds?.length) {
      const end = r.pts[r.pts.length - 2]!;
      let bd = 0.08;
      for (const h of g.holds) {
        const d = distanceNm(end[0], end[1], h.pt[0], h.pt[1]);
        if (d < bd) {
          bd = d;
          plan.hold = h.ref;
        }
      }
    }
    // Runway crossings, in local planar NM coordinates.
    const k = Math.cos((a.lat * Math.PI) / 180);
    const P = (p: Pt): [number, number] => [(p[1] - a.lon) * 60 * k, (p[0] - a.lat) * 60];
    const total = cum[cum.length - 1]!;
    const act = [runway, a.inUse.ident, a.inUseDep?.ident];
    const active = (name: string) => name.split('/').some((n) => act.includes(n));
    for (const st of a.strips) {
      const q0 = P(st.a);
      const q1 = P(st.b);
      for (let i = 0; i < r.pts.length - 1; i++) {
        const tt = intersect(P(r.pts[i]!), P(r.pts[i + 1]!), q0, q1);
        if (tt === null) continue;
        const s = cum[i]! + (cum[i + 1]! - cum[i]!) * tt;
        // The departure runway itself (at the end) and the landing runway (at the start) are not crossings.
        if ((mode === 'out' && total - s < 0.12) || (mode === 'in' && s < 0.12)) continue;
        if (!plan.crossings.some((c) => Math.abs(c.s - s) < 0.05)) plan.crossings.push({ s, runway: st.name, active: active(st.name) });
      }
    }
    plan.crossings.sort((x, y) => x.s - y.s);
    return plan;
  }

  /** Emits the taxi movement along a plan, stopping short of each runway crossing. */
  private emitTaxi(b: Builder, plan: TaxiPlan, kt: number, upTo?: number, ap?: SimAirport) {
    const end = upTo ?? plan.cum[plan.cum.length - 1]!;
    // Low-visibility procedures: slower taxi and every runway crossing protected by a stop-bar
    // that is switched off only once the runway is clear.
    const lvp = !!ap && (ap.weather?.visSm ?? 10) < 0.75;
    if (lvp) kt = Math.min(kt, 10);
    let s0 = 0;
    for (const c of plan.crossings) {
      if (c.s >= end) break;
      const stop = Math.max(s0, c.s - 0.045);
      if (stop - s0 > 0.01) b.path('taxi', slice(plan.pts, plan.cum, s0, stop), ground, ground, kt, kt);
      const here = along(plan.pts, plan.cum, stop);
      const ahead = along(plan.pts, plan.cum, Math.min(end, c.s + 0.05));
      const wait = c.active ? this.rng.range(30, 110) : this.rng.range(6, 25);
      b.wait('taxi', here, (lvp ? wait * 1.6 + 30 : wait) * 1000, bearingDeg(here[0], here[1], ahead[0], ahead[1]));
      b.ev('cross', lvp ? { a: c.runway, b: 'stopbar' } : { a: c.runway });
      s0 = stop;
    }
    if (end - s0 > 0.005) b.path('taxi', slice(plan.pts, plan.cum, s0, end), ground, ground, kt, kt);
  }

  // -------------------------------------------------------------- timetable

  /** Repeating, airline-style flight numbers: stable per route, odd outbound from the hub. */
  private flightNumber(af: Airframe, from: SimAirport, to: SimAirport, tOff: number) {
    const al = af.airline!;
    const dist = distanceNm(from.lat, from.lon, to.lat, to.lon);
    const cls = af.type.cls;
    const [lo, hi] = dist > 2500 || cls === 'wide' ? [1, 399] : cls === 'regional' || cls === 'turboprop' ? [2000, 4999] : [400, 1999];
    const pair = from.ident < to.ident ? from.ident + to.ident : to.ident + from.ident;
    const h = hash(al.icao + pair);
    const base = lo + 8 * (h % Math.max(1, Math.floor((hi - lo) / 8)));
    const outbound = al.hubs.includes(from.ident) ? true : al.hubs.includes(to.ident) ? false : from.ident < to.ident;
    const localH = localHour(tOff, from.lon);
    const wave = Math.min(3, Math.floor(localH / 6));
    let num = base + 2 * wave + (outbound ? 0 : 1);
    if (num % 2 === (outbound ? 0 : 1)) num = num + 1 > hi ? num - 1 : num + 1;
    let icaoCs = `${al.icao}${num}`;
    if (al.alnum) {
      const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
      icaoCs = `${al.icao}${(h % 90) + 1 + wave * 100}${L[(h >>> 8) % L.length]}${L[(h >>> 13) % L.length]}`.slice(0, 7);
    }
    return { icao: icaoCs, iata: `${al.iata}${num}`, num };
  }

  private codeshares(af: Airframe, from: SimAirport, to: SimAirport, num: number): string[] {
    const al = af.airline!;
    const alliance = ALLIANCES.find((a) => a.members.includes(al.icao));
    if (!alliance) return [];
    const h = hash(`${al.icao}${num}${from.ident}${to.ident}`);
    const intl = from.country !== to.country;
    const count = intl ? h % 4 : h % 2;
    const partners = alliance.members.filter((m) => m !== al.icao).map((m) => AIRLINES.find((x) => x.icao === m)).filter((x): x is AirlineProfile => !!x);
    const out: string[] = [];
    for (let i = 0; i < count && partners.length; i++) {
      const p = partners[(h >>> (i * 5)) % partners.length]!;
      const code = `${p.iata}${1000 + ((h >>> (i * 3)) % 8000)}`;
      if (!out.some((x) => x.startsWith(p.iata))) out.push(code);
    }
    return out;
  }

  /** Callsign for non-airline operators. */
  private opCallsign(af: Airframe, kind: LegKind): string {
    if (af.role === 'ga' || af.role === 'glider' || af.role === 'tow' || !af.op) return af.reg.replace(/[-+.]/g, '');
    af.seq = (af.seq % 899) + 1;
    const op = af.op;
    if (af.role === 'hems') return `${op.icao}${(hash(af.hex) % 80) + 1}`;
    if (op.icao === 'NATO') return `NATO${String((hash(af.hex) % 30) + 1).padStart(2, '0')}`;
    if (kind === 'training') return `${op.icao}${(hash(af.hex + af.seq) % 8) + 1}${(af.seq % 4) + 1}`;
    return `${op.icao}${100 + (hash(af.hex) % 600) + (af.seq % 9)}`;
  }

  // -------------------------------------------------------------- emergencies

  private rollEmergency(af: Airframe, kind: LegKind, flightH: number): Emergency['kind'] | null {
    if (af.role !== 'airline' || kind === 'delivery' || af.type.cls === 'turboprop' || flightH < 1) return null;
    const r = this.rng.next();
    // Rare, as in reality: roughly one medical diversion per ~8,000 four-hour flights; technical ones rarer still.
    const pMed = (kind === 'cargo' ? 0 : 0.00004) * flightH;
    const pEng = 0.000012 * Math.min(4, flightH);
    const pPress = 0.000006 * Math.min(4, flightH);
    // Bird strikes after take-off occasionally force a return to the departure airport.
    if (r > 1 - 0.00025) return 'birdstrike';
    if (r < pMed) return 'medical';
    if (r < pMed + pEng) return 'engine';
    if (r < pMed + pEng + pPress) return 'pressurisation';
    return null;
  }

  // -------------------------------------------------------------- en-route profile

  /**
   * Flies a polyline route with a realistic vertical profile: 250 kt below FL100, climb,
   * cruise (with optional +2,000 ft step climbs), descent at ~3°. Emits great-circle
   * segments with winds aloft and position events for ATC hand-offs. Stops early at
   * `stopAt` NM (emergencies); returns where it ended.
   */
  private flyChain(
    b: Builder,
    chain: Pt[],
    p: { alt0: number; alt1: number; cruise: number; tas: number; light: boolean; v0: number; v1: number; steps: boolean; ceiling: number; climbFpm: number },
    stopAt?: number,
  ): { pt: Pt; alt: number; gs: number; cruiseFt: number; tod: number; toc: number } {
    const cum = cumulative(chain);
    const D = cum[cum.length - 1]!;
    // Distances needed to climb / descend at a given cruise level.
    const climbNm = (to: number) => {
      if (p.light) return ((to - p.alt0) / 600) * (p.tas / 60);
      const lo = Math.max(0, Math.min(10_000, to) - p.alt0);
      const hi = Math.max(0, to - Math.max(10_000, p.alt0));
      return (lo / 2400) * (270 / 60) + (hi / p.climbFpm) * ((p.tas * 0.82) / 60);
    };
    const descNm = (from: number) => (p.light ? (from - p.alt1) / 350 : Math.max(0, from - p.alt1) / 310);
    let cruise = p.cruise;
    while (cruise > Math.max(p.alt0, p.alt1) + 1000 && climbNm(cruise) + descNm(cruise) > D * 0.95) cruise -= p.light || cruise < 12_000 ? 1000 : 2000; // 2,000 ft keeps the semicircular parity
    cruise = Math.max(cruise, Math.max(p.alt0, p.alt1) + 500);
    const toc = Math.min(D * 0.5, climbNm(cruise));
    const tod = Math.max(toc, D - descNm(cruise));
    // Altitude knots along the route.
    const knots: [number, number][] = [[0, p.alt0]];
    if (!p.light && p.alt0 < 10_000 && cruise > 10_000) knots.push([Math.min(toc, climbNm(10_000)), 10_000]);
    knots.push([toc, cruise]);
    let level = cruise;
    if (p.steps && tod - toc > 2400) {
      for (const f of [1 / 3, 2 / 3]) {
        const at = toc + (tod - toc) * f;
        if (level + 2000 > p.ceiling) break;
        knots.push([at, level], [at + 16, level + 2000]);
        level += 2000;
      }
    }
    knots.push([tod, level]);
    if (!p.light && level > 10_000 && p.alt1 < 10_000) knots.push([Math.max(tod, D - descNm(10_000)), 10_000]);
    knots.push([D, p.alt1]);
    const altAt = (s: number) => {
      for (let i = 1; i < knots.length; i++) {
        const [s1, a1] = knots[i]!;
        const [s0, a0] = knots[i - 1]!;
        if (s <= s1) return s1 > s0 ? a0 + ((a1 - a0) * (s - s0)) / (s1 - s0) : a1;
      }
      return p.alt1;
    };
    // Break points: knots, chain vertices and ~300 NM chunks (fresh winds, hand-offs).
    const marks = new Set<number>([...knots.map((k) => k[0]), ...cum]);
    for (let s = 300; s < D; s += 300) marks.add(s);
    const end = Math.min(D, stopAt ?? D);
    const sorted = [...marks].filter((s) => s >= 0 && s <= end).sort((x, y) => x - y);
    if (sorted[sorted.length - 1] !== end) sorted.push(end);
    let lastGs = p.v0;
    let lastPos = -210; // first hand-off ~30 NM after departure
    for (let i = 1; i < sorted.length; i++) {
      const s0 = sorted[i - 1]!;
      const s1 = sorted[i]!;
      if (s1 - s0 < 0.05) continue;
      const a = alongGc(chain, cum, s0);
      const c = alongGc(chain, cum, s1);
      const alt0 = altAt(s0);
      const alt1 = altAt(s1);
      const phase: Phase = alt1 > alt0 + 50 ? 'climb' : alt1 < alt0 - 50 ? 'descent' : 'cruise';
      const mid = intermediatePoint(a[0], a[1], c[0], c[1], 0.5);
      const midAlt = (alt0 + alt1) / 2;
      const trk = bearingDeg(a[0], a[1], c[0], c[1]);
      let wind: Seg['wind'];
      if (!p.light && midAlt > 8000) {
        const w = windAloft(mid[0], mid[1], b.time, this.windSeed);
        const kt = Math.max(5, (w.kt + this.rng.range(-12, 12)) * Math.min(1, midAlt / 30_000));
        wind = { dir: w.dir, kt: Math.round(kt), comp: tailwind({ dir: w.dir, kt }, trk) };
      }
      const gsAt = (alt: number, s: number) => {
        if (s <= 0.01) return p.v0;
        if (s >= D - 0.01) return p.v1;
        return Math.max(p.light ? 60 : 180, tasAt(alt, cruise, p.tas, p.light) + (wind?.comp ?? 0));
      };
      const g0 = i === 1 ? p.v0 : lastGs;
      const g1 = gsAt(alt1, s1);
      const seg: Omit<Seg, 't0' | 't1'> = { phase, kind: 'gc', a, b: c, alt0, alt1, spd0: g0, spd1: g1 };
      if (wind) seg.wind = wind;
      if (s0 <= toc && s1 > toc - 0.01 && phase !== 'climb') b.ev('cruise', { n: Math.round(cruise / 100) });
      if (s0 >= tod - 0.01 && s0 <= tod + 0.5 && phase === 'descent') b.ev('descent', { n: Math.round(Math.max(p.alt1, 10_000) / 100) });
      if (phase === 'climb' && s0 > toc + 1) b.ev('step', { n: Math.round(alt1 / 100) });
      if (s0 - lastPos >= 240 && !p.light) {
        b.ev('pos', { lat: a[0], lon: a[1], n: Math.round(alt0 / 100) });
        lastPos = s0;
      }
      b.push(seg, segDuration(s1 - s0, Math.max(40, (g0 + g1) / 2)));
      lastGs = g1;
    }
    return { pt: alongGc(chain, cum, end), alt: altAt(end), gs: lastGs, cruiseFt: Math.max(cruise, level), tod, toc };
  }

  // -------------------------------------------------------------- path

  buildLeg(af: Airframe, from: SimAirport, to: SimAirport, tOff: number, stand?: StandRef, opts: { kind?: LegKind; mission?: MissionPlan | undefined } = {}): Leg {
    const t = af.type;
    if (t.cls === 'heli') return this.buildHeliLeg(af, from, to, tOff, af.role === 'ga' ? 'ga' : af.role === 'mil' ? 'military' : 'ga', stand);
    const spec = specOf(t.code);
    const wake: Wake = spec?.wake ?? (t.cls === 'wide' ? 'H' : t.cls === 'light' ? 'L' : 'M');
    const airline = af.role === 'airline';
    const cargoOp = !!af.airline && CARGO.has(af.airline.icao);
    let kind: LegKind = opts.kind ?? (airline ? (cargoOp ? 'cargo' : 'scheduled') : af.role === 'ambulance' ? 'ambulance' : af.role === 'mil' ? 'military' : t.cls === 'bizjet' ? 'bizjet' : 'ga');
    const light = t.cls === 'light';
    const priority = kind === 'ambulance';
    if (light && from === to && !opts.mission) kind = 'circuits';
    const b = new Builder(tOff);
    const start = stand ?? this.takeStand(from, tOff - 60 * MIN, tOff, af, to);
    if (stand) this.holdStand(from, stand, tOff);
    const tas = t.kt * this.rng.range(0.96, 1.04);
    let holdMs = 0;
    let gateHoldMs = 0;
    let deiceMs = 0;
    let divertedFrom: SimAirport | undefined;
    let dest = to;
    let route: RouteInfo | undefined;
    let taxiOut: TaxiInfo | undefined;
    let emergency: Emergency | undefined;
    const mission = opts.mission;
    const usesSlots = (airline || af.role === 'mil') && !light;

    // ---- departure: clearance, push-back, taxi (crossings, de-icing), queue, take-off.
    this.runwaysAt(from, tOff);
    const dep = from.inUseDep ?? from.inUse;
    const thr: Pt = [dep.lat, dep.lon];
    let groundDelay = 0;
    if (airline && !light && to.scheduled && from !== to) {
      const est = tOff + 20 * MIN + segDuration(distanceNm(from.lat, from.lon, to.lat, to.lon), tas * 0.9) + 12 * MIN;
      const wait = this.peekSlot(to, 'arr', est, wake) - est;
      if (wait > 8 * MIN) groundDelay = wait - 4 * MIN;
    }
    const pushes = airline || (af.role === 'mil' && (t.cls === 'wide' || t.cls === 'narrow'));
    const nose = start.hdg ?? bearingDeg(start.pt[0], start.pt[1], from.lat, from.lon);
    // Strictly on the taxiways: the push-back ends on the taxilane centre line facing the
    // route, the taxi ends at the holding point, the line-up follows the entry taxiway.
    const turnNm = t.cls === 'wide' ? 0.024 : 0.016;
    const rwEntry = light ? null : this.runwayEntry(from, dep);
    const taxiTo: Pt = rwEntry?.entry ?? thr;
    const gFrom = this.ground.get(from.ident);
    const pushPath = pushes && gFrom ? pushbackPath(gFrom, start.pt, taxiTo, t.cls === 'wide' ? 0.04 : 0.03) : null;
    const pushed = pushPath ? pushPath[pushPath.length - 1]! : pushes ? destination(start.pt[0], start.pt[1], nose + 180, t.cls === 'wide' ? 0.045 : 0.035) : start.pt;
    const outPlan = light ? null : this.taxiPlan(from, pushed, taxiTo, 'out', dep.ident, turnNm);
    const taxiKt = t.cls === 'wide' ? 14 : light ? 12 : 16;
    const taxiNm = outPlan ? outPlan.cum[outPlan.cum.length - 1]! : Math.max(0.3, distanceNm(pushed[0], pushed[1], thr[0], thr[1]) * 1.35);
    const w0 = from.weather;
    const icing = !!w0 && (w0.tempC ?? 10) <= 3 && !!w0.wx && (/SN|FZ|SG|PL|GS|IC/.test(w0.wx) || ((w0.tempC ?? 10) <= 0 && /RA|DZ|FG|BR/.test(w0.wx)));
    if (icing && !light) deiceMs = this.rng.range(8, t.cls === 'wide' ? 22 : 15) * MIN;
    const readyEst = tOff + MIN + groundDelay + (pushes ? 60_000 : 0) + segDuration(taxiNm, taxiKt) + deiceMs + 40_000;
    if (usesSlots && !priority && from.scheduled) {
      const wait = this.peekSlot(from, 'dep', readyEst, wake) - readyEst;
      if (wait > 6 * MIN) gateHoldMs = wait - 3 * MIN;
    }
    b.ev('clearance', {}, tOff - this.rng.range(6, 18) * MIN);
    b.wait('parked', start.pt, MIN + groundDelay + gateHoldMs, start.hdg);
    if (groundDelay > 0) b.ev('edct', { n: Math.round(groundDelay / MIN) }, tOff);
    if (gateHoldMs > 0) b.ev('gatehold', { n: Math.round(gateHoldMs / MIN) }, tOff + groundDelay);
    b.ev('pushback');
    if (pushPath && pushPath.length > 1) {
      const pp = fillet(pushPath, 0.012);
      const pushNm = cumulative(pp).at(-1)!;
      b.path('pushback', pp, ground, ground, 3, 3, Math.max(40_000, Math.min(150_000, segDuration(pushNm, 2.6))));
      b.reverseLast();
    } else if (pushes) b.line('pushback', start.pt, pushed, ground, ground, 3, 3, 55_000, { nose });
    let holdPt: Pt;
    let lineupPath: Pt[] | null = null;
    if (outPlan && outPlan.pts.length > 3 && rwEntry) {
      // Hold short at the OSM holding position (projected onto the route) or ~90 m before the runway.
      const total = outPlan.cum[outPlan.cum.length - 1]!;
      let upTo = Math.max(0, total - 0.05);
      if (rwEntry.hold) {
        const s = nearestAlong(outPlan.pts, outPlan.cum, rwEntry.hold.pt);
        if (s > total - 0.15 && s < total - 0.01) upTo = s;
        else delete rwEntry.hold;
      }
      holdPt = along(outPlan.pts, outPlan.cum, upTo);
      lineupPath = [...slice(outPlan.pts, outPlan.cum, upTo, total), rwEntry.lineup];
      taxiOut = { via: outPlan.via, crossings: outPlan.crossings.filter((c) => c.s < upTo).map((c) => c.runway), runway: dep.ident };
      if (rwEntry.hold) taxiOut.hold = rwEntry.hold.ref;
      else if (outPlan.hold) taxiOut.hold = outPlan.hold;
      b.ev('taxi');
      this.emitTaxi(b, outPlan, taxiKt, upTo, from);
    } else if (outPlan && outPlan.pts.length > 3) {
      holdPt = outPlan.pts[outPlan.pts.length - 2]!;
      const upTo = outPlan.cum[outPlan.cum.length - 2]!;
      taxiOut = { via: outPlan.via, crossings: outPlan.crossings.filter((c) => c.s < upTo).map((c) => c.runway), runway: dep.ident };
      if (outPlan.hold) taxiOut.hold = outPlan.hold;
      b.ev('taxi');
      this.emitTaxi(b, outPlan, taxiKt, upTo, from);
    } else {
      holdPt = destination(thr[0], thr[1], dep.hdg + 90, light ? 0.04 : 0.07);
      taxiOut = { via: [], crossings: [], runway: dep.ident };
      b.ev('taxi');
      b.line('taxi', pushed, holdPt, ground, ground, taxiKt, taxiKt, segDuration(taxiNm, taxiKt));
    }
    if (deiceMs) {
      b.ev('deice', { n: Math.round(deiceMs / MIN) });
      b.wait('taxi', holdPt, deiceMs, bearingDeg(holdPt[0], holdPt[1], thr[0], thr[1]));
    }
    // Earliest possible take-off: a short hold, 25 s to line up and 10 s on the runway.
    const ready = b.time + 55_000 + (light ? -5_000 : 0);
    const slot = usesSlots && !priority ? this.reserveSlot(from, 'dep', ready, wake) : ready;
    b.ev('holdshort', { a: taxiOut.hold ?? '' });
    b.wait('taxi', holdPt, slot - b.time - (light ? 30_000 : 35_000), bearingDeg(holdPt[0], holdPt[1], thr[0], thr[1]));
    b.ev('lineup');
    const lu: Pt = lineupPath ? lineupPath[lineupPath.length - 1]! : thr;
    if (lineupPath && lineupPath.length > 1) b.path('taxi', fillet(lineupPath, turnNm), ground, ground, 8, 4, 25_000);
    else b.line('taxi', holdPt, thr, ground, ground, 8, 4, 25_000);
    b.wait('taxi', lu, light ? 5_000 : 10_000, dep.hdg);
    b.ev('takeoff');
    const rollNm = light ? 0.25 : Math.min(dep.lengthNm * 0.6, t.cls === 'wide' ? 1.5 : 1.2);
    const lift = destination(lu[0], lu[1], dep.hdg, rollNm);
    const vr = spec?.vrKt ?? (light ? 65 : t.cls === 'wide' ? 160 : 145);
    b.line('takeoff', lu, lift, ground, ground, 0, vr, segDuration(rollNm, vr / 2), { ease: 'accel' });

    const climbOutNm = light ? 1.5 : 4;
    const dFix = destination(lu[0], lu[1], dep.hdg, rollNm + climbOutNm);
    const climbOutAlt = from.elev + (light ? 800 : 2500);
    b.line('climb', lift, dFix, from.elev + 35, climbOutAlt, vr + 10, light ? 85 : 210, segDuration(climbOutNm, light ? 80 : 175));
    b.ev('departure');

    // ---- circuits: touch-and-go practice in the traffic pattern, then a full-stop landing.
    if (kind === 'circuits') return this.finishCircuits(af, b, from, start, dFix, climbOutAlt, tOff, wake);

    // ---- weather at the destination may force a diversion.
    const w = to.weather;
    const divert = airline && !light && ((w?.category === 'LIFR' && this.rng.next() < 0.12) || ((w?.gustKt ?? 0) >= 45 && this.rng.next() < 0.25) || (!!w?.wx && /\+TS/.test(w.wx) && this.rng.next() < 0.08));
    const alternate = divert ? this.alternateFor(to) : undefined;
    let improved = false;

    // ---- route: departure procedure, en-route navaids, oceanic track, arrival procedure.
    const gcNm = distanceNm(from.lat, from.lon, to.lat, to.lon);
    const big = !light && gcNm > 90;
    this.runwaysAt(to, tOff + segDuration(gcNm, tas) + 25 * MIN);
    const arrRwy = to.inUse;
    // Published FAA procedures at US airports; procedure-style ones elsewhere.
    const inbound = bearingDeg(to.lat, to.lon, from.lat, from.lon);
    const realStar = big && !mission && this.usProcs && to.country === 'US' ? this.published(pickStar(this.usProcs, to.ident, arrRwy.ident, inbound), 'star') : undefined;
    const star = realStar ?? (big && !mission ? starFor(this.nav, to, arrRwy.ident, inbound) : undefined);
    const target: Pt = mission ? mission.area : star ? [star.fix.lat, star.fix.lon] : [to.lat, to.lon];
    const outCrs = bearingDeg(from.lat, from.lon, target[0], target[1]);
    const realSid = big && !mission && this.usProcs && from.country === 'US' ? this.published(pickSid(this.usProcs, from.ident, dep.ident, outCrs), 'sid') : undefined;
    const sid = realSid ?? (big || (mission && !light) ? sidFor(this.nav, from, dep.ident, outCrs) : undefined);
    const turnR = light ? 0.7 : 2.6;
    const firstTarget: Pt = sid?.fixes ? [sid.fixes[0]!.lat, sid.fixes[0]!.lon] : sid ? [sid.fix.lat, sid.fix.lon] : target;
    const arc = turnTowards(dFix, dep.hdg, firstTarget, turnR);
    let via: Fix[] = [];
    let nat: { track: OtsTrack; pts: Pt[] } | null = null;
    let avoids: string[] | undefined;
    const chain: Pt[] = [...arc];
    if (sid?.fixes) chain.push(...sid.fixes.map((f) => [f.lat, f.lon] as Pt));
    else if (sid) chain.push(firstTarget);
    let airwayLegs: AirwayLeg[] | null = null;
    if (!mission && star && sid) {
      const a: Fix = sid.fix;
      const z: Fix = star.fix;
      // Estimated time crossing 30°W for the track system.
      const t30 = b.time + segDuration(gcNm * 0.5, tas);
      nat = af.role === 'airline' && t.cls !== 'turboprop' ? assignOts(from, to, t30, this.seed, `${af.hex}${Math.floor(tOff / 86_400_000)}`) : null;
      // A track that would cross airspace this operator avoids is not flown.
      if (nat) {
        const zs = this.zonesAt(b.time);
        const oc = af.airline?.country;
        const seq: Pt[] = [[a.lat, a.lon], ...nat.pts, [z.lat, z.lon]];
        if (seq.some((p, i) => i > 0 && crossedZones(seq[i - 1]!, p, zs, oc).length)) nat = null;
      }
      if (nat) {
        const entry = nat.pts[0]!;
        const exit = nat.pts[nat.pts.length - 1]!;
        const v1 = enroute(this.nav, a, { ident: 'NAT', lat: entry[0], lon: entry[1], real: false });
        const v2 = enroute(this.nav, { ident: 'NAT', lat: exit[0], lon: exit[1], real: false }, z);
        via = [...v1, ...v2];
        chain.push(...v1.map((f) => [f.lat, f.lon] as Pt), ...nat.pts, ...v2.map((f) => [f.lat, f.lon] as Pt));
      } else {
        // Around closed airspace and volcanic ash, then real navaids along each part.
        const zones = this.zonesAt(b.time);
        const opCountry = af.airline?.country ?? af.op?.country;
        const around = detour([a.lat, a.lon], [z.lat, z.lon], zones, opCountry);
        if (around?.length) {
          avoids = crossedZones([a.lat, a.lon], [z.lat, z.lon], zones, opCountry).map((zn) => zn.name);
          const gate = (g: Pt, i: number): Fix => {
            const n = this.nav?.nearestVor(g[0], g[1], 40);
            return n ? { ident: n.ident, lat: n.lat, lon: n.lon, real: true, name: n.name, kind: n.kind } : { ident: fixName(`${g[0]}${g[1]}${i}`), lat: g[0], lon: g[1], real: false };
          };
          const pts: Fix[] = [a, ...around.map(gate), z];
          for (let i = 0; i < pts.length - 1; i++) {
            if (i > 0) via.push(pts[i]!);
            via.push(...enroute(this.nav, pts[i]!, pts[i + 1]!));
          }
          // Snapping to navaids must not lead back into closed airspace: check every leg.
          const legsClear = (list: Fix[]) => {
            const seq = [a, ...list, z];
            return seq.every((f, i) => i === 0 || !crossedZones([seq[i - 1]!.lat, seq[i - 1]!.lon], [f.lat, f.lon], zones, opCountry).length);
          };
          if (!legsClear(via)) via = around.map((g, i) => ({ ident: fixName(`${g[0]}${g[1]}${i}`), lat: g[0], lon: g[1], real: false }));
        } else {
          // Domestic US flights file along the real published airways (jets on J and Q
          // routes, turboprops on Victor and T routes); elsewhere navaid to navaid.
          if (this.usAwys && from.country === 'US' && to.country === 'US' && gcNm > 250) {
            const high = t.cls !== 'turboprop';
            const legs = routeViaAirways(this.usAwys, a, z, { high }) ?? (high ? null : routeViaAirways(this.usAwys, a, z, { high: true }));
            if (legs && legs.length >= 2) {
              const list = legs.filter((l, i) => !(i === 0 && l.ident === a.ident) && !(i === legs.length - 1 && l.ident === z.ident));
              const seq = [a, ...list, z];
              if (seq.every((f, i) => i === 0 || !crossedZones([seq[i - 1]!.lat, seq[i - 1]!.lon], [f.lat, f.lon], zones, opCountry).length)) {
                via = list;
                airwayLegs = legs;
              }
            }
          }
          if (!airwayLegs) via = enroute(this.nav, a, z);
        }
        chain.push(...via.map((f) => [f.lat, f.lon] as Pt));
      }
    }

    // ---- arrival geometry: vectors (downwind / base) onto final for the runway in use.
    const arrivalAt = (ap: SimAirport, entry: Pt) => {
      const arr = ap.inUse;
      const athr: Pt = [arr.lat, arr.lon];
      const finalNm = light ? 4 : 10;
      const back = arr.hdg + 180;
      const P = (al: number, cross: number) => fromLocal(athr, back, al, cross);
      const faf = P(finalNm, 0);
      const fafAlt = ap.elev + finalNm * 318;
      const rel = angle(back, bearingDeg(athr[0], athr[1], entry[0], entry[1]));
      const side = rel >= 0 ? 1 : -1;
      const off = light ? 2 : 7;
      const turnOn = finalNm + (light ? 2 : 4);
      const pattern: Pt[] = [entry];
      if (Math.abs(rel) < 35) pattern.push(P(turnOn + (light ? 2 : 8), 0));
      else if (Math.abs(rel) < 115) pattern.push(P(turnOn + (light ? 2 : 6), off * side));
      else pattern.push(P(light ? -1 : -4, off * side), P(turnOn + (light ? 2 : 6), off * side));
      pattern.push(P(turnOn, 0), faf);
      const vectors = smooth(pattern, 3);
      const vecLen = cumulative(vectors).at(-1)!;
      return { arr, athr, finalNm, P, faf, fafAlt, vectors, vecLen, turnOn };
    };
    const starLast = star?.fixes?.[star.fixes.length - 1];
    let entry: Pt = starLast ? [starLast.lat, starLast.lon] : star ? [star.fix.lat, star.fix.lon] : destination(to.lat, to.lon, bearingDeg(to.lat, to.lon, chain[chain.length - 1]![0], chain[chain.length - 1]![1]), light ? 6 : 20);
    if (mission) entry = mission.area;
    else if (star?.fixes) chain.push(...star.fixes.map((f) => [f.lat, f.lon] as Pt));
    else chain.push(entry);
    let geo = arrivalAt(to, entry);
    // Arrival entry altitude: a continuous ~3° descent through the vectors to the final fix.
    let entryAlt = mission ? mission.ft : Math.min(light ? to.elev + 2500 : 15_000, geo.fafAlt + geo.vecLen * (light ? 150 : 250));

    // ---- cruise level: type ceiling, semicircular rule, NAT level.
    let cruiseFt = t.ft;
    if (!light && cruiseFt >= 10_000) {
      const east = bearingDeg(from.lat, from.lon, target[0], target[1]) < 180;
      let k = Math.round(cruiseFt / 1000) - (gcNm > 3000 ? 2 : 0); // heavy at the start of long flights
      if (k > 41) k = 41;
      if (east && k % 2 === 0) k -= 1;
      if (!east && k % 2 === 1) k -= 1;
      cruiseFt = k * 1000;
      if (nat) cruiseFt = nat.track.levels[hash(af.hex) % nat.track.levels.length]! * 100;
    }
    if (mission) cruiseFt = mission.ft;
    const ceiling = spec?.ceilingFt ?? t.ft + 4000;
    const climbFpm = t.cls === 'wide' ? 1300 : t.cls === 'turboprop' ? 1100 : t.cls === 'fighter' ? 6000 : 1700;

    // ---- emergency en route (rare): fly to the event point, then divert.
    const flightH = gcNm / Math.max(100, tas);
    const emerKind = mission ? null : this.rollEmergency(af, kind, flightH);
    let stopAt: number | undefined;
    const chainLen = cumulative(chain).at(-1)!;
    if (emerKind) stopAt = emerKind === 'birdstrike' ? Math.min(chainLen * 0.4, 10 + this.rng.range(0, 8)) : chainLen * this.rng.range(0.25, 0.75);
    const prof = { alt0: climbOutAlt, alt1: entryAlt, cruise: cruiseFt, tas, light, v0: light ? 85 : 220, v1: light ? 90 : 250, steps: gcNm > 3000 && !nat, ceiling, climbFpm };
    b.ev('climb', { n: light ? Math.round(cruiseFt / 100) : Math.round(Math.min(cruiseFt, 24_000) / 1000) * 10 });
    const flown = this.flyChain(b, chain, prof, stopAt);
    cruiseFt = flown.cruiseFt;

    if (sid) {
      const parts = [sid.name.replace(' ', '')];
      if (airwayLegs && star) parts.push(airwayString(airwayLegs, { from: sid.fix.ident, to: star.fix.ident }));
      else {
        parts.push(sid.fix.ident);
        for (const f of via) parts.push('DCT', f.ident);
        if (nat) parts.push(nat.track.system, nat.track.letter);
        if (star) parts.push('DCT', star.fix.ident);
      }
      if (star) parts.push(star.name.replace(' ', ''));
      route = { via, text: parts.join(' ') };
      if (airwayLegs) route.airways = `FAA CIFP ${this.usAwys?.cycle ?? ''}`.trim();
      if (avoids?.length) route.avoids = avoids;
      route.sid = sid;
      if (star) route.star = star;
    }
    if (nat && route && !emerKind) {
      // When the aircraft enters and leaves the track (first/last track point in the segments).
      const near = (p: Pt) => b.segs.find((s) => distanceNm(s.b[0], s.b[1], p[0], p[1]) < 1)?.t1 ?? b.time;
      const tin = near(nat.pts[0]!);
      const tout = near(nat.pts[nat.pts.length - 1]!);
      const mach = spec?.cruiseMach ?? (t.cls === 'wide' ? 0.84 : 0.78);
      route.nat = { system: nat.track.system, letter: nat.track.letter, text: otsString(nat.track), fl: Math.round(cruiseFt / 100), mach, entry: tin, exit: tout };
      b.ev('oceanic', { a: nat.track.letter, b: otsString(nat.track), n: Math.round(cruiseFt / 100) }, tin - 2 * MIN);
      b.ev('oceanicExit', { a: nat.track.letter }, tout);
    }

    if (emerKind) {
      // ---- emergency: declare, descend as required, divert to the nearest suitable airport.
      const here = flown.pt;
      const field = emerKind === 'birdstrike' ? from : (this.nearestSuitable(here, t, undefined) ?? to);
      const squawk = emerKind === 'medical' || (emerKind === 'birdstrike' && this.rng.next() < 0.6) ? undefined : '7700';
      emergency = { t: b.time, kind: emerKind, divertTo: field };
      if (squawk) emergency.squawk = squawk;
      b.ev('emergency', { a: emerKind, b: field.ident });
      let alt = flown.alt;
      const trk = bearingDeg(here[0], here[1], field.lat, field.lon);
      if (emerKind === 'pressurisation') {
        const p2 = destination(here[0], here[1], trk, 14);
        b.line('descent', here, p2, alt, Math.max(10_000, field.elev + 4000), 420, 320, 4 * MIN);
        alt = Math.max(10_000, field.elev + 4000);
        entry = p2;
      } else if (emerKind === 'engine' && alt > 24_000) {
        const p2 = destination(here[0], here[1], trk, 35);
        b.line('descent', here, p2, alt, 24_000, flown.gs, flown.gs * 0.85, segDuration(35, flown.gs * 0.9));
        alt = 24_000;
        entry = p2;
      } else entry = here;
      if (field !== to) {
        divertedFrom = to;
        dest = field;
      }
      geo = arrivalAt(dest, destination(dest.lat, dest.lon, bearingDeg(dest.lat, dest.lon, entry[0], entry[1]), 25));
      entryAlt = Math.min(alt, geo.fafAlt + geo.vecLen * 250);
      const leg2 = [entry, geo.vectors[0]!];
      if (distanceNm(entry[0], entry[1], geo.vectors[0]![0], geo.vectors[0]![1]) > 2) {
        this.flyChain(b, leg2, { ...prof, alt0: alt, alt1: entryAlt, cruise: alt, steps: false, v0: flown.gs, v1: 250 });
      }
      b.ev('divert', { a: dest.ident });
      entry = geo.vectors[0]!;
    } else if (mission) {
      // ---- mission: orbit / patrol / training area, then return to base.
      const m = mission;
      const kt = m.role === 'fighter' ? 380 : m.role === 'patrol' ? 280 : 320;
      b.ev('orbit', { a: m.role, n: Math.round(m.ft / 100) });
      if (m.role === 'fighter') {
        // Manoeuvring: random loops and reversals across the training area.
        let p = m.area;
        let alt = m.ft;
        const until = b.time + m.durMs;
        while (b.time < until) {
          const pts: Pt[] = [p];
          for (let i = 0; i < 5; i++) pts.push(destination(m.area[0], m.area[1], this.rng.range(0, 360), this.rng.range(3, m.legNm)));
          const curve = smooth(pts, 3);
          const a2 = Math.max(8000, Math.min(36_000, alt + this.rng.int(-8, 8) * 1000));
          b.path('orbit', curve, alt, a2, kt, kt);
          alt = a2;
          p = curve[curve.length - 1]!;
        }
        entry = p;
        entryAlt = alt;
      } else {
        const laps = Math.max(1, Math.round(m.durMs / segDuration(2 * m.legNm + (kt / 60) * 2, kt)));
        b.path('orbit', racetrack(m.area, m.crs, kt, laps, m.legNm), m.ft, m.ft, kt, kt, m.durMs);
        entryAlt = m.ft;
      }
      const home = to;
      geo = arrivalAt(home, destination(home.lat, home.lon, bearingDeg(home.lat, home.lon, entry[0], entry[1]), 25));
      const back = [entry, geo.vectors[0]!];
      const e2 = Math.min(12_000, geo.fafAlt + geo.vecLen * 250);
      this.flyChain(b, back, { ...prof, alt0: entryAlt, alt1: e2, cruise: Math.max(entryAlt, 15_000), steps: false, v0: kt, v1: 250 });
      entry = geo.vectors[0]!;
      entryAlt = e2;
    } else if (divert && alternate) {
      // ---- weather diversion: hold at the arrival fix, then fly to the alternate.
      const crs = bearingDeg(entry[0], entry[1], to.lat, to.lon);
      // Hold for an improvement first (fuel permitting); about four in ten get in after all.
      const laps = this.rng.int(3, 6);
      b.ev('hold', { a: star?.fix.ident ?? '', n: Math.round(entryAlt / 100) });
      b.path('holding', racetrack(entry, crs, 230, laps), entryAlt, entryAlt, 230, 230);
      holdMs += b.time - b.segs[b.segs.length - 1]!.t0;
      improved = this.rng.next() < 0.4;
    }
    if (divert && alternate && !emerKind && !mission && improved) {
      b.ev('improve', { a: to.ident });
    } else if (divert && alternate && !emerKind && !mission) {
      divertedFrom = to;
      dest = alternate;
      b.ev('divert', { a: alternate.ident });
      geo = arrivalAt(alternate, destination(alternate.lat, alternate.lon, bearingDeg(alternate.lat, alternate.lon, to.lat, to.lon), 25));
      const nm = distanceNm(entry[0], entry[1], geo.vectors[0]![0], geo.vectors[0]![1]);
      b.line('cruise', entry, geo.vectors[0]!, entryAlt + 2000, Math.min(entryAlt, geo.fafAlt + geo.vecLen * 250), 300, 270, segDuration(nm, 285));
      entry = geo.vectors[0]!;
      entryAlt = Math.min(entryAlt, geo.fafAlt + geo.vecLen * 250);
    } else if (star) b.ev('star', { a: star.name });

    // ---- arrival: sequenced by wake-separated slot; hold over the arrival fix if needed.
    const { arr, athr, finalNm, P, faf, fafAlt, vectors, vecLen, turnOn } = geo;
    const vecKt = light ? 85 : 215;
    const vecDur = segDuration(vecLen, vecKt);
    const lvp = (dest.weather?.visSm ?? 10) < 0.75 || (dest.weather?.category === 'LIFR' && !light);
    const approach = light ? `visual ${arr.ident}` : lvp ? `ILS CAT III ${arr.ident}` : !dest.large && this.rng.next() < 0.35 ? `RNP ${arr.ident}` : dest.weather?.category === 'VFR' && !dest.large && this.rng.next() < 0.3 ? `visual ${arr.ident}` : `ILS ${arr.ident}`;
    // Runway occupancy: on tightly spaced finals the aircraft ahead is sometimes slow to
    // vacate, and Tower sends the follower around.
    let occupied = false;
    if (usesSlots && !priority && !emergency && dest.scheduled) {
      const want = b.time + vecDur;
      const slotA = this.reserveSlot(dest, 'arr', want, wake);
      const list = this.slots.get(`${dest.ident}:arr`);
      const i = list ? list.findIndex((x) => x.t === slotA) : -1;
      const gap = i > 0 ? slotA - list![i - 1]!.t : Infinity;
      occupied = airline && !light && gap < 110_000 && this.rng.next() < 0.012;
      const delay = slotA - want;
      if (delay > 3 * MIN) {
        const laps = Math.max(1, Math.round(delay / (4 * MIN)));
        b.ev('hold', { a: star?.fix.ident ?? '', n: Math.round(entryAlt / 100), b: String(slotA) });
        b.path('holding', racetrack(entry, bearingDeg(entry[0], entry[1], dest.lat, dest.lon), 230, laps), entryAlt, entryAlt, 230, 230, delay);
        holdMs += delay;
        b.ev('approach', { a: approach, n: Math.round((dest.elev + 3000) / 100) });
        b.path('approach', vectors, entryAlt, fafAlt, light ? 90 : 230, light ? 80 : 180, vecDur);
      } else {
        b.ev('approach', { a: approach, n: Math.round((dest.elev + 3000) / 100) });
        b.path('approach', vectors, entryAlt, fafAlt, light ? 90 : 230, light ? 80 : 180, vecDur + Math.max(0, delay));
      }
    } else {
      b.ev('approach', { a: approach, n: Math.round((dest.elev + 3000) / 100) });
      b.path('approach', vectors, entryAlt, fafAlt, light ? 90 : 230, light ? 80 : 180, vecDur);
    }

    const vapp = spec?.vappKt ?? (light ? 70 : t.cls === 'wide' ? 150 : 140);
    const dw = dest.weather;
    const goAround = airline && !light && !emergency && this.rng.next() < 0.004 + ((dw?.gustKt ?? 0) >= 30 ? 0.03 : 0) + (dw?.category === 'LIFR' ? 0.02 : 0) + (dw?.wx && /TS/.test(dw.wx) ? 0.02 : 0);
    if (goAround || occupied) {
      const short = P(0.6, 0);
      b.ev('final', { a: arr.ident });
      b.line('approach', faf, short, fafAlt, dest.elev + 200, vapp + 15, vapp, segDuration(finalNm - 0.6, vapp + 7));
      const upwind = P(-4, 0);
      b.ev('goaround', occupied && !goAround ? { a: arr.ident, b: 'occupied' } : { a: arr.ident });
      b.line('goaround', short, upwind, dest.elev + 200, dest.elev + 3000, vapp + 10, 190, segDuration(4.6, 170));
      const side = this.rng.next() < 0.5 ? 1 : -1;
      const circuit = smooth([upwind, P(-6, 4 * side), P(4, 5 * side), P(turnOn + 3, 5 * side), P(turnOn, 0), faf], 3);
      b.path('goaround', circuit, dest.elev + 3000, fafAlt, 200, 180);
    }
    b.ev('final', { a: arr.ident });
    b.line('approach', faf, athr, fafAlt, dest.elev + 50, vapp + 15, vapp, segDuration(finalNm, vapp + 7));
    const minRoll = light ? 0.2 : t.cls === 'wide' ? 0.85 : 0.6;
    const ex = light ? null : this.runwayExit(dest.ident, athr, arr.hdg, arr.lengthNm, minRoll);
    const stop = ex?.pt ?? destination(athr[0], athr[1], arr.hdg, light ? 0.2 : Math.min(arr.lengthNm * 0.5, 1));
    const rollOutNm = distanceNm(athr[0], athr[1], stop[0], stop[1]);
    b.ev('land', { a: arr.ident });
    b.line('landing', athr, stop, ground, ground, vapp, 20, segDuration(rollOutNm, (vapp + 20) / 2), { ease: 'decel' });
    b.ev('vacate', ex?.name ? { a: ex.name } : {});
    const tOnGuess = b.time + 6 * MIN;
    const standTo = this.takeStand(dest, tOnGuess - 5 * MIN, tOnGuess + af.turnMs + 30 * MIN, af, from);
    const inPlan = light ? null : this.taxiPlan(dest, stop, standTo.pt, 'in', arr.ident, t.cls === 'wide' ? 0.024 : 0.016);
    const taxiIn: TaxiInfo = { via: inPlan?.via ?? [], crossings: inPlan?.crossings.map((c) => c.runway) ?? [], runway: arr.ident };
    if (ex?.name) taxiIn.exit = ex.name;
    b.ev('taxiIn');
    if (inPlan) this.emitTaxi(b, inPlan, taxiKt, undefined, dest);
    else b.line('taxi', stop, standTo.pt, ground, ground, taxiKt, taxiKt, segDuration(Math.max(0.3, distanceNm(stop[0], stop[1], standTo.pt[0], standTo.pt[1]) * 1.3), taxiKt));
    b.ev('onblock');
    if (route?.star && route.star.fix && !star) delete route.star;
    return this.finishLeg(af, b, { kind, from, dest, tOff, start, standTo, holdMs, gateHoldMs, deiceMs, divertedFrom, route, taxiOut, taxiIn, approach, emergency, wake, cruiseFt });
  }

  /** Touch-and-go circuits at the home field, ending with a full-stop landing. */
  private finishCircuits(af: Airframe, b: Builder, ap: SimAirport, start: StandRef, dFix: Pt, climbOutAlt: number, tOff: number, wake: Wake): Leg {
    const rw = ap.inUse;
    const thr: Pt = [rw.lat, rw.lon];
    const L = Math.max(0.5, rw.lengthNm);
    const back = rw.hdg + 180;
    const P = (al: number, cross: number) => fromLocal(thr, back, al, cross);
    const side = (hash(ap.ident) & 1) === 0 ? 1 : -1; // left- or right-hand circuit
    const pa = ap.elev + 1000; // circuit height 1,000 ft
    const laps = this.rng.int(2, 5);
    let p = dFix;
    for (let i = 0; i < laps; i++) {
      b.ev('circuit', { n: i + 1 });
      const lap = smooth([p, P(-(L + 0.9), 0.4 * side), P(-(L + 0.8), 1.1 * side), P(-L * 0.4, 1.25 * side), P(1.1, 1.25 * side), P(1.6, 0.6 * side), P(1.6, 0)], 2);
      b.path('climb', lap.slice(0, Math.ceil(lap.length / 2)), i === 0 ? climbOutAlt : ap.elev + 400, pa, 80, 90);
      b.path('approach', lap.slice(Math.ceil(lap.length / 2) - 1), pa, ap.elev + 300, 90, 70);
      b.line('approach', P(1.6, 0), thr, ap.elev + 300, ap.elev + 30, 70, 62);
      const last = i === laps - 1;
      const touch = destination(thr[0], thr[1], rw.hdg, last ? 0.25 : 0.3);
      b.line('landing', thr, touch, ground, ground, 60, last ? 15 : 45, undefined, { ease: 'decel' });
      if (!last) {
        const lift = destination(touch[0], touch[1], rw.hdg, 0.25);
        b.line('takeoff', touch, lift, ground, ground, 45, 65, undefined, { ease: 'accel' });
        p = destination(lift[0], lift[1], rw.hdg, 0.6);
        b.line('climb', lift, p, ap.elev + 35, ap.elev + 400, 65, 80);
      } else p = touch;
    }
    b.ev('land', { a: rw.ident });
    const standTo = this.takeStand(ap, b.time, b.time + af.turnMs + 30 * MIN, af, ap);
    b.line('taxi', p, standTo.pt, ground, ground, 12, 12, segDuration(Math.max(0.3, distanceNm(p[0], p[1], standTo.pt[0], standTo.pt[1]) * 1.3), 12));
    b.ev('onblock');
    return this.finishLeg(af, b, { kind: 'circuits', from: ap, dest: ap, tOff, start, standTo, holdMs: 0, gateHoldMs: 0, deiceMs: 0, wake, cruiseFt: ap.elev + 1000 });
  }

  /** Helicopter flight between any two sites (airports, hospital pads, scenes, platforms). */
  buildHeliLeg(af: Airframe, from: SimAirport, to: SimAirport, tOff: number, kind: LegKind, stand?: StandRef): Leg {
    const t = af.type;
    const b = new Builder(tOff);
    const pad = (s: SimAirport) => (s.site ? ([s.lat, s.lon] as Pt) : destination(s.lat, s.lon, this.rng.range(0, 360), this.rng.range(0.1, 0.4)));
    const start: StandRef = stand ?? { pt: pad(from) };
    const standTo: StandRef = { pt: pad(to) };
    const offshore = from.site === 'offshore' || to.site === 'offshore' || kind === 'offshore';
    const cruiseAgl = offshore ? 3000 : kind === 'hems' ? 1200 : kind === 'shuttle' ? 1100 : t.ft;
    const climbTo = Math.max(from.elev, to.elev) + cruiseAgl;
    const tas = (offshore ? 140 : t.kt) * this.rng.range(0.95, 1.05);
    const nm = Math.max(1, distanceNm(start.pt[0], start.pt[1], standTo.pt[0], standTo.pt[1]));
    const crs = bearingDeg(start.pt[0], start.pt[1], standTo.pt[0], standTo.pt[1]);
    const rotorStart = kind === 'hems' && from.site === 'hospital' ? 1.5 * MIN : 3 * MIN;
    b.ev('clearance', {}, tOff - 2 * MIN);
    b.wait('parked', start.pt, rotorStart, crs);
    b.ev('takeoff');
    const outPt = destination(start.pt[0], start.pt[1], crs, Math.min(0.8, nm * 0.2));
    b.line('climb', start.pt, outPt, from.elev + 30, from.elev + Math.min(cruiseAgl, 700), 0, Math.min(90, tas * 0.7), 70_000);
    const inPt = destination(standTo.pt[0], standTo.pt[1], crs + 180, Math.min(0.8, nm * 0.2));
    if (distanceNm(outPt[0], outPt[1], inPt[0], inPt[1]) > 0.3) {
      const climbNm = Math.min(nm * 0.3, 3);
      const p1 = destination(outPt[0], outPt[1], crs, climbNm);
      b.line('climb', outPt, p1, from.elev + Math.min(cruiseAgl, 700), climbTo, tas * 0.7, tas, segDuration(climbNm, tas * 0.85));
      b.ev('cruise', { n: Math.round(climbTo / 100) });
      const descNm = Math.min(nm * 0.3, 3);
      const p2 = destination(inPt[0], inPt[1], crs + 180, descNm);
      if (distanceNm(p1[0], p1[1], p2[0], p2[1]) > 0.2) b.line('cruise', p1, p2, climbTo, climbTo, tas, tas);
      b.ev('approach', { a: to.site === 'offshore' ? 'deck' : to.site === 'hospital' ? 'helipad' : to.site === 'scene' ? 'scene' : 'heli' });
      b.line('descent', p2, inPt, climbTo, to.elev + 300, tas, 60, segDuration(descNm, (tas + 60) / 2));
    }
    b.line('approach', inPt, standTo.pt, to.elev + 300, to.elev + 20, 50, 0, 90_000, { ease: 'decel' });
    b.ev(to.site === 'scene' ? 'scene' : 'land', { a: to.site ?? '' });
    b.wait('parked', standTo.pt, MIN, crs);
    b.ev('onblock');
    return this.finishLeg(af, b, { kind, from, dest: to, tOff, start, standTo, holdMs: 0, gateHoldMs: 0, deiceMs: 0, wake: 'L', cruiseFt: climbTo });
  }

  /** Glider flight: winch launch, thermalling climbs and glides around a cross-country task, landing back at the site. */
  buildGliderLeg(af: Airframe, site: SimAirport, tOff: number): Leg {
    const b = new Builder(tOff);
    const rw = site.inUse;
    const wd = site.weather?.windDir ?? this.rng.range(200, 300);
    const into = norm(wd);
    const startPt = destination(site.lat, site.lon, into + 180, 0.25);
    const start: StandRef = { pt: startPt, hdg: into };
    void rw;
    b.wait('parked', startPt, 4 * MIN, into);
    b.ev('takeoff', { a: 'winch' });
    const top = destination(startPt[0], startPt[1], into, 0.45);
    const elev = site.elev;
    b.line('climb', startPt, top, elev + 20, elev + 1300, 55, 60, 50_000);
    b.ev('release', { n: Math.round((elev + 1300) / 100) });
    // Cross-country task: a triangle of 15–60 NM legs (shorter for training gliders).
    const two = af.type.code === 'AS21';
    const legNm = two ? this.rng.range(4, 14) : this.rng.range(15, 55);
    const b0 = this.rng.range(0, 360);
    const tps: Pt[] = [destination(site.lat, site.lon, b0, legNm), destination(site.lat, site.lon, b0 + 60, legNm), [site.lat, site.lon]];
    const kmh = { dir: wd, kt: site.weather?.windKt ?? this.rng.range(5, 15) };
    const drift = (min: number): Pt => {
      const d = (kmh.kt * min) / 60; // NM drifted downwind while circling
      const p = destination(0, 0, kmh.dir + 180, d);
      return [p[0], p[1]];
    };
    let p = top;
    let alt = elev + 1300;
    const cloudbase = elev + this.rng.range(3500, 6500);
    const until = tOff + this.rng.range(1.2, two ? 1.5 : 4.5) * H;
    let tp = 0;
    let guard = 0;
    while (guard++ < 60) {
      // Thermal: circle up at 2–4 kt (≈200–400 ft/min) to near cloud base.
      const climbFpm = this.rng.range(200, 420);
      const gain = Math.max(300, cloudbase - alt - this.rng.range(0, 500));
      const mins = gain / climbFpm;
      const turns = (mins * 60) / 22; // ≈22 s per turn
      const c = destination(p[0], p[1], this.rng.range(0, 360), 0.08);
      const ring = circle(c, 0.08, bearingDeg(c[0], c[1], p[0], p[1]), turns, drift(mins));
      b.path('soaring', [p, ...ring], alt, alt + gain, 48, 48, mins * MIN);
      alt += gain;
      p = ring[ring.length - 1]!;
      // Glide towards the next turnpoint (glide ratio ~35:1 → ~175 ft lost per NM).
      const goal = tps[tp]!;
      const dist = distanceNm(p[0], p[1], goal[0], goal[1]);
      const reach = Math.max(0, (alt - elev - 1200) / 175);
      const go = Math.min(dist, reach, this.rng.range(6, 18));
      const q = go >= dist - 0.1 ? goal : destination(p[0], p[1], bearingDeg(p[0], p[1], goal[0], goal[1]), go);
      const lose = go * 175;
      b.path('soaring', [p, q], alt, alt - lose, 60, 60, segDuration(go, 60));
      alt -= lose;
      p = q;
      if (distanceNm(p[0], p[1], goal[0], goal[1]) < 0.3) tp++;
      if (tp >= tps.length || b.time > until) break;
    }
    // Final glide home and a circuit to land.
    const home: Pt = [site.lat, site.lon];
    const dist = distanceNm(p[0], p[1], home[0], home[1]);
    if (dist > 0.3) {
      b.path('soaring', [p, home], alt, Math.max(elev + 900, alt - dist * 175), 60, 60, segDuration(dist, 60));
      alt = Math.max(elev + 900, alt - dist * 175);
    }
    const land = destination(site.lat, site.lon, into + 180, 0.2);
    const circuit = smooth([home, destination(home[0], home[1], into + 90, 0.5), destination(home[0], home[1], into + 150, 0.8), destination(home[0], home[1], into + 180, 0.7), land], 2);
    b.path('approach', circuit, alt, elev + 30, 55, 50);
    b.ev('land', {});
    const stopPt = destination(land[0], land[1], into, 0.12);
    b.line('landing', land, stopPt, ground, ground, 45, 0, 25_000, { ease: 'decel' });
    b.wait('parked', stopPt, MIN, into);
    return this.finishLeg(af, b, { kind: 'glider', from: site, dest: site, tOff, start, standTo: { pt: stopPt, hdg: into }, holdMs: 0, gateHoldMs: 0, deiceMs: 0, wake: 'L', cruiseFt: cloudbase });
  }

  /** Tow plane: an aerotow climb to ~2,000 ft above the site, release, quick descent, landing. */
  buildTowLeg(af: Airframe, site: SimAirport, tOff: number): Leg {
    const b = new Builder(tOff);
    const into = norm(site.weather?.windDir ?? 250);
    const p0 = destination(site.lat, site.lon, into + 180, 0.25);
    b.wait('parked', p0, 2 * MIN, into);
    b.ev('takeoff', { a: 'aerotow' });
    const p1 = destination(p0[0], p0[1], into, 0.4);
    b.line('takeoff', p0, p1, ground, ground, 0, 55, 35_000, { ease: 'accel' });
    const climb = circle(destination(site.lat, site.lon, into + 90, 1.2), 1.2, into - 90, 1.1);
    const top = site.elev + 2000;
    b.path('climb', [p1, ...climb], site.elev + 50, top, 65, 65, 6 * MIN);
    b.ev('release', { n: Math.round(top / 100) });
    const end = climb[climb.length - 1]!;
    const land = destination(site.lat, site.lon, into + 180, 0.3);
    b.path('descent', smooth([end, destination(site.lat, site.lon, into + 120, 1.2), destination(site.lat, site.lon, into + 180, 1.2), land], 2), top, site.elev + 30, 100, 65, 4 * MIN);
    b.ev('land', {});
    const stop = destination(land[0], land[1], into, 0.15);
    b.line('landing', land, stop, ground, ground, 55, 5, 25_000, { ease: 'decel' });
    b.wait('parked', stop, MIN, into);
    return this.finishLeg(af, b, { kind: 'tow', from: site, dest: site, tOff, start: { pt: p0, hdg: into }, standTo: { pt: p0, hdg: into }, holdMs: 0, gateHoldMs: 0, deiceMs: 0, wake: 'L', cruiseFt: top });
  }

  /** Schedule, flight number, codeshares and cancellations for a finished movement. */
  private finishLeg(
    af: Airframe,
    b: Builder,
    o: { kind: LegKind; from: SimAirport; dest: SimAirport; tOff: number; start: StandRef; standTo: StandRef; holdMs: number; gateHoldMs: number; deiceMs: number; wake: Wake; cruiseFt: number; divertedFrom?: SimAirport | undefined; route?: RouteInfo | undefined; taxiOut?: TaxiInfo | undefined; taxiIn?: TaxiInfo | undefined; approach?: string | undefined; emergency?: Emergency | undefined },
  ): Leg {
    const { from, tOff } = o;
    const to = o.divertedFrom ?? o.dest; // planned destination
    const segs = b.segs;
    const time = b.time;
    const heli = af.type.cls === 'heli' || af.type.cls === 'glider';
    const tTakeoff = segs.find((s) => s.phase === 'climb' || s.phase === 'takeoff')?.t0 ?? tOff;
    const tLand = heli ? (segs.findLast((s) => s.phase === 'approach' || s.phase === 'landing')?.t1 ?? time) : (segs.find((s) => s.phase === 'landing')?.t0 ?? segs.findLast((s) => !Number.isNaN(s.alt1))?.t1 ?? time);
    const block = time - tOff - o.holdMs - o.gateHoldMs;
    const scheduled = af.role === 'airline';
    const delay = !scheduled ? this.rng.range(-5, 5) : this.rng.next() < 0.7 ? this.rng.range(-4, 12) : this.rng.range(12, 55);
    const std = round5(tOff - o.gateHoldMs - delay * MIN);
    const sta = round5(std + block + o.gateHoldMs * 0.3 + (scheduled ? this.rng.range(5, 20) : 0) * MIN);
    let flight: string;
    let flightIata: string | undefined;
    let codeshares: string[] = [];
    let days: RouteDays | undefined;
    if (af.airline) {
      const fn = this.flightNumber(af, from, to, std);
      flight = fn.icao;
      flightIata = fn.iata;
      if (o.kind === 'positioning' || o.kind === 'delivery') {
        // Ferry flights use a separate number range and carry no passengers.
        const n = 9000 + (hash(af.hex + std) % 900);
        flight = af.airline.alnum ? `${af.airline.icao}${(n % 90) + 1}P` : `${af.airline.icao}${n}`;
        flightIata = `${af.airline.iata}${n}`;
      } else {
        codeshares = this.codeshares(af, from, to, fn.num);
        const model = this.airlineModel(af.airline);
        const atHub = af.airline.hubs.includes(from.ident) || af.airline.hubs.includes(to.ident);
        const leisure = leisureOf(to.ident, to.lat, to.lon);
        days = routeDays(af.airline.icao, from.ident, to.ident, { distNm: distanceNm(from.lat, from.lon, to.lat, to.lon), hubEnd: atHub, bothLarge: from.large && to.large, leisure, model });
      }
    } else flight = this.opCallsign(af, o.kind);
    // Cancellations: rare, more likely when either end has bad weather.
    const wxBad = (a: SimAirport) => (a.weather?.category === 'LIFR' ? 0.05 : a.weather?.category === 'IFR' ? 0.012 : 0) + ((a.weather?.gustKt ?? 0) >= 40 ? 0.04 : 0) + (a.weather?.wx && /\+SN|FZRA/.test(a.weather.wx) ? 0.06 : 0);
    const cancel = scheduled && o.kind !== 'delivery' && o.kind !== 'positioning' && this.rng.next() < 0.004 + wxBad(from) + wxBad(to);
    const leg: Leg = {
      kind: o.kind,
      flight,
      codeshares,
      from,
      to: o.dest,
      std,
      sta,
      tOff,
      tTakeoff,
      tLand,
      tOn: time,
      holdMs: o.holdMs,
      gateHoldMs: o.gateHoldMs,
      deiceMs: o.deiceMs,
      cruiseFt: segs.reduce((m, s) => Math.max(m, Number.isNaN(s.alt1) ? 0 : s.alt1), 0),
      segs,
      stand: o.start,
      standTo: o.standTo,
      events: b.events.sort((x, y) => x.t - y.t),
      wake: o.wake,
      turnAfter: 0,
    };
    if (flightIata) leg.flightIata = flightIata;
    if (o.divertedFrom) leg.divertedFrom = o.divertedFrom;
    if (o.route) leg.route = o.route;
    if (o.taxiOut) leg.taxiOut = o.taxiOut;
    if (o.taxiIn) leg.taxiIn = o.taxiIn;
    if (o.approach) leg.approach = o.approach;
    if (o.emergency) leg.emergency = o.emergency;
    if (days) leg.days = days;
    if (cancel) {
      // Keep the schedule for the boards, but the aircraft never leaves its stand.
      leg.canceled = true;
      leg.canceledTo = o.dest;
      leg.to = from;
      leg.standTo = o.start;
      leg.segs = [{ t0: tOff, t1: leg.tOn, phase: 'parked', kind: 'line', a: o.start.pt, b: o.start.pt, alt0: ground, alt1: ground, spd0: 0, spd1: 0 }];
      leg.events = [{ t: tOff - 90 * MIN, k: 'canceled' }];
      leg.tTakeoff = leg.tLand = leg.tOn;
      leg.holdMs = 0;
      delete leg.divertedFrom;
      delete leg.emergency;
      delete leg.route;
    }
    // Ground time after this flight.
    const next = this.turnaround(af, leg.tOn, leg.to);
    leg.turnAfter =
      leg.emergency?.kind === 'engine' ? this.rng.range(10, 20) * H : leg.emergency ? this.rng.range(70, 120) * MIN : af.role === 'hems' ? (leg.to.site === 'scene' ? this.rng.range(15, 30) : leg.to.site === 'hospital' && leg.to !== af.home ? this.rng.range(15, 25) : this.rng.range(40, 300)) * MIN : af.role === 'offshore' ? (leg.to.site === 'offshore' ? this.rng.range(15, 30) * MIN : this.rng.range(60, 200) * MIN) : af.role === 'shuttle' ? this.rng.range(15, 50) * MIN : af.role === 'glider' || af.role === 'tow' ? this.rng.range(8, 45) * MIN : next;
    af.turnMs = leg.turnAfter;
    // Rotation: where this aircraft goes next (shown on the flight card, flown in turn).
    if (af.role === 'airline' && !leg.canceled && !leg.divertedFrom && !leg.emergency) leg.plannedNext = this.chooseDestination(af, leg.to, leg.tOn + leg.turnAfter);
    return leg;
  }

  /** Builds the next leg after `prev` for any role. */
  private nextLeg(af: Airframe, prev: Leg): Leg {
    const at = prev.to;
    const tOff = this.releaseTime(af, at, prev.tOn + prev.turnAfter);
    switch (af.role) {
      case 'hems': {
        const base = af.home!;
        if (at.site === 'scene') return this.buildHeliLeg(af, at, this.hospitalNear(at, at.country) ?? base, tOff, 'hems');
        if (at !== base) return this.buildHeliLeg(af, at, base, tOff, 'hems');
        return this.buildHeliLeg(af, base, this.sceneNear(base), tOff, 'hems');
      }
      case 'offshore': {
        const base = af.home!;
        if (at !== base) return this.buildHeliLeg(af, at, base, tOff, 'offshore');
        const op = OFFSHORE.find((o) => o.base === base.ident);
        const [s, w, n, e] = op?.region ?? [0, 0, 0, 0];
        const rigs = this.sites.filter((p) => p.site === 'offshore' && p.lat >= s && p.lat <= n && p.lon >= w && p.lon <= e && distanceNm(p.lat, p.lon, base.lat, base.lon) < 260);
        return this.buildHeliLeg(af, base, rigs.length ? this.rng.pick(rigs) : base, tOff, 'offshore');
      }
      case 'shuttle': {
        const ap = af.home!;
        if (at !== ap) return this.buildHeliLeg(af, at, ap, tOff, 'shuttle');
        const pads = this.sites.filter((p) => p.site === 'heliport' && Math.abs(p.lat - ap.lat) < 0.6 && distanceNm(p.lat, p.lon, ap.lat, ap.lon) <= 30);
        return this.buildHeliLeg(af, ap, pads.length ? this.rng.pick(pads) : ap, tOff, 'shuttle');
      }
      case 'glider':
        return this.buildGliderLeg(af, at, tOff);
      case 'tow':
        return this.buildTowLeg(af, at, tOff);
      case 'mil': {
        const op = MILITARY.find((m) => m.icao === af.op?.icao);
        if (!op) return this.buildLeg(af, at, af.home ?? at, tOff, prev.standTo);
        const [from, to, plan] = this.milNext(af, op, at, tOff);
        const role = af.milRole;
        return this.buildLeg(af, from, to, tOff, prev.standTo, { kind: plan ? (role === 'tanker' ? 'tanker' : role === 'awacs' ? 'awacs' : role === 'patrol' ? 'patrol' : 'training') : 'military', mission: plan });
      }
      case 'ambulance': {
        const home = af.home ?? at;
        const to = at === home ? this.ambulanceDestination(home, af.type) : home;
        return this.buildLeg(af, at, to, tOff, prev.standTo, { kind: 'ambulance' });
      }
      default: {
        // A diverted aircraft returns to where it was meant to go; an engine failure
        // means a ferry (positioning) flight back to base once it is repaired.
        if (prev.emergency?.kind === 'engine' && af.airline) {
          const hub = this.airports.get(af.airline.hubs[0]!);
          if (hub && hub !== at) return this.buildLeg(af, at, hub, tOff, prev.standTo, { kind: 'positioning' });
        }
        let next = prev.canceledTo ?? prev.divertedFrom ?? (prev.plannedNext && prev.plannedNext !== at ? prev.plannedNext : this.chooseDestination(af, at, tOff));
        if (next === at) next = this.chooseDestination(af, at, tOff);
        // Occasionally an aircraft positions empty to a hub (maintenance, schedule recovery).
        const positioning = !!af.airline && !af.airline.hubs.includes(at.ident) && this.rng.next() < 0.012;
        if (positioning) {
          const hub = this.airports.get(af.airline!.hubs[0]!);
          if (hub && hub !== at && distanceNm(at.lat, at.lon, hub.lat, hub.lon) <= af.type.range) return this.buildLeg(af, at, hub, tOff, prev.standTo, { kind: 'positioning' });
        }
        // Crew duty limits: a crew that would run out of hours needs a replacement crew
        // (a short wait at the hub) or, at an outstation, sometimes its legal rest.
        let crewDelay = 0;
        if (af.airline) {
          const limit = (af.type.cls === 'wide' ? 16 : 13) * H;
          const est = (distanceNm(at.lat, at.lon, next.lat, next.lon) / (af.type.kt * 0.88)) * H + 50 * MIN;
          if (af.dutyStart === undefined || prev.turnAfter >= 8 * H) af.dutyStart = tOff - 60 * MIN;
          else if (tOff + est - af.dutyStart > limit) {
            const r = this.rng.next();
            if (af.airline.hubs.includes(at.ident)) crewDelay = r < 0.35 ? this.rng.range(25, 80) * MIN : 0;
            else crewDelay = r < 0.12 ? this.rng.range(9.5, 12) * H : r < 0.45 ? this.rng.range(30, 120) * MIN : 0;
            af.dutyStart = tOff + crewDelay - 60 * MIN;
          }
        }
        // Night curfews: the timetable avoids departing or arriving while one is in force.
        let curfewShift = 0;
        if (af.airline) {
          const est = (distanceNm(at.lat, at.lon, next.lat, next.lon) / (af.type.kt * 0.88)) * H + 35 * MIN;
          const t0 = tOff + crewDelay;
          const depLift = curfewEnd(at.ident, t0, at.lon);
          if (depLift !== null) curfewShift = depLift - t0 + this.rng.range(0, 120) * MIN;
          const arrLift = curfewEnd(next.ident, t0 + curfewShift + est, next.lon);
          if (arrLift !== null) curfewShift += arrLift - (t0 + curfewShift + est) + this.rng.range(5, 150) * MIN;
          if (curfewShift > 12 * H) curfewShift = 0;
        }
        // Maintenance: an overnight A-check (or, rarely, a heavy C-check) at the home base.
        let maint: { check: string; from: number; until: number } | undefined;
        const day = Math.floor(tOff / 86_400_000);
        if (af.airline && af.maintDay !== day) {
          const due = maintenanceDue((hash(`${af.hex}m${day}`) % 100_000) / 100_000, localHour(tOff, at.lon), af.airline.hubs.includes(at.ident));
          if (due) {
            af.maintDay = day;
            maint = { check: due.check, from: tOff, until: tOff + due.ms };
          }
        }
        const leg = this.buildLeg(af, at, next, tOff + crewDelay + curfewShift + (maint ? maint.until - maint.from : 0), prev.standTo);
        if (maint && !leg.canceled) leg.maint = maint;
        if (crewDelay > 0 && !leg.canceled) {
          leg.crewDelayMs = crewDelay;
          leg.std = round5(leg.std - crewDelay);
          leg.sta = round5(leg.sta - crewDelay);
          leg.events.unshift({ t: tOff, k: 'crew', n: Math.round(crewDelay / MIN) });
        }
        return leg;
      }
    }
  }

  private summary(leg: Leg): LegSummary {
    const s: LegSummary = { flight: leg.flight, kind: leg.kind, from: leg.from, to: leg.canceled ? (leg.canceledTo ?? leg.to) : leg.to, std: leg.std, sta: leg.sta, tOff: leg.tOff, tOn: leg.tOn };
    if (leg.flightIata) s.flightIata = leg.flightIata;
    if (leg.divertedFrom) s.divertedFrom = leg.divertedFrom;
    if (leg.canceled) s.canceled = true;
    if (leg.emergency) s.emergency = leg.emergency.kind;
    return s;
  }

  /**
   * Plausible earlier flights for an airline airframe (before the simulation started),
   * built on demand: the rotation is walked backwards from the oldest known flight,
   * alternating hub and outstations, until there are eight.
   */
  ensureHistory(af: Airframe) {
    const al = af.airline;
    if (!al || af.historyBuilt) return;
    af.historyBuilt = true;
    const rng = new Rng(hash(af.hex) % 2147483646 || 3);
    const oldest = af.history[af.history.length - 1];
    let to = oldest ? oldest.from : af.leg.from;
    let tOn = (oldest ? oldest.tOff : af.leg.tOff) - af.turnMs * rng.range(0.6, 1.1);
    const hubs = al.hubs.map((h) => this.airports.get(h)).filter((a): a is SimAirport => !!a);
    while (af.history.length < 8) {
      let from: SimAirport | undefined;
      if (!al.hubs.includes(to.ident) && hubs.length) from = rng.pick(hubs);
      else {
        for (let k = 0; k < 30 && !from; k++) {
          const a = this.scheduledPool.pick(rng);
          if (!a || a === to) continue;
          const d = distanceNm(a.lat, a.lon, to.lat, to.lon);
          if (d > (af.type.cls === 'wide' ? 700 : 120) && d < af.type.range * 0.9 && (af.type.cls !== 'wide' || a.large)) from = a;
        }
      }
      if (!from) break;
      const d = distanceNm(from.lat, from.lon, to.lat, to.lon);
      const dur = (d / (af.type.kt * 0.9)) * H + rng.range(25, 40) * MIN;
      const tOff = tOn - dur;
      const delay = rng.next() < 0.7 ? rng.range(-4, 12) : rng.range(12, 55);
      const std = round5(tOff - delay * MIN);
      const fn = this.flightNumber(af, from, to, std);
      af.history.push({ flight: fn.icao, flightIata: fn.iata, kind: CARGO.has(al.icao) ? 'cargo' : 'scheduled', from, to, std, sta: round5(std + dur + rng.range(5, 20) * MIN), tOff, tOn });
      to = from;
      tOn = tOff - rng.range(0.7, 2) * af.turnMs - (rng.next() < 0.15 ? rng.range(4, 9) * H : 0);
    }
  }

  /** Advance every airframe so that its current leg covers `now`. */
  advance(now: number) {
    this.lastNow = now;
    for (const af of this.airframes) {
      let guard = 0;
      while (now >= af.leg.tOn + af.leg.turnAfter && guard++ < 20) {
        const prev = af.leg;
        af.prev = prev;
        af.history.unshift(this.summary(prev));
        if (af.history.length > 12) af.history.length = 12;
        af.leg = this.nextLeg(af, prev);
        if (af.role === 'airline' || af.role === 'mil' || af.role === 'offshore' || af.role === 'shuttle' || af.role === 'ambulance') af.squawk = this.squawkFor();
      }
    }
  }

  private segAt(leg: Leg, now: number) {
    let lo = 0;
    let hi = leg.segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (leg.segs[mid]!.t1 <= now) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Transponder code at a moment (7700 after an emergency is declared). */
  squawkAt(af: Airframe, now: number): string {
    const e = af.leg.emergency;
    if (e?.squawk && now >= e.t && now < af.leg.tLand + 3 * MIN) return e.squawk;
    return af.squawk;
  }

  /** The segment the airframe is on at `now` (undefined when parked). */
  segNow(af: Airframe, now: number): Seg | undefined {
    const leg = af.leg;
    if (now < leg.tOff || now >= leg.tOn || leg.canceled) return undefined;
    return leg.segs[this.segAt(leg, now)];
  }

  /** Position/state of an airframe at sim time `now`. */
  state(af: Airframe, now: number): SimState {
    const leg = af.leg;
    const glide = af.role === 'glider' || af.role === 'tow';
    if (now < leg.tOff) {
      // Parked at the stand before departure; transponder on ~40 min before off-block.
      const recent = !!af.prev && now - af.prev.tOn < 15 * MIN;
      const s = recent ? af.prev!.standTo : leg.stand;
      const soon = glide ? leg.tOff - now < 20 * MIN : af.type.cls === 'heli' ? leg.tOff - now < 10 * MIN : leg.tOff - now < 40 * MIN;
      return { lat: s.pt[0], lon: s.pt[1], gs: 0, trk: s.hdg ?? (leg.from.inUse.hdg + 90) % 360, vr: 0, onGround: true, phase: 'parked', emit: soon || recent };
    }
    if (now >= leg.tOn) {
      const s = leg.standTo;
      return { lat: s.pt[0], lon: s.pt[1], gs: 0, trk: s.hdg ?? (leg.to.inUse.hdg + 90) % 360, vr: 0, onGround: true, phase: 'parked', emit: now - leg.tOn < (glide ? 5 : 15) * MIN };
    }
    if (leg.canceled) {
      const p = leg.stand;
      return { lat: p.pt[0], lon: p.pt[1], gs: 0, trk: p.hdg ?? (leg.from.inUse.hdg + 90) % 360, vr: 0, onGround: true, phase: 'parked', emit: false };
    }
    const i = this.segAt(leg, now);
    const s = leg.segs[i]!;
    const f = s.t1 > s.t0 ? Math.min(1, Math.max(0, (now - s.t0) / (s.t1 - s.t0))) : 1;
    const g = s.ease === 'accel' ? f * f : s.ease === 'decel' ? 1 - (1 - f) * (1 - f) : f;
    const [lat, lon] = pointOn(s, g);
    const moving = s.a[0] !== s.b[0] || s.a[1] !== s.b[1] || s.kind === 'path';
    let trk: number;
    if (moving) {
      const [nl, no] = pointOn(s, Math.min(1, g + 0.004));
      if (nl === lat && no === lon) {
        const [pl, po] = pointOn(s, Math.max(0, g - 0.004));
        trk = pl === lat && po === lon ? bearingDeg(s.a[0], s.a[1], s.b[0], s.b[1]) : bearingDeg(pl, po, lat, lon);
      } else trk = bearingDeg(lat, lon, nl, no);
    } else if (s.phase === 'taxi') {
      // Holding short / lined up: face the runway direction.
      trk = leg.from.inUse.hdg;
    } else trk = leg.stand.hdg ?? (leg.from.inUse.hdg + 90) % 360;
    if (s.nose !== undefined) trk = s.nose;
    else if (s.reverse && moving) trk = (trk + 180) % 360;
    const onGround = Number.isNaN(s.alt0);
    let gs = s.spd0 + (s.spd1 - s.spd0) * f;
    if (s.kind === 'path' && (s.phase === 'holding' || s.phase === 'orbit' || s.phase === 'soaring')) gs = (s.cum!.at(-1)! / Math.max(1e-6, (s.t1 - s.t0) / H)) * (0.97 + 0.03 * Math.sin(f * 40));
    if (onGround) return { lat, lon, gs, trk, vr: 0, onGround, phase: s.phase, emit: true };
    const alt = s.alt0 + (s.alt1 - s.alt0) * f;
    const vr = ((s.alt1 - s.alt0) / Math.max(1, (s.t1 - s.t0) / MIN)) | 0;
    const out: SimState = { lat, lon, alt, gs, trk, vr, onGround: false, phase: s.phase, emit: true };
    if (s.wind) out.wind = s.wind;
    else if (alt > 5000) {
      const w = windAloft(lat, lon, now, this.windSeed);
      const kt = Math.round(w.kt * Math.min(1, alt / 30000));
      out.wind = { dir: w.dir, kt, comp: tailwind({ dir: w.dir, kt }, trk) };
    }
    return out;
  }

  /**
   * Estimated on-block time as a flight-management computer would show it: the remaining
   * cruise is flown at the CURRENT wind, so the estimate moves as the winds change.
   */
  eta(af: Airframe, now: number): number {
    const leg = af.leg;
    if (now < leg.tOff || now >= leg.tOn) return leg.tOn;
    const i = this.segAt(leg, now);
    const cur = leg.segs[i]!;
    if (cur.phase !== 'cruise' || !cur.wind) return leg.tOn;
    let t = now;
    for (let k = i; k < leg.segs.length; k++) {
      const s = leg.segs[k]!;
      const startF = k === i ? (now - s.t0) / (s.t1 - s.t0) : 0;
      const dur = (s.t1 - s.t0) * (1 - startF);
      if (k > i && s.phase === 'cruise' && s.wind) {
        // Later cruise: blend the forecast wind for that part with the wind being flown now.
        const gs = (s.spd0 + s.spd1) / 2;
        const withNow = Math.max(gs * 0.6, gs - s.wind.comp + cur.wind.comp);
        t += (dur * gs) / ((gs + withNow) / 2);
      } else t += dur;
    }
    return t;
  }

  /** Simulated past positions of the current leg (for the trail). */
  trail(af: Airframe, now: number, windowMs: number): { lat: number; lon: number; alt?: number; gs: number; vr: number; t: number }[] {
    const leg = af.leg;
    const start = Math.max(leg.tOff, now - windowMs);
    if (now <= start) return [];
    const step = Math.max(15_000, (now - start) / 180);
    const out = [];
    for (let t = start; t <= now; t += step) {
      const s = this.state(af, t);
      out.push({ lat: s.lat, lon: s.lon, alt: s.onGround ? 0 : s.alt, gs: s.gs, vr: s.vr, t });
    }
    return out;
  }

  /** The remaining planned path of the current leg (for the route line). */
  plannedPath(af: Airframe, now: number): Pt[] {
    const leg = af.leg;
    const out: Pt[] = [];
    for (const s of leg.segs) {
      if (s.t1 < now) continue;
      if (s.kind === 'gc') {
        const n = Math.max(2, Math.ceil(distanceNm(s.a[0], s.a[1], s.b[0], s.b[1]) / 40));
        for (let k = 0; k <= n; k++) out.push(intermediatePoint(s.a[0], s.a[1], s.b[0], s.b[1], k / n));
      } else if (s.kind === 'path') out.push(...s.pts!);
      else out.push(s.a, s.b);
    }
    return out;
  }
}

/**
 * Marks stands big enough for wide-bodies: OpenStreetMap has no stand sizes, but wide-body
 * stands sit ~65–80 m apart against ~40–50 m for narrow-bodies.
 */
function markWideStands(stands: Stand[]) {
  const cell = (la: number, lo: number) => `${Math.round(la * 1500)},${Math.round(lo * 1500)}`;
  const grid = new Map<string, Stand[]>();
  for (const s of stands) {
    const k = cell(s.lat, s.lon);
    const g = grid.get(k);
    if (g) g.push(s);
    else grid.set(k, [s]);
  }
  for (const s of stands) {
    let nn = Infinity;
    const cy = Math.round(s.lat * 1500);
    const cx = Math.round(s.lon * 1500);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (const o of grid.get(`${cy + dy},${cx + dx}`) ?? []) {
          if (o === s) continue;
          const m = distanceNm(s.lat, s.lon, o.lat, o.lon) * 1852;
          if (m < nn) nn = m;
        }
    s.wide = s.kind !== 3 && nn >= 58;
  }
}

function bestRunway(ends: SimRunway[], windDir: number): SimRunway {
  return ends.reduce((best, e) => (Math.abs(angle(e.hdg, windDir)) < Math.abs(angle(best.hdg, windDir)) ? e : best), ends[0]!);
}

function pointOn(s: Seg, x: number): Pt {
  if (s.kind === 'gc') return intermediatePoint(s.a[0], s.a[1], s.b[0], s.b[1], x);
  if (s.kind === 'path') {
    const cum = s.cum!;
    const pts = s.pts!;
    const d = x * cum[cum.length - 1]!;
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid]! < d) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return pts[0]!;
    const a = pts[lo - 1]!;
    const b = pts[lo]!;
    const span = cum[lo]! - cum[lo - 1]!;
    const k = span > 0 ? (d - cum[lo - 1]!) / span : 0;
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  }
  return [s.a[0] + (s.b[0] - s.a[0]) * x, s.a[1] + (s.b[1] - s.a[1]) * x];
}
