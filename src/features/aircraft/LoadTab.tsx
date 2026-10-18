// Estimated load sheet for the simulated flight: passengers and cabin, connecting traffic,
// fuel plan with tankering, weights against structural limits, a weight-and-balance trim
// sheet with its CG envelope, cargo and CO2. Illustrative only — never operational.
import { angleDelta, bearingDeg } from '@shared/geo';
import { useQuery } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { BarList, SplitBar } from '@/components/ui/Charts';
import { Stat } from '@/components/ui/Data';
import { EmptyState, Skeleton } from '@/components/ui/Feedback';
import { cgLimitsAt, withTanker, type LoadSheet, type TankerPlan, type TrimPoint, type TrimSheet } from '@/data/sim/loadsheet';
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
const WARN = 'text-[#ffb547] [:root[data-theme=light]_&]:text-[#9a5700]';

/** "12.4 t", or kilograms below a tonne (light aircraft). */
function fmtMass(kg: number): string {
  if (Math.abs(kg) < 1000) return `${Math.round(kg).toLocaleString()} kg`;
  return `${(kg / 1000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} t`;
}
const fmtIdx = (v: number) => (v > 0 ? `+${v.toFixed(1)}` : v < 0 ? `−${Math.abs(v).toFixed(1)}` : '0.0');
const fmtUsd = (v: number) => `$${Math.round(v).toLocaleString()}`;

const seedOf = (id: string) => {
  const n = Number.parseInt(id.replace(/^~/, ''), 16);
  if (Number.isFinite(n)) return n;
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
};
const hashStr = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

function Section({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('glass-2 rounded-[16px] px-3.5 pb-2 pt-3', className)}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h3 className="eyebrow">{title}</h3>
        {aside && <span className="truncate text-[10.5px] text-fg-3">{aside}</span>}
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
      <div className="mt-1.5 h-1.5 rounded-full bg-[var(--viz-grid)]" role="meter" aria-label={`${label} against ${limitLabel}`} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn('h-1.5 rounded-full', tight ? 'bg-[#ffb547]' : 'bg-[var(--viz-1)]')} style={{ width: `${pct}%` }} />
      </div>
      <p className="tnum mt-1 text-right text-[10.5px] text-fg-3">
        {Math.round(pct)} % of {limitLabel}
        {tight && ' · close to the limit'}
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
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mx-auto mt-1 flex h-8 items-center rounded-full border border-[var(--line)] px-3.5 text-[11.5px] font-medium text-fg-2 hover:text-fg">
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
    <div className="mb-1.5 mt-0.5 rounded-[12px] bg-[var(--line)] px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12px] font-medium text-fg-2">Fuel on board now</span>
        <span className="tnum text-[15px] font-semibold tracking-[-0.01em] text-fg">{fmtMass(s.fuelNowKg)}</span>
      </div>
      <div className="relative mt-2 h-2 rounded-full bg-[var(--line)]" role="meter" aria-label="Fuel on board against take-off fuel" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-2 rounded-full bg-[linear-gradient(90deg,#ffb547,#3ddc97)]" style={{ width: `${pct}%` }} />
        <span className="absolute -top-0.5 h-3 w-px bg-[var(--fg-3)]" style={{ left: `${landPct}%` }} title="Planned fuel at landing" />
      </div>
      <p className="tnum mt-1.5 flex justify-between gap-2 text-[10.5px] text-fg-3">
        <span>Planned at landing {fmtMass(atLanding)}</span>
        <span>Take-off {fmtMass(start)}</span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- connecting passengers

const REGIONS = [
  { id: 'eu', name: 'Europe', lat: 50, lon: 10, w: 1.2 },
  { id: 'me', name: 'Middle East', lat: 26, lon: 48, w: 0.55 },
  { id: 'af', name: 'Africa', lat: 2, lon: 22, w: 0.6 },
  { id: 'sa', name: 'South Asia', lat: 21, lon: 78, w: 0.9 },
  { id: 'ea', name: 'East Asia', lat: 34, lon: 118, w: 1 },
  { id: 'se', name: 'Southeast Asia', lat: 6, lon: 108, w: 0.8 },
  { id: 'oc', name: 'Oceania', lat: -28, lon: 145, w: 0.45 },
  { id: 'na', name: 'North America', lat: 40, lon: -95, w: 1.1 },
  { id: 'la', name: 'Latin America', lat: -12, lon: -60, w: 0.45 },
] as const;
type RegionId = (typeof REGIONS)[number]['id'];

/** Coarse world region of a position (for the connecting-traffic estimate). */
function regionOf(lat: number, lon: number): RegionId {
  if (lon < -30) return lat > 15 ? 'na' : 'la';
  if (lon < 60) return lat > 36 || (lat > 34 && lon < 45) ? 'eu' : lat > 12 && lon > 34 ? 'me' : 'af';
  if (lon < 90) return lat > 40 ? 'eu' : 'sa';
  if (lon < 150) return lat < -10 ? 'oc' : lat < 20 ? 'se' : 'ea';
  return 'oc';
}

/**
 * Where connecting passengers go next (flight into the hub) or came from (flight out of
 * the hub): regions roughly "beyond" the hub along the direction of travel weigh most.
 * Deterministic per flight number; a plausible model, not booking data.
 */
function connectSplit(info: FlightInfo, hub: string, pax: number) {
  const inbound = info.to.iata === hub || info.to.ident === hub;
  const h = inbound ? info.to : info.from;
  const other = inbound ? info.from : info.to;
  const hubR = regionOf(h.lat, h.lon);
  const otherR = regionOf(other.lat, other.lon);
  // Directions of travel measured at the hub: arriving (reverse of hub → other) vs leaving.
  const toOther = bearingDeg(h.lat, h.lon, other.lat, other.lon);
  const travel = inbound ? toOther + 180 : toOther;
  const parts = REGIONS.map((r) => {
    let f: number;
    if (r.id === hubR) f = 0.35;
    else {
      const toR = bearingDeg(h.lat, h.lon, r.lat, r.lon);
      const dir = inbound ? toR : toR + 180;
      f = Math.max(0.03, ((1 + Math.cos((angleDelta(travel, dir) * Math.PI) / 180)) / 2) ** 1.5);
    }
    if (r.id === otherR) f *= 0.25;
    return { key: r.id, label: r.name, w: r.w * f * (0.85 + (hashStr(info.flight + r.id) % 30) / 100) };
  }).sort((a, b) => b.w - a.w);
  const total = parts.reduce((a, p) => a + p.w, 0) || 1;
  const top = parts.slice(0, 4);
  const rest = 1 - top.reduce((a, p) => a + p.w, 0) / total;
  const rows = [...top.map((p) => ({ key: p.key, label: p.label, share: p.w / total })), ...(rest > 0.02 ? [{ key: 'other', label: 'Other regions', share: rest }] : [])];
  return { inbound, rows: rows.map((r) => ({ key: r.key, label: r.label, value: Math.round(r.share * pax) })) };
}

function Connecting({ c, s, info }: { c: { share: number; hub: string }; s: LoadSheet; info: FlightInfo | undefined }) {
  const conn = Math.round(s.pax * c.share);
  const split = info ? connectSplit(info, c.hub, conn) : undefined;
  return (
    <Section title="Connecting passengers" aside="estimate">
      <p className="text-[13px] text-fg">
        <span className="tnum font-semibold">≈ {Math.round(c.share * 100)} %</span> connecting at <span className="font-semibold">{c.hub}</span>
        <span className="tnum text-fg-3"> · {conn.toLocaleString()} of {s.pax.toLocaleString()}</span>
      </p>
      <div className="mt-2">
        <SplitBar
          parts={[
            { key: 'c', label: `Connecting at ${c.hub}`, value: conn, color: 'var(--viz-1)' },
            { key: 'l', label: split?.inbound === false ? `Starting at ${c.hub}` : `Ending at ${c.hub}`, value: s.pax - conn, color: 'var(--viz-3)' },
          ]}
        />
      </div>
      {split && conn > 0 && (
        <div className="mt-3 border-t border-[var(--line)] pb-1 pt-2.5">
          <p className="mb-2 text-[11.5px] font-medium text-fg-2">{split.inbound ? `Flying on from ${c.hub} to` : `Connected at ${c.hub} from`}</p>
          <BarList data={split.rows} total={conn} valueLabel={(d) => `${d.value}`} />
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- tankering

function Tankering({ t, from, to }: { t: TankerPlan; from: string; to: string }) {
  const title = t.on ? `Tankering ${fmtMass(t.extraKg)} — saves ≈ ${fmtUsd(t.savingUsd)}` : `No tankering — ${t.reason}`;
  return (
    <div className={cn('mb-1.5 mt-2 rounded-[12px] border px-3 py-2.5', t.on ? 'border-[color-mix(in_srgb,var(--viz-3)_45%,transparent)] bg-[color-mix(in_srgb,var(--viz-3)_9%,transparent)]' : 'border-[var(--line)] bg-[var(--line)]')}>
      <div className="flex items-start gap-2">
        <span className={cn('mt-[3px] shrink-0 rounded-full px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-[0.08em]', t.on ? 'bg-[var(--viz-3)] text-[#04140d]' : 'bg-[var(--line-strong)] text-fg-2')}>{t.on ? 'Tanker' : 'No'}</span>
        <p className="min-w-0 text-[12.5px] font-semibold leading-snug text-fg">{title}</p>
      </div>
      <dl className="tnum mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-fg-3">Fuel at {from}</dt>
        <dd className="text-right text-fg-2">≈ {fmtUsd(t.usdPerT.origin)}/t</dd>
        <dt className="text-fg-3">Fuel at {to}</dt>
        <dd className="text-right text-fg-2">≈ {fmtUsd(t.usdPerT.dest)}/t</dd>
        {t.on ? (
          <>
            <dt className="text-fg-3">Extra burn to carry it</dt>
            <dd className="text-right text-fg-2">
              {fmtMass(t.burnKg)} <span className="text-fg-3">({(t.ratePerH * 100).toFixed(1)} %/h)</span>
            </dd>
            <dt className="text-fg-3">Limited by</dt>
            <dd className="text-right text-fg-2">{t.limit}</dd>
          </>
        ) : (
          <>
            <dt className="text-fg-3">Per tonne carried</dt>
            <dd className="text-right text-fg-2">{t.perTonneUsd >= 0 ? `saves ${fmtUsd(t.perTonneUsd)}` : `costs ${fmtUsd(-t.perTonneUsd)}`}</dd>
          </>
        )}
      </dl>
      <p className="mt-1.5 text-[10.5px] leading-snug text-fg-3">Illustrative fuel prices; ignores CO₂ costs and fuel-quality rules.</p>
    </div>
  );
}

// ---------------------------------------------------------------- trim sheet

const POINT_NAME = { zfw: 'Zero-fuel weight', tow: 'Take-off weight', lw: 'Landing weight' } as const;
type PointKey = keyof typeof POINT_NAME;

/** Weight vs CG (%MAC) with the certified envelope polygon and the ZFW → TOW fuel line. */
function EnvelopeChart({ t, s }: { t: TrimSheet; s: LoadSheet }) {
  const [hover, setHover] = useState<PointKey | null>(null);
  const titleId = useId();
  const W = 340;
  const H = 236;
  const pad = { l: 38, r: 44, t: 12, b: 34 };
  const macs = t.envelope.map((p) => p[0]).concat([t.zfw.mac, t.tow.mac, t.lw.mac]);
  const x0 = Math.floor((Math.min(...macs) - 2) / 5) * 5;
  const x1 = Math.ceil((Math.max(...macs) + 2) / 5) * 5;
  const wMin = Math.min(...t.envelope.map((p) => p[1]));
  const wMax = s.mtowKg;
  const span = wMax - wMin;
  const step = [1, 2, 5, 10, 20, 25, 50, 100].map((v) => v * 1000).find((v) => span / v <= 5) ?? 100_000;
  const y0 = Math.floor((wMin - span * 0.04) / step) * step;
  const y1 = Math.ceil((wMax + span * 0.04) / step) * step;
  const x = (m: number) => pad.l + ((m - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const y = (kg: number) => pad.t + (1 - (kg - y0) / (y1 - y0)) * (H - pad.t - pad.b);
  const xt: number[] = [];
  for (let m = x0; m <= x1; m += 5) xt.push(m);
  const yt: number[] = [];
  for (let v = y0; v <= y1 + 1; v += step) yt.push(v);
  const poly = t.envelope.map(([m, kg]) => `${x(m).toFixed(1)},${y(kg).toFixed(1)}`).join(' ');
  const limits = [
    { k: 'MTOW', kg: s.mtowKg },
    { k: 'MLW', kg: s.mlwKg },
    { k: 'MZFW', kg: t.mzfwKg },
  ]
    .filter((l) => l.kg <= wMax && l.kg >= wMin)
    .sort((a, b) => b.kg - a.kg);
  // Keep the right-hand limit labels at least 10 px apart (MLW and MZFW are often close).
  const labelY: number[] = [];
  for (const l of limits) labelY.push(Math.max(y(l.kg) + 3.5, (labelY[labelY.length - 1] ?? -Infinity) + 10));
  const pts: { key: PointKey; p: TrimPoint; label: string }[] = [
    { key: 'zfw', p: t.zfw, label: 'ZFW' },
    { key: 'tow', p: t.tow, label: 'TOW' },
    { key: 'lw', p: t.lw, label: 'LW' },
  ];
  // Labels sit right of the point, except LW (on the fuel line between the two) which sits left.
  const tip = hover ? pts.find((q) => q.key === hover)! : null;
  const tl = tip ? cgLimitsAt(t.envelope, tip.p.kg) : null;
  const t1 = (kg: number) => (kg / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 });
  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-manipulation select-none" role="group" aria-labelledby={titleId} onPointerLeave={() => setHover(null)}>
        <title id={titleId}>
          CG envelope: zero-fuel weight {t1(t.zfw.kg)} t at {t.zfw.mac} % MAC, take-off weight {t1(t.tow.kg)} t at {t.tow.mac} % MAC, landing weight {t1(t.lw.kg)} t at {t.lw.mac} % MAC — {t.inLimits ? 'all within limits' : 'outside limits'}
        </title>
        {yt.map((v) => (
          <g key={`y${v}`}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--viz-grid)" />
            <text x={pad.l - 6} y={y(v) + 3.5} textAnchor="end" fontSize="9.5" fill="var(--fg-3)" className="tnum">
              {t1(v)}
            </text>
          </g>
        ))}
        {xt.map((m) => (
          <g key={`x${m}`}>
            <line x1={x(m)} x2={x(m)} y1={pad.t} y2={H - pad.b} stroke="var(--viz-grid)" />
            <text x={x(m)} y={H - pad.b + 13} textAnchor="middle" fontSize="9.5" fill="var(--fg-3)" className="tnum">
              {m}
            </text>
          </g>
        ))}
        <text x={pad.l + (W - pad.l - pad.r) / 2} y={H - 4} textAnchor="middle" fontSize="10" fill="var(--fg-2)">
          Centre of gravity (% MAC)
        </text>
        <text transform={`translate(10 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`} textAnchor="middle" fontSize="10" fill="var(--fg-2)">
          Weight (t)
        </text>
        <polygon points={poly} fill="var(--viz-1)" fillOpacity="0.08" stroke="var(--fg-3)" strokeWidth="1.25" strokeLinejoin="round" />
        {limits.map((l, i) => {
          const [f, a] = cgLimitsAt(t.envelope, l.kg);
          return (
            <g key={l.k}>
              <line x1={x(f)} x2={x(a)} y1={y(l.kg)} y2={y(l.kg)} stroke="var(--fg-3)" strokeDasharray="3 3" strokeWidth="1" />
              <text x={W - pad.r + 4} y={labelY[i]} fontSize="9" fill="var(--fg-3)">
                {l.k}
              </text>
            </g>
          );
        })}
        <line x1={x(t.zfw.mac)} y1={y(t.zfw.kg)} x2={x(t.tow.mac)} y2={y(t.tow.kg)} stroke="var(--viz-1)" strokeWidth="2" strokeLinecap="round" />
        {pts.map(({ key, p, label }) => {
          const left = key === 'lw' ? p.mac <= Math.max(t.zfw.mac, t.tow.mac) : false;
          const active = hover === key;
          return (
            <g
              key={key}
              tabIndex={0}
              role="img"
              aria-label={`${POINT_NAME[key]} ${t1(p.kg)} t, ${p.mac} % MAC, index ${p.index.toFixed(1)}`}
              onPointerEnter={() => setHover(key)}
              onFocus={() => setHover(key)}
              onBlur={() => setHover(null)}
              className="cursor-default outline-none [&:focus-visible>circle:nth-child(2)]:stroke-[var(--accent)]"
            >
              <circle cx={x(p.mac)} cy={y(p.kg)} r="13" fill="transparent" />
              <circle cx={x(p.mac)} cy={y(p.kg)} r={active ? 5.5 : 4.5} fill={key === 'lw' ? 'var(--surface-solid)' : 'var(--viz-1)'} stroke={key === 'lw' ? 'var(--viz-1)' : 'var(--surface-solid)'} strokeWidth="2" />
              <text x={x(p.mac) + (left ? -9 : 9)} y={y(p.kg) + 3.5} textAnchor={left ? 'end' : 'start'} fontSize="10" fontWeight="600" fill="var(--fg)">
                {label}
              </text>
            </g>
          );
        })}
      </svg>
      {tip && tl && (
        <div
          className="pointer-events-none absolute z-10 w-[176px] rounded-[10px] border border-[var(--line)] bg-[var(--surface-solid)] px-2.5 py-1.5 text-[11px] shadow-xl"
          style={
            x(tip.p.mac) > W / 2
              ? { right: `calc(${(1 - x(tip.p.mac) / W) * 100}% + 14px)`, top: `calc(${(y(tip.p.kg) / H) * 100}% - 24px)` }
              : { left: `calc(${(x(tip.p.mac) / W) * 100}% + 14px)`, top: `calc(${(y(tip.p.kg) / H) * 100}% - 24px)` }
          }
        >
          <div className="font-semibold text-fg">{POINT_NAME[tip.key]}</div>
          <div className="tnum text-fg-2">
            {fmtMass(tip.p.kg)} · {tip.p.mac} % MAC
          </div>
          <div className="tnum text-fg-3">
            Index {tip.p.index.toFixed(1)}
          </div>
          <div className="tnum text-fg-3">
            Limits {tl[0].toFixed(1)}–{tl[1].toFixed(1)} % MAC
          </div>
        </div>
      )}
      <figcaption className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-fg-3">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-3.5 rounded-[3px] border border-[var(--fg-3)] bg-[color-mix(in_srgb,var(--viz-1)_10%,transparent)]" /> Certified envelope
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-[2px] w-3.5 rounded-full bg-[var(--viz-1)]" /> Fuel line ZFW → TOW
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3.5 border-t border-dashed border-[var(--fg-3)]" /> Weight limits
        </span>
      </figcaption>
    </figure>
  );
}

function TrimTable({ t, s }: { t: TrimSheet; s: LoadSheet }) {
  const row = (label: ReactNode, kg: number | null, idx: ReactNode, total?: boolean, key?: string) => (
    <tr key={key} className={cn('border-b border-[var(--line)] last:border-b-0', total && 'border-t border-t-[var(--line-strong)]')}>
      <th scope="row" className={cn('py-1.5 pr-2 text-left text-[12px] font-normal', total ? 'font-semibold text-fg' : 'text-fg-3')}>
        {label}
      </th>
      <td className={cn('tnum py-1.5 pr-2 text-right text-[12px]', total ? 'font-semibold text-fg' : 'text-fg')}>{kg === null ? '' : fmtMass(kg)}</td>
      <td className={cn('tnum py-1.5 text-right text-[12px]', total ? 'font-semibold text-fg' : 'text-fg-2')}>{idx}</td>
    </tr>
  );
  const pt = (p: TrimPoint, name: string) => (
    <>
      {p.index.toFixed(1)}
      <span className="block text-[10px] font-normal text-fg-3">
        {name} · {p.mac} % MAC
      </span>
    </>
  );
  const landFuel = t.fuelKg - s.tripFuelKg;
  return (
    <table className="w-full border-collapse">
      <caption className="sr-only">Trim sheet: weights and index units from the dry operating weight to the landing weight</caption>
      <thead>
        <tr className="border-b border-[var(--line-strong)] text-[10.5px] uppercase tracking-[0.08em] text-fg-3">
          <th scope="col" className="pb-1 text-left font-medium">
            Item
          </th>
          <th scope="col" className="pb-1 pr-2 text-right font-medium">
            Weight
          </th>
          <th scope="col" className="pb-1 text-right font-medium">
            Index
          </th>
        </tr>
      </thead>
      <tbody>
        {row(
          <>
            Dry operating weight
            <span className="block text-[10px] text-fg-3">
              crew {t.crew[0]}/{t.crew[1]} · {t.dowMac} % MAC
            </span>
          </>,
          t.dowKg,
          <>
            {t.doi.toFixed(1)}
            <span className="block text-[10px] text-fg-3">DOI</span>
          </>,
          false,
          'dow',
        )}
        {t.zones.map((z) =>
          row(
            <>
              Zone {z.id}
              <span className="ml-1.5 text-[10.5px] text-fg-3">
                {z.pax}/{z.seats} pax{z.upper ? ' · upper deck' : ''}
              </span>
            </>,
            z.kg,
            fmtIdx(z.index),
            false,
            z.id,
          ),
        )}
        {t.holds.map((h) => row(h.label, h.kg, fmtIdx(h.index), false, h.id))}
        {row('Zero-fuel weight', t.zfw.kg, pt(t.zfw, 'LIZFW'), true, 'zfw')}
        {row('Take-off fuel', t.fuelKg, fmtIdx(t.fuelIndex), false, 'tof')}
        {row('Take-off weight', t.tow.kg, pt(t.tow, 'LITOW'), true, 'tow')}
        {row('Trip fuel burned', -s.tripFuelKg, fmtIdx(t.lw.index - t.tow.index), false, 'trip')}
        {row(
          <>
            Landing weight
            <span className="block text-[10px] font-normal text-fg-3">with {fmtMass(landFuel)} fuel</span>
          </>,
          t.lw.kg,
          pt(t.lw, 'LILW'),
          true,
          'lw',
        )}
      </tbody>
    </table>
  );
}

function Trim({ t, s }: { t: TrimSheet; s: LoadSheet }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const [fwd, aft] = cgLimitsAt(t.envelope, t.tow.kg);
  return (
    <Section title="Trim sheet" aside="weight & balance · index method">
      <div className="grid grid-cols-3 gap-2 pb-2.5 pt-0.5">
        {[
          ['ZFW CG', `${t.zfw.mac} %`, `% MAC · I ${t.zfw.index.toFixed(1)}`],
          ['TOW CG', `${t.tow.mac} %`, `% MAC · I ${t.tow.index.toFixed(1)}`],
          ['T/O trim', t.stab.replace(' units', ''), t.geo.airbus ? 'THS, degrees' : 'stab units'],
        ].map(([l, v, sub]) => (
          <div key={l} className="min-w-0 rounded-[12px] bg-[var(--line)] px-2.5 py-2">
            <div className="truncate text-[10px] font-medium uppercase tracking-[0.08em] text-fg-3">{l}</div>
            <div className="tnum mt-1 truncate text-[16px] font-semibold leading-none text-fg">{v}</div>
            <div className="tnum mt-1 truncate text-[10px] text-fg-3">{sub}</div>
          </div>
        ))}
      </div>
      <p className={cn('mb-2 text-[11.5px] leading-snug', t.inLimits ? 'text-fg-2' : WARN)}>
        {t.inLimits ? (
          <>
            <span className="mr-1 inline-block size-2 rounded-full bg-[var(--viz-3)] align-[1px]" aria-hidden="true" />
            <span className="font-semibold text-fg">Within limits</span> — take-off CG {t.tow.mac} % against {fwd.toFixed(1)}–{aft.toFixed(1)} % MAC at this weight.
          </>
        ) : (
          <>
            <span className="mr-1 inline-block size-2 rounded-full bg-[#ffb547] align-[1px]" aria-hidden="true" />
            <span className="font-semibold">Outside limits</span> — the simulated CG falls outside the envelope; a real flight would re-trim before departure.
          </>
        )}
        {t.movedKg ? ` Load control moved ${fmtMass(t.movedKg)} between holds to trim.` : ''}
      </p>
      <div className="mb-2 flex gap-1.5" role="group" aria-label="Trim sheet view">
        {(['chart', 'table'] as const).map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={cn('h-7 rounded-full border px-3 text-[11.5px] font-medium', view === v ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--line)] text-fg-3 hover:text-fg-2')}
          >
            {v === 'chart' ? 'CG envelope' : 'Envelope as table'}
          </button>
        ))}
      </div>
      {view === 'chart' ? (
        <EnvelopeChart t={t} s={s} />
      ) : (
        <table className="w-full border-collapse text-[12px]">
          <caption className="sr-only">Centre of gravity at each weight against the envelope limits</caption>
          <thead>
            <tr className="border-b border-[var(--line-strong)] text-[10.5px] uppercase tracking-[0.08em] text-fg-3">
              <th scope="col" className="pb-1 text-left font-medium">
                Point
              </th>
              <th scope="col" className="pb-1 text-right font-medium">
                Weight
              </th>
              <th scope="col" className="pb-1 text-right font-medium">
                CG
              </th>
              <th scope="col" className="pb-1 text-right font-medium">
                Limits
              </th>
            </tr>
          </thead>
          <tbody>
            {(['zfw', 'tow', 'lw'] as const).map((k) => {
              const p = t[k];
              const [f, a] = cgLimitsAt(t.envelope, p.kg);
              return (
                <tr key={k} className="border-b border-[var(--line)] last:border-b-0">
                  <th scope="row" className="py-1.5 text-left font-normal text-fg-3">
                    {k.toUpperCase()}
                  </th>
                  <td className="tnum py-1.5 text-right text-fg">{fmtMass(p.kg)}</td>
                  <td className="tnum py-1.5 text-right text-fg">{p.mac} %</td>
                  <td className="tnum py-1.5 text-right text-fg-2">
                    {f.toFixed(1)}–{a.toFixed(1)} %
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="mt-3 border-t border-[var(--line)] pt-2">
        <TrimTable t={t} s={s} />
      </div>
      <p className="tnum pb-1 pt-2 text-[10.5px] leading-snug text-fg-3">
        Index = W × (arm − {(t.geo.lemac + t.geo.mac * 0.25).toFixed(1)} m) / {t.geo.c.toLocaleString()} + {t.geo.k}. LEMAC {t.geo.lemac} m, MAC {t.geo.mac} m — approximated from the type&rsquo;s dimensions.
      </p>
    </Section>
  );
}

// ---------------------------------------------------------------- tab

export function LoadTab({ id, info }: { id: string; info: FlightInfo | undefined }) {
  const q = useQuery({
    queryKey: ['load', id],
    queryFn: async () => (await simLoad(id)) ?? null,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
  if (q.isPending)
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading the load sheet">
        <div className="grid grid-cols-2 gap-2.5">
          <Skeleton className="h-[74px]" />
          <Skeleton className="h-[74px]" />
        </div>
        <Skeleton className="h-28" />
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );
  const d = q.data;
  if (!d) return <EmptyState title="No load data" body="There are no public weight figures for this aircraft type, so no load sheet can be estimated." />;
  // Tankering needs fuel prices; apply it here when the simulator has not already done so.
  const s = d.sheet.tanker || !d.fuelPrice || d.sheet.airborneH === undefined ? d.sheet : withTanker(d.sheet, d.fuelPrice);
  const positioning = info?.kind === 'positioning' || info?.kind === 'delivery';
  const lfPct = Math.round(s.lf * 100);
  const classes = (['F', 'J', 'W', 'Y'] as const).filter((c) => s.byClass[c]);
  const tk = s.tanker;
  const tankered = tk?.on ? tk.extraKg - tk.burnKg : 0;
  const fuelSum = s.tripFuelKg + s.contingencyKg + s.alternateKg + s.reserveKg + s.taxiFuelKg + tankered;
  const extra = s.blockFuelKg - fuelSum;
  const from = info?.from.iata ?? info?.from.ident ?? 'origin';
  const to = info?.to.iata ?? info?.to.ident ?? 'destination';

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

      {d.connecting && s.pax > 0 && !positioning && <Connecting c={d.connecting} s={s} info={info} />}

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
        <Line label="Trip" sub={tk?.on ? `incl. ${fmtMass(tk.burnKg)} to carry tankered fuel` : undefined} value={fmtMass(s.tripFuelKg)} />
        <Line label="Contingency" sub="5 %" value={fmtMass(s.contingencyKg)} />
        <Line label="Alternate" value={fmtMass(s.alternateKg)} />
        <Line label="Final reserve" sub="30 min" value={fmtMass(s.reserveKg)} />
        {extra > 0 && <Line label="Extra" sub="captain's discretion" value={fmtMass(extra)} />}
        {tankered > 0 && <Line label="Tankered" sub={`for the return from ${to}`} value={fmtMass(tankered)} />}
        <Line label="Block fuel" value={fmtMass(s.blockFuelKg)} strong />
        {tk && <Tankering t={tk} from={from} to={to} />}
      </Section>

      <Section title="Weights">
        {s.trim ? <LimitBar label="Zero-fuel weight" kg={s.zfwKg} limit={s.trim.mzfwKg} limitLabel="MZFW" /> : <Line label="Zero-fuel weight" value={fmtMass(s.zfwKg)} />}
        <LimitBar label="Take-off weight" kg={s.towKg} limit={s.mtowKg} limitLabel="MTOW" />
        <LimitBar label="Landing weight" kg={s.lwKg} limit={s.mlwKg} limitLabel="MLW" />
        {s.limitedBy && (
          <p className={cn('py-2 text-[11.5px] leading-snug', WARN)}>
            Limited by {s.limitedBy}
            {s.limitedBy === 'MTOW'
              ? ' — cargo was offloaded to stay within the maximum take-off weight.'
              : s.limitedBy === 'fuel capacity'
                ? ' — tanks are full; the planned fuel exceeds capacity.'
                : ' — at the maximum structural payload.'}
          </p>
        )}
      </Section>

      {s.trim && <Trim t={s.trim} s={s} />}

      <Section title="Payload">
        {!s.freighter && <Line label="Passengers" sub={s.pax ? `${s.pax} × 84 kg` : undefined} value={fmtMass(s.pax * 84)} />}
        {!s.freighter && <Line label="Checked baggage" value={fmtMass(s.bagsKg)} />}
        <Line label={s.freighter ? 'Cargo (main deck and holds)' : 'Cargo and mail'} value={fmtMass(s.cargoKg)} />
        <Line label="Total payload" value={fmtMass(s.payloadKg)} strong />
      </Section>

      <p className="px-0.5 text-[11px] leading-relaxed text-fg-3">
        Simulated: estimated from public type data and standard planning rules (EASA standard masses, 5 % contingency, 30-minute reserve). Not an operational load or trim sheet.
      </p>
    </div>
  );
}
