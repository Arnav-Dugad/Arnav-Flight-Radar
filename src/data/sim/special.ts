// Reference data for special simulated operations: military air arms (real callsign
// prefixes and real bases), air ambulances, offshore helicopter operators, city shuttles
// and gliding. Missions, serials and positions are invented; the site labels them simulated.

export type MilRole = 'transport' | 'tanker' | 'awacs' | 'patrol' | 'fighter' | 'heli';

export interface MilOperator {
  icao: string; // ICAO-style callsign prefix in the flight field
  tel: string; // radiotelephony callsign
  name: string;
  country: string; // ISO
  /** Address block override: US and UK military use their own ICAO address ranges. */
  hex?: [number, number];
  reg: string; // serial pattern, L letter # digit
  bases: string[];
  fleet: [string, number, MilRole][];
  size: number;
}

export const MILITARY: MilOperator[] = [
  { icao: 'RCH', tel: 'REACH', name: 'US Air Force Air Mobility Command', country: 'US', hex: [0xae0000, 0xafffff], reg: '##-####', bases: ['KDOV', 'KCHS', 'KTCM', 'KSUU', 'KWRI', 'ETAR', 'LTAG', 'RJTY', 'PGUA', 'PHIK', 'OTBH', 'LPLA'], fleet: [['C17', 6, 'transport'], ['C30J', 2, 'transport']], size: 60 },
  { icao: 'QID', tel: 'QUID', name: 'US Air Force tankers', country: 'US', hex: [0xae0000, 0xafffff], reg: '##-####', bases: ['KMCF', 'KFOE', 'EGUN', 'KSUU', 'KWRI', 'PGUA', 'OTBH', 'RJTY'], fleet: [['K35R', 1, 'tanker']], size: 26 },
  { icao: 'NATO', tel: 'NATO', name: 'NATO Airborne Early Warning', country: 'DE', reg: 'LX-N#####', bases: ['ETNG'], fleet: [['E3TF', 1, 'awacs']], size: 4 },
  { icao: 'CNV', tel: 'CONVOY', name: 'US Navy', country: 'US', hex: [0xae0000, 0xafffff], reg: '######', bases: ['KNIP', 'KNZY', 'PHIK', 'RJTY'], fleet: [['P8', 1, 'patrol']], size: 12 },
  { icao: 'VPR', tel: 'VIPER', name: 'US Air Force fighter training', country: 'US', hex: [0xae0000, 0xafffff], reg: '##-####', bases: ['KLUF', 'KHIF', 'KLSV', 'KLFI', 'ETAD', 'LIPA', 'EGUL', 'RKSO', 'RKJK'], fleet: [['F16', 3, 'fighter'], ['F35', 2, 'fighter']], size: 28 },
  { icao: 'RRR', tel: 'ASCOT', name: 'Royal Air Force', country: 'GB', hex: [0x43c000, 0x43cfff], reg: 'ZZ###', bases: ['EGVN', 'EGXC', 'EGQS', 'EGXW', 'EGYM'], fleet: [['A400', 2, 'transport'], ['C17', 1, 'transport'], ['A332', 1, 'tanker'], ['P8', 1, 'patrol'], ['EUFI', 3, 'fighter']], size: 26 },
  { icao: 'GAF', tel: 'GERMAN AIR FORCE', name: 'German Air Force', country: 'DE', hex: [0x3f4000, 0x3f7fff], reg: '##+##', bases: ['ETNW', 'ETNL', 'ETNG', 'ETSN'], fleet: [['A400', 2, 'transport'], ['EUFI', 3, 'fighter'], ['H60', 0.6, 'heli']], size: 20 },
  { icao: 'FAF', tel: 'FRENCH AIR FORCE', name: 'French Air and Space Force', country: 'FR', hex: [0x3b7000, 0x3bffff], reg: 'F-RAL#', bases: ['LFOJ', 'LFSI', 'LFMI'], fleet: [['A400', 2, 'transport'], ['RFAL', 3, 'fighter']], size: 18 },
  { icao: 'IAM', tel: 'ITALIAN AIR FORCE', name: 'Italian Air Force', country: 'IT', reg: 'MM####', bases: ['LIRP', 'LIPI', 'LIRS'], fleet: [['C30J', 2, 'transport'], ['EUFI', 3, 'fighter']], size: 14 },
  { icao: 'AME', tel: 'SPANISH AIR FORCE', name: 'Spanish Air and Space Force', country: 'ES', reg: 'T.##-##', bases: ['LEZG', 'LETO'], fleet: [['A400', 1, 'transport'], ['EUFI', 2, 'fighter']], size: 10 },
  { icao: 'NAF', tel: 'NETHERLANDS AIR FORCE', name: 'Royal Netherlands Air Force', country: 'NL', reg: 'F-###', bases: ['EHEH', 'EHLW'], fleet: [['C30J', 1, 'transport'], ['F35', 2, 'fighter']], size: 8 },
  { icao: 'PLF', tel: 'POLISH AIR FORCE', name: 'Polish Air Force', country: 'PL', reg: '####', bases: ['EPLK', 'EPMB'], fleet: [['C30J', 1, 'transport'], ['F16', 2, 'fighter']], size: 8 },
  { icao: 'ASY', tel: 'AUSSIE', name: 'Royal Australian Air Force', country: 'AU', reg: 'A##-###', bases: ['YAMB', 'YPED', 'YSRI'], fleet: [['C17', 1, 'transport'], ['C30J', 1.5, 'transport'], ['A332', 1, 'tanker'], ['P8', 1, 'patrol'], ['F35', 1.5, 'fighter']], size: 14 },
  { icao: 'CFC', tel: 'CANFORCE', name: 'Royal Canadian Air Force', country: 'CA', reg: '1####', bases: ['CYTR', 'CYOD'], fleet: [['C17', 1, 'transport'], ['C30J', 1.5, 'transport']], size: 8 },
];

/** Typical mission parameters by role. */
export const MIL_MISSION: Record<MilRole, { ft: number; orbitMin: [number, number]; offNm: [number, number]; legNm: number }> = {
  transport: { ft: 31000, orbitMin: [0, 0], offNm: [0, 0], legNm: 0 },
  tanker: { ft: 25000, orbitMin: [90, 180], offNm: [120, 320], legNm: 45 },
  awacs: { ft: 30000, orbitMin: [240, 420], offNm: [180, 420], legNm: 60 },
  patrol: { ft: 6000, orbitMin: [150, 300], offNm: [120, 300], legNm: 30 },
  fighter: { ft: 22000, orbitMin: [35, 60], offNm: [40, 90], legNm: 18 },
  heli: { ft: 1500, orbitMin: [30, 60], offNm: [10, 30], legNm: 4 },
};

/** Air ambulance (HEMS) helicopter operators by country: callsign style and squawk. */
export const HEMS: { country: string; icao: string; tel: string; name: string; reg: string; types: [string, number][]; squawk: string; count: number }[] = [
  { country: 'GB', icao: 'HLE', tel: 'HELIMED', name: 'Air ambulance (UK)', reg: 'G-LLLL', types: [['EC35', 1], ['EC45', 1.5], ['A169', 1]], squawk: '0020', count: 22 },
  { country: 'DE', icao: 'CHX', tel: 'CHRISTOPH', name: 'Air rescue (Germany)', reg: 'D-HLLL', types: [['EC35', 1], ['EC45', 2]], squawk: '0020', count: 30 },
  { country: 'CH', icao: 'REGA', tel: 'REGA', name: 'Swiss Air-Rescue', reg: 'HB-ZLL', types: [['EC45', 1]], squawk: '7000', count: 8 },
  { country: 'AT', icao: 'OEX', tel: 'CHRISTOPHORUS', name: 'Air rescue (Austria)', reg: 'OE-XLL', types: [['EC35', 1]], squawk: '7000', count: 8 },
  { country: 'FR', icao: 'SAM', tel: 'SAMU', name: 'SAMU air ambulance', reg: 'F-HLLL', types: [['EC35', 1], ['EC45', 1]], squawk: '7000', count: 12 },
  { country: 'US', icao: 'LIF', tel: 'LIFEGUARD', name: 'Air medical (US)', reg: 'N###LL', types: [['EC35', 1], ['EC45', 1], ['A109', 1], ['A139', 0.5]], squawk: '1200', count: 90 },
  { country: 'CA', icao: 'ORN', tel: 'ORNGE', name: 'Air ambulance (Canada)', reg: 'C-LLLL', types: [['A139', 1]], squawk: '1200', count: 8 },
  { country: 'AU', icao: 'RES', tel: 'RESCUE', name: 'Air ambulance (Australia)', reg: 'VH-LLL', types: [['A139', 1], ['EC45', 1]], squawk: '1200', count: 10 },
  { country: 'JP', icao: 'DRH', tel: 'DOCTOR HELI', name: 'Doctor-Heli (Japan)', reg: 'JA##LL', types: [['EC35', 1], ['EC45', 1]], squawk: '1200', count: 10 },
];

/** Fixed-wing air-ambulance operators (patient transfers between airports, priority handling). */
export const AIR_AMBULANCE: { country: string; icao: string; tel: string; name: string; reg: string; types: [string, number][]; bases: string[]; count: number }[] = [
  { country: 'CH', icao: 'SAZ', tel: 'SWISS AMBULANCE', name: 'Rega jet ambulance', reg: 'HB-JLL', types: [['CL35', 1]], bases: ['LSZH'], count: 3 },
  { country: 'DE', icao: 'AMB', tel: 'CIVIL AIR AMBULANCE', name: 'Air ambulance (Germany)', reg: 'D-CLLL', types: [['LJ45', 1]], bases: ['EDDK', 'EDDN', 'EDDB'], count: 5 },
  { country: 'US', icao: 'LGD', tel: 'LIFEGUARD', name: 'Air ambulance (US)', reg: 'N###LL', types: [['B350', 2], ['PC12', 2], ['LJ45', 1]], bases: ['KPHX', 'KDEN', 'KABQ', 'KSLC', 'KBIL', 'PANC', 'KBOI', 'KRNO'], count: 24 },
  { country: 'AU', icao: 'FD', tel: 'FLYING DOCTOR', name: 'Royal Flying Doctor Service', reg: 'VH-LLL', types: [['B350', 1], ['PC12', 2]], bases: ['YPJT', 'YBAS', 'YBCS', 'YPAD', 'YBTL', 'YPKG'], count: 18 },
  { country: 'NO', icao: 'LAR', tel: 'LIFELINE', name: 'Air ambulance (Norway)', reg: 'LN-LLL', types: [['B350', 1]], bases: ['ENBO', 'ENTC', 'ENGM'], count: 5 },
];

/** Offshore helicopter shuttles from real base airports to oil & gas platforms. */
export const OFFSHORE: { base: string; icao: string; tel: string; country: string; reg: string; types: [string, number][]; count: number; region: [number, number, number, number] }[] = [
  { base: 'EGPD', icao: 'BHL', tel: 'BRISTOW', country: 'GB', reg: 'G-LLLL', types: [['S92', 2], ['EC75', 1], ['A139', 0.6]], count: 12, region: [55.5, -3, 62.5, 4.5] },
  { base: 'ENZV', icao: 'HKS', tel: 'HELIBUS', country: 'NO', reg: 'LN-LLL', types: [['S92', 1], ['EC75', 1]], count: 8, region: [56, 1, 62, 8] },
  { base: 'ENBR', icao: 'BHL', tel: 'BRISTOW', country: 'NO', reg: 'LN-LLL', types: [['S92', 1]], count: 5, region: [58.5, 1, 62.5, 6] },
  { base: 'EKEB', icao: 'DOF', tel: 'DANISH OFFSHORE', country: 'DK', reg: 'OY-HLL', types: [['A139', 1]], count: 4, region: [54.5, 3, 57, 8.5] },
  { base: 'EHKD', icao: 'NHV', tel: 'NOORDZEE', country: 'NL', reg: 'PH-NLL', types: [['A139', 1], ['EC75', 1]], count: 5, region: [52.5, 2.5, 55.5, 6.5] },
  { base: 'KLFT', icao: 'PHM', tel: 'PHI', country: 'US', reg: 'N###LL', types: [['S92', 1], ['A139', 2], ['S76', 1]], count: 14, region: [26.5, -95, 29.4, -87.5] },
  { base: 'KLFT', icao: 'ERA', tel: 'ERAH', country: 'US', reg: 'N###LL', types: [['A139', 1], ['S76', 1]], count: 6, region: [26.5, -95, 29.4, -87.5] },
];

/** City helicopter shuttle operators: heliports near major airports. */
export const SHUTTLES: { airport: string; icao: string; tel: string; country: string; reg: string; types: [string, number][]; count: number }[] = [
  { airport: 'KJFK', icao: 'BLA', tel: 'BLADE', country: 'US', reg: 'N###LL', types: [['S76', 1], ['A109', 1], ['AS50', 1]], count: 10 },
  { airport: 'KEWR', icao: 'BLA', tel: 'BLADE', country: 'US', reg: 'N###LL', types: [['AS50', 1]], count: 3 },
  { airport: 'SBSP', icao: 'HEL', tel: 'HELISP', country: 'BR', reg: 'PR-LLL', types: [['AS50', 2], ['A109', 1], ['EC30', 1]], count: 18 },
  { airport: 'SBGR', icao: 'HEL', tel: 'HELISP', country: 'BR', reg: 'PR-LLL', types: [['AS50', 1], ['A109', 1]], count: 6 },
  { airport: 'EGLL', icao: 'HLX', tel: 'HELIX', country: 'GB', reg: 'G-LLLL', types: [['A109', 1], ['AS50', 1]], count: 4 },
  { airport: 'LFMN', icao: 'MCM', tel: 'HELI AIR', country: 'MC', reg: '3A-MLL', types: [['EC30', 2], ['AS50', 1]], count: 6 },
  { airport: 'VHHH', icao: 'HKH', tel: 'HELIJET', country: 'HK', reg: 'B-KLL', types: [['A139', 1]], count: 5 },
  { airport: 'OMDB', icao: 'DXH', tel: 'DUBAI HELI', country: 'AE', reg: 'A6-LLL', types: [['EC30', 1], ['A139', 1]], count: 4 },
  { airport: 'MMMX', icao: 'MXH', tel: 'HELIMEX', country: 'MX', reg: 'XA-LLL', types: [['AS50', 1], ['A109', 1]], count: 6 },
  { airport: 'KLAX', icao: 'HLA', tel: 'HELILA', country: 'US', reg: 'N###LL', types: [['AS50', 1], ['EC30', 1]], count: 5 },
  { airport: 'LTFM', icao: 'IHL', tel: 'ISTANBUL HELI', country: 'TR', reg: 'TC-HLL', types: [['A109', 1]], count: 3 },
  { airport: 'RKSI', icao: 'KHL', tel: 'KOREA HELI', country: 'KR', reg: 'HL9###', types: [['S76', 1]], count: 3 },
  { airport: 'RJTT', icao: 'JHL', tel: 'TOKYO HELI', country: 'JP', reg: 'JA##LL', types: [['AS50', 1], ['A109', 1]], count: 5 },
];

/** Glider and tow types; gliders are tracked by FLARM receivers rather than ADS-B. */
export const GLIDER_TYPES: [string, number][] = [
  ['AS21', 2],
  ['DUOD', 1.5],
  ['DISC', 2],
  ['LS8', 1.5],
  ['GLID', 1],
];
export const TOW_TYPES: [string, number][] = [
  ['DR40', 2],
  ['PA25', 1],
];

/** Registration patterns for gliders by country (common national formats). */
export const GLIDER_REG: Record<string, string> = { DE: 'D-####', GB: 'G-CLLL', US: 'N###LL', JP: 'JA2###', NL: 'PH-###', DK: 'OY-LLL', FR: 'F-CLLL', CH: 'HB-###', AT: 'OE-5###', PL: 'SP-3###', CZ: 'OK-####', AU: 'VH-LLL', SE: 'SE-ULL', FI: 'OH-###', BE: 'OO-ZLL', ES: 'EC-LLL', IT: 'I-LLLL' };

/** Aircraft manufacturers' delivery centres (for occasional simulated delivery flights). */
export const DELIVERY_CENTRES: { maker: RegExp; airport: string }[] = [
  { maker: /^A3[0-9]|^A2[01]N|^A3[3-5]|^A38/, airport: 'LFBO' },
  { maker: /^A3[12]|^A2[01]N/, airport: 'EDHI' },
  { maker: /^BCS/, airport: 'CYMX' },
  { maker: /^B7[3-8]|^B3[789]M/, airport: 'KBFI' },
  { maker: /^B78/, airport: 'KCHS' },
  { maker: /^E[1-2]|^E75/, airport: 'SBSJ' },
  { maker: /^AT[47]/, airport: 'LFBO' },
];
