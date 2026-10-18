// Airframe photos from the Planespotters.net public Photo API.
// Terms honoured (https://www.planespotters.net/photo/api):
//  • requested by the viewer's browser from this page (Origin/Referer present);
//  • each thumbnail is a plain link to its photo page, unchanged URL, no nofollow;
//  • the photographer is credited in visible text next to the image;
//  • images load straight from the returned URL and are never stored or re-hosted;
//  • JSON responses live only in memory (well under the 24-hour cache limit).
// The API returns at most one photo per lookup, so we look up by ICAO address AND
// by registration and show the distinct results as a small carousel.
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, EyeOff } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/Feedback';
import { representativePhoto, useMediaTable } from '@/data/media';
import { useBookmarks } from '@/state/bookmarks';

interface Photo {
  src: string;
  width: number;
  height: number;
  link: string;
  photographer: string;
}

type ApiPhoto = { thumbnail_large?: { src: string; size: { width: number; height: number } }; link?: string; photographer?: string };

const ok = (u: string, host: RegExp) => {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && host.test(url.hostname);
  } catch {
    return false;
  }
};

async function fetchPhotos(kind: 'hex' | 'reg', id: string, signal: AbortSignal): Promise<Photo[]> {
  const res = await fetch(`https://api.planespotters.net/pub/photos/${kind}/${encodeURIComponent(id)}`, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) return [];
  const j = (await res.json()) as { photos?: ApiPhoto[] };
  const out: Photo[] = [];
  for (const p of j.photos ?? []) {
    if (!p.thumbnail_large?.src || !p.link || !p.photographer) continue;
    // Only accept the documented hosts; never render arbitrary URLs.
    if (!ok(p.thumbnail_large.src, /(^|\.)plnspttrs\.net$/) || !ok(p.link, /(^|\.)planespotters\.net$/)) continue;
    out.push({ src: p.thumbnail_large.src, width: p.thumbnail_large.size.width, height: p.thumbnail_large.size.height, link: p.link, photographer: p.photographer });
  }
  return out;
}

/**
 * Representative photo from Wikimedia Commons: the airline's livery on this aircraft
 * type when available, otherwise the type. Always labelled as NOT this airframe.
 */
export function RepresentativePhoto({ type, typeName, airlineIcao, airlineName }: { type?: string | undefined; typeName?: string | undefined; airlineIcao?: string | undefined; airlineName?: string | undefined }) {
  const media = useMediaTable();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const p = representativePhoto(media.data, type, airlineIcao);
  if (media.isPending) return <Skeleton className="aspect-[3/2] w-full rounded-[18px]" />;
  if (!p || failed) return null;
  const what = p.kind === 'livery' ? `${airlineName ?? airlineIcao} ${typeName ?? type}` : (typeName ?? type);
  return (
    <figure className="space-y-1.5">
      <a href={p.page} target="_blank" rel="noopener" className="group relative block overflow-hidden rounded-[18px] border border-[var(--line)]">
        {!loaded && <Skeleton className="absolute inset-0 rounded-none" />}
        <img
          src={p.src}
          alt={`Representative photo of a ${what}`}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className="aspect-[3/2] w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
        />
        <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white backdrop-blur">Representative</span>
      </a>
      <figcaption className="text-[11px] leading-snug text-fg-3">
        <span className="block">
          A {what} — not this aircraft{p.kind === 'type' && airlineName ? ', and not necessarily in this airline’s livery' : ''}.
        </span>
        <span className="block">
          Photo{p.artist ? ` © ${p.artist}` : ''} · {p.license} ·{' '}
          <a href={p.page} target="_blank" rel="noopener" className="text-[var(--accent)] hover:underline">
            Wikimedia Commons
          </a>
        </span>
      </figcaption>
    </figure>
  );
}

export function AircraftPhoto({
  hex,
  registration,
  type,
  typeName,
  airlineIcao,
  airlineName,
}: {
  hex: string;
  registration?: string | undefined;
  type?: string | undefined;
  typeName?: string | undefined;
  airlineIcao?: string | undefined;
  airlineName?: string | undefined;
}) {
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const toggleHidden = useBookmarks((s) => s.toggleHiddenPhoto);
  const byHex = useQuery({
    queryKey: ['photo', 'hex', hex],
    queryFn: ({ signal }) => fetchPhotos('hex', hex, signal),
    staleTime: 6 * 3_600_000,
    gcTime: 12 * 3_600_000,
    retry: 0,
  });
  const byReg = useQuery({
    queryKey: ['photo', 'reg', registration],
    queryFn: ({ signal }) => fetchPhotos('reg', registration!, signal),
    enabled: !!registration,
    staleTime: 6 * 3_600_000,
    gcTime: 12 * 3_600_000,
    retry: 0,
  });
  useEffect(() => setIndex(0), [hex]);

  const photos: Photo[] = [];
  for (const p of [...(byHex.data ?? []), ...(byReg.data ?? [])]) if (!photos.some((x) => x.link === p.link)) photos.push(p);
  if (byHex.isPending && !photos.length) return <Skeleton className="aspect-[3/2] w-full rounded-[18px]" />;
  if (!photos.length) {
    if (byReg.isPending && registration) return <Skeleton className="aspect-[3/2] w-full rounded-[18px]" />;
    // No photo of this exact airframe: fall back to a clearly labelled representative one.
    return <RepresentativePhoto type={type} typeName={typeName} airlineIcao={airlineIcao} airlineName={airlineName} />;
  }
  const i = Math.min(index, photos.length - 1);
  const p = photos[i]!;
  const many = photos.length > 1;
  const go = (d: number) => setIndex((i + d + photos.length) % photos.length);

  return (
    <figure className="space-y-1.5" aria-roledescription={many ? 'carousel' : undefined} aria-label="Airframe photos">
      <div className="group relative overflow-hidden rounded-[18px] border border-[var(--line)]">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.a
            key={p.link}
            href={p.link}
            target="_blank"
            rel="noopener"
            initial={{ opacity: 0, scale: 1.02 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="relative block"
            aria-label={`Photo ${i + 1} of ${photos.length} by ${p.photographer} on Planespotters.net`}
          >
            {!loaded[p.src] && <Skeleton className="absolute inset-0 rounded-none" />}
            <img
              src={p.src}
              width={p.width}
              height={p.height}
              alt={`Photo of this airframe by ${p.photographer}`}
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              onLoad={() => setLoaded((l) => ({ ...l, [p.src]: true }))}
              className="aspect-[3/2] w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
            />
          </motion.a>
        </AnimatePresence>
        <button
          type="button"
          onClick={() => toggleHidden(hex)}
          className="absolute right-2 top-2 grid size-8 place-items-center rounded-full bg-black/45 text-white/90 opacity-0 backdrop-blur transition-opacity hover:bg-black/65 focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100"
          aria-label="Hide photos for this aircraft"
          title="Hide photos for this aircraft"
        >
          <EyeOff size={14} />
        </button>
        {many && (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="Previous photo" className="absolute left-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur hover:bg-black/65">
              <ChevronLeft size={16} />
            </button>
            <button type="button" onClick={() => go(1)} aria-label="Next photo" className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur hover:bg-black/65">
              <ChevronRight size={16} />
            </button>
            <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5" aria-hidden="true">
              {photos.map((x, k) => (
                <span key={x.link} className={`h-1.5 rounded-full transition-all ${k === i ? 'w-4 bg-white' : 'w-1.5 bg-white/50'}`} />
              ))}
            </div>
          </>
        )}
      </div>
      <figcaption className="text-[11px] leading-snug text-fg-3">
        <span className="block">
          Photo © <span className="text-fg-2">{p.photographer}</span> via{' '}
          <a href={p.link} target="_blank" rel="noopener" className="text-[var(--accent)] hover:underline">
            Planespotters.net
          </a>
          {many && <span className="tnum"> · {i + 1}/{photos.length}</span>}
        </span>
        <span className="block">Photo of this airframe, not live — livery may differ.</span>
      </figcaption>
    </figure>
  );
}
