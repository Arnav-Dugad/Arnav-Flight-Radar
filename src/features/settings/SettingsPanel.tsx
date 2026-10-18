import { Download, Keyboard, RotateCcw, Settings } from 'lucide-react';
import { useInstall } from '@/lib/pwa';
import { SegmentedControl, Slider, Toggle } from '@/components/ui/Controls';
import { GlassButton, Section } from '@/components/ui/Glass';
import { Panel } from '@/components/ui/Sheet';
import { getMap } from '@/map/controller';
import { useSettings } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { useUI } from '@/state/ui';
import { useShortcutsModal } from '@/features/shell/Shortcuts';

export function SettingsPanel() {
  const open = useUI((s) => s.panel === 'settings');
  const openPanel = useUI((s) => s.openPanel);
  const toast = useUI((s) => s.toast);
  const s = useSettings();
  const showShortcuts = useShortcutsModal((m) => m.setOpen);
  const installPrompt = useInstall((i) => i.prompt);
  const install = useInstall((i) => i.install);

  const useCurrentAsDefault = () => {
    const m = getMap();
    if (!m) return;
    const c = m.getCenter();
    s.set('defaultView', { lat: c.lat, lon: c.lng, zoom: m.getZoom() });
    toast({ kind: 'success', title: 'Default view saved', body: 'The map opens here when no link or last view applies.' });
  };

  return (
    <Panel open={open} onClose={() => openPanel(null)} title="Settings" icon={<Settings size={18} />} ariaLabel="Settings" subtitle="Saved on this device only — no account needed">
      <div className="space-y-6 pt-1">
        <Section title="Appearance">
          <SegmentedControl
            label="Interface theme"
            value={s.appearance}
            onChange={(v) => s.set('appearance', v)}
            options={[
              { value: 'map', label: 'Match map' },
              { value: 'system', label: 'System' },
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
            ]}
          />
          <p className="text-[11.5px] text-fg-3">“Match map” uses light glass over Arctic Glass and dark glass over the darker styles.</p>
          <Toggle
            label="High contrast"
            description="Opaque panels, stronger borders and focus rings, brighter secondary text and heavier aircraft outlines."
            checked={s.highContrast}
            onChange={(v) => s.set('highContrast', v)}
          />
        </Section>

        <Section title="Units">
          <div className="space-y-2.5">
            <UnitRow label="Altitude">
              <SegmentedControl size="sm" label="Altitude unit" value={s.units.altitude} onChange={(v) => s.setUnit('altitude', v)} options={[{ value: 'ft', label: 'Feet' }, { value: 'm', label: 'Metres' }, { value: 'fl', label: 'FL' }]} />
            </UnitRow>
            <UnitRow label="Speed">
              <SegmentedControl size="sm" label="Speed unit" value={s.units.speed} onChange={(v) => s.setUnit('speed', v)} options={[{ value: 'kt', label: 'kt' }, { value: 'kmh', label: 'km/h' }, { value: 'mph', label: 'mph' }, { value: 'ms', label: 'm/s' }]} />
            </UnitRow>
            <UnitRow label="Distance">
              <SegmentedControl size="sm" label="Distance unit" value={s.units.distance} onChange={(v) => s.setUnit('distance', v)} options={[{ value: 'nm', label: 'NM' }, { value: 'km', label: 'km' }, { value: 'mi', label: 'mi' }]} />
            </UnitRow>
            <UnitRow label="Vertical">
              <SegmentedControl size="sm" label="Vertical rate unit" value={s.units.verticalRate} onChange={(v) => s.setUnit('verticalRate', v)} options={[{ value: 'fpm', label: 'ft/min' }, { value: 'ms', label: 'm/s' }]} />
            </UnitRow>
            <UnitRow label="Temperature">
              <SegmentedControl size="sm" label="Temperature unit" value={s.units.temperature} onChange={(v) => s.setUnit('temperature', v)} options={[{ value: 'c', label: '°C' }, { value: 'f', label: '°F' }]} />
            </UnitRow>
          </div>
        </Section>

        <Section title="Motion & effects">
          <SegmentedControl
            label="Animation intensity"
            value={s.motion}
            onChange={(v) => s.set('motion', v)}
            options={[
              { value: 'full', label: 'Full' },
              { value: 'reduced', label: 'Reduced' },
              { value: 'off', label: 'Off' },
            ]}
          />
          <div className="space-y-1.5">
            <span className="text-[13px] font-medium text-fg">Aircraft motion between reports</span>
            <SegmentedControl
              label="Aircraft motion between reports"
              value={s.smoothMotion}
              onChange={(v) => s.set('smoothMotion', v)}
              options={[
                { value: 'curved', label: 'Curved' },
                { value: 'linear', label: 'Straight' },
                { value: 'off', label: 'Jump' },
              ]}
            />
            <p className="text-[11.5px] leading-snug text-fg-3">
              Curved follows the reported track at both ends; Straight glides in a line; Jump shows only reported positions. Motion always stops at the
              newest real report — never beyond it.
            </p>
          </div>
          <Toggle label="Reduced glass effects" description="Solid panels instead of blur — lighter on older GPUs and batteries." checked={s.reducedEffects} onChange={(v) => s.set('reducedEffects', v)} />
          <Toggle label="Ambient globe rotation" description="Slowly turn the globe when idle and zoomed out." checked={s.globeAutoRotate} onChange={(v) => s.set('globeAutoRotate', v)} />
        </Section>

        <Section title="Live data">
          <Slider label="Refresh interval" min={10} max={60} step={5} value={s.pollIntervalSec} onChange={(v) => s.set('pollIntervalSec', v)} format={(v) => `${v} s`} />
          <p className="text-[11.5px] leading-relaxed text-fg-3">
            Snapshots are shared between all visitors and upstream calls are capped globally below adsb.fi’s 1 request/second limit. A longer interval
            is kinder to the free data source.
          </p>
          <Slider label="Mark as stale after" min={30} max={120} step={5} value={s.staleAfterSec} onChange={(v) => s.set('staleAfterSec', v)} format={(v) => `${v} s`} />
          <Slider label="Remove lost aircraft after" min={30} max={300} step={15} value={s.lostAfterSec} onChange={(v) => s.set('lostAfterSec', v)} format={(v) => `${v} s`} />
          <Slider label="Trail length" min={2} max={60} step={1} value={s.trailMinutes} onChange={(v) => s.set('trailMinutes', v)} format={(v) => `${v} min`} />
          <Toggle
            label="Record this session for replay"
            description="Keeps up to about an hour of observed snapshots in memory for the Timeline. Nothing is uploaded or stored on disk."
            checked={s.recordSession}
            onChange={(v) => {
              s.set('recordSession', v);
              if (!v) traffic.clearSession();
            }}
          />
        </Section>

        <Section title="Aircraft details & alerts">
          <Toggle
            label="Aircraft photos"
            description="Airframe photos from Planespotters.net with photographer credit. Loaded by your browser on demand."
            checked={s.showPhotos}
            onChange={(v) => s.set('showPhotos', v)}
          />
          <div className="space-y-1.5">
            <span className="text-[13px] font-medium text-fg">Emergency squawk alerts</span>
            <SegmentedControl
              label="Emergency squawk alerts"
              value={s.emergencyAlerts}
              onChange={async (v) => {
                if (v === 'notify' && 'Notification' in window && Notification.permission !== 'granted') {
                  const perm = await Notification.requestPermission().catch(() => 'denied' as NotificationPermission);
                  if (perm !== 'granted') {
                    toast({ kind: 'warning', title: 'Notifications are blocked', body: 'In-app alerts stay on. Allow notifications for this site in your browser to enable them.' });
                    s.set('emergencyAlerts', 'in-app');
                    return;
                  }
                }
                s.set('emergencyAlerts', v);
              }}
              options={[
                { value: 'off', label: 'Off' },
                { value: 'in-app', label: 'In app' },
                { value: 'notify', label: '+ Notifications' },
              ]}
            />
            <p className="text-[11.5px] leading-snug text-fg-3">Alerts when a live aircraft in your area squawks 7500, 7600 or 7700. Never for demo traffic.</p>
          </div>
        </Section>

        <Section title="Camera">
          <SegmentedControl
            label="Follow camera"
            value={s.cameraMode}
            onChange={(v) => s.set('cameraMode', v)}
            options={[
              { value: 'north-up', label: 'North up' },
              { value: 'heading-up', label: 'Heading up' },
            ]}
          />
          <Slider label="Follow zoom" min={6} max={14} step={0.5} value={s.followZoom} onChange={(v) => s.set('followZoom', v)} />
          <Slider label="Follow tilt" min={0} max={70} step={5} value={s.followPitch} onChange={(v) => s.set('followPitch', v)} format={(v) => `${v}°`} />
          <Toggle label="Reopen at last view" checked={s.rememberLastView} onChange={(v) => s.set('rememberLastView', v)} />
          <div className="flex flex-wrap gap-2">
            <GlassButton size="sm" onClick={useCurrentAsDefault}>
              Use current view as default
            </GlassButton>
            {s.defaultView && (
              <GlassButton size="sm" variant="ghost" onClick={() => s.set('defaultView', null)}>
                Clear default
              </GlassButton>
            )}
          </div>
        </Section>

        <Section title="More">
          <div className="flex flex-wrap gap-2">
            {installPrompt && (
              <GlassButton size="sm" variant="accent" onClick={() => void install()}>
                <Download size={14} /> Install app
              </GlassButton>
            )}
            <GlassButton size="sm" onClick={() => showShortcuts(true)}>
              <Keyboard size={14} /> Keyboard shortcuts
            </GlassButton>
            <GlassButton
              size="sm"
              variant="danger"
              onClick={() => {
                s.reset();
                toast({ kind: 'info', title: 'Settings reset to defaults' });
              }}
            >
              <RotateCcw size={14} /> Reset settings
            </GlassButton>
          </div>
          <p className="text-[11.5px] leading-relaxed text-fg-3">
            Arnav Flight Radar uses no cookies, no analytics and no accounts. Preferences, bookmarks and filter presets live in this browser’s local
            storage. Informational use only — not for navigation.
          </p>
        </Section>
      </div>
    </Panel>
  );
}

function UnitRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12.5px] font-medium text-fg-2">{label}</span>
      <div className="w-[230px]">{children}</div>
    </div>
  );
}
