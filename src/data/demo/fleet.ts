// Demo-world reference data: real airlines, their real hubs and representative
// fleets, and real aircraft-type performance figures. Used ONLY by demo mode,
// which is always labelled as simulated. Flights, registrations, addresses and
// schedules generated from this data are invented.

export type TypeClass = 'wide' | 'narrow' | 'regional' | 'turboprop' | 'bizjet' | 'light' | 'heli';

export interface TypeInfo {
  code: string;
  desc: string;
  cat: string; // ADS-B emitter category
  kt: number; // typical cruise ground speed
  ft: number; // typical cruise altitude
  range: number; // NM
  cls: TypeClass;
}

const T = (code: string, desc: string, cat: string, kt: number, ft: number, range: number, cls: TypeClass): TypeInfo => ({ code, desc, cat, kt, ft, range, cls });

export const TYPES: Record<string, TypeInfo> = Object.fromEntries(
  [
    T('A319', 'AIRBUS A-319', 'A3', 445, 35000, 3000, 'narrow'),
    T('A320', 'AIRBUS A-320', 'A3', 450, 36000, 3000, 'narrow'),
    T('A20N', 'AIRBUS A-320neo', 'A3', 450, 36000, 3300, 'narrow'),
    T('A321', 'AIRBUS A-321', 'A3', 450, 35000, 3000, 'narrow'),
    T('A21N', 'AIRBUS A-321neo', 'A3', 450, 36000, 3900, 'narrow'),
    T('BCS3', 'AIRBUS A220-300', 'A3', 450, 37000, 3300, 'narrow'),
    T('B737', 'BOEING 737-700', 'A3', 440, 37000, 2800, 'narrow'),
    T('B738', 'BOEING 737-800', 'A3', 450, 37000, 2900, 'narrow'),
    T('B739', 'BOEING 737-900', 'A3', 450, 37000, 2800, 'narrow'),
    T('B38M', 'BOEING 737 MAX 8', 'A3', 450, 37000, 3500, 'narrow'),
    T('B39M', 'BOEING 737 MAX 9', 'A3', 450, 37000, 3300, 'narrow'),
    T('B752', 'BOEING 757-200', 'A4', 460, 38000, 3900, 'narrow'),
    T('B763', 'BOEING 767-300', 'A5', 460, 37000, 5900, 'wide'),
    T('B772', 'BOEING 777-200', 'A5', 485, 37000, 7000, 'wide'),
    T('B77W', 'BOEING 777-300ER', 'A5', 490, 37000, 7300, 'wide'),
    T('B77L', 'BOEING 777-200LR / 777F', 'A5', 485, 37000, 8500, 'wide'),
    T('B788', 'BOEING 787-8', 'A5', 485, 39000, 7300, 'wide'),
    T('B789', 'BOEING 787-9', 'A5', 488, 39000, 7500, 'wide'),
    T('B78X', 'BOEING 787-10', 'A5', 488, 39000, 6300, 'wide'),
    T('B744', 'BOEING 747-400', 'A5', 490, 34000, 7200, 'wide'),
    T('B748', 'BOEING 747-8', 'A5', 495, 36000, 7700, 'wide'),
    T('A332', 'AIRBUS A-330-200', 'A5', 470, 38000, 6500, 'wide'),
    T('A333', 'AIRBUS A-330-300', 'A5', 470, 37000, 6000, 'wide'),
    T('A339', 'AIRBUS A-330-900', 'A5', 470, 38000, 6500, 'wide'),
    T('A359', 'AIRBUS A-350-900', 'A5', 488, 39000, 8000, 'wide'),
    T('A35K', 'AIRBUS A-350-1000', 'A5', 488, 39000, 8700, 'wide'),
    T('A388', 'AIRBUS A-380-800', 'A5', 490, 38000, 8000, 'wide'),
    T('E75L', 'EMBRAER ERJ-175', 'A3', 430, 35000, 2000, 'regional'),
    T('E190', 'EMBRAER ERJ-190', 'A3', 440, 37000, 2400, 'regional'),
    T('E195', 'EMBRAER ERJ-195', 'A3', 440, 37000, 2300, 'regional'),
    T('E295', 'EMBRAER E195-E2', 'A3', 445, 39000, 2600, 'regional'),
    T('CRJ7', 'BOMBARDIER CRJ-700', 'A3', 440, 37000, 1400, 'regional'),
    T('CRJ9', 'BOMBARDIER CRJ-900', 'A3', 450, 37000, 1500, 'regional'),
    T('SU95', 'SUKHOI SUPERJET 100-95', 'A3', 440, 36000, 1600, 'regional'),
    T('AT76', 'ATR 72-600', 'A2', 275, 23000, 800, 'turboprop'),
    T('DH8D', 'DE HAVILLAND CANADA DASH 8-400', 'A2', 340, 25000, 1000, 'turboprop'),
    T('C68A', 'CESSNA 680A CITATION LATITUDE', 'A2', 440, 43000, 2700, 'bizjet'),
    T('CL35', 'BOMBARDIER CHALLENGER 350', 'A2', 450, 43000, 3200, 'bizjet'),
    T('GLF6', 'GULFSTREAM G650', 'A2', 488, 45000, 7000, 'bizjet'),
    T('PC12', 'PILATUS PC-12', 'A1', 270, 25000, 1800, 'turboprop'),
    T('C172', 'CESSNA 172 SKYHAWK', 'A1', 115, 4500, 500, 'light'),
    T('PA28', 'PIPER PA-28 CHEROKEE', 'A1', 115, 4500, 500, 'light'),
    T('SR22', 'CIRRUS SR22', 'A1', 170, 8500, 900, 'light'),
    T('EC35', 'AIRBUS HELICOPTERS H135', 'A7', 125, 1500, 300, 'heli'),
    T('EC45', 'AIRBUS HELICOPTERS H145', 'A7', 130, 1500, 350, 'heli'),
    T('AS50', 'AIRBUS HELICOPTERS H125', 'A7', 120, 1200, 300, 'heli'),
  ].map((t) => [t.code, t]),
);

export interface AirlineProfile {
  icao: string;
  iata: string;
  name: string;
  country: string; // ISO code used for registrations and ICAO address block
  reg: string; // registration pattern: L = letter, # = digit
  hubs: string[]; // ICAO airport idents
  fleet: [string, number][]; // [type code, weight]
  size: number; // simulated airframes
  dom: number; // share of domestic flights
  alnum?: boolean; // alphanumeric callsigns (e.g. EZY45LX)
}

const A = (
  icao: string,
  iata: string,
  name: string,
  country: string,
  reg: string,
  hubs: string,
  fleet: string,
  size: number,
  dom: number,
  alnum = false,
): AirlineProfile => ({
  icao,
  iata,
  name,
  country,
  reg,
  hubs: hubs.split(' '),
  fleet: fleet.split(' ').map((p) => {
    const [t, w] = p.split(':');
    return [t!, Number(w)];
  }),
  size,
  dom,
  alnum,
});

export const AIRLINES: AirlineProfile[] = [
  // North America
  A('AAL', 'AA', 'American Airlines', 'US', 'N###LL', 'KDFW KCLT KORD KMIA KPHL KPHX KLAX KJFK KDCA', 'A321:3 B38M:2 B738:3 A319:1 B772:0.5 B77W:0.5 B789:0.6 B788:0.4', 900, 0.85),
  A('DAL', 'DL', 'Delta Air Lines', 'US', 'N###LL', 'KATL KDTW KMSP KSLC KJFK KLAX KSEA KBOS', 'A321:2 A320:1 B739:2 B752:1 BCS3:0.6 A333:0.5 A339:0.5 A359:0.5', 900, 0.85),
  A('UAL', 'UA', 'United Airlines', 'US', 'N###LL', 'KORD KDEN KIAH KEWR KSFO KIAD KLAX', 'B739:2 B738:1.5 B38M:1 A320:1 A319:1 B772:0.6 B77W:0.3 B789:0.5 B78X:0.3 B763:0.3', 850, 0.8),
  A('SWA', 'WN', 'Southwest Airlines', 'US', 'N###LL', 'KDAL KMDW KBWI KDEN KLAS KPHX KHOU KMCO KOAK', 'B737:3 B38M:2 B738:2', 750, 1),
  A('ASA', 'AS', 'Alaska Airlines', 'US', 'N###LL', 'KSEA KPDX KSFO KLAX PANC', 'B739:2 B38M:1 B738:1', 230, 1),
  A('JBU', 'B6', 'JetBlue', 'US', 'N###LL', 'KJFK KBOS KFLL KMCO', 'A320:2 A321:2 BCS3:1', 270, 0.8),
  A('SKW', 'OO', 'SkyWest Airlines', 'US', 'N###LL', 'KDEN KORD KSLC KDTW KSFO KMSP', 'E75L:3 CRJ9:1 CRJ7:1', 450, 1),
  A('RPA', 'YX', 'Republic Airways', 'US', 'N###LL', 'KORD KEWR KIAD KIND', 'E75L:1', 230, 1),
  A('ENY', 'MQ', 'Envoy Air', 'US', 'N###LL', 'KDFW KORD KMIA', 'E75L:1', 180, 1),
  A('NKS', 'NK', 'Spirit Airlines', 'US', 'N###LL', 'KFLL KDTW KLAS KMCO', 'A20N:1 A321:0.5 A320:1', 200, 0.9),
  A('FFT', 'F9', 'Frontier Airlines', 'US', 'N###LL', 'KDEN KLAS KMCO', 'A20N:1 A21N:1', 160, 0.95),
  A('FDX', 'FX', 'FedEx', 'US', 'N###LL', 'KMEM KIND KOAK KEWR', 'B763:1 B77L:1 B752:1', 300, 0.7),
  A('UPS', '5X', 'UPS Airlines', 'US', 'N###LL', 'KSDF KONT KPHL', 'B763:1 B752:1 B748:0.3', 260, 0.7),
  A('GTI', '5Y', 'Atlas Air', 'US', 'N###LL', 'KCVG KMIA KJFK', 'B744:1 B748:0.5 B763:0.5', 80, 0.3),
  A('EJA', '1I', 'NetJets', 'US', 'N###LL', 'KTEB KPBI KVNY KHPN', 'C68A:2 CL35:1 GLF6:0.5', 300, 0.95),
  A('ACA', 'AC', 'Air Canada', 'CA', 'C-LLLL', 'CYYZ CYVR CYUL CYYC', 'A320:1 A321:1 B38M:1 BCS3:0.5 B789:0.6 B77W:0.4 A333:0.3', 300, 0.5),
  A('WJA', 'WS', 'WestJet', 'CA', 'C-LLLL', 'CYYC CYYZ CYVR', 'B38M:1 B737:1 B738:1 B789:0.2', 180, 0.8),
  A('JZA', 'QK', 'Jazz Aviation', 'CA', 'C-LLLL', 'CYYZ CYUL CYVR', 'DH8D:1 CRJ9:1', 120, 0.9),
  A('AMX', 'AM', 'Aeroméxico', 'MX', 'XA-LLL', 'MMMX MMMY MMGL', 'B38M:2 B738:1 B789:0.4 E190:1', 130, 0.6),
  A('VOI', 'Y4', 'Volaris', 'MX', 'XA-LLL', 'MMMX MMGL MMTJ', 'A20N:2 A21N:1 A320:1', 130, 0.75),
  // South America
  A('LAN', 'LA', 'LATAM Airlines', 'CL', 'CC-LLL', 'SCEL SBGR SPIM SKBO', 'A320:2 A321:1 B789:0.4 B763:0.3', 300, 0.55),
  A('GLO', 'G3', 'Gol Linhas Aéreas', 'BR', 'PR-LLL', 'SBGR SBSP SBBR SBGL', 'B738:2 B38M:1', 140, 0.9),
  A('AZU', 'AD', 'Azul Linhas Aéreas', 'BR', 'PR-LLL', 'SBKP SBCF SBRF', 'E195:2 A20N:1 AT76:1', 170, 0.9),
  A('AVA', 'AV', 'Avianca', 'CO', 'N###LL', 'SKBO SKRG', 'A320:2 A20N:1 B788:0.3', 120, 0.5),
  A('ARG', 'AR', 'Aerolíneas Argentinas', 'AR', 'LV-LLL', 'SAEZ SABE', 'B738:2 E190:0.5 A332:0.2', 80, 0.7),
  // Europe
  A('BAW', 'BA', 'British Airways', 'GB', 'G-LLLL', 'EGLL EGKK', 'A320:2 A319:1 A321:1 A20N:1 A21N:0.5 E190:0.3 B772:0.6 B77W:0.5 B789:0.4 B78X:0.2 A388:0.2 A35K:0.3', 300, 0.1),
  A('EZY', 'U2', 'easyJet', 'GB', 'G-LLLL', 'EGKK EGGW EGSS EGCC LFPG LSGG EHAM LEMD EDDB', 'A320:2 A20N:2 A319:1 A21N:1', 330, 0.2, true),
  A('RYR', 'FR', 'Ryanair', 'IE', 'EI-LLL', 'EIDW LEMD LEBL EGSS LIME LIRF LEPA LPPT EPKK LGAV EBCI', 'B738:3 B38M:1.2', 600, 0.1, true),
  A('DLH', 'LH', 'Lufthansa', 'DE', 'D-ALLL', 'EDDF EDDM', 'A320:1 A20N:1 A321:1 A319:0.5 A333:0.3 A359:0.4 B748:0.3 A388:0.1 B789:0.2', 330, 0.25),
  A('AFR', 'AF', 'Air France', 'FR', 'F-LLLL', 'LFPG LFPO', 'A320:1 A321:0.5 BCS3:1 A359:0.5 B77W:0.6 B772:0.3 B789:0.3 A332:0.2', 220, 0.2),
  A('KLM', 'KL', 'KLM', 'NL', 'PH-LLL', 'EHAM', 'B738:2 B739:0.5 E190:1 E295:0.5 B77W:0.4 B789:0.4 A332:0.2', 180, 0),
  A('IBE', 'IB', 'Iberia', 'ES', 'EC-LLL', 'LEMD', 'A320:1 A20N:1 A321:0.5 A359:0.4 A332:0.3', 120, 0.3),
  A('VLG', 'VY', 'Vueling', 'ES', 'EC-LLL', 'LEBL LEMD', 'A320:2 A20N:1', 120, 0.4),
  A('ITY', 'AZ', 'ITA Airways', 'IT', 'I-LLLL', 'LIRF LIML', 'A20N:1 A320:1 A359:0.2 A339:0.2', 90, 0.4),
  A('SWR', 'LX', 'Swiss', 'CH', 'HB-LLL', 'LSZH LSGG', 'A20N:1 A320:1 BCS3:1 B77W:0.2 A333:0.2', 100, 0),
  A('AUA', 'OS', 'Austrian Airlines', 'AT', 'OE-LLL', 'LOWW', 'A320:1 E195:1 B763:0.2 B772:0.1', 70, 0),
  A('SAS', 'SK', 'SAS Scandinavian Airlines', 'SE', 'SE-LLL', 'EKCH ESSA ENGM', 'A20N:2 A320:1 CRJ9:1 A359:0.2 A333:0.1', 150, 0.4),
  A('FIN', 'AY', 'Finnair', 'FI', 'OH-LLL', 'EFHK', 'A320:1 A321:1 A359:0.4 E190:0.5 AT76:0.5', 80, 0.2),
  A('NAX', 'DY', 'Norwegian', 'NO', 'LN-LLL', 'ENGM EKCH ESSA EFHK', 'B738:2 B38M:1', 90, 0.4),
  A('WZZ', 'W6', 'Wizz Air', 'HU', 'HA-LLL', 'EPWA LHBP LROP EGGW', 'A21N:2 A321:1 A20N:1', 210, 0.05),
  A('THY', 'TK', 'Turkish Airlines', 'TR', 'TC-LLL', 'LTFM LTFJ', 'A321:1 A21N:1 B738:1 B38M:1 A333:0.4 B77W:0.4 B789:0.4 A359:0.3', 400, 0.3),
  A('PGT', 'PC', 'Pegasus Airlines', 'TR', 'TC-LLL', 'LTFJ LTAI', 'A20N:2 A21N:1 B738:1', 110, 0.5),
  A('TAP', 'TP', 'TAP Air Portugal', 'PT', 'CS-LLL', 'LPPT LPPR', 'A20N:1 A321:1 A339:0.4 E195:0.3', 100, 0.1),
  A('AEE', 'A3', 'Aegean Airlines', 'GR', 'SX-LLL', 'LGAV', 'A20N:1 A320:1 A321:0.5', 60, 0.4),
  A('LOT', 'LO', 'LOT Polish Airlines', 'PL', 'SP-LLL', 'EPWA', 'B38M:1 E195:1 B788:0.3 B789:0.2', 75, 0.1),
  A('EIN', 'EI', 'Aer Lingus', 'IE', 'EI-LLL', 'EIDW', 'A320:2 A21N:0.5 A333:0.3', 60, 0),
  A('BEL', 'SN', 'Brussels Airlines', 'BE', 'OO-LLL', 'EBBR', 'A320:1 A319:0.5 A333:0.2', 45, 0),
  A('EWG', 'EW', 'Eurowings', 'DE', 'D-ALLL', 'EDDL EDDK EDDH EDDS', 'A320:1 A319:1 A20N:0.5', 110, 0.3),
  A('TOM', 'BY', 'TUI Airways', 'GB', 'G-LLLL', 'EGCC EGKK EGBB', 'B38M:1 B738:1 B789:0.3', 70, 0, true),
  A('EXS', 'LS', 'Jet2.com', 'GB', 'G-LLLL', 'EGCC EGBB EGNM EGPH', 'A321:1 B738:1 A21N:0.5', 120, 0, true),
  A('CLX', 'CV', 'Cargolux', 'LU', 'LX-LLL', 'ELLX', 'B748:1 B744:0.3', 25, 0),
  A('NJE', 'NJ', 'NetJets Europe', 'PT', 'CS-LLL', 'LFPB EGGW LSGG', 'C68A:1 CL35:1', 80, 0.2),
  A('AFL', 'SU', 'Aeroflot', 'RU', 'RA-#####', 'UUEE', 'A320:1 A321:1 B738:1 SU95:1 B77W:0.2 A333:0.2', 220, 0.7),
  // Middle East & Africa
  A('UAE', 'EK', 'Emirates', 'AE', 'A6-LLL', 'OMDB', 'B77W:4 A388:2.5', 260, 0),
  A('FDB', 'FZ', 'flydubai', 'AE', 'A6-LLL', 'OMDB', 'B38M:2 B738:1 B39M:0.5', 85, 0),
  A('ETD', 'EY', 'Etihad Airways', 'AE', 'A6-LLL', 'OMAA', 'B789:1 B78X:0.5 B77W:0.5 A320:0.5 A321:0.5 A35K:0.2', 100, 0),
  A('QTR', 'QR', 'Qatar Airways', 'QA', 'A7-LLL', 'OTHH', 'B77W:1 B788:0.5 B789:0.5 A359:1 A35K:0.5 A388:0.3 A320:0.5 B38M:0.5 B77L:0.4', 250, 0),
  A('SVA', 'SV', 'Saudia', 'SA', 'HZ-LLL', 'OEJN OERK OEMA OEDF', 'A320:1 A20N:1 A21N:0.5 B77W:0.5 B789:0.4 B78X:0.2', 150, 0.5),
  A('FAD', 'XY', 'flynas', 'SA', 'HZ-LLL', 'OERK OEJN', 'A20N:2 A320:1', 70, 0.6),
  A('GFA', 'GF', 'Gulf Air', 'BH', 'A9C-LL', 'OBBI', 'A20N:1 A21N:0.5 B789:0.3', 30, 0),
  A('OMA', 'WY', 'Oman Air', 'OM', 'A4O-LL', 'OOMS', 'B738:1 B38M:1 B789:0.5 A332:0.2', 40, 0.1),
  A('RJA', 'RJ', 'Royal Jordanian', 'JO', 'JY-LLL', 'OJAI', 'A320:1 A321:0.5 B788:0.3 E195:0.3', 25, 0),
  A('ELY', 'LY', 'El Al', 'IL', '4X-LLL', 'LLBG', 'B738:1 B739:1 B789:0.5 B788:0.3', 45, 0),
  A('MSR', 'MS', 'EgyptAir', 'EG', 'SU-LLL', 'HECA', 'A20N:1 B738:1 A21N:0.5 B77W:0.2 B789:0.2 A333:0.2', 70, 0.2),
  A('ETH', 'ET', 'Ethiopian Airlines', 'ET', 'ET-LLL', 'HAAB', 'B38M:1 B738:0.5 B788:0.4 B789:0.3 A359:0.4 B77W:0.3 DH8D:0.8 B77L:0.2', 140, 0.2),
  A('KQA', 'KQ', 'Kenya Airways', 'KE', '5Y-LLL', 'HKJK', 'E190:1 B738:1 B788:0.5', 35, 0.2),
  A('SAA', 'SA', 'South African Airways', 'ZA', 'ZS-LLL', 'FAOR FACT', 'A320:1 A20N:0.5 A333:0.3', 35, 0.4),
  A('RAM', 'AT', 'Royal Air Maroc', 'MA', 'CN-LLL', 'GMMN', 'B738:2 B38M:0.5 B788:0.3 B789:0.3 AT76:0.5', 60, 0.2),
  // South Asia
  A('AIC', 'AI', 'Air India', 'IN', 'VT-LLL', 'VIDP VABB VOBL', 'A20N:2 A21N:1 A320:1 B788:0.4 B77W:0.4 B772:0.2 A359:0.2', 200, 0.6),
  A('IGO', '6E', 'IndiGo', 'IN', 'VT-LLL', 'VIDP VABB VOBL VOMM VOHS VECC VOCI VAAH VOPB', 'A20N:4 A21N:2 A320:1 AT76:1.5', 380, 0.85),
  A('AXB', 'IX', 'Air India Express', 'IN', 'VT-LLL', 'VOCI VOBL VIDP VOTV VOML', 'B38M:2 B738:1', 90, 0.5),
  A('AKJ', 'QP', 'Akasa Air', 'IN', 'VT-LLL', 'VABB VOBL VIDP', 'B38M:1', 35, 0.95),
  A('SEJ', 'SG', 'SpiceJet', 'IN', 'VT-LLL', 'VIDP VABB', 'B738:1 B38M:0.5 DH8D:1', 50, 0.9),
  A('PIA', 'PK', 'Pakistan International', 'PK', 'AP-LLL', 'OPKC OPLA OPIS', 'A320:1 B77W:0.3 B772:0.2 AT76:0.3', 30, 0.5),
  A('ALK', 'UL', 'SriLankan Airlines', 'LK', '4R-LLL', 'VCBI', 'A320:1 A321:0.5 A333:0.4', 25, 0),
  A('BBC', 'BG', 'Biman Bangladesh', 'BD', 'S2-LLL', 'VGHS', 'B738:1 B788:0.3 B789:0.3 DH8D:0.3', 20, 0.3),
  // East & South-East Asia
  A('CCA', 'CA', 'Air China', 'CN', 'B-####', 'ZBAA ZUUU ZBAD', 'A320:1 A20N:1 A321:1 B738:1 B38M:0.5 A333:0.3 B77W:0.3 B789:0.2 A359:0.2 B748:0.1', 450, 0.85),
  A('CES', 'MU', 'China Eastern', 'CN', 'B-####', 'ZSPD ZSSS ZSHC ZPPP', 'A320:2 A20N:1 A321:1 B738:1.5 A333:0.3 B77W:0.2 A359:0.2', 650, 0.9),
  A('CSN', 'CZ', 'China Southern', 'CN', 'B-####', 'ZGGG ZGSZ ZBAD ZUUU ZWWW', 'A320:1.5 A20N:1.5 A321:1 B738:2 B38M:0.5 A333:0.3 B789:0.3 B77W:0.2', 700, 0.9),
  A('CHH', 'HU', 'Hainan Airlines', 'CN', 'B-####', 'ZJHK ZBAA', 'B738:2 B789:0.5 B788:0.3 A333:0.3', 280, 0.85),
  A('CSZ', 'ZH', 'Shenzhen Airlines', 'CN', 'B-####', 'ZGSZ', 'A320:1 B738:1', 220, 0.95),
  A('CXA', 'MF', 'Xiamen Airlines', 'CN', 'B-####', 'ZSAM ZSFZ', 'B738:2 B38M:1 B789:0.3', 200, 0.9),
  A('CSC', '3U', 'Sichuan Airlines', 'CN', 'B-####', 'ZUUU', 'A320:2 A321:1 A333:0.2', 180, 0.95),
  A('CPA', 'CX', 'Cathay Pacific', 'CN', 'B-HLL', 'VHHH', 'A333:1 A359:1 A35K:0.5 B77W:1 A321:0.5 A21N:0.5', 200, 0),
  A('JAL', 'JL', 'Japan Airlines', 'JP', 'JA###L', 'RJTT RJAA RJBB RJFF', 'B738:2 B789:0.6 B788:0.4 A359:0.5 B77W:0.3 E190:0.5', 230, 0.7),
  A('ANA', 'NH', 'All Nippon Airways', 'JP', 'JA###L', 'RJTT RJAA RJBB RJGG', 'B738:1 A320:0.5 A21N:0.5 B789:1 B788:0.7 B78X:0.3 B77W:0.4 B772:0.3', 280, 0.7),
  A('KAL', 'KE', 'Korean Air', 'KR', 'HL####', 'RKSI RKSS RKPC', 'B738:1 B39M:0.5 A21N:0.5 A333:0.5 B77W:0.5 B789:0.3 A388:0.1 B748:0.1', 180, 0.2),
  A('AAR', 'OZ', 'Asiana Airlines', 'KR', 'HL####', 'RKSI RKSS', 'A321:1 A333:0.5 A359:0.5', 80, 0.2),
  A('JJA', '7C', 'Jeju Air', 'KR', 'HL####', 'RKPC RKSS RKSI', 'B738:2', 45, 0.5),
  A('SIA', 'SQ', 'Singapore Airlines', 'SG', '9V-LLL', 'WSSS', 'A359:2 B78X:1 B77W:0.5 A388:0.3 B38M:0.5', 140, 0),
  A('TGW', 'TR', 'Scoot', 'SG', '9V-LLL', 'WSSS', 'A20N:1 A21N:1 A320:0.5 B789:0.5 B788:0.3 E190:0.3', 75, 0),
  A('MAS', 'MH', 'Malaysia Airlines', 'MY', '9M-LLL', 'WMKK', 'B738:2 B38M:0.5 A333:0.5 A359:0.3', 90, 0.3),
  A('AXM', 'AK', 'AirAsia', 'MY', '9M-LLL', 'WMKK WSSS VTBD RPLL WIII', 'A320:2 A20N:2 A21N:0.5', 240, 0.4),
  A('THA', 'TG', 'Thai Airways', 'TH', 'HS-LLL', 'VTBS', 'A20N:0.5 A321:0.5 B788:0.4 B789:0.4 A359:0.6 B77W:0.5 A333:0.3', 80, 0.2),
  A('GIA', 'GA', 'Garuda Indonesia', 'ID', 'PK-LLL', 'WIII WADD', 'B738:2 A333:0.4 B77W:0.2', 75, 0.6),
  A('LNI', 'JT', 'Lion Air', 'ID', 'PK-LLL', 'WIII WARR WAAA', 'B739:2 B738:1 A333:0.2', 110, 0.9),
  A('PAL', 'PR', 'Philippine Airlines', 'PH', 'RP-C####', 'RPLL', 'A321:1 A21N:0.5 A333:0.3 A359:0.3 B77W:0.2 DH8D:0.5', 70, 0.5),
  A('CEB', '5J', 'Cebu Pacific', 'PH', 'RP-C####', 'RPLL RPVM', 'A320:1 A21N:1 A20N:1 AT76:1', 90, 0.7),
  A('VJC', 'VJ', 'VietJet Air', 'VN', 'VN-A###', 'VVTS VVNB VVDN', 'A321:2 A21N:1 A320:1', 110, 0.7),
  A('HVN', 'VN', 'Vietnam Airlines', 'VN', 'VN-A###', 'VVNB VVTS', 'A321:2 A21N:1 B789:0.4 A359:0.4', 100, 0.7),
  A('EVA', 'BR', 'EVA Air', 'TW', 'B-#####', 'RCTP', 'A321:1 B78X:0.6 B789:0.3 B77W:0.6 A333:0.3', 85, 0),
  A('CAL', 'CI', 'China Airlines', 'TW', 'B-#####', 'RCTP', 'A21N:1 A359:0.6 B77W:0.3 A333:0.3 B77L:0.3', 80, 0),
  // Oceania
  A('QFA', 'QF', 'Qantas', 'AU', 'VH-LLL', 'YSSY YMML YBBN YPPH', 'B738:2 A332:0.4 A333:0.3 B789:0.4 A388:0.2', 200, 0.7),
  A('VOZ', 'VA', 'Virgin Australia', 'AU', 'VH-LLL', 'YBBN YSSY YMML', 'B738:2 B38M:0.5', 90, 0.9),
  A('JST', 'JQ', 'Jetstar', 'AU', 'VH-LLL', 'YMML YSSY YBBN', 'A320:1 A21N:1 A321:0.5 B788:0.2', 90, 0.8),
  A('ANZ', 'NZ', 'Air New Zealand', 'NZ', 'ZK-LLL', 'NZAA NZCH NZWN', 'A20N:1 A21N:0.5 AT76:1 B789:0.5 B77W:0.2', 110, 0.6),
];

/** General aviation & helicopters (local flights, callsign = registration). */
export const GA_TYPES: [string, number][] = [
  ['C172', 4],
  ['PA28', 2.5],
  ['SR22', 2],
  ['PC12', 1],
  ['EC35', 1],
  ['EC45', 1],
  ['AS50', 1],
];

/** Country registration patterns and GA traffic share for general aviation. */
export const GA_COUNTRIES: { iso: string; reg: string; share: number; squawk: string }[] = [
  { iso: 'US', reg: 'N###LL', share: 45, squawk: '1200' },
  { iso: 'GB', reg: 'G-LLLL', share: 6, squawk: '7000' },
  { iso: 'DE', reg: 'D-ELLL', share: 6, squawk: '7000' },
  { iso: 'FR', reg: 'F-LLLL', share: 6, squawk: '7000' },
  { iso: 'CA', reg: 'C-LLLL', share: 6, squawk: '1200' },
  { iso: 'AU', reg: 'VH-LLL', share: 5, squawk: '1200' },
  { iso: 'BR', reg: 'PR-LLL', share: 4, squawk: '7000' },
  { iso: 'IT', reg: 'I-LLLL', share: 3, squawk: '7000' },
  { iso: 'ES', reg: 'EC-LLL', share: 3, squawk: '7000' },
  { iso: 'CH', reg: 'HB-LLL', share: 2, squawk: '7000' },
  { iso: 'ZA', reg: 'ZS-LLL', share: 2, squawk: '7000' },
  { iso: 'IN', reg: 'VT-LLL', share: 2, squawk: '7000' },
  { iso: 'NZ', reg: 'ZK-LLL', share: 2, squawk: '1200' },
  { iso: 'SE', reg: 'SE-LLL', share: 2, squawk: '7000' },
  { iso: 'MX', reg: 'XA-LLL', share: 2, squawk: '1200' },
];
