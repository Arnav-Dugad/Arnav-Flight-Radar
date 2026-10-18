// Aircraft type page (airliners.net / FR24 style): representative photo, key
// specifications, a typical cabin and how the type is used in the simulated world.
import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { useMemo, useState, type ReactNode } from 'react';
import type { AircraftClass } from '@shared/classify';
import { AircraftGlyph } from '@/components/icons';
import { Tabs } from '@/components/ui/Data';
import { EmptyState } from '@/components/ui/Feedback';
import { IconButton } from '@/components/ui/Glass';
import { Panel } from '@/components/ui/Sheet';
import { cabinFor, type CabinLayout, type SeatClass } from '@/data/sim/cabin';
import type { Recat, Wake } from '@/data/sim/refTypes';
import { specOf, type TypeSpec } from '@/data/sim/typeSpecs';
import { simTypeStats, type TypeStats, useSim } from '@/data/world';
import { RepresentativePhoto } from '@/features/aircraft/AircraftPhoto';
import { AirlineLogo, STATUS_TEXT } from '@/features/aircraft/FlightParts';
import { MakerLogo } from '@/features/aircraft/MakerLogo';
import { SeatMap } from '@/features/aircraft/SeatMap';
import { cn } from '@/lib/cn';
import { useNow } from '@/lib/hooks';
import { focusAircraft } from '@/map/controller';
import { useSettings } from '@/state/settings';
import { useUI } from '@/state/ui';

type Tab = 'specs' | 'cabin' | 'sim';
type CabinModel = 'full' | 'low';

const ROLE_LABEL: Record<TypeSpec['role'], string> = {
  airliner: 'Airliner',
  freighter: 'Freighter',
  bizjet: 'Business jet',
  ga: 'General aviation',
  helicopter: 'Helicopter',
  'military-transport': 'Military transport',
  tanker: 'Tanker',
  fighter: 'Fighter',
  patrol: 'Maritime patrol',
  awacs: 'Airborne early warning',
  trainer: 'Trainer',
  glider: 'Glider',
  utility: 'Utility',
};

const WAKE_LABEL: Record<Wake, string> = {
  J: 'Super',
  H: 'Heavy',
  M: 'Medium',
  L: 'Light',
};
const RECAT_LABEL: Record<Recat, string> = {
  A: 'Super Heavy',
  B: 'Upper Heavy',
  C: 'Lower Heavy',
  D: 'Upper Medium',
  E: 'Lower Medium',
  F: 'Light',
};
const ENGINE_KIND: Record<TypeSpec['engines']['kind'], string> = {
  jet: 'Turbofan',
  turboprop: 'Turboprop',
  piston: 'Piston',
  turboshaft: 'Turboshaft',
  none: 'Unpowered',
};
const CLASS_NAME: Record<SeatClass, string> = {
  F: 'First',
  J: 'Business',
  W: 'Premium',
  Y: 'Economy',
};
const CLASS_DOT: Record<SeatClass, string> = {
  F: 'bg-[var(--viz-2)]',
  J: 'bg-[var(--accent)]',
  W: 'bg-[var(--viz-3)]',
  Y: 'bg-[var(--fg-3)]',
};

/** Map-symbol class for a type (used for its glyph). */
function glyphClass(s: TypeSpec): AircraftClass {
  if (s.role === 'helicopter' || s.shape === 'heli') return 'helicopter';
  if (s.role === 'glider') return 'glider';
  if (['fighter', 'tanker', 'awacs', 'patrol', 'military-transport', 'trainer'].includes(s.role) && s.shape !== 'narrow' && s.shape !== 'wide-twin') return 'military';
  if (s.role === 'bizjet') return 'bizjet';
  switch (s.shape) {
    case 'wide-twin':
    case 'tri-jet':
    case 'quad':
    case 'b747':
    case 'a380':
    case 'awacs':
      return 'widebody';
    case 'narrow':
      return s.seatsTypical > 0 && s.seatsTypical < 110 ? 'regional' : 'narrowbody';
    case 'rear-jet':
      return 'regional';
    case 'high-turboprop':
    case 'low-turboprop':
    case 'high-quad-turboprop':
      return 'turboprop';
    case 'high-jet-quad':
      return 'military';
    case 'single-high':
    case 'single-low':
    case 'single-turboprop':
      return 'light';
    default:
      return 'unknown';
  }
}

const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const n0 = (v: number) => nf.format(v);
const t = (kg: number) => (kg >= 10_000 ? `${nf1.format(kg / 1000)} t` : `${n0(kg)} kg`);
const lb = (kg: number) => `${n0(Math.round((kg * 2.20462) / 100) * 100)} lb`;
const ft = (m: number) => `${n0(m * 3.28084)} ft`;

interface Cell {
  label: string;
  value: ReactNode;
  sub?: ReactNode | undefined;
  wide?: boolean;
}

function SpecGroup({ title, cells }: { title: string; cells: (Cell | null)[] }) {
  const list = cells.filter((c): c is Cell => !!c);
  // Lay out the two-column grid ourselves so hairlines sit only between cells.
  let col = 0;
  let row = 0;
  const placed = list.map((c) => {
    if (c.wide && col === 1) {
      col = 0;
      row++;
    }
    const at = { c, col, row };
    if (c.wide || col === 1) {
      col = 0;
      row++;
    } else col = 1;
    return at;
  });
  return (
    <section className="space-y-1.5">
      <h3 className="eyebrow px-0.5">{title}</h3>
      <dl className="glass-2 grid grid-cols-2 overflow-hidden rounded-[16px]">
        {placed.map(({ c, col: x, row: y }) => (
          <div key={c.label} className={cn('min-w-0 border-[var(--line)] px-3.5 py-2.5', c.wide ? 'col-span-2' : x === 0 && 'border-r', y > 0 && 'border-t')}>
            <dt className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-fg-3">{c.label}</dt>
            <dd className="tnum mt-0.5 truncate text-[13.5px] font-semibold text-fg">{c.value}</dd>
            {c.sub && <dd className="tnum truncate text-[11px] text-fg-3">{c.sub}</dd>}
          </div>
        ))}
        {col === 1 && <div aria-hidden="true" className={cn('border-[var(--line)]', row > 0 && 'border-t')} />}
      </dl>
    </section>
  );
}

function Specs({ s }: { s: TypeSpec }) {
  const heli = s.role === 'helicopter';
  const glider = s.role === 'glider';
  const powered = s.engines.kind !== 'none' && s.engines.count > 0;
  const m = (v: number) => ({ value: `${nf1.format(v)} m`, sub: ft(v) });
  const w = (kg: number) => (kg > 0 ? { value: t(kg), sub: lb(kg) } : { value: '—' });
  return (
    <div className="space-y-4">
      <SpecGroup
        title="Dimensions & capacity"
        cells={[
          { label: 'Length', ...m(s.lengthM) },
          { label: heli ? 'Rotor diameter' : 'Wingspan', ...m(s.spanM) },
          { label: 'Height', ...m(s.heightM) },
          {
            label: 'Seats',
            value: s.seatsTypical > 0 ? `${n0(s.seatsTypical)} typical` : s.role === 'freighter' ? 'Freighter' : '—',
            sub: s.seatsMax > 0 ? `${n0(s.seatsMax)} maximum` : undefined,
          },
        ]}
      />
      <SpecGroup
        title="Weights"
        cells={[
          { label: 'Max take-off', ...w(s.mtowKg) },
          { label: 'Max landing', ...w(s.mlwKg) },
          { label: 'Empty weight', ...w(s.oewKg) },
          { label: 'Max fuel', ...w(s.maxFuelKg) },
          { label: 'Max payload', ...w(s.maxPayloadKg) },
          s.burnKgH > 0
            ? {
                label: 'Cruise fuel burn',
                value: `${t(s.burnKgH)}/h`,
                sub: lb(s.burnKgH) + '/h',
              }
            : null,
        ]}
      />
      <SpecGroup
        title="Performance"
        cells={[
          {
            label: glider ? 'Cross-country' : 'Range',
            value: `${n0(s.rangeNm)} NM`,
            sub: `${n0(Math.round((s.rangeNm * 1.852) / 10) * 10)} km`,
          },
          {
            label: 'Ceiling',
            value: `${n0(s.ceilingFt)} ft`,
            sub: `${n0(Math.round((s.ceilingFt * 0.3048) / 10) * 10)} m`,
          },
          s.cruiseMach
            ? {
                label: 'Typical cruise',
                value: `Mach ${s.cruiseMach.toFixed(2)}`,
                sub: s.mmo ? `Mmo ${s.mmo.toFixed(2)}` : undefined,
              }
            : null,
          s.vrKt > 0
            ? {
                label: glider ? 'Launch release' : 'Rotation (Vr)',
                value: `${s.vrKt} kt`,
                sub: 'typical',
              }
            : null,
          {
            label: heli ? 'Approach' : 'Approach (Vapp)',
            value: `${s.vappKt} kt`,
            sub: 'typical',
          },
        ]}
      />
      <SpecGroup
        title="Engines & classification"
        cells={[
          {
            label: 'Engines',
            wide: true,
            value: powered ? `${s.engines.count} × ${s.engines.name}` : 'None (unpowered)',
            sub: powered ? `${ENGINE_KIND[s.engines.kind]}${s.engines.mount !== 'none' ? ` · ${s.engines.mount}-mounted` : ''}` : undefined,
          },
          {
            label: 'ICAO wake',
            value: WAKE_LABEL[s.wake],
            sub: `Category ${s.wake}`,
          },
          {
            label: 'RECAT-EU',
            value: `CAT ${s.recat}`,
            sub: RECAT_LABEL[s.recat],
          },
          {
            label: 'First flight',
            value: String(s.firstFlight),
            sub: s.family ? `${s.family}` : undefined,
          },
          { label: 'ICAO designator', value: s.code, sub: s.maker },
        ]}
      />
    </div>
  );
}

function Cabin({ s }: { s: TypeSpec }) {
  const [model, setModel] = useState<CabinModel>('full');
  const layouts = useMemo(() => ({ full: cabinFor(s.code, 'full'), low: cabinFor(s.code, 'low') }), [s.code]);
  const differ = !!layouts.full && !!layouts.low && (layouts.full.seats !== layouts.low.seats || layouts.full.byClass.J !== layouts.low.byClass.J);
  const layout: CabinLayout | null = (differ ? layouts[model] : null) ?? layouts.full ?? layouts.low;
  if (!layout) return null;
  const classes = (['F', 'J', 'W', 'Y'] as const).filter((c) => layout.byClass[c] > 0);
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="eyebrow px-0.5">Typical cabin</h3>
        {differ && (
          <div role="radiogroup" aria-label="Airline type" className="glass-2 flex rounded-full p-0.5">
            {(['full', 'low'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={model === m}
                onClick={() => setModel(m)}
                className={cn('relative h-7 rounded-full px-3 text-[11.5px] font-medium transition-colors', model === m ? 'text-fg' : 'text-fg-3 hover:text-fg-2')}
              >
                {model === m && (
                  <motion.span layoutId={`cabin-model-${s.code}`} className="absolute inset-0 rounded-full bg-[var(--line-strong)]" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />
                )}
                <span className="relative">{m === 'full' ? 'Full-service' : 'Low-cost'}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="glass-2 rounded-[16px] px-3.5 py-3">
        <div className="flex items-baseline justify-between">
          <span className="tnum text-[22px] font-semibold leading-none tracking-[-0.02em] text-fg">{layout.seats}</span>
          <span className="text-[11px] text-fg-3">seats · {classes.length === 1 ? 'single class' : `${classes.length} classes`}</span>
        </div>
        <div className="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-[var(--line)]">
          {classes.map((c) => (
            <span key={c} className={cn('h-full', CLASS_DOT[c])} style={{ width: `${(layout.byClass[c] / layout.seats) * 100}%` }} />
          ))}
        </div>
        <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
          {classes.map((c) => (
            <li key={c} className="flex items-center gap-1.5 text-[11.5px] text-fg-2">
              <span aria-hidden="true" className={cn('size-2 rounded-full', CLASS_DOT[c])} />
              {layout.seats <= 9 && c === 'Y' ? 'Cabin' : CLASS_NAME[c]}
              <span className="tnum font-semibold text-fg">{layout.byClass[c]}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="glass-2 rounded-[16px] px-2 py-4">
        <SeatMap layout={layout} occupancy={0.8} seed={7} />
      </div>
      <p className="text-[11px] leading-snug text-fg-3">
        A representative {differ ? (model === 'full' ? 'full-service' : 'low-cost') : ''} layout, not any one airline&rsquo;s. Occupancy is illustrative.
      </p>
    </section>
  );
}

function InSim({ stats }: { stats: TypeStats | undefined }) {
  const select = useUI((s) => s.select);
  const selectAirline = useUI((s) => s.selectAirline);
  const [all, setAll] = useState(false);
  if (!stats) return <EmptyState title="Simulation not running" body="Start the simulated world to see where this type is flying." />;
  if (!stats.airframes) return <EmptyState title="Not in today’s simulation" body="No simulated operator flies this type right now." />;
  const ops = all ? stats.operators : stats.operators.slice(0, 6);
  const max = stats.operators[0]?.count ?? 1;
  return (
    <div className="space-y-4">
      <section className="space-y-1.5">
        <div className="flex items-center justify-between px-0.5">
          <h3 className="eyebrow">Top operators</h3>
          <span className="text-[11px] text-fg-3">{stats.operators.length} total</span>
        </div>
        <ul className="glass-2 divide-y divide-[var(--line)] overflow-hidden rounded-[16px]">
          {ops.map((o) => {
            const body = (
              <>
                {o.airline ? (
                  <AirlineLogo icao={o.icao} code={o.icao} size={24} name={o.name} wide />
                ) : (
                  <span className="grid h-6 w-[53px] shrink-0 place-items-center rounded-[7px] bg-[var(--line)] text-[9.5px] font-bold tracking-[0.04em] text-fg-2">{o.icao.slice(0, 3)}</span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 text-[12.5px]">
                    <span className="truncate font-semibold text-fg">{o.name}</span>
                    <span className="tnum shrink-0 text-fg-2">{o.count}</span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-[var(--line)]">
                    <div
                      className="h-1 rounded-full bg-[var(--viz-1)]"
                      style={{
                        width: `${Math.max(3, (o.count / max) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </>
            );
            return (
              <li key={o.icao}>
                {o.airline ? (
                  <button type="button" onClick={() => selectAirline(o.icao)} title={`Open ${o.name}`} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-[var(--line)]">
                    {body}
                  </button>
                ) : (
                  <div className="flex items-center gap-3 px-3.5 py-2.5">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
        {stats.operators.length > 6 && (
          <button type="button" onClick={() => setAll((v) => !v)} className="px-0.5 text-[11.5px] font-medium text-[var(--accent)] hover:underline">
            {all ? 'Show fewer' : `Show all ${stats.operators.length} operators`}
          </button>
        )}
      </section>
      <section className="space-y-1.5">
        <div className="flex items-center justify-between px-0.5">
          <h3 className="eyebrow">Transmitting now</h3>
          <span className="tnum text-[11px] text-fg-3">{stats.flights.length >= 60 ? 'first 60' : stats.flights.length}</span>
        </div>
        {stats.flights.length ? (
          <ul className="glass-2 divide-y divide-[var(--line)] overflow-hidden rounded-[16px]">
            {stats.flights.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => {
                    select(f.id);
                    focusAircraft(f.id, 8);
                  }}
                  className="flex w-full items-center gap-3 px-3.5 py-2 text-left hover:bg-[var(--line)]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="tnum truncate text-[12.5px] font-semibold text-fg">
                      {f.flight}{' '}
                      <span className="font-normal text-fg-2">
                        {f.from.iata ?? f.from.ident} → {f.to.iata ?? f.to.ident}
                      </span>
                    </div>
                    <div className="tnum truncate text-[10.5px] text-fg-3">
                      {f.reg} · {f.from.city ?? f.from.name} to {f.to.city ?? f.to.name}
                    </div>
                  </div>
                  <span className={cn('shrink-0 text-[11px] font-semibold', STATUS_TEXT[f.status])}>{f.status}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="glass-2 rounded-[16px] px-3.5 py-3 text-[12px] text-fg-3">None of these aircraft is transmitting at the moment.</p>
        )}
      </section>
    </div>
  );
}

export function TypePanel() {
  useSim((s) => s.rev); // re-render when the simulation worker answers
  const open = useUI((s) => s.panel === 'type');
  const code = useUI((s) => s.selectedType);
  const openPanel = useUI((s) => s.openPanel);
  const showPhotos = useSettings((s) => s.showPhotos);
  useNow(5000);
  const [tab, setTab] = useState<Tab>('specs');
  const spec = code ? specOf(code) : undefined;
  const hasCabin = useMemo(() => !!spec && !!(cabinFor(spec.code, 'full') ?? cabinFor(spec.code, 'low')), [spec]);
  const stats = (open && spec ? simTypeStats(spec.code) : undefined);
  const current: Tab = tab === 'cabin' && !hasCabin ? 'specs' : tab;
  const name = spec ? `${spec.maker} ${spec.model}` : 'Aircraft type';
  const close = () => openPanel(null);

  return (
    <Panel open={open} onClose={close} title={name} ariaLabel="Aircraft type details" bare>
      <div className="flex min-h-full flex-col">
        <div className="relative">
          {showPhotos && spec ? <RepresentativePhoto key={spec.code} hero type={spec.code} typeName={name} /> : null}
          {!(showPhotos && spec) && <div className="h-12" />}
          <IconButton label="Close" shortcut="Esc" onClick={close} size={34} variant="glass" className="!absolute right-3 top-3">
            <X size={17} />
          </IconButton>
        </div>
        {!spec ? (
          <div className="px-5 py-6">
            <EmptyState title="Type not found" body="This aircraft type is not in the simulation’s reference data." />
          </div>
        ) : (
          <div className="flex-1 space-y-4 px-5 pb-5 pt-4">
            <div>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid size-11 shrink-0 place-items-center rounded-[13px] glass-2 text-[var(--accent)]">
                  <AircraftGlyph cls={glyphClass(spec)} size={30} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex min-h-5 items-center gap-1.5 text-[11.5px] font-medium text-fg-3">
                    <MakerLogo maker={spec.maker} size={20} maxWidth={84} />
                    <span>{spec.maker}</span>
                  </p>
                  <motion.h2 key={spec.code} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="text-[24px] font-semibold leading-[1.05] tracking-[-0.03em] text-fg">
                    {spec.model}
                  </motion.h2>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span
                  className="tnum rounded-[7px] bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] px-2 py-0.5 font-mono text-[11.5px] font-semibold tracking-[0.04em] text-[var(--accent)]"
                  title="ICAO type designator"
                >
                  {spec.code}
                </span>
                {spec.family && <span className="rounded-full bg-[var(--line)] px-2 py-0.5 text-[11px] font-medium text-fg-2">{spec.family}</span>}
                <span className="rounded-full bg-[var(--line)] px-2 py-0.5 text-[11px] font-medium text-fg-2">{ROLE_LABEL[spec.role]}</span>
                <span className="rounded-full bg-[var(--line)] px-2 py-0.5 text-[11px] font-medium text-fg-2" title="ICAO wake turbulence category">
                  {WAKE_LABEL[spec.wake]} wake
                </span>
              </div>
              <p className="mt-3 text-[12.5px] leading-relaxed text-fg-2">{spec.blurb}</p>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              {(
                [
                  ['Airborne now', stats ? n0(stats.airborne) : '—'],
                  ['Sim airframes', stats ? n0(stats.airframes) : '—'],
                  ['Range', `${n0(spec.rangeNm)} NM`],
                ] as const
              ).map(([l, v]) => (
                <div key={l} className="glass-2 rounded-[14px] px-1.5 py-2.5">
                  <div className="tnum truncate text-[18px] font-semibold text-fg">{v}</div>
                  <div className="mt-0.5 text-[10.5px] text-fg-3">{l}</div>
                </div>
              ))}
            </div>

            <Tabs
              label="Aircraft type information"
              value={current}
              onChange={setTab}
              tabs={[{ id: 'specs', label: 'Specifications' }, ...(hasCabin ? [{ id: 'cabin' as const, label: 'Cabin' }] : []), { id: 'sim', label: 'In the simulation' }]}
            />
            {current === 'specs' && <Specs s={spec} />}
            {current === 'cabin' && <Cabin key={spec.code} s={spec} />}
            {current === 'sim' && <InSim stats={stats} />}

            <p className="border-t border-[var(--line)] pt-3 text-[11px] leading-snug text-fg-3">Specifications are rounded public figures. Operators and flights shown are simulated.</p>
          </div>
        )}
      </div>
    </Panel>
  );
}
