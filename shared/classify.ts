// Aircraft symbol classification.
//
// Only two kinds of evidence are used:
//   1. The ICAO type designator reported by the provider (e.g. "B738"), mapped
//      through the table below of well-known designators.
//   2. The ADS-B emitter category the aircraft itself broadcasts (A1–C7).
// If neither is conclusive the symbol is the generic "unknown" aircraft.
// Nothing is inferred from speed, altitude or callsign.

import type { Aircraft } from './types';

export type AircraftClass =
  | 'widebody'
  | 'narrowbody'
  | 'regional'
  | 'turboprop'
  | 'bizjet'
  | 'helicopter'
  | 'light'
  | 'glider'
  | 'military'
  | 'balloon'
  | 'drone'
  | 'ground'
  | 'unknown';

export const CLASS_LABEL: Record<AircraftClass, string> = {
  widebody: 'Widebody jet',
  narrowbody: 'Narrowbody jet',
  regional: 'Regional jet',
  turboprop: 'Turboprop',
  bizjet: 'Business jet',
  helicopter: 'Helicopter',
  light: 'Light aircraft',
  glider: 'Glider',
  military: 'Military',
  balloon: 'Lighter-than-air',
  drone: 'Unmanned aircraft',
  ground: 'Surface vehicle',
  unknown: 'Unclassified aircraft',
};

const T = (cls: AircraftClass, codes: string) => codes.split(/\s+/).map((c) => [c, cls] as const);

// Designators from ICAO Doc 8643. Deliberately conservative: only types whose
// class is unambiguous are listed.
const TYPE_TABLE = new Map<string, AircraftClass>([
  ...T(
    'widebody',
    'A306 A30B A310 A332 A333 A337 A338 A339 A342 A343 A345 A346 A359 A35K A388 B741 B742 B743 B744 B748 B74S B74R B752 B753 B762 B763 B764 B772 B773 B77L B77W B778 B779 B788 B789 B78X DC10 MD11 IL96 L101 A3ST BLCF',
  ),
  ...T(
    'narrowbody',
    'A318 A319 A320 A321 A19N A20N A21N BCS1 BCS3 B712 B717 B721 B722 B731 B732 B733 B734 B735 B736 B737 B738 B739 B37M B38M B39M B3XM MD80 MD81 MD82 MD83 MD87 MD88 MD90 C919 T204 TU54 F100 B461 B462 B463 RJ70 RJ85 RJ1H',
  ),
  ...T(
    'regional',
    'CRJ1 CRJ2 CRJ7 CRJ9 CRJX E135 E145 E35L E170 E75L E75S E190 E195 E290 E295 SU95 AJ27 F70 F28 J328 E45X',
  ),
  ...T(
    'turboprop',
    'AT43 AT45 AT46 AT72 AT73 AT75 AT76 DH8A DH8B DH8C DH8D DHC6 DHC7 SF34 SB20 JS31 JS32 JS41 E120 F50 F27 SW4 B190 C208 C212 CN35 C295 D228 L410 PC12 TBM7 TBM8 TBM9 P180 B350 BE20 BE9L BE30 AN26 AN24 AN32 Y12 MA60 BN2P C30J C130 A400 P3 DHC2 DHC3 PC6T AT8T AT5T',
  ),
  ...T(
    'bizjet',
    'C25A C25B C25C C25M C500 C501 C510 C525 C550 C551 C55B C560 C56X C650 C680 C68A C700 C750 CL30 CL35 CL60 GL5T GL7T GLEX GLF4 GLF5 GLF6 G150 G280 GALX E50P E55P E545 E550 FA10 FA20 FA50 FA7X FA8X F900 F2TH LJ35 LJ40 LJ45 LJ60 LJ75 H25B H25C PRM1 HDJT SF50 PC24 BE40 ASTR',
  ),
  ...T(
    'helicopter',
    'EC20 EC25 EC30 EC35 EC45 EC55 EC75 AS32 AS35 AS50 AS55 AS65 A109 A119 A139 A169 A189 AW09 B06 B06T B105 B212 B407 B412 B429 B430 B505 BK17 H125 H130 H135 H145 H160 H175 R22 R44 R66 S76 S92 S61 UH1 UH60 H60 CH47 MI8 MI17 KA32 NH90 EH10 GAZL',
  ),
  ...T(
    'light',
    'C150 C152 C162 C170 C172 C175 C177 C180 C182 C185 C195 C206 C207 C210 P210 C310 C340 C402 C414 C421 PA18 PA20 PA22 PA24 PA28 PA30 PA31 PA32 PA34 PA44 PA46 P28A P28B P28R P28T P32R P46T SR20 SR22 S22T DA20 DA40 DA42 DA50 DA62 DV20 BE33 BE35 BE36 BE55 BE58 BE76 M20P M20T M20J AA5 TB10 TB20 TB21 RV6 RV7 RV8 RV9 RV10 RV12 CH7A J3 G115 TOBA ULAC EV97 CTSW AT3 C42 SIRA DR40 PA25',
  ),
  ...T('glider', 'GLID AS21 AS33 DG80 LS8 DUOD DISC ARCP JANU NIMB VENT'),
  ...T('balloon', 'BALL SHIP'),
  ...T(
    'military',
    'F16 F15 F18 F18S F22 F35 EUFI TOR RFAL MIR2 A10 B1 B2 B52 E3TF E3CF E6 E8 K35R KC35 K35E KC10 KC46 KC2 C17 C5 C5M P8 RC35 U2 HAWK T38 T6 TEX2 PC21 M346 F5 F4 SU27 SU30 SU35 MG29 TPHR',
  ),
]);

/** ADS-B emitter category → class (DO-260B table). */
const CATEGORY_CLASS: Record<string, AircraftClass> = {
  A1: 'light', // < 15,500 lb
  A7: 'helicopter',
  B1: 'glider',
  B2: 'balloon',
  B4: 'light', // ultralight / hang-glider / paraglider
  B6: 'drone',
  C1: 'ground',
  C2: 'ground',
  C3: 'ground',
};

export function classifyAircraft(ac: Pick<Aircraft, 'aircraftType' | 'category' | 'military'>): AircraftClass {
  const byType = ac.aircraftType ? TYPE_TABLE.get(ac.aircraftType) : undefined;
  if (ac.military && byType !== 'helicopter') return 'military';
  if (byType) return byType;
  if (ac.category) {
    const byCategory = CATEGORY_CLASS[ac.category];
    if (byCategory) return byCategory;
    // A5 (heavy, > 300,000 lb) is reliably a widebody; A2/A3/A4 are too broad to call.
  }
  if (ac.category === 'A5') return 'widebody';
  return 'unknown';
}

/** Explains why a class was chosen, shown in the aircraft panel. */
export function classificationBasis(ac: Pick<Aircraft, 'aircraftType' | 'category' | 'military'>): string {
  if (ac.military) return 'Military flag in the provider aircraft database';
  if (ac.aircraftType && TYPE_TABLE.has(ac.aircraftType)) return `ICAO type designator ${ac.aircraftType}`;
  if (ac.category && (CATEGORY_CLASS[ac.category] || ac.category === 'A5'))
    return `ADS-B emitter category ${ac.category}`;
  return 'No conclusive type data — generic symbol';
}

export const EMITTER_CATEGORY_LABEL: Record<string, string> = {
  A0: 'No category information',
  A1: 'Light (< 15,500 lb)',
  A2: 'Small (15,500–75,000 lb)',
  A3: 'Large (75,000–300,000 lb)',
  A4: 'High-vortex large (e.g. B757)',
  A5: 'Heavy (> 300,000 lb)',
  A6: 'High performance (> 5 g, > 400 kt)',
  A7: 'Rotorcraft',
  B0: 'No category information',
  B1: 'Glider / sailplane',
  B2: 'Lighter-than-air',
  B3: 'Parachutist / skydiver',
  B4: 'Ultralight / hang-glider / paraglider',
  B6: 'Unmanned aerial vehicle',
  B7: 'Space / trans-atmospheric vehicle',
  C0: 'No category information',
  C1: 'Surface vehicle — emergency',
  C2: 'Surface vehicle — service',
  C3: 'Point obstacle',
  C4: 'Cluster obstacle',
  C5: 'Line obstacle',
};

export const SPECIAL_SQUAWKS: Record<string, string> = {
  '7500': 'Unlawful interference',
  '7600': 'Radio failure',
  '7700': 'General emergency',
};
