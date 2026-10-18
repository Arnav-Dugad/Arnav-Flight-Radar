// Estimated load sheet for a simulated flight: passengers, baggage, cargo, fuel plan
// (trip, contingency, alternate, final reserve, taxi) and weights against the type's
// structural limits. Built from public type figures and standard industry rules of
// thumb (EASA standard passenger masses, 5 % contingency, 30-minute final reserve).
// It is an illustration for a simulated flight — not an operational calculation.
//
// The trim sheet (weight and balance) uses the classic index method:
//   index = W × (arm − ref) / C + K,   ref = LEMAC + 25 % MAC,
// with wing geometry, cabin zones, hold positions and a certified-looking CG envelope
// approximated per aircraft class from the type's public dimensions.

import { cabinFor, seatsPerRow, type CabinLayout, type SeatClass } from './cabin';
import type { AirlineModel } from './refTypes';
import type { TypeSpec } from './typeSpecs';

export interface TrimPoint {
  kg: number;
  /** Centre of gravity, % of the mean aerodynamic chord. */
  mac: number;
  index: number;
}
export interface TrimItem {
  id: string;
  label: string;
  kg: number;
  /** Index change this item adds to the dry operating index. */
  index: number;
  seats?: number;
  pax?: number;
  upper?: boolean;
}
export interface TrimSheet {
  dowKg: number;
  doi: number;
  dowMac: number;
  /** Flight deck / cabin crew included in the dry operating weight. */
  crew: [number, number];
  zones: TrimItem[];
  holds: TrimItem[];
  /** Take-off fuel and its index. */
  fuelKg: number;
  fuelIndex: number;
  zfw: TrimPoint;
  tow: TrimPoint;
  lw: TrimPoint;
  mzfwKg: number;
  /** CG envelope polygon as [%MAC, kg]: forward edge upwards, then aft edge downwards. */
  envelope: [number, number][];
  /** Stabiliser trim for take-off, e.g. "1.4 UP" (Airbus THS) or "5.25 units". */
  stab: string;
  inLimits: boolean;
  /** Load moved between holds by load control to bring the CG into the target band. */
  movedKg?: number;
  geo: { lemac: number; mac: number; c: number; k: number; fuelArm: number; airbus: boolean };
}

export interface TankerPlan {
  on: boolean;
  /** Extra fuel uplifted at the origin (kg). */
  extraKg: number;
  /** Extra fuel burned to carry it (kg). */
  burnKg: number;
  /** Net saving in USD (only meaningful when `on`). */
  savingUsd: number;
  /** Cost (−) or saving (+) per tonne carried, USD. */
  perTonneUsd: number;
  usdPerT: { origin: number; dest: number };
  /** Burn penalty, fraction of the tankered fuel per flight hour. */
  ratePerH: number;
  reason: string;
  limit?: 'MLW' | 'MTOW' | 'tank capacity' | 'return sector';
}

export interface LoadSheet {
  pax: number;
  seats: number;
  lf: number;
  byClass: Partial<Record<'F' | 'J' | 'W' | 'Y', { seats: number; pax: number }>>;
  bagsKg: number;
  cargoKg: number;
  payloadKg: number;
  zfwKg: number;
  tripFuelKg: number;
  contingencyKg: number;
  alternateKg: number;
  reserveKg: number;
  taxiFuelKg: number;
  blockFuelKg: number;
  towKg: number;
  lwKg: number;
  mtowKg: number;
  mlwKg: number;
  burnKgH: number;
  /** Fuel on board at the given elapsed airborne time. */
  fuelNowKg?: number;
  co2Kg: number;
  co2PerPaxKg?: number;
  limitedBy?: 'MTOW' | 'fuel capacity' | 'payload';
  cabin: CabinLayout | null;
  freighter: boolean;
  airborneH: number;
  maxFuelKg: number;
  /** Weight and balance (aircraft with a wing chord worth balancing: jets and turboprops). */
  trim?: TrimSheet;
  /** Fuel tankering decision (needs fuel prices). */
  tanker?: TankerPlan;
}

/** EASA standard masses: 84 kg per adult incl. hand baggage; ~15 kg per checked bag. */
const PAX_KG = 84;
const BAG_KG = 15;
/** kg of CO2 per kg of jet fuel burned. */
const CO2_PER_KG = 3.16;

function rand(seed: number) {
  let s = seed % 2147483647 || 7;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function loadSheet(o: {
  spec: TypeSpec;
  model: AirlineModel;
  lf: number;
  seed: number;
  airborneH: number;
  taxiMin: number;
  positioning?: boolean;
  first?: boolean;
  premEco?: boolean;
  elapsedH?: number;
  /** Fuel price index at origin and destination (1 = world average) → tankering plan. */
  fuelPrice?: { origin: number; dest: number };
}): LoadSheet {
  const { spec } = o;
  const r = rand(o.seed);
  const freighter = spec.role === 'freighter' || o.model === 'cargo' || spec.seatsTypical === 0;
  const cabin = freighter ? null : cabinFor(spec.code, o.model, { ...(o.first !== undefined ? { first: o.first } : {}), ...(o.premEco !== undefined ? { premEco: o.premEco } : {}) });
  const seats = cabin?.seats ?? (freighter ? 0 : spec.seatsTypical);
  const lf = o.positioning || freighter ? 0 : o.lf;
  // Premium cabins fill a little better on full-service carriers.
  const byClass: LoadSheet['byClass'] = {};
  let pax = 0;
  if (cabin) {
    for (const cls of ['F', 'J', 'W', 'Y'] as const) {
      const n = cabin.byClass[cls] ?? 0;
      if (!n) continue;
      const f = Math.min(1, lf * (cls === 'Y' ? 1 : cls === 'W' ? 1.02 : 0.95));
      const p = Math.round(n * f);
      byClass[cls] = { seats: n, pax: p };
      pax += p;
    }
  } else pax = Math.round(seats * lf);
  const wide = spec.mtowKg > 140_000;
  let bagsKg = Math.round(pax * (wide ? 1.05 : 0.7) * BAG_KG);
  let cargoKg = freighter ? Math.round(spec.maxPayloadKg * (0.5 + r() * 0.4)) : o.positioning ? 0 : Math.round(wide ? 3000 + r() * 14_000 : spec.mtowKg > 50_000 ? 150 + r() * 1800 : r() * 400);
  // Fuel plan.
  const burn = spec.burnKgH;
  const tripFuelKg = Math.round(burn * o.airborneH * 1.06 + burn * 0.12); // climb penalty
  const contingencyKg = Math.round(Math.max(tripFuelKg * 0.05, burn * (5 / 60)));
  const alternateKg = Math.round(burn * (o.airborneH > 6 ? 0.75 : 0.55));
  const reserveKg = Math.round(burn * 0.5 * 0.85); // 30 minutes holding at 1,500 ft
  const taxiFuelKg = Math.round(burn * 0.22 * (o.taxiMin / 60) + (spec.engines.kind === 'jet' ? 80 : 20)); // APU + taxi
  let blockFuelKg = tripFuelKg + contingencyKg + alternateKg + reserveKg + taxiFuelKg + Math.round(r() * burn * 0.1);
  let limitedBy: LoadSheet['limitedBy'];
  if (blockFuelKg > spec.maxFuelKg) {
    blockFuelKg = spec.maxFuelKg;
    limitedBy = 'fuel capacity';
  }
  let payloadKg = pax * PAX_KG + bagsKg + cargoKg;
  if (payloadKg > spec.maxPayloadKg) {
    cargoKg = Math.max(0, cargoKg - (payloadKg - spec.maxPayloadKg));
    payloadKg = pax * PAX_KG + bagsKg + cargoKg;
    if (payloadKg > spec.maxPayloadKg) limitedBy = 'payload';
  }
  let zfwKg = spec.oewKg + payloadKg;
  let towKg = zfwKg + blockFuelKg - taxiFuelKg;
  if (towKg > spec.mtowKg) {
    // Payload-limited by take-off weight: offload cargo first, then passengers.
    let over = towKg - spec.mtowKg;
    const cut = Math.min(cargoKg, over);
    cargoKg -= cut;
    over -= cut;
    if (over > 0) {
      const off = Math.ceil(over / (PAX_KG + BAG_KG));
      pax = Math.max(0, pax - off);
      bagsKg = Math.round(pax * (wide ? 1.05 : 0.7) * BAG_KG);
    }
    payloadKg = pax * PAX_KG + bagsKg + cargoKg;
    zfwKg = spec.oewKg + payloadKg;
    towKg = Math.min(spec.mtowKg, zfwKg + blockFuelKg - taxiFuelKg);
    limitedBy = 'MTOW';
  }
  const lwKg = towKg - tripFuelKg;
  const out: LoadSheet = {
    pax,
    seats,
    lf: seats ? pax / seats : 0,
    byClass,
    bagsKg,
    cargoKg,
    payloadKg,
    zfwKg,
    tripFuelKg,
    contingencyKg,
    alternateKg,
    reserveKg,
    taxiFuelKg,
    blockFuelKg,
    towKg,
    lwKg,
    mtowKg: spec.mtowKg,
    mlwKg: spec.mlwKg,
    burnKgH: burn,
    co2Kg: Math.round(tripFuelKg * CO2_PER_KG),
    cabin,
    freighter,
    airborneH: o.airborneH,
    maxFuelKg: spec.maxFuelKg,
  };
  if (pax > 0) out.co2PerPaxKg = Math.round((tripFuelKg * CO2_PER_KG * (payloadKg ? (pax * (PAX_KG + BAG_KG)) / payloadKg : 1)) / pax);
  if (limitedBy) out.limitedBy = limitedBy;
  if (o.elapsedH !== undefined) {
    const used = Math.min(tripFuelKg, burn * Math.max(0, o.elapsedH) * 1.06 + (o.elapsedH > 0 ? burn * 0.12 : 0));
    out.fuelNowKg = Math.round(blockFuelKg - taxiFuelKg - used);
  }
  const trim = trimSheet(spec, out, o.seed, o.airborneH);
  if (trim) out.trim = trim;
  return o.fuelPrice ? withTanker(out, o.fuelPrice) : out;
}

// ---------------------------------------------------------------- weight and balance

type Cls = 'nb' | 'wide' | 'rear' | 'tp';
/** Per class: MAC (fraction of span), cabin extent (LEMAC sits so the cabin centroid is near 28 % MAC),
 *  hold arms [fwd, aft, bulk] (fraction of length; bulk 0 = none), DOW and fuel CG (%MAC)
 *  and the envelope [fwd low, fwd knee, fwd at MTOW, aft low, aft at MZFW, aft at MTOW]. */
const CLASS: Record<Cls, { mac: number; cab: [number, number]; holds: [number, number, number]; dow: number; fuel: number; env: number[] }> = {
  nb: { mac: 0.115, cab: [0.13, 0.86], holds: [0.3, 0.66, 0.76], dow: 23, fuel: 22, env: [15, 17, 24, 38, 37, 31] },
  wide: { mac: 0.12, cab: [0.1, 0.85], holds: [0.29, 0.65, 0.75], dow: 24, fuel: 20, env: [14, 16, 23, 37, 35, 30] },
  rear: { mac: 0.12, cab: [0.12, 0.74], holds: [0.22, 0.79, 0], dow: 19, fuel: 24, env: [10, 12, 18, 36, 34, 30] },
  tp: { mac: 0.088, cab: [0.2, 0.8], holds: [0.13, 0.86, 0], dow: 25, fuel: 24, env: [16, 18, 22, 38, 36, 33] },
};
const NICE_C = [200, 500, 1000, 2000, 2500, 5000, 10_000, 20_000];
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Forward and aft CG limits (%MAC) at a weight, from the envelope polygon. */
export function cgLimitsAt(env: [number, number][], kg: number): [number, number] {
  const n = env.length / 2;
  const edge = (pts: [number, number][]) => {
    for (let i = 1; i < pts.length; i++) {
      const [m0, w0] = pts[i - 1]!;
      const [m1, w1] = pts[i]!;
      if (kg <= w1 || i === pts.length - 1) return m0 + (m1 - m0) * Math.max(0, Math.min(1, (kg - w0) / Math.max(1, w1 - w0)));
    }
    return pts[0]![0];
  };
  return [edge(env.slice(0, n)), edge(env.slice(n).reverse())];
}

function point(g: TrimSheet['geo'], kg: number, index: number): TrimPoint {
  const arm = g.lemac + g.mac * 0.25 + ((index - g.k) * g.c) / Math.max(1, kg);
  return { kg: Math.round(kg), index: r1(index), mac: r1(((arm - g.lemac) / g.mac) * 100) };
}

const fuelIdx = (g: TrimSheet['geo'], kg: number) => (kg * (g.fuelArm - g.lemac - g.mac * 0.25)) / g.c;

function stabFor(g: TrimSheet['geo'], mac: number, tow: number, mtow: number): string {
  if (g.airbus) {
    const ths = Math.max(-2.5, Math.min(3.8, (27 - mac) * 0.18));
    return Math.abs(ths) < 0.05 ? '0.0' : `${Math.abs(ths).toFixed(1)} ${ths > 0 ? 'UP' : 'DN'}`;
  }
  const u = Math.max(1.5, Math.min(9, 8.6 - (mac - 5) * 0.19 + (tow / mtow - 0.75) * 1.2));
  return `${(Math.round(u * 4) / 4).toFixed(2)} units`;
}

/** Re-derive the take-off / landing points, stabiliser trim and limit check for a fuel load. */
function settle(t: TrimSheet, s: Pick<LoadSheet, 'towKg' | 'lwKg' | 'mtowKg' | 'mlwKg' | 'tripFuelKg'>, fuelKg: number): TrimSheet {
  const fi = fuelIdx(t.geo, fuelKg);
  const tow = point(t.geo, s.towKg, t.zfw.index + fi);
  const lw = point(t.geo, s.lwKg, t.zfw.index + fuelIdx(t.geo, fuelKg - s.tripFuelKg));
  const ok = (p: TrimPoint, max: number) => {
    const [f, a] = cgLimitsAt(t.envelope, p.kg);
    return p.kg <= max && p.mac >= f && p.mac <= a;
  };
  return { ...t, fuelKg, fuelIndex: r1(fi), tow, lw, stab: stabFor(t.geo, tow.mac, s.towKg, s.mtowKg), inLimits: ok(t.zfw, t.mzfwKg) && ok(tow, s.mtowKg) && ok(lw, s.mlwKg) };
}

function trimSheet(spec: TypeSpec, s: LoadSheet, seed: number, airborneH: number): TrimSheet | undefined {
  const kind = spec.engines.kind;
  if ((kind !== 'jet' && kind !== 'turboprop') || spec.mtowKg < 5000 || ['helicopter', 'fighter', 'glider', 'trainer'].includes(spec.role)) return undefined;
  const r = rand(seed ^ 0x5bd1e995);
  const cls: Cls = kind === 'turboprop' ? 'tp' : spec.engines.mount === 'rear' || spec.shape === 'rear-jet' ? 'rear' : spec.mtowKg > 140_000 ? 'wide' : 'nb';
  const P = CLASS[cls];
  const L = spec.lengthM;
  const mac = Math.max(1, spec.spanM * P.mac);

  // Cabin rows placed along the fuselage by seat pitch, split into zones 0A, 0B, …
  type Z = { seats: number; upper: boolean; by: Partial<Record<SeatClass, [seats: number, xs: number]>> };
  const zs: Z[] = [];
  if (s.cabin) {
    for (const d of s.cabin.decks) {
      const upper = d.deck === 'upper';
      const rows = d.sections.flatMap((q) => Array.from({ length: q.rows }, () => ({ cls: q.cls, n: seatsPerRow(q.abreast), p: q.pitchIn })));
      const tot = rows.reduce((a, q) => a + q.p, 0) || 1;
      const [a, b] = upper ? (spec.deck === 'hump' ? [0.1, 0.32] : [0.12, 0.8]) : P.cab;
      const seats = rows.reduce((n, q) => n + q.n, 0);
      const nz = Math.min(rows.length, upper ? (seats > 100 ? 2 : 1) : seats <= 80 ? 2 : seats <= 250 ? 3 : 4);
      const deckZones: Z[] = Array.from({ length: nz }, () => ({ seats: 0, upper, by: {} }));
      zs.push(...deckZones);
      let acc = 0;
      rows.forEach((q, i) => {
        const z = deckZones[Math.floor((i * nz) / rows.length)]!;
        const x = L * (a + ((b - a) * (acc + q.p / 2)) / tot);
        acc += q.p;
        z.seats += q.n;
        const e = (z.by[q.cls] ??= [0, 0]);
        e[0] += q.n;
        e[1] += q.n * x;
      });
    }
  } else if (s.seats || s.pax) zs.push({ seats: s.seats || s.pax, upper: false, by: { Y: [s.seats || s.pax, (s.seats || s.pax) * L * ((P.cab[0] + P.cab[1]) / 2)] } });
  const cells = zs.flatMap((z) => Object.values(z.by));
  const seatN = cells.reduce((a, v) => a + v[0], 0);
  // The wing sits so the seat centroid is near 28 % MAC (aircraft are designed to balance).
  const centroid = seatN ? cells.reduce((a, v) => a + v[1], 0) / seatN : (L * (P.cab[0] + P.cab[1])) / 2;
  const lemac = centroid - mac * 0.28;
  const ref = lemac + mac * 0.25;
  const rawC = (spec.maxPayloadKg * L) / 300;
  const c = NICE_C.reduce((a, b) => (Math.abs(b - rawC) < Math.abs(a - rawC) ? b : a));
  const geo: TrimSheet['geo'] = { lemac: r1(lemac), mac: r1(mac), c, k: 50, fuelArm: lemac + (mac * (P.fuel + r() * 4)) / 100, airbus: /airbus/i.test(spec.maker) };
  const idx = (kg: number, arm: number) => (kg * (arm - ref)) / c;
  const dowMac = r1(P.dow + (r() - 0.5) * 5);
  const doi = geo.k + idx(spec.oewKg, lemac + (mac * dowMac) / 100);

  // Passengers per zone and class, scaled to the final head count (largest remainder).
  const clsSeats: Partial<Record<SeatClass, number>> = {};
  for (const z of zs) for (const [k, v] of Object.entries(z.by) as [SeatClass, [number, number]][]) clsSeats[k] = (clsSeats[k] ?? 0) + v[0];
  const want = zs.map((z) => (Object.entries(z.by) as [SeatClass, [number, number]][]).map(([k, v]) => ({ x: v[1] / v[0], n: ((s.byClass[k]?.pax ?? s.pax) * v[0]) / (clsSeats[k] || 1) })));
  const sum = want.flat().reduce((a, q) => a + q.n, 0) || 1;
  const exact = want.map((w) => (w.reduce((a, q) => a + q.n, 0) * s.pax) / sum);
  const pax = exact.map(Math.floor);
  const order = exact.map((v, i) => [v - Math.floor(v), i] as const).sort((x, y) => y[0] - x[0]);
  for (let left = s.pax - pax.reduce((a, b) => a + b, 0), j = 0; left > 0 && order.length; left--, j++) pax[order[j % order.length]![1]]!++;
  const zones: TrimItem[] = zs.map((z, i) => {
    const w = want[i]!;
    const n = w.reduce((a, q) => a + q.n, 0);
    const arm = n ? w.reduce((a, q) => a + q.x * q.n, 0) / n : ref;
    const kg = pax[i]! * PAX_KG;
    return { id: `0${String.fromCharCode(65 + i)}`, label: z.upper ? 'Upper deck' : 'Main deck', kg, index: r1(idx(kg, arm)), seats: z.seats, pax: pax[i]!, ...(z.upper ? { upper: true } : {}) };
  });

  // Baggage and cargo by hold.
  const [hf, ha, hb] = P.holds;
  const arms = { fwd: L * hf, aft: L * ha, bulk: L * hb, main: lemac + mac * 0.3 };
  const load = { fwd: 0, aft: 0, bulk: 0, main: 0 };
  if (s.freighter) {
    load.main = s.cargoKg * 0.72;
    load.fwd = s.cargoKg * 0.16;
    load.aft = s.cargoKg * 0.12;
  } else if (hb) {
    load.fwd = s.bagsKg * 0.25 + s.cargoKg * 0.55;
    load.aft = s.bagsKg * 0.45 + s.cargoKg * 0.45;
    load.bulk = s.bagsKg * 0.3;
  } else {
    load.fwd = s.bagsKg * 0.4 + s.cargoKg * 0.6;
    load.aft = s.bagsKg * 0.6 + s.cargoKg * 0.4;
  }
  // Load control: move hold load fore/aft to bring the ZFW CG into a comfortable band.
  const zfwKg = s.zfwKg;
  const env: [number, number][] = [];
  const [f0, f1, f2, a0, a1, a2] = P.env as [number, number, number, number, number, number];
  const minW = Math.round(spec.oewKg * 0.9);
  const mzfwKg = Math.min(spec.mtowKg, spec.oewKg + spec.maxPayloadKg);
  env.push([f0, minW], [f1, Math.round((minW + spec.mtowKg) / 2)], [f2, spec.mtowKg], [a2, spec.mtowKg], [a1, mzfwKg], [a0, minW]);
  const holdIdx = (Object.keys(load) as (keyof typeof load)[]).reduce((a, h) => a + idx(load[h], arms[h]), 0);
  const [lo, hi] = cgLimitsAt(env, zfwKg);
  const cur = point(geo, zfwKg, doi + zones.reduce((a, z) => a + z.index, 0) + holdIdx).mac;
  const target = cur < lo + 2.5 ? lo + 3 : cur > hi - 3.5 ? hi - 4 : cur;
  let movedKg = 0;
  if (target !== cur && arms.aft > arms.fwd) {
    // Shifting m kg from the forward to the aft hold moves the CG by m(xa − xf)/W.
    const m = (((target - cur) / 100) * mac * zfwKg) / (arms.aft - arms.fwd);
    const mv = Math.round(m > 0 ? Math.min(m, load.fwd * 0.7) : Math.max(m, -load.aft * 0.7));
    load.fwd -= mv;
    load.aft += mv;
    movedKg = Math.abs(mv);
  }
  const names = { fwd: hb ? 'Forward hold · CPT 1' : 'Forward hold', aft: hb ? 'Aft hold · CPT 3/4' : 'Aft hold', bulk: 'Bulk · CPT 5', main: 'Main deck' };
  const holds: TrimItem[] = (['main', 'fwd', 'aft', 'bulk'] as const)
    .filter((h) => (h !== 'bulk' || (hb && !s.freighter)) && (h !== 'main' || s.freighter))
    .map((h) => ({ id: h, label: names[h], kg: Math.round(load[h]), index: r1(idx(load[h], arms[h])) }));
  const zfwIdx = doi + zones.reduce((a, z) => a + z.index, 0) + holds.reduce((a, h) => a + h.index, 0);
  const t: TrimSheet = {
    dowKg: spec.oewKg,
    doi: r1(doi),
    dowMac,
    crew: [airborneH > 12 ? 4 : airborneH > 8 ? 3 : 2, s.freighter ? 0 : Math.max(1, Math.ceil(s.seats / 50))],
    zones,
    holds,
    fuelKg: 0,
    fuelIndex: 0,
    zfw: point(geo, zfwKg, zfwIdx),
    tow: { kg: 0, mac: 0, index: 0 },
    lw: { kg: 0, mac: 0, index: 0 },
    mzfwKg,
    envelope: env,
    stab: '',
    inLimits: true,
    geo,
  };
  if (movedKg >= 50) t.movedKg = movedKg;
  return settle(t, s, s.blockFuelKg - s.taxiFuelKg);
}

// ---------------------------------------------------------------- fuel tankering

/** Illustrative world-average jet fuel price, USD per tonne (index 1). */
const FUEL_USD_T = 820;

/**
 * Should the flight carry fuel for the return sector? Tankering pays when fuel is cheaper
 * at the origin by more than the cost of burning extra fuel to carry it (≈ 2.5–4 % of the
 * tankered fuel per flight hour), within landing weight, take-off weight and tank capacity.
 */
export function planTanker(s: LoadSheet, price: { origin: number; dest: number }): TankerPlan {
  const h = s.airborneH;
  const ratePerH = s.mtowKg > 140_000 ? 0.035 : s.mtowKg > 50_000 ? 0.03 : 0.025;
  const keep = 1 - ratePerH * h; // share of the tankered fuel still in the tanks on arrival
  const po = Math.round(FUEL_USD_T * price.origin);
  const pd = Math.round(FUEL_USD_T * price.dest);
  const perTonneUsd = Math.round(pd * keep - po);
  const base = { on: false, extraKg: 0, burnKg: 0, savingUsd: 0, perTonneUsd, usdPerT: { origin: po, dest: pd }, ratePerH };
  if (s.maxFuelKg < 2000 || h < 0.3) return { ...base, reason: 'not planned for this type or sector' };
  if (h > 5) return { ...base, reason: 'sector too long to pay off' };
  if (pd <= po) return { ...base, reason: 'fuel is no cheaper at the origin' };
  if (perTonneUsd <= 0) return { ...base, reason: 'burn penalty exceeds saving' };
  const room: [NonNullable<TankerPlan['limit']>, number][] = [
    ['MLW', (s.mlwKg - s.lwKg) / keep],
    ['MTOW', s.mtowKg - s.towKg],
    ['tank capacity', s.maxFuelKg - s.blockFuelKg],
    ['return sector', s.tripFuelKg + s.taxiFuelKg],
  ];
  const [limit, max] = room.reduce((a, b) => (b[1] < a[1] ? b : a));
  const extraKg = Math.max(0, Math.floor(max / 100) * 100);
  const savingUsd = Math.round((extraKg / 1000) * perTonneUsd);
  if (extraKg < 500) return { ...base, limit, reason: `no margin left (${limit})` };
  if (savingUsd < 50) return { ...base, limit, reason: 'saving too small' };
  return { ...base, on: true, extraKg, burnKg: Math.round(extraKg * ratePerH * h), savingUsd, limit, reason: `cheaper fuel at the origin, limited by ${limit}` };
}

/** The load sheet with the tankering plan applied to fuel, weights, CO₂ and trim. */
export function withTanker(s: LoadSheet, price: { origin: number; dest: number }): LoadSheet {
  const tanker = planTanker(s, price);
  if (!tanker.on) return { ...s, tanker };
  const trip = s.tripFuelKg + tanker.burnKg;
  const out: LoadSheet = {
    ...s,
    tanker,
    tripFuelKg: trip,
    blockFuelKg: s.blockFuelKg + tanker.extraKg,
    towKg: s.towKg + tanker.extraKg,
    lwKg: s.lwKg + tanker.extraKg - tanker.burnKg,
    co2Kg: Math.round(trip * CO2_PER_KG),
  };
  if (s.co2PerPaxKg !== undefined) out.co2PerPaxKg = Math.round((s.co2PerPaxKg * trip) / s.tripFuelKg);
  if (s.fuelNowKg !== undefined) {
    const used = s.blockFuelKg - s.taxiFuelKg - s.fuelNowKg;
    out.fuelNowKg = Math.round(out.blockFuelKg - s.taxiFuelKg - (used * trip) / s.tripFuelKg);
  }
  if (s.trim) out.trim = settle(s.trim, out, s.trim.fuelKg + tanker.extraKg);
  return out;
}
