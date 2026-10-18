// Airports up close:
//   • Accurate 3D airport buildings — OpenStreetMap terminals, piers, hangars, control
//     towers (shaft, glazed cab, roof), jet bridges, car parks… extruded to their mapped
//     heights (built by scripts/build-buildings.mjs into /data/buildings/<ICAO>.json) when
//     the map is zoomed in and tilted near an airport.
//   • Airport lighting at night — runway edge / centreline / threshold / end / touchdown-zone
//     lights, an approach lighting system with its sequenced-flasher "rabbit", green taxiway
//     centreline and blue edge lights, and warm apron floodlighting. They fade in as the sun
//     at the airport (simulated clock) sinks below the horizon.

import type * as GeoJSON from 'geojson';
import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { simNow, simRunwayInUse } from '@/data/world';
import { getSettings, useSettings, type MapStyleId } from '@/state/settings';
import { solarElevation, subsolarPoint } from './extraOverlays';

// ---------------------------------------------------------------- types

export type BuildingKind = 'terminal' | 'pier' | 'hangar' | 'control_tower' | 'jet_bridge' | 'parking' | 'cargo' | 'hotel' | 'office' | 'other';
export interface BuildingProps {
  kind: BuildingKind;
  height_m: number;
  min_height_m: number;
  part?: 'shaft' | 'cab' | 'cap' | 'base';
  colour?: string;
  roof_colour?: string;
  material?: string;
  name?: string;
  osm?: string;
}
interface BuildingsFile {
  type: 'FeatureCollection';
  icao: string;
  center: [number, number];
  bbox: [number, number, number, number]; // s, w, n, e
  features: GeoJSON.Feature<GeoJSON.Polygon, BuildingProps>[];
}
/** Runway row from runways-major.json. */
export type RunwayRow = [string, number, number, number, string, number, number, number, number];
interface GroundFile {
  nodes: [number, number][];
  edges: [number, number, number?][];
  stands?: [number, number, ...unknown[]][];
}
type XY = [number, number];
export interface Light {
  x: number;
  y: number;
  /** Colour (hex). */
  c: string;
  /** Size factor. */
  r: number;
  /** Relative intensity (0–1). */
  o?: number;
  /** Rabbit group (0–4) for sequenced flashers. */
  g?: number;
}

// ---------------------------------------------------------------- geometry helpers (unit-tested)

const D2R = Math.PI / 180;
const M_PER_DEG = 111_320;

/** Local metric projection (metres east / north) around a reference point. */
export function localProjection(lat0: number, lon0: number) {
  const k = Math.cos(lat0 * D2R) * M_PER_DEG;
  return {
    fwd: (lat: number, lon: number): XY => [(lon - lon0) * k, (lat - lat0) * M_PER_DEG],
    inv: (x: number, y: number): [number, number] => [lon0 + x / k, lat0 + y / M_PER_DEG], // [lon, lat]
  };
}

/** Points every `spacing` metres along a polyline, starting `start` metres in (inclusive of the end when it lands on it). */
export function placeAlong(line: XY[], spacing: number, start = 0): { p: XY; dir: XY; s: number }[] {
  const out: { p: XY; dir: XY; s: number }[] = [];
  if (line.length < 2 || spacing <= 0) return out;
  let next = start;
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    const dir: XY = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    while (next <= acc + len + 1e-6) {
      const t = next - acc;
      out.push({ p: [a[0] + dir[0] * t, a[1] + dir[1] * t], dir, s: next });
      next += spacing;
    }
    acc += len;
  }
  return out;
}

export const LIGHT = {
  white: '#fff4dc',
  yellow: '#ffc83d',
  red: '#ff3a2e',
  green: '#3dff86',
  taxi: '#2fe57c',
  blue: '#4f7dff',
  flash: '#eef6ff',
  flood: '#ffd9a0',
} as const;

/**
 * Lights for one runway, landing from threshold `a` towards the far end `b` (local metres).
 * Edge lights every 60 m (yellow in the last 600 m), centreline every 15 m (alternating red /
 * white in the last 900 m, red in the last 300 m), green threshold bar with wing bars, red
 * end bar, touchdown-zone barrettes, and — when `als` — a 900 m approach lighting system with
 * sequenced flashers (returned separately with their rabbit group).
 */
export function runwayLights(a: XY, b: XY, width: number, als: boolean): { steady: Light[]; flashers: Light[] } {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const steady: Light[] = [];
  const flashers: Light[] = [];
  if (L < 200) return { steady, flashers };
  const u: XY = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const n: XY = [-u[1], u[0]];
  const at = (s: number, t: number, c: string, r = 1, g?: number): Light => {
    const l: Light = { x: a[0] + u[0] * s + n[0] * t, y: a[1] + u[1] * s + n[1] * t, c, r };
    if (g !== undefined) l.g = g;
    return l;
  };
  const half = width / 2;
  // Edge lights — evenly spread, about 60 m apart, both ends included.
  const edgeN = Math.max(1, Math.round(L / 60));
  for (let i = 0; i <= edgeN; i++) {
    const s = (L * i) / edgeN;
    const c = L - s <= 600 ? LIGHT.yellow : LIGHT.white;
    steady.push(at(s, half + 1.5, c), at(s, -half - 1.5, c));
  }
  // Centreline every 15 m.
  for (let s = 7.5, i = 0; s <= L - 7.5; s += 15, i++) {
    const rem = L - s;
    const c = rem <= 300 ? LIGHT.red : rem <= 900 ? (i % 2 ? LIGHT.red : LIGHT.white) : LIGHT.white;
    steady.push(at(s, 0, c, 0.8));
  }
  // Threshold (green, with wing bars) and runway end (red).
  for (let t = -half; t <= half + 1e-6; t += 3) {
    steady.push(at(-1, t, LIGHT.green, 1.15));
    steady.push(at(L + 1, t, LIGHT.red, 1.1));
  }
  for (let k = 1; k <= 5; k++) for (const sgn of [1, -1]) steady.push(at(-1, sgn * (half + 2 + k * 3), LIGHT.green, 1.15));
  // Touchdown zone: barrettes of three either side of the centreline, 60 m apart to 900 m.
  if (L >= 1800)
    for (let s = 60; s <= 900; s += 60) for (const t of [9, 10.5, 12]) steady.push(at(s, t, LIGHT.white, 0.85), at(s, -t, LIGHT.white, 0.85));
  if (als && L >= 1800) {
    for (let s = 30; s <= 900; s += 30) {
      // Centreline barrettes of five.
      for (let t = -2.1; t <= 2.11; t += 1.05) steady.push(at(-s, t, LIGHT.white, 0.9));
      // Red side barrettes in the inner 270 m.
      if (s <= 270) for (const t of [9, 10.5, 12]) steady.push(at(-s, t, LIGHT.red, 0.85), at(-s, -t, LIGHT.red, 0.85));
    }
    // Crossbar at 300 m.
    for (let t = 4; t <= 15; t += 1.5) steady.push(at(-300, t, LIGHT.white, 0.9), at(-300, -t, LIGHT.white, 0.9));
    // Sequenced flashers from 900 m in to 330 m — five groups, running toward the threshold.
    const stations: number[] = [];
    for (let s = 900; s >= 330; s -= 30) stations.push(s);
    stations.forEach((s, i) => flashers.push(at(-s, 0, LIGHT.flash, 1.6, Math.floor((i * 5) / stations.length))));
  }
  return { steady, flashers };
}

export function polylineLength(line: XY[]): number {
  let d = 0;
  for (let i = 1; i < line.length; i++) d += Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]);
  return d;
}

/** Joins taxiway graph edges into polylines through nodes of degree two. */
export function taxiPolylines(_nodes: [number, number][], edges: [number, number, number?][]): { pts: number[]; named: boolean }[] {
  const adj = new Map<number, { to: number; e: number }[]>();
  edges.forEach(([x, y], e) => {
    if (!adj.has(x)) adj.set(x, []);
    if (!adj.has(y)) adj.set(y, []);
    adj.get(x)!.push({ to: y, e });
    adj.get(y)!.push({ to: x, e });
  });
  const used = new Uint8Array(edges.length);
  const out: { pts: number[]; named: boolean }[] = [];
  const deg = (v: number) => adj.get(v)?.length ?? 0;
  const walk = (start: number, first: { to: number; e: number }) => {
    const pts = [start];
    let named = (edges[first.e]![2] ?? -1) >= 0;
    let cur = first;
    for (;;) {
      used[cur.e] = 1;
      pts.push(cur.to);
      if (deg(cur.to) !== 2) break;
      const nxt = adj.get(cur.to)!.find((x) => !used[x.e]);
      if (!nxt) break;
      named &&= (edges[nxt.e]![2] ?? -1) >= 0;
      cur = nxt;
    }
    out.push({ pts, named });
  };
  // Chains start at junctions and dead ends; what remains are closed loops.
  for (const [v, list] of adj) if (deg(v) !== 2) for (const x of list) if (!used[x.e]) walk(v, x);
  for (const [v, list] of adj) for (const x of list) if (!used[x.e]) walk(v, x);
  return out;
}

/** Sun elevation → light intensity: nothing by day, fading in through civil dusk (0° → −4°). */
export function nightFactor(sunElevationDeg: number): number {
  return Math.max(0, Math.min(1, -sunElevationDeg / 4));
}

/** Parses #rgb / #rrggbb or a common CSS colour name. */
export function parseColour(c: string | undefined): [number, number, number] | undefined {
  if (!c) return undefined;
  const s = c.trim().toLowerCase();
  const named: Record<string, string> = {
    white: '#ffffff', black: '#202020', grey: '#808080', gray: '#808080', silver: '#c0c0c0', lightgrey: '#d3d3d3', lightgray: '#d3d3d3', darkgrey: '#555555', darkgray: '#555555',
    red: '#b03a2e', darkred: '#7a1f1a', blue: '#2e5fa8', lightblue: '#9cc3e6', darkblue: '#1f3566', green: '#3c7a46', darkgreen: '#244d2b', brown: '#7a5638', beige: '#d8ccb0',
    yellow: '#d8c04a', orange: '#d8833a', cream: '#efe6cc', tan: '#c8a878', maroon: '#6d2a2a', teal: '#2f7f7f', navy: '#22305a',
  };
  const hex = named[s] ?? s;
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(hex);
  if (m3) return [parseInt(m3[1]! + m3[1]!, 16), parseInt(m3[2]! + m3[2]!, 16), parseInt(m3[3]! + m3[3]!, 16)];
  const m6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(hex);
  if (m6) return [parseInt(m6[1]!, 16), parseInt(m6[2]!, 16), parseInt(m6[3]!, 16)];
  return undefined;
}
/** Mixes colour `b` into `a` by `t` (0–1); returns `a` unchanged when `b` does not parse. */
export function mixColour(a: string, b: string | undefined, t: number): string {
  const A = parseColour(a);
  const B = parseColour(b);
  if (!A) return a;
  if (!B || t <= 0) return a;
  const h = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return `#${h(A[0] + (B[0] - A[0]) * t)}${h(A[1] + (B[1] - A[1]) * t)}${h(A[2] + (B[2] - A[2]) * t)}`;
}

/** Base-map building feature ids (OpenFreeMap / Planetiler: OSM id × 10 + element type). */
export function basemapIds(osm: string): number[] {
  const m = /^([nwr])(\d+)$/.exec(osm);
  if (!m) return [];
  const id = Number(m[2]);
  return m[1] === 'w' ? [id * 10 + 2] : m[1] === 'r' ? [id * 10 + 3, id * 10] : [id * 10 + 1];
}

// ---------------------------------------------------------------- palettes

interface Swatch {
  wall: string;
  roof: string;
}
type Palette = Record<BuildingKind, Swatch> & { cab: Swatch; shaft: Swatch; cap: Swatch; glow: string; night: string; dark: boolean };

const DARK: Palette = {
  terminal: { wall: '#25364d', roof: '#46597a' },
  pier: { wall: '#243449', roof: '#425573' },
  hangar: { wall: '#30353d', roof: '#4b525c' },
  control_tower: { wall: '#5f6874', roof: '#8d96a2' },
  jet_bridge: { wall: '#7b8490', roof: '#99a2ad' },
  parking: { wall: '#2f3540', roof: '#454d5a' },
  cargo: { wall: '#2c3440', roof: '#434d5b' },
  hotel: { wall: '#2e3646', roof: '#4a5366' },
  office: { wall: '#2a3241', roof: '#444e60' },
  other: { wall: '#232a34', roof: '#353e4a' },
  shaft: { wall: '#b7c0cc', roof: '#cfd6df' },
  cab: { wall: '#1c4257', roof: '#2d6380' },
  cap: { wall: '#d7dde5', roof: '#e9edf2' },
  glow: '#ffcf8f',
  night: '#141b26',
  dark: true,
};
const LIGHTP: Palette = {
  terminal: { wall: '#b9cbe0', roof: '#eef3f9' },
  pier: { wall: '#bfcfe2', roof: '#f0f4f9' },
  hangar: { wall: '#a9b0ba', roof: '#d6dbe2' },
  control_tower: { wall: '#e6e9ee', roof: '#f7f8fa' },
  jet_bridge: { wall: '#9ea7b3', roof: '#c3c9d1' },
  parking: { wall: '#ccd1d8', roof: '#e3e6eb' },
  cargo: { wall: '#bfc6cf', roof: '#dde1e7' },
  hotel: { wall: '#d6d0c6', roof: '#ebe7e0' },
  office: { wall: '#cbd2dc', roof: '#e6eaef' },
  other: { wall: '#d6dbe2', roof: '#e8ebef' },
  shaft: { wall: '#eef0f3', roof: '#ffffff' },
  cab: { wall: '#4f7896', roof: '#7fa3bd' },
  cap: { wall: '#ffffff', roof: '#ffffff' },
  glow: '#ffd9a6',
  night: '#5d6878',
  dark: false,
};
const SAT: Palette = {
  ...DARK,
  terminal: { wall: '#3a4d68', roof: '#8495ad' },
  pier: { wall: '#384a63', roof: '#7d8fa8' },
  hangar: { wall: '#4a5059', roof: '#8a919b' },
  other: { wall: '#3d444e', roof: '#6c747f' },
};
function paletteFor(style: MapStyleId): Palette {
  return style === 'arctic' ? LIGHTP : style === 'satellite' ? SAT : DARK;
}

/**
 * Extrusion features for a buildings file: each building becomes a body and a thin roof slab
 * (a lighter roof colour that reads as a parapet from the side); tower parts keep their own
 * colours. OSM `building:colour` / `roof:colour` tint the style's colours; at night lit
 * buildings warm up.
 */
export function extrusionFeatures(features: GeoJSON.Feature<GeoJSON.Polygon, BuildingProps>[], pal: Palette, night: number): GeoJSON.FeatureCollection {
  const out: GeoJSON.Feature[] = [];
  const lit = new Set<BuildingKind>(['terminal', 'pier', 'hotel', 'office', 'parking']);
  for (const f of features) {
    const p = f.properties;
    const h = p.height_m;
    const base = p.min_height_m;
    const sw = p.part ? pal[p.part === 'base' ? 'control_tower' : p.part] : pal[p.kind] ?? pal.other;
    let wall = mixColour(sw.wall, p.colour, 0.28);
    let roof = mixColour(sw.roof, p.roof_colour ?? p.colour, 0.3);
    if (night > 0 && pal.dark) {
      // Lit façades take a faint warm glow; roofs, lit by nothing, sink into the dark.
      if (lit.has(p.kind)) wall = mixColour(wall, pal.glow, 0.12 * night);
      roof = mixColour(roof, pal.night, 0.35 * night);
    }
    const span = h - base;
    if (p.part || p.kind === 'jet_bridge' || span < 3) {
      out.push({ type: 'Feature', geometry: f.geometry, properties: { color: wall, base, top: h, kind: p.kind } });
      continue;
    }
    const slab = Math.min(0.9, span * 0.12);
    out.push({ type: 'Feature', geometry: f.geometry, properties: { color: wall, base, top: h - slab, kind: p.kind } });
    out.push({ type: 'Feature', geometry: f.geometry, properties: { color: roof, base: h - slab, top: h, kind: p.kind } });
  }
  return { type: 'FeatureCollection', features: out };
}

// ---------------------------------------------------------------- data loading

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
type IndexRow = [number, number, number, number, number, number, number]; // lat, lon, s, w, n, e, count
let indexP: Promise<Record<string, IndexRow>> | null = null;
let runwaysP: Promise<Record<string, RunwayRow[]>> | null = null;
const buildingsCache = new Map<string, Promise<BuildingsFile | null>>();
const groundCache = new Map<string, Promise<GroundFile | null>>();

const getJson = <T>(url: string): Promise<T | null> =>
  fetch(url)
    .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
    .catch(() => null);
function loadIndex() {
  indexP ??= getJson<{ airports: Record<string, IndexRow> }>('/data/buildings/index.json').then((j) => j?.airports ?? {});
  return indexP;
}
function loadRunways() {
  runwaysP ??= getJson<{ runways: Record<string, RunwayRow[]> }>('/data/airports/runways-major.json').then((j) => j?.runways ?? {});
  return runwaysP;
}
function loadBuildings(icao: string) {
  let p = buildingsCache.get(icao);
  if (!p) {
    p = getJson<BuildingsFile>(`/data/buildings/${icao}.json`);
    buildingsCache.set(icao, p);
  }
  return p;
}
function loadGroundFile(icao: string) {
  let p = groundCache.get(icao);
  if (!p) {
    p = getJson<GroundFile>(`/data/ground/${icao}.json`);
    groundCache.set(icao, p);
  }
  return p;
}

/** The airport whose buildings box (grown by ~1.5 km) contains the point, nearest first. */
export function airportAt(index: Record<string, IndexRow>, lat: number, lon: number): string | undefined {
  let best: string | undefined;
  let bd = Infinity;
  for (const [icao, r] of Object.entries(index)) {
    const [la, lo, s, w, n, e] = r;
    const m = 0.014;
    const mx = m / Math.cos(la * D2R);
    if (lat < s - m || lat > n + m || lon < w - mx || lon > e + mx) continue;
    const d = Math.hypot(lat - la, (lon - lo) * Math.cos(la * D2R));
    if (d < bd) {
      bd = d;
      best = icao;
    }
  }
  return best;
}

/** The airport with a runway nearest the point (within ~6 km of any runway's middle). */
function runwayAirportAt(runways: Record<string, RunwayRow[]>, lat: number, lon: number): string | undefined {
  let best: string | undefined;
  let bd = 6000;
  const k = Math.cos(lat * D2R) * M_PER_DEG;
  for (const [icao, rows] of Object.entries(runways)) {
    const r0 = rows[0];
    if (!r0 || Math.abs(r0[1] - lat) > 0.12) continue;
    for (const r of rows) {
      if (!r[1] || !r[5]) continue;
      const d = Math.hypot(((r[1] + r[5]) / 2 - lat) * M_PER_DEG, ((r[2] + r[6]) / 2 - lon) * k);
      if (d < bd) {
        bd = d;
        best = icao;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------- lights assembly

interface LightSet {
  icao: string;
  inUse: string | undefined;
  rows: RunwayRow[];
  ground: GroundFile | null;
  lat: number;
  lon: number;
  steady: GeoJSON.FeatureCollection;
  rabbit: GeoJSON.FeatureCollection;
  flood: GeoJSON.FeatureCollection;
  groups: number[][]; // rabbit feature ids per group
}

/** Heading difference in degrees (0–180). */
const hdgDiff = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

function buildLights(icao: string, rows: RunwayRow[], ground: GroundFile | null): LightSet | undefined {
  const r0 = rows.find((r) => r[1] && r[5]);
  if (!r0) return undefined;
  const lat0 = r0[1];
  const lon0 = r0[2];
  const P = localProjection(lat0, lon0);
  const inUse = simRunwayInUse(icao)?.runway;
  const inUseHdg = inUse ? rows.flatMap((r) => (r[0] === inUse ? [r[3]] : r[4] === inUse ? [r[7]] : []))[0] : undefined;
  const steady: GeoJSON.Feature[] = [];
  const flashers: Light[] = [];
  const segs: [XY, XY, number][] = [];
  const toFeature = (l: Light): GeoJSON.Feature => {
    const [lon, lat] = P.inv(l.x, l.y);
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6] }, properties: { c: l.c, r: l.r, o: l.o ?? 1 } };
  };
  for (const r of rows) {
    if (!r[1] || !r[5]) continue;
    const le = P.fwd(r[1], r[2]);
    const he = P.fwd(r[5], r[6]);
    const L = Math.hypot(he[0] - le[0], he[1] - le[1]);
    if (L < 300) continue;
    const width = L >= 3900 ? 60 : L >= 1800 ? 45 : 30;
    segs.push([le, he, width]);
    // Landing direction: the runway in use (and its parallels), else the lower-numbered end.
    const reverse = inUseHdg !== undefined && hdgDiff(r[7], inUseHdg) < hdgDiff(r[3], inUseHdg);
    const [a, b] = reverse ? [he, le] : [le, he];
    const { steady: s, flashers: f } = runwayLights(a, b, width, L >= 1800);
    for (const l of s) steady.push(toFeature(l));
    flashers.push(...f);
  }
  // Taxiway centreline (green, ~30 m) and edge lights (blue, ~60 m, named taxiways only).
  const nearRunway = (p: XY) =>
    segs.some(([a, b, w]) => {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) < w / 2 + 30;
    });
  if (ground?.nodes?.length) {
    const pts = ground.nodes.map(([la, lo]) => P.fwd(la, lo));
    for (const line of taxiPolylines(ground.nodes, ground.edges)) {
      const xy = line.pts.map((i) => pts[i]!).filter(Boolean);
      for (const q of placeAlong(xy, 30, 6)) if (!nearRunway(q.p)) steady.push(toFeature({ x: q.p[0], y: q.p[1], c: LIGHT.taxi, r: 0.55, o: 0.75 }));
      // Blue edges along named taxiways, clear of junctions (where the pavement widens).
      const len = polylineLength(xy);
      if (line.named && len > 80)
        for (const q of placeAlong(xy, 60, 30)) {
          if (q.s > len - 30) break;
          for (const sgn of [1, -1]) {
            const p: XY = [q.p[0] - q.dir[1] * 11.5 * sgn, q.p[1] + q.dir[0] * 11.5 * sgn];
            if (!nearRunway(p)) steady.push(toFeature({ x: p[0], y: p[1], c: LIGHT.blue, r: 0.5, o: 0.7 }));
          }
        }
    }
  }
  const flood: GeoJSON.Feature[] = [];
  for (const st of ground?.stands ?? []) flood.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [st[1], st[0]] }, properties: {} });
  const groups: number[][] = [[], [], [], [], []];
  const rabbit: GeoJSON.Feature[] = flashers.map((l, i) => {
    groups[l.g ?? 0]!.push(i);
    return { ...toFeature(l), id: i };
  });
  return {
    icao,
    inUse,
    rows,
    ground,
    lat: lat0,
    lon: lon0,
    steady: { type: 'FeatureCollection', features: steady },
    rabbit: { type: 'FeatureCollection', features: rabbit },
    flood: { type: 'FeatureCollection', features: flood },
    groups,
  };
}

// ---------------------------------------------------------------- map layers

const SRC_B = 'apt3d';
const SRC_L = 'apt-lights';
const SRC_R = 'apt-rabbit';
const SRC_F = 'apt-flood';
const L_BLDG = 'apt3d-bldg';
const LIGHT_LAYERS = ['apt-flood', 'apt-lights-bloom', 'apt-lights', 'apt-rabbit-bloom', 'apt-rabbit'] as const;
export const AIRPORT3D_LAYERS = [L_BLDG, ...LIGHT_LAYERS];

const state = {
  buildings: null as BuildingsFile | null,
  buildingsFor: '',
  lights: null as LightSet | null,
  lightsFor: '',
  night: 0,
  hiddenIds: [] as number[],
  rabbitOn: new Set<number>(),
  forceNight: undefined as number | undefined,
};

/** px radius for a size in metres on the ground at zoom 16 (scaled exponentially with zoom). */
function metresAtZoom(m: number, lat: number): ExpressionSpecification {
  const px16 = m / ((156_543.03 * Math.cos(lat * D2R)) / 2 ** 16);
  return ['interpolate', ['exponential', 2], ['zoom'], 10, px16 / 64, 20, px16 * 16];
}

function beforeBuildings(map: MlMap) {
  return ['stands-dot', 'disruption', 'ac-heat'].find((l) => map.getLayer(l));
}

export function installAirport3d(map: MlMap) {
  if (!map.getSource(SRC_B)) map.addSource(SRC_B, { type: 'geojson', data: EMPTY });
  if (!map.getSource(SRC_L)) map.addSource(SRC_L, { type: 'geojson', data: EMPTY });
  if (!map.getSource(SRC_R)) map.addSource(SRC_R, { type: 'geojson', data: EMPTY });
  if (!map.getSource(SRC_F)) map.addSource(SRC_F, { type: 'geojson', data: EMPTY });
  const before = beforeBuildings(map);
  // Lights first so the buildings (drawn after, with depth) hide what is behind them.
  const size = (k: number) =>
    ['interpolate', ['exponential', 1.6], ['zoom'], 10, ['*', 0.5 * k, ['get', 'r']], 13, ['*', 1.25 * k, ['get', 'r']], 15, ['*', 2.3 * k, ['get', 'r']], 17, ['*', 4.4 * k, ['get', 'r']], 19, ['*', 8.5 * k, ['get', 'r']]] as unknown as number;
  if (!map.getLayer('apt-flood'))
    map.addLayer(
      {
        id: 'apt-flood',
        type: 'circle',
        source: SRC_F,
        minzoom: 12.5,
        layout: { visibility: 'none' },
        paint: { 'circle-radius': 20, 'circle-color': LIGHT.flood, 'circle-blur': 1, 'circle-opacity': 0, 'circle-pitch-alignment': 'map', 'circle-pitch-scale': 'map' },
      },
      before,
    );
  if (!map.getLayer('apt-lights-bloom'))
    map.addLayer(
      {
        id: 'apt-lights-bloom',
        type: 'circle',
        source: SRC_L,
        minzoom: 10.5,
        layout: { visibility: 'none' },
        paint: { 'circle-radius': size(4.2), 'circle-color': ['get', 'c'], 'circle-blur': 1, 'circle-opacity': 0, 'circle-pitch-alignment': 'map' },
      },
      before,
    );
  if (!map.getLayer('apt-lights'))
    map.addLayer(
      {
        id: 'apt-lights',
        type: 'circle',
        source: SRC_L,
        minzoom: 10.5,
        layout: { visibility: 'none' },
        paint: { 'circle-radius': size(1), 'circle-color': ['get', 'c'], 'circle-blur': 0.45, 'circle-opacity': 0, 'circle-pitch-alignment': 'map' },
      },
      before,
    );
  if (!map.getLayer('apt-rabbit-bloom'))
    map.addLayer(
      {
        id: 'apt-rabbit-bloom',
        type: 'circle',
        source: SRC_R,
        minzoom: 10.5,
        layout: { visibility: 'none' },
        paint: { 'circle-radius': size(7), 'circle-color': LIGHT.flash, 'circle-blur': 1, 'circle-opacity': 0, 'circle-pitch-alignment': 'map' },
      },
      before,
    );
  if (!map.getLayer('apt-rabbit'))
    map.addLayer(
      {
        id: 'apt-rabbit',
        type: 'circle',
        source: SRC_R,
        minzoom: 10.5,
        layout: { visibility: 'none' },
        paint: { 'circle-radius': size(1.6), 'circle-color': '#ffffff', 'circle-blur': 0.3, 'circle-opacity': 0, 'circle-pitch-alignment': 'map' },
      },
      before,
    );
  if (!map.getLayer(L_BLDG))
    map.addLayer(
      {
        id: L_BLDG,
        type: 'fill-extrusion',
        source: SRC_B,
        minzoom: 13.5,
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-height': ['get', 'top'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 14.6, 0.96],
          'fill-extrusion-vertical-gradient': true,
        },
      },
      before,
    );
  // A fresh style: put the current airport's data back.
  state.hiddenIds = [];
  state.rabbitOn.clear();
  renderBuildings(map);
  renderLights(map);
  syncVisibility(map);
}

function renderBuildings(map: MlMap) {
  const src = map.getSource(SRC_B) as GeoJSONSource | undefined;
  if (!src) return;
  const b = state.buildings;
  src.setData(b ? extrusionFeatures(b.features, paletteFor(getSettings().mapStyle), state.night) : EMPTY);
  hideBasemapTwins(map);
}

/**
 * The base map's own extruded buildings ('building-3d') share our footprints with simpler
 * heights; hide exactly those (by OSM id) while our model is on screen so the two never
 * z-fight. Our polygons are also grown ~0.5 m at build time as a second line of defence.
 */
function hideBasemapTwins(map: MlMap) {
  if (!map.getLayer('building-3d')) return;
  // Independent of pitch: changing a base-map filter re-parses its tiles, so do it only when the airport changes.
  const ids = state.buildings && getSettings().show3dBuildings ? [...new Set(state.buildings.features.flatMap((f) => (f.properties.osm ? basemapIds(f.properties.osm) : [])))] : [];
  if (ids.length === state.hiddenIds.length && ids.every((v, i) => v === state.hiddenIds[i])) return;
  state.hiddenIds = ids;
  map.setFilter('building-3d', ids.length ? (['!', ['in', ['id'], ['literal', ids]]] as FilterSpecification) : null);
}

function renderLights(map: MlMap) {
  const l = state.lights;
  (map.getSource(SRC_L) as GeoJSONSource | undefined)?.setData(l?.steady ?? EMPTY);
  if (map.getSource(SRC_R)) map.removeFeatureState({ source: SRC_R });
  (map.getSource(SRC_R) as GeoJSONSource | undefined)?.setData(l?.rabbit ?? EMPTY);
  (map.getSource(SRC_F) as GeoJSONSource | undefined)?.setData(l?.flood ?? EMPTY);
  state.rabbitOn.clear();
  if (l && map.getLayer('apt-flood')) map.setPaintProperty('apt-flood', 'circle-radius', metresAtZoom(55, l.lat));
}

const buildingsShown = (map: MlMap) => getSettings().show3dBuildings && map.getPitch() > 15;

function syncVisibility(map: MlMap) {
  if (map.getLayer(L_BLDG)) map.setLayoutProperty(L_BLDG, 'visibility', buildingsShown(map) && state.buildings ? 'visible' : 'none');
  hideBasemapTwins(map);
  const f = state.night;
  const on = f > 0.02 && !!state.lights;
  for (const id of LIGHT_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  if (!on) return;
  const ease = f * f * (3 - 2 * f);
  map.setPaintProperty('apt-lights', 'circle-opacity', ['*', ease, ['get', 'o']]);
  map.setPaintProperty('apt-lights-bloom', 'circle-opacity', ['*', 0.42 * ease, ['get', 'o']]);
  map.setPaintProperty('apt-flood', 'circle-opacity', 0.16 * ease);
  map.setPaintProperty('apt-rabbit', 'circle-opacity', ['case', ['boolean', ['feature-state', 'on'], false], ease, 0]);
  map.setPaintProperty('apt-rabbit-bloom', 'circle-opacity', ['case', ['boolean', ['feature-state', 'on'], false], 0.85 * ease, 0]);
}

/** Night factor at a point from the simulated sun (or the dev override). */
function nightAt(lat: number, lon: number) {
  if (state.forceNight !== undefined) return state.forceNight;
  return nightFactor(solarElevation(lat, lon, subsolarPoint(simNow())));
}

// ---------------------------------------------------------------- binding

export function bindAirport3d(map: MlMap): () => void {
  let disposed = false;
  let rabbitTimer: ReturnType<typeof setInterval> | undefined;
  let lastNightRender = -1;

  const update = async () => {
    const z = map.getZoom();
    const c = map.getCenter();
    // Buildings: the airport whose box we are in, once zoomed in close.
    if (z >= 13.5) {
      const icao = airportAt(await loadIndex(), c.lat, c.lng);
      if (disposed) return;
      if (icao && icao !== state.buildingsFor) {
        state.buildingsFor = icao;
        const b = await loadBuildings(icao);
        if (disposed || state.buildingsFor !== icao) return;
        state.buildings = b;
        renderBuildings(map);
      } else if (!icao && state.buildingsFor) {
        state.buildingsFor = '';
        state.buildings = null;
        renderBuildings(map);
      }
    }
    // Lights: the airport with a runway nearest the centre, from zoom 10.5.
    if (z >= 10.5) {
      const runways = await loadRunways();
      if (disposed) return;
      const icao = runwayAirportAt(runways, c.lat, c.lng);
      if (icao && icao !== state.lightsFor) {
        state.lightsFor = icao;
        const rows = runways[icao] ?? [];
        const ground = await loadGroundFile(icao);
        if (disposed || state.lightsFor !== icao) return;
        state.lights = buildLights(icao, rows, ground) ?? null;
        renderLights(map);
      }
    }
    refreshNight();
  };

  const refreshNight = () => {
    // The simulated runway in use changed: turn the lights round.
    const was = state.lights;
    if (was && simRunwayInUse(was.icao)?.runway !== was.inUse) {
      state.lights = buildLights(was.icao, was.rows, was.ground) ?? null;
      renderLights(map);
    }
    const l = state.lights;
    const ref = l ?? (state.buildings ? { lat: state.buildings.center[0], lon: state.buildings.center[1] } : null);
    state.night = ref ? nightAt(ref.lat, ref.lon) : 0;
    // Lit windows warm the buildings at night: re-colour when the light level moves.
    if (state.buildings && Math.abs(state.night - lastNightRender) > 0.1) {
      lastNightRender = state.night;
      renderBuildings(map);
    }
    syncVisibility(map);
    syncRabbit();
  };

  const tickRabbit = () => {
    const l = state.lights;
    if (!l || !map.getSource(SRC_R)) return;
    // Two sweeps a second: five groups, 100 ms each, running toward the threshold.
    const phase = Math.floor(Date.now() / 100) % 5;
    const want = new Set(l.groups[phase] ?? []);
    for (const id of state.rabbitOn) if (!want.has(id)) map.setFeatureState({ source: SRC_R, id }, { on: false });
    for (const id of want) if (!state.rabbitOn.has(id)) map.setFeatureState({ source: SRC_R, id }, { on: true });
    state.rabbitOn = want;
  };
  const syncRabbit = () => {
    const l = state.lights;
    const b = map.getBounds();
    // Only while the airport is (nearly) on screen, lit, and the tab is visible.
    const near = !!l && l.lat > b.getSouth() - 0.05 && l.lat < b.getNorth() + 0.05 && l.lon > b.getWest() - 0.08 && l.lon < b.getEast() + 0.08;
    const run = near && state.night > 0.02 && !!l?.rabbit.features.length && map.getZoom() >= 10.5 && !document.hidden;
    if (run && !rabbitTimer) rabbitTimer = setInterval(tickRabbit, 100);
    else if (!run && rabbitTimer) {
      clearInterval(rabbitTimer);
      rabbitTimer = undefined;
    }
  };

  const onMove = () => void update();
  const onPitch = () => syncVisibility(map);
  const onVis = () => syncRabbit();
  map.on('moveend', onMove);
  map.on('pitch', onPitch);
  map.on('pitchend', onPitch);
  document.addEventListener('visibilitychange', onVis);
  const nightTimer = setInterval(refreshNight, 15_000);
  const unsub = useSettings.subscribe((s, p) => {
    if (s.show3dBuildings !== p.show3dBuildings) syncVisibility(map);
  });
  if (import.meta.env.DEV) {
    const dev = (window as unknown as { __arnav?: Record<string, unknown> }).__arnav;
    if (dev)
      dev.airport3d = {
        /** Forces the light level (0 day … 1 night); undefined returns to the simulated sun. */
        forceNight: (v?: number) => {
          state.forceNight = v;
          lastNightRender = -1;
          refreshNight();
        },
        state,
      };
  }
  void update();
  return () => {
    disposed = true;
    map.off('moveend', onMove);
    map.off('pitch', onPitch);
    map.off('pitchend', onPitch);
    document.removeEventListener('visibilitychange', onVis);
    clearInterval(nightTimer);
    if (rabbitTimer) clearInterval(rabbitTimer);
    unsub();
    state.buildingsFor = '';
    state.lightsFor = '';
  };
}
