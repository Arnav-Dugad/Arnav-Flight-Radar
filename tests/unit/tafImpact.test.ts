import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { tafSchema } from '../../src/lib/schemas';
import {
  bestCrosswind,
  ceilingOf,
  flightCategory,
  hourlyForecast,
  parseVisibilitySm,
  summarize,
  type HourForecast,
} from '../../src/lib/tafImpact';

type Taf = z.infer<typeof tafSchema>;
type Period = Taf['periods'][number];

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 18, 6); // 18 Oct 2026 06:00Z
const at = (h: number) => T0 + h * H;

const period = (fromH: number, toH: number, o: Partial<Period> = {}): Period => ({
  from: at(fromH),
  to: at(toH),
  clouds: [],
  ...o,
});

const taf = (periods: Period[], hours = 30): Taf => ({
  station: 'TEST',
  issuedAt: T0,
  validFrom: T0,
  validTo: at(hours),
  raw: 'TAF TEST',
  periods,
});

const base = (o: Partial<Period> = {}, toH = 30) =>
  period(0, toH, { windDirDeg: 270, windSpeedKt: 10, visibility: '6+', clouds: [{ cover: 'FEW', baseFt: 4000 }], ...o });

const hourAt = (hours: HourForecast[], h: number) => {
  const f = hours.find((x) => x.t === at(h));
  if (!f) throw new Error(`no forecast for +${h}h`);
  return f;
};

describe('parseVisibilitySm', () => {
  it('parses statute-mile formats', () => {
    expect(parseVisibilitySm('6+')).toBe(6);
    expect(parseVisibilitySm('P6SM')).toBe(6);
    expect(parseVisibilitySm('10SM')).toBe(10);
    expect(parseVisibilitySm('1 1/2')).toBe(1.5);
    expect(parseVisibilitySm('1 1/2SM')).toBe(1.5);
    expect(parseVisibilitySm('3/4')).toBe(0.75);
    expect(parseVisibilitySm('3/4SM')).toBe(0.75);
    expect(parseVisibilitySm('0.5')).toBe(0.5);
    expect(parseVisibilitySm('4.35')).toBe(4.35);
    expect(parseVisibilitySm('2')).toBe(2);
    expect(parseVisibilitySm(' 1/4 ')).toBe(0.25);
    expect(parseVisibilitySm('M1/4SM')).toBeLessThan(0.25);
    expect(parseVisibilitySm(3)).toBe(3);
  });

  it('parses metre formats', () => {
    expect(parseVisibilitySm('9999')).toBeCloseTo(6.21, 2);
    expect(parseVisibilitySm('0800')).toBeCloseTo(0.497, 3);
    expect(parseVisibilitySm('4000')).toBeCloseTo(2.485, 3);
    expect(parseVisibilitySm('0000')).toBe(0);
    expect(parseVisibilitySm('1500NDV')).toBeCloseTo(0.932, 3);
    expect(parseVisibilitySm('5KM')).toBeCloseTo(3.107, 3);
    expect(parseVisibilitySm('800M')).toBeCloseTo(0.497, 3);
    expect(parseVisibilitySm('CAVOK')).toBeCloseTo(6.21, 2);
  });

  it('rejects junk', () => {
    expect(parseVisibilitySm(undefined)).toBeUndefined();
    expect(parseVisibilitySm('')).toBeUndefined();
    expect(parseVisibilitySm('   ')).toBeUndefined();
    expect(parseVisibilitySm('abc')).toBeUndefined();
    expect(parseVisibilitySm('1/0')).toBeUndefined();
    expect(parseVisibilitySm(Number.NaN)).toBeUndefined();
  });
});

describe('helpers', () => {
  it('finds the lowest BKN/OVC/VV ceiling', () => {
    expect(ceilingOf([{ cover: 'FEW', baseFt: 500 }, { cover: 'BKN', baseFt: 1200 }, { cover: 'OVC', baseFt: 800 }])).toBe(800);
    expect(ceilingOf([{ cover: 'SCT', baseFt: 300 }])).toBeUndefined();
    expect(ceilingOf([{ cover: 'VV', baseFt: 100 }])).toBe(100);
    expect(ceilingOf([{ cover: 'CAVOK' }])).toBeUndefined();
  });

  it('applies FAA flight categories', () => {
    expect(flightCategory(undefined, 10)).toBe('VFR');
    expect(flightCategory(3000, 10)).toBe('MVFR');
    expect(flightCategory(5000, 5)).toBe('MVFR');
    expect(flightCategory(900, 10)).toBe('IFR');
    expect(flightCategory(5000, 2)).toBe('IFR');
    expect(flightCategory(400, 10)).toBe('LIFR');
    expect(flightCategory(5000, 0.5)).toBe('LIFR');
  });

  it('computes the best-runway crosswind', () => {
    expect(bestCrosswind(270, 30, [270])).toBeCloseTo(0, 5);
    expect(bestCrosswind(360, 30, [90, 270])).toBeCloseTo(30, 5);
    expect(bestCrosswind(360, 30, [90, 360])).toBeCloseTo(0, 5);
    expect(bestCrosswind(undefined, 30, [90])).toBeUndefined();
    expect(bestCrosswind(90, 30, [])).toBeUndefined();
  });
});

describe('hourlyForecast', () => {
  it('defaults to 24 hours from the floored start and skips hours outside validity', () => {
    const hours = hourlyForecast(taf([base()], 10), { from: at(0) + 25 * 60_000 });
    expect(hours).toHaveLength(10);
    expect(hours[0]!.t).toBe(at(0));
    expect(hours[0]).toMatchObject({ category: 'VFR', capacity: 1, confidence: 1, causes: [], windDir: 270, windKt: 10, visSm: 6 });
  });

  it('FM groups replace conditions from their start', () => {
    const t = taf([
      base({}, 4),
      period(4, 30, { change: 'FM', windDirDeg: 180, windSpeedKt: 5, visibility: '2', clouds: [{ cover: 'OVC', baseFt: 700 }], weather: '-RA BR' }),
    ]);
    const hours = hourlyForecast(t, { from: at(0), hours: 8 });
    expect(hourAt(hours, 3).category).toBe('VFR');
    const h5 = hourAt(hours, 5);
    expect(h5).toMatchObject({ category: 'IFR', windDir: 180, windKt: 5, visSm: 2, ceilingFt: 700, wx: ['-RA', 'BR'], confidence: 1 });
    expect(h5.capacity).toBe(0.85);
    expect(h5.causes).toContain('Low cloud 700 ft');
  });

  it('an FM group starting mid-hour affects that hour (worst sample)', () => {
    const t = taf([base({}, 4.5), period(4.5, 30, { change: 'FM', visibility: '1/2', weather: 'FG', clouds: [{ cover: 'VV', baseFt: 100 }] })]);
    const hours = hourlyForecast(t, { from: at(0), hours: 6 });
    expect(hourAt(hours, 4).causes).toContain('Low visibility (LVP)');
  });

  it('BECMG transitions linearly then persists', () => {
    const t = taf([base({ windSpeedKt: 10 }), period(4, 8, { change: 'BECMG', windDirDeg: 270, windSpeedKt: 30, clouds: [] })]);
    const hours = hourlyForecast(t, { from: at(0), hours: 12 });
    expect(hourAt(hours, 2).windKt).toBe(10);
    // The 06:00 hour is sampled at 06:00, 06:15, 06:30, 06:45 — wind ramps 20 → 23.75 kt.
    const mid = hourAt(hours, 6).windKt!;
    expect(mid).toBeGreaterThan(18);
    expect(mid).toBeLessThan(26);
    expect(hourAt(hours, 9).windKt).toBe(30);
    expect(hourAt(hours, 11).windKt).toBe(30);
    // BECMG with no visibility/cloud group keeps the prevailing ones.
    expect(hourAt(hours, 11).visSm).toBe(6);
  });

  it('TEMPO overlays worse conditions only within its window with ~40% confidence', () => {
    const t = taf([base(), period(8, 12, { change: 'TEMPO', visibility: '3000', weather: 'TSRA', clouds: [{ cover: 'BKN', baseFt: 1500, type: 'CB' }] })]);
    const hours = hourlyForecast(t, { from: at(0), hours: 16 });
    expect(hourAt(hours, 7)).toMatchObject({ capacity: 1, confidence: 1, wx: [] });
    const h9 = hourAt(hours, 9);
    expect(h9.confidence).toBe(0.4);
    expect(h9.wx).toEqual(['TSRA']);
    expect(h9.causes).toContain('Thunderstorms');
    // TS (0.55) × IFR (0.85) = 0.4675 worse capacity; expected = 1×0.6 + 0.4675×0.4 = 0.787
    expect(h9.capacity).toBeCloseTo(0.79, 2);
    expect(h9.category).toBe('IFR');
    expect(hourAt(hours, 12)).toMatchObject({ capacity: 1, confidence: 1 });
  });

  it('PROB30 TEMPO uses the stated probability', () => {
    const t = taf([base(), period(2, 6, { change: 'TEMPO', probability: 30, weather: 'TSRA' })]);
    const h = hourAt(hourlyForecast(t, { from: at(0), hours: 8 }), 3);
    expect(h.confidence).toBe(0.3);
    // 1×0.7 + 0.55×0.3 = 0.865
    expect(h.capacity).toBeGreaterThanOrEqual(0.86);
    expect(h.capacity).toBeLessThanOrEqual(0.87);
  });

  it('bare PROB40 groups are overlays with 40% confidence', () => {
    const t = taf([base(), period(2, 6, { change: 'PROB', probability: 40, visibility: '1/4', weather: 'FG', clouds: [{ cover: 'VV', baseFt: 100 }] })]);
    const h = hourAt(hourlyForecast(t, { from: at(0), hours: 8 }), 3);
    expect(h.confidence).toBe(0.4);
    expect(h.category).toBe('LIFR');
    expect(h.causes).toContain('Low visibility (LVP)');
  });

  it('ignores TEMPO groups that improve conditions', () => {
    const t = taf([
      base({ visibility: '2', clouds: [{ cover: 'OVC', baseFt: 600 }] }),
      period(2, 6, { change: 'TEMPO', visibility: '6+', weather: 'NSW', clouds: [{ cover: 'SCT', baseFt: 3000 }] }),
    ]);
    const h = hourAt(hourlyForecast(t, { from: at(0), hours: 8 }), 3);
    expect(h).toMatchObject({ category: 'IFR', confidence: 1, capacity: 0.85 });
  });

  it('detects low-visibility procedures from visibility or ceiling', () => {
    const fog = hourlyForecast(taf([base({ visibility: '0400', weather: 'FG', clouds: [{ cover: 'VV', baseFt: 100 }] })]), { from: at(0), hours: 1 })[0]!;
    expect(fog.category).toBe('LIFR');
    expect(fog.capacity).toBe(0.55);
    expect(fog.causes).toEqual(expect.arrayContaining(['Low visibility (LVP)', 'Low cloud 100 ft']));

    const lowCig = hourlyForecast(taf([base({ visibility: '3', clouds: [{ cover: 'OVC', baseFt: 150 }] })]), { from: at(0), hours: 1 })[0]!;
    expect(lowCig.capacity).toBe(0.55);
    expect(lowCig.causes).toContain('Low cloud 150 ft (LVP)');

    const lifr = hourlyForecast(taf([base({ visibility: '3/4', clouds: [{ cover: 'OVC', baseFt: 300 }] })]), { from: at(0), hours: 1 })[0]!;
    expect(lifr.category).toBe('LIFR');
    expect(lifr.capacity).toBe(0.65);
    expect(lifr.causes.some((c) => c.includes('LVP'))).toBe(false);
  });

  it('models thunderstorm, gust, snow and freezing-rain capacity', () => {
    const one = (o: Partial<Period>) => hourlyForecast(taf([base(o)]), { from: at(0), hours: 1 })[0]!;
    expect(one({ weather: 'TSRA' }).capacity).toBe(0.55);
    expect(one({ weather: '+TSRA' }).capacity).toBe(0.45);
    expect(one({ weather: '+TSRA' }).causes).toContain('Heavy thunderstorms');
    expect(one({ weather: 'TS +RA' }).capacity).toBe(0.45);
    expect(one({ windSpeedKt: 20, windGustKt: 34 }).capacity).toBe(0.8);
    expect(one({ windSpeedKt: 28, windGustKt: 45 }).causes).toContain('Strong gusts 45 kt');
    expect(one({ windSpeedKt: 28, windGustKt: 45 }).capacity).toBe(0.65);
    expect(one({ weather: '-SN' }).capacity).toBe(0.7);
    expect(one({ weather: '+SN' }).capacity).toBe(0.5);
    expect(one({ weather: 'FZRA' }).causes).toContain('Freezing rain');
    expect(one({ weather: 'FZRA' }).capacity).toBe(0.5);
    // Combined multiplicatively and floored at 0.3.
    expect(one({ weather: '+TSRA +SN', windSpeedKt: 30, windGustKt: 50, visibility: '1/4', clouds: [{ cover: 'VV', baseFt: 100 }] }).capacity).toBe(0.3);
  });

  it('applies crosswind only on the best runway', () => {
    const t = taf([base({ windDirDeg: 360, windSpeedKt: 30 })]);
    const xw = hourlyForecast(t, { from: at(0), hours: 1, runwayHeadings: [90, 270] })[0]!;
    expect(xw.causes).toContain('Crosswind 30 kt');
    // 0.8 for 30 kt sustained wind × 0.75 crosswind
    expect(xw.capacity).toBe(0.6);
    const aligned = hourlyForecast(t, { from: at(0), hours: 1, runwayHeadings: [90, 270, 360] })[0]!;
    expect(aligned.causes.some((c) => c.startsWith('Crosswind'))).toBe(false);
    const none = hourlyForecast(t, { from: at(0), hours: 1 })[0]!;
    expect(none.causes.some((c) => c.startsWith('Crosswind'))).toBe(false);
  });
});

describe('summarize', () => {
  it('reports no disruption for benign weather', () => {
    const s = summarize(hourlyForecast(taf([base()]), { from: at(0) }));
    expect(s.level).toBe(0);
    expect(s.headline).toBe('No weather disruption expected');
  });

  it('headlines a TEMPO thunderstorm window', () => {
    const t = taf([base(), period(8, 12, { change: 'TEMPO', visibility: '3000', weather: 'TSRA', clouds: [{ cover: 'BKN', baseFt: 1500, type: 'CB' }] })]);
    const s = summarize(hourlyForecast(t, { from: at(0) }));
    expect(s.level).toBe(2);
    expect(s.headline).toBe('Thunderstorms likely 14:00Z–18:00Z — expect holding and arrival delays');
    expect(s.worst?.wx).toEqual(['TSRA']);
    expect(s.detail[0]).toBe('Thunderstorms 14:00Z–18:00Z (40% chance)');
  });

  it('headlines fog with the custom time formatter', () => {
    const t = taf([
      base({}, 16),
      period(16, 26, { change: 'FM', windSpeedKt: 3, windDirDeg: 0, visibility: '0200', weather: 'FG', clouds: [{ cover: 'VV', baseFt: 100 }] }),
      period(26, 30, { change: 'FM', windSpeedKt: 8, windDirDeg: 250, visibility: '9999', clouds: [{ cover: 'SCT', baseFt: 3000 }] }),
    ]);
    const tz = (ms: number) => {
      const d = new Date(ms + 2 * H); // UTC+2
      return `${String(d.getUTCHours()).padStart(2, '0')}:00`;
    };
    const s = summarize(hourlyForecast(t, { from: at(0), hours: 30 }), tz);
    expect(s.level).toBe(3);
    expect(s.headline).toBe('Fog 00:00–10:00: low-visibility procedures, reduced arrival rate');
    expect(s.detail.some((d) => d.startsWith('Lowest expected arrival capacity ≈ 55%'))).toBe(true);
  });

  it('handles an empty forecast', () => {
    expect(summarize([]).level).toBe(0);
  });
});
