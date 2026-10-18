// DEMO MODE — explicitly simulated traffic.
//
// Exists so people can explore the interface when live data is unavailable.
// Rules:
//  • opt-in only, never the default, never persisted across reloads;
//  • live polling is paused while it runs and all live tracks are cleared, so
//    simulated and real aircraft can never appear together;
//  • every simulated aircraft is unmistakable: callsigns start with "DMO",
//    addresses are non-ICAO ("~d…"), there are no registrations, and the UI shows
//    a persistent DEMO banner and badges;
//  • nothing simulated is recorded for replay or exported.

import type { Map as MlMap } from 'maplibre-gl';
import { create } from 'zustand';
import { bearingDeg, destination, distanceNm, intermediatePoint } from '@shared/geo';
import type { Aircraft, AircraftResponse } from '@shared/types';
import { getSettings } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { ui } from '@/state/ui';
import { loadMajorAirports } from './airports';
import { setFeedPaused, useFeed } from './feed';

export const useDemo = create<{ active: boolean }>()(() => ({ active: false }));

export const DEMO_ATTRIBUTION = { name: 'Simulated demo traffic', url: 'https://github.com/Arnav-Dugad/Arnav-Flight-Radar', license: 'Not real aircraft' };

const TICK_MS = 5000;
const FLIGHTS = 70;

const TYPES: { t: string; d: string; cat: string; kt: [number, number]; ft: [number, number] }[] = [
  { t: 'A20N', d: 'AIRBUS A-320neo', cat: 'A3', kt: [430, 470], ft: [34000, 38000] },
  { t: 'B38M', d: 'BOEING 737 MAX 8', cat: 'A3', kt: [430, 465], ft: [33000, 39000] },
  { t: 'A21N', d: 'AIRBUS A-321neo', cat: 'A3', kt: [430, 470], ft: [33000, 37000] },
  { t: 'B789', d: 'BOEING 787-9', cat: 'A5', kt: [470, 500], ft: [37000, 41000] },
  { t: 'A359', d: 'AIRBUS A-350-900', cat: 'A5', kt: [470, 500], ft: [37000, 41000] },
  { t: 'E190', d: 'EMBRAER ERJ-190', cat: 'A3', kt: [400, 440], ft: [30000, 36000] },
  { t: 'AT76', d: 'ATR 72-600', cat: 'A2', kt: [250, 280], ft: [17000, 24000] },
  { t: 'C68A', d: 'CESSNA 680A LATITUDE', cat: 'A2', kt: [420, 460], ft: [39000, 45000] },
  { t: 'C172', d: 'CESSNA 172', cat: 'A1', kt: [100, 120], ft: [2500, 5500] },
];

interface DemoFlight {
  n: number;
  type: (typeof TYPES)[number];
  from: [number, number];
  to: [number, number];
  dist: number;
  cruiseKt: number;
  cruiseFt: number;
  startedAt: number;
}

let flights: DemoFlight[] = [];
let timer: ReturnType<typeof setInterval> | undefined;
let serial = 0;
let rng = 1;
const rand = () => ((rng = (rng * 16807) % 2147483647) / 2147483647);
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)]!;

async function routeEndpoints(centre: { lat: number; lon: number }): Promise<[number, number][]> {
  try {
    const list = await loadMajorAirports();
    const near = list
      .filter((a) => a.type !== 'small_airport' && distanceNm(centre.lat, centre.lon, a.lat, a.lon) < 600)
      .map((a) => [a.lat, a.lon] as [number, number]);
    if (near.length >= 6) return near;
  } catch {
    /* fall through to synthetic endpoints */
  }
  // Open ocean or no airports: endpoints on a ring around the centre.
  return Array.from({ length: 12 }, (_, i) => destination(centre.lat, centre.lon, i * 30, 300));
}

function makeFlight(ends: [number, number][], now: number, spreadStart: boolean): DemoFlight {
  let from = pick(ends);
  let to = pick(ends);
  for (let i = 0; i < 8 && distanceNm(from[0], from[1], to[0], to[1]) < 120; i++) to = pick(ends);
  if (from === to) from = destination(to[0], to[1], rand() * 360, 200);
  const type = pick(TYPES);
  const dist = distanceNm(from[0], from[1], to[0], to[1]);
  const cruiseKt = type.kt[0] + rand() * (type.kt[1] - type.kt[0]);
  const durationMs = (dist / cruiseKt) * 3_600_000;
  return {
    n: ++serial,
    type,
    from,
    to,
    dist,
    cruiseKt,
    cruiseFt: Math.round((type.ft[0] + rand() * (type.ft[1] - type.ft[0])) / 1000) * 1000,
    startedAt: spreadStart ? now - rand() * durationMs : now,
  };
}

function state(f: DemoFlight, now: number): Aircraft | null {
  const flown = ((now - f.startedAt) / 3_600_000) * f.cruiseKt;
  if (flown >= f.dist) return null;
  const frac = flown / f.dist;
  const [lat, lon] = intermediatePoint(f.from[0], f.from[1], f.to[0], f.to[1], frac);
  const [nlat, nlon] = intermediatePoint(f.from[0], f.from[1], f.to[0], f.to[1], Math.min(1, frac + 0.001));
  const climbNm = Math.min(f.dist * 0.35, f.cruiseFt / 300);
  const descentNm = Math.min(f.dist * 0.35, f.cruiseFt / 320);
  const toGo = f.dist - flown;
  let alt = f.cruiseFt;
  let vr = 0;
  let gs = f.cruiseKt;
  if (flown < climbNm) {
    alt = Math.max(1500, (flown / climbNm) * f.cruiseFt);
    vr = 1800;
    gs = 220 + (f.cruiseKt - 220) * (flown / climbNm);
  } else if (toGo < descentNm) {
    alt = Math.max(1200, (toGo / descentNm) * f.cruiseFt);
    vr = -1400;
    gs = 200 + (f.cruiseKt - 200) * (toGo / descentNm);
  }
  return {
    id: `~d${f.n.toString(16).padStart(5, '0')}`,
    icao24: `~d${f.n.toString(16).padStart(5, '0')}`,
    callsign: `DMO${100 + (f.n % 900)}`,
    aircraftType: f.type.t,
    typeDescription: `${f.type.d} (simulated)`,
    category: f.type.cat,
    lat,
    lon,
    altitudeBarometric: Math.round(alt / 25) * 25,
    groundSpeed: Math.round(gs),
    track: Math.round(bearingDeg(lat, lon, nlat, nlon) * 10) / 10,
    verticalRate: vr,
    onGround: false,
    positionSource: 'other',
    observedAt: now,
    seenAt: now,
    receivedAt: now,
    provider: 'demo',
    freshness: 'live',
  };
}

function tick(ends: [number, number][], centre: { lat: number; lon: number }) {
  const now = Date.now();
  const list: Aircraft[] = [];
  flights = flights.map((f) => {
    let s = state(f, now);
    if (!s) {
      f = makeFlight(ends, now, false);
      s = state(f, now);
    }
    if (s) list.push(s);
    return f;
  });
  const resp: AircraftResponse = {
    provider: 'demo',
    attribution: DEMO_ATTRIBUTION,
    query: { lat: centre.lat, lon: centre.lon, radiusNm: 600 },
    providerNow: now,
    fetchedAt: now,
    servedAt: now,
    stale: false,
    cache: { hit: false, ageMs: 0, ttlMs: TICK_MS },
    count: list.length,
    aircraft: list,
  };
  traffic.ingest(resp, now);
  // Simulated flights that "land" are replaced; they are not "lost" aircraft.
  const ids = new Set(list.map((a) => a.id));
  for (const id of [...traffic.tracks.keys()]) if (!ids.has(id)) traffic.tracks.delete(id);
}

export async function startDemo(map: MlMap) {
  if (useDemo.getState().active) return;
  useDemo.setState({ active: true });
  setFeedPaused(true);
  ui().select(null);
  ui().setReplay({ active: false, playing: false, index: 0 });
  traffic.reset();
  traffic.record = false;
  traffic.expectedIntervalMs = TICK_MS;
  useFeed.setState({ status: 'live', message: undefined, errorCode: undefined });
  const c = map.getCenter();
  const centre = { lat: c.lat, lon: c.lng };
  rng = Math.max(1, Math.floor(Math.abs(c.lat * 1000 + c.lng * 100)) % 2147483646);
  const ends = await routeEndpoints(centre);
  if (!useDemo.getState().active) return;
  const now = Date.now();
  flights = Array.from({ length: FLIGHTS }, () => makeFlight(ends, now, true));
  tick(ends, centre);
  timer = setInterval(() => tick(ends, centre), TICK_MS);
}

export function stopDemo() {
  if (!useDemo.getState().active) return;
  clearInterval(timer);
  flights = [];
  ui().select(null);
  traffic.reset();
  const s = getSettings();
  traffic.record = s.recordSession;
  traffic.expectedIntervalMs = s.pollIntervalSec * 1000;
  useDemo.setState({ active: false });
  setFeedPaused(false);
}

export const isDemo = () => useDemo.getState().active;
