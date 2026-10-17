// Secondary panels are code-split and fetched the first time they are opened.
// Once loaded they stay mounted so their exit animations still play.
import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { useUI, type PanelId } from '@/state/ui';

const named = <K extends string>(loader: () => Promise<Record<K, ComponentType>>, key: K) =>
  lazy(() => loader().then((m) => ({ default: m[key] })));

const AnalyticsPanel = named(() => import('./analytics/AnalyticsPanel'), 'AnalyticsPanel');
const BookmarksPanel = named(() => import('./bookmarks/BookmarksPanel'), 'BookmarksPanel');
const DiscoverPanel = named(() => import('./discover/DiscoverPanel'), 'DiscoverPanel');
const DataPanel = named(() => import('./data/DataPanel'), 'DataPanel');
const ComparePanel = named(() => import('./modes/ComparePanel'), 'ComparePanel');
const InspectorPanel = named(() => import('./modes/InspectorPanel'), 'InspectorPanel');
const SpotterPanel = named(() => import('./modes/SpotterPanel'), 'SpotterPanel');
const SettingsPanel = named(() => import('./settings/SettingsPanel'), 'SettingsPanel');
const AirportsBrowser = named(() => import('./airports/AirportsBrowser'), 'AirportsBrowser');
const LayersPanel = named(() => import('./layers/LayersPanel'), 'LayersPanel');

function OnDemand({ id, children }: { id: PanelId; children: ReactNode }) {
  const active = useUI((s) => s.panel === id);
  const [seen, setSeen] = useState(active);
  useEffect(() => {
    if (active) setSeen(true);
  }, [active]);
  if (!seen && !active) return null;
  return <Suspense fallback={null}>{children}</Suspense>;
}

export function LazyPanels() {
  return (
    <>
      <OnDemand id="analytics">
        <AnalyticsPanel />
      </OnDemand>
      <OnDemand id="bookmarks">
        <BookmarksPanel />
      </OnDemand>
      <OnDemand id="discover">
        <DiscoverPanel />
      </OnDemand>
      <OnDemand id="data">
        <DataPanel />
      </OnDemand>
      <OnDemand id="compare">
        <ComparePanel />
      </OnDemand>
      <OnDemand id="inspector">
        <InspectorPanel />
      </OnDemand>
      <OnDemand id="spotter">
        <SpotterPanel />
      </OnDemand>
      <OnDemand id="settings">
        <SettingsPanel />
      </OnDemand>
      <OnDemand id="airports">
        <AirportsBrowser />
      </OnDemand>
      <OnDemand id="layers">
        <LayersPanel />
      </OnDemand>
    </>
  );
}

/** Warm the most-used lazy panels once the app is idle. */
export function prefetchPanels() {
  const idle = (cb: () => void) => ('requestIdleCallback' in window ? window.requestIdleCallback(cb, { timeout: 4000 }) : setTimeout(cb, 2500));
  idle(() => {
    void import('./layers/LayersPanel');
    void import('./settings/SettingsPanel');
    void import('./airports/AirportsBrowser');
    void import('./analytics/AnalyticsPanel');
  });
}
