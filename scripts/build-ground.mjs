// Builds airport ground data for the simulation from OpenStreetMap (ODbL) via Overpass:
//   public/data/ground/<IDENT>.json  — taxiway network, holding points, terminals
//     { v: 2, nodes: [[lat,lon]], edges: [[a,b,name]], names: [..], holds: [[lat,lon,ref]],
//       terminals: [{ name, lat, lon, ring }], stands: [[lat,lon,ref,hdg|null,terminal,kind]] }
//   public/data/ground/stands.json   — every airport's stands and terminal names, loaded by the
//     simulation in the background: { v: 3, airports: { IDENT: { c: [lat,lon], t: [names],
//     s: [[dLat·1e5, dLon·1e5, ref, hdg|null, terminal, kind]] } } }
//
//   npm run data:ground    (occasional; the output is committed)
//   GROUND_AIRPORTS=220 GROUND_BUDGET_MIN=150 npm run data:ground
//
// Stand kinds: 0 contact (at a terminal), 1 remote (bussed), 2 cargo apron, 3 general aviation.
//
// Overpass etiquette (https://wiki.openstreetmap.org/wiki/Overpass_API): one query at a
// time, an identifying User-Agent, a pause between queries, back-off on 429/504, and a
// time budget per run. Airports already fetched (v2) are skipped, so a run can resume.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/data/ground');
const UA = 'ArnavFlightRadar-build/2.0 (https://github.com/Arnav-Dugad/Arnav-Flight-Radar)';
const MAX_AIRPORTS = Number(process.env.GROUND_AIRPORTS ?? 220);
const BUDGET_MS = Number(process.env.GROUND_BUDGET_MIN ?? 10) * 60_000;
const ONLY = process.env.GROUND_ONLY?.split(',');
const MERGE_ONLY = process.env.GROUND_MERGE_ONLY === '1';
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
// Large airports with no hub carrier still see plenty of traffic: rank them after the hubs.
for (const r of rows) if (r[8] === 0 && !weight.has(r[0])) weight.set(r[0], 1);
const runways = JSON.parse(readFileSync(join(ROOT, 'public/data/airports/runways-major.json'), 'utf8')).runways;
const hubs = ONLY ?? [...weight.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h).filter((h) => pos.has(h)).slice(0, MAX_AIRPORTS);

const D2R = Math.PI / 180;
const bearing = (a, b) => {
  const y = Math.sin((b[1] - a[1]) * D2R) * Math.cos(b[0] * D2R);
  const x = Math.cos(a[0] * D2R) * Math.sin(b[0] * D2R) - Math.sin(a[0] * D2R) * Math.cos(b[0] * D2R) * Math.cos((b[1] - a[1]) * D2R);
  return Math.round(((Math.atan2(y, x) / D2R + 360) % 360) * 10) / 10;
};
const r5 = (v) => Math.round(v * 1e5) / 1e5;
function inside(p, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if (yi > p[0] !== yj > p[0] && p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** Distance in metres from a point to a polygon (0 inside). */
function toRing(p, ring) {
  if (inside(p, ring)) return 0;
  let best = Infinity;
  const k = Math.cos(p[0] * D2R);
  const P = [p[1] * k, p[0]];
  for (let i = 0; i < ring.length - 1; i++) {
    const A = [ring[i][1] * k, ring[i][0]];
    const B = [ring[i + 1][1] * k, ring[i + 1][0]];
    const dx = B[0] - A[0];
    const dy = B[1] - A[1];
    const t = Math.max(0, Math.min(1, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(P[0] - A[0] - t * dx, P[1] - A[1] - t * dy) * 111_320);
  }
  return best;
}
function centroid(ring) {
  let la = 0;
  let lo = 0;
  for (const p of ring) {
    la += p[0];
    lo += p[1];
  }
  return [r5(la / ring.length), r5(lo / ring.length)];
}
/** Keeps every n-th vertex so outlines stay small (labels and stand assignment only). */
function thin(ring, max = 48) {
  if (ring.length <= max) return ring.map((p) => [r5(p[0]), r5(p[1])]);
  const step = ring.length / max;
  const out = [];
  for (let i = 0; i < max; i++) out.push(ring[Math.floor(i * step)]);
  out.push(ring[0]);
  return out.map((p) => [r5(p[0]), r5(p[1])]);
}
const ringsOf = (el) => {
  if (el.type === 'way' && el.geometry?.length >= 4) return [el.geometry.map((g) => [g.lat, g.lon])];
  if (el.type === 'relation') return (el.members ?? []).filter((m) => m.role === 'outer' && m.geometry?.length >= 4).map((m) => m.geometry.map((g) => [g.lat, g.lon]));
  return [];
};
function terminalName(tags) {
  const raw = String(tags.name ?? tags['name:en'] ?? tags.ref ?? '').trim();
  if (!raw) return '';
  if (/^[0-9A-Z]{1,3}$/.test(raw)) return `Terminal ${raw}`;
  const m = raw.match(/terminal\s*([0-9A-Z]{1,3})\b/i);
  return m ? `Terminal ${m[1].toUpperCase()}` : raw.length > 32 ? raw.slice(0, 32) : raw;
}

async function overpass(q) {
  for (let attempt = 0; attempt < 5; attempt++) {
    let res;
    try {
      res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: q }),
      });
    } catch {
      await sleep(30_000);
      continue;
    }
    if (res.status === 429 || res.status === 504 || res.status === 502) {
      console.log(`  overpass busy (${res.status}), waiting 45 s…`);
      await sleep(45_000);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
  throw new Error('overpass unavailable');
}

function bbox(ident) {
  const [lat, lon] = pos.get(ident);
  let s = lat - 0.03;
  let n = lat + 0.03;
  let w = lon - 0.03 / Math.cos(lat * D2R);
  let e = lon + 0.03 / Math.cos(lat * D2R);
  for (const r of runways[ident] ?? []) {
    for (const [la, lo] of [
      [r[1], r[2]],
      [r[5], r[6]],
    ]) {
      if (!la && !lo) continue;
      s = Math.min(s, la);
      n = Math.max(n, la);
      w = Math.min(w, lo);
      e = Math.max(e, lo);
    }
  }
  const m = 0.012;
  return [s - m, w - m / Math.cos(lat * D2R), n + m, e + m / Math.cos(lat * D2R)];
}

const started = Date.now();
let fetched = 0;
for (const ident of MERGE_ONLY ? [] : hubs) {
  const file = join(OUT, `${ident}.json`);
  if (existsSync(file)) {
    try {
      if (JSON.parse(readFileSync(file, 'utf8')).v === 2) continue;
    } catch {
      /* refetch */
    }
  }
  if (Date.now() - started > BUDGET_MS) {
    console.log('ground: time budget used — run again later for the remaining airports');
    break;
  }
  const [s, w, n, e] = bbox(ident);
  const q = `[out:json][timeout:150][bbox:${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)}];
(way[aeroway~"^(taxiway|taxilane)$"]; way[aeroway=parking_position]; node[aeroway=parking_position];
 way[aeroway=terminal]; relation[aeroway=terminal]; node[aeroway=holding_position]; way[aeroway=apron];);
out body geom qt;`;
  try {
    const t0 = Date.now();
    const j = await overpass(q);
    const index = new Map();
    const nodes = [];
    const edges = new Map();
    const names = [];
    const nameIdx = new Map();
    const stands = [];
    const holds = [];
    const terminals = [];
    const aprons = [];
    const nameOf = (tags) => {
      const raw = String(tags?.ref ?? tags?.name ?? '').trim();
      if (!raw || raw.length > 8) return -1;
      if (!nameIdx.has(raw)) {
        nameIdx.set(raw, names.length);
        names.push(raw);
      }
      return nameIdx.get(raw);
    };
    for (const el of j.elements) {
      const aw = el.tags?.aeroway;
      if (el.type === 'way' && (aw === 'taxiway' || aw === 'taxilane') && el.geometry?.length === el.nodes?.length) {
        const nm = nameOf(el.tags);
        let prev = -1;
        el.nodes.forEach((id, k) => {
          let i = index.get(id);
          if (i === undefined) {
            i = nodes.length;
            index.set(id, i);
            nodes.push([r5(el.geometry[k].lat), r5(el.geometry[k].lon)]);
          }
          if (prev >= 0 && prev !== i) {
            const key = prev < i ? `${prev},${i}` : `${i},${prev}`;
            if (!edges.has(key) || edges.get(key) < 0) edges.set(key, nm);
          }
          prev = i;
        });
      } else if (aw === 'parking_position' && el.type === 'way' && el.geometry?.length >= 2) {
        const g = el.geometry;
        const a = [g[0].lat, g[0].lon];
        const b = [g[g.length - 1].lat, g[g.length - 1].lon];
        stands.push([r5((a[0] + b[0]) / 2), r5((a[1] + b[1]) / 2), String(el.tags.ref ?? '').slice(0, 8), bearing(a, b)]);
      } else if (aw === 'parking_position' && el.type === 'node') {
        stands.push([r5(el.lat), r5(el.lon), String(el.tags.ref ?? '').slice(0, 8), null]);
      } else if (aw === 'holding_position' && el.type === 'node') {
        const ref = String(el.tags.ref ?? el.tags.name ?? '').trim();
        if (ref && ref.length <= 8) holds.push([r5(el.lat), r5(el.lon), ref]);
      } else if (aw === 'terminal') {
        const name = terminalName(el.tags);
        for (const ring of ringsOf(el)) {
          const area = Math.abs(ring.reduce((a, p, i) => (i ? a + (ring[i - 1][1] * p[0] - p[1] * ring[i - 1][0]) : a), 0));
          terminals.push({ name, ring, area });
        }
      } else if (aw === 'apron') {
        const label = `${el.tags.name ?? ''} ${el.tags.apron ?? ''} ${el.tags.usage ?? ''}`.toLowerCase();
        const kind = /cargo|freight|fracht|carga|fret|mail/.test(label) ? 2 : /general aviation|\bga\b|business|fbo|executive|private/.test(label) ? 3 : -1;
        if (kind >= 0) for (const ring of ringsOf(el)) aprons.push({ ring, kind });
      }
    }
    // Merge terminal pieces that share a name; name the unnamed ones by size order.
    const merged = [];
    for (const t of terminals.sort((a, b) => b.area - a.area)) {
      if (t.area < 2e-7 && !t.name) continue; // kiosks and sheds
      if (/suite|baggage|^T\dIB$|vip|lounge|royal/i.test(t.name)) continue;
      const same = t.name && merged.find((m) => m.name === t.name);
      if (same) same.rings.push(t.ring);
      else merged.push({ name: t.name, rings: [t.ring] });
    }
    let unnamed = 0;
    for (const m of merged) if (!m.name) m.name = merged.filter((x) => x.name).length || unnamed ? `Terminal ${String.fromCharCode(65 + unnamed++)}` : 'Terminal';
    const outTerms = merged.slice(0, 12).map((m) => {
      const main = m.rings[0];
      const [lat, lon] = centroid(main);
      return { name: m.name, lat, lon, ring: thin(main) };
    });
    // Assign every stand to a terminal (contact within 220 m) or classify it.
    const rowsOut = stands.map((s) => {
      const p = [s[0], s[1]];
      let best = -1;
      let bd = Infinity;
      merged.slice(0, 12).forEach((m, i) => {
        for (const ring of m.rings) {
          const d = toRing(p, ring);
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
      });
      const apron = aprons.find((a) => inside(p, a.ring));
      let kind = bd <= 220 ? 0 : 1;
      if (apron) kind = apron.kind;
      else if (bd > 1400) kind = 3;
      return [...s, bd <= 1400 ? best : -1, kind];
    });
    // Drop exact duplicates (a way and a node for the same stand).
    const seen = new Set();
    const uniq = rowsOut.filter((r) => {
      const k = `${r[0].toFixed(4)},${r[1].toFixed(4)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const edgeRows = [...edges.entries()].map(([k, nm]) => [...k.split(',').map(Number), nm]);
    writeFileSync(file, JSON.stringify({ v: 2, source: '© OpenStreetMap contributors (ODbL)', nodes, edges: edgeRows, names, holds, terminals: outTerms, stands: uniq }));
    fetched++;
    console.log(
      `ground: ${ident} — ${nodes.length} nodes, ${edgeRows.length} edges, ${names.length} names, ${holds.length} holds, ${outTerms.length} terminals, ${uniq.length} stands (${((Date.now() - t0) / 1000).toFixed(0)} s)`,
    );
  } catch (err) {
    console.warn(`ground: ${ident} failed: ${err.message}`);
  }
  await sleep(6_000);
}

// Merge every airport's stands into one compact file the simulation loads in the background:
// positions are stored as integer offsets (1e-5°, about a metre) from the airport reference
// point, headings as whole degrees.
const all = {};
for (const f of readdirSync(OUT)) {
  if (!/^[A-Z0-9]{3,4}\.json$/.test(f)) continue;
  const j = JSON.parse(readFileSync(join(OUT, f), 'utf8'));
  const ident = f.replace('.json', '');
  // v1 files (stands without terminals) are kept until the airport is fetched again.
  if (!j.stands?.length || !pos.has(ident)) continue;
  const [clat, clon] = pos.get(ident).map((v) => Math.round(v * 1e4) / 1e4);
  all[ident] = {
    c: [clat, clon],
    t: (j.terminals ?? []).map((t) => t.name),
    s: j.stands.map(([la, lo, ref, hdg, term = -1, kind = 0]) => [Math.round((la - clat) * 1e5), Math.round((lo - clon) * 1e5), ref, hdg === null ? null : Math.round(hdg), term, kind]),
  };
}
writeFileSync(join(OUT, 'stands.json'), JSON.stringify({ v: 3, source: '© OpenStreetMap contributors (ODbL)', airports: all }));
console.log(`ground: fetched ${fetched}; stands for ${Object.keys(all).length} airports`);
