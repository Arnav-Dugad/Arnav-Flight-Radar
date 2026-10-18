// Reference specifications for every aircraft type the simulation can generate.
// Figures are rounded public values (manufacturer data and well-known references) for
// the variant named in `model`; where variants differ a typical/conservative value is
// used. Only the simulation uses them, and the simulation is always labelled as such.
import type { ModelShape, Recat, Wake } from './refTypes';

export interface TypeSpec {
  code: string; // ICAO type designator
  maker: string;
  model: string; // marketing name of the variant described
  family?: string;
  firstFlight: number; // year of first flight of this variant
  lengthM: number;
  spanM: number; // wingspan (helicopters: main-rotor diameter)
  heightM: number;
  mtowKg: number;
  mlwKg: number;
  oewKg: number;
  maxFuelKg: number;
  maxPayloadKg: number;
  burnKgH: number; // typical cruise fuel burn for the whole aircraft
  mmo?: number; // max operating Mach (jets only)
  cruiseMach?: number; // typical long-range cruise Mach (jets)
  ceilingFt: number;
  rangeNm: number; // typical range (gliders: typical long cross-country distance)
  seatsTypical: number; // typical seating (2-class for mainline; 0 for freighters/military)
  seatsMax: number; // certified exit limit (light aircraft: total occupants)
  engines: {
    count: number;
    kind: 'jet' | 'turboprop' | 'piston' | 'turboshaft' | 'none';
    mount: 'wing' | 'rear' | 'nose' | 'fuselage' | 'tail' | 'none';
    name: string;
  };
  wing: 'low' | 'high' | 'mid' | 'rotor';
  /** 'none' = no horizontal tailplane (tailless deltas). */
  tail: 'conventional' | 'T' | 'cruciform' | 'twin' | 'V' | 'none';
  deck: 'single' | 'double' | 'hump';
  wake: Wake;
  recat: Recat;
  role:
    | 'airliner'
    | 'freighter'
    | 'bizjet'
    | 'ga'
    | 'helicopter'
    | 'military-transport'
    | 'tanker'
    | 'fighter'
    | 'patrol'
    | 'awacs'
    | 'trainer'
    | 'glider'
    | 'utility';
  vrKt: number; // typical rotation speed (gliders: launch release speed; helicopters: 0)
  vappKt: number; // typical final approach speed
  blurb: string;
  shape: ModelShape;
}

type Eng = TypeSpec['engines'];
type Row = [
  code: string,
  maker: string,
  model: string,
  family: string,
  firstFlight: number,
  dims: [lengthM: number, spanM: number, heightM: number],
  weights: [mtow: number, mlw: number, oew: number, maxFuel: number, maxPayload: number],
  perf: [burnKgH: number, mmo: number, cruiseMach: number, ceilingFt: number, rangeNm: number],
  seats: [typical: number, max: number],
  engines: [count: number, kind: Eng['kind'], mount: Eng['mount'], name: string],
  config: [wing: TypeSpec['wing'], tail: TypeSpec['tail'], deck: TypeSpec['deck']],
  cls: [recat: Recat, role: TypeSpec['role']],
  speeds: [vrKt: number, vappKt: number],
  shape: ModelShape,
  blurb: string,
];

/** ICAO wake category from MTOW (A380 is the only "super"). */
function wakeOf(code: string, mtowKg: number): Wake {
  if (code === 'A388') return 'J';
  if (mtowKg >= 136_000) return 'H';
  if (mtowKg > 7_000) return 'M';
  return 'L';
}

const AB = 'Airbus';
const BO = 'Boeing';
const EM = 'Embraer';
const BOMB = 'Bombardier';
const A320F = 'A320 family';
const B737F = '737 family';
const B777F = '777 family';
const B787F = '787 family';
const A330F = 'A330 family';
const A350F = 'A350 family';
const EJ = 'E-Jet family';
const EJ2 = 'E-Jet E2 family';
const CRJ = 'CRJ family';

// prettier-ignore
const ROWS: Row[] = [
  // ── Airbus narrow-bodies ──────────────────────────────────────────────────────────
  ['A318', AB, 'A318', A320F, 2002, [31.44, 34.1, 12.56], [68000, 57500, 39500, 19000, 15000], [2200, 0.82, 0.78, 41000, 3100], [107, 132], [2, 'jet', 'wing', 'CFM CFM56-5B'], ['low', 'conventional', 'single'], ['D', 'airliner'], [130, 125], 'narrow',
    'Shortest A320-family member, six frames shorter than the A319. Certified for steep approaches, which is why it served London City.'],
  ['A319', AB, 'A319', A320F, 1995, [33.84, 35.8, 11.76], [75500, 62500, 40800, 19000, 17700], [2300, 0.82, 0.78, 39800, 3750], [124, 156], [2, 'jet', 'wing', 'CFM CFM56-5B'], ['low', 'conventional', 'single'], ['D', 'airliner'], [135, 130], 'narrow',
    'Shortened A320 with the same wing, cockpit and systems. Common with low-cost and flag carriers on thinner short-haul routes.'],
  ['A320', AB, 'A320ceo', A320F, 1987, [37.57, 35.8, 11.76], [78000, 66000, 42600, 19000, 19900], [2500, 0.82, 0.78, 39800, 3300], [150, 186], [2, 'jet', 'wing', 'CFM CFM56-5B'], ['low', 'conventional', 'single'], ['D', 'airliner'], [140, 135], 'narrow',
    'The first airliner with digital fly-by-wire and sidestick controls. Engines are the CFM56-5B or IAE V2500.'],
  ['A20N', AB, 'A320neo', A320F, 2014, [37.57, 35.8, 11.76], [79000, 67400, 44300, 18700, 20000], [2200, 0.82, 0.78, 39800, 3400], [165, 194], [2, 'jet', 'wing', 'CFM LEAP-1A'], ['low', 'conventional', 'single'], ['D', 'airliner'], [140, 133], 'narrow',
    'Re-engined A320 with LEAP-1A or PW1100G geared turbofans and sharklets as standard. Burns roughly 15–20% less fuel per seat than the ceo.'],
  ['A321', AB, 'A321ceo', A320F, 1993, [44.51, 35.8, 11.76], [93500, 77800, 48500, 18900, 25300], [2900, 0.82, 0.78, 39800, 3200], [185, 220], [2, 'jet', 'wing', 'IAE V2533-A5'], ['low', 'conventional', 'single'], ['D', 'airliner'], [145, 138], 'narrow',
    'Stretched A320 with double-slotted flaps and four pairs of exits. Engines are the IAE V2500 or CFM56-5B.'],
  ['A21N', AB, 'A321neo', A320F, 2016, [44.51, 35.8, 11.76], [97000, 79200, 50100, 18400, 25500], [2600, 0.82, 0.78, 39800, 4000], [200, 244], [2, 'jet', 'wing', 'CFM LEAP-1A'], ['low', 'conventional', 'single'], ['D', 'airliner'], [145, 135], 'narrow',
    'Best-selling A320neo variant; the LR and XLR versions add fuel for transatlantic sectors. Cabin-Flex door layouts allow up to 244 seats.'],
  ['BCS1', AB, 'A220-100', 'A220 family', 2013, [35.0, 35.1, 11.5], [63100, 52400, 35200, 17300, 15100], [1700, 0.82, 0.78, 41000, 3450], [115, 135], [2, 'jet', 'wing', 'P&W PW1500G'], ['low', 'conventional', 'single'], ['D', 'airliner'], [125, 120], 'narrow',
    'Developed by Bombardier as the CS100 and renamed after Airbus took control in 2018. Five-abreast cabin with PW1500G geared turbofans.'],
  ['BCS3', AB, 'A220-300', 'A220 family', 2015, [38.7, 35.1, 11.5], [70900, 58700, 37100, 17100, 18700], [1900, 0.82, 0.78, 41000, 3600], [140, 160], [2, 'jet', 'wing', 'P&W PW1500G'], ['low', 'conventional', 'single'], ['D', 'airliner'], [130, 128], 'narrow',
    'Stretched A220 (formerly Bombardier CS300) with a composite wing. Seats 2-3 abreast in a cabin slightly wider than most regional jets.'],

  // ── Boeing narrow-bodies ──────────────────────────────────────────────────────────
  ['B737', BO, '737-700', B737F, 1997, [33.6, 35.8, 12.5], [70080, 58600, 38150, 20400, 17600], [2300, 0.82, 0.785, 41000, 3010], [128, 149], [2, 'jet', 'wing', 'CFM CFM56-7B'], ['low', 'conventional', 'single'], ['D', 'airliner'], [140, 130], 'narrow',
    'Next Generation 737 with a new wing and CFM56-7B engines. Southwest Airlines was the launch customer.'],
  ['B738', BO, '737-800', B737F, 1997, [39.5, 35.8, 12.5], [79010, 66360, 41410, 20400, 21300], [2500, 0.82, 0.785, 41000, 2935], [162, 189], [2, 'jet', 'wing', 'CFM CFM56-7B'], ['low', 'conventional', 'single'], ['D', 'airliner'], [145, 140], 'narrow',
    'The most-produced 737 Next Generation variant. Ryanair operates the largest fleet, at 189 seats.'],
  ['B739', BO, '737-900ER', B737F, 2006, [42.1, 35.8, 12.5], [85130, 71350, 44680, 23300, 23000], [2650, 0.82, 0.785, 41000, 2950], [178, 220], [2, 'jet', 'wing', 'CFM CFM56-7B'], ['low', 'conventional', 'single'], ['D', 'airliner'], [150, 145], 'narrow',
    'Longest 737 NG; the ER adds a pair of exits, auxiliary tanks and a flat rear pressure bulkhead. Launched by Lion Air.'],
  ['B37M', BO, '737 MAX 7', B737F, 2018, [35.56, 35.9, 12.3], [80300, 66000, 42000, 20300, 17700], [2000, 0.82, 0.79, 41000, 3850], [140, 172], [2, 'jet', 'wing', 'CFM LEAP-1B'], ['low', 'conventional', 'single'], ['D', 'airliner'], [135, 130], 'narrow',
    'Shortest 737 MAX, with the LEAP-1B and split-tip winglets. Replaces the 737-700 with more range.'],
  ['B38M', BO, '737 MAX 8', B737F, 2016, [39.52, 35.9, 12.3], [82190, 69310, 45070, 20400, 20800], [2150, 0.82, 0.79, 41000, 3550], [172, 210], [2, 'jet', 'wing', 'CFM LEAP-1B'], ['low', 'conventional', 'single'], ['D', 'airliner'], [145, 138], 'narrow',
    'Fourth-generation 737 with LEAP-1B engines and split-tip winglets. The high-density 737-8-200 seats up to 210 using an extra pair of exits.'],
  ['B39M', BO, '737 MAX 9', B737F, 2017, [42.16, 35.9, 12.3], [88310, 74350, 50300, 20400, 22000], [2350, 0.82, 0.79, 41000, 3300], [193, 220], [2, 'jet', 'wing', 'CFM LEAP-1B'], ['low', 'conventional', 'single'], ['D', 'airliner'], [150, 145], 'narrow',
    'Stretched 737 MAX, successor to the 737-900ER. Optional mid-cabin exit plugs allow up to 220 seats.'],
  ['B712', BO, '717-200', '717', 1998, [37.81, 28.45, 8.92], [54900, 46300, 31070, 11000, 12500], [1950, 0.82, 0.77, 37000, 2060], [110, 134], [2, 'jet', 'rear', 'Rolls-Royce BR715'], ['low', 'T', 'single'], ['E', 'airliner'], [135, 130], 'rear-jet',
    'Began as the McDonnell Douglas MD-95, the last DC-9 derivative. Two BR715 turbofans are mounted on the rear fuselage under a T-tail.'],
  ['B752', BO, '757-200', '757', 1982, [47.32, 38.05, 13.56], [115680, 89810, 58000, 33500, 25400], [3300, 0.86, 0.8, 42000, 3915], [200, 239], [2, 'jet', 'wing', 'Rolls-Royce RB211-535E4'], ['low', 'conventional', 'single'], ['D', 'airliner'], [145, 135], 'narrow',
    'Single-aisle twin with a large wing and strong climb performance; still flown on thin transatlantic routes. Engines are the RB211-535 or PW2000.'],
  ['B753', BO, '757-300', '757', 1998, [54.43, 38.05, 13.56], [123600, 101600, 64590, 34000, 31000], [3600, 0.86, 0.8, 42000, 3400], [243, 280], [2, 'jet', 'wing', 'Rolls-Royce RB211-535E4B'], ['low', 'conventional', 'single'], ['D', 'airliner'], [155, 140], 'narrow',
    'Stretched 757 and the longest single-aisle twinjet built; it has a tail skid against tail strikes. Only 55 were delivered.'],

  // ── Wide-bodies ───────────────────────────────────────────────────────────────────
  ['B762', BO, '767-200ER', '767', 1984, [48.51, 47.57, 15.85], [179170, 136080, 82380, 72000, 35500], [4800, 0.86, 0.8, 43100, 6590], [214, 255], [2, 'jet', 'wing', 'GE CF6-80C2'], ['low', 'conventional', 'single'], ['C', 'airliner'], [150, 140], 'wide-twin',
    'Extended-range 767-200 that helped open ETOPS twin-engine transatlantic flying. Seven-abreast 2-3-2 economy.'],
  ['B763', BO, '767-300ER', '767', 1986, [54.94, 47.57, 15.85], [186880, 145150, 90010, 73400, 43800], [5400, 0.86, 0.8, 43100, 5980], [269, 351], [2, 'jet', 'wing', 'GE CF6-80C2'], ['low', 'conventional', 'single'], ['C', 'airliner'], [150, 140], 'wide-twin',
    'The most-produced 767 passenger variant; many carry blended winglets. Engines are the CF6-80C2, PW4000 or RB211-524.'],
  ['B764', BO, '767-400ER', '767', 1999, [61.37, 51.92, 16.87], [204120, 158760, 103870, 72000, 45800], [5800, 0.86, 0.8, 43100, 5625], [296, 375], [2, 'jet', 'wing', 'GE CF6-80C2B8F'], ['low', 'conventional', 'single'], ['C', 'airliner'], [155, 145], 'wide-twin',
    'Longest 767, with raked wingtips and a 777-style cabin. Only Delta and United ordered it as an airliner.'],
  ['B772', BO, '777-200ER', B777F, 1996, [63.73, 60.93, 18.5], [297550, 213180, 138100, 134400, 57000], [7000, 0.87, 0.84, 43100, 7065], [313, 440], [2, 'jet', 'wing', 'GE GE90-94B'], ['low', 'conventional', 'single'], ['B', 'airliner'], [160, 140], 'wide-twin',
    'Extended-range 777-200 with more fuel and higher weights. Engines are the GE90, PW4090 or Trent 895.'],
  ['B77W', BO, '777-300ER', B777F, 2003, [73.86, 64.8, 18.5], [351530, 251290, 167830, 145500, 69900], [7800, 0.87, 0.84, 43100, 7370], [396, 550], [2, 'jet', 'wing', 'GE GE90-115B'], ['low', 'conventional', 'single'], ['B', 'airliner'], [165, 150], 'wide-twin',
    'Long-range 777-300 with raked wingtips and GE90-115B engines, among the most powerful jet engines in service. The backbone of many long-haul fleets.'],
  ['B77L', BO, '777-200LR / 777F', B777F, 2005, [63.7, 64.8, 18.6], [347800, 260800, 144400, 145500, 102000], [7500, 0.87, 0.84, 43100, 4970], [301, 440], [2, 'jet', 'wing', 'GE GE90-110B1'], ['low', 'conventional', 'single'], ['B', 'airliner'], [165, 150], 'wide-twin',
    'Shared airframe of the ultra-long-range 777-200LR (about 8,500 nm) and the 777F freighter (102 t payload). Weights and range here are the 777F figures.'],
  ['B788', BO, '787-8', B787F, 2009, [56.72, 60.12, 16.92], [227930, 172365, 119950, 101000, 41000], [5400, 0.9, 0.85, 43100, 7305], [248, 381], [2, 'jet', 'wing', 'Rolls-Royce Trent 1000'], ['low', 'conventional', 'single'], ['B', 'airliner'], [150, 140], 'wide-twin',
    'First airliner with a mostly carbon-composite airframe and a bleedless electrical architecture. Engines are the Trent 1000 or GEnx-1B.'],
  ['B789', BO, '787-9', B787F, 2013, [62.81, 60.12, 17.02], [254011, 192777, 128850, 101300, 52600], [5800, 0.9, 0.85, 43100, 7565], [296, 420], [2, 'jet', 'wing', 'GE GEnx-1B'], ['low', 'conventional', 'single'], ['B', 'airliner'], [155, 145], 'wide-twin',
    'Stretched 787 with the longest range of the family. Flies some of the longest scheduled routes, such as Perth–London.'],
  ['B78X', BO, '787-10', B787F, 2017, [68.28, 60.12, 17.02], [254011, 201849, 135500, 101300, 57200], [6300, 0.9, 0.85, 41100, 6330], [330, 440], [2, 'jet', 'wing', 'Rolls-Royce Trent 1000 TEN'], ['low', 'conventional', 'single'], ['B', 'airliner'], [160, 150], 'wide-twin',
    'Longest 787, trading range for capacity at the same maximum take-off weight as the 787-9. Built only in North Charleston.'],
  ['B744', BO, '747-400', '747', 1988, [70.66, 64.44, 19.41], [396890, 285760, 178760, 174000, 67300], [10500, 0.92, 0.85, 45100, 7260], [416, 660], [4, 'jet', 'wing', 'P&W PW4056'], ['low', 'conventional', 'hump'], ['B', 'airliner'], [165, 150], 'b747',
    'The best-selling 747, with a two-crew glass cockpit, winglets and an extended upper deck. Engines are the PW4000, CF6-80C2 or RB211-524.'],
  ['B748', BO, '747-8 Intercontinental', '747', 2011, [76.25, 68.4, 19.4], [447700, 312100, 220130, 194600, 75200], [10000, 0.9, 0.855, 43100, 7730], [410, 605], [4, 'jet', 'wing', 'GE GEnx-2B67'], ['low', 'conventional', 'hump'], ['B', 'airliner'], [170, 155], 'b747',
    'Longest airliner built until the 777-9, with a new wing and GEnx-2B engines. Production ended in 2022 after 155 aircraft.'],
  ['A332', AB, 'A330-200', A330F, 1997, [58.82, 60.3, 17.39], [242000, 182000, 120600, 109000, 49400], [5600, 0.86, 0.82, 41450, 7250], [247, 406], [2, 'jet', 'wing', 'GE CF6-80E1'], ['low', 'conventional', 'single'], ['B', 'airliner'], [150, 140], 'wide-twin',
    'Shortened, longer-range A330 with a taller fin. Engines are the CF6-80E1, PW4000 or Trent 700.'],
  ['A333', AB, 'A330-300', A330F, 1992, [63.67, 60.3, 16.79], [242000, 187000, 124500, 109000, 50500], [5900, 0.86, 0.82, 41450, 6350], [290, 440], [2, 'jet', 'wing', 'Rolls-Royce Trent 772B'], ['low', 'conventional', 'single'], ['B', 'airliner'], [155, 140], 'wide-twin',
    'Original A330, sharing its wing and fuselage cross-section with the four-engined A340. Eight-abreast 2-4-2 economy is typical.'],
  ['A339', AB, 'A330-900', A330F, 2017, [63.66, 64.0, 16.79], [251000, 191000, 135000, 109000, 46000], [5500, 0.86, 0.82, 41450, 6550], [287, 460], [2, 'jet', 'wing', 'Rolls-Royce Trent 7000'], ['low', 'conventional', 'single'], ['B', 'airliner'], [150, 140], 'wide-twin',
    'Re-engined A330neo with Trent 7000 engines and a longer, sharklet-tipped wing. About 11% lower fuel burn per seat than the ceo.'],
  ['A359', AB, 'A350-900', A350F, 2013, [66.8, 64.75, 17.05], [283000, 207000, 142400, 110500, 53300], [5800, 0.89, 0.85, 43100, 8100], [315, 440], [2, 'jet', 'wing', 'Rolls-Royce Trent XWB-84'], ['low', 'conventional', 'single'], ['B', 'airliner'], [155, 140], 'wide-twin',
    'Carbon-composite long-hauler powered exclusively by the Trent XWB. The ULR version flies Singapore–New York nonstop.'],
  ['A35K', AB, 'A350-1000', A350F, 2016, [73.79, 64.75, 17.08], [319000, 236000, 155000, 124700, 68000], [6800, 0.89, 0.85, 41450, 8700], [369, 480], [2, 'jet', 'wing', 'Rolls-Royce Trent XWB-97'], ['low', 'conventional', 'single'], ['B', 'airliner'], [160, 145], 'wide-twin',
    'Stretched A350 with six-wheel main bogies and the more powerful Trent XWB-97. Basis of Qantas\'s planned Sydney–London nonstops.'],
  ['A388', AB, 'A380-800', 'A380', 2005, [72.72, 79.75, 24.09], [575000, 394000, 277000, 254000, 84000], [11500, 0.89, 0.85, 43000, 8000], [545, 853], [4, 'jet', 'wing', 'Engine Alliance GP7200'], ['low', 'conventional', 'double'], ['A', 'airliner'], [150, 140], 'a380',
    'The largest passenger airliner, with two full-length decks. Production ended in 2021; Emirates operates about half the fleet.'],
  ['A343', AB, 'A340-300', 'A340', 1991, [63.69, 60.3, 16.85], [276500, 192000, 130200, 116000, 52800], [6800, 0.86, 0.82, 41100, 7400], [295, 440], [4, 'jet', 'wing', 'CFM CFM56-5C4'], ['low', 'conventional', 'single'], ['B', 'airliner'], [150, 140], 'quad',
    'Four-engined sibling of the A330 with the same wing and cockpit. Its four CFM56-5C engines suited long overwater routes before ETOPS rules relaxed.'],
  ['A306', AB, 'A300F4-600R', 'A300', 1994, [54.08, 44.84, 16.62], [170500, 140000, 81900, 53500, 48100], [5200, 0.82, 0.78, 40000, 2650], [0, 0], [2, 'jet', 'wing', 'GE CF6-80C2'], ['low', 'conventional', 'single'], ['C', 'freighter'], [150, 140], 'wide-twin',
    'Freighter version of the A300-600, the first twin-engined wide-body. FedEx and UPS were long its largest operators.'],
  ['MD11', 'McDonnell Douglas', 'MD-11F', 'MD-11', 1990, [61.6, 51.97, 17.6], [286000, 213900, 113400, 117000, 91000], [8000, 0.87, 0.82, 42000, 3600], [0, 0], [3, 'jet', 'wing', 'GE CF6-80C2D1F'], ['low', 'conventional', 'single'], ['C', 'freighter'], [165, 155], 'tri-jet',
    'Tri-jet derived from the DC-10, with one engine on each wing and one in the tail. It survives mainly as a freighter; its high approach speed is notable.'],

  // ── Regional jets ─────────────────────────────────────────────────────────────────
  ['E170', EM, 'E170', EJ, 2002, [29.9, 26.0, 9.67], [37200, 32800, 21140, 9335, 9100], [1500, 0.82, 0.78, 41000, 2150], [72, 80], [2, 'jet', 'wing', 'GE CF34-8E'], ['low', 'conventional', 'single'], ['E', 'airliner'], [125, 125], 'narrow',
    'Smallest first-generation E-Jet, with a four-abreast double-bubble fuselage. Engines are under-wing GE CF34-8Es.'],
  ['E75L', EM, 'E175', EJ, 2003, [31.68, 28.65, 9.86], [40370, 34000, 21890, 9335, 10360], [1600, 0.82, 0.78, 41000, 2200], [76, 88], [2, 'jet', 'wing', 'GE CF34-8E'], ['low', 'conventional', 'single'], ['E', 'airliner'], [130, 125], 'narrow',
    'The E175 is the mainstay of US regional flying, where scope clauses cap it at 76 seats. E75L denotes the long-wing (enhanced wingtip) version.'],
  ['E190', EM, 'E190', EJ, 2004, [36.24, 28.72, 10.57], [51800, 44000, 28080, 12971, 13080], [1900, 0.82, 0.78, 41000, 2450], [100, 114], [2, 'jet', 'wing', 'GE CF34-10E'], ['low', 'conventional', 'single'], ['E', 'airliner'], [135, 130], 'narrow',
    'Stretched E-Jet with a larger wing and CF34-10E engines. Popular with European regionals such as KLM Cityhopper.'],
  ['E195', EM, 'E195', EJ, 2004, [38.65, 28.72, 10.55], [52290, 45000, 28970, 12971, 13650], [2000, 0.82, 0.78, 41000, 2300], [116, 124], [2, 'jet', 'wing', 'GE CF34-10E'], ['low', 'conventional', 'single'], ['E', 'airliner'], [140, 135], 'narrow',
    'Largest first-generation E-Jet, with a four-abreast cabin and no middle seats.'],
  ['E295', EM, 'E195-E2', EJ2, 2017, [41.5, 35.12, 10.91], [62500, 54000, 35700, 13690, 16150], [1850, 0.82, 0.78, 41000, 2600], [132, 146], [2, 'jet', 'wing', 'P&W PW1900G'], ['low', 'conventional', 'single'], ['D', 'airliner'], [135, 130], 'narrow',
    'Second-generation E195 with a new, longer wing, fly-by-wire and PW1900G geared turbofans. Three rows longer than the original E195.'],
  ['CRJ2', BOMB, 'CRJ200', CRJ, 1995, [26.77, 21.21, 6.22], [24040, 21319, 13835, 6490, 6125], [1100, 0.85, 0.74, 41000, 1700], [50, 50], [2, 'jet', 'rear', 'GE CF34-3B1'], ['low', 'T', 'single'], ['E', 'airliner'], [140, 140], 'rear-jet',
    '50-seat regional jet stretched from the Challenger 600 business jet, with a narrow four-abreast cabin. Production ended in 2006.'],
  ['CRJ7', BOMB, 'CRJ700', CRJ, 1999, [32.51, 23.24, 7.57], [34019, 30390, 20069, 8890, 8200], [1350, 0.85, 0.78, 41000, 1430], [70, 78], [2, 'jet', 'rear', 'GE CF34-8C5'], ['low', 'T', 'single'], ['E', 'airliner'], [140, 135], 'rear-jet',
    'Stretched CRJ with a new wing, leading-edge slats and a lowered cabin floor. Common with US regional airlines.'],
  ['CRJ9', BOMB, 'CRJ900', CRJ, 2001, [36.4, 24.85, 7.51], [38330, 34065, 21845, 8880, 10200], [1450, 0.85, 0.78, 41000, 1550], [76, 90], [2, 'jet', 'rear', 'GE CF34-8C5'], ['low', 'T', 'single'], ['E', 'airliner'], [145, 140], 'rear-jet',
    'Further stretched CRJ700. The CRJ programme passed to Mitsubishi in 2020 and production ended that year.'],
  ['E145', EM, 'ERJ-145', 'ERJ family', 1995, [29.87, 20.04, 6.76], [22000, 19300, 12100, 5187, 5800], [950, 0.78, 0.74, 37000, 1550], [50, 50], [2, 'jet', 'rear', 'Rolls-Royce AE 3007A1'], ['low', 'T', 'single'], ['E', 'airliner'], [135, 130], 'rear-jet',
    '50-seat regional jet derived from the EMB-120 Brasilia fuselage, seated 1-2 abreast. AE 3007 engines are mounted on the rear fuselage.'],
  ['SU95', 'Sukhoi', 'Superjet 100-95', 'Superjet 100', 2008, [29.94, 27.8, 10.28], [49450, 41000, 25100, 12690, 12245], [1700, 0.81, 0.78, 40000, 2470], [87, 108], [2, 'jet', 'wing', 'PowerJet SaM146'], ['low', 'conventional', 'single'], ['E', 'airliner'], [130, 125], 'narrow',
    'Russian regional jet with five-abreast seating and Franco-Russian SaM146 engines. Aeroflot is the largest operator.'],

  // ── Turboprops ────────────────────────────────────────────────────────────────────
  ['AT45', 'ATR', 'ATR 42-500', 'ATR 42/72', 1994, [22.67, 24.57, 7.59], [18600, 18300, 11250, 4500, 5450], [600, 0, 0, 25000, 716], [48, 50], [2, 'turboprop', 'wing', 'P&WC PW127E'], ['high', 'T', 'single'], ['E', 'airliner'], [105, 105], 'high-turboprop',
    'Smaller ATR with six-blade propellers, suited to short and unpaved runways. The -600 adds a glass cockpit.'],
  ['AT76', 'ATR', 'ATR 72-600', 'ATR 42/72', 2009, [27.17, 27.05, 7.65], [23000, 22350, 13500, 5000, 7500], [750, 0, 0, 25000, 825], [70, 78], [2, 'turboprop', 'wing', 'P&WC PW127M'], ['high', 'T', 'single'], ['E', 'airliner'], [110, 110], 'high-turboprop',
    'The best-selling regional turboprop. Passengers board through a rear door because the forward fuselage holds the cargo hold.'],
  ['DH8D', 'De Havilland Canada', 'Dash 8-400', 'Dash 8', 1998, [32.81, 28.42, 8.34], [29574, 28123, 17819, 5318, 8670], [950, 0, 0, 27000, 1100], [76, 90], [2, 'turboprop', 'wing', 'P&WC PW150A'], ['high', 'T', 'single'], ['E', 'airliner'], [115, 120], 'high-turboprop',
    'Fast regional turboprop, cruising near 360 kt with PW150A engines. It was marketed as the Q400 for its active noise and vibration suppression.'],
  ['SF34', 'Saab', 'Saab 340B', 'Saab 340', 1989, [19.73, 21.44, 6.97], [13155, 12930, 8140, 2600, 3400], [400, 0, 0, 25000, 930], [34, 37], [2, 'turboprop', 'wing', 'GE CT7-9B'], ['low', 'conventional', 'single'], ['F', 'airliner'], [110, 115], 'low-turboprop',
    'Swedish 34-seat commuter turboprop with three-abreast seating. The 340B introduced more powerful CT7-9B engines and a larger tailplane.'],
  ['B190', 'Beechcraft', '1900D', 'Beech 1900', 1991, [17.63, 17.67, 4.72], [7765, 7604, 4815, 1600, 2100], [400, 0, 0, 25000, 700], [19, 19], [2, 'turboprop', 'wing', 'P&WC PT6A-67D'], ['low', 'T', 'single'], ['F', 'airliner'], [110, 115], 'low-turboprop',
    '19-seat commuter airliner; the D model has a stand-up cabin. It carries small winglets and tailets for stability.'],

  // ── Business jets ─────────────────────────────────────────────────────────────────
  ['C68A', 'Cessna', 'Citation Latitude', 'Citation', 2014, [18.97, 22.05, 6.38], [13970, 12500, 8870, 5170, 1100], [650, 0.8, 0.72, 45000, 2700], [9, 9], [2, 'jet', 'rear', 'P&WC PW306D1'], ['low', 'T', 'single'], ['F', 'bizjet'], [110, 110], 'rear-jet',
    'Mid-size Citation with a flat-floor, stand-up cabin. Built by Textron Aviation in Wichita.'],
  ['CL35', BOMB, 'Challenger 350', 'Challenger 300', 2013, [20.92, 21.0, 6.1], [18416, 15354, 11250, 6420, 1600], [800, 0.83, 0.8, 45000, 3200], [9, 10], [2, 'jet', 'rear', 'Honeywell HTF7350'], ['low', 'T', 'single'], ['E', 'bizjet'], [125, 120], 'rear-jet',
    'Super mid-size business jet, an upgraded Challenger 300 with canted winglets and more thrust. One of the best-selling jets in its class.'],
  ['GLF6', 'Gulfstream', 'G650', 'G650', 2009, [30.41, 30.36, 7.82], [45180, 37876, 24494, 20050, 2950], [1400, 0.925, 0.85, 51000, 7000], [14, 19], [2, 'jet', 'rear', 'Rolls-Royce BR725'], ['low', 'T', 'single'], ['E', 'bizjet'], [135, 115], 'rear-jet',
    'Ultra-long-range business jet with a maximum operating Mach of 0.925. The G650ER extends range to about 7,500 nm.'],
  ['GLEX', BOMB, 'Global 6000', 'Global', 1996, [30.3, 28.65, 7.7], [45132, 35652, 23224, 20430, 2600], [1500, 0.89, 0.85, 51000, 6000], [13, 19], [2, 'jet', 'rear', 'Rolls-Royce BR710A2-20'], ['low', 'T', 'single'], ['E', 'bizjet'], [135, 125], 'rear-jet',
    'Ultra-long-range business jet derived from the Global Express, which first flew in 1996. It shares its fuselage cross-section with the CRJ.'],
  ['E55P', EM, 'Phenom 300E', 'Phenom', 2008, [15.64, 16.2, 5.1], [8150, 7650, 5400, 2428, 1000], [400, 0.8, 0.7, 45000, 2010], [7, 10], [2, 'jet', 'rear', 'P&WC PW535E1'], ['low', 'T', 'single'], ['F', 'bizjet'], [105, 115], 'rear-jet',
    'Light jet that has been the world\'s best-delivered business jet for most years since 2013. Often flown single-pilot.'],
  ['PC24', 'Pilatus', 'PC-24', 'PC-24', 2015, [16.85, 17.0, 5.4], [8300, 7665, 5310, 2720, 1100], [400, 0.74, 0.66, 45000, 2000], [8, 10], [2, 'jet', 'rear', 'Williams FJ44-4A'], ['low', 'T', 'single'], ['F', 'bizjet'], [100, 105], 'rear-jet',
    'Swiss light jet certified for short, unpaved runways. It has a large cargo door and is used as an air ambulance in Australia.'],
  ['F2TH', 'Dassault', 'Falcon 2000', 'Falcon', 1993, [20.23, 19.33, 7.06], [16556, 14970, 10250, 5510, 1600], [700, 0.86, 0.8, 47000, 3000], [10, 19], [2, 'jet', 'rear', 'CFE CFE738-1-1B'], ['low', 'cruciform', 'single'], ['E', 'bizjet'], [125, 115], 'rear-jet',
    'Twin-engine wide-cabin business jet derived from the three-engined Falcon 900. Later LX/S versions add blended winglets and PW308 engines.'],
  ['LJ45', 'Learjet', 'Learjet 45', 'Learjet', 1995, [17.68, 14.58, 4.3], [9752, 8709, 6124, 2750, 1000], [550, 0.81, 0.75, 51000, 1900], [8, 9], [2, 'jet', 'rear', 'Honeywell TFE731-20'], ['low', 'T', 'single'], ['F', 'utility'], [120, 125], 'rear-jet',
    'Light business jet often configured as an air ambulance with a stretcher and medical crew. Production ended in 2012 with the Learjet 75 continuing the line.'],

  // ── Utility / single turboprops ───────────────────────────────────────────────────
  ['PC12', 'Pilatus', 'PC-12', 'PC-12', 1991, [14.4, 16.28, 4.26], [4740, 4500, 2840, 1220, 1000], [190, 0, 0, 30000, 1800], [9, 9], [1, 'turboprop', 'nose', 'P&WC PT6A-67P'], ['low', 'T', 'single'], ['F', 'utility'], [80, 85], 'single-turboprop',
    'Single-engine turboprop with a large rear cargo door. Widely used by the Royal Flying Doctor Service in Australia.'],
  ['C208', 'Cessna', '208B Grand Caravan', 'Caravan', 1986, [12.67, 15.88, 4.52], [3995, 3856, 2250, 1010, 1360], [170, 0, 0, 25000, 900], [9, 13], [1, 'turboprop', 'nose', 'P&WC PT6A-140'], ['high', 'conventional', 'single'], ['F', 'utility'], [70, 80], 'single-turboprop',
    'Rugged single-engine utility turboprop, flown as a parcel feeder, commuter and floatplane. The EX model has the PT6A-140.'],
  ['B350', 'Beechcraft', 'King Air 350', 'King Air', 1988, [14.22, 17.65, 4.37], [6804, 6804, 4100, 1630, 1100], [300, 0, 0, 35000, 1800], [8, 11], [2, 'turboprop', 'wing', 'P&WC PT6A-60A'], ['low', 'T', 'single'], ['F', 'utility'], [100, 105], 'low-turboprop',
    'Largest King Air twin turboprop, common as an air ambulance and special-mission aircraft. Military versions fly as the MC-12 and C-12.'],

  // ── Light aircraft ────────────────────────────────────────────────────────────────
  ['C152', 'Cessna', '152', 'Cessna single', 1977, [7.34, 10.11, 2.59], [757, 757, 490, 67, 230], [17, 0, 0, 14700, 415], [2, 2], [1, 'piston', 'nose', 'Lycoming O-235-L2C'], ['high', 'conventional', 'single'], ['F', 'ga'], [50, 60], 'single-high',
    'Two-seat high-wing trainer that taught generations of pilots. More than 7,500 were built before production ended in 1985.'],
  ['C172', 'Cessna', '172S Skyhawk', 'Cessna single', 1955, [8.28, 11.0, 2.72], [1157, 1157, 767, 145, 390], [25, 0, 0, 14000, 640], [4, 4], [1, 'piston', 'nose', 'Lycoming IO-360-L2A'], ['high', 'conventional', 'single'], ['F', 'ga'], [55, 65], 'single-high',
    'The most-produced aircraft in history, with more than 45,000 built. A four-seat high-wing trainer and tourer.'],
  ['C182', 'Cessna', '182T Skylane', 'Cessna single', 1956, [8.84, 11.0, 2.84], [1406, 1338, 894, 237, 500], [36, 0, 0, 18100, 915], [4, 4], [1, 'piston', 'nose', 'Lycoming IO-540-AB1A5'], ['high', 'conventional', 'single'], ['F', 'ga'], [50, 70], 'single-high',
    'Heavier, more powerful four-seat Cessna with a constant-speed propeller. Frequently used as a glider tow plane and for parachute drops.'],
  ['PA28', 'Piper', 'PA-28-181 Archer', 'Cherokee', 1960, [7.25, 10.67, 2.22], [1157, 1157, 760, 131, 390], [25, 0, 0, 13200, 520], [4, 4], [1, 'piston', 'nose', 'Lycoming O-360-A4M'], ['low', 'conventional', 'single'], ['F', 'ga'], [60, 66], 'single-low',
    'Four-seat low-wing tourer and trainer of the Cherokee line. It has a single door on the right side and an all-moving stabilator.'],
  ['SR22', 'Cirrus', 'SR22', 'SR2x', 2000, [7.92, 11.68, 2.72], [1633, 1633, 1050, 250, 530], [46, 0, 0, 17500, 1000], [4, 5], [1, 'piston', 'nose', 'Continental IO-550-N'], ['low', 'conventional', 'single'], ['F', 'ga'], [70, 80], 'single-low',
    'Composite four/five-seat tourer with a whole-airframe ballistic parachute as standard. The best-selling piston single of recent decades.'],
  ['DA40', 'Diamond', 'DA40 NG', 'DA40', 1997, [8.06, 11.94, 1.97], [1310, 1280, 900, 118, 380], [17, 0, 0, 16400, 750], [4, 4], [1, 'piston', 'nose', 'Austro Engine AE300'], ['low', 'T', 'single'], ['F', 'ga'], [60, 70], 'single-low',
    'Composite four-seat trainer with a T-tail. The NG burns Jet A-1 in its AE300 diesel engine.'],
  ['DR40', 'Robin', 'DR400/180 Regent', 'DR400', 1972, [6.96, 8.72, 2.23], [1100, 1100, 600, 137, 400], [27, 0, 0, 15000, 700], [4, 4], [1, 'piston', 'nose', 'Lycoming O-360-A3A'], ['low', 'conventional', 'single'], ['F', 'ga'], [55, 65], 'single-low',
    'French wooden four-seater with the Jodel cranked wing and a sliding canopy. The 180R Remorqueur version is a common glider tug.'],
  ['PA25', 'Piper', 'PA-25-235 Pawnee', 'Pawnee', 1957, [7.53, 11.02, 2.19], [1315, 1315, 740, 104, 500], [35, 0, 0, 13000, 260], [1, 1], [1, 'piston', 'nose', 'Lycoming O-540-B2B5'], ['low', 'conventional', 'single'], ['F', 'utility'], [55, 65], 'single-low',
    'Single-seat agricultural aircraft, now best known as a glider tug. The cockpit sits high and aft for visibility and crash protection.'],

  // ── Helicopters ───────────────────────────────────────────────────────────────────
  ['EC35', 'Airbus Helicopters', 'H135 (EC135 T3)', 'H135', 1994, [12.16, 10.2, 3.51], [2980, 2980, 1490, 540, 1000], [200, 0, 0, 20000, 340], [6, 7], [2, 'turboshaft', 'fuselage', 'Safran Arrius 2B2'], ['rotor', 'conventional', 'single'], ['F', 'helicopter'], [0, 60], 'heli',
    'Light twin helicopter with a shrouded Fenestron tail rotor. Widely used by air ambulance (HEMS) and police units.'],
  ['EC45', 'Airbus Helicopters', 'H145 (EC145 T2)', 'H145', 2011, [13.64, 11.0, 3.95], [3800, 3800, 1919, 723, 1600], [270, 0, 0, 18000, 350], [9, 10], [2, 'turboshaft', 'fuselage', 'Safran Arriel 2E'], ['rotor', 'conventional', 'single'], ['F', 'helicopter'], [0, 65], 'heli',
    'Light twin developed from the BK 117, with a Fenestron and rear clamshell doors for stretcher loading. Common in HEMS, police and mountain rescue.'],
  ['AS50', 'Airbus Helicopters', 'H125 (AS350 B3)', 'Écureuil', 1974, [12.94, 10.69, 3.34], [2250, 2250, 1174, 430, 900], [170, 0, 0, 23000, 340], [6, 7], [1, 'turboshaft', 'fuselage', 'Safran Arriel 2D'], ['rotor', 'conventional', 'single'], ['F', 'helicopter'], [0, 60], 'heli',
    'Single-engine utility helicopter with strong hot-and-high performance; one landed on the summit of Everest in 2005.'],
  ['EC30', 'Airbus Helicopters', 'H130 (EC130 T2)', 'Écureuil', 1999, [12.64, 10.69, 3.61], [2427, 2427, 1460, 430, 900], [180, 0, 0, 15000, 330], [7, 7], [1, 'turboshaft', 'fuselage', 'Safran Arriel 2D'], ['rotor', 'conventional', 'single'], ['F', 'helicopter'], [0, 60], 'heli',
    'Wide-cabin development of the AS350 with a Fenestron tail. Favoured for sightseeing tours over cities and the Grand Canyon.'],
  ['A109', 'Leonardo', 'AW109 Power', 'AW109', 1995, [13.04, 10.83, 3.5], [3000, 3000, 1600, 450, 1100], [260, 0, 0, 15000, 450], [6, 7], [2, 'turboshaft', 'fuselage', 'P&WC PW206C'], ['rotor', 'conventional', 'single'], ['F', 'helicopter'], [0, 70], 'heli',
    'Fast light twin with retractable landing gear, descended from the 1971 Agusta A109. Used for corporate, police and air ambulance work.'],
  ['A169', 'Leonardo', 'AW169', 'AW169', 2012, [14.65, 12.12, 4.47], [4800, 4800, 2900, 780, 1700], [330, 0, 0, 15000, 440], [8, 10], [2, 'turboshaft', 'fuselage', 'P&WC PW210A'], ['rotor', 'conventional', 'single'], ['F', 'helicopter'], [0, 70], 'heli',
    'Light-intermediate twin used by many air ambulance charities. Its PW210A engines can drive the main rotor gearbox as an APU on the ground.'],
  ['A139', 'Leonardo', 'AW139', 'AW139', 2001, [16.66, 13.8, 4.98], [6400, 6400, 3700, 1250, 2500], [500, 0, 0, 20000, 570], [12, 15], [2, 'turboshaft', 'fuselage', 'P&WC PT6C-67C'], ['rotor', 'conventional', 'single'], ['F', 'helicopter'], [0, 70], 'heli',
    'Medium twin and the best-selling helicopter in its class, used offshore, for search and rescue and by coastguards.'],
  ['EC75', 'Airbus Helicopters', 'H175', 'H175', 2009, [18.06, 14.8, 5.34], [7800, 7800, 4700, 2000, 2700], [550, 0, 0, 15000, 590], [16, 18], [2, 'turboshaft', 'fuselage', 'P&WC PT6C-67E'], ['rotor', 'conventional', 'single'], ['F', 'helicopter'], [0, 70], 'heli',
    'Super-medium twin co-developed with China\'s Avicopter, designed around offshore oil-and-gas crew change with 16 seats.'],
  ['S76', 'Sikorsky', 'S-76C++', 'S-76', 1977, [16.0, 13.41, 4.42], [5307, 5307, 3180, 860, 1700], [300, 0, 0, 13800, 400], [12, 13], [2, 'turboshaft', 'fuselage', 'Safran Arriel 2S2'], ['rotor', 'conventional', 'single'], ['F', 'helicopter'], [0, 70], 'heli',
    'Medium twin with retractable gear, long used for offshore transport and VIP flights. The S-76D switched to PW210S engines.'],
  ['S92', 'Sikorsky', 'S-92', 'S-92', 1998, [20.88, 17.17, 5.47], [12020, 12020, 7030, 2300, 4500], [620, 0, 0, 14000, 539], [19, 19], [2, 'turboshaft', 'fuselage', 'GE CT7-8A'], ['rotor', 'conventional', 'single'], ['F', 'helicopter'], [0, 75], 'heli',
    'Large twin used for offshore crew change and search and rescue (UK coastguard). Its systems derive from the UH-60 Black Hawk.'],
  ['H60', 'Sikorsky', 'UH-60 Black Hawk', 'S-70', 1974, [19.76, 16.36, 5.13], [9980, 9980, 5200, 1080, 2600], [500, 0, 0, 19000, 320], [11, 14], [2, 'turboshaft', 'fuselage', 'GE T700-GE-701D'], ['rotor', 'conventional', 'single'], ['F', 'helicopter'], [0, 75], 'heli',
    'US Army medium-lift utility helicopter, also flown for medevac (HH-60) and firefighting. More than 4,000 of the S-70 family have been built.'],

  // ── Military ──────────────────────────────────────────────────────────────────────
  ['C17', BO, 'C-17A Globemaster III', 'C-17', 1991, [53.04, 51.75, 16.79], [265350, 199600, 128100, 105000, 77500], [9000, 0.875, 0.74, 45000, 2420], [0, 102], [4, 'jet', 'wing', 'P&W F117-PW-100'], ['high', 'T', 'single'], ['C', 'military-transport'], [115, 120], 'high-jet-quad',
    'Strategic airlifter, originally a McDonnell Douglas design, able to land on short and austere strips. It can carry an M1 Abrams tank.'],
  ['K35R', BO, 'KC-135R Stratotanker', 'C-135', 1956, [41.53, 39.88, 12.7], [146285, 102000, 44660, 90700, 37600], [5500, 0.9, 0.78, 50000, 1500], [0, 80], [4, 'jet', 'wing', 'CFM F108-CF-100'], ['low', 'conventional', 'single'], ['C', 'tanker'], [160, 145], 'quad',
    'Boom-equipped aerial refuelling tanker related to the 707; the R model was re-engined with CFM F108 turbofans. Range shown is with a large fuel offload.'],
  ['C30J', 'Lockheed Martin', 'C-130J-30 Super Hercules', 'C-130', 1996, [34.37, 40.41, 11.84], [74390, 70300, 36300, 20800, 19960], [2400, 0, 0, 28000, 1800], [0, 128], [4, 'turboprop', 'wing', 'Rolls-Royce AE 2100D3'], ['high', 'conventional', 'single'], ['D', 'military-transport'], [105, 120], 'high-quad-turboprop',
    'Stretched Super Hercules with a two-pilot glass cockpit and six-blade propellers. Operates from short, unprepared airstrips.'],
  ['A400', AB, 'A400M Atlas', 'A400M', 2009, [45.1, 42.4, 14.7], [141000, 123000, 76500, 50500, 37000], [3800, 0, 0, 37000, 1780], [0, 116], [4, 'turboprop', 'wing', 'Europrop TP400-D6'], ['high', 'T', 'single'], ['C', 'military-transport'], [110, 115], 'high-quad-turboprop',
    'European tactical and strategic airlifter with the most powerful turboprops in Western service. The propellers on each wing turn in opposite directions.'],
  ['E3TF', BO, 'E-3 Sentry', 'E-3', 1975, [46.61, 44.42, 12.6], [147400, 112000, 73480, 72500, 15000], [7000, 0.85, 0.72, 41000, 4000], [0, 0], [4, 'jet', 'wing', 'P&W TF33-PW-100A'], ['low', 'conventional', 'single'], ['C', 'awacs'], [150, 145], 'awacs',
    'Airborne warning and control aircraft built on the 707-320 airframe, carrying a 9.1 m rotating radar dome. E3TF denotes the TF33-powered USAF/NATO aircraft.'],
  ['P8', BO, 'P-8A Poseidon', '737 family', 2009, [39.47, 37.64, 12.83], [85820, 66400, 62730, 33500, 9000], [3000, 0.82, 0.79, 41000, 3000], [0, 0], [2, 'jet', 'wing', 'CFM CFM56-7B27A'], ['low', 'conventional', 'single'], ['D', 'patrol'], [150, 140], 'narrow',
    'Maritime patrol and anti-submarine aircraft based on the 737-800 fuselage and 737-900 wing, with a weapons bay and raked wingtips.'],
  ['EUFI', 'Eurofighter', 'Typhoon', 'Typhoon', 1994, [15.96, 10.95, 5.28], [23500, 15000, 11000, 4996, 7500], [2500, 2.0, 0.85, 55000, 1500], [0, 0], [2, 'jet', 'fuselage', 'Eurojet EJ200'], ['mid', 'none', 'single'], ['E', 'fighter'], [135, 140], 'fighter',
    'Twin-engine canard-delta multirole fighter built by a UK–German–Italian–Spanish consortium. Capable of supersonic cruise without afterburner.'],
  ['F16', 'Lockheed Martin', 'F-16C Fighting Falcon', 'F-16', 1984, [15.06, 9.96, 4.88], [19200, 13000, 8570, 3175, 7700], [2000, 2.05, 0.85, 50000, 1740], [0, 0], [1, 'jet', 'fuselage', 'GE F110-GE-129'], ['mid', 'conventional', 'single'], ['E', 'fighter'], [145, 145], 'fighter',
    'Single-engine multirole fighter with fly-by-wire controls and a frameless bubble canopy; more than 4,600 have been built.'],
  ['F35', 'Lockheed Martin', 'F-35A Lightning II', 'F-35', 2006, [15.7, 10.7, 4.38], [31750, 22000, 13290, 8278, 8160], [3000, 1.6, 0.85, 50000, 1200], [0, 0], [1, 'jet', 'fuselage', 'P&W F135-PW-100'], ['mid', 'twin', 'single'], ['E', 'fighter'], [150, 140], 'fighter',
    'Single-engine stealth multirole fighter; the A is the conventional take-off variant. Carries its weapons internally to keep a low radar signature.'],
  ['RFAL', 'Dassault', 'Rafale C', 'Rafale', 1991, [15.27, 10.9, 5.34], [24500, 15000, 10000, 4700, 9500], [2500, 1.8, 0.85, 50000, 2000], [0, 0], [2, 'jet', 'fuselage', 'Safran M88-2'], ['mid', 'none', 'single'], ['E', 'fighter'], [135, 130], 'fighter',
    'French twin-engine canard-delta omnirole fighter; the M version operates from aircraft carriers.'],
  ['HAWK', 'BAE Systems', 'Hawk', 'Hawk', 1974, [12.43, 9.94, 3.98], [9100, 7500, 4480, 1300, 3085], [700, 0.84, 0.75, 44500, 1360], [0, 0], [1, 'jet', 'fuselage', 'Rolls-Royce Turbomeca Adour 951'], ['low', 'conventional', 'single'], ['F', 'trainer'], [115, 125], 'fighter',
    'Tandem two-seat advanced jet trainer, flown by the RAF Red Arrows display team. Later versions have glass cockpits that mimic front-line fighters.'],

  // ── Gliders ───────────────────────────────────────────────────────────────────────
  ['AS21', 'Alexander Schleicher', 'ASK 21', 'ASK 21', 1979, [8.35, 17.0, 1.55], [600, 600, 360, 0, 240], [0, 0, 0, 18000, 300], [2, 2], [0, 'none', 'none', '—'], ['mid', 'T', 'single'], ['F', 'glider'], [60, 50], 'glider',
    'Two-seat glass-fibre trainer used by gliding clubs worldwide; robust enough for basic aerobatics and spin training. Best glide ratio about 34:1.'],
  ['DUOD', 'Schempp-Hirth', 'Duo Discus', 'Discus', 1993, [8.62, 20.0, 1.6], [750, 750, 410, 0, 240], [0, 0, 0, 18000, 540], [2, 2], [0, 'none', 'none', '—'], ['high', 'T', 'single'], ['F', 'glider'], [65, 55], 'glider',
    'Two-seat 20 m sailplane for cross-country flying and advanced training. Carries water ballast; best glide ratio about 45:1.'],
  ['DISC', 'Schempp-Hirth', 'Discus', 'Discus', 1984, [6.58, 15.0, 1.3], [525, 525, 233, 0, 110], [0, 0, 0, 18000, 400], [1, 1], [0, 'none', 'none', '—'], ['mid', 'T', 'single'], ['F', 'glider'], [60, 50], 'glider',
    'Standard Class (15 m) single-seat sailplane with a swept-back leading edge. It dominated championships for years.'],
  ['LS8', 'Rolladen-Schneider', 'LS8', 'LS8', 1994, [6.72, 15.0, 1.36], [525, 525, 250, 0, 110], [0, 0, 0, 18000, 400], [1, 1], [0, 'none', 'none', '—'], ['mid', 'T', 'single'], ['F', 'glider'], [60, 50], 'glider',
    'Standard Class sailplane, also flown at 18 m span with wingtip extensions. Later built by DG Flugzeugbau.'],
  ['GLID', 'Various', 'Glider (generic)', 'Sailplane', 1970, [7.0, 15.0, 1.4], [500, 500, 260, 0, 110], [0, 0, 0, 18000, 300], [1, 1], [0, 'none', 'none', '—'], ['mid', 'T', 'single'], ['F', 'glider'], [60, 50], 'glider',
    'Generic ICAO designator used when a glider\'s exact type is not given. The figures here are representative of a 15 m single-seat sailplane.'],
];

function build(r: Row): TypeSpec {
  const [code, maker, model, family, firstFlight, [lengthM, spanM, heightM], [mtowKg, mlwKg, oewKg, maxFuelKg, maxPayloadKg], [burnKgH, mmo, cruiseMach, ceilingFt, rangeNm], [seatsTypical, seatsMax], [count, kind, mount, name], [wing, tail, deck], [recat, role], [vrKt, vappKt], shape, blurb] = r;
  const spec: TypeSpec = {
    code,
    maker,
    model,
    firstFlight,
    lengthM,
    spanM,
    heightM,
    mtowKg,
    mlwKg,
    oewKg,
    maxFuelKg,
    maxPayloadKg,
    burnKgH,
    ceilingFt,
    rangeNm,
    seatsTypical,
    seatsMax,
    engines: { count, kind, mount, name },
    wing,
    tail,
    deck,
    wake: wakeOf(code, mtowKg),
    recat,
    role,
    vrKt,
    vappKt,
    blurb,
    shape,
  };
  if (family) spec.family = family;
  if (mmo > 0) spec.mmo = mmo;
  if (cruiseMach > 0) spec.cruiseMach = cruiseMach;
  return spec;
}

export const TYPE_SPECS: Record<string, TypeSpec> = Object.fromEntries(ROWS.map((r) => [r[0], build(r)]));

export function specOf(code: string): TypeSpec | undefined {
  return TYPE_SPECS[code.trim().toUpperCase()];
}

/** Search by code, maker or model text (case-insensitive), best matches first. */
export function searchTypes(q: string, limit = 20): TypeSpec[] {
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const scored: { s: TypeSpec; score: number }[] = [];
  for (const s of Object.values(TYPE_SPECS)) {
    const code = s.code.toLowerCase();
    const model = s.model.toLowerCase();
    const maker = s.maker.toLowerCase();
    const family = (s.family ?? '').toLowerCase();
    let score = 0;
    let all = true;
    for (const t of tokens) {
      let best = 0;
      if (code === t) best = 100;
      else if (code.startsWith(t)) best = 70;
      if (model === t) best = Math.max(best, 90);
      else if (model.startsWith(t)) best = Math.max(best, 60);
      else if (model.includes(t)) best = Math.max(best, 40);
      if (maker.startsWith(t)) best = Math.max(best, 35);
      else if (maker.includes(t)) best = Math.max(best, 25);
      if (family.includes(t)) best = Math.max(best, 20);
      if (!best && code.includes(t)) best = 15;
      if (!best) {
        all = false;
        break;
      }
      score += best;
    }
    if (all) scored.push({ s, score });
  }
  scored.sort((a, b) => b.score - a.score || a.s.code.localeCompare(b.s.code));
  return scored.slice(0, limit).map((x) => x.s);
}
