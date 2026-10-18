// Airline operating rules that shape a fleet's day beyond the timetable:
//
//  • Maintenance: overnight A-checks at the home base (every ~6–8 weeks per aircraft) and
//    rare heavy C-checks that take an aircraft out of service for days.
//  • Wet lease (ACMI): in the summer peak, and for Hajj, airlines hire aircraft WITH crews
//    from specialist operators that fly under the airline's flight numbers.
//  • ETOPS: twin-engine aircraft far from land must stay within an approved diversion time
//    of an adequate airport; the en-route alternates are listed and drawn on the map.
// Names and codes of the ACMI operators are real; which flights they operate is simulated.

import { distanceNm } from '@shared/geo';

export interface AcmiOperator {
  icao: string;
  name: string;
  country: string;
  /** Registration prefix of its country ("LY-") and the pattern after it (L = letter, # = digit). */
  prefix: string;
  reg: string;
  /** Aircraft types it typically supplies. */
  types: string[];
}

export const ACMI: AcmiOperator[] = [
  { icao: 'NVD', name: 'Avion Express', country: 'LT', prefix: 'LY-', reg: 'LLL', types: ['A320', 'A321'] },
  { icao: 'ART', name: 'SmartLynx Airlines', country: 'LV', prefix: 'YL-', reg: 'LLL', types: ['A320', 'A321'] },
  { icao: 'HST', name: 'Heston Airlines', country: 'LT', prefix: 'LY-', reg: 'LLL', types: ['A320'] },
  { icao: 'AWC', name: 'Titan Airways', country: 'GB', prefix: 'G-', reg: 'LLLL', types: ['A321', 'A320'] },
  { icao: 'HFY', name: 'Hi Fly', country: 'PT', prefix: 'CS-', reg: 'LLL', types: ['A332', 'A333', 'A359'] },
  { icao: 'WAM', name: 'Wamos Air', country: 'ES', prefix: 'EC-', reg: 'LLL', types: ['A332', 'A333'] },
  { icao: 'ABD', name: 'Air Atlanta Icelandic', country: 'IS', prefix: 'TF-', reg: 'LLL', types: ['B744', 'B77W', 'A333'] },
  { icao: 'PVG', name: 'Privilege Style', country: 'ES', prefix: 'EC-', reg: 'LLL', types: ['B763'] },
];

/** Airlines known to hire ACMI capacity, and which kind (narrow-body summer or wide-body Hajj). */
const LESSEES: Record<string, 'summer' | 'hajj'> = {
  BAW: 'summer', DLH: 'summer', EWG: 'summer', BEL: 'summer', SAS: 'summer', FIN: 'summer', BTI: 'summer', AUA: 'summer', KLM: 'summer', TAP: 'summer', IBE: 'summer', VLG: 'summer', AEE: 'summer', LOT: 'summer', EIN: 'summer', SWR: 'summer',
  SVA: 'hajj', GIA: 'hajj', PIA: 'hajj', MAS: 'hajj', BBC: 'hajj', NAS: 'hajj',
};

/**
 * The ACMI operator flying one of this airline's aircraft at `t`, or undefined. Narrow-body
 * leases run in the northern summer; wide-body leases around Hajj (`hajj` > 0).
 */
export function acmiFor(airlineIcao: string, typeCode: string, cls: string, t: number, hajj: number, roll: number): AcmiOperator | undefined {
  const kind = LESSEES[airlineIcao];
  if (!kind) return undefined;
  const m = new Date(t).getUTCMonth();
  if (kind === 'summer') {
    if (cls !== 'narrow' || m < 4 || m > 9 || roll > 0.05) return undefined;
  } else if (cls !== 'wide' || hajj < 1.2 || roll > 0.12) return undefined;
  const ops = ACMI.filter((o) => o.types.includes(typeCode));
  return ops.length ? ops[Math.floor(roll * 1e6) % ops.length] : undefined;
}

export interface MaintenanceCheck {
  check: 'A-check' | 'C-check';
  /** How long the aircraft is out of service (ms). */
  ms: number;
}

/**
 * Whether an aircraft starts a maintenance check at its base this evening. `roll` is a
 * stable per-aircraft-per-day random number in [0, 1); `localHour` the base's local time.
 */
export function maintenanceDue(roll: number, localHour: number, atBase: boolean): MaintenanceCheck | null {
  if (!atBase || (localHour < 19 && localHour > 2)) return null;
  const H = 3_600_000;
  if (roll < 0.0015) return { check: 'C-check', ms: (4 + roll * 4000) * 24 * H };
  if (roll < 0.022) return { check: 'A-check', ms: (7 + (roll * 1000) % 3) * H };
  return null;
}

export interface EtopsAirport {
  ident: string;
  iata?: string;
  name: string;
  lat: number;
  lon: number;
}

export interface EtopsInfo {
  /** Approved diversion time this flight needs (minutes at one-engine speed). */
  minutes: number;
  /** Longest time from an adequate airport along the route, minutes. */
  maxMin: number;
  alternates: (EtopsAirport & { radiusNm: number })[];
  /** One-engine-inoperative cruise speed assumed, kt. */
  speedKt: number;
}

const RULES = [60, 120, 138, 180, 207, 240, 330];

/**
 * ETOPS analysis of a route (sampled points) for a twin: the farthest point from an adequate
 * airport sets the required rule time; the airports nearest the oceanic stretch are the
 * en-route alternates. Returns null when the whole route stays within 60 minutes.
 */
export function etopsFor(route: [number, number][], adequate: EtopsAirport[], speedKt: number): EtopsInfo | null {
  if (route.length < 2 || !adequate.length) return null;
  const samples: { p: [number, number]; d: number; a: EtopsAirport }[] = [];
  for (let i = 0; i < route.length - 1; i++) {
    const [la0, lo0] = route[i]!;
    const [la1, lo1] = route[i + 1]!;
    const n = Math.max(1, Math.ceil(distanceNm(la0, lo0, la1, lo1) / 90));
    for (let k = 0; k < n; k++) {
      const f = k / n;
      const p: [number, number] = [la0 + (la1 - la0) * f, lo0 + (lo1 - lo0) * f];
      let best = Infinity;
      let ba = adequate[0]!;
      for (const a of adequate) {
        if (Math.abs(a.lat - p[0]) > 25) continue;
        const d = distanceNm(p[0], p[1], a.lat, a.lon);
        if (d < best) {
          best = d;
          ba = a;
        }
      }
      samples.push({ p, d: best, a: ba });
    }
  }
  const maxNm = Math.max(...samples.map((s) => s.d));
  const maxMin = (maxNm / speedKt) * 60;
  if (maxMin <= 60) return null;
  const minutes = RULES.find((r) => r >= maxMin) ?? 370;
  const radiusNm = (minutes / 60) * speedKt;
  // Alternates: the nearest adequate airport at each point beyond 60 minutes, in route order.
  const alts: (EtopsAirport & { radiusNm: number })[] = [];
  for (const s of samples) {
    if ((s.d / speedKt) * 60 <= 60 * 0.85) continue;
    if (!alts.some((x) => x.ident === s.a.ident)) alts.push({ ...s.a, radiusNm });
  }
  return { minutes, maxMin: Math.round(maxMin), alternates: alts.slice(0, 8), speedKt };
}
