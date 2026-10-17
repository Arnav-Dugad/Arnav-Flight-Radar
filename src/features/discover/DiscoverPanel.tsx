import { ChevronDown, Square } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { CLASS_LABEL } from '@shared/classify';
import { computeStats } from '@shared/stats';
import {
  AnalyticsIcon,
  CompareIcon,
  DataIcon,
  DiscoverIcon,
  FollowIcon,
  GlobeIcon,
  InspectorIcon,
  LearnIcon,
  MeasureIcon,
  PresentationIcon,
  SpotterIcon,
  TimelineIcon,
} from '@/components/icons';
import { GlassButton, Section } from '@/components/ui/Glass';
import { Panel } from '@/components/ui/Sheet';
import { HUBS } from '@/data/airports';
import { fmtAltitude, fmtSpeed } from '@/lib/format';
import { useTrafficVersion } from '@/lib/hooks';
import { focusAircraft, setProjection, startFollow } from '@/map/controller';
import { startTour, stopTour, useTour } from '@/map/tour';
import { useSettings } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { useUI } from '@/state/ui';

interface ModeCard {
  key: string;
  title: string;
  body: string;
  icon: ReactNode;
  run: () => void;
  disabled?: string;
}

export function DiscoverPanel() {
  const open = useUI((s) => s.panel === 'discover');
  const openPanel = useUI((s) => s.openPanel);
  const ui = useUI();
  const units = useSettings((s) => s.units);
  useTrafficVersion();
  const stats = computeStats(traffic.current());

  const modes: ModeCard[] = [
    {
      key: 'globe',
      title: 'Globe explorer',
      body: 'Cinematic 3D globe with atmosphere and airport exploration.',
      icon: <GlobeIcon />,
      run: () => {
        setProjection('globe');
        openPanel(null);
      },
    },
    {
      key: 'follow',
      title: 'Flight follow',
      body: 'Lock the camera to the selected aircraft.',
      icon: <FollowIcon />,
      disabled: ui.selectedId ? undefined : 'Select an aircraft first',
      run: () => ui.selectedId && startFollow(ui.selectedId),
    },
    { key: 'spotter', title: 'Spotter mode', body: 'Distraction-free view of traffic around an airport.', icon: <SpotterIcon />, run: () => openPanel('spotter') },
    { key: 'analytics', title: 'Analytics', body: 'Live statistics of the observed regional sample.', icon: <AnalyticsIcon />, run: () => openPanel('analytics') },
    { key: 'timeline', title: 'Timeline replay', body: 'Replay positions recorded during this session.', icon: <TimelineIcon />, run: () => openPanel('timeline') },
    { key: 'compare', title: 'Compare', body: 'Side-by-side telemetry for two observed aircraft.', icon: <CompareIcon />, run: () => openPanel('compare') },
    { key: 'present', title: 'Presentation', body: 'Minimal interface with cinematic camera moves.', icon: <PresentationIcon />, run: () => ui.setPresentation(true) },
    {
      key: 'inspector',
      title: 'Data inspector',
      body: 'Raw and normalized fields for the selected aircraft.',
      icon: <InspectorIcon />,
      disabled: ui.selectedId ? undefined : 'Select an aircraft first',
      run: () => openPanel('inspector'),
    },
    { key: 'data', title: 'Data & coverage', body: 'Provider health, freshness and queried areas.', icon: <DataIcon />, run: () => openPanel('data') },
    {
      key: 'measure',
      title: 'Measure',
      body: 'Great-circle distance and bearing between points.',
      icon: <MeasureIcon />,
      run: () => {
        ui.setMeasure({ active: true, points: [] });
        openPanel(null);
      },
    },
  ];

  const go = (id: string) => {
    ui.select(id);
    focusAircraft(id, 9.5);
  };

  return (
    <Panel open={open} onClose={() => openPanel(null)} title="Discover" icon={<DiscoverIcon size={18} />} ariaLabel="Discover" subtitle="Modes, live highlights and aviation basics">
      <div className="space-y-6 pt-1">
        <Section title="Experiences">
          <div className="grid grid-cols-2 gap-2">
            {modes.map((m, i) => (
              <motion.button
                key={m.key}
                type="button"
                disabled={!!m.disabled}
                title={m.disabled}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                whileHover={m.disabled ? undefined : { y: -2 }}
                whileTap={m.disabled ? undefined : { scale: 0.97 }}
                onClick={m.run}
                className="glass-2 flex flex-col items-start gap-2 rounded-[16px] p-3 text-left transition-colors hover:border-[var(--line-strong)] disabled:opacity-45"
              >
                <span className="grid size-8 place-items-center rounded-[10px] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)]">{m.icon}</span>
                <span className="text-[13px] font-semibold text-fg">{m.title}</span>
                <span className="text-[11px] leading-snug text-fg-3">{m.disabled ?? m.body}</span>
              </motion.button>
            ))}
          </div>
        </Section>

        <Section title="Right now in the live area">
          {stats.sample === 0 ? (
            <p className="text-[12px] text-fg-3">Highlights appear once live data arrives.</p>
          ) : (
            <ul className="space-y-1.5 text-[12.5px] text-fg-2">
              <li>
                <span className="font-semibold text-fg">{stats.sample}</span> aircraft observed — {stats.airborne} airborne, {stats.onGround} on the ground.
              </li>
              {stats.maxAltitude && (
                <li>
                  Highest:{' '}
                  <button type="button" className="font-semibold text-[var(--accent)] hover:underline" onClick={() => go(stats.maxAltitude!.id)}>
                    {stats.maxAltitude.label}
                  </button>{' '}
                  at {fmtAltitude(stats.maxAltitude.value, units.altitude)}.
                </li>
              )}
              {stats.maxSpeed && (
                <li>
                  Fastest over the ground:{' '}
                  <button type="button" className="font-semibold text-[var(--accent)] hover:underline" onClick={() => go(stats.maxSpeed!.id)}>
                    {stats.maxSpeed.label}
                  </button>{' '}
                  at {fmtSpeed(stats.maxSpeed.value, units.speed)} — tailwinds count.
                </li>
              )}
              {stats.byType[0] && (
                <li>
                  Most common type: <span className="font-semibold text-fg">{stats.byType[0].type}</span> ({stats.byType[0].count} aircraft).
                </li>
              )}
              {stats.byClass[0] && (
                <li>
                  Largest class: <span className="font-semibold text-fg">{CLASS_LABEL[stats.byClass[0].cls]}</span>.
                </li>
              )}
              <li>
                {stats.climbing} climbing · {stats.level} level · {stats.descending} descending.
              </li>
            </ul>
          )}
        </Section>

        <HubTour />
        <Learn />
      </div>
    </Panel>
  );
}

function HubTour() {
  const running = useTour((s) => s.running);
  const stop = useTour((s) => s.stop);
  return (
    <Section title="Cinematic hub tour">
      <p className="text-[12px] text-fg-3">
        Glide between {HUBS.length} major hubs. Live data loads at each stop; aircraft shown are real. Touch the map to stop.
      </p>
      {running ? (
        <div className="flex items-center gap-3">
          <GlassButton size="sm" variant="danger" onClick={stopTour}>
            <Square size={13} /> Stop tour
          </GlassButton>
          {stop && <span className="text-[12px] text-fg-2">Now: {stop}</span>}
        </div>
      ) : (
        <GlassButton size="sm" variant="accent" onClick={() => void startTour()}>
          Start tour
        </GlassButton>
      )}
    </Section>
  );
}

const GLOSSARY: [string, string][] = [
  ['ADS-B', 'Automatic Dependent Surveillance–Broadcast: aircraft broadcast their own GNSS position, altitude, velocity and identity about twice a second. Volunteer ground receivers pick these up and share them with networks like adsb.fi.'],
  ['MLAT', 'Multilateration: for aircraft that do not broadcast a position, several receivers time the arrival of the same signal to compute where it came from. Usually a little less precise and less frequent.'],
  ['Barometric vs geometric altitude', 'Barometric altitude comes from air pressure referenced to 1013.25 hPa — it is what pilots and controllers use (flight levels). Geometric altitude is the GNSS height above the WGS-84 ellipsoid. They can differ by hundreds of feet depending on the weather.'],
  ['Track vs heading', 'Track is the direction the aircraft moves over the ground; heading is where its nose points. Crosswind makes them differ — the gap is the drift angle.'],
  ['Ground speed vs airspeed', 'Ground speed is speed over the Earth; indicated/true airspeed is speed through the air. A 100 kt jet stream tailwind can push ground speed past 650 kt.'],
  ['Squawk', 'The four-digit transponder code assigned by air traffic control. 7700 means general emergency, 7600 radio failure, 7500 unlawful interference.'],
  ['Callsign', 'The flight identification transmitted by the aircraft — usually the ICAO airline code plus a flight number (e.g. BAW123), or the registration for private flights.'],
  ['ICAO 24-bit address', 'A unique hexadecimal address assigned to each aircraft’s transponder by its state of registry. The first digits reveal the registering country.'],
  ['METAR & TAF', 'METAR is a routine airport weather observation (usually every 30–60 minutes). TAF is the terminal aerodrome forecast covering the next 24–30 hours.'],
  ['Flight categories', 'VFR, MVFR, IFR and LIFR summarise ceiling and visibility. They indicate how restrictive the weather is for visual flying.'],
  ['NIC / NACp / SIL', 'ADS-B quality indicators: navigation integrity category, position accuracy category and source integrity level. Higher numbers mean a more trustworthy position.'],
  ['Data freshness', 'Every position here carries its age. “Live” means recently reported; “stale” means the latest report is getting old; “lost” means the aircraft vanished from the provider’s results.'],
];

function Learn() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  return (
    <Section title={<span className="flex items-center gap-1.5"><LearnIcon size={14} /> Learn the telemetry</span>}>
      <ul className="glass-2 divide-y divide-[var(--line)] rounded-[16px]">
        {GLOSSARY.map(([term, body], i) => {
          const open = openIdx === i;
          return (
            <li key={term}>
              <button type="button" aria-expanded={open} onClick={() => setOpenIdx(open ? null : i)} className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-[13px] font-medium text-fg hover:bg-[var(--line)]">
                {term}
                <motion.span animate={{ rotate: open ? 180 : 0 }}>
                  <ChevronDown size={15} className="text-fg-3" />
                </motion.span>
              </button>
              <AnimatePresence initial={false}>
                {open && (
                  <motion.p initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden px-3.5 text-[12px] leading-relaxed text-fg-2">
                    <span className="block pb-3">{body}</span>
                  </motion.p>
                )}
              </AnimatePresence>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
