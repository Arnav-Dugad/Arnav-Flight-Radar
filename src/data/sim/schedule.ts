// Timetable shape for the simulation: which days a route operates, IATA seasons,
// seasonal (leisure / ski / winter-sun) demand, weekday traffic patterns and load factors.
// Everything here is a model of how airline schedules generally behave, not real timetables.

import type { AirlineModel } from './refTypes';

const DAY = 86_400_000;
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Local weekday (0 = Sunday) at a longitude, using solar time. */
export function localWeekday(t: number, lon: number): number {
  return new Date(t + (lon / 15) * 3_600_000).getUTCDay();
}

/** Local solar hour (0–24) at a longitude. */
export function localHour(t: number, lon: number): number {
  return (((t / 3_600_000 + lon / 15) % 24) + 24) % 24;
}

// ---------------------------------------------------------------- IATA seasons

/** Last Sunday of a month (UTC midnight). */
function lastSunday(year: number, month: number): number {
  const d = new Date(Date.UTC(year, month + 1, 0));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.getTime();
}

/**
 * IATA scheduling season: Summer runs from the last Sunday of March to the Saturday
 * before the last Sunday of October; Winter covers the rest. Names like "S26" / "W26".
 */
export function iataSeason(t: number): { code: string; name: string; summer: boolean; start: number; end: number } {
  const y = new Date(t).getUTCFullYear();
  const s0 = lastSunday(y, 2);
  const w0 = lastSunday(y, 9);
  const yy = (n: number) => String(n % 100).padStart(2, '0');
  if (t >= s0 && t < w0) return { code: `S${yy(y)}`, name: `Summer ${y}`, summer: true, start: s0, end: w0 - DAY };
  if (t >= w0) return { code: `W${yy(y)}`, name: `Winter ${y}/${yy(y + 1)}`, summer: false, start: w0, end: lastSunday(y + 1, 2) - DAY };
  return { code: `W${yy(y - 1)}`, name: `Winter ${y - 1}/${yy(y)}`, summer: false, start: lastSunday(y - 1, 9), end: s0 - DAY };
}

// ---------------------------------------------------------------- leisure geography

export type Leisure = 'summer-sun' | 'winter-sun' | 'ski' | 'all-year' | null;

const SKI = new Set(['LOWI', 'LOWS', 'LFLS', 'LFLB', 'LFLP', 'LSGS', 'LSZS', 'LIPB', 'KEGE', 'KASE', 'KHDN', 'KJAC', 'KSUN', 'KMTJ', 'CYLW', 'RJCC', 'ESNZ', 'ENTC', 'EFRO', 'EFKT', 'LOWK', 'LFKB', 'EPKK']);
const ALL_YEAR = new Set(['GCLP', 'GCTS', 'GCRR', 'GCFV', 'GCLA', 'LPMA', 'MMUN', 'MDPC', 'MKJS', 'TNCA', 'MBPV', 'HEGN', 'HESH', 'VRMM', 'VTSP', 'WADD', 'PHOG', 'PHNL', 'PHKO', 'PHLI', 'KMCO', 'KFLL', 'KMIA', 'KLAS', 'KRSW', 'KPBI', 'KTPA', 'FIMP', 'FSIA', 'HKMO', 'GVAC', 'GVBA', 'OMDB', 'OMDW']);
/** Mediterranean, Adriatic, Aegean, Black Sea and Atlantic beach airports that peak in summer. */
function summerSun(ident: string, lat: number, lon: number): boolean {
  if (/^(LG|LD|LC|LM|LT[BF]|LEPA|LEIB|LEMH|LEAL|LEMG|LERS|LEGE|LIEO|LIEE|LICC|LICJ|LICA|LIBP|LIBR|LFKJ|LFKB|LFKF|LFMN|LFTH|LPFR|LBBG|LBWN|LWOH|LATI|LYTV|LQMO|LRCK|UKOO|UDSG|HEMA|DTMB|DTTJ|GMMX|GMAD)/.test(ident)) return true;
  // Mediterranean coast box, excluding the hubs (checked by caller).
  return lat >= 35 && lat <= 44.5 && lon >= -6 && lon <= 36 && !/^(LEMD|LIRF|LIMC|LGAV|LTFM|LTBA|LTAI|LFPG|LFPO)$/.test(ident);
}
const WINTER_SUN_BOX = (lat: number, lon: number) => (lat >= 9 && lat <= 27.5 && lon >= -90 && lon <= -59) || (lat >= 27 && lat <= 29.5 && lon >= -18.5 && lon <= -13);

export function leisureOf(ident: string, lat: number, lon: number): Leisure {
  if (SKI.has(ident)) return 'ski';
  if (ALL_YEAR.has(ident)) return 'all-year';
  if (WINTER_SUN_BOX(lat, lon)) return 'winter-sun';
  if (summerSun(ident, lat, lon)) return 'summer-sun';
  return null;
}

/**
 * Seasonal demand multiplier for flights to an airport (used to weight destinations).
 * Northern-hemisphere seasons; ski airports peak December–March.
 */
export function seasonalWeight(leisure: Leisure, t: number, model: AirlineModel): number {
  if (!leisure) return 1;
  const m = new Date(t).getUTCMonth(); // 0 = Jan
  const holiday = model === 'leisure' || model === 'low' || model === 'charter' ? 1.6 : 1;
  switch (leisure) {
    case 'summer-sun': {
      // Peak July–August, shoulder May/June/September/October, very quiet in winter.
      const k = [0.25, 0.25, 0.4, 0.75, 1.1, 1.45, 1.8, 1.85, 1.4, 0.95, 0.35, 0.3][m]!;
      return k * holiday;
    }
    case 'winter-sun':
      return [1.5, 1.5, 1.35, 1.1, 0.8, 0.7, 0.85, 0.85, 0.6, 0.8, 1.2, 1.6][m]! * holiday;
    case 'ski':
      return [1.9, 1.9, 1.6, 0.8, 0.3, 0.5, 0.7, 0.7, 0.4, 0.3, 0.5, 1.5][m]! * holiday;
    case 'all-year':
      return 1.15 * (holiday > 1 ? 1.3 : 1);
  }
}

// ---------------------------------------------------------------- days of operation

export interface RouteDays {
  mask: number; // bit 0 = Sunday … bit 6 = Saturday
  perWeek: number;
}

const DAY_SETS: Record<number, number[]> = {
  1: [0b0100000, 0b0000001, 0b1000000],
  2: [0b0100010, 0b1000100, 0b0010001, 0b0101000],
  3: [0b0101010, 0b1010100, 0b0100101, 0b1001010],
  4: [0b0101011, 0b1100110, 0b0110101, 0b1010011],
  5: [0b0111110, 0b1011011, 0b1101101, 0b0111011],
  6: [0b1111110, 0b0111111, 0b1011111],
  7: [0b1111111],
};

/**
 * Days a route operates. Trunk routes between hubs and large airports run daily; thinner
 * long-haul and leisure routes run a few times a week (stable per route).
 */
export function routeDays(airline: string, from: string, to: string, opts: { distNm: number; hubEnd: boolean; bothLarge: boolean; leisure: Leisure; model: AirlineModel }): RouteDays {
  const pair = from < to ? from + to : to + from;
  const h = hash(`${airline}|${pair}`);
  // Ski charters and leisure flights to the Alps change over on Saturdays.
  if (opts.leisure === 'ski' && (opts.model === 'leisure' || opts.model === 'charter' || opts.model === 'low')) return skiChangeover(h);
  let per = 7;
  if (opts.model === 'cargo') per = opts.bothLarge ? 5 + (h % 3) : 3 + (h % 3);
  else if (opts.leisure && opts.leisure !== 'all-year' && !opts.bothLarge) per = 2 + (h % 4);
  else if (!opts.bothLarge && opts.distNm > 2500) per = 3 + (h % 4);
  else if (!opts.hubEnd && !opts.bothLarge) per = 4 + (h % 4);
  else if (opts.distNm > 4500 && !opts.bothLarge) per = 4 + (h % 4);
  per = Math.min(7, Math.max(1, per));
  const sets = DAY_SETS[per]!;
  return { mask: sets[(h >>> 7) % sets.length]!, perWeek: per };
}

export function operatesOn(days: RouteDays, weekday: number): boolean {
  return ((days.mask >> weekday) & 1) === 1;
}

export function daysLabel(days: RouteDays): string {
  if (days.perWeek === 7) return 'Daily';
  // Monday-first, as on airline timetables.
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => (days.mask >> d) & 1).map((d) => WEEKDAYS[d]).join(' ');
}

// ---------------------------------------------------------------- weekday traffic

/**
 * How much longer aircraft sit on the ground on a given local weekday (1 = normal).
 * Passenger traffic peaks on Friday and Sunday and dips on Saturday and Tuesday;
 * general aviation flies far more at weekends; cargo is quiet on Sunday.
 */
export function weekdayGroundFactor(weekday: number, kind: 'airline' | 'cargo' | 'ga' | 'bizjet'): number {
  switch (kind) {
    case 'airline':
      return [0.95, 1, 1.12, 1.08, 1, 0.92, 1.25][weekday]!;
    case 'cargo':
      return [1.6, 1.05, 1, 1, 1, 0.95, 1.3][weekday]!;
    case 'ga':
      return [0.45, 1.5, 1.4, 1.35, 1.3, 1.05, 0.4][weekday]!;
    case 'bizjet':
      return [1.2, 0.85, 0.95, 0.95, 0.85, 0.8, 1.4][weekday]!;
  }
}

// ---------------------------------------------------------------- load factors

/** Expected seat load factor for a flight (0.3–1), deterministic per flight and day. */
export function loadFactor(opts: { model: AirlineModel; flight: string; std: number; fromLon: number; leisure: Leisure; longHaul: boolean; country?: string }): number {
  const base: Record<AirlineModel, number> = { full: 0.82, low: 0.92, regional: 0.74, leisure: 0.9, cargo: 0, bizjet: 0.45, charter: 0.93 };
  let lf = base[opts.model];
  const m = new Date(opts.std).getUTCMonth();
  lf += [-0.07, -0.06, -0.01, 0.01, 0.02, 0.04, 0.06, 0.06, 0.02, 0.01, -0.03, 0.01][m]!;
  const wd = localWeekday(opts.std, opts.fromLon);
  lf += opts.model === 'full' ? [0.04, 0.02, -0.04, -0.03, 0.01, 0.05, -0.06][wd]! : [0.04, -0.01, -0.05, -0.04, 0, 0.05, 0.01][wd]!;
  const h = localHour(opts.std, opts.fromLon);
  if (h < 6.5 || h > 22) lf -= 0.06;
  else if ((h >= 7 && h < 9.5) || (h >= 17 && h < 19.5)) lf += 0.03;
  if (opts.longHaul) lf += 0.02;
  lf += holidayUplift(opts.std, opts.country);
  const day = Math.floor(opts.std / DAY);
  const r = (hash(`${opts.flight}|${day}`) % 1000) / 1000;
  lf += (r - 0.5) * 0.18;
  return Math.max(0.3, Math.min(1, lf));
}

// ---------------------------------------------------------------- daylight

/** Approximate sunrise/sunset in local solar hours (for VFR flying and gliding). */
export function daylight(t: number, lat: number): { rise: number; set: number } {
  const doy = Math.floor((t - Date.UTC(new Date(t).getUTCFullYear(), 0, 1)) / DAY);
  const decl = 23.44 * Math.sin(((2 * Math.PI) / 365) * (doy - 81));
  const x = -Math.tan((lat * Math.PI) / 180) * Math.tan((decl * Math.PI) / 180);
  if (x <= -1) return { rise: 0, set: 24 }; // midnight sun
  if (x >= 1) return { rise: 12, set: 12 }; // polar night
  const half = (Math.acos(x) * 180) / Math.PI / 15;
  return { rise: 12 - half, set: 12 + half };
}

// ---------------------------------------------------------------- holidays and pilgrimage

export interface Holiday {
  name: string;
  /** Countries (ISO) whose travellers it affects, or 'all'. */
  countries: string[] | 'all';
  from: number;
  to: number;
}

const D = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

/** Major travel peaks (dates for 2026–2028; movable feasts precomputed). */
const HOLIDAYS: Holiday[] = [
  ...[2025, 2026, 2027].map((y) => ({ name: 'Christmas & New Year', countries: 'all' as const, from: D(y, 12, 18), to: D(y + 1, 1, 5) })),
  // Thanksgiving: the Wednesday before the fourth Thursday of November to the Sunday after.
  ...[2026, 2027, 2028].map((y) => {
    const nov1 = new Date(D(y, 11, 1)).getUTCDay();
    const thu = 1 + ((4 - nov1 + 7) % 7) + 21;
    return { name: 'Thanksgiving', countries: ['US'], from: D(y, 11, thu - 1), to: D(y, 11, thu + 4) };
  }),
  { name: 'Chinese New Year', countries: ['CN', 'TW', 'HK', 'MO', 'SG', 'MY', 'VN', 'KR'], from: D(2026, 2, 10), to: D(2026, 2, 27) },
  { name: 'Chinese New Year', countries: ['CN', 'TW', 'HK', 'MO', 'SG', 'MY', 'VN', 'KR'], from: D(2027, 1, 30), to: D(2027, 2, 16) },
  { name: 'Chinese New Year', countries: ['CN', 'TW', 'HK', 'MO', 'SG', 'MY', 'VN', 'KR'], from: D(2028, 1, 19), to: D(2028, 2, 5) },
  { name: 'Diwali', countries: ['IN', 'NP'], from: D(2026, 11, 3), to: D(2026, 11, 13) },
  { name: 'Diwali', countries: ['IN', 'NP'], from: D(2027, 10, 24), to: D(2027, 11, 3) },
  { name: 'Easter', countries: 'all', from: D(2026, 3, 28), to: D(2026, 4, 12) },
  { name: 'Easter', countries: 'all', from: D(2027, 3, 20), to: D(2027, 4, 4) },
  { name: 'Eid al-Fitr', countries: ['SA', 'AE', 'QA', 'KW', 'BH', 'OM', 'EG', 'TR', 'PK', 'BD', 'ID', 'MY', 'MA', 'DZ', 'TN', 'JO', 'IR', 'IQ', 'NG'], from: D(2026, 3, 16), to: D(2026, 3, 25) },
  { name: 'Eid al-Fitr', countries: ['SA', 'AE', 'QA', 'KW', 'BH', 'OM', 'EG', 'TR', 'PK', 'BD', 'ID', 'MY', 'MA', 'DZ', 'TN', 'JO', 'IR', 'IQ', 'NG'], from: D(2027, 3, 6), to: D(2027, 3, 14) },
  { name: 'Golden Week', countries: ['JP'], from: D(2026, 4, 29), to: D(2026, 5, 6) },
  { name: 'Golden Week', countries: ['JP'], from: D(2027, 4, 29), to: D(2027, 5, 6) },
  { name: 'National Day Golden Week', countries: ['CN'], from: D(2026, 9, 30), to: D(2026, 10, 8) },
  { name: 'National Day Golden Week', countries: ['CN'], from: D(2027, 9, 30), to: D(2027, 10, 8) },
  { name: 'Summer holidays', countries: 'all', from: D(2026, 7, 10), to: D(2026, 8, 31) },
  { name: 'Summer holidays', countries: 'all', from: D(2027, 7, 9), to: D(2027, 8, 31) },
];

/** Travel peaks in effect at `t` for travellers from a country. */
export function holidaysAt(t: number, country?: string): Holiday[] {
  return HOLIDAYS.filter((h) => t >= h.from && t < h.to + 86_400_000 && (h.countries === 'all' || (!!country && h.countries.includes(country))));
}

/** Load-factor uplift during peaks (strongest around the start and end of the period). */
export function holidayUplift(t: number, country?: string): number {
  let u = 0;
  for (const h of holidaysAt(t, country)) u = Math.max(u, h.name === 'Summer holidays' ? 0.03 : 0.08);
  return u;
}

/** Hajj (Dhul Hijjah 8–13): pilgrims fly in over the four weeks before and home over the three after. */
const HAJJ = [D(2026, 5, 25), D(2027, 5, 15), D(2028, 5, 3)];
const HAJJ_COUNTRIES = new Set('ID PK IN BD MY NG EG TR IR DZ MA TN SN ML NE TD SD SO ET KE TZ UZ KZ AZ AF IQ JO GB FR US LY YE BF GN CM GH CI MR GM AE KW QA BH OM LB SY PS'.split(' '));
export function hajjWeight(t: number, destIdent: string, airlineCountry: string | undefined): number {
  if (destIdent !== 'OEJN' && destIdent !== 'OEMA' && destIdent !== 'OETF') return 1;
  if (!airlineCountry || !HAJJ_COUNTRIES.has(airlineCountry)) return 1.15; // Umrah all year
  for (const d of HAJJ) {
    const days = (t - d) / 86_400_000;
    if (days > -28 && days < 0) return 4.5; // pilgrims arriving
    if (days >= 5 && days < 26) return 3.5; // pilgrims going home (flights still head to Jeddah/Medina to collect them)
  }
  return 1.3;
}

export function hajjInfo(t: number): { phase: 'arrivals' | 'departures'; day: number } | null {
  for (const d of HAJJ) {
    const days = Math.floor((t - d) / 86_400_000);
    if (days > -28 && days < 0) return { phase: 'arrivals', day: days };
    if (days >= 5 && days < 26) return { phase: 'departures', day: days };
  }
  return null;
}

/** Ski charters change over on Saturdays (and some on Sundays). */
export function skiChangeover(h: number): RouteDays {
  return h % 3 === 0 ? { mask: 0b1000001, perWeek: 2 } : { mask: 0b1000000, perWeek: 1 };
}
