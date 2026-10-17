import { Save, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CLASS_LABEL, type AircraftClass } from '@shared/classify';
import { countryFromIcao, REGISTRY_COUNTRIES } from '@shared/icaoCountry';
import type { PositionSource } from '@shared/types';
import { AircraftGlyph, FilterIcon } from '@/components/icons';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { Chip, RangeSlider, SegmentedControl, TextField, Toggle } from '@/components/ui/Controls';
import { GlassButton, Section } from '@/components/ui/Glass';
import { Panel } from '@/components/ui/Sheet';
import { activeFilterCount, compileFilter, EMPTY_FILTERS, type VerticalState } from '@/lib/filters';
import { useTrafficVersion } from '@/lib/hooks';
import { useFilters } from '@/state/filters';
import { traffic } from '@/state/traffic';
import { useUI } from '@/state/ui';

const CLASSES: AircraftClass[] = ['widebody', 'narrowbody', 'regional', 'turboprop', 'bizjet', 'helicopter', 'light', 'glider', 'military', 'drone', 'balloon', 'ground', 'unknown'];
const SOURCES: { id: PositionSource; label: string }[] = [
  { id: 'adsb', label: 'ADS-B' },
  { id: 'mlat', label: 'MLAT' },
  { id: 'tisb', label: 'TIS-B' },
  { id: 'adsr', label: 'ADS-R' },
  { id: 'adsc', label: 'ADS-C' },
  { id: 'modes', label: 'Mode S' },
];

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function FiltersPanel() {
  const open = useUI((s) => s.panel === 'filters');
  const openPanel = useUI((s) => s.openPanel);
  const { filters: f, update, clear, highlightMode, setHighlightMode, presets, savePreset, applyPreset, deletePreset } = useFilters();
  const [presetName, setPresetName] = useState('');
  const [countryQuery, setCountryQuery] = useState('');
  useTrafficVersion();

  const all = traffic.current();
  const predicate = useMemo(() => compileFilter(f), [f]);
  const matching = all.filter((a) => predicate(a)).length;
  const n = activeFilterCount(f);

  const presentCountries = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of all) {
      const c = countryFromIcao(a.icao24);
      if (c) m.set(c.iso, (m.get(c.iso) ?? 0) + 1);
    }
    return m;
  }, [all]);
  const countryOptions = REGISTRY_COUNTRIES.filter(
    (c) => f.countries.includes(c.iso) || (countryQuery ? c.name.toLowerCase().includes(countryQuery.toLowerCase()) : presentCountries.has(c.iso)),
  )
    .sort((a, b) => (presentCountries.get(b.iso) ?? 0) - (presentCountries.get(a.iso) ?? 0))
    .slice(0, 14);

  return (
    <Panel
      open={open}
      onClose={() => openPanel(null)}
      title="Filters"
      icon={<FilterIcon size={18} />}
      ariaLabel="Aircraft filters"
      subtitle={
        <span className="tnum">
          <AnimatedNumber value={matching} /> of {all.length} observed aircraft match{n ? ` · ${n} active` : ''}
        </span>
      }
      footer={
        <div className="flex items-center gap-2">
          <GlassButton size="sm" variant="ghost" onClick={clear} disabled={n === 0}>
            Clear all
          </GlassButton>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[12px] text-fg-3">{highlightMode ? 'Dim non-matching' : 'Hide non-matching'}</span>
            <SegmentedControl
              size="sm"
              label="Filter mode"
              value={highlightMode ? 'dim' : 'hide'}
              onChange={(v) => setHighlightMode(v === 'dim')}
              options={[
                { value: 'hide', label: 'Hide' },
                { value: 'dim', label: 'Dim' },
              ]}
            />
          </div>
        </div>
      }
    >
      <div className="space-y-6 pt-1">
        <Section title="Flight state">
          <SegmentedControl
            label="Ground state"
            value={f.ground}
            onChange={(v) => update({ ground: v })}
            options={[
              { value: 'all', label: 'All' },
              { value: 'airborne', label: 'Airborne' },
              { value: 'ground', label: 'On ground' },
            ]}
          />
          <div className="flex flex-wrap gap-1.5">
            {(['climbing', 'level', 'descending'] as VerticalState[]).map((v) => (
              <Chip key={v} active={f.vertical.includes(v)} onClick={() => update({ vertical: toggle(f.vertical, v) })}>
                {v[0]!.toUpperCase() + v.slice(1)}
              </Chip>
            ))}
          </div>
        </Section>

        <Section title="Altitude & speed" action={(f.altitude || f.speed) && <button type="button" className="text-[11px] text-fg-3 hover:text-fg" onClick={() => update({ altitude: null, speed: null })}>Reset</button>}>
          <RangeSlider
            label="Altitude"
            min={0}
            max={50000}
            step={500}
            value={f.altitude ?? [0, 50000]}
            onChange={(v) => update({ altitude: v[0] === 0 && v[1] === 50000 ? null : v })}
            format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k ft` : `${v} ft`)}
          />
          <RangeSlider
            label="Ground speed"
            min={0}
            max={700}
            step={10}
            value={f.speed ?? [0, 700]}
            onChange={(v) => update({ speed: v[0] === 0 && v[1] === 700 ? null : v })}
            format={(v) => `${v} kt`}
          />
        </Section>

        <Section title="Aircraft category">
          <div className="flex flex-wrap gap-1.5">
            {CLASSES.map((c) => (
              <Chip key={c} active={f.classes.includes(c)} onClick={() => update({ classes: toggle(f.classes, c) })} icon={<AircraftGlyph cls={c} size={15} />}>
                {CLASS_LABEL[c]}
              </Chip>
            ))}
          </div>
          <p className="text-[11px] text-fg-3">Categories come from the reported ICAO type code or ADS-B emitter category; unclassifiable aircraft are “Unclassified”.</p>
        </Section>

        <Section title="Identification">
          <div className="grid grid-cols-2 gap-2.5">
            <TextField label="Callsign contains" value={f.callsign} onChange={(v) => update({ callsign: v })} placeholder="BAW" maxLength={8} />
            <TextField label="Registration" value={f.registration} onChange={(v) => update({ registration: v })} placeholder="G-" maxLength={10} />
            <TextField label="Type code / name" value={f.type} onChange={(v) => update({ type: v })} placeholder="A320, 787" maxLength={20} />
            <TextField label="Squawk starts with" value={f.squawk} onChange={(v) => update({ squawk: v.replace(/[^0-7]/g, '') })} placeholder="7700" maxLength={4} inputMode="numeric" />
          </div>
        </Section>

        <Section title="Registry country (ICAO address block)">
          <TextField label="Find a country" value={countryQuery} onChange={setCountryQuery} placeholder="e.g. India" />
          <div className="flex flex-wrap gap-1.5">
            {countryOptions.map((c) => (
              <Chip key={c.iso} active={f.countries.includes(c.iso)} onClick={() => update({ countries: toggle(f.countries, c.iso) })}>
                <span className="tnum text-[10px] font-bold opacity-70">{c.iso}</span> {c.name}
                {presentCountries.get(c.iso) ? <span className="tnum opacity-60">{presentCountries.get(c.iso)}</span> : null}
              </Chip>
            ))}
            {countryOptions.length === 0 && <span className="text-[12px] text-fg-3">No matching countries.</span>}
          </div>
        </Section>

        <Section title="Data">
          <div className="flex flex-wrap gap-1.5">
            {SOURCES.map((s) => (
              <Chip key={s.id} active={f.sources.includes(s.id)} onClick={() => update({ sources: toggle(f.sources, s.id) })}>
                {s.label}
              </Chip>
            ))}
          </div>
          <SegmentedControl
            label="Maximum data age"
            value={String(f.maxAgeSec ?? 'any')}
            onChange={(v) => update({ maxAgeSec: v === 'any' ? null : Number(v) })}
            options={[
              { value: 'any', label: 'Any age' },
              { value: '10', label: '≤ 10 s' },
              { value: '30', label: '≤ 30 s' },
              { value: '60', label: '≤ 60 s' },
            ]}
          />
          <Toggle label="Military only" description="Aircraft flagged military in the provider database." checked={f.militaryOnly} onChange={(v) => update({ militaryOnly: v })} />
          <Toggle label="Emergencies only" description="Squawk 7500/7600/7700 or an emergency status." checked={f.emergenciesOnly} onChange={(v) => update({ emergenciesOnly: v })} />
          <Toggle
            label="Exclude unknown values"
            description="When a range filter is set, also hide aircraft that do not report that value."
            checked={f.excludeUnknown}
            onChange={(v) => update({ excludeUnknown: v })}
          />
        </Section>

        <Section title="Presets (saved on this device)">
          <div className="flex items-end gap-2">
            <TextField className="flex-1" label="Preset name" value={presetName} onChange={setPresetName} placeholder="e.g. Heavy jets above FL300" />
            <GlassButton
              size="sm"
              disabled={!presetName.trim() || n === 0}
              onClick={() => {
                savePreset(presetName);
                setPresetName('');
              }}
            >
              <Save size={14} /> Save
            </GlassButton>
          </div>
          {presets.length === 0 ? (
            <p className="text-[12px] text-fg-3">No presets yet. Set some filters, name them and save.</p>
          ) : (
            <ul className="space-y-1.5">
              {presets.map((p) => (
                <li key={p.name} className="glass-2 flex items-center gap-2 rounded-[12px] py-1 pl-3 pr-1">
                  <button type="button" className="min-w-0 flex-1 truncate text-left text-[13px] text-fg hover:text-[var(--accent)]" onClick={() => applyPreset(p.name)}>
                    {p.name}
                    <span className="ml-2 text-[11px] text-fg-3">{activeFilterCount({ ...EMPTY_FILTERS, ...p.filters })} filters</span>
                  </button>
                  <button type="button" aria-label={`Delete preset ${p.name}`} onClick={() => deletePreset(p.name)} className="grid size-8 place-items-center rounded-lg text-fg-3 hover:bg-[var(--line)] hover:text-[#ff8a9a]">
                    <Trash2 size={14} />
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
