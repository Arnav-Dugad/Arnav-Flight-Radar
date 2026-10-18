// Airline names from the OpenFlights airline database (ODbL 1.0), shipped as a
// static asset and loaded on demand. The operator is INFERRED from the ICAO
// telephony prefix of a callsign (e.g. "BAW123" → British Airways); the UI says so.

import { useQuery } from '@tanstack/react-query';

export interface AirlineInfo {
  icao: string;
  name: string;
  iata?: string;
  telephony?: string;
  country?: string;
  active: boolean;
}

type Row = [name: string, iata: string, callsign: string, country: string, active: 0 | 1];

let table: Promise<Record<string, Row>> | null = null;

export function loadAirlines(): Promise<Record<string, Row>> {
  table ??= fetch('/data/airlines.json')
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<{ airlines: Record<string, Row> }>;
    })
    .then((j) => j.airlines)
    .catch((e) => {
      table = null;
      throw e;
    });
  return table;
}

/** ICAO airline designator implied by a callsign: three letters followed by a digit. */
export function airlinePrefix(callsign: string | undefined): string | undefined {
  const m = callsign?.trim().toUpperCase().match(/^([A-Z]{3})\d[A-Z0-9]*$/);
  return m?.[1];
}

export function decodeAirline(icao: string, r: Row | undefined): AirlineInfo | undefined {
  if (!r) return undefined;
  const a: AirlineInfo = { icao, name: r[0], active: r[4] === 1 };
  if (r[1]) a.iata = r[1];
  if (r[2]) a.telephony = r[2];
  if (r[3]) a.country = r[3];
  return a;
}

export function useAirline(callsign: string | undefined) {
  const prefix = airlinePrefix(callsign);
  return useQuery({
    queryKey: ['airline', prefix],
    queryFn: async () => decodeAirline(prefix!, (await loadAirlines())[prefix!]) ?? null,
    enabled: !!prefix,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });
}

/** A stable, pleasant hue for an airline code (for the monogram badge — not a logo). */
export function airlineHue(code: string): number {
  let h = 0;
  for (const c of code) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}
