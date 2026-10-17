import { describe, expect, it } from 'vitest';
import { angleDelta, bearingDeg, destination, distanceNm, isValidCoordinate, lerpAngle, lerpPosition, normalizeLon, parseCoordinates } from '../../shared/geo';
import { convertAltitude, convertDistance, convertSpeed, convertTemperature, convertVerticalRate, ftToM, mToFt } from '../../shared/units';

describe('coordinate validation', () => {
  it('accepts valid and rejects invalid coordinates', () => {
    expect(isValidCoordinate(51.47, -0.45)).toBe(true);
    expect(isValidCoordinate(90, 180)).toBe(true);
    expect(isValidCoordinate(90.1, 0)).toBe(false);
    expect(isValidCoordinate(0, -180.5)).toBe(false);
    expect(isValidCoordinate(Number.NaN, 0)).toBe(false);
    expect(isValidCoordinate(null, 0)).toBe(false);
    expect(isValidCoordinate('51', 0)).toBe(false);
  });

  it('normalizes longitude across the antimeridian', () => {
    expect(normalizeLon(190)).toBeCloseTo(-170);
    expect(normalizeLon(-190)).toBeCloseTo(170);
    expect(normalizeLon(180)).toBe(180);
    expect(normalizeLon(0)).toBe(0);
  });
});

describe('geodesy', () => {
  it('computes London–New York distance (≈ 2,999 NM)', () => {
    const d = distanceNm(51.47, -0.4543, 40.6398, -73.7789);
    expect(d).toBeGreaterThan(2980);
    expect(d).toBeLessThan(3010);
  });

  it('computes cardinal bearings', () => {
    expect(bearingDeg(0, 0, 1, 0)).toBeCloseTo(0, 5);
    expect(bearingDeg(0, 0, 0, 1)).toBeCloseTo(90, 5);
    expect(bearingDeg(0, 0, -1, 0)).toBeCloseTo(180, 5);
    expect(bearingDeg(0, 0, 0, -1)).toBeCloseTo(270, 5);
  });

  it('destination round-trips with distance', () => {
    const [lat, lon] = destination(12.95, 77.6, 45, 120);
    expect(distanceNm(12.95, 77.6, lat, lon)).toBeCloseTo(120, 1);
  });

  it('interpolates angles the short way round', () => {
    expect(angleDelta(350, 10)).toBeCloseTo(20);
    expect(angleDelta(10, 350)).toBeCloseTo(-20);
    expect(lerpAngle(350, 10, 0.5)).toBeCloseTo(0);
  });

  it('interpolates positions across the antimeridian', () => {
    const [, lon] = lerpPosition([0, 179], [0, -179], 0.5);
    expect(Math.abs(lon)).toBeCloseTo(180);
  });
});

describe('coordinate parsing', () => {
  it.each([
    ['51.47, -0.45', [51.47, -0.45]],
    ['51.47N 0.45W', [51.47, -0.45]],
    ['-33.9 151.2', [-33.9, 151.2]],
    ['12.95° N, 77.6° E', [12.95, 77.6]],
  ])('parses %s', (input, expected) => {
    const r = parseCoordinates(input);
    expect(r).not.toBeNull();
    expect(r![0]).toBeCloseTo(expected[0]!);
    expect(r![1]).toBeCloseTo(expected[1]!);
  });

  it.each(['hello', '95, 10', '10, 200', 'BAW123'])('rejects %s', (input) => {
    expect(parseCoordinates(input)).toBeNull();
  });
});

describe('unit conversion', () => {
  it('converts altitude', () => {
    expect(convertAltitude(10000, 'ft')).toBe(10000);
    expect(convertAltitude(10000, 'm')).toBeCloseTo(3048, 0);
    expect(convertAltitude(35000, 'fl')).toBe(350);
    expect(mToFt(ftToM(1234))).toBeCloseTo(1234);
  });
  it('converts speed', () => {
    expect(convertSpeed(100, 'kmh')).toBeCloseTo(185.2);
    expect(convertSpeed(100, 'mph')).toBeCloseTo(115.08, 1);
    expect(convertSpeed(100, 'ms')).toBeCloseTo(51.44, 1);
  });
  it('converts distance, vertical rate and temperature', () => {
    expect(convertDistance(10, 'km')).toBeCloseTo(18.52);
    expect(convertDistance(10, 'mi')).toBeCloseTo(11.5078, 3);
    expect(convertVerticalRate(1000, 'ms')).toBeCloseTo(5.08);
    expect(convertTemperature(0, 'f')).toBe(32);
    expect(convertTemperature(100, 'f')).toBe(212);
  });
});
