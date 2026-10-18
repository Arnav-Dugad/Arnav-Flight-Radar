// Airport ground-service vehicles as true-scale 3D models (loaded on demand by modelsBridge when
// the user zooms in close with 3D models on).
//
// The simulator reports bare service vehicles around aircraft in their turnaround (catering,
// fuel, stairs, baggage, push-back tug, de-icing; simServiceVehicles). Here each one is matched
// to its aircraft (nearest aircraft on the ground with the same heading) and re-placed where
// such a vehicle really works, from the aircraft type's length and span:
//   • stairs at the forward left door (L1) — only at remote stands; at a contact stand (an
//     OpenStreetMap jet bridge reaches the door) the bridge does the job. At remote stands an
//     apron bus waits alongside while passengers board or disembark;
//   • catering high-loader nose-in at the aft right door (wide-bodies: front right), its box
//     rising to the door sill and its platform sliding out over the cab;
//   • refueller or hydrant dispenser just ahead of the right wing, outboard of the engines,
//     facing forward (its escape route);
//   • belt loader + baggage train at the aft hold (wide-bodies: container loader + ULD dollies);
//   • towbarless tug under the nose, cradling the nose wheel, during push-back;
//   • two de-icing trucks working along either side (forward fuselage → outer wing → tail),
//     boom raised, spraying while stationary; a glycol-tinted wet patch spreads underneath.
// Unmatched vehicles stay at their simulated spot. Everything rides the models layer's instanced
// pipeline (registerMeshes); the 2D service dots (opsOverlays.ts) take over at lower zooms.

import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import type * as GeoJSON from 'geojson';
import { simServiceVehicles, type ServiceVehicle } from '@/data/world';
import { airportBuildings } from './airport3d';
import type { VehicleShape } from './modelMeshes';
import { registerMeshes, type ModelInstance } from './models3d';
import { DEICE_BOOM, VEHICLE_SHAPES, getVehicleMesh, vehicleInfo } from './vehicleMeshes';

registerMeshes(VEHICLE_SHAPES, getVehicleMesh);

if (import.meta.env.DEV && typeof window !== 'undefined') {
  const dev = (window as unknown as { __arnav?: Record<string, unknown> }).__arnav;
  if (dev)
    dev.vehicles = {
      /** Forces service vehicles around an aircraft (visual checks), e.g. demo('~abc123', ['catering', 'fuel', 'deice']); [] clears. */
      demo: (id: string, kinds: Kind[]) => {
        if (!kinds.length) forced.delete(id);
        else forced.set(id, { kinds: new Set(kinds), deiceSides: kinds.includes('deice') ? [-1, 1] : [] });
        lastMatch = 0;
      },
    };
}

/** 3D vehicles from this zoom (the 2D service dots are shown from 15.5). */
export const VEHICLES_3D_MIN_ZOOM = 16;
const MAX_VEHICLES = 700;
const MATCH_M = 80;
const DRAW_RADIUS_M = 2600;
const M_PER_DEG = 111_320;
const D2R = Math.PI / 180;
const EARTH_CIRC = 40_075_016.7;

type RGB = [number, number, number];
type Kind = ServiceVehicle['kind'];

export interface GroundAircraft {
  id: string;
  lat: number;
  lon: number;
  /** Degrees true, where the nose points. */
  hdg: number;
  lengthM: number;
  spanM: number;
}

/** A vehicle relative to its aircraft: x right / y forward of the aircraft's centre (m), heading relative to the aircraft's. */
export interface Placement {
  key: string;
  shape: VehicleShape;
  x: number;
  y: number;
  rel: number;
  /** Target lift / boom fraction. */
  lift: number;
  /** Seconds to reach it after the vehicle appears (0 = at once). */
  liftS: number;
  scale: number;
  body: RGB;
  tail: RGB;
}

const C = {
  white: [0.93, 0.94, 0.95] as RGB,
  yellow: [0.96, 0.74, 0.1] as RGB,
  orange: [0.95, 0.45, 0.08] as RGB,
  blue: [0.13, 0.3, 0.6] as RGB,
  red: [0.74, 0.12, 0.1] as RGB,
  green: [0.05, 0.42, 0.26] as RGB,
  dark: [0.13, 0.13, 0.14] as RGB,
  grey: [0.5, 0.53, 0.56] as RGB,
};
/** Ground handlers: tractor / loader body, cart curtains. */
const HANDLERS: [RGB, RGB][] = [
  [C.orange, C.blue],
  [C.yellow, C.grey],
  [C.white, C.red],
];
const CATERERS: RGB[] = [C.blue, C.green, C.red];
const FUELLERS: RGB[] = [C.red, C.green, C.yellow];

function hash(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}
const pick = <T>(list: T[], h: number): T => list[Math.min(list.length - 1, Math.floor(h * list.length))]!;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth01 = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const hdgDiff = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

// ------------------------------------------------------------------ airframe geometry (unit-tested)

export interface AirframeGeometry {
  L: number;
  S: number;
  /** Fuselage width (m). */
  W: number;
  /** Passenger door sill height (m). */
  sill: number;
  wide: boolean;
  /** y of the forward left door (L1), the aft passenger door, the aft cargo hold door, the nose gear. */
  yL1: number;
  yAftDoor: number;
  yAftHold: number;
  yNoseGear: number;
  /** y of the wing leading edge at lateral distance x from the centreline. */
  yLE: (x: number) => number;
}

/** Door, hold, gear and wing positions of a typical airliner of this length and span (aircraft frame, origin at mid-length). */
export function airframeGeometry(lengthM: number, spanM: number): AirframeGeometry {
  const L = Math.max(10, lengthM);
  const S = Math.max(8, spanM || L);
  const W = clamp(0.105 * L, 2.4, 7.2);
  const wide = L >= 45;
  const yRootLE = 0.14 * L;
  return {
    L,
    S,
    W,
    wide,
    sill: clamp(0.072 * L + 0.7, 1.7, 5.4),
    yL1: L / 2 - Math.max(4.2, 0.15 * L),
    yAftDoor: L / 2 - 0.83 * L,
    yAftHold: L / 2 - 0.66 * L,
    yNoseGear: L / 2 - (wide ? 0.1 : 0.13) * L,
    yLE: (x: number) => yRootLE - 0.55 * Math.max(0, Math.abs(x) - W / 2),
  };
}

/** De-icing truck stations along one side: forward fuselage, outer wing, tail (lateral distance and basket y). */
function deiceStations(g: AirframeGeometry): [number, number][] {
  const rx = DEICE_BOOM.basket[0];
  const half = vehicleInfo('veh-deice').widthM / 2;
  const fwd: [number, number] = [g.W / 2 - 0.3 + rx, g.L / 2 - 0.2 * g.L];
  const wing: [number, number] = [g.S / 2 + 2.3 + half, g.yLE(g.S / 2) - 1.0];
  const tail: [number, number] = [0.165 * g.L + 2.3 + half, -0.42 * g.L];
  return [fwd, wing, tail, wing];
}
const DWELL_S = 95;
const MOVE_S = 25;

/**
 * Where each service vehicle of an aircraft works (aircraft frame). `kinds` are the simulated
 * vehicles present; `contact` = a jet bridge serves the forward door; `deiceSides` -1 / +1 for
 * de-icing trucks on the left / right; `t` = seconds (drives the de-icers' rounds).
 */
export function servicePlan(ac: { id: string; lengthM: number; spanM: number }, kinds: ReadonlySet<Kind>, opts: { contact: boolean; deiceSides: readonly number[]; t: number }): Placement[] {
  const g = airframeGeometry(ac.lengthM, ac.spanM);
  const h = hash(ac.id);
  const [handler, curtains] = pick(HANDLERS, hash(ac.id, 7));
  const out: Placement[] = [];
  const add = (key: string, shape: VehicleShape, x: number, y: number, rel: number, body: RGB, tail: RGB, extra: Partial<Placement> = {}) =>
    out.push({ key: `${ac.id}|${key}`, shape, x, y, rel, lift: 1, liftS: 0, scale: 1, body, tail, ...extra });

  if (kinds.has('tug')) {
    const scale = g.wide ? 8.4 / vehicleInfo('veh-tug').lengthM : 1;
    add('tug', 'veh-tug', 0, g.yNoseGear - vehicleInfo('veh-tug').reach * scale, 0, C.yellow, C.dark, { scale });
  }
  if (kinds.has('stairs') && !opts.contact) {
    const shape: VehicleShape = g.sill > 4.3 ? 'veh-stairs-hi' : 'veh-stairs';
    add('stairs', shape, -(0.475 * g.W + 0.08 + vehicleInfo(shape).reach), g.yL1, 90, C.white, C.yellow);
    // boarding / disembarking (no catering or fuelling under way): an apron bus alongside
    if (!kinds.has('catering') && !kinds.has('fuel')) add('bus', 'veh-bus', -(g.W / 2 + 15), g.yL1 - 3.5, 0, C.white, C.blue);
  }
  if (kinds.has('catering')) {
    const i = vehicleInfo('veh-catering');
    add('catering', 'veh-catering', 0.475 * g.W + 0.06 + i.reach, g.wide ? g.yL1 : g.yAftDoor, -90, C.white, pick(CATERERS, hash(ac.id, 3)), {
      lift: clamp((g.sill - 1.72) / 4, 0.42, 1),
      liftS: 22,
    });
  }
  if (kinds.has('fuel')) {
    const shape: VehicleShape = (g.wide ? h < 0.7 : h < 0.35) ? 'veh-hydrant' : 'veh-fuel';
    const i = vehicleInfo(shape);
    const x = Math.max(0.25 * g.S + 0.4, g.W / 2 + 4.5);
    add('fuel', shape, x, g.yLE(x - i.widthM / 2) + 1.6 + i.lengthM / 2, 0, C.white, pick(FUELLERS, hash(ac.id, 5)));
  }
  if (kinds.has('baggage')) {
    const loader: VehicleShape = g.wide ? 'veh-cloader' : 'veh-belt';
    const train: VehicleShape = g.wide ? 'veh-uld' : 'veh-baggage';
    const li = vehicleInfo(loader);
    const ti = vehicleInfo(train);
    add('loader', loader, 0.4 * g.W + 0.1 + li.reach, g.yAftHold, -90, g.wide ? C.yellow : handler, C.dark);
    add('train', train, 0.4 * g.W + 0.1 + li.lengthM + 2.2 + ti.widthM / 2, g.yAftHold - 1.5, 0, handler, curtains);
  }
  if (opts.deiceSides.length) {
    const st = deiceStations(g);
    const info = vehicleInfo('veh-deice');
    const by = DEICE_BOOM.basket[1] - info.centreY;
    for (const s of opts.deiceSides) {
      const t = opts.t + h * 480 + (s > 0 ? 40 : 0);
      const cycle = DWELL_S + MOVE_S;
      const n = Math.floor(t / cycle);
      const u = t - n * cycle;
      const a = st[((n % st.length) + st.length) % st.length]!;
      const b = st[(((n + 1) % st.length) + st.length) % st.length]!;
      const f = u < DWELL_S ? 0 : smooth01((u - DWELL_S) / MOVE_S);
      const lat = a[0] + (b[0] - a[0]) * f;
      const yb = a[1] + (b[1] - a[1]) * f;
      // left: facing forward (aircraft to its right); right: facing aft (aircraft again to its right)
      add(`deice${s}`, 'veh-deice', s * lat, s < 0 ? yb - by : yb + by, s < 0 ? 0 : 180, C.orange, C.blue, {
        lift: u < DWELL_S ? 1 : 0.99,
        liftS: 9,
      });
    }
  }
  return out;
}

/** Fallback for a vehicle with no aircraft found: its simulated spot, a narrow-body-sized vehicle. */
function orphanPlacement(v: ServiceVehicle, i: number): Placement & { lat: number; lon: number; hdg: number } {
  const map: Record<Kind, [VehicleShape, number, number]> = {
    tug: ['veh-tug', 0, 1],
    stairs: ['veh-stairs', 90, 1],
    catering: ['veh-catering', -90, 0.42],
    fuel: ['veh-fuel', 0, 1],
    baggage: ['veh-belt', -90, 1],
    deice: ['veh-deice', 0, 1],
  };
  const [shape, rel, lift] = map[v.kind] ?? map.tug;
  return { key: `orphan|${v.kind}|${i}|${v.lat.toFixed(5)},${v.lon.toFixed(5)}`, shape, x: 0, y: 0, rel, lift, liftS: 0, scale: 1, body: v.kind === 'deice' ? C.orange : v.kind === 'tug' ? C.yellow : C.white, tail: C.blue, lat: v.lat, lon: v.lon, hdg: v.hdg };
}

/** Lat / lon of a point x right, y forward (m) of a reference point heading `hdg`. */
export function offsetLatLon(lat: number, lon: number, hdg: number, x: number, y: number): [number, number] {
  const h = hdg * D2R;
  const east = x * Math.cos(h) + y * Math.sin(h);
  const north = -x * Math.sin(h) + y * Math.cos(h);
  return [lat + north / M_PER_DEG, lon + east / (M_PER_DEG * Math.cos(lat * D2R))];
}

// ------------------------------------------------------------------ matching

interface Plan {
  kinds: Set<Kind>;
  deiceSides: number[];
}
let lastList: ServiceVehicle[] | null = null;
let lastMatch = 0;
const plans = new Map<string, Plan>();
let orphans: ServiceVehicle[] = [];
/** Dev override (window.__arnav.vehicles.demo): extra vehicles forced around an aircraft. */
const forced = new Map<string, Plan>();

function rematch(list: ServiceVehicle[], ground: GroundAircraft[]) {
  plans.clear();
  orphans = [];
  for (const [id, p] of forced) plans.set(id, { kinds: new Set(p.kinds), deiceSides: [...p.deiceSides] });
  // grid of aircraft by ~0.002° cells
  const grid = new Map<string, GroundAircraft[]>();
  const cell = (lat: number, lon: number) => `${Math.floor(lat / 0.002)},${Math.floor(lon / 0.003)}`;
  for (const a of ground) {
    const k = cell(a.lat, a.lon);
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push(a);
  }
  for (const v of list) {
    let best: GroundAircraft | undefined;
    let bd = MATCH_M;
    const cy = Math.floor(v.lat / 0.002);
    const cx = Math.floor(v.lon / 0.003);
    const k = Math.cos(v.lat * D2R) * M_PER_DEG;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (const a of grid.get(`${cy + dy},${cx + dx}`) ?? []) {
          const hd = hdgDiff(v.hdg, a.hdg);
          if (hd > 6 && !(v.kind === 'tug' && hd > 174)) continue;
          const d = Math.hypot((a.lat - v.lat) * M_PER_DEG, (a.lon - v.lon) * k);
          if (d < bd) {
            bd = d;
            best = a;
          }
        }
    if (!best) {
      orphans.push(v);
      continue;
    }
    let p = plans.get(best.id);
    if (!p) plans.set(best.id, (p = { kinds: new Set(), deiceSides: [] }));
    p.kinds.add(v.kind);
    if (v.kind === 'deice') {
      // which side of the aircraft: sign of the vehicle's offset to the aircraft's right
      const h = best.hdg * D2R;
      const east = (v.lon - best.lon) * k;
      const north = (v.lat - best.lat) * M_PER_DEG;
      const side = east * Math.cos(h) - north * Math.sin(h) >= 0 ? 1 : -1;
      if (!p.deiceSides.includes(side)) p.deiceSides.push(side);
    }
  }
}

// ------------------------------------------------------------------ contact stands (jet bridges)

let bridgeIndex: { src: unknown; cells: Map<string, [number, number][]> } | null = null;
const contactCache = new Map<string, { lat: number; lon: number; contact: boolean }>();

function jetBridgeCells() {
  const b = airportBuildings();
  if (bridgeIndex?.src === b) return bridgeIndex.cells;
  const cells = new Map<string, [number, number][]>();
  for (const f of b?.features ?? []) {
    if (f.properties.kind !== 'jet_bridge') continue;
    for (const [lon = 0, lat = 0] of f.geometry.coordinates[0] ?? []) {
      const k = `${Math.floor(lat / 0.0005)},${Math.floor(lon / 0.0008)}`;
      let l = cells.get(k);
      if (!l) cells.set(k, (l = []));
      l.push([lat, lon]);
    }
  }
  bridgeIndex = { src: b, cells };
  contactCache.clear();
  return cells;
}

/** Whether an OpenStreetMap jet bridge comes within `r` metres of a point. */
function jetBridgeNear(lat: number, lon: number, r: number): boolean {
  const cells = jetBridgeCells();
  if (!cells.size) return false;
  const k = Math.cos(lat * D2R) * M_PER_DEG;
  const cy = Math.floor(lat / 0.0005);
  const cx = Math.floor(lon / 0.0008);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      for (const [la, lo] of cells.get(`${cy + dy},${cx + dx}`) ?? []) if (Math.hypot((la - lat) * M_PER_DEG, (lo - lon) * k) < r) return true;
  return false;
}

function isContactStand(a: GroundAircraft): boolean {
  jetBridgeCells();
  const c = contactCache.get(a.id);
  if (c && Math.abs(c.lat - a.lat) < 2e-5 && Math.abs(c.lon - a.lon) < 3e-5) return c.contact;
  const g = airframeGeometry(a.lengthM, a.spanM);
  const [lat, lon] = offsetLatLon(a.lat, a.lon, a.hdg, -g.W / 2 - 1, g.yL1);
  const contact = jetBridgeNear(lat, lon, 26);
  if (contactCache.size > 3000) contactCache.clear();
  contactCache.set(a.id, { lat: a.lat, lon: a.lon, contact });
  return contact;
}

// ------------------------------------------------------------------ instances

const firstSeen = new Map<string, number>();
let lastSweep = 0;

export interface VehicleFrame {
  /** Night factor at the airport (0 day … 1 night). */
  night: number;
  /** Ground height (m, as drawn) at a point — terrain elevation, or 0 without terrain. */
  groundZ: (lat: number, lon: number) => number;
}

/** The 3D vehicle instances for this frame (empty below VEHICLES_3D_MIN_ZOOM). */
export function vehicleInstances(map: MlMap, ground: GroundAircraft[], frame: VehicleFrame): ModelInstance[] {
  if (map.getZoom() < VEHICLES_3D_MIN_ZOOM) {
    updateWet(map, []);
    return [];
  }
  const b = map.getBounds();
  const list = simServiceVehicles([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
  const nowMs = performance.now();
  if (list !== lastList || nowMs - lastMatch > 1500) {
    rematch(list, ground);
    lastList = list;
    lastMatch = nowMs;
  }
  const t = nowMs / 1000;
  const c = map.getCenter();
  const kc = Math.cos(c.lat * D2R) * M_PER_DEG;
  const far = (lat: number, lon: number) => Math.hypot((lat - c.lat) * M_PER_DEG, (lon - c.lng) * kc) > DRAW_RADIUS_M;
  const out: ModelInstance[] = [];
  const deiced: { a: GroundAircraft; g: AirframeGeometry }[] = [];
  const push = (p: Placement, lat: number, lon: number, hdg: number) => {
    let t0 = firstSeen.get(p.key);
    if (t0 === undefined) firstSeen.set(p.key, (t0 = nowMs));
    const ramp = p.liftS > 0 ? smooth01((nowMs - t0) / (p.liftS * 1000)) : 1;
    out.push({
      id: p.key,
      lat,
      lon,
      altM: frame.groundZ(lat, lon),
      hdg: (((hdg + p.rel) % 360) + 360) % 360,
      pitch: 0,
      roll: 0,
      shape: p.shape,
      lengthM: vehicleInfo(p.shape).lengthM * p.scale,
      spanM: 0,
      body: p.body,
      tail: p.tail,
      gear: p.lift * ramp,
      flaps: 0,
      lights: 1,
      night: frame.night,
    });
  };
  const byId = new Map(ground.map((a) => [a.id, a]));
  for (const [id, plan] of plans) {
    const a = byId.get(id);
    if (!a || far(a.lat, a.lon)) continue;
    const placements = servicePlan(a, plan.kinds, { contact: plan.kinds.has('stairs') && isContactStand(a), deiceSides: plan.deiceSides, t });
    for (const p of placements) {
      const [lat, lon] = offsetLatLon(a.lat, a.lon, a.hdg, p.x, p.y);
      push(p, lat, lon, a.hdg);
    }
    if (plan.deiceSides.length) deiced.push({ a, g: airframeGeometry(a.lengthM, a.spanM) });
    if (out.length >= MAX_VEHICLES) break;
  }
  orphans.forEach((v, i) => {
    if (out.length >= MAX_VEHICLES || far(v.lat, v.lon)) return;
    const p = orphanPlacement(v, i);
    push(p, p.lat, p.lon, p.hdg);
  });
  if (nowMs - lastSweep > 5000) {
    lastSweep = nowMs;
    const live = new Set(out.map((o) => o.id));
    for (const k of firstSeen.keys()) if (!live.has(k)) firstSeen.delete(k);
  }
  updateWet(map, deiced);
  return out;
}

// ------------------------------------------------------------------ de-icing wet patch

const WET_SRC = 'svc-deice-wet';
const WET_LAYERS = ['svc-deice-wet', 'svc-deice-glycol'] as const;
let wetSig = '';
let wetAt = 0;
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Radius in px at zoom 0 of `m` metres at `lat` (512 px tiles); scaled by 2^zoom in the style. */
const px0 = (m: number, lat: number) => (m * 512) / (EARTH_CIRC * Math.cos(lat * D2R));

function ensureWetLayers(map: MlMap): boolean {
  try {
    if (!map.getSource(WET_SRC)) map.addSource(WET_SRC, { type: 'geojson', data: EMPTY });
    const before = ['stands-dot', 'svc-dot', 'aircraft-models'].find((l) => map.getLayer(l));
    const radius = (k: string) => ['interpolate', ['exponential', 2], ['zoom'], 0, ['get', k], 24, ['*', ['get', k], 2 ** 24]] as unknown as number;
    if (!map.getLayer(WET_LAYERS[0]))
      map.addLayer(
        {
          id: WET_LAYERS[0],
          type: 'circle',
          source: WET_SRC,
          minzoom: 14,
          paint: { 'circle-radius': radius('r'), 'circle-color': '#081018', 'circle-opacity': 0.32, 'circle-blur': 0.7, 'circle-pitch-alignment': 'map', 'circle-pitch-scale': 'map' },
        },
        before,
      );
    if (!map.getLayer(WET_LAYERS[1]))
      map.addLayer(
        {
          id: WET_LAYERS[1],
          type: 'circle',
          source: WET_SRC,
          minzoom: 14,
          paint: { 'circle-radius': radius('g'), 'circle-color': '#e08a2c', 'circle-opacity': 0.2, 'circle-blur': 0.85, 'circle-pitch-alignment': 'map', 'circle-pitch-scale': 'map' },
        },
        before,
      );
    return true;
  } catch {
    return false; // style not ready
  }
}

/** A dark wet patch with an orange (type I fluid) tint under each aircraft being de-iced. */
function updateWet(map: MlMap, list: { a: GroundAircraft; g: AirframeGeometry }[]) {
  const now = performance.now();
  if (now - wetAt < 1000 && list.length) return;
  wetAt = now;
  const sig = list.map(({ a }) => `${a.id}@${a.lat.toFixed(5)},${a.lon.toFixed(5)}`).join('|');
  if (sig === wetSig && (!list.length || map.getSource(WET_SRC))) return;
  wetSig = sig;
  if (!list.length) {
    (map.getSource(WET_SRC) as GeoJSONSource | undefined)?.setData(EMPTY);
    return;
  }
  if (!ensureWetLayers(map)) {
    wetSig = '';
    return;
  }
  const features: GeoJSON.Feature[] = [];
  for (const { a, g } of list) {
    const blobs: [number, number, number][] = [
      [0, 0.08 * g.L, 0.3 * g.L],
      [-0.27 * g.S, g.yLE(0.27 * g.S) - 1.5, 0.2 * g.S],
      [0.27 * g.S, g.yLE(0.27 * g.S) - 1.5, 0.2 * g.S],
      [0, -0.38 * g.L, 0.14 * g.L],
    ];
    for (const [x, y, r] of blobs) {
      const [lat, lon] = offsetLatLon(a.lat, a.lon, a.hdg, x, y);
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { r: px0(r, lat), g: px0(r * 0.75, lat) } });
    }
  }
  (map.getSource(WET_SRC) as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
}
