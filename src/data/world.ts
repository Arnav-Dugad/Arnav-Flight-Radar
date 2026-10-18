// The simulated world that drives the whole site.
//
// A whole planet of traffic is simulated — real airlines on real routes between
// real airports, with real aircraft types, gate-to-gate (stands, taxi, runway in
// use, departure queues, winds aloft, holding, diversions, approaches, landings).
// Real weather (METAR) sets runways and capacity.
//
// Honesty rules:
//  • every aircraft is marked as simulated (provider "sim", non-ICAO "~" addresses,
//    so no real-aircraft record or photo is ever attached to an invented flight);
//  • flights, registrations, schedules and positions are invented and the UI says
//    "Simulated" wherever a reader could mistake them for real tracking data.

import { create } from 'zustand';
import type { AirportIndexEntry, Aircraft, AircraftResponse } from '@shared/types';
import { destination, distanceNm } from '@shared/geo';
import { api } from '@/lib/api';
import { getSettings } from '@/state/settings';
import { traffic, type Track, type TrailPoint } from '@/state/traffic';
import { ui } from '@/state/ui';
import { loadMajorAirports } from './airports';
import type { AirlineProfile } from './sim/fleet';
import type { Airframe, World, Leg, LegKind, Phase, SimAirport, TaxiGraph, TaxiInfo, RouteInfo, Emergency } from './sim/engine';
import type { RouteDays } from './sim/schedule';

export const SIM_SPEEDS = [1, 5, 15, 30] as const;

interface SimState {
  active: boolean;
  loading: boolean;
  speed: number;
  airborne: number;
  ground: number;
}

export const useSim = create<SimState>()(() => ({ active: false, loading: true, speed: 1, airborne: 0, ground: 0 }));

export const SIM_ATTRIBUTION = { name: 'Simulated traffic', url: 'https://github.com/Arnav-Dugad/Arnav-Flight-Radar', license: 'Simulated — not real aircraft' };

const WORLD_REGION = { lat: 0, lon: 0, radiusNm: 100_000 };

let world: World | null = null;
let byId = new Map<string, Airframe>();
let timer: ReturnType<typeof setTimeout> | undefined;
let clock = { sim0: 0, real0: 0, speed: 1 };
let tickNo = 0;
let runwaysPromise: Promise<Record<string, never[]>> | null = null;

/** Simulated wall-clock time (runs faster than real time in time-lapse). */
export function simNow(real = Date.now()) {
  return clock.sim0 + (real - clock.real0) * clock.speed;
}

function tickMs() {
  return clock.speed >= 15 ? 2000 : 3000;
}

export function setSimSpeed(speed: number) {
  const now = Date.now();
  clock = { sim0: simNow(now), real0: now, speed };
  traffic.speedScale = speed;
  traffic.expectedIntervalMs = tickMs();
  useSim.setState({ speed });
  ui().announce(`Simulation speed ${speed}×`);
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
    squawk: world!.squawkAt(af, sim),
    onGround: s.onGround,
    positionSource: af.role === 'glider' ? 'other' : 'adsb',
    observedAt: real,
    seenAt: real,
    receivedAt: real,
    provider: 'sim',
    freshness: 'live',
  };
  if (a.squawk === '7700') a.emergency = 'general';
  if (af.role === 'mil') a.military = true;
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
    const owner = af.airline?.name ?? af.op?.name;
    if (owner) ext.ownerOperator = owner;
    a.ext = ext;
  } else {
    const owner = af.airline?.name ?? af.op?.name;
    if (owner) a.ext = { ownerOperator: owner };
  }
  return a;
}

function tick() {
  if (!world) return;
  const real = Date.now();
  const sim = simNow(real);
  world.advance(sim);
  tickNo++;
  const list: Aircraft[] = [];
  let airborne = 0;
  routeCodes.clear();
  for (const af of world.airframes) {
    const a = toAircraft(af, sim, real);
    if (!a) continue;
    if (!a.onGround) airborne++;
    list.push(a);
    const to = af.leg.canceledTo ?? af.leg.to;
    routeCodes.set(a.id, [af.leg.flightIata ?? af.leg.flight, af.leg.from.iata ?? af.leg.from.ident, to.iata ?? to.ident]);
  }
  const resp: AircraftResponse = {
    provider: 'sim',
    attribution: SIM_ATTRIBUTION,
    query: WORLD_REGION,
    providerNow: real,
    fetchedAt: real,
    servedAt: real,
    stale: false,
    cache: { hit: false, ageMs: 0, ttlMs: tickMs() },
    count: list.length,
    aircraft: list,
  };
  // Session recording (Timeline playback) keeps only what is in view, to stay light.
  const b = lastBounds;
  traffic.recordFilter = b ? (a) => a.lat >= b[1] && a.lat <= b[3] && a.lon >= b[0] && a.lon <= b[2] : () => false;
  traffic.ingest(resp, real);
  // Simulated aircraft that park and switch off are simply gone, not "lost".
  const ids = new Set(list.map((a) => a.id));
  for (const id of traffic.tracks.keys()) if (!ids.has(id) && !traffic.pinned.has(id)) traffic.tracks.delete(id);
  useSim.setState({ airborne, ground: list.length - airborne });
  alertEmergencies(sim);
  timer = setTimeout(tick, tickMs());
}

const alerted = new Set<string>();
/** Tells the user when a simulated flight declares an emergency (setting: Emergency alerts). */
function alertEmergencies(sim: number) {
  const mode = getSettings().emergencyAlerts;
  if (!world || mode === 'off') return;
  for (const af of world.airframes) {
    const e = af.leg.emergency;
    if (!e || sim < e.t || sim > af.leg.tLand) continue;
    const key = `${af.hex}${e.t}`;
    if (alerted.has(key)) continue;
    alerted.add(key);
    if (sim - e.t > 10 * 60_000) continue; // already old when we first saw it
    const flight = af.leg.flightIata ?? af.leg.flight;
    const what = e.kind === 'medical' ? 'Medical emergency (PAN PAN)' : e.kind === 'engine' ? 'Engine failure — squawk 7700' : 'Loss of cabin pressure — squawk 7700';
    const body = `${flight} ${af.leg.from.iata ?? af.leg.from.ident} → ${(af.leg.divertedFrom ?? af.leg.to).iata ?? af.leg.to.ident}, diverting to ${e.divertTo.name}. Simulated.`;
    const id = `~${af.hex}`;
    ui().toast({ kind: 'warning', title: what, body, action: { label: 'Show', run: () => ui().select(id) } });
    if (mode === 'notify' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(what, { body, tag: key });
      } catch {
        /* notifications are best effort */
      }
    }
  }
}

// ---------------------------------------------------------------- trails

const trailCache = new Map<string, { tick: number; full: boolean; pts: TrailPoint[] }>();

function simTrail(t: Track, full: boolean): TrailPoint[] | undefined {
  const af = byId.get(t.id);
  if (!world || !af) return undefined;
  const c = trailCache.get(t.id);
  if (c && c.tick === tickNo && c.full === full) return c.pts;
  const sim = simNow();
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

let lastBounds: [number, number, number, number] | null = null;

/** Per-aircraft [flight number, origin code, destination code], refreshed every tick (cheap map labels). */
const routeCodes = new Map<string, [string, string, string]>();
export function simRouteCodes(id: string): [string, string, string] | undefined {
  return routeCodes.get(id);
}

/** Builds the world and starts the clock (called once, when the map is ready). */
export async function startSim() {
  if (useSim.getState().active) return;
  useSim.setState({ active: true, loading: true, speed: 1 });
  traffic.reset();
  traffic.record = getSettings().recordSession;
  traffic.storeTrails = false;
  traffic.trailProvider = (t) => simTrail(t, ui().selectedId === t.id);
  let airports: AirportIndexEntry[] = [];
  let runways: Record<string, never[]> = {};
  let Sim: typeof import('./sim/engine') | null = null;
  let navaids: NavRow[] = [];
  try {
    [airports, runways, Sim, navaids] = await Promise.all([loadMajorAirports(), loadRunways(), import('./sim/engine'), loadSimData<NavRow[]>('navaids')]);
  } catch {
    /* handled below */
  }
  if (!airports.length || !Sim) {
    useSim.setState({ active: false, loading: false });
    ui().toast({
      kind: 'error',
      title: 'The simulation could not start',
      body: 'The airport dataset could not be loaded. Check your connection and reload.',
      action: { label: 'Reload', run: () => location.reload() },
    });
    return;
  }
  const now = Date.now();
  clock = { sim0: now, real0: now, speed: 1 };
  traffic.speedScale = 1;
  traffic.expectedIntervalMs = tickMs();
  world = new Sim.World(Math.floor(now / 86_400_000) % 2147483646 || 7, airports, runways);
  ALLIANCES = Sim.ALL_ALLIANCES;
  if (navaids.length) world.setNavaids(navaids);
  // Stands arrive quickly; if they are slow the first legs use apron positions instead.
  const stands = await Promise.race([loadStands(), new Promise<null>((r) => setTimeout(() => r(null), 2500))]);
  if (!world) return;
  if (stands) world.setStands(stands);
  world.populate(now, deviceScale());
  if (!stands) void loadStands().then((s) => world?.setStands(s));
  void loadHubWeather();
  byId = new Map(world.airframes.map((af) => [`~${af.hex}`, af]));
  useSim.setState({ loading: false });
  tick();
  void loadExtraTraffic();
}

type NavRow = [string, string, number, number, number, number, string];
type HeliRow = [string, string, number, number, string, number, number | null];
type GlideRow = [string, string, number, number, string, number | null];

/** Helicopter (air ambulance, offshore, shuttle) and gliding traffic, once their site lists arrive. */
async function loadExtraTraffic() {
  const [heli, gliding] = await Promise.all([loadSimData<HeliRow[]>('heliports'), loadSimData<GlideRow[]>('gliding')]);
  if (!world) return;
  world.populateExtra(simNow(), deviceScale(), heli, gliding);
  byId = new Map(world.airframes.map((af) => [`~${af.hex}`, af]));
}

const simData = new Map<string, Promise<unknown>>();
/** Reference datasets for the simulator in /data/sim (navaids, heliports, gliding sites). */
function loadSimData<T>(name: 'navaids' | 'heliports' | 'gliding'): Promise<T> {
  let p = simData.get(name) as Promise<T> | undefined;
  if (!p) {
    p = fetch(`/data/sim/${name}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<{ rows: T }>) : { rows: [] as unknown as T }))
      .then((j) => j.rows)
      .catch(() => [] as unknown as T);
    simData.set(name, p);
  }
  return p;
}

export type FreqTable = Record<string, Partial<Record<'twr' | 'gnd' | 'app' | 'dep' | 'atis' | 'del' | 'ctr', number[]>>>;
let freqPromise: Promise<FreqTable> | null = null;
/** Real published airport frequencies (OurAirports), for the simulated radio. */
export function loadFrequencies(): Promise<FreqTable> {
  freqPromise ??= fetch('/data/sim/frequencies.json')
    .then((r) => (r.ok ? (r.json() as Promise<{ airports: FreqTable }>) : { airports: {} }))
    .then((j) => j.airports)
    .catch(() => ({}));
  return freqPromise;
}

/** Stops the clock (tests / teardown only). */
export function stopSim() {
  clearTimeout(timer);
  world = null;
  metarFetched.clear();
  groundLoaded.clear();
  byId = new Map();
  trailCache.clear();
  useSim.setState({ active: false, loading: false, speed: 1, airborne: 0, ground: 0 });
}

export const isSim = () => useSim.getState().active;
export const isSimId = (id: string | null | undefined) => !!id && byId.has(id);

// ---------------------------------------------------------------- flight info

export type FlightStatus =
  | 'Scheduled'
  | 'Boarding'
  | 'Delayed'
  | 'Canceled'
  | 'Gate hold'
  | 'De-icing'
  | 'Departed'
  | 'Taxiing'
  | 'En route'
  | 'Holding'
  | 'Diverted'
  | 'Emergency'
  | 'Go-around'
  | 'On station'
  | 'Soaring'
  | 'Approach'
  | 'Landed'
  | 'Arrived';

export interface FlightInfo {
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
  alliance?: string;
  /** Turnaround on the stand before departure (simulated ground operations). */
  ground?: { start: number; end: number; steps: { label: string; t0: number; t1: number }[] };
  canceledTo?: SimAirport;
  kind: LegKind;
  /** Operator for non-airline flights (military, air ambulance, helicopter operators). */
  operator?: { icao: string; name: string; tel: string; country: string };
  route?: RouteInfo;
  taxiOut?: TaxiInfo;
  taxiIn?: TaxiInfo;
  approach?: string;
  emergency?: Emergency;
  days?: RouteDays;
  terminalFrom?: string;
  terminalTo?: string;
  gateHoldMin: number;
  deiceMin: number;
  wake: string;
  remoteFrom: boolean;
}

/** Alliance memberships, taken from the simulator chunk once it has loaded. */
let ALLIANCES: { name: string; members: string[] }[] = [];

/** Alliance of an airline (as publicly announced), if any. */
export function allianceOf(icao: string | undefined): string | undefined {
  if (!icao) return undefined;
  return ALLIANCES.find((a) => a.members.includes(icao))?.name;
}

/** Typical turnaround steps as fractions of the time on stand. */
const TURN_STEPS: [string, number, number][] = [
  ['Arrived on stand', 0, 0.04],
  ['Deboarding', 0.03, 0.2],
  ['Cleaning', 0.18, 0.36],
  ['Catering', 0.22, 0.42],
  ['Fuelling', 0.32, 0.6],
  ['Boarding', 0.55, 0.9],
  ['Doors closed · push-back', 0.9, 1],
];

function groundOps(start: number, end: number) {
  const span = Math.max(1, end - start);
  return { start, end, steps: TURN_STEPS.map(([label, a, b]) => ({ label, t0: start + a * span, t1: start + b * span })) };
}

function legInfo(af: Airframe, leg: Leg, sim: number): FlightInfo {
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
  const seg = leg === af.leg ? world?.segNow(af, sim) : undefined;
  let status: FlightStatus;
  if (leg.canceled) status = 'Canceled';
  else if (sim >= leg.tOn) status = 'Arrived';
  else if (sim < leg.tOff) status = late && leg.std < sim ? 'Delayed' : leg.tOff - sim < 35 * 60_000 ? 'Boarding' : late ? 'Delayed' : 'Scheduled';
  else if (leg.gateHoldMs > 0 && seg?.phase === 'parked') status = 'Gate hold';
  else if (sim < leg.tTakeoff) status = leg.deiceMs > 0 && leg.events.some((e) => e.k === 'deice' && sim >= e.t && sim < e.t + leg.deiceMs) ? 'De-icing' : 'Taxiing';
  else if (leg.emergency && sim >= leg.emergency.t && sim < leg.tLand) status = 'Emergency';
  else if (phase === 'goaround') status = 'Go-around';
  else if (phase === 'orbit') status = 'On station';
  else if (phase === 'soaring') status = 'Soaring';
  else if (sim >= leg.tLand) status = 'Landed';
  else if (phase === 'holding') status = 'Holding';
  else if (leg.divertedFrom && sim > leg.tTakeoff) status = 'Diverted';
  else if (phase === 'approach') status = 'Approach';
  else status = 'En route';
  const info: FlightInfo = {
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
    kind: leg.kind,
    gateHoldMin: Math.round(leg.gateHoldMs / 60_000),
    deiceMin: Math.round(leg.deiceMs / 60_000),
    wake: leg.wake,
    remoteFrom: leg.stand.kind === 1,
  };
  if (phase) info.phase = phase;
  if (af.op) info.operator = { icao: af.op.icao, name: af.op.name, tel: af.op.tel, country: af.op.country };
  if (leg.route) info.route = leg.route;
  if (leg.taxiOut) info.taxiOut = leg.taxiOut;
  if (leg.taxiIn) info.taxiIn = leg.taxiIn;
  if (leg.approach) info.approach = leg.approach;
  if (leg.emergency && sim >= leg.emergency.t) info.emergency = leg.emergency;
  if (leg.days) info.days = leg.days;
  if (leg.stand.terminal) info.terminalFrom = leg.stand.terminal;
  if (leg.standTo.terminal) info.terminalTo = leg.standTo.terminal;
  if (leg.stand.ref) info.gateFrom = leg.stand.ref;
  if (leg.standTo.ref) info.gateTo = leg.standTo.ref;
  if (leg.divertedFrom) info.divertedFrom = leg.divertedFrom;
  if (st?.wind && !st.onGround) info.wind = st.wind;
  const alliance = allianceOf(af.airline?.icao);
  if (alliance) info.alliance = alliance;
  if (leg.canceledTo) info.canceledTo = leg.canceledTo;
  if (sim < leg.tOff && !leg.canceled && af.airline) {
    const start = af.prev && af.prev.tOn <= sim ? af.prev.tOn : leg.tOff - af.turnMs;
    info.ground = groundOps(start, leg.tOff);
  }
  if (leg.flightIata) info.flightIata = leg.flightIata;
  if (af.airline) info.airline = { icao: af.airline.icao, iata: af.airline.iata, name: af.airline.name, country: af.airline.country };
  if (sim >= leg.tOff) info.atd = leg.tOff;
  if (sim >= leg.tOn) info.ata = leg.tOn;
  return info;
}

/** Simulated route and schedule for an aircraft. */
export function simFlight(id: string | null | undefined): FlightInfo | undefined {
  const af = id ? byId.get(id) : undefined;
  if (!af || !world) return undefined;
  const sim = simNow();
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
  terminal?: string;
  divertedFrom?: SimAirport;
  /** Set on this airport's arrivals board when the flight diverted elsewhere. */
  divertedTo?: SimAirport;
}

/** Simulated arrivals/departures board for an airport. */
export function simBoard(ident: string, opts: { pastMin?: number; aheadMin?: number } = {}): { arrivals: BoardRow[]; departures: BoardRow[] } | undefined {
  if (!world) return undefined;
  const sim = simNow();
  const past = (opts.pastMin ?? 60) * 60_000;
  const ahead = (opts.aheadMin ?? 180) * 60_000;
  const arrivals: BoardRow[] = [];
  const departures: BoardRow[] = [];
  const row = (af: Airframe, leg: Leg, dep: boolean): BoardRow => {
    const info = legInfo(af, leg, sim);
    const r: BoardRow = {
      id: `~${af.hex}`,
      flight: leg.flight,
      other: dep ? (leg.canceledTo ?? leg.to) : leg.from,
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
    const term = dep ? leg.stand.terminal : leg.standTo.terminal;
    if (term) r.terminal = term;
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
    if (!af.airline) continue;
    for (const leg of af.prev ? [af.prev, af.leg] : [af.leg]) {
      if (leg.from.ident === ident && leg.tOff > sim - past && leg.std < sim + ahead) departures.push(row(af, leg, true));
      const arrivesHere = (!leg.canceled && leg.to.ident === ident) || leg.divertedFrom?.ident === ident || leg.canceledTo?.ident === ident;
      if (arrivesHere && leg.tOn > sim - past && leg.sta < sim + ahead) arrivals.push(row(af, leg, false));
    }
  }
  arrivals.sort((a, b) => a.scheduled - b.scheduled);
  departures.sort((a, b) => a.scheduled - b.scheduled);
  return { arrivals, departures };
}

/** Simulated runway in use at an airport (landing direction) and why. */
export function simRunwayInUse(ident: string): { runway: string; basis: 'simulated' | 'metar'; wind?: string } | undefined {
  const a = world?.airports.get(ident);
  if (!a) return undefined;
  const out: { runway: string; basis: 'simulated' | 'metar'; wind?: string } = { runway: a.inUse.ident, basis: a.inUseBasis };
  const w = a.weather;
  if (w?.windDir !== undefined && w.windKt !== undefined) out.wind = `${String(Math.round(w.windDir)).padStart(3, '0')}° ${w.windKt} kt${w.gustKt ? ` G${w.gustKt}` : ''}`;
  return out;
}

/** Route geometry for the selected simulated flight: origin, destination and the path still to fly. */
export function simRoute(id: string | null | undefined): { from: SimAirport; to: SimAirport; ahead: [number, number][]; divertedFrom?: SimAirport } | undefined {
  const af = id ? byId.get(id) : undefined;
  if (!af || !world) return undefined;
  const sim = simNow();
  if (sim < af.leg.tOff || sim >= af.leg.tOn) return undefined;
  const out: { from: SimAirport; to: SimAirport; ahead: [number, number][]; divertedFrom?: SimAirport } = { from: af.leg.from, to: af.leg.to, ahead: world.plannedPath(af, sim) };
  if (af.leg.divertedFrom) out.divertedFrom = af.leg.divertedFrom;
  return out;
}

/** The simulated flight's planned vertical profile from now to landing (for the 3D-path profile). */
export function simPlannedProfile(id: string | null | undefined): { lat: number; lon: number; alt: number }[] | undefined {
  const af = id ? byId.get(id) : undefined;
  if (!af || !world) return undefined;
  const sim = simNow();
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

type StandData = Parameters<World['setStands']>[0];
let standsPromise: Promise<StandData> | null = null;
function loadStands() {
  standsPromise ??= fetch('/data/ground/stands.json')
    .then((r) => (r.ok ? (r.json() as Promise<{ stands?: StandData; airports?: StandData }>) : ({} as { stands?: StandData; airports?: StandData })))
    .then((j) => j.airports ?? j.stands ?? {})
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
      const w: Parameters<World['setWeather']>[1] = { observedAt: m.observedAt };
      if (m.flightCategory) w.category = m.flightCategory;
      if (m.windDirDeg !== undefined) w.windDir = m.windDirDeg;
      if (m.windSpeedKt !== undefined) w.windKt = m.windSpeedKt;
      if (m.windGustKt !== undefined) w.gustKt = m.windGustKt;
      const vis = m.visibility ? Number.parseFloat(m.visibility) : NaN;
      if (Number.isFinite(vis)) w.visSm = vis;
      if (m.tempC !== undefined) w.tempC = m.tempC;
      if (m.weather) w.wx = m.weather;
      if (m.altimeterHpa !== undefined) w.qnh = m.altimeterHpa;
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
    if (!useSim.getState().active) return;
    await applyMetars(top.slice(i, i + 10));
    await new Promise((r) => setTimeout(r, 2000)); // stay well inside the weather API pacing
  }
  // Forecasts (TAF) for the busiest hubs: slots further ahead follow the forecast weather.
  for (let i = 0; i < Math.min(top.length, 30); i += 10) {
    if (!useSim.getState().active) return;
    await applyTafs(top.slice(i, i + 10));
    await new Promise((r) => setTimeout(r, 2000));
  }
}

type TafLib = typeof import('@/lib/tafImpact');
const tafFetched = new Map<string, number>();
async function applyTafs(ids: string[]) {
  const want = ids.filter((id) => /^[A-Z]{4}$/.test(id) && Date.now() - (tafFetched.get(id) ?? 0) > 60 * 60_000);
  if (!want.length || !world) return;
  for (const id of want) tafFetched.set(id, Date.now());
  try {
    const [r, lib] = await Promise.all([api.taf(want), import('@/lib/tafImpact')]);
    for (const taf of r.data) applyForecast(taf, lib);
  } catch {
    /* forecasts are optional */
  }
}

/** Feeds a decoded TAF into the simulation (also called when an airport panel loads one). */
export function applyForecast(taf: Parameters<TafLib['hourlyForecast']>[0], lib: TafLib) {
  const a = world?.airports.get(taf.station);
  if (!a || !world) return;
  const hours = lib.hourlyForecast(taf, { from: Math.floor(simNow() / 3_600_000) * 3_600_000, hours: 30, runwayHeadings: a.runways.map((r) => r.hdg) });
  world.setForecast(taf.station, hours.map((h) => ({ t: h.t, capacity: h.capacity })));
}

const groundLoaded = new Set<string>();
let lastView = 0;

/**
 * Called when the map view settles. Loads real weather for large airports in view and,
 * when zoomed in on an airport, its OpenStreetMap taxiway network.
 */
export function simViewChanged(view: { lat: number; lon: number; zoom: number; bounds: [number, number, number, number] }) {
  lastBounds = view.bounds;
  if (!world || !useSim.getState().active) return;
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
  if (best) void loadGround(best.ident);
}

export interface GroundData {
  nodes: [number, number][];
  edges: [number, number, number?][];
  names?: string[];
  holds?: [number, number, string][];
  terminals?: { name: string; lat: number; lon: number; ring: [number, number][] }[];
}
const groundData = new Map<string, Promise<GroundData | null>>();

/** OpenStreetMap ground data for an airport: taxiways with names, holding points and terminals. */
export function loadGround(ident: string): Promise<GroundData | null> {
  const hit = groundData.get(ident);
  if (hit) return hit;
  if (!world?.airports.get(ident)?.stands) return Promise.resolve(null);
  const p = fetch(`/data/ground/${ident}.json`)
    .then((r) => (r.ok ? (r.json() as Promise<GroundData>) : null))
    .then((j) => {
      if (!j || !world) return j;
      groundLoaded.add(ident);
      const adj: number[][] = j.nodes.map(() => []);
      const edgeNames = new Map<string, string>();
      for (const [x, y, nm] of j.edges) {
        adj[x]!.push(y);
        adj[y]!.push(x);
        if (nm !== undefined && nm >= 0 && j.names?.[nm]) edgeNames.set(x < y ? `${x}-${y}` : `${y}-${x}`, j.names[nm]!);
      }
      const g: TaxiGraph = { nodes: j.nodes, adj, edgeNames, holds: (j.holds ?? []).map(([la, lo, ref]) => ({ pt: [la, lo] as [number, number], ref })) };
      world.setTaxiGraph(ident, g, simNow());
      return j;
    })
    .catch(() => {
      groundData.delete(ident);
      return null;
    });
  groundData.set(ident, p);
  return p;
}

/** Hourly simulated movements at an airport over the last `hours` and the next few. */
export function simMovementsByHour(ident: string, hours = 6): { t: number; arrivals: number; departures: number }[] | undefined {
  const b = simBoard(ident, { pastMin: hours * 60, aheadMin: 120 });
  if (!b) return undefined;
  const sim = simNow();
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
export function simSearch(q: string, limit = 8): { id: string; label: string; sub: string }[] {
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

/** Headline numbers about the simulated world (About panel, widgets). */
export function simStats() {
  const s = useSim.getState();
  if (!world) return { airborne: s.airborne, ground: s.ground, airframes: 0, airlines: 0, airports: 0, groundAirports: 0, metarAirports: 0, holding: 0, diverted: 0 };
  const sim = simNow();
  const airlines = new Set<string>();
  const airports = new Set<string>();
  let holding = 0;
  let diverted = 0;
  for (const af of world.airframes) {
    if (af.airline) airlines.add(af.airline.icao);
    airports.add(af.leg.from.ident);
    airports.add(af.leg.to.ident);
    if (world.state(af, sim).phase === 'holding') holding++;
    if (af.leg.divertedFrom || af.prev?.divertedFrom) diverted++;
  }
  let groundAirports = 0;
  let metarAirports = 0;
  for (const a of world.airports.values()) {
    if (a.stands?.length) groundAirports++;
    if (a.weather) metarAirports++;
  }
  return { airborne: s.airborne, ground: s.ground, airframes: world.airframes.length, airlines: airlines.size, airports: airports.size, groundAirports, metarAirports, holding, diverted };
}

// ---------------------------------------------------------------- airlines

export interface AirlineFlightRow {
  id: string;
  flight: string;
  flightIata?: string;
  from: SimAirport;
  to: SimAirport;
  type: string;
  reg: string;
  status: FlightStatus;
  progress: number;
  transmitting: boolean;
}

export interface AirlineInfo {
  profile: Pick<AirlineProfile, 'icao' | 'iata' | 'name' | 'country' | 'hubs'>;
  hubs: SimAirport[];
  fleet: { type: string; desc: string; count: number }[];
  airframes: number;
  flights: AirlineFlightRow[];
}

/** An airline's simulated fleet and its flights right now. */
export function simAirline(icao: string | null | undefined): AirlineInfo | undefined {
  if (!world || !icao) return undefined;
  const sim = simNow();
  const own = world.airframes.filter((af) => af.airline?.icao === icao);
  if (!own.length) return undefined;
  const al = own[0]!.airline!;
  const fleet = new Map<string, { type: string; desc: string; count: number }>();
  const flights: AirlineFlightRow[] = [];
  for (const af of own) {
    const f = fleet.get(af.type.code) ?? { type: af.type.code, desc: af.type.desc, count: 0 };
    f.count++;
    fleet.set(af.type.code, f);
    const info = legInfo(af, af.leg, sim);
    const row: AirlineFlightRow = {
      id: `~${af.hex}`,
      flight: af.leg.flight,
      from: af.leg.from,
      to: af.leg.to,
      type: af.type.code,
      reg: af.reg,
      status: info.status,
      progress: info.progress,
      transmitting: world.state(af, sim).emit,
    };
    if (af.leg.flightIata) row.flightIata = af.leg.flightIata;
    flights.push(row);
  }
  const order: Record<string, number> = { 'En route': 0, Holding: 0, Approach: 0, Diverted: 0, Taxiing: 1, Landed: 1, Boarding: 2, Delayed: 2, Scheduled: 3, Arrived: 4, Departed: 0 };
  flights.sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5) || a.flight.localeCompare(b.flight));
  return {
    profile: { icao: al.icao, iata: al.iata, name: al.name, country: al.country, hubs: al.hubs },
    hubs: al.hubs.map((h) => world!.airports.get(h)).filter((a): a is SimAirport => !!a),
    fleet: [...fleet.values()].sort((a, b) => b.count - a.count),
    airframes: own.length,
    flights,
  };
}

/** Airlines matching a name / code query (search). */
export function simAirlineSearch(q: string, limit = 5): { icao: string; iata: string; name: string; airframes: number }[] {
  if (!world) return [];
  const n = q.trim().toLowerCase();
  if (n.length < 2) return [];
  const seen = new Map<string, { icao: string; iata: string; name: string; airframes: number }>();
  for (const af of world.airframes) {
    const al = af.airline;
    if (!al) continue;
    const hit = seen.get(al.icao);
    if (hit) {
      hit.airframes++;
      continue;
    }
    if (al.name.toLowerCase().includes(n) || al.icao.toLowerCase() === n || al.iata.toLowerCase() === n) seen.set(al.icao, { icao: al.icao, iata: al.iata, name: al.name, airframes: 1 });
  }
  return [...seen.values()].sort((a, b) => Number(b.name.toLowerCase().startsWith(n)) - Number(a.name.toLowerCase().startsWith(n)) || b.airframes - a.airframes).slice(0, limit);
}

// ---------------------------------------------------------------- widgets

export interface AirportActivity {
  airport: SimAirport;
  movements: number; // arrivals + departures in the last hour
  arrivals: number;
  departures: number;
  avgDelayMin: number;
  holding: number;
  diverted: number;
  canceled: number;
  /** 0 (smooth) … 5 (severe), like a disruption index. */
  disruption: number;
}

export interface NotableFlight {
  id: string;
  flight: string;
  from: SimAirport;
  to: SimAirport;
  type: string;
  value: number;
}

/** Busiest and most disrupted airports, and notable flights, over the last simulated hour. */
export function simWidgets(): { airports: AirportActivity[]; longest: NotableFlight[]; fastest: NotableFlight[]; highest: NotableFlight[] } | undefined {
  if (!world) return undefined;
  const sim = simNow();
  const H = 3_600_000;
  const acts = new Map<string, AirportActivity & { delaySum: number; delayN: number }>();
  const get = (a: SimAirport) => {
    let x = acts.get(a.ident);
    if (!x) acts.set(a.ident, (x = { airport: a, movements: 0, arrivals: 0, departures: 0, avgDelayMin: 0, holding: 0, diverted: 0, canceled: 0, disruption: 0, delaySum: 0, delayN: 0 }));
    return x;
  };
  const longest: NotableFlight[] = [];
  const fastest: NotableFlight[] = [];
  const highest: NotableFlight[] = [];
  for (const af of world.airframes) {
    if (!af.airline) continue;
    for (const leg of af.prev ? [af.prev, af.leg] : [af.leg]) {
      if (leg.canceled) {
        if (Math.abs(leg.std - sim) < H) get(leg.from).canceled++;
        continue;
      }
      if (leg.tTakeoff > sim - H && leg.tTakeoff <= sim) {
        const d = get(leg.from);
        d.departures++;
        d.delaySum += Math.max(0, (leg.tOff - leg.std) / 60_000);
        d.delayN++;
      }
      if (leg.tLand > sim - H && leg.tLand <= sim) {
        const a = get(leg.to);
        a.arrivals++;
        a.delaySum += Math.max(0, (leg.tOn - leg.sta) / 60_000);
        a.delayN++;
        if (leg.divertedFrom) get(leg.divertedFrom).diverted++;
      }
    }
    const st = world.state(af, sim);
    if (st.phase === 'holding') get(af.leg.to).holding++;
    if (!st.onGround && st.emit && st.alt !== undefined) {
      const base = { id: `~${af.hex}`, flight: af.leg.flightIata ?? af.leg.flight, from: af.leg.from, to: af.leg.to, type: af.type.code };
      longest.push({ ...base, value: distanceNm(af.leg.from.lat, af.leg.from.lon, af.leg.to.lat, af.leg.to.lon) });
      fastest.push({ ...base, value: st.gs });
      highest.push({ ...base, value: st.alt });
    }
  }
  const airports = [...acts.values()].map((x) => {
    const avg = x.delayN ? x.delaySum / x.delayN : 0;
    const volume = x.arrivals + x.departures + x.canceled;
    // Only airports with real volume get an index; ordinary delays count little,
    // holding, diversions and cancellations (as a share of traffic) count a lot.
    const raw = Math.max(0, avg - 10) / 12 + x.holding / 5 + x.diverted * 0.8 + (volume ? (x.canceled / volume) * 12 : 0);
    const disruption = volume >= 8 ? Math.min(5, Math.round(raw * 10) / 10) : 0;
    const out: AirportActivity = {
      airport: x.airport,
      movements: x.arrivals + x.departures,
      arrivals: x.arrivals,
      departures: x.departures,
      avgDelayMin: Math.round(avg),
      holding: x.holding,
      diverted: x.diverted,
      canceled: x.canceled,
      disruption,
    };
    return out;
  });
  const top = (l: NotableFlight[]) => l.sort((a, b) => b.value - a.value).slice(0, 6);
  return { airports, longest: top(longest), fastest: top(fastest), highest: top(highest) };
}

// ---------------------------------------------------------------- airport operations

export interface QueueRow {
  id: string;
  flight: string;
  type: string;
  to: SimAirport;
  runway: string;
  /** Taxiing, holding short, lining up or pushing back. */
  state: 'Push-back' | 'Taxiing' | 'Holding short' | 'Lining up';
  takeoff: number;
}

/** Departures between push-back and take-off, in take-off order. */
export function simDepartureQueue(ident: string): QueueRow[] {
  if (!world) return [];
  const sim = simNow();
  const out: QueueRow[] = [];
  for (const af of world.airframes) {
    const leg = af.leg;
    if (leg.from.ident !== ident || leg.canceled || sim < leg.tOff || sim >= leg.tTakeoff) continue;
    const st = world.state(af, sim);
    if (st.phase === 'parked') continue;
    const seg = leg.segs.find((s) => s.t0 <= sim && s.t1 > sim);
    const lastTaxi = [...leg.segs].reverse().find((s) => s.phase === 'taxi');
    let state: QueueRow['state'] = 'Taxiing';
    if (st.phase === 'pushback') state = 'Push-back';
    else if (seg && seg.phase === 'taxi' && seg.nose !== undefined && seg === lastTaxi) state = 'Lining up';
    else if (seg && seg.phase === 'taxi' && seg.nose !== undefined) state = 'Holding short';
    else if (seg && seg.phase === 'taxi' && seg.b === leg.segs.find((x) => x.phase === 'takeoff')?.a) state = 'Lining up';
    const takeoff = leg.segs.find((s) => s.phase === 'takeoff')?.t0 ?? leg.tTakeoff;
    out.push({ id: `~${af.hex}`, flight: leg.flightIata ?? leg.flight, type: af.type.code, to: leg.to, runway: leg.from.inUse.ident, state, takeoff });
  }
  return out.sort((a, b) => a.takeoff - b.takeoff);
}

export interface StandState {
  lat: number;
  lon: number;
  ref: string;
  occupied: boolean;
  flight?: string;
  id?: string;
}

/** Stands at an airport (OpenStreetMap) and whether an aircraft is parked on each. */
export function simStands(ident: string): StandState[] {
  const a = world?.airports.get(ident);
  if (!world || !a?.stands) return [];
  const sim = simNow();
  const parked = new Map<string, Airframe>();
  for (const af of world.airframes) {
    if (af.leg.from.ident !== ident && af.leg.to.ident !== ident && af.prev?.to.ident !== ident) continue;
    const st = world.state(af, sim);
    if (st.phase !== 'parked') continue;
    parked.set(`${st.lat.toFixed(5)},${st.lon.toFixed(5)}`, af);
  }
  return a.stands.map((s) => {
    const af = parked.get(`${s.lat.toFixed(5)},${s.lon.toFixed(5)}`);
    const out: StandState = { lat: s.lat, lon: s.lon, ref: s.ref ?? '', occupied: !!af };
    if (af) {
      out.flight = af.leg.flightIata ?? af.leg.flight;
      out.id = `~${af.hex}`;
    }
    return out;
  });
}

export interface ServiceVehicle {
  lat: number;
  lon: number;
  kind: 'catering' | 'fuel' | 'stairs' | 'baggage' | 'tug';
  hdg: number;
}

/** Simulated ground-service vehicles around parked aircraft in a bounding box (turnaround). */
export function simServiceVehicles(bounds: [number, number, number, number]): ServiceVehicle[] {
  if (!world) return [];
  const sim = simNow();
  const [w, s, e, n] = bounds;
  const out: ServiceVehicle[] = [];
  for (const af of world.airframes) {
    if (!af.airline) continue;
    const leg = af.leg;
    const st = world.state(af, sim);
    if ((st.phase !== 'parked' && st.phase !== 'pushback') || st.lat < s || st.lat > n || st.lon < w || st.lon > e) continue;
    const at = (dist: number, side: number, kind: ServiceVehicle['kind']) => {
      const p = destination(st.lat, st.lon, st.trk + side, dist);
      out.push({ lat: p[0], lon: p[1], kind, hdg: st.trk });
    };
    if (st.phase === 'pushback') {
      at(0.012, 0, 'tug');
      continue;
    }
    if (sim >= leg.tOff || leg.canceled) continue;
    const start = af.prev && af.prev.tOn <= sim ? af.prev.tOn : leg.tOff - af.turnMs;
    const f = (sim - start) / Math.max(1, leg.tOff - start);
    if (f > 0.03 && f < 0.9) at(0.012, -60, 'stairs');
    if (f > 0.03 && f < 0.85) at(0.02, 150, 'baggage');
    if (f > 0.22 && f < 0.42) at(0.018, 70, 'catering');
    if (f > 0.32 && f < 0.6) at(0.016, 115, 'fuel');
  }
  return out.slice(0, 600);
}

/** The airport with OpenStreetMap stands nearest a point (within `maxNm`). */
export function simNearestGroundAirport(lat: number, lon: number, maxNm = 4): string | undefined {
  if (!world) return undefined;
  let best: string | undefined;
  let bd = maxNm;
  for (const a of world.airports.values()) {
    if (!a.stands?.length || Math.abs(a.lat - lat) > 0.2) continue;
    const d = distanceNm(lat, lon, a.lat, a.lon);
    if (d < bd) {
      bd = d;
      best = a.ident;
    }
  }
  return best;
}

// ---------------------------------------------------------------- flight details (radio, load, history)

/** Loads OpenStreetMap taxiways for both ends of a flight (names in the taxi clearances). */
export function simPrepareFlight(id: string | null | undefined) {
  const af = id ? byId.get(id) : undefined;
  if (!af) return;
  for (const a of [af.leg.from, af.leg.to]) if (a.stands) void loadGround(a.ident);
}

let countryGrid: Map<string, string> | null = null;
/** Country under a point (nearest airport within ~200 NM), or undefined over the ocean. */
function countryAt(lat: number, lon: number): string | undefined {
  if (!world) return undefined;
  if (!countryGrid) {
    countryGrid = new Map();
    for (const a of world.airports.values()) countryGrid.set(`${Math.round(a.lat)},${Math.round(a.lon)}`, a.country);
  }
  for (let r = 0; r <= 3; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const c = countryGrid.get(`${Math.round(lat) + dy},${Math.round(lon) + dx}`);
        if (c) return c;
      }
    }
  }
  return undefined;
}

const LEG_KIND_LABEL: Record<LegKind, string> = {
  scheduled: 'Scheduled passenger flight',
  cargo: 'Cargo flight',
  positioning: 'Positioning flight · no passengers',
  delivery: 'Delivery flight from the factory',
  ga: 'General aviation',
  circuits: 'Circuit training (touch-and-go)',
  bizjet: 'Business aviation',
  military: 'Military transport',
  tanker: 'Air-to-air refuelling',
  awacs: 'Airborne early warning',
  patrol: 'Maritime patrol',
  training: 'Military training sortie',
  ambulance: 'Air ambulance transfer',
  hems: 'Air ambulance (HEMS)',
  offshore: 'Offshore helicopter shuttle',
  shuttle: 'Helicopter shuttle',
  glider: 'Glider (FLARM)',
  tow: 'Glider tow',
};
export const legKindLabel = (k: LegKind) => LEG_KIND_LABEL[k];

const titleCase = (s: string) => s.toLowerCase().replace(/\b(\w)/g, (c) => c.toUpperCase());

/** Simulated radio transcript of the flight being shown. */
export async function simRadio(id: string | null | undefined, fmtTime: (t: number) => string): Promise<{ lines: import('./sim/radio').RadioLine[]; now: number } | undefined> {
  const af = id ? byId.get(id) : undefined;
  if (!af || !world) return undefined;
  const [freqs, radio, info] = await Promise.all([loadFrequencies(), import('./sim/radio'), import('./sim/airlineInfo')]);
  if (!world) return undefined;
  const sim = simNow();
  const leg = sim < af.leg.tOff && af.prev && sim - af.prev.tOn < 15 * 60_000 ? af.prev : af.leg;
  let callsign: string;
  if (af.airline) callsign = `${titleCase(info.telephonyOf(af.airline.icao, af.airline.name))} ${leg.flight.slice(af.airline.icao.length)}`;
  else if (af.op) callsign = `${titleCase(af.op.tel)} ${leg.flight.replace(/^[A-Z]+/, '')}`.trim();
  else callsign = af.reg;
  const lines = radio.transcript({
    leg,
    callsign,
    wake: leg.wake,
    freq: (ident, kind) => freqs[ident]?.[kind]?.[0],
    countryAt,
    squawk: af.squawk,
    typeName: af.type.desc,
    fmtTime,
    ga: af.role === 'ga',
  });
  return { lines, now: sim };
}

export interface FlightLoad {
  sheet: import('./sim/loadsheet').LoadSheet;
  model: string;
}

/** Estimated passengers, cabin, fuel and weights for the flight (simulated). */
export async function simLoad(id: string | null | undefined): Promise<FlightLoad | undefined> {
  const af = id ? byId.get(id) : undefined;
  if (!af || !world) return undefined;
  const [{ specOf }, { loadSheet }, { AIRLINE_EXTRA }, sched] = await Promise.all([import('./sim/typeSpecs'), import('./sim/loadsheet'), import('./sim/airlineInfo'), import('./sim/schedule')]);
  const spec = specOf(af.type.code);
  if (!spec) return undefined;
  const sim = simNow();
  const leg = sim < af.leg.tOff && af.prev && sim - af.prev.tOn < 15 * 60_000 ? af.prev : af.leg;
  const extra = af.airline ? AIRLINE_EXTRA[af.airline.icao] : undefined;
  const model = extra?.model ?? (af.role === 'airline' ? 'full' : af.type.cls === 'bizjet' ? 'bizjet' : 'charter');
  const airborneH = Math.max(0.2, (leg.tLand - leg.tTakeoff) / 3_600_000);
  const taxiMin = Math.max(4, (leg.tTakeoff - leg.tOff + (leg.tOn - leg.tLand)) / 60_000);
  const leisure = sched.leisureOf(leg.to.ident, leg.to.lat, leg.to.lon);
  const longHaul = distanceNm(leg.from.lat, leg.from.lon, leg.to.lat, leg.to.lon) > 2500;
  const lf = af.role === 'airline' ? sched.loadFactor({ model, flight: leg.flight, std: leg.std, fromLon: leg.from.lon, leisure, longHaul }) : af.role === 'ga' ? 0.5 : 0.3;
  const o: Parameters<typeof loadSheet>[0] = { spec, model, lf, seed: Number.parseInt(af.hex, 16) + Math.floor(leg.std / 86_400_000), airborneH, taxiMin, positioning: leg.kind === 'positioning' || leg.kind === 'delivery' };
  if (extra?.first !== undefined && longHaul) o.first = extra.first;
  if (extra?.premEco !== undefined) o.premEco = extra.premEco && longHaul;
  if (sim > leg.tTakeoff) o.elapsedH = Math.min(airborneH, (sim - leg.tTakeoff) / 3_600_000);
  return { sheet: loadSheet(o), model };
}

export interface HistoryRow {
  flight: string;
  flightIata?: string;
  kind: LegKind;
  from: SimAirport;
  to: SimAirport;
  std: number;
  sta: number;
  atd: number;
  ata: number;
  status: 'Landed' | 'Diverted' | 'Canceled' | 'Emergency';
  delayMin: number;
}

/** The airframe's previous flights, newest first. */
export function simHistory(id: string | null | undefined): { reg: string; type: string; rows: HistoryRow[] } | undefined {
  const af = id ? byId.get(id) : undefined;
  if (!af || !world) return undefined;
  world.ensureHistory(af);
  const rows: HistoryRow[] = af.history.map((h) => {
    const r: HistoryRow = {
      flight: h.flight,
      kind: h.kind,
      from: h.from,
      to: h.to,
      std: h.std,
      sta: h.sta,
      atd: h.tOff,
      ata: h.tOn,
      status: h.canceled ? 'Canceled' : h.emergency ? 'Emergency' : h.divertedFrom ? 'Diverted' : 'Landed',
      delayMin: Math.round((h.tOn - h.sta) / 60_000),
    };
    if (h.flightIata) r.flightIata = h.flightIata;
    return r;
  });
  return { reg: af.reg, type: af.type.code, rows };
}

// ---------------------------------------------------------------- aircraft types

export interface TypeStats {
  code: string;
  airframes: number;
  airborne: number;
  operators: { icao: string; name: string; count: number; airline: boolean }[];
  flights: { id: string; flight: string; from: SimAirport; to: SimAirport; status: FlightStatus; reg: string }[];
}

/** How a type is used in the simulated world right now. */
export function simTypeStats(code: string): TypeStats | undefined {
  if (!world) return undefined;
  const sim = simNow();
  const ops = new Map<string, { icao: string; name: string; count: number; airline: boolean }>();
  const flights: TypeStats['flights'] = [];
  let airframes = 0;
  let airborne = 0;
  for (const af of world.airframes) {
    if (af.type.code !== code) continue;
    airframes++;
    const st = world.state(af, sim);
    if (!st.onGround && st.emit) airborne++;
    const key = af.airline?.icao ?? af.op?.icao ?? 'GA';
    const name = af.airline?.name ?? af.op?.name ?? 'Private owners';
    const o = ops.get(key) ?? { icao: key, name, count: 0, airline: !!af.airline };
    o.count++;
    ops.set(key, o);
    if (st.emit && flights.length < 60) flights.push({ id: `~${af.hex}`, flight: af.leg.flightIata ?? af.leg.flight, from: af.leg.from, to: af.leg.to, status: legInfo(af, af.leg, sim).status, reg: af.reg });
  }
  return { code, airframes, airborne, operators: [...ops.values()].sort((a, b) => b.count - a.count), flights };
}

// ---------------------------------------------------------------- airport statistics

export interface DayStats {
  day: number; // UTC day start
  movements: number;
  onTimePct: number; // departures within 15 min of schedule
  avgDelayMin: number;
  canceled: number;
  diverted: number;
  weather: 'fine' | 'rain' | 'storms' | 'fog' | 'snow' | 'wind';
  /** 'model' for days before the simulation started, 'sim' for today (from the running world). */
  source: 'model' | 'sim';
}

function weatherWord(a: SimAirport): DayStats['weather'] {
  const w = a.weather;
  if (!w) return 'fine';
  if (w.wx && /TS/.test(w.wx)) return 'storms';
  if (w.wx && /SN/.test(w.wx)) return 'snow';
  if ((w.visSm ?? 10) < 1 || (w.wx && /FG/.test(w.wx))) return 'fog';
  if ((w.gustKt ?? 0) >= 30) return 'wind';
  if (w.wx && /RA|DZ/.test(w.wx)) return 'rain';
  return 'fine';
}

/**
 * Seven days of punctuality at an airport. Today comes from the running simulation;
 * earlier days are modelled from today's traffic, the weekday pattern and a plausible
 * climate-driven weather day (and are labelled as modelled).
 */
export function simAirportHistory(ident: string): DayStats[] | undefined {
  const a = world?.airports.get(ident);
  if (!world || !a) return undefined;
  const sim = simNow();
  const day0 = Math.floor(sim / 86_400_000) * 86_400_000;
  const b = simBoard(ident, { pastMin: 24 * 60, aheadMin: 0 });
  const rows = [...(b?.departures ?? []), ...(b?.arrivals ?? [])].filter((r) => r.scheduled >= day0 && r.scheduled <= sim);
  const deps = (b?.departures ?? []).filter((r) => r.scheduled >= day0 && r.scheduled <= sim);
  const recent = simMovementsByHour(ident, 6) ?? [];
  const perHour = recent.slice(0, 6).reduce((s, h) => s + h.arrivals + h.departures, 0) / 6;
  const daily = Math.max(rows.length, Math.round(perHour * 18.5));
  const delayOf = (r: BoardRow) => Math.max(0, r.delayMin);
  const today: DayStats = {
    day: day0,
    movements: rows.length,
    onTimePct: deps.length ? Math.round((100 * deps.filter((r) => delayOf(r) <= 15 && r.status !== 'Canceled').length) / deps.length) : 0,
    avgDelayMin: deps.length ? Math.round(deps.reduce((s, r) => s + delayOf(r), 0) / deps.length) : 0,
    canceled: rows.filter((r) => r.status === 'Canceled').length,
    diverted: rows.filter((r) => r.status === 'Diverted').length,
    weather: weatherWord(a),
    source: 'sim',
  };
  const out: DayStats[] = [];
  const month = new Date(sim).getUTCMonth();
  for (let k = 6; k >= 1; k--) {
    const d = day0 - k * 86_400_000;
    let h = 0x811c9dc5;
    for (const c of `${ident}${d}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0;
    const r = () => {
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
      return (h % 10_000) / 10_000;
    };
    const wd = new Date(d + (a.lon / 15) * 3_600_000).getUTCDay();
    const vol = [0.97, 1, 0.92, 0.94, 1, 1.05, 0.88][wd]!;
    // Climate: summer thunderstorms in the mid-latitudes; fog in the cool season; snow only
    // in mid-winter away from the subtropics (or in the shoulder months far north).
    const mm = a.lat >= 0 ? month : (month + 6) % 12; // the same season in either hemisphere
    const summer = mm >= 5 && mm <= 8;
    const cool = mm >= 9 || mm <= 2;
    const lat = Math.abs(a.lat);
    const snowy = (lat > 45 && (mm === 11 || mm <= 1)) || (lat > 55 && (mm === 10 || mm === 2)) || (lat > 38 && mm === 0 && a.elev > 2000);
    const roll = r();
    const weather: DayStats['weather'] =
      snowy && roll < 0.14 ? 'snow' : cool && lat > 30 && roll < 0.22 ? 'fog' : summer && lat < 48 && roll < 0.25 ? 'storms' : roll < 0.45 ? 'rain' : roll < 0.52 ? 'wind' : 'fine';
    const wxDelay = { fine: 0, rain: 3, wind: 6, fog: 14, storms: 22, snow: 28 }[weather];
    const congestion = Math.min(1.4, daily / (a.large ? 900 : 250));
    const avg = Math.max(2, Math.round(4 + congestion * 8 + wxDelay * (0.6 + r() * 0.8) + (wd === 5 ? 3 : 0) + r() * 4));
    const movements = Math.round(daily * vol * (0.95 + r() * 0.1) * (weather === 'snow' ? 0.9 : 1));
    out.push({
      day: d,
      movements,
      onTimePct: Math.max(35, Math.min(97, Math.round(96 - avg * 1.55 - r() * 4))),
      avgDelayMin: avg,
      canceled: Math.round(movements * (weather === 'snow' ? 0.06 : weather === 'storms' ? 0.025 : weather === 'fog' ? 0.015 : 0.004) * (0.5 + r())),
      diverted: movements ? Math.min(Math.round(movements * 0.02), Math.round((weather === 'storms' || weather === 'fog' ? 3 : 0.3) * r() * (a.large ? 2 : 1))) : 0,
      weather,
      source: 'model',
    });
  }
  out.push(today);
  return out;
}

// ---------------------------------------------------------------- oceanic tracks

export interface NatTrackView {
  letter: string;
  eastbound: boolean;
  pts: [number, number][];
  text: string;
  from: number;
  to: number;
  flights: number;
}

/** The day's simulated North Atlantic tracks (valid now or soon) and how many flights are on each. */
export function simNatTracks(): NatTrackView[] {
  if (!world) return [];
  const sim = simNow();
  const count = new Map<string, number>();
  for (const af of world.airframes) {
    const nat = af.leg.route?.nat;
    if (nat && sim >= af.leg.tTakeoff && sim < af.leg.tLand) count.set(nat.letter, (count.get(nat.letter) ?? 0) + 1);
  }
  const lons = [-20, -30, -40, -50];
  const seen = new Set<string>();
  return [...world.natTracks(sim - 86_400_000), ...world.natTracks(sim)]
    .filter((t) => sim < t.to + 3 * 3_600_000 && sim > t.from - 6 * 3_600_000)
    .filter((t) => {
      const k = `${t.letter}${t.from}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((t) => ({ letter: t.letter, eastbound: t.eastbound, pts: t.lats.map((la, i) => [la, lons[i]!] as [number, number]), text: t.lats.map((la, i) => `${la}/${-lons[i]!}`).join(' '), from: t.from, to: t.to, flights: count.get(t.letter) ?? 0 }));
}

/** Ground elevation (ft) under a simulated aircraft on the ground: its departure or arrival field. */
export function simElevationFt(id: string): number | undefined {
  const af = byId.get(id);
  if (!af || !world) return undefined;
  const sim = simNow();
  const leg = af.leg;
  const at = sim < leg.tTakeoff ? leg.from : leg.to;
  return at.elev;
}
