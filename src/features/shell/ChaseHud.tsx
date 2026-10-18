// Glass flight display for the chase view (loaded on demand): speed and altitude tapes,
// vertical speed, a track ribbon, the phase of flight and the distance to go. Every number is
// the simulator's output for a simulated aircraft, and the display says so.

import { Mountain, RotateCcw, Satellite } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { distanceNm } from '@shared/geo';
import { convertAltitude, convertSpeed, convertVerticalRate, UNIT_LABEL, type AltitudeUnit, type SpeedUnit } from '@shared/units';
import { simFlight, useSim } from '@/data/world';
import { fmtDistance, fmtHmUTC, fmtTemp, vrateParts } from '@/lib/format';
import { useFrame } from '@/lib/hooks';
import { useIsMobile } from '@/lib/useMedia';
import { chaseHooks, chaseState, viewPadding } from '@/map/camera';
import { getSettings, useSettings, type MapStyleId } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { useUI } from '@/state/ui';

// The HUD keeps a dark, sim-like palette whatever the app theme: it sits on sky and imagery.
const FG = '#f4f8ff';
const TICK = 'rgba(244,248,255,0.55)';
const CYAN = '#5ce1ff';
const AMBER = '#ffb547';
const GREEN = '#3ddc97';

const PHASE: Record<string, string> = {
  parked: 'Parked',
  pushback: 'Push-back',
  taxi: 'Taxi',
  takeoff: 'Take-off',
  climb: 'Climb',
  cruise: 'Cruise',
  descent: 'Descent',
  holding: 'Holding',
  approach: 'Approach',
  goaround: 'Go-around',
  landing: 'Landing',
  orbit: 'On station',
  soaring: 'Soaring',
};

/** Style to go back to when the chase view ends (if the HUD switched to satellite imagery). */
let styleBeforeSatellite: MapStyleId | null = null;

interface TapeProps {
  value: number;
  height: number;
  width: number;
  pxPerUnit: number;
  minor: number;
  major: number;
  /** Which screen edge the tape sits on: ticks face the aircraft. */
  side: 'left' | 'right';
  readout: string;
  caption: string;
  bug?: number; // e.g. the selected altitude
}

function Tape({ value, height, width, pxPerUnit, minor, major, side, readout, caption, bug }: TapeProps) {
  const half = height / 2;
  const range = half / pxPerUnit;
  const ticks: { y: number; major: boolean; v: number }[] = [];
  const start = Math.ceil((value - range) / minor) * minor;
  for (let v = start; v <= value + range; v += minor) {
    const y = half - (v - value) * pxPerUnit;
    ticks.push({
      y,
      v,
      major: Math.round(v / minor) % Math.round(major / minor) === 0,
    });
  }
  const inner = side === 'left' ? width : 0; // edge nearest the aircraft
  const dir = side === 'left' ? -1 : 1;
  const boxH = 30;
  const notch = 7;
  const bx0 = side === 'left' ? 2 : notch;
  const bx1 = side === 'left' ? width - notch : width - 2;
  const box =
    side === 'left'
      ? `M${bx0} ${half - boxH / 2} H${bx1} L${width} ${half} L${bx1} ${half + boxH / 2} H${bx0} Z`
      : `M${bx1} ${half - boxH / 2} H${bx0} L0 ${half} L${bx0} ${half + boxH / 2} H${bx1} Z`;
  const bugY = bug === undefined ? null : half - (bug - value) * pxPerUnit;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        className="overflow-visible rounded-[12px] border border-[rgba(255,255,255,0.16)] bg-[rgba(6,10,18,0.34)] backdrop-blur-[8px]"
        style={{
          maskImage: 'linear-gradient(transparent, #000 18%, #000 82%, transparent)',
          WebkitMaskImage: 'linear-gradient(transparent, #000 18%, #000 82%, transparent)',
        }}
      >
        {ticks.map((t) => (
          <g key={t.v}>
            <line x1={inner} x2={inner + dir * (t.major ? 11 : 6)} y1={t.y} y2={t.y} stroke={TICK} strokeWidth={t.major ? 1.4 : 1} />
            {t.major && (
              <text
                x={inner + dir * 15}
                y={t.y + 3.6}
                fill={FG}
                fillOpacity={0.82}
                fontSize={10.5}
                fontWeight={600}
                textAnchor={side === 'left' ? 'end' : 'start'}
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {Math.round(t.v)}
              </text>
            )}
          </g>
        ))}
        {bugY !== null && bugY > 0 && bugY < height && (
          <path d={side === 'left' ? `M${width} ${bugY - 5} l-6 5 l6 5` : `M0 ${bugY - 5} l6 5 l-6 5`} fill="none" stroke={CYAN} strokeWidth={1.6} />
        )}
        <path d={box} fill="rgba(3,6,11,0.88)" stroke={CYAN} strokeWidth={1.2} />
        <text
          x={(bx0 + bx1) / 2}
          y={half + 6}
          fill={FG}
          fontSize={readout.length > 5 ? 15 : 17}
          fontWeight={700}
          textAnchor="middle"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {readout}
        </text>
      </svg>
      <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: TICK }}>
        {caption}
      </span>
    </div>
  );
}

function compassLabel(d: number): string {
  const n = ((Math.round(d) % 360) + 360) % 360;
  return n === 0 ? 'N' : n === 90 ? 'E' : n === 180 ? 'S' : n === 270 ? 'W' : String(n / 10).padStart(2, '0');
}

function HeadingRibbon({ track, width }: { track: number; width: number }) {
  const h = 30;
  const pxPerDeg = width / 70;
  const half = width / 2;
  const ticks: { x: number; d: number; major: boolean }[] = [];
  const start = Math.ceil((track - 36) / 5) * 5;
  for (let d = start; d <= track + 36; d += 5) ticks.push({ x: half + (d - track) * pxPerDeg, d, major: d % 10 === 0 });
  return (
    <div className="flex flex-col items-center">
      <div
        className="tnum mb-1 rounded-[8px] border px-2 py-0.5 text-[13px] font-bold"
        style={{
          color: FG,
          borderColor: CYAN,
          background: 'rgba(3,6,11,0.85)',
        }}
        aria-hidden="true"
      >
        <span className="mr-1 text-[9.5px] font-semibold tracking-[0.12em]" style={{ color: TICK }}>
          TRK
        </span>
        {String(((Math.round(track) % 360) + 360) % 360).padStart(3, '0')}°
      </div>
      <svg
        width={width}
        height={h}
        viewBox={`0 0 ${width} ${h}`}
        aria-hidden="true"
        className="rounded-[10px] border border-[rgba(255,255,255,0.16)] bg-[rgba(6,10,18,0.34)] backdrop-blur-[8px]"
        style={{
          maskImage: 'linear-gradient(90deg, transparent, #000 15%, #000 85%, transparent)',
          WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 15%, #000 85%, transparent)',
        }}
      >
        {ticks.map((t) => (
          <g key={t.d}>
            <line x1={t.x} x2={t.x} y1={0} y2={t.major ? 9 : 5} stroke={TICK} strokeWidth={t.major ? 1.4 : 1} />
            {t.major && (
              <text
                x={t.x}
                y={22}
                fill={FG}
                fillOpacity={((t.d % 90) + 90) % 90 === 0 ? 1 : 0.78}
                fontSize={10.5}
                fontWeight={((t.d % 90) + 90) % 90 === 0 ? 800 : 600}
                textAnchor="middle"
              >
                {compassLabel(t.d)}
              </text>
            )}
          </g>
        ))}
        <path d={`M${half - 5} 0 L${half} 7 L${half + 5} 0 Z`} fill={CYAN} />
      </svg>
    </div>
  );
}

/** Vertical speed: a needle on a compressed ±6,000 ft/min scale. */
function VsiBar({ fpm, height }: { fpm: number; height: number }) {
  const half = height / 2;
  const k = Math.sign(fpm) * Math.min(1, Math.sqrt(Math.abs(fpm) / 6000));
  const y = half - k * (half - 8);
  const color = Math.abs(fpm) < 100 ? TICK : fpm > 0 ? GREEN : AMBER;
  return (
    <svg width={14} height={height} viewBox={`0 0 14 ${height}`} aria-hidden="true" className="overflow-visible">
      <line x1={7} x2={7} y1={8} y2={height - 8} stroke="rgba(244,248,255,0.25)" strokeWidth={1} />
      {[-1, -0.577, 0, 0.577, 1].map((f) => (
        <line key={f} x1={4} x2={10} y1={half - f * (half - 8)} y2={half - f * (half - 8)} stroke={TICK} strokeWidth={f === 0 ? 1.4 : 1} />
      ))}
      <line x1={7} x2={7} y1={half} y2={y} stroke={color} strokeWidth={3} strokeLinecap="round" />
      <circle cx={7} cy={y} r={3} fill={color} />
    </svg>
  );
}

function speedScale(unit: SpeedUnit) {
  return unit === 'kmh' ? { px: 1.6, minor: 10, major: 20 } : unit === 'ms' ? { px: 5.5, minor: 5, major: 10 } : { px: 3, minor: 5, major: 10 };
}
function altScale(unit: AltitudeUnit) {
  return unit === 'm' ? { px: 0.3, minor: 20, major: 100 } : { px: 0.1, minor: 100, major: 500 };
}

function HudButton({
  label,
  pressed,
  onClick,
  children,
  compact,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
  compact: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={compact ? label : undefined}
      title={label}
      className="pointer-events-auto flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[11.5px] font-semibold backdrop-blur-[10px] transition-colors"
      style={{
        color: pressed ? '#04101c' : FG,
        background: pressed ? CYAN : 'rgba(6,10,18,0.55)',
        borderColor: pressed ? CYAN : 'rgba(255,255,255,0.2)',
      }}
    >
      {children}
      {!compact && <span>{label}</span>}
    </button>
  );
}

export function ChaseHud() {
  const id = useUI((s) => s.selectedId);
  const panel = useUI((s) => s.panel);
  const sheet = useUI((s) => s.sheet);
  const units = useSettings((s) => s.units);
  const motionSetting = useSettings((s) => s.motion);
  const mapStyle = useSettings((s) => s.mapStyle);
  const terrain3d = useSettings((s) => s.terrain3d);
  const setSetting = useSettings((s) => s.set);
  const speed = useSim((s) => s.speed);
  useSim((s) => s.rev); // simFlight() answers arrive with the next revision
  const prefersReduced = useReducedMotion();
  const reduced = !!prefersReduced || motionSetting !== 'full';
  const mobile = useIsMobile();
  const [hint, setHint] = useState(true);
  useFrame(true, reduced ? 5 : 20);

  useEffect(() => {
    const t = setTimeout(() => setHint(false), 6000);
    return () => clearTimeout(t);
  }, []);
  // Leaving the chase view puts back the map style the HUD switched away from.
  useEffect(
    () => () => {
      if (styleBeforeSatellite && getSettings().mapStyle === 'satellite') getSettings().set('mapStyle', styleBeforeSatellite);
      styleBeforeSatellite = null;
    },
    [],
  );

  const t = traffic.get(id);
  if (!t) return null;
  if (mobile && panel && sheet === 'full') return null;
  const a = t.ac;
  const now = Date.now();
  const pos = traffic.displayPosition(t, now);
  const info = simFlight(t.id);

  // Between simulator ticks, run the altitude on along the vertical rate so the tape moves smoothly.
  const vr = a.onGround ? 0 : (a.verticalRate ?? 0);
  const elapsedMin = Math.min(Math.max(0, now - a.observedAt) * speed, traffic.expectedIntervalMs * 1.2 * speed) / 60_000;
  const altFt = a.onGround ? 0 : Math.max(0, (a.altitudeBarometric ?? a.altitudeGeometric ?? 0) + vr * elapsedMin);
  const gs = a.groundSpeed ?? 0;
  const tas = a.ext?.tas;
  const mach = a.ext?.mach;
  const track = pos.trk ?? a.track ?? 0;

  const sp = speedScale(units.speed);
  const al = altScale(units.altitude);
  const spVal = convertSpeed(gs, units.speed);
  const altUnit: AltitudeUnit = units.altitude === 'fl' ? 'ft' : units.altitude;
  const altVal = convertAltitude(altFt, altUnit);
  const altReadout = a.onGround
    ? 'GND'
    : units.altitude === 'fl'
      ? `FL${String(Math.round(altFt / 100)).padStart(3, '0')}`
      : String(Math.round(altVal / (altUnit === 'm' ? 5 : 20)) * (altUnit === 'm' ? 5 : 20));
  const mcp = a.ext?.navAltitudeMcp;
  const vrP = vrateParts(vr, units.verticalRate);

  const phaseKey = info?.phase ?? (a.onGround ? 'taxi' : vr > 400 ? 'climb' : vr < -400 ? 'descent' : 'cruise');
  const status = info?.status;
  const phase = status === 'Holding' || status === 'Go-around' || status === 'Diverted' || status === 'Emergency' ? status : (PHASE[phaseKey] ?? 'En route');
  const flight = info?.flightIata ?? info?.flight ?? a.callsign ?? a.registration ?? a.icao24.toUpperCase();
  const type = a.aircraftType ?? '';
  const dest = info?.to;
  const toGo = dest ? distanceNm(pos.lat, pos.lon, dest.lat, dest.lon) : undefined;

  // Keep clear of the header, the follow banner, the map controls and the open panel / sheet.
  const pad = viewPadding();
  const inset = mobile ? { top: 118, bottom: Math.max(pad.bottom, 84) + 8, left: 10, right: 66 } : { top: 138, bottom: 236, left: 88, right: pad.right + 80 }; // bottom: clear of the path profile & minimap
  const bandH = typeof window === 'undefined' ? 600 : window.innerHeight - inset.top - inset.bottom;
  const tapeH = Math.round(Math.max(96, Math.min(mobile ? 170 : 250, bandH - (mobile ? 150 : 170))));
  const compact = mobile || bandH < 300;
  // Tapes need room; with the sheet half open on a phone a single line of readouts replaces them.
  const tall = bandH >= (mobile ? 330 : 280);
  const satellite = mapStyle === 'satellite';
  const orbited = chaseState.orbited;
  const toggleSatellite = () => {
    if (!satellite) {
      styleBeforeSatellite = mapStyle;
      setSetting('mapStyle', 'satellite');
    } else {
      setSetting('mapStyle', styleBeforeSatellite ?? 'obsidian');
      styleBeforeSatellite = null;
    }
  };

  const infoStrip = (
    <div className="flex max-w-full flex-wrap items-center justify-center gap-x-2.5 gap-y-1 rounded-[16px] border border-[rgba(255,255,255,0.16)] bg-[rgba(6,10,18,0.55)] px-3 py-1.5 text-[11.5px] backdrop-blur-[12px]">
      <span className="font-bold tracking-[0.02em]" style={{ color: FG }}>
        {flight}
      </span>
      {type && <span style={{ color: TICK }}>{type}</span>}
      <span
        className="rounded-full px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.1em]"
        style={{
          color: '#04101c',
          background: phase === 'Emergency' ? '#ff5d73' : AMBER,
        }}
      >
        {phase}
      </span>
      {dest && toGo !== undefined && (
        <span className="tnum" style={{ color: FG }}>
          {fmtDistance(toGo, units.distance)} <span style={{ color: TICK }}>to</span> {dest.iata ?? dest.ident}
          {!compact && info && <span style={{ color: TICK }}> · ETA {fmtHmUTC(info.eta)}</span>}
        </span>
      )}
      {!compact && a.ext?.outsideAirTemp !== undefined && (
        <span className="tnum" style={{ color: TICK }}>
          OAT {fmtTemp(a.ext.outsideAirTemp, units.temperature)}
        </span>
      )}
      <span
        className="flex items-center gap-1 rounded-full border px-1.5 py-px text-[9.5px] font-bold uppercase tracking-[0.12em]"
        style={{ color: GREEN, borderColor: 'rgba(61,220,151,0.45)' }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: GREEN }} aria-hidden="true" />
        Simulated
      </span>
    </div>
  );

  const readouts = (
    <div className="tnum flex items-center gap-2.5 rounded-[12px] border border-[rgba(255,255,255,0.16)] bg-[rgba(6,10,18,0.6)] px-3 py-1 text-[12px] font-semibold backdrop-blur-[12px]">
      <span>
        <span className="mr-1 text-[9.5px] tracking-[0.12em]" style={{ color: TICK }}>
          GS
        </span>
        {Math.round(spVal)}
      </span>
      <span>
        <span className="mr-1 text-[9.5px] tracking-[0.12em]" style={{ color: TICK }}>
          ALT
        </span>
        {altReadout}
      </span>
      <span style={{ color: Math.abs(vr) < 100 ? FG : vr > 0 ? GREEN : AMBER }}>
        <span className="mr-1 text-[9.5px] tracking-[0.12em]" style={{ color: TICK }}>
          V/S
        </span>
        {vrP.value}
      </span>
      {mach !== undefined && <span style={{ color: CYAN }}>M{mach.toFixed(2).replace(/^0/, '')}</span>}
    </div>
  );

  const hudButtons = (
    <div className="flex items-center gap-1.5">
      {orbited && (
        <HudButton label="Behind aircraft" compact={compact} onClick={() => chaseHooks.reset?.()}>
          <RotateCcw size={14} />
        </HudButton>
      )}
      <HudButton label="Satellite" compact={compact} pressed={satellite} onClick={toggleSatellite}>
        <Satellite size={14} />
      </HudButton>
      <HudButton label="3D terrain" compact={compact} pressed={terrain3d} onClick={() => setSetting('terrain3d', !terrain3d)}>
        <Mountain size={14} />
      </HudButton>
    </div>
  );

  return (
    <motion.div
      role="group"
      aria-label="Chase view flight display (simulated)"
      initial={reduced ? false : { opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      className="pointer-events-none absolute z-[25] flex flex-col items-center justify-between"
      style={{ ...inset, color: FG }}
    >
      <p className="sr-only">
        {`${flight}, simulated. Ground speed ${Math.round(gs)} knots, altitude ${a.onGround ? 'on the ground' : `${Math.round(altFt)} feet`}, track ${Math.round(track)} degrees, ${phase}.`}
      </p>
      <div className="flex max-w-full flex-col items-center gap-1.5">
        <div className="flex items-end gap-2">
          <HeadingRibbon track={track} width={mobile ? 168 : 300} />
          {mobile && hudButtons}
        </div>
        {!mobile && infoStrip}
        {!mobile && hudButtons}
      </div>

      {tall ? (
        <div className="flex w-full flex-1 items-center justify-between py-2">
          <div className="flex flex-col items-start gap-1">
            <Tape
              value={spVal}
              height={tapeH}
              width={mobile ? 56 : 66}
              pxPerUnit={sp.px}
              minor={sp.minor}
              major={sp.major}
              side="left"
              readout={String(Math.round(spVal))}
              caption={`GS ${UNIT_LABEL[units.speed]}`}
            />
            <div
              className="tnum rounded-[8px] bg-[rgba(6,10,18,0.5)] px-1.5 py-0.5 text-[10.5px] font-semibold leading-tight backdrop-blur-[8px]"
              style={{ color: FG }}
            >
              {tas !== undefined && <div>TAS {Math.round(convertSpeed(tas, units.speed))}</div>}
              {mach !== undefined && <div style={{ color: CYAN }}>M {mach.toFixed(2).replace(/^0/, '')}</div>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-start gap-1">
              <Tape
                value={altVal}
                height={tapeH}
                width={mobile ? 60 : 72}
                pxPerUnit={al.px}
                minor={al.minor}
                major={al.major}
                side="right"
                readout={altReadout}
                caption={`ALT ${units.altitude === 'fl' ? 'ft' : UNIT_LABEL[altUnit]}`}
                {...(mcp !== undefined && !a.onGround ? { bug: convertAltitude(mcp, altUnit) } : {})}
              />
              <VsiBar fpm={vr} height={tapeH} />
            </div>
            <div
              className="tnum rounded-[8px] bg-[rgba(6,10,18,0.5)] px-1.5 py-0.5 text-[10.5px] font-semibold backdrop-blur-[8px]"
              style={{ color: Math.abs(vr) < 100 ? FG : vr > 0 ? GREEN : AMBER }}
            >
              V/S {vrP.value}
              {!compact && <span className="ml-1 font-normal opacity-70">{convertVerticalRate(1, units.verticalRate) === 1 ? 'fpm' : 'm/s'}</span>}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {!tall && readouts}
      {mobile && <div className="mt-1.5 max-w-full">{infoStrip}</div>}
      <div className="flex min-h-[26px] items-end">
        <AnimatePresence>
          {hint && (
            <motion.div
              initial={reduced ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="rounded-full bg-[rgba(6,10,18,0.55)] px-2.5 py-1 text-[10.5px] backdrop-blur-[8px]"
              style={{ color: TICK }}
            >
              {mobile ? 'Drag to look around · pinch to zoom' : 'Drag to look around · scroll to zoom · double-click to reset'}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
