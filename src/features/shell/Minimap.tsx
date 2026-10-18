import type * as GeoJSON from 'geojson';
import { Map as MlMap, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import { motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { flyTo, getMap } from '@/map/controller';
import { STYLE_META } from '@/map/styles';
import { useSettings } from '@/state/settings';
import { useView } from '@/state/view';

function miniStyle(dark: boolean): StyleSpecification {
  return {
    version: 8,
    sources: { omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': dark ? '#141b26' : '#eef1f5' } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': dark ? '#071526' : '#cddff1' } },
      {
        id: 'border',
        type: 'line',
        source: 'omt',
        'source-layer': 'boundary',
        filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': dark ? '#3b4c64' : '#a7b4c4', 'line-width': 0.6 },
      },
    ],
  };
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Overview inset showing the current viewport (cyan) on a world map. */
export function Minimap() {
  const ref = useRef<HTMLDivElement>(null);
  const mini = useRef<MlMap | null>(null);
  const style = useSettings((s) => s.mapStyle);
  const dark = STYLE_META[style].dark;
  const view = useView();

  useEffect(() => {
    if (!ref.current) return;
    const m = new MlMap({
      container: ref.current,
      style: miniStyle(dark),
      interactive: false,
      attributionControl: false,
      center: [0, 20],
      zoom: 0,
      fadeDuration: 0,
      renderWorldCopies: true,
      maxTileCacheSize: 40,
    });
    m.on('load', () => {
      m.addSource('view', { type: 'geojson', data: EMPTY });
      m.addLayer({ id: 'view-fill', type: 'fill', source: 'view', paint: { 'fill-color': '#5ce1ff', 'fill-opacity': 0.1 } });
      m.addLayer({ id: 'view-line', type: 'line', source: 'view', paint: { 'line-color': '#5ce1ff', 'line-width': 1.4 } });
    });
    const onClick = (e: { lngLat: { lng: number; lat: number } }) => flyTo(e.lngLat.lng, e.lngLat.lat);
    m.on('click', onClick);
    mini.current = m;
    return () => {
      m.remove();
      mini.current = null;
    };
    // Recreated only when switching between light and dark palettes.
  }, [dark]);

  // Follow the main camera at a wider zoom.
  useEffect(() => {
    const m = mini.current;
    const main = getMap();
    if (!m || !main || !view.ready) return;
    m.jumpTo({ center: [view.lon, view.lat], zoom: Math.max(0, view.zoom - 4.8) });
    const b = main.getBounds();
    const ring: [number, number][] = [
      [b.getWest(), b.getSouth()],
      [b.getEast(), b.getSouth()],
      [b.getEast(), b.getNorth()],
      [b.getWest(), b.getNorth()],
      [b.getWest(), b.getSouth()],
    ];
    (m.getSource('view') as GeoJSONSource | undefined)?.setData({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: {},
    });
  }, [view]);


  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass pointer-events-auto relative h-[132px] w-[212px] overflow-hidden rounded-[18px] p-1"
      role="img"
      aria-label="Overview map: the cyan box is your current view"
    >
      <div ref={ref} className="h-full w-full cursor-pointer overflow-hidden rounded-[14px]" style={{ position: 'relative' }} />
      <div className="pointer-events-none absolute bottom-2 left-2.5 flex gap-2 text-[9.5px] font-semibold uppercase tracking-wider text-fg-2">
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-2.5 rounded-sm bg-[#5ce1ff]" /> View
        </span>
      </div>
    </motion.div>
  );
}
