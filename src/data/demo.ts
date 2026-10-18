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
import { api } from '@/lib/api';
import { getSettings } from '@/state/settings';
import { traffic, type Track, type TrailPoint } from '@/state/traffic';
import { ui } from '@/state/ui';
import { loadMajorAirports } from './airports';
import type { AirlineProfile } from './demo/fleet';
import type { Airframe, DemoWorld, Leg, Phase, SimAirport, TaxiGraph } from './demo/sim';
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
    else if (s.phase === 'holding') ext.navAltitudeMcp = Math.round(s.alt / 1000) * 1000;
    else if (s.phase === 'descent' || s.phase === 'approach') ext.navAltitudeMcp = Math.max(3000, Math.round((leg.to.elev + 3000) / 1000) * 1000);
    const tas = s.wind ? s.gs - s.wind.comp : s.gs;
    if (s.wind && s.alt > 5000) {
      ext.windDirection = Math.round(s.wind.dir);
      ext.windSpeed = Math.round(s.wind.kt);
    }
    if (s.alt > 24000) {
      // TAS → Mach at altitude (ISA): illustrative only.
      const tempK = Math.max(216.65, 288.15 - 0.0019812 * s.alt);
      ext.tas = Math.round(tas);
      ext.mach = Math.round((tas / (38.967854 * Math.sqrt(tempK))) * 1000) / 1000;
      ext.outsideAirTemp = Math.round(tempK - 273.15);
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
  let stands: Record<string, [number, number, string, number | null][]> = {};
  try {
    // The simulator, its fleet tables and the stand positions load only when demo mode is used.
    [airports, runways, Sim, stands] = await Promise.all([loadMajorAirports(), loadRunways(), import('./demo/sim'), loadStands()]);
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
  world.setStands(stands);
  world.populate(now, deviceScale());
  void loadHubWeather();
  byId = new Map(world.airframes.map((af) => [`~${af.hex}`, af]));
  useDemo.setState({ loading: false });
  tick();
}

export function stopDemo() {
  if (!useDemo.getState().active) return;
  clearTimeout(timer);
  world = null;
  metarFetched.clear();
  groundLoaded.clear();
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

export type FlightStatus = 'Scheduled' | 'Boarding' | 'Delayed' | 'Departed' | 'Taxiing' | 'En route' | 'Holding' | 'Diverted' | 'Approach' | 'Landed' | 'Arrived';

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
  phase?: Phase;
  cruiseFt: number;
  delayMin: number;
  codeshares: string[];
  gateFrom?: string;
  gateTo?: string;
  divertedFrom?: SimAirport;
  holdMin: number;
  wind?: { dir: number; kt: number; comp: number };
}

function legInfo(af: Airframe, leg: Leg, sim: number): DemoFlightInfo {
  const totalNm = Math.max(1, distanceNm(leg.from.lat, leg.from.lon, leg.to.lat, leg.to.lon));
  let flownNm = 0;
  if (sim >= leg.tOn) flownNm = totalNm;
  else if (sim > leg.tTakeoff && world) {
    const s = world.state(af, sim);
    flownNm = Math.max(0, Math.min(totalNm, totalNm - distanceNm(s.lat, s.lon, leg.to.lat, leg.to.lon)));
  }
  const st = world?.state(af, sim);
  const phase = st?.phase;
  const late = leg.tOff - leg.std > 15 * 60_000;
  let status: FlightStatus;
  if (sim >= leg.tOn) status = 'Arrived';
  else if (sim < leg.tOff) status = late && leg.std < sim ? 'Delayed' : leg.tOff - sim < 35 * 60_000 ? 'Boarding' : late ? 'Delayed' : 'Scheduled';
  else if (sim < leg.tTakeoff) status = 'Taxiing';
  else if (sim >= leg.tLand) status = 'Landed';
  else if (phase === 'holding') status = 'Holding';
  else if (leg.divertedFrom && sim > leg.tTakeoff) status = 'Diverted';
  else if (phase === 'approach') status = 'Approach';
  else status = 'En route';
  const info: DemoFlightInfo = {
    flight: leg.flight,
    from: leg.from,
    to: leg.to,
    std: leg.std,
    sta: leg.sta,
    eta: world ? world.eta(af, sim) : leg.tOn,
    takeoff: leg.tTakeoff,
    landing: leg.tLand,
    progress: flownNm / totalNm,
    flownNm,
    totalNm,
    status,
    cruiseFt: leg.cruiseFt,
    delayMin: Math.round((leg.tOn - leg.sta) / 60_000),
    codeshares: leg.codeshares,
    holdMin: Math.round(leg.holdMs / 60_000),
  };
  if (phase) info.phase = phase;
  if (leg.stand.ref) info.gateFrom = leg.stand.ref;
  if (leg.standTo.ref) info.gateTo = leg.standTo.ref;
  if (leg.divertedFrom) info.divertedFrom = leg.divertedFrom;
  if (st?.wind && !st.onGround) info.wind = st.wind;
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
  airlineIcao?: string;
  other: SimAirport;
  scheduled: number;
  estimated: number;
  actual?: number;
  status: FlightStatus;
  type: string;
  reg: string;
  delayMin: number;
  codeshares: string[];
  gate?: string;
  divertedFrom?: SimAirport;
  /** Set on this airport's arrivals board when the flight diverted elsewhere. */
  divertedTo?: SimAirport;
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
      codeshares: leg.codeshares,
    };
    const gate = dep ? leg.stand.ref : leg.standTo.ref;
    if (gate) r.gate = gate;
    if (leg.divertedFrom) r.divertedFrom = leg.divertedFrom;
    if (!dep && leg.divertedFrom?.ident === ident) {
      r.divertedTo = leg.to;
      r.status = 'Diverted';
    }
    if (leg.flightIata) r.flightIata = leg.flightIata;
    if (af.airline) {
      r.airline = af.airline.name;
      r.airlineIata = af.airline.iata;
      r.airlineIcao = af.airline.icao;
    }
    const act = dep ? info.atd : info.ata;
    if (act !== undefined) r.actual = act;
    return r;
  };
  for (const af of world.airframes) {
    if (af.ga) continue;
    for (const leg of af.prev ? [af.prev, af.leg] : [af.leg]) {
      if (leg.from.ident === ident && leg.tOff > sim - past && leg.std < sim + ahead) departures.push(row(af, leg, true));
      if ((leg.to.ident === ident || leg.divertedFrom?.ident === ident) && leg.tOn > sim - past && leg.sta < sim + ahead) arrivals.push(row(af, leg, false));
    }
  }
  arrivals.sort((a, b) => a.scheduled - b.scheduled);
  departures.sort((a, b) => a.scheduled - b.scheduled);
  return { arrivals, departures };
}

/** Simulated runway in use at an airport (landing direction) and why. */
export function demoRunwayInUse(ident: string): { runway: string; basis: 'simulated' | 'metar'; wind?: string } | undefined {
  const a = world?.airports.get(ident);
  if (!a) return undefined;
  const out: { runway: string; basis: 'simulated' | 'metar'; wind?: string } = { runway: a.inUse.ident, basis: a.inUseBasis };
  const w = a.weather;
  if (w?.windDir !== undefined && w.windKt !== undefined) out.wind = `${String(Math.round(w.windDir)).padStart(3, '0')}° ${w.windKt} kt${w.gustKt ? ` G${w.gustKt}` : ''}`;
  return out;
}

/** Route geometry for the selected simulated flight: origin, destination and the path still to fly. */
export function demoRoute(id: string | null | undefined): { from: SimAirport; to: SimAirport; ahead: [number, number][]; divertedFrom?: SimAirport } | undefined {
  const af = id ? byId.get(id) : undefined;
  if (!af || !world) return undefined;
  const sim = demoNow();
  if (sim < af.leg.tOff || sim >= af.leg.tOn) return undefined;
  const out: { from: SimAirport; to: SimAirport; ahead: [number, number][]; divertedFrom?: SimAirport } = { from: af.leg.from, to: af.leg.to, ahead: world.plannedPath(af, sim) };
  if (af.leg.divertedFrom) out.divertedFrom = af.leg.divertedFrom;
  return out;
}

/** The simulated flight's planned vertical profile from now to landing (for the 3D-path profile). */
export function demoPlannedProfile(id: string | null | undefined): { lat: number; lon: number; alt: number }[] | undefined {
  const af = id ? byId.get(id) : undefined;
  if (!af || !world) return undefined;
  const sim = demoNow();
  const end = af.leg.tLand;
  if (sim >= end) return undefined;
  const out: { lat: number; lon: number; alt: number }[] = [];
  const step = Math.max(30_000, (end - sim) / 90);
  for (let t = sim; t <= end; t += step) {
    const s = world.state(af, t);
    out.push({ lat: s.lat, lon: s.lon, alt: s.onGround ? af.leg.to.elev : (s.alt ?? 0) });
  }
  return out;
}

// ---------------------------------------------------------------- real-world inputs

let standsPromise: Promise<Record<string, [number, number, string, number | null][]>> | null = null;
function loadStands() {
  standsPromise ??= fetch('/data/ground/stands.json')
    .then((r) => (r.ok ? (r.json() as Promise<{ stands: Record<string, [number, number, string, number | null][]> }>) : { stands: {} }))
    .then((j) => j.stands)
    .catch(() => ({}));
  return standsPromise;
}

const metarFetched = new Map<string, number>();

async function applyMetars(ids: string[]) {
  const want = ids.filter((id) => /^[A-Z]{4}$/.test(id) && Date.now() - (metarFetched.get(id) ?? 0) > 20 * 60_000).slice(0, 10);
  if (!want.length || !world) return;
  for (const id of want) metarFetched.set(id, Date.now());
  try {
    const r = await api.metar(want);
    for (const m of r.data) {
      const w: Parameters<DemoWorld['setWeather']>[1] = { observedAt: m.observedAt };
      if (m.flightCategory) w.category = m.flightCategory;
      if (m.windDirDeg !== undefined) w.windDir = m.windDirDeg;
      if (m.windSpeedKt !== undefined) w.windKt = m.windSpeedKt;
      if (m.windGustKt !== undefined) w.gustKt = m.windGustKt;
      world?.setWeather(m.station, w);
    }
  } catch {
    /* weather is optional: the simulated runway choice stays in place */
  }
}

/** Real METARs for the busiest simulated hubs set their runway in use and capacity. */
async function loadHubWeather() {
  if (!world) return;
  const count = new Map<string, number>();
  for (const af of world.airframes) if (af.airline) count.set(af.leg.to.ident, (count.get(af.leg.to.ident) ?? 0) + 1);
  const top = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([id]) => id);
  for (let i = 0; i < top.length; i += 10) {
    if (!useDemo.getState().active) return;
    await applyMetars(top.slice(i, i + 10));
    await new Promise((r) => setTimeout(r, 2000)); // stay well inside the weather API pacing
  }
}

const groundLoaded = new Set<string>();
let lastView = 0;

/**
 * Called when the map view settles. Loads real weather for large airports in view and,
 * when zoomed in on an airport, its OpenStreetMap taxiway network.
 */
export function demoViewChanged(view: { lat: number; lon: number; zoom: number; bounds: [number, number, number, number] }) {
  if (!world || !useDemo.getState().active) return;
  if (view.zoom >= 6.5 && Date.now() - lastView > 15_000) {
    lastView = Date.now();
    const [w, s, e, n] = view.bounds;
    const inView = [...world.airports.values()].filter((a) => a.large && a.lat >= s && a.lat <= n && a.lon >= w && a.lon <= e).map((a) => a.ident);
    void applyMetars(inView);
  }
  if (view.zoom < 11) return;
  let best: SimAirport | undefined;
  let bd = 4;
  for (const a of world.airports.values()) {
    if (!a.stands) continue;
    const d = distanceNm(view.lat, view.lon, a.lat, a.lon);
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  if (!best || groundLoaded.has(best.ident)) return;
  groundLoaded.add(best.ident);
  const ident = best.ident;
  void fetch(`/data/ground/${ident}.json`)
    .then((r) => (r.ok ? (r.json() as Promise<{ nodes: [number, number][]; edges: [number, number][] }>) : null))
    .then((j) => {
      if (!j || !world) return;
      const adj: number[][] = j.nodes.map(() => []);
      for (const [a, b] of j.edges) {
        adj[a]!.push(b);
        adj[b]!.push(a);
      }
      const g: TaxiGraph = { nodes: j.nodes, adj };
      world.setTaxiGraph(ident, g, demoNow());
    })
    .catch(() => groundLoaded.delete(ident));
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
