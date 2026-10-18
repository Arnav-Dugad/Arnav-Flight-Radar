import { describe, expect, it } from 'vitest';
import { decodeRow, detailShard, makeSearchable, searchAirports, type AirportRow } from '../../shared/airports';
import { classificationBasis, classifyAircraft } from '../../shared/classify';
import { countryFromIcao } from '../../shared/icaoCountry';
import { classifyAircraftQuery } from '../../shared/query';
import { computeStats } from '../../shared/stats';
import type { Aircraft } from '../../shared/types';
import { decodeWeather, normalizeMetar, normalizeTaf } from '../../shared/weather';

const ac = (o: Partial<Aircraft>): Aircraft => ({
  id: 'abc123',
  icao24: 'abc123',
  lat: 0,
  lon: 0,
  onGround: false,
  positionSource: 'adsb',
  observedAt: 0,
  seenAt: 0,
  receivedAt: 0,
  provider: 'sim',
  freshness: 'live',
  ...o,
});

describe('classification', () => {
  it('uses the ICAO type designator first', () => {
    expect(classifyAircraft({ aircraftType: 'B77W' })).toBe('widebody');
    expect(classifyAircraft({ aircraftType: 'A20N' })).toBe('narrowbody');
    expect(classifyAircraft({ aircraftType: 'AT76' })).toBe('turboprop');
    expect(classifyAircraft({ aircraftType: 'CRJ9' })).toBe('regional');
    expect(classifyAircraft({ aircraftType: 'C68A' })).toBe('bizjet');
    expect(classifyAircraft({ aircraftType: 'EC35' })).toBe('helicopter');
  });
  it('falls back to emitter category, then generic', () => {
    expect(classifyAircraft({ category: 'A7' })).toBe('helicopter');
    expect(classifyAircraft({ category: 'B1' })).toBe('glider');
    expect(classifyAircraft({ category: 'A5' })).toBe('widebody');
    expect(classifyAircraft({ category: 'A3' })).toBe('unknown'); // too broad to call
    expect(classifyAircraft({})).toBe('unknown');
    expect(classifyAircraft({ aircraftType: 'ZZZZ' })).toBe('unknown');
  });
  it('honours the military database flag', () => {
    expect(classifyAircraft({ aircraftType: 'B738', military: true })).toBe('military');
    expect(classifyAircraft({ aircraftType: 'H60', military: true })).toBe('helicopter');
    expect(classificationBasis({ military: true })).toMatch(/Military/);
  });
});

describe('aircraft query classification', () => {
  it.each([
    ['BAW123', 'callsign'],
    ['g-dbca', 'registration'],
    ['N123AB', 'registration'],
    ['4066b9', 'hex'],
    ['7700', 'sqk'],
  ])('%s → %s', (q, kind) => {
    expect(classifyAircraftQuery(q)?.kind).toBe(kind);
  });
  it('rejects nonsense and honours forced kinds', () => {
    expect(classifyAircraftQuery('')).toBeNull();
    expect(classifyAircraftQuery('this is far too long')).toBeNull();
    expect(classifyAircraftQuery('ABC123', 'hex')?.value).toBe('abc123');
    expect(classifyAircraftQuery('BAW', 'hex')).toBeNull();
  });
});

describe('registry country from ICAO address', () => {
  it('maps well-known blocks', () => {
    expect(countryFromIcao('400a5b')?.iso).toBe('GB');
    expect(countryFromIcao('8018df')?.iso).toBe('IN');
    expect(countryFromIcao('a1b2c3')?.iso).toBe('US');
    expect(countryFromIcao('896123')?.iso).toBe('AE');
    expect(countryFromIcao('~123456')).toBeUndefined();
    expect(countryFromIcao('000001')).toBeUndefined();
  });
});

describe('airports', () => {
  const rows: AirportRow[] = [
    ['EGLL', 'EGLL', 'LHR', 'London Heathrow Airport', 'London', 'GB', 51.47, -0.46, 0, 83, 1],
    ['EGKK', 'EGKK', 'LGW', 'London Gatwick Airport', 'London', 'GB', 51.15, -0.19, 0, 202, 1],
    ['VABB', 'VABB', 'BOM', 'Chhatrapati Shivaji Maharaj International Airport', 'Mumbai', 'IN', 19.09, 72.87, 0, 39, 1],
    ['EG01', '', '', 'Heathrow Farm Strip', 'Nowhere', 'GB', 52, -1, 2, null, 0],
  ];
  const list = makeSearchable(rows.map(decodeRow));

  it('decodes compact rows', () => {
    const a = decodeRow(rows[0]!);
    expect(a).toMatchObject({ ident: 'EGLL', iata: 'LHR', type: 'large_airport', scheduled: true, elevationFt: 83 });
    expect(decodeRow(rows[3]!).elevationFt).toBeUndefined();
  });

  it('ranks exact codes first, then names and cities', () => {
    expect(searchAirports(list, 'lhr')[0]?.ident).toBe('EGLL');
    expect(searchAirports(list, 'VABB')[0]?.ident).toBe('VABB');
    expect(searchAirports(list, 'mumbai')[0]?.ident).toBe('VABB');
    expect(searchAirports(list, 'heathrow')[0]?.ident).toBe('EGLL');
    expect(searchAirports(list, 'london').map((a) => a.ident)).toEqual(expect.arrayContaining(['EGLL', 'EGKK']));
    expect(searchAirports(list, 'london', { country: 'IN' })).toEqual([]);
    expect(searchAirports(list, '')).toEqual([]);
  });

  it('shards details by ident prefix', () => {
    expect(detailShard('EGLL')).toBe('EG');
    expect(detailShard('00AK')).toBe('00');
    expect(detailShard('a-b')).toBe('A_');
  });
});

describe('statistics', () => {
  it('summarizes an observed population without inventing values', () => {
    const list = [
      ac({ id: '1', altitudeBarometric: 35000, groundSpeed: 480, verticalRate: 0, aircraftType: 'A320', callsign: 'AAA1' }),
      ac({ id: '2', altitudeBarometric: 4000, groundSpeed: 180, verticalRate: 1500, aircraftType: 'A320' }),
      ac({ id: '3', onGround: true, groundSpeed: 12, aircraftType: 'B738' }),
      ac({ id: '4', squawk: '7700', freshness: 'stale' }),
    ];
    const s = computeStats(list);
    expect(s.sample).toBe(4);
    expect(s.airborne).toBe(3);
    expect(s.onGround).toBe(1);
    expect(s.climbing).toBe(1);
    expect(s.level).toBe(1);
    expect(s.verticalUnknown).toBe(1);
    expect(s.avgAltitudeFt).toBe(19500);
    expect(s.altitudeKnown).toBe(2);
    expect(s.maxAltitude?.id).toBe('1');
    expect(s.byType[0]).toEqual({ type: 'A320', count: 2 });
    expect(s.emergencies).toHaveLength(1);
    expect(s.freshness).toEqual({ live: 3, stale: 1 });
  });
  it('handles an empty sample', () => {
    const s = computeStats([]);
    expect(s.sample).toBe(0);
    expect(s.avgAltitudeFt).toBeUndefined();
  });
});

describe('weather normalization', () => {
  it('normalizes METAR JSON', () => {
    const m = normalizeMetar({
      icaoId: 'KJFK',
      obsTime: 1792266660,
      rawOb: 'METAR KJFK 171951Z 35016G23KT 10SM FEW047 BKN190 11/M03 A3022',
      temp: 11.1,
      dewp: -2.8,
      wdir: 350,
      wspd: 16,
      wgst: 23,
      visib: '10+',
      altim: 1023.5,
      clouds: [{ cover: 'FEW', base: 4700 }, { cover: 'BKN', base: 19000 }],
      fltCat: 'VFR',
    })!;
    expect(m).toMatchObject({ station: 'KJFK', windDirDeg: 350, windGustKt: 23, visibility: '10+', flightCategory: 'VFR' });
    expect(m.observedAt).toBe(1792266660000);
    expect(m.clouds).toHaveLength(2);
  });
  it('handles variable wind and rejects incomplete records', () => {
    expect(normalizeMetar({ icaoId: 'EGLL', obsTime: 1, rawOb: 'x', wdir: 'VRB', wspd: 3, clouds: [] })!.windVariable).toBe(true);
    expect(normalizeMetar({ icaoId: 'EGLL' })).toBeNull();
    expect(normalizeMetar(null)).toBeNull();
  });
  it('normalizes TAF periods', () => {
    const t = normalizeTaf({
      icaoId: 'EGLL',
      rawTAF: 'TAF EGLL ...',
      validTimeFrom: 100,
      validTimeTo: 200,
      issueTime: '2026-10-17T16:52:00.000Z',
      fcsts: [{ timeFrom: 100, timeTo: 200, wdir: 10, wspd: 10, visib: '6+', clouds: [{ cover: 'SCT', base: 3000 }] }, { timeFrom: 150, timeTo: 180, fcstChange: 'TEMPO', probability: 30, wxString: '-SHRA', clouds: [] }],
    })!;
    expect(t.periods).toHaveLength(2);
    expect(t.periods[1]).toMatchObject({ change: 'TEMPO', probability: 30, weather: '-SHRA' });
    expect(t.issuedAt).toBe(Date.parse('2026-10-17T16:52:00.000Z'));
  });
  it('decodes present weather', () => {
    expect(decodeWeather('-SHRA BR')).toBe('light showers of rain, mist');
    expect(decodeWeather('+TSRA')).toBe('heavy thunderstorm rain');
  });
});
