// Airport surface detail, drawn when the map is zoomed in on an airport (zoom ≥ 12.5) so it
// reads like an airport diagram / flight-simulator scenery:
//   • Runways — asphalt with shoulders, white side stripes, ICAO Annex 14 threshold "piano
//     keys" (stripe count by runway width), designators painted at each end (rotated to read
//     from the approach), dashed centreline, touchdown-zone and aiming-point markings, and
//     displaced-threshold arrows. Geometry: OurAirports runway ends, widths and displaced
//     thresholds (public domain).
//   • Taxiways — pavement bands and yellow centre lines (with a dark outline so they read on
//     imagery) from the OpenStreetMap taxiway graph, runway-holding-position markings (two
//     solid + two dashed lines, dashed side toward the runway) at OSM holding positions.
//   • Signs — mandatory runway signs (white on red, e.g. "27L-09R") at runway holds, taxiway
//     location signs (yellow on black) and direction signs (black on yellow, with arrows) at
//     intersections, drawn upright as billboards.
//   • Stands — yellow lead-in lines with stop bars and painted stand numbers.
// Map data © OpenStreetMap contributors (ODbL). Everything here is static scenery; nothing is live.
//
// Loaded lazily (its own chunk) the first time the map is zoomed in close.

import type * as GeoJSON from 'geojson';
import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import type { AirportDetail } from '@shared/types';
import { loadMajorAirports } from '@/data/airports';
import { loadGround } from '@/data/world';
import { api } from '@/lib/api';
import { getSettings, useSettings, type MapStyleId } from '@/state/settings';

// ---------------------------------------------------------------- types

export type XY = [number, number];
type Ring = XY[];

export interface RunwayEndInput {
  id: string;
  lat: number;
  lon: number;
  /** Displaced threshold, metres from the pavement end. */
  disp: number;
}
export interface RunwayInput {
  a: RunwayEndInput;
  b: RunwayEndInput;
  /** Metres. */
  width: number;
}
/** /data/ground/<ICAO>.json (OpenStreetMap, ODbL). */
export interface GroundFile {
  nodes: [number, number][];
  edges: [number, number, number?][];
  names?: string[];
  holds?: [number, number, string][];
  stands?: [number, number, string?, (number | null)?, ...unknown[]][];
}
export interface SurfaceData {
  lines: GeoJSON.Feature[];
  polys: GeoJSON.Feature[];
  pts: GeoJSON.Feature[];
}

// ---------------------------------------------------------------- geometry helpers (unit-tested)

const D2R = Math.PI / 180;
const M_PER_DEG = 111_320;
/** Metres per pixel at zoom 0 on the equator (512 px tiles). */
const M_PER_PX_Z0 = 40_075_016.686 / 512;

/** Pixels per metre at zoom 0 at a latitude; × 2^zoom gives pixels per metre at that zoom. */
export const pxPerMetreZ0 = (lat: number) => 1 / (M_PER_PX_Z0 * Math.cos(lat * D2R));

/** Local metric projection (metres east / north) around a reference point. */
export function localFrame(lat0: number, lon0: number) {
  const k = Math.cos(lat0 * D2R) * M_PER_DEG;
  return {
    fwd: (lat: number, lon: number): XY => [(lon - lon0) * k, (lat - lat0) * M_PER_DEG],
    inv: (x: number, y: number): XY => [Math.round((lon0 + x / k) * 1e7) / 1e7, Math.round((lat0 + y / M_PER_DEG) * 1e7) / 1e7], // [lon, lat]
  };
}

const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const len = (a: XY) => Math.hypot(a[0], a[1]);
const unit = (a: XY): XY => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
const dot = (a: XY, b: XY) => a[0] * b[0] + a[1] * b[1];
const cross = (a: XY, b: XY) => a[0] * b[1] - a[1] * b[0];
/** Left normal (90° counter-clockwise). */
const left = (u: XY): XY => [-u[1], u[0]];
/** Compass bearing (degrees, clockwise from north) of a local direction. */
export const bearingOf = (u: XY) => ((Math.atan2(u[0], u[1]) / D2R) + 360) % 360;

/** Signed area (positive = counter-clockwise). */
export function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j]![0] - r[i]![0]) * (r[j]![1] + r[i]![1]);
  return a / 2;
}
/** Counter-clockwise copy of a ring (GeoJSON outer-ring winding, so tiled polygons never turn into holes). */
export const ccw = (r: Ring): Ring => (ringArea(r) < 0 ? [...r].reverse() : r);

/**
 * Threshold-marking stripes (ICAO Annex 14 §5.2.4): 4 / 6 / 8 / 12 / 16 stripes for runways
 * 18 / 23 / 30 / 45 / 60 m wide, reaching to 3 m from each edge (or 27 m from the centre line),
 * stripes and spaces equal, with a double space either side of the centre line.
 * Returns each stripe's lateral centre (metres left of the centre line) and the stripe width.
 */
export function thresholdStripes(width: number): { offsets: number[]; w: number } {
  const n = width >= 60 ? 16 : width >= 45 ? 12 : width >= 30 ? 8 : width >= 23 ? 6 : 4;
  const half = Math.min(width / 2 - 3, 27);
  const per = n / 2;
  const w = half / (2 * per);
  const offsets: number[] = [];
  for (let i = 0; i < per; i++) {
    const c = w * 1.5 + i * 2 * w; // first stripe starts one stripe-width off the centre line
    offsets.push(c, -c);
  }
  offsets.sort((a, b) => a - b);
  return { offsets, w };
}

/** Rectangle [σ0, σ1] × [τ0, τ1] in an end's runway coordinates. */
type Box = [number, number, number, number];

export interface EndMarkings {
  boxes: Box[];
  arrows: Ring[];
  /** Designator block centre (σ). */
  desig: number;
  /** Where the centre line may start (σ). */
  clStart: number;
}

/**
 * Painted markings for one runway end in its own coordinates: σ metres from the pavement end
 * along the landing direction, τ metres left of the centre line. `L` is the runway length,
 * `W` its width, `T` the displaced threshold and `letter` whether the designator has an L/C/R.
 */
export function endMarkings(L: number, W: number, T: number, letter: boolean): EndMarkings {
  const boxes: Box[] = [];
  const arrows: Ring[] = [];
  const lda = L - T;
  // Displaced threshold: transverse bar plus arrows pointing at it along the centre line.
  if (T >= 30) {
    boxes.push([T - 1.8, T, -W / 2 + 1, W / 2 - 1]);
    for (let s = T - 40; s >= 10; s -= 80) {
      arrows.push([
        [s, -0.5],
        [s + 18, -0.5],
        [s + 18, -2.6],
        [s + 30, 0],
        [s + 18, 2.6],
        [s + 18, 0.5],
        [s, 0.5],
      ]);
    }
  }
  // Threshold "piano keys", 30 m long starting 6 m in.
  const { offsets, w } = thresholdStripes(W);
  for (const o of offsets) boxes.push([T + 6, T + 36, o - w / 2, o + w / 2]);
  // Designator: 12 m after the stripes (block ≈ 9 m numbers, + letter line).
  const block = letter ? 23 : 9;
  const desig = T + 48 + block / 2;
  const clStart = T + 48 + block + 12;
  if (lda >= 1200 && W >= 23) {
    // Aiming point and touchdown zone (Annex 14 Tables 5-1 / 5-2).
    const aimAt = lda >= 2400 ? 400 : lda >= 1500 ? 300 : 250;
    const aimLen = lda >= 2400 ? 60 : 45;
    const aimW = lda >= 2400 && W >= 45 ? 10 : 6;
    const inner = Math.max(3, Math.min(10, W / 2 - aimW - 2.5));
    for (const sg of [1, -1]) boxes.push([T + aimAt, T + aimAt + aimLen, sg > 0 ? inner : -inner - aimW, sg > 0 ? inner + aimW : -inner]);
    const pairs = lda >= 2400 ? 6 : lda >= 1500 ? 4 : 3;
    const stations = [150, 300, 450, 600, 750, 900, 1050].filter((s) => s + 22.5 < aimAt - 10 || s > aimAt + aimLen + 10).slice(0, pairs);
    const bars = [3, 3, 2, 2, 1, 1];
    stations.forEach((s, i) => {
      for (let b = 0; b < bars[i]!; b++) {
        const t0 = inner + b * 3.3;
        if (t0 + 1.8 > W / 2 - 2) break;
        boxes.push([T + s, T + s + 22.5, t0, t0 + 1.8], [T + s, T + s + 22.5, -t0 - 1.8, -t0]);
      }
    });
  }
  return { boxes, arrows, desig, clStart };
}

/** Centre-line dashes (30 m painted, 20 m gap) from σ0 to σ1. */
export function centrelineDashes(s0: number, s1: number, width = 0.9): Box[] {
  const out: Box[] = [];
  for (let s = s0; s + 10 <= s1; s += 50) out.push([s, Math.min(s + 30, s1), -width / 2, width / 2]);
  return out;
}

/** A rectangle in a runway / taxiway frame. */
export interface Frame {
  o: XY;
  u: XY;
  s0: number;
  s1: number;
  t0: number;
  t1: number;
}

/**
 * The parts of segment a→b that lie outside every frame rectangle (Liang–Barsky per rectangle,
 * intervals subtracted from [0, 1]). Pieces shorter than `minLen` metres are dropped.
 */
export function clipOutside(a: XY, b: XY, frames: Frame[], minLen = 0.5): [XY, XY][] {
  let keep: [number, number][] = [[0, 1]];
  const d = sub(b, a);
  for (const f of frames) {
    const n = left(f.u);
    const p0 = sub(a, f.o);
    const ps: [number, number] = [dot(p0, f.u), dot(p0, n)];
    const ds: [number, number] = [dot(d, f.u), dot(d, n)];
    let lo = 0;
    let hi = 1;
    const lims: [number, number, number, number][] = [
      [ps[0], ds[0], f.s0, f.s1],
      [ps[1], ds[1], f.t0, f.t1],
    ];
    let empty = false;
    for (const [p, dd, mn, mx] of lims) {
      if (Math.abs(dd) < 1e-12) {
        if (p < mn || p > mx) empty = true;
        continue;
      }
      let t0 = (mn - p) / dd;
      let t1 = (mx - p) / dd;
      if (t0 > t1) [t0, t1] = [t1, t0];
      lo = Math.max(lo, t0);
      hi = Math.min(hi, t1);
    }
    if (empty || lo >= hi) continue;
    const next: [number, number][] = [];
    for (const [k0, k1] of keep) {
      if (hi <= k0 || lo >= k1) next.push([k0, k1]);
      else {
        if (lo > k0) next.push([k0, lo]);
        if (hi < k1) next.push([hi, k1]);
      }
    }
    keep = next;
  }
  const L = len(d);
  return keep
    .filter(([k0, k1]) => (k1 - k0) * L >= minLen)
    .map(([k0, k1]) => [
      [a[0] + d[0] * k0, a[1] + d[1] * k0],
      [a[0] + d[0] * k1, a[1] + d[1] * k1],
    ]);
}

/**
 * Runway-holding-position marking (pattern A) across a taxiway at `h`, `f` the unit direction
 * toward the runway: two solid lines on the taxiway side and two dashed lines on the runway
 * side. `half` is the taxiway half-width. Line weights are exaggerated ~3× (real: 0.15 m) so
 * they read on screen. Returns yellow rings and one dark backing ring.
 */
export function holdMarking(h: XY, f: XY, half: number, runway: boolean): { yellow: Ring[]; backing: Ring } {
  const l = left(f);
  const at = (along: number, across: number): XY => [h[0] + f[0] * along + l[0] * across, h[1] + f[1] * along + l[1] * across];
  const rect = (a0: number, a1: number, c0: number, c1: number): Ring => ccw([at(a0, c0), at(a1, c0), at(a1, c1), at(a0, c1)]);
  const yellow: Ring[] = [];
  const th = 0.9;
  const dashed = (centre: number, dash: number, gap: number) => {
    for (let c = -half; c < half - 0.3; c += dash + gap) yellow.push(rect(centre - th / 2, centre + th / 2, c, Math.min(c + dash, half)));
  };
  if (runway) {
    const centres = [-2.25, -0.75, 0.75, 2.25]; // from the taxiway side to the runway side
    for (const c of centres.slice(0, 2)) yellow.push(rect(c - th / 2, c + th / 2, -half, half));
    for (const c of centres.slice(2)) dashed(c, 2.4, 1.2);
    return { yellow, backing: rect(-3.4, 3.4, -half - 0.6, half + 0.6) };
  }
  // Intermediate holding position: a single dashed line.
  dashed(0, 1.5, 1);
  return { yellow, backing: rect(-1.2, 1.2, -half - 0.4, half + 0.4) };
}

/** Distance from p to segment a–b, with the closest point and its fraction along the segment. */
export function nearestOnSegment(p: XY, a: XY, b: XY): { d: number; q: XY; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  const q: XY = [a[0] + ab[0] * t, a[1] + ab[1] * t];
  return { d: len(sub(p, q)), q, t };
}

/**
 * Text of the mandatory sign at a runway holding position. Facing the runway (`f`), the
 * designator of the threshold on the left comes first ("27L-09R"); near (or beyond) a runway
 * end only that end's designator is shown.
 */
export function runwaySignText(h: XY, f: XY, a: XY, b: XY, idA: string, idB: string): string {
  const L = len(sub(b, a));
  const along = dot(sub(h, a), unit(sub(b, a)));
  if (along < 60) return idA;
  if (along > L - 60) return idB;
  const l = left(f);
  return dot(sub(a, h), l) > dot(sub(b, h), l) ? `${idA}-${idB}` : `${idB}-${idA}`;
}

/** Turn angle (degrees; negative = left, positive = right) from heading `a` to heading `b`. */
export function turnAngle(a: XY, b: XY): number {
  return -Math.atan2(cross(a, b), dot(a, b)) / D2R;
}

/** Arrow quantised to 45° for a direction sign, or undefined for a U-turn. */
export function signArrow(angle: number): number | undefined {
  if (Math.abs(angle) > 157.5) return undefined;
  return Math.round(angle / 45) * 45;
}

/**
 * The sign array for an aircraft on taxiway `here` approaching a junction: direction signs for
 * the other taxiways (left turns left of the location sign, right turns right of it), e.g.
 * "D~B~-90|L~A|D~C~45". Returns undefined when nothing branches off.
 */
export function directionSignSpec(here: string, branches: { name: string; angle: number }[]): string | undefined {
  const best = new Map<string, number>();
  for (const b of branches) {
    if (!b.name || b.name === here) continue;
    const arrow = signArrow(b.angle);
    if (arrow === undefined) continue;
    const prev = best.get(b.name);
    if (prev === undefined || Math.abs(arrow) < Math.abs(prev)) best.set(b.name, arrow);
  }
  if (!best.size) return undefined;
  const list = [...best].sort((x, y) => x[1] - y[1] || x[0].localeCompare(y[0]));
  const lefts = list.filter(([, a]) => a <= 0).map(([n, a]) => `D~${n}~${a}`);
  const rights = list.filter(([, a]) => a > 0).map(([n, a]) => `D~${n}~${a}`);
  return [...lefts, `L~${here}`, ...rights].join('|');
}

/** Taxiway graph → chains of one name, split at junctions, dead ends and name changes. */
export function namedChains(edges: [number, number, number?][], names: string[] = []): { pts: number[]; name: string }[] {
  const adj = new Map<number, { to: number; e: number }[]>();
  edges.forEach(([x, y], e) => {
    if (x === y) return;
    if (!adj.has(x)) adj.set(x, []);
    if (!adj.has(y)) adj.set(y, []);
    adj.get(x)!.push({ to: y, e });
    adj.get(y)!.push({ to: x, e });
  });
  const nm = (e: number) => {
    const i = edges[e]![2] ?? -1;
    return i >= 0 ? (names[i] ?? '') : '';
  };
  const used = new Uint8Array(edges.length);
  const out: { pts: number[]; name: string }[] = [];
  const deg = (v: number) => adj.get(v)?.length ?? 0;
  const walk = (start: number, first: { to: number; e: number }) => {
    const name = nm(first.e);
    const pts = [start];
    let cur = first;
    for (;;) {
      used[cur.e] = 1;
      pts.push(cur.to);
      if (deg(cur.to) !== 2) break;
      const nxt = adj.get(cur.to)!.find((x) => !used[x.e]);
      if (!nxt || nm(nxt.e) !== name) break;
      cur = nxt;
    }
    out.push({ pts, name });
  };
  const isBreak = (v: number) => {
    const l = adj.get(v)!;
    return l.length !== 2 || nm(l[0]!.e) !== nm(l[1]!.e);
  };
  for (const [v, list] of adj) if (isBreak(v)) for (const x of list) if (!used[x.e]) walk(v, x);
  for (const [v, list] of adj) for (const x of list) if (!used[x.e]) walk(v, x);
  return out;
}

/** Point and direction `dist` metres along a polyline (clamped to its ends). */
export function pointAlong(line: XY[], dist: number): { p: XY; dir: XY } {
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const l = len(sub(b, a));
    if (l < 1e-9) continue;
    if (acc + l >= dist) {
      const t = (dist - acc) / l;
      return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir: unit(sub(b, a)) };
    }
    acc += l;
  }
  const n = line.length;
  return { p: line[n - 1]!, dir: n > 1 ? unit(sub(line[n - 1]!, line[n - 2]!)) : [0, 1] };
}

export const lineLength = (line: XY[]) => line.reduce((s, p, i) => (i ? s + len(sub(p, line[i - 1]!)) : 0), 0);

/** Cubic Bézier sampled into `n` segments. */
export function bezier(p0: XY, p1: XY, p2: XY, p3: XY, n = 10): XY[] {
  const out: XY[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const m = 1 - t;
    const a = m * m * m;
    const b = 3 * m * m * t;
    const c = 3 * m * t * t;
    const d = t * t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
  }
  return out;
}

type NearestTaxi = (p: XY, maxD: number) => { q: XY; dir: XY } | undefined | null;

/**
 * Lead-in line for a stand mapped as an OpenStreetMap parking_position way: `p` is the way's
 * midpoint and `hdg` its drawn direction, which mappers use both ways round — so the end
 * nearer a taxilane is taken as the entry. The line curves off the taxilane (tangent to it),
 * runs through `p` and ends at the stop position, the mirror of the entry point.
 */
export function standLeadIn(p: XY, hdg: number, nearestTaxi: NearestTaxi): { path: XY[]; stopBar: XY[]; label: XY; h: XY } {
  let h: XY = [Math.sin(hdg * D2R), Math.cos(hdg * D2R)];
  const back = nearestTaxi([p[0] - h[0] * 35, p[1] - h[1] * 35], 60);
  const fwd = nearestTaxi([p[0] + h[0] * 35, p[1] + h[1] * 35], 60);
  const dist = (n: { q: XY } | undefined | null, q: XY) => (n ? len(sub(n.q, q)) : Infinity);
  if (dist(fwd, [p[0] + h[0] * 35, p[1] + h[1] * 35]) < dist(back, [p[0] - h[0] * 35, p[1] - h[1] * 35])) h = [-h[0], -h[1]];
  const entry = nearestTaxi([p[0] - h[0] * 25, p[1] - h[1] * 25], 70);
  const along = entry ? dot(sub(p, entry.q), h) : 0;
  const half = entry && along > 8 ? Math.min(60, along) : 25;
  const stop: XY = [p[0] + h[0] * half, p[1] + h[1] * half];
  const path: XY[] = [];
  if (entry && along > 8 && len(sub(entry.q, p)) < 90) {
    let t = entry.dir;
    if (dot(t, sub(p, entry.q)) < 0) t = [-t[0], -t[1]];
    const k = len(sub(p, entry.q)) * 0.5;
    path.push(...bezier(entry.q, [entry.q[0] + t[0] * k, entry.q[1] + t[1] * k], [p[0] - h[0] * k, p[1] - h[1] * k], p, 10));
  } else path.push([p[0] - h[0] * half, p[1] - h[1] * half], p);
  path.push(stop);
  const n = left(h);
  return {
    path,
    stopBar: [
      [stop[0] + n[0] * 2.5, stop[1] + n[1] * 2.5],
      [stop[0] - n[0] * 2.5, stop[1] - n[1] * 2.5],
    ],
    label: [p[0] - h[0] * half * 0.35, p[1] - h[1] * half * 0.35],
    h,
  };
}

/** Uniform-grid index of segments for nearest-segment queries. */
class SegIndex {
  private cells = new Map<string, number[]>();
  constructor(
    private segs: [XY, XY][],
    private size = 80,
  ) {
    segs.forEach(([a, b], i) => {
      const x0 = Math.floor(Math.min(a[0], b[0]) / size);
      const x1 = Math.floor(Math.max(a[0], b[0]) / size);
      const y0 = Math.floor(Math.min(a[1], b[1]) / size);
      const y1 = Math.floor(Math.max(a[1], b[1]) / size);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) return; // absurdly long edge: skip
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const k = `${x},${y}`;
          let c = this.cells.get(k);
          if (!c) this.cells.set(k, (c = []));
          c.push(i);
        }
    });
  }
  nearest(p: XY, maxD: number): { i: number; d: number; q: XY } | undefined {
    const r = Math.ceil(maxD / this.size);
    const cx = Math.floor(p[0] / this.size);
    const cy = Math.floor(p[1] / this.size);
    let best: { i: number; d: number; q: XY } | undefined;
    const seen = new Set<number>();
    for (let x = cx - r; x <= cx + r; x++)
      for (let y = cy - r; y <= cy + r; y++)
        for (const i of this.cells.get(`${x},${y}`) ?? []) {
          if (seen.has(i)) continue;
          seen.add(i);
          const [a, b] = this.segs[i]!;
          const n = nearestOnSegment(p, a, b);
          if (n.d <= maxD && (!best || n.d < best.d)) best = { i, d: n.d, q: n.q };
        }
    return best;
  }
}

// ---------------------------------------------------------------- airport assembly

const TAXI_HALF = 11.5; // 23 m code-E taxiway
const MAX_SIGNS = 360;
const MAX_STANDS = 700;

/**
 * All surface features for one airport. Lines carry `k` ('pave' | 'tcl' | 'lead'), polygons
 * `k` ('shoulder' | 'rwy' | 'white' | 'holdbg' | 'hold'), points `k` ('desig' | 'standno' |
 * 'sign'). Every feature carries `m0` (pixels per metre at zoom 0) for metric sizing.
 */
export function buildAirportSurface(ref: { lat: number; lon: number }, runways: RunwayInput[], ground: GroundFile | null): SurfaceData {
  const P = localFrame(ref.lat, ref.lon);
  const m0 = pxPerMetreZ0(ref.lat);
  const lines: GeoJSON.Feature[] = [];
  const polys: GeoJSON.Feature[] = [];
  const pts: GeoJSON.Feature[] = [];
  const ll = (p: XY) => P.inv(p[0], p[1]);
  const poly = (k: string, rings: Ring[]) => {
    if (!rings.length) return;
    polys.push({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: rings.map((r) => [[...r, r[0]!].map(ll)]) }, properties: { k, m0 } });
  };
  const line = (k: string, xy: XY[], props: Record<string, unknown> = {}) => {
    if (xy.length < 2) return;
    lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: xy.map(ll) }, properties: { k, m0, ...props } });
  };
  const point = (k: string, p: XY, props: Record<string, unknown>) => {
    pts.push({ type: 'Feature', geometry: { type: 'Point', coordinates: ll(p) }, properties: { k, m0, ...props } });
  };

  // ---- runways
  interface Rw {
    a: XY;
    b: XY;
    u: XY;
    L: number;
    W: number;
    idA: string;
    idB: string;
  }
  const rws: Rw[] = [];
  const rwyFrames: Frame[] = [];
  const shoulders: Ring[] = [];
  const asphalt: Ring[] = [];
  const white: Ring[] = [];
  for (const r of runways) {
    const a = P.fwd(r.a.lat, r.a.lon);
    const b = P.fwd(r.b.lat, r.b.lon);
    const L = len(sub(b, a));
    if (L < 250 || L > 6000) continue;
    const W = Math.max(15, Math.min(80, r.width));
    const u = unit(sub(b, a));
    const n = left(u);
    const at = (s: number, t: number): XY => [a[0] + u[0] * s + n[0] * t, a[1] + u[1] * s + n[1] * t];
    const box = ([s0, s1, t0, t1]: Box): Ring => ccw([at(s0, t0), at(s1, t0), at(s1, t1), at(s0, t1)]);
    rws.push({ a, b, u, L, W, idA: r.a.id, idB: r.b.id });
    rwyFrames.push({ o: a, u, s0: -4, s1: L + 4, t0: -W / 2 - 1, t1: W / 2 + 1 });
    if (W >= 40) shoulders.push(box([-2, L + 2, -W / 2 - 7.5, W / 2 + 7.5]));
    asphalt.push(box([0, L, -W / 2, W / 2]));
    // Side stripes along the whole runway.
    const edge = W >= 30 ? 0.9 : 0.6;
    white.push(box([0, L, W / 2 - 0.6 - edge, W / 2 - 0.6]), box([0, L, -W / 2 + 0.6, -W / 2 + 0.6 + edge]));
    const ends = [
      { id: r.a.id, T: Math.max(0, Math.min(r.a.disp, L / 3)), map: (s: number, t: number): [number, number] => [s, t], rot: bearingOf(u) },
      { id: r.b.id, T: Math.max(0, Math.min(r.b.disp, L / 3)), map: (s: number, t: number): [number, number] => [L - s, -t], rot: bearingOf([-u[0], -u[1]]) },
    ];
    const cl: [number, number] = [0, L];
    ends.forEach((e, i) => {
      const letter = /[LCR]$/.test(e.id);
      const m = endMarkings(L, W, e.T, letter);
      for (const [s0, s1, t0, t1] of m.boxes) {
        const [x0, y0] = e.map(s0, t0);
        const [x1, y1] = e.map(s1, t1);
        white.push(box([Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)]));
      }
      for (const ar of m.arrows) white.push(ccw(ar.map(([s, t]) => at(...e.map(s, t)))));
      const [ds, dt] = e.map(m.desig, 0);
      const num = e.id.replace(/[LCR]$/, '');
      point('desig', at(ds, dt), { text: letter ? `${num}\n${e.id.slice(-1)}` : num, rot: Math.round(e.rot * 10) / 10 });
      if (i === 0) cl[0] = m.clStart;
      else cl[1] = L - m.clStart;
    });
    for (const bx of centrelineDashes(cl[0], cl[1], W >= 30 ? 0.9 : 0.6)) white.push(box(bx));
  }
  poly('shoulder', shoulders);
  poly('rwy', asphalt);
  poly('white', white);

  // ---- taxiways
  if (ground?.nodes?.length && ground.edges?.length) {
    const xy = ground.nodes.map(([la, lo]) => P.fwd(la, lo));
    const chains = namedChains(ground.edges, ground.names).map((c) => ({ ...c, xy: c.pts.map((i) => xy[i]!).filter(Boolean) })).filter((c) => c.xy.length >= 2);
    const segs: [XY, XY][] = [];
    for (const c of chains) {
      const named = !!c.name;
      line('pave', c.xy, { w: named ? 23 : 18, name: named && c.name.length <= 8 ? c.name : '' });
      for (let i = 1; i < c.xy.length; i++) segs.push([c.xy[i - 1]!, c.xy[i]!]);
      // Centre line, interrupted where it crosses a runway; kept where it leads on/off at a shallow
      // angle (lead-off lines), but not where a mapped way simply runs along the runway.
      let run: XY[] = [];
      const flush = () => {
        if (run.length >= 2) line('tcl', run);
        run = [];
      };
      for (let i = 1; i < c.xy.length; i++) {
        const a = c.xy[i - 1]!;
        const b = c.xy[i]!;
        const d = unit(sub(b, a));
        const segLen = len(sub(b, a));
        const frames = rwyFrames.filter((f) => {
          const c = Math.abs(dot(d, f.u));
          return c < 0.77 || (c > 0.99 && segLen > 40);
        });
        const pieces = frames.length ? clipOutside(a, b, frames) : [[a, b] as [XY, XY]];
        for (const [p, q] of pieces) {
          const last = run[run.length - 1];
          if (!last || len(sub(last, p)) > 0.05) {
            flush();
            run.push(p);
          }
          run.push(q);
        }
        if (!pieces.length || len(sub(pieces[pieces.length - 1]![1], b)) > 0.05) flush();
      }
      flush();
    }
    const index = new SegIndex(segs);

    // ---- holding positions and mandatory signs
    let signs = 0;
    const signAt: XY[] = [];
    const addSign = (p: XY, img: string, pri: number) => {
      if (signs >= MAX_SIGNS || signAt.some((q) => len(sub(p, q)) < 14)) return;
      signs++;
      signAt.push(p);
      point('sign', p, { img: `sgn:${img}`, pri });
    };
    const holdYellow: Ring[] = [];
    const holdBack: Ring[] = [];
    for (const [la, lo, refRaw] of ground.holds ?? []) {
      const h = P.fwd(la, lo);
      const near = index.nearest(h, 30);
      if (!near) continue;
      const [sa, sb] = segs[near.i]!;
      let f = unit(sub(sb, sa));
      // Nearest runway (distance from its centre line, clamped to its ends).
      let best: { rw: Rw; d: number; q: XY } | undefined;
      for (const rw of rws) {
        const n = nearestOnSegment(h, rw.a, rw.b);
        if (!best || n.d - rw.W / 2 < best.d - best.rw.W / 2) best = { rw, d: n.d, q: n.q };
      }
      const toRunway = !!best && best.d - best.rw.W / 2 < 230 && best.d > best.rw.W / 2 + 5;
      if (best && toRunway && dot(f, sub(best.q, h)) < 0) f = [-f[0], -f[1]];
      const m = holdMarking(h, f, TAXI_HALF, toRunway);
      holdYellow.push(...m.yellow);
      holdBack.push(m.backing);
      if (best && toRunway) {
        const text = runwaySignText(h, f, best.rw.a, best.rw.b, best.rw.idA, best.rw.idB);
        const ref = (refRaw ?? '').trim();
        const l = left(f);
        const spec = ref && ref.length <= 5 && !text.includes(ref) ? `M~${text}|L~${ref}` : `M~${text}`;
        addSign([h[0] + l[0] * (TAXI_HALF + 9) - f[0] * 4, h[1] + l[1] * (TAXI_HALF + 9) - f[1] * 4], spec, 0);
      }
    }
    poly('holdbg', holdBack);
    poly('hold', holdYellow);

    // ---- direction and location signs at junctions
    const degree = new Map<number, number>();
    for (const [x, y] of ground.edges) {
      if (x === y) continue;
      degree.set(x, (degree.get(x) ?? 0) + 1);
      degree.set(y, (degree.get(y) ?? 0) + 1);
    }
    interface Arm {
      name: string;
      out: XY; // direction leaving the junction along the chain
      line: XY[]; // chain points starting at the junction
      len: number;
    }
    const arms = new Map<number, Arm[]>();
    for (const c of chains) {
      const L = lineLength(c.xy);
      if (L < 8) continue;
      for (const [node, from] of [
        [c.pts[0]!, c.xy],
        [c.pts[c.pts.length - 1]!, [...c.xy].reverse()],
      ] as [number, XY[]][]) {
        if ((degree.get(node) ?? 0) < 3) continue;
        const ahead = pointAlong(from, Math.min(25, L));
        const out = unit(sub(ahead.p, from[0]!));
        let list = arms.get(node);
        if (!list) arms.set(node, (list = []));
        list.push({ name: c.name, out, line: from, len: L });
      }
    }
    const nearRunway = (p: XY) => rws.some((rw) => nearestOnSegment(p, rw.a, rw.b).d < rw.W / 2 + 40);
    for (const list of arms.values()) {
      if (new Set(list.map((a) => a.name).filter(Boolean)).size < 2) continue;
      for (const arm of list) {
        if (!arm.name || arm.name.length > 8 || arm.len < 70) continue;
        const travel: XY = [-arm.out[0], -arm.out[1]];
        const spec = directionSignSpec(
          arm.name,
          list.filter((o) => o !== arm).map((o) => ({ name: o.name.length <= 8 ? o.name : '', angle: turnAngle(travel, o.out) })),
        );
        if (!spec) continue;
        const at = pointAlong(arm.line, 34);
        const l = left([-at.dir[0], -at.dir[1]]); // left of the direction of travel (toward the junction)
        const p: XY = [at.p[0] + l[0] * (TAXI_HALF + 8), at.p[1] + l[1] * (TAXI_HALF + 8)];
        if (!nearRunway(p)) addSign(p, spec, 1);
      }
    }
    // Location signs along long taxiways.
    for (const c of chains) {
      if (!c.name || c.name.length > 8) continue;
      const L = lineLength(c.xy);
      if (L < 220) continue;
      const at = pointAlong(c.xy, L / 2);
      const l = left(at.dir);
      const p: XY = [at.p[0] + l[0] * (TAXI_HALF + 8), at.p[1] + l[1] * (TAXI_HALF + 8)];
      if (!nearRunway(p)) addSign(p, `L~${c.name}`, 2);
    }

    // ---- stands: lead-in lines, stop bars, painted numbers
    let stands = 0;
    for (const st of ground.stands ?? []) {
      if (stands >= MAX_STANDS) break;
      const [la, lo, refRaw, hdg] = st;
      if (typeof hdg !== 'number' || !Number.isFinite(hdg)) continue;
      stands++;
      const p = P.fwd(la, lo);
      const lead = standLeadIn(p, hdg, (q, r) => {
        const n = index.nearest(q, r);
        return n && { q: n.q, dir: unit(sub(segs[n.i]![1], segs[n.i]![0])) };
      });
      line('lead', lead.path);
      line('lead', lead.stopBar);
      const ref = typeof refRaw === 'string' ? refRaw.trim() : '';
      if (ref && ref.length <= 6) point('standno', lead.label, { text: ref, rot: Math.round(bearingOf(lead.h)) });
    }
  }
  return { lines, polys, pts };
}

/** Runway inputs from an OurAirports airport record (paved, open runways with both ends). */
export function runwaysFromDetail(d: Pick<AirportDetail, 'runways' | 'type'>): RunwayInput[] {
  const FT = 0.3048;
  const paved = (s?: string) => !s || /ASP|CON|PEM|BIT|TAR|MAC|PAV|ASF|SEAL|TRT|COP/i.test(s);
  const rows = d.runways.filter(
    (r) => !r.closed && paved(r.surface) && r.leLat !== undefined && r.leLon !== undefined && r.heLat !== undefined && r.heLon !== undefined && !/^H/i.test(r.leIdent ?? ''),
  );
  const longest = Math.max(0, ...rows.map((r) => r.lengthFt ?? 0));
  return rows.map((r) => {
    const lengthFt = r.lengthFt ?? 0;
    const fallback = d.type === 'large_airport' && lengthFt >= 11500 && lengthFt === longest ? 60 : lengthFt >= 5900 ? 45 : lengthFt >= 3900 ? 30 : 23;
    const width = r.widthFt && r.widthFt >= 40 && r.widthFt <= 300 ? r.widthFt * FT : fallback;
    return {
      a: { id: r.leIdent ?? '', lat: r.leLat!, lon: r.leLon!, disp: (r.leDisplacedThresholdFt ?? 0) * FT },
      b: { id: r.heIdent ?? '', lat: r.heLat!, lon: r.heLon!, disp: (r.heDisplacedThresholdFt ?? 0) * FT },
      width,
    };
  });
}

// ---------------------------------------------------------------- sign images

const SIGN_RATIO = 1.5;
const SIGN_COL = {
  red: '#c8102e',
  yellow: '#f6c518',
  black: '#111111',
  white: '#ffffff',
} as const;

/** Draws a sign array ("M~27L-09R|L~A|D~B~-90") into RGBA pixels (at SIGN_RATIO pixels per CSS pixel; ~1.5 keeps a few hundred signs to a few MB). */
export function renderSign(spec: string): { width: number; height: number; data: Uint8ClampedArray } | undefined {
  const R = SIGN_RATIO;
  const H = Math.round(17 * R);
  const LEGS = Math.round(5 * R);
  const font = `700 ${12 * R}px "Inter Variable", "Helvetica Neue", Arial, sans-serif`;
  const make = (w: number, h: number) => {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    if (typeof document !== 'undefined') return Object.assign(document.createElement('canvas'), { width: w, height: h });
    return undefined;
  };
  const probe = make(4, 4)?.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null | undefined;
  if (!probe) return undefined;
  probe.font = font;
  const segs = spec.split('|').map((s) => {
    const [kind, text = '', ang] = s.split('~');
    const arrow = kind === 'D' && ang !== undefined ? Number(ang) : undefined;
    const tw = probe.measureText(text).width;
    const aw = arrow !== undefined ? 13 * R : 0;
    return { kind, text, arrow, w: Math.ceil(tw + aw + 10 * R) };
  });
  const W = segs.reduce((s, g) => s + g.w, 0) + 2 * R;
  const cv = make(W, H + LEGS);
  const ctx = cv?.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null | undefined;
  if (!cv || !ctx) return undefined;
  // Legs (frangible mounts) so the billboard reads as a sign standing on the grass.
  ctx.fillStyle = '#3a3f46';
  ctx.fillRect(W * 0.22, H - 2, 2 * R, LEGS + 2);
  ctx.fillRect(W * 0.78 - 2 * R, H - 2, 2 * R, LEGS + 2);
  // Frame.
  ctx.fillStyle = SIGN_COL.black;
  ctx.fillRect(0, 0, W, H);
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  let x = R;
  for (const g of segs) {
    const inner = { x: x, y: R, w: g.w, h: H - 2 * R };
    let fg: string;
    if (g.kind === 'M') {
      ctx.fillStyle = SIGN_COL.red;
      ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
      fg = SIGN_COL.white;
    } else if (g.kind === 'L') {
      ctx.fillStyle = SIGN_COL.black;
      ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
      ctx.strokeStyle = SIGN_COL.yellow;
      ctx.lineWidth = 1.2 * R;
      ctx.strokeRect(inner.x + 2 * R, inner.y + 2 * R, inner.w - 4 * R, inner.h - 4 * R);
      fg = SIGN_COL.yellow;
    } else {
      ctx.fillStyle = SIGN_COL.yellow;
      ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
      fg = SIGN_COL.black;
    }
    ctx.fillStyle = fg;
    const cy = inner.y + inner.h / 2 + 0.5 * R;
    const arrowLeft = g.arrow !== undefined && g.arrow <= 0;
    let tx = inner.x + 5 * R;
    if (g.arrow !== undefined && arrowLeft) {
      drawArrow(ctx, tx + 5.5 * R, cy - 0.5 * R, g.arrow, R, fg);
      tx += 13 * R;
    }
    ctx.fillText(g.text, tx, cy);
    if (g.arrow !== undefined && !arrowLeft) drawArrow(ctx, inner.x + inner.w - 10.5 * R, cy - 0.5 * R, g.arrow, R, fg);
    x += g.w;
    // Thin black divider between panels.
    ctx.fillStyle = SIGN_COL.black;
    ctx.fillRect(x - 0.5 * R, 0, R, H);
  }
  const img = ctx.getImageData(0, 0, W, H + LEGS);
  return { width: W, height: H + LEGS, data: img.data };
}

function drawArrow(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, cx: number, cy: number, angle: number, R: number, colour: string) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle * D2R);
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 1.8 * R;
  ctx.beginPath();
  ctx.moveTo(0, 5 * R);
  ctx.lineTo(0, -1.5 * R);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -5.5 * R);
  ctx.lineTo(4 * R, -0.5 * R);
  ctx.lineTo(-4 * R, -0.5 * R);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- map layers

const SRC_L = 'surf-lines';
const SRC_P = 'surf-polys';
const SRC_X = 'surf-pts';
export const SURFACE_LAYERS = [
  'surf-pave',
  'surf-shoulder',
  'surf-rwy',
  'surf-white',
  'surf-holdbg',
  'surf-tcl-case',
  'surf-tcl',
  'surf-hold',
  'surf-desig',
  'surf-standno',
  'surf-tname',
  'surf-sign',
] as const;
const MIN_Z = 12.5;
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

interface SurfPalette {
  pave: string;
  shoulder: string;
  rwy: string;
  white: string;
  yellow: string;
  casing: string;
  holdBg: string;
  tname: string;
  halo: string;
}
function surfPalette(style: MapStyleId): SurfPalette {
  const dark = { white: '#e4e9ee', yellow: '#f2bd2c', casing: 'rgba(4,7,11,0.8)', holdBg: 'rgba(0,0,0,0.55)', tname: '#ffd75a', halo: 'rgba(4,7,11,0.92)' };
  switch (style) {
    case 'arctic':
      return { pave: '#c4cbd3', shoulder: '#d3d8de', rwy: '#6f7883', white: '#ffffff', yellow: '#f0b000', casing: 'rgba(70,56,20,0.4)', holdBg: 'rgba(20,20,20,0.35)', tname: '#8a5d00', halo: 'rgba(255,255,255,0.95)' };
    case 'satellite':
      return { ...dark, pave: 'rgba(58,61,66,0.82)', shoulder: 'rgba(80,82,84,0.55)', rwy: 'rgba(44,46,50,0.94)', white: '#f2f2f0' };
    case 'midnight':
      return { ...dark, pave: '#141a21', shoulder: '#11161c', rwy: '#1d232b', white: '#c9d1d9', yellow: '#d9a823' };
    case 'terrain':
      return { ...dark, pave: '#2b322e', shoulder: '#262c29', rwy: '#343a37' };
    case 'minimal':
      return { ...dark, pave: '#1d232b', shoulder: '#191e25', rwy: '#2a313b' };
    default:
      return { ...dark, pave: '#232a33', shoulder: '#1e242c', rwy: '#2e353f' };
  }
}

/** Width in metres (feature property or constant) → pixels, exact at every zoom (`m0` = px per metre at zoom 0). */
function metric(m: number | ExpressionSpecification): ExpressionSpecification {
  return ['interpolate', ['exponential', 2], ['zoom'], 0, ['*', m, ['get', 'm0']], 24, ['*', m, ['*', 2 ** 24, ['get', 'm0']]]];
}
/** Like `metric`, but never thinner than `minPx` (sampled stops). */
function metricMin(m: number, minPx: number): ExpressionSpecification {
  const stops: (number | ExpressionSpecification)[] = [];
  // Stops end at zoom 20 (the map's max is 19) so text sizes stay under MapLibre's 255 px limit.
  for (const z of [12, 14, 15, 16, 17, 18, 19, 20]) stops.push(z, ['max', minPx, ['*', m * 2 ** z, ['get', 'm0']]]);
  return ['interpolate', ['exponential', 2], ['zoom'], ...stops] as ExpressionSpecification;
}
const fadeIn = (to: number, z0 = MIN_Z, z1 = MIN_Z + 0.8): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], z0, 0, z1, to];

/** Our layers sit just above the base map's roads and below every label and overlay. */
function beforeId(map: MlMap): string | undefined {
  for (const id of ['boundary-state', 'boundary-country', 'road-label', 'water-label']) if (map.getLayer(id)) return id;
  return map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
}

const kind = (...k: string[]): FilterSpecification => (k.length === 1 ? ['==', ['get', 'k'], k[0]!] : ['in', ['get', 'k'], ['literal', k]]);

export function installAirportSurface(map: MlMap) {
  const s = getSettings();
  const pal = surfPalette(s.mapStyle);
  for (const id of [SRC_L, SRC_P, SRC_X]) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY, tolerance: 0.2, buffer: 64 });
  const before = beforeId(map);
  const vis = s.showSurfaceMarkings ? 'visible' : 'none';
  const add = (spec: Record<string, unknown>) => {
    if (map.getLayer(spec.id as string)) return;
    const layout = { visibility: vis, ...(spec.layout as object | undefined) };
    map.addLayer({ minzoom: MIN_Z, ...spec, layout } as never, before);
  };
  add({ id: 'surf-pave', type: 'line', source: SRC_L, filter: kind('pave'), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': pal.pave, 'line-width': metric(['get', 'w']), 'line-opacity': fadeIn(1) } });
  add({ id: 'surf-shoulder', type: 'fill', source: SRC_P, filter: kind('shoulder'), paint: { 'fill-color': pal.shoulder, 'fill-opacity': fadeIn(1) } });
  add({ id: 'surf-rwy', type: 'fill', source: SRC_P, filter: kind('rwy'), paint: { 'fill-color': pal.rwy, 'fill-opacity': fadeIn(1) } });
  add({ id: 'surf-white', type: 'fill', source: SRC_P, minzoom: 13, filter: kind('white'), paint: { 'fill-color': pal.white, 'fill-opacity': fadeIn(0.92, 13, 13.8) } });
  add({ id: 'surf-holdbg', type: 'fill', source: SRC_P, minzoom: 14.5, filter: kind('holdbg'), paint: { 'fill-color': pal.holdBg } });
  const tclWidth: ExpressionSpecification = ['interpolate', ['exponential', 1.6], ['zoom'], 13, 0.6, 15, 1.1, 17, 2, 19, 3.6, 21, 7];
  add({
    id: 'surf-tcl-case',
    type: 'line',
    source: SRC_L,
    minzoom: 13.5,
    filter: kind('tcl', 'lead'),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': pal.casing, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 13.5, 1.4, 15, 2.4, 17, 3.6, 19, 5.6, 21, 9.5], 'line-opacity': fadeIn(1, 13.5, 14.2) },
  });
  add({
    id: 'surf-tcl',
    type: 'line',
    source: SRC_L,
    minzoom: 13,
    filter: kind('tcl', 'lead'),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': pal.yellow, 'line-width': tclWidth, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 13.8, 0.95] },
  });
  add({ id: 'surf-hold', type: 'fill', source: SRC_P, minzoom: 14.5, filter: kind('hold'), paint: { 'fill-color': pal.yellow } });
  add({
    id: 'surf-desig',
    type: 'symbol',
    source: SRC_X,
    minzoom: 14,
    filter: kind('desig'),
    layout: {
      'text-field': ['get', 'text'],
      'text-font': ['Noto Sans Bold'],
      'text-size': metricMin(12.5, 0),
      'text-line-height': 1.15,
      'text-rotate': ['get', 'rot'],
      'text-rotation-alignment': 'map',
      'text-pitch-alignment': 'map',
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'text-padding': 0,
    },
    paint: { 'text-color': pal.white, 'text-opacity': fadeIn(0.95, 14, 14.6) },
  });
  add({
    id: 'surf-standno',
    type: 'symbol',
    source: SRC_X,
    minzoom: 16,
    filter: kind('standno'),
    layout: {
      'text-field': ['get', 'text'],
      'text-font': ['Noto Sans Bold'],
      'text-size': metricMin(4.2, 0),
      'text-rotate': ['get', 'rot'],
      'text-rotation-alignment': 'map',
      'text-pitch-alignment': 'map',
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'text-padding': 0,
    },
    paint: { 'text-color': pal.yellow, 'text-halo-color': pal.casing, 'text-halo-width': 0.8, 'text-opacity': fadeIn(1, 16, 16.5) },
  });
  add({
    id: 'surf-tname',
    type: 'symbol',
    source: SRC_L,
    minzoom: 14.5,
    maxzoom: 16.2,
    filter: ['all', kind('pave'), ['!=', ['get', 'name'], '']],
    layout: {
      visibility: s.showSurfaceMarkings && s.labelDensity !== 'none' && s.labelDensity !== 'low' ? 'visible' : 'none',
      'symbol-placement': 'line',
      'symbol-spacing': 420,
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 10.5,
      'text-keep-upright': true,
      'text-max-angle': 30,
      'text-padding': 6,
    },
    paint: { 'text-color': pal.tname, 'text-halo-color': pal.halo, 'text-halo-width': 1.6 },
  });
  add({
    id: 'surf-sign',
    type: 'symbol',
    source: SRC_X,
    minzoom: 15.3,
    filter: kind('sign'),
    layout: {
      'icon-image': ['get', 'img'],
      'icon-anchor': 'bottom',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 15.3, 0.62, 17, 0.85, 19, 1.1],
      'icon-rotation-alignment': 'viewport',
      'icon-pitch-alignment': 'viewport',
      'icon-padding': 1,
      'symbol-sort-key': ['get', 'pri'],
    },
    paint: { 'icon-opacity': fadeIn(1, 15.3, 15.8) },
  });
  state.images.clear(); // a fresh style has no images
  render(map);
}

// ---------------------------------------------------------------- data & binding

const state = {
  key: '',
  data: { lines: [], polys: [], pts: [] } as SurfaceData,
  images: new Set<string>(),
};
const builds = new Map<string, Promise<SurfaceData | null>>();

function render(map: MlMap) {
  const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
  (map.getSource(SRC_L) as GeoJSONSource | undefined)?.setData(fc(state.data.lines));
  (map.getSource(SRC_P) as GeoJSONSource | undefined)?.setData(fc(state.data.polys));
  (map.getSource(SRC_X) as GeoJSONSource | undefined)?.setData(fc(state.data.pts));
}

function buildFor(ident: string, lat: number, lon: number): Promise<SurfaceData | null> {
  let p = builds.get(ident);
  if (!p) {
    p = Promise.all([api.airport(ident).catch(() => null), loadGround(ident).catch(() => null)]).then(([detail, ground]) => {
      const runways = detail ? runwaysFromDetail(detail) : [];
      const g = ground as GroundFile | null;
      if (!runways.length && !g?.nodes?.length) return null;
      return buildAirportSurface({ lat: detail?.lat ?? lat, lon: detail?.lon ?? lon }, runways, g);
    });
    builds.set(ident, p);
    // Keep the cache small: geometry for a big hub is a few MB of objects.
    if (builds.size > 6) builds.delete(builds.keys().next().value!);
  }
  return p;
}

function syncVisibility(map: MlMap) {
  const s = getSettings();
  for (const id of SURFACE_LAYERS) {
    if (!map.getLayer(id)) continue;
    const on = s.showSurfaceMarkings && (id !== 'surf-tname' || (s.labelDensity !== 'none' && s.labelDensity !== 'low'));
    map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
}

export function bindAirportSurface(map: MlMap): () => void {
  let disposed = false;
  let seq = 0;
  const update = async () => {
    const my = ++seq;
    if (!getSettings().showSurfaceMarkings || map.getZoom() < MIN_Z - 0.3) return;
    const list = await loadMajorAirports().catch(() => []);
    if (disposed || my !== seq) return;
    const b = map.getBounds();
    const c = map.getCenter();
    const padLat = 0.035;
    const padLon = padLat / Math.max(0.2, Math.cos(c.lat * D2R));
    const kc = Math.cos(c.lat * D2R);
    const cand = list
      .filter((a) => a.type !== 'heliport' && a.type !== 'closed' && a.type !== 'seaplane_base' && a.type !== 'balloonport')
      .filter((a) => a.lat > b.getSouth() - padLat && a.lat < b.getNorth() + padLat && a.lon > b.getWest() - padLon && a.lon < b.getEast() + padLon)
      .sort((x, y) => Math.hypot(x.lat - c.lat, (x.lon - c.lng) * kc) - Math.hypot(y.lat - c.lat, (y.lon - c.lng) * kc))
      .slice(0, map.getZoom() >= 14 ? 3 : 2);
    const key = cand.map((a) => a.ident).sort().join(',');
    if (key === state.key) return;
    const built = await Promise.all(cand.map((a) => buildFor(a.ident, a.lat, a.lon).catch(() => null)));
    if (disposed || my !== seq) return;
    const data: SurfaceData = { lines: [], polys: [], pts: [] };
    for (const d of built) {
      if (!d) continue;
      data.lines.push(...d.lines);
      data.polys.push(...d.polys);
      data.pts.push(...d.pts);
    }
    state.key = key;
    state.data = data;
    pruneImages(map);
    render(map);
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void update(), 120);
  };
  const onStyle = () => installAirportSurface(map);
  // Sign images are drawn on demand, only for signs MapLibre actually lays out.
  const onMissing = (id: string) => {
    if (!id.startsWith('sgn:') || map.hasImage(id)) return;
    const img = renderSign(id.slice(4));
    if (!img) return;
    map.addImage(id, img, { pixelRatio: SIGN_RATIO });
    state.images.add(id);
  };
  map.on('style.load', onStyle);
  map.setMissingStyleImageResolver(onMissing);
  map.on('moveend', schedule);
  const unsub = useSettings.subscribe((s, p) => {
    if (s.showSurfaceMarkings !== p.showSurfaceMarkings || s.labelDensity !== p.labelDensity) {
      syncVisibility(map);
      if (s.showSurfaceMarkings && !p.showSurfaceMarkings) {
        state.key = '';
        schedule();
      }
    }
  });
  // Loaded lazily after the first style: install now (later styles arrive via 'style.load').
  if (map.getLayer('background')) installAirportSurface(map);
  schedule();
  return () => {
    disposed = true;
    clearTimeout(timer);
    map.off('style.load', onStyle);
    map.setMissingStyleImageResolver(null);
    map.off('moveend', schedule);
    unsub();
  };
}

/** Drops sign images no longer referenced once there are many (memory on phones). */
function pruneImages(map: MlMap) {
  if (state.images.size < 240) return;
  const keep = new Set(state.data.pts.map((f) => f.properties?.img as string | undefined).filter(Boolean));
  for (const id of state.images) {
    if (keep.has(id)) continue;
    if (map.hasImage(id)) map.removeImage(id);
    state.images.delete(id);
  }
}
