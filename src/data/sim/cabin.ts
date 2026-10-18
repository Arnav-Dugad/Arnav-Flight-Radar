// Typical cabin layouts by aircraft type and airline business model. Representative of
// common real-world configurations, not of any one airline; used only by the simulation.
//
// Returns null for aircraft without a passenger cabin worth drawing: freighters, all
// military types (transports, tankers, fighters, trainers, patrol, AWACS), gliders and
// helicopters (whose bench/club seating varies too much by role to be meaningful).
import type { AirlineModel } from './refTypes';
import { TYPE_SPECS } from './typeSpecs';

export type SeatClass = 'F' | 'J' | 'W' | 'Y'; // first, business, premium economy, economy
/** `abreast` lists seat groups separated by aisles, e.g. '3-3', '2-4-2', '1-2-1', '1-1'. */
export interface CabinSection {
  cls: SeatClass;
  rows: number;
  abreast: string;
  pitchIn: number;
  firstRow: number;
}
export interface CabinDeck {
  deck: 'main' | 'upper';
  sections: CabinSection[];
}
export interface CabinLayout {
  code: string;
  model: AirlineModel;
  decks: CabinDeck[];
  seats: number;
  byClass: Record<SeatClass, number>;
}

/** Seats in one row of an abreast string ('2-4-2' → 8). */
export function seatsPerRow(abreast: string): number {
  return abreast.split('-').reduce((n, g) => n + (Number(g) || 0), 0);
}

// ── Geometry per type ────────────────────────────────────────────────────────────────
// nb / rj: `rows` is the all-economy row count at a dense pitch (29" nb, 30" rj); premium
//          layouts are derived from the same usable cabin length.
// tp:      small regional types that are always single-class.
// wb:      explicit templates. Sections 'J8:1-2-1[:pitch]' joined by '/', decks by '|'
//          (main first, then upper). Default pitch F 80, J 44, W 38, Y 31 inches.
// biz:     club seating, pairs of facing seats.
// light:   simple rows for light / utility aircraft.
type Geo =
  | { k: 'nb' | 'rj' | 'tp'; y: string; rows: number }
  | { k: 'wb'; full: string; dense: string; first?: string }
  | { k: 'biz' }
  | { k: 'light'; y: string };

const nb = (y: string, rows: number): Geo => ({ k: 'nb', y, rows });
const rj = (y: string, rows: number): Geo => ({ k: 'rj', y, rows });
const tp = (y: string, rows: number): Geo => ({ k: 'tp', y, rows });
const wb = (full: string, dense: string, first?: string): Geo => (first ? { k: 'wb', full, dense, first } : { k: 'wb', full, dense });
const BIZ: Geo = { k: 'biz' };
const light = (y: string): Geo => ({ k: 'light', y });

const B772_CABIN = wb('J9:1-2-1/W3:2-4-2/Y24:3-4-3', 'Y40:3-4-3', 'F2:1-1-1');

const GEO: Record<string, Geo> = {
  A318: nb('3-3', 22),
  A319: nb('3-3', 26),
  A320: nb('3-3', 31),
  A20N: nb('3-3', 31),
  A321: nb('3-3', 36),
  A21N: nb('3-3', 40),
  BCS1: nb('2-3', 27),
  BCS3: nb('2-3', 31),
  B737: nb('3-3', 24),
  B738: nb('3-3', 31),
  B739: nb('3-3', 36),
  B37M: nb('3-3', 28),
  B38M: nb('3-3', 33),
  B39M: nb('3-3', 36),
  B712: nb('2-3', 25),
  B752: nb('3-3', 39),
  B753: nb('3-3', 46),
  SU95: nb('2-3', 21),
  E170: rj('2-2', 20),
  E75L: rj('2-2', 22),
  E190: rj('2-2', 28),
  E195: rj('2-2', 31),
  E295: rj('2-2', 36),
  CRJ7: rj('2-2', 19),
  CRJ9: rj('2-2', 22),
  CRJ2: tp('2-2', 12),
  E145: tp('1-2', 16),
  AT45: tp('2-2', 12),
  AT76: tp('2-2', 18),
  DH8D: tp('2-2', 19),
  SF34: tp('1-2', 11),
  B190: tp('1-1', 9),
  B788: wb('J7:1-2-1/W3:2-3-2/Y22:3-3-3', 'Y37:3-3-3', 'F2:1-1-1'),
  B789: wb('J8:1-2-1/W4:2-3-2/Y25:3-3-3', 'Y41:3-3-3', 'F2:1-1-1'),
  B78X: wb('J10:1-2-1/W4:2-3-2/Y28:3-3-3', 'Y45:3-3-3', 'F2:1-1-1'),
  A359: wb('J9:1-2-1/W3:2-4-2/Y26:3-3-3', 'Y42:3-3-3', 'F1:1-2-1'),
  A35K: wb('J11:1-2-1/W4:2-4-2/Y29:3-3-3', 'Y48:3-3-3', 'F2:1-2-1'),
  B772: B772_CABIN,
  B77L: B772_CABIN,
  B77W: wb('J11:1-2-1/W4:2-4-2/Y28:3-4-3', 'Y48:3-4-3', 'F2:1-1-1'),
  A332: wb('J7:1-2-1/W3:2-3-2/Y25:2-4-2', 'Y37:3-3-3', 'F1:1-2-1'),
  A333: wb('J9:1-2-1/W3:2-3-2/Y27:2-4-2', 'Y41:3-3-3', 'F1:1-2-1'),
  A339: wb('J8:1-2-1/W3:2-3-2/Y29:2-4-2', 'Y42:3-3-3', 'F1:1-2-1'),
  A343: wb('J8:1-2-1/W3:2-4-2/Y27:2-4-2', 'Y41:2-4-2', 'F2:1-2-1'),
  B762: wb('J6:1-1-1/W3:2-2-2/Y21:2-3-2', 'Y32:2-3-2'),
  B763: wb('J8:1-1-1/W3:2-2-2/Y25:2-3-2', 'Y38:2-3-2'),
  B764: wb('J10:1-1-1/W3:2-2-2/Y27:2-3-2', 'Y43:2-3-2'),
  B744: wb('J3:2-3-2/W4:2-4-2/Y32:3-4-3|J8:2-2', 'Y44:3-4-3|Y12:3-3', 'F4:1-1:60'),
  B748: wb('J4:2-3-2/W4:2-4-2/Y28:3-4-3|J10:2-2', 'Y46:3-4-3|Y14:3-3', 'F4:1-1:60'),
  // Emirates-like: main deck economy (first-class suites up front when asked for),
  // upper deck business, premium economy and a small economy cabin.
  A388: wb('Y44:3-4-3|J17:1-2-1/W5:2-4-2/Y5:2-4-2', 'Y46:3-4-3|Y33:2-4-2', 'F3:1-2-1:60'),
  C68A: BIZ,
  CL35: BIZ,
  GLF6: BIZ,
  GLEX: BIZ,
  E55P: BIZ,
  PC24: BIZ,
  F2TH: BIZ,
  LJ45: BIZ,
  B350: BIZ,
  PC12: BIZ,
  C208: light('1-1'),
  C152: light('1-1'),
  C172: light('1-1'),
  C182: light('1-1'),
  PA28: light('1-1'),
  SR22: light('1-1'),
  DA40: light('1-1'),
  DR40: light('1-1'),
  PA25: light('1'),
};

const NO_CABIN_ROLES = new Set(['freighter', 'fighter', 'glider', 'tanker', 'awacs', 'patrol', 'military-transport', 'trainer', 'helicopter']);
const DEFAULT_PITCH: Record<SeatClass, number> = { F: 80, J: 44, W: 38, Y: 31 };

type Sec = Omit<CabinSection, 'firstRow'>;

function parseDecks(t: string): Sec[][] {
  return t.split('|').map((deck) =>
    deck.split('/').map((s) => {
      const [head = 'Y0', abreast = '3-3', pitch] = s.split(':');
      const cls = head[0] as SeatClass;
      return { cls, rows: Number(head.slice(1)), abreast, pitchIn: pitch ? Number(pitch) : DEFAULT_PITCH[cls] };
    }),
  );
}

/** Largest economy section on a deck (where rows are taken from or given back). */
function mainY(deck: Sec[]): Sec | undefined {
  let best: Sec | undefined;
  for (const s of deck) if (s.cls === 'Y' && (!best || s.rows > best.rows)) best = s;
  return best;
}

function wideBody(g: Extract<Geo, { k: 'wb' }>, full: boolean, first: boolean, premEco: boolean): Sec[][] {
  const fullDecks = parseDecks(g.full);
  if (full) {
    const decks = fullDecks;
    if (!premEco) {
      for (const deck of decks) {
        const wi = deck.findIndex((s) => s.cls === 'W');
        if (wi < 0) continue;
        const w = deck[wi]!;
        deck.splice(wi, 1);
        const y = mainY(deck) ?? mainY(decks[0]!);
        if (y) y.rows += Math.round((w.rows * w.pitchIn) / y.pitchIn);
      }
    }
    if (first && g.first) {
      const f = parseDecks(g.first)[0]![0]!;
      const main = decks[0]!;
      const y = mainY(main);
      if (y) y.rows -= Math.ceil((f.rows * f.pitchIn) / y.pitchIn);
      main.unshift(f);
    }
    return decks;
  }
  const decks = parseDecks(g.dense);
  if (premEco) {
    decks.forEach((deck, i) => {
      const w = fullDecks[i]?.find((s) => s.cls === 'W');
      const y = mainY(deck);
      if (!w || !y) return;
      y.rows -= Math.ceil((w.rows * w.pitchIn) / y.pitchIn);
      deck.splice(deck.indexOf(y), 0, { ...w });
    });
  }
  return decks;
}

function singleAisle(g: Extract<Geo, { k: 'nb' | 'rj' | 'tp' }>, full: boolean, first: boolean): Sec[] {
  const densePitch = g.k === 'nb' ? 29 : 30;
  const len = g.rows * densePitch; // usable cabin length, inches
  if (g.k === 'tp') {
    const pitch = full ? 31 : 30;
    return [{ cls: 'Y', rows: Math.floor(len / pitch), abreast: g.y, pitchIn: pitch }];
  }
  if (!full) return [{ cls: 'Y', rows: g.rows, abreast: g.y, pitchIn: densePitch }];
  if (first) {
    // US-style domestic first: wider recliners, 2-2 on mainline jets, 1-2 on regional jets.
    const pitch = g.k === 'nb' ? 37 : 36;
    const rows = Math.max(2, Math.round(len / (g.k === 'nb' ? 230 : 165)));
    const abreast = g.k === 'nb' ? '2-2' : '1-2';
    return [
      { cls: 'F', rows, abreast, pitchIn: pitch },
      { cls: 'Y', rows: Math.floor((len - rows * pitch) / 31), abreast: g.y, pitchIn: 31 },
    ];
  }
  // European-style business: the same seats as economy (middle seat blocked) at more pitch.
  const rows = Math.max(2, Math.round(len / 150));
  return [
    { cls: 'J', rows, abreast: g.y, pitchIn: 32 },
    { cls: 'Y', rows: Math.floor((len - rows * 32) / 30), abreast: g.y, pitchIn: 30 },
  ];
}

export function cabinFor(code: string, model: AirlineModel, opts?: { first?: boolean; premEco?: boolean }): CabinLayout | null {
  const key = code.trim().toUpperCase();
  const spec = TYPE_SPECS[key];
  const g = GEO[key];
  if (!spec || !g || model === 'cargo' || NO_CABIN_ROLES.has(spec.role) || spec.seatsTypical <= 0) return null;

  // Bizjet and regional operators fly airliners in a mainline-style layout.
  const full = model === 'full' || model === 'regional' || model === 'bizjet';
  const first = !!opts?.first;
  const premEco = opts?.premEco ?? model === 'full';

  let raw: Sec[][];
  switch (g.k) {
    case 'wb':
      raw = wideBody(g, full, first, premEco);
      break;
    case 'nb':
    case 'rj':
    case 'tp':
      raw = [singleAisle(g, full, first)];
      break;
    case 'biz':
      raw = [[{ cls: 'J', rows: Math.max(1, Math.floor(spec.seatsTypical / 2)), abreast: '1-1', pitchIn: 50 }]];
      break;
    case 'light': {
      const per = seatsPerRow(g.y);
      raw = [[{ cls: 'Y', rows: Math.max(1, Math.ceil(spec.seatsTypical / per)), abreast: g.y, pitchIn: 36 }]];
      break;
    }
  }

  // Never exceed the certified exit limit: trim economy rows from the back.
  const count = () => raw.flat().reduce((n, s) => n + Math.max(0, s.rows) * seatsPerRow(s.abreast), 0);
  if (spec.seatsMax > 0) {
    let guard = 200;
    while (count() > spec.seatsMax && guard-- > 0) {
      const y = mainY(raw[0]!) ?? raw.flat().find((s) => s.rows > 0);
      if (!y || y.rows <= 0) break;
      y.rows -= 1;
    }
  }

  const byClass: Record<SeatClass, number> = { F: 0, J: 0, W: 0, Y: 0 };
  let row = 1;
  const decks: CabinDeck[] = raw.map((secs, i) => ({
    deck: i === 0 ? 'main' : 'upper',
    sections: secs
      .filter((s) => s.rows > 0)
      .map((s) => {
        const sec: CabinSection = { ...s, firstRow: row };
        row += s.rows;
        byClass[s.cls] += s.rows * seatsPerRow(s.abreast);
        return sec;
      }),
  }));
  const seats = byClass.F + byClass.J + byClass.W + byClass.Y;
  return { code: key, model, decks: decks.filter((d) => d.sections.length > 0), seats, byClass };
}
