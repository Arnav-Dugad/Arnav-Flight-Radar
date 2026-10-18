// Days of operation for an airline's routes, derived on the page from the flights the
// simulated airline is operating today. Uses the simulator's own timetable rules
// (`routeDays` in sim/schedule) with the same inputs the engine uses, so the result
// matches the simulated schedule (the airline model comes from AIRLINE_EXTRA; cargo
// carriers missing there are treated as full-service).
import { distanceNm } from '@shared/geo';
import { AIRLINE_EXTRA } from '@/data/sim/airlineInfo';
import { leisureOf, routeDays, type RouteDays } from '@/data/sim/schedule';
import type { AirlineInfo } from '@/data/world';

export interface RouteWeek {
  key: string;
  from: AirlineInfo['flights'][number]['from'];
  to: AirlineInfo['flights'][number]['to'];
  days: RouteDays;
}

/** Monday-first weekday order (bit index into RouteDays.mask, 0 = Sunday). */
export const MON_FIRST = [1, 2, 3, 4, 5, 6, 0] as const;

/** Ferry and positioning flights use a 9xxx number range or a "P" suffix. */
const FERRY = /^[A-Z]{3}(9\d{3}|\d{1,3}P)$/;

export function routeWeek(info: AirlineInfo): RouteWeek[] {
  const icao = info.profile.icao;
  const model = AIRLINE_EXTRA[icao]?.model ?? 'full';
  const hubs = info.profile.hubs;
  const seen = new Map<string, RouteWeek>();
  for (const f of info.flights) {
    if (f.from.ident === f.to.ident || FERRY.test(f.flight) || (f.kind && f.kind !== 'scheduled' && f.kind !== 'cargo')) continue;
    const key = f.from.ident < f.to.ident ? `${f.from.ident}-${f.to.ident}` : `${f.to.ident}-${f.from.ident}`;
    if (seen.has(key)) continue;
    // The simulator's own days for this leg when it has them; otherwise the same rules here.
    const days = f.days ?? routeDays(icao, f.from.ident, f.to.ident, {
      distNm: distanceNm(f.from.lat, f.from.lon, f.to.lat, f.to.lon),
      hubEnd: hubs.includes(f.from.ident) || hubs.includes(f.to.ident),
      bothLarge: f.from.large && f.to.large,
      leisure: leisureOf(f.to.ident, f.to.lat, f.to.lon),
      model,
    });
    seen.set(key, { key, from: f.from, to: f.to, days });
  }
  return [...seen.values()];
}

/** Routes operating on each weekday (Monday first), split into daily and non-daily. */
export function weekCounts(routes: RouteWeek[]): { day: number; daily: number; some: number }[] {
  return MON_FIRST.map((day) => {
    let daily = 0;
    let some = 0;
    for (const r of routes) {
      if (((r.days.mask >> day) & 1) !== 1) continue;
      if (r.days.perWeek === 7) daily++;
      else some++;
    }
    return { day, daily, some };
  });
}
