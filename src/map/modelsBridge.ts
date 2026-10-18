// Feeds the 3D model layer with the aircraft in view (loaded on demand, only when the
// user zooms in close or flies the chase view). Each model gets its type's real length
// and span, its airline's livery colours, a pitch attitude from the climb/descent rate,
// a bank angle from the rate of turn, an animated landing-gear / flap configuration derived
// from the height above the field and the vertical rate, and a night factor from the sun
// altitude at the aircraft (simulated clock).
//
// Heights: without terrain the map's ground is sea level everywhere, so models are placed by
// their height above the field. With 3D terrain (drawn exaggerated) aircraft on or near the
// ground sit on the rendered terrain (queryTerrainElevation, which includes the exaggeration)
// and blend into MSL + the field's exaggeration offset by ~120 m above it.
//
// Close in (zoom ≥ 15.5) the ground-service vehicles module (vehicles3d.ts) is loaded and its
// vehicles are drawn by the same layer; the 2D service dots then step aside above its zoom.

import type { Map as MlMap } from 'maplibre-gl';
import { AIRLINE_EXTRA } from '@/data/sim/airlineInfo';
import { specOf } from '@/data/sim/typeSpecs';
import { simElevationFt, simNow } from '@/data/world';
import { getSettings } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { ui } from '@/state/ui';
import { forcedNight } from './airport3d';
import { installModels, nightFactor, sunAltitudeAt, sunFrame, type ModelInstance, type ModelsHandle } from './models3d';
import { setServiceVehicles3d } from './opsOverlays';
import type { GroundAircraft } from './vehicles3d';

const MAX_MODELS = 2000;
const GEAR_TRAVEL_S = 6; // full extension / retraction
const FLAP_TRAVEL_S = 9; // clean → full
const FORGET_MS = 120_000;

const hexRgb = (h: string): [number, number, number] => {
  const n = Number.parseInt(h.replace('#', '').slice(0, 6), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const MIL: [number, number, number] = [0.47, 0.5, 0.52];
const WHITE: [number, number, number] = [0.95, 0.96, 0.97];
const GA_TAIL: [number, number, number] = [0.16, 0.34, 0.62];

const turn = new Map<string, { trk: number; t: number; bank: number }>();

function attitude(id: string, trk: number, gs: number, vr: number, onGround: boolean, now: number): { pitch: number; roll: number } {
  if (onGround) return { pitch: 0, roll: 0 };
  const prev = turn.get(id);
  let bank = prev?.bank ?? 0;
  if (prev && now - prev.t > 200) {
    const d = ((trk - prev.trk + 540) % 360) - 180;
    const rate = (d / ((now - prev.t) / 1000)) * (Math.PI / 180); // rad/s
    const v = gs * 0.5144;
    const target = Math.max(-35, Math.min(35, (Math.atan((v * rate) / 9.81) * 180) / Math.PI));
    bank += (target - bank) * 0.35;
    turn.set(id, { trk, t: now, bank });
  } else if (!prev) turn.set(id, { trk, t: now, bank: 0 });
  // Flight-path angle plus a few degrees of body attitude (nose up when slow).
  const gamma = (Math.atan2(vr / 60, Math.max(60, gs) * 1.688) * 180) / Math.PI;
  const body = gs < 200 ? 4 : 2;
  return { pitch: Math.max(-6, Math.min(18, gamma + body)), roll: bank };
}

// ------------------------------------------------------------------ gear / flaps
export interface FlightState {
  onGround: boolean;
  gs: number; // kt
  vr: number; // ft/min
  agl: number; // ft above the field (0 on the ground)
}

export interface AircraftConfig {
  gear: number; // current gear-down fraction
  gearDown: boolean; // commanded
  flaps: number; // current setting
  flapTarget: number;
  wasAirborne: boolean;
  landed: boolean; // touched down since we last saw it airborne (landing roll / taxi in)
  t: number; // sim ms of the last update
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const approach = (v: number, target: number, maxStep: number) => (v < target ? Math.min(target, v + maxStep) : Math.max(target, v - maxStep));

/**
 * Advances an aircraft's gear / flap configuration by `dtS` seconds (sim time). Rules:
 * gear down on the ground, below ~2,500 ft above the field when descending (and it stays down
 * until a climb above ~800 ft), and below ~800 ft after take-off. Flaps: take-off setting
 * (0.35) for the take-off roll and the climb below ~3,000 ft, ramping 0.25 → 1 on the approach
 * below ~4,000 ft, 1 on the landing roll, 0 when taxiing in and in cruise.
 */
export function stepConfig(prev: AircraftConfig | undefined, f: FlightState, dtS: number, nowMs: number): AircraftConfig {
  const c: AircraftConfig = prev
    ? { ...prev }
    : (() => {
        const down = f.onGround || f.agl < 800 || (f.agl < 2500 && f.vr < -300);
        return { gear: down ? 1 : 0, gearDown: down, flaps: 0, flapTarget: 0, wasAirborne: !f.onGround, landed: false, t: nowMs };
      })();
  // gear
  if (f.onGround) c.gearDown = true;
  else if (c.gearDown) {
    if (f.agl > 2500 || (f.agl > 800 && f.vr > 300)) c.gearDown = false;
  } else if (f.agl < 2500 && f.vr < -300) c.gearDown = true;
  // flaps
  if (f.onGround) {
    if (c.wasAirborne) c.landed = true;
    c.wasAirborne = false;
    if (c.landed) c.flapTarget = f.gs > 40 ? 1 : 0;
    else c.flapTarget = f.gs > 3 ? 0.35 : 0;
  } else {
    c.wasAirborne = true;
    c.landed = false;
    if (f.vr > 300) c.flapTarget = f.agl < 3000 ? 0.35 : 0; // initial climb / go-around
    else if (f.vr < -200) c.flapTarget = f.agl < 4000 ? 0.25 + 0.75 * smooth(4000, 1000, f.agl) : 0;
    else if (f.agl >= 4000) c.flapTarget = 0;
    // level below 4,000 ft: hold the current setting
  }
  if (!prev) c.flaps = c.flapTarget;
  const dt = Math.min(10, Math.max(0, dtS));
  c.gear = approach(c.gear, c.gearDown ? 1 : 0, dt / GEAR_TRAVEL_S);
  c.flaps = approach(c.flaps, c.flapTarget, dt / FLAP_TRAVEL_S);
  c.t = nowMs;
  return c;
}

const configs = new Map<string, AircraftConfig>();
let lastSweep = 0;

// Terrain height (m, as drawn — includes the exaggeration) per key, re-queried as things move.
const elev = new Map<string, { lat: number; lon: number; z: number; t: number }>();

function terrainZ(map: MlMap, key: string, lat: number, lon: number, fallback: number, now: number): number {
  const c = elev.get(key);
  if (c && now - c.t < 3000 && Math.abs(c.lat - lat) < 4e-5 && Math.abs(c.lon - lon) < 6e-5) return c.z;
  let z: number | null;
  try {
    z = map.queryTerrainElevation([lon, lat]);
  } catch {
    z = null;
  }
  const v = z ?? fallback;
  elev.set(key, { lat, lon, z: v, t: now });
  return v;
}

function sweep(now: number, simMs: number) {
  if (now - lastSweep < 5000) return;
  lastSweep = now;
  for (const [id, t] of turn) if (now - t.t > FORGET_MS) turn.delete(id);
  for (const [id, c] of configs) if (Math.abs(simMs - c.t) > FORGET_MS * 30) configs.delete(id);
  for (const [k, c] of elev) if (now - c.t > 10_000) elev.delete(k);
}

// ------------------------------------------------------------------ ground-service vehicles (lazy)
const VEHICLES_LOAD_ZOOM = 15.5;
let veh: typeof import('./vehicles3d') | null = null;
let vehLoading = false;

function loadVehicles(map: MlMap) {
  if (veh || vehLoading) return;
  vehLoading = true;
  import('./vehicles3d')
    .then((m) => {
      veh = m;
      map.triggerRepaint();
    })
    .catch((e: unknown) => {
      console.warn('[aircraft-models] ground vehicles unavailable:', e);
    });
}

function instances(map: MlMap): ModelInstance[] {
  if (!getSettings().show3dModels) return [];
  const now = Date.now();
  const sim = simNow(now);
  sweep(now, sim);
  const sun = sunFrame(sim);
  const b = map.getBounds();
  const w = b.getWest();
  const e = b.getEast();
  const s = b.getSouth();
  const n = b.getNorth();
  const selected = ui().selectedId;
  const forced = forcedNight();
  const zoom = map.getZoom();
  if (zoom >= VEHICLES_LOAD_ZOOM) loadVehicles(map);
  const wantGround = !!veh && zoom >= veh.VEHICLES_3D_MIN_ZOOM;
  const ground: GroundAircraft[] = [];
  // Without terrain the map's ground is sea level everywhere: place models by their height
  // above the field (so aircraft on the ground sit on the apron). With terrain see the header.
  const terr = map.getTerrain();
  const exag = terr?.exaggeration ?? 1;
  const out: ModelInstance[] = [];
  for (const t of traffic.tracks.values()) {
    const a = t.ac;
    const pos = traffic.displayPosition(t, now);
    if (pos.lat < s || pos.lat > n || pos.lon < w || pos.lon > e) {
      if (t.id !== selected) continue;
    }
    const spec = a.aircraftType ? specOf(a.aircraftType) : undefined;
    if (!spec) continue;
    const icao = a.callsign?.slice(0, 3) ?? '';
    const extra = AIRLINE_EXTRA[icao];
    const body = a.military ? MIL : extra ? hexRgb(extra.body) : WHITE;
    const tail = a.military ? MIL : extra ? hexRgb(extra.tail) : GA_TAIL;
    const fieldFt = simElevationFt(t.id) ?? 0;
    const altFt = a.onGround ? fieldFt : (a.altitudeBarometric ?? 0);
    const trk = pos.trk ?? a.track ?? 0;
    const gs = a.groundSpeed ?? 0;
    const vr = a.verticalRate ?? 0;
    const att = attitude(t.id, trk, gs, vr, a.onGround, now);
    const prev = configs.get(t.id);
    const cfg = stepConfig(prev, { onGround: a.onGround, gs, vr, agl: a.onGround ? 0 : Math.max(0, altFt - fieldFt) }, prev ? (sim - prev.t) / 1000 : 0, sim);
    configs.set(t.id, cfg);
    const aglM = a.onGround ? 0 : Math.max(0, altFt - fieldFt) * 0.3048;
    let altM = aglM;
    if (terr) {
      const fieldM = fieldFt * 0.3048;
      const high = altFt * 0.3048 + fieldM * (exag - 1);
      if (aglM >= 120) altM = high;
      else {
        const low = terrainZ(map, t.id, pos.lat, pos.lon, fieldM * exag, now) + aglM;
        altM = low + (high - low) * smooth(30, 120, aglM);
      }
    }
    if (wantGround && a.onGround) ground.push({ id: t.id, lat: pos.lat, lon: pos.lon, hdg: trk, lengthM: spec.lengthM, spanM: spec.spanM });
    const inst: ModelInstance = {
      id: t.id,
      lat: pos.lat,
      lon: pos.lon,
      altM,
      hdg: trk,
      pitch: att.pitch,
      roll: att.roll,
      shape: spec.shape,
      lengthM: spec.lengthM,
      spanM: spec.spanM,
      body,
      tail,
      selected: t.id === selected,
      gear: cfg.gear,
      flaps: cfg.flaps,
      // strobes and landing lights on the runway and in the air; taxiing: nav, beacon, taxi
      // light; parked: navigation and logo lights only
      lights: !a.onGround || gs >= 30 ? 1 : gs >= 1 ? 0.5 : 0.25,
      night: forced ?? nightFactor(sunAltitudeAt(sun, pos.lat, pos.lon)),
    };
    if (spec.engines.kind === 'turboprop' || spec.engines.kind === 'piston' || spec.engines.kind === 'turboshaft') inst.rotorRpm = a.onGround && gs < 2 ? 0 : 1;
    out.push(inst);
    if (out.length >= MAX_MODELS) break;
  }
  if (veh) {
    const c = map.getCenter();
    const night = forced ?? nightFactor(sunAltitudeAt(sun, c.lat, c.lng));
    const groundZ = terr ? (lat: number, lon: number) => terrainZ(map, `v${Math.round(lat * 2e4)},${Math.round(lon * 2e4)}`, lat, lon, 0, now) : () => 0;
    for (const v of veh.vehicleInstances(map, wantGround ? ground : [], { night, groundZ })) out.push(v);
  }
  return out;
}

export function startModels(map: MlMap): ModelsHandle {
  const handle = installModels(map, () => instances(map), { minZoom: 12.5, clock: () => simNow(), ...(map.getLayer('ac-labels') ? { beforeId: 'ac-labels' } : {}) });
  // The 2D service-vehicle dots step aside where the 3D vehicles are drawn.
  const sync = () => setServiceVehicles3d(map, veh && getSettings().show3dModels && handle.isEnabled() ? veh.VEHICLES_3D_MIN_ZOOM : null);
  const timer = setInterval(sync, 1500);
  if (import.meta.env.DEV) {
    const dev = (window as unknown as { __arnav?: Record<string, unknown> }).__arnav;
    if (dev) dev.models = { stats: () => handle.stats?.(), instances: () => instances(map) };
  }
  return {
    ...handle,
    setEnabled(on: boolean) {
      handle.setEnabled(on);
      sync();
    },
    dispose() {
      clearInterval(timer);
      setServiceVehicles3d(map, null);
      handle.dispose();
    },
  };
}
