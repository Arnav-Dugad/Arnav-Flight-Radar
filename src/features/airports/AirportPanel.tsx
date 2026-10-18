import { useQuery } from '@tanstack/react-query';
import { Columns3, ExternalLink, Navigation, Pin, Share2, Star, Video } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AIRPORT_TYPE_LABEL } from '@shared/airports';
import { distanceNm } from '@shared/geo';
import type { AirportDetail, AirportType } from '@shared/types';
import { AirportIcon, RunwayIcon, SpotterIcon, TowerIcon, WeatherIcon } from '@/components/icons';
import { Badge, EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { CopyButton, Row, Rows, Tabs } from '@/components/ui/Data';
import { GlassButton, IconButton, Section } from '@/components/ui/Glass';
import { Panel } from '@/components/ui/Sheet';
import { loadCountries, loadMajorAirports } from '@/data/airports';
import { api } from '@/lib/api';
import { fmtAltitude, fmtBearing, fmtDistance, fmtLocalTime, fmtMhz, fmtTimeUTC } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { shareUrl } from '@/lib/urlState';
import { showAirportDetail } from '@/map/airportsLayer';
import { flyTo, getMap } from '@/map/controller';
import { useBookmarks } from '@/state/bookmarks';
import { useSettings } from '@/state/settings';
import { useUI } from '@/state/ui';
import { MetarCard, TafCard, WeatherAttribution } from '@/features/weather/WeatherCards';
import { simNow, useSim } from '@/data/world';
import { webcamsFor } from '@/data/webcams';
import { ApproachExplorer } from './Approach';
import { BoardTab, GroundTab, HourlyMovements, RunwayInUseCard } from './AirportOps';
import { SkyTimesCard } from './SkyTimes';

// The delays tab (charts and the TAF impact model) loads the first time it is opened.
const AirportDelays = lazy(() => import('./AirportDelays').then((m) => ({ default: m.AirportDelays })));
const AirportRadio = lazy(() => import('./AirportRadio').then((m) => ({ default: m.AirportRadio })));

type Tab = 'overview' | 'arrivals' | 'departures' | 'ground' | 'radio' | 'delays' | 'weather' | 'runways';

export function AirportPanel() {
  useSim((s) => s.rev); // re-render when the simulation worker answers
  const ident = useUI((s) => s.selectedAirport);
  const open = useUI((s) => s.panel === 'airport') && !!ident;
  const selectAirport = useUI((s) => s.selectAirport);
  const comparing = useUI((s) => !!ident && s.compareAirports.includes(ident));
  const compare = () => {
    if (!ident) return;
    const { compareAirports, setCompareAirports, openPanel } = useUI.getState();
    setCompareAirports(compareAirports.includes(ident) ? compareAirports : [...compareAirports.slice(0, 3), ident]);
    openPanel('airportCompare');
  };
  const q = useQuery({
    queryKey: ['airport', ident],
    queryFn: ({ signal }) => api.airport(ident!, signal),
    enabled: !!ident,
    staleTime: Infinity,
    retry: 0,
  });

  useEffect(() => {
    const m = getMap();
    if (!m) return;
    showAirportDetail(m, q.data && open ? q.data : null);
  }, [q.data, open]);

  return (
    <Panel
      open={open}
      onClose={() => selectAirport(null)}
      title={q.data ? (q.data.iata ? `${q.data.iata} · ${q.data.name}` : q.data.name) : (ident ?? 'Airport')}
      icon={<AirportIcon size={18} />}
      subtitle={q.data ? [q.data.icao ?? q.data.ident, q.data.city].filter(Boolean).join(' · ') : 'Loading…'}
      ariaLabel="Airport details"
      actions={
        q.data ? (
          <IconButton label="Compare airports" size={34} active={comparing} onClick={compare}>
            <Columns3 size={16} />
          </IconButton>
        ) : undefined
      }
    >
      {q.isPending ? (
        <div className="space-y-3 pt-2">
          <Skeleton className="h-20 rounded-[16px]" />
          <Skeleton className="h-40 rounded-[16px]" />
        </div>
      ) : q.isError ? (
        (q.error as { status?: number }).status === 404 ? (
          <EmptyState title="Airport not in the dataset" body={`${ident} was not found in the bundled OurAirports snapshot.`} />
        ) : (
          <ErrorState title="Airport data unavailable" body={(q.error as Error).message} />
        )
      ) : (
        <AirportBody a={q.data} />
      )}
    </Panel>
  );
}

function AirportBody({ a }: { a: AirportDetail }) {
  const [tab, setTab] = useState<Tab>('overview');
  const now = useNow(1000);
  const [tz, setTz] = useState<string | null>(null);
  const [countryName, setCountryName] = useState<string>(a.country);
  const units = useSettings((s) => s.units);
  const favs = useBookmarks((s) => s.airports);
  const toggleFav = useBookmarks((s) => s.toggleAirport);
  const setSpotter = useUI((s) => s.setSpotter);
  const openPanel = useUI((s) => s.openPanel);
  const toast = useUI((s) => s.toast);
  const isFav = favs.includes(a.ident);
  const pinned = useBookmarks((s) => s.pinnedAirports.includes(a.ident));
  const togglePin = useBookmarks((s) => s.togglePin);
  const station = a.icao && /^[A-Z]{4}$/.test(a.icao) ? a.icao : /^[A-Z]{4}$/.test(a.ident) ? a.ident : null;

  useEffect(() => {
    let alive = true;
    void import('@photostructure/tz-lookup')
      .then((m) => {
        if (alive) setTz(m.default(a.lat, a.lon));
      })
      .catch(() => setTz(null));
    void loadCountries().then((list) => {
      if (alive) setCountryName(list.find((c) => c.code === a.country)?.name ?? a.country);
    });
    return () => {
      alive = false;
    };
  }, [a.lat, a.lon, a.country]);

  const share = async () => {
    const url = shareUrl({ airport: a.ident });
    try {
      if (navigator.share)
        await navigator.share({
          title: `${a.name} on Arnav Flight Radar`,
          url,
        });
      else {
        await navigator.clipboard.writeText(url);
        toast({ kind: 'success', title: 'Link copied' });
      }
    } catch {
      /* cancelled */
    }
  };

  return (
    <div className="space-y-4 pt-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="accent">{AIRPORT_TYPE_LABEL[a.type as AirportType] ?? a.type}</Badge>
        {a.scheduled && <Badge tone="ok">Scheduled service</Badge>}
        <Badge>{countryName}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="glass-2 rounded-[16px] p-3">
          <div className="eyebrow">Local time</div>
          <div className="tnum mt-1.5 text-[20px] font-semibold leading-none text-fg">{tz ? fmtLocalTime(now, tz) : '—'}</div>
          <div className="mt-1.5 truncate text-[11px] text-fg-3">{tz ?? 'Time zone unavailable'}</div>
        </div>
        <div className="glass-2 rounded-[16px] p-3">
          <div className="eyebrow">UTC</div>
          <div className="tnum mt-1.5 text-[20px] font-semibold leading-none text-fg">{fmtTimeUTC(now).slice(0, 8)}</div>
          <div className="mt-1.5 text-[11px] text-fg-3">Zulu</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <GlassButton size="sm" onClick={() => flyTo(a.lon, a.lat, 12.5, { pitch: 45 })}>
          <Navigation size={14} /> Fly to
        </GlassButton>
        <GlassButton
          size="sm"
          onClick={() => {
            setSpotter(a.ident);
            flyTo(a.lon, a.lat, 10.5);
            openPanel('spotter');
          }}
        >
          <SpotterIcon size={15} /> Spotter mode
        </GlassButton>
        <IconButton label={isFav ? 'Remove from favourites' : 'Add to favourites'} variant="glass" size={32} active={isFav} onClick={() => toggleFav(a.ident)}>
          <Star size={15} fill={isFav ? 'currentColor' : 'none'} />
        </IconButton>
        <IconButton label="Share link" variant="glass" size={32} onClick={() => void share()}>
          <Share2 size={15} />
        </IconButton>
        <IconButton label={pinned ? 'Unpin from map' : 'Pin to map'} variant="glass" size={32} active={pinned} onClick={() => togglePin(a.ident)}>
          <Pin size={15} />
        </IconButton>
      </div>

      <TabScroller active={tab}>
        <Tabs
          label="Airport information"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'arrivals', label: 'Arrivals' },
            { id: 'departures', label: 'Departures' },
            { id: 'ground', label: 'Ground' },
            { id: 'radio', label: 'Radio' },
            { id: 'delays', label: 'Delays' },
            { id: 'weather', label: 'Weather' },
            { id: 'runways', label: 'Runways' },
          ]}
        />
      </TabScroller>

      {tab === 'overview' && (
        <div className="space-y-4">
          <RunwayInUseCard a={a} />
          <HourlyMovements a={a} />
          <SkyTimesCard lat={a.lat} lon={a.lon} tz={tz} now={simNow()} />
          <Rows>
            <Row label="ICAO / GPS code" value={a.icao ?? a.ident} mono />
            <Row label="IATA code" value={a.iata} mono />
            <Row label="Name" value={a.name} />
            <Row label="City" value={a.city} />
            <Row label="Region" value={a.region} mono />
            <Row label="Country" value={countryName} />
            <Row label="Elevation" value={a.elevationFt !== undefined ? fmtAltitude(a.elevationFt, units.altitude === 'fl' ? 'ft' : units.altitude) : undefined} mono />
            <Row label="Position" value={`${a.lat.toFixed(5)}, ${a.lon.toFixed(5)}`} mono copy={`${a.lat.toFixed(5)}, ${a.lon.toFixed(5)}`} />
          </Rows>
          {a.frequencies.length > 0 && (
            <Section title={`Radio frequencies (${a.frequencies.length})`}>
              <ul className="glass-2 divide-y divide-[var(--line)] rounded-[16px]">
                {a.frequencies.map((f, i) => (
                  <li key={i} className="flex items-center gap-3 px-3.5 py-2">
                    <TowerIcon size={15} className="shrink-0 text-fg-3" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-medium text-fg">{f.type}</div>
                      {f.description && <div className="truncate text-[11px] text-fg-3">{f.description}</div>}
                    </div>
                    <span className="tnum text-[12.5px] font-semibold text-fg">{fmtMhz(f.mhz)}</span>
                    <CopyButton text={String(f.mhz)} label={`Copy ${f.type} frequency`} />
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <NearbyAirports a={a} />
          <LiveViews a={a} />
          {(a.homeLink || a.wikipedia) && (
            <div className="flex flex-wrap gap-2">
              {a.homeLink && (
                <a href={a.homeLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[12px] text-[var(--accent)] hover:underline">
                  Airport website <ExternalLink size={12} />
                </a>
              )}
              {a.wikipedia && (
                <a href={a.wikipedia} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[12px] text-[var(--accent)] hover:underline">
                  Wikipedia <ExternalLink size={12} />
                </a>
              )}
            </div>
          )}
          <p className="text-[11px] text-fg-3">Airport data: OurAirports (public domain), community-maintained. Not for navigation.</p>
        </div>
      )}

      {tab === 'weather' && (
        <div className="space-y-4">
          {station ? (
            <>
              <Section title={`METAR · ${station}`}>
                <MetarCard station={station} />
              </Section>
              <Section title={`TAF · ${station}`}>
                <TafCard station={station} />
              </Section>
              <WeatherAttribution />
            </>
          ) : (
            <EmptyState icon={<WeatherIcon />} title="No reporting station" body="This airfield has no four-letter ICAO identifier, so no METAR/TAF can be looked up." />
          )}
        </div>
      )}

      {tab === 'runways' && <Runways a={a} />}
      {tab === 'arrivals' && <BoardTab a={a} kind="arrivals" />}
      {tab === 'departures' && <BoardTab a={a} kind="departures" />}
      {tab === 'ground' && <GroundTab a={a} />}
      {tab === 'radio' && (
        <Suspense fallback={<div className="skeleton h-40 rounded-[16px]" aria-hidden="true" />}>
          <AirportRadio a={a} />
        </Suspense>
      )}
      {tab === 'delays' && (
        <Suspense fallback={<div className="skeleton h-40 rounded-[16px]" aria-hidden="true" />}>
          <AirportDelays a={a} station={station} />
        </Suspense>
      )}
    </div>
  );
}

function Runways({ a }: { a: AirportDetail }) {
  const unit = useSettings((s) => s.units.altitude);
  const toM = unit === 'm';
  const len = (ft?: number) => (ft === undefined ? undefined : toM ? `${Math.round(ft * 0.3048).toLocaleString()} m` : `${ft.toLocaleString()} ft`);
  if (!a.runways.length) return <EmptyState icon={<RunwayIcon />} title="No runway data" body="OurAirports has no runway records for this airfield." />;
  return (
    <div className="space-y-3">
      <RunwayInUseCard a={a} />
      <RunwayDiagram a={a} />
      <ApproachExplorer a={a} />
      {a.runways.map((r, i) => (
        <div key={i} className="glass-2 rounded-[16px] px-3.5 py-3">
          <div className="flex items-center justify-between">
            <span className="tnum text-[15px] font-semibold text-fg">
              {r.leIdent ?? '—'} / {r.heIdent ?? '—'}
            </span>
            <span className="flex gap-1.5">
              {r.closed && <Badge tone="danger">Closed</Badge>}
              {r.lighted && <Badge tone="warn">Lighted</Badge>}
            </span>
          </div>
          <div className="tnum mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] text-fg-2">
            <span>Length: {len(r.lengthFt) ?? '—'}</span>
            <span>Width: {len(r.widthFt) ?? '—'}</span>
            <span>Surface: {r.surface ?? '—'}</span>
            <span>
              Headings: {r.leHeadingDegT !== undefined ? fmtBearing(r.leHeadingDegT) : '—'} / {r.heHeadingDegT !== undefined ? fmtBearing(r.heHeadingDegT) : '—'}
            </span>
            {(r.leDisplacedThresholdFt || r.heDisplacedThresholdFt) && (
              <span className="col-span-2">
                Displaced thresholds: {len(r.leDisplacedThresholdFt) ?? '—'} / {len(r.heDisplacedThresholdFt) ?? '—'}
              </span>
            )}
          </div>
        </div>
      ))}
      <p className="text-[11px] text-fg-3">Runways are drawn on the map from the published threshold coordinates where available.</p>
    </div>
  );
}

function RunwayDiagram({ a }: { a: AirportDetail }) {
  const lines = a.runways.filter((r) => r.leLat !== undefined && r.leLon !== undefined && r.heLat !== undefined && r.heLon !== undefined && !r.closed);
  if (!lines.length) return null;
  const k = Math.cos((a.lat * Math.PI) / 180);
  const pts = lines.flatMap((r) => [
    [(r.leLon! - a.lon) * k, r.leLat! - a.lat],
    [(r.heLon! - a.lon) * k, r.heLat! - a.lat],
  ]);
  const ext = Math.max(...pts.flat().map(Math.abs)) || 0.01;
  const S = 64 / ext;
  const P = (x: number, y: number) => [80 + x * S, 80 - y * S] as const;
  return (
    <svg viewBox="0 0 160 160" className="glass-2 mx-auto block h-40 w-full rounded-[16px]" role="img" aria-label="Runway layout diagram (north up)">
      <text x="150" y="16" fontSize="9" textAnchor="end" fill="var(--fg-3)" fontWeight="700">
        N ↑
      </text>
      {lines.map((r, i) => {
        const [x1, y1] = P((r.leLon! - a.lon) * k, r.leLat! - a.lat);
        const [x2, y2] = P((r.heLon! - a.lon) * k, r.heLat! - a.lat);
        return (
          <g key={i}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--fg-2)" strokeWidth="6" strokeLinecap="butt" />
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--canvas)" strokeWidth="0.8" strokeDasharray="3 3" />
            <text x={x1} y={y1} dy={-6} fontSize="8.5" textAnchor="middle" fill="var(--accent)" fontWeight="700">
              {r.leIdent}
            </text>
            <text x={x2} y={y2} dy={12} fontSize="8.5" textAnchor="middle" fill="var(--accent)" fontWeight="700">
              {r.heIdent}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function NearbyAirports({ a }: { a: AirportDetail }) {
  const selectAirport = useUI((s) => s.selectAirport);
  const unit = useSettings((s) => s.units.distance);
  const q = useQuery({
    queryKey: ['major-airports'],
    queryFn: loadMajorAirports,
    staleTime: Infinity,
  });
  const near = useMemo(
    () =>
      (q.data ?? [])
        .filter((x) => x.ident !== a.ident)
        .map((x) => ({ x, d: distanceNm(a.lat, a.lon, x.lat, x.lon) }))
        .filter((o) => o.d < 120)
        .sort((p, r) => p.d - r.d)
        .slice(0, 6),
    [q.data, a],
  );
  if (!near.length) return null;
  return (
    <Section title="Nearby airports">
      <ul className="glass-2 divide-y divide-[var(--line)] rounded-[16px]">
        {near.map(({ x, d }) => (
          <li key={x.ident}>
            <button
              type="button"
              onClick={() => {
                selectAirport(x.ident);
                flyTo(x.lon, x.lat, 10.5);
              }}
              className="flex w-full items-center gap-3 px-3.5 py-2 text-left hover:bg-[var(--line)]"
            >
              <span className="tnum w-10 shrink-0 text-[12.5px] font-semibold text-[var(--accent)]">{x.iata ?? x.ident}</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{x.name}</span>
              <span className="tnum shrink-0 text-[11.5px] text-fg-3">{fmtDistance(d, unit)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function LiveViews({ a }: { a: AirportDetail }) {
  const cams = useMemo(() => webcamsFor(a.icao ?? a.ident, a.lat, a.lon), [a.icao, a.ident, a.lat, a.lon]);
  if (!cams.length) return null;
  return (
    <Section title="Live views">
      <ul className="glass-2 divide-y divide-[var(--line)] overflow-hidden rounded-[16px]">
        {cams.map((c) => (
          <li key={c.url}>
            <a href={c.url} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-3 px-3.5 py-2.5 hover:bg-[var(--line)]">
              <Video size={15} className="shrink-0 text-fg-3" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium text-fg">{c.label}</span>
                <span className="block truncate text-[11px] text-fg-3">{c.source}</span>
              </span>
              <ExternalLink size={13} className="shrink-0 text-fg-3 group-hover:text-[var(--accent)]" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-fg-3">External sites — not affiliated. They may change or go offline.</p>
    </Section>
  );
}

/** Horizontally scrollable tab strip: fades the clipped edge and keeps the active tab in view. */
function TabScroller({ active, children }: { active: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const measure = () => {
    const el = ref.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 1, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 });
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tab = el.querySelector<HTMLElement>('[role=tab][aria-selected=true]');
    if (tab) {
      const box = el.getBoundingClientRect();
      const t = tab.getBoundingClientRect();
      if (t.left < box.left + 24 || t.right > box.right - 24) el.scrollTo({ left: el.scrollLeft + t.left - box.left - (box.width - t.width) / 2, behavior: 'smooth' });
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active]);
  const mask = `linear-gradient(to right, ${edges.start ? '#000' : 'transparent'}, #000 28px, #000 calc(100% - 28px), ${edges.end ? '#000' : 'transparent'})`;
  return (
    <div
      ref={ref}
      onScroll={measure}
      className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&_[role=tab]]:whitespace-nowrap [&_[role=tab]]:px-2.5 [&_[role=tablist]]:min-w-max [&_[role=tablist]]:gap-0.5"
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    >
      {children}
    </div>
  );
}
