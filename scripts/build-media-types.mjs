// Adds representative photos for aircraft types that public/data/media.json does not
// cover yet (military, helicopters, gliders, light aircraft), without rebuilding the
// logos and livery photos. Same sources and rules as build-media.mjs: the Wikidata P18
// image of the type's item, resolved to a Wikimedia Commons thumbnail with its licence
// and author.
//
//   node scripts/build-media-types.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = { 'User-Agent': 'ArnavFlightRadar-build/1.0 (https://github.com/Arnav-Dugad/Arnav-Flight-Radar)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wikidata English labels (or aliases) of the types still missing a photo. */
const LABELS = {
  RFAL: ['Dassault Rafale'],
  HAWK: ['BAE Systems Hawk'],
  EC75: ['Airbus Helicopters H175', 'Eurocopter EC175'],
  S76: ['Sikorsky S-76', 'Sikorsky S-76 Spirit', 'S-76'],
  B350: ['Beechcraft King Air 350', 'Beechcraft Super King Air'],
  AS21: ['Schleicher ASK 21'],
  DUOD: ['Schempp-Hirth Duo Discus'],
  DISC: ['Schempp-Hirth Discus'],
  LS8: ['Rolladen-Schneider LS8', 'Schempp-Hirth LS8', 'LS8', 'Rolladen-Schneider LS-8'],
  DR40: ['Robin DR400'],
  PA25: ['Piper PA-25 Pawnee', 'Piper Pawnee', 'PA-25 Pawnee'],
  DH8D: ['Bombardier Dash 8 Q400', 'De Havilland Canada Dash 8-400', 'Dash 8-400', 'Q400'],
  F2TH: ['Dassault Falcon 2000'],
  PA28: ['Piper PA-28 Cherokee', 'Piper PA-28'],
};

const WRONG = { DH8D: /Q[23]00|Dash 8-[123]00/i, PA28: /PA-?28R|Arrow/i };

async function getJson(url) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: { ...UA, Accept: 'application/json' } });
    if (r.status === 429 || r.status >= 500) {
      await sleep(20_000);
      continue;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  throw new Error('unavailable');
}
const sparql = (q) => getJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`);
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

const path = join(ROOT, 'public/data/media.json');
const media = JSON.parse(readFileSync(path, 'utf8'));
const want = Object.entries(LABELS).filter(([c]) => !media.types[c]);
const labels = [...new Set(want.flatMap(([, l]) => l))];
const values = labels.map((l) => `"${l}"@en`).join(' ');
const r = await sparql(`SELECT ?label ?img ?sl WHERE { VALUES ?label { ${values} } { ?item rdfs:label ?label } UNION { ?item skos:altLabel ?label } ?item wdt:P18 ?img . OPTIONAL { ?item wikibase:sitelinks ?sl } }`);
const best = new Map();
for (const b of r.results.bindings) {
  const sl = Number(b.sl?.value ?? 0);
  const cur = best.get(b.label.value);
  if (!cur || sl > cur.sl) best.set(b.label.value, { file: decodeURIComponent(b.img.value.split('/Special:FilePath/')[1] ?? '').replace(/_/g, ' '), sl });
}
let added = 0;
for (const [code, ls] of want) {
  const hit = ls.map((l) => best.get(l)).find(Boolean);
  // Family items often show a sibling variant: skip photos whose title names another one.
  if (hit && WRONG[code]?.test(hit.file)) {
    console.log(`media-types: ${code} photo shows another variant (${hit.file}), skipped`);
    continue;
  }
  if (!hit) {
    console.log(`media-types: no image for ${code}`);
    continue;
  }
  await sleep(400);
  const q = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', titles: `File:${hit.file}`, prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '960' });
  const info = await getJson(`https://commons.wikimedia.org/w/api.php?${q}`);
  const page = info.query?.pages?.[0];
  const ii = page?.imageinfo?.[0];
  if (!ii?.thumburl) continue;
  const m = ii.extmetadata ?? {};
  media.types[code] = [ii.thumburl.split('?')[0], page.title, strip(m.LicenseShortName?.value) || 'See file page', strip(m.Artist?.value)];
  added++;
  console.log(`media-types: ${code} ← ${page.title}`);
}
writeFileSync(path, JSON.stringify(media));
console.log(`media-types: added ${added} type photos`);
