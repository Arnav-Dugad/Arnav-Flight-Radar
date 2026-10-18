// Builds public/data/media.json (+ public/media/logos/*, public/media/makers/*) from
// Wikidata and Wikimedia Commons.
//
//   npm run data:media                 (one-off / occasional; the output is committed)
//   node scripts/build-media.mjs --logos-only   (logos, icons and maker logos only; keeps
//                                                the type and livery photos already in media.json)
//   node scripts/build-media.mjs --only=AIC,UAE,Airbus   (just those airline / maker keys:
//                                                curated files + icon crops; everything else kept)
//
// Curated corrections (LOGO_FILES, NO_LOGO, ICON_CROPS, MAKER_FILES, NO_MAKER,
// TONE_OVERRIDES below) were checked by eye on a dark + light contact sheet.
//
// Afterwards run `node scripts/build-media-types.mjs`: it adds the extra type photos
// (military, helicopters, gliders…) that this script does not resolve.
//
// • Airline logos: Wikidata P154 (logo image) for airlines by ICAO designator (P230),
//   current statements only (best rank, no end date). Thumbnails are DOWNLOADED and
//   served from this site (Wikimedia recommends copying over hotlinking): 500 px wide
//   (Commons renders SVGs crisply at any size), 330 px when that is too heavy; both are
//   standard Commons thumbnail steps. When `sharp` is installed the PNGs are re-encoded
//   (palette-quantised, max compression) to stay small.
// • Airline icons: Wikidata P2910 (icon) / P8972 (small logo or icon) — square tail/brand
//   marks for the compact badge — at 120 px into public/media/logos/icons/.
// • Manufacturer logos: Wikidata P154 of the aircraft makers named in typeSpecs.ts.
// • Every logo is analysed (tiny built-in PNG decoder): 'dark' (dark-on-transparent),
//   'light' (white-on-transparent) or 'opaque' (own background) goes into `tones`, so the
//   UI can put dark logos on a light tile in dark themes and vice versa.
// • Aircraft-type photos: Wikidata P18 of the exact model/variant item for each ICAO
//   type designator (curated name table — Wikidata has no type-designator property).
// • Livery photos: Commons fleet categories "<Type> of <Airline>" (e.g. "Boeing 787-9
//   of Qantas"), title-checked and filtered (no cockpit/cabin/model/…); hotlinked at a
//   standard thumbnail width.
// Every file on Commons is freely licensed or public domain; licence + author are kept
// and shown next to each image. Logos are trademarks of their owners (identification).
// Requests are paced to ≤ ~3 per second with an identifying User-Agent.

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = { 'User-Agent': 'ArnavFlightRadar-build/1.0 (https://github.com/Arnav-Dugad/Arnav-Flight-Radar)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * `--only=AIC,UAE,Airbus` refreshes just those airline / maker keys (curated overrides,
 * icon crops) and keeps every other row of media.json; no Wikidata queries, a handful
 * of Commons requests. Tones of all stored logos are re-analysed locally either way.
 */
const ONLY = process.argv
  .find((a) => a.startsWith('--only='))
  ?.slice(7)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const LOGOS_ONLY = process.argv.includes('--logos-only') || !!ONLY;
const MEDIA_PATH = join(ROOT, 'public/data/media.json');
const previous = existsSync(MEDIA_PATH) ? JSON.parse(readFileSync(MEDIA_PATH, 'utf8')) : {};
if (ONLY && !previous.logos) throw new Error('--only needs an existing public/data/media.json');
const wanted = (key) => !ONLY || ONLY.includes(key);

// ------------------------------------------------------------- curated corrections
// Checked by eye on a contact sheet (dark + light UI). Commons files only; the licence
// and author are read from Commons like every other row.

/** Airline wordmarks that Wikidata lacks, has wrong (another holder of the code) or outdated. */
const LOGO_FILES = {
  SDG: 'Star Air India logo.png', // Wikidata/search found Star Air (Denmark)
  GOA: 'Fly91.png', // transparent vector-quality wordmark instead of a square social-media JPG
  UAE: 'Emirates logo.svg', // the calligraphy + wordmark (the "banner" file is a red tail block)
  OMS: 'SalamAir.png',
  IYE: 'Yemenia-Airlines-logo.gif',
  IRC: 'Aseman Airlines logo.jpg',
  SYR: 'SYRIAN AIRLINES NEW TEXT.png', // 2025 "Syrian Airlines" wordmark
  RXI: 'Riyadh Air Logo.svg', // English version (the Arabic-first file is unreadable when small)
};
/** No current free logo on Commons (only an outdated brand): show the code chip instead. */
const NO_LOGO = new Set([
  'LLR', // Alliance Air: Commons only has the pre-2017 "Air India Regional" marks
]);
/**
 * Square icons cut from the airline's own wordmark (its emblem / tail mark), where
 * Wikidata has no separate icon file. `part` picks the emblem at that end; `gap` is the
 * minimum clear gap (fraction of the width) that separates it from the lettering.
 */
const ICON_CROPS = {
  AIC: { part: 'right', near: [200, 165, 110] }, // the gold Vista window (overlaps the last "A")
  AKJ: { part: 'left' },
  SEJ: { box: [0, 0, 0.295, 1] }, // the spice dots
  GOA: { part: 'left' },
  UAE: { box: [0.28, 0, 0.73, 0.7] }, // calligraphy above "Emirates"
  RXI: { part: 'left' },
  OMA: { part: 'right' }, // khanjar
  OMS: { part: 'left', gap: 0.015 },
  IAW: { part: 'top', gap: 0.01 }, // green bird
  IRM: { box: [0, 0, 0.3, 1] },
  THY: { part: 'left' }, // red roundel with the wild goose
  SXS: { part: 'left' },
  FHY: { part: 'left', near: [0, 64, 160] }, // blue bird (its tail runs under the "F")
  MSR: { part: 'right', gap: 0.01 }, // Horus
  NIA: { part: 'left' },
};
/** Tones the pixel analysis gets wrong (dark green / navy parts too dim on the dark UI). */
const TONE_OVERRIDES = {
  logos: { SVA: 'dark', SDG: 'dark' },
  // Coloured marks with black lettering ("Cessna", "Helicopter") that vanishes on the dark UI.
  makers: { Cessna: 'dark', Bell: 'dark' },
};
/** Manufacturer logos to use instead of what the Wikidata lookup finds. */
const MAKER_FILES = {
  Dassault: 'Dassault Aviation logo.svg', // the JPG was grey-on-grey
  'Lockheed Martin': 'Lockheed Martin logo (2).svg', // current mark, not the 2011–2022 one
  'De Havilland Canada': 'Logo text De Havilland Aircraft of Canada.png',
  Eurofighter: 'Eurofighter logo.jpg',
  'Textron Aviation': 'Textron Aviation logo 2018.svg',
};
/** Wrong organisation or unreadable: better no logo. */
const NO_MAKER = new Set([
  'Comac', // the only "COMAC" logos on Commons belong to Belgian / Dutch youth organisations
  'Robin', // white-on-light-grey JPG, unreadable at any size
]);

/** Optional: sharp (when installed) re-encodes PNGs much smaller. */
let sharp = null;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.log('media: sharp not available — logos are stored as Commons serves them');
}

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

// ------------------------------------------------------------- PNG analysis (no dependencies)

/** Decodes a non-interlaced PNG into 8-bit RGBA. Returns null for anything it cannot read. */
function decodePng(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let off = 8;
  let w = 0;
  let h = 0;
  let depth = 8;
  let ctype = 6;
  let interlace = 0;
  let palette = null;
  let trns = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      ctype = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!w || !h || interlace || w * h > 4_000_000) return null;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!channels) return null;
  let raw;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const bitsPP = channels * depth;
  const stride = Math.ceil((w * bitsPP) / 8);
  const bpp = Math.max(1, bitsPP >> 3);
  if (raw.length < (stride + 1) * h) return null;
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0;
      const b = y > 0 ? px[row - stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[row - stride + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[row + x] = v & 255;
    }
  }
  const sample = (row, i) => {
    // i-th sample of a row, scaled to 0–255 (raw value for palette indices).
    if (depth === 8) return px[row + i];
    if (depth === 16) return px[row + i * 2];
    const bit = i * depth;
    const v = (px[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    return ctype === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
  };
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (ctype === 3) {
        const idx = sample(row, x);
        rgba[o] = palette?.[idx * 3] ?? 0;
        rgba[o + 1] = palette?.[idx * 3 + 1] ?? 0;
        rgba[o + 2] = palette?.[idx * 3 + 2] ?? 0;
        rgba[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else if (ctype === 0 || ctype === 4) {
        const g = sample(row, x * channels);
        rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
        rgba[o + 3] = ctype === 4 ? sample(row, x * channels + 1) : trns && depth === 8 && g === trns[1] ? 0 : 255;
      } else {
        rgba[o] = sample(row, x * channels);
        rgba[o + 1] = sample(row, x * channels + 1);
        rgba[o + 2] = sample(row, x * channels + 2);
        rgba[o + 3] = ctype === 6 ? sample(row, x * channels + 3) : 255;
      }
    }
  }
  return { w, h, rgba };
}

const lin = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const LIN = Array.from({ length: 256 }, (_, i) => lin(i));
/** WCAG contrast ratio of two relative luminances. */
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
// Relative luminance of the darkest / lightest panel backgrounds the logos sit on.
const DARK_UI_L = 0.008;
const LIGHT_UI_L = 0.92;

/**
 * How a logo sits on a background: 'opaque' (draws its own background), 'dark' (much of
 * the ink is too dark to read on the dark UI — navy, black, dark grey), 'light' (mostly
 * white / pale ink that vanishes on the light UI), or undefined (fine on both).
 * Judged by WCAG contrast against the panel colours, not by raw lightness, so navy
 * wordmarks (Airbus, IndiGo, Schempp-Hirth) count as dark too.
 */
function logoTone(buf, ext) {
  if (ext !== 'png') return 'opaque';
  const img = decodePng(buf);
  if (!img) return undefined;
  const { w, h, rgba } = img;
  let ink = 0;
  let dark = 0;
  let light = 0;
  let transparent = 0;
  const step = Math.max(1, Math.floor((w * h) / 60_000));
  let n = 0;
  for (let i = 0; i < w * h; i += step) {
    n++;
    const a = rgba[i * 4 + 3] / 255;
    if (a < 0.5) {
      transparent++;
      continue;
    }
    const L = 0.2126 * LIN[rgba[i * 4]] + 0.7152 * LIN[rgba[i * 4 + 1]] + 0.0722 * LIN[rgba[i * 4 + 2]];
    ink += a;
    if (contrast(L, DARK_UI_L) < 2.5) dark += a;
    else if (contrast(L, LIGHT_UI_L) < 1.6) light += a;
  }
  if (transparent / n < 0.04) return 'opaque';
  if (!ink) return undefined;
  if (dark / ink >= 0.35) return 'dark';
  if (light / ink >= 0.5) return 'light';
  return undefined;
}

/**
 * Square icon cut from a wordmark: the emblem at one end ('left' / 'right' / 'top') —
 * the first or last run of ink separated from the rest by a clear gap — or a fixed box
 * ([x0, y0, x1, y1] as fractions), optionally only the ink `near` one colour.
 * Trimmed, padded to a square and scaled to `size`.
 * Needs sharp. Returns null when nothing sensible is found.
 */
async function cropIcon(buf, spec, size = 120) {
  if (!sharp) return null;
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const px = (x, y) => (y * w + x) * 4;
  // `near: [r, g, b]` keeps only ink of about that colour (an emblem overlapping the lettering).
  if (spec.near) {
    const [r, g, b] = spec.near;
    for (let o = 0; o < data.length; o += 4) if (Math.abs(data[o] - r) + Math.abs(data[o + 1] - g) + Math.abs(data[o + 2] - b) > 200) data[o + 3] = 0;
    buf = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  }
  // Background: transparent, or the corner colour of an opaque image.
  const c0 = px(0, 0);
  const opaqueBg = data[c0 + 3] > 200 ? [data[c0], data[c0 + 1], data[c0 + 2]] : null;
  const isInk = (x, y) => {
    const o = px(x, y);
    if (data[o + 3] < 60) return false;
    if (!opaqueBg) return true;
    return Math.abs(data[o] - opaqueBg[0]) + Math.abs(data[o + 1] - opaqueBg[1]) + Math.abs(data[o + 2] - opaqueBg[2]) > 90;
  };
  let box;
  if (Array.isArray(spec.box)) {
    box = [Math.round(spec.box[0] * w), Math.round(spec.box[1] * h), Math.round(spec.box[2] * w), Math.round(spec.box[3] * h)];
  } else {
    const horizontal = spec.part !== 'top' && spec.part !== 'bottom';
    const len = horizontal ? w : h;
    const other = horizontal ? h : w;
    const prof = new Array(len).fill(0);
    for (let i = 0; i < len; i++) for (let j = 0; j < other; j++) if (horizontal ? isInk(i, j) : isInk(j, i)) prof[i]++;
    // Runs of ink, merging gaps narrower than `gap` (fraction of the length).
    const minGap = Math.max(2, Math.round(len * (spec.gap ?? 0.03)));
    const runs = [];
    for (let i = 0; i < len; i++) {
      if (!prof[i]) continue;
      const last = runs.at(-1);
      if (last && i - last[1] <= minGap) last[1] = i;
      else runs.push([i, i]);
    }
    if (!runs.length || (runs.length < 2 && !spec.near)) return null;
    const run = spec.part === 'left' || spec.part === 'top' ? runs[0] : runs.at(-1);
    box = horizontal ? [run[0], 0, run[1] + 1, h] : [0, run[0], w, run[1] + 1];
  }
  // Tight bounding box of the ink inside the box.
  let [x0, y0, x1, y1] = [Infinity, Infinity, -1, -1];
  for (let y = box[1]; y < box[3]; y++)
    for (let x = box[0]; x < box[2]; x++)
      if (isInk(x, y)) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  if (x1 < 0 || x1 - x0 < 8 || y1 - y0 < 8) return null;
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  if (Math.max(cw, ch) / Math.min(cw, ch) > 3.2) return null; // not an emblem
  const side = Math.round(Math.max(cw, ch) * 1.12);
  const bg = opaqueBg ? { r: opaqueBg[0], g: opaqueBg[1], b: opaqueBg[2], alpha: 1 } : { r: 0, g: 0, b: 0, alpha: 0 };
  // Two passes: sharp would otherwise resize before extending.
  const square = await sharp(buf)
    .ensureAlpha()
    .extract({ left: x0, top: y0, width: cw, height: ch })
    .extend({ left: Math.floor((side - cw) / 2), right: Math.ceil((side - cw) / 2), top: Math.floor((side - ch) / 2), bottom: Math.ceil((side - ch) / 2), background: bg })
    .png()
    .toBuffer();
  const out = await sharp(square).resize(size, size, { fit: 'contain', background: bg }).png().toBuffer();
  return optimise(out, 'png');
}

/** Smaller PNG with the same look (palette-quantised when sharp is available). */
async function optimise(buf, ext) {
  if (!sharp || ext !== 'png') return buf;
  try {
    const out = await sharp(buf).png({ palette: true, quality: 92, effort: 10, compressionLevel: 9 }).toBuffer();
    return out.length < buf.length ? out : buf;
  } catch {
    return buf;
  }
}

/** Download a Commons thumbnail (preferred width first), keep it if small enough. */
async function downloadLogo(thumb, widths, limits) {
  for (let i = 0; i < widths.length; i++) {
    const url = widths[i] ? thumb.replace(/\/\d+px-([^/]+)$/, `/${widths[i]}px-$1`) : thumb;
    await sleep(350);
    const res = await fetch(url, { headers: UA });
    if (res.status === 429) {
      await sleep(30_000);
      i--;
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ext = /\.jpe?g$/i.test(url) ? 'jpg' : 'png';
    const buf = await optimise(Buffer.from(await res.arrayBuffer()), ext);
    if (buf.length <= limits[i] || i === widths.length - 1) {
      if (buf.length > limits.at(-1)) throw new Error(`too large (${buf.length} B)`);
      return { buf, ext };
    }
  }
  throw new Error('no size fits');
}

// ------------------------------------------------------------- fleet (simulated airlines)

const fleetSrc = ['fleet.ts', 'fleet-more.ts', 'fleet-extra.ts']
  .map((f) => join(ROOT, 'src/data/sim', f))
  .filter((p) => existsSync(p))
  .map((p) => readFileSync(p, 'utf8'))
  .join('\n');
const fleetAirlines = [...fleetSrc.matchAll(/airline\('([A-Z]{3})', '([A-Z0-9]{0,2})', (?:'([^']+)'|"([^"]+)"), '[A-Z]{2}', '[^']+', '[^']+', '([^']+)'/g)].map((m) => ({
  icao: m[1],
  name: m[3] ?? m[4],
  types: m[5].split(' ').map((p) => p.split(':')[0]),
}));

// ------------------------------------------------------------- 1. logos and icons

const norm = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const BAD_LOGO = /\b(livery|aircraft|tail|plane|airport|old|former|historic|uniform|sticker|ticket|19\d\d|200\d)\b/i;
const GENERIC = new Set(['air', 'airline', 'airlines', 'airways', 'aviation', 'aero', 'the', 'de', 'of', 'and', 'logo', 'svg', 'png', 'jpg', 'com']);
/** Significant words of a name ("China Southern Airlines" → china, southern). */
const words = (s) =>
  norm(s)
    .split(' ')
    .filter((w) => w.length > 1 && !GENERIC.has(w));
/** Whether two names share a significant word (or one has none to compare). */
const sameName = (a, b) => {
  const wa = words(a);
  const wb = new Set(words(b));
  return wa.length === 0 || wb.size === 0 || wa.some((w) => wb.has(w)) || norm(a).replace(/ /g, '') === norm(b).replace(/ /g, '');
};
/** Whether a file title names the airline (a significant word, or the squashed name). */
const titleNames = (title, name) => {
  const t = norm(title);
  const squashed = t.replace(/ /g, '');
  return words(name).some((w) => t.split(' ').includes(w) || squashed.includes(w)) || (norm(name) !== '' && squashed.includes(norm(name).replace(/ /g, '')));
};

console.log(ONLY ? `media: refreshing ${ONLY.join(', ') || '(tones only)'}…` : 'media: querying Wikidata for airline logos and icons…');
const fleetName = new Map(fleetAirlines.map((a) => [a.icao, a.name]));
/** Best file per ICAO for a Wikidata image property (or two). */
async function airlineImages(props) {
  const rows = await sparql(`SELECT ?airline ?icao ?img ?sl ?dissolved ?label WHERE {
    ?airline p:P230 ?icaoSt . ?icaoSt ps:P230 ?icao .
    FILTER NOT EXISTS { ?icaoSt pq:P582 ?e1 }
    FILTER NOT EXISTS { ?icaoSt wikibase:rank wikibase:DeprecatedRank }
    VALUES ?prop { ${props.map((p) => `p:${p}`).join(' ')} }
    VALUES ?pst { ${props.map((p) => `ps:${p}`).join(' ')} }
    ?airline ?prop ?st . ?st ?pst ?img ; a wikibase:BestRank .
    FILTER NOT EXISTS { ?st pq:P582 ?e2 }
    OPTIONAL { ?airline wikibase:sitelinks ?sl }
    OPTIONAL { ?airline wdt:P576 ?dissolved }
    OPTIONAL { ?airline rdfs:label ?label FILTER(lang(?label) = 'en') }
  }`);
  const best = new Map();
  for (const b of rows.results.bindings) {
    const icao = b.icao.value.toUpperCase();
    if (!/^[A-Z]{3}$/.test(icao)) continue;
    // Current airlines only: ICAO codes get reassigned, so a dissolved airline's logo is never used.
    if (b.dissolved) continue;
    if (!b.img.value.includes('/Special:FilePath/')) continue;
    // Simulated airlines: the Wikidata item must be the same airline, not another holder of the code.
    const name = fleetName.get(icao);
    if (name && b.label && !sameName(name, b.label.value)) continue;
    const file = fileTitle(b.img.value);
    // Several current logos (rebrands): prefer one that is not marked old and names the airline, then vectors.
    const cand = { file, sl: Number(b.sl?.value ?? 0), svg: /\.svg$/i.test(file), named: titleNames(file, b.label?.value ?? name ?? '') ? 1 : 0, old: BAD_LOGO.test(file) ? 1 : 0 };
    const cur = best.get(icao);
    const better = (a, c) => a.sl - c.sl || c.old - a.old || a.named - c.named || Number(a.svg) - Number(c.svg);
    if (!cur || better(cand, cur) > 0) best.set(icao, cand);
  }
  return best;
}
const prevFile = (row) => row?.[1]?.replace(/^File:/, '');
let bestLogo;
let bestIcon;
if (ONLY) {
  // Only the listed airlines, from the curated table or the file they already use.
  bestLogo = new Map();
  bestIcon = new Map();
  for (const icao of ONLY) {
    const file = LOGO_FILES[icao] ?? prevFile(previous.logos[icao]);
    if (file && /^[A-Z0-9]{3}$/.test(icao)) bestLogo.set(icao, { file, sl: 0, svg: /\.svg$/i.test(file) });
    const icon = previous.icons?.[icao];
    if (icon && !icon[3]?.includes('(detail of the logo)')) bestIcon.set(icao, { file: prevFile(icon) });
  }
} else {
  bestLogo = await airlineImages(['P154']);
  await sleep(1500);
  bestIcon = await airlineImages(['P2910', 'P8972']);
  for (const [icao, v] of bestIcon) if (bestLogo.get(icao)?.file === v.file) bestIcon.delete(icao); // same file as the wordmark
  console.log(`media: ${bestLogo.size} airline logos, ${bestIcon.size} icons on Wikidata`);
  for (const [icao, file] of Object.entries(LOGO_FILES)) bestLogo.set(icao, { file, sl: 0, svg: /\.svg$/i.test(file) });
}
for (const icao of NO_LOGO) bestLogo.delete(icao);

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
const typeImage = new Map(); // code → file title
if (!LOGOS_ONLY) {
  console.log('media: resolving aircraft-type images…');
  const labels = [...new Set([...Object.values(TYPE_LABELS), ...Object.values(TYPE_FALLBACK)])];
  const byLabel = new Map();
  for (let i = 0; i < labels.length; i += 60) {
    const values = labels
      .slice(i, i + 60)
      .map((l) => `"${l.replace(/"/g, '\\"')}"@en`)
      .join(' ');
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
  const ids = Object.values(TYPE_ITEMS)
    .map((q) => `wd:${q}`)
    .join(' ');
  const exact = await sparql(`SELECT ?item ?img WHERE { VALUES ?item { ${ids} } ?item wdt:P18 ?img }`);
  for (const [code, q] of Object.entries(TYPE_ITEMS)) {
    const b = exact.results.bindings.find((x) => x.item.value.endsWith(`/${q}`));
    if (b) typeImage.set(code, fileTitle(b.img.value));
  }
  // Guard against model items whose image shows a sibling variant.
  const WRONG_VARIANT = { CRJ7: /CRJ-?900|CRJ-?1000/i, CRJ9: /CRJ-?700|CRJ-?200/i, E190: /E-?175|E-?195/i, A359: /A350-1/i };
  for (const [code, re] of Object.entries(WRONG_VARIANT)) if (re.test(typeImage.get(code) ?? '')) typeImage.delete(code);
  const missingTypes = Object.keys({ ...TYPE_LABELS, ...TYPE_ITEMS }).filter((c) => !typeImage.has(c));
  console.log(`media: ${typeImage.size} type photos; no image for ${missingTypes.join(' ')}`);
}

// ------------------------------------------------------------- 3. liveries (+ logo fallbacks)

// Commons category names used for each type in "<type> of <airline>" fleet categories.
const CAT_TYPES = {
  A319: ['Airbus A319'], A320: ['Airbus A320'], A20N: ['Airbus A320neo'], A321: ['Airbus A321'], A21N: ['Airbus A321neo'], BCS3: ['Airbus A220-300'],
  B737: ['Boeing 737-700'], B738: ['Boeing 737-800'], B739: ['Boeing 737-900', 'Boeing 737-900ER'], B38M: ['Boeing 737 MAX 8'], B39M: ['Boeing 737 MAX 9'], B752: ['Boeing 757-200'],
  B763: ['Boeing 767-300ER', 'Boeing 767-300', 'Boeing 767-300F'], B772: ['Boeing 777-200ER', 'Boeing 777-200'], B77W: ['Boeing 777-300ER'], B77L: ['Boeing 777F', 'Boeing 777-200LR'],
  B788: ['Boeing 787-8'], B789: ['Boeing 787-9'], B78X: ['Boeing 787-10'], B744: ['Boeing 747-400', 'Boeing 747-400F'], B748: ['Boeing 747-8', 'Boeing 747-8F'],
  A332: ['Airbus A330-200'], A333: ['Airbus A330-300'], A339: ['Airbus A330-900'], A359: ['Airbus A350-900'], A35K: ['Airbus A350-1000'], A388: ['Airbus A380'],
  E75L: ['Embraer 175'], E190: ['Embraer 190'], E195: ['Embraer 195'], E295: ['Embraer E195-E2'], CRJ7: ['Bombardier CRJ700'], CRJ9: ['Bombardier CRJ900'], SU95: ['Sukhoi Superjet 100'],
  A318: ['Airbus A318'], BCS1: ['Airbus A220-100'], B37M: ['Boeing 737 MAX 7'], B712: ['Boeing 717-200', 'Boeing 717'], B753: ['Boeing 757-300'], B762: ['Boeing 767-200'],
  B764: ['Boeing 767-400ER'], A306: ['Airbus A300-600', 'Airbus A300'], A343: ['Airbus A340-300'], MD11: ['McDonnell Douglas MD-11'], E170: ['Embraer 170'], E145: ['Embraer ERJ 145'],
  CRJ2: ['Bombardier CRJ200', 'Canadair CRJ200'], AT45: ['ATR 42-500'], SF34: ['Saab 340'], C208: ['Cessna 208 Caravan'], B190: ['Beechcraft 1900'], GLEX: ['Bombardier Global 6000', 'Bombardier Global Express'],
  E55P: ['Embraer Phenom 300'], PC24: ['Pilatus PC-24'], F2TH: ['Dassault Falcon 2000'],
  AT76: ['ATR 72-600'], DH8D: ['De Havilland Canada Dash 8-400', 'Bombardier Dash 8 Q400'], C68A: ['Cessna Citation Latitude'], CL35: ['Bombardier Challenger 350'], GLF6: ['Gulfstream G650'], PC12: ['Pilatus PC-12'],
};
const FAMILY = (cat) => {
  const m = cat.match(/(A\d{3}|7\d7|MD-11|E\d{3}|ERJ|E19\d|CRJ\d*|Superjet|ATR|Dash 8|Q400|Saab|Caravan|1900|Global|Phenom|PC-\d+|Falcon|Latitude|Challenger|G650)/);
  return m ? m[1] : cat.split(' ').at(-1);
};
const EXCLUDE =
  'cockpit cabin interior seat seats suite suites business economy premium class bed lounge engine engines model toy livery drawing menu galley crew uniform meal food logo diagram ticket boarding lavatory window scale wreck crash panorama tail tailfin winglet wing gear nose detail fuselage door stairs'.split(
    ' ',
  );

const airlineCat = new Map();
if (!ONLY) {
  console.log('media: Commons categories for simulated airlines…');
  const catRows = await sparql(`SELECT ?icao ?cat ?label WHERE { VALUES ?icao { ${fleetAirlines.map((a) => `"${a.icao}"`).join(' ')} } ?a wdt:P230 ?icao ; wdt:P373 ?cat .
    FILTER NOT EXISTS { ?a wdt:P576 ?d } OPTIONAL { ?a rdfs:label ?label FILTER(lang(?label) = 'en') } }`);
  // Only the item that is the simulated airline (another current holder of the code is skipped).
  for (const b of catRows.results.bindings) if (sameName(fleetName.get(b.icao.value) ?? '', b.label?.value ?? b.cat.value)) airlineCat.set(b.icao.value, b.cat.value);
}

// Logos missing from Wikidata (no P154): look in the airline's own Commons category for a
// file titled "…logo…" (vector preferred); failing that, a Commons-wide search for a file
// named "<airline name> logo". Only for airlines flown in the simulation.
let foundLogos = 0;
for (const al of fleetAirlines) {
  if (ONLY || bestLogo.has(al.icao) || NO_LOGO.has(al.icao)) continue;
  const cat = airlineCat.get(al.icao);
  try {
    let pick;
    if (cat) {
      const r = await commons({ action: 'query', list: 'search', srsearch: `deepcat:"${cat}" intitle:logo -intitle:livery -intitle:aircraft -intitle:tail`, srnamespace: '6', srlimit: '8', srprop: '' });
      // deepcat also walks subsidiaries' categories: the file must name this airline.
      const titles = (r.query?.search ?? [])
        .map((x) => x.title.replace(/^File:/, ''))
        .filter((t) => (titleNames(t, al.name) || titleNames(t, cat)) && !BAD_LOGO.test(t));
      pick = titles.find((t) => /\.svg$/i.test(t)) ?? titles.find((t) => /\.png$/i.test(t));
    }
    if (!pick) {
      const r = await commons({ action: 'query', list: 'search', srsearch: `intitle:"${al.name}" intitle:logo`, srnamespace: '6', srlimit: '10', srprop: '' });
      const want = norm(al.name);
      const titles = (r.query?.search ?? []).map((x) => x.title.replace(/^File:/, '')).filter((t) => norm(t).startsWith(want) && /logo/i.test(t) && !BAD_LOGO.test(t));
      pick = titles.find((t) => /\.svg$/i.test(t)) ?? titles.find((t) => /\.png$/i.test(t));
    }
    if (pick) {
      bestLogo.set(al.icao, { file: pick, sl: 0, svg: /\.svg$/i.test(pick) });
      foundLogos++;
    }
  } catch (e) {
    console.warn('  logo search failed', al.icao, e.message);
  }
}
console.log(`media: ${foundLogos} more logos from Commons searches`);

const livery = new Map(); // "ICAO|TYPE" → file title
if (!LOGOS_ONLY) {
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
}

// ------------------------------------------------------------- 4. manufacturers

// Every `maker` in typeSpecs.ts (constants resolved), plus a few likely additions.
const specSrc = readFileSync(join(ROOT, 'src/data/sim/typeSpecs.ts'), 'utf8');
const specConsts = new Map([...specSrc.matchAll(/^const ([A-Z0-9_]+) = '([^']+)';/gm)].map((m) => [m[1], m[2]]));
const makers = new Set(
  [...specSrc.matchAll(/^\s*\['[A-Z0-9]+',\s*(?:'([^']+)'|([A-Z0-9_]+)),/gm)].map((m) => m[1] ?? specConsts.get(m[2])).filter((m) => m && m !== 'Various'),
);
for (const m of ['Textron Aviation', 'Mitsubishi Aircraft', 'AgustaWestland', 'DG Flugzeugbau', 'Daher', 'Bell', 'Robinson', 'Eurofighter']) makers.add(m);
/** Wikidata items for maker names that are ambiguous as labels (verified QIDs). */
const MAKER_ITEMS = {
  Airbus: 'Q67',
  Boeing: 'Q66',
};
/** Labels to look up for the others (first that resolves to an item with a logo wins). */
const MAKER_LABELS = {
  Embraer: ['Embraer'],
  Bombardier: ['Bombardier Inc.', 'Bombardier'],
  'McDonnell Douglas': ['McDonnell Douglas'],
  Sukhoi: ['Sukhoi', 'Sukhoi Company'],
  ATR: ['ATR', 'ATR (aircraft manufacturer)', 'Avions de Transport Régional'],
  'De Havilland Canada': ['De Havilland Aircraft of Canada', 'De Havilland Canada'],
  Saab: ['Saab AB', 'Saab'],
  Beechcraft: ['Beechcraft'],
  Cessna: ['Cessna'],
  Gulfstream: ['Gulfstream Aerospace'],
  Pilatus: ['Pilatus Aircraft'],
  Dassault: ['Dassault Aviation'],
  Learjet: ['Learjet'],
  Piper: ['Piper Aircraft'],
  Cirrus: ['Cirrus Aircraft'],
  Diamond: ['Diamond Aircraft Industries'],
  Robin: ['Robin Aircraft'],
  'Airbus Helicopters': ['Airbus Helicopters'],
  Leonardo: ['Leonardo S.p.A.', 'Leonardo'],
  Sikorsky: ['Sikorsky Aircraft', 'Sikorsky'],
  'Lockheed Martin': ['Lockheed Martin'],
  Eurofighter: ['Eurofighter Jagdflugzeug GmbH', 'Eurofighter GmbH'],
  'BAE Systems': ['BAE Systems'],
  'Alexander Schleicher': ['Alexander Schleicher GmbH & Co', 'Alexander Schleicher'],
  'Schempp-Hirth': ['Schempp-Hirth'],
  'Rolladen-Schneider': ['Rolladen-Schneider'],
  Comac: ['Commercial Aircraft Corporation of China', 'Comac'],
  'Textron Aviation': ['Textron Aviation'],
  'Mitsubishi Aircraft': ['Mitsubishi Aircraft Corporation'],
  AgustaWestland: ['AgustaWestland'],
  'DG Flugzeugbau': ['DG Flugzeugbau'],
  Daher: ['Daher'],
  Bell: ['Bell Textron', 'Bell Helicopter'],
  Robinson: ['Robinson Helicopter Company'],
};
const makerLogo = new Map(); // maker → file title
if (ONLY) {
  for (const m of ONLY) {
    const file = MAKER_FILES[m] ?? prevFile(previous.makers?.[m]);
    if (file && !NO_MAKER.has(m) && !/^[A-Z0-9]{3}$/.test(m)) makerLogo.set(m, file);
  }
} else {
  console.log(`media: maker logos for ${[...makers].join(', ')}…`);
  const ids = Object.values(MAKER_ITEMS)
    .map((q) => `wd:${q}`)
    .join(' ');
  const r = await sparql(`SELECT ?item ?logo WHERE { VALUES ?item { ${ids} } ?item p:P154 ?st . ?st ps:P154 ?logo ; a wikibase:BestRank . FILTER NOT EXISTS { ?st pq:P582 ?e } }`);
  for (const [maker, q] of Object.entries(MAKER_ITEMS)) {
    const b = r.results.bindings.find((x) => x.item.value.endsWith(`/${q}`));
    if (b && makers.has(maker)) makerLogo.set(maker, fileTitle(b.logo.value));
  }
  const labels = [...makers].filter((m) => !makerLogo.has(m)).flatMap((m) => MAKER_LABELS[m] ?? [m]);
  await sleep(1500);
  const rows = await sparql(`SELECT ?label ?item ?logo ?sl WHERE { VALUES ?label { ${labels.map((l) => `"${l.replace(/"/g, '\\"')}"@en`).join(' ')} }
    { ?item rdfs:label ?label } UNION { ?item skos:altLabel ?label }
    ?item p:P154 ?st . ?st ps:P154 ?logo ; a wikibase:BestRank . FILTER NOT EXISTS { ?st pq:P582 ?e }
    OPTIONAL { ?item wikibase:sitelinks ?sl } }`);
  const byLabel = new Map();
  for (const b of rows.results.bindings) {
    const sl = Number(b.sl?.value ?? 0);
    const cur = byLabel.get(b.label.value);
    if (!cur || sl > cur.sl || (sl === cur.sl && /\.svg$/i.test(b.logo.value))) byLabel.set(b.label.value, { file: fileTitle(b.logo.value), sl, item: b.item.value.split('/').pop() });
  }
  const NOT_A_LOGO = /roundel|insignia|flag|coat of arms/i;
  for (const m of makers) {
    if (makerLogo.has(m)) continue;
    const hit = (MAKER_LABELS[m] ?? [m]).map((l) => byLabel.get(l)).find((h) => h && !NOT_A_LOGO.test(h.file));
    if (hit) {
      makerLogo.set(m, hit.file);
      console.log(`  ${m} ← ${hit.item} ${hit.file}`);
      continue;
    }
    // Not on Wikidata: a Commons file named "<maker> … logo" (vector preferred).
    for (const label of MAKER_LABELS[m] ?? [m]) {
      const r = await commons({ action: 'query', list: 'search', srsearch: `intitle:"${label}" intitle:logo`, srnamespace: '6', srlimit: '10', srprop: '' });
      const want = norm(label);
      const titles = (r.query?.search ?? []).map((x) => x.title.replace(/^File:/, '')).filter((t) => norm(t).startsWith(want) && /logo/i.test(t) && !BAD_LOGO.test(t) && !NOT_A_LOGO.test(t));
      const pick = titles.find((t) => /\.svg$/i.test(t)) ?? titles.find((t) => /\.png$/i.test(t));
      if (pick) {
        makerLogo.set(m, pick);
        console.log(`  ${m} ← Commons ${pick}`);
        break;
      }
    }
    if (!makerLogo.has(m)) console.log(`  ${m}: no logo found`);
  }
  for (const [m, file] of Object.entries(MAKER_FILES)) makerLogo.set(m, file);
  for (const m of NO_MAKER) makerLogo.delete(m);
}

// ------------------------------------------------------------- 5. file metadata

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
      titles: titles
        .slice(i, i + 50)
        .map((t) => `File:${t.replace(/^File:/, '')}`)
        .join('|'),
      prop: 'imageinfo',
      iiprop: 'url|extmetadata',
      iiurlwidth: String(width),
      iiextmetadatafilter: 'LicenseShortName|Artist|AttributionRequired',
    });
    // Map normalised titles back to the requested spelling (Commons may change case/underscores).
    const from = new Map((r.query?.normalized ?? []).map((n) => [n.to, n.from]));
    for (const p of r.query?.pages ?? []) {
      const ii = p.imageinfo?.[0];
      if (!ii?.thumburl) continue;
      const m = ii.extmetadata ?? {};
      const row = { thumb: ii.thumburl.split('?')[0], title: p.title, license: strip(m.LicenseShortName?.value) || 'See file page', artist: strip(m.Artist?.value) };
      out.set(p.title.replace(/^File:/, ''), row);
      const asked = from.get(p.title);
      if (asked) out.set(asked.replace(/^File:/, ''), row);
    }
  }
  return out;
}

console.log('media: file metadata…');
// Wordmarks need the width; icons are square. 500/330/120 are standard Commons thumbnail steps.
const logoInfo = await fileInfo([...new Set([...bestLogo.values(), ...bestIcon.values()].map((v) => v.file).concat([...makerLogo.values()]))], 500);
const photoInfo = LOGOS_ONLY ? new Map() : await fileInfo([...new Set([...typeImage.values(), ...livery.values()].map((t) => t.replace(/^File:/, '')))], 960);

// ------------------------------------------------------------- 6. download logos, write table

const LOGO_DIR = join(ROOT, 'public/media/logos');
const ICON_DIR = join(LOGO_DIR, 'icons');
const MAKER_DIR = join(ROOT, 'public/media/makers');
for (const d of [LOGO_DIR, ICON_DIR, MAKER_DIR]) mkdirSync(d, { recursive: true });
const tones = { logos: {}, icons: {}, makers: {} };
const sizes = [];

/** Downloads every entry into `dir`, returns the media.json map (keeps the old row on failure). */
async function fetchAll(entries, dir, urlDir, widths, limits, kind, old = {}) {
  const table = {};
  let n = 0;
  for (const [key, file, slug] of entries) {
    const info = logoInfo.get(file);
    if (!info) {
      if (old[key]) table[key] = old[key];
      continue;
    }
    try {
      const { buf, ext } = await downloadLogo(info.thumb, widths, limits);
      const name = `${slug}.${ext}`;
      writeFileSync(join(dir, name), buf);
      table[key] = [`${urlDir}/${name}`, info.title, info.license, info.artist];
      const tone = logoTone(buf, ext);
      if (tone) tones[kind][key] = tone;
      sizes.push(buf.length);
      if (++n % 50 === 0) console.log(`  ${kind}: ${n}/${entries.length}`);
    } catch (e) {
      console.warn(`  ${kind} failed`, key, e.message);
      if (old[key] && existsSync(join(ROOT, 'public', filePart(old[key][0])))) table[key] = old[key];
    }
  }
  return table;
}

const slugOf = (s) => norm(s).replace(/ /g, '-');
/** A stored URL without its `?v=` cache-buster. */
const filePart = (u) => u.split('?')[0];
// With --only, the fetched rows are merged over the previous tables.
const merged = (fresh, old = {}) => (ONLY ? { ...old, ...fresh } : fresh);
const logos = merged(
  await fetchAll(
    [...bestLogo].map(([icao, v]) => [icao, v.file, icao]),
    LOGO_DIR,
    '/media/logos',
    [500, 330],
    [40_000, 60_000],
    'logos',
    previous.logos,
  ),
  previous.logos,
);
const icons = merged(
  await fetchAll(
    [...bestIcon].map(([icao, v]) => [icao, v.file, icao]),
    ICON_DIR,
    '/media/logos/icons',
    [120],
    [24_000],
    'icons',
    previous.icons,
  ),
  previous.icons,
);
const makerTable = merged(
  await fetchAll(
    [...makerLogo].map(([m, f]) => [m, f, slugOf(m)]),
    MAKER_DIR,
    '/media/makers',
    [500, 330],
    [40_000, 60_000],
    'makers',
    previous.makers,
  ),
  previous.makers,
);
for (const k of NO_LOGO) delete logos[k];
for (const k of NO_MAKER) delete makerTable[k];

// Square icons cut from the wordmark's emblem (airlines without an icon file).
for (const [icao, spec] of Object.entries(ICON_CROPS)) {
  if (!wanted(icao) || bestIcon.has(icao) || !bestLogo.has(icao)) continue;
  const info = logoInfo.get(bestLogo.get(icao).file);
  if (!info) continue;
  try {
    // A larger rendering than the wordmark copy, so the emblem keeps its detail.
    let src;
    for (const url of [info.thumb.replace(/\/\d+px-([^/]+)$/, '/960px-$1'), info.thumb]) {
      await sleep(350);
      const res = await fetch(url, { headers: UA });
      if (res.ok) {
        src = Buffer.from(await res.arrayBuffer());
        break;
      }
    }
    const buf = src && (await cropIcon(src, spec));
    if (!buf) {
      console.warn('  icon crop: no emblem found', icao);
      delete icons[icao];
      continue;
    }
    writeFileSync(join(ICON_DIR, `${icao}.png`), buf);
    icons[icao] = ['/media/logos/icons/' + `${icao}.png`, info.title, info.license, `${info.artist ? `${info.artist} ` : ''}(detail of the logo)`];
    sizes.push(buf.length);
  } catch (e) {
    console.warn('  icon crop failed', icao, e.message);
  }
}

// Tones of every stored logo, re-analysed from the files on disk (cheap, no network), and a
// content hash in each URL (`?v=…`): the service worker serves /media/* stale-while-
// revalidate, so a replaced logo must get a new URL to show up on the next visit.
for (const [kind, table] of [
  ['logos', logos],
  ['icons', icons],
  ['makers', makerTable],
]) {
  for (const [k, r] of Object.entries(table)) {
    const f = join(ROOT, 'public', filePart(r[0]));
    if (!existsSync(f)) continue;
    const buf = readFileSync(f);
    table[k] = [`${filePart(r[0])}?v=${createHash('sha1').update(buf).digest('hex').slice(0, 8)}`, ...r.slice(1)];
    const tone = logoTone(buf, /\.png$/i.test(f) ? 'png' : 'jpg');
    if (tone) tones[kind][k] = tone;
    else delete tones[kind][k];
  }
  for (const [k, tone] of Object.entries(TONE_OVERRIDES[kind] ?? {})) if (table[k]) tones[kind][k] = tone;
}

// Remove files no row points at any more (e.g. a logo that changed from .jpg to .png).
for (const [dir, urlDir, table] of [
  [LOGO_DIR, '/media/logos', logos],
  [ICON_DIR, '/media/logos/icons', icons],
  [MAKER_DIR, '/media/makers', makerTable],
]) {
  const used = new Set(Object.values(table).map((r) => filePart(r[0])));
  for (const f of readdirSync(dir, { withFileTypes: true })) if (f.isFile() && !used.has(`${urlDir}/${f.name}`)) unlinkSync(join(dir, f.name));
}

const row = (t) => {
  const info = photoInfo.get(t.replace(/^File:/, ''));
  return info ? [info.thumb, info.title, info.license, info.artist] : undefined;
};
let types = previous.types ?? {};
let liveries = previous.liveries ?? {};
if (!LOGOS_ONLY) {
  types = {};
  for (const [code, t] of typeImage) {
    const r = row(t);
    if (r) types[code] = r;
  }
  liveries = {};
  for (const [k, t] of livery) {
    const r = row(t);
    if (r) liveries[k] = r;
  }
}
writeFileSync(
  MEDIA_PATH,
  JSON.stringify({
    v: 2,
    generatedAt: new Date().toISOString(),
    source: 'Wikidata (CC0) and Wikimedia Commons (free licences / public domain; see each file). Logos are trademarks of their owners.',
    logos,
    icons,
    makers: makerTable,
    tones,
    types,
    liveries,
  }),
);
const total = sizes.reduce((a, b) => a + b, 0);
console.log(
  `media: wrote ${Object.keys(logos).length} logos, ${Object.keys(icons).length} icons, ${Object.keys(makerTable).length} maker logos ` +
    `(${(total / 1024).toFixed(0)} KB downloaded, max ${(Math.max(0, ...sizes) / 1024).toFixed(1)} KB), ${Object.keys(types).length} type photos, ${Object.keys(liveries).length} livery photos`,
);
const fleetWithLogo = fleetAirlines.filter((a) => logos[a.icao]).length;
console.log(`media: simulated airlines with a logo: ${fleetWithLogo}/${fleetAirlines.length}, with an icon: ${fleetAirlines.filter((a) => icons[a.icao]).length}`);
