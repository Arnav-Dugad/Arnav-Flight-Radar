// Airport panel features: codeshare-aware boards, the route network, procedure constraints,
// curfew windows, great-circle arcs and the scanner's hand-offs and go-around phraseology.
import { describe, expect, it } from 'vitest';
import type { Leg, LegEvent, SimAirport } from '@/data/sim/engine';
import { transcript } from '@/data/sim/radio';
import type { BoardRow, RouteDest } from '@/data/world';
import { boardEntries, spacedFlight, terminalCode } from '@/features/airports/AirportBoards';
import { inCurfew } from '@/features/airports/AirportOpsStrip';
import { fmtConstraint, procedureFixes } from '@/features/airports/AirportProcedures';
import { channelFreq, channelOfStation, handoffOf } from '@/features/airports/AirportRadio';
import { filterRoutes, groupRoutes, routeAirlines } from '@/features/airports/AirportRoutes';
import { greatCircle } from '@/map/airportRoutesOverlay';

const apt = (ident: string, iata: string, city: string, country: string, lat = 0, lon = 0) => ({ ident, iata, name: `${city} Airport`, city, country, lat, lon }) as unknown as SimAirport;

describe('codeshare-aware boards', () => {
  const row = (flight: string, codeshares: string[]) => ({ id: `~${flight}`, flight, codeshares }) as unknown as BoardRow;
  const rows = [row('BA117', ['AA6136', 'IB4021']), row('VS3', [])];
  it('shows one line per operating flight by default', () => {
    expect(boardEntries(rows, false).map((e) => e.code ?? e.row.flight)).toEqual(['BA117', 'VS3']);
  });
  it('lists every codeshare number as its own line right after the operating flight', () => {
    const e = boardEntries(rows, true);
    expect(e.map((x) => x.code ?? x.row.flight)).toEqual(['BA117', 'AA6136', 'IB4021', 'VS3']);
    expect(e[1]!.row).toBe(rows[0]); // links to the operating flight
  });
  it('formats flight numbers and terminals like a FIDS', () => {
    expect(spacedFlight('EK1234')).toBe('EK 1234');
    expect(spacedFlight('6E2031')).toBe('6E 2031');
    expect(spacedFlight('BAW117')).toBe('BAW117');
    expect(terminalCode('Terminal 5')).toBe('T5');
    expect(terminalCode('North Terminal')).toBe('N');
  });
});

describe('route network', () => {
  const dest = (a: SimAirport, perWeek: number, airlines: [string, string][]): RouteDest => ({ airport: a, perWeek, distNm: 100, airlines: airlines.map(([icao, name]) => ({ icao, name })) });
  const list = [
    dest(apt('KJFK', 'JFK', 'New York', 'US'), 70, [['BAW', 'British Airways'], ['AAL', 'American']]),
    dest(apt('LFPG', 'CDG', 'Paris', 'FR'), 84, [['BAW', 'British Airways'], ['AFR', 'Air France']]),
    dest(apt('LFMN', 'NCE', 'Nice', 'FR'), 21, [['EZY', 'easyJet']]),
    dest(apt('KLAX', 'LAX', 'Los Angeles', 'US'), 14, [['BAW', 'British Airways']]),
  ];
  const countries = [
    { code: 'US', name: 'United States', continent: 'NA' },
    { code: 'FR', name: 'France', continent: 'EU' },
  ];
  it('filters by airline and by city, code or country name', () => {
    expect(filterRoutes(list, { airline: 'BAW' }).map((d) => d.airport.iata)).toEqual(['JFK', 'CDG', 'LAX']);
    expect(filterRoutes(list, { query: 'nce' }).map((d) => d.airport.iata)).toEqual(['NCE']);
    expect(filterRoutes(list, { query: 'france', countryName: (c) => countries.find((x) => x.code === c)!.name }).map((d) => d.airport.iata)).toEqual(['CDG', 'NCE']);
  });
  it('groups by region then country, busiest first', () => {
    const g = groupRoutes(list, countries);
    expect(g.map((x) => [x.label, x.perWeek])).toEqual([
      ['Europe', 105],
      ['North America', 84],
    ]);
    expect(g[1]!.countries[0]!.dests.map((d) => d.airport.iata)).toEqual(['JFK', 'LAX']);
  });
  it('ranks airlines by the number of destinations they serve', () => {
    expect(routeAirlines(list)[0]).toEqual({ icao: 'BAW', name: 'British Airways', dests: 3 });
  });
  it('draws great circles without jumping across the antimeridian', () => {
    const arc = greatCircle([139.78, 35.55], [-122.38, 37.62]); // Tokyo → San Francisco
    expect(arc.length).toBeGreaterThan(10);
    for (let i = 1; i < arc.length; i++) expect(Math.abs(arc[i]![0] - arc[i - 1]![0])).toBeLessThan(30);
    expect(arc.at(-1)![0]).toBeCloseTo(-122.38 + 360, 5);
    // A great circle Tokyo → SFO arcs north of both ends.
    expect(Math.max(...arc.map((p) => p[1]))).toBeGreaterThan(45);
  });
});

describe('procedures and operations', () => {
  it('formats published altitude constraints', () => {
    expect(fmtConstraint({ altMin: 5000 })).toBe('≥5,000');
    expect(fmtConstraint({ altMax: 11000 })).toBe('≤11,000');
    expect(fmtConstraint({ altMin: 9000, altMax: 9000 })).toBe('9,000');
    expect(fmtConstraint({ altMin: 11000, altMax: 19000 })).toBe('11,000–FL190');
    expect(fmtConstraint({})).toBeUndefined();
  });
  it('uses the single fix of a simulated procedure', () => {
    const fix = { ident: 'DET', lat: 51.3, lon: 0.6, real: true };
    expect(procedureFixes({ name: 'DET 2F', fix })).toEqual([fix]);
  });
  it('knows when a night curfew is in force, across midnight', () => {
    const c = { from: '23:30', to: '06:00' };
    expect(inCurfew('23:45', c)).toBe(true);
    expect(inCurfew('02:10', c)).toBe(true);
    expect(inCurfew('06:00', c)).toBe(false);
    expect(inCurfew('14:00', c)).toBe(false);
    expect(inCurfew('01:00', { from: '00:00', to: '05:00' })).toBe(true);
  });
});

describe('scanner channels', () => {
  const freqs = [
    { type: 'TWR', mhz: 118.5 },
    { type: 'APP', mhz: 119.725 },
    { type: 'DEP', mhz: 120.4 },
  ];
  it('gives Departure and Approach their own frequency, falling back to each other', () => {
    expect(channelFreq(freqs, 'dep')).toBe(120.4);
    expect(channelFreq(freqs, 'app')).toBe(119.725);
    expect(channelFreq([{ type: 'APP', mhz: 119.725 }], 'dep')).toBe(119.725);
  });
  it('recognises hand-offs to another of the airport channels', () => {
    expect(channelOfStation('London Departure')).toBe('dep');
    expect(channelOfStation('Kennedy Clearance')).toBe('del');
    expect(handoffOf('Speedbird 12A, contact London Departure 120.4, good day.')).toEqual({ station: 'London Departure', channel: 'dep' });
    expect(handoffOf('Speedbird 12A, cleared ILS approach runway 27L, contact Heathrow Tower 118.5.')?.channel).toBe('twr');
    expect(handoffOf('Speedbird 12A, contact London Control 127.105.')).toBeUndefined();
  });
});

describe('radio hand-offs and go-arounds', () => {
  const lhr = { ...apt('EGLL', 'LHR', 'London', 'GB', 51.47, -0.45), name: 'London Heathrow Airport', elev: 83, inUse: { ident: '27L', hdg: 270 }, inUseDep: { ident: '27R', hdg: 270 } } as unknown as SimAirport;
  const cdg = { ...apt('LFPG', 'CDG', 'Paris', 'FR', 49.0, 2.55), name: 'Charles de Gaulle International Airport', elev: 392, inUse: { ident: '27R', hdg: 270 } } as unknown as SimAirport;
  const T = Date.UTC(2026, 6, 15, 12, 0);
  const ev = (k: string, dt: number, extra: Partial<LegEvent> = {}) => ({ k, t: T + dt * 60_000, ...extra }) as LegEvent;
  const leg = (events: LegEvent[]) =>
    ({ from: lhr, to: cdg, events, flight: 'BAW12A', kind: 'scheduled', stand: { ref: '512' }, standTo: { ref: 'F21' }, tTakeoff: T + 15 * 60_000, taxiOut: { runway: '27R', via: ['A'], crossings: [] } }) as unknown as Leg;
  const freq = (_: string, k: string) => ({ twr: 118.5, app: 119.725, dep: 120.4, gnd: 121.9, del: 121.975 })[k];
  const run = (events: LegEvent[]) => transcript({ leg: leg(events), callsign: 'Speedbird 12A', wake: 'M', freq, countryAt: () => 'GB', squawk: '4521', typeName: 'Airbus A320', fmtTime: () => '1200', ga: false });

  it('hands departures from Tower to Departure, with a read-back on the tower frequency, and takes off from the departure runway', () => {
    const lines = run([ev('takeoff', 15), ev('departure', 16)]);
    expect(lines.find((l) => l.who === 'atc' && /cleared for take-off/.test(l.text))!.text).toMatch(/runway 27R/);
    const handoff = lines.find((l) => l.station === 'Heathrow Tower' && /contact London Departure 120\.4/.test(l.text));
    expect(handoff).toBeDefined();
    expect(lines.some((l) => l.station === 'Heathrow Tower' && l.who === 'pilot' && /^Departure 120\.40?, Speedbird 12A/.test(l.text))).toBe(true);
    expect(lines.some((l) => l.station === 'London Departure' && l.who === 'pilot' && /^London Departure, Speedbird 12A/.test(l.text))).toBe(true);
  });

  it('hands arrivals from Approach to Tower on final', () => {
    const lines = run([ev('final', 60, { a: '27R' })]);
    const app = lines.filter((l) => l.station === 'Paris Approach');
    expect(app.some((l) => l.who === 'atc' && /contact de Gaulle Tower 118\.5/.test(l.text))).toBe(true);
    expect(app.some((l) => l.who === 'pilot' && /Tower 118\.50?, Speedbird 12A/.test(l.text))).toBe(true);
    expect(lines.some((l) => l.station === 'de Gaulle Tower' && /cleared to land/.test(l.text))).toBe(true);
  });

  it('has Tower call the go-around when the runway is occupied, and the crew reads back', () => {
    const lines = run([ev('goaround', 58, { a: '27R', b: 'occupied' })]);
    const i = lines.findIndex((l) => l.who === 'atc' && l.text === 'Speedbird 12A, go around, I say again, go around, traffic on the runway.');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(lines[i + 1]).toMatchObject({ who: 'pilot', text: 'Going around, Speedbird 12A.' });
    expect(lines.some((l) => l.station === 'Paris Approach' && l.who === 'pilot' && /go-around/.test(l.text))).toBe(true);
  });

  it('keeps the pilot-initiated go-around otherwise', () => {
    const lines = run([ev('goaround', 58, { a: '27R' })]);
    expect(lines[0]).toMatchObject({ who: 'pilot', text: 'Speedbird 12A, going around.' });
    expect(lines.some((l) => /I say again/.test(l.text))).toBe(false);
    for (let i = 1; i < lines.length; i++) expect(lines[i]!.t).toBeGreaterThanOrEqual(lines[i - 1]!.t);
  });
});
