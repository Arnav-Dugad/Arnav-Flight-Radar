// "Where can I fly from here?" (lazy chunk of the airport panel): every destination of the
// airport's SIMULATED route network — busiest first or grouped by region and country, with
// an airline filter and search — and great-circle arcs to all of them on the map.
import { useQuery } from '@tanstack/react-query';
import { Map as MapIcon, Route, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AirportDetail, Country } from '@shared/types';
import { SegmentedControl, Toggle } from '@/components/ui/Controls';
import { EmptyState, Skeleton } from '@/components/ui/Feedback';
import { loadCountries } from '@/data/airports';
import { simAirportRoutes, type RouteDest } from '@/data/world';
import { cn } from '@/lib/cn';
import { fmtDistance } from '@/lib/format';
import { useSettings } from '@/state/settings';
import { useUI, type AirportOverlayDest } from '@/state/ui';
import { AirlineLogo } from '@/features/aircraft/FlightParts';

export const CONTINENT: Record<string, string> = { EU: 'Europe', AS: 'Asia', NA: 'North America', SA: 'South America', AF: 'Africa', OC: 'Oceania', AN: 'Antarctica' };

/** Destinations matching a search (code, city, name or country) and an airline (ICAO). */
export function filterRoutes(list: RouteDest[], opts: { query?: string; airline?: string | null; countryName?: (code: string) => string }): RouteDest[] {
  const q = (opts.query ?? '').trim().toLowerCase();
  return list.filter((d) => {
    if (opts.airline && !d.airlines.some((x) => x.icao === opts.airline)) return false;
    if (!q) return true;
    const a = d.airport;
    return [a.iata, a.ident, a.city, a.name, a.country, opts.countryName?.(a.country)].some((s) => s && s.toLowerCase().includes(q));
  });
}

export interface RouteGroup {
  key: string;
  label: string;
  perWeek: number;
  countries: { code: string; name: string; perWeek: number; dests: RouteDest[] }[];
}

/** Region (continent) → country → destinations, each level sorted by weekly flights. */
export function groupRoutes(list: RouteDest[], countries: Pick<Country, 'code' | 'name' | 'continent'>[]): RouteGroup[] {
  const byCode = new Map(countries.map((c) => [c.code, c]));
  const groups = new Map<string, RouteGroup>();
  for (const d of list) {
    const c = byCode.get(d.airport.country);
    const key = c?.continent ?? '??';
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, label: CONTINENT[key] ?? 'Other', perWeek: 0, countries: [] }));
    g.perWeek += d.perWeek;
    let cc = g.countries.find((x) => x.code === d.airport.country);
    if (!cc) g.countries.push((cc = { code: d.airport.country, name: c?.name ?? d.airport.country, perWeek: 0, dests: [] }));
    cc.perWeek += d.perWeek;
    cc.dests.push(d);
  }
  const out = [...groups.values()].sort((x, y) => y.perWeek - x.perWeek);
  for (const g of out) {
    g.countries.sort((x, y) => y.perWeek - x.perWeek);
    for (const c of g.countries) c.dests.sort((x, y) => y.perWeek - x.perWeek);
  }
  return out;
}

/** Airlines serving the network, busiest (most destinations) first. */
export function routeAirlines(list: RouteDest[]): { icao: string; name: string; dests: number }[] {
  const m = new Map<string, { icao: string; name: string; dests: number }>();
  for (const d of list)
    for (const a of d.airlines) {
      const e = m.get(a.icao);
      if (e) e.dests++;
      else m.set(a.icao, { icao: a.icao, name: a.name, dests: 1 });
    }
  return [...m.values()].sort((x, y) => y.dests - x.dests || x.name.localeCompare(y.name));
}

const code = (d: RouteDest) => d.airport.iata ?? d.airport.ident;

function DestRow({ d, max, onPick, onHover }: { d: RouteDest; max: number; onPick: (d: RouteDest) => void; onHover: (ident: string | null) => void }) {
  const unit = useSettings((s) => s.units.distance);
  const pct = Math.max(4, Math.round((d.perWeek / max) * 100));
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(d)}
        onPointerEnter={() => onHover(d.airport.ident)}
        onPointerLeave={() => onHover(null)}
        onFocus={() => onHover(d.airport.ident)}
        onBlur={() => onHover(null)}
        className="group flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--line)] focus-visible:bg-[var(--line)]"
      >
        <span className="tnum w-9 shrink-0 text-[12.5px] font-semibold text-[var(--accent)]">{code(d)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-fg">{d.airport.city ?? d.airport.name}</span>
          <span className="tnum mt-0.5 flex items-center gap-1.5 text-[10.5px] text-fg-3">
            <span className="truncate">
              {d.airlines
                .slice(0, 2)
                .map((x) => x.name)
                .join(', ')}
              {d.airlines.length > 2 ? ` +${d.airlines.length - 2}` : ''}
            </span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">{fmtDistance(d.distNm, unit)}</span>
          </span>
        </span>
        <span className="flex w-[74px] shrink-0 flex-col items-end gap-1">
          <span className="tnum text-[11.5px] font-semibold text-fg">
            {d.perWeek}
            <span className="font-normal text-fg-3">/wk</span>
          </span>
          <span className="h-1 w-full overflow-hidden rounded-full bg-[var(--line)]" aria-hidden="true">
            <span className="block h-full rounded-full bg-[var(--accent)] opacity-80" style={{ width: `${pct}%` }} />
          </span>
        </span>
      </button>
    </li>
  );
}

export function AirportRoutes({ a }: { a: AirportDetail }) {
  const routes = simAirportRoutes(a.ident);
  const countries = useQuery({ queryKey: ['countries'], queryFn: loadCountries, staleTime: Infinity });
  const [query, setQuery] = useState('');
  const [airline, setAirline] = useState<string | null>(null);
  const [view, setView] = useState<'busiest' | 'region'>('busiest');
  const [onMap, setOnMap] = useState(true);
  const [focus, setFocus] = useState<string | null>(null);
  const [limit, setLimit] = useState(60);
  const selectAirport = useUI((s) => s.selectAirport);
  const setOverlay = useUI((s) => s.setAirportOverlay);

  const countryList = countries.data ?? [];
  const countryName = (c: string) => countryList.find((x) => x.code === c)?.name ?? c;
  const all = routes ?? [];
  const list = filterRoutes(all, { query, airline, countryName });
  const airlines = routeAirlines(all);

  // ---------------------------------------------------------------- map overlay
  const dests = useRef<AirportOverlayDest[]>([]);
  dests.current = list.map((d) => ({ ident: d.airport.ident, code: code(d), name: d.airport.city ?? d.airport.name, lon: d.airport.lon, lat: d.airport.lat, perWeek: d.perWeek }));
  const key = onMap && routes ? `${a.ident}|${focus ?? ''}|${dests.current.map((d) => `${d.ident}${d.perWeek}`).join(',')}` : '';
  // Re-frame the map when the network first arrives or the airline filter changes (not while typing or hovering).
  const fitKey = `${a.ident}|${airline ?? ''}|${onMap}`;
  useEffect(() => {
    if (!key) {
      setOverlay(null);
      return;
    }
    setOverlay({ kind: 'routes', airport: a.ident, origin: [a.lon, a.lat], dests: dests.current, focus, fit: fitKey });
  }, [key, fitKey, a.ident, a.lon, a.lat, focus, setOverlay]);
  useEffect(
    () => () => {
      const o = useUI.getState().airportOverlay;
      if (o?.kind === 'routes') useUI.getState().setAirportOverlay(null);
    },
    [],
  );

  if (!routes)
    return (
      <div className="space-y-2.5" aria-busy="true" aria-label="Loading the route network">
        <Skeleton className="h-16 rounded-[16px]" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-11 rounded-[12px]" />
        ))}
      </div>
    );
  if (!all.length)
    return (
      <EmptyState
        icon={<Route size={20} />}
        title="No scheduled routes"
        body="No simulated airline serves this airport today. Larger airports in the simulated world have a full network."
      />
    );

  const totalWeek = all.reduce((s, d) => s + d.perWeek, 0);
  const nCountries = new Set(all.map((d) => d.airport.country)).size;
  const max = Math.max(...list.map((d) => d.perWeek), 1);
  const pick = (d: RouteDest) => selectAirport(d.airport.ident);
  const flat = list.slice(0, limit);
  const groups = view === 'region' ? groupRoutes(list, countryList) : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--line)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-2">
          <Route size={11} aria-hidden="true" /> Simulated network
        </span>
        <span className="text-[11px] text-fg-3">Not a real timetable</span>
      </div>

      <dl className="grid grid-cols-3 gap-2">
        {[
          ['Destinations', all.length],
          ['Countries', nCountries],
          ['Flights / week', totalWeek.toLocaleString('en-GB')],
        ].map(([k, v]) => (
          <div key={k} className="glass-2 rounded-[14px] px-3 py-2.5">
            <dt className="text-[10.5px] font-medium text-fg-3">{k}</dt>
            <dd className="tnum mt-1 text-[17px] font-semibold leading-none text-fg">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="space-y-2">
        <div className="glass-2 flex h-9 items-center gap-2 rounded-[11px] px-3 focus-within:border-[var(--line-strong)]">
          <Search size={14} className="shrink-0 text-fg-3" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(60);
            }}
            placeholder="Search city, airport or country"
            aria-label="Search destinations"
            spellCheck={false}
            autoComplete="off"
            maxLength={40}
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-fg-3"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="grid size-6 place-items-center rounded-full text-fg-3 hover:bg-[var(--line)] hover:text-fg">
              <X size={13} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="glass-2 flex h-8 min-w-0 flex-1 items-center rounded-[10px] pl-2.5 pr-1 text-[12px] text-fg-2">
            <span className="sr-only">Filter by airline</span>
            <select
              value={airline ?? ''}
              onChange={(e) => setAirline(e.target.value || null)}
              className="h-full min-w-0 flex-1 cursor-pointer bg-transparent text-[12px] font-medium text-fg outline-none [&>option]:bg-[var(--surface-solid)]"
            >
              <option value="">All airlines ({airlines.length})</option>
              {airlines.map((x) => (
                <option key={x.icao} value={x.icao}>
                  {x.name} · {x.dests}
                </option>
              ))}
            </select>
          </label>
          <SegmentedControl
            size="sm"
            label="Order destinations"
            value={view}
            onChange={setView}
            options={[
              { value: 'busiest', label: 'Busiest' },
              { value: 'region', label: 'By region' },
            ]}
          />
        </div>
        {airline && (
          <div className="flex items-center gap-2 px-0.5 text-[11.5px] text-fg-2">
            <AirlineLogo icao={airline} code={airline.slice(0, 2)} size={18} name={airlines.find((x) => x.icao === airline)?.name} />
            <span className="min-w-0 flex-1 truncate">
              {list.length} destination{list.length === 1 ? '' : 's'} on {airlines.find((x) => x.icao === airline)?.name ?? airline}
            </span>
            <button type="button" onClick={() => setAirline(null)} className="shrink-0 font-semibold text-[var(--accent)] hover:underline">
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="glass-2 rounded-[14px] px-3.5 py-2.5">
        <Toggle checked={onMap} onChange={setOnMap} label={<span className="inline-flex items-center gap-1.5"><MapIcon size={13} aria-hidden="true" /> Draw routes on the map</span>} description="Great-circle arcs, thicker for more flights a week. Click a destination to open it." />
      </div>

      {!list.length ? (
        <p className="glass-2 rounded-[14px] px-3.5 py-4 text-center text-[12px] text-fg-3">No destination matches{query ? ` “${query}”` : ''}.</p>
      ) : view === 'busiest' ? (
        <>
          <ul className="glass-2 divide-y divide-[var(--line)] overflow-hidden rounded-[16px]">
            {flat.map((d) => (
              <DestRow key={d.airport.ident} d={d} max={max} onPick={pick} onHover={setFocus} />
            ))}
          </ul>
          {list.length > limit && (
            <button type="button" onClick={() => setLimit((n) => n + 100)} className="w-full rounded-[12px] py-2 text-[12px] font-medium text-[var(--accent)] hover:bg-[var(--line)]">
              Show {Math.min(100, list.length - limit)} more of {list.length}
            </button>
          )}
        </>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label} className="space-y-2">
              <h3 className="flex items-baseline justify-between px-0.5">
                <span className="eyebrow">{g.label}</span>
                <span className="tnum text-[10.5px] text-fg-3">
                  {g.countries.reduce((s, c) => s + c.dests.length, 0)} destinations · {g.perWeek}/wk
                </span>
              </h3>
              <div className="glass-2 overflow-hidden rounded-[16px]">
                {g.countries.map((c, i) => (
                  <div key={c.code} className={cn(i > 0 && 'border-t border-[var(--line)]')}>
                    <div className="flex items-baseline justify-between bg-[color-mix(in_srgb,var(--line)_55%,transparent)] px-3 py-1.5">
                      <span className="truncate text-[11.5px] font-semibold text-fg-2">{c.name}</span>
                      <span className="tnum shrink-0 text-[10.5px] text-fg-3">{c.perWeek}/wk</span>
                    </div>
                    <ul className="divide-y divide-[var(--line)]">
                      {c.dests.map((d) => (
                        <DestRow key={d.airport.ident} d={d} max={max} onPick={pick} onHover={setFocus} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="text-[11px] leading-snug text-fg-3">
        Simulated routes: the destinations simulated airlines fly from {a.iata ?? a.ident} today, with an estimate of weekly frequency. Real airlines and airports, invented schedule — not
        for planning travel.
      </p>
    </div>
  );
}
