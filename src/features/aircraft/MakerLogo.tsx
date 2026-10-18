// Logos of aircraft manufacturers (Wikidata P154 → Wikimedia Commons, copied to this
// site at build time), plus the shared logo tile used for airline logos too. Logos are
// trademarks of their owners, shown only to identify the manufacturer / operator; the
// file's licence and author are in the tooltip and in Image credits.
import { useState, type CSSProperties } from 'react';
import { makerLogo, useMediaTable, type MediaItem } from '@/data/media';
import { cn } from '@/lib/cn';

/**
 * Tile backgrounds by logo tone. The theme is the `data-theme` attribute on <html>, so
 * this is pure CSS: dark ink gets a soft light tile on dark themes (as flight-tracker apps
 * do) and sits plain on light themes; white ink gets a dark tile on light themes only.
 */
const TONE_CLASS: Record<string, string> = {
  dark: 'bg-[#f3f5f8] shadow-[0_0_0_0.5px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.22)] [:root[data-theme=light]_&]:bg-transparent [:root[data-theme=light]_&]:shadow-none',
  light: '[:root[data-theme=light]_&]:bg-[#172030] [:root[data-theme=light]_&]:shadow-[0_1px_2px_rgba(0,0,0,0.2)]',
  opaque: 'bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.22)]',
  plain: '',
};

/**
 * One logo image, `height` tall: in a fixed box when `width` is given (list rows stay
 * aligned), otherwise as wide as the logo up to `maxWidth`. The image is declared 2x
 * (`srcSet … 2x`; every stored logo is at least twice its largest display size), so it is
 * never stretched past half its pixel size; lazy-loaded and decoded off the main thread.
 */
export function LogoTile({
  item,
  alt,
  width,
  maxWidth,
  height,
  title,
  onError,
  className,
}: {
  item: MediaItem;
  alt: string;
  width?: number | undefined;
  maxWidth?: number | undefined;
  height: number;
  title?: string | undefined;
  onError?: () => void;
  className?: string | undefined;
}) {
  const pad = item.tone === 'opaque' ? 0 : Math.max(2, Math.round(height * 0.12));
  const box: CSSProperties = { width, maxWidth, height, borderRadius: Math.round(height * 0.28), padding: pad };
  // Explicit pixel limits: `max-height: 100%` does not resolve inside an auto-sized grid
  // row, so tall logos (Emirates' calligraphy) would overflow the tile and be cropped.
  const inner: CSSProperties =
    width === undefined
      ? { height: height - 2 * pad, width: 'auto', maxWidth: maxWidth === undefined ? undefined : maxWidth - 2 * pad }
      : { maxHeight: height - 2 * pad, maxWidth: width - 2 * pad };
  // Fade the tile in once the image is there (an empty light tile would flash as a sliver).
  const [loaded, setLoaded] = useState(false);
  return (
    <span
      className={cn('grid shrink-0 place-items-center overflow-hidden transition-opacity duration-200', TONE_CLASS[item.tone ?? 'plain'], !loaded && 'opacity-0', className)}
      style={box}
      title={title}
    >
      <img
        ref={(el) => {
          if (el?.complete && el.naturalWidth > 0) setLoaded(true);
        }}
        onLoad={() => setLoaded(true)}
        src={item.src}
        srcSet={`${item.src} 2x`}
        alt={alt}
        loading="lazy"
        decoding="async"
        draggable={false}
        referrerPolicy="strict-origin-when-cross-origin"
        onError={onError}
        style={inner}
        className={cn('max-h-full max-w-full select-none object-contain', item.tone === 'opaque' && 'h-full w-full')}
      />
    </span>
  );
}

const credit = (name: string, m: MediaItem) => `${name} logo · ${m.license}${m.artist ? ` · ${m.artist}` : ''} · Wikimedia Commons`;

/** Manufacturer logo (e.g. `<MakerLogo maker="Airbus" size={20} />`); renders nothing when there is none. */
export function MakerLogo({ maker, size = 20, maxWidth, className }: { maker: string | undefined; size?: number; maxWidth?: number; className?: string }) {
  const media = useMediaTable();
  const logo = makerLogo(media.data, maker);
  const [failed, setFailed] = useState<string | null>(null);
  if (!maker || !logo || failed === logo.src) return null;
  return (
    <LogoTile
      key={logo.src}
      item={logo}
      alt={`${maker} logo`}
      maxWidth={maxWidth ?? Math.round(size * 4.5)}
      height={size}
      title={credit(maker, logo)}
      onError={() => setFailed(logo.src)}
      className={className}
    />
  );
}

export { credit as logoCredit };
