// Fixtures here are SYNTHETIC records shaped like adsb.fi output — never used as live data.
import { describe, expect, it } from 'vitest';
import { normalizeAdsbfi, normalizeAdsbfiRecord, parseAdsbfiEnvelope } from '../../shared/normalize';

const NOW = 1_800_000_000_000;

const base = {
  hex: '400a5b',
  type: 'adsb_icao',
  flight: 'BAW617  ',
  r: 'G-DBCA',
  t: 'A319',
  desc: 'AIRBUS A-319',
  alt_baro: 3425,
  alt_geom: 4125,
  gs: 206.7,
  track: 32.15,
  baro_rate: -1920,
  squawk: '5707',
  emergency: 'none',
  category: 'A3',
  lat: 51.451768,
  lon: -0.809402,
  seen_pos: 1.5,
  seen: 0.2,
  ias: 278,
  mach: 0.724,
  nav_qnh: 1032.8,
  dst: 13.459,
};

describe('normalizeAdsbfiRecord', () => {
  it('maps every supported field with explicit units', () => {
    const a = normalizeAdsbfiRecord(base, NOW, NOW + 100)!;
    expect(a).toMatchObject({
      id: '400a5b',
      icao24: '400a5b',
      callsign: 'BAW617',
      registration: 'G-DBCA',
      aircraftType: 'A319',
      typeDescription: 'AIRBUS A-319',
      category: 'A3',
      altitudeBarometric: 3425,
      altitudeGeometric: 4125,
      groundSpeed: 206.7,
      verticalRate: -1920,
      squawk: '5707',
      onGround: false,
      positionSource: 'adsb',
      provider: 'adsbfi',
      freshness: 'live',
      distanceNm: 13.46,
    });
    expect(a.track).toBeCloseTo(32.15, 1);
    expect(a.observedAt).toBe(NOW - 1500);
    expect(a.seenAt).toBe(NOW - 200);
    expect(a.receivedAt).toBe(NOW + 100);
    expect(a.emergency).toBeUndefined(); // "none" is not an emergency
    expect(a.ext?.ias).toBe(278);
    expect(a.ext?.navQnh).toBe(1032.8);
  });

  it('treats alt_baro "ground" as on-ground with no barometric altitude', () => {
    const a = normalizeAdsbfiRecord({ ...base, alt_baro: 'ground' }, NOW, NOW)!;
    expect(a.onGround).toBe(true);
    expect(a.altitudeBarometric).toBeUndefined();
  });

  it('never invents missing values', () => {
    const minimal = { hex: 'abc123', type: 'mlat', lat: 10, lon: 20, seen_pos: 3 };
    const a = normalizeAdsbfiRecord(minimal, NOW, NOW)!;
    expect(a.positionSource).toBe('mlat');
    for (const k of ['callsign', 'registration', 'aircraftType', 'altitudeBarometric', 'groundSpeed', 'track', 'verticalRate', 'squawk', 'military', 'ext'] as const) {
      expect(a[k]).toBeUndefined();
    }
  });

  it('rejects records without a valid position or timestamp', () => {
    expect(normalizeAdsbfiRecord({ ...base, lat: undefined }, NOW, NOW)).toBeNull();
    expect(normalizeAdsbfiRecord({ ...base, lat: 91 }, NOW, NOW)).toBeNull();
    expect(normalizeAdsbfiRecord({ ...base, lon: 'x' }, NOW, NOW)).toBeNull();
    expect(normalizeAdsbfiRecord({ ...base, seen_pos: undefined, seen: undefined }, NOW, NOW)).toBeNull();
    expect(normalizeAdsbfiRecord({ ...base, hex: 'zzzzzz' }, NOW, NOW)).toBeNull();
    expect(normalizeAdsbfiRecord(null, NOW, NOW)).toBeNull();
  });

  it('drops implausible values instead of fixing them', () => {
    const a = normalizeAdsbfiRecord({ ...base, alt_baro: 250000, gs: -5, track: 400, baro_rate: 90000, squawk: '9999', category: 'Z9' }, NOW, NOW)!;
    expect(a.altitudeBarometric).toBeUndefined();
    expect(a.groundSpeed).toBeUndefined();
    expect(a.track).toBeUndefined();
    expect(a.verticalRate).toBeUndefined();
    expect(a.squawk).toBeUndefined();
    expect(a.category).toBeUndefined();
  });

  it('falls back to geometric rate and keeps emergencies', () => {
    const a = normalizeAdsbfiRecord({ ...base, baro_rate: undefined, geom_rate: 640, emergency: 'general', squawk: '7700' }, NOW, NOW)!;
    expect(a.verticalRate).toBe(640);
    expect(a.emergency).toBe('general');
  });

  it('flags military only from the database bit', () => {
    expect(normalizeAdsbfiRecord({ ...base, dbFlags: 1 }, NOW, NOW)!.military).toBe(true);
    expect(normalizeAdsbfiRecord({ ...base, dbFlags: 8 }, NOW, NOW)!.military).toBeUndefined();
  });

  it('marks old positions as stale', () => {
    expect(normalizeAdsbfiRecord({ ...base, seen_pos: 45 }, NOW, NOW)!.freshness).toBe('stale');
  });

  it('keeps non-ICAO (TIS-B) addresses distinct', () => {
    const a = normalizeAdsbfiRecord({ ...base, hex: '~1a2b3c', type: 'tisb_other' }, NOW, NOW)!;
    expect(a.id).toBe('~1a2b3c');
    expect(a.positionSource).toBe('tisb');
  });
});

describe('envelope handling', () => {
  it('accepts ac and aircraft lists and second/ms timestamps', () => {
    expect(parseAdsbfiEnvelope({ ac: [], now: NOW }).now).toBe(NOW);
    expect(parseAdsbfiEnvelope({ aircraft: [], now: NOW / 1000 }).now).toBe(NOW);
  });

  it('throws on unexpected shapes', () => {
    expect(() => parseAdsbfiEnvelope({ error: 'nope' })).toThrow();
    expect(() => parseAdsbfiEnvelope('x')).toThrow();
  });

  it('de-duplicates by address keeping the newest position', () => {
    const r = normalizeAdsbfi({ now: NOW, ac: [{ ...base, seen_pos: 10, lat: 1 }, { ...base, seen_pos: 2, lat: 2 }, { hex: 'bad' }] }, NOW);
    expect(r.aircraft).toHaveLength(1);
    expect(r.aircraft[0]!.lat).toBe(2);
  });

  it('handles an empty area', () => {
    expect(normalizeAdsbfi({ now: NOW, ac: [] }).aircraft).toEqual([]);
  });
});
