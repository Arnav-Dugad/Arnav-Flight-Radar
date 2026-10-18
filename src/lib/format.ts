import {
  convertAltitude,
  convertDistance,
  convertSpeed,
  convertTemperature,
  convertVerticalRate,
  UNIT_LABEL,
  type AltitudeUnit,
  type DistanceUnit,
  type SpeedUnit,
  type TemperatureUnit,
  type VerticalRateUnit,
} from '@shared/units';

export const NA = 'Not available';

const nf0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

export function fmtInt(n: number | undefined): string {
  return n === undefined ? NA : nf0.format(n);
}

export function altitudeParts(ft: number | undefined, unit: AltitudeUnit, onGround = false) {
  if (onGround) return { value: 'GND', unit: '' };
  if (ft === undefined) return { value: NA, unit: '' };
  if (unit === 'fl') return { value: String(Math.round(ft / 100)).padStart(3, '0'), unit: 'FL', prefix: true };
  return { value: nf0.format(Math.round(convertAltitude(ft, unit))), unit: UNIT_LABEL[unit] };
}

export function fmtAltitude(ft: number | undefined, unit: AltitudeUnit, onGround = false): string {
  const p = altitudeParts(ft, unit, onGround);
  if (!p.unit) return p.value;
  return 'prefix' in p && p.prefix ? `${p.unit}${p.value}` : `${p.value} ${p.unit}`;
}

export function speedParts(kt: number | undefined, unit: SpeedUnit) {
  if (kt === undefined) return { value: NA, unit: '' };
  const v = convertSpeed(kt, unit);
  return { value: unit === 'ms' ? nf1.format(v) : nf0.format(Math.round(v)), unit: UNIT_LABEL[unit] };
}

export function fmtSpeed(kt: number | undefined, unit: SpeedUnit): string {
  const p = speedParts(kt, unit);
  return p.unit ? `${p.value} ${p.unit}` : p.value;
}

export function fmtDistance(nm: number | undefined, unit: DistanceUnit): string {
  if (nm === undefined) return NA;
  const v = convertDistance(nm, unit);
  return `${v < 10 ? nf1.format(v) : nf0.format(v)} ${UNIT_LABEL[unit]}`;
}

export function vrateParts(fpm: number | undefined, unit: VerticalRateUnit) {
  if (fpm === undefined) return { value: NA, unit: '' };
  const v = convertVerticalRate(fpm, unit);
  const s = unit === 'ms' ? nf1.format(Math.abs(v)) : nf0.format(Math.abs(Math.round(v)));
  const sign = fpm > 0 ? '+' : fpm < 0 ? '−' : '';
  return { value: `${sign}${s}`, unit: UNIT_LABEL[unit] };
}

export function fmtVRate(fpm: number | undefined, unit: VerticalRateUnit): string {
  const p = vrateParts(fpm, unit);
  return p.unit ? `${p.value} ${p.unit}` : p.value;
}

export function fmtTemp(c: number | undefined, unit: TemperatureUnit): string {
  if (c === undefined) return NA;
  return `${nf0.format(Math.round(convertTemperature(c, unit)))}${UNIT_LABEL[unit]}`;
}

export function fmtBearing(deg: number | undefined): string {
  if (deg === undefined) return NA;
  return `${String(Math.round(deg) % 360).padStart(3, '0')}°`;
}

export function fmtCoord(n: number | undefined, digits = 5): string {
  return n === undefined ? NA : n.toFixed(digits);
}

export function fmtAgo(ms: number): string {
  if (!Number.isFinite(ms)) return NA;
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

export function fmtAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function fmtTimeUTC(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19) + 'Z';
}

export function fmtDateTimeUTC(ms: number): string {
  const d = new Date(ms).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)}Z`;
}

export function fmtLocalTime(ms: number, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone,
    }).format(ms);
  } catch {
    return new Date(ms).toLocaleTimeString();
  }
}

export function fmtMhz(mhz: number): string {
  // Aviation frequencies use 2–3 decimals (8.33 kHz channels need 3).
  return `${mhz.toFixed(3).replace(/0$/, '')} MHz`;
}

export function fmtNumber(n: number | undefined, dp = 0): string {
  if (n === undefined) return NA;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: dp, minimumFractionDigits: dp }).format(n);
}

export function fmtPercent(part: number, total: number): string {
  if (!total) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

/** Hours and minutes, UTC (schedules). */
export function fmtHmUTC(ms: number): string {
  return new Date(ms).toISOString().slice(11, 16) + 'Z';
}
