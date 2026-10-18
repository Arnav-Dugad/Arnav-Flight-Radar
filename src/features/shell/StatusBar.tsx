import { motion } from 'motion/react';
import { useMemo } from 'react';
import { classifyAircraft } from '@shared/classify';
import { formatLatLon } from '@shared/geo';
import { AircraftGlyph } from '@/components/icons';
import { simNow, useSim } from '@/data/world';
import { fmtAltitude, fmtSpeed } from '@/lib/format';
import { useNow, useSelectedTrack } from '@/lib/hooks';
import { styleAttribution } from '@/map/styles';
import { useSettings } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { useUI } from '@/state/ui';
import { useView } from '@/state/view';

const NICE = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];

/** Metric-free scale bar in the user's distance unit. */
function ScaleBar() {
  const zoom = useView((s) => s.zoom);
  const lat = useView((s) => s.lat);
  const unit = useSettings((s) => s.units.distance);
  const { width, label } = useMemo(() => {
    const mPerPx = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
    const unitM = unit === 'km' ? 1000 : unit === 'mi' ? 1609.344 : 1852;
    const maxUnits = (96 * mPerPx) / unitM;
    const nice = [...NICE].reverse().find((n) => n <= maxUnits) ?? NICE[0]!;
    return { width: Math.max(8, (nice * unitM) / mPerPx), label: `${nice} ${unit === 'nm' ? 'NM' : unit}` };
  }, [zoom, lat, unit]);
  return (
    <div className="flex items-center gap-2" aria-label={`Scale ${label}`}>
      <div className="relative h-2 border-x border-b border-[var(--fg-3)]" style={{ width }} />
      <span className="tnum">{label}</span>
    </div>
  );
}

export function StatusBar() {
  useNow(1000);
  const t = useSelectedTrack();
  const cursor = useUI((s) => s.cursor);
  const units = useSettings((s) => s.units);
  const style = useSettings((s) => s.mapStyle);
  const terrain = useSettings((s) => s.terrain3d);
  const radar = useSettings((s) => s.showRadar);
  const zoom = useView((s) => s.zoom);
  const ground = useSim((s) => s.ground);
  const speed = useSim((s) => s.speed);
  void traffic;

  return (
    <motion.footer
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30, delay: 0.18 }}
      className="glass pointer-events-auto absolute bottom-3 left-4 right-4 z-20 flex h-11 items-center gap-4 overflow-hidden rounded-[16px] px-4 text-[11.5px] text-fg-3"
    >
      <div className="flex min-w-0 shrink-0 items-center gap-2.5" aria-live="off">
        {t ? (
          <>
            <AircraftGlyph cls={classifyAircraft(t.ac)} size={18} rotate={t.ac.track ?? 0} className="text-[var(--color-amber)]" />
            <span className="font-semibold tracking-wide text-fg">{t.ac.callsign ?? t.ac.registration ?? t.ac.icao24.toUpperCase()}</span>
            <span className="tnum">{fmtAltitude(t.ac.altitudeBarometric ?? t.ac.altitudeGeometric, units.altitude, t.ac.onGround)}</span>
            <span className="tnum">{fmtSpeed(t.ac.groundSpeed, units.speed)}</span>
          </>
        ) : (
          <span>No aircraft selected</span>
        )}
      </div>
      <span className="h-4 w-px shrink-0 bg-[var(--line-strong)]" />
      <span className="tnum hidden min-w-[190px] shrink-0 lg:inline">{cursor ? formatLatLon(cursor.lat, cursor.lon, 4) : 'Move the pointer over the map'}</span>
      <span className="hidden shrink-0 md:inline">
        <ScaleBar />
      </span>
      <span className="tnum hidden shrink-0 xl:inline">z {zoom.toFixed(1)}</span>
      <span className="hidden shrink-0 lg:inline">
        <span className="tnum">
          {new Date(simNow()).toUTCString().slice(5, 22)} UTC{speed > 1 ? ` · ${speed}×` : ''} · {ground.toLocaleString()} on the ground
        </span>
      </span>
      <div className="ml-auto flex min-w-0 items-center gap-1.5 truncate">
        <span className="shrink-0 font-semibold text-fg-2" title="Every aircraft on this map is simulated">
          Simulated traffic
        </span>
        <span>·</span>
        <a className="shrink-0 text-fg-2 hover:text-fg" href="https://ourairports.com/data/" target="_blank" rel="noopener noreferrer">
          OurAirports
        </a>
        <span>·</span>
        <a className="shrink-0 text-fg-2 hover:text-fg" href="https://aviationweather.gov" target="_blank" rel="noopener noreferrer">
          NOAA AWC
        </a>
        {radar && (
          <>
            <span>·</span>
            <a className="shrink-0 text-fg-2 hover:text-fg" href="https://www.rainviewer.com/" target="_blank" rel="noopener">
              Rain Viewer
            </a>
          </>
        )}
        <span className="mx-1 h-3 w-px bg-[var(--line-strong)]" />
        <span className="truncate">
          {styleAttribution(style, terrain).map((a, i) => (
            <span key={a.href}>
              {i > 0 && ' · '}
              <a className="hover:text-fg" href={a.href} target="_blank" rel="noopener noreferrer">
                {a.label}
              </a>
            </span>
          ))}
        </span>
      </div>
    </motion.footer>
  );
}
