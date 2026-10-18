// Runway configuration rules: which runway is used for arrivals and which for departures,
// and night curfews.
//
//  • Segregated mode: at airports with independent parallel runways, arrivals use one runway
//    and departures the other (Heathrow, Paris-CDG, Frankfurt, Dubai…). Departures take the
//    longer runway; Heathrow alternates its runways at 15:00 local each day (the published
//    "runway alternation" that gives residents predictable relief).
//  • Curfews: well-known night restrictions (simplified to a closed window for scheduled
//    movements). Late arrivals already in the air are still accepted, as in reality.

import { bearingDeg, distanceNm } from '@shared/geo';

export interface RunwayEnd {
  ident: string;
  lat: number;
  lon: number;
  hdg: number;
  lengthNm: number;
}

const angle = (a: number, b: number) => ((b - a + 540) % 360) - 180;

/** Lateral offset (NM) of end `b`'s threshold from end `a`'s extended centreline. */
function lateralNm(a: RunwayEnd, b: RunwayEnd): number {
  const d = distanceNm(a.lat, a.lon, b.lat, b.lon);
  if (d < 1e-6) return 0;
  const brg = bearingDeg(a.lat, a.lon, b.lat, b.lon);
  return Math.abs(d * Math.sin((angle(a.hdg, brg) * Math.PI) / 180));
}

/** Airports that alternate arrival and departure runways during the day. */
export const ALTERNATING = new Set(['EGLL']);

/**
 * The departure runway paired with an arrival runway, when the airport has an independent
 * parallel (≥ 0.4 NM apart) facing the same way; otherwise undefined (mixed mode).
 */
export function segregatedPair(ends: RunwayEnd[], inUse: RunwayEnd, ident: string, t: number, lon: number): { arr: RunwayEnd; dep: RunwayEnd } | undefined {
  const parallels = ends.filter((e) => e.ident !== inUse.ident && Math.abs(angle(e.hdg, inUse.hdg)) < 8 && lateralNm(inUse, e) >= 0.4);
  if (!parallels.length) return undefined;
  const other = parallels.reduce((b, e) => (lateralNm(inUse, e) > lateralNm(inUse, b) ? e : b), parallels[0]!);
  let [arr, dep] = other.lengthNm > inUse.lengthNm + 0.05 ? [inUse, other] : [other, inUse];
  if (other.lengthNm <= inUse.lengthNm + 0.05 && other.lengthNm >= inUse.lengthNm - 0.05) [arr, dep] = inUse.ident < other.ident ? [inUse, other] : [other, inUse];
  if (ALTERNATING.has(ident)) {
    const local = t / 3_600_000 + lon / 15;
    const day = Math.floor(local / 24);
    const afternoon = ((local % 24) + 24) % 24 >= 15;
    if ((day + (afternoon ? 1 : 0)) % 2 === 1) [arr, dep] = [dep, arr];
  }
  return { arr, dep };
}

/** Night curfews and movement bans (local times, simplified). */
export const CURFEWS: Record<string, { from: number; to: number }> = {
  EDDF: { from: 23, to: 5 },
  EDDL: { from: 23, to: 6 },
  EDDM: { from: 0, to: 5 },
  EDDS: { from: 23.5, to: 6 },
  LSZH: { from: 23.5, to: 6 },
  LSGG: { from: 0, to: 6 },
  LFPO: { from: 23.5, to: 6 },
  EGLC: { from: 22.5, to: 6.5 },
  EGLL: { from: 23.5, to: 4.5 },
  EBBR: { from: 23, to: 6 },
  EHAM: { from: 0, to: 6 },
  LOWW: { from: 23.5, to: 5.5 },
  YSSY: { from: 23, to: 6 },
  YPAD: { from: 23, to: 6 },
  YBCG: { from: 23, to: 6 },
  NZWN: { from: 0, to: 6 },
  RJOO: { from: 21, to: 7 },
  RJFF: { from: 22, to: 7 },
  RKSS: { from: 23, to: 6 },
  RCSS: { from: 23, to: 6 },
  KDCA: { from: 22, to: 7 },
  KSNA: { from: 22, to: 7 },
  KLGB: { from: 22, to: 7 },
  CYTZ: { from: 23, to: 6.75 },
  CYYZ: { from: 0.5, to: 6.5 },
  LIML: { from: 23, to: 6 },
  ESSB: { from: 22, to: 7 },
};

function hhmm(h: number) {
  const m = Math.round((((h % 24) + 24) % 24) * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** The airport's curfew window as "HH:MM"–"HH:MM" local, if it has one. */
export function curfewOf(ident: string): { from: string; to: string } | undefined {
  const c = CURFEWS[ident];
  if (!c || c.from >= 24) return undefined;
  return { from: hhmm(c.from), to: hhmm(c.to) };
}

/** If `t` falls inside the airport's curfew, the time (ms) the curfew lifts; otherwise null. */
export function curfewEnd(ident: string, t: number, lon: number): number | null {
  const c = CURFEWS[ident];
  if (!c || c.from >= 24) return null;
  const H = 3_600_000;
  const local = (((t / H + lon / 15) % 24) + 24) % 24;
  const inside = c.from < c.to ? local >= c.from && local < c.to : local >= c.from || local < c.to;
  if (!inside) return null;
  const wait = (((c.to - local) % 24) + 24) % 24;
  return t + wait * H;
}
