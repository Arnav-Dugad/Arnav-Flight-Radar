// TAF → hour-by-hour operational impact.
//
// Turns a decoded TAF (real data from AviationWeather.gov) into an hourly outlook of
// flight category, expected arrival capacity and the reasons behind it, plus a short
// human summary. The capacity model is a deliberately simple heuristic for a *busy*
// airport — it is an illustration of how weather constrains traffic, not an ATFM
// prediction.

import type { z } from 'zod';
import type { tafSchema } from './schemas';

export type Taf = z.infer<typeof tafSchema>;
export type TafPeriod = Taf['periods'][number];
export type FlightCategory = 'VFR' | 'MVFR' | 'IFR' | 'LIFR';

export interface HourForecast {
  /** Start of the hour (ms UTC). */
  t: number;
  windDir?: number;
  windKt?: number;
  gustKt?: number;
  /** Visibility (statute miles) of the conditions reported for this hour (the worse overlay if one applies). */
  visSm?: number;
  /** Lowest BKN/OVC/VV base (ft AGL). */
  ceilingFt?: number;
  /** Present-weather groups in effect, e.g. ['TSRA', 'BR']. */
  wx: string[];
  category: FlightCategory;
  /** Expected arrival-capacity factor 0.3–1 for a busy airport (1 = normal). */
  capacity: number;
  /** Probability (0–1) the worst conditions in this hour actually happen (TEMPO ≈ 0.4, PROB30 = 0.3, PROB40 = 0.4, base/FM/BECMG = 1). */
  confidence: number;
  /** Short human causes, e.g. 'Thunderstorms', 'Low visibility (LVP)', 'Strong gusts 38 kt'. */
  causes: string[];
}

export interface ForecastSummary {
  /** 0 none, 1 minor, 2 moderate, 3 severe. */
  level: 0 | 1 | 2 | 3;
  headline: string;
  detail: string[];
  worst?: HourForecast;
}

// ── Model constants ────────────────────────────────────────────────────────────

const HOUR = 3_600_000;
const SM_PER_M = 1 / 1609.344;

/** Confidence given to a TEMPO group without an explicit PROBxx. */
export const TEMPO_CONFIDENCE = 0.4;
/** Confidence given to INTER (Australian intermittent) groups. */
export const INTER_CONFIDENCE = 0.3;
/** Confidence of a bare PROB group whose percentage was not decoded. */
export const PROB_DEFAULT_CONFIDENCE = 0.3;

/** Arrival-capacity multipliers (combined multiplicatively, then floored at CAPACITY_FLOOR). */
export const CAPACITY = {
  /** Thunderstorms at/near the field: holding, re-routes, ground stops for lightning. */
  thunderstorm: 0.55,
  /** Thunderstorms with heavy precipitation (+TSRA or TS with a heavy precip group). */
  heavyThunderstorm: 0.45,
  /** Low-visibility procedures (vis < 0.75 sm ≈ RVR 1200 m, or ceiling < 200 ft → CAT II/III): wider ILS spacing. */
  lvp: 0.55,
  /** LIFR (not yet LVP): CAT I minima, larger in-trail spacing. */
  lifr: 0.65,
  /** IFR: no visual approaches, so dependent parallel/visual separations are lost. */
  ifr: 0.85,
  /** Gusts ≥ 30 kt: go-arounds, increased spacing. */
  gust30: 0.8,
  /** Gusts ≥ 40 kt: frequent go-arounds, possible single-runway ops. */
  gust40: 0.65,
  /** Snow: runway clearing cycles, de-icing. */
  snow: 0.7,
  /** Heavy snow. */
  heavySnow: 0.5,
  /** Freezing rain / drizzle: severe icing, de-icing, runway treatment. */
  freezing: 0.5,
  /** Squalls / funnel cloud. */
  squall: 0.7,
  /** Crosswind component above CROSSWIND_LIMIT_KT on the best runway. */
  crosswind: 0.75,
} as const;
export const CAPACITY_FLOOR = 0.3;
export const CROSSWIND_LIMIT_KT = 25;
/** Visibility below this (sm) triggers low-visibility procedures. */
export const LVP_VIS_SM = 0.75;
/** Ceiling below this (ft) triggers low-visibility procedures (CAT II/III). */
export const LVP_CEILING_FT = 200;

// ── Parsing helpers ────────────────────────────────────────────────────────────

function parseFraction(s: string): number | undefined {
  // "1 1/2", "3/4", "1/2", "2", "0.5"
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s);
  if (mixed) {
    const den = Number(mixed[3]);
    return den ? Number(mixed[1]) + Number(mixed[2]) / den : undefined;
  }
  const frac = /^(\d+)\/(\d+)$/.exec(s);
  if (frac) {
    const den = Number(frac[2]);
    return den ? Number(frac[1]) / den : undefined;
  }
  if (/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return Number(s);
  return undefined;
}

/**
 * Parses a TAF/METAR visibility string into statute miles.
 * Accepts AviationWeather decodings ('6+', '4.35'), US groups ('P6SM', '1 1/2SM', '3/4', 'M1/4SM'),
 * ICAO metre groups ('9999' → 10 km+, '0800', '4000', '1500NDV'), '5KM', '800M' and 'CAVOK'.
 * Four-digit integers are always metres; anything else without a unit is statute miles.
 */
export function parseVisibilitySm(input: string | number | undefined | null): number | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 ? input : undefined;
  let s = input.trim().toUpperCase();
  if (!s) return undefined;
  if (s === 'CAVOK') return 10_000 * SM_PER_M;
  s = s.replace(/NDV$/, '').trim();
  // Metres / kilometres with explicit units.
  const km = /^(\d+(?:\.\d+)?)\s*KM$/.exec(s);
  if (km) return Number(km[1]) * 1000 * SM_PER_M;
  const m = /^(\d+)\s*M$/.exec(s);
  if (m) return Number(m[1]) * SM_PER_M;
  // ICAO four-digit metres.
  if (/^\d{4}$/.test(s)) {
    const metres = Number(s);
    return (metres >= 9999 ? 10_000 : metres) * SM_PER_M;
  }
  // Statute miles: optional P/M prefix or '+' suffix, optional SM suffix.
  let body = s.replace(/\s*SM$/, '').trim();
  let lessThan = false;
  if (body.startsWith('P')) body = body.slice(1);
  else if (body.startsWith('M')) {
    lessThan = true;
    body = body.slice(1);
  }
  if (body.endsWith('+')) body = body.slice(0, -1).trim();
  const v = parseFraction(body);
  if (v === undefined || !Number.isFinite(v)) return undefined;
  // "M1/4SM" means "less than 1/4": report slightly below the threshold.
  return lessThan ? v * 0.9 : v;
}

const CEILING_COVERS = new Set(['BKN', 'OVC', 'VV', 'OVX']);

/** Lowest BKN/OVC/VV base, or undefined when there is no ceiling. */
export function ceilingOf(clouds: TafPeriod['clouds']): number | undefined {
  let min: number | undefined;
  for (const c of clouds) {
    if (!CEILING_COVERS.has(c.cover.toUpperCase())) continue;
    const base = c.baseFt ?? 0;
    if (min === undefined || base < min) min = base;
  }
  return min;
}

/** FAA flight category from ceiling (ft) and visibility (sm). */
export function flightCategory(ceilingFt: number | undefined, visSm: number | undefined): FlightCategory {
  const c = ceilingFt ?? Infinity;
  const v = visSm ?? Infinity;
  if (c < 500 || v < 1) return 'LIFR';
  if (c < 1000 || v < 3) return 'IFR';
  if (c <= 3000 || v <= 5) return 'MVFR';
  return 'VFR';
}

const CATEGORY_RANK: Record<FlightCategory, number> = { VFR: 0, MVFR: 1, IFR: 2, LIFR: 3 };

function splitWeather(wx: string | undefined): string[] {
  if (!wx) return [];
  const toks = wx.toUpperCase().split(/\s+/).filter(Boolean);
  return toks.includes('NSW') ? [] : toks;
}

// ── Conditions ─────────────────────────────────────────────────────────────────

interface Conditions {
  windDir?: number;
  windKt?: number;
  gustKt?: number;
  visSm?: number;
  ceilingFt?: number;
  wx: string[];
}

interface Assessment {
  category: FlightCategory;
  capacity: number;
  causes: string[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const fmtVis = (sm: number) => (sm >= 1 ? `${round1(sm)}` : sm >= 0.1 ? `${Math.round(sm * 100) / 100}` : '<0.1');

function hasPrecip(tok: string): boolean {
  return /(RA|SN|GR|GS|PL|DZ|UP)/.test(tok);
}

/** Smallest crosswind component over the runways (kt), or undefined if it cannot be computed. */
export function bestCrosswind(windDir: number | undefined, windKt: number | undefined, headings: number[] | undefined): number | undefined {
  if (windDir === undefined || windKt === undefined || !headings?.length) return undefined;
  let best = Infinity;
  for (const h of headings) {
    if (!Number.isFinite(h)) continue;
    const xw = Math.abs(windKt * Math.sin(((windDir - h) * Math.PI) / 180));
    if (xw < best) best = xw;
  }
  return Number.isFinite(best) ? best : undefined;
}

function assess(c: Conditions, runwayHeadings: number[] | undefined): Assessment {
  const category = flightCategory(c.ceilingFt, c.visSm);
  const causes: string[] = [];
  let cap = 1;

  // Thunderstorms.
  const ts = c.wx.filter((t) => t.includes('TS'));
  if (ts.length) {
    const heavy = ts.some((t) => t.startsWith('+')) || c.wx.some((t) => t.startsWith('+') && hasPrecip(t));
    cap *= heavy ? CAPACITY.heavyThunderstorm : CAPACITY.thunderstorm;
    causes.push(heavy ? 'Heavy thunderstorms' : 'Thunderstorms');
  }
  if (c.wx.some((t) => /SQ|FC/.test(t))) {
    cap *= CAPACITY.squall;
    causes.push('Squalls');
  }

  // Visibility / ceiling.
  const lvpVis = c.visSm !== undefined && c.visSm < LVP_VIS_SM;
  const lvpCig = c.ceilingFt !== undefined && c.ceilingFt < LVP_CEILING_FT;
  if (lvpVis || lvpCig) {
    cap *= CAPACITY.lvp;
    if (lvpVis) causes.push('Low visibility (LVP)');
    if (c.ceilingFt !== undefined && c.ceilingFt < 1000) causes.push(`Low cloud ${c.ceilingFt} ft${lvpVis ? '' : ' (LVP)'}`);
  } else if (category === 'LIFR' || category === 'IFR') {
    cap *= category === 'LIFR' ? CAPACITY.lifr : CAPACITY.ifr;
    if (c.visSm !== undefined && c.visSm < 3) causes.push(`Reduced visibility ${fmtVis(c.visSm)} sm`);
    if (c.ceilingFt !== undefined && c.ceilingFt < 1000) causes.push(`Low cloud ${c.ceilingFt} ft`);
  }

  // Wind.
  const peak = Math.max(c.gustKt ?? 0, c.windKt ?? 0);
  if (peak >= 30) {
    cap *= peak >= 40 ? CAPACITY.gust40 : CAPACITY.gust30;
    causes.push(c.gustKt !== undefined && c.gustKt >= 30 ? `Strong gusts ${c.gustKt} kt` : `Strong winds ${peak} kt`);
  }
  const xw = bestCrosswind(c.windDir, c.gustKt ?? c.windKt, runwayHeadings);
  if (xw !== undefined && xw > CROSSWIND_LIMIT_KT) {
    cap *= CAPACITY.crosswind;
    causes.push(`Crosswind ${Math.round(xw)} kt`);
  }

  // Winter precipitation.
  const freezing = c.wx.filter((t) => /FZ(RA|DZ|UP)/.test(t));
  if (freezing.length) {
    cap *= CAPACITY.freezing;
    causes.push(freezing.some((t) => t.includes('FZRA')) ? 'Freezing rain' : 'Freezing drizzle');
  }
  const snow = c.wx.filter((t) => t.includes('SN'));
  if (snow.length) {
    const heavy = snow.some((t) => t.startsWith('+'));
    cap *= heavy ? CAPACITY.heavySnow : CAPACITY.snow;
    causes.push(heavy ? 'Heavy snow' : 'Snow');
  }

  return { category, capacity: Math.max(CAPACITY_FLOOR, cap), causes };
}

// ── Period evaluation ──────────────────────────────────────────────────────────

type Kind = 'base' | 'becmg' | 'overlay';

function kindOf(p: TafPeriod, index: number): Kind {
  const ch = (p.change ?? '').toUpperCase();
  if (ch.includes('TEMPO') || ch.includes('PROB') || ch.includes('INTER')) return 'overlay';
  if (ch.includes('BECMG')) return 'becmg';
  if (ch === '' && p.probability !== undefined && index > 0) return 'overlay';
  return 'base'; // initial period, FM groups
}

function confidenceOf(p: TafPeriod): number {
  if (p.probability !== undefined && p.probability > 0) return Math.min(1, p.probability / 100);
  const ch = (p.change ?? '').toUpperCase();
  if (ch.includes('PROB')) {
    const m = /PROB\s*(\d+)/.exec(ch);
    return m ? Math.min(1, Number(m[1]) / 100) : PROB_DEFAULT_CONFIDENCE;
  }
  if (ch.includes('INTER')) return INTER_CONFIDENCE;
  return TEMPO_CONFIDENCE;
}

/** Full replacement (initial forecast / FM group). */
function fromPeriod(p: TafPeriod): Conditions {
  return {
    windDir: p.windDirDeg,
    windKt: p.windSpeedKt,
    gustKt: p.windGustKt,
    visSm: parseVisibilitySm(p.visibility),
    ceilingFt: ceilingOf(p.clouds),
    wx: splitWeather(p.weather),
  };
}

/** Partial update (BECMG / TEMPO): only the elements present in the group change. */
function applyPartial(prev: Conditions, p: TafPeriod): Conditions {
  const next: Conditions = { ...prev, wx: [...prev.wx] };
  if (p.windSpeedKt !== undefined) {
    next.windDir = p.windDirDeg;
    next.windKt = p.windSpeedKt;
    next.gustKt = p.windGustKt;
  } else if (p.windGustKt !== undefined) next.gustKt = p.windGustKt;
  const vis = parseVisibilitySm(p.visibility);
  if (vis !== undefined) next.visSm = vis;
  if (p.clouds.length) next.ceilingFt = ceilingOf(p.clouds);
  if (p.weather !== undefined) next.wx = splitWeather(p.weather);
  return next;
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

function lerpOpt(a: number | undefined, b: number | undefined, f: number): number | undefined {
  if (a !== undefined && b !== undefined) return lerp(a, b, f);
  return f >= 0.5 ? b : a;
}

function lerpAngle(a: number | undefined, b: number | undefined, f: number): number | undefined {
  if (a === undefined || b === undefined) return f >= 0.5 ? b : a;
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * f + 360) % 360;
}

function blend(a: Conditions, b: Conditions, f: number): Conditions {
  const roundOpt = (v: number | undefined) => (v === undefined ? undefined : Math.round(v));
  const vis = lerpOpt(a.visSm, b.visSm, f);
  return {
    windDir: roundOpt(lerpAngle(a.windDir, b.windDir, f)),
    windKt: roundOpt(lerpOpt(a.windKt, b.windKt, f)),
    gustKt: roundOpt(f >= 0.5 ? b.gustKt : a.gustKt),
    visSm: vis === undefined ? undefined : Math.round(vis * 100) / 100,
    ceilingFt: roundOpt(lerpOpt(a.ceilingFt, b.ceilingFt, f)),
    wx: f >= 0.5 ? b.wx : a.wx,
  };
}

interface Prepared {
  validFrom: number;
  validTo: number;
  persistent: Array<{ p: TafPeriod; kind: 'base' | 'becmg' }>;
  overlays: Array<{ p: TafPeriod; confidence: number }>;
}

function prepare(taf: Taf): Prepared {
  const persistent: Prepared['persistent'] = [];
  const overlays: Prepared['overlays'] = [];
  taf.periods.forEach((p, i) => {
    const k = kindOf(p, i);
    if (k === 'overlay') overlays.push({ p, confidence: confidenceOf(p) });
    else persistent.push({ p, kind: k });
  });
  persistent.sort((a, b) => a.p.from - b.p.from);
  return { validFrom: taf.validFrom, validTo: taf.validTo, persistent, overlays };
}

/** Prevailing conditions (initial / FM / BECMG) at time s. */
function prevailingAt(prep: Prepared, s: number): Conditions | undefined {
  let state: Conditions | undefined;
  for (const { p, kind } of prep.persistent) {
    if (p.from > s && state) break;
    if (kind === 'base') {
      state = fromPeriod(p);
      continue;
    }
    const prev = state ?? { wx: [] };
    const target = applyPartial(prev, p);
    if (s >= p.to || p.to <= p.from) state = target;
    else if (s >= p.from) state = blend(prev, target, (s - p.from) / (p.to - p.from));
    else state = prev;
  }
  return state;
}

interface Sample {
  cond: Conditions;
  assessment: Assessment;
  capacity: number;
  confidence: number;
}

function sampleAt(prep: Prepared, s: number, headings: number[] | undefined): Sample | undefined {
  if (s < prep.validFrom || s >= prep.validTo) return undefined;
  const base = prevailingAt(prep, s);
  if (!base) return undefined;
  const baseA = assess(base, headings);
  let best: Sample = { cond: base, assessment: baseA, capacity: baseA.capacity, confidence: 1 };
  for (const { p, confidence } of prep.overlays) {
    if (s < p.from || s >= p.to) continue;
    const worse = applyPartial(base, p);
    const a = assess(worse, headings);
    const worseCap = a.capacity < baseA.capacity - 1e-9;
    const worseCat = CATEGORY_RANK[a.category] > CATEGORY_RANK[baseA.category];
    if (!worseCap && !worseCat) continue; // TEMPO improvements are ignored (we report the risk)
    const expected = baseA.capacity * (1 - confidence) + Math.min(a.capacity, baseA.capacity) * confidence;
    const better =
      best.confidence === 1 && best.cond === base
        ? true
        : expected < best.capacity - 1e-9 ||
          (Math.abs(expected - best.capacity) < 1e-9 && CATEGORY_RANK[a.category] > CATEGORY_RANK[best.assessment.category]);
    if (better) best = { cond: worse, assessment: a, capacity: expected, confidence };
  }
  return best;
}

function isWorseSample(a: Sample, b: Sample): boolean {
  if (a.capacity < b.capacity - 1e-9) return true;
  if (a.capacity > b.capacity + 1e-9) return false;
  return CATEGORY_RANK[a.assessment.category] > CATEGORY_RANK[b.assessment.category];
}

/** Sampling offsets within each hour; the hour reports its worst sample. */
const SAMPLE_OFFSETS = [0, 15, 30, 45].map((m) => m * 60_000);

/**
 * Hour-by-hour forecast. Initial/FM groups replace conditions from their start; BECMG
 * transitions linearly over its window and then persists; TEMPO/PROB/INTER overlay the
 * worse conditions only within their window, weighted by their confidence.
 * Hours outside the TAF validity are omitted.
 */
export function hourlyForecast(taf: Taf, opts: { from?: number; hours?: number; runwayHeadings?: number[] } = {}): HourForecast[] {
  const from = Math.floor((opts.from ?? Date.now()) / HOUR) * HOUR;
  const hours = Math.max(0, Math.floor(opts.hours ?? 24));
  const prep = prepare(taf);
  const out: HourForecast[] = [];
  for (let i = 0; i < hours; i++) {
    const t = from + i * HOUR;
    let worst: Sample | undefined;
    for (const off of SAMPLE_OFFSETS) {
      const s = sampleAt(prep, t + off, opts.runwayHeadings);
      if (s && (!worst || isWorseSample(s, worst))) worst = s;
    }
    if (!worst) continue;
    const c = worst.cond;
    const h: HourForecast = {
      t,
      wx: [...c.wx],
      category: worst.assessment.category,
      capacity: Math.round(worst.capacity * 100) / 100,
      confidence: Math.round(worst.confidence * 100) / 100,
      causes: worst.assessment.causes,
    };
    if (c.windDir !== undefined) h.windDir = c.windDir;
    if (c.windKt !== undefined) h.windKt = c.windKt;
    if (c.gustKt !== undefined) h.gustKt = c.gustKt;
    if (c.visSm !== undefined) h.visSm = Math.round(c.visSm * 100) / 100;
    if (c.ceilingFt !== undefined) h.ceilingFt = c.ceilingFt;
    out.push(h);
  }
  return out;
}

// ── Summary ────────────────────────────────────────────────────────────────────

type CauseKind = 'ts' | 'lvp' | 'freezing' | 'snow' | 'wind' | 'crosswind' | 'squall' | 'lowcloud' | 'vis';

/** Headline priority (first = most important). */
const KIND_ORDER: CauseKind[] = ['ts', 'lvp', 'freezing', 'snow', 'squall', 'wind', 'crosswind', 'lowcloud', 'vis'];

function causeKind(cause: string): CauseKind | undefined {
  if (/thunderstorm/i.test(cause)) return 'ts';
  if (/LVP/.test(cause)) return 'lvp';
  if (/^Freezing/.test(cause)) return 'freezing';
  if (/snow/i.test(cause)) return 'snow';
  if (/^Squall/.test(cause)) return 'squall';
  if (/^Strong (gusts|winds)/.test(cause)) return 'wind';
  if (/^Crosswind/.test(cause)) return 'crosswind';
  if (/^Low cloud/.test(cause)) return 'lowcloud';
  if (/^Reduced visibility/.test(cause)) return 'vis';
  return undefined;
}

const kindsOf = (h: HourForecast) => new Set(h.causes.map(causeKind).filter((k): k is CauseKind => k !== undefined));

/** Disruption level of one hour, from its expected capacity. */
export function hourLevel(h: HourForecast): 0 | 1 | 2 | 3 {
  if (h.capacity < 0.7) return 3;
  if (h.capacity < 0.85) return 2;
  if (h.capacity < 0.97 || CATEGORY_RANK[h.category] >= 2) return 1;
  return 0;
}

const defaultTz = (t: number) => {
  const d = new Date(t);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
};

const likelihood = (conf: number) => (conf >= 0.9 ? 'expected' : conf >= 0.4 ? 'likely' : 'possible');

interface Span {
  kind: CauseKind;
  start: number;
  end: number;
  peak: HourForecast;
  maxConfidence: number;
}

function spansOf(hours: HourForecast[]): Span[] {
  const spans: Span[] = [];
  const open = new Map<CauseKind, Span>();
  hours.forEach((h, i) => {
    const kinds = kindsOf(h);
    const prev = hours[i - 1];
    const contiguous = prev !== undefined && h.t - prev.t <= HOUR;
    for (const [k, span] of open) {
      if (!kinds.has(k) || !contiguous) {
        spans.push(span);
        open.delete(k);
      }
    }
    for (const k of kinds) {
      const span = open.get(k);
      if (span) {
        span.end = h.t + HOUR;
        if (h.capacity < span.peak.capacity) span.peak = h;
        span.maxConfidence = Math.max(span.maxConfidence, h.confidence);
      } else open.set(k, { kind: k, start: h.t, end: h.t + HOUR, peak: h, maxConfidence: h.confidence });
    }
  });
  spans.push(...open.values());
  return spans.sort((a, b) => a.start - b.start || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

function describeSpan(s: Span, range: string): string {
  const conf = s.maxConfidence < 0.9 ? ` (${Math.round(s.maxConfidence * 100)}% chance)` : '';
  const p = s.peak;
  switch (s.kind) {
    case 'ts':
      return `Thunderstorms ${range}${conf}`;
    case 'lvp':
      return `${p.wx.some((w) => w.includes('FG')) ? 'Fog' : 'Low visibility'} ${range}${conf}`;
    case 'freezing':
      return `Freezing precipitation ${range}${conf}`;
    case 'snow':
      return `Snow ${range}${conf}`;
    case 'squall':
      return `Squalls ${range}${conf}`;
    case 'wind':
      return `Strong winds${p.gustKt ? ` gusting ${p.gustKt} kt` : ''} ${range}${conf}`;
    case 'crosswind':
      return `Strong crosswind ${range}${conf}`;
    case 'lowcloud':
      return `Low cloud${p.ceilingFt !== undefined ? ` (${p.ceilingFt} ft)` : ''} ${range}${conf}`;
    case 'vis':
      return `Reduced visibility${p.visSm !== undefined ? ` (${fmtVis(p.visSm)} sm)` : ''} ${range}${conf}`;
  }
}

function headlineFor(s: Span, range: string): string {
  const p = s.peak;
  const word = likelihood(s.maxConfidence);
  switch (s.kind) {
    case 'ts':
      return `Thunderstorms ${word} ${range} — expect holding and arrival delays`;
    case 'lvp':
      return `${p.wx.some((w) => w.includes('FG')) ? 'Fog' : 'Low visibility'} ${range}: low-visibility procedures, reduced arrival rate`;
    case 'freezing':
      return `Freezing precipitation ${word} ${range} — de-icing delays, reduced arrival rate`;
    case 'snow':
      return `Snow ${word} ${range} — runway clearing and de-icing delays`;
    case 'squall':
      return `Squalls ${word} ${range} — expect holding and go-arounds`;
    case 'wind':
      return `Strong winds${p.gustKt ? ` gusting ${p.gustKt} kt` : ''} ${range} — increased spacing and possible go-arounds`;
    case 'crosswind':
      return `Strong crosswind ${range} — runway limitations, reduced arrival rate`;
    case 'lowcloud':
      return `Low cloud ${range} — instrument approaches, some arrival delays`;
    case 'vis':
      return `Reduced visibility ${range} — instrument approaches, some arrival delays`;
  }
}

/** One-line headline plus detail lines for an hourly forecast. */
export function summarize(hours: HourForecast[], tz: (t: number) => string = defaultTz): ForecastSummary {
  if (!hours.length) return { level: 0, headline: 'No forecast available', detail: [] };
  let worst = hours[0]!;
  for (const h of hours) {
    if (h.capacity < worst.capacity - 1e-9 || (Math.abs(h.capacity - worst.capacity) < 1e-9 && CATEGORY_RANK[h.category] > CATEGORY_RANK[worst.category])) worst = h;
  }
  const level = hours.reduce<0 | 1 | 2 | 3>((m, h) => Math.max(m, hourLevel(h)) as 0 | 1 | 2 | 3, 0);
  if (level === 0) return { level, headline: 'No weather disruption expected', detail: [], worst };

  const range = (s: Span) => `${tz(s.start)}–${tz(s.end)}`;
  const spans = spansOf(hours);
  const worstKinds = kindsOf(worst);
  const primaryKind = KIND_ORDER.find((k) => worstKinds.has(k));
  const primary =
    (primaryKind && spans.find((s) => s.kind === primaryKind && s.start <= worst.t && worst.t < s.end)) ??
    spans.slice().sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))[0];

  const detail = spans.map((s) => describeSpan(s, range(s)));
  if (worst.capacity < 1) detail.push(`Lowest expected arrival capacity ≈ ${Math.round(worst.capacity * 100)}% at ${tz(worst.t)}`);
  const headline = primary ? headlineFor(primary, range(primary)) : `${worst.category} conditions around ${tz(worst.t)}`;
  return { level, headline, detail, worst };
}
