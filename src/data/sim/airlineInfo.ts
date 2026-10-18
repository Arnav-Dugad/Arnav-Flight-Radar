// Extra reference data for every airline in ALL_AIRLINES: ICAO radiotelephony
// designators (as published in ICAO Doc 8585 and widely reproduced lists), business
// model, premium cabins and approximate livery colours. Used only by the
// simulation, which is always labelled as simulated.
//
// Unverified telephony (most widely reported designator used; could not be
// cross-checked against Doc 8585): LAN, FAD, NBT, EAI, OCN, HOP, DHK, TKJ, SEH,
// RXI, APK, UBG, CDC, SJV, QLK, DWI, SKU.
//
// Colours are approximate: `body` is the dominant fuselage colour a viewer would
// remember, `tail` the dominant fin colour.

import type { AirlineModel } from './refTypes';

export interface AirlineExtra {
  /** ICAO radiotelephony designator, upper case (e.g. 'SPEEDBIRD'). */
  tel: string;
  model: AirlineModel;
  /** Sells a first-class cabin on long-haul. */
  first?: boolean;
  /** Has a premium-economy cabin on long-haul. */
  premEco?: boolean;
  /** Dominant fuselage colour (hex). */
  body: string;
  /** Dominant tail-fin colour (hex). */
  tail: string;
  hubsNote?: string;
}

const W = '#f4f5f7'; // standard white fuselage

/** flags: 'F' = first class, 'P' = premium economy. */
const e = (tel: string, model: AirlineModel, body: string, tail: string, flags = ''): AirlineExtra => {
  const x: AirlineExtra = { tel, model, body, tail };
  if (flags.includes('F')) x.first = true;
  if (flags.includes('P')) x.premEco = true;
  return x;
};

export const AIRLINE_EXTRA: Record<string, AirlineExtra> = {
  // ------------------------------------------------------------------ North America
  AAL: e('AMERICAN', 'full', '#c9ced4', '#0078d2', 'FP'),
  DAL: e('DELTA', 'full', W, '#0b2a5b', 'P'),
  UAL: e('UNITED', 'full', W, '#0a2a66', 'P'),
  SWA: e('SOUTHWEST', 'low', '#304cb2', '#304cb2'),
  ASA: e('ALASKA', 'full', W, '#01426a'),
  JBU: e('JETBLUE', 'low', W, '#0033a0'),
  SKW: e('SKYWEST', 'regional', W, '#1b3d6d'),
  RPA: e('BRICKYARD', 'regional', W, '#1c3f94'),
  ENY: e('ENVOY', 'regional', '#c9ced4', '#0078d2'),
  NKS: e('SPIRIT WINGS', 'low', '#ffe300', '#ffe300'),
  FFT: e('FRONTIER FLIGHT', 'low', W, '#00754a'),
  FDX: e('FEDEX', 'cargo', W, '#4d148c'),
  UPS: e('UPS', 'cargo', W, '#351c15'),
  GTI: e('GIANT', 'cargo', W, '#1c3967'),
  EJA: e('EXECJET', 'bizjet', W, '#5b6670'),
  ACA: e('AIR CANADA', 'full', W, '#111111', 'P'),
  WJA: e('WESTJET', 'low', W, '#00aaa6'),
  JZA: e('JAZZ', 'regional', W, '#111111'),
  AMX: e('AEROMEXICO', 'full', W, '#0b2343'),
  VOI: e('VOLARIS', 'low', W, '#a12885'),
  // ------------------------------------------------------------------ South America
  LAN: e('LAN', 'full', W, '#1b0088'),
  GLO: e('GOL TRANSPORTE', 'low', W, '#ff7020'),
  AZU: e('AZUL', 'low', W, '#002e6d'),
  AVA: e('AVIANCA', 'full', '#da291c', '#da291c'),
  ARG: e('ARGENTINA', 'full', W, '#1b75bb'),
  // ------------------------------------------------------------------ Europe
  BAW: e('SPEEDBIRD', 'full', W, '#1b2a5a', 'FP'),
  EZY: e('EASY', 'low', W, '#ff6600'),
  RYR: e('RYANAIR', 'low', W, '#073590'),
  DLH: e('LUFTHANSA', 'full', W, '#0a1d3d', 'FP'),
  AFR: e('AIRFRANS', 'full', W, '#002157', 'FP'),
  KLM: e('KLM', 'full', '#00a1de', '#00a1de', 'P'),
  IBE: e('IBERIA', 'full', W, '#d7192d', 'P'),
  VLG: e('VUELING', 'low', W, '#fdc400'),
  ITY: e('ITARROW', 'full', '#0b3d91', '#0b3d91', 'P'),
  SWR: e('SWISS', 'full', W, '#e20613', 'FP'),
  AUA: e('AUSTRIAN', 'full', W, '#e30613', 'P'),
  SAS: e('SCANDINAVIAN', 'full', W, '#00175a', 'P'),
  FIN: e('FINNAIR', 'full', W, '#0b1560', 'P'),
  NAX: e('NOR SHUTTLE', 'low', W, '#d81939'),
  WZZ: e('WIZZ AIR', 'low', W, '#c6007e'),
  THY: e('TURKISH', 'full', W, '#c70a0c'),
  PGT: e('SUNTURK', 'low', W, '#fdc300'),
  TAP: e('AIR PORTUGAL', 'full', W, '#169e45'),
  AEE: e('AEGEAN', 'full', W, '#0d2c6c'),
  LOT: e('POLLOT', 'full', W, '#11397d', 'P'),
  EIN: e('SHAMROCK', 'full', W, '#008272'),
  BEL: e('BEELINE', 'full', W, '#c8102e'),
  EWG: e('EUROWINGS', 'low', W, '#9b1c4d'),
  TOM: e('TOMSON', 'leisure', W, '#1b8fd4'),
  EXS: e('CHANNEX', 'leisure', W, '#e0291f'),
  CLX: e('CARGOLUX', 'cargo', W, '#e31b23'),
  NJE: e('FRACTION', 'bizjet', W, '#5b6670'),
  AFL: e('AEROFLOT', 'full', W, '#1b4b97'),
  // ------------------------------------------------------------------ Middle East & Africa
  UAE: e('EMIRATES', 'full', W, '#d71a21', 'FP'),
  FDB: e('SKYDUBAI', 'low', W, '#f26b21'),
  ETD: e('ETIHAD', 'full', '#d8c9a8', '#8a6d3b', 'F'),
  QTR: e('QATARI', 'full', W, '#5c0632', 'F'),
  SVA: e('SAUDIA', 'full', '#efe8d8', '#0a4c7a', 'F'),
  KNE: e('NAS EXPRESS', 'low', W, '#00a7b5'),
  FAD: e('FLYADEAL', 'low', W, '#a3cf3e'),
  GFA: e('GULF AIR', 'full', W, '#a3192e'),
  OMA: e('OMAN AIR', 'full', W, '#00838f'),
  RJA: e('JORDANIAN', 'full', W, '#2b2b2b'),
  ELY: e('ELAL', 'full', W, '#0a2d6e', 'P'),
  MSR: e('EGYPTAIR', 'full', W, '#1b3c6e'),
  ETH: e('ETHIOPIAN', 'full', W, '#2e8b3e'),
  KQA: e('KENYA', 'full', W, '#c8102e'),
  SAA: e('SPRINGBOK', 'full', W, '#007749'),
  RAM: e('ROYALAIR MAROC', 'full', W, '#c1272d'),
  // ------------------------------------------------------------------ South Asia
  AIC: e('AIRINDIA', 'full', W, '#8b1538', 'FP'),
  IGO: e('IFLY', 'low', W, '#001b94'),
  AXB: e('EXPRESS INDIA', 'low', W, '#e45f2b'),
  AKJ: e('AKASA AIR', 'low', W, '#ff6d38'),
  SEJ: e('SPICEJET', 'low', W, '#e2231a'),
  PIA: e('PAKISTAN', 'full', W, '#00573f'),
  ALK: e('SRILANKAN', 'full', W, '#003c71'),
  BBC: e('BANGLADESH', 'full', W, '#006a4e'),
  // ------------------------------------------------------------------ East & South-East Asia
  CCA: e('AIR CHINA', 'full', W, '#d7000f', 'FP'),
  CES: e('CHINA EASTERN', 'full', W, '#c8102e', 'P'),
  CSN: e('CHINA SOUTHERN', 'full', W, '#0b6fb8', 'FP'),
  CHH: e('HAINAN', 'full', W, '#c8102e'),
  CSZ: e('SHENZHEN AIR', 'full', W, '#c8102e'),
  CXA: e('XIAMEN AIR', 'full', W, '#0a5ca8'),
  CSC: e('SI CHUAN', 'full', W, '#c8102e'),
  CPA: e('CATHAY', 'full', W, '#006564', 'FP'),
  JAL: e('JAPANAIR', 'full', W, '#c8102e', 'FP'),
  ANA: e('ALL NIPPON', 'full', W, '#13448f', 'FP'),
  KAL: e('KOREANAIR', 'full', '#a8cde6', W, 'F'),
  AAR: e('ASIANA', 'full', '#e8e3d6', '#5b6670', 'F'),
  JJA: e('JEJU AIR', 'low', W, '#ff5000'),
  SIA: e('SINGAPORE', 'full', W, '#16285b', 'FP'),
  TGW: e('SCOOTER', 'low', W, '#ffd400'),
  MAS: e('MALAYSIAN', 'full', W, '#1a2a6c'),
  AXM: e('RED CAP', 'low', W, '#e41b23'),
  THA: e('THAI', 'full', W, '#5b2a86'),
  GIA: e('INDONESIA', 'full', W, '#0094a8'),
  LNI: e('LION INTER', 'low', W, '#e2231a'),
  PAL: e('PHILIPPINE', 'full', W, '#0033a0', 'P'),
  CEB: e('CEBU', 'low', W, '#ffde00'),
  VJC: e('VIETJET', 'low', W, '#e2231a'),
  HVN: e('VIET NAM AIRLINES', 'full', W, '#00788a', 'P'),
  EVA: e('EVA', 'full', W, '#005f3b', 'P'),
  CAL: e('DYNASTY', 'full', W, '#e9568c', 'P'),
  // ------------------------------------------------------------------ Oceania
  QFA: e('QANTAS', 'full', W, '#e40000', 'FP'),
  VOZ: e('VELOCITY', 'full', W, '#c3002f'),
  JST: e('JETSTAR', 'low', W, '#ff5115'),
  ANZ: e('NEW ZEALAND', 'full', W, '#111111', 'P'),

  // ================================================================== MORE_AIRLINES
  // United States
  JIA: e('BLUE STREAK', 'regional', '#c9ced4', '#0078d2'),
  PDT: e('PIEDMONT', 'regional', '#c9ced4', '#0078d2'),
  EDV: e('ENDEAVOR', 'regional', W, '#0b2a5b'),
  QXE: e('HORIZON', 'regional', W, '#01426a'),
  ASH: e('AIR SHUTTLE', 'regional', W, '#0a2a66'),
  AAY: e('ALLEGIANT', 'low', W, '#f58220'),
  SCX: e('SUN COUNTRY', 'low', W, '#f68b1f'),
  HAL: e('HAWAIIAN', 'full', W, '#5b2a86'),
  MXY: e('MOXY', 'low', W, '#2c3e94'),
  VXP: e('AVELO', 'low', W, '#5b2d8e'),
  CKS: e('CONNIE', 'cargo', W, '#c8102e'),
  PAC: e('POLAR', 'cargo', W, '#0b3b8c'),
  ABX: e('ABEX', 'cargo', W, '#1b3d6d'),
  ATN: e('AIR TRANSPORT', 'cargo', W, '#232f3e'),
  LXJ: e('FLEXJET', 'bizjet', W, '#2e2e2e'),
  // Canada
  POE: e('PORTER', 'full', W, '#1c2c5b'),
  FLE: e('FLAIR', 'low', W, '#6f2c91'),
  TSC: e('AIR TRANSAT', 'leisure', W, '#2bb3d8', 'P'),
  ROU: e('ROUGE', 'leisure', W, '#e31937'),
  CJT: e('CARGOJET', 'cargo', W, '#005eb8'),
  // Latin America & Caribbean
  VIV: e('AEROENLACES', 'low', W, '#00a650'),
  CMP: e('COPA', 'full', W, '#00205b'),
  TAM: e('TAM', 'full', W, '#1b0088'),
  LPE: e('LANPERU', 'full', W, '#1b0088'),
  JAT: e('ROCKSMART', 'low', W, '#1b3d8f'),
  SKU: e('AEROSKY', 'low', W, '#4b2c87'),
  BOV: e('BOLIVIANA', 'full', W, '#0b5394'),
  DWI: e('ARAJET', 'low', W, '#e3006d'),
  BWA: e('CARIBBEAN AIRLINES', 'full', W, '#00a3e0'),
  LCO: e('LAN CARGO', 'cargo', W, '#1b0088'),
  TPA: e('TAMPA', 'cargo', W, '#da291c'),
  // Iberia & Atlantic islands
  AEA: e('EUROPA', 'full', W, '#1a2b4c', 'P'),
  IBS: e('IBEREXPRES', 'low', W, '#d7192d'),
  ANE: e('AIR NOSTRUM', 'regional', W, '#d7192d'),
  IBB: e('BINTER', 'regional', W, '#7ab929'),
  VOE: e('VOLOTEA', 'low', W, '#4b2a7b'),
  // Germany, Switzerland, Benelux
  CFG: e('CONDOR', 'leisure', '#f2b900', '#f2b900', 'P'),
  OCN: e('OCEAN', 'leisure', W, '#1a2d58', 'P'),
  CLH: e('HANSALINE', 'regional', W, '#0a1d3d'),
  GEC: e('LUFTHANSA CARGO', 'cargo', W, '#0a1d3d'),
  BOX: e('GERMAN CARGO', 'cargo', W, '#203a72'),
  BCS: e('WORLD EXPRESS', 'cargo', '#ffcc00', '#ffcc00'),
  EDW: e('EDELWEISS', 'leisure', W, '#e30613'),
  OAW: e('HELVETIC', 'regional', W, '#9e1b32'),
  EZS: e('TOPSWISS', 'low', W, '#ff6600'),
  LGL: e('LUXAIR', 'full', W, '#00a1de'),
  TRA: e('TRANSAVIA', 'low', W, '#00b45a'),
  KLC: e('CITY', 'regional', '#00a1de', '#00a1de'),
  // France
  TVF: e('FRANCE SOLEIL', 'low', W, '#00b45a'),
  HOP: e('AIR HOP', 'regional', W, '#002157'),
  EJU: e('ALPINE', 'low', W, '#ff6600'),
  // UK & Ireland
  VIR: e('VIRGIN', 'full', W, '#da0530', 'P'),
  LOG: e('LOGAN', 'regional', W, '#0b2d63'),
  CFE: e('FLYER', 'regional', W, '#1b2a5a'),
  DHK: e('WORLD EXPRESS', 'cargo', '#ffcc00', '#ffcc00'),
  EAI: e('GREEN FLYER', 'regional', W, '#008272'),
  // Nordics & Baltics
  ICE: e('ICEAIR', 'full', W, '#0b2a6b'),
  NBT: e('NORSE ATLANTIC', 'low', W, '#0b1f3a', 'P'),
  WIF: e('WIDEROE', 'regional', W, '#008fc5'),
  BTI: e('AIRBALTIC', 'full', W, '#c3d600'),
  // Central, Eastern & Southern Europe
  TVS: e('SKYTRAVEL', 'low', W, '#00a1e4'),
  CTN: e('CROATIA', 'full', W, '#003a8c'),
  ASL: e('AIR SERBIA', 'full', W, '#c8102e'),
  ROT: e('TAROM', 'full', W, '#0c2e6b'),
  SEH: e('AIR CRETE', 'low', W, '#00a8e1'),
  NOS: e('MOONFLOWER', 'leisure', W, '#0b2a6b'),
  SXS: e('SUNEXPRESS', 'leisure', W, '#f6a800'),
  TKJ: e('ANATOLIAN', 'low', W, '#14275a'),
  CAI: e('CORENDON', 'leisure', W, '#e30613'),
  // Russia
  SBI: e('SIBERIAN AIRLINES', 'full', '#a4c639', '#a4c639'),
  SDM: e('RUSSIA', 'full', W, '#0039a6'),
  PBD: e('POBEDA', 'low', W, '#1e5aa8'),
  SVR: e('SVERDLOVSK AIR', 'full', W, '#c8102e'),
  UTA: e('UTAIR', 'full', W, '#0055a5'),
  // Middle East & Central Asia
  KAC: e('KUWAITI', 'full', W, '#0071bc', 'F'),
  JZR: e('JAZEERA', 'low', W, '#002b5c'),
  MEA: e('CEDAR JET', 'full', W, '#00843d'),
  ABY: e('ARABIA', 'low', W, '#e2231a'),
  RXI: e('RIYADH AIR', 'full', '#2d1a5c', '#2d1a5c'),
  KZR: e('ASTANALINE', 'full', W, '#0092b8'),
  UZB: e('UZBEK', 'full', W, '#0099b5'),
  // Africa
  DAH: e('AIR ALGERIE', 'full', W, '#c8102e'),
  TAR: e('TUNAIR', 'full', W, '#c8102e'),
  RWD: e('RWANDAIR', 'full', W, '#00a1de'),
  APK: e('PEACE BIRD', 'full', W, '#1e4597'),
  MAU: e('AIRMAURITIUS', 'full', W, '#c8102e'),
  LNK: e('LINK', 'regional', W, '#e04a1f'),
  SFR: e('SAFAIR', 'low', W, '#ff6600'),
  DTA: e('DTA', 'full', W, '#c8102e'),
  // South Asia
  UBG: e('BANGLA STAR', 'full', W, '#0055a5'),
  // China, Hong Kong & Taiwan
  CQH: e('AIR SPRING', 'low', W, '#00a651'),
  DKH: e('JUNEYAO AIRLINES', 'full', W, '#c8102e'),
  CDG: e('SHANDONG', 'full', W, '#0072bc'),
  CBJ: e('CAPITAL JET', 'full', W, '#d7262a'),
  GCR: e('BOHAI', 'full', W, '#c8102e'),
  CDC: e('LOONG AIR', 'low', W, '#e02020'),
  CKK: e('CARGO KING', 'cargo', W, '#c8102e'),
  CSS: e('SHUN FENG', 'cargo', W, '#1a1a1a'),
  HKE: e('HONGKONG SHUTTLE', 'low', W, '#7c2a8c'),
  CRK: e('BAUHINIA', 'full', W, '#c8102e'),
  AHK: e('AIR HONG KONG', 'cargo', '#ffcc00', '#ffcc00'),
  SJX: e('STARWALKER', 'full', W, '#8a6d3b', 'FP'),
  TTW: e('SMART CAT', 'low', W, '#ff8200'),
  // Japan & Korea
  APJ: e('AIR PEACH', 'low', W, '#d71f85'),
  SKY: e('SKYMARK', 'low', W, '#2052a2'),
  JJP: e('ORANGE LINER', 'low', W, '#ff5115'),
  TZP: e('ZIPPY', 'low', W, '#2b2b2b'),
  NCA: e('NIPPON CARGO', 'cargo', W, '#002e6d'),
  JNA: e('JIN AIR', 'low', W, '#8dc63f'),
  TWB: e('TEEWAY', 'low', W, '#c8102e'),
  ABL: e('AIR BUSAN', 'low', W, '#0072bc'),
  // South-East Asia
  AIQ: e('THAI ASIA', 'low', W, '#e41b23'),
  TLM: e('MENTARI', 'low', W, '#e2231a'),
  BKP: e('BANGKOK AIR', 'full', W, '#0072bc'),
  CTV: e('SUPERGREEN', 'low', W, '#8dc63f'),
  BTK: e('BATIK', 'full', W, '#c8102e'),
  WON: e('WINGS ABADI', 'regional', W, '#e2231a'),
  SJV: e('SUPERJET AIR', 'low', W, '#ed1c24'),
  MXD: e('MALINDO EXPRESS', 'full', W, '#c8102e'),
  XAX: e('XANADU', 'low', W, '#e41b23'),
  FFM: e('FIREFLY', 'regional', W, '#f15a22'),
  BAV: e('BAMBOO', 'full', W, '#3a9a3c'),
  // Oceania
  RXA: e('REX', 'regional', W, '#e30613'),
  QLK: e('QLINK', 'regional', W, '#e40000'),
  FJI: e('PACIFIC', 'full', W, '#3b2a1e'),
  // Business aviation
  VJT: e('VISTA MALTA', 'bizjet', '#d9dcdf', '#c8102e'),
};

/** The radiotelephony designator for an airline, or the upper-case first word of its name. */
export function telephonyOf(icao: string, fallbackName: string): string {
  const tel = AIRLINE_EXTRA[icao.toUpperCase()]?.tel;
  if (tel) return tel;
  const word = fallbackName.trim().split(/\s+/)[0] ?? '';
  const clean = word.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return clean || icao.toUpperCase();
}
