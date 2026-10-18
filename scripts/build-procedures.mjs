// Builds REAL published US departure (SID / named ODP) and arrival (STAR) procedures for the
// traffic simulator from the FAA Coded Instrument Flight Procedures (CIFP) — a public-domain
// U.S. Government dataset in ARINC 424-18 format, published every 28 days by FAA Aeronautical
// Information Services: https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/
//
//   node scripts/build-procedures.mjs [--force]    (--force re-downloads the cached zip)
//
// Output (regenerated on every run, so the script is idempotent):
//   public/data/sim/procedures-us.json
//     { v, generatedAt, source, cycle, effective, airports: { KJFK: { lat, lon, sids, stars } } }
//     sid/star = { name, rwys, tracks, rwt? }
//       rwys    runways served ("RW04L"…) or ["ALL"]
//       tracks  one fix sequence per en-route transition (SID: common route + en-route
//               transition; STAR: en-route transition + common route). A fix is
//               [ident, lat, lon] or [ident, lat, lon, constraint] where constraint is
//               "+2500" (at or above), "-11000" (at or below), "@9000" (at) or "B13000/11000"
//               (between upper/lower), in feet.
//       rwt     runway-transition fixes keyed by runway ("RW04L": [fix…]); a SID flies them
//               before its track, a STAR after it. Runways whose transition is only
//               headings/vectors have no entry.
// CIFP carries no holding-pattern records and its STARs contain no HA/HF/HM legs, so no holds
// are emitted (the simulator keeps holding over the STAR's last fix / a nearby navaid).
// Requires public/data/airports/index-major.json (npm run data:airports) for the airport list.
// Reference data for the simulation only — never for navigation.
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'data', 'sim', 'procedures-us.json');
const CACHE = join(ROOT, 'node_modules', '.cache', 'cifp');
const PAGE = 'https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/download/';
const UA = 'ArnavFlightRadar-build/1.0 (https://github.com/Arnav-Dugad/Arnav-Flight-Radar)';
const MAX_BYTES = 1.5 * 1024 * 1024;

// --- ARINC 424-18 field helpers (columns are 1-based in the spec) -------------------------
/** Characters `from`..`to` (1-based, inclusive) of a fixed-width record. */
export const col = (line, from, to) => line.slice(from - 1, to);
const r4 = (x) => Math.round(x * 1e4) / 1e4;

/** "N40401997" → 40.67221 (hemisphere, DD MM SS ss). */
export function parseLat(s) {
  const m = /^([NS])(\d{2})(\d{2})(\d{4})$/.exec(s);
  if (!m) return null;
  const v = +m[2] + +m[3] / 60 + +m[4] / 100 / 3600;
  return m[1] === 'S' ? -v : v;
}
/** "W073444686" → -73.74635 (hemisphere, DDD MM SS ss). */
export function parseLon(s) {
  const m = /^([EW])(\d{3})(\d{2})(\d{4})$/.exec(s);
  if (!m) return null;
  const v = +m[2] + +m[3] / 60 + +m[4] / 100 / 3600;
  return m[1] === 'W' ? -v : v;
}
/** Latitude at cols 33-41 and longitude at cols 42-51 (the standard position of most records). */
export function parseLatLon(line, at = 33) {
  const lat = parseLat(line.slice(at - 1, at + 8));
  const lon = parseLon(line.slice(at + 8, at + 18));
  return lat === null || lon === null ? null : [lat, lon];
}
/** "02500" → 2500, "FL240" → 24000, blank → null. */
export function parseAlt(s) {
  const t = s.trim();
  if (!t) return null;
  if (/^FL\d{3}$/.test(t)) return +t.slice(2) * 100;
  return /^-?\d+$/.test(t) ? +t : null;
}

/**
 * Classifies one 132-character record. Returns null for records this build does not use.
 *   { kind: 'fix', key, lat, lon }                         navaids / waypoints / airport / runway
 *   { kind: 'leg', airport, sub, proc, routeType, trans, seq, fix, fixKey, leg, turn, alt, course }
 */
export function parseRecord(line) {
  if (line.length < 100 || line[0] !== 'S') return null;
  const sec = line[4];
  const sub6 = line[5];
  // Enroute waypoint (EA): ident 14-18, ICAO 20-21, continuation 22.
  if (sec === 'E' && sub6 === 'A') {
    if (!'01'.includes(line[21])) return null;
    const p = parseLatLon(line);
    return p && { kind: 'fix', key: `EA|${col(line, 14, 18).trim()}|${col(line, 20, 21)}`, lat: p[0], lon: p[1] };
  }
  // VHF navaid (D ) and enroute NDB (DB): ident 14-17, ICAO 20-21; DME-only stations carry the
  // position in the DME latitude/longitude fields (cols 56-74).
  if (sec === 'D' && (sub6 === ' ' || sub6 === 'B')) {
    if (!'01'.includes(line[21])) return null;
    const p = parseLatLon(line) ?? (sub6 === ' ' ? parseLatLon(line, 56) : null);
    const k = sub6 === ' ' ? 'D' : 'DB';
    return p && { kind: 'fix', key: `${k}|${col(line, 14, 17).trim()}|${col(line, 20, 21)}`, lat: p[0], lon: p[1] };
  }
  // Terminal NDB (PN): airport 7-10, ident 14-17, ICAO 20-21.
  if (sec === 'P' && sub6 === 'N') {
    if (!'01'.includes(line[21])) return null;
    const p = parseLatLon(line);
    return p && { kind: 'fix', key: `PN|${col(line, 7, 10).trim()}|${col(line, 14, 17).trim()}`, lat: p[0], lon: p[1] };
  }
  if (sec !== 'P' || sub6 !== ' ') return null;
  const airport = col(line, 7, 10).trim();
  const sub = line[12];
  if (sub === 'A' || sub === 'C' || sub === 'G') {
    if (!'01'.includes(line[21])) return null;
    const p = parseLatLon(line);
    if (!p) return null;
    const ident = col(line, 14, 18).trim();
    const key = sub === 'A' ? `PA|${airport}` : sub === 'C' ? `PC|${airport}|${ident}` : `PG|${airport}|${ident}`;
    return { kind: 'fix', key, lat: p[0], lon: p[1], ident, icao: col(line, 20, 21) };
  }
  if (sub !== 'D' && sub !== 'E') return null;
  // Procedure continuation records (col 39 > 1) use a different layout.
  if (!'01'.includes(line[38])) return null;
  const fix = col(line, 30, 34).trim();
  const fsec = line[36];
  const fsub = line[37];
  const ficao = col(line, 35, 36);
  let fixKey = null;
  if (fix) {
    if (fsec === 'D') fixKey = fsub === 'B' ? `DB|${fix}|${ficao}` : `D|${fix}|${ficao}`;
    else if (fsec === 'E' && fsub === 'A') fixKey = `EA|${fix}|${ficao}`;
    else if (fsec === 'P' && fsub === 'C') fixKey = `PC|${airport}|${fix}`;
    else if (fsec === 'P' && fsub === 'N') fixKey = `PN|${airport}|${fix}`;
    else if (fsec === 'P' && (fsub === 'A' || fsub === 'G')) fixKey = null; // the airport / a runway threshold
  }
  const altDesc = line[82];
  const a1 = parseAlt(col(line, 85, 89));
  const a2 = parseAlt(col(line, 90, 94));
  let alt = null;
  if (a1 !== null) {
    if (altDesc === '+') alt = `+${a1}`;
    else if (altDesc === '-') alt = `-${a1}`;
    else if (altDesc === ' ' || altDesc === '@') alt = `@${a1}`;
    else if (altDesc === 'B' && a2 !== null) alt = `B${Math.max(a1, a2)}/${Math.min(a1, a2)}`;
  }
  const crs = col(line, 71, 74).trim();
  return {
    kind: 'leg',
    airport,
    sub,
    proc: col(line, 14, 19).trim(),
    routeType: line[19],
    trans: col(line, 21, 25).trim(),
    seq: +col(line, 27, 29),
    fix,
    fixKey,
    leg: col(line, 48, 49),
    turn: line[43],
    alt,
    course: /^\d{4}$/.test(crs) ? +crs / 10 : null,
  };
}

// Route types (ARINC 424-18 §5.7). SID: 1/4/F/T runway transition, 2/5/M common route,
// 3/6/S/V en-route transition, 0 engine-out (skipped). STAR: 1/4/7/F en-route transition,
// 2/5/8/M common route, 3/6/9/S runway transition.
const SID_PART = { 1: 'rw', 4: 'rw', F: 'rw', T: 'rw', 2: 'common', 5: 'common', M: 'common', 3: 'enrt', 6: 'enrt', S: 'enrt', V: 'enrt' };
const STAR_PART = { 1: 'enrt', 4: 'enrt', 7: 'enrt', F: 'enrt', 2: 'common', 5: 'common', 8: 'common', M: 'common', 3: 'rw', 6: 'rw', 9: 'rw', S: 'rw' };

/** "RW04B" → ["RW04L","RW04R"] using the airport's runway list; "ALL"/"" → ["ALL"]. */
export function expandRunway(trans, runways) {
  if (!trans || trans === 'ALL') return ['ALL'];
  if (!trans.startsWith('RW')) return [];
  if (trans.endsWith('B') && trans.length === 5) {
    const base = trans.slice(0, 4);
    const hit = runways.filter((r) => r.length === 5 && r.startsWith(base) && 'LRC'.includes(r[4]));
    return hit.length ? hit : [`${base}L`, `${base}R`];
  }
  return [trans];
}

/**
 * Turns the legs of one airport into compact procedures.
 * @param legs   parsed 'leg' records of one airport, in file order
 * @param fixes  Map key → [lat, lon]
 * @param runways runway idents at the airport ("RW04L"…)
 */
export function buildProcedures(legs, fixes, runways, stats = { unresolved: 0 }) {
  const groups = new Map(); // `${sub}|${proc}` → Map(`${part}|${trans}` → legs[])
  for (const l of legs) {
    const part = (l.sub === 'D' ? SID_PART : STAR_PART)[l.routeType];
    if (!part) continue;
    const gk = `${l.sub}|${l.proc}`;
    if (!groups.has(gk)) groups.set(gk, new Map());
    const g = groups.get(gk);
    const tk = `${part}|${l.trans}`;
    if (!g.has(tk)) g.set(tk, []);
    g.get(tk).push(l);
  }
  const toFixes = (ls) => {
    const out = [];
    for (const l of [...ls].sort((a, b) => a.seq - b.seq)) {
      if (!l.fixKey) continue;
      const p = fixes.get(l.fixKey);
      if (!p) {
        stats.unresolved++;
        continue;
      }
      const f = [l.fix, r4(p[0]), r4(p[1])];
      if (l.alt) f.push(l.alt);
      const last = out[out.length - 1];
      if (last && last[0] === f[0]) {
        if (f[3] && !last[3]) last[3] = f[3];
        continue;
      }
      out.push(f);
    }
    return out;
  };
  const join2 = (a, b) => {
    const out = a.map((f) => [...f]);
    for (const f of b) {
      const last = out[out.length - 1];
      if (last && last[0] === f[0]) {
        if (f[3] && !last[3]) last[3] = f[3];
        continue;
      }
      out.push([...f]);
    }
    return out;
  };
  const sids = [];
  const stars = [];
  for (const [gk, g] of groups) {
    const isSid = gk[0] === 'D';
    const name = gk.slice(2);
    const parts = { rw: [], common: [], enrt: [] };
    for (const [tk, ls] of g) {
      const [part, trans] = tk.split('|');
      parts[part].push({ trans, fixes: toFixes(ls), legs: ls });
    }
    // Runways served.
    const rwys = new Set();
    const rwt = {};
    for (const t of parts.rw) {
      for (const r of expandRunway(t.trans, runways)) {
        rwys.add(r);
        if (t.fixes.length && r !== 'ALL') rwt[r] = t.fixes;
      }
    }
    for (const t of parts.common) if (t.trans.startsWith('RW')) for (const r of expandRunway(t.trans, runways)) rwys.add(r);
    if (!rwys.size || rwys.has('ALL')) {
      rwys.clear();
      rwys.add('ALL');
    }
    const common = parts.common.reduce((acc, t) => join2(acc, t.fixes), []);
    let tracks = parts.enrt.length
      ? parts.enrt.map((t) => (isSid ? join2(common, t.fixes) : join2(t.fixes, common)))
      : common.length
        ? [common]
        : [];
    // Runway-only procedures: their runway transitions are the whole route.
    if (!tracks.some((t) => t.length)) {
      tracks = Object.values(rwt);
      for (const k of Object.keys(rwt)) delete rwt[k];
    }
    const seen = new Set();
    tracks = tracks.filter((t) => {
      const k = JSON.stringify(t);
      if (!t.length || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (!tracks.length) continue;
    const proc = { name, rwys: [...rwys].sort(), tracks };
    if (Object.keys(rwt).length) proc.rwt = rwt;
    (isSid ? sids : stars).push(proc);
  }
  const byName = (a, b) => a.name.localeCompare(b.name);
  return { sids: sids.sort(byName), stars: stars.sort(byName) };
}

// --- zip (store / deflate) reader --------------------------------------------------------
export function unzipEntry(buf, wanted) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip: end of central directory not found');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('latin1', p + 46, p + 46 + nameLen);
    if (name === wanted) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + csize);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw new Error(`zip: unsupported method ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`zip: ${wanted} not found`);
}

// --- download (once, cached) -------------------------------------------------------------
async function getZip(force) {
  mkdirSync(CACHE, { recursive: true });
  const cached = readdirSync(CACHE)
    .filter((f) => /^CIFP_\d{6}\.zip$/.test(f))
    .sort();
  // A cached cycle that is still in force (cycles last 28 days) is used without any request.
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
    if (!cached.length) throw new Error(`procedures: cannot reach the FAA CIFP page (${e.message})`, { cause: e });
    console.warn(`procedures: FAA page unreachable (${e.message}); using cached ${cached.at(-1)}`);
    return { name: cached.at(-1), buf: readFileSync(join(CACHE, cached.at(-1))) };
  }
  if (!links.length) throw new Error('procedures: no CIFP_YYMMDD.zip link on the FAA download page');
  // The page lists the current cycle and (near a changeover) the next one: take the newest
  // cycle that is already effective.
  const today = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const eff = links.filter((u) => /CIFP_(\d{6})/.exec(u)[1] <= today);
  const url = (eff.length ? eff : links).at(eff.length ? -1 : 0);
  const name = /CIFP_\d{6}\.zip/.exec(url)[0];
  const path = join(CACHE, name);
  if (!force && existsSync(path)) return { name, buf: readFileSync(path) };
  console.log(`procedures: downloading ${url}…`);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(path, buf);
  return { name, buf };
}

// --- main --------------------------------------------------------------------------------
async function main() {
  const force = process.argv.includes('--force');
  const majorPath = join(ROOT, 'public', 'data', 'airports', 'index-major.json');
  if (!existsSync(majorPath)) throw new Error('procedures: run `npm run data:airports` first');
  const major = JSON.parse(readFileSync(majorPath, 'utf8')).rows;
  // rows: [ident, icao, iata, name, city, country, lat, lon, type(0 = large), elev, scheduled]
  const wanted = new Set(major.filter((r) => r[5] === 'US' && r[8] === 0).map((r) => r[1] || r[0]));

  const { name, buf } = await getZip(force);
  const text = unzipEntry(buf, 'FAACIFP18').toString('latin1');
  const lines = text.split(/\r?\n/);
  const hdr = lines.find((l) => l.startsWith('HDR01')) ?? '';
  const cycle = /FAACIFP18\s+\S+\s+\S*?(\d{4})\s/.exec(hdr)?.[1] ?? col(hdr, 36, 39);
  const ymd = /CIFP_(\d{2})(\d{2})(\d{2})/.exec(name);
  const effective = ymd ? `20${ymd[1]}-${ymd[2]}-${ymd[3]}` : null;

  const fixes = new Map();
  const legsBy = new Map();
  const runwaysBy = new Map();
  for (const line of lines) {
    const r = parseRecord(line);
    if (!r) continue;
    if (r.kind === 'fix') {
      if (!fixes.has(r.key)) fixes.set(r.key, [r.lat, r.lon]);
      if (r.key.startsWith('PG|')) {
        const apt = r.key.split('|')[1];
        if (!runwaysBy.has(apt)) runwaysBy.set(apt, []);
        runwaysBy.get(apt).push(r.ident);
      }
    } else if (wanted.has(r.airport)) {
      if (!legsBy.has(r.airport)) legsBy.set(r.airport, []);
      legsBy.get(r.airport).push(r);
    }
  }

  const stats = { unresolved: 0 };
  const airports = {};
  let nSid = 0;
  let nStar = 0;
  let nTracks = 0;
  for (const apt of [...wanted].sort()) {
    const ref = fixes.get(`PA|${apt}`);
    const legs = legsBy.get(apt);
    if (!ref || !legs) continue;
    const { sids, stars } = buildProcedures(legs, fixes, runwaysBy.get(apt) ?? [], stats);
    if (!sids.length && !stars.length) continue;
    airports[apt] = { lat: r4(ref[0]), lon: r4(ref[1]), sids, stars };
    nSid += sids.length;
    nStar += stars.length;
    nTracks += [...sids, ...stars].reduce((s, p) => s + p.tracks.length, 0);
  }
  const out = {
    v: 1,
    generatedAt: new Date().toISOString(),
    source: `FAA CIFP ${cycle} (public domain)`,
    cycle,
    effective,
    airports,
  };
  const json = JSON.stringify(out);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, json);
  const size = statSync(OUT).size;
  const missing = [...wanted].filter((a) => !airports[a]);
  console.log(
    `procedures: cycle ${cycle} (${effective}) — ${Object.keys(airports).length}/${wanted.size} airports, ` +
      `${nSid} SIDs, ${nStar} STARs, ${nTracks} tracks, ${stats.unresolved} unresolved fix refs, ` +
      `${(size / 1024).toFixed(1)} KB`,
  );
  if (missing.length) console.log(`procedures: no procedures for ${missing.join(' ')}`);
  if (size > MAX_BYTES) console.warn(`procedures: WARNING output exceeds ${(MAX_BYTES / 1048576).toFixed(1)} MB`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
