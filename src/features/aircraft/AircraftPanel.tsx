import { Crosshair, Pause, Play, Share2, Star, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { classificationBasis, classifyAircraft, CLASS_LABEL, EMITTER_CATEGORY_LABEL, SPECIAL_SQUAWKS } from '@shared/classify';
import { countryFromIcao } from '@shared/icaoCountry';
import type { TrackState } from '@shared/types';
import { AircraftGlyph, CompareIcon, FollowIcon, InspectorIcon } from '@/components/icons';
import { Badge, EmptyState, FreshnessBadge, Skeleton } from '@/components/ui/Feedback';
import { CopyButton, Row, Rows, Tabs } from '@/components/ui/Data';
import { GlassButton, IconButton } from '@/components/ui/Glass';
import { Panel } from '@/components/ui/Sheet';
import { lookupAndSelect } from '@/data/feed';
import { aircraftColor } from '@/lib/colors';
import { cn } from '@/lib/cn';
import {
  fmtAge,
  fmtAltitude,
  fmtBearing,
  fmtCoord,
  fmtDateTimeUTC,
  fmtDistance,
  fmtNumber,
  fmtSpeed,
  fmtTemp,
  fmtTimeUTC,
  fmtVRate,
} from '@/lib/format';
import { useNow, useSelectedTrack } from '@/lib/hooks';
import { shareUrl } from '@/lib/urlState';
import { focusAircraft, startFollow, stopFollow } from '@/map/controller';
import { useBookmarks } from '@/state/bookmarks';
import { useSettings } from '@/state/settings';
import { traffic, type Track } from '@/state/traffic';
import { useUI } from '@/state/ui';
import { airlinePrefix, useAirline } from '@/data/airlines';
import { demoFlight } from '@/data/demo';
import { AircraftPhoto, RepresentativePhoto } from './AircraftPhoto';
import { RouteCard } from './RouteCard';
import { AltitudeGauge, HeadingGauge, SpeedGauge, VerticalSpeedGauge } from './Gauges';
import { TrailProfile } from './TrailProfile';

type Tab = 'overview' | 'position' | 'technical' | 'trail';

const SOURCE_LABEL: Record<string, string> = {
  adsb: 'ADS-B',
  mlat: 'MLAT',
  tisb: 'TIS-B',
  adsr: 'ADS-R',
  adsc: 'ADS-C',
  modes: 'Mode S',
  other: 'Other',
};

export function AircraftPanel() {
  const selectedId = useUI((s) => s.selectedId);
  const panel = useUI((s) => s.panel);
  const select = useUI((s) => s.select);
  const open = panel === 'aircraft' && !!selectedId;
  const t = useSelectedTrack();
  const [lookup, setLookup] = useState<'idle' | 'loading' | 'missing'>('idle');

  // Deep links / search results may select an aircraft we have not polled yet.
  useEffect(() => {
    if (!selectedId || traffic.get(selectedId)) {
      setLookup('idle');
      return;
    }
    if (selectedId.startsWith('~')) {
      setLookup('missing');
      return;
    }
    let cancelled = false;
    setLookup('loading');
    void lookupAndSelect(selectedId).then((ok) => {
      if (cancelled) return;
      setLookup(ok ? 'idle' : 'missing');
      if (ok) focusAircraft(selectedId, 8.5);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  return (
    <Panel open={open} onClose={() => select(null)} title="Aircraft" ariaLabel="Aircraft details" bare>
      {t ? (
        <AircraftDetails t={t} />
      ) : lookup === 'loading' ? (
        <div className="space-y-4 p-5">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-56" />
          <div className="grid grid-cols-2 gap-2.5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[104px] rounded-[18px]" />
            ))}
          </div>
        </div>
      ) : (
        <div className="p-5">
          <div className="flex justify-end">
            <IconButton label="Close" onClick={() => select(null)} size={34}>
              <X size={17} />
            </IconButton>
          </div>
          <EmptyState
            title="Aircraft not currently reported"
            body={`No current position for ${selectedId?.toUpperCase()} from adsb.fi. It may be on the ground with its transponder off, or outside receiver coverage.`}
          />
        </div>
      )}
    </Panel>
  );
}

function AircraftDetails({ t }: { t: Track }) {
  const now = useNow(1000);
  const [tab, setTab] = useState<Tab>('overview');
  const units = useSettings((s) => s.units);
  const colorMode = useSettings((s) => s.colorMode);
  const palette = useSettings((s) => s.altitudePalette);
  const following = useUI((s) => s.following);
  const followPaused = useUI((s) => s.followPaused);
  const select = useUI((s) => s.select);
  const setCompare = useUI((s) => s.setCompare);
  const compare = useUI((s) => s.compare);
  const openPanel = useUI((s) => s.openPanel);
  const toast = useUI((s) => s.toast);
  const favorites = useBookmarks((s) => s.aircraft);
  const toggleFav = useBookmarks((s) => s.toggleAircraft);
  const addRecent = useBookmarks((s) => s.addRecent);

  const a = t.ac;
  const cls = classifyAircraft(a);
  const state: TrackState = traffic.stateOf(t, now);
  const age = traffic.ageMs(t, now);
  const country = countryFromIcao(a.icao24);
  const alt = a.altitudeBarometric ?? a.altitudeGeometric;
  const ident = a.callsign ?? a.registration ?? a.icao24.toUpperCase();
  const isFav = favorites.some((f) => f.hex === a.icao24);
  const special = a.squawk ? SPECIAL_SQUAWKS[a.squawk] : undefined;
  const demo = a.provider === 'demo';
  const showPhotos = useSettings((s) => s.showPhotos);
  const hiddenPhotos = useBookmarks((s) => s.hiddenPhotos);
  const toggleHiddenPhoto = useBookmarks((s) => s.toggleHiddenPhoto);
  const photoHidden = hiddenPhotos.includes(a.icao24);
  const operator = useAirline(demo ? undefined : a.callsign);
  const demoAirline = demo ? demoFlight(a.id)?.airline : undefined;
  const glow = aircraftColor(colorMode, palette, { onGround: a.onGround, alt, gs: a.groundSpeed, vr: a.verticalRate, stale: state !== 'live' });

  useEffect(() => {
    addRecent({ kind: 'aircraft', id: a.icao24, label: ident, sub: a.typeDescription ?? a.aircraftType, lat: a.lat, lon: a.lon });
    // Only when a different aircraft is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.icao24]);

  const share = async () => {
    const url = shareUrl({ aircraft: a.icao24 });
    try {
      if (navigator.share) await navigator.share({ title: `${ident} on Arnav Flight Radar`, url });
      else {
        await navigator.clipboard.writeText(url);
        toast({ kind: 'success', title: 'Link copied', body: 'Anyone with the link will open this aircraft.' });
      }
    } catch {
      /* user cancelled */
    }
  };

  const onFollow = () => {
    if (following && !followPaused) stopFollow();
    else startFollow(t.id);
  };

  const onCompare = () => {
    const slot = compare[0] && compare[0] !== t.id ? 1 : 0;
    setCompare(slot, t.id);
    openPanel('compare');
  };

  return (
    <div className="flex min-h-full flex-col">
      {/* ------------------------------------------------ hero */}
      <div className="relative overflow-hidden px-5 pb-4 pt-4">
        <div
          className="pointer-events-none absolute -right-10 -top-16 size-64 rounded-full opacity-30 blur-3xl"
          style={{ background: `radial-gradient(circle, ${glow}, transparent 65%)` }}
          aria-hidden="true"
        />
        <div className="relative flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <FreshnessBadge state={demo ? 'demo' : state} age={demo ? undefined : fmtAge(age)} />
              <Badge tone="accent" title="How the position was determined">
                {SOURCE_LABEL[a.positionSource]}
              </Badge>
              {a.military && <Badge tone="violet">Military</Badge>}
              {(a.emergency || special) && (
                <Badge tone="danger" title={special ?? a.emergency}>
                  {a.squawk && special ? `${a.squawk} · ${special}` : `Emergency: ${a.emergency}`}
                </Badge>
              )}
            </div>
            <motion.h2
              key={ident}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-2.5 truncate text-[28px] font-semibold leading-none tracking-[-0.03em] text-fg"
            >
              {ident}
            </motion.h2>
            <p className="mt-1.5 truncate text-[13px] text-fg-2">
              {a.typeDescription ?? (a.aircraftType ? `Type ${a.aircraftType}` : CLASS_LABEL[cls])}
            </p>
            <p className="tnum mt-1 flex flex-wrap gap-x-2 text-[12px] text-fg-3">
              {a.registration && <span>{a.registration}</span>}
              <span>{a.icao24.toUpperCase()}</span>
              {country && <span title="State of registry from the ICAO 24-bit address block">{country.name}</span>}
            </p>
          </div>
          <div className="relative grid size-[84px] shrink-0 place-items-center">
            <div className="absolute inset-0 rounded-full border border-[var(--line)]" />
            <div className="absolute inset-3 rounded-full border border-dashed border-[var(--line)]" />
            <motion.div initial={{ rotate: 0, scale: 0.6, opacity: 0 }} animate={{ rotate: a.track ?? 0, scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 120, damping: 16 }}>
              <AircraftGlyph cls={cls} size={58} style={{ color: glow, filter: `drop-shadow(0 0 14px ${glow}66)` }} />
            </motion.div>
          </div>
          <IconButton label="Close" shortcut="Esc" onClick={() => select(null)} size={34} className="-mr-2 -mt-1">
            <X size={17} />
          </IconButton>
        </div>

        <div className="relative mt-4 flex flex-wrap items-center gap-1.5">
          <GlassButton size="sm" variant={following && !followPaused ? 'accent' : 'subtle'} onClick={onFollow} aria-pressed={following}>
            {following && !followPaused ? <Pause size={14} /> : following ? <Play size={14} /> : <FollowIcon size={15} />}
            {following ? (followPaused ? 'Resume follow' : 'Following') : 'Follow'}
          </GlassButton>
          <IconButton label="Centre on aircraft" variant="glass" size={32} onClick={() => focusAircraft(t.id, 10)}>
            <Crosshair size={15} />
          </IconButton>
          <IconButton label={isFav ? 'Remove from favourites' : 'Add to favourites'} variant="glass" size={32} active={isFav} onClick={() => toggleFav({ hex: a.icao24, label: ident, type: a.aircraftType })}>
            <Star size={15} fill={isFav ? 'currentColor' : 'none'} />
          </IconButton>
          <IconButton label="Share link" variant="glass" size={32} disabled={demo} onClick={() => void share()}>
            <Share2 size={15} />
          </IconButton>
          <IconButton label="Compare with another aircraft" variant="glass" size={32} onClick={onCompare}>
            <CompareIcon size={16} />
          </IconButton>
          <IconButton label="Data inspector" variant="glass" size={32} onClick={() => openPanel('inspector')}>
            <InspectorIcon size={16} />
          </IconButton>
        </div>
      </div>

      {demo && (
        <div role="status" className="mx-5 mb-3 rounded-[14px] border border-[rgba(167,139,250,0.4)] bg-[rgba(167,139,250,0.1)] px-3.5 py-2.5 text-[12px] leading-snug text-[#d8cdfd]">
          Simulated flight (demo mode). The airline, airports and aircraft type are real; the flight, registration, schedule and telemetry are invented. It is not a real aircraft.
        </div>
      )}
      <div className="px-5 pb-3 empty:hidden">
        <RouteCard ac={a} />
      </div>
      {!demo && a.privacy && (
        <p className="mx-5 mb-3 rounded-[14px] border border-[var(--line)] px-3.5 py-2.5 text-[11.5px] leading-snug text-fg-3">
          {a.privacy === 'ladd'
            ? 'The owner of this aircraft asked for limited display (FAA LADD). Photos are not shown.'
            : 'This aircraft uses a privacy ICAO address (PIA). Photos are not shown.'}
        </p>
      )}
      {!demo && showPhotos && !a.privacy && !a.icao24.startsWith('~') && !photoHidden && (
        <div className="px-5 pb-3">
          <AircraftPhoto
            hex={a.icao24}
            registration={a.registration}
            type={a.aircraftType}
            typeName={a.typeDescription}
            airlineIcao={airlinePrefix(a.callsign)}
            airlineName={operator.data?.name}
          />
        </div>
      )}
      {demo && showPhotos && (
        <div className="px-5 pb-3">
          <RepresentativePhoto type={a.aircraftType} typeName={a.typeDescription} airlineIcao={demoAirline?.icao} airlineName={demoAirline?.name} />
        </div>
      )}
      {!demo && photoHidden && (
        <p className="mx-5 mb-3 flex items-center justify-between gap-2 text-[11.5px] text-fg-3">
          Photos hidden for this aircraft.
          <button type="button" className="font-medium text-[var(--accent)] hover:underline" onClick={() => toggleHiddenPhoto(a.icao24)}>
            Show photos
          </button>
        </p>
      )}

      {/* ------------------------------------------------ state banners */}
      <AnimatePresence>
        {(state === 'lost' || t.outsideRegion || state === 'stale') && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden px-5">
            <div
              role="status"
              className={cn(
                'mb-3 rounded-[14px] border px-3.5 py-2.5 text-[12px] leading-snug',
                state === 'lost' ? 'border-[rgba(255,93,115,0.3)] bg-[rgba(255,93,115,0.08)] text-[#ffb3bd]' : 'border-[rgba(255,181,71,0.3)] bg-[rgba(255,181,71,0.08)] text-[#ffd59a]',
              )}
            >
              {state === 'lost'
                ? `Tracking lost — the provider stopped reporting this aircraft. Last position ${fmtAge(age)} ago is shown and is no longer updating.`
                : t.outsideRegion
                  ? 'Outside the live area — this aircraft is being updated with single-aircraft lookups.'
                  : `Position is ${fmtAge(age)} old. The aircraft may be leaving receiver coverage.`}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------ gauges */}
      <div className="grid grid-cols-2 gap-2.5 px-5">
        <AltitudeGauge ft={alt} onGround={a.onGround} />
        <SpeedGauge kt={a.groundSpeed} mach={a.ext?.mach} />
        <HeadingGauge track={a.track} heading={a.ext?.trueHeading} />
        <VerticalSpeedGauge fpm={a.onGround ? undefined : a.verticalRate} />
      </div>

      {/* ------------------------------------------------ tabs */}
      <div className="mt-4 px-5">
        <Tabs
          label="Aircraft information"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'position', label: 'Position' },
            { id: 'technical', label: 'Technical' },
            { id: 'trail', label: 'Trail' },
          ]}
        />
      </div>
      <div className="flex-1 px-5 pb-5 pt-3.5">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}>
            {tab === 'overview' && (
              <Rows>
                <Row label="Callsign" value={a.callsign} mono />
                <Row label="Registration" value={a.registration} mono />
                <Row label="ICAO address" value={a.icao24.toUpperCase()} mono copy={a.icao24} />
                <Row label="Type code" value={a.aircraftType} mono />
                <Row label="Type" value={a.typeDescription} />
                <Row label="Symbol class" value={CLASS_LABEL[cls]} hint={classificationBasis(a)} />
                <Row label="Classified by" value={classificationBasis(a)} />
                <Row label="Emitter category" value={a.category ? `${a.category} · ${EMITTER_CATEGORY_LABEL[a.category] ?? 'Unknown'}` : undefined} />
                <Row label="Owner / operator" value={a.ext?.ownerOperator} />
                <Row label="Registry country" value={country?.name} hint="From the ICAO 24-bit address allocation" />
                <Row label="Squawk" value={a.squawk ? `${a.squawk}${special ? ` · ${special}` : ''}` : undefined} mono />
                <Row label="Data source" value={demo ? 'Simulated (demo mode)' : `adsb.fi · ${SOURCE_LABEL[a.positionSource]}`} />
                <Row label="Origin / destination" value={undefined} hint="Not provided by the permitted data source; never inferred." />
              </Rows>
            )}
            {tab === 'position' && (
              <Rows>
                <Row label="Latitude" value={fmtCoord(a.lat)} mono />
                <Row label="Longitude" value={fmtCoord(a.lon)} mono copy={`${a.lat.toFixed(5)}, ${a.lon.toFixed(5)}`} />
                <Row label="Barometric altitude" value={a.onGround ? 'On ground' : a.altitudeBarometric !== undefined ? fmtAltitude(a.altitudeBarometric, units.altitude) : undefined} mono />
                <Row label="Geometric altitude" value={a.altitudeGeometric !== undefined ? fmtAltitude(a.altitudeGeometric, units.altitude) : undefined} mono hint="GNSS height above the WGS-84 ellipsoid" />
                <Row label="Ground speed" value={a.groundSpeed !== undefined ? fmtSpeed(a.groundSpeed, units.speed) : undefined} mono />
                <Row label="Track (true)" value={a.track !== undefined ? fmtBearing(a.track) : undefined} mono />
                <Row label="Heading (true)" value={a.ext?.trueHeading !== undefined ? fmtBearing(a.ext.trueHeading) : undefined} mono />
                <Row label="Heading (magnetic)" value={a.ext?.magHeading !== undefined ? fmtBearing(a.ext.magHeading) : undefined} mono />
                <Row label="Vertical rate" value={a.verticalRate !== undefined ? fmtVRate(a.verticalRate, units.verticalRate) : undefined} mono />
                <Row label="On ground" value={a.onGround ? 'Yes' : 'No'} />
                <Row label="Position time" value={fmtDateTimeUTC(a.observedAt)} mono />
                <Row label="Position age" value={fmtAge(age)} mono />
                <Row label="Last message" value={`${fmtAge(traffic.serverNow(now) - a.seenAt)} ago`} mono />
                <Row label="From area centre" value={a.distanceNm !== undefined ? fmtDistance(a.distanceNm, units.distance) : undefined} mono />
              </Rows>
            )}
            {tab === 'technical' && (
              <Rows>
                <Row label="Indicated airspeed" value={a.ext?.ias !== undefined ? fmtSpeed(a.ext.ias, units.speed) : undefined} mono />
                <Row label="True airspeed" value={a.ext?.tas !== undefined ? fmtSpeed(a.ext.tas, units.speed) : undefined} mono />
                <Row label="Mach" value={a.ext?.mach !== undefined ? a.ext.mach.toFixed(3) : undefined} mono />
                <Row label="Roll angle" value={a.ext?.roll !== undefined ? `${a.ext.roll.toFixed(1)}°` : undefined} mono />
                <Row label="Selected altitude" value={a.ext?.navAltitudeMcp !== undefined ? fmtAltitude(a.ext.navAltitudeMcp, units.altitude) : undefined} mono hint="MCP/FCU selected altitude broadcast by the aircraft" />
                <Row label="FMS altitude" value={a.ext?.navAltitudeFms !== undefined ? fmtAltitude(a.ext.navAltitudeFms, units.altitude) : undefined} mono />
                <Row label="Selected heading" value={a.ext?.navHeading !== undefined ? fmtBearing(a.ext.navHeading) : undefined} mono />
                <Row label="Altimeter (QNH)" value={a.ext?.navQnh !== undefined ? `${a.ext.navQnh.toFixed(1)} hPa` : undefined} mono />
                <Row label="Wind (aircraft-derived)" value={a.ext?.windDirection !== undefined && a.ext.windSpeed !== undefined ? `${fmtBearing(a.ext.windDirection)} / ${fmtSpeed(a.ext.windSpeed, units.speed)}` : undefined} mono />
                <Row label="Outside air temp" value={a.ext?.outsideAirTemp !== undefined ? fmtTemp(a.ext.outsideAirTemp, units.temperature) : undefined} mono />
                <Row label="NIC / NACp / SIL" value={a.ext?.nic !== undefined || a.ext?.nacP !== undefined ? `${a.ext?.nic ?? '—'} / ${a.ext?.nacP ?? '—'} / ${a.ext?.sil ?? '—'}` : undefined} mono hint="Integrity and accuracy categories reported in ADS-B" />
                <Row label="ADS-B version" value={a.ext?.adsbVersion} mono />
                <Row label="Signal (RSSI)" value={a.ext?.rssi !== undefined ? `${a.ext.rssi.toFixed(1)} dBFS` : undefined} mono hint="At the best receiving feeder" />
                <Row label="Messages" value={a.ext?.messages !== undefined ? fmtNumber(a.ext.messages) : undefined} mono />
                <Row label="Military flag" value={a.military ? 'Yes (provider database)' : 'Not flagged'} />
              </Rows>
            )}
            {tab === 'trail' && <TrailTab t={t} />}
          </motion.div>
        </AnimatePresence>
        <p className="mt-4 text-[11px] leading-relaxed text-fg-3">
          Informational only — not for navigation. Positions are interpolated between real reports for smooth motion; the hollow ring marks the latest
          reported position.
        </p>
      </div>
    </div>
  );
}

function TrailTab({ t }: { t: Track }) {
  const units = useSettings((s) => s.units);
  const trailMode = useSettings((s) => s.trailColorMode);
  const setSetting = useSettings((s) => s.set);
  const pts = traffic.trailOf(t);
  const duration = pts.length > 1 ? pts[pts.length - 1]!.t - pts[0]!.t : 0;
  const gaps = pts.filter((p) => p.gap).length;
  const recent = useMemo(() => [...pts].reverse().slice(0, 40), [pts]);
  return (
    <div className="space-y-3.5">
      <TrailProfile points={pts} />
      <div className="flex flex-wrap gap-1.5">
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
            {m}
          </button>
        ))}
      </div>
      <Rows>
        <Row label="Observed points" value={String(pts.length)} mono />
        <Row label="Span" value={fmtAge(duration)} mono />
        <Row label="Data gaps (not bridged)" value={String(gaps)} mono />
        <Row label="First observed" value={pts[0] ? fmtDateTimeUTC(pts[0].t) : undefined} mono />
      </Rows>
      <div>
        <h4 className="eyebrow mb-2">Observed positions</h4>
        <div className="glass-2 scroll-thin max-h-64 overflow-y-auto rounded-[14px]">
          <table className="tnum w-full text-[11.5px]">
            <thead className="sticky top-0 bg-[var(--surface-solid)] text-fg-3">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Time (UTC)</th>
                <th className="px-2 py-2 text-right font-medium">Altitude</th>
                <th className="px-3 py-2 text-right font-medium">Speed</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((p, i) => (
                <tr key={`${p.t}-${i}`} className={cn('border-t border-[var(--line)]', p.gap && 'border-t-2 border-dashed')}>
                  <td className="px-3 py-1.5 text-fg-2">{fmtTimeUTC(p.t)}</td>
                  <td className="px-2 py-1.5 text-right text-fg">{p.alt === undefined ? '—' : fmtAltitude(p.alt, units.altitude, p.alt === 0)}</td>
                  <td className="px-3 py-1.5 text-right text-fg">{p.gs === undefined ? '—' : fmtSpeed(p.gs, units.speed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-fg-3">Trail contains only positions received during this session. <CopyButton text={JSON.stringify(pts)} label="Copy trail as JSON" /></p>
      </div>
    </div>
  );
}
