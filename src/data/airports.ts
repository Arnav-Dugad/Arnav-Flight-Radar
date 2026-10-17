// Static OurAirports dataset loader (public domain). The "major" tier loads at
// startup for the map and instant search; the full tier loads on demand.

import { decodeRow, makeSearchable, type AirportRow, type SearchableAirport } from '@shared/airports';
import type { AirportIndexEntry, Country } from '@shared/types';

let major: Promise<SearchableAirport[]> | null = null;
let full: Promise<SearchableAirport[]> | null = null;
let countries: Promise<Country[]> | null = null;
const byIdent = new Map<string, AirportIndexEntry>();

async function loadIndex(file: string): Promise<SearchableAirport[]> {
  const res = await fetch(`/data/airports/${file}`);
  if (!res.ok) throw new Error(`Airport data unavailable (HTTP ${res.status}).`);
  const j = (await res.json()) as { rows: AirportRow[] };
  const list = j.rows.map(decodeRow);
  for (const a of list) {
    byIdent.set(a.ident, a);
    if (a.icao && a.icao !== a.ident) byIdent.set(a.icao, a);
  }
  return makeSearchable(list);
}

export function loadMajorAirports(): Promise<SearchableAirport[]> {
  major ??= loadIndex('index-major.json').catch((e) => {
    major = null;
    throw e;
  });
  return major;
}

export function loadAllAirports(): Promise<SearchableAirport[]> {
  full ??= loadIndex('index.json').catch((e) => {
    full = null;
    throw e;
  });
  return full;
}

export function isFullIndexLoaded() {
  return full !== null;
}

export function loadCountries(): Promise<Country[]> {
  countries ??= fetch('/data/countries.json')
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<{ countries: Country[] }>;
    })
    .then((j) => j.countries)
    .catch((e) => {
      countries = null;
      throw e;
    });
  return countries;
}

/** Synchronous lookup among already-loaded airports (ident, ICAO or IATA). */
export function airportByCode(code: string): AirportIndexEntry | undefined {
  const c = code.toUpperCase();
  return byIdent.get(c);
}

export function findIata(iata: string): AirportIndexEntry | undefined {
  const c = iata.toUpperCase();
  for (const a of byIdent.values()) if (a.iata === c) return a;
  return undefined;
}

export function countryName(code: string, list: Country[] | null): string {
  return list?.find((c) => c.code === code)?.name ?? code;
}

/** Curated hubs for quick navigation. Coordinates are resolved from OurAirports at runtime. */
export const HUBS: { ident: string; city: string }[] = [
  { ident: 'EGLL', city: 'London' },
  { ident: 'KJFK', city: 'New York' },
  { ident: 'OMDB', city: 'Dubai' },
  { ident: 'WSSS', city: 'Singapore' },
  { ident: 'VABB', city: 'Mumbai' },
  { ident: 'VIDP', city: 'Delhi' },
  { ident: 'VOBL', city: 'Bengaluru' },
  { ident: 'RJTT', city: 'Tokyo' },
  { ident: 'EDDF', city: 'Frankfurt' },
  { ident: 'KLAX', city: 'Los Angeles' },
  { ident: 'OTHH', city: 'Doha' },
  { ident: 'OERK', city: 'Riyadh' },
  { ident: 'OEDF', city: 'Dammam' },
  { ident: 'VOML', city: 'Mangalore' },
  { ident: 'LFPG', city: 'Paris' },
  { ident: 'EHAM', city: 'Amsterdam' },
  { ident: 'KATL', city: 'Atlanta' },
  { ident: 'YSSY', city: 'Sydney' },
];
