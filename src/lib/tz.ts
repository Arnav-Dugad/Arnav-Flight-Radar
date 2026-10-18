// Time zones from coordinates (lazy-loaded tz-lookup, offline) and local-time formatting.
import { useEffect, useState } from 'react';

let lookup: Promise<(lat: number, lon: number) => string> | null = null;
const cache = new Map<string, string>();

export function timeZoneAt(lat: number, lon: number): Promise<string | null> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  lookup ??= import('@photostructure/tz-lookup').then((m) => m.default);
  return lookup
    .then((f) => {
      const tz = f(lat, lon);
      cache.set(key, tz);
      return tz;
    })
    .catch(() => null);
}

/** Synchronous lookup among zones already resolved. */
export function cachedTimeZone(lat: number, lon: number): string | undefined {
  return cache.get(`${lat.toFixed(2)},${lon.toFixed(2)}`);
}

export function useTimeZone(lat: number | undefined, lon: number | undefined): string | null {
  const [tz, setTz] = useState<string | null>(() => (lat !== undefined && lon !== undefined ? (cachedTimeZone(lat, lon) ?? null) : null));
  useEffect(() => {
    if (lat === undefined || lon === undefined) return;
    let alive = true;
    void timeZoneAt(lat, lon).then((z) => alive && setTz(z));
    return () => {
      alive = false;
    };
  }, [lat, lon]);
  return tz;
}

const fmts = new Map<string, Intl.DateTimeFormat>();

/** "14:05" in a time zone (24-hour). */
export function fmtHmIn(ms: number, tz: string | null | undefined): string {
  if (!tz) return new Date(ms).toISOString().slice(11, 16) + 'Z';
  let f = fmts.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz });
    } catch {
      return new Date(ms).toISOString().slice(11, 16) + 'Z';
    }
    fmts.set(tz, f);
  }
  return f.format(ms);
}

/** Short zone label, e.g. "GMT+1" or "BST". */
export function tzAbbrev(ms: number, tz: string | null | undefined): string {
  if (!tz) return 'UTC';
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'short' }).formatToParts(ms).find((p) => p.type === 'timeZoneName')?.value ?? tz;
  } catch {
    return tz;
  }
}
