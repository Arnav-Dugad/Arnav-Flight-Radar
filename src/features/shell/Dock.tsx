import { Search } from 'lucide-react';
import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from 'motion/react';
import { useRef, type ReactNode } from 'react';
import {
  AirportIcon,
  AltitudeIcon,
  AnalyticsIcon,
  BookmarkIcon,
  CompareIcon,
  FilterIcon,
  GlobeIcon,
  LayersIcon,
  MeasureIcon,
  PresentationIcon,
  RadarIcon,
  TimelineIcon,
} from '@/components/icons';
import { Tooltip } from '@/components/ui/Tooltip';
import { activeFilterCount } from '@/lib/filters';
import { cn } from '@/lib/cn';
import { useMedia } from '@/lib/useMedia';
import { setProjection } from '@/map/controller';
import { useFilters } from '@/state/filters';
import { useSettings } from '@/state/settings';
import { useUI } from '@/state/ui';

interface Item {
  key: string;
  label: string;
  shortcut?: string;
  icon: ReactNode;
  active: boolean;
  badge?: number;
  onClick: () => void;
}

/** Vertical dock with desktop-OS style magnification that follows the pointer. */
export function Dock() {
  const mouseY = useMotionValue(Infinity);
  const panel = useUI((s) => s.panel);
  const projection = useUI((s) => s.projection);
  const measure = useUI((s) => s.measure.active);
  const togglePanel = useUI((s) => s.togglePanel);
  const openPanel = useUI((s) => s.openPanel);
  const setSearchOpen = useUI((s) => s.setSearchOpen);
  const setMeasure = useUI((s) => s.setMeasure);
  const setPresentation = useUI((s) => s.setPresentation);
  const filters = useFilters((s) => s.filters);
  const motionLevel = useSettings((s) => s.motion);
  const showProfile = useSettings((s) => s.showProfile);
  const setSetting = useSettings((s) => s.set);
  const nFilters = activeFilterCount(filters);
  // Short laptop screens: smaller items; very short: tools move to Discover/shortcuts.
  const compact = useMedia('(max-height: 880px)');
  const tiny = useMedia('(max-height: 740px)');

  const groups: Item[][] = [
    [
      { key: 'radar', label: 'Radar', icon: <RadarIcon />, active: panel === null, onClick: () => openPanel(null) },
      {
        key: 'globe',
        label: projection === 'globe' ? 'Flat map' : 'Globe',
        shortcut: 'G',
        icon: <GlobeIcon />,
        active: projection === 'globe',
        onClick: () => setProjection(projection === 'globe' ? 'mercator' : 'globe'),
      },
      { key: 'airports', label: 'Airports', icon: <AirportIcon />, active: panel === 'airports', onClick: () => togglePanel('airports') },
      { key: 'search', label: 'Search', shortcut: '/', icon: <Search size={19} strokeWidth={1.7} />, active: false, onClick: () => setSearchOpen(true) },
      {
        key: 'filters',
        label: 'Filters',
        shortcut: 'F',
        icon: <FilterIcon />,
        active: panel === 'filters',
        badge: nFilters,
        onClick: () => togglePanel('filters'),
      },
      { key: 'analytics', label: 'Analytics', icon: <AnalyticsIcon />, active: panel === 'analytics', onClick: () => togglePanel('analytics') },
      { key: 'bookmarks', label: 'Bookmarks', shortcut: 'B', icon: <BookmarkIcon />, active: panel === 'bookmarks', onClick: () => togglePanel('bookmarks') },
      { key: 'layers', label: 'Layers', shortcut: 'L', icon: <LayersIcon />, active: panel === 'layers', onClick: () => togglePanel('layers') },
    ],
    [
      { key: 'timeline', label: 'Timeline replay', shortcut: 'T', icon: <TimelineIcon />, active: panel === 'timeline', onClick: () => togglePanel('timeline') },
      { key: 'profile', label: 'Vertical profile', shortcut: 'V', icon: <AltitudeIcon />, active: showProfile, onClick: () => setSetting('showProfile', !showProfile) },
      { key: 'compare', label: 'Compare aircraft', icon: <CompareIcon />, active: panel === 'compare', onClick: () => togglePanel('compare') },
      {
        key: 'measure',
        label: measure ? 'Stop measuring' : 'Measure distance',
        shortcut: 'M',
        icon: <MeasureIcon />,
        active: measure,
        onClick: () => setMeasure({ active: !measure, points: [] }),
      },
      { key: 'present', label: 'Presentation mode', shortcut: 'P', icon: <PresentationIcon />, active: false, onClick: () => setPresentation(true) },
    ],
  ];

  return (
    <motion.nav
      aria-label="Tools"
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30, delay: 0.12 }}
      onMouseMove={(e) => mouseY.set(e.clientY)}
      onMouseLeave={() => mouseY.set(Infinity)}
      className="glass pointer-events-auto absolute left-4 top-1/2 z-20 flex -translate-y-1/2 flex-col items-center gap-1 rounded-[22px] p-1.5"
    >
      {(tiny ? groups.slice(0, 1) : groups).map((g, gi) => (
        <div key={gi} className={cn('flex flex-col items-center', compact ? 'gap-0.5' : 'gap-1')}>
          {gi > 0 && <div className="my-1 h-px w-7 bg-[var(--line-strong)]" />}
          {g.map((it) => (
            <DockItem key={it.key} item={it} mouseY={mouseY} magnify={motionLevel === 'full'} compact={compact} />
          ))}
        </div>
      ))}
    </motion.nav>
  );
}

function DockItem({ item, mouseY, magnify, compact }: { item: Item; mouseY: MotionValue<number>; magnify: boolean; compact: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const distance = useTransform(mouseY, (y) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return Infinity;
    return y - (r.top + r.height / 2);
  });
  const scaleRaw = useTransform(distance, [-110, 0, 110], magnify ? [1, 1.32, 1] : [1, 1, 1], { clamp: true });
  const scale = useSpring(scaleRaw, { stiffness: 420, damping: 26, mass: 0.4 });
  const x = useTransform(scale, (s) => (s - 1) * 14);

  return (
    <Tooltip content={item.label} shortcut={item.shortcut} side="right">
      <motion.button
        ref={ref}
        type="button"
        aria-label={item.label}
        aria-pressed={item.active}
        onClick={item.onClick}
        style={{ scale, x }}
        whileTap={{ scale: 0.9 }}
        className={cn(
          'relative grid place-items-center rounded-[13px] text-fg-2 transition-colors duration-200 hover:text-fg',
          compact ? 'size-9' : 'size-10',
          item.active ? 'bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent)] hover:text-[var(--accent)]' : 'hover:bg-[var(--line)]',
        )}
      >
        {item.icon}
        {item.active && (
          <motion.span
            layoutId="dock-active"
            className="absolute -left-1.5 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-[var(--accent)]"
            transition={{ type: 'spring', stiffness: 500, damping: 35 }}
          />
        )}
        {!!item.badge && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--accent)] px-1 text-[9.5px] font-bold text-[#03111c]">
            {item.badge}
          </span>
        )}
      </motion.button>
    </Tooltip>
  );
}
