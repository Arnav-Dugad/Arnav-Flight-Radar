// Instrument-style telemetry gauges. Pure SVG; values animate with springs.
import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { ALTITUDE_STOPS, scaleColor } from '@/lib/colors';
import { NA } from '@/lib/format';
import { useSettings } from '@/state/settings';
import { convertAltitude, convertSpeed, convertVerticalRate, UNIT_LABEL } from '@shared/units';

const spring = { type: 'spring', stiffness: 120, damping: 20, mass: 0.8 } as const;

function GaugeCard({ label, children, value, unit, sub }: { label: string; children: ReactNode; value: ReactNode; unit?: string; sub?: ReactNode }) {
  return (
    <div className="glass-2 flex flex-col gap-2 rounded-[18px] p-3">
      <div className="flex items-center justify-between">
        <span className="eyebrow">{label}</span>
        {sub}
      </div>
      <div className="flex items-center gap-3">
        <div className="shrink-0">{children}</div>
        <div className="min-w-0">
          <div className="tnum truncate text-[19px] font-semibold leading-none tracking-[-0.02em] text-fg">{value}</div>
          {unit && <div className="mt-1 text-[11px] font-medium text-fg-3">{unit}</div>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Altitude

export function AltitudeGauge({ ft, onGround }: { ft: number | undefined; onGround: boolean }) {
  const unit = useSettings((s) => s.units.altitude);
  const palette = useSettings((s) => s.altitudePalette);
  const max = 45000;
  const v = onGround ? 0 : ft;
  const frac = v === undefined ? 0 : Math.max(0, Math.min(1, v / max));
  const H = 64;
  const color = v === undefined ? 'var(--fg-3)' : onGround ? '#9aa6b2' : scaleColor(ALTITUDE_STOPS[palette], v);
  const stops = ALTITUDE_STOPS[palette];
  return (
    <GaugeCard
      label="Altitude"
      value={
        onGround ? 'Ground' : v === undefined ? <span className="text-[14px] text-fg-3">{NA}</span> : (
          <AnimatedNumber value={unit === 'fl' ? v / 100 : convertAltitude(v, unit)} format={(n) => (unit === 'fl' ? `FL${String(Math.round(n)).padStart(3, '0')}` : Math.round(n).toLocaleString())} />
        )
      }
      unit={onGround || v === undefined || unit === 'fl' ? undefined : `${UNIT_LABEL[unit]} · barometric`}
    >
      <svg width="26" height={H} viewBox={`0 0 26 ${H}`} aria-hidden="true">
        <defs>
          <linearGradient id="alt-g" x1="0" y1="1" x2="0" y2="0">
            {stops.map(([at, c]) => (
              <stop key={at} offset={at / max} stopColor={c} />
            ))}
          </linearGradient>
        </defs>
        <rect x="9" y="2" width="6" height={H - 4} rx="3" fill="url(#alt-g)" opacity=".35" />
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <line key={t} x1="17" x2="21" y1={H - 2 - t * (H - 4)} y2={H - 2 - t * (H - 4)} stroke="currentColor" className="text-fg-3" strokeWidth="1" />
        ))}
        <motion.g initial={false} animate={{ y: (1 - frac) * (H - 4) }} transition={spring}>
          <path d="M2 0 L8 2 L2 4 Z" fill={color} transform="translate(0,0)" />
          <rect x="8" y="0.5" width="8" height="3" rx="1.5" fill={color} />
        </motion.g>
      </svg>
    </GaugeCard>
  );
}

// ---------------------------------------------------------------- Speed

export function SpeedGauge({ kt, mach }: { kt: number | undefined; mach?: number }) {
  const unit = useSettings((s) => s.units.speed);
  const max = 650;
  const frac = kt === undefined ? 0 : Math.min(1, kt / max);
  const R = 26;
  const start = 135;
  const sweep = 270;
  const arc = (a0: number, a1: number) => {
    const p = (a: number) => [32 + R * Math.cos((a * Math.PI) / 180), 32 + R * Math.sin((a * Math.PI) / 180)];
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    return `M${x0},${y0} A${R},${R} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1},${y1}`;
  };
  const reduce = useReducedMotion();
  return (
    <GaugeCard
      label="Ground speed"
      value={kt === undefined ? <span className="text-[14px] text-fg-3">{NA}</span> : <AnimatedNumber value={convertSpeed(kt, unit)} format={(n) => (unit === 'ms' ? n.toFixed(1) : Math.round(n).toString())} />}
      unit={kt === undefined ? undefined : UNIT_LABEL[unit]}
      sub={mach !== undefined ? <span className="tnum text-[11px] font-semibold text-fg-2">M{mach.toFixed(2)}</span> : undefined}
    >
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
        <path d={arc(start, start + sweep)} stroke="var(--line-strong)" strokeWidth="5" fill="none" strokeLinecap="round" />
        <motion.path
          d={arc(start, start + sweep)}
          stroke="url(#spd-g)"
          strokeWidth="5"
          fill="none"
          strokeLinecap="round"
          initial={false}
          animate={{ pathLength: Math.max(0.001, frac) }}
          transition={reduce ? { duration: 0 } : spring}
        />
        <defs>
          <linearGradient id="spd-g" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#2e8bff" />
            <stop offset="1" stopColor="#5ce1ff" />
          </linearGradient>
        </defs>
      </svg>
    </GaugeCard>
  );
}

// ---------------------------------------------------------------- Heading

export function HeadingGauge({ track, heading }: { track: number | undefined; heading?: number }) {
  const t = track ?? heading;
  return (
    <GaugeCard
      label={track !== undefined ? 'Track' : 'Heading'}
      value={t === undefined ? <span className="text-[14px] text-fg-3">{NA}</span> : <AnimatedNumber value={t} format={(n) => `${String(Math.round(((n % 360) + 360) % 360)).padStart(3, '0')}°`} />}
      unit={t === undefined ? undefined : track !== undefined ? 'true, over ground' : 'true heading'}
    >
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="28" fill="none" stroke="var(--line-strong)" strokeWidth="1.2" />
        {Array.from({ length: 36 }, (_, i) => {
          const a = (i * 10 * Math.PI) / 180;
          const long = i % 9 === 0;
          const r1 = long ? 21 : 24.5;
          return (
            <line
              key={i}
              x1={32 + Math.sin(a) * r1}
              y1={32 - Math.cos(a) * r1}
              x2={32 + Math.sin(a) * 27}
              y2={32 - Math.cos(a) * 27}
              stroke="currentColor"
              strokeWidth={long ? 1.6 : 0.8}
              className={long ? 'text-fg-2' : 'text-fg-3'}
            />
          );
        })}
        <text x="32" y="15.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="#ff5d73">
          N
        </text>
        {t !== undefined && (
          <motion.g initial={false} animate={{ rotate: t }} transition={spring} style={{ originX: '32px', originY: '32px' }}>
            <path d="M32 9 L36 22 L32 19.5 L28 22 Z" fill="#ffb547" />
            <line x1="32" y1="20" x2="32" y2="44" stroke="#ffb547" strokeWidth="1.6" strokeLinecap="round" />
          </motion.g>
        )}
        <circle cx="32" cy="32" r="2.2" fill="currentColor" className="text-fg" />
      </svg>
    </GaugeCard>
  );
}

// ---------------------------------------------------------------- Vertical speed

export function VerticalSpeedGauge({ fpm }: { fpm: number | undefined }) {
  const unit = useSettings((s) => s.units.verticalRate);
  const clamp = (v: number) => Math.max(-6000, Math.min(6000, v));
  // Non-linear scale (like a real VSI): more resolution near zero.
  const angle = fpm === undefined ? 0 : Math.sign(clamp(fpm)) * Math.sqrt(Math.abs(clamp(fpm)) / 6000) * 150;
  const state = fpm === undefined ? '' : fpm > 300 ? 'Climbing' : fpm < -300 ? 'Descending' : 'Level';
  const color = fpm === undefined ? 'var(--fg-3)' : fpm > 300 ? '#3ddc97' : fpm < -300 ? '#ff9f43' : 'var(--fg)';
  return (
    <GaugeCard
      label="Vertical speed"
      value={
        fpm === undefined ? (
          <span className="text-[14px] text-fg-3">{NA}</span>
        ) : (
          <span style={{ color }}>
            <AnimatedNumber value={convertVerticalRate(fpm, unit)} format={(n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${unit === 'ms' ? Math.abs(n).toFixed(1) : Math.abs(Math.round(n)).toLocaleString()}`} />
          </span>
        )
      }
      unit={fpm === undefined ? undefined : `${UNIT_LABEL[unit]} · ${state}`}
    >
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="32" cy="32" r="28" fill="none" stroke="var(--line-strong)" strokeWidth="1.2" />
        {/* Zero at 9 o'clock like a real VSI: climb sweeps up, descent sweeps down. */}
        <path d="M8.5 24.3 A24 24 0 0 1 24.3 8.5" fill="none" stroke="rgba(61,220,151,0.45)" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M8.5 39.7 A24 24 0 0 0 24.3 55.5" fill="none" stroke="rgba(255,159,67,0.45)" strokeWidth="2.5" strokeLinecap="round" />
        {[-150, -105, -60, 0, 60, 105, 150].map((a) => {
          const r = (180 + a) * (Math.PI / 180);
          return <line key={a} x1={32 + Math.cos(r) * 22} y1={32 + Math.sin(r) * 22} x2={32 + Math.cos(r) * 27} y2={32 + Math.sin(r) * 27} stroke="currentColor" className="text-fg-3" strokeWidth={a === 0 ? 1.8 : 1} />;
        })}
        <motion.g initial={false} animate={{ rotate: 180 + angle }} transition={spring} style={{ originX: '32px', originY: '32px' }}>
          <line x1="32" y1="32" x2="56" y2="32" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
        </motion.g>
        <circle cx="32" cy="32" r="3" fill="currentColor" className="text-fg" />
      </svg>
    </GaugeCard>
  );
}
