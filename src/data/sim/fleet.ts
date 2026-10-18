// Reference data for the simulation: real airlines, their real hubs and representative
// fleets, and real aircraft-type performance figures. Used only by the simulation,
// which is always labelled as simulated. Flights, registrations, addresses and
// schedules generated from this data are invented.

export type TypeClass = 'wide' | 'narrow' | 'regional' | 'turboprop' | 'bizjet' | 'light' | 'heli' | 'fighter' | 'glider';

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
    T('A318', 'AIRBUS A-318', 'A3', 440, 37000, 3100, 'narrow'),
    T('BCS1', 'AIRBUS A220-100', 'A3', 445, 37000, 3400, 'narrow'),
    T('B37M', 'BOEING 737 MAX 7', 'A3', 450, 37000, 3800, 'narrow'),
    T('B712', 'BOEING 717-200', 'A3', 430, 35000, 1400, 'narrow'),
    T('B753', 'BOEING 757-300', 'A4', 460, 37000, 3300, 'narrow'),
    T('B762', 'BOEING 767-200', 'A5', 455, 37000, 5000, 'wide'),
    T('B764', 'BOEING 767-400ER', 'A5', 460, 37000, 5600, 'wide'),
    T('A306', 'AIRBUS A-300F4-600', 'A5', 450, 33000, 2600, 'wide'),
    T('A343', 'AIRBUS A-340-300', 'A5', 470, 37000, 7000, 'wide'),
    T('MD11', 'BOEING (MCDONNELL DOUGLAS) MD-11F', 'A5', 475, 33000, 3500, 'wide'),
    T('E170', 'EMBRAER ERJ-170', 'A3', 430, 35000, 2000, 'regional'),
    T('E145', 'EMBRAER ERJ-145', 'A2', 420, 33000, 1500, 'regional'),
    T('CRJ2', 'BOMBARDIER CRJ-200', 'A2', 420, 35000, 1300, 'regional'),
    T('AT45', 'ATR 42-500', 'A2', 260, 21000, 700, 'turboprop'),
    T('SF34', 'SAAB 340', 'A2', 250, 20000, 800, 'turboprop'),
    T('C208', 'CESSNA 208 CARAVAN', 'A1', 160, 10000, 900, 'turboprop'),
    T('B190', 'BEECH 1900D', 'A2', 270, 22000, 700, 'turboprop'),
    T('GLEX', 'BOMBARDIER GLOBAL 6000', 'A2', 488, 45000, 6000, 'bizjet'),
    T('E55P', 'EMBRAER PHENOM 300', 'A2', 430, 41000, 1900, 'bizjet'),
    T('PC24', 'PILATUS PC-24', 'A2', 420, 41000, 1900, 'bizjet'),
    T('F2TH', 'DASSAULT FALCON 2000', 'A2', 460, 41000, 3300, 'bizjet'),
    T('C172', 'CESSNA 172 SKYHAWK', 'A1', 115, 4500, 500, 'light'),
    T('PA28', 'PIPER PA-28 CHEROKEE', 'A1', 115, 4500, 500, 'light'),
    T('SR22', 'CIRRUS SR22', 'A1', 170, 8500, 900, 'light'),
    T('EC35', 'AIRBUS HELICOPTERS H135', 'A7', 125, 1500, 300, 'heli'),
    T('EC45', 'AIRBUS HELICOPTERS H145', 'A7', 130, 1500, 350, 'heli'),
    T('AS50', 'AIRBUS HELICOPTERS H125', 'A7', 120, 1200, 300, 'heli'),
    // Military (simulated missions from real bases)
    T('C17', 'BOEING C-17A GLOBEMASTER III', 'A5', 450, 32000, 2400, 'wide'),
    T('K35R', 'BOEING KC-135R STRATOTANKER', 'A5', 460, 31000, 1500, 'wide'),
    T('C30J', 'LOCKHEED MARTIN C-130J HERCULES', 'A4', 320, 26000, 1800, 'turboprop'),
    T('A400', 'AIRBUS A400M ATLAS', 'A5', 400, 31000, 1800, 'turboprop'),
    T('E3TF', 'BOEING E-3 SENTRY (AWACS)', 'A5', 400, 30000, 4000, 'wide'),
    T('P8', 'BOEING P-8 POSEIDON', 'A4', 440, 25000, 1200, 'narrow'),
    T('EUFI', 'EUROFIGHTER TYPHOON', 'A6', 480, 25000, 1000, 'fighter'),
    T('F16', 'LOCKHEED MARTIN F-16 FIGHTING FALCON', 'A6', 480, 25000, 900, 'fighter'),
    T('F35', 'LOCKHEED MARTIN F-35 LIGHTNING II', 'A6', 470, 27000, 1200, 'fighter'),
    T('RFAL', 'DASSAULT RAFALE', 'A6', 480, 25000, 1000, 'fighter'),
    T('HAWK', 'BAE SYSTEMS HAWK', 'A6', 400, 20000, 600, 'fighter'),
    T('H60', 'SIKORSKY UH-60 BLACK HAWK', 'A7', 140, 2000, 300, 'heli'),
    // Air ambulance, offshore and city helicopters
    T('A109', 'LEONARDO AW109', 'A7', 150, 1500, 400, 'heli'),
    T('A169', 'LEONARDO AW169', 'A7', 140, 1500, 400, 'heli'),
    T('A139', 'LEONARDO AW139', 'A7', 150, 3000, 500, 'heli'),
    T('S92', 'SIKORSKY S-92', 'A7', 145, 3000, 500, 'heli'),
    T('EC75', 'AIRBUS HELICOPTERS H175', 'A7', 150, 3000, 600, 'heli'),
    T('S76', 'SIKORSKY S-76', 'A7', 145, 2000, 400, 'heli'),
    T('EC30', 'AIRBUS HELICOPTERS H130', 'A7', 125, 1200, 330, 'heli'),
    T('B350', 'BEECHCRAFT KING AIR 350', 'A2', 300, 27000, 1500, 'turboprop'),
    T('LJ45', 'LEARJET 45', 'A2', 440, 43000, 1700, 'bizjet'),
    // Gliders (FLARM), tugs and light aircraft
    T('AS21', 'SCHLEICHER ASK 21', 'B1', 55, 4000, 150, 'glider'),
    T('DUOD', 'SCHEMPP-HIRTH DUO DISCUS', 'B1', 60, 5000, 400, 'glider'),
    T('DISC', 'SCHEMPP-HIRTH DISCUS', 'B1', 60, 5000, 400, 'glider'),
    T('LS8', 'DG FLUGZEUGBAU LS8', 'B1', 60, 5000, 400, 'glider'),
    T('GLID', 'GLIDER', 'B1', 55, 4000, 300, 'glider'),
    T('DR40', 'ROBIN DR400', 'A1', 110, 3000, 450, 'light'),
    T('PA25', 'PIPER PA-25 PAWNEE', 'A1', 90, 2500, 250, 'light'),
    T('DA40', 'DIAMOND DA40', 'A1', 125, 5500, 600, 'light'),
    T('C152', 'CESSNA 152', 'A1', 95, 3500, 350, 'light'),
    T('C182', 'CESSNA 182 SKYLANE', 'A1', 140, 7500, 800, 'light'),
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

export const airline = (
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
  airline('AAL', 'AA', 'American Airlines', 'US', 'N###LL', 'KDFW KCLT KORD KMIA KPHL KPHX KLAX KJFK KDCA', 'A321:3 B38M:2 B738:3 A319:1 B772:0.5 B77W:0.5 B789:0.6 B788:0.4', 900, 0.85),
  airline('DAL', 'DL', 'Delta Air Lines', 'US', 'N###LL', 'KATL KDTW KMSP KSLC KJFK KLAX KSEA KBOS', 'A321:2 A320:1 B739:2 B752:1 BCS3:0.6 A333:0.5 A339:0.5 A359:0.5', 900, 0.85),
  airline('UAL', 'UA', 'United Airlines', 'US', 'N###LL', 'KORD KDEN KIAH KEWR KSFO KIAD KLAX', 'B739:2 B738:1.5 B38M:1 A320:1 A319:1 B772:0.6 B77W:0.3 B789:0.5 B78X:0.3 B763:0.3', 850, 0.8),
  airline('SWA', 'WN', 'Southwest Airlines', 'US', 'N###LL', 'KDAL KMDW KBWI KDEN KLAS KPHX KHOU KMCO KOAK', 'B737:3 B38M:2 B738:2', 750, 0.97),
  airline('ASA', 'AS', 'Alaska Airlines', 'US', 'N###LL', 'KSEA KPDX KSFO KLAX PANC', 'B739:2 B38M:1 B738:1', 230, 0.93),
  airline('JBU', 'B6', 'JetBlue', 'US', 'N###LL', 'KJFK KBOS KFLL KMCO', 'A320:2 A321:2 BCS3:1', 270, 0.8),
  airline('SKW', 'OO', 'SkyWest Airlines', 'US', 'N###LL', 'KDEN KORD KSLC KDTW KSFO KMSP', 'E75L:3 CRJ9:1 CRJ7:1', 450, 1),
  airline('RPA', 'YX', 'Republic Airways', 'US', 'N###LL', 'KORD KEWR KIAD KIND', 'E75L:1', 230, 1),
  airline('ENY', 'MQ', 'Envoy Air', 'US', 'N###LL', 'KDFW KORD KMIA', 'E75L:1', 180, 1),
  airline('NKS', 'NK', 'Spirit Airlines', 'US', 'N###LL', 'KFLL KDTW KLAS KMCO', 'A20N:1 A321:0.5 A320:1', 200, 0.9),
  airline('FFT', 'F9', 'Frontier Airlines', 'US', 'N###LL', 'KDEN KLAS KMCO', 'A20N:1 A21N:1', 160, 0.95),
  airline('FDX', 'FX', 'FedEx', 'US', 'N###LL', 'KMEM KIND KOAK KEWR', 'B763:1 B77L:1 B752:1', 300, 0.7),
  airline('UPS', '5X', 'UPS Airlines', 'US', 'N###LL', 'KSDF KONT KPHL', 'B763:1 B752:1 B748:0.3', 260, 0.7),
  airline('GTI', '5Y', 'Atlas Air', 'US', 'N###LL', 'KCVG KMIA KJFK', 'B744:1 B748:0.5 B763:0.5', 80, 0.3),
  airline('EJA', '1I', 'NetJets', 'US', 'N###LL', 'KTEB KPBI KVNY KHPN', 'C68A:2 CL35:1 GLF6:0.5', 300, 0.95),
  airline('ACA', 'AC', 'Air Canada', 'CA', 'C-LLLL', 'CYYZ CYVR CYUL CYYC', 'A320:1 A321:1 B38M:1 BCS3:0.5 B789:0.6 B77W:0.4 A333:0.3', 300, 0.5),
  airline('WJA', 'WS', 'WestJet', 'CA', 'C-LLLL', 'CYYC CYYZ CYVR', 'B38M:1 B737:1 B738:1 B789:0.2', 180, 0.8),
  airline('JZA', 'QK', 'Jazz Aviation', 'CA', 'C-LLLL', 'CYYZ CYUL CYVR', 'DH8D:1 CRJ9:1', 120, 0.9),
  airline('AMX', 'AM', 'Aeroméxico', 'MX', 'XA-LLL', 'MMMX MMMY MMGL', 'B38M:2 B738:1 B789:0.4 E190:1', 130, 0.6),
  airline('VOI', 'Y4', 'Volaris', 'MX', 'XA-LLL', 'MMMX MMGL MMTJ', 'A20N:2 A21N:1 A320:1', 130, 0.75),
  // South America
  airline('LAN', 'LA', 'LATAM Airlines', 'CL', 'CC-LLL', 'SCEL SBGR SPIM SKBO', 'A320:2 A321:1 B789:0.4 B763:0.3', 300, 0.55),
  airline('GLO', 'G3', 'Gol Linhas Aéreas', 'BR', 'PR-LLL', 'SBGR SBSP SBBR SBGL', 'B738:2 B38M:1', 140, 0.9),
  airline('AZU', 'AD', 'Azul Linhas Aéreas', 'BR', 'PR-LLL', 'SBKP SBCF SBRF', 'E195:2 A20N:1 AT76:1', 170, 0.9),
  airline('AVA', 'AV', 'Avianca', 'CO', 'N###LL', 'SKBO SKRG', 'A320:2 A20N:1 B788:0.3', 120, 0.5),
  airline('ARG', 'AR', 'Aerolíneas Argentinas', 'AR', 'LV-LLL', 'SAEZ SABE', 'B738:2 E190:0.5 A332:0.2', 80, 0.7),
  // Europe
  airline('BAW', 'BA', 'British Airways', 'GB', 'G-LLLL', 'EGLL EGKK', 'A320:2 A319:1 A321:1 A20N:1 A21N:0.5 E190:0.3 B772:0.6 B77W:0.5 B789:0.4 B78X:0.2 A388:0.2 A35K:0.3', 300, 0.1),
  airline('EZY', 'U2', 'easyJet', 'GB', 'G-LLLL', 'EGKK EGGW EGSS EGCC LFPG LSGG EHAM LEMD EDDB', 'A320:2 A20N:2 A319:1 A21N:1', 330, 0.2, true),
  airline('RYR', 'FR', 'Ryanair', 'IE', 'EI-LLL', 'EIDW LEMD LEBL EGSS LIME LIRF LEPA LPPT EPKK LGAV EBCI', 'B738:3 B38M:1.2', 600, 0.1, true),
  airline('DLH', 'LH', 'Lufthansa', 'DE', 'D-ALLL', 'EDDF EDDM', 'A320:1 A20N:1 A321:1 A319:0.5 A333:0.3 A359:0.4 B748:0.3 A388:0.1 B789:0.2', 330, 0.25),
  airline('AFR', 'AF', 'Air France', 'FR', 'F-LLLL', 'LFPG LFPO', 'A320:1 A321:0.5 BCS3:1 A359:0.5 B77W:0.6 B772:0.3 B789:0.3 A332:0.2', 220, 0.2),
  airline('KLM', 'KL', 'KLM', 'NL', 'PH-LLL', 'EHAM', 'B738:2 B739:0.5 E190:1 E295:0.5 B77W:0.4 B789:0.4 A332:0.2', 180, 0),
  airline('IBE', 'IB', 'Iberia', 'ES', 'EC-LLL', 'LEMD', 'A320:1 A20N:1 A321:0.5 A359:0.4 A332:0.3', 120, 0.3),
  airline('VLG', 'VY', 'Vueling', 'ES', 'EC-LLL', 'LEBL LEMD', 'A320:2 A20N:1', 120, 0.4),
  airline('ITY', 'AZ', 'ITA Airways', 'IT', 'I-LLLL', 'LIRF LIML', 'A20N:1 A320:1 A359:0.2 A339:0.2', 90, 0.4),
  airline('SWR', 'LX', 'Swiss', 'CH', 'HB-LLL', 'LSZH LSGG', 'A20N:1 A320:1 BCS3:1 B77W:0.2 A333:0.2', 100, 0),
  airline('AUA', 'OS', 'Austrian Airlines', 'AT', 'OE-LLL', 'LOWW', 'A320:1 E195:1 B763:0.2 B772:0.1', 70, 0),
  airline('SAS', 'SK', 'SAS Scandinavian Airlines', 'SE', 'SE-LLL', 'EKCH ESSA ENGM', 'A20N:2 A320:1 CRJ9:1 A359:0.2 A333:0.1', 150, 0.4),
  airline('FIN', 'AY', 'Finnair', 'FI', 'OH-LLL', 'EFHK', 'A320:1 A321:1 A359:0.4 E190:0.5 AT76:0.5', 80, 0.2),
  airline('NAX', 'DY', 'Norwegian', 'NO', 'LN-LLL', 'ENGM EKCH ESSA EFHK', 'B738:2 B38M:1', 90, 0.4),
  airline('WZZ', 'W6', 'Wizz Air', 'HU', 'HA-LLL', 'EPWA LHBP LROP EGGW', 'A21N:2 A321:1 A20N:1', 210, 0.05),
  airline('THY', 'TK', 'Turkish Airlines', 'TR', 'TC-LLL', 'LTFM LTFJ', 'A321:1 A21N:1 B738:1 B38M:1 A333:0.4 B77W:0.4 B789:0.4 A359:0.3', 400, 0.3),
  airline('PGT', 'PC', 'Pegasus Airlines', 'TR', 'TC-LLL', 'LTFJ LTAI', 'A20N:2 A21N:1 B738:1', 110, 0.5),
  airline('TAP', 'TP', 'TAP Air Portugal', 'PT', 'CS-LLL', 'LPPT LPPR', 'A20N:1 A321:1 A339:0.4 E195:0.3', 100, 0.1),
  airline('AEE', 'A3', 'Aegean Airlines', 'GR', 'SX-LLL', 'LGAV', 'A20N:1 A320:1 A321:0.5', 60, 0.4),
  airline('LOT', 'LO', 'LOT Polish Airlines', 'PL', 'SP-LLL', 'EPWA', 'B38M:1 E195:1 B788:0.3 B789:0.2', 75, 0.1),
  airline('EIN', 'EI', 'Aer Lingus', 'IE', 'EI-LLL', 'EIDW', 'A320:2 A21N:0.5 A333:0.3', 60, 0),
  airline('BEL', 'SN', 'Brussels Airlines', 'BE', 'OO-LLL', 'EBBR', 'A320:1 A319:0.5 A333:0.2', 45, 0),
  airline('EWG', 'EW', 'Eurowings', 'DE', 'D-ALLL', 'EDDL EDDK EDDH EDDS', 'A320:1 A319:1 A20N:0.5', 110, 0.3),
  airline('TOM', 'BY', 'TUI Airways', 'GB', 'G-LLLL', 'EGCC EGKK EGBB', 'B38M:1 B738:1 B789:0.3', 70, 0, true),
  airline('EXS', 'LS', 'Jet2.com', 'GB', 'G-LLLL', 'EGCC EGBB EGNM EGPH', 'A321:1 B738:1 A21N:0.5', 120, 0, true),
  airline('CLX', 'CV', 'Cargolux', 'LU', 'LX-LLL', 'ELLX', 'B748:1 B744:0.3', 25, 0),
  airline('NJE', 'NJ', 'NetJets Europe', 'PT', 'CS-LLL', 'LFPB EGGW LSGG', 'C68A:1 CL35:1', 80, 0.2),
  airline('AFL', 'SU', 'Aeroflot', 'RU', 'RA-#####', 'UUEE', 'A320:1 A321:1 B738:1 SU95:1 B77W:0.2 A333:0.2', 220, 0.7),
  // Middle East & Africa
  airline('UAE', 'EK', 'Emirates', 'AE', 'A6-LLL', 'OMDB', 'B77W:4 A388:2.5', 260, 0),
  airline('FDB', 'FZ', 'flydubai', 'AE', 'A6-LLL', 'OMDB', 'B38M:2 B738:1 B39M:0.5', 85, 0),
  airline('ETD', 'EY', 'Etihad Airways', 'AE', 'A6-LLL', 'OMAA', 'B789:1 B78X:0.5 B77W:0.5 A320:0.5 A321:0.5 A35K:0.2', 100, 0),
  airline('QTR', 'QR', 'Qatar Airways', 'QA', 'A7-LLL', 'OTHH', 'B77W:1 B788:0.5 B789:0.5 A359:1 A35K:0.5 A388:0.3 A320:0.5 B38M:0.5 B77L:0.4', 250, 0),
  airline('SVA', 'SV', 'Saudia', 'SA', 'HZ-LLL', 'OEJN OERK OEMA OEDF', 'A320:1 A20N:1 A21N:0.5 B77W:0.5 B789:0.4 B78X:0.2', 150, 0.5),
  airline('KNE', 'XY', 'flynas', 'SA', 'HZ-NSL', 'OERK OEJN OEDF', 'A20N:3 A320:1 A21N:0.5', 70, 0.6),
  airline('FAD', 'F3', 'flyadeal', 'SA', 'HZ-FAL', 'OERK OEJN', 'A20N:2 A320:1', 38, 0.8),
  airline('GFA', 'GF', 'Gulf Air', 'BH', 'A9C-LL', 'OBBI', 'A20N:1 A21N:0.5 B789:0.3', 30, 0),
  airline('OMA', 'WY', 'Oman Air', 'OM', 'A4O-LL', 'OOMS', 'B738:1 B38M:1 B789:0.5 A332:0.2', 40, 0.1),
  airline('RJA', 'RJ', 'Royal Jordanian', 'JO', 'JY-LLL', 'OJAI', 'A320:1 A321:0.5 B788:0.3 E195:0.3', 25, 0),
  airline('ELY', 'LY', 'El Al', 'IL', '4X-LLL', 'LLBG', 'B738:1 B739:1 B789:0.5 B788:0.3', 45, 0),
  airline('MSR', 'MS', 'EgyptAir', 'EG', 'SU-LLL', 'HECA', 'A20N:1 B738:1 A21N:0.5 B77W:0.2 B789:0.2 A333:0.2', 70, 0.2),
  airline('ETH', 'ET', 'Ethiopian Airlines', 'ET', 'ET-LLL', 'HAAB', 'B38M:1 B738:0.5 B788:0.4 B789:0.3 A359:0.4 B77W:0.3 DH8D:0.8 B77L:0.2', 140, 0.2),
  airline('KQA', 'KQ', 'Kenya Airways', 'KE', '5Y-LLL', 'HKJK', 'E190:1 B738:1 B788:0.5', 35, 0.2),
  airline('SAA', 'SA', 'South African Airways', 'ZA', 'ZS-LLL', 'FAOR FACT', 'A320:1 A20N:0.5 A333:0.3', 35, 0.4),
  airline('RAM', 'AT', 'Royal Air Maroc', 'MA', 'CN-LLL', 'GMMN', 'B738:2 B38M:0.5 B788:0.3 B789:0.3 AT76:0.5', 60, 0.2),
  // South Asia
  // Indian carriers fly a large share internationally (Gulf, South-East Asia, Europe, North America).
  airline('AIC', 'AI', 'Air India', 'IN', 'VT-LLL', 'VIDP VABB VOBL', 'A20N:2 A21N:1.5 A320:0.6 A319:0.3 B788:0.8 B789:0.4 B77W:0.5 B77L:0.2 A359:0.4 A35K:0.1', 190, 0.5),
  // IndiGo: A321neo (incl. XLR) on medium-haul international and wet-leased 787-9s to Europe.
  airline('IGO', '6E', 'IndiGo', 'IN', 'VT-LLL', 'VIDP VABB VOBL VOMM VOHS VECC VOCI VAAH VOPB', 'A20N:4 A21N:2.5 A320:0.5 AT76:1.5 B789:0.15', 400, 0.75),
  airline('AXB', 'IX', 'Air India Express', 'IN', 'VT-LLL', 'VOCI VOBL VIDP VOTV VOML VOCL VABB', 'B38M:2 B738:1 A320:0.4 A20N:0.3', 100, 0.5),
  airline('AKJ', 'QP', 'Akasa Air', 'IN', 'VT-LLL', 'VABB VOBL VIDP VAAH', 'B38M:1', 35, 0.8),
  airline('SEJ', 'SG', 'SpiceJet', 'IN', 'VT-LLL', 'VIDP VABB VAAH', 'B738:1 B38M:0.5 DH8D:0.8', 30, 0.75),
  airline('PIA', 'PK', 'Pakistan International', 'PK', 'AP-LLL', 'OPKC OPLA OPIS', 'A320:1 B77W:0.3 B772:0.2 AT76:0.3', 30, 0.5),
  airline('ALK', 'UL', 'SriLankan Airlines', 'LK', '4R-LLL', 'VCBI', 'A320:1 A321:0.5 A333:0.4', 25, 0),
  airline('BBC', 'BG', 'Biman Bangladesh', 'BD', 'S2-LLL', 'VGHS', 'B738:1 B788:0.3 B789:0.3 DH8D:0.3', 20, 0.3),
  // East & South-East Asia
  airline('CCA', 'CA', 'Air China', 'CN', 'B-####', 'ZBAA ZUTF ZBAD', 'A320:1 A20N:1 A321:1 B738:1 B38M:0.5 A333:0.3 B77W:0.3 B789:0.2 A359:0.2 B748:0.1', 450, 0.85),
  airline('CES', 'MU', 'China Eastern', 'CN', 'B-####', 'ZSPD ZSSS ZSHC ZPPP', 'A320:2 A20N:1 A321:1 B738:1.5 A333:0.3 B77W:0.2 A359:0.2', 650, 0.9),
  airline('CSN', 'CZ', 'China Southern', 'CN', 'B-####', 'ZGGG ZGSZ ZBAD ZUTF ZWWW', 'A320:1.5 A20N:1.5 A321:1 B738:2 B38M:0.5 A333:0.3 B789:0.3 B77W:0.2', 700, 0.9),
  airline('CHH', 'HU', 'Hainan Airlines', 'CN', 'B-####', 'ZJHK ZBAA', 'B738:2 B789:0.5 B788:0.3 A333:0.3', 280, 0.85),
  airline('CSZ', 'ZH', 'Shenzhen Airlines', 'CN', 'B-####', 'ZGSZ', 'A320:1 B738:1', 220, 0.95),
  airline('CXA', 'MF', 'Xiamen Airlines', 'CN', 'B-####', 'ZSAM ZSFZ', 'B738:2 B38M:1 B789:0.3', 200, 0.9),
  airline('CSC', '3U', 'Sichuan Airlines', 'CN', 'B-####', 'ZUUU ZUTF', 'A320:2 A321:1 A333:0.2', 180, 0.95),
  airline('CPA', 'CX', 'Cathay Pacific', 'CN', 'B-HLL', 'VHHH', 'A333:1 A359:1 A35K:0.5 B77W:1 A321:0.5 A21N:0.5', 200, 0),
  airline('JAL', 'JL', 'Japan Airlines', 'JP', 'JA###L', 'RJTT RJAA RJBB RJFF', 'B738:2 B789:0.6 B788:0.4 A359:0.5 B77W:0.3 E190:0.5', 230, 0.7),
  airline('ANA', 'NH', 'All Nippon Airways', 'JP', 'JA###L', 'RJTT RJAA RJBB RJGG', 'B738:1 A320:0.5 A21N:0.5 B789:1 B788:0.7 B78X:0.3 B77W:0.4 B772:0.3', 280, 0.7),
  airline('KAL', 'KE', 'Korean Air', 'KR', 'HL####', 'RKSI RKSS RKPC', 'B738:1 B39M:0.5 A21N:0.5 A333:0.5 B77W:0.5 B789:0.3 A388:0.1 B748:0.1', 180, 0.2),
  airline('AAR', 'OZ', 'Asiana Airlines', 'KR', 'HL####', 'RKSI RKSS', 'A321:1 A333:0.5 A359:0.5', 80, 0.2),
  airline('JJA', '7C', 'Jeju Air', 'KR', 'HL####', 'RKPC RKSS RKSI', 'B738:2', 45, 0.5),
  airline('SIA', 'SQ', 'Singapore Airlines', 'SG', '9V-LLL', 'WSSS', 'A359:2 B78X:1 B77W:0.5 A388:0.3 B38M:0.5', 140, 0),
  airline('TGW', 'TR', 'Scoot', 'SG', '9V-LLL', 'WSSS', 'A20N:1 A21N:1 A320:0.5 B789:0.5 B788:0.3 E190:0.3', 75, 0),
  airline('MAS', 'MH', 'Malaysia Airlines', 'MY', '9M-LLL', 'WMKK', 'B738:2 B38M:0.5 A333:0.5 A359:0.3', 90, 0.3),
  airline('AXM', 'AK', 'AirAsia', 'MY', '9M-LLL', 'WMKK WSSS VTBD RPLL WIII', 'A320:2 A20N:2 A21N:0.5', 240, 0.4),
  airline('THA', 'TG', 'Thai Airways', 'TH', 'HS-LLL', 'VTBS', 'A20N:0.5 A321:0.5 B788:0.4 B789:0.4 A359:0.6 B77W:0.5 A333:0.3', 80, 0.2),
  airline('GIA', 'GA', 'Garuda Indonesia', 'ID', 'PK-LLL', 'WIII WADD', 'B738:2 A333:0.4 B77W:0.2', 75, 0.6),
  airline('LNI', 'JT', 'Lion Air', 'ID', 'PK-LLL', 'WIII WARR WAAA', 'B739:2 B738:1 A333:0.2', 110, 0.9),
  airline('PAL', 'PR', 'Philippine Airlines', 'PH', 'RP-C####', 'RPLL', 'A321:1 A21N:0.5 A333:0.3 A359:0.3 B77W:0.2 DH8D:0.5', 70, 0.5),
  airline('CEB', '5J', 'Cebu Pacific', 'PH', 'RP-C####', 'RPLL RPVM', 'A320:1 A21N:1 A20N:1 AT76:1', 90, 0.7),
  airline('VJC', 'VJ', 'VietJet Air', 'VN', 'VN-A###', 'VVTS VVNB VVDN', 'A321:2 A21N:1 A320:1', 110, 0.7),
  airline('HVN', 'VN', 'Vietnam Airlines', 'VN', 'VN-A###', 'VVNB VVTS', 'A321:2 A21N:1 B789:0.4 A359:0.4', 100, 0.7),
  airline('EVA', 'BR', 'EVA Air', 'TW', 'B-#####', 'RCTP', 'A321:1 B78X:0.6 B789:0.3 B77W:0.6 A333:0.3', 85, 0),
  airline('CAL', 'CI', 'China Airlines', 'TW', 'B-#####', 'RCTP', 'A21N:1 A359:0.6 B77W:0.3 A333:0.3 B77L:0.3', 80, 0),
  // Oceania
  airline('QFA', 'QF', 'Qantas', 'AU', 'VH-LLL', 'YSSY YMML YBBN YPPH', 'B738:2 A332:0.4 A333:0.3 B789:0.4 A388:0.2', 200, 0.7),
  airline('VOZ', 'VA', 'Virgin Australia', 'AU', 'VH-LLL', 'YBBN YSSY YMML', 'B738:2 B38M:0.5', 90, 0.9),
  airline('JST', 'JQ', 'Jetstar', 'AU', 'VH-LLL', 'YMML YSSY YBBN', 'A320:1 A21N:1 A321:0.5 B788:0.2', 90, 0.8),
  airline('ANZ', 'NZ', 'Air New Zealand', 'NZ', 'ZK-LLL', 'NZAA NZCH NZWN', 'A20N:1 A21N:0.5 AT76:1 B789:0.5 B77W:0.2', 110, 0.6),
];

/** General aviation & helicopters (local flights, callsign = registration). */
export const GA_TYPES: [string, number][] = [
  ['C172', 4],
  ['PA28', 2.5],
  ['C152', 1.2],
  ['C182', 1.2],
  ['DA40', 1],
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

/**
 * Global airline alliances (membership as publicly announced, late 2026), used only to
 * give simulated flights plausible codeshare numbers. Only airlines in the core list
 * are listed here; more members come from fleet-more.ts.
 */
export const ALLIANCES: { name: string; members: string[] }[] = [
  { name: 'Star Alliance', members: ['UAL', 'DLH', 'SWR', 'AUA', 'BEL', 'LOT', 'TAP', 'AEE', 'THY', 'ACA', 'AVA', 'AIC', 'ANA', 'AAR', 'SIA', 'THA', 'EVA', 'CCA', 'CSZ', 'MSR', 'ETH', 'SAA', 'ANZ'] },
  { name: 'oneworld', members: ['AAL', 'BAW', 'IBE', 'FIN', 'QFA', 'CPA', 'JAL', 'QTR', 'RJA', 'MAS', 'ASA', 'RAM', 'ALK'] },
  { name: 'SkyTeam', members: ['DAL', 'AFR', 'KLM', 'KAL', 'CES', 'CXA', 'SVA', 'KQA', 'AMX', 'CAL', 'GIA', 'HVN', 'ARG', 'SAS'] },
];
