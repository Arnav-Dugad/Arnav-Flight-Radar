// Air-travel geography for the simulation:
//   • Markets — world regions and how strongly airlines from one region serve another
//     (a gravity model with real-world affinities: South Asia ↔ Gulf diaspora traffic,
//     North America ↔ Caribbean leisure, intra-European short-haul…).
//   • Airspace closures — real, long-standing restrictions (Ukraine closed to civil
//     traffic; Russian airspace closed to airlines of countries it has banned and those
//     airlines avoiding it; Belarus closed to EU/UK/North American carriers; North Korea
//     avoided) and simulated volcanic-ash advisories, with re-routing around them.
// Polygons are deliberately coarse; nothing here is for navigation.

import { bearingDeg, destination, distanceNm } from '@shared/geo';

type Pt = [number, number];

// ---------------------------------------------------------------- regions

export type Region = 'NAM' | 'CAM' | 'SAM' | 'WEU' | 'EEU' | 'RUS' | 'MEA' | 'NAF' | 'SSA' | 'SAS' | 'CAS' | 'SEA' | 'EAS' | 'OCE';

const R: Record<Region, string> = {
  NAM: 'US CA PM GL',
  CAM: 'MX GT BZ SV HN NI CR PA CU JM HT DO PR BS KY TC VG VI AG KN LC VC GD BB TT AW CW SX BQ MQ GP DM MS AI BL MF',
  SAM: 'CO VE GY SR GF EC PE BO BR PY UY AR CL FK',
  WEU: 'GB IE FR BE NL LU DE AT CH LI IT SM VA MT ES PT AD MC DK NO SE FI IS FO GI IM JE GG',
  EEU: 'PL CZ SK HU SI HR BA RS ME MK AL GR BG RO MD UA BY LT LV EE CY TR XK',
  RUS: 'RU',
  CAS: 'KZ UZ TM KG TJ AZ GE AM MN AF',
  MEA: 'AE QA SA KW BH OM YE JO LB SY IQ IR IL PS',
  NAF: 'EG LY TN DZ MA EH SD',
  SSA: 'MR ML NE TD SN GM GW GN SL LR CI BF GH TG BJ NG CM CF GQ GA CG CD AO ZM MW MZ ZW BW NA ZA LS SZ MG MU SC KM RE YT SS ET ER DJ SO KE UG RW BI TZ CV ST',
  SAS: 'IN PK BD LK NP BT MV',
  SEA: 'TH VN LA KH MM MY SG ID BN PH TL',
  EAS: 'CN HK MO TW JP KR KP',
  OCE: 'AU NZ PG FJ NC PF VU SB WS TO KI FM MH PW NR TV CK GU MP AS',
};
const REGION_OF = new Map<string, Region>();
for (const [r, list] of Object.entries(R) as [Region, string][]) for (const c of list.split(' ')) REGION_OF.set(c, r);
export const regionOf = (country: string): Region => REGION_OF.get(country) ?? 'WEU';

/**
 * How strongly carriers flying from region `a` serve region `b` internationally
 * (relative weights; same-region international traffic is strong almost everywhere).
 * Based on the general shape of world air-traffic flows, not on any timetable.
 */
const AFF: Partial<Record<Region, Partial<Record<Region, number>>>> = {
  NAM: { NAM: 2.2, CAM: 2.4, SAM: 0.6, WEU: 2.6, EEU: 0.3, MEA: 0.25, EAS: 0.8, SEA: 0.15, SAS: 0.15, OCE: 0.2, SSA: 0.05, NAF: 0.05 },
  CAM: { NAM: 3, CAM: 1.6, SAM: 1.1, WEU: 0.7, EEU: 0.05 },
  SAM: { SAM: 2.4, NAM: 1.2, CAM: 1, WEU: 0.9, MEA: 0.15, SSA: 0.05 },
  WEU: { WEU: 3, EEU: 1.4, NAF: 0.9, MEA: 0.8, NAM: 1.7, CAM: 0.25, SAM: 0.25, SSA: 0.35, SAS: 0.35, EAS: 0.45, SEA: 0.2, CAS: 0.15, OCE: 0.03 },
  EEU: { WEU: 2.6, EEU: 1.5, MEA: 0.7, NAF: 0.4, CAS: 0.5, NAM: 0.2, EAS: 0.15, SAS: 0.1 },
  RUS: { RUS: 1, CAS: 2, MEA: 1.2, EEU: 0.5, EAS: 0.8, SAS: 0.4, SEA: 0.4, NAF: 0.3 },
  CAS: { RUS: 1.6, CAS: 1, MEA: 1.2, EEU: 0.9, WEU: 0.5, EAS: 0.5, SAS: 0.4 },
  MEA: { MEA: 1.8, SAS: 2.4, WEU: 1.4, EEU: 0.7, NAF: 1, SSA: 0.8, SEA: 0.9, EAS: 0.6, NAM: 0.45, CAS: 0.5, OCE: 0.2, RUS: 0.3, SAM: 0.05 },
  NAF: { WEU: 2.4, MEA: 1.4, NAF: 0.8, SSA: 0.8, EEU: 0.5, NAM: 0.1, SAS: 0.05 },
  SSA: { SSA: 2.2, MEA: 1.2, WEU: 1.2, NAF: 0.7, SAS: 0.35, EAS: 0.2, NAM: 0.15, SAM: 0.05 },
  SAS: { MEA: 3, SEA: 1.5, WEU: 1, SAS: 0.6, EAS: 0.35, NAM: 0.45, SSA: 0.3, CAS: 0.25, OCE: 0.25, EEU: 0.15, RUS: 0.1 },
  SEA: { SEA: 2.6, EAS: 2, SAS: 1.2, OCE: 1, MEA: 0.7, WEU: 0.5, NAM: 0.2 },
  EAS: { EAS: 2.6, SEA: 2.2, NAM: 0.8, WEU: 0.6, OCE: 0.6, SAS: 0.3, MEA: 0.3, CAS: 0.2, RUS: 0.15, EEU: 0.1 },
  OCE: { OCE: 2.4, SEA: 1.8, EAS: 1.1, NAM: 0.7, MEA: 0.6, WEU: 0.05, SAS: 0.3 },
};
export function affinity(a: Region, b: Region): number {
  return AFF[a]?.[b] ?? (a === b ? 1 : 0.05);
}
export const REGIONS = Object.keys(R) as Region[];

// ---------------------------------------------------------------- airspace closures

export interface Zone {
  id: string;
  name: string;
  poly: Pt[]; // [lat, lon] ring
  /** Who must avoid it: 'all', or countries of operators that avoid it. */
  avoidBy: 'all' | Set<string>;
  kind: 'closure' | 'ash';
  until?: number;
}

const EU = 'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE';
const RU_BANNED = new Set(`${EU} GB NO IS CH LI AL ME MK CA US AU NZ JP KR TW`.split(' '));
const BY_BANNED = new Set(`${EU} GB NO IS CH CA US`.split(' '));

/** Long-standing real-world restrictions (coarse outlines). */
export const STANDING_ZONES: Zone[] = [
  {
    id: 'UA',
    name: 'Ukraine — airspace closed to civil aviation',
    kind: 'closure',
    avoidBy: 'all',
    poly: [
      [52.3, 23.6], [52.4, 31.8], [52.1, 34.4], [50.4, 40.2], [48.0, 40.2], [46.5, 38.2], [45.3, 36.6], [44.4, 33.4], [45.4, 32.4], [46.1, 30.3], [45.2, 29.6], [45.4, 28.2], [48.2, 26.6], [48.0, 22.6], [49.1, 22.6], [51.5, 23.6],
    ],
  },
  {
    id: 'RU',
    name: 'Russia — closed to airlines of countries it has banned',
    kind: 'closure',
    avoidBy: RU_BANNED,
    poly: [
      [69.8, 30.8], [68.6, 28.4], [66.8, 29.3], [64.0, 30.1], [62.9, 31.3], [61.6, 29.8], [61.1, 28.8], [60.5, 27.8], [59.4, 28.0], [57.5, 27.6], [56.1, 28.2], [55.8, 30.9],
      [53.9, 32.0], [52.4, 34.0], [50.3, 40.2], [47.2, 39.8], [46.5, 38.0], [43.4, 40.0], [43.55, 41.9], [42.75, 44.6], [42.5, 45.7], [41.85, 46.6], [41.85, 48.6],
      [43.0, 47.5], [44.3, 47.0], [45.6, 47.6], [46.5, 48.9], [48.5, 46.6], [50.4, 48.6], [51.6, 50.6], [51.0, 55.5], [50.4, 61.4], [54.4, 69.2], [51.2, 79.9], [49.1, 87.3],
      [50.3, 98.0], [49.9, 107.8], [49.6, 116.7], [53.4, 121.4], [48.5, 134.7], [42.7, 130.7], [43.8, 135.9], [46.3, 140.2], [50.9, 143.4], [52.7, 156.6], [60.0, 163.4],
      [64.6, 178.7], [65.5, 179.9], [71.5, 179.9], [77.5, 105.0], [81.5, 60.0], [70.4, 30.9],
    ],
  },
  {
    id: 'BY',
    name: 'Belarus — closed to EU, UK and North American airlines',
    kind: 'closure',
    avoidBy: BY_BANNED,
    poly: [
      [53.9, 23.5], [54.0, 24.0], [54.6, 25.8], [55.3, 26.7], [55.7, 27.6], [56.15, 28.15], [55.8, 30.9], [53.9, 32.0], [53.1, 32.8], [52.1, 31.8], [51.5, 30.6], [51.6, 28.0], [51.6, 25.0], [51.3, 23.6],
    ],
  },
  {
    id: 'KP',
    name: 'North Korea — avoided',
    kind: 'closure',
    avoidBy: 'all',
    poly: [
      [42.9, 129.8], [41.9, 130.7], [39.6, 128.4], [38.3, 128.4], [37.7, 126.1], [38.0, 124.6], [39.8, 124.3], [40.9, 126.0], [42.4, 128.0],
    ],
  },
];

const boxes = new WeakMap<Pt[], [number, number, number, number]>();
/** Bounding box [minLat, minLon, maxLat, maxLon] of a ring (cached). */
function box(ring: Pt[]): [number, number, number, number] {
  let b = boxes.get(ring);
  if (!b) {
    b = [90, 180, -90, -180];
    for (const [la, lo] of ring) {
      b[0] = Math.min(b[0], la);
      b[1] = Math.min(b[1], lo);
      b[2] = Math.max(b[2], la);
      b[3] = Math.max(b[3], lo);
    }
    boxes.set(ring, b);
  }
  return b;
}
const inBox = (p: Pt, b: [number, number, number, number]) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];

/** Exact point-in-polygon (ray casting). */
function insideExact(p: Pt, ring: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i]!;
    const [yj, xj] = ring[j]!;
    if (yi > p[0] !== yj > p[0] && p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

const RES = 4; // cells per degree (0.25°, ~15 NM)
const rasters = new WeakMap<Pt[], { b: [number, number, number, number]; w: number; bits: Uint8Array }>();
/** Point-in-polygon through a cached 0.25° raster (exact test only for small polygons). */
function inside(p: Pt, ring: Pt[]): boolean {
  const b = box(ring);
  if (!inBox(p, b)) return false;
  if (ring.length < 24) return insideExact(p, ring);
  let r = rasters.get(ring);
  if (!r) {
    const w = Math.ceil((b[3] - b[1]) * RES) + 1;
    const h = Math.ceil((b[2] - b[0]) * RES) + 1;
    const bits = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bits[y * w + x] = insideExact([b[0] + (y + 0.5) / RES, b[1] + (x + 0.5) / RES], ring) ? 1 : 0;
    r = { b, w, bits };
    rasters.set(ring, r);
  }
  const x = Math.floor((p[1] - r.b[1]) * RES);
  const y = Math.floor((p[0] - r.b[0]) * RES);
  return r.bits[y * r.w + x] === 1;
}

const avoids = (z: Zone, operatorCountry: string | undefined) => z.avoidBy === 'all' || (!!operatorCountry && z.avoidBy.has(operatorCountry));

/** n−1 evenly spaced interior points of the great circle a→b (vector slerp: endpoints' trig once). */
function sampleGc(a: Pt, b: Pt, n: number): Pt[] {
  const r = Math.PI / 180;
  const [la1, lo1, la2, lo2] = [a[0] * r, a[1] * r, b[0] * r, b[1] * r];
  const ax = Math.cos(la1) * Math.cos(lo1);
  const ay = Math.cos(la1) * Math.sin(lo1);
  const az = Math.sin(la1);
  const bx = Math.cos(la2) * Math.cos(lo2);
  const by = Math.cos(la2) * Math.sin(lo2);
  const bz = Math.sin(la2);
  const d = Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz)));
  const out: Pt[] = [];
  if (d < 1e-9) return out;
  const sd = Math.sin(d);
  for (let k = 1; k < n; k++) {
    const f = k / n;
    const A = Math.sin((1 - f) * d) / sd;
    const B = Math.sin(f * d) / sd;
    const x = A * ax + B * bx;
    const y = A * ay + B * by;
    const z = A * az + B * bz;
    out.push([Math.atan2(z, Math.hypot(x, y)) / r, Math.atan2(y, x) / r]);
  }
  return out;
}

/** Zones the great circle a→b crosses for this operator. */
export function crossedZones(a: Pt, b: Pt, zones: Zone[], operatorCountry: string | undefined): Zone[] {
  const relevant = zones.filter((z) => avoids(z, operatorCountry));
  if (!relevant.length) return [];
  const d = distanceNm(a[0], a[1], b[0], b[1]);
  const n = Math.max(2, Math.ceil(d / 30));
  const pts = sampleGc(a, b, n);
  const hit: Zone[] = [];
  for (const z of relevant) {
    const bb = box(z.poly);
    for (const p of pts) {
      if (inBox(p, bb) && inside(p, z.poly)) {
        hit.push(z);
        break;
      }
    }
  }
  return hit;
}

export const pointInZones = (p: Pt, zones: Zone[], operatorCountry: string | undefined) => zones.some((z) => avoids(z, operatorCountry) && inside(p, z.poly));

/** Corridor points real re-routes use around the closures (Caucasus, Caspian, Central Asia, the pole…). */
const GATES: Pt[] = [
  [41.3, 33.0], // central Turkey
  [41.6, 41.6], // Black Sea coast / Batumi
  [41.3, 45.0], // Georgia
  [40.4, 50.0], // Baku / Caspian
  [41.5, 56.0], // Turkmenistan
  [42.8, 64.0], // Uzbekistan
  [44.5, 74.0], // Kazakhstan (south)
  [46.5, 82.0], // Kazakhstan (east)
  [43.0, 90.0], // Xinjiang
  [41.0, 105.0], // Inner Mongolia
  [39.5, 117.0], // Beijing area
  [36.5, 124.5], // Yellow Sea (avoids North Korea)
  [36.0, 131.5], // Sea of Japan (south)
  [55.0, 18.0], // Baltic Sea
  [60.5, 21.0], // Gulf of Bothnia
  [70.5, 22.0], // northern Norway
  [79.0, 15.0], // Svalbard
  [87.5, 0.0], // the pole
  [80.0, -120.0], // Canadian Arctic
  [72.0, -160.0], // Beaufort / Alaska north
  [64.0, -165.0], // Bering Strait (US side)
  [55.0, -165.0], // Aleutians
  [47.0, 152.0], // Kuril side, over the Pacific
  [44.0, 20.0], // Balkans
  [47.5, 26.5], // Romania / Moldova border
  [44.0, 28.5], // Black Sea west
  [36.5, 136.0], // Japan
  [50.0, 5.0], // western Europe
  [55.0, -12.0], // west of Ireland
  [63.0, -22.0], // Iceland
  [64.0, -42.0], // southern Greenland
  [58.0, -62.0], // Labrador
  [60.0, -110.0], // northern Canada
  [30.0, 60.0], // Iran / Pakistan
  [25.0, 90.0], // Bangladesh / Myanmar
  [20.0, 115.0], // South China Sea
  [42.0, 145.0], // off Hokkaido
  [52.0, -175.0], // Aleutians (west)
  [60.0, -150.0], // Alaska
  [50.5, 178.0], // south of the Bering Sea
  [48.0, 166.0], // south of the Commander Islands
  [44.5, 158.0], // off the southern Kurils
  [56.0, -170.0], // Pribilof Islands
];

const clearCache = new Map<string, boolean>();
/** Whether the great circle a→b stays out of the zones this operator avoids (memoised). */
function clear(a: Pt, b: Pt, zones: Zone[], c: string | undefined): boolean {
  const rel = zones.filter((z) => avoids(z, c));
  if (!rel.length) return true;
  // Cheap reject: the segment's (bulge-padded) box misses every zone box.
  const pad = Math.min(12, distanceNm(a[0], a[1], b[0], b[1]) / 400);
  const sb = [Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.max(a[0], b[0]) + pad + (Math.abs(a[1] - b[1]) > 60 ? 15 : 0), Math.max(a[1], b[1]) + pad];
  const crossesDateLine = Math.abs(a[1] - b[1]) > 180;
  if (!crossesDateLine && rel.every((z) => {
    const zb = box(z.poly);
    return zb[0] > sb[2]! || zb[2] < sb[0]! || zb[1] > sb[3]! || zb[3] < sb[1]!;
  }))
    return true;
  const key = `${rel.map((z) => z.id).join(',')}|${a[0].toFixed(2)},${a[1].toFixed(2)}|${b[0].toFixed(2)},${b[1].toFixed(2)}`;
  let r = clearCache.get(key);
  if (r === undefined) {
    r = !crossedZones(a, b, rel, c).length;
    if (clearCache.size > 200_000) clearCache.clear();
    clearCache.set(key, r);
  }
  return r;
}
const visCache = new Map<string, boolean[][]>();

/** Which corridor points can see each other without crossing the zones (cached per rule set). */
function gateVisibility(zones: Zone[], operatorCountry: string | undefined): boolean[][] {
  const key = zones
    .filter((z) => avoids(z, operatorCountry))
    .map((z) => z.id)
    .join('|');
  let m = visCache.get(key);
  if (!m) {
    m = GATES.map(() => GATES.map(() => false));
    for (let i = 0; i < GATES.length; i++) {
      if (pointInZones(GATES[i]!, zones, operatorCountry)) continue;
      for (let j = i + 1; j < GATES.length; j++) {
        if (pointInZones(GATES[j]!, zones, operatorCountry)) continue;
        if (distanceNm(GATES[i]![0], GATES[i]![1], GATES[j]![0], GATES[j]![1]) > 4500) continue;
        const ok = clear(GATES[i]!, GATES[j]!, zones, operatorCountry);
        m[i]![j] = ok;
        m[j]![i] = ok;
      }
    }
    visCache.set(key, m);
    if (visCache.size > 40) visCache.delete(visCache.keys().next().value!);
  }
  return m;
}

/**
 * The shortest detour around the zones this operator avoids, through corridor points
 * that real re-routes use (Caucasus, Caspian, Central Asia, the Arctic, the North
 * Atlantic, the Pacific). Returns [] when the direct route is clear, or null when no
 * clean detour exists (the caller then flies direct).
 */
export function detour(a: Pt, b: Pt, zones: Zone[], operatorCountry: string | undefined): Pt[] | null {
  if (clear(a, b, zones, operatorCountry)) return [];
  const vis = gateVisibility(zones, operatorCountry);
  const n = GATES.length;
  // Nodes 0..n-1 = gates, n = start, n+1 = end. Dijkstra on great-circle distance.
  const fromStart = GATES.map((g) => !pointInZones(g, zones, operatorCountry) && distanceNm(a[0], a[1], g[0], g[1]) < 5000 && clear(a, g, zones, operatorCountry));
  const toEnd = GATES.map((g) => !pointInZones(g, zones, operatorCountry) && distanceNm(g[0], g[1], b[0], b[1]) < 5000 && clear(g, b, zones, operatorCountry));
  const dist = new Array<number>(n + 2).fill(Infinity);
  const prev = new Array<number>(n + 2).fill(-1);
  const done = new Array<boolean>(n + 2).fill(false);
  dist[n] = 0;
  const pos = (i: number): Pt => (i === n ? a : i === n + 1 ? b : GATES[i]!);
  for (let iter = 0; iter < n + 2; iter++) {
    let u = -1;
    for (let i = 0; i < n + 2; i++) if (!done[i] && (u < 0 || dist[i]! < dist[u]!)) u = i;
    if (u < 0 || !Number.isFinite(dist[u]!)) break;
    if (u === n + 1) break;
    done[u] = true;
    const pu = pos(u);
    const relax = (v: number) => {
      const pv = pos(v);
      const d = dist[u]! + distanceNm(pu[0], pu[1], pv[0], pv[1]);
      if (d < dist[v]!) {
        dist[v] = d;
        prev[v] = u;
      }
    };
    if (u === n) {
      for (let g = 0; g < n; g++) if (fromStart[g]) relax(g);
    } else {
      for (let g = 0; g < n; g++) if (g !== u && vis[u]![g]) relax(g);
      if (toEnd[u]) relax(n + 1);
    }
  }
  if (!Number.isFinite(dist[n + 1]!)) return null;
  const out: Pt[] = [];
  for (let v = prev[n + 1]!; v !== -1 && v !== n; v = prev[v]!) out.push(GATES[v]!);
  return out.reverse();
}

// ---------------------------------------------------------------- volcanic ash (simulated)

const VOLCANOES: { name: string; lat: number; lon: number }[] = [
  { name: 'Etna', lat: 37.75, lon: 14.99 },
  { name: 'Reykjanes peninsula', lat: 63.9, lon: -22.3 },
  { name: 'Popocatépetl', lat: 19.02, lon: -98.62 },
  { name: 'Sakurajima', lat: 31.58, lon: 130.66 },
  { name: 'Merapi', lat: -7.54, lon: 110.45 },
  { name: 'Semeru', lat: -8.11, lon: 112.92 },
  { name: 'Klyuchevskoy', lat: 56.06, lon: 160.64 },
  { name: 'Fuego', lat: 14.47, lon: -90.88 },
  { name: 'Sabancaya', lat: -15.78, lon: -71.85 },
  { name: 'Ruang', lat: 2.3, lon: 125.37 },
];

/**
 * The day's simulated volcanic-ash advisory, if any (about one day in five somewhere in
 * the world): an elongated area downwind of a real active volcano that every operator avoids.
 */
export function ashAdvisory(t: number, seed: number): (Zone & { volcano: string; from: number }) | null {
  const day = Math.floor(t / 86_400_000);
  let h = (day * 2654435761 + seed * 40503) >>> 0;
  const r = () => {
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    return (h % 10_000) / 10_000;
  };
  if (r() > 0.2) return null;
  const v = VOLCANOES[Math.floor(r() * VOLCANOES.length)]!;
  const toward = Math.abs(v.lat) < 20 ? 250 + r() * 40 : 60 + r() * 60; // trades blow west, mid-latitude westerlies east
  const len = 120 + r() * 200;
  const wid = 40 + r() * 50;
  const poly: Pt[] = [];
  for (let k = 0; k < 16; k++) {
    const ang = (k / 16) * Math.PI * 2;
    const along = (Math.cos(ang) * 0.5 + 0.5) * len; // ellipse from the vent downwind
    const across = Math.sin(ang) * wid * 0.5;
    const p = destination(v.lat, v.lon, toward, along);
    poly.push(across ? destination(p[0], p[1], toward + (across > 0 ? 90 : -90), Math.abs(across)) : p);
  }
  return { id: `ASH${day}`, name: `Volcanic ash advisory — ${v.name} (simulated)`, kind: 'ash', avoidBy: 'all', poly, volcano: v.name, from: day * 86_400_000, until: (day + 1) * 86_400_000 };
}

/** Bearing helper re-exported for callers that build detour labels. */
export const bearing = (a: Pt, b: Pt) => bearingDeg(a[0], a[1], b[0], b[1]);
