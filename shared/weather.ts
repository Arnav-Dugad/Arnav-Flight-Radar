// AviationWeather.gov (NOAA) JSON → normalized METAR/TAF.

import type { CloudLayer, Metar, Taf, TafPeriod } from './types';

type Raw = Record<string, unknown>;

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export const STATION_RE = /^[A-Z0-9]{3,4}$/;

function clouds(v: unknown): CloudLayer[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((c) => {
    if (!c || typeof c !== 'object') return [];
    const o = c as Raw;
    const cover = str(o.cover);
    if (!cover) return [];
    const layer: CloudLayer = { cover };
    const base = num(o.base);
    if (base !== undefined) layer.baseFt = base;
    const type = str(o.type);
    if (type) layer.type = type;
    return [layer];
  });
}

function visibility(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined;
  const n = num(v);
  return n === undefined ? undefined : String(Math.round(n * 100) / 100);
}

const FLIGHT_CATS = new Set(['VFR', 'MVFR', 'IFR', 'LIFR']);

export function normalizeMetar(raw: unknown): Metar | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const station = str(r.icaoId)?.toUpperCase();
  const obs = num(r.obsTime);
  const rawOb = str(r.rawOb);
  if (!station || obs === undefined || !rawOb) return null;
  const m: Metar = { station, observedAt: obs * 1000, raw: rawOb, clouds: clouds(r.clouds) };
  const set = <K extends keyof Metar>(k: K, v: Metar[K] | undefined) => {
    if (v !== undefined) m[k] = v;
  };
  set('name', str(r.name));
  set('lat', num(r.lat));
  set('lon', num(r.lon));
  set('elevationM', num(r.elev));
  set('tempC', num(r.temp));
  set('dewpointC', num(r.dewp));
  if (r.wdir === 'VRB') m.windVariable = true;
  else set('windDirDeg', num(r.wdir));
  set('windSpeedKt', num(r.wspd));
  set('windGustKt', num(r.wgst));
  set('visibility', visibility(r.visib));
  set('altimeterHpa', num(r.altim));
  set('weather', str(r.wxString));
  const cat = str(r.fltCat);
  if (cat && FLIGHT_CATS.has(cat)) m.flightCategory = cat as Metar['flightCategory'];
  return m;
}

export function normalizeTaf(raw: unknown): Taf | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Raw;
  const station = str(r.icaoId)?.toUpperCase();
  const rawTaf = str(r.rawTAF);
  const from = num(r.validTimeFrom);
  const to = num(r.validTimeTo);
  if (!station || !rawTaf || from === undefined || to === undefined) return null;
  const issued = str(r.issueTime);
  const issuedAt = issued ? Date.parse(issued) : NaN;
  const periods: TafPeriod[] = Array.isArray(r.fcsts)
    ? r.fcsts.flatMap((f) => {
        if (!f || typeof f !== 'object') return [];
        const o = f as Raw;
        const pf = num(o.timeFrom);
        const pt = num(o.timeTo);
        if (pf === undefined || pt === undefined) return [];
        const p: TafPeriod = { from: pf * 1000, to: pt * 1000, clouds: clouds(o.clouds) };
        const change = str(o.fcstChange);
        if (change) p.change = change;
        const prob = num(o.probability);
        if (prob !== undefined) p.probability = prob;
        const wdir = num(o.wdir);
        if (wdir !== undefined) p.windDirDeg = wdir;
        const wspd = num(o.wspd);
        if (wspd !== undefined) p.windSpeedKt = wspd;
        const wgst = num(o.wgst);
        if (wgst !== undefined) p.windGustKt = wgst;
        const vis = visibility(o.visib);
        if (vis) p.visibility = vis;
        const wx = str(o.wxString);
        if (wx) p.weather = wx;
        return [p];
      })
    : [];
  const taf: Taf = {
    station,
    issuedAt: Number.isFinite(issuedAt) ? issuedAt : from * 1000,
    validFrom: from * 1000,
    validTo: to * 1000,
    raw: rawTaf,
    periods,
  };
  const name = str(r.name);
  if (name) taf.name = name;
  return taf;
}

/** Human-readable decoding of cloud cover codes. */
export const CLOUD_COVER: Record<string, string> = {
  SKC: 'Sky clear',
  CLR: 'Clear below 12,000 ft',
  NSC: 'No significant cloud',
  NCD: 'No cloud detected',
  CAVOK: 'Ceiling and visibility OK',
  FEW: 'Few (1–2 oktas)',
  SCT: 'Scattered (3–4 oktas)',
  BKN: 'Broken (5–7 oktas)',
  OVC: 'Overcast (8 oktas)',
  OVX: 'Sky obscured',
  VV: 'Vertical visibility',
};

export const FLIGHT_CATEGORY_INFO: Record<string, string> = {
  VFR: 'Visual flight rules — ceiling > 3,000 ft and visibility > 5 SM',
  MVFR: 'Marginal VFR — ceiling 1,000–3,000 ft and/or visibility 3–5 SM',
  IFR: 'Instrument flight rules — ceiling 500–999 ft and/or visibility 1–3 SM',
  LIFR: 'Low IFR — ceiling < 500 ft and/or visibility < 1 SM',
};

const WX_CODES: Record<string, string> = {
  MI: 'shallow',
  BC: 'patches of',
  PR: 'partial',
  DR: 'low drifting',
  BL: 'blowing',
  SH: 'showers of',
  TS: 'thunderstorm',
  FZ: 'freezing',
  DZ: 'drizzle',
  RA: 'rain',
  SN: 'snow',
  SG: 'snow grains',
  IC: 'ice crystals',
  PL: 'ice pellets',
  GR: 'hail',
  GS: 'small hail',
  UP: 'unknown precipitation',
  BR: 'mist',
  FG: 'fog',
  FU: 'smoke',
  VA: 'volcanic ash',
  DU: 'dust',
  SA: 'sand',
  HZ: 'haze',
  PO: 'dust whirls',
  SQ: 'squalls',
  FC: 'funnel cloud',
  SS: 'sandstorm',
  DS: 'duststorm',
  VC: 'in the vicinity',
};

/** "-SHRA BR" → "light showers of rain, mist". */
export function decodeWeather(wx: string): string {
  return wx
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      let t = tok;
      let prefix = '';
      if (t.startsWith('+')) {
        prefix = 'heavy ';
        t = t.slice(1);
      } else if (t.startsWith('-')) {
        prefix = 'light ';
        t = t.slice(1);
      }
      const parts: string[] = [];
      for (let i = 0; i + 2 <= t.length; i += 2) parts.push(WX_CODES[t.slice(i, i + 2)] ?? t.slice(i, i + 2));
      return prefix + parts.join(' ');
    })
    .join(', ');
}
