import { LogOut, Orbit, Undo2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { classifyAircraft } from '@shared/classify';
import { AircraftGlyph, BrandMark, FollowIcon, MeasureIcon } from '@/components/icons';
import { GlassButton, IconButton } from '@/components/ui/Glass';
import { fmtAltitude, fmtBearing, fmtDistance, fmtSpeed } from '@/lib/format';
import { useSelectedTrack, useTrafficVersion } from '@/lib/hooks';
import { useIsMobile } from '@/lib/useMedia';
import { getMap, motionMs, startFollow, stopFollow } from '@/map/controller';
import { measureLegs } from '@/map/overlays';
import { useTour } from '@/map/tour';
import { useSettings } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { useUI } from '@/state/ui';
import { startDemo, stopDemo, useDemo } from '@/data/demo';
import { useFeed } from '@/data/feed';
import { LiveStatus } from './LiveStatus';

/** Following indicator + "Return to aircraft" after a manual camera move. */
export function FollowBanner() {
  const following = useUI((s) => s.following);
  const paused = useUI((s) => s.followPaused);
  const id = useUI((s) => s.selectedId);
  const t = useSelectedTrack();
  const label = t?.ac.callsign ?? t?.ac.registration ?? id?.toUpperCase();
  const lost = t ? traffic.stateOf(t) === 'lost' : true;
  return (
    <AnimatePresence>
      {following && id && (
        <motion.div
          initial={{ opacity: 0, y: -12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12, scale: 0.96 }}
          className="glass pointer-events-auto flex items-center gap-2.5 rounded-full py-1.5 pl-3.5 pr-1.5"
          role="status"
        >
          <FollowIcon size={16} className={paused ? 'text-fg-3' : 'text-[var(--color-amber)]'} />
          <span className="text-[12.5px] font-medium text-fg">
            {lost ? `Tracking lost — ${label}` : paused ? `Paused following ${label}` : `Following ${label}`}
          </span>
          {paused && !lost && (
            <GlassButton size="sm" variant="accent" className="!h-7 !rounded-full" onClick={() => startFollow(id)}>
              Return to aircraft
            </GlassButton>
          )}
          <IconButton label="Stop following" size={28} onClick={stopFollow}>
            <X size={14} />
          </IconButton>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function MeasureHUD() {
  const measure = useUI((s) => s.measure);
  const setMeasure = useUI((s) => s.setMeasure);
  const unit = useSettings((s) => s.units.distance);
  const mobile = useIsMobile();
  const legs = measureLegs(measure.points);
  const total = legs.reduce((a, l) => a + l.dist, 0);
  return (
    <AnimatePresence>
      {measure.active && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          className={`glass pointer-events-auto absolute left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-[18px] px-3.5 py-2 ${mobile ? 'bottom-[84px]' : 'bottom-[68px]'}`}
          role="status"
        >
          <MeasureIcon size={17} className="text-[var(--color-amber)]" />
          <div className="text-[12.5px]">
            {measure.points.length < 2 ? (
              <span className="text-fg-2">Click the map to place points</span>
            ) : (
              <span className="tnum font-semibold text-fg">
                {fmtDistance(total, unit)}
                {legs.length === 1 && <span className="ml-2 font-normal text-fg-3">bearing {fmtBearing(legs[0]!.brg)}</span>}
                {legs.length > 1 && <span className="ml-2 font-normal text-fg-3">{legs.length} legs</span>}
              </span>
            )}
          </div>
          <IconButton label="Undo last point" size={30} disabled={!measure.points.length} onClick={() => setMeasure({ points: measure.points.slice(0, -1) })}>
            <Undo2 size={14} />
          </IconButton>
          <GlassButton size="sm" variant="ghost" onClick={() => setMeasure({ active: false, points: [] })}>
            Done
          </GlassButton>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Minimal cinematic interface. */
export function PresentationOverlay() {
  const on = useUI((s) => s.presentation);
  const setOn = useUI((s) => s.setPresentation);
  const selectedId = useUI((s) => s.selectedId);
  const units = useSettings((s) => s.units);
  const t = useSelectedTrack();
  const [orbit, setOrbit] = useState(false);
  const raf = useRef(0);
  useTrafficVersion();

  useEffect(() => {
    if (!on) setOrbit(false);
  }, [on]);

  // Slow orbit around the selected aircraft (or map centre).
  useEffect(() => {
    if (!orbit) return;
    const m = getMap();
    if (!m) return;
    if (selectedId) startFollow(selectedId);
    m.easeTo({ pitch: 60, duration: motionMs(1200) });
    let last = performance.now();
    const loop = (now: number) => {
      raf.current = requestAnimationFrame(loop);
      const dt = now - last;
      last = now;
      if (!m.isMoving()) m.setBearing(m.getBearing() + dt * 0.006);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [orbit, selectedId]);

  return (
    <AnimatePresence>
      {on && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-0 z-40">
          <div className="pointer-events-auto absolute left-5 top-5 flex items-center gap-3">
            <BrandMark size={34} />
            <LiveStatus compact />
          </div>
          <div className="pointer-events-auto absolute right-5 top-5 flex gap-2">
            <GlassButton size="sm" variant={orbit ? 'accent' : 'glass'} onClick={() => setOrbit((o) => !o)}>
              <Orbit size={14} /> {orbit ? 'Stop orbit' : 'Cinematic orbit'}
            </GlassButton>
            <GlassButton
              size="sm"
              variant="glass"
              onClick={() => {
                setOrbit(false);
                if (useUI.getState().following) stopFollow();
                setOn(false);
              }}
            >
              <LogOut size={14} /> Exit
            </GlassButton>
          </div>
          <AnimatePresence>
            {t && (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="glass absolute bottom-6 left-6 flex items-center gap-5 rounded-[26px] px-6 py-4"
              >
                <AircraftGlyph cls={classifyAircraft(t.ac)} size={46} rotate={t.ac.track ?? 0} className="text-[var(--color-amber)]" />
                <div>
                  <div className="text-[26px] font-semibold leading-none tracking-[-0.03em]">{t.ac.callsign ?? t.ac.registration ?? t.ac.icao24.toUpperCase()}</div>
                  <div className="mt-1 text-[13px] text-fg-2">{t.ac.typeDescription ?? t.ac.aircraftType ?? ''}</div>
                </div>
                <div className="tnum grid grid-cols-3 gap-6 border-l border-[var(--line)] pl-5">
                  {[
                    ['Altitude', fmtAltitude(t.ac.altitudeBarometric ?? t.ac.altitudeGeometric, units.altitude, t.ac.onGround)],
                    ['Speed', fmtSpeed(t.ac.groundSpeed, units.speed)],
                    ['Track', fmtBearing(t.ac.track)],
                  ].map(([l, v]) => (
                    <div key={l}>
                      <div className="eyebrow">{l}</div>
                      <div className="mt-1 text-[17px] font-semibold">{v}</div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <p className="absolute bottom-3 right-5 text-[10.5px] text-fg-3">Live data: adsb.fi · Map: OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors · Esc to exit</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function RadarSweep() {
  const on = useSettings((s) => s.radarSweep);
  const motionLevel = useSettings((s) => s.motion);
  if (!on || motionLevel === 'off') return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden" aria-hidden="true">
      <div className="radar-scan absolute left-1/2 top-1/2 aspect-square w-[160vmax] -translate-x-1/2 -translate-y-1/2" />
    </div>
  );
}

export function TourBadge() {
  const running = useTour((s) => s.running);
  const stop = useTour((s) => s.stop);
  return (
    <AnimatePresence>
      {running && stop && (
        <motion.div
          key={stop}
          initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -10, filter: 'blur(6px)' }}
          className="pointer-events-none absolute left-1/2 top-[30%] z-20 -translate-x-1/2 text-center"
        >
          <div className="eyebrow">Hub tour</div>
          <div className="mt-1 text-[44px] font-semibold tracking-[-0.04em] text-fg drop-shadow-[0_4px_30px_rgba(0,0,0,0.6)]">{stop}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Honest notices: provider outage/refusal, or nothing reported in the live area. */
export function CoverageNotice() {
  useTrafficVersion();
  const openPanel = useUI((s) => s.openPanel);
  const following = useUI((s) => s.following);
  const status = useFeed((s) => s.status);
  const message = useFeed((s) => s.message);
  const code = useFeed((s) => s.errorCode);
  const demo = useDemo((s) => s.active);
  const meta = traffic.meta;
  const outage = !demo && (status === 'error' || (status === 'degraded' && !!code));
  const empty = !demo && !outage && !!meta && meta.count === 0 && !following;
  const show = outage || empty;
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key={outage ? 'outage' : 'empty'}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          role={outage ? 'alert' : 'status'}
          className="glass pointer-events-auto w-[min(460px,calc(100vw-24px))] rounded-[18px] px-4 py-3"
        >
          {outage ? (
            <>
              <p className="text-[13px] font-semibold text-fg">
                {code === 'upstream_forbidden' ? 'Live aircraft data is unavailable' : status === 'degraded' ? 'Live data is delayed' : 'Live data is temporarily unavailable'}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-fg-2">
                {message ?? 'The aircraft data provider could not be reached.'} Nothing is simulated in its place.{' '}
                <button type="button" className="font-medium text-[var(--accent)] hover:underline" onClick={() => openPanel('data')}>
                  Provider status
                </button>
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <GlassButton size="sm" onClick={() => getMap() && void startDemo(getMap()!)}>
                  Explore with simulated demo traffic
                </GlassButton>
                <span className="text-[11px] text-fg-3">Clearly labelled; never mixed with live data.</span>
              </div>
            </>
          ) : (
            <>
              <p className="text-[13px] font-semibold text-fg">No aircraft reported in this area right now</p>
              <p className="mt-1 text-[12px] leading-relaxed text-fg-2">
                adsb.fi relies on volunteer receivers, and coverage here is currently thin or absent. Nothing is simulated to fill the gap.{' '}
                <button type="button" className="font-medium text-[var(--accent)] hover:underline" onClick={() => openPanel('data')}>
                  Coverage details
                </button>
              </p>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Persistent, unmissable label while demo mode is on. */
export function DemoBanner() {
  const demo = useDemo((s) => s.active);
  return (
    <AnimatePresence>
      {demo && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          role="status"
          className="pointer-events-auto flex items-center gap-3 rounded-full border border-[rgba(167,139,250,0.45)] bg-[rgba(76,52,160,0.82)] py-1.5 pl-4 pr-1.5 text-[12.5px] text-white shadow-xl backdrop-blur-md"
        >
          <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.14em]">Demo</span>
          <span className="font-medium max-[420px]:hidden">Simulated aircraft — not real flights</span>
          <button type="button" onClick={stopDemo} className="rounded-full bg-white px-3 py-1 text-[12px] font-semibold text-[#2c1d6b] hover:bg-white/90">
            Exit demo
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Top-centre stack so banners never overlap each other. */
export function TopNotices() {
  const mobile = useIsMobile();
  return (
    <div className={`pointer-events-none absolute left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-2 ${mobile ? 'top-[68px]' : 'top-[84px]'}`}>
      <DemoBanner />
      <FollowBanner />
      <CoverageNotice />
    </div>
  );
}
