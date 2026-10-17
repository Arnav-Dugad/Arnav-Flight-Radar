// Aircraft filters — pure functions over normalized records (unit-tested).

import { classifyAircraft, type AircraftClass } from '@shared/classify';
import { countryFromIcao } from '@shared/icaoCountry';
import { LEVEL_TOLERANCE_FPM } from '@shared/stats';
import type { Aircraft, PositionSource } from '@shared/types';

export type VerticalState = 'climbing' | 'descending' | 'level';

export interface Filters {
  altitude: [number, number] | null; // ft (barometric, falling back to geometric)
  speed: [number, number] | null; // kt ground speed
  classes: AircraftClass[];
  ground: 'all' | 'airborne' | 'ground';
  vertical: VerticalState[];
  callsign: string;
  registration: string;
  type: string;
  squawk: string;
  countries: string[]; // ISO codes from ICAO address block
  sources: PositionSource[];
  maxAgeSec: number | null;
  militaryOnly: boolean;
  emergenciesOnly: boolean;
  excludeUnknown: boolean; // drop aircraft whose filtered field is unknown
}

export const EMPTY_FILTERS: Filters = {
  altitude: null,
  speed: null,
  classes: [],
  ground: 'all',
  vertical: [],
  callsign: '',
  registration: '',
  type: '',
  squawk: '',
  countries: [],
  sources: [],
  maxAgeSec: null,
  militaryOnly: false,
  emergenciesOnly: false,
  excludeUnknown: false,
};

export function activeFilterCount(f: Filters): number {
  let n = 0;
  if (f.altitude) n++;
  if (f.speed) n++;
  if (f.classes.length) n++;
  if (f.ground !== 'all') n++;
  if (f.vertical.length) n++;
  if (f.callsign.trim()) n++;
  if (f.registration.trim()) n++;
  if (f.type.trim()) n++;
  if (f.squawk.trim()) n++;
  if (f.countries.length) n++;
  if (f.sources.length) n++;
  if (f.maxAgeSec !== null) n++;
  if (f.militaryOnly) n++;
  if (f.emergenciesOnly) n++;
  return n;
}

export function verticalState(vr: number | undefined): VerticalState | undefined {
  if (vr === undefined) return undefined;
  if (vr > LEVEL_TOLERANCE_FPM) return 'climbing';
  if (vr < -LEVEL_TOLERANCE_FPM) return 'descending';
  return 'level';
}

/** Compiles filters into a fast predicate. `ageSec` supplies current position age. */
export function compileFilter(f: Filters): (a: Aircraft, ageSec?: number) => boolean {
  const cs = f.callsign.trim().toUpperCase();
  const reg = f.registration.trim().toUpperCase().replace(/-/g, '');
  const type = f.type.trim().toUpperCase();
  const sq = f.squawk.trim();
  const classes = f.classes.length ? new Set(f.classes) : null;
  const countries = f.countries.length ? new Set(f.countries) : null;
  const sources = f.sources.length ? new Set(f.sources) : null;
  const vertical = f.vertical.length ? new Set(f.vertical) : null;
  const strict = f.excludeUnknown;

  return (a, ageSec) => {
    if (f.ground === 'airborne' && a.onGround) return false;
    if (f.ground === 'ground' && !a.onGround) return false;

    if (f.altitude) {
      const alt = a.onGround ? 0 : (a.altitudeBarometric ?? a.altitudeGeometric);
      if (alt === undefined) {
        if (strict) return false;
      } else if (alt < f.altitude[0] || alt > f.altitude[1]) return false;
    }
    if (f.speed) {
      if (a.groundSpeed === undefined) {
        if (strict) return false;
      } else if (a.groundSpeed < f.speed[0] || a.groundSpeed > f.speed[1]) return false;
    }
    if (vertical) {
      const v = a.onGround ? undefined : verticalState(a.verticalRate);
      if (v === undefined) {
        if (strict || a.onGround) return false;
      } else if (!vertical.has(v)) return false;
    }
    if (classes && !classes.has(classifyAircraft(a))) return false;
    if (cs) {
      if (!a.callsign) return false;
      if (!a.callsign.includes(cs)) return false;
    }
    if (reg) {
      if (!a.registration) return false;
      if (!a.registration.replace(/-/g, '').includes(reg)) return false;
    }
    if (type) {
      const t = `${a.aircraftType ?? ''} ${a.typeDescription?.toUpperCase() ?? ''}`;
      if (!a.aircraftType && !a.typeDescription) return false;
      if (!t.includes(type)) return false;
    }
    if (sq) {
      if (!a.squawk || !a.squawk.startsWith(sq)) return false;
    }
    if (countries) {
      // An aircraft whose registry country is unknown can never match a country filter.
      const c = countryFromIcao(a.icao24);
      if (!c || !countries.has(c.iso)) return false;
    }
    if (sources && !sources.has(a.positionSource)) return false;
    if (f.maxAgeSec !== null && ageSec !== undefined && ageSec > f.maxAgeSec) return false;
    if (f.militaryOnly && !a.military) return false;
    if (f.emergenciesOnly && !(a.emergency || a.squawk === '7500' || a.squawk === '7600' || a.squawk === '7700'))
      return false;
    return true;
  };
}
