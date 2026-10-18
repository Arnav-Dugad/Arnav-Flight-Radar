// Representative aircraft photo from Wikimedia Commons, shown edge-to-edge at the top
// of the aircraft panel (FR24-style). It shows a REAL aircraft of the same type —
// in this airline's livery when Commons has one — never this simulated flight, and
// the caption says exactly what is pictured, with author and licence.
import { useState } from 'react';
import { Skeleton } from '@/components/ui/Feedback';
import { representativePhoto, useMediaTable } from '@/data/media';

export function RepresentativePhoto({
  type,
  typeName,
  airlineIcao,
  airlineName,
  hero = false,
}: {
  type?: string | undefined;
  typeName?: string | undefined;
  airlineIcao?: string | undefined;
  airlineName?: string | undefined;
  /** Full-bleed header image with the credit overlaid. */
  hero?: boolean;
}) {
  const media = useMediaTable();
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const p = representativePhoto(media.data, type, airlineIcao);
  if (media.isPending) return <Skeleton className={hero ? 'aspect-[16/9] w-full rounded-none' : 'aspect-[3/2] w-full rounded-[18px]'} />;
  if (!p || failed === p.src) return null;
  const what = p.kind === 'livery' ? `${airlineName ?? airlineIcao} ${typeName ?? type}` : (typeName ?? type);
  return (
    <figure className={hero ? 'relative' : 'space-y-1.5'}>
      <a
        href={p.page}
        target="_blank"
        rel="noopener"
        className={hero ? 'group relative block aspect-[16/9] overflow-hidden' : 'group relative block overflow-hidden rounded-[18px] border border-[var(--line)]'}
        aria-label={`Representative photo: ${p.caption}. Opens the file on Wikimedia Commons.`}
      >
        {loaded !== p.src && <Skeleton className="absolute inset-0 rounded-none" />}
        <img
          src={p.src}
          alt={`Representative photo of a ${what}: ${p.caption}`}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setLoaded(p.src)}
          onError={() => setFailed(p.src)}
          className={hero ? 'size-full object-cover transition-transform duration-700 group-hover:scale-[1.03]' : 'aspect-[3/2] w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]'}
        />
        <span className="absolute left-3 top-3 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white backdrop-blur">
          Representative
        </span>
        {hero && <span className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />}
      </a>
      <figcaption
        className={
          hero ? 'pointer-events-none absolute inset-x-3 bottom-2 text-[10.5px] leading-snug text-white/85 [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]' : 'text-[11px] leading-snug text-fg-3'
        }
      >
        <span className="block truncate">Pictured: {p.caption}</span>
        <span className="block truncate">
          {p.artist ? `© ${p.artist} · ` : ''}
          {p.license} · Wikimedia Commons · not this simulated aircraft
        </span>
      </figcaption>
    </figure>
  );
}
