import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Navigation, Share2, Star } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AIRPORT_TYPE_LABEL } from '@shared/airports';
import { classifyAircraft } from '@shared/classify';
import { bearingDeg, distanceNm } from '@shared/geo';
import type { AirportDetail, AirportType } from '@shared/types';
import { AircraftGlyph, AirportIcon, RunwayIcon, SpotterIcon, TowerIcon, WeatherIcon } from '@/components/icons';
import { Badge, EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { CopyButton, Row, Rows, Tabs } from '@/components/ui/Data';
import { GlassButton, IconButton, Section } from '@/components/ui/Glass';
import { Panel } from '@/components/ui/Sheet';
import { loadCountries, loadMajorAirports } from '@/data/airports';
import { api } from '@/lib/api';
import { fmtAltitude, fmtBearing, fmtDistance, fmtLocalTime, fmtMhz, fmtTimeUTC } from '@/lib/format';
import { useNow, useTrafficVersion } from '@/lib/hooks';
import { shareUrl } from '@/lib/urlState';
import { verticalState } from '@/lib/filters';
import { showAirportDetail } from '@/map/airportsLayer';
import { flyTo, focusAircraft, getMap } from '@/map/controller';
import { useBookmarks } from '@/state/bookmarks';
import { useSettings } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { useUI } from '@/state/ui';
import { MetarCard, TafCard, WeatherAttribution } from '@/features/weather/WeatherCards';
import { useDemo } from '@/data/demo';
import { ApproachExplorer, ObservedMovements } from './Approach';
import { DemoAirportOps, RunwayInUseCard } from './AirportOps';

type Tab = 'overview' | 'weather' | 'runways' | 'activity';

export function AirportPanel() {
  const ident = useUI((s) => s.selectedAirport);
  const open = useUI((s) => s.panel === 'airport') && !!ident;
  const selectAirport = useUI((s) => s.selectAirport);
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
      if (navigator.share) await navigator.share({ title: `${a.name} on Arnav Flight Radar`, url });
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
      </div>

      <Tabs
        label="Airport information"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'weather', label: 'Weather' },
          { id: 'runways', label: `Runways ${a.runways.length ? `(${a.runways.length})` : ''}` },
          { id: 'activity', label: 'Activity' },
        ]}
      />

      {tab === 'overview' && (
        <div className="space-y-4">
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
      {tab === 'activity' && <Activity a={a} />}
    </div>
  );
}

function Runways({ a }: { a: AirportDetail }) {
  const unit = useSettings((s) => s.units.altitude);
  const toM = unit === 'm';
  const len = (ft?: number) => (ft === undefined ? undefined : toM ? `${Math.round(ft * 0.3048).toLocaleString()} m` : `${ft.toLocaleString()} ft`);
  const demo = useDemo((s) => s.active);
  if (!a.runways.length) return <EmptyState icon={<RunwayIcon />} title="No runway data" body="OurAirports has no runway records for this airfield." />;
  return (
    <div className="space-y-3">
      <RunwayInUseCard a={a} demo={demo} />
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

function Activity({ a }: { a: AirportDetail }) {
  const demo = useDemo((s) => s.active);
  return demo ? <DemoAirportOps a={a} /> : <LiveActivity a={a} />;
}

function LiveActivity({ a }: { a: AirportDetail }) {
  useTrafficVersion();
  const units = useSettings((s) => s.units);
  const select = useUI((s) => s.select);
  const RADIUS = 30;
  const near = useMemo(
    () =>
      traffic
        .current()
        .map((ac) => ({ ac, d: distanceNm(a.lat, a.lon, ac.lat, ac.lon), b: bearingDeg(a.lat, a.lon, ac.lat, ac.lon) }))
        .filter((x) => x.d <= RADIUS)
        .sort((x, y) => x.d - y.d),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [a.lat, a.lon, traffic.version],
  );
  const covered = traffic.meta && distanceNm(traffic.meta.region.lat, traffic.meta.region.lon, a.lat, a.lon) + RADIUS <= traffic.meta.region.radiusNm;
  const ground = near.filter((x) => x.ac.onGround).length;
  const low = near.filter((x) => !x.ac.onGround && (x.ac.altitudeBarometric ?? x.ac.altitudeGeometric ?? 99999) < 10000);
  const desc = low.filter((x) => verticalState(x.ac.verticalRate) === 'descending').length;
  const climb = low.filter((x) => verticalState(x.ac.verticalRate) === 'climbing').length;

  return (
    <div className="space-y-3">
      {!covered && (
        <p className="rounded-[12px] border border-[rgba(255,181,71,0.3)] bg-[rgba(255,181,71,0.08)] px-3 py-2 text-[12px] text-[#ffd59a]">
          This airport is not fully inside the current live area. Fly to it to load nearby traffic.
        </p>
      )}
      <div className="grid grid-cols-4 gap-2 text-center">
        {[
          ['Within 30 NM', near.length],
          ['On ground', ground],
          ['Descending < 10k', desc],
          ['Climbing < 10k', climb],
        ].map(([l, v]) => (
          <div key={l} className="glass-2 rounded-[14px] px-1.5 py-2.5">
            <div className="tnum text-[18px] font-semibold text-fg">{v}</div>
            <div className="mt-0.5 text-[10px] leading-tight text-fg-3">{l}</div>
          </div>
        ))}
      </div>
      <RunwayInUseCard a={a} demo={false} />
      <ObservedMovements a={a} />
      <p className="text-[11px] text-fg-3">
        Observed aircraft near the airport right now. These are live observations, not an arrivals/departures schedule — origins and destinations are not
        provided by the data source and are never guessed.
      </p>
      {near.length === 0 ? (
        <EmptyState title="No aircraft observed nearby" body="Nothing is currently reported within 30 NM." />
      ) : (
        <ul className="glass-2 divide-y divide-[var(--line)] rounded-[16px]">
          {near.slice(0, 40).map(({ ac, d, b }) => (
            <li key={ac.id}>
              <button
                type="button"
                onClick={() => {
                  select(ac.id);
                  focusAircraft(ac.id, 11);
                }}
                className="flex w-full items-center gap-3 px-3.5 py-2 text-left hover:bg-[var(--line)]"
              >
                <AircraftGlyph cls={classifyAircraft(ac)} size={20} rotate={ac.track ?? 0} className="shrink-0 text-fg-2" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold text-fg">{ac.callsign ?? ac.registration ?? ac.icao24.toUpperCase()}</div>
                  <div className="truncate text-[11px] text-fg-3">{ac.typeDescription ?? ac.aircraftType ?? 'Type not reported'}</div>
                </div>
                <div className="tnum text-right text-[11.5px]">
                  <div className="text-fg">{fmtAltitude(ac.altitudeBarometric ?? ac.altitudeGeometric, units.altitude, ac.onGround)}</div>
                  <div className="text-fg-3">
                    {fmtDistance(d, units.distance)} · {fmtBearing(b)}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NearbyAirports({ a }: { a: AirportDetail }) {
  const selectAirport = useUI((s) => s.selectAirport);
  const unit = useSettings((s) => s.units.distance);
  const q = useQuery({ queryKey: ['major-airports'], queryFn: loadMajorAirports, staleTime: Infinity });
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
