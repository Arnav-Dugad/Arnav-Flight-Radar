// Builds public/data/media.json (+ public/media/logos/*) from Wikidata and Wikimedia Commons.
//
//   npm run data:media     (one-off / occasional; the output is committed)
//
// • Airline logos: Wikidata P154 (logo image) for airlines by ICAO designator (P230),
//   current statements only (best rank, no end date). Thumbnails are DOWNLOADED and
//   served from this site (Wikimedia recommends copying over hotlinking).
// • Aircraft-type photos: Wikidata P18 of the exact model/variant item for each ICAO
//   type designator (curated name table — Wikidata has no type-designator property).
// • Livery photos: Commons fleet categories "<Type> of <Airline>" (e.g. "Boeing 787-9
//   of Qantas"), title-checked and filtered (no cockpit/cabin/model/…); hotlinked at a
//   standard thumbnail width.
// Every file on Commons is freely licensed or public domain; licence + author are kept
// and shown next to each image. Logos are trademarks of their owners (identification).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = { 'User-Agent': 'ArnavFlightRadar-build/1.0 (https://github.com/Arnav-Dugad/Arnav-Flight-Radar)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, init = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { ...init, headers: { ...UA, Accept: 'application/json', ...(init.headers ?? {}) } });
    if (res.status === 429 || res.status >= 500) {
      await sleep(30_000);
      continue;
    }
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json();
  }
  throw new Error(`${url}: gave up`);
}

const sparql = (q) => getJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, { headers: { Accept: 'application/sparql-results+json' } });

async function commons(params) {
  await sleep(350); // ≤ ~170 requests/minute, under the anonymous limit
  return getJson(`https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`);
}

const fileTitle = (url) => decodeURIComponent(url.split('/Special:FilePath/')[1] ?? '').replace(/_/g, ' ');

// ------------------------------------------------------------- fleet (demo airlines)

const fleetSrc = readFileSync(join(ROOT, 'src/data/demo/fleet.ts'), 'utf8');
const fleetAirlines = [...fleetSrc.matchAll(/A\('([A-Z]{3})', '([A-Z0-9]{2})', '([^']+)', '[A-Z]{2}', '[^']+', '[^']+', '([^']+)'/g)].map((m) => ({
  icao: m[1],
  name: m[3],
  types: m[4].split(' ').map((p) => p.split(':')[0]),
}));
const airlinesJson = JSON.parse(readFileSync(join(ROOT, 'public/data/airlines.json'), 'utf8')).airlines;

// ------------------------------------------------------------- 1. logos

console.log('media: querying Wikidata for airline logos…');
const logoRows = await sparql(`SELECT ?airline ?icao ?logo ?sl ?dissolved WHERE {
  ?airline p:P230 ?icaoSt . ?icaoSt ps:P230 ?icao .
  FILTER NOT EXISTS { ?icaoSt pq:P582 ?e1 }
  FILTER NOT EXISTS { ?icaoSt wikibase:rank wikibase:DeprecatedRank }
  ?airline p:P154 ?st . ?st ps:P154 ?logo ; a wikibase:BestRank .
  FILTER NOT EXISTS { ?st pq:P582 ?e2 }
  OPTIONAL { ?airline wikibase:sitelinks ?sl }
  OPTIONAL { ?airline wdt:P576 ?dissolved }
}`);
const fleetCodes = new Set(fleetAirlines.map((a) => a.icao));
const bestLogo = new Map();
for (const b of logoRows.results.bindings) {
  const icao = b.icao.value.toUpperCase();
  if (!/^[A-Z]{3}$/.test(icao)) continue;
  // Current airlines only: not dissolved on Wikidata (or simulated in demo mode).
  if (b.dissolved && !fleetCodes.has(icao)) continue;
  void airlinesJson;
  const cand = { file: fileTitle(b.logo.value), sl: Number(b.sl?.value ?? 0), svg: /\.svg$/i.test(b.logo.value) };
  const cur = bestLogo.get(icao);
  if (!cur || cand.sl > cur.sl || (cand.sl === cur.sl && cand.svg && !cur.svg)) bestLogo.set(icao, cand);
}
console.log(`media: ${bestLogo.size} airline logos`);

// ------------------------------------------------------------- 2. aircraft types

// ICAO type designator → exact Wikidata item (verified variant items where known) or English label.
const TYPE_ITEMS = {
  A20N: 'Q58022928', A359: 'Q92162002', B789: 'Q15111575', B77W: 'Q31189801', E190: 'Q2549320', AT76: 'Q19328170', B738: 'Q12476717', B38M: 'Q106340166', C172: 'Q244479', EC35: 'Q39654',
};
const TYPE_LABELS = {
  A318: 'Airbus A318', A319: 'Airbus A319', A320: 'Airbus A320', A321: 'Airbus A321', A21N: 'Airbus A321neo', A19N: 'Airbus A319neo', BCS1: 'Airbus A220-100', BCS3: 'Airbus A220-300',
  A306: 'Airbus A300-600', A310: 'Airbus A310', A332: 'Airbus A330-200', A333: 'Airbus A330-300', A339: 'Airbus A330-900', A338: 'Airbus A330-800', A35K: 'Airbus A350-1000', A388: 'Airbus A380',
  A342: 'Airbus A340-200', A343: 'Airbus A340-300', A346: 'Airbus A340-600', A400: 'Airbus A400M Atlas',
  B712: 'Boeing 717', B733: 'Boeing 737-300', B734: 'Boeing 737-400', B735: 'Boeing 737-500', B736: 'Boeing 737-600', B737: 'Boeing 737-700', B739: 'Boeing 737-900',
  B37M: 'Boeing 737 MAX 7', B39M: 'Boeing 737 MAX 9', B3XM: 'Boeing 737 MAX 10', B752: 'Boeing 757-200', B753: 'Boeing 757-300', B762: 'Boeing 767-200', B763: 'Boeing 767-300', B764: 'Boeing 767-400ER',
  B772: 'Boeing 777-200', B77L: 'Boeing 777-200LR', B773: 'Boeing 777-300', B778: 'Boeing 777-8', B779: 'Boeing 777-9', B788: 'Boeing 787-8', B78X: 'Boeing 787-10',
  B744: 'Boeing 747-400', B748: 'Boeing 747-8', MD11: 'McDonnell Douglas MD-11', MD82: 'McDonnell Douglas MD-82', DC10: 'McDonnell Douglas DC-10',
  E170: 'Embraer 170', E75L: 'Embraer 175', E75S: 'Embraer 175', E195: 'Embraer 195', E290: 'Embraer E190-E2', E295: 'Embraer E195-E2', E145: 'Embraer ERJ 145', E135: 'Embraer ERJ 135',
  CRJ2: 'Bombardier CRJ200', CRJ7: 'Bombardier CRJ700', CRJ9: 'Bombardier CRJ900', CRJX: 'Bombardier CRJ1000', SU95: 'Sukhoi Superjet 100', A148: 'Antonov An-148', C919: 'Comac C919', AJ27: 'Comac ARJ21',
  AT72: 'ATR 72', AT75: 'ATR 72-500', AT43: 'ATR 42', AT45: 'ATR 42-500', AT46: 'ATR 42-600', DH8A: 'De Havilland Canada Dash 8-100', DH8C: 'De Havilland Canada Dash 8-300', DH8D: 'De Havilland Canada Dash 8-400',
  SF34: 'Saab 340', SB20: 'Saab 2000', F100: 'Fokker 100', F70: 'Fokker 70', B190: 'Beechcraft 1900', JS41: 'British Aerospace Jetstream 41', D328: 'Dornier 328', DHC6: 'De Havilland Canada DHC-6 Twin Otter',
  C208: 'Cessna 208 Caravan', PC12: 'Pilatus PC-12', PC24: 'Pilatus PC-24', BE20: 'Beechcraft King Air', BE9L: 'Beechcraft King Air', TBM9: 'Daher TBM 900', TBM7: 'Socata TBM 700',
  C68A: 'Cessna Citation Latitude', C700: 'Cessna Citation Longitude', C25A: 'Cessna CitationJet', C25B: 'Cessna CitationJet', C56X: 'Cessna Citation Excel', C510: 'Cessna Citation Mustang', E55P: 'Embraer Phenom 300', E50P: 'Embraer Phenom 100',
  CL35: 'Bombardier Challenger 300', CL30: 'Bombardier Challenger 300', CL60: 'Bombardier Challenger 600 series', GLEX: 'Bombardier Global Express', GL7T: 'Bombardier Global 7500', GLF4: 'Gulfstream IV', GLF5: 'Gulfstream V', GLF6: 'Gulfstream G650', G280: 'Gulfstream G280',
  F2TH: 'Dassault Falcon 2000', FA7X: 'Dassault Falcon 7X', FA8X: 'Dassault Falcon 8X', F900: 'Dassault Falcon 900', H25B: 'Hawker 800', LJ45: 'Learjet 45', LJ75: 'Learjet 75', PC6T: 'Pilatus PC-6 Porter',
  C152: 'Cessna 152', C182: 'Cessna 182 Skylane', C206: 'Cessna 206', C210: 'Cessna 210 Centurion', P28A: 'Piper PA-28 Cherokee', PA28: 'Piper PA-28 Cherokee', PA32: 'Piper PA-32', PA34: 'Piper PA-34 Seneca', PA46: 'Piper PA-46', SR20: 'Cirrus SR20', SR22: 'Cirrus SR22',
  DA40: 'Diamond DA40 Diamond Star', DA42: 'Diamond DA42 Twin Star', DA62: 'Diamond DA62', BE36: 'Beechcraft Bonanza', BE58: 'Beechcraft Baron', M20P: 'Mooney M20', AA5: 'Grumman American AA-5',
  EC45: 'Eurocopter EC145', EC30: 'Eurocopter EC130', EC55: 'Eurocopter EC155', AS50: 'Eurocopter AS350 Écureuil', AS65: 'Eurocopter AS365 Dauphin', H160: 'Airbus Helicopters H160', A139: 'AgustaWestland AW139', A169: 'AgustaWestland AW169', A109: 'AgustaWestland AW109',
  B06: 'Bell 206', B407: 'Bell 407', B429: 'Bell 429', R44: 'Robinson R44', R22: 'Robinson R22', R66: 'Robinson R66', S76: 'Sikorsky S-76', S92: 'Sikorsky S-92', H60: 'Sikorsky UH-60 Black Hawk', EH10: 'AgustaWestland AW101',
  C130: 'Lockheed C-130 Hercules', C30J: 'Lockheed Martin C-130J Super Hercules', C17: 'Boeing C-17 Globemaster III', C5M: 'Lockheed C-5 Galaxy', K35R: 'Boeing KC-135 Stratotanker', KC46: 'Boeing KC-46 Pegasus', A332M: 'Airbus A330 MRTT',
  P8: 'Boeing P-8 Poseidon', E3TF: 'Boeing E-3 Sentry', B52: 'Boeing B-52 Stratofortress', F16: 'General Dynamics F-16 Fighting Falcon', F35: 'Lockheed Martin F-35 Lightning II', EUFI: 'Eurofighter Typhoon', A124: 'Antonov An-124 Ruslan', IL76: 'Ilyushin Il-76',
  BLCF: 'Boeing 747 Large Cargo Freighter', A3ST: 'Airbus Beluga', CONC: 'Concorde', DC3: 'Douglas DC-3', GLID: 'Glider',
};

console.log('media: resolving aircraft-type images…');
// Fallback names (families / alternative labels) for types whose exact variant has no item or image.
const TYPE_FALLBACK = {
  BCS1: 'Airbus A220', BCS3: 'Airbus A220', A339: 'Airbus A330neo', A338: 'Airbus A330neo', B3XM: 'Boeing 737 MAX', B778: 'Boeing 777X', B779: 'Boeing 777X',
  E290: 'Embraer E-Jet E2 family', SU95: 'Sukhoi Superjet 100', AJ27: 'Comac ARJ21 Xiangfeng',
  DH8A: 'De Havilland Canada Dash 8', DH8C: 'De Havilland Canada Dash 8', DH8D: 'De Havilland Canada Dash 8', JS41: 'British Aerospace Jetstream 41', DHC6: 'de Havilland Canada DHC-6 Twin Otter',
  TBM7: 'SOCATA TBM', E55P: 'Embraer Phenom 300', E50P: 'Embraer Phenom 100', CL60: 'Bombardier Challenger 600 series', GLF5: 'Gulfstream V', F2TH: 'Dassault Falcon 2000', LJ75: 'Learjet 75',
  P28A: 'Piper PA-28 Cherokee', PA28: 'Piper PA-28 Cherokee', PA32: 'Piper PA-32', PA34: 'Piper PA-34 Seneca', DA40: 'Diamond DA40 Diamond Star', DA42: 'Diamond DA42', AA5: 'Grumman American AA-5',
  EC45: 'Eurocopter EC145', EC55: 'Eurocopter EC155', AS65: 'Eurocopter AS365 Dauphin', A169: 'AgustaWestland AW169', B429: 'Bell 429 GlobalRanger', R44: 'Robinson R44', R22: 'Robinson R22',
  S76: 'Sikorsky S-76', S92: 'Sikorsky S-92', C30J: 'Lockheed Martin C-130J Super Hercules', KC46: 'Boeing KC-46 Pegasus', A3ST: 'Airbus Beluga', GLID: 'glider',
};
const labels = [...new Set([...Object.values(TYPE_LABELS), ...Object.values(TYPE_FALLBACK)])];
const typeImage = new Map(); // code → file title
const byLabel = new Map();
for (let i = 0; i < labels.length; i += 60) {
  const values = labels.slice(i, i + 60).map((l) => `"${l.replace(/"/g, '\\"')}"@en`).join(' ');
  // Exact English label (or alias) match, most-linked item wins; specific names rarely collide.
  const r = await sparql(`SELECT ?label ?item ?img ?sl WHERE { VALUES ?label { ${values} } { ?item rdfs:label ?label } UNION { ?item skos:altLabel ?label } ?item wdt:P18 ?img .
    OPTIONAL { ?item wikibase:sitelinks ?sl } }`);
  for (const b of r.results.bindings) {
    const cur = byLabel.get(b.label.value);
    const sl = Number(b.sl?.value ?? 0);
    if (!cur || sl > cur.sl) byLabel.set(b.label.value, { file: fileTitle(b.img.value), sl });
  }
  await sleep(1500);
}
for (const code of new Set([...Object.keys(TYPE_LABELS), ...Object.keys(TYPE_FALLBACK)])) {
  const hit = byLabel.get(TYPE_LABELS[code]) ?? byLabel.get(TYPE_FALLBACK[code]);
  if (hit) typeImage.set(code, hit.file);
}
const ids = Object.values(TYPE_ITEMS).map((q) => `wd:${q}`).join(' ');
const exact = await sparql(`SELECT ?item ?img WHERE { VALUES ?item { ${ids} } ?item wdt:P18 ?img }`);
for (const [code, q] of Object.entries(TYPE_ITEMS)) {
  const b = exact.results.bindings.find((x) => x.item.value.endsWith(`/${q}`));
  if (b) typeImage.set(code, fileTitle(b.img.value));
}
const missingTypes = Object.keys({ ...TYPE_LABELS, ...TYPE_ITEMS }).filter((c) => !typeImage.has(c));
console.log(`media: ${typeImage.size} type photos; no image for ${missingTypes.join(' ')}`);

// ------------------------------------------------------------- 3. liveries

// Commons category names used for each type in "<type> of <airline>" fleet categories.
const CAT_TYPES = {
  A319: ['Airbus A319'], A320: ['Airbus A320'], A20N: ['Airbus A320neo'], A321: ['Airbus A321'], A21N: ['Airbus A321neo'], BCS3: ['Airbus A220-300'],
  B737: ['Boeing 737-700'], B738: ['Boeing 737-800'], B739: ['Boeing 737-900', 'Boeing 737-900ER'], B38M: ['Boeing 737 MAX 8'], B39M: ['Boeing 737 MAX 9'], B752: ['Boeing 757-200'],
  B763: ['Boeing 767-300ER', 'Boeing 767-300', 'Boeing 767-300F'], B772: ['Boeing 777-200ER', 'Boeing 777-200'], B77W: ['Boeing 777-300ER'], B77L: ['Boeing 777F', 'Boeing 777-200LR'],
  B788: ['Boeing 787-8'], B789: ['Boeing 787-9'], B78X: ['Boeing 787-10'], B744: ['Boeing 747-400', 'Boeing 747-400F'], B748: ['Boeing 747-8', 'Boeing 747-8F'],
  A332: ['Airbus A330-200'], A333: ['Airbus A330-300'], A339: ['Airbus A330-900'], A359: ['Airbus A350-900'], A35K: ['Airbus A350-1000'], A388: ['Airbus A380'],
  E75L: ['Embraer 175'], E190: ['Embraer 190'], E195: ['Embraer 195'], E295: ['Embraer E195-E2'], CRJ7: ['Bombardier CRJ700'], CRJ9: ['Bombardier CRJ900'], SU95: ['Sukhoi Superjet 100'],
  AT76: ['ATR 72-600'], DH8D: ['De Havilland Canada Dash 8-400', 'Bombardier Dash 8 Q400'], C68A: ['Cessna Citation Latitude'], CL35: ['Bombardier Challenger 350'], GLF6: ['Gulfstream G650'], PC12: ['Pilatus PC-12'],
};
const FAMILY = (cat) => {
  const m = cat.match(/(A\d{3}|7\d7|E\d{3}|E19\d|CRJ\d+|Superjet|ATR|Dash 8|Q400|Latitude|Challenger|G650|PC-12)/);
  return m ? m[1] : cat.split(' ').at(-1);
};
const EXCLUDE =
  'cockpit cabin interior seat seats suite suites business economy premium class bed lounge engine engines model toy livery drawing menu galley crew uniform meal food logo diagram ticket boarding lavatory window scale wreck crash panorama tail tailfin winglet wing gear nose detail fuselage door stairs'.split(
    ' ',
  );

console.log('media: Commons categories for demo airlines…');
const catRows = await sparql(`SELECT ?icao ?cat WHERE { VALUES ?icao { ${fleetAirlines.map((a) => `"${a.icao}"`).join(' ')} } ?a wdt:P230 ?icao ; wdt:P373 ?cat . FILTER NOT EXISTS { ?a wdt:P576 ?d } }`);
const airlineCat = new Map(catRows.results.bindings.map((b) => [b.icao.value, b.cat.value]));
const livery = new Map(); // "ICAO|TYPE" → file title
let tried = 0;
for (const al of fleetAirlines) {
  const cat = airlineCat.get(al.icao) ?? al.name;
  const word = cat.split(' ')[0];
  for (const t of al.types) {
    for (const typeCat of CAT_TYPES[t] ?? []) {
      tried++;
      const q = `deepcat:"${typeCat} of ${cat}" intitle:"${word}" intitle:"${FAMILY(typeCat)}" filetype:bitmap ${EXCLUDE.map((w) => `-intitle:${w}`).join(' ')}`;
      try {
        const r = await commons({ action: 'query', list: 'search', srsearch: q, srnamespace: '6', srlimit: '5', srprop: '' });
        const bad = new RegExp(`\\b(${EXCLUDE.join('|')})\\b`, 'i');
        const hit = r.query?.search?.map((x) => x.title).find((t) => !bad.test(t));
        if (hit) {
          livery.set(`${al.icao}|${t}`, hit);
          break;
        }
      } catch (e) {
        console.warn('  search failed', typeCat, cat, e.message);
      }
    }
  }
}
console.log(`media: ${livery.size} livery photos from ${tried} category searches`);

// ------------------------------------------------------------- 4. file metadata

const strip = (html) =>
  String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

async function fileInfo(titles, width) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const r = await commons({
      action: 'query',
      titles: titles.slice(i, i + 50).map((t) => `File:${t.replace(/^File:/, '')}`).join('|'),
      prop: 'imageinfo',
      iiprop: 'url|extmetadata',
      iiurlwidth: String(width),
      iiextmetadatafilter: 'LicenseShortName|Artist|AttributionRequired',
    });
    const norm = new Map((r.query?.normalized ?? []).map((n) => [n.to, n.from]));
    for (const p of r.query?.pages ?? []) {
      const ii = p.imageinfo?.[0];
      if (!ii?.thumburl) continue;
      const m = ii.extmetadata ?? {};
      const title = p.title;
      out.set(title.replace(/^File:/, ''), { thumb: ii.thumburl.split('?')[0], title, license: strip(m.LicenseShortName?.value) || 'See file page', artist: strip(m.Artist?.value) });
      void norm;
    }
  }
  return out;
}

console.log('media: file metadata…');
const logoInfo = await fileInfo([...new Set([...bestLogo.values()].map((v) => v.file))], 250); // wordmarks need the width
const photoInfo = await fileInfo([...new Set([...typeImage.values(), ...livery.values()].map((t) => t.replace(/^File:/, '')))], 960);

// ------------------------------------------------------------- 5. download logos, write table

const LOGO_DIR = join(ROOT, 'public/media/logos');
mkdirSync(LOGO_DIR, { recursive: true });
const logos = {};
let downloaded = 0;
for (const [icao, v] of bestLogo) {
  const info = logoInfo.get(v.file);
  if (!info) continue;
  const ext = /\.jpe?g$/i.test(info.thumb) ? 'jpg' : 'png';
  const name = `${icao}.${ext}`;
  try {
    await sleep(120);
    const res = await fetch(info.thumb, { headers: UA });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 60_000) throw new Error('too large');
    writeFileSync(join(LOGO_DIR, name), buf);
    downloaded++;
    logos[icao] = [`/media/logos/${name}`, info.title, info.license, info.artist];
  } catch (e) {
    console.warn('  logo failed', icao, e.message);
  }
}
const row = (t) => {
  const info = photoInfo.get(t.replace(/^File:/, ''));
  return info ? [info.thumb, info.title, info.license, info.artist] : undefined;
};
const types = {};
for (const [code, t] of typeImage) {
  const r = row(t);
  if (r) types[code] = r;
}
const liveries = {};
for (const [k, t] of livery) {
  const r = row(t);
  if (r) liveries[k] = r;
}
writeFileSync(
  join(ROOT, 'public/data/media.json'),
  JSON.stringify({
    v: 1,
    generatedAt: new Date().toISOString(),
    source: 'Wikidata (CC0) and Wikimedia Commons (free licences / public domain; see each file). Logos are trademarks of their owners.',
    logos,
    types,
    liveries,
  }),
);
console.log(`media: wrote ${downloaded} logos, ${Object.keys(types).length} type photos, ${Object.keys(liveries).length} livery photos`);
