// REAL published US airways (Victor, T, Jet and Q routes plus the Alaska / oceanic colored
// routes), from the en-route records of the FAA Coded Instrument Flight Procedures (public
// domain), compiled by scripts/build-airways.mjs into public/data/sim/airways-us.json.
// Pure functions over that JSON: nothing is fetched here. Reference data for the simulation
// only — never for navigation.

import { distanceNm } from '@shared/geo';
import type { Fix } from './procedures';

/** [ident, lat, lon] for a waypoint, [ident, lat, lon, kind, name] for a navaid (kind as in navaids.json). */
export type RawAirwayFix = [string, number, number] | [string, number, number, number, string];

export interface RawAirway {
  /** Airway identifier ("J60", "V16", "Q480"). An identifier can have several segments. */
  a: string;
  /** Altitude band: H high (FL180 and above), L low, B both. */
  l: 'H' | 'L' | 'B';
  /** Fix indices in coded order. */
  f: number[];
  /** Minimum en-route altitude per leg, hundreds of feet (one number when uniform). */
  m?: number | number[];
  /** Maximum authorised altitude per leg, hundreds of feet (one number when uniform). */
  x?: number | number[];
  /** One-way legs, one character per leg: "F" coded order only, "B" reverse only, " " both. */
  d?: string;
}

export interface AirwaysData {
  v: number;
  source: string;
  cycle: string;
  effective?: string | null;
  fixes: RawAirwayFix[];
  airways: RawAirway[];
}

/** One fix of an airway route; `airway` is the airway flown TO this fix ("DCT" for the entry fix). */
export type AirwayLeg = Fix & { airway: string };

/** Compact directed graph: CSR adjacency over the fix table. */
export interface AirwayGraph {
  fixes: RawAirwayFix[];
  /** Edges leaving fix i: start[i] .. start[i + 1] - 1. */
  start: Int32Array;
  to: Int32Array;
  /** Index into `names`. */
  aw: Int32Array;
  /** Bit 1 low, bit 2 high. */
  band: Uint8Array;
  len: Float32Array;
  names: string[];
  /** Bands (bit mask) a fix is served by. */
  fixBand: Uint8Array;
  byIdent: Map<string, number[]>;
  grid: Map<number, number[]>;
}

export interface RouteOptions {
  /** High (J / Q and high colored routes) or low (V / T) airways. */
  high: boolean;
  /** Longest acceptable route relative to the great circle (default 1.25). */
  maxDetourRatio?: number;
  /** Cost of changing airway, NM (default 12). */
  changePenaltyNm?: number;
  /** How far from each end an airway may be joined or left, NM (default 60). */
  joinRadiusNm?: number;
}

export type RoutePoint = string | { lat: number; lon: number; ident?: string };

const BAND = { L: 1, H: 2, B: 3 } as const;
const cell = (lat: number, lon: number) => (Math.floor(lat) + 90) * 360 + ((Math.floor(lon) + 540) % 360);

/** Builds the airway graph (both directions of every leg unless the leg is one-way). */
export function buildAirwayGraph(data: AirwaysData): AirwayGraph {
  const n = data.fixes.length;
  const names: string[] = [];
  const nameIx = new Map<string, number>();
  const edges: [number, number, number, number][] = []; // from, to, airway, band
  for (const s of data.airways) {
    let k = nameIx.get(s.a);
    if (k === undefined) nameIx.set(s.a, (k = names.push(s.a) - 1));
    const b = BAND[s.l] ?? 3;
    for (let i = 0; i + 1 < s.f.length; i++) {
      const d = s.d?.[i];
      if (d !== 'B') edges.push([s.f[i]!, s.f[i + 1]!, k, b]);
      if (d !== 'F') edges.push([s.f[i + 1]!, s.f[i]!, k, b]);
    }
  }
  edges.sort((p, q) => p[0] - q[0]);
  const start = new Int32Array(n + 1);
  for (const e of edges) start[e[0] + 1]!++;
  for (let i = 0; i < n; i++) start[i + 1]! += start[i]!;
  const to = new Int32Array(edges.length);
  const aw = new Int32Array(edges.length);
  const band = new Uint8Array(edges.length);
  const len = new Float32Array(edges.length);
  const fixBand = new Uint8Array(n);
  edges.forEach(([a, z, k, b], i) => {
    const fa = data.fixes[a]!;
    const fz = data.fixes[z]!;
    to[i] = z;
    aw[i] = k;
    band[i] = b;
    len[i] = distanceNm(fa[1], fa[2], fz[1], fz[2]);
    fixBand[a]! |= b;
    fixBand[z]! |= b;
  });
  const byIdent = new Map<string, number[]>();
  const grid = new Map<number, number[]>();
  data.fixes.forEach((f, i) => {
    const l = byIdent.get(f[0]);
    if (l) l.push(i);
    else byIdent.set(f[0], [i]);
    const c = cell(f[1], f[2]);
    const g = grid.get(c);
    if (g) g.push(i);
    else grid.set(c, [i]);
  });
  return { fixes: data.fixes, start, to, aw, band, len, names, fixBand, byIdent, grid };
}

const graphs = new WeakMap<AirwaysData, AirwayGraph>();
const routeCache = new WeakMap<AirwayGraph, Map<string, AirwayLeg[] | null>>();

/** The (cached) graph of a data set. */
export function airwayGraph(data: AirwaysData | AirwayGraph): AirwayGraph {
  if ('start' in data) return data;
  let g = graphs.get(data);
  if (!g) graphs.set(data, (g = buildAirwayGraph(data)));
  return g;
}

/** Fixes within `radiusNm` of a point served by the band mask, nearest first. */
export function fixesNear(g: AirwayGraph, lat: number, lon: number, radiusNm: number, mask = 3): { i: number; d: number }[] {
  const out: { i: number; d: number }[] = [];
  const dLat = Math.ceil(radiusNm / 60);
  const dLon = Math.min(180, Math.ceil(radiusNm / (60 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)))));
  for (let a = -dLat; a <= dLat; a++) {
    for (let b = -dLon; b <= dLon; b++) {
      for (const i of g.grid.get(cell(lat + a, lon + b)) ?? []) {
        if (!(g.fixBand[i]! & mask)) continue;
        const f = g.fixes[i]!;
        const d = distanceNm(lat, lon, f[1], f[2]);
        if (d <= radiusNm) out.push({ i, d });
      }
    }
  }
  return out.sort((p, q) => p.d - q.d);
}

/** Candidate join / leave fixes of one route end with their direct (off-airway) distance. */
function ends(g: AirwayGraph, p: RoutePoint, mask: number, radius: number): { pos: [number, number]; c: { i: number; d: number }[] } | null {
  let pos: [number, number];
  if (typeof p === 'string') {
    const i = g.byIdent.get(p.toUpperCase())?.find((k) => g.fixBand[k]! & mask) ?? g.byIdent.get(p.toUpperCase())?.[0];
    if (i === undefined) return null;
    pos = [g.fixes[i]![1], g.fixes[i]![2]];
  } else pos = [p.lat, p.lon];
  const id = typeof p === 'string' ? p.toUpperCase() : p.ident?.toUpperCase();
  const c = fixesNear(g, pos[0], pos[1], radius, mask);
  // A named end that is itself on an airway of the band is joined there and nowhere else.
  const exact = id ? c.findIndex((x) => g.fixes[x.i]![0] === id && x.d < 3) : -1;
  return { pos, c: exact >= 0 ? [{ i: c[exact]!.i, d: 0 }] : c.slice(0, 16) };
}

/**
 * Airway route between two points (or fix idents): from a fix joined near `from` (e.g. the SID
 * exit fix) to a fix left near `to` (e.g. the STAR entry fix). A* over legs of the requested
 * band, cost = distance + `changePenaltyNm` per airway change, off-airway join/leave legs
 * costed 1.2×. Null when either end has no airway within `joinRadiusNm` or the best route is
 * more than `maxDetourRatio` × the great circle. The first leg's airway is "DCT"; the result
 * includes the join and leave fixes (which equal `from` / `to` when those are airway fixes).
 * Results are cached per graph; the returned array is a fresh copy.
 */
export function routeViaAirways(data: AirwaysData | AirwayGraph, from: RoutePoint, to: RoutePoint, opts: RouteOptions): AirwayLeg[] | null {
  const g = airwayGraph(data);
  const mask = opts.high ? 2 : 1;
  const ratio = opts.maxDetourRatio ?? 1.25;
  const pen = opts.changePenaltyNm ?? 12;
  const radius = opts.joinRadiusNm ?? 60;
  const key = (p: RoutePoint) => (typeof p === 'string' ? p : `${p.ident ?? ''}@${p.lat.toFixed(3)},${p.lon.toFixed(3)}`);
  const ck = `${key(from)}>${key(to)}|${mask}|${ratio}|${pen}|${radius}`;
  let cache = routeCache.get(g);
  if (!cache) routeCache.set(g, (cache = new Map()));
  if (cache.has(ck)) return cache.get(ck)?.map((l) => ({ ...l })) ?? null;
  const r = search(g, from, to, mask, ratio, pen, radius);
  if (cache.size > 4000) cache.clear();
  cache.set(ck, r);
  return r?.map((l) => ({ ...l })) ?? null;
}

function search(g: AirwayGraph, from: RoutePoint, to: RoutePoint, mask: number, ratio: number, pen: number, radius: number): AirwayLeg[] | null {
  const A = ends(g, from, mask, radius);
  const Z = ends(g, to, mask, radius);
  if (!A || !Z || !A.c.length || !Z.c.length) return null;
  const [tLat, tLon] = Z.pos;
  const gc = distanceNm(A.pos[0], A.pos[1], tLat, tLon);
  if (gc < 1) return null;
  const maxLen = gc * ratio;
  const exitD = new Map(Z.c.map((x) => [x.i, x.d]));
  const E = g.to.length;
  // States are edges (so the airway flown is known) plus one pseudo-state per join fix.
  const S = E + A.c.length;
  const node = (s: number) => (s < E ? g.to[s]! : A.c[s - E]!.i);
  const cost = new Float64Array(S).fill(Infinity);
  const geo = new Float64Array(S);
  const prev = new Int32Array(S).fill(-1);
  const h = (i: number) => distanceNm(g.fixes[i]![1], g.fixes[i]![2], tLat, tLon);
  const heap: number[] = []; // [f, state] pairs, flattened
  const push = (f: number, s: number) => {
    let k = heap.push(f, s) / 2 - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p * 2]! <= f) break;
      heap[k * 2] = heap[p * 2]!;
      heap[k * 2 + 1] = heap[p * 2 + 1]!;
      k = p;
    }
    heap[k * 2] = f;
    heap[k * 2 + 1] = s;
  };
  const pop = (): [number, number] => {
    const top: [number, number] = [heap[0]!, heap[1]!];
    const s = heap.pop()!;
    const f = heap.pop()!;
    const n = heap.length / 2;
    if (n) {
      let k = 0;
      for (;;) {
        let c = k * 2 + 1;
        if (c >= n) break;
        if (c + 1 < n && heap[(c + 1) * 2]! < heap[c * 2]!) c++;
        if (heap[c * 2]! >= f) break;
        heap[k * 2] = heap[c * 2]!;
        heap[k * 2 + 1] = heap[c * 2 + 1]!;
        k = c;
      }
      heap[k * 2] = f;
      heap[k * 2 + 1] = s;
    }
    return top;
  };
  A.c.forEach((x, j) => {
    cost[E + j] = x.d * 1.2;
    geo[E + j] = x.d;
    push(cost[E + j]! + h(x.i), E + j);
  });
  let best = Infinity;
  let bestState = -1;
  while (heap.length) {
    const [f, s] = pop();
    if (f >= best) break;
    const i = node(s);
    if (f > cost[s]! + h(i) + 1e-6) continue; // stale entry
    const out = exitD.get(i);
    if (out !== undefined && geo[s]! + out <= maxLen) {
      const c = cost[s]! + out * 1.2;
      if (c < best) {
        best = c;
        bestState = s;
      }
    }
    const cur = s < E ? g.aw[s]! : -1;
    for (let e = g.start[i]!; e < g.start[i + 1]!; e++) {
      if (!(g.band[e]! & mask)) continue;
      const z = g.to[e]!;
      const gz = geo[s]! + g.len[e]!;
      const hz = h(z);
      if (gz + hz > maxLen) continue;
      const c = cost[s]! + g.len[e]! + (cur >= 0 && g.aw[e] !== cur ? pen : 0);
      if (c < cost[e]!) {
        cost[e] = c;
        geo[e] = gz;
        prev[e] = s;
        push(c + hz, e);
      }
    }
  }
  if (bestState < 0) return null;
  const states: number[] = [];
  for (let s = bestState; s >= 0; s = prev[s]!) states.push(s);
  states.reverse();
  return states.map((s) => {
    const f = g.fixes[node(s)]!;
    const leg: AirwayLeg = { ident: f[0], lat: f[1], lon: f[2], real: true, airway: s < E ? g.names[g.aw[s]!]! : 'DCT' };
    if (f.length === 5) {
      leg.kind = f[3];
      if (f[4]) leg.name = f[4];
    }
    return leg;
  });
}

/**
 * ICAO-style route text: "CANDR J60 PSB J584 SLT" — consecutive legs on one airway collapse
 * into "airway exit-fix". With `from` / `to` (the SID exit / STAR entry fix idents) a
 * "DCT" leg is added when the route joins or leaves the airways elsewhere:
 * "DEEZZ DCT CANDR J60 PSB DCT HAYNZ". Procedure names (SID / STAR) are added by the caller.
 */
export function airwayString(route: readonly { ident: string; airway: string }[], ends: { from?: string; to?: string } = {}): string {
  if (!route.length) return '';
  const out = [route[0]!.ident];
  if (ends.from && ends.from !== route[0]!.ident) out.unshift(ends.from, 'DCT');
  for (let i = 1; i < route.length; i++) {
    const l = route[i]!;
    if (i === route.length - 1 || route[i + 1]!.airway !== l.airway) out.push(l.airway, l.ident);
  }
  if (ends.to && ends.to !== route[route.length - 1]!.ident) out.push('DCT', ends.to);
  return out.join(' ');
}

/** Length of a fix sequence along its legs, NM. */
export function routeLengthNm(route: readonly { lat: number; lon: number }[]): number {
  let s = 0;
  for (let i = 1; i < route.length; i++) s += distanceNm(route[i - 1]!.lat, route[i - 1]!.lon, route[i]!.lat, route[i]!.lon);
  return s;
}
