// The simulated world that drives the whole site — page side.
//
// The simulation itself runs in a Web Worker (src/data/sim.worker.ts → simCore.ts):
// building a planet of traffic and advancing it every few seconds never blocks the
// page. This module owns the clock, feeds real weather to the worker, turns each tick's
// packed aircraft state into the traffic engine's records, and exposes the same query
// API as before. Queries are answered from a cache that the worker refreshes on every
// tick for whatever the page asked about recently; a first-time query returns
// `undefined` for a moment while the worker answers (components re-render on `rev`).
//
// Honesty rules:
//  • every aircraft is marked as simulated (provider "sim", non-ICAO "~" addresses,
//    so no real-aircraft record or photo is ever attached to an invented flight);
//  • flights, registrations, schedules and positions are invented and the UI says
//    "Simulated" wherever a reader could mistake them for real tracking data.

import { create } from 'zustand';
import type { Aircraft, AircraftResponse } from '@shared/types';
import { api } from '@/lib/api';
import { getSettings } from '@/state/settings';
import { traffic, type TrailPoint } from '@/state/traffic';
import { ui } from '@/state/ui';
import { loadMajorAirports } from './airports';
import type * as Core from './simCore';
import type { AircraftMeta, TickPacket } from './simCore';
import type { AsyncQuery, SyncQuery } from './sim.worker';

export { legKindLabel } from './sim/labels';
export type {
  AirportActivity,
  AirportSummary,
  AirlineFlightRow,
  AirlineInfo,
  BoardRow,
  DayStats,
  FlightInfo,
  FlightLoad,
  FlightStatus,
  GroundData,
  HistoryRow,
  NatTrackView,
  NotableFlight,
  OceanicTrackView,
  PunctualityRow,
  QueueRow,
  RouteFix,
  RouteHit,
  ScannerKind,
  SeasonNotes,
  ScannerLine,
  ServiceVehicle,
  StandState,
  TaxiView,
  TypeStats,
  ZoneView,
} from './simCore';

export const SIM_SPEEDS = [1, 5, 15, 30] as const;

interface SimState {
  active: boolean;
  loading: boolean;
  speed: number;
  airborne: number;
  ground: number;
  /** Bumped whenever query results arrive from the worker (components subscribe to refresh). */
  rev: number;
}

export const useSim = create<SimState>()(() => ({ active: false, loading: true, speed: 1, airborne: 0, ground: 0, rev: 0 }));

export const SIM_ATTRIBUTION = { name: 'Simulated traffic', url: 'https://github.com/Arnav-Dugad/Arnav-Flight-Radar', license: 'Simulated — not real aircraft' };

const WORLD_REGION = { lat: 0, lon: 0, radiusNm: 100_000 };

let worker: Worker | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let clock = { sim0: 0, real0: 0, speed: 1 };
let tickSeq = 0;
let ticking = false;

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

function deviceScale() {
  // Real-world density on capable devices; lighter on small or low-core devices.
  const cores = navigator.hardwareConcurrency || 4;
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;
  return small || cores <= 4 ? 0.4 : 0.75;
}

// ---------------------------------------------------------------- query cache

interface Entry {
  name: string;
  args: unknown[];
  value: unknown;
  used: number;
  has: boolean;
}
const cache = new Map<string, Entry>();
let revScheduled = false;
function bumpRev() {
  if (revScheduled) return;
  revScheduled = true;
  queueMicrotask(() => {
    revScheduled = false;
    useSim.setState((s) => ({ rev: s.rev + 1 }));
  });
}

/** Cached answer to a worker query; asks the worker when it has none yet (or it is stale). */
function q<T>(name: SyncQuery, args: unknown[]): T | undefined {
  if (!worker) return undefined;
  const key = `${name}${JSON.stringify(args)}`;
  let e = cache.get(key);
  const now = Date.now();
  if (!e) {
    e = { name, args, value: undefined, used: now, has: false };
    cache.set(key, e);
    worker.postMessage({ type: 'q', key, name, args, sim: simNow() });
  }
  e.used = now;
  return e.value as T | undefined;
}

let asyncSeq = 0;
const waiting = new Map<number, (v: unknown) => void>();
function qa<T>(name: AsyncQuery, args: unknown[]): Promise<T | undefined> {
  if (!worker) return Promise.resolve(undefined);
  const id = ++asyncSeq;
  return new Promise((resolve) => {
    waiting.set(id, resolve as (v: unknown) => void);
    worker!.postMessage({ type: 'q', id, key: `#${id}`, name, args, sim: simNow() });
  });
}

/** Queries used in the last few seconds are recomputed by the worker on every tick. */
function subscriptions() {
  const now = Date.now();
  const subs: { key: string; name: string; args: unknown[] }[] = [];
  for (const [key, e] of cache) {
    if (now - e.used > 30_000) cache.delete(key);
    else if (now - e.used < 8_000 && subs.length < 400) subs.push({ key, name: e.name, args: e.args });
  }
  return subs;
}

// ---------------------------------------------------------------- ticks

const metas: (AircraftMeta | undefined)[] = [];
const routeCodes = new Map<string, [string, string, string]>();
const knownIds = new Set<string>();

function onTick(p: TickPacket, real: number) {
  for (const m of p.meta) {
    metas[m.i] = m;
    routeCodes.set(m.id, m.route);
    knownIds.add(m.id);
  }
  const list: Aircraft[] = [];
  for (let i = 0; i < p.n; i++) {
    if (!p.emit[i]) continue;
    const m = metas[i];
    if (!m) continue;
    const onGround = p.ground[i] === 1;
    const a: Aircraft = {
      id: m.id,
      icao24: m.id,
      callsign: m.callsign,
      registration: m.registration,
      aircraftType: m.aircraftType,
      typeDescription: m.typeDescription,
      category: m.category,
      lat: p.lat[i]!,
      lon: p.lon[i]!,
      groundSpeed: p.gs[i]!,
      track: p.trk[i]!,
      squawk: m.squawk,
      onGround,
      positionSource: m.flarm ? 'other' : 'adsb',
      observedAt: real,
      seenAt: real,
      receivedAt: real,
      provider: 'sim',
      freshness: 'live',
    };
    if (m.squawk === '7700') a.emergency = 'general';
    if (m.military) a.military = true;
    if (!onGround) {
      const alt = p.alt[i]!;
      a.altitudeBarometric = Math.round(alt / 25) * 25;
      a.altitudeGeometric = Math.round((alt + 175) / 25) * 25;
      a.verticalRate = p.vr[i]!;
      const ext: NonNullable<Aircraft['ext']> = { navQnh: 1013.2, trueHeading: a.track! };
      if (!Number.isNaN(p.mcp[i]!)) ext.navAltitudeMcp = p.mcp[i]!;
      if (!Number.isNaN(p.wdir[i]!)) {
        ext.windDirection = p.wdir[i]!;
        ext.windSpeed = p.wspd[i]!;
      }
      if (!Number.isNaN(p.tas[i]!)) {
        ext.tas = p.tas[i]!;
        ext.mach = Math.round(p.mach[i]! * 1000) / 1000;
        ext.outsideAirTemp = p.oat[i]!;
      }
      if (m.owner) ext.ownerOperator = m.owner;
      a.ext = ext;
    } else if (m.owner) a.ext = { ownerOperator: m.owner };
    list.push(a);
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
  useSim.setState({ airborne: p.airborne, ground: p.onGround });
  for (const al of p.alerts) alertEmergency(al);
}

function tick() {
  if (!worker || ticking) return;
  ticking = true;
  worker.postMessage({ type: 'tick', sim: simNow(), seq: ++tickSeq, subs: subscriptions() });
}

function scheduleTick() {
  clearTimeout(timer);
  timer = setTimeout(tick, tickMs());
}

/** Tells the user when a simulated flight declares an emergency (setting: Emergency alerts). */
function alertEmergency(e: Core.EmergencyAlert) {
  const mode = getSettings().emergencyAlerts;
  if (mode === 'off') return;
  const what =
    e.kind === 'medical' ? 'Medical emergency (PAN PAN)' : e.kind === 'engine' ? 'Engine failure — squawk 7700' : e.kind === 'birdstrike' ? 'Bird strike — returning to land' : 'Loss of cabin pressure — squawk 7700';
  const body = `${e.flight} ${e.from} → ${e.to}, diverting to ${e.divertTo}. Simulated.`;
  ui().toast({ kind: 'warning', title: what, body, action: { label: 'Show', run: () => ui().select(e.id) } });
  if (mode === 'notify' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(what, { body, tag: `${e.id}${e.kind}` });
    } catch {
      /* notifications are best effort */
    }
  }
}

function onMessage(ev: MessageEvent) {
  const m = ev.data as { type: string; [k: string]: unknown };
  switch (m.type) {
    case 'ready': {
      if (!m.ok) {
        useSim.setState({ active: false, loading: false });
        ui().toast({
          kind: 'error',
          title: 'The simulation could not start',
          body: 'The airport dataset could not be loaded. Check your connection and reload.',
          action: { label: 'Reload', run: () => location.reload() },
        });
        return;
      }
      // "Loading" ends with the first tick, once aircraft are actually on the map.
      tick();
      void loadHubWeather(m.hubs as string[]);
      break;
    }
    case 'extra':
      bumpRev();
      break;
    case 'tick': {
      ticking = false;
      const real = Date.now();
      if (m.packet) onTick(m.packet as TickPacket, real);
      if (useSim.getState().loading) useSim.setState({ loading: false });
      let changed = false;
      for (const [key, value] of m.results as [string, unknown][]) {
        const e = cache.get(key);
        if (!e) continue;
        e.value = value;
        e.has = true;
        changed = true;
      }
      if (changed) bumpRev();
      scheduleTick();
      break;
    }
    case 'q': {
      if (typeof m.id === 'number') {
        waiting.get(m.id)?.(m.value);
        waiting.delete(m.id);
        return;
      }
      const e = cache.get(m.key as string);
      if (e) {
        e.value = m.value;
        e.has = true;
        bumpRev();
      }
      break;
    }
    case 'error':
      if (typeof m.id === 'number') {
        waiting.get(m.id)?.(undefined);
        waiting.delete(m.id);
      }
      break;
  }
}

// ---------------------------------------------------------------- lifecycle

let lastBounds: [number, number, number, number] | null = null;

/** Per-aircraft [flight number, origin code, destination code] (cheap map labels). */
export function simRouteCodes(id: string): [string, string, string] | undefined {
  return routeCodes.get(id);
}

let ALLIANCES: { name: string; members: string[] }[] = [];

/** Builds the world (in the worker) and starts the clock (called once, when the map is ready). */
export async function startSim() {
  if (useSim.getState().active) return;
  useSim.setState({ active: true, loading: true, speed: 1 });
  traffic.reset();
  traffic.record = getSettings().recordSession;
  traffic.storeTrails = false;
  traffic.trailProvider = (t) => {
    const selected = ui().selectedId === t.id;
    if (!selected && !getSettings().showAllTrails) return undefined;
    return q<TrailPoint[]>('simTrail', [t.id, selected]);
  };
  const now = Date.now();
  clock = { sim0: now, real0: now, speed: 1 };
  traffic.speedScale = 1;
  traffic.expectedIntervalMs = tickMs();
  void import('./sim/airlines').then((m) => (ALLIANCES = m.ALL_ALLIANCES));
  try {
    worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module', name: 'simulation' });
  } catch {
    worker = null;
  }
  if (!worker) {
    useSim.setState({ active: false, loading: false });
    ui().toast({ kind: 'error', title: 'The simulation could not start', body: 'This browser cannot run the simulation worker.' });
    return;
  }
  worker.onmessage = onMessage;
  worker.onerror = (e) => console.warn('simulation worker error', e.message);
  worker.postMessage({ type: 'init', now, seed: Math.floor(now / 86_400_000) % 2147483646 || 7, scale: deviceScale() });
}

/** Stops the clock and the worker (tests / teardown only). */
export function stopSim() {
  clearTimeout(timer);
  worker?.terminate();
  worker = null;
  ticking = false;
  cache.clear();
  metas.length = 0;
  routeCodes.clear();
  knownIds.clear();
  metarFetched.clear();
  useSim.setState({ active: false, loading: false, speed: 1, airborne: 0, ground: 0 });
}

export const isSim = () => useSim.getState().active;
export const isSimId = (id: string | null | undefined) => !!id && knownIds.has(id);

/** Alliance of an airline (as publicly announced), if any. */
export function allianceOf(icao: string | undefined): string | undefined {
  if (!icao) return undefined;
  return ALLIANCES.find((a) => a.members.includes(icao))?.name;
}

// ---------------------------------------------------------------- real weather

const metarFetched = new Map<string, number>();

async function applyMetars(ids: string[]) {
  const want = ids.filter((id) => /^[A-Z]{4}$/.test(id) && Date.now() - (metarFetched.get(id) ?? 0) > 20 * 60_000).slice(0, 10);
  if (!want.length || !worker) return;
  for (const id of want) metarFetched.set(id, Date.now());
  try {
    const r = await api.metar(want);
    for (const m of r.data) {
      const w: Parameters<typeof Core.coreSetWeather>[1] = { observedAt: m.observedAt };
      if (m.flightCategory) w.category = m.flightCategory;
      if (m.windDirDeg !== undefined) w.windDir = m.windDirDeg;
      if (m.windSpeedKt !== undefined) w.windKt = m.windSpeedKt;
      if (m.windGustKt !== undefined) w.gustKt = m.windGustKt;
      const vis = m.visibility ? Number.parseFloat(m.visibility) : NaN;
      if (Number.isFinite(vis)) w.visSm = vis;
      if (m.tempC !== undefined) w.tempC = m.tempC;
      if (m.weather) w.wx = m.weather;
      if (m.altimeterHpa !== undefined) w.qnh = m.altimeterHpa;
      worker?.postMessage({ type: 'weather', ident: m.station, w });
    }
  } catch {
    /* weather is optional: the simulated runway choice stays in place */
  }
}

/** Real METARs for the busiest simulated hubs set their runway in use and capacity; TAFs plan ahead. */
async function loadHubWeather(top: string[]) {
  for (let i = 0; i < top.length; i += 10) {
    if (!useSim.getState().active) return;
    await applyMetars(top.slice(i, i + 10));
    await new Promise((r) => setTimeout(r, 2000)); // stay well inside the weather API pacing
  }
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
  if (!want.length || !worker) return;
  for (const id of want) tafFetched.set(id, Date.now());
  try {
    const r = await api.taf(want);
    for (const taf of r.data) worker?.postMessage({ type: 'forecast', taf });
  } catch {
    /* forecasts are optional */
  }
}

/** Feeds a decoded TAF into the simulation (also called when an airport panel loads one). */
export function applyForecast(taf: Parameters<TafLib['hourlyForecast']>[0], _lib?: TafLib) {
  worker?.postMessage({ type: 'forecast', taf });
}

let lastView = 0;
/**
 * Called when the map view settles. Loads real weather for large airports in view and,
 * when zoomed in on an airport, its OpenStreetMap taxiway network (in the worker).
 */
export function simViewChanged(view: { lat: number; lon: number; zoom: number; bounds: [number, number, number, number] }) {
  lastBounds = view.bounds;
  if (!worker || !useSim.getState().active) return;
  worker.postMessage({ type: 'view', view: { lat: view.lat, lon: view.lon, zoom: view.zoom } });
  if (view.zoom >= 6.5 && Date.now() - lastView > 15_000) {
    lastView = Date.now();
    const [w, s, e, n] = view.bounds;
    void loadMajorAirports().then((list) => applyMetars(list.filter((a) => a.type === 'large_airport' && a.lat >= s && a.lat <= n && a.lon >= w && a.lon <= e).map((a) => a.ident)));
  }
}

const groundData = new Map<string, Promise<Core.GroundData | null>>();
/** OpenStreetMap ground data for an airport (terminals for the map); the worker loads its own copy. */
export function loadGround(ident: string): Promise<Core.GroundData | null> {
  worker?.postMessage({ type: 'ground', ident });
  let p = groundData.get(ident);
  if (!p) {
    p = fetch(`/data/ground/${ident}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Core.GroundData>) : null))
      .catch(() => null);
    groundData.set(ident, p);
  }
  return p;
}

/** Loads OpenStreetMap taxiways for both ends of a flight (names in the taxi clearances). */
export function simPrepareFlight(id: string | null | undefined) {
  if (id) worker?.postMessage({ type: 'prepare', id });
}

// ---------------------------------------------------------------- queries (answered by the worker)

type R<K extends keyof typeof Core> = (typeof Core)[K] extends (...a: never[]) => infer T ? Awaited<T> : never;

export const simFlight = (id: string | null | undefined) => (id ? q<R<'simFlight'>>('simFlight', [id]) : undefined);
export const simBoard = (ident: string, opts: { pastMin?: number; aheadMin?: number } = {}) => q<R<'simBoard'>>('simBoard', [ident, opts]);
export const simRunwayInUse = (ident: string) => q<R<'simRunwayInUse'>>('simRunwayInUse', [ident]);
export const simRoute = (id: string | null | undefined) => (id ? q<R<'simRoute'>>('simRoute', [id]) : undefined);
export const simPlannedProfile = (id: string | null | undefined) => (id ? q<R<'simPlannedProfile'>>('simPlannedProfile', [id]) : undefined);
export const simMovementsByHour = (ident: string, hours = 6) => q<R<'simMovementsByHour'>>('simMovementsByHour', [ident, hours]);
export const simSearch = (query: string, limit = 8) => q<R<'simSearch'>>('simSearch', [query, limit]) ?? [];
export const simStats = () => q<R<'simStats'>>('simStats', []) ?? { airborne: useSim.getState().airborne, ground: useSim.getState().ground, airframes: 0, airlines: 0, airports: 0, groundAirports: 0, metarAirports: 0, holding: 0, diverted: 0 };
export const simAirline = (icao: string | null | undefined) => (icao ? q<R<'simAirline'>>('simAirline', [icao]) : undefined);
export const simAirlineSearch = (query: string, limit = 5) => q<R<'simAirlineSearch'>>('simAirlineSearch', [query, limit]) ?? [];
export const simWidgets = () => q<R<'simWidgets'>>('simWidgets', []);
export const simDepartureQueue = (ident: string) => q<R<'simDepartureQueue'>>('simDepartureQueue', [ident]) ?? [];
export const simStands = (ident: string) => q<R<'simStands'>>('simStands', [ident]) ?? [];
export const simServiceVehicles = (bounds: [number, number, number, number]) => q<R<'simServiceVehicles'>>('simServiceVehicles', [bounds.map((v) => Math.round(v * 200) / 200)]) ?? [];
export const simNearestGroundAirport = (lat: number, lon: number, maxNm = 4) => q<R<'simNearestGroundAirport'>>('simNearestGroundAirport', [Math.round(lat * 100) / 100, Math.round(lon * 100) / 100, maxNm]);
export const simHistory = (id: string | null | undefined) => (id ? q<R<'simHistory'>>('simHistory', [id]) : undefined);
export const simTypeStats = (code: string) => q<R<'simTypeStats'>>('simTypeStats', [code]);
export const simAirportHistory = (ident: string) => q<R<'simAirportHistory'>>('simAirportHistory', [ident]);
export const simNatTracks = () => q<R<'simNatTracks'>>('simNatTracks', []) ?? [];
export const simElevationFt = (id: string) => q<R<'simElevationFt'>>('simElevationFt', [id]);
export const simPunctuality = (minFlights = 5) => q<R<'simPunctuality'>>('simPunctuality', [minFlights]) ?? [];
export const simAirportSummary = (ident: string) => q<R<'simAirportSummary'>>('simAirportSummary', [ident]);
/** Flights between two sets of airports; undefined while the worker is still answering. */
export const simRouteSearch = (from: string[], to: string[], limit = 12) => q<R<'simRouteSearch'>>('simRouteSearch', [from, to, limit]);
export const simRouteFixes = (id: string | null | undefined) => (id ? (q<R<'simRouteFixes'>>('simRouteFixes', [id]) ?? []) : []);
export const simTaxiPath = (id: string | null | undefined) => (id ? q<R<'simTaxiPath'>>('simTaxiPath', [id]) : undefined);
export const simZones = () => q<R<'simZones'>>('simZones', []) ?? [];

/** Simulated radio transcript of a flight (UTC times in the phraseology). */
export const simRadio = (id: string | null | undefined, _fmtTime?: (t: number) => string) => (id ? qa<R<'simRadio'>>('simRadio', [id]) : Promise.resolve(undefined));
export const simLoad = (id: string | null | undefined) => (id ? qa<R<'simLoad'>>('simLoad', [id]) : Promise.resolve(undefined));
export const simAirportRadio = (ident: string, kind: Core.ScannerKind, windowMin = 20) => qa<R<'simAirportRadio'>>('simAirportRadio', [ident, kind, windowMin]);
export const simOceanicTracks = async () => (await qa<R<'simOceanicTracks'>>('simOceanicTracks', [])) ?? [];

/** Travel peaks, IATA season, Hajj and ash advisory at the simulated date. */
export const simSeason = () => qa<R<'simSeason'>>('simSeason', []);
