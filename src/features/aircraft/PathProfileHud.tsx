// Mini side view of the selected aircraft's path (altitude against distance flown),
// shown next to the 3D flight path when the map is tilted. Flights also show the
// planned descent to landing (dashed).
import { motion } from 'motion/react';
import { distanceNm } from '@shared/geo';
import { simPlannedProfile, useSim } from '@/data/world';
import { fmtAltitude, fmtDistance } from '@/lib/format';
import { useNow, useSelectedTrack } from '@/lib/hooks';
import { useSettings } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { useView } from '@/state/view';

const W = 300;
const H = 104;
const P = { l: 34, r: 10, t: 10, b: 18 };

export function PathProfileHud() {
  useSim((s) => s.rev); // re-render when the simulation worker answers
  useNow(1000);
  const pitched = useView((v) => v.pitch > 8);
  const show = useSettings((s) => s.show3dPath);
  const units = useSettings((s) => s.units);
  const t = useSelectedTrack();
  if (!show || !pitched || !t || t.ac.onGround) return null;
  const trail = traffic.trailOf(t).filter((p) => p.alt !== undefined);
  if (trail.length < 2) return null;
  const flown: [number, number][] = [];
  let d = 0;
  for (let i = 0; i < trail.length; i++) {
    if (i > 0) d += distanceNm(trail[i - 1]!.lat, trail[i - 1]!.lon, trail[i]!.lat, trail[i]!.lon);
    flown.push([d, trail[i]!.alt!]);
  }
  const ahead: [number, number][] = [];
  const plan = t.ac.provider === 'sim' ? simPlannedProfile(t.id) : undefined;
  if (plan?.length) {
    let e = d;
    ahead.push([d, flown[flown.length - 1]![1]]);
    for (let i = 1; i < plan.length; i++) {
      e += distanceNm(plan[i - 1]!.lat, plan[i - 1]!.lon, plan[i]!.lat, plan[i]!.lon);
      ahead.push([e, plan[i]!.alt]);
    }
  }
  const maxX = Math.max(1, (ahead.at(-1) ?? flown.at(-1)!)[0]);
  const maxY = Math.max(5000, ...flown.map((p) => p[1]), ...ahead.map((p) => p[1])) * 1.1;
  const x = (v: number) => P.l + (v / maxX) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - v / maxY) * (H - P.t - P.b);
  const path = (pts: [number, number][]) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  const cur = flown[flown.length - 1]!;
  const area = `${path(flown)}L${x(cur[0]).toFixed(1)},${y(0)}L${x(0)},${y(0)}Z`;
  const altUnit = units.altitude === 'fl' ? 'ft' : units.altitude;
  return (
    <motion.figure
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass pointer-events-auto absolute bottom-[64px] left-[88px] z-10 w-[320px] rounded-[20px] px-2.5 pb-2 pt-2.5"
      aria-label="Altitude profile of the selected aircraft's path"
    >
      <figcaption className="flex items-center justify-between px-1 pb-0.5 text-[11px]">
        <span className="font-semibold text-fg">Path profile</span>
        <span className="tnum text-fg-3">
          {fmtAltitude(cur[1], altUnit)} · {fmtDistance(cur[0], units.distance)} flown
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Altitude against distance: now ${Math.round(cur[1])} ft after ${Math.round(cur[0])} NM`}>
        <defs>
          <linearGradient id="pp-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--viz-1)" stopOpacity="0.45" />
            <stop offset="1" stopColor="var(--viz-1)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((k) => (
          <g key={k}>
            <line x1={P.l} x2={W - P.r} y1={y(maxY * k * 0.909)} y2={y(maxY * k * 0.909)} stroke="var(--viz-grid)" />
            <text x={P.l - 4} y={y(maxY * k * 0.909) + 3} textAnchor="end" fontSize="8.5" fill="var(--fg-3)" className="tnum">
              {Math.round((maxY * k * 0.909) / 1000)}k
            </text>
          </g>
        ))}
        <path d={area} fill="url(#pp-fill)" />
        <path d={path(flown)} fill="none" stroke="var(--viz-1)" strokeWidth="2" strokeLinejoin="round" />
        {ahead.length > 1 && <path d={path(ahead)} fill="none" stroke="#ffd28a" strokeWidth="1.6" strokeDasharray="4 3" opacity="0.85" />}
        <circle cx={x(cur[0])} cy={y(cur[1])} r="4" fill="#ffb547" stroke="var(--surface-solid)" strokeWidth="2" />
        <text x={P.l} y={H - 4} fontSize="8.5" fill="var(--fg-3)">
          {ahead.length > 1 ? 'Flown (solid) · planned (dashed, simulated)' : 'Observed positions'}
        </text>
      </svg>
    </motion.figure>
  );
}
