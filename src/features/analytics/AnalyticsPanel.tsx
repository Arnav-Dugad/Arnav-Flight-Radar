import { Table2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CLASS_LABEL } from '@shared/classify';
import { countryFromIcao } from '@shared/icaoCountry';
import { computeStats } from '@shared/stats';
import { AircraftGlyph, AnalyticsIcon } from '@/components/icons';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { BarList, Histogram, SplitBar, Sparkline } from '@/components/ui/Charts';
import { SegmentedControl } from '@/components/ui/Controls';
import { EmptyState } from '@/components/ui/Feedback';
import { Stat } from '@/components/ui/Data';
import { GlassButton, Section } from '@/components/ui/Glass';
import { Panel } from '@/components/ui/Sheet';
import { useDemo } from '@/data/demo';
import { compileFilter } from '@/lib/filters';
import { fmtAltitude, fmtSpeed } from '@/lib/format';
import { useTrafficVersion } from '@/lib/hooks';
import { focusAircraft, getMap } from '@/map/controller';
import { useFilters } from '@/state/filters';
import { useSettings } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { useUI } from '@/state/ui';

type Scope = 'area' | 'view' | 'filtered';

const SOURCE_LABEL: Record<string, string> = { adsb: 'ADS-B', mlat: 'MLAT', tisb: 'TIS-B', adsr: 'ADS-R', adsc: 'ADS-C', modes: 'Mode S', other: 'Other' };

export function AnalyticsPanel() {
  const open = useUI((s) => s.panel === 'analytics');
  const openPanel = useUI((s) => s.openPanel);
  const select = useUI((s) => s.select);
  const units = useSettings((s) => s.units);
  const filters = useFilters((s) => s.filters);
  const [scope, setScope] = useState<Scope>('area');
  const [table, setTable] = useState(false);
  const version = useTrafficVersion();
  const meta = traffic.meta;
  const demo = useDemo((d) => d.active);

  const population = useMemo(() => {
    let list = traffic.current();
    if (scope === 'view') {
      const b = getMap()?.getBounds();
      if (b) list = list.filter((a) => b.contains([a.lon, a.lat]));
    } else if (scope === 'filtered') {
      const p = compileFilter(filters);
      list = list.filter((a) => p(a));
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, version, filters, open]);

  const s = useMemo(() => computeStats(population), [population]);
  const countries = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of population) {
      const c = countryFromIcao(a.icao24);
      const k = c?.name ?? 'Unknown block';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [population]);
  const trend = traffic.snapshots.slice(-60);

  const describe =
    scope === 'area'
      ? meta
        ? `All aircraft reported by adsb.fi within ${meta.region.radiusNm} NM of ${meta.region.lat.toFixed(2)}, ${meta.region.lon.toFixed(2)}.`
        : 'Waiting for the first live snapshot.'
      : scope === 'view'
        ? 'Aircraft from the live area that are inside the current map view.'
        : 'Aircraft from the live area that match your active filters.';

  const go = (id: string) => {
    select(id);
    focusAircraft(id, 9.5);
  };

  return (
    <Panel
      open={open}
      onClose={() => openPanel(null)}
      title="Analytics"
      icon={<AnalyticsIcon size={18} />}
      ariaLabel="Traffic analytics"
      subtitle="Regional sample, not worldwide"
      actions={
        <GlassButton size="sm" variant="ghost" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          <Table2 size={14} /> {table ? 'Charts' : 'Table'}
        </GlassButton>
      }
    >
      <div className="space-y-5 pt-1">
        <SegmentedControl
          label="Population"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'area', label: 'Live area' },
            { value: 'view', label: 'In view' },
            { value: 'filtered', label: 'Filtered' },
          ]}
        />
        {demo ? (
          <p className="rounded-[12px] border border-[rgba(167,139,250,0.4)] bg-[rgba(167,139,250,0.1)] px-3 py-2 text-[11.5px] leading-relaxed text-[#d8cdfd]">
            <span className="font-semibold">Demo mode:</span> these figures describe {s.sample} simulated aircraft. They are not real traffic statistics.
          </p>
        ) : (
          <p className="rounded-[12px] bg-[var(--line)] px-3 py-2 text-[11.5px] leading-relaxed text-fg-2">
            <span className="font-semibold text-fg">Sample: {s.sample} aircraft.</span> {describe}
          </p>
        )}

        {s.sample === 0 ? (
          <EmptyState icon={<AnalyticsIcon />} title="No aircraft in this sample" body="Pan to a busier area or change the population." />
        ) : table ? (
          <StatsTable s={s} />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Observed" value={<AnimatedNumber value={s.sample} />} />
              <Stat label="Airborne" value={<AnimatedNumber value={s.airborne} />} />
              <Stat label="On ground" value={<AnimatedNumber value={s.onGround} />} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Avg altitude" value={s.avgAltitudeFt !== undefined ? fmtAltitude(s.avgAltitudeFt, units.altitude) : '—'} sub={`${s.altitudeKnown} reporting · airborne`} />
              <Stat label="Avg ground speed" value={s.avgGroundSpeedKt !== undefined ? fmtSpeed(s.avgGroundSpeedKt, units.speed) : '—'} sub={`${s.speedKnown} reporting`} />
            </div>
            <p className="text-[11.5px] text-fg-3">
              Military-flagged: <span className="font-semibold text-fg-2">{s.military}</span> · Emergency squawks:{' '}
              <span className="font-semibold text-fg-2">{s.emergencies.length}</span>
            </p>

            {s.emergencies.length > 0 && (
              <div role="alert" className="rounded-[14px] border border-[rgba(255,93,115,0.35)] bg-[rgba(255,93,115,0.08)] px-3.5 py-2.5 text-[12px]">
                <p className="font-semibold text-[#ffb3bd]">Emergency squawks observed</p>
                <ul className="mt-1 space-y-0.5">
                  {s.emergencies.map((e) => (
                    <li key={e.id}>
                      <button type="button" className="text-fg-2 hover:text-fg" onClick={() => go(e.id)}>
                        {e.label} · {e.squawk ?? e.emergency}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Section title="Altitude distribution">
              <Histogram data={s.altitudeBands.map((b) => ({ label: b.label, value: b.count }))} caption="Aircraft count by altitude band" />
            </Section>

            <Section title="Vertical state (airborne)">
              <SplitBar
                parts={[
                  { key: 'c', label: 'Climbing', value: s.climbing, color: 'var(--viz-3)' },
                  { key: 'l', label: 'Level', value: s.level, color: 'var(--viz-1)' },
                  { key: 'd', label: 'Descending', value: s.descending, color: 'var(--viz-2)' },
                ]}
              />
              {s.verticalUnknown > 0 && <p className="text-[11px] text-fg-3">{s.verticalUnknown} airborne aircraft do not report a vertical rate.</p>}
            </Section>

            <Section title="Ground speed">
              <Histogram data={s.speedBands.map((b) => ({ label: b.label, value: b.count }))} height={120} caption="Aircraft count by ground speed band" />
            </Section>

            <Section title="By aircraft class">
              <BarList data={s.byClass.map((c) => ({ key: c.cls, label: CLASS_LABEL[c.cls], value: c.count, icon: <AircraftGlyph cls={c.cls} size={15} className="text-fg-3" /> }))} />
            </Section>

            {s.byType.length > 0 && (
              <Section title="Most common types">
                <BarList data={s.byType.map((t) => ({ key: t.type, label: t.type, value: t.count }))} total={s.sample} />
              </Section>
            )}

            <Section title="Registry country (ICAO address block)">
              <BarList data={countries.map(([k, v]) => ({ key: k, label: k, value: v }))} total={s.sample} />
            </Section>

            <Section title="Observed count this session">
              <Sparkline values={trend.map((x) => x.rows.length)} times={trend.map((x) => x.t)} caption="Number of aircraft in each live snapshot this session" />
              <p className="text-[11px] text-fg-3">Counts depend on where the live area was at each refresh.</p>
            </Section>

            <Section title="Records">
              <div className="grid grid-cols-2 gap-2">
                {s.maxAltitude && (
                  <button type="button" onClick={() => go(s.maxAltitude!.id)} className="glass-2 rounded-[14px] p-3 text-left hover:border-[var(--line-strong)]">
                    <div className="eyebrow">Highest</div>
                    <div className="mt-1 text-[14px] font-semibold text-fg">{s.maxAltitude.label}</div>
                    <div className="tnum text-[12px] text-fg-2">{fmtAltitude(s.maxAltitude.value, units.altitude)}</div>
                  </button>
                )}
                {s.maxSpeed && (
                  <button type="button" onClick={() => go(s.maxSpeed!.id)} className="glass-2 rounded-[14px] p-3 text-left hover:border-[var(--line-strong)]">
                    <div className="eyebrow">Fastest (ground)</div>
                    <div className="mt-1 text-[14px] font-semibold text-fg">{s.maxSpeed.label}</div>
                    <div className="tnum text-[12px] text-fg-2">{fmtSpeed(s.maxSpeed.value, units.speed)}</div>
                  </button>
                )}
              </div>
            </Section>

            <Section title="Data quality">
              <BarList
                data={[
                  { key: 'live', label: 'Live positions', value: s.freshness.live },
                  { key: 'stale', label: 'Stale positions', value: s.freshness.stale },
                  ...s.bySource.map((b) => ({ key: `src-${b.source}`, label: `Source: ${SOURCE_LABEL[b.source] ?? b.source}`, value: b.count })),
                ]}
                total={s.sample}
              />
            </Section>
          </>
        )}
      </div>
    </Panel>
  );
}

function StatsTable({ s }: { s: ReturnType<typeof computeStats> }) {
  const rows: [string, string | number][] = [
    ['Observed', s.sample],
    ['Airborne', s.airborne],
    ['On ground', s.onGround],
    ['Climbing', s.climbing],
    ['Level', s.level],
    ['Descending', s.descending],
    ['Vertical rate not reported', s.verticalUnknown],
    ['Average altitude (ft)', s.avgAltitudeFt ?? '—'],
    ['Average ground speed (kt)', s.avgGroundSpeedKt ?? '—'],
    ['Military', s.military],
    ...s.altitudeBands.map((b) => [`Altitude ${b.label}`, b.count] as [string, number]),
    ...s.speedBands.map((b) => [`Speed ${b.label}`, b.count] as [string, number]),
    ...s.byClass.map((c) => [CLASS_LABEL[c.cls], c.count] as [string, number]),
  ];
  return (
    <table className="tnum w-full text-[12px]">
      <caption className="sr-only">Traffic statistics</caption>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-b border-[var(--line)]">
            <th scope="row" className="py-1.5 text-left font-normal text-fg-3">
              {k}
            </th>
            <td className="py-1.5 text-right font-semibold text-fg">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
