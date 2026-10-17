// Statistics over an observed population. Every result carries the sample size
// and describes WHAT was sampled — never presented as a worldwide total.

import { classifyAircraft, type AircraftClass } from './classify';
import type { Aircraft } from './types';

export const ALTITUDE_BANDS = [
  { label: 'Ground', min: -Infinity, max: -Infinity },
  { label: '< 5k ft', min: -2000, max: 5000 },
  { label: '5–10k', min: 5000, max: 10000 },
  { label: '10–20k', min: 10000, max: 20000 },
  { label: '20–30k', min: 20000, max: 30000 },
  { label: '30–40k', min: 30000, max: 40000 },
  { label: '40k +', min: 40000, max: Infinity },
] as const;

export const SPEED_BANDS = [
  { label: '< 100 kt', min: 0, max: 100 },
  { label: '100–250', min: 100, max: 250 },
  { label: '250–400', min: 250, max: 400 },
  { label: '400–500', min: 400, max: 500 },
  { label: '500 kt +', min: 500, max: Infinity },
] as const;

export interface RegionStats {
  sample: number;
  airborne: number;
  onGround: number;
  climbing: number;
  descending: number;
  level: number;
  verticalUnknown: number;
  altitudeKnown: number;
  avgAltitudeFt?: number;
  speedKnown: number;
  avgGroundSpeedKt?: number;
  maxAltitude?: { id: string; label: string; value: number };
  maxSpeed?: { id: string; label: string; value: number };
  altitudeBands: { label: string; count: number }[];
  speedBands: { label: string; count: number }[];
  byClass: { cls: AircraftClass; count: number }[];
  byType: { type: string; count: number }[];
  bySource: { source: string; count: number }[];
  military: number;
  emergencies: { id: string; label: string; squawk?: string; emergency?: string }[];
  freshness: { live: number; stale: number };
}

/** Vertical rates within ±this (ft/min) count as level flight. */
export const LEVEL_TOLERANCE_FPM = 300;

const label = (a: Aircraft) => a.callsign ?? a.registration ?? a.icao24.toUpperCase();

export function computeStats(list: Aircraft[]): RegionStats {
  let airborne = 0;
  let onGround = 0;
  let climbing = 0;
  let descending = 0;
  let level = 0;
  let verticalUnknown = 0;
  let altSum = 0;
  let altN = 0;
  let spdSum = 0;
  let spdN = 0;
  let military = 0;
  let live = 0;
  let stale = 0;
  let maxAlt: RegionStats['maxAltitude'];
  let maxSpd: RegionStats['maxSpeed'];
  const altBands = ALTITUDE_BANDS.map((b) => ({ label: b.label, count: 0 }));
  const spdBands = SPEED_BANDS.map((b) => ({ label: b.label, count: 0 }));
  const cls = new Map<AircraftClass, number>();
  const types = new Map<string, number>();
  const sources = new Map<string, number>();
  const emergencies: RegionStats['emergencies'] = [];

  for (const a of list) {
    if (a.onGround) {
      onGround++;
      altBands[0]!.count++;
    } else {
      airborne++;
      const alt = a.altitudeBarometric ?? a.altitudeGeometric;
      if (alt !== undefined) {
        altSum += alt;
        altN++;
        const i = ALTITUDE_BANDS.findIndex((b, idx) => idx > 0 && alt >= b.min && alt < b.max);
        if (i > 0) altBands[i]!.count++;
        if (!maxAlt || alt > maxAlt.value) maxAlt = { id: a.id, label: label(a), value: alt };
      }
      if (a.verticalRate === undefined) verticalUnknown++;
      else if (a.verticalRate > LEVEL_TOLERANCE_FPM) climbing++;
      else if (a.verticalRate < -LEVEL_TOLERANCE_FPM) descending++;
      else level++;
    }
    if (a.groundSpeed !== undefined) {
      spdSum += a.groundSpeed;
      spdN++;
      const i = SPEED_BANDS.findIndex((b) => a.groundSpeed! >= b.min && a.groundSpeed! < b.max);
      if (i >= 0) spdBands[i]!.count++;
      if (!a.onGround && (!maxSpd || a.groundSpeed > maxSpd.value))
        maxSpd = { id: a.id, label: label(a), value: a.groundSpeed };
    }
    const c = classifyAircraft(a);
    cls.set(c, (cls.get(c) ?? 0) + 1);
    if (a.aircraftType) types.set(a.aircraftType, (types.get(a.aircraftType) ?? 0) + 1);
    sources.set(a.positionSource, (sources.get(a.positionSource) ?? 0) + 1);
    if (a.military) military++;
    if (a.freshness === 'live') live++;
    else stale++;
    if (a.emergency || a.squawk === '7500' || a.squawk === '7600' || a.squawk === '7700') {
      const e: RegionStats['emergencies'][number] = { id: a.id, label: label(a) };
      if (a.squawk) e.squawk = a.squawk;
      if (a.emergency) e.emergency = a.emergency;
      emergencies.push(e);
    }
  }

  const sortDesc = <K extends string>(m: Map<K, number>) => [...m.entries()].sort((x, y) => y[1] - x[1]);
  const stats: RegionStats = {
    sample: list.length,
    airborne,
    onGround,
    climbing,
    descending,
    level,
    verticalUnknown,
    altitudeKnown: altN,
    speedKnown: spdN,
    altitudeBands: altBands,
    speedBands: spdBands,
    byClass: sortDesc(cls).map(([c, count]) => ({ cls: c, count })),
    byType: sortDesc(types)
      .slice(0, 12)
      .map(([type, count]) => ({ type, count })),
    bySource: sortDesc(sources).map(([source, count]) => ({ source, count })),
    military,
    emergencies,
    freshness: { live, stale },
  };
  if (altN) stats.avgAltitudeFt = Math.round(altSum / altN);
  if (spdN) stats.avgGroundSpeedKt = Math.round(spdSum / spdN);
  if (maxAlt) stats.maxAltitude = maxAlt;
  if (maxSpd) stats.maxSpeed = maxSpd;
  return stats;
}
