import { AnimatePresence, motion } from 'motion/react';
import { classifyAircraft, CLASS_LABEL } from '@shared/classify';
import { AircraftGlyph } from '@/components/icons';
import { aircraftColor } from '@/lib/colors';
import { fmtAge, fmtAltitude, fmtBearing, fmtSpeed } from '@/lib/format';
import { useMedia } from '@/lib/useMedia';
import { useSettings } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { useUI } from '@/state/ui';

/** Glass preview card that follows the pointer over an aircraft (pointer devices only). */
export function HoverCard() {
  const id = useUI((s) => s.hoveredId);
  const point = useUI((s) => s.hoverPoint);
  const selected = useUI((s) => s.selectedId);
  const units = useSettings((s) => s.units);
  const colorMode = useSettings((s) => s.colorMode);
  const palette = useSettings((s) => s.altitudePalette);
  const finePointer = useMedia('(hover: hover) and (pointer: fine)');
  const t = id ? traffic.get(id) : undefined;
  const show = finePointer && !!t && !!point && id !== selected;

  const a = t?.ac;
  const alt = a ? (a.onGround ? 0 : (a.altitudeBarometric ?? a.altitudeGeometric)) : undefined;
  const vr = a?.verticalRate;
  const left = point ? Math.min(point.x + 18, window.innerWidth - 250) : 0;
  const top = point ? Math.min(point.y + 18, window.innerHeight - 150) : 0;

  return (
    <AnimatePresence>
      {show && a && (
        <motion.div
          key="hover"
          initial={{ opacity: 0, scale: 0.95, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0, left, top }}
          exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
          transition={{ type: 'spring', stiffness: 700, damping: 45, opacity: { duration: 0.12 } }}
          className="glass pointer-events-none fixed z-40 w-[232px] rounded-[16px] px-3.5 py-3"
          style={{ left, top }}
          aria-hidden="true"
        >
          <div className="flex items-center gap-2.5">
            <AircraftGlyph
              cls={classifyAircraft(a)}
              size={26}
              rotate={a.track ?? 0}
              style={{ color: aircraftColor(colorMode, palette, { onGround: a.onGround, alt, gs: a.groundSpeed, vr }) }}
            />
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold text-fg">{a.callsign ?? a.registration ?? a.icao24.toUpperCase()}</div>
              <div className="truncate text-[11px] text-fg-3">{a.typeDescription ?? a.aircraftType ?? CLASS_LABEL[classifyAircraft(a)]}</div>
            </div>
          </div>
          <div className="tnum mt-2.5 grid grid-cols-3 gap-2 text-[11.5px]">
            <div>
              <div className="text-fg-3">Alt</div>
              <div className="font-semibold text-fg">{fmtAltitude(alt, units.altitude, a.onGround)}</div>
            </div>
            <div>
              <div className="text-fg-3">Speed</div>
              <div className="font-semibold text-fg">{fmtSpeed(a.groundSpeed, units.speed)}</div>
            </div>
            <div>
              <div className="text-fg-3">Track</div>
              <div className="font-semibold text-fg">
                {fmtBearing(a.track)}
                {vr !== undefined && !a.onGround && Math.abs(vr) > 300 && <span className={vr > 0 ? 'text-[#57e3a6]' : 'text-[#ffad6b]'}> {vr > 0 ? '↑' : '↓'}</span>}
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between text-[10.5px] text-fg-3">
            <span>{a.provider === 'demo' ? 'Simulated (demo)' : `Report ${fmtAge(traffic.ageMs(t!))} old`}</span>
            <span>Click for details</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Screen-reader-only live region for selection and status announcements. */
export function Announcer() {
  const msg = useUI((s) => s.announcement);
  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true">
      {msg}
    </div>
  );
}
