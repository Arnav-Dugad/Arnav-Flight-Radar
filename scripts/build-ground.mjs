// Builds airport ground data for the simulation from OpenStreetMap (ODbL) via Overpass:
//   public/data/ground/<IDENT>.json  — taxiway network { nodes: [[lat,lon]], edges: [[a,b]] }
//   public/data/ground/stands.json   — parking positions { stands: { IDENT: [[lat,lon,ref,hdg|null]] } }
//
//   npm run data:ground    (one-off / occasional; the output is committed)
//
// Overpass etiquette (https://wiki.openstreetmap.org/wiki/Overpass_API): one query at a
// time, an identifying User-Agent, a pause between queries, back-off on 429, and at most
// ~10 minutes of server time per run. Airports already fetched are skipped, so the
// remaining ones can be fetched by running the script again another day.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/data/ground');
const UA = 'ArnavFlightRadar-build/1.0 (https://github.com/Arnav-Dugad/Arnav-Flight-Radar)';
const MAX_AIRPORTS = Number(process.env.GROUND_AIRPORTS ?? 25);
const BUDGET_MS = Number(process.env.GROUND_BUDGET_MIN ?? 10) * 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

// Busiest simulated hubs: airline size shared across its hubs.
const fleet = readFileSync(join(ROOT, 'src/data/sim/fleet.ts'), 'utf8') + readFileSync(join(ROOT, 'src/data/sim/fleet-more.ts'), 'utf8');
const weight = new Map();
for (const m of fleet.matchAll(/airline\('[A-Z]{3}', '[A-Z0-9]{0,2}', '[^']+', '[A-Z]{2}', '[^']+', '([^']+)', '[^']+', (\d+)/g)) {
  const hubs = m[1].split(' ');
  for (const h of hubs) weight.set(h, (weight.get(h) ?? 0) + Number(m[2]) / hubs.length);
}
const rows = JSON.parse(readFileSync(join(ROOT, 'public/data/airports/index-major.json'), 'utf8')).rows;
const pos = new Map(rows.map((r) => [r[0], [r[6], r[7]]]));
const hubs = [...weight.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h).filter((h) => pos.has(h)).slice(0, MAX_AIRPORTS);

const D2R = Math.PI / 180;
const bearing = (a, b) => {
  const y = Math.sin((b[1] - a[1]) * D2R) * Math.cos(b[0] * D2R);
  const x = Math.cos(a[0] * D2R) * Math.sin(b[0] * D2R) - Math.sin(a[0] * D2R) * Math.cos(b[0] * D2R) * Math.cos((b[1] - a[1]) * D2R);
  return Math.round(((Math.atan2(y, x) / D2R + 360) % 360) * 10) / 10;
};
const r5 = (v) => Math.round(v * 1e5) / 1e5;

async function overpass(q) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: q }),
    });
    if (res.status === 429 || res.status === 504) {
      console.log('  overpass busy, waiting 30 s…');
      await sleep(30_000);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  throw new Error('overpass unavailable');
}

const started = Date.now();
for (const ident of hubs) {
  const file = join(OUT, `${ident}.json`);
  if (existsSync(file)) continue;
  if (Date.now() - started > BUDGET_MS) {
    console.log('ground: time budget used — run again later for the remaining airports');
    break;
  }
  const [lat, lon] = pos.get(ident);
  const dLat = 0.042;
  const dLon = 0.042 / Math.cos(lat * D2R);
  const q = `[out:json][timeout:90][bbox:${(lat - dLat).toFixed(4)},${(lon - dLon).toFixed(4)},${(lat + dLat).toFixed(4)},${(lon + dLon).toFixed(4)}];
(way[aeroway=taxiway]; way[aeroway=parking_position]; node[aeroway=parking_position];);
out body geom qt;`;
  try {
    const t0 = Date.now();
    const j = await overpass(q);
    const index = new Map();
    const nodes = [];
    const edges = new Set();
    const stands = [];
    for (const el of j.elements) {
      if (el.type === 'way' && el.tags?.aeroway === 'taxiway' && el.geometry?.length === el.nodes?.length) {
        let prev = -1;
        el.nodes.forEach((id, k) => {
          let i = index.get(id);
          if (i === undefined) {
            i = nodes.length;
            index.set(id, i);
            nodes.push([r5(el.geometry[k].lat), r5(el.geometry[k].lon)]);
          }
          if (prev >= 0 && prev !== i) edges.add(prev < i ? `${prev},${i}` : `${i},${prev}`);
          prev = i;
        });
      } else if (el.type === 'way' && el.tags?.aeroway === 'parking_position' && el.geometry?.length >= 2) {
        const g = el.geometry;
        const a = [g[0].lat, g[0].lon];
        const b = [g[g.length - 1].lat, g[g.length - 1].lon];
        stands.push([r5((a[0] + b[0]) / 2), r5((a[1] + b[1]) / 2), String(el.tags.ref ?? ''), bearing(a, b)]);
      } else if (el.type === 'node' && el.tags?.aeroway === 'parking_position') {
        stands.push([r5(el.lat), r5(el.lon), String(el.tags.ref ?? ''), null]);
      }
    }
    writeFileSync(file, JSON.stringify({ v: 1, source: '© OpenStreetMap contributors (ODbL)', nodes, edges: [...edges].map((e) => e.split(',').map(Number)), stands }));
    console.log(`ground: ${ident} — ${nodes.length} taxiway nodes, ${edges.size} edges, ${stands.length} stands (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  } catch (e) {
    console.warn(`ground: ${ident} failed: ${e.message}`);
  }
  await sleep(5_000);
}

// Merge every airport's stands into one small file loaded when the simulation starts.
const all = {};
for (const f of readdirSync(OUT)) {
  if (!/^[A-Z0-9]{3,4}\.json$/.test(f)) continue;
  const j = JSON.parse(readFileSync(join(OUT, f), 'utf8'));
  if (j.stands?.length) all[f.replace('.json', '')] = j.stands;
}
writeFileSync(join(OUT, 'stands.json'), JSON.stringify({ v: 1, source: '© OpenStreetMap contributors (ODbL)', stands: all }));
console.log(`ground: stands for ${Object.keys(all).length} airports`);
