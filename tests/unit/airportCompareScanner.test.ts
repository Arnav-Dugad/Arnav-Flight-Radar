import { describe, expect, it } from 'vitest';
import { bestIndices } from '@/features/airports/AirportCompare';
import { publishedFreq, RADIO_CHANNELS, SCANNER_KINDS } from '@/features/airports/AirportRadio';

describe('airport comparison: best value per row', () => {
  it('marks the highest or lowest value', () => {
    expect([...bestIndices([3, 7, 5], 'high')]).toEqual([1]);
    expect([...bestIndices([3, 7, 5], 'low')]).toEqual([0]);
  });
  it('marks every airport that ties for best', () => {
    expect([...bestIndices([72, 64, 72], 'high')]).toEqual([0, 2]);
  });
  it('marks nothing when all values are equal, only one is known, or the row has no ranking', () => {
    expect(bestIndices([0, 0, 0], 'low').size).toBe(0);
    expect(bestIndices([5, undefined], 'high').size).toBe(0);
    expect(bestIndices([1, 2], null).size).toBe(0);
  });
  it('ignores missing values', () => {
    expect([...bestIndices([undefined, 4, 9], 'low')]).toEqual([1]);
  });
});

describe('airport scanner frequencies', () => {
  const freqs = [
    { type: 'ATIS', mhz: 113.75 },
    { type: 'DEL', mhz: 121.975 },
    { type: 'GND', mhz: 121.7 },
    { type: 'TWR', mhz: 118.5 },
    { type: 'APP', mhz: 119.725 },
  ];
  it('picks the published frequency for each channel', () => {
    expect(SCANNER_KINDS.map((k) => publishedFreq(freqs, k.id))).toEqual([121.975, 121.7, 118.5, 119.725]);
  });
  it('accepts common alternative type codes and reports missing ones', () => {
    expect(publishedFreq([{ type: 'CLD', mhz: 135.15 }], 'del')).toBe(135.15);
    expect(publishedFreq([{ type: 'DEP', mhz: 125.4 }], 'app')).toBe(125.4);
    expect(publishedFreq([{ type: 'CTAF', mhz: 122.8 }], 'twr')).toBeUndefined();
  });
  it('offers Departure as its own channel between Tower and Approach', () => {
    expect(RADIO_CHANNELS.map((c) => c.id)).toEqual(['del', 'gnd', 'twr', 'dep', 'app']);
  });
});
