// Runway approach geometry and observed airport movements.
// Everything here is inferred from reported positions — it is NOT an ATC
// sequence, a schedule or a landing clearance, and the UI says so.

import { angleDelta, bearingDeg, distanceNm } from './geo';
import type { Aircraft, Runway } from './types';

export interface RunwayEnd {
  ident: string;
  lat: number;
  lon: number;
  headingDeg: number; // landing direction (true)
  elevationFt?: number;
}

/** Both landing directions of every runway with published threshold coordinates. */
export function runwayEnds(runways: Runway[]): RunwayEnd[] {
  const out: RunwayEnd[] = [];
  for (const r of runways) {
    if (r.closed || r.leLat === undefined || r.leLon === undefined || r.heLat === undefined || r.heLon === undefined) continue;
    const leHdg = r.leHeadingDegT ?? bearingDeg(r.leLat, r.leLon, r.heLat, r.heLon);
    const heHdg = r.heHeadingDegT ?? bearingDeg(r.heLat, r.heLon, r.leLat, r.leLon);
    const le: RunwayEnd = { ident: r.leIdent ?? 'LE', lat: r.leLat, lon: r.leLon, headingDeg: leHdg };
    if (r.leElevationFt !== undefined) le.elevationFt = r.leElevationFt;
    const he: RunwayEnd = { ident: r.heIdent ?? 'HE', lat: r.heLat, lon: r.heLon, headingDeg: heHdg };
    if (r.heElevationFt !== undefined) he.elevationFt = r.heElevationFt;
    out.push(le, he);
  }
  return out;
}

export interface ApproachTarget {
  id: string;
  label: string;
  runway: string;
  distNm: number; // to threshold
  heightFt: number; // above threshold
  angleDeg: number; // observed descent-path angle to threshold
  verticalRate?: number;
}

export const APPROACH_RANGE_NM = 15;

/**
 * Aircraft whose position and track are consistent with an approach to a runway end:
 * within 15 NM, inside a ±12° sector off the runway end, tracking within 30° of the
 * runway heading, below 6,000 ft above the threshold, and not climbing.
 */
export function approachTargets(ends: RunwayEnd[], airportElevationFt: number | undefined, aircraft: Aircraft[]): ApproachTarget[] {
  const out: ApproachTarget[] = [];
  for (const a of aircraft) {
    if (a.onGround || a.track === undefined) continue;
    const alt = a.altitudeBarometric ?? a.altitudeGeometric;
    if (alt === undefined) continue;
    if (a.verticalRate !== undefined && a.verticalRate > 500) continue;
    let best: ApproachTarget | null = null;
    for (const e of ends) {
      const d = distanceNm(e.lat, e.lon, a.lat, a.lon);
      if (d > APPROACH_RANGE_NM || d < 0.2) continue;
      const fromThreshold = bearingDeg(e.lat, e.lon, a.lat, a.lon);
      if (Math.abs(angleDelta(e.headingDeg + 180, fromThreshold)) > 12) continue;
      if (Math.abs(angleDelta(e.headingDeg, a.track)) > 30) continue;
      const height = alt - (e.elevationFt ?? airportElevationFt ?? 0);
      if (height < -200 || height > 6000) continue;
      const angle = (Math.atan2(Math.max(0, height), d * 6076.12) * 180) / Math.PI;
      const t: ApproachTarget = { id: a.id, label: a.callsign ?? a.registration ?? a.icao24.toUpperCase(), runway: e.ident, distNm: d, heightFt: height, angleDeg: angle };
      if (a.verticalRate !== undefined) t.verticalRate = a.verticalRate;
      if (!best || d < best.distNm) best = t;
    }
    if (best) out.push(best);
  }
  return out.sort((x, y) => x.distNm - y.distNm);
}

export interface TrailSample {
  lat: number;
  lon: number;
  alt?: number; // 0 = on ground
  t: number;
}

export interface Movement {
  id: string;
  label: string;
  kind: 'arrival' | 'departure';
  t: number;
}

/**
 * Arrivals/departures OBSERVED in recorded trails: a departure is a ground report
 * near the airport followed by an airborne report nearby; an arrival is the reverse.
 * Aircraft whose ground reports are not received are missed — counts are lower bounds.
 */
export function observedMovements(lat: number, lon: number, tracks: { id: string; label: string; trail: TrailSample[] }[]): Movement[] {
  const out: Movement[] = [];
  const GROUND_NM = 4;
  const AIR_NM = 15;
  for (const tr of tracks) {
    let lastGround: TrailSample | null = null;
    let lastAir: TrailSample | null = null;
    for (const p of tr.trail) {
      if (p.alt === undefined) continue;
      const d = distanceNm(lat, lon, p.lat, p.lon);
      if (p.alt === 0 && d <= GROUND_NM) {
        if (lastAir && lastAir.t < p.t) out.push({ id: tr.id, label: tr.label, kind: 'arrival', t: p.t });
        lastAir = null;
        lastGround = p;
      } else if (p.alt > 0 && d <= AIR_NM) {
        if (lastGround && lastGround.t < p.t) out.push({ id: tr.id, label: tr.label, kind: 'departure', t: p.t });
        lastGround = null;
        lastAir = p;
      }
    }
  }
  return out.sort((a, b) => b.t - a.t);
}
