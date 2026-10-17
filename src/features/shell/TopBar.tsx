import { Search, Settings } from 'lucide-react';
import { motion } from 'motion/react';
import { AirportIcon, AnalyticsIcon, BrandMark, DiscoverIcon, LayersIcon, RadarIcon } from '@/components/icons';
import { IconButton, useSheen } from '@/components/ui/Glass';
import { Kbd } from '@/components/ui/Feedback';
import { cn } from '@/lib/cn';
import { useUI, type PanelId } from '@/state/ui';
import { LiveStatus } from './LiveStatus';

const NAV: { id: PanelId | null; label: string; icon: React.ReactNode }[] = [
  { id: null, label: 'Radar', icon: <RadarIcon size={16} /> },
  { id: 'airports', label: 'Airports', icon: <AirportIcon size={16} /> },
  { id: 'analytics', label: 'Analytics', icon: <AnalyticsIcon size={16} /> },
  { id: 'discover', label: 'Discover', icon: <DiscoverIcon size={16} /> },
];

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function TopBar() {
  const panel = useUI((s) => s.panel);
  const openPanel = useUI((s) => s.openPanel);
  const togglePanel = useUI((s) => s.togglePanel);
  const setSearchOpen = useUI((s) => s.setSearchOpen);
  const sheen = useSheen();
  const activeNav = NAV.find((n) => n.id === panel)?.id ?? (panel === null || panel === 'aircraft' || panel === 'airport' ? null : 'none');

  return (
    <motion.header
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30, delay: 0.05 }}
      className="glass pointer-events-auto absolute left-4 right-4 top-4 z-30 flex h-[52px] items-center gap-3 rounded-[20px] px-2.5"
    >
      <a href="/" className="flex shrink-0 items-center gap-2.5 rounded-[12px] py-1 pl-1 pr-2" aria-label="Arnav Flight Radar home">
        <BrandMark size={32} />
        <span className="hidden flex-col leading-none lg:flex">
          <span className="text-[14.5px] font-semibold tracking-[0.16em] text-fg">ARNAV</span>
          <span className="mt-[3px] text-[8.5px] font-semibold tracking-[0.34em] text-fg-3">FLIGHT RADAR</span>
        </span>
      </a>

      <LiveStatus />

      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        onPointerMove={sheen}
        className="sheen glass-2 mx-auto flex h-9 w-full max-w-[420px] items-center gap-2.5 rounded-[12px] px-3 text-left text-[13px] text-fg-3 transition-colors hover:text-fg-2"
        aria-label="Search flights, airports and places"
        aria-keyshortcuts="Control+K Meta+K"
      >
        <Search size={15} />
        <span className="flex-1 truncate">Search flights, airports, places…</span>
        <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
        <Kbd>K</Kbd>
      </button>

      <nav aria-label="Primary" className="glass-2 relative hidden h-9 items-center rounded-[12px] p-[3px] xl:flex">
        {NAV.map((n) => {
          const active = activeNav === n.id;
          return (
            <button
              key={n.label}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => (n.id === null ? openPanel(null) : togglePanel(n.id))}
              className={cn(
                'relative z-[1] flex h-full items-center gap-1.5 rounded-[9px] px-3 text-[12.5px] font-medium transition-colors',
                active ? 'text-fg' : 'text-fg-3 hover:text-fg-2',
              )}
            >
              {active && (
                <motion.span
                  layoutId="topnav"
                  className="absolute inset-0 -z-[1] rounded-[9px] bg-[var(--surface-solid)] ring-1 ring-[var(--line-strong)]"
                  transition={{ type: 'spring', stiffness: 520, damping: 38 }}
                />
              )}
              {n.icon}
              {n.label}
            </button>
          );
        })}
      </nav>

      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton label="Map styles & layers" shortcut="L" active={panel === 'layers'} onClick={() => togglePanel('layers')}>
          <LayersIcon size={19} />
        </IconButton>
        <IconButton label="Settings" shortcut="," active={panel === 'settings'} onClick={() => togglePanel('settings')}>
          <Settings size={18} />
        </IconButton>
      </div>
    </motion.header>
  );
}
