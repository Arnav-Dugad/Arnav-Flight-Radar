import { LayoutGrid, Search, Settings } from 'lucide-react';
import { motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import {
  AirportIcon,
  AnalyticsIcon,
  BookmarkIcon,
  BrandMark,
  CompareIcon,
  DataIcon,
  DiscoverIcon,
  FilterIcon,
  GlobeIcon,
  LayersIcon,
  MeasureIcon,
  PresentationIcon,
  RadarIcon,
  SpotterIcon,
  TimelineIcon,
} from '@/components/icons';
import { IconButton } from '@/components/ui/Glass';
import { Panel } from '@/components/ui/Sheet';
import { activeFilterCount } from '@/lib/filters';
import { cn } from '@/lib/cn';
import { setProjection } from '@/map/controller';
import { useFilters } from '@/state/filters';
import { useUI, type PanelId } from '@/state/ui';
import { LiveStatus } from './LiveStatus';

export function MobileHeader() {
  const setSearchOpen = useUI((s) => s.setSearchOpen);
  const togglePanel = useUI((s) => s.togglePanel);
  return (
    <motion.header
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass pointer-events-auto absolute inset-x-3 top-[max(env(safe-area-inset-top),10px)] z-30 flex h-[50px] items-center gap-2 rounded-[18px] pl-2 pr-1"
    >
      <BrandMark size={30} />
      <span className="text-[13px] font-semibold tracking-[0.14em] max-[380px]:hidden">ARNAV</span>
      <div className="ml-auto">
        <LiveStatus compact />
      </div>
      <IconButton label="Search" onClick={() => setSearchOpen(true)} size={38}>
        <Search size={18} />
      </IconButton>
      <IconButton label="Settings" onClick={() => togglePanel('settings')} size={38}>
        <Settings size={18} />
      </IconButton>
    </motion.header>
  );
}

const TABS: { id: PanelId | null | 'search' | 'more'; label: string; icon: ReactNode }[] = [
  { id: null, label: 'Radar', icon: <RadarIcon size={21} /> },
  { id: 'search', label: 'Search', icon: <Search size={20} strokeWidth={1.7} /> },
  { id: 'airports', label: 'Airports', icon: <AirportIcon size={21} /> },
  { id: 'analytics', label: 'Stats', icon: <AnalyticsIcon size={21} /> },
  { id: 'more', label: 'More', icon: <LayoutGrid size={20} strokeWidth={1.7} /> },
];

export function MobileNav() {
  const panel = useUI((s) => s.panel);
  const openPanel = useUI((s) => s.openPanel);
  const setSearchOpen = useUI((s) => s.setSearchOpen);
  const [more, setMore] = useState(false);
  const active = more ? 'more' : panel === null || panel === 'aircraft' || panel === 'airport' ? null : (TABS.find((t) => t.id === panel)?.id ?? 'more');

  return (
    <>
      <nav aria-label="Primary" className="glass pointer-events-auto absolute inset-x-3 bottom-[max(env(safe-area-inset-bottom),10px)] z-30 flex h-[62px] items-stretch rounded-[22px] px-1">
        {TABS.map((t) => {
          const isActive = active === t.id;
          return (
            <button
              key={t.label}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => {
                if (t.id === 'search') return setSearchOpen(true);
                if (t.id === 'more') return setMore(true);
                setMore(false);
                openPanel(t.id === panel ? null : t.id);
              }}
              className={cn('relative flex flex-1 flex-col items-center justify-center gap-1 rounded-[16px] text-[10.5px] font-medium transition-colors', isActive ? 'text-[var(--accent)]' : 'text-fg-3')}
            >
              {isActive && (
                <motion.span layoutId="mobile-tab" className="absolute inset-1 -z-[1] rounded-[16px] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />
              )}
              {t.icon}
              {t.label}
            </button>
          );
        })}
      </nav>
      <MoreSheet open={more} onClose={() => setMore(false)} />
    </>
  );
}

function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const openPanel = useUI((s) => s.openPanel);
  const projection = useUI((s) => s.projection);
  const setMeasure = useUI((s) => s.setMeasure);
  const setPresentation = useUI((s) => s.setPresentation);
  const nFilters = activeFilterCount(useFilters((s) => s.filters));
  const go = (p: PanelId) => {
    onClose();
    openPanel(p);
  };
  const items: { label: string; icon: ReactNode; run: () => void; badge?: number }[] = [
    { label: 'Filters', icon: <FilterIcon />, run: () => go('filters'), badge: nFilters },
    { label: 'Layers', icon: <LayersIcon />, run: () => go('layers') },
    { label: projection === 'globe' ? 'Flat map' : 'Globe', icon: <GlobeIcon />, run: () => (onClose(), setProjection(projection === 'globe' ? 'mercator' : 'globe')) },
    { label: 'Bookmarks', icon: <BookmarkIcon />, run: () => go('bookmarks') },
    { label: 'Discover', icon: <DiscoverIcon />, run: () => go('discover') },
    { label: 'Timeline', icon: <TimelineIcon />, run: () => go('timeline') },
    { label: 'Compare', icon: <CompareIcon />, run: () => go('compare') },
    { label: 'Spotter', icon: <SpotterIcon />, run: () => go('spotter') },
    { label: 'Measure', icon: <MeasureIcon />, run: () => (onClose(), setMeasure({ active: true, points: [] })) },
    { label: 'Present', icon: <PresentationIcon />, run: () => (onClose(), setPresentation(true)) },
    { label: 'Data', icon: <DataIcon />, run: () => go('data') },
    { label: 'Settings', icon: <Settings size={20} strokeWidth={1.7} />, run: () => go('settings') },
  ];
  return (
    <Panel open={open} onClose={onClose} title="More" icon={<LayoutGrid size={18} />} ariaLabel="More tools">
      <div className="grid grid-cols-3 gap-2 pt-1">
        {items.map((it) => (
          <button key={it.label} type="button" onClick={it.run} className="glass-2 relative flex flex-col items-center gap-2 rounded-[16px] px-2 py-3.5 text-[12px] font-medium text-fg-2 active:scale-95">
            <span className="text-[var(--accent)]">{it.icon}</span>
            {it.label}
            {!!it.badge && <span className="absolute right-2 top-2 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--accent)] px-1 text-[9.5px] font-bold text-[#03111c]">{it.badge}</span>}
          </button>
        ))}
      </div>
    </Panel>
  );
}
