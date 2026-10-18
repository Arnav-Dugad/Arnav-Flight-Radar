// Procedure-style routing for the simulation, built on REAL navaids (OurAirports, public
// domain): departures leave via a real VOR/NDB in the direction of flight, arrivals
// enter (and hold) over a real navaid on the inbound side, and longer routes pass real
// navaids near the great circle. Procedure designators ("DET 2F") are generated in the
// style of real SIDs/STARs — published procedures are not freely licensed worldwide.
//
// North Atlantic flights use a simulated Organised Track System that is regenerated
// every day: eastbound tracks ride the jet stream at night, westbound tracks avoid it
// by day, in the real NAT "56/20 57/30 57/40 56/50" format.

import { bearingDeg, destination, distanceNm, intermediatePoint } from '@shared/geo';

type Pt = [number, number];

export interface Navaid {
  ident: string;
  name: string;
  kind: number; // 0 VOR, 1 VOR-DME, 2 VORTAC, 3 NDB, 4 NDB-DME
  lat: number;
  lon: number;
  freq: number; // kHz
  country: string;
}

export interface Fix {
  ident: string;
  lat: number;
  lon: number;
  /** Real navaid (true) or a generated waypoint name (false). */
  real: boolean;
  name?: string;
  kind?: number;
}

const NAV_KIND = ['VOR', 'VOR-DME', 'VORTAC', 'NDB', 'NDB-DME'];
export const navaidKind = (k: number | undefined) => (k === undefined ? 'Waypoint' : (NAV_KIND[k] ?? 'Navaid'));

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
const angle = (a: number, b: number) => ((b - a + 540) % 360) - 180;

/** Pronounceable five-letter waypoint names, like real ICAO fixes ("KODAP", "BEXIL"). */
export function fixName(seed: string): string {
  const C = 'BDFGKLMNPRSTVZ';
  const V = 'AEIOU';
  let h = hash(seed);
  const pick = (s: string) => {
    const c = s[h % s.length]!;
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
    return c;
  };
  return pick(C) + pick(V) + pick(C) + pick(V) + pick(C);
}

export class NavDb {
  private grid = new Map<string, Navaid[]>();
  readonly size: number;
  constructor(rows: [string, string, number, number, number, number, string][]) {
    for (const [ident, name, kind, lat, lon, freq, country] of rows) {
      const n: Navaid = { ident, name, kind, lat, lon, freq, country };
      const key = `${Math.floor(lat)},${Math.floor(lon)}`;
      const cell = this.grid.get(key);
      if (cell) cell.push(n);
      else this.grid.set(key, [n]);
    }
    this.size = rows.length;
  }

  private nearCache = new Map<string, Navaid | null>();
  /** Nearest VOR within `maxNm` of a point, cached on a 0.25° grid (en-route waypoints). */
  nearestVor(lat: number, lon: number, maxNm: number): Navaid | undefined {
    const key = `${Math.round(lat * 4)},${Math.round(lon * 4)},${maxNm}`;
    let hit = this.nearCache.get(key);
    if (hit === undefined) {
      // Allocation-free scan of the neighbouring 1° cells.
      let best: Navaid | null = null;
      let bd = maxNm;
      const dLat = Math.ceil(maxNm / 60);
      const dLon = Math.ceil(maxNm / (60 * Math.max(0.15, Math.cos((lat * Math.PI) / 180))));
      const fl = Math.floor(lat);
      const fo = Math.floor(lon);
      for (let a = fl - dLat; a <= fl + dLat; a++) {
        for (let b = fo - dLon; b <= fo + dLon; b++) {
          const cell = this.grid.get(`${a},${((b + 540) % 360) - 180}`);
          if (!cell) continue;
          for (const n of cell) {
            if (n.kind >= 3) continue;
            const d = distanceNm(lat, lon, n.lat, n.lon);
            if (d < bd) {
              bd = d;
              best = n;
            }
          }
        }
      }
      hit = best;
      this.nearCache.set(key, hit);
    }
    return hit ?? undefined;
  }

  /** Navaids within `maxNm` of a point (VOR family first if `vorOnly`). */
  near(lat: number, lon: number, maxNm: number, vorOnly = false): (Navaid & { d: number })[] {
    const out: (Navaid & { d: number })[] = [];
    const dLat = Math.ceil(maxNm / 60);
    const dLon = Math.ceil(maxNm / (60 * Math.max(0.15, Math.cos((lat * Math.PI) / 180))));
    for (let a = Math.floor(lat) - dLat; a <= Math.floor(lat) + dLat; a++) {
      for (let b = Math.floor(lon) - dLon; b <= Math.floor(lon) + dLon; b++) {
        for (const n of this.grid.get(`${a},${((b + 540) % 360) - 180}`) ?? []) {
          if (vorOnly && n.kind >= 3) continue;
          const d = distanceNm(lat, lon, n.lat, n.lon);
          if (d <= maxNm) out.push({ ...n, d });
        }
      }
    }
    return out.sort((x, y) => x.d - y.d);
  }
}

const toFix = (n: Navaid): Fix => ({ ident: n.ident, lat: n.lat, lon: n.lon, real: true, name: n.name, kind: n.kind });

/** Letter used for a procedure from a runway designator (stable per airport & runway). */
function procLetter(airport: string, runway: string, arrival: boolean): string {
  const L = arrival ? 'ABCDEFGHJKLMNPRSTUVWXYZ' : 'FGHJKLMNPQRSTUVWXYZABCDE';
  return L[hash(airport + runway + (arrival ? 'A' : 'D')) % L.length]!;
}

export interface Procedure {
  name: string; // e.g. "DET 2F"
  fix: Fix; // departure exit / arrival entry fix
}

/**
 * Departure procedure: the navaid 18–75 NM out in the direction of flight. Falls back to
 * a generated waypoint at 35 NM when no navaid is suitable.
 */
const sidCache = new WeakMap<object, Map<string, Procedure>>();
const starCache = new WeakMap<object, Map<string, Procedure>>();
const NO_NAV = {};
function cached(store: WeakMap<object, Map<string, Procedure>>, nav: NavDb | null, key: string, build: () => Procedure): Procedure {
  const owner = nav ?? NO_NAV;
  let m = store.get(owner);
  if (!m) store.set(owner, (m = new Map()));
  let p = m.get(key);
  if (!p) m.set(key, (p = build()));
  return p;
}

export function sidFor(nav: NavDb | null, ap: { ident: string; lat: number; lon: number }, runway: string, crs: number): Procedure {
  // Procedures are stable per airport, runway and 10° of departure course.
  const c10 = Math.round((((crs % 360) + 360) % 360) / 10) * 10;
  return cached(sidCache, nav, `${ap.ident}|${runway}|${c10}`, () => buildSid(nav, ap, runway, c10));
}

function buildSid(nav: NavDb | null, ap: { ident: string; lat: number; lon: number }, runway: string, crs: number): Procedure {
  let best: Navaid | undefined;
  let score = Infinity;
  for (const n of nav?.near(ap.lat, ap.lon, 75, true) ?? []) {
    if (n.d < 18) continue;
    const off = Math.abs(angle(crs, bearingDeg(ap.lat, ap.lon, n.lat, n.lon)));
    if (off > 40) continue;
    const s = off * 1.6 + Math.abs(n.d - 40) * 0.4;
    if (s < score) {
      score = s;
      best = n;
    }
  }
  const fix: Fix = best ? toFix(best) : (() => {
    const [lat, lon] = destination(ap.lat, ap.lon, Math.round(crs / 15) * 15, 35);
    return { ident: fixName(`${ap.ident}D${Math.round(crs / 15)}`), lat, lon, real: false };
  })();
  const digit = (hash(ap.ident + fix.ident) % 9) + 1;
  return { name: `${fix.ident.length <= 3 ? fix.ident : fix.ident.slice(0, 5)} ${digit}${procLetter(ap.ident, runway, false)}`, fix };
}

/**
 * Arrival procedure: the navaid 22–60 NM out on the inbound side (aircraft hold there
 * when the airport is busy, like the real holding stacks). Falls back to a generated fix.
 */
export function starFor(nav: NavDb | null, ap: { ident: string; lat: number; lon: number }, runway: string, inboundFrom: number): Procedure {
  // Real arrivals funnel traffic through a few entry points: snap the inbound bearing
  // to one of four quadrants so different origins share the same stack.
  const quadrant = (Math.round(((inboundFrom % 360) + 360) % 360 / 90) % 4) * 90 + 45;
  return cached(starCache, nav, `${ap.ident}|${runway}|${quadrant}`, () => buildStar(nav, ap, runway, quadrant));
}

function buildStar(nav: NavDb | null, ap: { ident: string; lat: number; lon: number }, runway: string, quadrant: number): Procedure {
  let best: Navaid | undefined;
  let score = Infinity;
  for (const n of nav?.near(ap.lat, ap.lon, 60, true) ?? []) {
    if (n.d < 22) continue;
    const off = Math.abs(angle(quadrant, bearingDeg(ap.lat, ap.lon, n.lat, n.lon)));
    if (off > 50) continue;
    const s = off + Math.abs(n.d - 35) * 0.6;
    if (s < score) {
      score = s;
      best = n;
    }
  }
  const fix: Fix = best ? toFix(best) : (() => {
    const [lat, lon] = destination(ap.lat, ap.lon, quadrant, 32);
    return { ident: fixName(`${ap.ident}A${quadrant}`), lat, lon, real: false };
  })();
  const digit = (hash(fix.ident + ap.ident) % 9) + 1;
  return { name: `${fix.ident.slice(0, 5)} ${digit}${procLetter(ap.ident, runway, true)}`, fix };
}

/**
 * En-route waypoints: real navaids near the great circle every ~250 NM (free-route
 * airspace "DCT" legs between them). Oceans have none, so the route stays direct.
 */
export function enroute(nav: NavDb | null, a: Fix, b: Fix): Fix[] {
  if (!nav) return [];
  const total = distanceNm(a.lat, a.lon, b.lat, b.lon);
  if (total < 320) return [];
  const n = Math.floor(total / 250);
  const out: Fix[] = [];
  for (let i = 1; i <= n; i++) {
    const [lat, lon] = intermediatePoint(a.lat, a.lon, b.lat, b.lon, i / (n + 1));
    const hit = nav.nearestVor(lat, lon, 35);
    if (hit && !out.some((f) => f.ident === hit.ident)) out.push(toFix(hit));
  }
  return out;
}

// ---------------------------------------------------------------- North Atlantic tracks

export interface NatTrack {
  letter: string;
  eastbound: boolean;
  /** Whole-degree latitudes at 20°W, 30°W, 40°W and 50°W (real NAT message format). */
  lats: [number, number, number, number];
  /** Validity window at 30°W (UTC ms). */
  from: number;
  to: number;
  levels: number[]; // flight levels (hundreds of feet)
}

const NAT_LONS = [-20, -30, -40, -50];

/**
 * The day's simulated Organised Track System. Eastbound (night) tracks are laid along
 * the jet stream to use its tailwind; westbound (day) tracks route north of it.
 */
export function natTracks(t: number, seed: number): NatTrack[] {
  const day = Math.floor(t / 86_400_000);
  const D = day * 86_400_000;
  const h = hash(`nat${day}${seed}`);
  const month = new Date(t).getUTCMonth();
  const winter = month <= 2 || month >= 10;
  const jet = (winter ? 49 : 53) + ((h % 5) - 2);
  const bend = ((h >>> 5) % 5) - 2;
  const tracks: NatTrack[] = [];
  // Westbound: valid 11:30–19:00Z at 30°W, letters from A, placed north of the jet.
  const wCore = jet + 6 + ((h >>> 9) % 3);
  for (let i = 0; i < 6; i++) {
    const base = wCore - i;
    tracks.push({
      letter: 'ABCDEF'[i]!,
      eastbound: false,
      lats: [base - bend, base, base + (bend > 0 ? 0 : 1), base - Math.sign(bend)].map((x) => Math.max(44, Math.min(66, x))) as NatTrack['lats'],
      from: D + 11.5 * 3_600_000,
      to: D + 19 * 3_600_000,
      levels: [310, 320, 330, 340, 350, 360, 370, 380, 390],
    });
  }
  // Eastbound: valid 01:00–08:00Z at 30°W, letters from Z backwards, along the jet core.
  for (let i = 0; i < 6; i++) {
    const base = jet + 3 - i;
    tracks.push({
      letter: 'ZYXWVU'[i]!,
      eastbound: true,
      lats: [base + bend, base + Math.sign(bend), base, base - 1].map((x) => Math.max(42, Math.min(64, x))) as NatTrack['lats'],
      from: D + 1 * 3_600_000,
      to: D + 8 * 3_600_000,
      levels: [310, 320, 330, 340, 350, 360, 370, 380, 390, 400],
    });
  }
  return tracks;
}

export const natPoints = (tr: NatTrack): Pt[] => tr.lats.map((la, i) => [la, NAT_LONS[i]!] as Pt);
export const natString = (tr: NatTrack) => tr.lats.map((la, i) => `${la}/${-NAT_LONS[i]!}`).join(' ');

/**
 * Track assignment for a transatlantic flight crossing 30°W at `t30` (UTC ms), or null when
 * the flight is outside the system (random routing). Points are returned in flight order.
 */
export function assignNat(a: { lat: number; lon: number }, b: { lat: number; lon: number }, t30: number, seed: number, flight: string): { track: NatTrack; pts: Pt[] } | null {
  const europe = (p: { lat: number; lon: number }) => p.lon > -16 && p.lon < 45 && p.lat > 34;
  const america = (p: { lat: number; lon: number }) => p.lon < -52 && p.lat > 20;
  const eastbound = america(a) && europe(b);
  if (!eastbound && !(europe(a) && america(b))) return null;
  // Latitude where the great circle crosses 30°W (sampled).
  let lat30 = NaN;
  for (let k = 1; k < 64; k++) {
    const p = intermediatePoint(a.lat, a.lon, b.lat, b.lon, k / 64);
    const q = intermediatePoint(a.lat, a.lon, b.lat, b.lon, (k + 1) / 64);
    if ((p[1] - -30) * (q[1] - -30) <= 0) {
      lat30 = (p[0] + q[0]) / 2;
      break;
    }
  }
  if (!Number.isFinite(lat30) || lat30 < 40 || lat30 > 68) return null;
  // Tracks of this direction valid around the crossing time (one day either side).
  const day = Math.floor(t30 / 86_400_000);
  const cand = [...natTracks((day - 1) * 86_400_000, seed), ...natTracks(t30, seed)].filter((t) => t.eastbound === eastbound && t30 >= t.from - 30 * 60_000 && t30 <= t.to + 30 * 60_000);
  if (!cand.length) return null;
  // Nearest track to the great-circle latitude, with a little spread between flights.
  cand.sort((x, y) => Math.abs(x.lats[1] - lat30) - Math.abs(y.lats[1] - lat30));
  const pick = cand[Math.min(cand.length - 1, hash(flight) % 3 === 0 ? 1 : 0)]!;
  const pts = natPoints(pick);
  return { track: pick, pts: eastbound ? pts.reverse() : pts };
}
