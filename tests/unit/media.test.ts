import { describe, expect, it } from 'vitest';
import mediaRaw from '../../public/data/media.json?raw';
import { airlineIcon, airlineLogo, makerLogo, mediaUrlOk, type MediaTable } from '../../src/data/media';
import { ALL_AIRLINES } from '../../src/data/sim/airlines';
import { TYPE_SPECS } from '../../src/data/sim/typeSpecs';
import { modelName } from '../../src/features/aircraft/FlightParts';

const media = JSON.parse(mediaRaw) as MediaTable;
/** Every self-hosted logo file (paths as the site serves them). */
const files = new Set(Object.keys(import.meta.glob('../../public/media/**/*.{png,jpg}')).map((p) => p.replace('../../public', '')));
const exists = (url: string) => files.has(url.split('?')[0]!);

/** Makers in typeSpecs with no free, readable, current logo on Commons (shown without one). */
const NO_MAKER_LOGO = new Set(['Various', 'Learjet', 'Alexander Schleicher', 'Rolladen-Schneider', 'Robin']);

/** India and the Middle East (incl. Turkey, Egypt, Cyprus). */
const REGION = new Set(['IN', 'AE', 'QA', 'SA', 'BH', 'OM', 'KW', 'JO', 'LB', 'IQ', 'IR', 'IL', 'TR', 'YE', 'SY', 'EG', 'CY', 'PS']);
/** Region airlines with no current free logo on Commons (code chip instead). */
// No logo on Commons: Alliance Air (only the pre-2017 Air India Regional marks) and Qeshm Air.
const NO_REGION_LOGO = new Set(['LLR', 'QSM']);

describe('media table', () => {
  it('has a maker logo, keyed by the exact typeSpecs maker string, for every maker that has one', () => {
    const makers = new Set(Object.values(TYPE_SPECS).map((s) => s.maker));
    const missing = [...makers].filter((m) => !NO_MAKER_LOGO.has(m) && !makerLogo(media, m));
    expect(missing).toEqual([]);
    for (const m of ['Airbus', 'Boeing', 'Embraer', 'ATR', 'De Havilland Canada', 'Bombardier', 'Lockheed Martin', 'Dassault']) expect(makerLogo(media, m), m).toBeDefined();
  });

  it('points every self-hosted logo row at an existing file, with its credit recorded', () => {
    expect(files.size).toBeGreaterThan(600);
    for (const table of [media.logos, media.icons ?? {}, media.makers ?? {}]) {
      for (const [key, row] of Object.entries(table)) {
        expect(mediaUrlOk(row[0]), `${key} ${row[0]}`).toBe(true);
        if (!row[0].startsWith('/')) continue;
        expect(exists(row[0]), `${key} ${row[0]}`).toBe(true);
        // Licence and Commons file title are recorded for the credits.
        expect(row[1], key).toMatch(/^File:/);
        expect(row[2].length, key).toBeGreaterThan(0);
      }
    }
  });

  it('gives every Indian and Middle Eastern airline a logo (and the major ones an icon)', () => {
    const region = ALL_AIRLINES.filter((a) => REGION.has(a.country));
    expect(region.length).toBeGreaterThan(30);
    const missing = region.filter((a) => !NO_REGION_LOGO.has(a.icao) && !airlineLogo(media, a.icao)).map((a) => a.icao);
    expect(missing).toEqual([]);
    for (const icao of ['AIC', 'UAE', 'THY', 'AKJ', 'MSR', 'OMA']) expect(airlineIcon(media, icao), icao).toBeDefined();
    // Current brands, not the pre-2023 Air India or the Danish Star Air.
    expect(media.logos.AIC?.[1]).toBe('File:Air India 2023.svg');
    expect(media.logos.SDG?.[1]).not.toMatch(/Denmark/);
  });

  it('only accepts self-hosted logo paths or Wikimedia hosts', () => {
    expect(mediaUrlOk('/media/makers/airbus.png?v=91e0bffe')).toBe(true);
    expect(mediaUrlOk('/media/logos/icons/AIC.png')).toBe(true);
    expect(mediaUrlOk('/media/logos/../x.png')).toBe(false);
    expect(mediaUrlOk('https://example.com/a.png')).toBe(false);
    expect(mediaUrlOk('https://upload.wikimedia.org/a.png')).toBe(true);
  });
});

describe('modelName', () => {
  it('builds full marketing names without repeating the maker', () => {
    expect(modelName(TYPE_SPECS.A359!)).toBe('Airbus A350-900');
    expect(modelName(TYPE_SPECS.B789!)).toBe('Boeing 787-9 Dreamliner');
    expect(modelName(TYPE_SPECS.AT76!)).toBe('ATR 72-600');
    expect(modelName(TYPE_SPECS.SF34!)).toBe('Saab 340B');
  });
});
