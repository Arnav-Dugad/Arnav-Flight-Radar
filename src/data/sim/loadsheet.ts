// Estimated load sheet for a simulated flight: passengers, baggage, cargo, fuel plan
// (trip, contingency, alternate, final reserve, taxi) and weights against the type's
// structural limits. Built from public type figures and standard industry rules of
// thumb (EASA standard passenger masses, 5 % contingency, 30-minute final reserve).
// It is an illustration for a simulated flight — not an operational calculation.

import { cabinFor, type CabinLayout } from './cabin';
import type { AirlineModel } from './refTypes';
import type { TypeSpec } from './typeSpecs';

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
  };
  if (pax > 0) out.co2PerPaxKg = Math.round((tripFuelKg * CO2_PER_KG * (payloadKg ? (pax * (PAX_KG + BAG_KG)) / payloadKg : 1)) / pax);
  if (limitedBy) out.limitedBy = limitedBy;
  if (o.elapsedH !== undefined) {
    const used = Math.min(tripFuelKg, burn * Math.max(0, o.elapsedH) * 1.06 + (o.elapsedH > 0 ? burn * 0.12 : 0));
    out.fuelNowKg = Math.round(blockFuelKg - taxiFuelKg - used);
  }
  return out;
}
