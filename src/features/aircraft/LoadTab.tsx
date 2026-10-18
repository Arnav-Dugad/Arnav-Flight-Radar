// Estimated load sheet for the simulated flight: passengers and cabin, fuel plan, weights
// against the type's structural limits, cargo and CO2. Illustrative only.
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Stat } from '@/components/ui/Data';
import { EmptyState, Skeleton } from '@/components/ui/Feedback';
import type { LoadSheet } from '@/data/sim/loadsheet';
import { simLoad, type FlightInfo } from '@/data/world';
import { cn } from '@/lib/cn';
import { SeatMap } from './SeatMap';

const CLASS_NAME = {
  F: 'First',
  J: 'Business',
  W: 'Premium Economy',
  Y: 'Economy',
} as const;
const MODEL_NAME: Record<string, string> = {
  full: 'Full-service',
  low: 'Low-cost',
  regional: 'Regional',
  leisure: 'Leisure',
  cargo: 'Cargo',
  bizjet: 'Business-jet',
  charter: 'Charter',
};

/** "12.4 t", or kilograms below a tonne (light aircraft). */
function fmtMass(kg: number): string {
  if (Math.abs(kg) < 1000) return `${Math.round(kg).toLocaleString()} kg`;
  return `${(kg / 1000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} t`;
}

const seedOf = (id: string) => {
  const n = Number.parseInt(id.replace(/^~/, ''), 16);
  if (Number.isFinite(n)) return n;
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
};

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="glass-2 rounded-[16px] px-3.5 pb-1.5 pt-3">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="eyebrow">{title}</h3>
        {aside && <span className="text-[10.5px] text-fg-3">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function Line({ label, value, sub, strong }: { label: ReactNode; value: ReactNode; sub?: ReactNode; strong?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 border-b border-[var(--line)] py-1.5 last:border-b-0', strong && 'border-t border-t-[var(--line-strong)]')}>
      <span className={cn('min-w-0 text-[12px]', strong ? 'font-semibold text-fg' : 'text-fg-3')}>
        {label}
        {sub && <span className="ml-1.5 text-[10.5px] text-fg-3">{sub}</span>}
      </span>
      <span className={cn('tnum shrink-0 text-right text-[12.5px]', strong ? 'font-semibold text-fg' : 'font-medium text-fg')}>{value}</span>
    </div>
  );
}

/** Weight against a structural limit, as a thin bar. */
function LimitBar({ label, kg, limit, limitLabel }: { label: string; kg: number; limit: number; limitLabel: string }) {
  const pct = Math.max(0, Math.min(100, (kg / Math.max(1, limit)) * 100));
  const tight = pct >= 97;
  return (
    <div className="border-b border-[var(--line)] py-2 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12px] text-fg-3">{label}</span>
        <span className="tnum text-[12.5px] font-medium text-fg">
          {fmtMass(kg)}{' '}
          <span className="text-[11px] font-normal text-fg-3">
            / {fmtMass(limit)} {limitLabel}
          </span>
        </span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-[var(--line)]" role="meter" aria-label={`${label} against ${limitLabel}`} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn('h-1.5 rounded-full', tight ? 'bg-[#ffb547]' : 'bg-[var(--accent)]')} style={{ width: `${pct}%` }} />
      </div>
      <p className="tnum mt-1 text-right text-[10.5px] text-fg-3">
        {Math.round(pct)} % of {limitLabel}
      </p>
    </div>
  );
}

/** Seat map, folded to the front cabin for long fuselages. */
function CabinMap({ s, seed }: { s: LoadSheet; seed: number }) {
  const [open, setOpen] = useState(false);
  if (!s.cabin) return null;
  const long = s.cabin.seats > 60;
  return (
    <div>
      <div className={cn(long && !open && 'max-h-[360px] overflow-hidden [mask-image:linear-gradient(to_bottom,black_65%,transparent)]')}>
        <SeatMap layout={s.cabin} occupancy={s.lf} seed={seed} compact />
      </div>
      {long && (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mx-auto mt-1 flex h-7 items-center rounded-full border border-[var(--line)] px-3 text-[11.5px] font-medium text-fg-2 hover:text-fg">
          {open ? 'Fold seat map' : `Show all ${s.cabin.seats} seats`}
        </button>
      )}
    </div>
  );
}

function FuelNow({ s }: { s: LoadSheet }) {
  if (s.fuelNowKg === undefined) return null;
  const start = s.blockFuelKg - s.taxiFuelKg;
  const pct = Math.max(0, Math.min(100, (s.fuelNowKg / Math.max(1, start)) * 100));
  const atLanding = start - s.tripFuelKg;
  const landPct = Math.max(0, Math.min(100, (atLanding / Math.max(1, start)) * 100));
  return (
    <div className="mb-1 mt-1 rounded-[12px] bg-[var(--line)] px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12px] font-medium text-fg-2">Fuel on board now</span>
        <span className="tnum text-[15px] font-semibold tracking-[-0.01em] text-fg">{fmtMass(s.fuelNowKg)}</span>
      </div>
      <div
        className="relative mt-2 h-2 rounded-full bg-[var(--line)]"
        role="meter"
        aria-label="Fuel on board against take-off fuel"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-2 rounded-full bg-[linear-gradient(90deg,#ffb547,#3ddc97)]" style={{ width: `${pct}%` }} />
        <span className="absolute -top-0.5 h-3 w-px bg-[var(--fg-3)]" style={{ left: `${landPct}%` }} title="Planned fuel at landing" />
      </div>
      <p className="tnum mt-1.5 flex justify-between text-[10.5px] text-fg-3">
        <span>Planned at landing {fmtMass(atLanding)}</span>
        <span>Take-off {fmtMass(start)}</span>
      </p>
    </div>
  );
}

export function LoadTab({ id, info }: { id: string; info: FlightInfo | undefined }) {
  const q = useQuery({
    queryKey: ['load', id],
    queryFn: async () => (await simLoad(id)) ?? null,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
  if (q.isPending)
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2.5">
          <Skeleton className="h-[74px]" />
          <Skeleton className="h-[74px]" />
        </div>
        <Skeleton className="h-48" />
      </div>
    );
  const d = q.data;
  if (!d) return <EmptyState title="No load data" body="There are no public weight figures for this aircraft type, so no load sheet can be estimated." />;
  const s = d.sheet;
  const positioning = info?.kind === 'positioning' || info?.kind === 'delivery';
  const lfPct = Math.round(s.lf * 100);
  const classes = (['F', 'J', 'W', 'Y'] as const).filter((c) => s.byClass[c]);
  const fuelSum = s.tripFuelKg + s.contingencyKg + s.alternateKg + s.reserveKg + s.taxiFuelKg;
  const extra = s.blockFuelKg - fuelSum;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5">
        {s.freighter ? (
          <Stat label="Cargo payload" value={fmtMass(s.cargoKg)} sub="Freighter · no passenger cabin" />
        ) : positioning || s.seats === 0 ? (
          <Stat label="Passengers" value="None" sub={positioning ? 'No passengers · positioning' : 'No passenger cabin'} />
        ) : (
          <Stat
            label="Passengers"
            value={
              <>
                {s.pax.toLocaleString()} <span className="text-[14px] font-medium text-fg-3">/ {s.seats.toLocaleString()}</span>
              </>
            }
            sub={`${lfPct} % load factor`}
          />
        )}
        <Stat label="Trip CO₂" value={fmtMass(s.co2Kg)} sub={s.co2PerPaxKg !== undefined ? `${s.co2PerPaxKg.toLocaleString()} kg per passenger` : 'from trip fuel × 3.16'} />
      </div>

      {!s.freighter && s.cabin && !positioning && (
        <Section title="Cabin" aside={`${MODEL_NAME[d.model] ?? 'Typical'} layout`}>
          {classes.length > 0 && (
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              {classes.map((c) => {
                const b = s.byClass[c]!;
                return (
                  <span key={c} className="tnum rounded-full bg-[var(--line)] px-2 py-0.5 text-[11px] text-fg-2">
                    {s.cabin && s.cabin.seats <= 9 && c === 'Y' ? 'Cabin' : CLASS_NAME[c]} <span className="font-semibold text-fg">{b.pax}</span>
                    <span className="text-fg-3">/{b.seats}</span>
                  </span>
                );
              })}
            </div>
          )}
          <div className="pb-2">
            <CabinMap s={s} seed={seedOf(id)} />
          </div>
        </Section>
      )}
      {positioning && !s.freighter && <p className="glass-2 rounded-[14px] px-3.5 py-2.5 text-[12px] text-fg-2">No passengers — the aircraft is being positioned empty for its next service.</p>}

      <Section title="Fuel plan" aside={`burn ${fmtMass(s.burnKgH)}/h`}>
        <FuelNow s={s} />
        <Line label="Taxi" value={fmtMass(s.taxiFuelKg)} />
        <Line label="Trip" value={fmtMass(s.tripFuelKg)} />
        <Line label="Contingency" sub="5 %" value={fmtMass(s.contingencyKg)} />
        <Line label="Alternate" value={fmtMass(s.alternateKg)} />
        <Line label="Final reserve" sub="30 min" value={fmtMass(s.reserveKg)} />
        {extra > 0 && <Line label="Extra" sub="captain's discretion" value={fmtMass(extra)} />}
        <Line label="Block fuel" value={fmtMass(s.blockFuelKg)} strong />
      </Section>

      <Section title="Weights">
        <Line label="Zero-fuel weight" value={fmtMass(s.zfwKg)} />
        <LimitBar label="Take-off weight" kg={s.towKg} limit={s.mtowKg} limitLabel="MTOW" />
        <LimitBar label="Landing weight" kg={s.lwKg} limit={s.mlwKg} limitLabel="MLW" />
        {s.limitedBy && (
          <p className="py-2 text-[11.5px] leading-snug text-[#ffb547]">
            Limited by {s.limitedBy}
            {s.limitedBy === 'MTOW'
              ? ' — cargo was offloaded to stay within the maximum take-off weight.'
              : s.limitedBy === 'fuel capacity'
                ? ' — tanks are full; the planned fuel exceeds capacity.'
                : ' — at the maximum structural payload.'}
          </p>
        )}
      </Section>

      <Section title="Payload">
        {!s.freighter && <Line label="Passengers" sub={s.pax ? `${s.pax} × 84 kg` : undefined} value={fmtMass(s.pax * 84)} />}
        {!s.freighter && <Line label="Checked baggage" value={fmtMass(s.bagsKg)} />}
        <Line label={s.freighter ? 'Cargo (main deck and holds)' : 'Cargo and mail'} value={fmtMass(s.cargoKg)} />
        <Line label="Total payload" value={fmtMass(s.payloadKg)} strong />
      </Section>

      <p className="text-[11px] leading-relaxed text-fg-3">Estimated from public type data and standard planning rules for a simulated flight — not an operational load sheet.</p>
    </div>
  );
}
