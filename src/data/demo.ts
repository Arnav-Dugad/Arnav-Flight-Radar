// DEMO MODE — an explicitly simulated world.
//
// Exists so people can explore the interface when live data is unavailable.
// It simulates a whole planet of traffic — real airlines on real routes between
// real airports, with real aircraft types — including gate, taxi, take-off,
// approach and landing activity on each airport's runway in use.
//
// Rules:
//  • opt-in only, never the default, never persisted across reloads;
//  • live polling is paused while it runs and all live tracks are cleared, so
//    simulated and real aircraft can never appear together;
//  • every simulated aircraft is marked: provider "demo", non-ICAO addresses
//    ("~…", so no real-aircraft lookups or photos can be attached), and the UI
//    shows a persistent DEMO banner and badges;
//  • flights, registrations, addresses and schedules are invented;
//  • nothing simulated is recorded for replay, exported or alerted on.

import { create } from 'zustand';
import type { AirportIndexEntry, Aircraft, AircraftResponse } from '@shared/types';
import { distanceNm } from '@shared/geo';
import { getSettings } from '@/state/settings';
import { traffic, type Track, type TrailPoint } from '@/state/traffic';
import { ui } from '@/state/ui';
import { loadMajorAirports } from './airports';
import type { AirlineProfile } from './demo/fleet';
import type { Airframe, DemoWorld, Leg, SimAirport } from './demo/sim';
import { setFeedPaused, useFeed } from './feed';

export const DEMO_SPEEDS = [1, 5, 15, 30] as const;

interface DemoState {
  active: boolean;
  loading: boolean;
  speed: number;
  airborne: number;
  ground: number;
}

export const useDemo = create<DemoState>()(() => ({ active: false, loading: false, speed: 1, airborne: 0, ground: 0 }));

export const DEMO_ATTRIBUTION = { name: 'Simulated demo traffic', url: 'https://github.com/Arnav-Dugad/Arnav-Flight-Radar', license: 'Not real aircraft' };

const WORLD_REGION = { lat: 0, lon: 0, radiusNm: 100_000 };

let world: DemoWorld | null = null;
let byId = new Map<string, Airframe>();
let timer: ReturnType<typeof setTimeout> | undefined;
let clock = { sim0: 0, real0: 0, speed: 1 };
let tickNo = 0;
let runwaysPromise: Promise<Record<string, never[]>> | null = null;

/** Simulated wall-clock time (runs faster than real time in time-lapse). */
export function demoNow(real = Date.now()) {
  return clock.sim0 + (real - clock.real0) * clock.speed;
}

function tickMs() {
  return clock.speed >= 15 ? 2000 : 3000;
}

export function setDemoSpeed(speed: number) {
  const now = Date.now();
  clock = { sim0: demoNow(now), real0: now, speed };
  traffic.speedScale = speed;
  traffic.expectedIntervalMs = tickMs();
  useDemo.setState({ speed });
  ui().announce(`Demo time-lapse ${speed}×`);
}

function loadRunways() {
  runwaysPromise ??= fetch('/data/airports/runways-major.json')
    .then((r) => (r.ok ? (r.json() as Promise<{ runways: Record<string, never[]> }>) : { runways: {} }))
    .then((j) => j.runways)
    .catch(() => ({}));
  return runwaysPromise;
}

function deviceScale() {
  // Real-world density on capable devices; lighter on small or low-core devices.
  const cores = navigator.hardwareConcurrency || 4;
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;
  return small || cores <= 4 ? 0.4 : 0.75;
}

function toAircraft(af: Airframe, sim: number, real: number): Aircraft | null {
  const s = world!.state(af, sim);
  if (!s.emit) return null;
  const leg = af.leg;
  const a: Aircraft = {
    id: `~${af.hex}`,
    icao24: `~${af.hex}`,
    callsign: leg.flight,
    registration: af.reg,
    aircraftType: af.type.code,
    typeDescription: af.type.desc,
    category: af.type.cat,
    lat: s.lat,
    lon: s.lon,
    groundSpeed: Math.round(s.gs),
    track: Math.round(s.trk * 10) / 10,
    squawk: af.squawk,
    onGround: s.onGround,
    positionSource: 'adsb',
    observedAt: real,
    seenAt: real,
    receivedAt: real,
    provider: 'demo',
    freshness: 'live',
  };
  if (!s.onGround && s.alt !== undefined) {
    a.altitudeBarometric = Math.round(s.alt / 25) * 25;
    a.altitudeGeometric = Math.round((s.alt + 175) / 25) * 25;
    a.verticalRate = Math.round(s.vr / 64) * 64;
    const ext: NonNullable<Aircraft['ext']> = { navQnh: 1013.2, trueHeading: a.track! };
    if (s.phase === 'climb' || s.phase === 'cruise') ext.navAltitudeMcp = leg.cruiseFt;
    else if (s.phase === 'descent' || s.phase === 'approach') ext.navAltitudeMcp = Math.max(3000, Math.round((leg.to.elev + 3000) / 1000) * 1000);
    if (s.alt > 24000) {
      // Rough TAS → Mach at altitude (ISA, no wind): illustrative only.
      const tempK = Math.max(216.65, 288.15 - 0.0019812 * s.alt);
      ext.tas = Math.round(s.gs);
      ext.mach = Math.round((s.gs / (38.967854 * Math.sqrt(tempK))) * 1000) / 1000;
    }
    if (af.airline) ext.ownerOperator = af.airline.name;
    a.ext = ext;
  } else if (af.airline) a.ext = { ownerOperator: af.airline.name };
  return a;
}

function tick() {
  if (!world) return;
  const real = Date.now();
  const sim = demoNow(real);
  world.advance(sim);
  tickNo++;
  const list: Aircraft[] = [];
  let airborne = 0;
  for (const af of world.airframes) {
    const a = toAircraft(af, sim, real);
    if (!a) continue;
    if (!a.onGround) airborne++;
    list.push(a);
  }
  const resp: AircraftResponse = {
    provider: 'demo',
    attribution: DEMO_ATTRIBUTION,
    query: WORLD_REGION,
    providerNow: real,
    fetchedAt: real,
    servedAt: real,
    stale: false,
    cache: { hit: false, ageMs: 0, ttlMs: tickMs() },
    count: list.length,
    aircraft: list,
  };
  traffic.ingest(resp, real);
  // Simulated aircraft that park and switch off are simply gone, not "lost".
  const ids = new Set(list.map((a) => a.id));
  for (const id of traffic.tracks.keys()) if (!ids.has(id) && !traffic.pinned.has(id)) traffic.tracks.delete(id);
  useDemo.setState({ airborne, ground: list.length - airborne });
  timer = setTimeout(tick, tickMs());
}

// ---------------------------------------------------------------- trails

const trailCache = new Map<string, { tick: number; full: boolean; pts: TrailPoint[] }>();

function demoTrail(t: Track, full: boolean): TrailPoint[] | undefined {
  const af = byId.get(t.id);
  if (!world || !af) return undefined;
  const c = trailCache.get(t.id);
  if (c && c.tick === tickNo && c.full === full) return c.pts;
  const sim = demoNow();
  const pts = world.trail(af, sim, full ? Infinity : 6 * 60_000).map((p) => {
    const tp: TrailPoint = { lat: p.lat, lon: p.lon, t: p.t, gs: p.gs, vr: p.vr };
    if (p.alt !== undefined) tp.alt = p.alt;
    return tp;
  });
  if (trailCache.size > 4000) trailCache.clear();
  trailCache.set(t.id, { tick: tickNo, full, pts });
  return pts;
}

// ---------------------------------------------------------------- lifecycle

export async function startDemo() {
  if (useDemo.getState().active) return;
  useDemo.setState({ active: true, loading: true, speed: 1 });
  setFeedPaused(true);
  ui().select(null);
  ui().setReplay({ active: false, playing: false, index: 0 });
  traffic.reset();
  traffic.record = false;
  traffic.storeTrails = false;
  traffic.trailProvider = (t) => demoTrail(t, ui().selectedId === t.id);
  useFeed.setState({ status: 'live', message: undefined, errorCode: undefined });
  let airports: AirportIndexEntry[] = [];
  let runways: Record<string, never[]> = {};
  let Sim: typeof import('./demo/sim') | null = null;
  try {
    // The simulator and its fleet tables load only when demo mode is used.
    [airports, runways, Sim] = await Promise.all([loadMajorAirports(), loadRunways(), import('./demo/sim')]);
  } catch {
    /* handled below */
  }
  if (!useDemo.getState().active) return;
  if (!airports.length || !Sim) {
    useDemo.setState({ loading: false });
    ui().toast({ kind: 'error', title: 'Demo mode is unavailable', body: 'The airport dataset could not be loaded.' });
    stopDemo();
    return;
  }
  const now = Date.now();
  clock = { sim0: now, real0: now, speed: 1 };
  traffic.speedScale = 1;
  traffic.expectedIntervalMs = tickMs();
  world = new Sim.DemoWorld(Math.floor(now / 86_400_000) % 2147483646 || 7, airports, runways);
  world.populate(now, deviceScale());
  byId = new Map(world.airframes.map((af) => [`~${af.hex}`, af]));
  useDemo.setState({ loading: false });
  tick();
}

export function stopDemo() {
  if (!useDemo.getState().active) return;
  clearTimeout(timer);
  world = null;
  byId = new Map();
  trailCache.clear();
  ui().select(null);
  traffic.reset();
  const s = getSettings();
  traffic.record = s.recordSession;
  traffic.storeTrails = true;
  traffic.trailProvider = null;
  traffic.speedScale = 1;
  traffic.expectedIntervalMs = s.pollIntervalSec * 1000;
  useDemo.setState({ active: false, loading: false, speed: 1, airborne: 0, ground: 0 });
  setFeedPaused(false);
}

export const isDemo = () => useDemo.getState().active;
export const isDemoId = (id: string | null | undefined) => !!id && byId.has(id);

// ---------------------------------------------------------------- flight info

export type FlightStatus = 'Scheduled' | 'Boarding' | 'Departed' | 'Taxiing' | 'En route' | 'Approach' | 'Landed' | 'Arrived';

export interface DemoFlightInfo {
  flight: string;
  flightIata?: string;
  airline?: Pick<AirlineProfile, 'icao' | 'iata' | 'name' | 'country'>;
  from: SimAirport;
  to: SimAirport;
  std: number;
  sta: number;
  atd?: number; // actual off-block
  eta: number; // estimated on-block
  ata?: number;
  takeoff: number;
  landing: number;
  progress: number; // 0..1 of distance
  flownNm: number;
  totalNm: number;
  status: FlightStatus;
  cruiseFt: number;
  delayMin: number;
}

function legInfo(af: Airframe, leg: Leg, sim: number): DemoFlightInfo {
  const totalNm = Math.max(1, distanceNm(leg.from.lat, leg.from.lon, leg.to.lat, leg.to.lon));
  let flownNm = 0;
  if (sim >= leg.tOn) flownNm = totalNm;
  else if (sim > leg.tTakeoff && world) {
    const s = world.state(af, sim);
    flownNm = Math.max(0, Math.min(totalNm, totalNm - distanceNm(s.lat, s.lon, leg.to.lat, leg.to.lon)));
  }
  const phase = world?.state(af, sim).phase;
  let status: FlightStatus;
  if (sim >= leg.tOn) status = 'Arrived';
  else if (sim < leg.tOff) status = leg.tOff - sim < 35 * 60_000 ? 'Boarding' : 'Scheduled';
  else if (sim < leg.tTakeoff) status = 'Taxiing';
  else if (sim >= leg.tLand) status = 'Landed';
  else if (phase === 'approach') status = 'Approach';
  else status = 'En route';
  const info: DemoFlightInfo = {
    flight: leg.flight,
    from: leg.from,
    to: leg.to,
    std: leg.std,
    sta: leg.sta,
    eta: leg.tOn,
    takeoff: leg.tTakeoff,
    landing: leg.tLand,
    progress: flownNm / totalNm,
    flownNm,
    totalNm,
    status,
    cruiseFt: leg.cruiseFt,
    delayMin: Math.round((leg.tOn - leg.sta) / 60_000),
  };
  if (leg.flightIata) info.flightIata = leg.flightIata;
  if (af.airline) info.airline = { icao: af.airline.icao, iata: af.airline.iata, name: af.airline.name, country: af.airline.country };
  if (sim >= leg.tOff) info.atd = leg.tOff;
  if (sim >= leg.tOn) info.ata = leg.tOn;
  return info;
}

/** Simulated route and schedule for a demo aircraft. */
export function demoFlight(id: string | null | undefined): DemoFlightInfo | undefined {
  const af = id ? byId.get(id) : undefined;
  if (!af || !world) return undefined;
  const sim = demoNow();
  // Shortly after arrival the aircraft still shows the flight it just completed.
  const leg = sim < af.leg.tOff && af.prev && sim - af.prev.tOn < 15 * 60_000 ? af.prev : af.leg;
  return legInfo(af, leg, sim);
}

export interface BoardRow {
  id: string; // aircraft id ('~hex')
  flight: string;
  flightIata?: string;
  airline?: string;
  airlineIata?: string;
  other: SimAirport;
  scheduled: number;
  estimated: number;
  actual?: number;
  status: FlightStatus;
  type: string;
  reg: string;
  delayMin: number;
}

/** Simulated arrivals/departures board for an airport. */
export function demoBoard(ident: string, opts: { pastMin?: number; aheadMin?: number } = {}): { arrivals: BoardRow[]; departures: BoardRow[] } | undefined {
  if (!world) return undefined;
  const sim = demoNow();
  const past = (opts.pastMin ?? 60) * 60_000;
  const ahead = (opts.aheadMin ?? 180) * 60_000;
  const arrivals: BoardRow[] = [];
  const departures: BoardRow[] = [];
  const row = (af: Airframe, leg: Leg, dep: boolean): BoardRow => {
    const info = legInfo(af, leg, sim);
    const r: BoardRow = {
      id: `~${af.hex}`,
      flight: leg.flight,
      other: dep ? leg.to : leg.from,
      scheduled: dep ? leg.std : leg.sta,
      estimated: dep ? leg.tOff : leg.tOn,
      status: info.status,
      type: af.type.code,
      reg: af.reg,
      delayMin: Math.round(((dep ? leg.tOff : leg.tOn) - (dep ? leg.std : leg.sta)) / 60_000),
    };
    if (leg.flightIata) r.flightIata = leg.flightIata;
    if (af.airline) {
      r.airline = af.airline.name;
      r.airlineIata = af.airline.iata;
    }
    const act = dep ? info.atd : info.ata;
    if (act !== undefined) r.actual = act;
    return r;
  };
  for (const af of world.airframes) {
    if (af.ga) continue;
    for (const leg of af.prev ? [af.prev, af.leg] : [af.leg]) {
      if (leg.from.ident === ident && leg.tOff > sim - past && leg.std < sim + ahead) departures.push(row(af, leg, true));
      if (leg.to.ident === ident && leg.tOn > sim - past && leg.sta < sim + ahead) arrivals.push(row(af, leg, false));
    }
  }
  arrivals.sort((a, b) => a.scheduled - b.scheduled);
  departures.sort((a, b) => a.scheduled - b.scheduled);
  return { arrivals, departures };
}

/** Simulated runway in use at an airport (landing direction). */
export function demoRunwayInUse(ident: string): string | undefined {
  return world?.airports.get(ident)?.inUse.ident;
}

/** Hourly simulated movements at an airport over the last `hours` and the next few. */
export function demoMovementsByHour(ident: string, hours = 6): { t: number; arrivals: number; departures: number }[] | undefined {
  const b = demoBoard(ident, { pastMin: hours * 60, aheadMin: 120 });
  if (!b) return undefined;
  const sim = demoNow();
  const h0 = Math.floor(sim / 3_600_000) * 3_600_000 - (hours - 1) * 3_600_000;
  const buckets = Array.from({ length: hours + 2 }, (_, i) => ({ t: h0 + i * 3_600_000, arrivals: 0, departures: 0 }));
  const put = (t: number, k: 'arrivals' | 'departures') => {
    const i = Math.floor((t - h0) / 3_600_000);
    if (i >= 0 && i < buckets.length) buckets[i]![k]++;
  };
  for (const r of b.arrivals) put(r.actual ?? r.estimated, 'arrivals');
  for (const r of b.departures) put(r.actual ?? r.estimated, 'departures');
  return buckets;
}

/** Search simulated flights by flight number (ICAO or IATA), callsign or registration. */
export function demoSearch(q: string, limit = 8): { id: string; label: string; sub: string }[] {
  if (!world) return [];
  const n = q.trim().toUpperCase().replace(/[\s-]/g, '');
  if (n.length < 2) return [];
  const out: { id: string; label: string; sub: string }[] = [];
  for (const af of world.airframes) {
    const leg = af.leg;
    const hit = leg.flight === n || leg.flightIata === n || af.reg.replace(/-/g, '') === n || leg.flight.startsWith(n) || leg.flightIata?.startsWith(n);
    if (!hit) continue;
    out.push({
      id: `~${af.hex}`,
      label: leg.flightIata ? `${leg.flightIata} · ${leg.flight}` : leg.flight,
      sub: `${leg.from.iata ?? leg.from.ident} → ${leg.to.iata ?? leg.to.ident} · ${af.type.code} · ${af.reg}`,
    });
    if (out.length >= limit) break;
  }
  return out;
}
