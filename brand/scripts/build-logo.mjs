// Arnav Flight Radar — brand mark generator.
// Every asset is built from the same geometry so the mark, favicon and
// lockups never drift apart. Run: node brand/scripts/build-logo.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'svg');
mkdirSync(OUT, { recursive: true });

const r1 = (n) => Math.round(n * 10) / 10;
const rad = (d) => (d * Math.PI) / 180;

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const C = {
  obsidian: '#03060B',
  midnight: '#081122',
  ocean: '#0C1D38',
  ice: '#F4F8FF',
  silver: '#B9C7D8',
  graphite: '#5B6B80',
  cyan: '#5CE1FF',
  blue: '#2E8BFF',
  amber: '#FFB547',
  amberDeep: '#FF8A1F',
};

// ---------------------------------------------------------------------------
// Geometry (512 grid)
// ---------------------------------------------------------------------------
// Continuous-curvature tile (superellipse, n = 5) — the "squircle".
function squircle(size, inset = 0, n = 5, steps = 160) {
  const a = size / 2 - inset;
  const c = size / 2;
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const ct = Math.cos(t);
    const st = Math.sin(t);
    const x = c + a * Math.sign(ct) * Math.abs(ct) ** (2 / n);
    const y = c + a * Math.sign(st) * Math.abs(st) ** (2 / n);
    pts.push(`${r1(x)},${r1(y)}`);
  }
  return `M${pts.join('L')}Z`;
}

// The "A": a heading chevron. Its apex is also the radar origin.
const APEX = { x: 256, y: 110 };
const FOOT_DX = 134;
const FOOT_Y = 398;
const LEG_ANGLE = Math.atan2(FOOT_DX, FOOT_Y - APEX.y); // from vertical
// Crossbar = range ring of radius RING centred on the apex.
const RING = 184;

// Point on the range ring; angle in degrees from straight down, +ve to the right.
const onRing = (deg, r = RING) => ({
  x: APEX.x + r * Math.sin(rad(deg)),
  y: APEX.y + r * Math.cos(rad(deg)),
});

function arcPath(fromDeg, toDeg, r = RING) {
  const a = onRing(fromDeg, r);
  const b = onRing(toDeg, r);
  // Travelling left→right along the bottom of the ring is counter-clockwise on screen.
  return `M${r1(a.x)},${r1(a.y)}A${r},${r} 0 0 0 ${r1(b.x)},${r1(b.y)}`;
}

const chevron = `M${APEX.x - FOOT_DX},${FOOT_Y}L${APEX.x},${APEX.y}L${APEX.x + FOOT_DX},${FOOT_Y}`;
const legDeg = (LEG_ANGLE * 180) / Math.PI;

// Original top-down aircraft silhouette, pointing up, ~40 units long.
const PLANE =
  'M0,-20C1.9,-20 2.7,-17.4 2.7,-14.2L2.7,-5.4L18.5,2.6L18.5,6.4L2.7,2.6L2.2,11.6L7.2,15.2L7.2,17.8L0,16.2L-7.2,17.8L-7.2,15.2L-2.2,11.6L-2.7,2.6L-18.5,6.4L-18.5,2.6L-2.7,-5.4L-2.7,-14.2C-2.7,-17.4 -1.9,-20 0,-20Z';

// The tracked aircraft sits on the ring just inside the right leg.
const BLIP_DEG = 6;
const blip = onRing(BLIP_DEG);
// Heading = ring tangent (moving left→right ⇒ rotating counter-clockwise about apex).
const blipHeading = 90 - BLIP_DEG; // degrees clockwise from north

// ---------------------------------------------------------------------------
// Shared <defs>
// ---------------------------------------------------------------------------
function defs(id, theme) {
  const dark = theme === 'dark';
  return `
  <defs>
    <linearGradient id="${id}-tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.ocean}"/>
      <stop offset=".45" stop-color="${C.midnight}"/>
      <stop offset="1" stop-color="${C.obsidian}"/>
    </linearGradient>
    <radialGradient id="${id}-sheen" cx="256" cy="-40" r="420" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity=".09"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${id}-glow" cx="${APEX.x}" cy="${APEX.y + 120}" r="300" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${C.cyan}" stop-opacity=".16"/>
      <stop offset="1" stop-color="${C.cyan}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${id}-beam" cx="${APEX.x}" cy="${APEX.y}" r="300" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${dark ? C.cyan : C.blue}" stop-opacity="${dark ? '.42' : '.26'}"/>
      <stop offset=".7" stop-color="${dark ? C.cyan : C.blue}" stop-opacity="${dark ? '.06' : '.04'}"/>
      <stop offset="1" stop-color="${dark ? C.cyan : C.blue}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${id}-stroke" x1="0" y1="${APEX.y}" x2="0" y2="${FOOT_Y}" gradientUnits="userSpaceOnUse">
      ${dark
        ? `<stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="${C.silver}"/>`
        : `<stop offset="0" stop-color="${C.midnight}"/><stop offset="1" stop-color="#1B2A44"/>`}
    </linearGradient>
    <linearGradient id="${id}-trail" x1="${APEX.x - FOOT_DX * 0.55}" y1="0" x2="${blip.x}" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${C.blue}" stop-opacity=".35"/>
      <stop offset=".6" stop-color="${C.blue}" stop-opacity=".85"/>
      <stop offset="1" stop-color="${C.cyan}"/>
    </linearGradient>
    <linearGradient id="${id}-plane" x1="0" y1="-20" x2="0" y2="18" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFD58A"/>
      <stop offset="1" stop-color="${C.amberDeep}"/>
    </linearGradient>
    <filter id="${id}-soft" x="-1" y="-1" width="3" height="3">
      <feGaussianBlur stdDeviation="9"/>
    </filter>
    <clipPath id="${id}-clip"><path d="${squircle(512)}"/></clipPath>
    <clipPath id="${id}-inside"><path d="${chevron}Z"/></clipPath>
  </defs>`;
}

// The glyph (chevron + beam + trail + aircraft), drawn on a 512 grid.
function glyph(id, theme, { rings = false, stroke = 46, trail = 24, detail = true, trailPaint } = {}) {
  const dark = theme === 'dark';
  const ringColor = dark ? '#9BD8FF' : C.blue;
  const ringEls = rings
    ? [96, RING, 288, 384, 480]
        .map((r, i) => `<circle cx="${APEX.x}" cy="${APEX.y}" r="${r}" fill="none" stroke="${ringColor}" stroke-opacity="${(i === 1 ? 0.13 : 0.07).toFixed(2)}" stroke-width="2"/>`)
        .join('\n      ')
    : '';
  const tickEls = rings
    ? [-60, -30, 30, 60]
        .map((d) => {
          const a = onRing(d, 470);
          const b = onRing(d, 490);
          return `<line x1="${r1(a.x)}" y1="${r1(a.y)}" x2="${r1(b.x)}" y2="${r1(b.y)}" stroke="${ringColor}" stroke-opacity=".12" stroke-width="2"/>`;
        })
        .join('\n      ')
    : '';

  const planeScale = detail ? 1 : 1.5;
  const aircraft = detail
    ? `<g transform="translate(${r1(blip.x)} ${r1(blip.y)})">
        <circle r="34" fill="${C.amber}" opacity=".42" filter="url(#${id}-soft)"/>
        <path d="${PLANE}" transform="rotate(${blipHeading}) scale(${planeScale * 1.4})" fill="url(#${id}-plane)" stroke="${dark ? C.obsidian : '#FFFFFF'}" stroke-width="2.2" stroke-linejoin="round" paint-order="stroke"/>
      </g>`
    : `<g transform="translate(${r1(blip.x)} ${r1(blip.y)})">
        <circle r="34" fill="${C.amber}" opacity=".5" filter="url(#${id}-soft)"/>
        <circle r="30" fill="url(#${id}-plane)" stroke="${dark ? C.obsidian : '#FFFFFF'}" stroke-width="7"/>
      </g>`;

  return `
      ${ringEls}
      ${tickEls}
      <path d="${chevron}Z" fill="url(#${id}-beam)"/>
      <path d="${arcPath(-legDeg, BLIP_DEG - 4)}" fill="none" stroke="${trailPaint ?? `url(#${id}-trail)`}" stroke-width="${trail}" stroke-linecap="round"/>
      <path d="${chevron}" fill="none" stroke="url(#${id}-stroke)" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>
      ${aircraft}`;
}

function tile(id) {
  return `
    <g clip-path="url(#${id}-clip)">
      <rect width="512" height="512" fill="url(#${id}-tile)"/>
      <rect width="512" height="512" fill="url(#${id}-glow)"/>
      <rect width="512" height="512" fill="url(#${id}-sheen)"/>`;
}
const tileClose = (_id) => `
    </g>
    <path d="${squircle(512, 1.5)}" fill="none" stroke="#FFFFFF" stroke-opacity=".14" stroke-width="3"/>`;

// ---------------------------------------------------------------------------
// Custom geometric wordmark (strokes on a 100-unit cap height)
// ---------------------------------------------------------------------------
const GLYPHS = {
  A: { w: 84, d: 'M0,100L42,0L84,100' },
  V: { w: 84, d: 'M0,0L42,100L84,0' },
  R: { w: 62, d: 'M0,100V0H34A27,27 0 0 1 34,54H0M32,54L62,100' },
  N: { w: 70, d: 'M0,100V0L70,100V0' },
  F: { w: 54, d: 'M54,0H0V100M0,50H44' },
  L: { w: 52, d: 'M0,0V100H52' },
  I: { w: 0, d: 'M0,0V100' },
  G: { w: 100, d: 'M90.96,21.32A50,50 0 1 0 100,50H60' },
  H: { w: 70, d: 'M0,0V100M70,0V100M0,50H70' },
  T: { w: 64, d: 'M0,0H64M32,0V100' },
  D: { w: 84, d: 'M0,0H34A50,50 0 0 1 34,100H0Z' },
  ' ': { w: 46, d: '' },
};
// Optical kerning: diagonal pairs sit tighter, round/straight pairs looser.
const KERN = { AR: -2, NA: -2, AV: -10, RA: -2, AD: -2, TR: -2 };

function setText(str, { size, track, weight }) {
  const s = size / 100;
  let x = 0;
  const parts = [];
  [...str].forEach((ch, i) => {
    const g = GLYPHS[ch];
    if (g.d) parts.push(`<path transform="translate(${r1(x)} 0)" d="${g.d}"/>`);
    const next = str[i + 1];
    if (next) x += g.w + track + (KERN[ch + next] ?? 0);
    else x += g.w;
  });
  return {
    width: x * s,
    svg: `<g transform="scale(${s})" fill="none" stroke-width="${r1(weight / s)}" stroke-linecap="round" stroke-linejoin="round">${parts.join('')}</g>`,
  };
}

// Match subtitle width to the main wordmark by solving for tracking.
function justified(str, size, width, weight) {
  const s = size / 100;
  const natural = setText(str, { size, track: 0, weight }).width / s;
  const gaps = str.length - 1;
  const track = (width / s - natural) / gaps;
  return setText(str, { size, track, weight });
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------
const files = {};
const head = (w, h, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="t"><title id="t">${title}</title>`;

// 1. App icon (dark tile) — primary mark
files['arnav-mark.svg'] = `${head(512, 512, 'Arnav Flight Radar')}${defs('m', 'dark')}${tile('m')}${glyph('m', 'dark', { rings: true })}${tileClose('m')}
</svg>`;

// 2. Favicon — optically thickened, no rings, aircraft becomes a beacon dot
files['favicon.svg'] = `${head(512, 512, 'Arnav Flight Radar')}${defs('f', 'dark')}${tile('f')}<g transform="translate(256 262) scale(1.16) translate(-256 -262)">${glyph('f', 'dark', { stroke: 64, trail: 50, detail: false, trailPaint: C.cyan })}</g>${tileClose('f')}
</svg>`;

// 3. Glyph only, for glass headers (dark and light surfaces)
for (const theme of ['dark', 'light']) {
  files[`arnav-glyph-${theme}.svg`] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="96 80 320 340" width="320" height="340" role="img" aria-labelledby="t"><title id="t">Arnav Flight Radar</title>${defs('g', theme)}${glyph('g', theme)}
</svg>`;
}

// 4. Monochrome (currentColor) — for print, embossing, single-ink use
files['arnav-glyph-mono.svg'] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="96 80 320 340" width="320" height="340" role="img" aria-labelledby="t"><title id="t">Arnav Flight Radar</title>
  <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
    <path d="${chevron}" stroke-width="46"/>
    <path d="${arcPath(-legDeg, BLIP_DEG - 13)}" stroke-width="24"/>
  </g>
  <path d="${PLANE}" transform="translate(${r1(blip.x)} ${r1(blip.y)}) rotate(${blipHeading}) scale(1.4)" fill="currentColor"/>
</svg>`;

// 5. Horizontal lockups
// Lockup body on a 128-high grid; returned separately so the share card can reuse it.
function lockupBody(theme, id) {
  const dark = theme === 'dark';
  const H = 128;
  const x0 = H + 34;
  const capMain = 44;
  const yMain = 30;
  const word = setText('ARNAV', { size: capMain, track: 40, weight: 7 });
  const sub = justified('FLIGHT RADAR', 12.5, word.width, 2.4);
  return {
    W: Math.ceil(x0 + word.width + 6),
    H,
    body: `
  <g transform="scale(${H / 512})">${tile(id)}${glyph(id, 'dark', { rings: true })}${tileClose(id)}</g>
  <g transform="translate(${x0} ${yMain})" stroke="${dark ? C.ice : C.midnight}">${word.svg}</g>
  <g transform="translate(${x0} ${yMain + capMain + 20})" stroke="${dark ? '#8DA2BC' : C.graphite}">${sub.svg}</g>`,
  };
}
for (const theme of ['dark', 'light']) {
  const id = `l${theme[0]}`;
  const { W, H, body } = lockupBody(theme, id);
  files[`arnav-lockup-${theme}.svg`] = `${head(W, H, 'Arnav Flight Radar')}${defs(id, 'dark')}${body}
</svg>`;
}

// 6. Wordmark only
for (const theme of ['dark', 'light']) {
  const word = setText('ARNAV', { size: 44, track: 40, weight: 7 });
  const sub = justified('FLIGHT RADAR', 12.5, word.width, 2.4);
  const W = Math.ceil(word.width + 12);
  files[`arnav-wordmark-${theme}.svg`] = `${head(W, 90, 'Arnav Flight Radar')}
  <g transform="translate(6 6)" stroke="${theme === 'dark' ? C.ice : C.midnight}">${word.svg}</g>
  <g transform="translate(6 70)" stroke="${theme === 'dark' ? '#8DA2BC' : C.graphite}">${sub.svg}</g>
</svg>`;
}

// Social share card (Open Graph, 1200×630)
{
  const id = 'o';
  const { W, H, body } = lockupBody('dark', id);
  const s = 760 / W;
  const ox = (1200 - W * s) / 2;
  const oy = (630 - H * s) / 2;
  const cx = ox + (H * s) / 2;
  const cy = oy + (APEX.y / 512) * H * s;
  files['arnav-og.svg'] = `${head(1200, 630, 'Arnav Flight Radar')}${defs(id, 'dark')}
  <defs>
    <radialGradient id="og-bg" cx="600" cy="-80" r="900" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#10223F"/><stop offset=".55" stop-color="#060C18"/><stop offset="1" stop-color="${C.obsidian}"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#og-bg)"/>
  ${[120, 240, 360, 480, 600, 720, 840].map((r) => `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r}" fill="none" stroke="#9BD8FF" stroke-opacity=".06" stroke-width="1.5"/>`).join('\n  ')}
  <g transform="translate(${r1(ox)} ${r1(oy)}) scale(${r1(s * 1000) / 1000})">${body}</g>
</svg>`;
}

// 7. Animated mark — splash / loading state. Range ring pings from the apex,
// the trail draws in, the aircraft flies along the ring to its resting point.
{
  const id = 'a';
  const trailD = arcPath(-legDeg, BLIP_DEG - 4);
  const trailLen = Math.round(rad(legDeg + BLIP_DEG - 4) * RING);
  // CSS rotate() is clockwise; a point below the apex swings left, back to the left leg.
  const startRot = legDeg + BLIP_DEG - 4;
  files['arnav-mark-animated.svg'] = `${head(512, 512, 'Arnav Flight Radar')}${defs(id, 'dark')}
  <style>
    .ping{transform-box:view-box;transform-origin:${APEX.x}px ${APEX.y}px;animation:ping 3.6s cubic-bezier(.2,.7,.2,1) infinite}
    .ping.d2{animation-delay:1.2s}.ping.d3{animation-delay:2.4s}
    .trail{stroke-dasharray:${trailLen + 4};stroke-dashoffset:${trailLen + 4};animation:draw 1.6s cubic-bezier(.65,0,.35,1) .35s forwards}
    .fly{transform-box:view-box;transform-origin:${APEX.x}px ${APEX.y}px;transform:rotate(${r1(startRot)}deg);opacity:0;animation:fly 1.6s cubic-bezier(.65,0,.35,1) .35s forwards}
    .beam{animation:breathe 4.8s ease-in-out infinite}
    .halo{animation:halo 2.4s ease-in-out 2s infinite}
    @keyframes ping{0%{transform:scale(.15);opacity:.4}100%{transform:scale(2.6);opacity:0}}
    @keyframes draw{to{stroke-dashoffset:0}}
    @keyframes fly{0%{opacity:0}12%{opacity:1}100%{transform:rotate(0deg);opacity:1}}
    @keyframes breathe{0%,100%{opacity:.75}50%{opacity:1}}
    @keyframes halo{0%,100%{opacity:.45}50%{opacity:.9}}
    @media (prefers-reduced-motion:reduce){.ping{display:none}.trail,.fly,.beam,.halo{animation:none;stroke-dashoffset:0;transform:none;opacity:1}}
  </style>${tile(id)}
      ${[96, RING, 288, 384, 480].map((r, i) => `<circle cx="${APEX.x}" cy="${APEX.y}" r="${r}" fill="none" stroke="#9BD8FF" stroke-opacity="${i === 1 ? 0.13 : 0.07}" stroke-width="2"/>`).join('\n      ')}
      <circle class="ping" cx="${APEX.x}" cy="${APEX.y}" r="${RING}" fill="none" stroke="${C.cyan}" stroke-width="3"/>
      <circle class="ping d2" cx="${APEX.x}" cy="${APEX.y}" r="${RING}" fill="none" stroke="${C.cyan}" stroke-width="3"/>
      <circle class="ping d3" cx="${APEX.x}" cy="${APEX.y}" r="${RING}" fill="none" stroke="${C.cyan}" stroke-width="3"/>
      <path class="beam" d="${chevron}Z" fill="url(#${id}-beam)"/>
      <path class="trail" d="${trailD}" fill="none" stroke="url(#${id}-trail)" stroke-width="24" stroke-linecap="round"/>
      <path d="${chevron}" fill="none" stroke="url(#${id}-stroke)" stroke-width="46" stroke-linecap="round" stroke-linejoin="round"/>
      <g class="fly"><g transform="translate(${r1(blip.x)} ${r1(blip.y)})">
        <circle class="halo" r="34" fill="${C.amber}" opacity=".45" filter="url(#${id}-soft)"/>
        <path d="${PLANE}" transform="rotate(${blipHeading}) scale(1.4)" fill="url(#${id}-plane)" stroke="${C.obsidian}" stroke-width="2.2" stroke-linejoin="round" paint-order="stroke"/>
      </g></g>${tileClose(id)}
</svg>`;
}

for (const [name, svg] of Object.entries(files)) {
  writeFileSync(join(OUT, name), svg.replace(/\n\s*\n/g, '\n'));
  console.log(`${name.padEnd(28)} ${(svg.length / 1024).toFixed(1)} KB`);
}
