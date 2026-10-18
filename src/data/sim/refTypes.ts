// Small shared vocabularies for the simulation's reference data (types, airlines, 3D models).

/** How an airline sells and flies: drives cabins, load factors, terminals and schedules. */
export type AirlineModel = 'full' | 'low' | 'regional' | 'leisure' | 'cargo' | 'bizjet' | 'charter';

/** ICAO wake-turbulence category (A380 = J "super"). */
export type Wake = 'J' | 'H' | 'M' | 'L';

/** RECAT-EU wake category (A = A380 … F = light). */
export type Recat = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

/** Procedural 3D model family used by the chase-view renderer. */
export type ModelShape =
  | 'narrow' // twin wing-mounted jets, low wing (A320, 737, 757, E-jets)
  | 'rear-jet' // twin rear-mounted jets, T-tail (CRJ, ERJ-145, 717, business jets)
  | 'wide-twin' // wide-body twin (767, 777, 787, A330, A350)
  | 'tri-jet' // MD-11
  | 'quad' // A340, 747 without hump details
  | 'b747' // 747 with upper-deck hump
  | 'a380' // full double deck
  | 'high-turboprop' // high wing twin turboprop (ATR, Dash 8)
  | 'low-turboprop' // low wing twin turboprop (Beech 1900, Saab 340, King Air)
  | 'high-quad-turboprop' // C-130, A400M
  | 'high-jet-quad' // C-17
  | 'single-high' // Cessna 172/182
  | 'single-low' // PA-28, SR22, DA40, DR400
  | 'single-turboprop' // PC-12, Caravan
  | 'heli'
  | 'glider'
  | 'fighter'
  | 'awacs'; // E-3 with rotodome
