import { Locate, Maximize, Minimize, Minus, Plus } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { GlobeIcon, LayersIcon, TiltIcon } from '@/components/icons';
import { IconButton } from '@/components/ui/Glass';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/cn';
import { useIsMobile, useMedia } from '@/lib/useMedia';
import { useSettings } from '@/state/settings';
import { Minimap } from './Minimap';
import { locateUser, resetNorth, setPitch, setProjection, zoomBy } from '@/map/controller';
import { useUI } from '@/state/ui';
import { useView } from '@/state/view';

export function MapControls() {
  const bearing = useView((s) => s.bearing);
  const pitch = useView((s) => s.pitch);
  const projection = useUI((s) => s.projection);
  const panel = useUI((s) => s.panel);
  const togglePanel = useUI((s) => s.togglePanel);
  const toast = useUI((s) => s.toast);
  const mobile = useIsMobile();
  const roomy = useMedia('(min-width: 1100px) and (min-height: 700px)');
  const showMinimap = useSettings((s) => s.showMinimap) && roomy && !mobile;
  const profile = useSettings((s) => s.showProfile) && !mobile;
  const [fs, setFs] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    const on = () => setFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  const toggleFs = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => toast({ kind: 'warning', title: 'Fullscreen is not available here' }));
  };

  const locate = async () => {
    setLocating(true);
    try {
      await locateUser();
    } catch (e) {
      toast({ kind: 'warning', title: 'Location unavailable', body: (e as Error).message });
    } finally {
      setLocating(false);
    }
  };

  const panelOpen = panel !== null && !mobile;
  const side = 'left' as const;
  const size = 38;

  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: panelOpen ? -404 : 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      style={mobile ? undefined : { bottom: profile ? 76 + 158 : 76 }}
      className={cn('pointer-events-auto absolute right-4 z-20 flex flex-col gap-2 transition-[bottom] duration-300', mobile && 'top-[72px]')}
    >
      {showMinimap && (
        <div className="absolute bottom-0 right-full mr-3">
          <Minimap />
        </div>
      )}
      <div className="glass flex flex-col rounded-[16px] p-1">
        <IconButton label="Zoom in" shortcut="+" tooltipSide={side} size={size} onClick={() => zoomBy(1)}>
          <Plus size={18} />
        </IconButton>
        <div className="mx-2 h-px bg-[var(--line)]" />
        <IconButton label="Zoom out" shortcut="−" tooltipSide={side} size={size} onClick={() => zoomBy(-1)}>
          <Minus size={18} />
        </IconButton>
      </div>

      <div className="glass flex flex-col rounded-[16px] p-1">
        <Tooltip content={bearing || pitch ? 'Reset north & tilt' : 'North up'} side={side}>
          <button
            type="button"
            aria-label={`Compass, bearing ${Math.round(((bearing % 360) + 360) % 360)} degrees. Reset north and tilt.`}
            onClick={resetNorth}
            style={{ width: size, height: size }}
            className="grid place-items-center rounded-[12px] hover:bg-[var(--line)]"
          >
            <motion.svg width="22" height="22" viewBox="0 0 24 24" style={{ rotate: -bearing }} aria-hidden="true">
              <path d="M12 2.5 15 12H9Z" fill="#ff5d73" />
              <path d="M12 21.5 9 12h6Z" fill="currentColor" className="text-fg-3" />
              <circle cx="12" cy="12" r="1.4" fill="currentColor" className="text-fg" />
            </motion.svg>
          </button>
        </Tooltip>
        <IconButton
          label={pitch > 5 ? 'Flatten view' : '3D tilt'}
          tooltipSide={side}
          size={size}
          active={pitch > 5}
          onClick={() => setPitch(pitch > 5 ? 0 : 55)}
        >
          <TiltIcon size={18} />
        </IconButton>
        <IconButton
          label={projection === 'globe' ? 'Flat map' : 'Globe view'}
          shortcut="G"
          tooltipSide={side}
          size={size}
          active={projection === 'globe'}
          onClick={() => setProjection(projection === 'globe' ? 'mercator' : 'globe')}
        >
          <GlobeIcon size={18} />
        </IconButton>
      </div>

      <div className="glass flex flex-col rounded-[16px] p-1">
        <IconButton label="My location" tooltipSide={side} size={size} onClick={() => void locate()} disabled={locating}>
          <Locate size={17} className={cn(locating && 'animate-pulse')} />
        </IconButton>
        {!mobile && (
          <IconButton label={fs ? 'Exit fullscreen' : 'Fullscreen'} tooltipSide={side} size={size} onClick={toggleFs}>
            {fs ? <Minimize size={17} /> : <Maximize size={17} />}
          </IconButton>
        )}
        {mobile && (
          <IconButton label="Map styles & layers" tooltipSide={side} size={size} active={panel === 'layers'} onClick={() => togglePanel('layers')}>
            <LayersIcon size={18} />
          </IconButton>
        )}
      </div>
    </motion.div>
  );
}
