// Additional reference data: more real airlines with their real hubs
// and representative fleets, filling coverage gaps in AIRLINES (fleet.ts).
// Used only by the simulation, which is labelled as simulated. Flights,
// registrations, addresses and schedules generated from this data are invented.
//
// Sizes are simulated airframes (~0.8–1.0x the real active fleet, late 2026).
// Fleet subtypes that have no entry in TYPES are mapped to the nearest one
// (CRJ-550/1000 -> CRJ7/CRJ9, ERJ-135/140 -> E145, Dash 8-100/200/300 -> DH8D,
// 737-500/600 -> B737, A330F -> A332, 777F -> B77L, 747-400F -> B744).

import { airline, type AirlineProfile } from './fleet';

export const MORE_AIRLINES: AirlineProfile[] = [
  // ------------------------------------------------------------------ United States
  airline('JIA', 'OH', 'PSA Airlines', 'US', 'N###LL', 'KCLT KDCA KPHL KDFW', 'CRJ9:2 CRJ7:1', 125, 1),
  airline('PDT', 'PT', 'Piedmont Airlines', 'US', 'N###LL', 'KCLT KPHL KDCA', 'E145:3 E75L:1', 55, 1),
  airline('EDV', '9E', 'Endeavor Air', 'US', 'N###LL', 'KMSP KDTW KATL KJFK KLGA', 'CRJ9:1', 115, 0.97),
  airline('QXE', 'QX', 'Horizon Air', 'US', 'N###LL', 'KSEA KPDX', 'E75L:1', 42, 0.95),
  airline('ASH', 'YV', 'Mesa Airlines', 'US', 'N###LL', 'KIAH KDEN KIAD', 'E75L:1', 50, 0.97),
  airline('AAY', 'G4', 'Allegiant Air', 'US', 'N###LL', 'KLAS KSFB KPIE KBLI KCVG KAUS KBNA', 'A320:2 A319:1 B38M:0.6', 115, 1),
  airline('SCX', 'SY', 'Sun Country Airlines', 'US', 'N###LL', 'KMSP', 'B738:1', 55, 0.9),
  airline('HAL', 'HA', 'Hawaiian Airlines', 'US', 'N###LL', 'PHNL PHOG', 'B712:1.2 A21N:0.6 A332:0.8 B789:0.2', 55, 0.75),
  airline('MXY', 'MX', 'Breeze Airways', 'US', 'N###LL', 'KCHS KTPA KPVD KORF KMCO', 'BCS3:4 E195:0.4', 45, 1),
  airline('VXP', 'XP', 'Avelo Airlines', 'US', 'N###LL', 'KHVN KMCO KILG KRDU', 'B738:1.4 B737:0.8 E295:1', 35, 0.95),
  airline('CKS', 'K4', 'Kalitta Air', 'US', 'N###LL', 'KYIP KCVG KLAX', 'B744:2 B77L:0.6 B763:0.7', 45, 0.3),
  airline('PAC', 'PO', 'Polar Air Cargo', 'US', 'N###LL', 'KCVG PANC KLAX', 'B77L:1 B744:0.3', 10, 0.2),
  airline('ABX', 'GB', 'ABX Air', 'US', 'N###LL', 'KILN KCVG', 'B763:1', 30, 0.9),
  airline('ATN', '8C', 'Air Transport International', 'US', 'N###LL', 'KILN KCVG KONT', 'B763:1 A321:0.3', 28, 0.9),
  airline('LXJ', '', 'Flexjet', 'US', 'N###LL', 'KTEB KPBI KVNY KHPN KCLE', 'E55P:2 CL35:1.5 GLF6:0.3', 260, 0.95),

  // ------------------------------------------------------------------ Canada
  airline('POE', 'PD', 'Porter Airlines', 'CA', 'C-LLLL', 'CYTZ CYYZ CYOW CYUL CYVR', 'E295:2 DH8D:1', 75, 0.75),
  airline('FLE', 'F8', 'Flair Airlines', 'CA', 'C-LLLL', 'CYEG CYYZ CYVR CYYC', 'B38M:1 B738:0.3', 20, 0.85),
  airline('TSC', 'TS', 'Air Transat', 'CA', 'C-LLLL', 'CYUL CYYZ', 'A21N:2 A333:0.6 A332:0.2', 36, 0.1),
  airline('ROU', 'RV', 'Air Canada Rouge', 'CA', 'C-LLLL', 'CYYZ CYUL CYVR', 'A321:2 A319:1 A320:0.4', 38, 0.2),
  airline('CJT', 'W8', 'Cargojet', 'CA', 'C-LLLL', 'CYHM CYYZ CYVR CYYC CYWG', 'B763:2 B752:0.6 B77L:0.2', 35, 0.85),

  // ------------------------------------------------------------------ Latin America & Caribbean
  airline('VIV', 'VB', 'Viva Aerobus', 'MX', 'XA-LLL', 'MMMY MMMX MMGL MMUN MMTJ', 'A20N:1.5 A21N:1.5 A320:1', 85, 0.85),
  airline('CMP', 'CM', 'Copa Airlines', 'PA', 'HP-####CMP', 'MPTO', 'B738:3 B38M:2 B39M:0.5 B737:0.3', 105, 0.01),
  airline('TAM', 'JJ', 'LATAM Airlines Brasil', 'BR', 'PR-LLL', 'SBGR SBSP SBBR SBFZ', 'A320:2 A321:1.5 A20N:1 A319:0.5 B77W:0.15 B763:0.15 B789:0.1', 150, 0.85),
  airline('LPE', 'LP', 'LATAM Airlines Perú', 'CL', 'CC-LLL', 'SPIM', 'A320:1.5 A321:0.5 A319:0.5 B788:0.2', 40, 0.6),
  airline('JAT', 'JA', 'JetSMART', 'CL', 'CC-LLL', 'SCEL SCFA SCIE', 'A20N:1 A320:0.5 A21N:0.8', 35, 0.7),
  airline('SKU', 'H2', 'Sky Airline', 'CL', 'CC-LLL', 'SCEL SPIM', 'A20N:1.5 A21N:1', 28, 0.5),
  airline('BOV', 'OB', 'Boliviana de Aviación', 'BO', 'CP-####', 'SLVR SLLP SLCB', 'B738:1.5 B737:1 B763:0.2', 22, 0.75),
  airline('DWI', 'DM', 'Arajet', 'DO', 'HI####', 'MDSD', 'B38M:1', 18, 0),
  airline('BWA', 'BW', 'Caribbean Airlines', 'TT', '9Y-LLL', 'TTPP MKJP', 'B38M:0.8 B738:0.5 AT76:0.6', 17, 0.1),
  airline('LCO', 'UC', 'LATAM Cargo Chile', 'CL', 'CC-LLL', 'SCEL KMIA SBGR', 'B763:1', 18, 0.05),
  airline('TPA', 'QT', 'Avianca Cargo', 'CO', 'N###LL', 'SKBO KMIA', 'A332:1 B763:0.4', 12, 0.1),

  // ------------------------------------------------------------------ Europe: Iberia & Atlantic islands
  airline('AEA', 'UX', 'Air Europa', 'ES', 'EC-LLL', 'LEMD LEPA', 'B788:0.7 B789:1 B38M:1 B738:0.8', 50, 0.15),
  airline('IBS', 'I2', 'Iberia Express', 'ES', 'EC-LLL', 'LEMD', 'A320:1 A20N:1 A321:0.4 A21N:0.6', 26, 0.6),
  airline('ANE', 'YW', 'Air Nostrum', 'ES', 'EC-LLL', 'LEVC LEMD LEBL LEMG', 'CRJ9:2 AT76:1', 38, 0.75),
  airline('IBB', 'NT', 'Binter Canarias', 'ES', 'EC-LLL', 'GCXO GCLP GCTS', 'AT76:2.5 E295:1', 36, 0.8),
  airline('VOE', 'V7', 'Volotea', 'ES', 'EC-LLL', 'LFRS LIPZ LFBD LFML LEBL LEAS', 'A320:1.5 A319:1', 40, 0.35),
  // ------------------------------------------------------------------ Europe: Germany, Switzerland, Benelux
  airline('CFG', 'DE', 'Condor', 'DE', 'D-ALLL', 'EDDF EDDM EDDL EDDH', 'A20N:1 A21N:1 A320:0.5 A321:0.3 A339:0.8', 60, 0.03),
  airline('OCN', '4Y', 'Discover Airlines', 'DE', 'D-ALLL', 'EDDF EDDM', 'A320:2 A332:0.5 A333:0.5', 30, 0),
  airline('CLH', 'CL', 'Lufthansa CityLine', 'DE', 'D-ALLL', 'EDDM EDDF', 'CRJ9:1 E195:1', 35, 0.3),
  airline('GEC', 'LH', 'Lufthansa Cargo', 'DE', 'D-ALLL', 'EDDF', 'B77L:1', 16, 0),
  airline('BOX', '3S', 'AeroLogic', 'DE', 'D-ALLL', 'EDDP EDDF', 'B77L:1', 22, 0),
  airline('BCS', 'QY', 'European Air Transport', 'DE', 'D-ALLL', 'EDDP', 'A306:1 A332:0.6 B763:0.3', 45, 0.05),
  airline('EDW', 'WK', 'Edelweiss Air', 'CH', 'HB-LLL', 'LSZH', 'A320:1.4 A343:0.4 A359:0.5', 20, 0),
  airline('OAW', '2L', 'Helvetic Airways', 'CH', 'HB-LLL', 'LSZH', 'E190:1 E295:1.5', 18, 0),
  airline('EZS', 'U2', 'easyJet Switzerland', 'CH', 'HB-LLL', 'LSGG LFSB LSZH', 'A320:1.5 A20N:1 A319:0.5', 30, 0.05, true),
  airline('LGL', 'LG', 'Luxair', 'LU', 'LX-LLL', 'ELLX', 'B738:1 B38M:0.8 B737:0.2 DH8D:2', 17, 0),
  airline('TRA', 'HV', 'Transavia', 'NL', 'PH-LLL', 'EHAM EHEH EHRD', 'B738:3 B737:0.5 A20N:1', 42, 0),
  airline('KLC', 'WA', 'KLM Cityhopper', 'NL', 'PH-LLL', 'EHAM', 'E75L:1 E190:0.6 E295:1.2', 50, 0),
  // ------------------------------------------------------------------ Europe: France
  airline('TVF', 'TO', 'Transavia France', 'FR', 'F-LLLL', 'LFPO LFLL LFML LFRS LFMN', 'B738:2 A20N:1.5', 80, 0.1),
  airline('HOP', 'A5', 'Air France Hop', 'FR', 'F-LLLL', 'LFPO LFLL LFPG LFRN', 'E170:1 E190:1.2', 40, 0.75),
  airline('EJU', 'U2', 'easyJet Europe', 'AT', 'OE-LLL', 'LFPG LFLL LFML LFMN LEBL LIMC LIRN EHAM EDDB LPPT', 'A320:2 A20N:2 A319:0.6 A21N:0.6', 140, 0.15, true),
  // ------------------------------------------------------------------ Europe: UK & Ireland
  airline('VIR', 'VS', 'Virgin Atlantic', 'GB', 'G-LLLL', 'EGLL EGCC', 'A35K:1.2 B789:1.4 A339:0.8', 42, 0),
  airline('LOG', 'LM', 'Loganair', 'GB', 'G-LLLL', 'EGPD EGPF EGPE EGPA EGPH', 'AT76:1.5 AT45:0.7 SF34:0.5', 30, 0.9),
  airline('CFE', 'BA', 'BA CityFlyer', 'GB', 'G-LLLL', 'EGLC', 'E190:2 E170:0.3', 22, 0.1, true),
  airline('DHK', 'D0', 'DHL Air UK', 'GB', 'G-LLLL', 'EGNX', 'B763:1 B77L:0.6 B752:0.6', 35, 0),
  airline('EAI', 'EA', 'Emerald Airlines', 'IE', 'EI-LLL', 'EIDW EGAC', 'AT76:1', 25, 0.05),
  // ------------------------------------------------------------------ Europe: Nordics & Baltics
  airline('ICE', 'FI', 'Icelandair', 'IS', 'TF-LLL', 'BIKF', 'B752:1 B38M:1 B39M:0.4 A21N:0.6 B763:0.2 DH8D:0.3', 40, 0.05),
  airline('NBT', 'N0', 'Norse Atlantic Airways', 'NO', 'LN-LLL', 'ENGM EGKK', 'B789:1', 8, 0),
  airline('WIF', 'WF', 'Widerøe', 'NO', 'LN-WLL', 'ENBR ENGM ENVA ENTC ENZV ENBO', 'DH8D:2 E295:0.3', 42, 0.9),
  airline('BTI', 'BT', 'airBaltic', 'LV', 'YL-LLL', 'EVRA EYVI EETN', 'BCS3:1', 45, 0),
  // ------------------------------------------------------------------ Europe: Central, Eastern & Southern
  airline('TVS', 'QS', 'Smartwings', 'CZ', 'OK-LLL', 'LKPR', 'B738:1 B38M:1', 35, 0),
  airline('CTN', 'OU', 'Croatia Airlines', 'HR', '9A-LLL', 'LDZA LDSP', 'BCS3:1.5 A320:0.3 A319:0.3 DH8D:0.8', 14, 0.25),
  airline('ASL', 'JU', 'Air Serbia', 'RS', 'YU-LLL', 'LYBE', 'A319:1 A320:1 A332:0.3 AT76:1', 22, 0.05),
  airline('ROT', 'RO', 'TAROM', 'RO', 'YR-LLL', 'LROP', 'B738:0.8 B38M:0.6 AT76:1 A318:0.3', 18, 0.25),
  airline('SEH', 'GQ', 'Sky Express', 'GR', 'SX-LLL', 'LGAV LGIR', 'A20N:1 A21N:0.5 AT76:1', 15, 0.7),
  airline('NOS', 'NO', 'Neos', 'IT', 'I-LLLL', 'LIMC LIRF LIPZ LIME', 'B38M:2 B789:0.8', 20, 0.1),
  airline('SXS', 'XQ', 'SunExpress', 'TR', 'TC-LLL', 'LTAI LTBJ LTFJ', 'B738:2 B38M:1.5', 70, 0.2),
  airline('TKJ', 'VF', 'AJet', 'TR', 'TC-LLL', 'LTFJ LTAC LTAI LTBJ', 'A20N:1.5 A21N:1.5 B738:1.5 B38M:1', 95, 0.6),
  airline('CAI', 'XC', 'Corendon Airlines', 'TR', 'TC-LLL', 'LTAI LTBJ', 'B738:1 B38M:1', 15, 0.05),
  // ------------------------------------------------------------------ Russia
  airline('SBI', 'S7', 'S7 Airlines', 'RU', 'RA-#####', 'UNNT UUDD UIII', 'A20N:1.5 A320:1 A21N:0.5 B738:1 E170:0.4', 95, 0.85),
  airline('SDM', 'FV', 'Rossiya Airlines', 'RU', 'RA-#####', 'ULLI UUEE UUWW', 'A320:1 A319:1 SU95:1.5 B738:1 B77W:0.3', 100, 0.85),
  airline('PBD', 'DP', 'Pobeda', 'RU', 'RA-#####', 'UUWW ULLI', 'B738:1', 45, 0.9),
  airline('SVR', 'U6', 'Ural Airlines', 'RU', 'RA-#####', 'USSS UUDD', 'A320:1.5 A319:0.5 A321:0.8 A20N:0.3', 45, 0.8),
  airline('UTA', 'UT', 'UTair', 'RU', 'RA-#####', 'UUWW USTR USRR', 'B737:1 B738:1 AT76:0.5', 50, 0.95),

  // ------------------------------------------------------------------ Middle East & Central Asia
  airline('KAC', 'KU', 'Kuwait Airways', 'KW', '9K-LLL', 'OKKK', 'A20N:1 A21N:0.3 A332:0.3 A339:0.6 B77W:0.6', 28, 0),
  airline('JZR', 'J9', 'Jazeera Airways', 'KW', '9K-LLL', 'OKKK', 'A20N:1.5 A21N:1', 24, 0),
  airline('MEA', 'ME', 'Middle East Airlines', 'LB', 'OD-LLL', 'OLBA', 'A21N:1.5 A20N:0.5 A332:0.7', 20, 0),
  airline('ABY', 'G9', 'Air Arabia', 'AE', 'A6-LLL', 'OMSJ OMRK', 'A320:2 A20N:1 A21N:0.5', 70, 0),
  airline('RXI', 'RX', 'Riyadh Air', 'SA', 'HZ-LLL', 'OERK', 'B789:1', 8, 0.1),
  airline('KZR', 'KC', 'Air Astana', 'KZ', 'UP-L####', 'UACC UAAA', 'A20N:0.6 A21N:1.4 B763:0.3 E295:0.2', 35, 0.3),
  airline('UZB', 'HY', 'Uzbekistan Airways', 'UZ', 'UK-#####', 'UTTT', 'A20N:1 A320:0.4 A21N:0.5 B788:0.4 B763:0.2', 30, 0.2),

  // ------------------------------------------------------------------ Africa
  airline('DAH', 'AH', 'Air Algérie', 'DZ', '7T-LLL', 'DAAG DAON DABC', 'B738:2 B737:0.5 A332:0.3 A333:0.3 AT76:0.7', 48, 0.35),
  airline('TAR', 'TU', 'Tunisair', 'TN', 'TS-LLL', 'DTTA', 'A320:1.5 A20N:1 A332:0.2', 14, 0.05),
  airline('RWD', 'WB', 'RwandAir', 'RW', '9XR-LL', 'HRYR', 'B738:1 A333:0.3 A332:0.2 CRJ9:0.4 DH8D:0.4', 11, 0),
  airline('APK', 'P4', 'Air Peace', 'NG', '5N-LLL', 'DNMM DNAA', 'B737:1 B738:0.5 E195:1 E145:0.4 E295:0.3 B772:0.2', 22, 0.8),
  airline('MAU', 'MK', 'Air Mauritius', 'MU', '3B-LLL', 'FIMP', 'A359:1 A339:0.6 AT76:0.6', 11, 0),
  airline('LNK', '4Z', 'Airlink', 'ZA', 'ZS-LLL', 'FAOR FACT', 'E145:1.2 E190:1 E195:0.5', 50, 0.6),
  airline('SFR', 'FA', 'FlySafair', 'ZA', 'ZS-LLL', 'FAOR FACT FALE', 'B738:1.5 B737:0.3', 24, 0.95),
  airline('DTA', 'DT', 'TAAG Angola Airlines', 'AO', 'D2-LLL', 'FNLU FNBJ', 'B77W:0.3 B772:0.2 B788:0.4 B737:0.5 DH8D:0.8', 14, 0.4),

  // ------------------------------------------------------------------ South Asia
  airline('UBG', 'BS', 'US-Bangla Airlines', 'BD', 'S2-LLL', 'VGHS', 'B738:1 AT76:1 A333:0.2', 22, 0.6),

  // ------------------------------------------------------------------ China, Hong Kong & Taiwan
  airline('CQH', '9C', 'Spring Airlines', 'CN', 'B-####', 'ZSPD ZSSS ZGSZ ZYTX', 'A320:1 A20N:2 A21N:0.5', 120, 0.85),
  airline('DKH', 'HO', 'Juneyao Air', 'CN', 'B-####', 'ZSPD ZSSS ZSNJ', 'A320:1 A20N:1 A321:1 A21N:1 B789:0.2', 95, 0.85),
  airline('CDG', 'SC', 'Shandong Airlines', 'CN', 'B-####', 'ZSJN ZSQD ZSAM', 'B738:2.5 B38M:1', 130, 0.95),
  airline('CBJ', 'JD', 'Beijing Capital Airlines', 'CN', 'B-####', 'ZBAD ZSHC ZPPP', 'A320:1 A20N:1 A321:0.5 A339:0.2', 70, 0.9),
  airline('GCR', 'GS', 'Tianjin Airlines', 'CN', 'B-####', 'ZBTJ ZLXY', 'A320:1 A321:0.4 E190:0.7 E195:0.5 E295:0.5 A332:0.2', 90, 0.95),
  airline('CDC', 'GJ', 'Loong Air', 'CN', 'B-####', 'ZSHC ZLXY', 'A320:1 A20N:1 A21N:0.5', 50, 0.95),
  airline('CKK', 'CK', 'China Cargo Airlines', 'CN', 'B-####', 'ZSPD', 'B77L:1', 18, 0.1),
  airline('CSS', 'O3', 'SF Airlines', 'CN', 'B-####', 'ZHEC ZGSZ ZSHC', 'B752:1.5 B763:1 B738:1 B77L:0.2 A332:0.2', 75, 0.9),
  airline('HKE', 'UO', 'HK Express', 'CN', 'B-HLL', 'VHHH', 'A20N:1 A21N:1.2 A321:0.3', 34, 0),
  airline('CRK', 'HX', 'Hong Kong Airlines', 'CN', 'B-HLL', 'VHHH', 'A320:0.5 A20N:0.3 A333:1 A332:0.2', 28, 0),
  airline('AHK', 'LD', 'Air Hong Kong', 'CN', 'B-HLL', 'VHHH', 'A332:1 A306:0.4', 12, 0),
  airline('SJX', 'JX', 'STARLUX Airlines', 'TW', 'B-#####', 'RCTP', 'A21N:1.2 A339:0.8 A359:0.7 A35K:0.1', 28, 0),
  airline('TTW', 'IT', 'Tigerair Taiwan', 'TW', 'B-#####', 'RCTP RCKH', 'A320:0.6 A20N:1 A21N:0.3', 16, 0),

  // ------------------------------------------------------------------ Japan & Korea
  airline('APJ', 'MM', 'Peach Aviation', 'JP', 'JA###L', 'RJBB RJAA ROAH', 'A320:1 A20N:0.7 A21N:0.8', 35, 0.75),
  airline('SKY', 'BC', 'Skymark Airlines', 'JP', 'JA##LL', 'RJTT RJFF RJCC ROAH', 'B738:1', 28, 1),
  airline('JJP', 'GK', 'Jetstar Japan', 'JP', 'JA##JJ', 'RJAA RJBB', 'A320:1 A21N:0.3', 23, 0.9),
  airline('TZP', 'ZG', 'ZIPAIR', 'JP', 'JA8##J', 'RJAA', 'B788:1', 8, 0),
  airline('NCA', 'KZ', 'Nippon Cargo Airlines', 'JP', 'JA##KZ', 'RJAA', 'B748:1', 8, 0),
  airline('JNA', 'LJ', 'Jin Air', 'KR', 'HL####', 'RKSI RKSS RKPC RKPK', 'B738:2 B38M:0.2 B772:0.2', 30, 0.4),
  airline('TWB', 'TW', "T'way Air", 'KR', 'HL####', 'RKSI RKSS RKTN RKPC', 'B738:2 B38M:0.3 A333:0.5', 35, 0.35),
  airline('ABL', 'BX', 'Air Busan', 'KR', 'HL####', 'RKPK RKSI', 'A320:0.3 A321:1 A21N:0.8', 22, 0.35),

  // ------------------------------------------------------------------ South-East Asia
  airline('AIQ', 'FD', 'Thai AirAsia', 'TH', 'HS-LLL', 'VTBD VTCC VTSP', 'A320:2 A20N:1 A21N:0.3', 60, 0.6),
  airline('TLM', 'SL', 'Thai Lion Air', 'TH', 'HS-LLL', 'VTBD', 'B738:0.8 B39M:1 A333:0.3', 25, 0.6),
  airline('BKP', 'PG', 'Bangkok Airways', 'TH', 'HS-LLL', 'VTBS VTSM', 'A319:1 A320:0.4 AT76:0.8', 22, 0.6),
  airline('CTV', 'QG', 'Citilink', 'ID', 'PK-LLL', 'WIII WIHH WARR', 'A320:2 A20N:1 AT76:0.6', 55, 0.9),
  airline('BTK', 'ID', 'Batik Air', 'ID', 'PK-LLL', 'WIII WIHH WARR WADD', 'A320:2 B738:1 A333:0.1', 75, 0.85),
  airline('WON', 'IW', 'Wings Air', 'ID', 'PK-LLL', 'WIII WARR WAAA WAMM', 'AT76:1', 55, 1),
  airline('SJV', 'IU', 'Super Air Jet', 'ID', 'PK-LLL', 'WIII WIMM WARR', 'A320:1 A20N:0.3 A321:0.5', 55, 0.95),
  airline('MXD', 'OD', 'Batik Air Malaysia', 'MY', '9M-LLL', 'WMKK', 'B738:2 B38M:1 A333:0.3', 35, 0.3),
  airline('XAX', 'D7', 'AirAsia X', 'MY', '9M-LLL', 'WMKK', 'A333:1', 18, 0),
  airline('FFM', 'FY', 'Firefly', 'MY', '9M-LLL', 'WMSA WMKP', 'AT76:1 B738:0.6', 18, 0.6),
  airline('BAV', 'QH', 'Bamboo Airways', 'VN', 'VN-A###', 'VVNB VVTS', 'A320:0.5 A321:1', 15, 0.9),

  // ------------------------------------------------------------------ Oceania
  airline('RXA', 'ZL', 'Rex Airlines', 'AU', 'VH-LLL', 'YSSY YMML YSWG YPAD', 'SF34:1', 40, 1),
  airline('QLK', 'QF', 'QantasLink', 'AU', 'VH-LLL', 'YSSY YMML YBBN YPPH YPAD', 'DH8D:2 BCS3:0.6 E190:0.6 B712:0.4', 90, 1),
  airline('FJI', 'FJ', 'Fiji Airways', 'FJ', 'DQ-LLL', 'NFFN NFNA', 'A333:0.4 A359:0.3 B38M:0.8 B738:0.2 AT76:0.6', 12, 0.3),

  // ------------------------------------------------------------------ Business aviation (rest of world)
  airline('VJT', '', 'VistaJet', 'MT', '9H-LLL', 'LFPB EGLF LSGG LIML OMDB KTEB', 'GLEX:2 CL35:1', 60, 0.3),
];

/** ICAO codes (from MORE_AIRLINES or the existing AIRLINES) that are all-cargo operators. */
export const CARGO_AIRLINES: string[] = [
  // existing AIRLINES
  'FDX', 'UPS', 'GTI', 'CLX',
  // MORE_AIRLINES
  'CKS', 'PAC', 'ABX', 'ATN', 'CJT', 'LCO', 'TPA', 'GEC', 'BOX', 'BCS', 'DHK',
  'CKK', 'CSS', 'AHK', 'NCA',
];

/** Alliance membership for airlines in MORE_AIRLINES only — include ONLY memberships you are confident are current (late 2026). */
export const MORE_ALLIANCES: Record<string, 'Star Alliance' | 'oneworld' | 'SkyTeam'> = {
  // full members
  CMP: 'Star Alliance',
  CTN: 'Star Alliance',
  VIR: 'SkyTeam',
  MEA: 'SkyTeam',
  ROT: 'SkyTeam',
  // oneworld affiliate members (operate for / under the code of a full member)
  IBS: 'oneworld',
  ANE: 'oneworld',
  CFE: 'oneworld',
  QLK: 'oneworld',
  QXE: 'oneworld',
};
