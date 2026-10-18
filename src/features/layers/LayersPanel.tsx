import { Check } from 'lucide-react';
import { motion } from 'motion/react';
import { useSyncExternalStore } from 'react';
import { LayersIcon } from '@/components/icons';
import { SegmentedControl, Slider, Toggle } from '@/components/ui/Controls';
import { Section } from '@/components/ui/Glass';
import { Panel } from '@/components/ui/Sheet';
import { STYLE_IDS } from '@/lib/styleIds';
import { cn } from '@/lib/cn';
import { FLIGHT_CAT_COLOR, getRadarState, onRadarChange, onWeatherChange, weatherNotice } from '@/map/overlays';
import { AIRSPACE_MIN_ZOOM, airspaceState, onAirspaceChange } from '@/map/extraOverlays';
import { STYLE_META } from '@/map/styles';
import { useSettings, type ColorMode } from '@/state/settings';
import { useUI } from '@/state/ui';
import { Legend } from './Legend';

function AirspaceStatus() {
  const st = useSyncExternalStore(onAirspaceChange, () => `${airspaceState.status}:${airspaceState.count}`);
  const [status, count] = st.split(':');
  const text =
    status === 'zoom'
      ? `Zoom in to level ${AIRSPACE_MIN_ZOOM} or closer to load airspace.`
      : status === 'outside'
        ? 'This view is outside the United States — FAA airspace only covers the US.'
        : status === 'loading'
          ? 'Loading airspace…'
          : status === 'error'
            ? 'FAA airspace service unavailable right now.'
            : status === 'ok'
              ? `${count} airspace sectors in view.`
              : '';
  return (
    <div className="space-y-1.5 rounded-[12px] bg-[var(--line)] px-3 py-2.5 text-[11.5px] text-fg-2">
      <div className="flex flex-wrap gap-3">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-[#4f8dff]" /> Class B
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-[#d65cff]" /> Class C
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 border-t-2 border-dashed border-[#5aa9ff]" /> Class D
        </span>
      </div>
      {text && <p className="text-fg-3">{text}</p>}
      <p className="text-fg-3">Source: FAA Aeronautical Data Delivery Service (public domain).</p>
    </div>
  );
}

export function LayersPanel() {
  const open = useUI((s) => s.panel === 'layers');
  const openPanel = useUI((s) => s.openPanel);
  const s = useSettings();
  const notice = useSyncExternalStore(onWeatherChange, () => weatherNotice);
  const radar = useSyncExternalStore(onRadarChange, getRadarState);

  return (
    <Panel open={open} onClose={() => openPanel(null)} title="Map & layers" icon={<LayersIcon size={18} />} ariaLabel="Map styles and layers" subtitle="Cartography, overlays and aircraft colouring">
      <div className="space-y-6 pt-1">
        <Section title="Map style">
          <div className="grid grid-cols-2 gap-2.5">
            {STYLE_IDS.map((id) => {
              const m = STYLE_META[id];
              const active = s.mapStyle === id;
              return (
                <motion.button
                  key={id}
                  type="button"
                  whileTap={{ scale: 0.97 }}
                  aria-pressed={active}
                  onClick={() => s.set('mapStyle', id)}
                  className={cn(
                    'group relative overflow-hidden rounded-[16px] border text-left transition-colors',
                    active ? 'border-[color-mix(in_srgb,var(--accent)_60%,transparent)]' : 'border-[var(--line)] hover:border-[var(--line-strong)]',
                  )}
                >
                  <StylePreview land={m.swatch[0]} water={m.swatch[1]} accent={m.swatch[2]} satellite={id === 'satellite'} terrain={id === 'terrain'} />
                  <div className="px-3 pb-2.5 pt-2">
                    <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-fg">
                      {m.name}
                      {active && <Check size={13} className="text-[var(--accent)]" />}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-fg-3">{m.description}</div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        </Section>

        <Section title="Overlays">
          <Toggle label="Airports" description="OurAirports — large airports always, others clustered." checked={s.showAirports} onChange={(v) => s.set('showAirports', v)} />
          <Toggle
            label="METAR weather stations"
            description="Flight category and reported surface wind from NOAA AviationWeather. Real station reports only."
            checked={s.showWeather}
            onChange={(v) => s.set('showWeather', v)}
          />
          {s.showWeather && (
            <div className="space-y-2 rounded-[12px] bg-[var(--line)] px-3 py-2.5 text-[11.5px] text-fg-2">
              <div className="flex flex-wrap gap-3">
                {Object.entries(FLIGHT_CAT_COLOR).map(([k, c]) => (
                  <span key={k} className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full" style={{ background: c }} /> {k}
                  </span>
                ))}
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full bg-[#9aa6b2]" /> No category
                </span>
              </div>
              <p className="text-fg-3">Arrows point where the wind blows to; size grows with wind speed.</p>
              {notice && <p className="text-[#ffc56e]">{notice}</p>}
            </div>
          )}
          <Toggle
            label="Precipitation radar"
            description="Latest RainViewer composite (updated every 10 min). Detail is limited to zoom 7; coverage depends on national radar networks."
            checked={s.showRadar}
            onChange={(v) => s.set('showRadar', v)}
          />
          {s.showRadar && (
            <div className="space-y-2 rounded-[12px] bg-[var(--line)] px-3 py-2.5 text-[11.5px] text-fg-2">
              <div className="h-2 rounded-full" style={{ background: 'linear-gradient(90deg, #88ddee, #0099cc, #0077aa, #ffee00, #ffaa00, #ff4400, #c10000, #ffaaff)' }} />
              <div className="flex justify-between text-[10.5px] text-fg-3">
                <span>Light</span>
                <span>Moderate</span>
                <span>Heavy</span>
              </div>
              <p className="text-fg-3">
                {radar === null
                  ? 'Loading radar…'
                  : typeof radar === 'string'
                    ? radar
                    : `Frame ${new Date(radar).toISOString().slice(11, 16)}Z (${Math.max(0, Math.round((Date.now() - radar) / 60000))} min ago).`}{' '}
                <a href="https://www.rainviewer.com/" target="_blank" rel="noopener" className="text-[var(--accent)] hover:underline">
                  Weather data by Rain Viewer
                </a>
              </p>
            </div>
          )}
          <Toggle
            label="Day & night"
            description="Sunlit and dark sides of the Earth with civil, nautical and astronomical twilight. Computed from the clock (the simulated clock in demo mode)."
            checked={s.showDayNight}
            onChange={(v) => s.set('showDayNight', v)}
          />
          <Toggle
            label="Controlled airspace (US)"
            description="FAA Class B, C and D boundaries with ceiling/floor in hundreds of feet. United States only, from zoom 6. Not for navigation."
            checked={s.showAirspace}
            onChange={(v) => s.set('showAirspace', v)}
          />
          {s.showAirspace && <AirspaceStatus />}
          <Toggle
            label="Lightning climatology"
            description="NASA's long-term average lightning flash rate (LIS satellite, 1998–2015). Shows where storms are common — NOT live strikes."
            checked={s.showLightning}
            onChange={(v) => s.set('showLightning', v)}
          />
          {s.showLightning && (
            <div className="space-y-1.5 rounded-[12px] bg-[var(--line)] px-3 py-2.5 text-[11.5px] text-fg-2">
              <div className="h-2 rounded-full" style={{ background: 'linear-gradient(90deg, rgb(142,133,166), rgb(157,96,181), rgb(196,51,172), rgb(212,2,82), rgb(227,75,64), rgb(242,190,133), rgb(252,251,207))' }} />
              <div className="flex justify-between text-[10.5px] text-fg-3">
                <span>0.1</span>
                <span>≥ 145 flashes/km²/yr</span>
              </div>
              <p className="text-fg-3">
                Climatology, not live data. Imagery: NASA GIBS (LIS Very High Resolution Full Climatology), detail to zoom 6.{' '}
                <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener" className="text-[var(--accent)] hover:underline">
                  NASA Earthdata
                </a>
              </p>
            </div>
          )}
          <Toggle
            label="3D flight path"
            description="When the map is tilted, the selected aircraft's path is drawn as a curtain at its true altitude."
            checked={s.show3dPath}
            onChange={(v) => s.set('show3dPath', v)}
          />
          <Toggle
            label="Range rings"
            description="Distance rings around the selected aircraft or airport (or the map centre)."
            checked={s.showRangeRings}
            onChange={(v) => s.set('showRangeRings', v)}
          />
          <Toggle label="Live coverage area" description="Outline of the region actually queried for live aircraft." checked={s.showCoverage} onChange={(v) => s.set('showCoverage', v)} />
          <Toggle label="Traffic density heatmap" description="Built only from aircraft positions currently retrieved." checked={s.showHeatmap} onChange={(v) => s.set('showHeatmap', v)} />
          <Toggle label="Trails for all aircraft" description="Short trails from positions observed this session." checked={s.showAllTrails} onChange={(v) => s.set('showAllTrails', v)} />
          <Toggle label="3D terrain" description="Elevation from AWS Terrain Tiles; tilt the map to see relief." checked={s.terrain3d} onChange={(v) => s.set('terrain3d', v)} />
          <Toggle label="Radar sweep" description="Decorative scan overlay. Off by default." checked={s.radarSweep} onChange={(v) => s.set('radarSweep', v)} />
        </Section>

        <Section title="Panels">
          <Toggle label="Overview minimap" description="Shows your view and the live area on a world inset (larger screens)." checked={s.showMinimap} onChange={(v) => s.set('showMinimap', v)} />
          <Toggle label="Vertical profile" description="Side view of aircraft in view by altitude (shortcut V)." checked={s.showProfile} onChange={(v) => s.set('showProfile', v)} />
        </Section>

        <Section title="Aircraft colour">
          <SegmentedControl<ColorMode>
            size="sm"
            label="Aircraft colour mode"
            value={s.colorMode}
            onChange={(v) => s.set('colorMode', v)}
            options={[
              { value: 'altitude', label: 'Altitude' },
              { value: 'speed', label: 'Speed' },
              { value: 'vertical', label: 'V/S' },
              { value: 'freshness', label: 'Age' },
              { value: 'mono', label: 'Mono' },
            ]}
          />
          <Legend />
          {s.colorMode === 'altitude' && (
            <SegmentedControl
              size="sm"
              label="Altitude palette"
              value={s.altitudePalette}
              onChange={(v) => s.set('altitudePalette', v)}
              options={[
                { value: 'aurora', label: 'Aurora' },
                { value: 'accessible', label: 'Colour-blind safe' },
              ]}
            />
          )}
        </Section>

        <Section title="Symbols & labels">
          <Slider label="Aircraft symbol size" min={0.7} max={1.6} step={0.05} value={s.symbolScale} onChange={(v) => s.set('symbolScale', v)} format={(v) => `${Math.round(v * 100)}%`} />
          <SegmentedControl
            size="sm"
            label="Label density"
            value={s.labelDensity}
            onChange={(v) => s.set('labelDensity', v)}
            options={[
              { value: 'none', label: 'None' },
              { value: 'low', label: 'Low' },
              { value: 'normal', label: 'Normal' },
              { value: 'high', label: 'High' },
            ]}
          />
        </Section>
      </div>
    </Panel>
  );
}

function StylePreview({ land, water, accent, satellite, terrain }: { land: string; water: string; accent: string; satellite?: boolean; terrain?: boolean }) {
  return (
    <svg viewBox="0 0 160 70" className="block h-[70px] w-full" aria-hidden="true">
      <rect width="160" height="70" fill={water} />
      <path d="M0 22 C30 10 52 30 80 18 S130 8 160 20 V70 H0Z" fill={land} />
      {satellite && <path d="M0 40 C40 30 70 52 110 38 S150 34 160 40 V70 H0Z" fill="#4b5c3d" opacity=".9" />}
      {terrain && (
        <g opacity=".5" stroke="#8fd18a" fill="none" strokeWidth=".8">
          <path d="M20 60 C40 40 60 44 80 30" />
          <path d="M40 66 C60 46 80 50 100 36" />
          <path d="M70 68 C90 52 110 54 130 40" />
        </g>
      )}
      <path d="M0 52 L160 30" stroke={accent} strokeOpacity=".25" strokeWidth="1" />
      <g fill={accent}>
        <path d="M60 40 l4 -7 l1.2 2.6 l5 1.2 l-5 1 l-1.2 3 Z" transform="rotate(-20 64 37)" />
        <path d="M112 26 l4 -7 l1.2 2.6 l5 1.2 l-5 1 l-1.2 3 Z" transform="rotate(30 116 23)" opacity=".75" />
      </g>
      <circle cx="96" cy="48" r="2.4" fill="none" stroke={accent} strokeWidth="1" />
    </svg>
  );
}
