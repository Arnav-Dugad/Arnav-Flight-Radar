// "Right now" widgets in the spirit of a commercial flight tracker: busiest airports,
// disruption index, and notable flights — all computed from the simulated world.
import { useMemo } from 'react';
import { AnalyticsIcon } from '@/components/icons';
import { Section } from '@/components/ui/Glass';
import { Skeleton } from '@/components/ui/Feedback';
import { Panel } from '@/components/ui/Sheet';
import { useQuery } from '@tanstack/react-query';
import { setSimSpeed, simPunctuality, simSeason, simWidgets, useSim, type NotableFlight, type PunctualityRow } from '@/data/world';
import { cn } from '@/lib/cn';
import { fmtAltitude, fmtSpeed } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { flyTo, focusAircraft } from '@/map/controller';
import { useSettings } from '@/state/settings';
import { useUI } from '@/state/ui';
import { AirlineLogo } from '@/features/aircraft/FlightParts';

const DISRUPTION = ['#3ddc97', '#9be15d', '#ffd166', '#ffb547', '#ff8a5c', '#ff5d73'];
export const disruptionColor = (v: number) => DISRUPTION[Math.min(5, Math.max(0, Math.round(v)))]!;

export function WidgetsPanel() {
  useSim((s) => s.rev); // re-render when the simulation worker answers
  const open = useUI((s) => s.panel === 'widgets');
  const openPanel = useUI((s) => s.openPanel);
  const selectAirport = useUI((s) => s.selectAirport);
  const select = useUI((s) => s.select);
  const loading = useSim((s) => s.loading);
  const airborne = useSim((s) => s.airborne);
  const units = useSettings((s) => s.units);
  useNow(10_000);
  const w = (open && !loading ? simWidgets() : undefined);
  const busiest = w ? [...w.airports].sort((a, b) => b.movements - a.movements).slice(0, 10) : [];
  const disrupted = w ? [...w.airports].filter((a) => a.disruption > 0.2).sort((a, b) => b.disruption - a.disruption).slice(0, 8) : [];

  const openAirport = (ident: string, lon: number, lat: number) => {
    selectAirport(ident);
    flyTo(lon, lat, 10);
  };
  const openFlight = (f: NotableFlight) => {
    select(f.id);
    focusAircraft(f.id, 7);
  };
  const flightList = (list: NotableFlight[], fmt: (v: number) => string) => (
    <ul className="glass-2 divide-y divide-[var(--line)] overflow-hidden rounded-[16px]">
      {list.map((f, i) => (
        <li key={f.id}>
          <button type="button" onClick={() => openFlight(f)} className="flex w-full items-center gap-3 px-3.5 py-2 text-left hover:bg-[var(--line)]">
            <span className="tnum w-4 text-[11px] text-fg-3">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">
              <span className="font-semibold">{f.flight}</span>{' '}
              <span className="text-fg-2">
                {f.from.iata ?? f.from.ident} → {f.to.iata ?? f.to.ident} · {f.type}
              </span>
            </span>
            <span className="tnum shrink-0 text-[12px] font-semibold text-fg">{fmt(f.value)}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <Panel open={open} onClose={() => openPanel(null)} title="Right now" icon={<AnalyticsIcon size={18} />} ariaLabel="World activity widgets" subtitle="Busiest airports, disruptions and notable flights in the simulated world">
      {!w ? (
        <div className="space-y-3 pt-1">
          <Skeleton className="h-24 rounded-[16px]" />
          <Skeleton className="h-64 rounded-[16px]" />
        </div>
      ) : (
        <div className="space-y-6 pt-1">
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="glass-2 rounded-[14px] px-2 py-3">
              <div className="tnum text-[24px] font-semibold text-fg">{airborne.toLocaleString()}</div>
              <div className="text-[10.5px] text-fg-3">aircraft flying</div>
            </div>
            <div className="glass-2 rounded-[14px] px-2 py-3">
              <div className="tnum text-[24px] font-semibold text-fg">{w.airports.reduce((s, a) => s + a.movements, 0).toLocaleString()}</div>
              <div className="text-[10.5px] text-fg-3">take-offs &amp; landings, last hour</div>
            </div>
          </div>

          <TravelPeaks />

          <Section title="Busiest airports (last hour)">
            <ul className="glass-2 divide-y divide-[var(--line)] overflow-hidden rounded-[16px]">
              {busiest.map((a, i) => (
                <li key={a.airport.ident}>
                  <button type="button" onClick={() => openAirport(a.airport.ident, a.airport.lon, a.airport.lat)} className="flex w-full items-center gap-3 px-3.5 py-2 text-left hover:bg-[var(--line)]">
                    <span className="tnum w-4 text-[11px] text-fg-3">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">
                      <span className="mr-1.5 font-semibold text-[var(--accent)]">{a.airport.iata ?? a.airport.ident}</span>
                      {a.airport.city ?? a.airport.name}
                    </span>
                    <span className="tnum shrink-0 text-[11.5px] text-fg-2">
                      ↓{a.arrivals} ↑{a.departures}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Airport disruptions">
            {disrupted.length === 0 ? (
              <p className="glass-2 rounded-[14px] px-3.5 py-3 text-[12px] text-fg-3">Operations are running smoothly everywhere.</p>
            ) : (
              <ul className="glass-2 divide-y divide-[var(--line)] overflow-hidden rounded-[16px]">
                {disrupted.map((a) => (
                  <li key={a.airport.ident}>
                    <button type="button" onClick={() => openAirport(a.airport.ident, a.airport.lon, a.airport.lat)} className="flex w-full items-center gap-3 px-3.5 py-2 text-left hover:bg-[var(--line)]">
                      <span className="tnum grid size-8 shrink-0 place-items-center rounded-full text-[12px] font-bold text-[#04101c]" style={{ background: disruptionColor(a.disruption) }}>
                        {a.disruption.toFixed(1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] text-fg">
                          <span className="mr-1.5 font-semibold">{a.airport.iata ?? a.airport.ident}</span>
                          {a.airport.city ?? a.airport.name}
                        </span>
                        <span className={cn('block truncate text-[11px] text-fg-3')}>
                          {[a.avgDelayMin > 0 && `avg delay ${a.avgDelayMin} min`, a.holding > 0 && `${a.holding} holding`, a.diverted > 0 && `${a.diverted} diverted`, a.canceled > 0 && `${a.canceled} canceled`]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-fg-3">Disruption index 0–5 from delays, holding, diversions and cancellations over the last hour. Real METAR weather drives much of it.</p>
          </Section>

          <PunctualityLeague />

          <Section title="Longest flights in the air">{flightList(w.longest, (v) => `${Math.round(v).toLocaleString()} NM`)}</Section>
          <Section title="Fastest ground speed (jet streams)">{flightList(w.fastest, (v) => fmtSpeed(v, units.speed))}</Section>
          <Section title="Highest">{flightList(w.highest, (v) => fmtAltitude(v, units.altitude))}</Section>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- punctuality league

/** Airlines need this many counted arrivals before they enter the league. */
const LEAGUE_MIN = 5;

function PunctualityLeague() {
  const speed = useSim((s) => s.speed);
  const selectAirline = useUI((s) => s.selectAirline);
  const now = useNow(5000);
  const tick = Math.floor(now / 5000);
  const data = useMemo(() => {
    void tick; // re-read the session tally every 5 s
    const all = simPunctuality(1);
    return { rows: all.filter((r) => r.flights >= LEAGUE_MIN), counted: all.reduce((n, r) => n + r.flights, 0), airlines: all.length };
  }, [tick]);
  const { rows, counted, airlines } = data;
  const ready = rows.length >= 3;
  const top = rows.slice(0, 10);
  const bottom = rows.length > 10 ? rows.slice(Math.max(10, rows.length - 5)).reverse() : [];

  const list = (items: PunctualityRow[], rank: (i: number) => number) => (
    <ul className="glass-2 divide-y divide-[var(--line)] overflow-hidden rounded-[16px]">
      {items.map((r, i) => (
        <li key={r.icao}>
          <button type="button" onClick={() => selectAirline(r.icao)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--line)]" title={`${r.name}: ${r.onTimePct}% of ${r.flights} arrivals within 15 minutes, average delay ${r.avgDelayMin} min`}>
            <span className="tnum w-5 shrink-0 text-right text-[11px] text-fg-3">{rank(i)}</span>
            <AirlineLogo icao={r.icao} code={r.icao} size={20} name={r.name} wide />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-fg">{r.name}</span>
              <span className="tnum block truncate text-[10.5px] text-fg-3">
                {r.flights} flight{r.flights === 1 ? '' : 's'} · avg delay {r.avgDelayMin} min{r.canceled ? ` · ${r.canceled} canceled` : ''}
              </span>
            </span>
            <span className="w-[58px] shrink-0">
              <span className="tnum block text-right text-[12.5px] font-semibold text-fg">{r.onTimePct}%</span>
              <span className="mt-1 block h-[4px] overflow-hidden rounded-full bg-[var(--viz-grid)]" aria-hidden="true">
                <span className="block h-full rounded-full bg-[var(--viz-1)]" style={{ width: `${Math.max(2, r.onTimePct)}%` }} />
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <Section
      title="Punctuality this session"
      action={<span className="rounded-full bg-[var(--line)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-2">Simulated</span>}
    >
      <p className="text-[11.5px] leading-snug text-fg-3">
        Counts simulated flights that arrived since you opened the site. On time means on stand within 15 minutes of schedule; airlines appear after {LEAGUE_MIN} arrivals.
      </p>
      {!ready ? (
        <div className="glass-2 rounded-[16px] px-4 py-5 text-center">
          <p className="text-[12.5px] font-medium text-fg-2">The league fills as flights land</p>
          <p className="tnum mt-1 text-[11.5px] leading-snug text-fg-3">
            {counted ? `${counted.toLocaleString()} arrival${counted === 1 ? '' : 's'} counted so far across ${airlines} airline${airlines === 1 ? '' : 's'}.` : 'No arrivals counted yet.'}{' '}
            {speed >= 30 ? 'At 30× clock speed it takes a minute or two.' : `It takes several minutes at ${speed}×; at 30× clock speed it fills much faster.`}
          </p>
          {speed < 30 && (
            <button
              type="button"
              onClick={() => setSimSpeed(30)}
              className="mt-3 inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--line)] px-3 text-[11.5px] font-medium text-fg-2 hover:text-fg"
            >
              Run the clock at 30× <kbd className="rounded-[4px] bg-[var(--line)] px-1 text-[10px] text-fg-3">4</kbd>
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <h4 className="px-0.5 text-[11.5px] font-medium text-fg-2">Most punctual</h4>
            {list(top, (i) => i + 1)}
          </div>
          {bottom.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="px-0.5 text-[11.5px] font-medium text-fg-2">Least punctual</h4>
              {list(bottom, (i) => rows.length - i)}
            </div>
          )}
          <p className="tnum text-[11px] text-fg-3">
            {counted.toLocaleString()} arrivals counted across {airlines} airlines · {rows.length} in the league.
          </p>
        </>
      )}
    </Section>
  );
}

/** Holiday peaks, Hajj, the IATA season and any ash advisory shaping today's simulated traffic. */
function TravelPeaks() {
  const q = useQuery({ queryKey: ['sim-season', Math.floor(Date.now() / 600_000)], queryFn: simSeason, staleTime: 10 * 60_000 });
  const s = q.data;
  if (!s) return null;
  const items: { title: string; sub: string; tone: 'accent' | 'warn' }[] = [];
  for (const h of s.holidays) items.push({ title: `${h.name} travel peak`, sub: `${h.where} · fuller flights`, tone: 'accent' });
  if (s.hajj) items.push({ title: s.hajj.phase === 'arrivals' ? 'Hajj — pilgrims arriving' : 'Hajj — pilgrims flying home', sub: 'Many extra flights to Jeddah and Medina', tone: 'accent' });
  if (s.ash) items.push({ title: s.ash.replace(' (simulated)', ''), sub: 'Flights route around it; nearby airports run at reduced capacity · simulated', tone: 'warn' });
  return (
    <Section title={`Shaping traffic today · ${s.season}`}>
      {items.length === 0 ? (
        <p className="glass-2 rounded-[16px] px-3.5 py-3 text-[12px] text-fg-3">No holiday peaks or disruption events today — a typical {s.season.startsWith('Summer') ? 'summer' : 'winter'} schedule.</p>
      ) : (
        <ul className="glass-2 divide-y divide-[var(--line)] overflow-hidden rounded-[16px]">
          {items.map((it) => (
            <li key={it.title} className="flex items-start gap-2.5 px-3.5 py-2.5">
              <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', it.tone === 'warn' ? 'bg-[#e8c24a]' : 'bg-[var(--accent)]')} aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold text-fg">{it.title}</div>
                <div className="text-[11px] text-fg-3">{it.sub}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
