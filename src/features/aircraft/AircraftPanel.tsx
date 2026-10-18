// Aircraft panel, laid out like the flight card of a commercial flight tracker:
// hero photo → airline & flight → route with progress and times → actions →
// flight / radio / load / aircraft / history / graph tabs. Everything shown is simulated.
import { Box, ChevronRight, Crosshair, Map as MapIcon, Pause, Play, Share2, Star, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { CLASS_LABEL, classifyAircraft, EMITTER_CATEGORY_LABEL } from '@shared/classify';
import { CompareIcon, FollowIcon, InspectorIcon } from '@/components/icons';
import { CopyButton, Row, Rows } from '@/components/ui/Data';
import { EmptyState, Skeleton } from '@/components/ui/Feedback';
import { GlassButton, IconButton } from '@/components/ui/Glass';
import { Panel } from '@/components/ui/Sheet';
import { specOf } from '@/data/sim/typeSpecs';
import { simFlight, simNow, simPrepareFlight, useSim, type FlightInfo } from '@/data/world';
import { cn } from '@/lib/cn';
import { fmtAltitude, fmtBearing, fmtCoord, fmtHmUTC, fmtSpeed, fmtTemp, fmtTimeUTC, fmtVRate } from '@/lib/format';
import { useNow, useSelectedTrack } from '@/lib/hooks';
import { fmtHmIn, useTimeZone } from '@/lib/tz';
import { shareUrl } from '@/lib/urlState';
import { viewPadding } from '@/map/camera';
import { focusAircraft, getMap, startFollow, stopFollow } from '@/map/controller';
import { useBookmarks } from '@/state/bookmarks';
import { useSettings } from '@/state/settings';
import { traffic, type Track } from '@/state/traffic';
import { useUI } from '@/state/ui';
import { RepresentativePhoto } from './AircraftPhoto';
import { EmergencyBanner, FlightPlan } from './FlightDetails';
import { AirlineBadge, AirlineLogo, AllianceBadge, FlightRoute, StatusChip } from './FlightParts';
import { AltitudeGauge, HeadingGauge, SpeedGauge, VerticalSpeedGauge } from './Gauges';
import { MakerLogo } from './MakerLogo';
import { TrailProfile } from './TrailProfile';

// The radio, load-sheet and history tabs (and their data) load the first time they are opened.
const RadioTab = lazy(() => import('./RadioTab').then((m) => ({ default: m.RadioTab })));
const LoadTab = lazy(() => import('./LoadTab').then((m) => ({ default: m.LoadTab })));
const HistoryTab = lazy(() => import('./HistoryTab').then((m) => ({ default: m.HistoryTab })));

type Tab = 'flight' | 'radio' | 'load' | 'aircraft' | 'history' | 'graph';

const TABS: { id: Tab; label: string }[] = [
  { id: 'flight', label: 'Flight' },
  { id: 'radio', label: 'Radio' },
  { id: 'load', label: 'Load' },
  { id: 'aircraft', label: 'Aircraft' },
  { id: 'history', label: 'History' },
  { id: 'graph', label: 'Graph' },
];

/** Compact tab bar that scrolls sideways on narrow screens (arrow keys move between tabs). */
function TabBar({ value, onChange }: { value: Tab; onChange: (t: Tab) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bar.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [value]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === value);
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -2;
    if (next === -2) return;
    e.preventDefault();
    const t = TABS[(next + TABS.length) % TABS.length]!;
    onChange(t.id);
    bar.current?.querySelector<HTMLElement>(`[data-tab="${t.id}"]`)?.focus();
  };
  return (
    <div ref={bar} className="-mx-5 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div role="tablist" aria-label="Aircraft information" onKeyDown={onKey} className="flex w-max min-w-full gap-0.5 border-b border-[var(--line)]">
        {TABS.map((t) => {
          const active = t.id === value;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              data-tab={t.id}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(t.id)}
              className={cn(
                'relative shrink-0 whitespace-nowrap rounded-t-[8px] px-2.5 pb-2.5 pt-1.5 text-[12.5px] font-medium transition-colors focus-visible:shadow-[var(--focus)]',
                active ? 'text-fg' : 'text-fg-3 hover:text-fg-2',
              )}
            >
              {t.label}
              {active && (
                <motion.span layoutId="aircraft-tab" className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-[var(--accent)]" transition={{ type: 'spring', stiffness: 500, damping: 36 }} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AircraftPanel() {
  useSim((s) => s.rev); // re-render when the simulation worker answers
  const selectedId = useUI((s) => s.selectedId);
  const panel = useUI((s) => s.panel);
  const select = useUI((s) => s.select);
  const open = panel === 'aircraft' && !!selectedId;
  const t = useSelectedTrack();
  const loading = useSim((s) => s.loading);

  return (
    <Panel open={open} onClose={() => select(null)} title="Aircraft" ariaLabel="Aircraft details" bare>
      {t ? (
        <AircraftDetails t={t} />
      ) : loading ? (
        <div className="space-y-4 p-5">
          <Skeleton className="aspect-[16/9] w-full" />
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
      ) : (
        <div className="p-5">
          <div className="flex justify-end">
            <IconButton label="Close" onClick={() => select(null)} size={34}>
              <X size={17} />
            </IconButton>
          </div>
          <EmptyState title="Aircraft not transmitting" body="This aircraft is parked with its transponder off, or the link comes from another day's simulation." />
        </div>
      )}
    </Panel>
  );
}

function GroundOps({ g, tz }: { g: NonNullable<FlightInfo['ground']>; tz: string | null }) {
  useNow(1000);
  const now = simNow();
  return (
    <div className="glass-2 rounded-[18px] p-3.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="eyebrow">Turnaround on stand</span>
        <span className="text-[10.5px] text-fg-3">simulated ground operations</span>
      </div>
      <ol className="space-y-1.5">
        {g.steps.map((s) => (
          <GroundStep key={s.label} label={s.label} t0={s.t0} t1={s.t1} tz={tz} now={now} />
        ))}
      </ol>
    </div>
  );
}

function GroundStep({ label, t0, t1, tz, now }: { label: string; t0: number; t1: number; tz: string | null; now: number }) {
  const done = now >= t1;
  const active = now >= t0 && now < t1;
  const pct = active ? Math.round(((now - t0) / Math.max(1, t1 - t0)) * 100) : done ? 100 : 0;
  return (
    <li className="grid grid-cols-[14px_1fr_auto] items-center gap-2.5">
      <span className={cn('size-2.5 rounded-full ring-2', done ? 'bg-[#3ddc97] ring-[rgba(61,220,151,0.25)]' : active ? 'bg-[#ffb547] ring-[rgba(255,181,71,0.3)]' : 'bg-transparent ring-[var(--line-strong)]')} />
      <div className="min-w-0">
        <div className={cn('text-[12.5px]', active ? 'font-semibold text-fg' : done ? 'text-fg-2' : 'text-fg-3')}>{label}</div>
        {active && (
          <div className="mt-1 h-1 rounded-full bg-[var(--line)]">
            <div className="h-1 rounded-full bg-[#ffb547]" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <span className="tnum text-[11px] text-fg-3">{fmtHmIn(t0, tz)}</span>
    </li>
  );
}

function AircraftDetails({ t }: { t: Track }) {
  useNow(1000);
  const [tab, setTab] = useState<Tab>('flight');
  const units = useSettings((s) => s.units);
  const following = useUI((s) => s.following);
  const followPaused = useUI((s) => s.followPaused);
  const chase = useUI((s) => s.chase);
  const select = useUI((s) => s.select);
  const selectAirline = useUI((s) => s.selectAirline);
  const selectType = useUI((s) => s.selectType);
  const setCompare = useUI((s) => s.setCompare);
  const compare = useUI((s) => s.compare);
  const openPanel = useUI((s) => s.openPanel);
  const toast = useUI((s) => s.toast);
  const favorites = useBookmarks((s) => s.aircraft);
  const toggleFav = useBookmarks((s) => s.toggleAircraft);
  const addRecent = useBookmarks((s) => s.addRecent);
  const showPhotos = useSettings((s) => s.showPhotos);

  const a = t.ac;
  const info = simFlight(a.id);
  const cls = classifyAircraft(a);
  const alt = a.altitudeBarometric ?? a.altitudeGeometric;
  const ident = info?.flightIata ?? a.callsign ?? a.registration ?? a.icao24.replace('~', '').toUpperCase();
  const isFav = favorites.some((f) => f.hex === a.icao24);
  const fromTz = useTimeZone(info?.from.lat, info?.from.lon);

  useEffect(() => {
    addRecent({ kind: 'aircraft', id: a.id, label: ident, sub: a.typeDescription ?? a.aircraftType, lat: a.lat, lon: a.lon });
    // Real (OpenStreetMap) taxiway names for the taxi clearances.
    simPrepareFlight(a.id);
    // Only when a different aircraft is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id]);

  const share = async () => {
    const url = shareUrl({ aircraft: a.id.replace(/^~/, '') });
    try {
      if (navigator.share) await navigator.share({ title: `${ident} on Arnav Flight Radar (simulated)`, url });
      else {
        await navigator.clipboard.writeText(url);
        toast({ kind: 'success', title: 'Link copied', body: 'Opens this simulated flight (links last for today’s simulation).' });
      }
    } catch {
      /* user cancelled */
    }
  };

  const fitRoute = () => {
    const m = getMap();
    if (!m || !info) return;
    const dest = info.canceledTo ?? info.to;
    const lons = [info.from.lon, dest.lon, a.lon];
    const lats = [info.from.lat, dest.lat, a.lat];
    m.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: { ...viewPadding(), top: viewPadding().top + 90, bottom: viewPadding().bottom + 90, left: viewPadding().left + 90, right: viewPadding().right + 90 }, duration: 1200, maxZoom: 9 },
    );
  };

  const onCompare = () => {
    const slot = compare[0] && compare[0] !== t.id ? 1 : 0;
    setCompare(slot, t.id);
    openPanel('compare');
  };

  return (
    <div className="flex min-h-full flex-col">
      {/* ------------------------------------------------ hero photo */}
      <div className="relative">
        {showPhotos ? (
          <RepresentativePhoto hero type={a.aircraftType} typeName={a.typeDescription} airlineIcao={info?.airline?.icao} airlineName={info?.airline?.name} />
        ) : (
          <div className="h-12" />
        )}
        <IconButton label="Close" shortcut="Esc" onClick={() => select(null)} size={34} variant="glass" className="!absolute right-3 top-3">
          <X size={17} />
        </IconButton>
      </div>

      {info?.emergency && (
        <div className="pt-3">
          <EmergencyBanner e={info.emergency} />
        </div>
      )}

      {/* ------------------------------------------------ airline & flight */}
      <div className="px-5 pb-3 pt-4">
        <div className="flex items-center gap-3">
          {info?.airline ? (
            <button type="button" onClick={() => selectAirline(info.airline!.icao)} title={`Open ${info.airline.name}`} className="shrink-0 rounded-[12px] focus-visible:shadow-[var(--focus)]">
              <AirlineLogo icao={info.airline.icao} code={info.airline.iata} size={36} name={info.airline.name} wide />
            </button>
          ) : (
            <AirlineBadge code="GA" size={36} />
          )}
          <div className="min-w-0 flex-1">
            <motion.h2 key={ident} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="truncate text-[26px] font-semibold leading-none tracking-[-0.03em] text-fg">
              {ident}
            </motion.h2>
            <p className="tnum mt-1 truncate text-[12px] text-fg-3">
              {a.callsign}
              {info?.airline ? ' · ' : ''}
              {info?.airline && (
                <button type="button" onClick={() => selectAirline(info.airline!.icao)} className="text-fg-2 hover:text-[var(--accent)] hover:underline">
                  {info.airline.name}
                </button>
              )}
            </p>
          </div>
          {info && <StatusChip status={info.status} />}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-[var(--line)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-2" title="Every aircraft on this map is simulated">
            Simulated
          </span>
          {info?.alliance && <AllianceBadge name={info.alliance} />}
          {info && info.codeshares.length > 0 && <span className="tnum text-[11px] text-fg-3">Also {info.codeshares.join(' · ')}</span>}
        </div>
      </div>

      {/* ------------------------------------------------ disruptions */}
      {info?.status === 'Canceled' && <Notice tone="danger">Canceled — the aircraft stays on its stand.</Notice>}
      {info?.divertedFrom && (
        <Notice tone="danger">
          Diverted from {info.divertedFrom.iata ?? info.divertedFrom.ident} ({info.divertedFrom.city ?? info.divertedFrom.name}): weather there is below limits.
        </Notice>
      )}
      {info?.status === 'Holding' && <Notice tone="warn">Holding for an arrival slot — about {info.holdMin} min planned.</Notice>}
      {info?.status === 'Go-around' && <Notice tone="warn">Went around and is flying a circuit for another approach.</Notice>}

      {/* ------------------------------------------------ route */}
      {info && (
        <div className="px-5 pb-3">
          <div className="glass-2 rounded-[20px] p-3.5">
            <FlightRoute info={info} />
          </div>
        </div>
      )}
      {info?.ground && (
        <div className="px-5 pb-3">
          <GroundOps g={info.ground} tz={fromTz} />
        </div>
      )}

      {/* ------------------------------------------------ actions */}
      <div className="flex flex-wrap items-center gap-1.5 px-5 pb-1">
        <GlassButton size="sm" variant={following && !followPaused && !chase ? 'accent' : 'subtle'} onClick={() => (following && !chase && !followPaused ? stopFollow() : startFollow(t.id))} aria-pressed={following && !chase}>
          {following && !followPaused && !chase ? <Pause size={14} /> : following && !chase ? <Play size={14} /> : <FollowIcon size={15} />}
          {following && !chase ? (followPaused ? 'Resume' : 'Following') : 'Follow'}
        </GlassButton>
        <GlassButton size="sm" variant={chase ? 'accent' : 'subtle'} onClick={() => (chase ? stopFollow() : startFollow(t.id, { chase: true }))} aria-pressed={chase}>
          <Box size={14} /> 3D view
        </GlassButton>
        <IconButton label="Show whole route" variant="glass" size={32} onClick={fitRoute} disabled={!info}>
          <MapIcon size={15} />
        </IconButton>
        <IconButton label="Centre on aircraft" variant="glass" size={32} onClick={() => focusAircraft(t.id, 10)}>
          <Crosshair size={15} />
        </IconButton>
        <IconButton label={isFav ? 'Remove from favourites' : 'Add to favourites'} variant="glass" size={32} active={isFav} onClick={() => toggleFav({ hex: a.icao24, label: ident, type: a.aircraftType })}>
          <Star size={15} fill={isFav ? 'currentColor' : 'none'} />
        </IconButton>
        <IconButton label="Share link" variant="glass" size={32} onClick={() => void share()}>
          <Share2 size={15} />
        </IconButton>
        <IconButton label="Compare with another aircraft" variant="glass" size={32} onClick={onCompare}>
          <CompareIcon size={16} />
        </IconButton>
        <IconButton label="Data inspector" variant="glass" size={32} onClick={() => openPanel('inspector')}>
          <InspectorIcon size={16} />
        </IconButton>
      </div>

      {/* ------------------------------------------------ tabs */}
      <div className="mt-3 px-5">
        <TabBar value={tab} onChange={setTab} />
      </div>
      <div className="flex-1 px-5 pb-5 pt-3.5">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
            {tab === 'flight' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2.5">
                  <AltitudeGauge ft={alt} onGround={a.onGround} />
                  <SpeedGauge kt={a.groundSpeed} mach={a.ext?.mach} />
                  <HeadingGauge track={a.track} heading={a.ext?.trueHeading} />
                  <VerticalSpeedGauge fpm={a.onGround ? undefined : a.verticalRate} />
                </div>
                {info && <FlightPlan info={info} />}
                <Rows>
                  <Row label="Barometric altitude" value={a.onGround ? 'On ground' : alt !== undefined ? fmtAltitude(alt, units.altitude) : undefined} mono />
                  <Row label="GPS altitude" value={a.altitudeGeometric !== undefined ? fmtAltitude(a.altitudeGeometric, units.altitude) : undefined} mono />
                  <Row label="Selected altitude" value={a.ext?.navAltitudeMcp !== undefined ? fmtAltitude(a.ext.navAltitudeMcp, units.altitude) : undefined} mono />
                  <Row label="Ground speed" value={a.groundSpeed !== undefined ? fmtSpeed(a.groundSpeed, units.speed) : undefined} mono />
                  <Row label="True airspeed" value={a.ext?.tas !== undefined ? fmtSpeed(a.ext.tas, units.speed) : undefined} mono />
                  <Row label="Mach" value={a.ext?.mach !== undefined ? a.ext.mach.toFixed(3) : undefined} mono />
                  <Row label="Vertical speed" value={a.verticalRate !== undefined && !a.onGround ? fmtVRate(a.verticalRate, units.verticalRate) : undefined} mono />
                  <Row label="Track" value={a.track !== undefined ? fmtBearing(a.track) : undefined} mono />
                  <Row label="Wind" value={a.ext?.windDirection !== undefined && a.ext.windSpeed !== undefined ? `${fmtBearing(a.ext.windDirection)} / ${fmtSpeed(a.ext.windSpeed, units.speed)}` : undefined} mono />
                  <Row label="Outside air temperature" value={a.ext?.outsideAirTemp !== undefined ? fmtTemp(a.ext.outsideAirTemp, units.temperature) : undefined} mono />
                  <Row label="Squawk" value={a.squawk} mono />
                  <Row label="Position" value={`${fmtCoord(a.lat)}, ${fmtCoord(a.lon)}`} mono copy={`${a.lat.toFixed(5)}, ${a.lon.toFixed(5)}`} />
                  <Row label="Updated" value={`${fmtTimeUTC(traffic.serverNow())}`} mono />
                </Rows>
              </div>
            )}
            {tab === 'aircraft' && (
              <Rows>
                <Row
                  label="Aircraft type"
                  value={
                    a.aircraftType ? (
                      <button
                        type="button"
                        onClick={() => a.aircraftType && selectType(a.aircraftType)}
                        title="Open aircraft type"
                        className="inline-flex max-w-full items-center gap-0.5 text-[var(--accent)] hover:underline"
                      >
                        <MakerLogo maker={specOf(a.aircraftType)?.maker} size={16} maxWidth={60} className="mr-1" />
                        <span className="truncate">{a.typeDescription ?? a.aircraftType}</span>
                        <ChevronRight size={13} className="shrink-0" />
                      </button>
                    ) : (
                      a.typeDescription
                    )
                  }
                />
                <Row label="Type code" value={a.aircraftType} mono />
                <Row label="Registration" value={a.registration} mono hint="Invented for the simulation" />
                <Row label="Mode-S code" value={a.icao24.replace('~', '').toUpperCase()} mono hint="Invented, inside the country's real address block" />
                <Row label="Airline" value={info?.airline?.name ?? 'Private / general aviation'} />
                <Row label="Alliance" value={info?.alliance} />
                <Row label="Country of airline" value={info?.airline?.country} />
                <Row label="Symbol" value={CLASS_LABEL[cls]} />
                <Row label="Wake category" value={a.category ? `${a.category} · ${EMITTER_CATEGORY_LABEL[a.category] ?? ''}` : undefined} />
                <Row label="Cruise level (planned)" value={info ? `FL${Math.round(info.cruiseFt / 100)}` : undefined} mono />
                <Row label="Route distance" value={info ? `${Math.round(info.totalNm).toLocaleString()} NM` : undefined} mono />
                <Row label="Departure (UTC)" value={info ? `${fmtHmUTC(info.std)} sched · ${info.atd ? fmtHmUTC(info.atd) : '—'} actual` : undefined} mono />
                <Row label="Arrival (UTC)" value={info ? `${fmtHmUTC(info.sta)} sched · ${fmtHmUTC(info.ata ?? info.eta)} ${info.ata ? 'actual' : 'est.'}` : undefined} mono />
              </Rows>
            )}
            <Suspense fallback={<Skeleton className="h-40 w-full rounded-[16px]" />}>
              {tab === 'radio' && <RadioTab key={a.id} id={a.id} />}
              {tab === 'load' && <LoadTab id={a.id} info={info} />}
              {tab === 'history' && <HistoryTab id={a.id} />}
            </Suspense>
            {tab === 'graph' && <GraphTab t={t} />}
          </motion.div>
        </AnimatePresence>
        <p className="mt-4 text-[11px] leading-relaxed text-fg-3">
          Simulated flight: the airline, airports and aircraft type are real; the flight, registration, schedule and telemetry are invented. Not for navigation.
        </p>
      </div>
    </div>
  );
}

function Notice({ tone, children }: { tone: 'warn' | 'danger'; children: ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        'mx-5 mb-3 rounded-[14px] px-3.5 py-2.5 text-[12px] leading-snug',
        tone === 'danger' ? 'bg-[rgba(255,93,115,0.12)] text-[#ffb3bd]' : 'bg-[rgba(255,181,71,0.12)] text-[#ffd59a]',
      )}
    >
      {children}
    </div>
  );
}

function GraphTab({ t }: { t: Track }) {
  const trailMode = useSettings((s) => s.trailColorMode);
  const setSetting = useSettings((s) => s.set);
  const pts = traffic.trailOf(t);
  const json = useMemo(() => JSON.stringify(pts), [pts]);
  return (
    <div className="space-y-3.5">
      <TrailProfile points={pts} />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] text-fg-3">Trail colour</span>
        {(['altitude', 'speed', 'vertical', 'time'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setSetting('trailColorMode', m)}
            aria-pressed={trailMode === m}
            className={cn(
              'h-7 rounded-full border px-2.5 text-[11.5px] font-medium capitalize',
              trailMode === m ? 'border-[color-mix(in_srgb,var(--accent)_45%,transparent)] text-[var(--accent)]' : 'border-[var(--line)] text-fg-3 hover:text-fg-2',
            )}
          >
            {m === 'vertical' ? 'climb rate' : m}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-fg-3">
        Altitude and speed since departure, sampled from the simulated path. <CopyButton text={json} label="Copy as JSON" />
      </p>
    </div>
  );
}
