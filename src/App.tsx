import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { useEffect, useState } from 'react';
import { Toasts } from '@/components/ui/Toasts';
import { useIsMobile, useMedia } from '@/lib/useMedia';
import { useSettings } from '@/state/settings';
import { useUI } from '@/state/ui';
import { useView } from '@/state/view';
import { STYLE_META } from '@/map/styles';
import { AircraftPanel } from '@/features/aircraft/AircraftPanel';
import { AirportPanel } from '@/features/airports/AirportPanel';
import { FiltersPanel } from '@/features/filters/FiltersPanel';
import { LazyPanels, prefetchPanels } from '@/features/LazyPanels';
import { SearchCommand } from '@/features/search/SearchCommand';
import { Dock } from '@/features/shell/Dock';
import { MapControls } from '@/features/shell/MapControls';
import { MapView } from '@/features/shell/MapView';
import { MobileHeader, MobileNav } from '@/features/shell/Mobile';
import { CoverageNotice, FollowBanner, MeasureHUD, PresentationOverlay, RadarSweep, TourBadge } from '@/features/shell/Overlays';
import { ShortcutsModal, useGlobalShortcuts } from '@/features/shell/Shortcuts';
import { StatusBar } from '@/features/shell/StatusBar';
import { TopBar } from '@/features/shell/TopBar';
import { ReplayBar, TimelinePanel } from '@/features/timeline/Timeline';

function useThemeSync() {
  const appearance = useSettings((s) => s.appearance);
  const mapStyle = useSettings((s) => s.mapStyle);
  const reducedEffects = useSettings((s) => s.reducedEffects);
  const motionLevel = useSettings((s) => s.motion);
  const prefersLight = useMedia('(prefers-color-scheme: light)');
  useEffect(() => {
    const theme =
      appearance === 'map' ? (STYLE_META[mapStyle].dark ? 'dark' : 'light') : appearance === 'system' ? (prefersLight ? 'light' : 'dark') : appearance;
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.effects = reducedEffects ? 'reduced' : 'full';
    root.dataset.motion = motionLevel === 'full' ? 'full' : 'reduced';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#EEF2F7' : '#03060B');
  }, [appearance, mapStyle, prefersLight, reducedEffects, motionLevel]);
}

function Splash() {
  const ready = useView((s) => s.ready);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 5000);
    return () => clearTimeout(t);
  }, []);
  return (
    <AnimatePresence>
      {!ready && !timedOut && (
        <motion.div
          key="splash"
          className="absolute inset-0 z-[80] grid place-items-center bg-[var(--canvas)]"
          exit={{ opacity: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } }}
          aria-hidden="true"
        >
          <motion.div initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} className="flex flex-col items-center gap-5">
            <img src="/brand/arnav-mark-animated.svg" width={112} height={112} alt="" className="drop-shadow-[0_30px_60px_rgba(0,0,0,0.6)]" />
            <div className="text-center">
              <div className="text-[18px] font-semibold tracking-[0.3em] text-fg">ARNAV</div>
              <div className="mt-1 text-[10px] font-semibold tracking-[0.42em] text-fg-3">FLIGHT RADAR</div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function App() {
  useThemeSync();
  useGlobalShortcuts();
  useEffect(prefetchPanels, []);
  const mobile = useIsMobile();
  const presentation = useUI((s) => s.presentation);
  const motionLevel = useSettings((s) => s.motion);

  return (
    <MotionConfig reducedMotion={motionLevel === 'full' ? 'user' : 'always'}>
      <div className="relative h-dvh w-full overflow-hidden bg-[var(--canvas)] text-fg">
        <h1 className="sr-only">Arnav Flight Radar — live aircraft map</h1>
        <MapView />
        <RadarSweep />
        <TourBadge />
        {!presentation && (
          <div className="pointer-events-none absolute inset-0">
            {mobile ? <MobileHeader /> : <TopBar />}
            {!mobile && <Dock />}
            <MapControls />
            {!mobile && <StatusBar />}
            {mobile && <MobileNav />}
            <FollowBanner />
            <CoverageNotice />
            <MeasureHUD />
            <ReplayBar />
          </div>
        )}
        {!presentation && (
          <div className="pointer-events-none absolute inset-0 z-30 [&>*]:pointer-events-auto">
            <AircraftPanel />
            <AirportPanel />
            <FiltersPanel />
            <TimelinePanel />
            <LazyPanels />
          </div>
        )}
        <PresentationOverlay />
        <SearchCommand />
        <ShortcutsModal />
        <Toasts />
        <Splash />
      </div>
    </MotionConfig>
  );
}
