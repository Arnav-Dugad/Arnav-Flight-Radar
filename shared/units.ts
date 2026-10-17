// Explicit unit conversions. Canonical units are documented in shared/types.ts.

export const FT_PER_M = 3.280839895;
export const M_PER_NM = 1852;
export const KM_PER_NM = 1.852;
export const MI_PER_NM = 1.150779448;
export const KMH_PER_KT = 1.852;
export const MPH_PER_KT = 1.150779448;
export const MS_PER_KT = 0.514444444;
export const MS_PER_FPM = 0.00508;

export type AltitudeUnit = 'ft' | 'm' | 'fl';
export type SpeedUnit = 'kt' | 'kmh' | 'mph' | 'ms';
export type DistanceUnit = 'nm' | 'km' | 'mi';
export type TemperatureUnit = 'c' | 'f';
export type VerticalRateUnit = 'fpm' | 'ms';

export const ftToM = (ft: number) => ft / FT_PER_M;
export const mToFt = (m: number) => m * FT_PER_M;
export const cToF = (c: number) => (c * 9) / 5 + 32;

export function convertAltitude(ft: number, unit: AltitudeUnit): number {
  switch (unit) {
    case 'm':
      return ftToM(ft);
    case 'fl':
      return ft / 100;
    default:
      return ft;
  }
}

export function convertSpeed(kt: number, unit: SpeedUnit): number {
  switch (unit) {
    case 'kmh':
      return kt * KMH_PER_KT;
    case 'mph':
      return kt * MPH_PER_KT;
    case 'ms':
      return kt * MS_PER_KT;
    default:
      return kt;
  }
}

export function convertDistance(nm: number, unit: DistanceUnit): number {
  switch (unit) {
    case 'km':
      return nm * KM_PER_NM;
    case 'mi':
      return nm * MI_PER_NM;
    default:
      return nm;
  }
}

export function convertVerticalRate(fpm: number, unit: VerticalRateUnit): number {
  return unit === 'ms' ? fpm * MS_PER_FPM : fpm;
}

export function convertTemperature(c: number, unit: TemperatureUnit): number {
  return unit === 'f' ? cToF(c) : c;
}

export const UNIT_LABEL = {
  ft: 'ft',
  m: 'm',
  fl: 'FL',
  kt: 'kt',
  kmh: 'km/h',
  mph: 'mph',
  ms: 'm/s',
  nm: 'NM',
  km: 'km',
  mi: 'mi',
  c: '°C',
  f: '°F',
  fpm: 'ft/min',
} as const;
