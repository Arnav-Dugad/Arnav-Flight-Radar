// Builds the REAL published US airway network for the traffic simulator from the en-route
// airway records (ARINC 424 section ER) of the FAA Coded Instrument Flight Procedures (CIFP) —
// a public-domain U.S. Government dataset published every 28 days by FAA Aeronautical
// Information Services: https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/
//
//   node scripts/build-airways.mjs [--force] [--zip <path to CIFP_YYMMDD.zip>]
//
// The CIFP zip is shared with scripts/build-procedures.mjs (cached in node_modules/.cache/cifp),
// so building both costs a single download per 28-day cycle.
//
// Output (regenerated on every run): public/data/sim/airways-us.json
//   { v, generatedAt, source, cycle, effective, fixes, airways }
//   fixes    [ident, lat, lon] for waypoints, [ident, lat, lon, kind, name] for navaids
//            (kind 0 VOR, 1 VOR-DME, 2 VORTAC, 3 NDB — as in navaids.json)
//   airways  one entry per continuous airway segment (an identifier can have several):
//            { a: "J60", l: "H" | "L" | "B", f: [fix index…], m?, x?, d? }
//              l  altitude band: H high (FL180+), L low (below FL180), B both
//              m  minimum en-route altitude per leg in hundreds of feet (a single number when
//                 every leg has the same value; omitted when unknown)
//              x  maximum authorised altitude per leg, same encoding
//              d  one-way legs: one character per leg, "F" = only in coded order, "B" = only
//                 against it, " " = both ways (omitted when every leg is two-way)
// Reference data for the simulation only — never for navigation.
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { col, parseLatLon, parseAlt, unzipEntry } from './build-procedures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'data', 'sim', 'airways-us.json');
const CACHE = join(ROOT, 'node_modules', '.cache', 'cifp');
const PAGE = 'https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/download/';
const UA = 'ArnavFlightRadar-build/1.0 (https://github.com/Arnav-Dugad/Arnav-Flight-Radar)';
const MAX_BYTES = 600 * 1024;
const r4 = (x) => Math.round(x * 1e4) / 1e4;

/** "LOS ANGELES" → "Los Angeles". */
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (_, p, c) => p + c.toUpperCase());

/**
 * Fix records an airway can reference. Returns null for anything else.
 *   { key: "EA|CANDR|K6" | "D|JFK|K6" | "DB|ADK|PA", ident, lat, lon, kind?, name? }
 */
export function parseFixRecord(line) {
  if (line.length < 100 || line[0] !== 'S') return null;
  const sec = line[4];
  const sub = line[5];
  if (!'01'.includes(line[21])) return null; // continuation records
  if (sec === 'E' && sub === 'A') {
    const p = parseLatLon(line);
    const ident = col(line, 14, 18).trim();
    return p && { key: `EA|${ident}|${col(line, 20, 21)}`, ident, lat: p[0], lon: p[1] };
  }
  if (sec === 'D' && (sub === ' ' || sub === 'B')) {
    // DME-only / TACAN stations carry their position in the DME fields (cols 56-74).
    const p = parseLatLon(line) ?? (sub === ' ' ? parseLatLon(line, 56) : null);
    if (!p) return null;
    const ident = col(line, 14, 17).trim();
    // Navaid class (cols 28-29): V = VOR; D = DME, T/M = TACAN.
    const c2 = line[28];
    const kind = sub === 'B' ? 3 : line[27] !== 'V' ? 1 : c2 === 'D' ? 1 : c2 === 'T' || c2 === 'M' ? 2 : 0;
    const name = titleCase(col(line, 94, 123).trim());
    return { key: `${sub === 'B' ? 'DB' : 'D'}|${ident}|${col(line, 20, 21)}`, ident, lat: p[0], lon: p[1], kind, name };
  }
  return null;
}

/**
 * One en-route airway record (section E, subsection R). The record describes the leg from its
 * fix to the next fix of the airway: minimum / maximum altitude and direction restriction
 * belong to that leg.
 *   { area, id, seq, fix, fixKey, end, level, dir, min, max }
 */
export function parseAirwayRecord(line) {
  if (line.length < 100 || line[0] !== 'S' || line[4] !== 'E' || line[5] !== 'R') return null;
  if (line[38] !== '0' && line[38] !== '1') return null; // continuation records
  const id = col(line, 14, 18).trim();
  const fix = col(line, 30, 34).trim();
  if (!id || !fix) return null;
  const fsec = col(line, 37, 38);
  const icao = col(line, 35, 36);
  const fixKey = fsec === 'EA' ? `EA|${fix}|${icao}` : fsec === 'D ' ? `D|${fix}|${icao}` : fsec === 'DB' ? `DB|${fix}|${icao}` : null;
  const alt = (s) => (s.trim() === 'UNKNN' ? null : parseAlt(s));
  return {
    area: col(line, 2, 4),
    id,
    seq: +col(line, 26, 29),
    fix,
    fixKey,
    // Waypoint description code, 2nd character (col 41) "E" = end of a continuous airway.
    end: line[40] === 'E',
    level: line[45] === 'H' || line[45] === 'L' ? line[45] : 'B',
    dir: line[46] === 'F' || line[46] === 'B' ? line[46] : ' ',
    min: alt(col(line, 84, 88)),
    max: alt(col(line, 94, 98)),
  };
}

/** Per-leg values in hundreds of feet: a single number when uniform, undefined when unknown. */
function packAlts(values) {
  const h = values.map((v) => (v === null || v === undefined ? 0 : Math.round(v / 100)));
  if (!h.some((v) => v > 0)) return undefined;
  return h.every((v) => v === h[0]) ? h[0] : h;
}

/**
 * Turns airway records (file order) into the compact { fixes, airways } tables.
 * @param records parsed airway records
 * @param fixes   Map fixKey → { ident, lat, lon, kind?, name? }
 */
export function buildAirways(records, fixes, stats = { unresolved: 0, segments: 0 }) {
  const table = [];
  const index = new Map(); // ident|lat|lon → table index (merges one fix coded in two regions)
  const fixIndex = (f) => {
    const k = `${f.ident}|${r4(f.lat)}|${r4(f.lon)}`;
    let i = index.get(k);
    if (i === undefined) {
      i = table.length;
      index.set(k, i);
      table.push(f.kind === undefined ? [f.ident, r4(f.lat), r4(f.lon)] : [f.ident, r4(f.lat), r4(f.lon), f.kind, f.name ?? '']);
    }
    return i;
  };
  const airways = [];
  let cur = null; // { a, pts: [{ f: fix, rec }] }
  const flush = () => {
    if (cur && cur.pts.length >= 2) {
      const legs = cur.pts.slice(0, -1).map((p) => p.rec);
      const lv = new Set(legs.map((r) => r.level));
      // Undesignated level: decide from the published altitudes.
      let l = lv.size === 1 ? [...lv][0] : 'B';
      if (l === 'B') {
        const lo = Math.min(...legs.map((r) => r.min ?? 0));
        const hi = Math.max(...legs.map((r) => r.max ?? 60000));
        if (hi < 18000) l = 'L';
        else if (lo >= 18000) l = 'H';
      }
      const seg = { a: cur.a, l, f: cur.pts.map((p) => fixIndex(p.f)) };
      const m = packAlts(legs.map((r) => r.min));
      const x = packAlts(legs.map((r) => r.max));
      if (m !== undefined) seg.m = m;
      if (x !== undefined) seg.x = x;
      const d = legs.map((r) => r.dir).join('');
      if (d.trim()) seg.d = d;
      airways.push(seg);
      stats.segments++;
    }
    cur = null;
  };
  let prev = null;
  for (const r of records) {
    if (!prev || prev.area !== r.area || prev.id !== r.id || r.seq <= prev.seq || prev.end) flush();
    prev = r;
    const f = r.fixKey ? fixes.get(r.fixKey) : undefined;
    if (!f) {
      // An unresolved fix breaks the airway: never join its neighbours with a false leg.
      stats.unresolved++;
      flush();
      continue;
    }
    if (!cur) cur = { a: r.id, pts: [] };
    if (cur.pts.at(-1)?.f === f) continue;
    cur.pts.push({ f, rec: r });
  }
  flush();
  return { fixes: table, airways };
}

// --- download (once, cached; shared with build-procedures.mjs) --------------------------
async function getZip(force) {
  mkdirSync(CACHE, { recursive: true });
  const cached = readdirSync(CACHE)
    .filter((f) => /^CIFP_\d{6}\.zip$/.test(f))
    .sort();
  const cycleDate = (f) => new Date(`20${f.slice(5, 7)}-${f.slice(7, 9)}-${f.slice(9, 11)}T00:00:00Z`);
  const current = cached.filter((f) => {
    const t = cycleDate(f).getTime();
    return t <= Date.now() && Date.now() < t + 28 * 86400e3;
  });
  if (!force && current.length) return { name: current.at(-1), buf: readFileSync(join(CACHE, current.at(-1))) };
  let links;
  try {
    const res = await fetch(PAGE, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    links = [...new Set([...html.matchAll(/https?:\/\/[^"'\s>]+\/CIFP_(\d{6})\.zip/g)].map((m) => m[0]))].sort();
  } catch (e) {
    if (!cached.length) throw new Error(`airways: cannot reach the FAA CIFP page (${e.message})`, { cause: e });
    console.warn(`airways: FAA page unreachable (${e.message}); using cached ${cached.at(-1)}`);
    return { name: cached.at(-1), buf: readFileSync(join(CACHE, cached.at(-1))) };
  }
  if (!links.length) throw new Error('airways: no CIFP_YYMMDD.zip link on the FAA download page');
  const today = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const eff = links.filter((u) => /CIFP_(\d{6})/.exec(u)[1] <= today);
  const url = (eff.length ? eff : links).at(eff.length ? -1 : 0);
  const name = /CIFP_\d{6}\.zip/.exec(url)[0];
  const path = join(CACHE, name);
  if (!force && existsSync(path)) return { name, buf: readFileSync(path) };
  console.log(`airways: downloading ${url}…`);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(path, buf);
  return { name, buf };
}

// --- main --------------------------------------------------------------------------------
async function main() {
  const force = process.argv.includes('--force');
  const zi = process.argv.indexOf('--zip');
  const { name, buf } =
    zi > 0 && process.argv[zi + 1]
      ? { name: process.argv[zi + 1].replace(/^.*[\\/]/, ''), buf: readFileSync(process.argv[zi + 1]) }
      : await getZip(force);
  const lines = unzipEntry(buf, 'FAACIFP18').toString('latin1').split(/\r?\n/);
  const hdr = lines.find((l) => l.startsWith('HDR01')) ?? '';
  const cycle = /FAACIFP18\s+\S+\s+\S*?(\d{4})\s/.exec(hdr)?.[1] ?? col(hdr, 36, 39);
  const ymd = /CIFP_(\d{2})(\d{2})(\d{2})/.exec(name);
  const effective = ymd ? `20${ymd[1]}-${ymd[2]}-${ymd[3]}` : null;

  const fixes = new Map();
  const records = [];
  for (const line of lines) {
    const a = parseAirwayRecord(line);
    if (a) {
      records.push(a);
      continue;
    }
    const f = parseFixRecord(line);
    if (f && !fixes.has(f.key)) fixes.set(f.key, f);
  }
  const stats = { unresolved: 0, segments: 0 };
  const built = buildAirways(records, fixes, stats);
  const out = {
    v: 1,
    generatedAt: new Date().toISOString(),
    source: `FAA CIFP ${cycle} (public domain)`,
    cycle,
    effective,
    ...built,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out));
  const size = statSync(OUT).size;
  const ids = new Set(built.airways.map((s) => s.a));
  const byKind = {};
  for (const id of ids) byKind[id[0]] = (byKind[id[0]] ?? 0) + 1;
  const bands = { H: 0, L: 0, B: 0 };
  for (const s of built.airways) bands[s.l]++;
  console.log(
    `airways: cycle ${cycle} (${effective}) — ${ids.size} airways in ${stats.segments} segments ` +
      `(H ${bands.H} / L ${bands.L} / both ${bands.B}), ${built.fixes.length} fixes, ` +
      `${stats.unresolved} unresolved fix refs, ${(size / 1024).toFixed(1)} KB`,
  );
  console.log(`airways: by prefix ${Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(' ')}`);
  if (size > MAX_BYTES) console.warn(`airways: WARNING output exceeds ${MAX_BYTES / 1024} KB`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
