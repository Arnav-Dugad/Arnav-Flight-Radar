// Demo-world flight simulator. Generates an entire planet of simulated traffic:
// airframes cycle through gate → taxi → takeoff → climb → cruise → descent →
// final approach → landing → taxi → turnaround, on great-circle routes between
// real airports, using the runway each airport has "in use".
//
// EVERYTHING produced here is simulated and is only ever shown in demo mode.

import { bearingDeg, destination, distanceNm, intermediatePoint } from '@shared/geo';
import { icaoBlock } from '@shared/icaoCountry';
import type { AirportIndexEntry } from '@shared/types';
import { AIRLINES, GA_COUNTRIES, GA_TYPES, TYPES, type AirlineProfile, type TypeInfo } from './fleet';

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

// ---------------------------------------------------------------- airports

export interface SimRunway {
  ident: string;
  lat: number;
  lon: number;
  hdg: number;
  lengthNm: number;
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
  inUse: SimRunway; // runway direction in use this session (into the simulated wind)
}

type RunwayRow = [string, number, number, number, string, number, number, number, number];

class WeightedPool {
  private cum: number[] = [];
  private total = 0;
  constructor(readonly items: SimAirport[], weight: (a: SimAirport) => number) {
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

type Phase = 'parked' | 'taxi' | 'takeoff' | 'climb' | 'cruise' | 'descent' | 'approach' | 'landing';

interface Seg {
  t0: number;
  t1: number;
  phase: Phase;
  a: [number, number];
  b: [number, number];
  gc: boolean; // great-circle interpolation (long legs)
  alt0: number; // ft MSL (NaN = on ground)
  alt1: number;
  spd0: number;
  spd1: number;
  ease?: 'accel' | 'decel';
}

export interface Leg {
  flight: string; // ICAO callsign
  flightIata?: string;
  from: SimAirport;
  to: SimAirport;
  std: number; // scheduled off-block (sim ms)
  sta: number; // scheduled on-block
  tOff: number; // actual off-block
  tTakeoff: number;
  tLand: number;
  tOn: number;
  cruiseFt: number;
  segs: Seg[];
  stand: [number, number];
  standTo: [number, number];
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
  flightNo: number;
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
}

const KT_PER_NM_MS = 3_600_000; // ms per NM at 1 kt

function segDuration(distNm: number, avgKt: number) {
  return (distNm / Math.max(1, avgKt)) * KT_PER_NM_MS;
}

const round5 = (ms: number) => Math.round(ms / 300_000) * 300_000;

export class DemoWorld {
  readonly rng: Rng;
  airports = new Map<string, SimAirport>();
  private scheduledPool!: WeightedPool;
  private byCountry = new Map<string, WeightedPool>();
  private gaPools = new Map<string, WeightedPool>();
  airframes: Airframe[] = [];
  private usedHex = new Set<number>();
  private counter = 0;

  constructor(seed: number, airports: AirportIndexEntry[], runways: Record<string, RunwayRow[]>) {
    this.rng = new Rng(seed);
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
      if (ends.length) {
        inUse = ends.reduce((best, e) => (Math.abs(angle(e.hdg, wind)) < Math.abs(angle(best.hdg, wind)) ? e : best), ends[0]!);
      } else {
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
          flightNo: this.rng.int(1, 9999),
          leg: undefined as unknown as Leg,
        };
        const dest = this.chooseDestination(af, hub);
        // Half the fleet starts on an inbound leg so hubs see arrivals as well as departures.
        af.leg = this.rng.next() < 0.5 && dest !== hub ? this.buildLeg(af, dest, hub, 0, undefined) : this.buildLeg(af, hub, dest, 0, undefined);
        this.placeInCycle(af, now);
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
      const reg = this.regFor(c.reg);
      const af: Airframe = {
        n: this.airframes.length + 1,
        hex: this.hexFor(c.iso),
        reg,
        type,
        ga: { squawk: c.squawk },
        squawk: c.squawk,
        flightNo: 0,
        leg: undefined as unknown as Leg,
      };
      af.leg = this.buildLeg(af, home, this.chooseDestination(af, home), 0, undefined);
      this.placeInCycle(af, now);
      this.airframes.push(af);
    }
  }

  /** Start each airframe at a random point of its cycle so the world begins "mid-day". */
  private placeInCycle(af: Airframe, now: number) {
    const dur = af.leg.tOn - af.leg.tOff;
    const turn = this.turnaround(af);
    const u = this.rng.range(-turn / (dur + turn), 1);
    const tOff = this.curfew(af, af.leg.from, now - u * dur);
    af.leg = this.buildLeg(af, af.leg.from, af.leg.to, tOff, undefined);
  }

  /**
   * Most scheduled flying stops overnight: departures between 00:00 and 05:00 local
   * (solar time) slip to the morning wave. Long-haul and cargo keep flying at night.
   */
  private curfew(af: Airframe, from: SimAirport, tOff: number): number {
    const night = af.type.cls === 'wide' || af.airline?.fleet.every(([t]) => TYPES[t]?.cls === 'wide') ? 0.3 : 0.9;
    const localH = (((tOff / 3_600_000 + from.lon / 15) % 24) + 24) % 24;
    if (localH >= 5 || this.rng.next() > night) return tOff;
    return tOff + (5 - localH) * 3_600_000 + this.rng.range(0, 100) * 60_000;
  }

  private turnaround(af: Airframe) {
    const c = af.type.cls;
    const min = c === 'wide' ? 100 : c === 'narrow' ? 45 : c === 'regional' || c === 'turboprop' ? 35 : c === 'bizjet' ? 120 : 60;
    return this.rng.range(min, min * 2) * 60_000;
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
    const domestic = this.rng.next() < al.dom;
    const pool = domestic ? (this.byCountry.get(from.country) ?? this.scheduledPool) : this.scheduledPool;
    for (let i = 0; i < 60; i++) {
      const a = pool.pick(this.rng);
      if (!a || a === from) continue;
      const d = distanceNm(from.lat, from.lon, a.lat, a.lon);
      if (d >= min && d <= max) return a;
    }
    for (let i = 0; i < 80; i++) {
      const a = this.scheduledPool.pick(this.rng);
      if (!a || a === from) continue;
      const d = distanceNm(from.lat, from.lon, a.lat, a.lon);
      if (d >= 80 && d <= max) return a;
    }
    return this.airports.get(al.hubs[0]!) ?? from;
  }

  private standNear(a: SimAirport): [number, number] {
    return destination(a.lat, a.lon, a.inUse.hdg + 90 + this.rng.range(-50, 50), this.rng.range(0.15, 0.55));
  }

  // -------------------------------------------------------------- path

  buildLeg(af: Airframe, from: SimAirport, to: SimAirport, tOff: number, stand?: [number, number]): Leg {
    const t = af.type;
    const segs: Seg[] = [];
    let time = tOff;
    const push = (s: Omit<Seg, 't0' | 't1'>, dur: number) => {
      segs.push({ ...s, t0: time, t1: time + dur });
      time += dur;
    };
    const ground = NaN;
    const heli = t.cls === 'heli';
    const light = t.cls === 'light' || heli;
    const start = stand ?? this.standNear(from);
    const standTo = this.standNear(to);
    const dep = from.inUse;
    const arr = to.inUse;
    const cruiseKt = t.kt * this.rng.range(0.96, 1.04);

    if (heli) {
      const climbTo = from.elev + t.ft;
      const enrouteNm = Math.max(2, distanceNm(start[0], start[1], standTo[0], standTo[1]));
      push({ phase: 'parked', a: start, b: start, gc: false, alt0: ground, alt1: ground, spd0: 0, spd1: 0 }, 60_000);
      push({ phase: 'climb', a: start, b: start, gc: false, alt0: from.elev + 50, alt1: climbTo, spd0: 0, spd1: 30 }, 90_000);
      push({ phase: 'cruise', a: start, b: standTo, gc: false, alt0: climbTo, alt1: to.elev + t.ft, spd0: cruiseKt, spd1: cruiseKt }, segDuration(enrouteNm, cruiseKt));
      push({ phase: 'descent', a: standTo, b: standTo, gc: false, alt0: to.elev + t.ft, alt1: to.elev + 50, spd0: 30, spd1: 0 }, 120_000);
    } else {
      // Taxi out to the runway in use, hold, take off.
      const thr: [number, number] = [dep.lat, dep.lon];
      const taxiNm = Math.max(0.3, distanceNm(start[0], start[1], thr[0], thr[1]));
      push({ phase: 'parked', a: start, b: start, gc: false, alt0: ground, alt1: ground, spd0: 0, spd1: 0 }, 60_000);
      push({ phase: 'taxi', a: start, b: thr, gc: false, alt0: ground, alt1: ground, spd0: 16, spd1: 16 }, segDuration(taxiNm, 16));
      push({ phase: 'taxi', a: thr, b: thr, gc: false, alt0: ground, alt1: ground, spd0: 0, spd1: 0 }, this.rng.range(40, 240) * 1000);
      const rollNm = light ? 0.25 : Math.min(dep.lengthNm * 0.6, 1.3);
      const lift = destination(thr[0], thr[1], dep.hdg, rollNm);
      const vr = light ? 65 : t.cls === 'wide' ? 160 : 145;
      push({ phase: 'takeoff', a: thr, b: lift, gc: false, alt0: ground, alt1: ground, spd0: 0, spd1: vr, ease: 'accel' }, segDuration(rollNm, vr / 2));
      const climbOutNm = light ? 2 : 6;
      const dFix = destination(thr[0], thr[1], dep.hdg, rollNm + climbOutNm);
      const climbOutAlt = from.elev + (light ? 1200 : 3000);
      push({ phase: 'climb', a: lift, b: dFix, gc: false, alt0: from.elev + 35, alt1: climbOutAlt, spd0: vr + 10, spd1: light ? 90 : 220 }, segDuration(climbOutNm, light ? 85 : 185));

      // Arrival geometry: final approach fix 12 NM out (4 NM for light aircraft).
      const finalNm = light ? 4 : 12;
      const athr: [number, number] = [arr.lat, arr.lon];
      const faf = destination(athr[0], athr[1], arr.hdg + 180, finalNm);
      const fafAlt = to.elev + finalNm * 318;
      const inbound = bearingDeg(to.lat, to.lon, from.lat, from.lon);
      const entryNm = light ? 8 : 30;
      let entry = destination(to.lat, to.lon, inbound, entryNm);
      const gcNm = distanceNm(dFix[0], dFix[1], entry[0], entry[1]);
      const short = gcNm < (light ? 10 : 60);
      if (short) entry = faf;

      // En route: climb / cruise / descent along the great circle.
      const entryAlt = short ? fafAlt : to.elev + (light ? 2000 : 8000);
      let cruiseFt = t.ft;
      const climbNmPerFt = (cruiseKt * 0.75) / 60 / (light ? 600 : 2200);
      const descNmPerFt = 1 / 318;
      const budget = Math.max(gcNm, 1) * 0.9;
      const need = (cruiseFt - climbOutAlt) * climbNmPerFt + (cruiseFt - entryAlt) * descNmPerFt;
      if (need > budget) cruiseFt = Math.max(climbOutAlt + 1000, climbOutAlt + (budget * (cruiseFt - climbOutAlt)) / Math.max(need, 1));
      cruiseFt = light ? Math.round(cruiseFt / 500) * 500 : Math.max(climbOutAlt + 1000, Math.round(cruiseFt / 1000) * 1000);
      const climbNm = Math.max(1, (cruiseFt - climbOutAlt) * climbNmPerFt);
      const descNm = Math.max(1, (cruiseFt - entryAlt) * descNmPerFt);
      const cruiseNm = Math.max(0, gcNm - climbNm - descNm);
      const f1 = Math.min(1, climbNm / Math.max(gcNm, 0.001));
      const f2 = Math.min(1, (climbNm + cruiseNm) / Math.max(gcNm, 0.001));
      const gcPoint = (f: number) => intermediatePoint(dFix[0], dFix[1], entry[0], entry[1], f);
      const p1 = gcPoint(f1);
      const p2 = gcPoint(f2);
      const climbKt = (light ? 90 : 300) * 0.5 + cruiseKt * 0.5;
      push({ phase: 'climb', a: dFix, b: p1, gc: true, alt0: climbOutAlt, alt1: cruiseFt, spd0: light ? 90 : 240, spd1: cruiseKt }, segDuration(gcNm * f1, climbKt));
      if (cruiseNm > 0) push({ phase: 'cruise', a: p1, b: p2, gc: true, alt0: cruiseFt, alt1: cruiseFt, spd0: cruiseKt, spd1: cruiseKt }, segDuration(cruiseNm, cruiseKt));
      push({ phase: 'descent', a: p2, b: entry, gc: true, alt0: cruiseFt, alt1: entryAlt, spd0: cruiseKt, spd1: light ? 90 : 250 }, segDuration(gcNm * (1 - f2), light ? 100 : cruiseKt * 0.5 + 125));
      if (!short) {
        const appNm = distanceNm(entry[0], entry[1], faf[0], faf[1]);
        push({ phase: 'approach', a: entry, b: faf, gc: false, alt0: entryAlt, alt1: fafAlt, spd0: light ? 90 : 230, spd1: light ? 80 : 180 }, segDuration(appNm, light ? 85 : 205));
      }
      const vapp = light ? 70 : t.cls === 'wide' ? 150 : 140;
      push({ phase: 'approach', a: faf, b: athr, gc: false, alt0: fafAlt, alt1: to.elev + 50, spd0: vapp + 15, spd1: vapp }, segDuration(finalNm, vapp + 7));
      const rollOutNm = light ? 0.2 : Math.min(arr.lengthNm * 0.5, 1);
      const stop = destination(athr[0], athr[1], arr.hdg, rollOutNm);
      push({ phase: 'landing', a: athr, b: stop, gc: false, alt0: ground, alt1: ground, spd0: vapp, spd1: 20, ease: 'decel' }, segDuration(rollOutNm, (vapp + 20) / 2));
      const taxiInNm = Math.max(0.3, distanceNm(stop[0], stop[1], standTo[0], standTo[1]));
      push({ phase: 'taxi', a: stop, b: standTo, gc: false, alt0: ground, alt1: ground, spd0: 16, spd1: 16 }, segDuration(taxiInNm, 16));
    }
    const tTakeoff = segs.find((s) => s.phase === 'climb')?.t0 ?? tOff;
    const lastAir = [...segs].reverse().find((s) => !Number.isNaN(s.alt1));
    const tLand = heli ? time : (segs.find((s) => s.phase === 'landing')?.t0 ?? lastAir?.t1 ?? time);
    const block = time - tOff;
    const delay = this.rng.next() < 0.7 ? this.rng.range(-4, 12) : this.rng.range(12, 55);
    const std = round5(tOff - delay * 60_000);
    const sta = round5(std + block + this.rng.range(5, 20) * 60_000);
    let flight = af.reg.replace(/-/g, '');
    let flightIata: string | undefined;
    if (af.airline) {
      af.flightNo = (af.flightNo + this.rng.int(1, 37)) % (t.cls === 'wide' ? 999 : 9999) || 1;
      const num = af.flightNo;
      flight = af.airline.alnum && this.rng.next() < 0.6 ? `${af.airline.icao}${num % 900 + 1}${String.fromCharCode(65 + this.rng.int(0, 25))}${String.fromCharCode(65 + this.rng.int(0, 25))}`.slice(0, 7) : `${af.airline.icao}${num}`;
      flightIata = `${af.airline.iata}${num}`;
    }
    const leg: Leg = { flight, from, to, std, sta, tOff, tTakeoff, tLand, tOn: time, cruiseFt: segs.reduce((m, s) => Math.max(m, Number.isNaN(s.alt1) ? 0 : s.alt1), 0), segs, stand: start, standTo };
    if (flightIata) leg.flightIata = flightIata;
    return leg;
  }

  /** Advance every airframe so that its current leg covers `now`. */
  advance(now: number) {
    for (const af of this.airframes) {
      let guard = 0;
      while (now >= af.leg.tOn + this.turnaroundOf(af) && guard++ < 20) {
        const prev = af.leg;
        const tOff = this.curfew(af, prev.to, prev.tOn + this.turnaroundOf(af));
        af.prev = prev;
        const next = this.chooseDestination(af, prev.to);
        af.leg = this.buildLeg(af, prev.to, next, tOff, prev.standTo);
        af.squawk = af.ga ? af.ga.squawk : this.squawkFor();
      }
    }
  }

  private turnCache = new Map<number, number>();
  private turnaroundOf(af: Airframe) {
    let t = this.turnCache.get(af.n);
    if (t === undefined) {
      t = this.turnaround(af);
      this.turnCache.set(af.n, t);
    }
    return t;
  }

  /** Position/state of an airframe at sim time `now`. */
  state(af: Airframe, now: number): SimState {
    const leg = af.leg;
    if (now < leg.tOff) {
      // Parked at the gate before departure; transponder on ~40 min before off-block.
      const p = af.prev && now - af.prev.tOn < 15 * 60_000 ? af.prev.standTo : leg.stand;
      return { lat: p[0], lon: p[1], gs: 0, trk: (leg.from.inUse.hdg + 90) % 360, vr: 0, onGround: true, phase: 'parked', emit: leg.tOff - now < 40 * 60_000 || (!!af.prev && now - af.prev.tOn < 15 * 60_000) };
    }
    if (now >= leg.tOn) {
      return { lat: leg.standTo[0], lon: leg.standTo[1], gs: 0, trk: (leg.to.inUse.hdg + 90) % 360, vr: 0, onGround: true, phase: 'parked', emit: now - leg.tOn < 15 * 60_000 };
    }
    let lo = 0;
    let hi = leg.segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (leg.segs[mid]!.t1 <= now) lo = mid + 1;
      else hi = mid;
    }
    const s = leg.segs[lo]!;
    const f = s.t1 > s.t0 ? Math.min(1, Math.max(0, (now - s.t0) / (s.t1 - s.t0))) : 1;
    const g = s.ease === 'accel' ? f * f : s.ease === 'decel' ? 1 - (1 - f) * (1 - f) : f;
    const at = (x: number): [number, number] =>
      s.gc ? intermediatePoint(s.a[0], s.a[1], s.b[0], s.b[1], x) : [s.a[0] + (s.b[0] - s.a[0]) * x, s.a[1] + (s.b[1] - s.a[1]) * x];
    const [lat, lon] = at(g);
    const moving = s.a[0] !== s.b[0] || s.a[1] !== s.b[1];
    const [nl, no] = at(Math.min(1, g + 0.002));
    const trk = moving ? (nl === lat && no === lon ? bearingDeg(s.a[0], s.a[1], s.b[0], s.b[1]) : bearingDeg(lat, lon, nl, no)) : s.phase === 'taxi' ? leg.from.inUse.hdg : (leg.from.inUse.hdg + 90) % 360;
    const onGround = Number.isNaN(s.alt0);
    const gs = s.spd0 + (s.spd1 - s.spd0) * f;
    if (onGround) return { lat, lon, gs, trk, vr: 0, onGround, phase: s.phase, emit: true };
    const alt = s.alt0 + (s.alt1 - s.alt0) * f;
    const vr = ((s.alt1 - s.alt0) / Math.max(1, (s.t1 - s.t0) / 60_000)) | 0;
    return { lat, lon, alt, gs, trk, vr, onGround: false, phase: s.phase, emit: true };
  }

  /** Simulated past positions of the current leg (for the trail). */
  trail(af: Airframe, now: number, windowMs: number): { lat: number; lon: number; alt?: number; gs: number; vr: number; t: number }[] {
    const leg = af.leg;
    const start = Math.max(leg.tOff, now - windowMs);
    if (now <= start) return [];
    const step = Math.max(15_000, (now - start) / 160);
    const out = [];
    for (let t = start; t <= now; t += step) {
      const s = this.state(af, t);
      out.push({ lat: s.lat, lon: s.lon, alt: s.onGround ? 0 : s.alt, gs: s.gs, vr: s.vr, t });
    }
    return out;
  }
}

function angle(a: number, b: number) {
  return ((b - a + 540) % 360) - 180;
}
