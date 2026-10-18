import { LogOut, Orbit, Shuffle, Undo2, Volume2, VolumeX, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { classifyAircraft } from '@shared/classify';
import { AircraftGlyph, BrandMark, FollowIcon, MeasureIcon } from '@/components/icons';
import { GlassButton, IconButton } from '@/components/ui/Glass';
import { type FlightSoundHandle, type FlightSoundState, soundKindFor, startFlightSound } from '@/lib/flightSound';
import { fmtAltitude, fmtBearing, fmtDistance, fmtSpeed } from '@/lib/format';
import { useNow, useSelectedTrack, useTrafficVersion } from '@/lib/hooks';
import { useIsMobile } from '@/lib/useMedia';
import { followRandomFlight, getMap, motionMs, startFollow, stopFollow } from '@/map/controller';
import { solarElevation, subsolarPoint } from '@/map/extraOverlays';
import { measureLegs } from '@/map/overlays';
import { useView } from '@/state/view';
import { useTour } from '@/map/tour';
import { useSettings } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { useUI } from '@/state/ui';
import { simNow } from '@/data/world';
import { LiveStatus } from './LiveStatus';

const SOUND_PREF = 'arnav:followSound';

function readSoundPref(): boolean {
  try {
    return localStorage.getItem(SOUND_PREF) === '1';
  } catch {
    return false;
  }
}

/** Live sound parameters for the followed aircraft (polled by the sound engine). */
function followedSoundState(): FlightSoundState | null {
  const s = useUI.getState();
  if (!s.following) return null;
  const tr = traffic.get(s.selectedId);
  if (!tr || traffic.stateOf(tr) === 'lost') return null;
  const ac = tr.ac;
  return {
    kind: soundKindFor(classifyAircraft(ac)),
    onGround: ac.onGround,
    gs: ac.groundSpeed ?? 0,
    vr: ac.verticalRate ?? 0,
    alt: ac.altitudeBarometric ?? ac.altitudeGeometric ?? 0,
  };
}

/** Following indicator + "Return to aircraft" after a manual camera move. */
export function FollowBanner() {
  const following = useUI((s) => s.following);
  const paused = useUI((s) => s.followPaused);
  const id = useUI((s) => s.selectedId);
  const t = useSelectedTrack();
  const label = t?.ac.callsign ?? t?.ac.registration ?? id?.toUpperCase();
  const lost = t ? traffic.stateOf(t) === 'lost' : true;
  const [soundOn, setSoundOn] = useState(readSoundPref);
  const sound = useRef<FlightSoundHandle | null>(null);
  const active = following && !!id;

  // Tear down when following stops; resume a remembered preference on a new follow.
  useEffect(() => {
    if (!active || !soundOn) {
      sound.current?.stop();
      sound.current = null;
    } else if (!sound.current) sound.current = startFlightSound(followedSoundState);
  }, [active, soundOn]);
  useEffect(
    () => () => {
      sound.current?.stop();
      sound.current = null;
    },
    [],
  );

  const toggleSound = () => {
    const next = !soundOn;
    try {
      localStorage.setItem(SOUND_PREF, next ? '1' : '0');
    } catch {
      /* preference simply won't persist */
    }
    // Start inside the click handler so the AudioContext satisfies autoplay policy.
    if (next && !sound.current) sound.current = startFlightSound(followedSoundState);
    if (!next) {
      sound.current?.stop();
      sound.current = null;
    }
    setSoundOn(next);
  };
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
          <IconButton label={soundOn ? 'Sound off' : 'Sound on'} size={28} onClick={toggleSound}>
            {soundOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </IconButton>
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
            <GlassButton size="sm" variant="glass" onClick={() => followRandomFlight()}>
              <Shuffle size={14} /> Random flight
            </GlassButton>
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
          <p className="absolute bottom-3 right-5 text-[10.5px] text-fg-3">Simulated traffic · Map: OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors · Esc to exit</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Sweep colour from the sun's elevation at the map centre: cyan by day, amber at twilight, phosphor green at night. */
function sweepColor(elev: number): string {
  const day = [92, 225, 255, 0.075];
  const dusk = [255, 168, 92, 0.085];
  const night = [90, 255, 170, 0.09];
  const mix = (a: number[], b: number[], k: number) => a.map((v, i) => v + (b[i]! - v) * Math.min(1, Math.max(0, k)));
  const c = elev >= 6 ? day : elev >= -3 ? mix(dusk, day, (elev + 3) / 9) : elev >= -12 ? mix(night, dusk, (elev + 12) / 9) : night;
  return `rgba(${Math.round(c[0]!)}, ${Math.round(c[1]!)}, ${Math.round(c[2]!)}, ${c[3]!.toFixed(3)})`;
}

export function RadarSweep() {
  const on = useSettings((s) => s.radarSweep);
  const motionLevel = useSettings((s) => s.motion);
  const lat = useView((v) => Math.round(v.lat));
  const lon = useView((v) => Math.round(v.lon));
  useNow(30_000);
  if (!on || motionLevel === 'off') return null;
  const t = simNow();
  const color = sweepColor(solarElevation(lat, lon, subsolarPoint(t)));
  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden" aria-hidden="true">
      <div className="radar-scan absolute left-1/2 top-1/2 aspect-square w-[160vmax] -translate-x-1/2 -translate-y-1/2" style={{ ['--sweep' as string]: color }} />
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

/** Top-centre stack so banners never overlap each other. */
export function TopNotices() {
  const mobile = useIsMobile();
  return (
    <div
      className={`pointer-events-none absolute z-30 flex flex-col gap-2 ${
        // Phones: keep clear of the map-control column on the right.
        mobile ? 'left-3 right-[64px] top-[68px] items-start [&>*]:max-w-full' : 'left-1/2 top-[84px] -translate-x-1/2 items-center'
      }`}
    >
      <FollowBanner />
    </div>
  );
}
