// Compact airport index format + search, shared by the browser and the Worker.
//
// index.json: { v: 1, generatedAt, rows: Row[] }, Row = [ident, icao, iata, name,
// city, country, lat, lon, typeCode, elevationFt, scheduled(0|1)] — compact arrays
// keep the file ~4× smaller than objects.

import type { AirportIndexEntry, AirportType } from './types';

export type AirportRow = [string, string, string, string, string, string, number, number, number, number | null, 0 | 1];

export const TYPE_CODES: AirportType[] = [
  'large_airport',
  'medium_airport',
  'small_airport',
  'heliport',
  'seaplane_base',
  'balloonport',
  'closed',
];

export const AIRPORT_TYPE_LABEL: Record<AirportType, string> = {
  large_airport: 'Large airport',
  medium_airport: 'Medium airport',
  small_airport: 'Small airport',
  heliport: 'Heliport',
  seaplane_base: 'Seaplane base',
  balloonport: 'Balloon port',
  closed: 'Closed',
};

export function decodeRow(r: AirportRow): AirportIndexEntry {
  const e: AirportIndexEntry = {
    ident: r[0],
    name: r[3],
    country: r[5],
    lat: r[6],
    lon: r[7],
    type: TYPE_CODES[r[8]] ?? 'small_airport',
    scheduled: r[10] === 1,
  };
  if (r[1]) e.icao = r[1];
  if (r[2]) e.iata = r[2];
  if (r[4]) e.city = r[4];
  if (r[9] !== null) e.elevationFt = r[9];
  return e;
}

/** Shard file for airport details: first two characters of the ident. */
export function detailShard(ident: string): string {
  return ident.slice(0, 2).toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

export const IDENT_RE = /^[A-Z0-9-]{2,10}$/;

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

// Importance outweighs small differences in match quality, so "heathrow" finds
// London Heathrow before a farm strip whose name merely starts with the word.
const TYPE_WEIGHT: Record<AirportType, number> = {
  large_airport: 120,
  medium_airport: 60,
  small_airport: 0,
  heliport: -10,
  seaplane_base: -10,
  balloonport: -10,
  closed: -60,
};

export interface SearchableAirport extends AirportIndexEntry {
  _name: string;
  _city: string;
}

export function makeSearchable(list: AirportIndexEntry[]): SearchableAirport[] {
  return list.map((a) => ({ ...a, _name: fold(a.name), _city: fold(a.city ?? '') }));
}

export interface AirportSearchOptions {
  limit?: number;
  country?: string;
  types?: AirportType[];
}

/** Ranked search over IATA, ICAO/ident, name and city. */
export function searchAirports(
  list: SearchableAirport[],
  query: string,
  opts: AirportSearchOptions = {},
): AirportIndexEntry[] {
  const q = fold(query.trim());
  if (!q) return [];
  const up = query.trim().toUpperCase();
  const limit = opts.limit ?? 12;
  const scored: { a: SearchableAirport; s: number }[] = [];
  for (const a of list) {
    if (opts.country && a.country !== opts.country) continue;
    if (opts.types && !opts.types.includes(a.type)) continue;
    let s = 0;
    if (a.iata === up) s = 1000;
    else if (a.icao === up || a.ident === up) s = 950;
    else if (up.length >= 2 && (a.icao?.startsWith(up) || a.ident.startsWith(up))) s = 400;
    else if (a._name === q) s = 600;
    else if (a._city === q) s = 550;
    else if (a._city.startsWith(q)) s = 350;
    else if (a._name.startsWith(q)) s = 330;
    else if (q.length >= 3 && a._name.includes(` ${q}`)) s = 300; // word start
    else if (q.length >= 3 && a._name.includes(q)) s = 200;
    else if (q.length >= 3 && a._city.includes(q)) s = 180;
    if (s === 0) continue;
    s += TYPE_WEIGHT[a.type] + (a.scheduled ? 40 : 0) + (a.iata ? 20 : 0);
    scored.push({ a, s });
  }
  scored.sort((x, y) => y.s - x.s);
  return scored.slice(0, limit).map(({ a }) => {
    const { _name, _city, ...rest } = a;
    void _name;
    void _city;
    return rest;
  });
}
