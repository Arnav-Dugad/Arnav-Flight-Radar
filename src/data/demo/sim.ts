// Demo-world flight simulator. Generates an entire planet of simulated traffic:
// airframes cycle through stand → taxi → take-off → climb → cruise → descent →
// arrival (vectors / holding) → final → landing → taxi → turnaround, on great-circle
// routes between real airports, using the runway each airport has "in use".
//
//  • Runway slots sequence arrivals and departures; when an airport is busy (or its
//    weather cuts capacity) arrivals hold in racetrack patterns and departures queue.
//  • Bad weather at the destination can cause diversions to a nearby alternate.
//  • Arrivals are vectored onto final via downwind/base legs (published procedures
//    are not freely available worldwide, so standard radar-vector geometry is used).
//  • Where OpenStreetMap stand and taxiway data is loaded, aircraft park on real
//    stands and taxi along real taxiways.
//  • Winds aloft change ground speed, so estimated arrival times move in flight.
//
// EVERYTHING produced here is simulated and is only ever shown in demo mode.

import { bearingDeg, destination, distanceNm, intermediatePoint } from '@shared/geo';
import { icaoBlock } from '@shared/icaoCountry';
import type { AirportIndexEntry } from '@shared/types';
import { AIRLINES, ALLIANCES, GA_COUNTRIES, GA_TYPES, TYPES, type AirlineProfile, type TypeInfo } from './fleet';

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

type Pt = [number, number];

export interface SimRunway {
  ident: string;
  lat: number;
  lon: number;
  hdg: number;
  lengthNm: number;
}

export interface Stand {
  lat: number;
  lon: number;
  ref?: string;
  hdg?: number; // nose direction when parked
}

export interface SimWeather {
  category?: 'VFR' | 'MVFR' | 'IFR' | 'LIFR';
  windDir?: number;
  windKt?: number;
  gustKt?: number;
  observedAt?: number;
}

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
  inUse: SimRunway; // runway direction in use (into the wind)
  /** Where the runway choice came from. */
  inUseBasis: 'simulated' | 'metar';
  stands?: Stand[]; // OpenStreetMap parking positions / gates
  weather?: SimWeather;
}

export interface TaxiGraph {
  nodes: Pt[];
  adj: number[][];
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

export type Phase = 'parked' | 'taxi' | 'takeoff' | 'climb' | 'cruise' | 'descent' | 'holding' | 'approach' | 'landing';

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
  /** Wind on this segment (direction it blows FROM, speed) and its along-track component. */
  wind?: { dir: number; kt: number; comp: number };
}

export interface StandRef {
  pt: Pt;
  ref?: string;
  hdg?: number;
}

export interface Leg {
  flight: string; // ICAO callsign
  flightIata?: string;
  codeshares: string[];
  from: SimAirport;
  to: SimAirport; // where it actually lands
  divertedFrom?: SimAirport; // original destination when diverted
  std: number; // scheduled off-block (sim ms)
  sta: number; // scheduled on-block
  tOff: number; // actual off-block
  tTakeoff: number;
  tLand: number;
  tOn: number;
  holdMs: number;
  cruiseFt: number;
  segs: Seg[];
  stand: StandRef;
  standTo: StandRef;
}

export interface Airframe {
  n: number;
  hex: string;
  reg: string;
  type: TypeInfo;
  airline?: AirlineProfile;
  ga?: { squawk: string };
  squawk: string;
  leg: Leg;
  prev?: Leg;
  turnMs: number;
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

/** Racetrack holding pattern (right turns, 1-minute legs) starting and ending at `fix`. */
function holdingLaps(fix: Pt, inboundCrs: number, kt: number, laps: number): Pt[] {
  const L = kt / 60; // NM in one minute
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

// ---------------------------------------------------------------- world

export class DemoWorld {
  readonly rng: Rng;
  airports = new Map<string, SimAirport>();
  private scheduledPool!: WeightedPool;
  private byCountry = new Map<string, WeightedPool>();
  private gaPools = new Map<string, WeightedPool>();
  airframes: Airframe[] = [];
  private usedHex = new Set<number>();
  private counter = 0;
  private slots = new Map<string, number[]>();
  private standBusy = new Map<string, number>();
  private ground = new Map<string, TaxiGraph>();
  private alternates = new Map<string, SimAirport | null>();
  readonly windSeed: number;

  constructor(seed: number, airports: AirportIndexEntry[], runways: Record<string, RunwayRow[]>) {
    this.rng = new Rng(seed);
    this.windSeed = seed % 360;
    for (const a of airports) {
      if (a.type !== 'large_airport' && a.type !== 'medium_airport') continue;
      const rows = runways[a.ident] ?? [];
      const ends: SimRunway[] = [];
      for (const r of rows) {
        const len = Math.max(0.6, (r[8] || 8000) / 6076);
        if (r[0]) ends.push({ ident: r[0], lat: r[1], lon: r[2], hdg: r[3], lengthNm: len });
        if (r[4]) ends.push({ ident: r[4], lat: r[5], lon: r[6], hdg: r[7], lengthNm: len });
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
        inUse,
        inUseBasis: 'simulated',
      };
      if (a.iata) sa.iata = a.iata;
      if (a.city) sa.city = a.city;
      this.airports.set(a.ident, sa);
    }
    const scheduled = [...this.airports.values()].filter((a) => a.scheduled || a.large);
    const weight = (a: SimAirport) => (a.large ? 10 : 1.5);
    this.scheduledPool = new WeightedPool(scheduled, weight);
    const byC = new Map<string, SimAirport[]>();
    for (const a of scheduled) byC.set(a.country, [...(byC.get(a.country) ?? []), a]);
    for (const [c, list] of byC) this.byCountry.set(c, new WeightedPool(list, weight));
    const ga = new Map<string, SimAirport[]>();
    for (const a of this.airports.values()) if (!a.large) ga.set(a.country, [...(ga.get(a.country) ?? []), a]);
    for (const [c, list] of ga) this.gaPools.set(c, new WeightedPool(list, () => 1));
  }

  // -------------------------------------------------------------- external data

  /** OpenStreetMap stands for airports (call before populate). */
  setStands(stands: Record<string, [number, number, string, number | null][]>) {
    for (const [ident, rows] of Object.entries(stands)) {
      const a = this.airports.get(ident);
      if (!a || !rows.length) continue;
      a.stands = rows.map(([lat, lon, ref, hdg]) => {
        const s: Stand = { lat, lon };
        if (ref) s.ref = ref;
        if (hdg !== null) s.hdg = hdg;
        return s;
      });
    }
  }

  /** OpenStreetMap taxiway network for one airport; future taxi movements follow it. */
  setTaxiGraph(ident: string, g: TaxiGraph, now: number) {
    this.ground.set(ident, g);
    // Re-route taxi movements that have not started yet (timing is kept).
    for (const af of this.airframes) {
      for (const leg of [af.leg]) {
        if (leg.from.ident !== ident && leg.to.ident !== ident) continue;
        for (const s of leg.segs) {
          if (s.phase !== 'taxi' || s.t0 <= now || (s.a[0] === s.b[0] && s.a[1] === s.b[1])) continue;
          const pts = this.taxiRoute(ident, s.a, s.b);
          if (!pts) continue;
          s.kind = 'path';
          s.pts = pts;
          s.cum = cumulative(pts);
          const kt = s.cum[s.cum.length - 1]! / Math.max(1e-6, (s.t1 - s.t0) / H);
          s.spd0 = s.spd1 = Math.min(25, kt);
        }
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
      a.inUse = bestRunway(a.runways, w.windDir);
      a.inUseBasis = 'metar';
    }
  }

  // -------------------------------------------------------------- identity

  private hexFor(iso: string): string {
    const block = icaoBlock(iso) ?? icaoBlock('US')!;
    for (let i = 0; i < 50; i++) {
      const v = block[0] + Math.floor(this.rng.next() * (block[1] - block[0]));
      if (!this.usedHex.has(v)) {
        this.usedHex.add(v);
        return v.toString(16).padStart(6, '0');
      }
    }
    return (block[0] + ++this.counter).toString(16).padStart(6, '0');
  }

  private regFor(pattern: string): string {
    const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
    return pattern.replace(/[L#]/g, (c) => (c === 'L' ? L[Math.floor(this.rng.next() * L.length)]! : String(Math.floor(this.rng.next() * 10))));
  }

  private squawkFor(): string {
    for (;;) {
      const s = Array.from({ length: 4 }, () => this.rng.int(0, 7)).join('');
      if (!['7500', '7600', '7700', '7000', '1200', '0000'].includes(s)) return s;
    }
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
        const af: Airframe = {
          n: this.airframes.length + 1,
          hex: this.hexFor(al.country),
          reg: this.regFor(al.reg),
          type,
          airline: al,
          squawk: this.squawkFor(),
          turnMs: 0,
          leg: undefined as unknown as Leg,
        };
        af.turnMs = this.turnaround(af);
        const dest = this.chooseDestination(af, hub);
        // Half the fleet starts on an inbound leg so hubs see arrivals as well as departures.
        const [from, to] = this.rng.next() < 0.5 && dest !== hub ? [dest, hub] : [hub, dest];
        af.leg = this.buildLeg(af, from, to, this.startTime(af, from, to, now));
        this.airframes.push(af);
      }
    }
    // General aviation & helicopters: local hops between nearby airfields.
    const gaCount = Math.round(1600 * scale);
    for (let i = 0; i < gaCount; i++) {
      const c = this.rng.weighted(GA_COUNTRIES.map((g) => [g, g.share] as [(typeof GA_COUNTRIES)[number], number]));
      const pool = this.gaPools.get(c.iso) ?? this.byCountry.get(c.iso);
      const home = pool?.pick(this.rng);
      if (!home) continue;
      const type = TYPES[this.rng.weighted(GA_TYPES)]!;
      const af: Airframe = {
        n: this.airframes.length + 1,
        hex: this.hexFor(c.iso),
        reg: this.regFor(c.reg),
        type,
        ga: { squawk: c.squawk },
        squawk: c.squawk,
        turnMs: 0,
        leg: undefined as unknown as Leg,
      };
      af.turnMs = this.turnaround(af);
      const to = this.chooseDestination(af, home);
      af.leg = this.buildLeg(af, home, to, this.startTime(af, home, to, now));
      this.airframes.push(af);
    }
  }

  /** Start each airframe at a random point of its cycle so the world begins "mid-day". */
  private startTime(af: Airframe, from: SimAirport, to: SimAirport, now: number) {
    const dist = distanceNm(from.lat, from.lon, to.lat, to.lon);
    const dur = (dist / (af.type.kt * 0.88)) * H + 30 * MIN;
    const u = this.rng.range(-af.turnMs / (dur + af.turnMs), 1);
    return this.curfew(af, from, now - u * dur);
  }

  /**
   * Most scheduled flying stops overnight: departures between 00:00 and 05:00 local
   * (solar time) slip to the morning wave. Long-haul and cargo keep flying at night.
   */
  private curfew(af: Airframe, from: SimAirport, tOff: number): number {
    const night = af.type.cls === 'wide' || af.airline?.fleet.every(([t]) => TYPES[t]?.cls === 'wide') ? 0.3 : 0.9;
    const localH = (((tOff / H + from.lon / 15) % 24) + 24) % 24;
    if (localH >= 5 || this.rng.next() > night) return tOff;
    // Released into the morning bank, spread over about three hours.
    return tOff + (5 - localH) * H + this.rng.range(0, 1) ** 1.6 * 180 * MIN;
  }

  private turnaround(af: Airframe) {
    const c = af.type.cls;
    const min = c === 'wide' ? 100 : c === 'narrow' ? 45 : c === 'regional' || c === 'turboprop' ? 35 : c === 'bizjet' ? 120 : 60;
    return this.rng.range(min, min * 2) * MIN;
  }

  private chooseDestination(af: Airframe, from: SimAirport): SimAirport {
    const t = af.type;
    if (af.ga) {
      const pool = this.gaPools.get(from.country) ?? this.byCountry.get(from.country);
      for (let i = 0; i < 25; i++) {
        const a = pool?.pick(this.rng);
        if (!a || a === from) continue;
        const d = distanceNm(from.lat, from.lon, a.lat, a.lon);
        if (d >= 15 && d <= (t.cls === 'heli' ? 80 : t.cls === 'turboprop' ? 400 : 180)) return a;
      }
      return from; // local circuit
    }
    const al = af.airline!;
    const atHub = al.hubs.includes(from.ident);
    if (!atHub && this.rng.next() < 0.85) {
      const hub = this.airports.get(this.rng.pick(al.hubs));
      if (hub && hub !== from && distanceNm(from.lat, from.lon, hub.lat, hub.lon) <= t.range) return hub;
    }
    const min = t.cls === 'wide' ? 700 : t.cls === 'turboprop' ? 60 : 120;
    const max = t.range * 0.92;
    // Wide-bodies serve large airports only (no A380s into regional fields).
    const fits = (a: SimAirport) => t.cls !== 'wide' || a.large;
    const domestic = this.rng.next() < al.dom;
    const pool = domestic ? (this.byCountry.get(from.country) ?? this.scheduledPool) : this.scheduledPool;
    for (let i = 0; i < 60; i++) {
      const a = pool.pick(this.rng);
      if (!a || a === from || !fits(a)) continue;
      const d = distanceNm(from.lat, from.lon, a.lat, a.lon);
      if (d >= min && d <= max) return a;
    }
    for (let i = 0; i < 80; i++) {
      const a = this.scheduledPool.pick(this.rng);
      if (!a || a === from || !fits(a)) continue;
      const d = distanceNm(from.lat, from.lon, a.lat, a.lon);
      if (d >= 80 && d <= max) return a;
    }
    return this.airports.get(al.hubs[0]!) ?? from;
  }

  // -------------------------------------------------------------- stands & slots

  /** A free stand (OpenStreetMap) or a plausible apron position. */
  private takeStand(a: SimAirport, from: number, until: number, ga: boolean): StandRef {
    if (a.stands?.length && !ga) {
      for (let i = 0; i < 12; i++) {
        const k = Math.floor(this.rng.next() * a.stands.length);
        const key = `${a.ident}|${k}`;
        if ((this.standBusy.get(key) ?? 0) <= from) {
          this.standBusy.set(key, until);
          const s = a.stands[k]!;
          const r: StandRef = { pt: [s.lat, s.lon] };
          if (s.ref) r.ref = s.ref;
          if (s.hdg !== undefined) r.hdg = s.hdg;
          return r;
        }
      }
    }
    return { pt: destination(a.lat, a.lon, a.inUse.hdg + 90 + this.rng.range(-50, 50), this.rng.range(0.15, 0.55)) };
  }

  private holdStand(a: SimAirport, s: StandRef, until: number) {
    if (!a.stands) return;
    const k = a.stands.findIndex((x) => x.lat === s.pt[0] && x.lon === s.pt[1]);
    if (k >= 0) this.standBusy.set(`${a.ident}|${k}`, Math.max(until, this.standBusy.get(`${a.ident}|${k}`) ?? 0));
  }

  /**
   * Runway capacity (movements/hour). Simulated hubs carry roughly real-world peak
   * traffic, so real-world capacities apply; weather reduces them.
   */
  private capacity(a: SimAirport, kind: 'arr' | 'dep') {
    const runways = Math.max(1, Math.round(a.runways.length / 2));
    let cap = a.large ? (runways >= 3 ? 60 : runways === 2 ? 44 : 32) : 22;
    const w = a.weather;
    if (w?.category === 'IFR') cap *= 0.85;
    else if (w?.category === 'LIFR') cap *= 0.62;
    if ((w?.gustKt ?? 0) >= 30) cap *= 0.8;
    if (kind === 'dep') cap *= 1.15;
    return Math.max(4, cap);
  }

  /** Earliest free slot at or after `t`, without reserving it. */
  private peekSlot(a: SimAirport, kind: 'arr' | 'dep', t: number): number {
    const sep = H / this.capacity(a, kind);
    let cand = t;
    for (const s of this.slots.get(`${a.ident}:${kind}`) ?? []) {
      if (s + sep <= cand) continue;
      if (s - sep >= cand) break;
      cand = s + sep;
    }
    return cand;
  }

  /** Earliest slot at or after `t` with the required separation; reserves it. */
  private reserveSlot(a: SimAirport, kind: 'arr' | 'dep', t: number): number {
    const key = `${a.ident}:${kind}`;
    const sep = H / this.capacity(a, kind);
    let list = this.slots.get(key);
    if (!list) this.slots.set(key, (list = []));
    if (list.length > 200) list.splice(0, list.length - 160);
    let cand = t;
    for (const s of list) {
      if (s + sep <= cand) continue;
      if (s - sep >= cand) break;
      cand = s + sep;
    }
    let i = list.length;
    while (i > 0 && list[i - 1]! > cand) i--;
    list.splice(i, 0, cand);
    return cand;
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

  // -------------------------------------------------------------- taxi routing

  private taxiRoute(ident: string, from: Pt, to: Pt): Pt[] | null {
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
    const path: Pt[] = [];
    for (let v = e; v !== -1; v = prev[v]!) path.push(g.nodes[v]!);
    path.reverse();
    return [from, ...path, to];
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
    const localH = (((tOff / H + from.lon / 15) % 24) + 24) % 24;
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

  // -------------------------------------------------------------- path

  buildLeg(af: Airframe, from: SimAirport, to: SimAirport, tOff: number, stand?: StandRef): Leg {
    const t = af.type;
    const segs: Seg[] = [];
    let time = tOff;
    const push = (s: Omit<Seg, 't0' | 't1'>, dur: number) => {
      segs.push({ ...s, t0: time, t1: time + Math.max(1, dur) });
      time += Math.max(1, dur);
    };
    const pathSeg = (phase: Phase, pts: Pt[], alt0: number, alt1: number, spd0: number, spd1: number, dur?: number) => {
      const cum = cumulative(pts);
      const len = cum[cum.length - 1]!;
      push({ phase, kind: 'path', a: pts[0]!, b: pts[pts.length - 1]!, pts, cum, alt0, alt1, spd0, spd1 }, dur ?? segDuration(len, (spd0 + spd1) / 2));
    };
    const ground = NaN;
    const heli = t.cls === 'heli';
    const light = t.cls === 'light' || heli;
    const airline = !!af.airline;
    const start = stand ?? this.takeStand(from, tOff - 60 * MIN, tOff, !airline);
    if (stand) this.holdStand(from, stand, tOff);
    const tas = t.kt * this.rng.range(0.96, 1.04);
    let holdMs = 0;
    let divertedFrom: SimAirport | undefined;
    let dest = to;
    let standTo: StandRef;

    const taxi = (ident: string, a: Pt, b: Pt) => {
      const route = this.taxiRoute(ident, a, b);
      if (route) pathSeg('taxi', route, ground, ground, 16, 16);
      else push({ phase: 'taxi', kind: 'line', a, b, alt0: ground, alt1: ground, spd0: 16, spd1: 16 }, segDuration(Math.max(0.3, distanceNm(a[0], a[1], b[0], b[1])), 16));
    };

    if (heli) {
      standTo = { pt: destination(to.lat, to.lon, this.rng.range(0, 360), this.rng.range(0.1, 0.4)) };
      const climbTo = from.elev + t.ft;
      const enrouteNm = Math.max(2, distanceNm(start.pt[0], start.pt[1], standTo.pt[0], standTo.pt[1]));
      push({ phase: 'parked', kind: 'line', a: start.pt, b: start.pt, alt0: ground, alt1: ground, spd0: 0, spd1: 0 }, MIN);
      push({ phase: 'climb', kind: 'line', a: start.pt, b: start.pt, alt0: from.elev + 50, alt1: climbTo, spd0: 0, spd1: 30 }, 90_000);
      push({ phase: 'cruise', kind: 'line', a: start.pt, b: standTo.pt, alt0: climbTo, alt1: to.elev + t.ft, spd0: tas, spd1: tas }, segDuration(enrouteNm, tas));
      push({ phase: 'descent', kind: 'line', a: standTo.pt, b: standTo.pt, alt0: to.elev + t.ft, alt1: to.elev + 50, spd0: 30, spd1: 0 }, 120_000);
    } else {
      // ---- departure: push-back, taxi to the runway in use, queue, take off.
      const dep = from.inUse;
      const thr: Pt = [dep.lat, dep.lon];
      // Ground-delay programme: if the destination will be saturated, wait at the stand
      // rather than in the air (only a few minutes of airborne holding are planned).
      let groundDelay = 0;
      if (airline && !light && to.scheduled) {
        const est = tOff + 20 * MIN + segDuration(distanceNm(from.lat, from.lon, to.lat, to.lon), tas * 0.9) + 12 * MIN;
        const wait = this.peekSlot(to, 'arr', est) - est;
        if (wait > 8 * MIN) groundDelay = wait - 4 * MIN;
      }
      push({ phase: 'parked', kind: 'line', a: start.pt, b: start.pt, alt0: ground, alt1: ground, spd0: 0, spd1: 0 }, MIN + groundDelay);
      taxi(from.ident, start.pt, thr);
      const ready = time + 30_000;
      const slot = airline ? this.reserveSlot(from, 'dep', ready) : ready;
      push({ phase: 'taxi', kind: 'line', a: thr, b: thr, alt0: ground, alt1: ground, spd0: 0, spd1: 0 }, Math.max(20_000, slot - time));
      const rollNm = light ? 0.25 : Math.min(dep.lengthNm * 0.6, 1.3);
      const lift = destination(thr[0], thr[1], dep.hdg, rollNm);
      const vr = light ? 65 : t.cls === 'wide' ? 160 : 145;
      push({ phase: 'takeoff', kind: 'line', a: thr, b: lift, alt0: ground, alt1: ground, spd0: 0, spd1: vr, ease: 'accel' }, segDuration(rollNm, vr / 2));
      const climbOutNm = light ? 2 : 6;
      const dFix = destination(thr[0], thr[1], dep.hdg, rollNm + climbOutNm);
      const climbOutAlt = from.elev + (light ? 1200 : 3000);
      push({ phase: 'climb', kind: 'line', a: lift, b: dFix, alt0: from.elev + 35, alt1: climbOutAlt, spd0: vr + 10, spd1: light ? 90 : 220 }, segDuration(climbOutNm, light ? 85 : 185));

      // ---- weather at the destination may force a diversion.
      const w = to.weather;
      const divert = airline && !light && ((w?.category === 'LIFR' && this.rng.next() < 0.12) || ((w?.gustKt ?? 0) >= 45 && this.rng.next() < 0.25));
      const alt = divert ? this.alternateFor(to) : undefined;

      // ---- en route to the arrival entry point of the (first) destination.
      const entryOf = (ap: SimAirport, refLat: number, refLon: number): { entry: Pt; entryAlt: number } => {
        const inbound = bearingDeg(ap.lat, ap.lon, refLat, refLon);
        return { entry: destination(ap.lat, ap.lon, inbound, light ? 8 : 30), entryAlt: ap.elev + (light ? 2000 : 8000) };
      };
      const first = entryOf(to, from.lat, from.lon);
      const gcNm = distanceNm(dFix[0], dFix[1], first.entry[0], first.entry[1]);
      const short = gcNm < (light ? 10 : 45);
      let cruiseFt = t.ft;
      const climbNmPerFt = (tas * 0.75) / 60 / (light ? 600 : 2200);
      const descNmPerFt = 1 / 318;
      const budget = Math.max(gcNm, 1) * 0.9;
      const need = (cruiseFt - climbOutAlt) * climbNmPerFt + (cruiseFt - first.entryAlt) * descNmPerFt;
      if (need > budget) cruiseFt = Math.max(climbOutAlt + 1000, climbOutAlt + (budget * (cruiseFt - climbOutAlt)) / Math.max(need, 1));
      cruiseFt = light ? Math.round(cruiseFt / 500) * 500 : Math.max(climbOutAlt + 1000, Math.round(cruiseFt / 1000) * 1000);
      let entry = first.entry;
      let entryAlt = first.entryAlt;
      if (short) {
        entry = dFix;
        entryAlt = Math.max(climbOutAlt, first.entryAlt * 0.7);
      } else {
        const climbNm = Math.max(1, (cruiseFt - climbOutAlt) * climbNmPerFt);
        const descNm = Math.max(1, (cruiseFt - entryAlt) * descNmPerFt);
        const cruiseNm = Math.max(0, gcNm - climbNm - descNm);
        const f1 = Math.min(1, climbNm / Math.max(gcNm, 0.001));
        const f2 = Math.min(1, (climbNm + cruiseNm) / Math.max(gcNm, 0.001));
        const gcPoint = (f: number) => intermediatePoint(dFix[0], dFix[1], entry[0], entry[1], f);
        const p1 = gcPoint(f1);
        const p2 = gcPoint(f2);
        const windSeg = (a: Pt, b: Pt) => {
          const mid = intermediatePoint(a[0], a[1], b[0], b[1], 0.5);
          const w = windAloft(mid[0], mid[1], time, this.windSeed);
          const kt = Math.max(5, w.kt + this.rng.range(-12, 12));
          const comp = tailwind({ dir: w.dir, kt }, bearingDeg(a[0], a[1], b[0], b[1]));
          return { dir: w.dir, kt: Math.round(kt), comp };
        };
        const climbW = windSeg(dFix, p1);
        const climbGs = (light ? 90 : 300) * 0.5 + tas * 0.5 + climbW.comp * 0.5;
        push({ phase: 'climb', kind: 'gc', a: dFix, b: p1, alt0: climbOutAlt, alt1: cruiseFt, spd0: light ? 90 : 240, spd1: tas + climbW.comp, wind: climbW }, segDuration(gcNm * f1, Math.max(80, climbGs)));
        if (cruiseNm > 0) {
          // Two cruise halves with their own winds aloft, so the estimate changes en route.
          const mid = gcPoint((f1 + f2) / 2);
          for (const [a, b] of [
            [p1, mid],
            [mid, p2],
          ] as [Pt, Pt][]) {
            const w = windSeg(a, b);
            const gs = Math.max(tas * 0.6, tas + w.comp);
            push({ phase: 'cruise', kind: 'gc', a, b, alt0: cruiseFt, alt1: cruiseFt, spd0: gs, spd1: gs, wind: w }, segDuration(distanceNm(a[0], a[1], b[0], b[1]), gs));
          }
        }
        const descW = windSeg(p2, entry);
        push(
          { phase: 'descent', kind: 'gc', a: p2, b: entry, alt0: cruiseFt, alt1: entryAlt, spd0: tas + descW.comp, spd1: light ? 90 : 250, wind: descW },
          segDuration(gcNm * (1 - f2), Math.max(90, light ? 100 : tas * 0.5 + 125 + descW.comp * 0.5)),
        );
      }

      // ---- diversion: hold at the original destination, then fly to the alternate.
      if (divert && alt) {
        const crs = bearingDeg(entry[0], entry[1], to.lat, to.lon);
        const laps = 2;
        const hold = holdingLaps(entry, crs, 230, laps);
        pathSeg('holding', hold, entryAlt, entryAlt, 230, 230);
        holdMs += time - segs[segs.length - 1]!.t0;
        divertedFrom = to;
        dest = alt;
        const next = entryOf(alt, to.lat, to.lon);
        const nm = distanceNm(entry[0], entry[1], next.entry[0], next.entry[1]);
        push({ phase: 'cruise', kind: 'gc', a: entry, b: next.entry, alt0: entryAlt + 2000, alt1: next.entryAlt, spd0: 300, spd1: 270 }, segDuration(nm, 285));
        entry = next.entry;
        entryAlt = next.entryAlt;
      }

      // ---- arrival: vectors (downwind / base) onto a 12 NM final, sequenced by slot.
      const arr = dest.inUse;
      const athr: Pt = [arr.lat, arr.lon];
      const finalNm = light ? 4 : 12;
      const back = arr.hdg + 180;
      const P = (along: number, cross: number) => fromLocal(athr, back, along, cross);
      const faf = P(finalNm, 0);
      const fafAlt = dest.elev + finalNm * 318;
      const rel = angle(back, bearingDeg(athr[0], athr[1], entry[0], entry[1]));
      const side = rel >= 0 ? 1 : -1;
      const off = light ? 2 : 7;
      const turnOn = finalNm + (light ? 2 : 4);
      const pattern: Pt[] = [entry];
      if (Math.abs(rel) < 35) pattern.push(P(turnOn + (light ? 2 : 8), 0));
      else if (Math.abs(rel) < 115) pattern.push(P(turnOn + (light ? 2 : 6), off * side)); // base leg
      else pattern.push(P(light ? -1 : -4, off * side), P(turnOn + (light ? 2 : 6), off * side));
      pattern.push(P(turnOn, 0), faf);
      const vectors = smooth(pattern, 3);
      const vecLen = cumulative(vectors).at(-1)!;
      const vecDur = segDuration(vecLen, light ? 85 : 215);
      if (airline && !light && dest.scheduled) {
        const want = time + vecDur;
        const slot = this.reserveSlot(dest, 'arr', want);
        const delay = slot - want;
        if (delay > 3 * MIN) {
          // Hold at the entry fix until the slot comes up (laps of ≈4 minutes).
          const laps = Math.max(1, Math.round(delay / (4 * MIN)));
          pathSeg('holding', holdingLaps(entry, bearingDeg(entry[0], entry[1], dest.lat, dest.lon), 230, laps), entryAlt, entryAlt, 230, 230, delay);
          holdMs += delay;
          pathSeg('approach', vectors, entryAlt, fafAlt, light ? 90 : 230, light ? 80 : 180, vecDur);
        } else pathSeg('approach', vectors, entryAlt, fafAlt, light ? 90 : 230, light ? 80 : 180, vecDur + Math.max(0, delay));
      } else pathSeg('approach', vectors, entryAlt, fafAlt, light ? 90 : 230, light ? 80 : 180, vecDur);

      const vapp = light ? 70 : t.cls === 'wide' ? 150 : 140;
      push({ phase: 'approach', kind: 'line', a: faf, b: athr, alt0: fafAlt, alt1: dest.elev + 50, spd0: vapp + 15, spd1: vapp }, segDuration(finalNm, vapp + 7));
      const rollOutNm = light ? 0.2 : Math.min(arr.lengthNm * 0.5, 1);
      const stop = destination(athr[0], athr[1], arr.hdg, rollOutNm);
      push({ phase: 'landing', kind: 'line', a: athr, b: stop, alt0: ground, alt1: ground, spd0: vapp, spd1: 20, ease: 'decel' }, segDuration(rollOutNm, (vapp + 20) / 2));
      const tOnGuess = time + 6 * MIN;
      standTo = this.takeStand(dest, tOnGuess - 5 * MIN, tOnGuess + af.turnMs + 30 * MIN, !airline);
      taxi(dest.ident, stop, standTo.pt);
    }
    const tTakeoff = segs.find((s) => s.phase === 'climb')?.t0 ?? tOff;
    const lastAir = [...segs].reverse().find((s) => !Number.isNaN(s.alt1));
    const tLand = heli ? time : (segs.find((s) => s.phase === 'landing')?.t0 ?? lastAir?.t1 ?? time);
    const block = time - tOff - holdMs;
    const delay = this.rng.next() < 0.7 ? this.rng.range(-4, 12) : this.rng.range(12, 55);
    const std = round5(tOff - delay * MIN);
    const sta = round5(std + block + this.rng.range(5, 20) * MIN);
    let flight = af.reg.replace(/-/g, '');
    let flightIata: string | undefined;
    let codeshares: string[] = [];
    if (af.airline) {
      const fn = this.flightNumber(af, from, to, std);
      flight = fn.icao;
      flightIata = fn.iata;
      codeshares = this.codeshares(af, from, to, fn.num);
    }
    const leg: Leg = {
      flight,
      codeshares,
      from,
      to: dest,
      std,
      sta,
      tOff,
      tTakeoff,
      tLand,
      tOn: time,
      holdMs,
      cruiseFt: segs.reduce((m, s) => Math.max(m, Number.isNaN(s.alt1) ? 0 : s.alt1), 0),
      segs,
      stand: start,
      standTo,
    };
    if (flightIata) leg.flightIata = flightIata;
    if (divertedFrom) leg.divertedFrom = divertedFrom;
    return leg;
  }

  /** Advance every airframe so that its current leg covers `now`. */
  advance(now: number) {
    for (const af of this.airframes) {
      let guard = 0;
      while (now >= af.leg.tOn + af.turnMs && guard++ < 20) {
        const prev = af.leg;
        const tOff = this.curfew(af, prev.to, prev.tOn + af.turnMs);
        af.prev = prev;
        // A diverted aircraft returns to where it was meant to go.
        const next = prev.divertedFrom ?? this.chooseDestination(af, prev.to);
        af.leg = this.buildLeg(af, prev.to, next === prev.to ? this.chooseDestination(af, prev.to) : next, tOff, prev.standTo);
        af.squawk = af.ga ? af.ga.squawk : this.squawkFor();
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

  /** Position/state of an airframe at sim time `now`. */
  state(af: Airframe, now: number): SimState {
    const leg = af.leg;
    if (now < leg.tOff) {
      // Parked at the stand before departure; transponder on ~40 min before off-block.
      const recent = !!af.prev && now - af.prev.tOn < 15 * MIN;
      const s = recent ? af.prev!.standTo : leg.stand;
      return { lat: s.pt[0], lon: s.pt[1], gs: 0, trk: s.hdg ?? (leg.from.inUse.hdg + 90) % 360, vr: 0, onGround: true, phase: 'parked', emit: leg.tOff - now < 40 * MIN || recent };
    }
    if (now >= leg.tOn) {
      const s = leg.standTo;
      return { lat: s.pt[0], lon: s.pt[1], gs: 0, trk: s.hdg ?? (leg.to.inUse.hdg + 90) % 360, vr: 0, onGround: true, phase: 'parked', emit: now - leg.tOn < 15 * MIN };
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
    const onGround = Number.isNaN(s.alt0);
    let gs = s.spd0 + (s.spd1 - s.spd0) * f;
    if (s.kind === 'path' && s.phase === 'holding') gs = (s.cum!.at(-1)! / Math.max(1e-6, (s.t1 - s.t0) / H)) * (0.97 + 0.03 * Math.sin(f * 40));
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
    const tasNow = cur.spd0 - cur.wind.comp;
    const gsNow = Math.max(tasNow * 0.6, tasNow + cur.wind.comp);
    let t = now;
    for (let k = i; k < leg.segs.length; k++) {
      const s = leg.segs[k]!;
      const startF = k === i ? (now - s.t0) / (s.t1 - s.t0) : 0;
      if (s.phase === 'cruise' && k > i) {
        // Later cruise: blend the wind being flown now with the forecast for that part.
        const nm = distanceNm(s.a[0], s.a[1], s.b[0], s.b[1]);
        t += segDuration(nm, (gsNow + s.spd0) / 2);
      } else t += (s.t1 - s.t0) * (1 - startF);
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
