// Airport comparison: two to four airports side by side — infrastructure, traffic,
// punctuality, network and weather — from the simulated world. Desktop shows a table;
// on phones each row becomes a card listing the airports under it.
import { useQuery } from '@tanstack/react-query';
import { Award, Plus, Search, X } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { searchAirports } from '@shared/airports';
import type { AirportIndexEntry } from '@shared/types';
import { AirportIcon } from '@/components/icons';
import { Badge } from '@/components/ui/Feedback';
import { Panel } from '@/components/ui/Sheet';
import { loadMajorAirports } from '@/data/airports';
import { simAirportSummary, useSim, type AirportSummary } from '@/data/world';
import { cn } from '@/lib/cn';
import { useNow } from '@/lib/hooks';
import { useIsMobile } from '@/lib/useMedia';
import { flyTo } from '@/map/controller';
import { useUI } from '@/state/ui';
import { AirlineLogo } from '@/features/aircraft/FlightParts';

type Better = 'high' | 'low' | null;

/** Indices of the best value(s) in a row; empty when there is nothing to choose between. */
export function bestIndices(values: (number | undefined)[], better: Better): Set<number> {
  const out = new Set<number>();
  if (!better) return out;
  const defined = values.filter((v): v is number => v !== undefined && Number.isFinite(v));
  if (defined.length < 2) return out;
  const best = better === 'high' ? Math.max(...defined) : Math.min(...defined);
  if (defined.every((v) => v === best)) return out;
  values.forEach((v, i) => {
    if (v === best) out.add(i);
  });
  return out;
}

interface Metric {
  id: string;
  label: string;
  value: (s: AirportSummary) => number | undefined;
  fmt?: (v: number) => string;
  sub?: (s: AirportSummary) => string | undefined;
  better: Better;
  /** Draw a thin bar: against 100 % ('pct') or against the row's largest value ('rel'). */
  bar?: 'pct' | 'rel';
}

interface Group {
  title: string;
  metrics: Metric[];
}

const shortTerminal = (n: string) => {
  const m = /^terminal\s*(\w+)$/i.exec(n.trim());
  return m ? `T${m[1]!.toUpperCase()}` : n.replace(/\s*terminal\s*/i, ' ').trim();
};

const GROUPS: Group[] = [
  {
    title: 'Infrastructure',
    metrics: [
      { id: 'runways', label: 'Runways', value: (s) => s.runways, sub: (s) => `in use ${s.runwayInUse}`, better: 'high' },
      { id: 'stands', label: 'Stands', value: (s) => s.stands || undefined, better: 'high' },
      {
        id: 'terminals',
        label: 'Terminals',
        value: (s) => s.terminals.length || undefined,
        sub: (s) => (s.terminals.length ? s.terminals.map(shortTerminal).slice(0, 5).join(' · ') + (s.terminals.length > 5 ? ' …' : '') : undefined),
        better: 'high',
      },
    ],
  },
  {
    title: 'Traffic',
    metrics: [
      { id: 'moves', label: 'Movements, last hour', value: (s) => s.movementsLastHour, better: 'high', bar: 'rel' },
      { id: 'arr', label: 'Arrivals, next 2 h', value: (s) => s.arrivalsNext2h, better: 'high', bar: 'rel' },
      { id: 'dep', label: 'Departures, next 2 h', value: (s) => s.departuresNext2h, better: 'high', bar: 'rel' },
      { id: 'hold', label: 'Holding now', value: (s) => s.holding, better: 'low' },
    ],
  },
  {
    title: 'Punctuality',
    metrics: [
      { id: 'ontime', label: 'On time, 7 days', value: (s) => s.onTime7d || undefined, fmt: (v) => `${v}%`, better: 'high', bar: 'pct' },
      { id: 'delay', label: 'Average delay, 7 days', value: (s) => (s.onTime7d ? s.avgDelay7d : undefined), fmt: (v) => `${v} min`, better: 'low', bar: 'rel' },
      { id: 'cxl', label: 'Cancellations today', value: (s) => s.canceledToday, better: 'low' },
    ],
  },
  {
    title: 'Network',
    metrics: [{ id: 'dest', label: 'Destinations now', value: (s) => s.destinations, better: 'high', bar: 'rel' }],
  },
];

const WX_TONE: Record<string, 'ok' | 'accent' | 'danger' | 'violet'> = { VFR: 'ok', MVFR: 'accent', IFR: 'danger', LIFR: 'violet' };

interface Column {
  ident: string;
  entry: AirportIndexEntry | undefined;
  s: AirportSummary | undefined;
}

export function AirportCompare() {
  useSim((s) => s.rev); // re-render when the simulation worker answers
  const open = useUI((s) => s.panel === 'airportCompare');
  const idents = useUI((s) => s.compareAirports);
  const setIdents = useUI((s) => s.setCompareAirports);
  const openPanel = useUI((s) => s.openPanel);
  const mobile = useIsMobile();
  const index = useQuery({ queryKey: ['major-airports'], queryFn: loadMajorAirports, staleTime: Infinity });
  const loading = useSim((s) => s.loading);
  const now = useNow(5000);
  const tick = Math.floor(now / 5000);
  const cols: Column[] = useMemo(() => {
    void tick; // re-read the simulation every 5 s
    const list = index.data;
    return idents.map((ident) => ({ ident, entry: list?.find((x) => x.ident === ident || x.icao === ident), s: open && !loading ? simAirportSummary(ident) : undefined }));
  }, [idents, index.data, open, loading, tick]);

  const remove = (ident: string) => setIdents(idents.filter((x) => x !== ident));
  const add = (ident: string) => setIdents([...idents, ident]);
  const width = Math.min(680, 300 + Math.max(2, cols.length) * 92);

  return (
    <Panel
      open={open}
      onClose={() => openPanel(null)}
      title="Compare airports"
      icon={<AirportIcon size={18} />}
      subtitle="Side by side · simulated traffic, updates every 5 s"
      ariaLabel="Airport comparison"
      width={width}
    >
      <div className="space-y-4 pt-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-[var(--line)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-2">Simulated</span>
          <span className="text-[11px] text-fg-3">{cols.length}/4 airports</span>
        </div>

        {cols.length < 4 && <AddAirport exclude={idents} onPick={add} list={index.data} />}

        {cols.length === 0 ? (
          <div className="glass-2 rounded-[16px] px-4 py-7 text-center">
            <AirportIcon size={20} className="mx-auto text-fg-3" />
            <p className="mt-2 text-[12.5px] font-medium text-fg-2">No airports to compare yet</p>
            <p className="mt-1 text-[11.5px] leading-snug text-fg-3">Search above, or use “Compare” on any airport page. Add two to four airports.</p>
          </div>
        ) : (
          <>
            {cols.length === 1 && <p className="glass-2 rounded-[14px] px-3.5 py-2.5 text-[12px] text-fg-2">Add at least one more airport to compare it with.</p>}
            {loading ? (
              <div className="skeleton h-72 rounded-[16px]" aria-hidden="true" />
            ) : mobile ? (
              <StackedView cols={cols} onRemove={remove} />
            ) : (
              <TableView cols={cols} onRemove={remove} />
            )}
          </>
        )}

        <p className="text-[11px] leading-relaxed text-fg-3">
          Everything here comes from the simulated world. Runways, stands and terminals come from OurAirports and OpenStreetMap; weather is the latest real METAR where available; the 7-day
          punctuality is modelled from today’s simulated traffic. The best value in each row is marked <Award size={11} className="inline align-[-1px] text-[var(--accent)]" aria-label="best" />.
        </p>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------- add / search

function AddAirport({ exclude, onPick, list }: { exclude: string[]; onPick: (ident: string) => void; list: Awaited<ReturnType<typeof loadMajorAirports>> | undefined }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(() => (list && q.trim().length >= 2 ? searchAirports(list, q, { limit: 8 }).filter((a) => !exclude.includes(a.ident)).slice(0, 6) : []), [list, q, exclude]);
  const pick = (a: AirportIndexEntry) => {
    onPick(a.ident);
    setQ('');
    setActive(0);
    input.current?.focus();
  };
  return (
    <div className="relative">
      <label className="glass-2 flex h-9 items-center gap-2 rounded-[11px] px-3 focus-within:border-[var(--line-strong)]">
        <Plus size={14} className="shrink-0 text-fg-3" aria-hidden="true" />
        <span className="sr-only">Add an airport</span>
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(results.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter' && results[active]) {
              e.preventDefault();
              pick(results[active]);
            } else if (e.key === 'Escape' && q) {
              e.stopPropagation();
              setQ('');
            }
          }}
          placeholder="Add an airport — IATA, ICAO, name or city"
          maxLength={40}
          spellCheck={false}
          autoComplete="off"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="compare-airport-results"
          aria-autocomplete="list"
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-3"
        />
        {!list && q.length >= 2 && <span className="text-[11px] text-fg-3">Loading…</span>}
        {q ? (
          <button type="button" onClick={() => setQ('')} aria-label="Clear search" className="text-fg-3 hover:text-fg">
            <X size={14} />
          </button>
        ) : (
          <Search size={14} className="text-fg-3" aria-hidden="true" />
        )}
      </label>
      {results.length > 0 && (
        <ul id="compare-airport-results" role="listbox" className="glass absolute inset-x-0 top-[calc(100%+6px)] z-20 overflow-hidden rounded-[14px] py-1 shadow-xl">
          {results.map((a, i) => (
            <li key={a.ident} role="option" aria-selected={i === active}>
              <button
                type="button"
                onPointerEnter={() => setActive(i)}
                onClick={() => pick(a)}
                className={cn('flex w-full items-center gap-3 px-3 py-2 text-left', i === active && 'bg-[var(--line)]')}
              >
                <span className="tnum w-10 shrink-0 text-[12.5px] font-semibold text-[var(--accent)]">{a.iata ?? a.ident}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{a.name}</span>
                <span className="shrink-0 truncate text-[11px] text-fg-3">{a.city}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- shared bits

const codeOf = (c: Column) => c.s?.airport.iata ?? c.entry?.iata ?? c.ident;
const cityOf = (c: Column) => c.s?.airport.city ?? c.entry?.city ?? c.s?.airport.name ?? c.entry?.name ?? '';

function openAirport(c: Column) {
  const lat = c.s?.airport.lat ?? c.entry?.lat;
  const lon = c.s?.airport.lon ?? c.entry?.lon;
  useUI.getState().selectAirport(c.ident);
  if (lat !== undefined && lon !== undefined) flyTo(lon, lat, 10.5);
}

function rowValues(m: Metric, cols: Column[]) {
  const values = cols.map((c) => (c.s ? m.value(c.s) : undefined));
  const best = bestIndices(values, m.better);
  const max = Math.max(1, ...values.filter((v): v is number => v !== undefined));
  return { values, best, max };
}

function Bar({ v, max, pct, best }: { v: number; max: number; pct: boolean; best: boolean }) {
  const w = Math.max(2, Math.min(100, pct ? v : (v / max) * 100));
  return (
    <span className="mt-1 block h-[4px] w-full overflow-hidden rounded-full bg-[var(--viz-grid)]" aria-hidden="true">
      <span className={cn('block h-full rounded-full', best ? 'bg-[var(--accent)]' : 'bg-[var(--viz-1)] opacity-80')} style={{ width: `${w}%` }} />
    </span>
  );
}

function BestMark() {
  return (
    <>
      <Award size={11} className="shrink-0 text-[var(--accent)]" aria-hidden="true" />
      <span className="sr-only">(best)</span>
    </>
  );
}

function Value({ m, c, v, best, max }: { m: Metric; c: Column; v: number | undefined; best: boolean; max: number }) {
  if (!c.s) return <span className="text-[12px] text-fg-3">Not simulated</span>;
  const sub = m.sub?.(c.s);
  const text = v === undefined ? '—' : m.fmt ? m.fmt(v) : v.toLocaleString();
  return (
    <span className="group/v relative block min-w-0" title={`${codeOf(c)} · ${m.label}: ${text}${sub ? ` (${sub})` : ''}`}>
      <span className={cn('tnum flex items-center gap-1 text-[13px] font-semibold', best ? 'text-[var(--accent)]' : v === undefined ? 'text-fg-3' : 'text-fg')}>
        {text}
        {best && <BestMark />}
      </span>
      {sub && <span className="tnum block truncate text-[10.5px] text-fg-3">{sub}</span>}
      {m.bar && v !== undefined && <Bar v={v} max={max} pct={m.bar === 'pct'} best={best} />}
    </span>
  );
}

function Airlines({ s, size }: { s: AirportSummary; size: number }) {
  if (!s.topAirlines.length) return <span className="text-[12px] text-fg-3">—</span>;
  return (
    <span className="flex flex-col gap-1">
      {s.topAirlines.slice(0, 3).map((al) => (
        <span key={al.icao} className="flex min-w-0 items-center gap-1.5" title={`${al.name}: ${al.flights} flights today`}>
          <AirlineLogo icao={al.icao} code={al.icao} size={size} name={al.name} wide />
          <span className="tnum truncate text-[11px] text-fg-2">{al.flights}</span>
        </span>
      ))}
    </span>
  );
}

function Weather({ s }: { s: AirportSummary }) {
  const w = s.weather;
  if (!w) return <span className="text-[12px] text-fg-3">No report</span>;
  return (
    <span className="flex min-w-0 flex-col items-start gap-1">
      {w.category && (
        <Badge tone={WX_TONE[w.category] ?? 'accent'} className="h-[19px] px-1.5 text-[10px]">
          {w.category}
        </Badge>
      )}
      <span className="tnum block text-[11.5px] leading-tight text-fg-2">
        {w.wind ?? 'Wind —'}
        {w.tempC !== undefined && <span className="block text-fg">{Math.round(w.tempC)}°C</span>}
        {w.wx && <span className="block truncate text-fg-3">{w.wx}</span>}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------- desktop table

function TableView({ cols, onRemove }: { cols: Column[]; onRemove: (ident: string) => void }) {
  const grid = { gridTemplateColumns: `minmax(104px, 1.1fr) repeat(${cols.length}, minmax(0, 1fr))` };
  const row = (key: string, label: ReactNode, cells: ReactNode[], best?: Set<number>) => (
    <div key={key} role="row" className="grid items-start gap-x-2 border-t border-[var(--line)] px-3 py-2" style={grid}>
      <span role="rowheader" className="pt-0.5 text-[11.5px] leading-snug text-fg-2">
        {label}
      </span>
      {cells.map((c, i) => (
        <span key={i} role="cell" className={cn('-mx-1 min-w-0 rounded-[8px] px-1 py-0.5', best?.has(i) && 'bg-[color-mix(in_srgb,var(--accent)_7%,transparent)]')}>
          {c}
        </span>
      ))}
    </div>
  );
  return (
    <div role="table" aria-label="Airport comparison" className="glass-2 overflow-clip rounded-[16px]">
      <div role="row" className="sticky top-0 z-10 grid items-end gap-x-2 bg-[color-mix(in_srgb,var(--surface-solid)_88%,transparent)] px-3 pb-2 pt-3 backdrop-blur-md" style={grid}>
        <span role="columnheader" className="eyebrow pb-0.5">
          Airport
        </span>
        {cols.map((c) => (
          <span key={c.ident} role="columnheader" className="group relative min-w-0">
            <button type="button" onClick={() => openAirport(c)} className="block min-w-0 max-w-full text-left" title={`Open ${c.s?.airport.name ?? c.entry?.name ?? c.ident}`}>
              <span className="tnum block text-[17px] font-semibold leading-tight tracking-[-0.01em] text-fg group-hover:text-[var(--accent)]">{codeOf(c)}</span>
              <span className="block truncate text-[10.5px] text-fg-3">{cityOf(c)}</span>
            </button>
            <button
              type="button"
              onClick={() => onRemove(c.ident)}
              aria-label={`Remove ${codeOf(c)}`}
              className="absolute right-0 top-0 grid size-5 place-items-center rounded-full text-fg-3 hover:bg-[var(--line)] hover:text-fg"
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      {GROUPS.map((g) => (
        <div key={g.title} role="rowgroup">
          <div className="eyebrow border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--line)_45%,transparent)] px-3 pb-1 pt-1.5">{g.title}</div>
          {g.metrics.map((m) => {
            const { values, best, max } = rowValues(m, cols);
            return row(
              m.id,
              m.label,
              cols.map((c, i) => <Value key={c.ident} m={m} c={c} v={values[i]} best={best.has(i)} max={max} />),
              best,
            );
          })}
          {g.title === 'Network' && row('airlines', 'Top airlines today', cols.map((c) => (c.s ? <Airlines key={c.ident} s={c.s} size={20} /> : <span key={c.ident} className="text-[12px] text-fg-3">—</span>)))}
        </div>
      ))}
      <div role="rowgroup">
        <div className="eyebrow border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--line)_45%,transparent)] px-3 pb-1 pt-1.5">Weather now</div>
        {row('wx', 'Category · wind · temperature', cols.map((c) => (c.s ? <Weather key={c.ident} s={c.s} /> : <span key={c.ident} className="text-[12px] text-fg-3">—</span>)))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- phone: stacked cards

function StackedView({ cols, onRemove }: { cols: Column[]; onRemove: (ident: string) => void }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {cols.map((c) => (
          <span key={c.ident} className="glass-2 inline-flex h-8 items-center gap-1 rounded-full pl-3 pr-1">
            <button type="button" onClick={() => openAirport(c)} className="tnum text-[12.5px] font-semibold text-fg">
              {codeOf(c)} <span className="font-normal text-fg-3">{cityOf(c)}</span>
            </button>
            <button type="button" onClick={() => onRemove(c.ident)} aria-label={`Remove ${codeOf(c)}`} className="grid size-6 place-items-center rounded-full text-fg-3 hover:bg-[var(--line)] hover:text-fg">
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      {GROUPS.map((g) => (
        <section key={g.title} className="space-y-2">
          <h3 className="eyebrow px-0.5">{g.title}</h3>
          {g.metrics.map((m) => {
            const { values, best, max } = rowValues(m, cols);
            return (
              <div key={m.id} className="glass-2 rounded-[14px] px-3 py-2.5">
                <div className="mb-1.5 text-[11.5px] font-medium text-fg-2">{m.label}</div>
                <ul className="space-y-1.5">
                  {cols.map((c, i) => (
                    <li key={c.ident} className={cn('-mx-1.5 flex items-start gap-2.5 rounded-[8px] px-1.5 py-0.5', best.has(i) && 'bg-[color-mix(in_srgb,var(--accent)_7%,transparent)]')}>
                      <span className="tnum w-9 shrink-0 pt-px text-[12px] font-semibold text-fg-2">{codeOf(c)}</span>
                      <span className="min-w-0 flex-1">
                        <Value m={m} c={c} v={values[i]} best={best.has(i)} max={max} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {g.title === 'Network' && (
            <div className="glass-2 rounded-[14px] px-3 py-2.5">
              <div className="mb-1.5 text-[11.5px] font-medium text-fg-2">Top airlines today</div>
              <ul className="space-y-2">
                {cols.map((c) => (
                  <li key={c.ident} className="flex items-start gap-2.5">
                    <span className="tnum w-9 shrink-0 pt-0.5 text-[12px] font-semibold text-fg-2">{codeOf(c)}</span>
                    {c.s ? (
                      <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
                        {c.s.topAirlines.slice(0, 3).map((al) => (
                          <span key={al.icao} className="flex items-center gap-1.5" title={al.name}>
                            <AirlineLogo icao={al.icao} code={al.icao} size={18} name={al.name} wide />
                            <span className="tnum text-[11px] text-fg-2">{al.flights}</span>
                          </span>
                        ))}
                        {!c.s.topAirlines.length && <span className="text-[12px] text-fg-3">—</span>}
                      </span>
                    ) : (
                      <span className="text-[12px] text-fg-3">Not simulated</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ))}
      <section className="space-y-2">
        <h3 className="eyebrow px-0.5">Weather now</h3>
        <div className="glass-2 grid grid-cols-2 gap-3 rounded-[14px] px-3 py-2.5">
          {cols.map((c) => (
            <div key={c.ident} className="min-w-0">
              <div className="tnum mb-1 text-[12px] font-semibold text-fg-2">{codeOf(c)}</div>
              {c.s ? <Weather s={c.s} /> : <span className="text-[12px] text-fg-3">—</span>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
