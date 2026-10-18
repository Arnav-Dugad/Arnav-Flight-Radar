import { X } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { aircraftColor } from '@/lib/colors';
import { compileFilter } from '@/lib/filters';
import { fmtAltitude } from '@/lib/format';
import { useFrame, useTrafficVersion } from '@/lib/hooks';
import { getMap } from '@/map/controller';
import { useFilters } from '@/state/filters';
import { useSettings } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { useUI } from '@/state/ui';
import { useView } from '@/state/view';

const H = 150;
const PAD_T = 14;
const PAD_B = 18;
const MAX_FT = 45000;
export const PROFILE_LEFT = 84;
export const PROFILE_RIGHT = 74;

/**
 * Vertical situation strip: each aircraft in view is drawn at its map x position
 * and its altitude, so the strip reads like a side view of the map above it.
 */
export function VerticalProfile() {
  useTrafficVersion();
  useView((s) => s.zoom + s.lon + s.lat + s.bearing);
  useFrame(true, 6);
  const selectedId = useUI((s) => s.selectedId);
  const select = useUI((s) => s.select);
  const panelOpen = useUI((s) => s.panel !== null);
  const setSetting = useSettings((s) => s.set);
  const units = useSettings((s) => s.units);
  const colorMode = useSettings((s) => s.colorMode);
  const palette = useSettings((s) => s.altitudePalette);
  const filters = useFilters((s) => s.filters);
  const [hover, setHover] = useState<string | null>(null);
  const map = getMap();
  if (!map) return null;

  const canvas = map.getCanvas();
  const width = canvas.clientWidth - PROFILE_LEFT - PROFILE_RIGHT - (panelOpen ? 404 : 0);
  const pred = compileFilter(filters);
  const y = (ft: number) => PAD_T + (1 - Math.min(ft, MAX_FT) / MAX_FT) * (H - PAD_T - PAD_B);
  const dots: { id: string; x: number; y: number; c: string; label: string; alt: number; sel: boolean }[] = [];
  for (const t of traffic.tracks.values()) {
    if (t.lost || !pred(t.ac)) continue;
    const a = t.ac;
    const alt = a.onGround ? 0 : (a.altitudeBarometric ?? a.altitudeGeometric);
    if (alt === undefined) continue;
    const pos = traffic.displayPosition(t);
    const p = map.project([pos.lon, pos.lat]);
    const x = p.x - PROFILE_LEFT;
    if (x < 0 || x > width || p.y < 0 || p.y > canvas.clientHeight) continue;
    dots.push({
      id: t.id,
      x,
      y: y(alt),
      alt,
      sel: t.id === selectedId,
      label: a.callsign ?? a.registration ?? a.icao24.toUpperCase(),
      c: aircraftColor(colorMode, palette, { onGround: a.onGround, alt, gs: a.groundSpeed, vr: a.verticalRate }),
    });
  }
  dots.sort((p, q) => Number(p.sel) - Number(q.sel));
  const grid = [10000, 20000, 30000, 40000];
  const hoverDot = dots.find((d) => d.id === hover);

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      aria-label="Vertical profile of aircraft in view"
      className="glass pointer-events-auto absolute bottom-[66px] z-20 overflow-hidden rounded-[18px]"
      style={{ left: PROFILE_LEFT - 8, width: width + 16, height: H }}
    >
      <div className="absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-2">
        <span className="eyebrow">Vertical profile</span>
        <span className="text-[10.5px] text-fg-3">{dots.length} in view · horizontal position matches the map</span>
      </div>
      <button
        type="button"
        aria-label="Close vertical profile"
        onClick={() => setSetting('showProfile', false)}
        className="absolute right-2 top-1.5 grid size-6 place-items-center rounded-md text-fg-3 hover:bg-[var(--line)] hover:text-fg"
      >
        <X size={13} />
      </button>
      <svg width={width + 16} height={H} className="block" role="img" aria-label={`${dots.length} aircraft plotted by position and altitude`}>
        <g transform="translate(8 0)">
          {grid.map((g) => (
            <g key={g}>
              <line x1={0} x2={width} y1={y(g)} y2={y(g)} stroke="var(--viz-grid)" strokeWidth="1" />
              <text x={4} y={y(g) - 3} fontSize="9.5" fill="var(--fg-3)" className="tnum">
                {fmtAltitude(g, units.altitude === 'fl' ? 'fl' : units.altitude)}
              </text>
            </g>
          ))}
          <line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke="var(--line-strong)" strokeWidth="1" />
          {dots.map((d) => (
            <g key={d.id} transform={`translate(${d.x} ${d.y})`} onPointerEnter={() => setHover(d.id)} onPointerLeave={() => setHover(null)} onClick={() => select(d.id)} className="cursor-pointer">
              <circle r={9} fill="transparent" />
              <line y1={0} y2={y(0) - d.y} stroke={d.c} strokeOpacity={d.sel ? 0.5 : 0.12} strokeWidth="1" />
              <circle r={d.sel ? 5 : 3.5} fill={d.sel ? '#ffb547' : d.c} stroke="var(--surface-solid)" strokeWidth="1.5" />
              {d.sel && (
                <text y={-9} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="var(--fg)">
                  {d.label}
                </text>
              )}
            </g>
          ))}
        </g>
      </svg>
      {hoverDot && !hoverDot.sel && (
        <div
          className="pointer-events-none absolute rounded-[8px] border border-[var(--line)] bg-[var(--surface-solid)] px-2 py-1 text-[11px] shadow-lg"
          style={{ left: Math.min(hoverDot.x + 16, width - 100), top: Math.max(4, hoverDot.y - 30) }}
        >
          <span className="font-semibold text-fg">{hoverDot.label}</span> <span className="tnum text-fg-2">{fmtAltitude(hoverDot.alt, units.altitude, hoverDot.alt === 0)}</span>
        </div>
      )}
    </motion.section>
  );
}
