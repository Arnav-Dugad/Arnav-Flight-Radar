// The full airline registry used by the simulation: the core list plus the
// additional carriers, alliance memberships and all-cargo operators.
import { AIRLINES, ALLIANCES, type AirlineProfile } from './fleet';
import { EXTRA_AIRLINES, EXTRA_ALLIANCES, EXTRA_CARGO } from './fleet-extra';
import { CARGO_AIRLINES, MORE_AIRLINES, MORE_ALLIANCES } from './fleet-more';

export const ALL_AIRLINES: AirlineProfile[] = [...AIRLINES, ...MORE_AIRLINES, ...EXTRA_AIRLINES];

const EXTRA_MEMBERS = { ...MORE_ALLIANCES, ...EXTRA_ALLIANCES };

export const ALL_ALLIANCES: { name: string; members: string[] }[] = ALLIANCES.map((a) => ({
  name: a.name,
  members: [...a.members, ...Object.entries(EXTRA_MEMBERS).filter(([, n]) => n === a.name).map(([icao]) => icao)],
}));

/** All-cargo operators fly mostly at night. */
export const CARGO = new Set([...CARGO_AIRLINES, ...EXTRA_CARGO]);
