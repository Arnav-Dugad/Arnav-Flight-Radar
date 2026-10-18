// Top-down seat map for a (simulated) cabin layout: fuselage outline, class sections,
// aisles, row numbers and a deterministic occupied/free pattern from a seed.
import { useMemo } from 'react';
import type { CabinLayout, CabinSection, SeatClass } from '@/data/sim/cabin';

const CLASS_NAME: Record<SeatClass, string> = { F: 'First', J: 'Business', W: 'Premium Economy', Y: 'Economy' };
/** Premium cabins run slightly fuller than the overall load factor. */
const CLASS_BOOST: Record<SeatClass, number> = { F: 1.08, J: 1.06, W: 1.03, Y: 1 };

// Base geometry in layout units (scaled to pixels later).
const SEAT_W: Record<SeatClass, number> = { F: 18, J: 16, W: 11, Y: 10 };
const SEAT_CAP: Record<SeatClass, number> = { F: 28, J: 24, W: 13, Y: 11 };
const GAP = 1.5; // between seats in a group
const AISLE = 8;
const WALL = 6; // fuselage wall padding each side
const ROW_PER_INCH = 0.36;

// Fixed pixel metrics.
const LEFT = 24; // row-number gutter
const RIGHT = 8;
const HEADER = 17;
const SECTION_GAP = 6;
const DECK_LABEL = 18;
const DECK_GAP = 14;

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const groupsOf = (abreast: string) => abreast.split('-').map((g) => Math.max(0, Number(g) || 0));

/** Base seat width for a section: lie-flat style layouts (≤ 4 abreast or with single seats) get bigger seats. */
function baseSeatW(s: CabinSection): number {
  const g = groupsOf(s.abreast);
  const n = g.reduce((a, b) => a + b, 0);
  if (s.cls === 'F') return n <= 4 ? SEAT_W.F : 12;
  if (s.cls === 'J') return n <= 4 || g.includes(1) ? SEAT_W.J : SEAT_W.Y;
  return SEAT_W[s.cls];
}

function naturalWidth(s: CabinSection): number {
  const g = groupsOf(s.abreast);
  const n = g.reduce((a, b) => a + b, 0);
  return n * baseSeatW(s) + (n - g.length) * GAP + (g.length - 1) * AISLE;
}

/** x offsets (units, from the inner wall) and seat width for each seat column in a section. */
function columns(s: CabinSection, inner: number): { xs: number[]; w: number } {
  const g = groupsOf(s.abreast);
  const n = g.reduce((a, b) => a + b, 0);
  const cap = s.cls === 'J' && baseSeatW(s) === SEAT_W.Y ? SEAT_CAP.Y : SEAT_CAP[s.cls];
  const w = Math.min(cap, (inner - (g.length - 1) * AISLE - (n - g.length) * GAP) / n);
  const used = n * w + (n - g.length) * GAP;
  let aisle = g.length > 1 ? (inner - used) / (g.length - 1) : 0;
  aisle = Math.min(aisle, AISLE * 3);
  const total = used + aisle * (g.length - 1);
  let x = (inner - total) / 2;
  const xs: number[] = [];
  g.forEach((count, gi) => {
    for (let i = 0; i < count; i++) {
      xs.push(x);
      x += w + (i < count - 1 ? GAP : 0);
    }
    if (gi < g.length - 1) x += aisle;
  });
  return { xs, w };
}

interface Seat {
  x: number;
  y: number;
  w: number;
  h: number;
  cls: SeatClass;
  occupied: boolean;
}
interface Label {
  x: number;
  y: number;
  text: string;
  sub?: string;
  kind: 'row' | 'header' | 'deck';
}
interface Hull {
  d: string;
}

function buildMap(layout: CabinLayout, occupancy: number, seed: number, compact: boolean) {
  const decks = layout.decks.map((d) => ({ ...d, inner: Math.max(...d.sections.map(naturalWidth)) }));
  const maxOuter = Math.max(...decks.map((d) => d.inner + 2 * WALL));
  // Leave room for the panel's own padding inside a ~340px side panel.
  const avail = (compact ? 280 : 320) - LEFT - RIGHT;
  const s = Math.min(compact ? 1.6 : 2.2, avail / maxOuter);
  const width = Math.ceil(LEFT + maxOuter * s + RIGHT);
  const cx = LEFT + (maxOuter * s) / 2;
  const twoDecks = decks.length > 1;

  const seats: Seat[] = [];
  const labels: Label[] = [];
  const hulls: Hull[] = [];
  let y = 4;

  decks.forEach((deck, di) => {
    const outer = (deck.inner + 2 * WALL) * s;
    const x0 = cx - outer / 2;
    const x1 = cx + outer / 2;
    const isMain = deck.deck === 'main';
    if (twoDecks) {
      labels.push({ x: LEFT, y: y + 10, text: isMain ? 'Main deck' : 'Upper deck', kind: 'deck' });
      y += DECK_LABEL;
    }
    const top = y;
    const noseH = isMain ? Math.min(outer * 0.75, 120) : 14;
    y += noseH;
    deck.sections.forEach((sec) => {
      const n = groupsOf(sec.abreast).reduce((a, b) => a + b, 0);
      const name = sec.cls === 'Y' && layout.seats <= 9 ? 'Cabin' : CLASS_NAME[sec.cls]; // light aircraft
      labels.push({ x: cx, y: y + 11, text: name, sub: String(sec.rows * n), kind: 'header' });
      y += HEADER;
      const { xs, w } = columns(sec, deck.inner);
      const rowH = sec.pitchIn * ROW_PER_INCH * s;
      const seatH = Math.min(rowH * 0.74, w * s * 1.15);
      for (let r = 0; r < sec.rows; r++) {
        const rowNo = sec.firstRow + r;
        const ry = y + r * rowH;
        if (rowNo === 1 || rowNo % 5 === 0) labels.push({ x: LEFT - 5, y: ry + seatH / 2 + 3, text: String(rowNo), kind: 'row' });
        for (const cxu of xs) seats.push({ x: x0 + (WALL + cxu) * s, y: ry, w: w * s, h: seatH, cls: sec.cls, occupied: false });
      }
      y += sec.rows * rowH + SECTION_GAP;
    });
    const bodyEnd = y;
    if (isMain) {
      const tailH = Math.min(outer * 0.9, 140);
      const tw = outer * 0.3;
      const k = noseH * 0.28;
      hulls.push({
        d: [
          `M${x0} ${top + noseH}`,
          `C${x0} ${top + k} ${cx - outer * 0.32} ${top} ${cx} ${top}`,
          `C${cx + outer * 0.32} ${top} ${x1} ${top + k} ${x1} ${top + noseH}`,
          `L${x1} ${bodyEnd}`,
          `L${cx + tw / 2} ${bodyEnd + tailH}`,
          `Q${cx} ${bodyEnd + tailH + 8} ${cx - tw / 2} ${bodyEnd + tailH}`,
          `L${x0} ${bodyEnd}Z`,
        ].join(' '),
      });
      y = bodyEnd + tailH + 8;
    } else {
      const r = Math.min(outer * 0.4, 40);
      hulls.push({
        d: `M${x0} ${top + r} Q${x0} ${top} ${x0 + r} ${top} L${x1 - r} ${top} Q${x1} ${top} ${x1} ${top + r} L${x1} ${bodyEnd + 4} Q${x1} ${bodyEnd + 12} ${x1 - 8} ${bodyEnd + 12} L${x0 + 8} ${bodyEnd + 12} Q${x0} ${bodyEnd + 12} ${x0} ${bodyEnd + 4}Z`,
      });
      y = bodyEnd + 12;
    }
    if (di < decks.length - 1) y += DECK_GAP;
  });

  // Deterministic occupied pattern, per class.
  const occ = Math.min(1, Math.max(0, Number.isFinite(occupancy) ? occupancy : 0));
  let occupied = 0;
  (['F', 'J', 'W', 'Y'] as const).forEach((cls, ci) => {
    const idx: number[] = [];
    seats.forEach((st, i) => {
      if (st.cls === cls) idx.push(i);
    });
    if (!idx.length) return;
    const want = Math.round(Math.min(1, occ * CLASS_BOOST[cls]) * idx.length);
    const rnd = mulberry32(Math.imul(seed | 0, 0x2c1b3c6d) ^ Math.imul(ci + 1, 0x9e3779b1));
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [idx[i], idx[j]] = [idx[j]!, idx[i]!];
    }
    for (let i = 0; i < want; i++) seats[idx[i]!]!.occupied = true;
    occupied += want;
  });

  return { width, height: Math.ceil(y + 4), seats, labels, hulls, occupied };
}

export function SeatMap({ layout, occupancy, seed, compact }: { layout: CabinLayout; occupancy: number; seed: number; compact?: boolean }) {
  const map = useMemo(() => buildMap(layout, occupancy, seed, !!compact), [layout, occupancy, seed, compact]);
  return (
    <figure className="m-0">
      <svg
        role="img"
        aria-label={`Seat map: ${layout.seats} seats, ${map.occupied} occupied (simulated)`}
        width={map.width}
        height={map.height}
        viewBox={`0 0 ${map.width} ${map.height}`}
        className="mx-auto block h-auto max-w-full"
      >
        {map.hulls.map((h, i) => (
          <path key={i} d={h.d} fill="var(--surface-2)" stroke="var(--line-strong)" strokeWidth={1} />
        ))}
        {map.seats.map((st, i) => (
          <rect
            key={i}
            x={st.x}
            y={st.y}
            width={st.w}
            height={st.h}
            rx={Math.min(3, st.w * 0.22)}
            fill={st.occupied ? 'var(--fg-3)' : 'none'}
            fillOpacity={st.occupied ? 0.55 : undefined}
            stroke={st.occupied ? 'none' : 'var(--line-strong)'}
            strokeWidth={0.9}
          />
        ))}
        {map.labels.map((l, i) =>
          l.kind === 'row' ? (
            <text key={i} x={l.x} y={l.y} textAnchor="end" fontSize={9} fill="var(--fg-3)" className="tnum">
              {l.text}
            </text>
          ) : l.kind === 'deck' ? (
            <text key={i} x={l.x} y={l.y} fontSize={9.5} fontWeight={600} letterSpacing="0.12em" fill="var(--accent)">
              {l.text.toUpperCase()}
            </text>
          ) : (
            <text key={i} x={l.x} y={l.y} textAnchor="middle" fontSize={9} fontWeight={600} letterSpacing="0.1em" fill="var(--fg-2)">
              {l.text.toUpperCase()}
              <tspan fill="var(--fg-3)" fontWeight={500} letterSpacing="0" className="tnum">
                {` · ${l.sub ?? ''}`}
              </tspan>
            </text>
          ),
        )}
      </svg>
      <figcaption className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-fg-3">
        <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-[3px] bg-[var(--fg-3)] opacity-55" />
        <span>Occupied</span>
        <span aria-hidden="true">·</span>
        <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-[3px] border border-[var(--line-strong)]" />
        <span>Free</span>
        <span className="tnum ml-2 text-fg-3">
          {map.occupied}/{layout.seats} · simulated
        </span>
      </figcaption>
    </figure>
  );
}
