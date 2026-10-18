// Airframe photo from the Planespotters.net public Photo API.
// Terms honoured (https://www.planespotters.net/photo/api):
//  • requested by the viewer's browser from this page (Origin/Referer present);
//  • the thumbnail is a plain link to the photo page, unchanged URL, no nofollow;
//  • the photographer is credited in visible text next to the image;
//  • images load straight from the returned URL and are never stored or re-hosted;
//  • JSON responses live only in memory (well under the 24-hour cache limit).
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Skeleton } from '@/components/ui/Feedback';

interface Photo {
  src: string;
  width: number;
  height: number;
  link: string;
  photographer: string;
}

async function fetchPhoto(hex: string, signal: AbortSignal): Promise<Photo | null> {
  const res = await fetch(`https://api.planespotters.net/pub/photos/hex/${encodeURIComponent(hex)}`, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const j = (await res.json()) as { photos?: { thumbnail_large?: { src: string; size: { width: number; height: number } }; link?: string; photographer?: string }[] };
  const p = j.photos?.[0];
  if (!p?.thumbnail_large?.src || !p.link || !p.photographer) return null;
  // Only accept the documented hosts; never render arbitrary URLs.
  const ok = (u: string, host: RegExp) => {
    try {
      const url = new URL(u);
      return url.protocol === 'https:' && host.test(url.hostname);
    } catch {
      return false;
    }
  };
  if (!ok(p.thumbnail_large.src, /(^|\.)plnspttrs\.net$/) || !ok(p.link, /(^|\.)planespotters\.net$/)) return null;
  return { src: p.thumbnail_large.src, width: p.thumbnail_large.size.width, height: p.thumbnail_large.size.height, link: p.link, photographer: p.photographer };
}

export function AircraftPhoto({ hex }: { hex: string }) {
  const [loaded, setLoaded] = useState(false);
  const q = useQuery({
    queryKey: ['photo', hex],
    queryFn: ({ signal }) => fetchPhoto(hex, signal),
    staleTime: 6 * 3_600_000,
    gcTime: 12 * 3_600_000,
    retry: 0,
  });
  if (q.isPending) return <Skeleton className="aspect-[3/2] w-full rounded-[18px]" />;
  if (!q.data) return null;
  const p = q.data;
  return (
    <figure className="space-y-1.5">
      <a href={p.link} target="_blank" rel="noopener" className="group relative block overflow-hidden rounded-[18px] border border-[var(--line)]">
        {!loaded && <Skeleton className="absolute inset-0 rounded-none" />}
        <img
          src={p.src}
          width={p.width}
          height={p.height}
          alt={`Photo of this airframe by ${p.photographer}`}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setLoaded(true)}
          className="aspect-[3/2] w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
        />
      </a>
      <figcaption className="text-[11px] leading-snug text-fg-3">
        <span className="block">
          Photo © <span className="text-fg-2">{p.photographer}</span> via{' '}
          <a href={p.link} target="_blank" rel="noopener" className="text-[var(--accent)] hover:underline">
            Planespotters.net
          </a>
        </span>
        <span className="block">Photo of this airframe, not live — livery may differ.</span>
      </figcaption>
    </figure>
  );
}
