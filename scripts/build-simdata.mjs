// Builds compact reference files for the traffic simulator from OurAirports (public domain).
//   node scripts/build-simdata.mjs [--force]      (--force re-downloads the cached CSVs)
// Output (regenerated on every run, so the script is idempotent):
//   public/data/sim/navaids.json      VOR family worldwide + NDBs near large airports (procedure-style fixes)
//   public/data/sim/frequencies.json  published ATC frequencies for large/medium airports (radio transcript)
//   public/data/sim/heliports.json    city heliports, hospital helipads and offshore platforms (helicopter traffic)
//   public/data/sim/gliding.json      gliding sites (glider traffic)
// Requires public/data/airports/index-major.json (npm run data:airports).
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'data', 'sim');
const CACHE = join(ROOT, 'node_modules', '.cache', 'ourairports');
const BASE = 'https://davidmegginson.github.io/ourairports-data';
const UA = 'ArnavFlightRadar-build/1.0 (https://github.com/Arnav-Dugad/Arnav-Flight-Radar)';
const SOURCE = 'OurAirports (public domain)';
const force = process.argv.includes('--force');

// --- tiny RFC 4180 CSV parser (copied from build-airports.mjs) ------------------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

async function download(name) {
  mkdirSync(CACHE, { recursive: true });
  const path = join(CACHE, name);
  if (!force && existsSync(path)) return readFileSync(path, 'utf8');
  console.log(`simdata: downloading ${name}…`);
  const res = await fetch(`${BASE}/${name}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const text = await res.text();
  writeFileSync(path, text);
  return text;
}

const n = (v) => {
  if (v === '' || v === undefined) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const r3 = (x) => Math.round(x * 1e3) / 1e3;

// Title-case names that arrive in all caps; mixed-case names are already cased (keeps "NYU", "McAllen").
const SMALL = new Set(['of', 'de', 'la', 'le', 'du', 'des', 'and', 'the', 'del', 'di', 'da', 'am', 'im', 'an', 'der']);
function nameCase(s, max) {
  let t = s.replace(/\s+/g, ' ').trim();
  if (!/[a-z]/.test(t)) {
    t = t
      .toLowerCase()
      .split(' ')
      .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.replace(/(^|[-/(.'])(\p{L})/gu, (_, p, c) => p + c.toUpperCase())))
      .join(' ');
  }
  return t.length > max ? t.slice(0, max).trim() : t;
}

// --- geometry -------------------------------------------------------------------
const toRad = (d) => (d * Math.PI) / 180;
function distNm(a1, o1, a2, o2) {
  const dLat = toRad(a2 - a1);
  const dLon = toRad(o2 - o1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a1)) * Math.cos(toRad(a2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h)));
}
// 1-degree grid index for coarse "nearest point within R NM" queries.
function makeGrid(points) {
  const g = new Map();
  for (const p of points) {
    const k = `${Math.floor(p.lat)},${Math.floor(p.lon)}`;
    const list = g.get(k);
    if (list) list.push(p);
    else g.set(k, [p]);
  }
  return {
    nearest(lat, lon, maxNm) {
      const dLat = Math.ceil(maxNm / 60);
      const dLon = Math.min(180, Math.ceil(maxNm / (60 * Math.max(0.05, Math.cos(toRad(Math.min(89, Math.abs(lat)) + dLat))))));
      let best = null;
      let bestD = maxNm;
      const la0 = Math.floor(lat);
      const lo0 = Math.floor(lon);
      for (let a = la0 - dLat; a <= la0 + dLat; a++) {
        for (let o = lo0 - dLon; o <= lo0 + dLon; o++) {
          const oo = ((((o + 180) % 360) + 360) % 360) - 180;
          const list = g.get(`${a},${oo}`);
          if (!list) continue;
          for (const p of list) {
            const d = distNm(lat, lon, p.lat, p.lon);
            if (d <= bestD) {
              bestD = d;
              best = p;
            }
          }
        }
      }
      return best ? { p: best, d: bestD } : null;
    },
  };
}

// --- inputs -----------------------------------------------------------------------
const majorPath = join(ROOT, 'public', 'data', 'airports', 'index-major.json');
if (!existsSync(majorPath)) throw new Error('simdata: public/data/airports/index-major.json missing — run npm run data:airports first');
const major = JSON.parse(readFileSync(majorPath, 'utf8')).rows;

const [aText, fText, nText] = await Promise.all(['airports.csv', 'airport-frequencies.csv', 'navaids.csv'].map(download));
const airports = parseCsv(aText);
const freqs = parseCsv(fText);
const navaids = parseCsv(nText);

const pt = (a) => ({ ident: a.ident, lat: Number(a.latitude_deg), lon: Number(a.longitude_deg) });
const valid = (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon);
const largeGrid = makeGrid(airports.filter((a) => a.type === 'large_airport').map(pt).filter(valid));
const fixedWingGrid = makeGrid(
  airports.filter((a) => a.type === 'large_airport' || a.type === 'medium_airport' || a.type === 'small_airport').map(pt).filter(valid),
);

mkdirSync(OUT, { recursive: true });
const generatedAt = new Date().toISOString();
function write(name, obj, summary) {
  const path = join(OUT, name);
  writeFileSync(path, JSON.stringify({ v: 1, generatedAt, source: SOURCE, ...obj }));
  console.log(`simdata: ${name.padEnd(17)} ${(statSync(path).size / 1024).toFixed(1).padStart(7)} KB  ${summary}`);
}

// --- 1. navaids ---------------------------------------------------------------------
const NAV_KIND = { VOR: 0, 'VOR-DME': 1, VORTAC: 2, NDB: 3, 'NDB-DME': 4 };
const navRows = [];
for (const v of navaids) {
  const kind = NAV_KIND[v.type];
  if (kind === undefined) continue;
  const lat = n(v.latitude_deg);
  const lon = n(v.longitude_deg);
  const khz = n(v.frequency_khz);
  if (lat === null || lon === null || !v.ident) continue;
  if (kind >= 3 && !largeGrid.nearest(lat, lon, 60)) continue;
  navRows.push([v.ident, nameCase(v.name || v.ident, 24), kind, r4(lat), r4(lon), khz ?? 0, v.iso_country]);
}
navRows.sort((x, y) => x[0].localeCompare(y[0]) || x[6].localeCompare(y[6]));
const navCounts = [0, 0, 0, 0, 0];
for (const r of navRows) navCounts[r[2]]++;
write(
  'navaids.json',
  { kinds: ['VOR', 'VOR-DME', 'VORTAC', 'NDB', 'NDB-DME'], rows: navRows },
  `${navRows.length} navaids (VOR ${navCounts[0]}, VOR-DME ${navCounts[1]}, VORTAC ${navCounts[2]}, NDB ${navCounts[3]}, NDB-DME ${navCounts[4]})`,
);

// --- 2. frequencies -------------------------------------------------------------------
// OurAirports types are free text from many national sources; map the common ones and
// use the description for the ambiguous ones (A/D is "approach/departure" in FAA data but
// sometimes carries a centre; GCCD is ground-or-clearance in some European AIPs).
const TYPE_MAP = {
  TWR: 'twr', TOWER: 'twr', AFIS: 'twr', 'A/G': 'twr',
  GND: 'gnd', GROUND: 'gnd', GRN: 'gnd', SMC: 'gnd',
  APP: 'app', APPROACH: 'app', APPR: 'app', ARR: 'app', DIR: 'app', 'APP/DEP': 'app', 'RAD/APP': 'app', TCA: 'app', RDR: 'app', RADAR: 'app',
  DEP: 'dep',
  ATIS: 'atis', 'D-ATIS': 'atis',
  CLD: 'del', CLNC: 'del', DEL: 'del', CD: 'del',
  CTR: 'ctr', CNTR: 'ctr', ACC: 'ctr', ARTC: 'ctr', ARTCC: 'ctr',
};
function classifyByDesc(desc) {
  const d = desc.toUpperCase();
  if (/\bATIS\b/.test(d)) return 'atis';
  if (/\b(CNTR|CENTER|CENTRE|CTR|ACC|CONTROL)\b/.test(d) && !/\b(APP|APPROACH|TWR|TOWER)\b/.test(d)) return 'ctr';
  if (/\b(CLNC|CLEARANCE|DELIVERY|DEL|CD)\b/.test(d)) return 'del';
  if (/\b(DEP|DEPARTURE)\b/.test(d) && !/\b(APP|APPROACH)\b/.test(d)) return 'dep';
  if (/\b(APP|APPROACH|ARR|ARRIVAL|DIRECTOR|DIR|RADAR|TRML|TERMINAL)\b/.test(d)) return 'app';
  if (/\b(GND|GROUND|SMC)\b/.test(d)) return 'gnd';
  if (/\b(TWR|TOWER)\b/.test(d)) return 'twr';
  return null;
}
const DESC_TYPES = new Set(['A/D', 'GCCD', 'MISC']);
const freqIdents = new Set(major.filter((r) => r[8] <= 1).map((r) => r[0]));
const ORDER = ['twr', 'gnd', 'app', 'dep', 'atis', 'del', 'ctr'];
const freqOut = {};
for (const f of freqs) {
  if (!freqIdents.has(f.airport_ident)) continue;
  const type = f.type.trim().toUpperCase();
  let kind = TYPE_MAP[type] ?? null;
  if (DESC_TYPES.has(type)) kind = classifyByDesc(f.description || '') ?? (type === 'A/D' ? 'app' : null);
  else if (type === 'TWR' && /\bGND|GROUND\b/i.test(f.description)) kind = 'gnd';
  if (!kind) continue;
  const mhz = n(f.frequency_mhz);
  if (mhz === null) continue;
  // VHF comms only (no UHF military channels); ATIS may share a VOR frequency.
  if (kind === 'atis' ? mhz < 108 || mhz > 137 : mhz < 118 || mhz > 137) continue;
  const o = (freqOut[f.airport_ident] ??= {});
  const list = (o[kind] ??= []);
  const v = r3(mhz);
  if (!list.includes(v) && list.length < 3) list.push(v);
}
let freqAirports = 0;
const freqKindCount = Object.fromEntries(ORDER.map((k) => [k, 0]));
const freqFinal = {};
for (const ident of Object.keys(freqOut).sort()) {
  const o = freqOut[ident];
  if (!o.twr && !o.gnd && !o.app) continue;
  const sorted = {};
  for (const k of ORDER) {
    if (o[k]) {
      sorted[k] = o[k];
      freqKindCount[k]++;
    }
  }
  freqFinal[ident] = sorted;
  freqAirports++;
}
write(
  'frequencies.json',
  { airports: freqFinal },
  `${freqAirports} airports (${ORDER.map((k) => `${k} ${freqKindCount[k]}`).join(', ')})`,
);

// --- 3. heliports -----------------------------------------------------------------------
const HOSPITAL = /hospital|medical|med ctr|medical center|health|clinic|trauma|klinik|krankenhaus|hôpital|hopital|ospedale|spital|hospitaal/i;
// "rig" as a whole word (not "Brig"); "field" only as oil/gas field, since plain "Field" names
// many onshore heliports at sports grounds and private strips ("Fedex Field", "Schultz Field").
const OFFSHORE = /platform|\brig\b|offshore|fpso|\b(oil|gas)\s?field\b/i;
const CITY_PER_HUB = 15;
const HOSPITAL_PER_HUB = 30;
const NORTH_SEA = new Set(['GB', 'NO', 'DK', 'NL']);
const isOffshore = (a, lat, lon) => {
  if (OFFSHORE.test(a.name)) return true;
  if (NORTH_SEA.has(a.iso_country) && lon >= -2 && lon <= 8 && lat >= 52.5 && lat <= 62.5 && !fixedWingGrid.nearest(lat, lon, 15)) return true;
  if (a.iso_country === 'US' && lat < 29.6 && lon >= -97.5 && lon <= -87.5 && (/^[A-Z]{2,3}[ -]?\d+/.test(a.name) || /block/i.test(a.name))) return true;
  return false;
};
const heliRows = [];
// City heliports and hospital helipads are capped per large airport (nearest first) so dense
// regions (US, JP, BR, KR) don't dominate the file; offshore platforms are all kept.
const cityByHub = new Map();
const hospitalsByHub = new Map();
const addToHub = (map, hub, row) => {
  const list = map.get(hub.p.ident) ?? [];
  list.push({ d: hub.d, row });
  map.set(hub.p.ident, list);
};
for (const a of airports) {
  if (a.type !== 'heliport') continue;
  const lat = n(a.latitude_deg);
  const lon = n(a.longitude_deg);
  if (lat === null || lon === null) continue;
  const row = (kind) => [a.ident, nameCase(a.name || a.ident, 32), r4(lat), r4(lon), a.iso_country, kind, n(a.elevation_ft)];
  if (HOSPITAL.test(a.name)) {
    const hub = largeGrid.nearest(lat, lon, 60);
    if (hub) addToHub(hospitalsByHub, hub, row(1));
  } else if (isOffshore(a, lat, lon)) heliRows.push(row(2));
  else {
    const hub = largeGrid.nearest(lat, lon, 40);
    if (hub) addToHub(cityByHub, hub, row(0));
  }
}
for (const [map, cap] of [[cityByHub, CITY_PER_HUB], [hospitalsByHub, HOSPITAL_PER_HUB]]) {
  for (const list of map.values()) {
    list.sort((x, y) => x.d - y.d);
    for (const h of list.slice(0, cap)) heliRows.push(h.row);
  }
}
heliRows.sort((x, y) => x[0].localeCompare(y[0]));
const heliCounts = [0, 0, 0];
for (const r of heliRows) heliCounts[r[5]]++;
write(
  'heliports.json',
  { kinds: ['heliport', 'hospital', 'offshore'], rows: heliRows },
  `${heliRows.length} heliports (city ${heliCounts[0]}, hospital ${heliCounts[1]}, offshore ${heliCounts[2]})`,
);

// --- 4. gliding sites ----------------------------------------------------------------------
const GLIDING_NAME = /glid|segelflug|vol à voile|vol a voile|zweefvlieg|soaring|sailplane|szybowisk|segelflyg|purjelento|planeur|volo a vela|szybowc|plachtar|kluzák|svæveflyv|seilfly/i;
const GLIDING_KW = /glid|segelflug|soaring|sailplane|vol à voile|vol a voile|zweefvlieg|segelflyg|szybow|svæveflyv|seilfly|volo a vela/i;
const glideRows = [];
for (const a of airports) {
  if (a.type === 'closed') continue;
  const lat = n(a.latitude_deg);
  const lon = n(a.longitude_deg);
  if (lat === null || lon === null) continue;
  const byName = a.type === 'small_airport' && GLIDING_NAME.test(a.name);
  if (!byName && !GLIDING_KW.test(a.keywords)) continue;
  glideRows.push([a.ident, nameCase(a.name || a.ident, 32), r4(lat), r4(lon), a.iso_country, n(a.elevation_ft)]);
}
glideRows.sort((x, y) => x[0].localeCompare(y[0]));
const glideTop = Object.entries(glideRows.reduce((m, r) => ((m[r[4]] = (m[r[4]] ?? 0) + 1), m), {}))
  .sort((x, y) => y[1] - x[1])
  .slice(0, 6)
  .map(([c, k]) => `${c} ${k}`)
  .join(', ');
write('gliding.json', { rows: glideRows }, `${glideRows.length} gliding sites (${glideTop})`);
