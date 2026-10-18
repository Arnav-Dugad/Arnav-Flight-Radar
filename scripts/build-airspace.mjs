// Builds controlled-airspace files for Canada and Europe from openAIP exports.
//   public/data/airspace/<cc>.json   — { f: [[geometry, name, class, kind, lowerLabel, upperLabel]] }
//   public/data/airspace/index.json  — { countries: { cc: [west, south, east, north] } }
//
//   npm run data:airspace   (occasional; the output is committed)
//
// openAIP (https://www.openaip.net) data is licensed CC BY-NC 4.0: non-commercial use with
// attribution ("openAIP"). This project is non-commercial and credits openAIP wherever the
// layer is shown. US airspace comes from the FAA instead (public domain, loaded live).
// Kept: CTR / TMA / CTA in ICAO classes A–E, and restricted / danger / prohibited
// areas. Geometry is rounded to ~10 m.
// Informational only — never for navigation.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/data/airspace');
const UA = { 'User-Agent': 'ArnavFlightRadar-build/1.0 (https://github.com/Arnav-Dugad/Arnav-Flight-Radar)' };
mkdirSync(OUT, { recursive: true });

const COUNTRIES = ['ca', 'gb', 'ie', 'fr', 'de', 'nl', 'be', 'lu', 'ch', 'at', 'it', 'es', 'pt', 'dk', 'no', 'se', 'fi', 'is', 'pl', 'cz', 'sk', 'hu', 'si', 'hr', 'gr', 'ro', 'bg', 'ee', 'lv', 'lt', 'mt', 'cy'];
const CLASS = { 0: 'A', 1: 'B', 2: 'C', 3: 'D', 4: 'E' };
const KIND = { 4: 'CTR', 7: 'TMA', 26: 'CTA' };
// Special-use airspace (any class): restricted, danger, prohibited.
const SUA = { 1: 'Restricted', 2: 'Danger', 3: 'Prohibited' };

/** Altitude limit in feet (approximate MSL; FL × 100; SFC = 0). */
function limitFt(l) {
  if (!l) return null;
  if (l.referenceDatum === 0 && (l.value ?? 0) === 0) return 0;
  if (l.unit === 6) return Math.round(l.value * 100);
  return Math.round(l.unit === 0 ? l.value * 3.28084 : l.value);
}

function limit(l) {
  if (!l) return '?';
  if (l.referenceDatum === 0 && (l.value ?? 0) === 0) return 'SFC';
  if (l.unit === 6) return `FL${Math.round(l.value)}`;
  const ft = l.unit === 0 ? l.value * 3.28084 : l.value; // 0 = metres, 1 = feet
  return String(Math.round(ft / 100));
}

const r4 = (v) => Math.round(v * 1e4) / 1e4;
function roundRing(ring) {
  const out = [];
  for (const [x, y] of ring) {
    const p = [r4(x), r4(y)];
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
  }
  return out.length >= 4 ? out : null;
}
function roundGeom(g) {
  if (g.type === 'Polygon') {
    const rings = g.coordinates.map(roundRing).filter(Boolean);
    return rings.length ? { type: 'Polygon', coordinates: rings } : null;
  }
  if (g.type === 'MultiPolygon') {
    const polys = g.coordinates.map((p) => p.map(roundRing).filter(Boolean)).filter((p) => p.length);
    return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null;
  }
  return null;
}

const index = {};
for (const cc of COUNTRIES) {
  try {
    const res = await fetch(`https://s3.openaip.net/openaip-system-exports/${cc}_asp.geojson`, { headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const f = [];
    let w = 180,
      s = 90,
      e = -180,
      n = -90;
    for (const feat of j.features ?? []) {
      const p = feat.properties ?? {};
      const sua = SUA[p.type];
      const cls = sua ? 'SUA' : CLASS[p.icaoClass];
      // Canada files terminal airspace as "other" (type 0); keep its class C/D areas.
      // (Canadian class B is high-level en-route airspace, unlike US class B.)
      const kind = sua ?? KIND[p.type] ?? (p.type === 0 && (cls === 'C' || cls === 'D') ? 'TCA' : undefined);
      if (!cls || !kind || !feat.geometry) continue;
      const g = roundGeom(feat.geometry);
      if (!g) continue;
      const flat = g.type === 'Polygon' ? g.coordinates.flat() : g.coordinates.flat(2);
      for (const [x, y] of flat) {
        w = Math.min(w, x);
        e = Math.max(e, x);
        s = Math.min(s, y);
        n = Math.max(n, y);
      }
      f.push([g, String(p.name ?? ''), cls, kind, limit(p.lowerLimit), limit(p.upperLimit), limitFt(p.lowerLimit), limitFt(p.upperLimit)]);
    }
    if (!f.length) continue;
    writeFileSync(join(OUT, `${cc}.json`), JSON.stringify({ v: 1, source: 'openAIP (CC BY-NC 4.0)', f }));
    index[cc] = [w, s, e, n].map((v) => Math.round(v * 100) / 100);
    console.log(`airspace: ${cc} ${f.length} areas`);
  } catch (err) {
    console.warn(`airspace: ${cc} failed: ${err.message}`);
  }
  await new Promise((r) => setTimeout(r, 800));
}
writeFileSync(
  join(OUT, 'index.json'),
  JSON.stringify({ v: 1, generatedAt: new Date().toISOString(), source: 'openAIP (https://www.openaip.net), CC BY-NC 4.0', countries: index }),
);
console.log(`airspace: ${Object.keys(index).length} countries`);
