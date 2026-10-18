// Simulated radio transcript for a flight, generated from its timeline of events in
// standard ICAO phraseology (FAA wording at US airports). Airport frequencies are the
// real published ones (OurAirports) where known; en-route sector names follow the real
// control centres, but their frequencies are illustrative. Nothing here is a recording.

import type { Leg, LegEvent, SimAirport } from './engine';
import type { Wake } from './refTypes';

export interface RadioLine {
  t: number;
  who: 'atc' | 'pilot';
  station: string;
  freq?: string;
  text: string;
}

export type FreqKind = 'twr' | 'gnd' | 'app' | 'dep' | 'atis' | 'del' | 'ctr';

export interface RadioContext {
  leg: Leg;
  /** Spoken callsign, e.g. "Speedbird 12A" (suffix added here). */
  callsign: string;
  wake: Wake;
  freq: (ident: string, kind: FreqKind) => number | undefined;
  /** Country under a point, for sector names. */
  countryAt: (lat: number, lon: number) => string | undefined;
  squawk: string;
  typeName: string;
  fmtTime: (t: number) => string;
  ga: boolean;
}

const fmtFreq = (f: number | undefined) => (f ? f.toFixed(3).replace(/0$/, '') : undefined);

/** Illustrative en-route frequency (8.33 kHz style) from a sector name. */
function sectorFreq(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const mhz = 124 + (h % 1100) / 100;
  return (Math.round(mhz * 200) / 200).toFixed(3);
}

const US_CENTERS: [string, number, number][] = [
  ['Boston', 42.73, -71.48],
  ['New York', 40.78, -73.1],
  ['Washington', 39.1, -77.5],
  ['Cleveland', 41.3, -82.2],
  ['Indianapolis', 39.7, -86.3],
  ['Chicago', 41.78, -88.3],
  ['Atlanta', 33.38, -84.3],
  ['Jacksonville', 30.7, -81.9],
  ['Miami', 25.8, -80.3],
  ['Memphis', 35.06, -89.96],
  ['Minneapolis', 44.6, -93.15],
  ['Kansas City', 38.88, -94.79],
  ['Fort Worth', 32.83, -97.07],
  ['Houston', 29.96, -95.33],
  ['Albuquerque', 35.17, -106.57],
  ['Denver', 40.19, -105.13],
  ['Salt Lake', 40.79, -111.95],
  ['Los Angeles', 34.6, -118.08],
  ['Oakland', 37.54, -122.02],
  ['Seattle', 47.29, -122.19],
  ['Anchorage', 61.23, -149.78],
  ['Honolulu', 21.32, -157.92],
];

const nearestOf = (list: [string, number, number][], lat: number, lon: number) => list.reduce((b, c) => ((c[1] - lat) ** 2 + (c[2] - lon) ** 2 < (b[1] - lat) ** 2 + (b[2] - lon) ** 2 ? c : b), list[0]!)[0];

/** Name of the area control centre at a point (real centre names, approximate boundaries). */
export function sectorAt(lat: number, lon: number, country: string | undefined): string {
  if (!country) {
    if (lat > 45 && lon > -60 && lon < -10) return lon < -30 ? 'Gander Oceanic' : 'Shanwick Oceanic';
    if (lat > 61 && lon > -40 && lon < -5) return 'Reykjavik Control';
    if (lat > 15 && lat <= 45 && lon > -70 && lon < -30) return 'New York Oceanic';
    if (lat > 15 && lat <= 45 && lon >= -30 && lon < -10) return 'Santa Maria Oceanic';
    if (lon < -130 || lon > 165) return lat > 40 ? 'Anchorage Oceanic' : 'Oakland Oceanic';
    if (lon > 50 && lon < 100 && lat < 25) return lat > 10 ? 'Mumbai Oceanic' : 'Chennai Oceanic';
    if (lon > 100 && lon < 165 && lat < 0) return 'Brisbane Centre';
    return 'Oceanic Control';
  }
  switch (country) {
    case 'US':
      return `${nearestOf(US_CENTERS, lat, lon)} Center`;
    case 'CA':
      return `${nearestOf([['Vancouver', 49.2, -123.2], ['Edmonton', 53.3, -113.6], ['Winnipeg', 49.9, -97.2], ['Toronto', 43.7, -79.6], ['Montreal', 45.5, -73.7], ['Moncton', 46.1, -64.7], ['Gander', 48.9, -54.6]], lat, lon)} Centre`;
    case 'GB':
      return lat > 54.6 ? 'Scottish Control' : 'London Control';
    case 'IE':
      return 'Shannon Control';
    case 'FR':
      return lat > 47.5 && lon < 1 ? 'Brest Control' : lat > 46.5 && lon > 3.5 ? 'Reims Control' : lat < 45.5 && lon > 3 ? 'Marseille Control' : lat < 46.5 && lon < 2 ? 'Bordeaux Control' : 'Paris Control';
    case 'DE':
      return lat > 51.7 ? 'Bremen Radar' : lat < 49 ? 'München Radar' : 'Langen Radar';
    case 'NL':
    case 'BE':
    case 'LU':
      return 'Maastricht Radar';
    case 'ES':
      return lat < 31 ? 'Canarias Control' : lon > 0 && lat > 39.5 ? 'Barcelona Control' : lat < 38.5 ? 'Sevilla Control' : 'Madrid Control';
    case 'PT':
      return 'Lisboa Control';
    case 'IT':
      return lat > 44.5 ? 'Milano Control' : lat < 41 && lon > 15 ? 'Brindisi Control' : 'Roma Control';
    case 'CH':
      return 'Swiss Radar';
    case 'AT':
      return 'Wien Radar';
    case 'CZ':
      return 'Praha Control';
    case 'PL':
      return 'Warszawa Control';
    case 'DK':
      return 'Copenhagen Control';
    case 'NO':
      return 'Polaris Control';
    case 'SE':
      return 'Sweden Control';
    case 'FI':
      return 'Helsinki Control';
    case 'TR':
      return lon > 33 ? 'Ankara Control' : 'Istanbul Control';
    case 'GR':
      return 'Athinai Control';
    case 'HU':
      return 'Budapest Control';
    case 'RO':
      return 'Bucuresti Control';
    case 'RU':
      return lon > 60 ? 'Yekaterinburg Control' : 'Moscow Control';
    case 'AE':
      return 'Emirates Control';
    case 'QA':
      return 'Doha Control';
    case 'SA':
      return 'Jeddah Control';
    case 'IN':
      return lat > 23 ? (lon > 82 ? 'Kolkata Control' : 'Delhi Control') : lon > 78 ? 'Chennai Control' : 'Mumbai Control';
    case 'CN':
      return lat > 35 ? 'Beijing Control' : lon > 112 ? (lat > 27 ? 'Shanghai Control' : 'Guangzhou Control') : lon < 105 ? 'Chengdu Control' : 'Wuhan Control';
    case 'JP':
      return lon < 133 ? 'Fukuoka Control' : 'Tokyo Control';
    case 'KR':
      return 'Incheon Control';
    case 'AU':
      return lat > -30 && lon > 135 ? 'Brisbane Centre' : 'Melbourne Centre';
    case 'NZ':
      return 'Christchurch Control';
    case 'BR':
      return lat < -22 ? 'Curitiba Center' : lat > -8 ? (lon < -50 ? 'Amazonica Center' : 'Recife Center') : 'Brasilia Center';
    case 'MX':
      return 'Mexico Control';
    case 'SG':
    case 'MY':
      return lat < 3 ? 'Singapore Control' : 'Lumpur Control';
    case 'TH':
      return 'Bangkok Control';
    case 'HK':
      return 'Hong Kong Radar';
    case 'ZA':
      return 'Johannesburg Control';
    case 'EG':
      return 'Cairo Control';
    default:
      return `${country} Control`;
  }
}

/** City name, used for approach and destination ("New York Approach", "cleared to Moscow"). */
function placeName(a: SimAirport): string {
  if (a.site === 'scene') return 'the scene';
  const city = a.city?.split(/[,/(]/)[0]?.trim();
  if (city && city.length <= 18) return city;
  return airportName(a);
}

/**
 * Short airport name as used by its tower and ground stations: "Heathrow" (London
 * Heathrow), "Kennedy" (John F Kennedy), "Atlanta" (Hartsfield-Jackson Atlanta).
 */
export function airportName(a: SimAirport): string {
  if (a.site) return a.site === 'scene' ? 'the scene' : a.name;
  const city = a.city?.split(/[,/(]/)[0]?.trim() ?? '';
  const base = a.name
    .replace(/\s*\(.*?\)/g, '')
    .replace(/\s*(International|Intl\.?|Regional|Municipal|Metropolitan)?\s*(Airport|Airfield|Air Base|Aerodrome|Airpark)\b.*$/i, '')
    .replace(/\s+International$/i, '')
    .trim();
  if (!base) return city || a.ident;
  if (city && base.toLowerCase().endsWith(city.toLowerCase())) return city;
  if (city && base.toLowerCase().startsWith(city.toLowerCase())) {
    const rest = base.slice(city.length).replace(/^[\s–-]+/, '');
    if (!rest || /^[a-z]/.test(rest)) return city;
    return shortName(rest);
  }
  const short = shortName(base);
  return short.length <= 22 ? short : city || short;
}

/** Last name of a long airport name, keeping particles: "John F Kennedy" → "Kennedy", "Charles de Gaulle" → "de Gaulle". */
function shortName(s: string): string {
  const words = s.split(/\s+/);
  if (words.length < 3) return s;
  const last = words[words.length - 1]!;
  const prev = words[words.length - 2]!;
  return /^(de|del|di|da|von)$/i.test(prev) ? `${prev} ${last}` : last;
}

const cardinal = (deg: number) => ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
const pad3 = (n: number) => String(Math.round(((n % 360) + 360) % 360) || 360).padStart(3, '0');
const level = (n: number) => (n >= 180 || n * 100 > 18_000 ? `flight level ${n}` : `${(n * 100).toLocaleString('en-US')} feet`);

export function transcript(ctx: RadioContext): RadioLine[] {
  const { leg } = ctx;
  const from = leg.from;
  const to = leg.to;
  const us = (a: SimAirport) => a.country === 'US';
  const suffix = ctx.wake === 'J' ? ' Super' : ctx.wake === 'H' && !us(from) ? ' Heavy' : ctx.wake === 'H' ? ' Heavy' : '';
  const cs = ctx.callsign + suffix;
  const out: RadioLine[] = [];
  const say = (e: LegEvent, who: RadioLine['who'], station: string, freq: string | undefined, text: string, dt = 0) => {
    const l: RadioLine = { t: e.t + dt, who, station, text };
    if (freq) l.freq = freq;
    out.push(l);
  };
  const fac = (a: SimAirport, kind: FreqKind): [string, string | undefined] => {
    const name = kind === 'app' || kind === 'dep' ? placeName(a) : airportName(a);
    const label = kind === 'gnd' ? 'Ground' : kind === 'twr' ? 'Tower' : kind === 'del' ? (us(a) ? 'Clearance' : 'Delivery') : kind === 'dep' ? 'Departure' : kind === 'app' ? (us(a) ? 'Approach' : 'Approach') : 'Control';
    const f = ctx.freq(a.ident, kind) ?? (kind === 'del' ? ctx.freq(a.ident, 'gnd') : kind === 'dep' ? ctx.freq(a.ident, 'app') : undefined);
    return [`${name} ${label}`, fmtFreq(f)];
  };
  const wx = (a: SimAirport) => a.weather;
  const windText = (a: SimAirport) => {
    const w = wx(a);
    if (!w?.windKt) return 'wind calm';
    if (w.windDir === undefined) return `wind variable ${w.windKt} knots`;
    return `wind ${pad3(w.windDir)} degrees ${w.windKt}${w.gustKt ? ` gusting ${w.gustKt}` : ''} knots`;
  };
  const qnh = (a: SimAirport) => {
    const q = wx(a)?.qnh ?? 1013;
    return us(a) ? `altimeter ${(q * 0.02953).toFixed(2).replace('.', '')}` : `QNH ${Math.round(q)}`;
  };
  const rwy = (r: string) => `runway ${r}`;
  const takeoff = (a: SimAirport) => (us(a) ? 'cleared for takeoff' : 'cleared for take-off');
  let sector = '';
  let lastFreq: string | undefined;
  const sid = leg.route?.sid?.name;
  const star = leg.route?.star?.name;
  const stand = leg.stand.ref;
  const heli = leg.kind === 'hems' || leg.kind === 'offshore' || leg.kind === 'shuttle';
  const glider = leg.kind === 'glider' || leg.kind === 'tow';
  if (glider) {
    for (const e of leg.events) {
      if (e.k === 'takeoff') say(e, 'pilot', `${placeName(from)} Radio`, '130.130', e.a === 'winch' ? `${cs}, all out, launching ${e.a}.` : `${cs}, tug and glider rolling, runway ${pad3(from.inUse.hdg).slice(0, 2)}.`);
      else if (e.k === 'release') say(e, 'pilot', 'Glider frequency', '130.130', `${cs}, released at ${(e.n ?? 0) * 100} feet.`);
      else if (e.k === 'land') say(e, 'pilot', `${placeName(from)} Radio`, '130.130', `${cs}, downwind, landing.`, -3 * 60_000);
    }
    return out;
  }
  for (const e of leg.events) {
    switch (e.k) {
      case 'canceled':
        out.push({ t: e.t, who: 'atc', station: 'Operations', text: `${leg.flight} to ${placeName(leg.canceledTo ?? to)} has been cancelled.` });
        break;
      case 'clearance': {
        if (heli) {
          const [st, f] = fac(from, from.site ? 'app' : 'twr');
          say(e, 'pilot', from.site ? `${placeName(from)} Radio` : st, from.site ? undefined : f, `${cs}, ${leg.kind === 'hems' ? 'HEMS mission, ' : ''}lifting from ${from.site === 'hospital' ? 'the hospital pad' : from.site === 'offshore' ? 'the deck' : placeName(from)}, routing to ${placeName(to)}${leg.kind === 'hems' ? ', request priority' : ''}.`);
          break;
        }
        const [st, f] = fac(from, 'del');
        if (ctx.ga) {
          say(e, 'pilot', fac(from, 'gnd')[0], fac(from, 'gnd')[1], `${cs}, ${ctx.typeName}, ${stand ? `at ${stand}` : 'on the apron'}, VFR to ${leg.kind === 'circuits' ? 'the circuit' : placeName(to)}, request taxi.`);
          break;
        }
        say(e, 'pilot', st, f, `${st}, ${cs}${stand ? `, stand ${stand}` : ''}, information ${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(e.t / 3_600_000) % 26]}, request clearance to ${placeName(leg.divertedFrom ?? to)}.`);
        const init = us(from) ? 'climb via SID, except maintain 5,000' : `climb altitude ${Math.round(5000 + from.elev / 1000) * 1000 > 6000 ? '6,000' : '5,000'} feet`;
        say(e, 'atc', st, f, `${cs}, cleared to ${placeName(leg.divertedFrom ?? to)}${sid ? ` via the ${sid} departure` : ''}, ${init}, squawk ${ctx.squawk}.`, 20_000);
        say(e, 'pilot', st, f, `Cleared ${placeName(leg.divertedFrom ?? to)}${sid ? `, ${sid}` : ''}, squawk ${ctx.squawk}, ${cs}.`, 35_000);
        break;
      }
      case 'edct': {
        const [st, f] = fac(from, 'del');
        say(e, 'atc', st, f, `${cs}, flow control: your departure is regulated, expect start-up in ${e.n} minutes.`);
        break;
      }
      case 'gatehold': {
        const [st, f] = fac(from, 'gnd');
        say(e, 'atc', st, f, `${cs}, departure sequencing in progress, hold on stand, expect push in ${e.n} minutes.`);
        break;
      }
      case 'pushback': {
        if (heli || ctx.ga) break;
        const [st, f] = fac(from, 'gnd');
        say(e, 'pilot', st, f, `${st}, ${cs}${stand ? `, stand ${stand}` : ''}, request push and start.`, -40_000);
        say(e, 'atc', st, f, `${cs}, push and start approved, facing ${cardinal((leg.stand.hdg ?? 0) + 180)}.`, -25_000);
        break;
      }
      case 'taxi': {
        if (heli) break;
        const [st, f] = fac(from, 'gnd');
        const t = leg.taxiOut;
        const via = t?.via.length ? ` via ${t.via.join(', ')}` : '';
        const target = t?.hold ? `holding point ${t.hold} ${rwy(from.inUse.ident)}` : us(from) ? rwy(from.inUse.ident) : `holding point ${rwy(from.inUse.ident)}`;
        const cross = t?.crossings.length ? `, cross ${t.crossings.map((c) => `runway ${c.split('/')[0]}`).join(' and ')}` : '';
        say(e, 'pilot', st, f, `${cs}, request taxi.`, -10_000);
        say(e, 'atc', st, f, `${cs}, taxi to ${target}${via}${us(from) ? cross : ''}, ${qnh(from)}.`);
        say(e, 'pilot', st, f, `Taxi ${target}${via}, ${cs}.`, 12_000);
        break;
      }
      case 'cross': {
        const [st, f] = fac(e.t < leg.tTakeoff ? from : to, 'twr');
        const r = e.a?.split('/')[0] ?? '';
        say(e, 'atc', st, f, `${cs}, cross runway ${r}.`, -8_000);
        say(e, 'pilot', st, f, `Crossing runway ${r}, ${cs}.`, -3_000);
        break;
      }
      case 'deice': {
        say(e, 'pilot', `${placeName(from)} De-icing`, undefined, `${cs}, on the pad, ready for de-icing, type I and type IV please.`);
        say(e, 'atc', `${placeName(from)} De-icing`, undefined, `${cs}, de-icing complete, type IV applied at time ${ctx.fmtTime(e.t + (e.n ?? 10) * 60_000)}, holdover time starts now.`, (e.n ?? 10) * 60_000 - 20_000);
        break;
      }
      case 'holdshort': {
        if (heli) break;
        const [st, f] = fac(from, 'twr');
        say(e, 'pilot', st, f, `${st}, ${cs}, ${e.a ? `holding point ${e.a}` : `holding short ${rwy(from.inUse.ident)}`}, ready for departure.`);
        say(e, 'atc', st, f, `${cs}, hold position.`, 8_000);
        break;
      }
      case 'lineup': {
        const [st, f] = fac(from, 'twr');
        say(e, 'atc', st, f, `${cs}, ${us(from) ? `${rwy(from.inUse.ident)}, line up and wait` : `line up and wait ${rwy(from.inUse.ident)}`}.`);
        say(e, 'pilot', st, f, `Line up and wait ${rwy(from.inUse.ident)}, ${cs}.`, 5_000);
        break;
      }
      case 'takeoff': {
        if (heli) break;
        const [st, f] = fac(from, 'twr');
        say(e, 'atc', st, f, `${cs}, ${windText(from)}, ${rwy(from.inUse.ident)}, ${takeoff(from)}.`, -6_000);
        say(e, 'pilot', st, f, `${us(from) ? 'Cleared for takeoff' : 'Cleared for take-off'} ${rwy(from.inUse.ident)}, ${cs}.`, -2_000);
        break;
      }
      case 'departure': {
        if (ctx.ga || heli) break;
        const [st, f] = fac(from, 'twr');
        const [dst, df] = fac(from, 'dep');
        say(e, 'atc', st, f, `${cs}, contact ${dst}${df ? ` ${df}` : ''}.`);
        say(e, 'pilot', dst, df, `${dst}, ${cs}, passing ${Math.round((from.elev + 2500) / 100) * 100} feet climbing ${us(from) ? '5,000' : 'altitude 5,000 feet'}${sid ? `, ${sid}` : ''}.`, 15_000);
        lastFreq = df;
        break;
      }
      case 'climb': {
        if (ctx.ga || heli) break;
        const [dst, df] = fac(from, 'dep');
        say(e, 'atc', dst, df, `${cs}, identified, climb ${level(e.n ?? 100)}${sid ? '' : ', proceed direct'}.`, 25_000);
        break;
      }
      case 'pos': {
        if (e.lat === undefined || e.lon === undefined) break;
        const next = sectorAt(e.lat, e.lon, ctx.countryAt(e.lat, e.lon));
        if (next === sector) break;
        const nf = sectorFreq(next);
        if (sector) say(e, 'atc', sector, lastFreq, `${cs}, contact ${next} ${nf}.`);
        else {
          const [dst, df] = fac(from, 'dep');
          say(e, 'atc', dst, df, `${cs}, contact ${next} ${nf}.`);
        }
        say(e, 'pilot', next, nf, `${next}, ${cs}, ${level(e.n ?? 350)}.`, 10_000);
        if (next.includes('Oceanic')) say(e, 'atc', next, nf, `${cs}, ${next.replace(' Oceanic', '')} Oceanic, identified, maintain Mach ${leg.route?.nat?.mach.toFixed(2).replace('0.', 'decimal ') ?? 'decimal eight two'}, report entering the next sector.`, 25_000);
        sector = next;
        lastFreq = nf;
        break;
      }
      case 'step':
        if (sector) {
          say(e, 'pilot', sector, lastFreq, `${cs}, request ${level(e.n ?? 370)}.`, -60_000);
          say(e, 'atc', sector, lastFreq, `${cs}, climb ${level(e.n ?? 370)}.`, -45_000);
        }
        break;
      case 'oceanic': {
        const nat = leg.route?.nat;
        if (!nat) break;
        const east = leg.to.lon > leg.from.lon;
        const oca = east ? 'Gander Oceanic' : 'Shanwick Oceanic';
        say(e, 'pilot', `${oca} (datalink)`, undefined, `${cs} request oceanic clearance, track ${nat.letter}, ${level(nat.fl)}, Mach ${nat.mach.toFixed(2)}.`, -20 * 60_000);
        say(e, 'atc', `${oca} (datalink)`, undefined, `${cs} cleared to ${placeName(to)} via track ${nat.letter} ${nat.text}, ${level(nat.fl)}, Mach ${nat.mach.toFixed(2)}.`, -18 * 60_000);
        break;
      }
      case 'oceanicExit':
        break;
      case 'emergency': {
        const field = leg.emergency?.divertTo ?? to;
        const st = sector || fac(from, 'dep')[0];
        if (e.a === 'medical') {
          say(e, 'pilot', st, lastFreq, `PAN PAN, PAN PAN, PAN PAN, ${st}, ${cs}, we have a medical emergency on board, request diversion to ${placeName(field)}, medical services on arrival.`);
          say(e, 'atc', st, lastFreq, `${cs}, roger PAN, cleared direct ${placeName(field)}, descend ${level(100)}, ambulance will be waiting.`, 25_000);
        } else {
          const what = e.a === 'engine' ? 'engine failure, number two engine shut down' : 'loss of cabin pressure, emergency descent';
          say(e, 'pilot', st, lastFreq, `MAYDAY, MAYDAY, MAYDAY, ${st}, ${cs}, ${what}, request immediate diversion to ${placeName(field)}.`);
          say(e, 'atc', st, lastFreq, `${cs}, roger MAYDAY, cleared direct ${placeName(field)}, descend at your discretion, emergency services alerted. Squawk 7700.`, 20_000);
        }
        break;
      }
      case 'divert': {
        if (leg.emergency) break;
        const st = sector || 'Approach';
        say(e, 'pilot', st, lastFreq, `${cs}, due to weather we'd like to divert to ${placeName(to)}.`);
        say(e, 'atc', st, lastFreq, `${cs}, cleared to ${placeName(to)}, direct, descend ${level(120)}.`, 20_000);
        break;
      }
      case 'descent': {
        if (!sector) break;
        say(e, 'atc', sector, lastFreq, `${cs}, descend ${level(e.n ?? 100)}${star ? `, expect the ${star} arrival` : ''}.`);
        say(e, 'pilot', sector, lastFreq, `Descend ${level(e.n ?? 100)}, ${cs}.`, 8_000);
        break;
      }
      case 'star': {
        const [ast, af] = fac(to, 'app');
        say(e, 'pilot', ast, af, `${ast}, ${cs}, ${star ? `${star} arrival, ` : ''}descending.`, -6 * 60_000);
        say(e, 'atc', ast, af, `${cs}, ${ast}, ${qnh(to)}.`, -5.6 * 60_000);
        lastFreq = af;
        break;
      }
      case 'hold': {
        const [ast, af] = fac(to, 'app');
        const efc = e.b ? Number(e.b) : e.t + 15 * 60_000;
        say(e, 'atc', ast, af, `${cs}, hold at ${e.a || 'the arrival fix'}, ${level(e.n ?? 100)}, expect onward clearance at ${ctx.fmtTime(efc - 6 * 60_000)}.`, -60_000);
        say(e, 'pilot', ast, af, `Hold at ${e.a || 'the fix'}, ${level(e.n ?? 100)}, ${cs}.`, -50_000);
        break;
      }
      case 'approach': {
        if (heli) break;
        const [ast, af] = fac(to, 'app');
        say(e, 'atc', ast, af, `${cs}, descend ${level(e.n ?? 30)}, ${qnh(to)}, reduce speed ${ctx.ga ? 90 : 210} knots, vectors for ${e.a ?? 'ILS'} approach.`);
        say(e, 'pilot', ast, af, `Descend ${level(e.n ?? 30)}, ${qnh(to)}, ${cs}.`, 8_000);
        break;
      }
      case 'final': {
        if (heli) break;
        const [ast, af] = fac(to, 'app');
        const [st, f] = fac(to, 'twr');
        const appr = leg.approach ?? `ILS ${to.inUse.ident}`;
        const kind = appr.startsWith('visual') ? 'visual approach' : `${appr.replace(/\s+\S+$/, '')} approach`;
        say(e, 'atc', ast, af, `${cs}, cleared ${kind} ${rwy(e.a ?? to.inUse.ident)}, contact ${st}${f ? ` ${f}` : ''}.`, -2.5 * 60_000);
        say(e, 'pilot', st, f, `${st}, ${cs}, established ${kind.replace(' approach', '')} ${rwy(e.a ?? to.inUse.ident)}.`, -2 * 60_000);
        say(e, 'atc', st, f, `${cs}, ${windText(to)}, ${rwy(e.a ?? to.inUse.ident)}, cleared to land.`, -90_000);
        break;
      }
      case 'goaround': {
        const [st, f] = fac(to, 'twr');
        say(e, 'pilot', st, f, `${cs}, going around.`);
        say(e, 'atc', st, f, `${cs}, roger, climb 3,000 feet, runway heading, contact Approach.`, 6_000);
        break;
      }
      case 'circuit': {
        const [st, f] = fac(from, 'twr');
        say(e, 'pilot', st, f, `${cs}, downwind ${rwy(from.inUse.ident)}, touch and go.`, 2 * 60_000);
        say(e, 'atc', st, f, `${cs}, ${windText(from)}, ${rwy(from.inUse.ident)}, cleared touch and go.`, 3.5 * 60_000);
        break;
      }
      case 'orbit': {
        const st = sector || fac(from, 'dep')[0];
        const what = e.a === 'tanker' ? 'established in the refuelling area' : e.a === 'awacs' ? 'on station' : e.a === 'patrol' ? 'commencing patrol' : 'entering the training area';
        say(e, 'pilot', st, lastFreq, `${cs}, ${what}, ${level(e.n ?? 250)}.`);
        say(e, 'atc', st, lastFreq, `${cs}, roger, report leaving the area.`, 10_000);
        break;
      }
      case 'vacate': {
        if (heli) break;
        const [st, f] = fac(to, 'twr');
        const [gst, gf] = fac(to, 'gnd');
        say(e, 'atc', st, f, `${cs}, vacate ${e.a ? `via ${e.a}` : 'next available'}, contact ${gst}${gf ? ` ${gf}` : ''}.`, -15_000);
        break;
      }
      case 'taxiIn': {
        if (heli) break;
        const [gst, gf] = fac(to, 'gnd');
        const t = leg.taxiIn;
        const via = t?.via.length ? ` via ${t.via.join(', ')}` : '';
        const dest = leg.standTo.ref ? `stand ${leg.standTo.ref}` : ctx.ga ? 'the apron' : 'your stand';
        say(e, 'pilot', gst, gf, `${gst}, ${cs}, runway vacated${t?.exit ? ` via ${t.exit}` : ''}.`);
        say(e, 'atc', gst, gf, `${cs}, taxi to ${dest}${via}.`, 6_000);
        break;
      }
      case 'land':
        if (heli) {
          const [st, f] = to.site ? [`${placeName(to)} Radio`, undefined] : fac(to, 'twr');
          say(e, 'pilot', st, f, `${cs}, landing ${to.site === 'offshore' ? 'on the deck' : to.site === 'hospital' ? 'at the hospital pad' : `at ${placeName(to)}`}.`, -60_000);
        }
        break;
      case 'scene': {
        say(e, 'pilot', `${placeName(from)} Radio`, undefined, `${cs}, landing at the scene, will call lifting.`, -60_000);
        break;
      }
      default:
        break;
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Text for speech synthesis: digits and suffix letters read the ATC way. */
export function speakable(text: string): string {
  const NATO: Record<string, string> = { A: 'alpha', B: 'bravo', C: 'charlie', D: 'delta', E: 'echo', F: 'foxtrot', G: 'golf', H: 'hotel', I: 'india', J: 'juliett', K: 'kilo', L: 'lima', M: 'mike', N: 'november', O: 'oscar', P: 'papa', Q: 'quebec', R: 'romeo', S: 'sierra', T: 'tango', U: 'uniform', V: 'victor', W: 'whiskey', X: 'x-ray', Y: 'yankee', Z: 'zulu' };
  const DIG = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
  return text
    .replace(/(\d{1,2}),000 feet/g, (_, a: string) => `${a} thousand feet`)
    .replace(/\b(\d+)\.(\d+)\b/g, (_, a: string, b: string) => `${[...a].map((d) => DIG[+d]).join(' ')} decimal ${[...b].map((d) => DIG[+d]).join(' ')}`)
    .replace(/\brunway (\d{2})([LRC])?\b/gi, (_, d: string, s?: string) => `runway ${[...d].map((x) => DIG[+x]).join(' ')}${s ? ` ${{ L: 'left', R: 'right', C: 'center' }[s.toUpperCase() as 'L']}` : ''}`)
    .replace(/\b(\d+)([A-Z]{1,2})\b/g, (_, d: string, l: string) => `${[...d].map((x) => DIG[+x]).join(' ')} ${[...l].map((x) => NATO[x] ?? x).join(' ')}`)
    .replace(/\b\d+\b/g, (n) => [...n].map((d) => DIG[+d]).join(' '));
}
