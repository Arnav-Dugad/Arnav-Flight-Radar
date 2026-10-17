import { Clock, Eye, Plus, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { classifyAircraft } from '@shared/classify';
import { AircraftGlyph, BookmarkIcon } from '@/components/icons';
import { TextField } from '@/components/ui/Controls';
import { EmptyState } from '@/components/ui/Feedback';
import { GlassButton, Section } from '@/components/ui/Glass';
import { Panel } from '@/components/ui/Sheet';
import { airportByCode } from '@/data/airports';
import { fmtAltitude } from '@/lib/format';
import { useTrafficVersion } from '@/lib/hooks';
import { flyTo, focusAircraft, getMap } from '@/map/controller';
import { useBookmarks } from '@/state/bookmarks';
import { useSettings } from '@/state/settings';
import { traffic } from '@/state/traffic';
import { useUI } from '@/state/ui';

export function BookmarksPanel() {
  const open = useUI((s) => s.panel === 'bookmarks');
  const openPanel = useUI((s) => s.openPanel);
  const select = useUI((s) => s.select);
  const selectAirport = useUI((s) => s.selectAirport);
  const toast = useUI((s) => s.toast);
  const b = useBookmarks();
  const style = useSettings((s) => s.mapStyle);
  const setStyle = useSettings((s) => s.set);
  const altUnit = useSettings((s) => s.units.altitude);
  const [name, setName] = useState('');
  useTrafficVersion();

  const saveView = () => {
    const m = getMap();
    if (!m) return;
    const c = m.getCenter();
    b.saveView({ name: name.trim() || `View ${b.views.length + 1}`, lat: c.lat, lon: c.lng, zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch(), style });
    setName('');
    toast({ kind: 'success', title: 'Viewpoint saved' });
  };

  return (
    <Panel open={open} onClose={() => openPanel(null)} title="Bookmarks" icon={<BookmarkIcon size={18} />} ariaLabel="Bookmarks" subtitle="Stored only in this browser">
      <div className="space-y-6 pt-1">
        <Section title="Saved viewpoints">
          <div className="flex items-end gap-2">
            <TextField className="flex-1" label="Name this view" value={name} onChange={setName} placeholder="e.g. Heathrow approach" />
            <GlassButton size="sm" onClick={saveView}>
              <Plus size={14} /> Save view
            </GlassButton>
          </div>
          {b.views.length === 0 ? (
            <p className="text-[12px] text-fg-3">Save the current camera — position, zoom, rotation, tilt and map style — to return later.</p>
          ) : (
            <ul className="glass-2 divide-y divide-[var(--line)] rounded-[16px]">
              {b.views.map((v) => (
                <li key={v.id} className="flex items-center gap-2 py-1 pl-3.5 pr-1">
                  <button
                    type="button"
                    className="min-w-0 flex-1 py-1.5 text-left"
                    onClick={() => {
                      if (v.style && v.style !== style) setStyle('mapStyle', v.style);
                      getMap()?.flyTo({ center: [v.lon, v.lat], zoom: v.zoom, bearing: v.bearing, pitch: v.pitch, duration: 1800 });
                    }}
                  >
                    <div className="truncate text-[13px] font-medium text-fg">{v.name}</div>
                    <div className="tnum text-[11px] text-fg-3">
                      {v.lat.toFixed(2)}, {v.lon.toFixed(2)} · z{v.zoom.toFixed(1)}
                      {v.pitch > 1 ? ` · tilt ${Math.round(v.pitch)}°` : ''}
                    </div>
                  </button>
                  <button type="button" aria-label={`Delete ${v.name}`} onClick={() => b.deleteView(v.id)} className="grid size-8 place-items-center rounded-lg text-fg-3 hover:bg-[var(--line)] hover:text-[#ff8a9a]">
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Favourite aircraft">
          {b.aircraft.length === 0 ? (
            <p className="text-[12px] text-fg-3">Star an aircraft in its details panel to keep it here.</p>
          ) : (
            <ul className="glass-2 divide-y divide-[var(--line)] rounded-[16px]">
              {b.aircraft.map((f) => {
                const t = traffic.get(f.hex);
                return (
                  <li key={f.hex} className="flex items-center gap-2 py-1 pl-3.5 pr-1">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-3 py-1.5 text-left"
                      onClick={() => {
                        select(f.hex);
                        if (t) focusAircraft(f.hex, 9);
                      }}
                    >
                      {t ? <AircraftGlyph cls={classifyAircraft(t.ac)} size={18} rotate={t.ac.track ?? 0} className="text-[var(--accent)]" /> : <Star size={16} className="text-fg-3" />}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-fg">{f.label}</span>
                        <span className="block truncate text-[11px] text-fg-3">
                          {f.hex.toUpperCase()}
                          {f.type ? ` · ${f.type}` : ''} · {t ? `in view at ${fmtAltitude(t.ac.altitudeBarometric ?? t.ac.altitudeGeometric, altUnit, t.ac.onGround)}` : 'tap to look up worldwide'}
                        </span>
                      </span>
                    </button>
                    <button type="button" aria-label={`Remove ${f.label}`} onClick={() => b.toggleAircraft(f)} className="grid size-8 place-items-center rounded-lg text-fg-3 hover:bg-[var(--line)] hover:text-[#ff8a9a]">
                      <Trash2 size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Favourite airports">
          {b.airports.length === 0 ? (
            <p className="text-[12px] text-fg-3">Star an airport in its panel to keep it here.</p>
          ) : (
            <ul className="glass-2 divide-y divide-[var(--line)] rounded-[16px]">
              {b.airports.map((id) => {
                const a = airportByCode(id);
                return (
                  <li key={id} className="flex items-center gap-2 py-1 pl-3.5 pr-1">
                    <button
                      type="button"
                      className="min-w-0 flex-1 py-1.5 text-left"
                      onClick={() => {
                        selectAirport(id);
                        if (a) flyTo(a.lon, a.lat, 10.5);
                      }}
                    >
                      <span className="block truncate text-[13px] font-medium text-fg">
                        {a?.iata && <span className="mr-2 text-[var(--accent)]">{a.iata}</span>}
                        {a?.name ?? id}
                      </span>
                      <span className="block truncate text-[11px] text-fg-3">{[a?.icao ?? id, a?.city].filter(Boolean).join(' · ')}</span>
                    </button>
                    <button type="button" aria-label={`Remove ${id}`} onClick={() => b.toggleAirport(id)} className="grid size-8 place-items-center rounded-lg text-fg-3 hover:bg-[var(--line)] hover:text-[#ff8a9a]">
                      <Trash2 size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="Recently explored" action={b.recents.length > 0 && <button type="button" onClick={b.clearRecents} className="text-[11px] text-fg-3 hover:text-fg">Clear</button>}>
          {b.recents.length === 0 ? (
            <EmptyState icon={<Clock size={18} />} title="Nothing yet" body="Places, airports and aircraft you open appear here." />
          ) : (
            <ul className="space-y-1">
              {b.recents.map((r) => (
                <li key={`${r.kind}-${r.id}`}>
                  <button
                    type="button"
                    onClick={() => {
                      if (r.kind === 'aircraft') select(r.id);
                      else if (r.kind === 'airport') selectAirport(r.id);
                      if (r.lat !== undefined && r.lon !== undefined) flyTo(r.lon, r.lat, r.zoom ?? (r.kind === 'country' ? 5 : 9.5));
                    }}
                    className="flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left hover:bg-[var(--line)]"
                  >
                    <Eye size={14} className="shrink-0 text-fg-3" />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{r.label}</span>
                    <span className="shrink-0 text-[10.5px] capitalize text-fg-3">{r.kind}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </Panel>
  );
}
