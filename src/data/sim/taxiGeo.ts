// Taxi routing on an airport's OpenStreetMap taxiway network, strictly along the centre lines.
//
//  • Stands, runway exits and holding points join the network at the nearest point ON a
//    taxiway edge (a perpendicular lead-in), not at the nearest vertex, so aircraft never cut
//    across grass or aprons to reach a far node.
//  • Only the network's largest connected part is used (OSM often has stray fragments: a
//    route that starts on one could otherwise "teleport" across the field).
//  • Corners are filleted with a turn radius, like a real nose-wheel steering turn.
// All geometry is in a local flat projection (NM east / north of the airport reference).

import type { Pt } from './engine';

export interface Graph {
  nodes: Pt[];
  adj: number[][];
  edgeNames?: Map<string, string>;
}

interface Prepared {
  /** Flat coordinates (NM) of every node. */
  x: Float64Array;
  y: Float64Array;
  /** Undirected edges (u < v) in the main component. */
  eu: Int32Array;
  ev: Int32Array;
  inMain: Uint8Array;
  lat0: number;
  lon0: number;
  k: number;
}

const cache = new WeakMap<Graph, Prepared>();

function prepare(g: Graph): Prepared {
  const hit = cache.get(g);
  if (hit) return hit;
  const n = g.nodes.length;
  let lat0 = 0;
  let lon0 = 0;
  for (const p of g.nodes) {
    lat0 += p[0];
    lon0 += p[1];
  }
  lat0 /= Math.max(1, n);
  lon0 /= Math.max(1, n);
  const k = Math.cos((lat0 * Math.PI) / 180);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = (g.nodes[i]![1] - lon0) * 60 * k;
    y[i] = (g.nodes[i]![0] - lat0) * 60;
  }
  // Connected components: keep the one with the most total edge length.
  const comp = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  for (let s = 0; s < n; s++) {
    if (comp[s] !== -1) continue;
    const id = sizes.length;
    let len = 0;
    const stack = [s];
    comp[s] = id;
    while (stack.length) {
      const u = stack.pop()!;
      for (const v of g.adj[u] ?? []) {
        if (v > u) len += Math.hypot(x[v]! - x[u]!, y[v]! - y[u]!);
        if (comp[v] === -1) {
          comp[v] = id;
          stack.push(v);
        }
      }
    }
    sizes.push(len);
  }
  let main = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i]! > sizes[main]!) main = i;
  const inMain = new Uint8Array(n);
  const eu: number[] = [];
  const ev: number[] = [];
  for (let u = 0; u < n; u++) {
    if (comp[u] !== main) continue;
    inMain[u] = 1;
    for (const v of g.adj[u] ?? []) if (v > u) {
      eu.push(u);
      ev.push(v);
    }
  }
  const p: Prepared = { x, y, eu: Int32Array.from(eu), ev: Int32Array.from(ev), inMain, lat0, lon0, k };
  cache.set(g, p);
  return p;
}

const toXY = (P: Prepared, p: Pt): [number, number] => [(p[1] - P.lon0) * 60 * P.k, (p[0] - P.lat0) * 60];
const toPt = (P: Prepared, x: number, y: number): Pt => [P.lat0 + y / 60, P.lon0 + x / (60 * P.k)];

export interface Attach {
  /** Edge end nodes. */
  u: number;
  v: number;
  /** Position along u→v (0–1). */
  t: number;
  /** The attachment point on the edge. */
  pt: Pt;
  /** Distance from the query point to the edge, NM. */
  d: number;
}

/** Nearest point on the network's main component to `p`. */
export function attach(g: Graph, p: Pt): Attach | null {
  const P = prepare(g);
  if (!P.eu.length) return null;
  const [px, py] = toXY(P, p);
  let best = Infinity;
  let bi = -1;
  let bt = 0;
  for (let i = 0; i < P.eu.length; i++) {
    const u = P.eu[i]!;
    const v = P.ev[i]!;
    const ax = P.x[u]!;
    const ay = P.y[u]!;
    const dx = P.x[v]! - ax;
    const dy = P.y[v]! - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + dx * t - px;
    const qy = ay + dy * t - py;
    const d = qx * qx + qy * qy;
    if (d < best) {
      best = d;
      bi = i;
      bt = t;
    }
  }
  if (bi < 0) return null;
  const u = P.eu[bi]!;
  const v = P.ev[bi]!;
  const x = P.x[u]! + (P.x[v]! - P.x[u]!) * bt;
  const y = P.y[u]! + (P.y[v]! - P.y[u]!) * bt;
  return { u, v, t: bt, pt: toPt(P, x, y), d: Math.sqrt(best) };
}

const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

export interface GraphRoute {
  pts: Pt[];
  /** Taxiway names in order (consecutive duplicates removed). */
  via: string[];
}

/**
 * Shortest route along taxiway centre lines from `from` to `to`, entering and leaving the
 * network perpendicular to the nearest edges. Returns null without a usable network.
 */
export function routeOnGraph(g: Graph, from: Pt, to: Pt): GraphRoute | null {
  const P = prepare(g);
  const A = attach(g, from);
  const B = attach(g, to);
  if (!A || !B) return null;
  const n = g.nodes.length;
  const len = (a: number, b: number) => Math.hypot(P.x[a]! - P.x[b]!, P.y[a]! - P.y[b]!);
  const name = (a: number, b: number) => g.edgeNames?.get(key(a, b));
  const sameEdge = (A.u === B.u && A.v === B.v) || (A.u === B.v && A.v === B.u);
  if (sameEdge) {
    const nm = name(A.u, A.v);
    return { pts: dedupe([from, A.pt, B.pt, to]), via: nm ? [nm] : [] };
  }
  const [ax, ay] = toXY(P, A.pt);
  const [bx, by] = toXY(P, B.pt);
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const heap = new MinHeap();
  const seed = (i: number, d: number) => {
    if (d < dist[i]!) {
      dist[i] = d;
      prev[i] = -2; // reached directly from the start attachment
      heap.push(d, i);
    }
  };
  seed(A.u, Math.hypot(P.x[A.u]! - ax, P.y[A.u]! - ay));
  seed(A.v, Math.hypot(P.x[A.v]! - ax, P.y[A.v]! - ay));
  const endU = Math.hypot(P.x[B.u]! - bx, P.y[B.u]! - by);
  const endV = Math.hypot(P.x[B.v]! - bx, P.y[B.v]! - by);
  let doneU = false;
  let doneV = false;
  while (heap.size) {
    const [d, u] = heap.pop();
    if (d > dist[u]!) continue;
    if (u === B.u) doneU = true;
    if (u === B.v) doneV = true;
    if (doneU && doneV) break;
    for (const v of g.adj[u]!) {
      if (!P.inMain[v]) continue;
      const nd = d + len(u, v);
      if (nd < dist[v]!) {
        dist[v] = nd;
        prev[v] = u;
        heap.push(nd, v);
      }
    }
  }
  const viaU = dist[B.u]! + endU;
  const viaV = dist[B.v]! + endV;
  if (!Number.isFinite(viaU) && !Number.isFinite(viaV)) return null;
  const last = viaU <= viaV ? B.u : B.v;
  const nodes: number[] = [];
  for (let v = last; v >= 0; v = prev[v]!) nodes.push(v);
  nodes.reverse();
  const via: string[] = [];
  const addName = (nm: string | undefined) => {
    if (nm && via[via.length - 1] !== nm) via.push(nm);
  };
  addName(name(A.u, A.v));
  for (let i = 1; i < nodes.length; i++) addName(name(nodes[i - 1]!, nodes[i]!));
  addName(name(B.u, B.v));
  const pts = dedupe([from, A.pt, ...nodes.map((i) => g.nodes[i]!), B.pt, to]);
  return { pts, via };
}

/** Removes consecutive points closer than ~2 m. */
function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) < 1.8e-5 && Math.abs(q[1] - p[1]) < 1.8e-5 / Math.max(0.2, Math.cos((p[0] * Math.PI) / 180))) continue;
    out.push(p);
  }
  return out;
}

/**
 * Rounds the corners of a taxi path with a turn of radius `rNm` (cut back where legs are
 * short); the first and last points are kept exactly.
 */
export function fillet(pts: Pt[], rNm = 0.016): Pt[] {
  if (pts.length < 3) return pts;
  const lat0 = pts[0]![0];
  const lon0 = pts[0]![1];
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xy = pts.map((p) => [(p[1] - lon0) * 60 * k, (p[0] - lat0) * 60] as [number, number]);
  const back = (x: number, y: number): Pt => [lat0 + y / 60, lon0 + x / (60 * k)];
  const out: Pt[] = [pts[0]!];
  for (let i = 1; i < xy.length - 1; i++) {
    const [px, py] = xy[i - 1]!;
    const [cx, cy] = xy[i]!;
    const [nx, ny] = xy[i + 1]!;
    const l1 = Math.hypot(cx - px, cy - py);
    const l2 = Math.hypot(nx - cx, ny - cy);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    const ux = (cx - px) / l1;
    const uy = (cy - py) / l1;
    const vx = (nx - cx) / l2;
    const vy = (ny - cy) / l2;
    const turn = Math.acos(Math.max(-1, Math.min(1, ux * vx + uy * vy)));
    // Gentle bends need no fillet; hairpins keep their vertex (a real 180° turn on a pad).
    if (turn < 0.2 || turn > 2.7) {
      out.push(pts[i]!);
      continue;
    }
    // Capped so the nose wheel never leaves the centre line by more than ~14 m.
    const cut = Math.min(rNm * Math.tan(turn / 2), 0.03, l1 * 0.45, l2 * 0.45);
    const ax = cx - ux * cut;
    const ay = cy - uy * cut;
    const bx = cx + vx * cut;
    const by = cy + vy * cut;
    const steps = Math.max(2, Math.ceil(turn / 0.25));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * cx + t * t * bx;
      const y = (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * cy + t * t * by;
      out.push(back(x, y));
    }
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/**
 * Where a push-back ends: the tug pushes the aircraft tail-first from the stand onto the
 * taxilane and on along it, away from the direction it will taxi, so the aircraft ends
 * aligned with the centre line and facing its route. Returns the push path (stand first).
 */
export function pushbackPath(g: Graph, stand: Pt, towards: Pt, alongNm = 0.03, maxLeadNm = 0.12): Pt[] | null {
  const A = attach(g, stand);
  if (!A || A.d > maxLeadNm) return null;
  const P = prepare(g);
  const [ax, ay] = toXY(P, A.pt);
  const [tx, ty] = toXY(P, towards);
  const ux = P.x[A.v]! - P.x[A.u]!;
  const uy = P.y[A.v]! - P.y[A.u]!;
  const l = Math.hypot(ux, uy);
  if (l < 1e-6) return [stand, A.pt];
  // Direction along the edge that points away from where the aircraft is going.
  let dx = ux / l;
  let dy = uy / l;
  if ((tx - ax) * dx + (ty - ay) * dy > 0) {
    dx = -dx;
    dy = -dy;
  }
  // Stay on this edge: stop at its end node if it is closer than the push distance.
  const endNode = dx * ux + dy * uy > 0 ? A.v : A.u;
  const room = Math.hypot(P.x[endNode]! - ax, P.y[endNode]! - ay);
  const s = Math.min(alongNm, Math.max(room, alongNm * 0.4));
  const end = toPt(P, ax + dx * s, ay + dy * s);
  return dedupe([stand, A.pt, end]);
}

class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: number) {
    const k = this.k;
    const v = this.v;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p]! <= k[i]!) break;
      [k[p], k[i]] = [k[i]!, k[p]!];
      [v[p], v[i]] = [v[i]!, v[p]!];
      i = p;
    }
  }
  pop(): [number, number] {
    const k = this.k;
    const v = this.v;
    const top: [number, number] = [k[0]!, v[0]!];
    const lk = k.pop()!;
    const lv = v.pop()!;
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l]! < k[m]!) m = l;
        if (r < k.length && k[r]! < k[m]!) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i]!, k[m]!];
        [v[m], v[i]] = [v[i]!, v[m]!];
        i = m;
      }
    }
    return top;
  }
}
