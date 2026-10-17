import { useEffect, useRef, useState } from 'react';
import { createMap, destroyMap } from '@/map/controller';
import { useUI } from '@/state/ui';

export function MapView() {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const veil = useUI((s) => s.styleLoading);

  useEffect(() => {
    if (!ref.current) return;
    try {
      createMap(ref.current);
    } catch (e) {
      console.error(e);
      setError(
        (e as Error).name === 'GPUInitializationError' || /webgl/i.test((e as Error).message)
          ? 'Your browser or device does not support WebGL 2, which the live map requires. Try a recent version of Chrome, Edge, Firefox or Safari, or enable hardware acceleration.'
          : 'The map could not start. Please reload the page.',
      );
    }
    return () => destroyMap();
  }, []);

  return (
    <main className="absolute inset-0" aria-label="Live flight map">
      <div
        ref={ref}
        // Inline style: MapLibre's unlayered CSS sets position:relative on this node,
        // which would otherwise beat Tailwind's layered utilities.
        style={{ position: 'absolute', inset: 0 }}
        role="application"
        aria-label="Live flight map. Use arrow keys to pan, plus and minus to zoom. Press Control K to search."
      />
      <div className="map-veil" data-active={veil} aria-hidden="true" />
      {error && (
        <div className="absolute inset-0 grid place-items-center bg-[var(--canvas)] p-6">
          <div role="alert" className="glass max-w-md rounded-[24px] p-6 text-center">
            <p className="text-[16px] font-semibold">Map unavailable</p>
            <p className="mt-2 text-[13px] leading-relaxed text-fg-2">{error}</p>
          </div>
        </div>
      )}
    </main>
  );
}
