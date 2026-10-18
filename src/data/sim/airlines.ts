// The full airline registry used by the simulation: the core list plus the
// additional carriers, alliance memberships and all-cargo operators.
import { AIRLINES, ALLIANCES, type AirlineProfile } from './fleet';
import { CARGO_AIRLINES, MORE_AIRLINES, MORE_ALLIANCES } from './fleet-more';

export const ALL_AIRLINES: AirlineProfile[] = [...AIRLINES, ...MORE_AIRLINES];

export const ALL_ALLIANCES: { name: string; members: string[] }[] = ALLIANCES.map((a) => ({
  name: a.name,
  members: [...a.members, ...Object.entries(MORE_ALLIANCES).filter(([, n]) => n === a.name).map(([icao]) => icao)],
}));

/** All-cargo operators fly mostly at night. */
export const CARGO = new Set(CARGO_AIRLINES);
