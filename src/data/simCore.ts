// Simulation core: owns the simulated World and answers every question about it.
// It runs inside a Web Worker (src/data/sim.worker.ts), so building the world and
// advancing it never blocks the page; src/data/world.ts is the page-side facade.
//
// Honesty rules:
//  • every aircraft is marked as simulated (provider "sim", non-ICAO "~" addresses,
//    so no real-aircraft record or photo is ever attached to an invented flight);
//  • flights, registrations, schedules and positions are invented and the UI says
//    "Simulated" wherever a reader could mistake them for real tracking data.

import type { AirportIndexEntry } from '@shared/types';
import { destination, distanceNm } from '@shared/geo';
import { loadMajorAirports } from './airports';
import type { AirlineProfile } from './sim/fleet';
import type { Airframe, World, Leg, LegKind, Phase, SimAirport, TaxiGraph, TaxiInfo, RouteInfo, Emergency } from './sim/engine';
import type { RouteDays } from './sim/schedule';
import { legKindLabel } from './sim/labels';

export { legKindLabel };

let world: World | null = null;
let byId = new Map<string, Airframe>();
let runwaysPromise: Promise<Record<string, never[]>> | null = null;
let counts = { airborne: 0, ground: 0 };

/** Simulated time of the request being answered (the page owns the clock). */
let NOW = 0;
export const simNow = () => NOW;
export function setNow(t: number) {
  NOW = t;
}

function loadRunways() {
  runwaysPromise ??= fetch('/data/airports/runways-major.json')
    .then((r) => (r.ok ? (r.json() as Promise<{ runways: Record<string, never[]> }>) : { runways: {} }))
    .then((j) => j.runways)
    .catch(() => ({}));
  return runwaysPromise;
}

// ---------------------------------------------------------------- start-up

/** Builds the world. Returns the busiest hubs (for real weather) or null when data is missing. */
export async function coreInit(o: { now: number; seed: number; scale: number }): Promise<{ hubs: string[]; airframes: number } | null> {
  NOW = o.now;
  let airports: AirportIndexEntry[] = [];
  let runways: Record<string, never[]> = {};
  let Sim: typeof import('./sim/engine') | null = null;
  let navaids: NavRow[] = [];
  let stands: StandData = {};
  try {
    [airports, runways, Sim, navaids, stands] = await Promise.all([loadMajorAirports(), loadRunways(), import('./sim/engine'), loadSimData<NavRow[]>('navaids'), loadStands()]);
  } catch {
    /* handled below */
  }
  if (!airports.length || !Sim) return null;
  world = new Sim.World(o.seed, airports, runways);
  ALLIANCES = Sim.ALL_ALLIANCES;
  if (navaids.length) world.setNavaids(navaids);
  world.setStands(stands);
  world.populate(o.now, o.scale);
  byId = new Map(world.airframes.map((af) => [`~${af.hex}`, af]));
  const count = new Map<string, number>();
  for (const af of world.airframes) if (af.airline) count.set(af.leg.to.ident, (count.get(af.leg.to.ident) ?? 0) + 1);
  const hubs = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([id]) => id);
  return { hubs, airframes: world.airframes.length };
}

type NavRow = [string, string, number, number, number, number, string];
type HeliRow = [string, string, number, number, string, number, number | null];
type GlideRow = [string, string, number, number, string, number | null];

/** Helicopter (air ambulance, offshore, shuttle) and gliding traffic, plus published US procedures. */
export async function coreLoadExtra(scale: number) {
  const [heli, gliding, procs] = await Promise.all([
    loadSimData<HeliRow[]>('heliports'),
    loadSimData<GlideRow[]>('gliding'),
    fetch('/data/sim/procedures-us.json')
      .then((r) => (r.ok ? (r.json() as Promise<import('./sim/usProcedures').ProceduresData>) : null))
      .catch(() => null),
  ]);
  if (!world) return;
  if (procs) world.setUsProcedures(procs);
  world.populateExtra(NOW, scale, heli, gliding);
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
function loadFrequencies(): Promise<FreqTable> {
  freqPromise ??= fetch('/data/sim/frequencies.json')
    .then((r) => (r.ok ? (r.json() as Promise<{ airports: FreqTable }>) : { airports: {} }))
    .then((j) => j.airports)
    .catch(() => ({}));
  return freqPromise;
}

// ---------------------------------------------------------------- ticks

/** Aircraft fields that change rarely (sent only when they change). */
export interface AircraftMeta {
  i: number;
  id: string;
  callsign: string;
  registration: string;
  aircraftType: string;
  typeDescription: string;
  category: string;
  squawk: string;
  military: boolean;
  flarm: boolean;
  owner?: string;
  route: [string, string, string];
}

/** One tick of the whole world, packed into typed arrays (transferred, not copied). */
export interface TickPacket {
  n: number;
  emit: Uint8Array;
  ground: Uint8Array;
  lat: Float64Array;
  lon: Float64Array;
  alt: Float32Array; // NaN on the ground
  gs: Float32Array;
  trk: Float32Array;
  vr: Float32Array;
  mcp: Float32Array; // selected altitude, NaN when none
  wdir: Float32Array; // NaN when none
  wspd: Float32Array;
  tas: Float32Array; // NaN below FL240
  mach: Float32Array;
  oat: Float32Array;
  meta: AircraftMeta[];
  airborne: number;
  onGround: number;
  alerts: EmergencyAlert[];
}

export interface EmergencyAlert {
  id: string;
  kind: Emergency['kind'];
  flight: string;
  from: string;
  to: string;
  divertTo: string;
}

const metaSig: string[] = [];
const alerted = new Set<string>();

/** Advances the world to `sim` and packs every transmitting aircraft. */
export function coreTick(sim: number): { packet: TickPacket; transfer: ArrayBuffer[] } | null {
  if (!world) return null;
  NOW = sim;
  world.advance(sim);
  const n = world.airframes.length;
  const f64 = () => new Float64Array(n);
  const f32 = () => new Float32Array(n).fill(Number.NaN);
  const p: TickPacket = {
    n,
    emit: new Uint8Array(n),
    ground: new Uint8Array(n),
    lat: f64(),
    lon: f64(),
    alt: f32(),
    gs: f32(),
    trk: f32(),
    vr: f32(),
    mcp: f32(),
    wdir: f32(),
    wspd: f32(),
    tas: f32(),
    mach: f32(),
    oat: f32(),
    meta: [],
    airborne: 0,
    onGround: 0,
    alerts: [],
  };
  for (let i = 0; i < n; i++) {
    const af = world.airframes[i]!;
    const s = world.state(af, sim);
    if (!s.emit) continue;
    const leg = af.leg;
    p.emit[i] = 1;
    p.lat[i] = s.lat;
    p.lon[i] = s.lon;
    p.gs[i] = Math.round(s.gs);
    p.trk[i] = Math.round(s.trk * 10) / 10;
    if (s.onGround || s.alt === undefined) {
      p.ground[i] = 1;
      p.onGround++;
    } else {
      p.airborne++;
      p.alt[i] = s.alt;
      p.vr[i] = Math.round(s.vr / 64) * 64;
      if (s.phase === 'climb' || s.phase === 'cruise') p.mcp[i] = leg.cruiseFt;
      else if (s.phase === 'holding') p.mcp[i] = Math.round(s.alt / 1000) * 1000;
      else if (s.phase === 'descent' || s.phase === 'approach') p.mcp[i] = Math.max(3000, Math.round((leg.to.elev + 3000) / 1000) * 1000);
      if (s.wind && s.alt > 5000) {
        p.wdir[i] = Math.round(s.wind.dir);
        p.wspd[i] = Math.round(s.wind.kt);
      }
      if (s.alt > 24000) {
        // TAS → Mach at altitude (ISA): illustrative only.
        const tas = s.wind ? s.gs - s.wind.comp : s.gs;
        const tempK = Math.max(216.65, 288.15 - 0.0019812 * s.alt);
        p.tas[i] = Math.round(tas);
        p.mach[i] = Math.round((tas / (38.967854 * Math.sqrt(tempK))) * 1000) / 1000;
        p.oat[i] = Math.round(tempK - 273.15);
      }
    }
    const to = leg.canceledTo ?? leg.to;
    const squawk = world.squawkAt(af, sim);
    const owner = af.airline?.name ?? af.op?.name;
    const route: [string, string, string] = [leg.flightIata ?? leg.flight, leg.from.iata ?? leg.from.ident, to.iata ?? to.ident];
    const sig = `${leg.flight}|${squawk}|${route.join(',')}|${owner ?? ''}`;
    if (metaSig[i] !== sig) {
      metaSig[i] = sig;
      const m: AircraftMeta = {
        i,
        id: `~${af.hex}`,
        callsign: leg.flight,
        registration: af.reg,
        aircraftType: af.type.code,
        typeDescription: af.type.desc,
        category: af.type.cat,
        squawk,
        military: af.role === 'mil',
        flarm: af.role === 'glider',
        route,
      };
      if (owner) m.owner = owner;
      p.meta.push(m);
    }
    const e = leg.emergency;
    if (e && sim >= e.t && sim <= leg.tLand) {
      const key = `${af.hex}${e.t}`;
      if (!alerted.has(key)) {
        alerted.add(key);
        if (sim - e.t < 10 * 60_000)
          p.alerts.push({ id: `~${af.hex}`, kind: e.kind, flight: leg.flightIata ?? leg.flight, from: leg.from.iata ?? leg.from.ident, to: (leg.divertedFrom ?? leg.to).iata ?? leg.to.ident, divertTo: e.divertTo.name });
      }
    }
  }
  counts = { airborne: p.airborne, ground: p.onGround };
  recordPunctuality(sim);
  const transfer = [p.emit, p.ground, p.lat, p.lon, p.alt, p.gs, p.trk, p.vr, p.mcp, p.wdir, p.wspd, p.tas, p.mach, p.oat].map((a) => a.buffer as ArrayBuffer);
  return { packet: p, transfer };
}

/** Forget what was already sent (the page restarted its traffic engine). */
export function coreResetMeta() {
  metaSig.length = 0;
}

/** Simulated past positions of an aircraft's current leg (for the trail). */
export function simTrail(id: string, full: boolean): { lat: number; lon: number; t: number; gs: number; vr: number; alt?: number }[] | undefined {
  const af = byId.get(id);
  if (!world || !af) return undefined;
  return world.trail(af, NOW, full ? Infinity : 6 * 60_000).map((p) => {
    const tp: { lat: number; lon: number; t: number; gs: number; vr: number; alt?: number } = { lat: p.lat, lon: p.lon, t: p.t, gs: p.gs, vr: p.vr };
    if (p.alt !== undefined) tp.alt = p.alt;
    return tp;
  });
}

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
  crewDelayMin: number;
  /** The aircraft's day: earlier legs, this flight and where it goes next. */
  rotation: { flight: string; from: SimAirport; to: SimAirport; t: number; state: 'done' | 'now' | 'next' }[];
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
    crewDelayMin: Math.round((leg.crewDelayMs ?? 0) / 60_000),
    rotation: [],
  };
  if (af.airline) {
    const done = af.history.filter((h) => h.tOn > leg.tOff - 20 * 3_600_000 && h.tOn <= leg.tOff).slice(0, 3).reverse();
    info.rotation = [
      ...done.map((h) => ({ flight: h.flightIata ?? h.flight, from: h.from, to: h.to, t: h.tOff, state: 'done' as const })),
      { flight: leg.flightIata ?? leg.flight, from: leg.from, to: leg.canceledTo ?? leg.to, t: leg.std, state: 'now' as const },
    ];
    if (leg.plannedNext) info.rotation.push({ flight: '', from: leg.to, to: leg.plannedNext, t: leg.tOn + leg.turnAfter, state: 'next' });
  }
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

/** Real weather (decoded METAR) for an airport. */
export function coreSetWeather(ident: string, w: Parameters<World['setWeather']>[1]) {
  world?.setWeather(ident, w);
}

type TafLib = typeof import('@/lib/tafImpact');
let tafLib: Promise<TafLib> | null = null;
/** Feeds a decoded TAF into the simulation: hourly capacity for future runway slots. */
export async function coreApplyForecast(taf: Parameters<TafLib['hourlyForecast']>[0]) {
  const a = world?.airports.get(taf.station);
  if (!a || !world) return;
  tafLib ??= import('@/lib/tafImpact');
  const lib = await tafLib;
  const hours = lib.hourlyForecast(taf, { from: Math.floor(NOW / 3_600_000) * 3_600_000, hours: 30, runwayHeadings: a.runways.map((r) => r.hdg) });
  world.setForecast(taf.station, hours.map((h) => ({ t: h.t, capacity: h.capacity })));
}

/** When zoomed in near an airport, load its OpenStreetMap taxiway network. */
export function coreViewChanged(view: { lat: number; lon: number; zoom: number }) {
  if (!world || view.zoom < 11) return;
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
      const adj: number[][] = j.nodes.map(() => []);
      const edgeNames = new Map<string, string>();
      for (const [x, y, nm] of j.edges) {
        adj[x]!.push(y);
        adj[y]!.push(x);
        if (nm !== undefined && nm >= 0 && j.names?.[nm]) edgeNames.set(x < y ? `${x}-${y}` : `${y}-${x}`, j.names[nm]!);
      }
      const g: TaxiGraph = { nodes: j.nodes, adj, edgeNames, holds: (j.holds ?? []).map(([la, lo, ref]) => ({ pt: [la, lo] as [number, number], ref })) };
      world.setTaxiGraph(ident, g, NOW);
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
  const s = counts;
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



const titleCase = (s: string) => s.toLowerCase().replace(/\b(\w)/g, (c) => c.toUpperCase());

/** Simulated radio transcript of the flight being shown. */
export async function simRadio(id: string | null | undefined): Promise<{ lines: import('./sim/radio').RadioLine[]; now: number } | undefined> {
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
    fmtTime: (x) => new Date(x).toISOString().slice(11, 16).replace(':', ''),
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

// ---------------------------------------------------------------- airport radio (scanner)

export type ScannerKind = 'del' | 'gnd' | 'twr' | 'app';

export interface ScannerLine {
  t: number;
  who: 'atc' | 'pilot';
  station: string;
  text: string;
  flight: string;
  id: string;
}

/**
 * What an airport's frequency would sound like: every simulated flight's calls to (and
 * from) one facility of the airport, interleaved, over the last `windowMin` minutes.
 */
export async function simAirportRadio(ident: string, kind: ScannerKind, windowMin = 20): Promise<{ station: string; freq?: number; lines: ScannerLine[]; now: number } | undefined> {
  const a = world?.airports.get(ident);
  if (!world || !a) return undefined;
  const [freqs, radio, info] = await Promise.all([loadFrequencies(), import('./sim/radio'), import('./sim/airlineInfo')]);
  if (!world) return undefined;
  const sim = simNow();
  const from = sim - windowMin * 60_000;
  const station = radio.stationName(a, kind === 'app' ? 'app' : kind);
  const alt = kind === 'app' ? radio.stationName(a, 'dep') : '';
  const lines: ScannerLine[] = [];
  for (const af of world.airframes) {
    for (const leg of af.prev ? [af.prev, af.leg] : [af.leg]) {
      if (leg.from !== a && leg.to !== a) continue;
      if (leg.tOn < from || leg.tOff - 30 * 60_000 > sim) continue;
      let callsign: string;
      if (af.airline) callsign = `${titleCase(info.telephonyOf(af.airline.icao, af.airline.name))} ${leg.flight.slice(af.airline.icao.length)}`;
      else if (af.op) callsign = `${titleCase(af.op.tel)} ${leg.flight.replace(/^[A-Z]+/, '')}`.trim();
      else callsign = af.reg;
      const t = radio.transcript({
        leg,
        callsign,
        wake: leg.wake,
        freq: (i, k) => freqs[i]?.[k]?.[0],
        countryAt,
        squawk: af.squawk,
        typeName: af.type.desc,
        fmtTime: (x) => new Date(x).toISOString().slice(11, 16).replace(':', ''),
        ga: af.role === 'ga',
      });
      for (const l of t) {
        if (l.t < from || l.t > sim) continue;
        if (l.station !== station && l.station !== alt) continue;
        lines.push({ t: l.t, who: l.who, station: l.station, text: l.text, flight: leg.flightIata ?? leg.flight, id: `~${af.hex}` });
      }
    }
  }
  lines.sort((x, y) => x.t - y.t);
  const out: { station: string; freq?: number; lines: ScannerLine[]; now: number } = { station, lines: lines.slice(-200), now: sim };
  const f = freqs[ident]?.[kind]?.[0] ?? (kind === 'del' ? freqs[ident]?.gnd?.[0] : undefined);
  if (f) out.freq = f;
  return out;
}

// ---------------------------------------------------------------- punctuality (this session)

interface PunctualityAcc {
  icao: string;
  name: string;
  flights: number;
  onTime: number;
  delaySum: number;
  canceled: number;
  diverted: number;
}
const punctuality = new Map<string, PunctualityAcc>();
const counted = new WeakSet<object>();

/** Records flights that reached their stand (or were cancelled) since the last tick. */
let sessionStart = 0;
function recordPunctuality(sim: number) {
  if (!world) return;
  // Only flights that reach their stand after the site was opened count.
  if (!sessionStart) sessionStart = sim;
  for (const af of world.airframes) {
    const al = af.airline;
    if (!al) continue;
    for (const leg of af.prev ? [af.prev, af.leg] : [af.leg]) {
      if (counted.has(leg) || sim < leg.tOn) continue;
      counted.add(leg);
      if (leg.tOn < sessionStart) continue;
      if (leg.kind !== 'scheduled' && leg.kind !== 'cargo') continue;
      let p = punctuality.get(al.icao);
      if (!p) punctuality.set(al.icao, (p = { icao: al.icao, name: al.name, flights: 0, onTime: 0, delaySum: 0, canceled: 0, diverted: 0 }));
      if (leg.canceled) {
        p.canceled++;
        continue;
      }
      const delay = Math.max(0, (leg.tOn - leg.sta) / 60_000);
      p.flights++;
      if (delay <= 15 && !leg.divertedFrom) p.onTime++;
      p.delaySum += delay;
      if (leg.divertedFrom) p.diverted++;
    }
  }
}

export interface PunctualityRow {
  icao: string;
  name: string;
  flights: number;
  onTimePct: number;
  avgDelayMin: number;
  canceled: number;
  diverted: number;
}

/** Airline arrival punctuality (on stand within 15 minutes) since the site was opened. */
export function simPunctuality(minFlights = 5): PunctualityRow[] {
  return [...punctuality.values()]
    .filter((p) => p.flights >= minFlights)
    .map((p) => ({ icao: p.icao, name: p.name, flights: p.flights, onTimePct: Math.round((100 * p.onTime) / p.flights), avgDelayMin: Math.round(p.delaySum / p.flights), canceled: p.canceled, diverted: p.diverted }))
    .sort((a, b) => b.onTimePct - a.onTimePct || b.flights - a.flights);
}

// ---------------------------------------------------------------- airport summary (comparison)

export interface AirportSummary {
  airport: SimAirport;
  runways: number;
  runwayInUse: string;
  stands: number;
  terminals: string[];
  movementsLastHour: number;
  arrivalsNext2h: number;
  departuresNext2h: number;
  holding: number;
  onTime7d: number;
  avgDelay7d: number;
  canceledToday: number;
  destinations: number;
  topAirlines: { icao: string; name: string; flights: number }[];
  weather?: { category?: string; wind?: string; visSm?: number; tempC?: number; wx?: string };
}

/** Key numbers for one airport, for side-by-side comparison. */
export function simAirportSummary(ident: string): AirportSummary | undefined {
  const a = world?.airports.get(ident);
  if (!world || !a) return undefined;
  const sim = simNow();
  const b = simBoard(ident, { pastMin: 60, aheadMin: 120 });
  const hist = simAirportHistory(ident) ?? [];
  const airlines = new Map<string, { icao: string; name: string; flights: number }>();
  const dests = new Set<string>();
  let holding = 0;
  for (const af of world.airframes) {
    const leg = af.leg;
    if (leg.from !== a && leg.to !== a) continue;
    dests.add(leg.from === a ? leg.to.ident : leg.from.ident);
    if (af.airline) {
      const x = airlines.get(af.airline.icao) ?? { icao: af.airline.icao, name: af.airline.name, flights: 0 };
      x.flights++;
      airlines.set(af.airline.icao, x);
    }
    if (leg.to === a && world.segNow(af, sim)?.phase === 'holding') holding++;
  }
  const rows = [...(b?.arrivals ?? []), ...(b?.departures ?? [])];
  const out: AirportSummary = {
    airport: a,
    runways: Math.max(1, Math.round(a.runways.length / 2)),
    runwayInUse: a.inUse.ident,
    stands: a.stands?.length ?? 0,
    terminals: (a.terminals ?? []).filter((t) => /terminal/i.test(t)),
    movementsLastHour: rows.filter((r) => r.actual !== undefined && r.actual > sim - 3_600_000 && r.actual <= sim).length,
    arrivalsNext2h: (b?.arrivals ?? []).filter((r) => r.estimated > sim && r.estimated <= sim + 7_200_000).length,
    departuresNext2h: (b?.departures ?? []).filter((r) => r.estimated > sim && r.estimated <= sim + 7_200_000).length,
    holding,
    onTime7d: hist.length ? Math.round(hist.reduce((s, d) => s + d.onTimePct, 0) / hist.length) : 0,
    avgDelay7d: hist.length ? Math.round(hist.reduce((s, d) => s + d.avgDelayMin, 0) / hist.length) : 0,
    canceledToday: hist.at(-1)?.canceled ?? 0,
    destinations: dests.size,
    topAirlines: [...airlines.values()].sort((x, y) => y.flights - x.flights).slice(0, 5),
  };
  const w = a.weather;
  if (w) {
    const wx: NonNullable<AirportSummary['weather']> = {};
    if (w.category) wx.category = w.category;
    if (w.windDir !== undefined && w.windKt !== undefined) wx.wind = `${String(Math.round(w.windDir)).padStart(3, '0')}° ${w.windKt} kt${w.gustKt ? ` G${w.gustKt}` : ''}`;
    if (w.visSm !== undefined) wx.visSm = w.visSm;
    if (w.tempC !== undefined) wx.tempC = w.tempC;
    if (w.wx) wx.wx = w.wx;
    out.weather = wx;
  }
  return out;
}

// ---------------------------------------------------------------- route search

export interface RouteHit {
  id: string;
  flight: string;
  airline?: string;
  airlineIcao?: string;
  from: SimAirport;
  to: SimAirport;
  std: number;
  status: FlightStatus;
  type: string;
  reverse: boolean;
}

/** Simulated flights between two sets of airports (both directions; the asked direction first). */
export function simRouteSearch(fromIdents: string[], toIdents: string[], limit = 12): RouteHit[] {
  if (!world || !fromIdents.length || !toIdents.length) return [];
  const sim = simNow();
  const A = new Set(fromIdents);
  const B = new Set(toIdents);
  const out: RouteHit[] = [];
  for (const af of world.airframes) {
    if (!af.airline) continue;
    for (const leg of af.prev && sim - af.prev.tOn < 30 * 60_000 ? [af.prev, af.leg] : [af.leg]) {
      const to = leg.canceledTo ?? leg.divertedFrom ?? leg.to;
      const fwd = A.has(leg.from.ident) && B.has(to.ident);
      const rev = B.has(leg.from.ident) && A.has(to.ident);
      if (!fwd && !rev) continue;
      const hit: RouteHit = { id: `~${af.hex}`, flight: leg.flightIata ?? leg.flight, from: leg.from, to, std: leg.std, status: legInfo(af, leg, sim).status, type: af.type.code, reverse: !fwd };
      hit.airline = af.airline.name;
      hit.airlineIcao = af.airline.icao;
      out.push(hit);
    }
  }
  const rank = (s: FlightStatus) => (['En route', 'Holding', 'Approach', 'Emergency', 'Diverted', 'Go-around', 'On station'].includes(s) ? 0 : s === 'Taxiing' || s === 'Boarding' || s === 'Gate hold' || s === 'De-icing' ? 1 : s === 'Scheduled' || s === 'Delayed' ? 2 : 3);
  return out.sort((x, y) => Number(x.reverse) - Number(y.reverse) || rank(x.status) - rank(y.status) || x.std - y.std).slice(0, limit);
}

// ---------------------------------------------------------------- route fixes, taxi route, zones

export interface RouteFix {
  ident: string;
  lat: number;
  lon: number;
  role: 'sid' | 'star' | 'via' | 'ocean';
  name?: string;
  detail: string;
}

/** Named points of the selected flight's route (procedures, navaids, oceanic track points). */
export function simRouteFixes(id: string | null | undefined): RouteFix[] {
  const af = id ? byId.get(id) : undefined;
  const r = af?.leg.route;
  if (!af || !r) return [];
  const navKind = (k?: number) => (k === undefined ? 'Waypoint' : (['VOR', 'VOR-DME', 'VORTAC', 'NDB', 'NDB-DME'][k] ?? 'Navaid'));
  const out: RouteFix[] = [];
  const add = (f: { ident: string; lat: number; lon: number; name?: string; real: boolean; kind?: number }, role: RouteFix['role'], what: string) => {
    if (out.some((x) => x.ident === f.ident && Math.abs(x.lat - f.lat) < 0.01)) return;
    const fx: RouteFix = { ident: f.ident, lat: f.lat, lon: f.lon, role, detail: `${what} · ${f.real ? navKind(f.kind) : 'generated waypoint'}` };
    if (f.name) fx.name = f.name;
    out.push(fx);
  };
  if (r.sid) for (const f of r.sid.fixes ?? [r.sid.fix]) add(f, 'sid', `${r.sid.name}${r.sid.published ? ` (published, ${r.sid.published})` : ''}`);
  for (const f of r.via) add(f, 'via', 'En route');
  if (r.nat) {
    for (const p of r.nat.text.split(' ')) {
      const m = /^(\d+)\/(\d+)$/.exec(p) ?? /^(\d+)([NS])(\d+|180)([EW]?)$/.exec(p);
      if (!m) continue;
      let lat: number;
      let lon: number;
      if (m.length === 3) {
        lat = Number(m[1]);
        lon = -Number(m[2]);
      } else {
        lat = Number(m[1]) * (m[2] === 'S' ? -1 : 1);
        lon = m[3] === '180' ? 180 : Number(m[3]) * (m[4] === 'W' ? -1 : 1);
      }
      out.push({ ident: p, lat, lon, role: 'ocean', detail: `Oceanic track ${r.nat.letter} · FL${r.nat.fl}` });
    }
  }
  if (r.star) for (const f of r.star.fixes ?? [r.star.fix]) add(f, 'star', `${r.star.name}${r.star.published ? ` (published, ${r.star.published})` : ''}`);
  return out;
}

export interface TaxiView {
  path: [number, number][];
  label: string;
  hold?: { lat: number; lon: number; text: string };
}

/** The selected aircraft's remaining cleared taxi route (ground radar view). */
export function simTaxiPath(id: string | null | undefined): TaxiView | undefined {
  const af = id ? byId.get(id) : undefined;
  if (!af || !world) return undefined;
  const sim = simNow();
  const leg = af.leg;
  if (sim < leg.tOff || sim >= leg.tOn || leg.canceled) return undefined;
  const out = sim < leg.tTakeoff;
  if (!out && sim < leg.tLand) return undefined;
  const path: [number, number][] = [];
  for (const s of leg.segs) {
    if (s.phase !== 'taxi' && s.phase !== 'pushback' && !(out ? false : s.phase === 'landing')) continue;
    if (out ? s.t0 > leg.tTakeoff : s.t0 < leg.tLand) continue;
    if (s.t1 < sim) continue;
    const pts = s.kind === 'path' ? s.pts! : [s.a, s.b];
    for (const p of pts) path.push([p[1], p[0]]);
  }
  const st = world.state(af, sim);
  if (path.length) path.unshift([st.lon, st.lat]);
  const t = out ? leg.taxiOut : leg.taxiIn;
  const runway = out ? leg.from.inUse.ident : leg.to.inUse.ident;
  const label = out
    ? `${t?.via.length ? `via ${t.via.join(', ')} ` : ''}to ${t?.hold ? `holding point ${t.hold}, ` : ''}runway ${runway}`
    : `${t?.exit ? `vacated via ${t.exit}, ` : ''}${t?.via.length ? `via ${t.via.join(', ')} ` : ''}to ${leg.standTo.ref ? `stand ${leg.standTo.ref}` : 'the stand'}`;
  const view: TaxiView = { path, label };
  if (out) {
    const holdSeg = leg.segs.find((s) => s.phase === 'taxi' && s.nose !== undefined && s.t0 > leg.tOff + 60_000 && s.a[0] === s.b[0] && s.a[1] === s.b[1] && s.t1 <= leg.tTakeoff);
    if (holdSeg) view.hold = { lat: holdSeg.a[0], lon: holdSeg.a[1], text: t?.hold ? `Hold short · ${t.hold}` : `Hold short · ${runway}` };
  }
  return view;
}

export interface ZoneView {
  id: string;
  name: string;
  kind: 'closure' | 'ash';
  ring: [number, number][];
  scope: string;
}

/** Closed airspace and the day's (simulated) volcanic-ash advisory. */
export function simZones(): ZoneView[] {
  if (!world) return [];
  return world.zonesAt(simNow()).map((z) => ({
    id: z.id,
    name: z.name,
    kind: z.kind,
    ring: z.poly.map(([la, lo]) => [lo, la] as [number, number]),
    scope: z.avoidBy === 'all' ? 'All airlines' : `Airlines of ${z.avoidBy.size} countries`,
  }));
}

export interface OceanicTrackView extends NatTrackView {
  system: 'NAT' | 'PACOTS' | 'AUSOTS';
}

/** Every organised track system (North Atlantic, Pacific, Australian flex tracks). */
export async function simOceanicTracks(): Promise<OceanicTrackView[]> {
  if (!world) return [];
  const { pacotsTracks, ausotsTracks, otsString } = await import('./sim/procedures');
  const sim = simNow();
  const count = new Map<string, number>();
  for (const af of world.airframes) {
    const nat = af.leg.route?.nat;
    if (nat && sim >= af.leg.tTakeoff && sim < af.leg.tLand) count.set(`${nat.system}${nat.letter}`, (count.get(`${nat.system}${nat.letter}`) ?? 0) + 1);
  }
  const nat: OceanicTrackView[] = simNatTracks().map((t) => ({ ...t, system: 'NAT', flights: count.get(`NAT${t.letter}`) ?? 0 }));
  const seen = new Set<string>();
  const others = [...pacotsTracks(sim - 86_400_000, world.seed), ...pacotsTracks(sim, world.seed), ...ausotsTracks(sim, world.seed)]
    .filter((t) => sim < t.to + 3 * 3_600_000 && sim > t.from - 6 * 3_600_000)
    .filter((t) => {
      const k = `${t.system}${t.letter}${t.from}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((t) => ({ letter: t.letter, eastbound: t.eastbound, pts: t.pts, text: otsString(t), from: t.from, to: t.to, flights: count.get(`${t.system}${t.letter}`) ?? 0, system: t.system }));
  return [...nat, ...others];
}

// ---------------------------------------------------------------- travel peaks

export interface SeasonNotes {
  season: string;
  holidays: { name: string; where: string }[];
  hajj?: { phase: 'arrivals' | 'departures'; day: number };
  ash?: string;
}

/** Travel peaks, the IATA season, Hajj and any ash advisory at the simulated date. */
export async function simSeason(): Promise<SeasonNotes> {
  const sched = await import('./sim/schedule');
  const t = NOW;
  const seen = new Set<string>();
  const holidays = sched
    .holidaysAt(t)
    .concat(['US', 'IN', 'CN', 'JP', 'SA', 'ID', 'KR'].flatMap((c) => sched.holidaysAt(t, c)))
    .filter((h) => {
      if (seen.has(h.name)) return false;
      seen.add(h.name);
      return true;
    })
    .map((h) => ({ name: h.name, where: h.countries === 'all' ? 'Worldwide' : h.countries.slice(0, 4).join(', ') + (h.countries.length > 4 ? '…' : '') }));
  const out: SeasonNotes = { season: sched.iataSeason(t).name, holidays };
  const hajj = sched.hajjInfo(t);
  if (hajj) out.hajj = hajj;
  const ash = world?.ash(t);
  if (ash) out.ash = ash.name;
  return out;
}
