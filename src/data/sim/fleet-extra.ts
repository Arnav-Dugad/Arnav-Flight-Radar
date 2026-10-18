// Even more reference data: real, currently operating airlines (late 2026) that
// neither AIRLINES (fleet.ts) nor MORE_AIRLINES (fleet-more.ts) list, with their
// real hubs and representative fleets. Used only by the simulation, which is
// labelled as simulated. Flights, registrations, addresses and schedules generated
// from this data are invented.
//
// Sizes are simulated airframes (~0.8–1.0x the real active fleet). Subtypes with no
// entry in TYPES are mapped to the nearest one (ATR 72-500 -> AT76, ATR 42-300/600 ->
// AT45, Dash 8-100/200/300 -> DH8D, 737-300/500 -> B737, 737-800BCF -> B738,
// 777F -> B77L, A330F -> A332, Fokker 70/100 -> E190, CRJ-1000 -> CRJ9).

import { airline, type AirlineProfile } from './fleet';

export const EXTRA_AIRLINES: AirlineProfile[] = [
  // ------------------------------------------------------------------ India & South Asia
  airline('LLR', '9I', 'Alliance Air', 'IN', 'VT-LLL', 'VIDP VABB VOBL VOHS VECC', 'AT76:2 AT45:0.5 CRJ7:0.3', 18, 1),
  airline('SDG', 'S5', 'Star Air', 'IN', 'VT-LLL', 'VOBL VOHS VAPO', 'E145:1 E75L:0.8', 10, 1),
  airline('GOA', 'IC', 'Fly91', 'IN', 'VT-LLL', 'VOGA VOGO', 'AT76:1', 5, 1),
  airline('BDA', 'BZ', 'Blue Dart Aviation', 'IN', 'VT-LLL', 'VOMM VIDP VABB VOBL VECC', 'B752:1 B738:0.6', 8, 0.95),
  airline('ABQ', 'PA', 'Airblue', 'PK', 'AP-LLL', 'OPKC OPLA OPIS', 'A320:1 A321:0.5 A20N:0.3', 9, 0.5),
  airline('SEP', 'ER', 'SereneAir', 'PK', 'AP-LLL', 'OPIS OPKC OPLA', 'A20N:1 A332:0.2', 6, 0.5),
  airline('SIF', 'PF', 'AirSial', 'PK', 'AP-LLL', 'OPST OPKC OPIS', 'A320:1', 4, 0.7),
  airline('FJL', '9P', 'Fly Jinnah', 'PK', 'AP-LLL', 'OPKC OPLA OPIS', 'A320:1', 7, 0.6),
  airline('NVQ', 'VQ', 'NOVOAIR', 'BD', 'S2-LLL', 'VGHS', 'AT76:1', 5, 0.9),
  airline('RNA', 'RA', 'Nepal Airlines', 'NP', '9N-LLL', 'VNKT', 'A320:0.6 A332:0.4', 4, 0.2),
  airline('BHA', 'U4', 'Buddha Air', 'NP', '9N-LLL', 'VNKT', 'AT76:1 AT45:0.5', 14, 0.9),
  airline('NYT', 'YT', 'Yeti Airlines', 'NP', '9N-LLL', 'VNKT', 'AT76:1', 5, 1),
  airline('DQA', 'Q2', 'Maldivian', 'MV', '8Q-LLL', 'VRMM', 'DH8D:1 A320:0.3', 8, 0.7),
  airline('DRK', 'KB', 'Drukair', 'BT', 'A5-LLL', 'VQPR', 'A20N:1 A319:0.5 AT45:0.3', 5, 0.1),

  // ------------------------------------------------------------------ Middle East
  airline('IAW', 'IA', 'Iraqi Airways', 'IQ', 'YI-LLL', 'ORBI ORER ORMM', 'A20N:1 A321:0.5 B738:1 B788:0.2', 20, 0.15),
  airline('OMS', 'OV', 'SalamAir', 'OM', 'A4O-LL', 'OOMS', 'A20N:1 A21N:0.5', 10, 0.05),
  airline('ADY', '3L', 'Air Arabia Abu Dhabi', 'AE', 'A6-LLL', 'OMAA', 'A320:1', 14, 0),
  airline('IRA', 'IR', 'Iran Air', 'IR', 'EP-LLL', 'OIII OIIE OIMM', 'A320:0.6 A321:0.5 A333:0.3 AT76:0.6', 25, 0.6),
  airline('IRM', 'W5', 'Mahan Air', 'IR', 'EP-LLL', 'OIIE OIII', 'A343:0.5 A306:0.5 A332:0.3 A320:0.5', 30, 0.5),
  airline('SYR', 'RB', 'Syrian Air', 'SY', 'YK-LLL', 'OSDI', 'A320:1', 5, 0),
  airline('SAW', '6Q', 'Cham Wings Airlines', 'SY', 'YK-LLL', 'OSDI', 'A320:1', 5, 0),
  airline('IYE', 'IY', 'Yemenia', 'YE', '7O-LLL', 'OYAA OYSY', 'A320:1', 4, 0.15),
  airline('FBA', 'IF', 'Fly Baghdad', 'IQ', 'YI-LLL', 'ORBI', 'B738:1 B737:0.5', 4, 0.1),
  airline('IRC', 'EP', 'Iran Aseman Airlines', 'IR', 'EP-LLL', 'OIII', 'A320:0.4 B737:0.6 AT76:1', 8, 0.8),
  airline('QSM', 'QB', 'Qeshm Air', 'IR', 'EP-LLL', 'OIKQ OIII', 'A320:1 A332:0.2', 6, 0.75),
  airline('AIZ', 'IZ', 'Arkia', 'IL', '4X-LLL', 'LLBG', 'A21N:1 E195:0.5', 9, 0.1),
  airline('ISR', '6H', 'Israir', 'IL', '4X-LLL', 'LLBG', 'A320:1 AT76:0.3', 7, 0.1),
  airline('CYP', 'CY', 'Cyprus Airways', 'CY', '5B-LLL', 'LCLK', 'A20N:1', 4, 0),
  airline('MSC', 'SM', 'Air Cairo', 'EG', 'SU-LLL', 'HECA HEGN HESH', 'A320:1 A20N:1', 18, 0.1),
  airline('NIA', 'NP', 'Nile Air', 'EG', 'SU-LLL', 'HECA', 'A320:1 B738:0.4', 6, 0.1),

  // ------------------------------------------------------------------ Africa
  airline('ATC', 'TC', 'Air Tanzania', 'TZ', '5H-LLL', 'HTDA HTKJ', 'BCS3:1 B788:0.6 DH8D:1 B38M:0.3', 13, 0.6),
  airline('UGD', 'UR', 'Uganda Airlines', 'UG', '5X-LLL', 'HUEN', 'CRJ9:1 A339:0.4', 6, 0),
  airline('ARA', 'W3', 'Arik Air', 'NG', '5N-LLL', 'DNMM DNAA', 'B737:0.6 B738:0.4 CRJ9:0.6 DH8D:0.4', 10, 0.95),
  airline('IAN', 'QI', 'Ibom Air', 'NG', '5N-LLL', 'DNAI DNMM DNAA', 'CRJ9:1 BCS3:0.5', 9, 0.95),
  airline('VRE', 'HF', "Air Côte d'Ivoire", 'CI', 'TU-LLL', 'DIAP', 'A319:0.5 A320:0.5 A20N:0.5 A339:0.2 DH8D:0.6', 10, 0.15),
  airline('SKK', 'KP', 'ASKY Airlines', 'TG', '5V-LLL', 'DXXX', 'B38M:0.5 B738:0.5 B737:0.3 DH8D:0.3', 10, 0),
  airline('SZN', 'HC', 'Air Senegal', 'SN', '6V-LLL', 'GOBD', 'A319:0.5 A20N:0.5 A332:0.3 AT76:0.6', 8, 0.1),
  airline('BOT', 'BP', 'Air Botswana', 'BW', 'A2-LLL', 'FBSK FBMN', 'AT76:1 E170:0.5', 4, 0.3),
  airline('PRF', 'PW', 'Precision Air', 'TZ', '5H-LLL', 'HTDA', 'AT76:1 AT45:0.3', 6, 0.9),
  airline('SEY', 'HM', 'Air Seychelles', 'SC', 'S7-LLL', 'FSIA', 'A20N:1', 3, 0),
  airline('MGY', 'MD', 'Madagascar Airlines', 'MG', '5R-LLL', 'FMMI', 'AT76:1 AT45:0.3', 5, 0.6),
  airline('AAW', '8U', 'Afriqiyah Airways', 'LY', '5A-LLL', 'HLLM', 'A320:1', 4, 0.3),
  airline('LAA', 'LN', 'Libyan Airlines', 'LY', '5A-LLL', 'HLLM', 'A320:1', 4, 0.3),
  airline('LBT', 'BJ', 'Nouvelair', 'TN', 'TS-LLL', 'DTMB DTNH', 'A320:1 A20N:0.3', 8, 0),
  airline('MAC', '3O', 'Air Arabia Maroc', 'MA', 'CN-LLL', 'GMMN GMFF GMMX GMTT', 'A320:1', 9, 0.1),
  airline('JMA', 'JM', 'Jambojet', 'KE', '5Y-LLL', 'HKJK', 'DH8D:1', 7, 0.9),
  airline('LAM', 'TM', 'LAM Mozambique Airlines', 'MZ', 'C9-LLL', 'FQMA', 'E190:0.5 B737:0.5 DH8D:0.5', 6, 0.7),
  airline('REU', 'UU', 'Air Austral', 'RE', 'F-OLLL', 'FMEE', 'B788:0.4 B77W:0.3 B738:0.3 AT76:0.3', 6, 0.1),
  airline('KEM', '5Z', 'CemAir', 'ZA', 'ZS-LLL', 'FAOR FACT', 'CRJ2:1 DH8D:0.5', 8, 1),

  // ------------------------------------------------------------------ China, Macau, Hong Kong & Mongolia
  airline('TBA', 'TV', 'Tibet Airlines', 'CN', 'B-####', 'ZULS ZUUU', 'A319:1 A20N:0.5', 40, 0.98),
  airline('UEA', 'EU', 'Chengdu Airlines', 'CN', 'B-####', 'ZUTF ZUUU', 'A320:1 A321:0.5 A20N:0.4', 60, 1),
  airline('LKE', '8L', 'Lucky Air', 'CN', 'B-####', 'ZPPP', 'A320:1 A20N:0.5 A332:0.1', 50, 0.95),
  airline('CHB', 'PN', 'West Air', 'CN', 'B-####', 'ZUCK ZHCC', 'A320:1 A20N:0.6 A21N:0.3', 45, 0.98),
  airline('KNA', 'KY', 'Kunming Airlines', 'CN', 'B-####', 'ZPPP', 'B738:1 B38M:0.3', 30, 1),
  airline('HBH', 'NS', 'Hebei Airlines', 'CN', 'B-####', 'ZBSJ', 'B738:1 E190:0.2', 30, 1),
  airline('QDA', 'QW', 'Qingdao Airlines', 'CN', 'B-####', 'ZSQD', 'A320:1 A20N:1', 30, 0.95),
  airline('CQN', 'OQ', 'Chongqing Airlines', 'CN', 'B-####', 'ZUCK', 'A320:1 A20N:0.5', 22, 1),
  airline('HXA', 'G5', 'China Express Airlines', 'CN', 'B-####', 'ZUCK ZUGY', 'CRJ9:1', 40, 1),
  airline('CSH', 'FM', 'Shanghai Airlines', 'CN', 'B-####', 'ZSSS ZSPD', 'B738:2 B38M:0.5 A21N:0.3 B789:0.2', 110, 0.9),
  airline('CUH', 'UQ', 'Urumqi Air', 'CN', 'B-####', 'ZWWW', 'A320:1', 25, 1),
  airline('CBG', 'GX', 'GX Airlines', 'CN', 'B-####', 'ZGNN', 'A320:1 E190:0.5', 25, 1),
  airline('CYZ', 'CF', 'China Postal Airlines', 'CN', 'B-####', 'ZSNJ', 'B752:1 B738:0.5', 30, 1),
  airline('CAO', 'CA', 'Air China Cargo', 'CN', 'B-####', 'ZBAA ZSPD', 'B77L:1 B744:0.2', 15, 0.2),
  airline('AMU', 'NX', 'Air Macau', 'MO', 'B-MLL', 'VMMC', 'A20N:1 A321:0.5', 18, 0),
  airline('HGB', 'HB', 'Greater Bay Airlines', 'CN', 'B-HLL', 'VHHH', 'B738:1', 7, 0),
  airline('MGL', 'OM', 'MIAT Mongolian Airlines', 'MN', 'JU-####', 'ZMCK', 'B738:1 B38M:0.5 B763:0.2 B789:0.2', 7, 0),

  // ------------------------------------------------------------------ Japan, Korea & Taiwan
  airline('SFJ', '7G', 'StarFlyer', 'JP', 'JA##MC', 'RJFF RJTT RJFR', 'A320:1', 11, 0.95),
  airline('ADO', 'HD', 'Air Do', 'JP', 'JA##AN', 'RJCC RJTT', 'B738:1 B763:0.4', 12, 1),
  airline('SNJ', '6J', 'Solaseed Air', 'JP', 'JA##RK', 'RJFM RJTT', 'B738:1', 14, 1),
  airline('FDA', 'JH', 'Fuji Dream Airlines', 'JP', 'JA##FJ', 'RJNS RJNA', 'E170:1 E75L:1', 16, 1),
  airline('JLJ', 'XM', 'J-Air', 'JP', 'JA##J', 'RJOO RJSS', 'E190:1 E170:0.3', 30, 1),
  airline('JTA', 'NU', 'Japan Transocean Air', 'JP', 'JA##RK', 'ROAH', 'B738:1', 13, 1),
  airline('AKX', 'EH', 'ANA Wings', 'JP', 'JA###A', 'RJTT RJOO RJCC RJFF', 'DH8D:1.2 B738:0.4', 35, 1),
  airline('IBX', 'FW', 'IBEX Airlines', 'JP', 'JA##RJ', 'RJSS RJOO', 'CRJ7:1', 9, 1),
  airline('SJO', 'IJ', 'Spring Japan', 'JP', 'JA##SJ', 'RJAA', 'B738:1', 8, 0.5),
  airline('JAC', 'JC', 'Japan Air Commuter', 'JP', 'JA##JC', 'RJFK', 'AT76:1 AT45:0.5', 11, 1),
  airline('APZ', 'YP', 'Air Premia', 'KR', 'HL####', 'RKSI', 'B789:1', 7, 0),
  airline('ASV', 'RS', 'Air Seoul', 'KR', 'HL####', 'RKSI', 'A321:1', 6, 0),
  airline('ESR', 'ZE', 'Eastar Jet', 'KR', 'HL####', 'RKSS RKSI', 'B38M:1 B738:1', 13, 0.4),
  airline('EOK', 'RF', 'Aero K', 'KR', 'HL####', 'RKTU', 'A320:1', 7, 0.3),
  airline('MDA', 'AE', 'Mandarin Airlines', 'TW', 'B-#####', 'RCMQ RCSS', 'AT76:1 E190:0.5', 12, 0.7),
  airline('UIA', 'B7', 'UNI Air', 'TW', 'B-#####', 'RCSS RCKH', 'AT76:1 A321:0.5', 20, 0.6),

  // ------------------------------------------------------------------ South-East Asia
  airline('GAP', '2P', 'PAL Express', 'PH', 'RP-C####', 'RPLL RPVM', 'DH8D:1 A320:0.3', 20, 0.95),
  airline('APG', 'Z2', 'Philippines AirAsia', 'PH', 'RP-C####', 'RPLL RPVM', 'A320:1', 25, 0.6),
  airline('AWQ', 'QZ', 'Indonesia AirAsia', 'ID', 'PK-LLL', 'WIII WADD', 'A320:1', 20, 0.3),
  airline('PAS', '6D', 'Pelita Air', 'ID', 'PK-LLL', 'WIII', 'A320:1', 12, 1),
  airline('NOK', 'DD', 'Nok Air', 'TH', 'HS-LLL', 'VTBD', 'B738:1 DH8D:0.3', 20, 0.85),
  airline('TVJ', 'VZ', 'Thai Vietjet Air', 'TH', 'HS-LLL', 'VTBS', 'A320:1 A321:0.6', 22, 0.6),
  airline('VAG', 'VU', 'Vietravel Airlines', 'VN', 'VN-A###', 'VVNB VVTS', 'A321:1', 5, 0.8),
  airline('LAO', 'QV', 'Lao Airlines', 'LA', 'RDPL-#####', 'VLVT', 'A320:1 AT76:1', 6, 0.3),
  airline('MMA', '8M', 'Myanmar Airways International', 'MM', 'XY-LLL', 'VYYY', 'A320:1', 5, 0.2),
  airline('RBA', 'BI', 'Royal Brunei Airlines', 'BN', 'V8-LLL', 'WBSB', 'A20N:1 B788:0.4', 11, 0),

  // ------------------------------------------------------------------ Central Asia & Caucasus
  airline('AYN', 'FS', 'FlyArystan', 'KZ', 'UP-L####', 'UAAA UACC UATE', 'A20N:1 A320:0.6', 20, 0.75),
  airline('VSV', 'DV', 'SCAT Airlines', 'KZ', 'UP-L####', 'UAAA UACC UAII', 'B738:1 B38M:0.6 B737:0.3', 18, 0.5),
  airline('AHY', 'J2', 'Azerbaijan Airlines', 'AZ', '4K-AZ##', 'UBBB', 'A320:1 A20N:0.4 B788:0.3 E190:0.3', 20, 0.05),
  airline('TGZ', 'A9', 'Georgian Airways', 'GE', '4L-LLL', 'UGTB', 'E190:1', 4, 0),
  airline('SMR', 'SZ', 'Somon Air', 'TJ', 'EY-###', 'UTDD', 'B738:1 B38M:0.5', 6, 0),
  airline('TUA', 'T5', 'Turkmenistan Airlines', 'TM', 'EZ-A###', 'UTAA', 'B738:1 B77L:0.2', 14, 0.3),

  // ------------------------------------------------------------------ Europe
  airline('KMM', 'KM', 'KM Malta Airlines', 'MT', '9H-LLL', 'LMML', 'A20N:1 A320:0.5', 6, 0),
  airline('JAF', 'TB', 'TUI fly Belgium', 'BE', 'OO-LLL', 'EBBR EBOS', 'B38M:1 B738:0.5 B788:0.2 E190:0.2', 25, 0),
  airline('TUI', 'X3', 'TUI fly Deutschland', 'DE', 'D-ALLL', 'EDDH EDDL EDDV EDDF EDDS', 'B738:1 B38M:1', 22, 0),
  airline('TFL', 'OR', 'TUI fly Netherlands', 'NL', 'PH-LLL', 'EHAM EHRD', 'B738:1 B38M:0.5 B788:0.3', 12, 0),
  airline('BLX', '6B', 'TUI fly Nordic', 'SE', 'SE-LLL', 'ESSA EKCH ENGM', 'B38M:1 B788:0.2', 6, 0),
  airline('RYS', 'FR', 'Buzz', 'PL', 'SP-RLL', 'EPKK EPWA EPKT', 'B738:1 B38M:1', 50, 0.05, true),
  airline('MAY', 'FR', 'Malta Air', 'MT', '9H-LLL', 'LMML LIRA LIPE LFML EDDB ESSA', 'B738:1 B38M:1', 80, 0, true),
  airline('LDA', 'FR', 'Lauda Europe', 'MT', '9H-LLL', 'LDZA LEPA LIBD LFML LIME', 'A320:1', 28, 0, true),
  airline('ABN', 'ZB', 'Air Albania', 'AL', 'ZA-LLL', 'LATI', 'A320:1 A319:0.5', 4, 0),
  airline('MNE', 'ZQ', 'Air Montenegro', 'ME', '4O-LLL', 'LYPG LYTV', 'E195:1', 3, 0),
  airline('FIA', '5F', 'FlyOne', 'MD', 'ER-LLL', 'LUKK', 'A320:1 A319:0.5', 8, 0),
  airline('GRL', 'GL', 'Air Greenland', 'GL', 'OY-LLL', 'BGGH BGSF', 'DH8D:1 A339:0.2', 9, 0.8),
  airline('FLI', 'RC', 'Atlantic Airways', 'FO', 'OY-LLL', 'EKVG', 'A20N:1 A320:0.5', 3, 0),
  airline('RUK', 'FR', 'Ryanair UK', 'GB', 'G-RUKL', 'EGSS EGCC EGGW', 'B738:1', 25, 0.05, true),
  airline('WUK', 'W9', 'Wizz Air UK', 'GB', 'G-WUKL', 'EGGW EGKK', 'A21N:1 A321:0.5', 18, 0),
  airline('WMT', 'W4', 'Wizz Air Malta', 'MT', '9H-WLL', 'LMML LROP LHBP EPKT LBSF', 'A21N:1 A20N:0.5', 80, 0),
  airline('AUR', 'GR', 'Aurigny', 'GB', 'G-ORLL', 'EGJB', 'AT76:1 E195:0.3', 5, 0),
  airline('BCY', 'WX', 'CityJet', 'IE', 'EI-LLL', 'EIDW EKCH ESSA', 'CRJ9:1', 12, 0),
  airline('PUE', 'PU', 'Plus Ultra', 'ES', 'EC-LLL', 'LEMD', 'A332:0.5 A333:0.5', 6, 0),
  airline('RZO', 'S4', 'Azores Airlines', 'PT', 'CS-LLL', 'LPPD', 'A21N:1 A20N:0.5', 6, 0.2),
  airline('SAT', 'SP', 'SATA Air Açores', 'PT', 'CS-LLL', 'LPPD', 'DH8D:1', 6, 1),
  airline('HFY', '5K', 'Hi Fly', 'PT', 'CS-LLL', 'LPPT', 'A332:1 A339:0.3', 8, 0),
  airline('AEZ', 'XZ', 'Aeroitalia', 'IT', 'I-LLLL', 'LIRF LIPK LIMC', 'B738:0.6 B737:0.3 AT76:1', 14, 0.6),
  airline('DLA', 'EN', 'Air Dolomiti', 'IT', 'I-LLLL', 'LIPX LIME LIMC', 'E195:1', 18, 0.2),
  airline('OAL', 'OA', 'Olympic Air', 'GR', 'SX-LLL', 'LGAV', 'DH8D:1 AT45:0.3', 14, 1),
  airline('MBU', 'DI', 'Marabu', 'DE', 'ES-LLL', 'EDDM EDDH', 'A20N:1', 6, 0),
  airline('SDR', 'SR', 'Sundair', 'DE', 'D-ALLL', 'EDDB EDDK EDDW', 'A320:1', 8, 0),
  airline('ENT', 'E4', 'Enter Air', 'PL', 'SP-ELL', 'EPWA EPKT EPKK', 'B738:1 B38M:0.5', 25, 0),
  airline('LZB', 'FB', 'Bulgaria Air', 'BG', 'LZ-LLL', 'LBSF', 'A320:1 A319:0.5 E190:0.3', 9, 0.1),
  airline('FHY', 'FH', 'Freebird Airlines', 'TR', 'TC-LLL', 'LTAI', 'A320:1 A20N:0.5', 10, 0.1),
  airline('BRU', 'B2', 'Belavia', 'BY', 'EW-###LL', 'UMMS', 'B738:1 E195:0.6 CRJ2:0.3', 25, 0),
  airline('BRX', 'TF', 'Braathens Regional Airlines', 'SE', 'SE-LLL', 'ESSB ESSA ESGG', 'AT76:1', 12, 0.7),
  airline('VKG', 'DK', 'Sunclass Airlines', 'DK', 'OY-LLL', 'EKCH ESSA', 'A321:1 A332:0.3', 8, 0),
  airline('DTR', 'DX', 'DAT', 'DK', 'OY-LLL', 'EKBI EKCH', 'AT76:1 AT45:0.3', 10, 0.6),
  airline('CRL', 'SS', 'Corsair', 'FR', 'F-LLLL', 'LFPO', 'A339:1 A332:0.3', 9, 0.1),
  airline('FWI', 'TX', 'Air Caraïbes', 'FR', 'F-OLLL', 'TFFR LFPO TFFF', 'A359:1 A35K:0.3 AT76:0.3', 9, 0.1),
  airline('FBU', 'BF', 'French bee', 'FR', 'F-LLLL', 'LFPO', 'A359:1 A35K:0.5', 6, 0),
  airline('SHU', 'HZ', 'Aurora', 'RU', 'RA-#####', 'UHHH UHWW', 'A319:0.6 A320:0.4 DH8D:0.5', 22, 0.9),
  airline('KTK', 'ZF', 'Azur Air', 'RU', 'RA-#####', 'UUWW', 'B763:0.5 B77W:0.3 B752:0.5 B738:0.5', 30, 0.2),
  airline('NWS', 'N4', 'Nordwind Airlines', 'RU', 'RA-#####', 'UUEE', 'A321:1 A333:0.3 SU95:0.5', 30, 0.7),
  airline('RWZ', 'WZ', 'Red Wings', 'RU', 'RA-#####', 'UUDD UWUU', 'SU95:1 A321:0.5', 25, 0.85),
  airline('SYL', 'R3', 'Yakutia', 'RU', 'RA-#####', 'UEEE', 'B738:0.5 SU95:0.5 DH8D:0.5', 15, 0.95),
  airline('AUL', '5N', 'Smartavia', 'RU', 'RA-#####', 'ULAA ULLI', 'A20N:0.5 B738:1', 20, 0.9),
  airline('TYA', 'Y7', 'NordStar', 'RU', 'RA-#####', 'UOOO UNKL', 'B738:1 AT45:0.4', 10, 1),

  // ------------------------------------------------------------------ North America
  airline('AWI', 'ZW', 'Air Wisconsin', 'US', 'N###LL', 'KORD KCLT KPHL', 'CRJ2:1', 40, 1),
  airline('UCA', 'C5', 'CommuteAir', 'US', 'N###LL', 'KIAH KDEN KIAD', 'E145:1', 55, 1),
  airline('JSX', 'XE', 'JSX', 'US', 'N###LL', 'KDAL KBUR KLAS KHOU KOAK', 'E145:1', 30, 0.95),
  airline('OAE', 'OY', 'Omni Air International', 'US', 'N###LL', 'KTUL KCVG', 'B763:1 B772:0.3', 10, 0.3),
  airline('GXA', 'G6', 'GlobalX', 'US', 'N###LL', 'KMIA', 'A320:1 A321:0.5', 10, 0.7),
  airline('AJT', 'M6', 'Amerijet International', 'US', 'N###LL', 'KMIA', 'B763:1', 8, 0.1),
  airline('PVL', 'PB', 'PAL Airlines', 'CA', 'C-LLLL', 'CYYT CYHZ', 'DH8D:1', 10, 1),
  airline('ANT', '4N', 'Air North', 'CA', 'C-LLLL', 'CYXY', 'B737:0.5 AT45:1', 7, 1),
  airline('MPE', '5T', 'Canadian North', 'CA', 'C-LLLL', 'CYZF CYFB CYEG', 'B737:1 AT45:0.5 DH8D:0.3', 12, 1),
  airline('SLI', '5D', 'Aeroméxico Connect', 'MX', 'XA-LLL', 'MMMX MMMY MMGL', 'E190:1 E75L:0.5', 50, 0.9),

  // ------------------------------------------------------------------ Latin America & Caribbean
  airline('VOC', 'Q6', 'Volaris Costa Rica', 'CR', 'N###LL', 'MROC', 'A320:1 A20N:0.5', 8, 0),
  airline('RPB', 'P5', 'Wingo', 'CO', 'HK-####', 'SKBO', 'B738:1', 10, 0.5),
  airline('ARE', '4C', 'LATAM Airlines Colombia', 'CO', 'CC-LLL', 'SKBO SKRG', 'A320:1 A319:0.3', 25, 0.75),
  airline('LNE', 'XL', 'LATAM Airlines Ecuador', 'EC', 'HC-LLL', 'SEQM SEGU', 'A320:1 A319:0.5', 8, 0.6),
  airline('NSE', '9R', 'SATENA', 'CO', 'HK-####', 'SKBO', 'AT76:1 AT45:0.4', 14, 1),
  airline('FBZ', 'FO', 'Flybondi', 'AR', 'LV-LLL', 'SAEZ SABE', 'B738:1', 15, 0.85),
  airline('JES', 'WJ', 'JetSMART Argentina', 'AR', 'LV-LLL', 'SABE SAEZ', 'A20N:1 A320:0.5', 15, 0.9),
  airline('VCV', 'V0', 'Conviasa', 'VE', 'YV####', 'SVMI', 'E190:1 A343:0.2', 10, 0.5),
  airline('SLM', 'PY', 'Surinam Airways', 'SR', 'PZ-TLL', 'SMJP', 'B738:1', 3, 0),
  airline('BHS', 'UP', 'Bahamasair', 'BS', 'C6-LLL', 'MYNN', 'B737:0.5 AT76:1', 6, 0.5),
  airline('CAY', 'KX', 'Cayman Airways', 'KY', 'VP-CLL', 'MWCR', 'B38M:1', 5, 0.1),
  airline('IWY', 'JY', 'interCaribbean Airways', 'TC', 'VQ-TLL', 'MBPV', 'AT76:0.6 AT45:0.5 E145:0.4', 10, 0.1),

  // ------------------------------------------------------------------ Oceania
  airline('ANG', 'PX', 'Air Niugini', 'PG', 'P2-LLL', 'AYPY', 'BCS3:1 B738:0.4 DH8D:0.8 B763:0.2', 18, 0.7),
  airline('FJA', 'FJ', 'Fiji Link', 'FJ', 'DQ-LLL', 'NFFN NFNA', 'AT76:1 AT45:0.5', 6, 0.9),
  airline('SOL', 'IE', 'Solomon Airlines', 'SB', 'H4-LLL', 'AGGH', 'A320:1', 2, 0),
  airline('RON', 'ON', 'Nauru Airlines', 'NR', 'VH-LLL', 'ANYN', 'B737:1', 3, 0),
  airline('UTY', 'QQ', 'Alliance Airlines', 'AU', 'VH-LLL', 'YBBN YPPH YMML YBCS', 'E190:1', 45, 1),
  airline('ANO', 'TL', 'Airnorth', 'AU', 'VH-LLL', 'YPDN', 'E170:1 E190:0.3', 10, 0.9),
  airline('THT', 'TN', 'Air Tahiti Nui', 'PF', 'F-OLLL', 'NTAA', 'B789:1', 4, 0),
  airline('VTA', 'VT', 'Air Tahiti', 'PF', 'F-OLLL', 'NTAA', 'AT76:1 AT45:0.5', 10, 1),
  airline('ACI', 'SB', 'Aircalin', 'NC', 'F-OLLL', 'NWWW', 'A339:0.6 A20N:0.6', 5, 0),

  // ------------------------------------------------------------------ Cargo
  airline('AZG', '7L', 'Silk Way West Airlines', 'AZ', '4K-SW###', 'UBBB', 'B748:1 B77L:0.5', 10, 0),
  airline('ABD', 'CC', 'Air Atlanta Icelandic', 'IS', 'TF-LLL', 'BIKF', 'B744:1 B748:0.2', 10, 0),
  airline('SWT', 'WT', 'Swiftair', 'ES', 'EC-LLL', 'LEMD LEBL', 'B737:1 AT45:0.5', 20, 0.4),
  airline('MAA', 'M7', 'MasAir', 'MX', 'XA-LLL', 'MMMX', 'B763:1 B77L:0.2', 5, 0),
  airline('TAY', '3V', 'ASL Airlines Belgium', 'BE', 'OO-LLL', 'EBLG', 'B744:0.3 B763:0.5 B738:0.5', 10, 0),
  airline('ABR', 'AG', 'ASL Airlines Ireland', 'IE', 'EI-LLL', 'EIDW', 'B738:1 AT76:0.5', 10, 0.2),
  airline('MPH', 'MP', 'Martinair Cargo', 'NL', 'PH-LLL', 'EHAM', 'B744:1', 4, 0),
];

/** All-cargo operators in EXTRA_AIRLINES. */
export const EXTRA_CARGO: string[] = ['BDA', 'CYZ', 'CAO', 'AJT', 'AZG', 'ABD', 'SWT', 'MAA', 'TAY', 'ABR', 'MPH'];

/**
 * Alliance membership for airlines in EXTRA_AIRLINES: only affiliates that the
 * alliances list publicly (they fly under a full member's code). LATAM left oneworld
 * in 2020, so its subsidiaries are unaligned.
 */
export const EXTRA_ALLIANCES: Record<string, 'Star Alliance' | 'oneworld' | 'SkyTeam'> = {
  CSH: 'SkyTeam',
  SLI: 'SkyTeam',
  MDA: 'SkyTeam',
  JLJ: 'oneworld',
  JTA: 'oneworld',
  JAC: 'oneworld',
};
