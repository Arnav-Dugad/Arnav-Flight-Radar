import { useQuery } from '@tanstack/react-query';
import { motion } from 'motion/react';
import type { Metar, Taf } from '@shared/types';
import { CLOUD_COVER, decodeWeather, FLIGHT_CATEGORY_INFO } from '@shared/weather';
import { WeatherIcon } from '@/components/icons';
import { Badge, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Row, Rows } from '@/components/ui/Data';
import { api } from '@/lib/api';
import { fmtAge, fmtBearing, fmtDateTimeUTC, fmtSpeed, fmtTemp } from '@/lib/format';
import { useNow } from '@/lib/hooks';
import { useSettings } from '@/state/settings';
import { FLIGHT_CAT_COLOR } from '@/map/overlays';

const TONE: Record<string, 'ok' | 'accent' | 'danger' | 'violet'> = { VFR: 'ok', MVFR: 'accent', IFR: 'danger', LIFR: 'violet' };

function WindDial({ dir, speed, variable }: { dir?: number; speed?: number; variable?: boolean }) {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="27" fill="none" stroke="var(--line-strong)" />
      {['N', 'E', 'S', 'W'].map((l, i) => (
        <text key={l} x={32 + Math.sin((i * Math.PI) / 2) * 21} y={32 - Math.cos((i * Math.PI) / 2) * 21 + 3} fontSize="7" textAnchor="middle" fill="var(--fg-3)" fontWeight="600">
          {l}
        </text>
      ))}
      {dir !== undefined && !variable && (speed ?? 0) > 0 && (
        <motion.g initial={{ rotate: dir + 180, opacity: 0 }} animate={{ rotate: dir + 180, opacity: 1 }} style={{ originX: '32px', originY: '32px' }}>
          {/* Arrow points where the wind blows to (reported FROM `dir`). */}
          <path d="M32 9 L36.5 19 L33.2 18.2 L33.2 46 L30.8 46 L30.8 18.2 L27.5 19 Z" fill="var(--accent)" />
        </motion.g>
      )}
      {variable && (
        <text x="32" y="35" fontSize="9" textAnchor="middle" fill="var(--fg-2)" fontWeight="700">
          VRB
        </text>
      )}
    </svg>
  );
}

export function MetarCard({ station }: { station: string }) {
  const now = useNow(5000);
  const units = useSettings((s) => s.units);
  const q = useQuery({
    queryKey: ['metar', station],
    queryFn: ({ signal }) => api.metar([station], signal),
    refetchInterval: 5 * 60_000,
    staleTime: 2 * 60_000,
  });
  if (q.isPending)
    return (
      <div className="space-y-2">
        <Skeleton className="h-[92px] rounded-[16px]" />
      </div>
    );
  if (q.isError) return <ErrorState title="Weather unavailable" body={(q.error as Error).message} />;
  const m: Metar | undefined = q.data.data[0];
  if (!m) return <p className="glass-2 rounded-[14px] px-3.5 py-3 text-[12.5px] text-fg-3">No current METAR for {station}. Not every airfield has a reporting station.</p>;

  const age = now - m.observedAt;
  return (
    <div className="space-y-2.5">
      <div className="glass-2 flex items-center gap-3 rounded-[16px] p-3">
        <WindDial dir={m.windDirDeg} speed={m.windSpeedKt} variable={m.windVariable} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {m.flightCategory ? (
              <Badge tone={TONE[m.flightCategory]} title={FLIGHT_CATEGORY_INFO[m.flightCategory]}>
                <span className="size-1.5 rounded-full" style={{ background: FLIGHT_CAT_COLOR[m.flightCategory] }} />
                {m.flightCategory}
              </Badge>
            ) : (
              <Badge>No category</Badge>
            )}
            <Badge tone={age > 90 * 60_000 ? 'warn' : 'neutral'} title={fmtDateTimeUTC(m.observedAt)}>
              Observed {fmtAge(age)} ago
            </Badge>
          </div>
          <p className="tnum text-[15px] font-semibold text-fg">
            {m.windVariable ? 'Variable' : m.windDirDeg !== undefined ? fmtBearing(m.windDirDeg) : 'Calm'}
            {m.windSpeedKt !== undefined && m.windSpeedKt > 0 && ` · ${fmtSpeed(m.windSpeedKt, units.speed)}`}
            {m.windGustKt !== undefined && <span className="text-[#ffc56e]"> gusting {fmtSpeed(m.windGustKt, units.speed)}</span>}
          </p>
          <p className="text-[12px] text-fg-3">
            {m.tempC !== undefined ? fmtTemp(m.tempC, units.temperature) : '—'} · dew point {m.dewpointC !== undefined ? fmtTemp(m.dewpointC, units.temperature) : '—'}
          </p>
        </div>
      </div>
      <Rows>
        <Row label="Visibility" value={m.visibility ? `${m.visibility} SM` : undefined} mono />
        <Row
          label="Clouds"
          value={m.clouds.length ? m.clouds.map((c) => `${c.cover}${c.baseFt !== undefined ? ` ${c.baseFt.toLocaleString()} ft` : ''}${c.type ? ` ${c.type}` : ''}`).join(', ') : undefined}
          hint={m.clouds.map((c) => CLOUD_COVER[c.cover] ?? c.cover).join('; ')}
          mono
        />
        <Row label="Weather" value={m.weather ? `${m.weather} — ${decodeWeather(m.weather)}` : undefined} />
        <Row label="Altimeter" value={m.altimeterHpa !== undefined ? `${Math.round(m.altimeterHpa)} hPa · ${(m.altimeterHpa * 0.02953).toFixed(2)} inHg` : undefined} mono />
        <Row label="Station" value={m.name ? `${m.station} · ${m.name}` : m.station} />
        <Row label="Observed" value={fmtDateTimeUTC(m.observedAt)} mono />
      </Rows>
      <pre className="glass-2 whitespace-pre-wrap break-words rounded-[14px] px-3.5 py-2.5 font-mono text-[11.5px] leading-relaxed text-fg-2">{m.raw}</pre>
    </div>
  );
}

export function TafCard({ station }: { station: string }) {
  const units = useSettings((s) => s.units);
  const q = useQuery({
    queryKey: ['taf', station],
    queryFn: ({ signal }) => api.taf([station], signal),
    refetchInterval: 15 * 60_000,
    staleTime: 10 * 60_000,
  });
  if (q.isPending) return <Skeleton className="h-[72px] rounded-[16px]" />;
  if (q.isError) return <ErrorState title="Forecast unavailable" body={(q.error as Error).message} />;
  const t: Taf | undefined = q.data.data[0];
  if (!t) return <p className="glass-2 rounded-[14px] px-3.5 py-3 text-[12.5px] text-fg-3">No current TAF for {station}. Forecasts are issued only for larger aerodromes.</p>;
  return (
    <div className="space-y-2.5">
      <p className="text-[11.5px] text-fg-3">
        Issued {fmtDateTimeUTC(t.issuedAt)} · valid {fmtDateTimeUTC(t.validFrom)} – {fmtDateTimeUTC(t.validTo)}
      </p>
      <ol className="space-y-1.5">
        {t.periods.map((p, i) => (
          <li key={i} className="glass-2 rounded-[12px] px-3 py-2 text-[12px]">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-fg">
                {p.change ? `${p.change}${p.probability ? ` ${p.probability}%` : ''}` : 'Base'}
              </span>
              <span className="tnum text-fg-3">
                {new Date(p.from).toISOString().slice(8, 13).replace('T', ' ')}Z → {new Date(p.to).toISOString().slice(8, 13).replace('T', ' ')}Z
              </span>
            </div>
            <div className="tnum mt-1 text-fg-2">
              {[
                p.windDirDeg !== undefined && p.windSpeedKt !== undefined ? `Wind ${fmtBearing(p.windDirDeg)} ${fmtSpeed(p.windSpeedKt, units.speed)}${p.windGustKt ? ` G${p.windGustKt}` : ''}` : null,
                p.visibility ? `Vis ${p.visibility} SM` : null,
                p.weather ? decodeWeather(p.weather) : null,
                p.clouds.length ? p.clouds.map((c) => `${c.cover}${c.baseFt !== undefined ? ` ${c.baseFt.toLocaleString()}` : ''}`).join(' ') : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'No change elements decoded'}
            </div>
          </li>
        ))}
      </ol>
      <pre className="glass-2 whitespace-pre-wrap break-words rounded-[14px] px-3.5 py-2.5 font-mono text-[11.5px] leading-relaxed text-fg-2">{t.raw}</pre>
    </div>
  );
}

export function WeatherAttribution() {
  return (
    <p className="flex items-center gap-1.5 text-[11px] text-fg-3">
      <WeatherIcon size={13} /> Weather: NOAA Aviation Weather Center (aviationweather.gov). Not for operational flight planning.
    </p>
  );
}
