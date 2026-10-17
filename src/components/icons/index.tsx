// Original Arnav aviation icon set — 24 px grid, 1.6 px strokes, round joins.
import type { SVGProps } from 'react';
import type { AircraftClass } from '@shared/classify';
import { silhouettePaths } from '@/map/silhouettes';

type P = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 20, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const RadarIcon = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" opacity=".55" />
    <path d="M12 12 18.4 5.6" />
    <path d="M12 3a9 9 0 0 1 6.4 2.6L12 12Z" fill="currentColor" stroke="none" opacity=".22" />
    <circle cx="16" cy="9.2" r="1.1" fill="currentColor" stroke="none" />
  </Base>
);

export const GlobeIcon = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3.5 9h17M3.5 15h17" opacity=".6" />
    <path d="M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3Z" />
  </Base>
);

export const AirportIcon = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m8.2 16.6 7.6-9.2" strokeWidth={2.4} />
    <path d="m8.7 9 6.6 6" strokeWidth={2.2} opacity=".7" />
  </Base>
);

export const RunwayIcon = (p: P) => (
  <Base {...p}>
    <path d="M9 3h6l2 18H7Z" />
    <path d="M12 6v2.5M12 11v2.5M12 16v2.5" />
  </Base>
);

export const TowerIcon = (p: P) => (
  <Base {...p}>
    <path d="M7 8h10l-1.6 4H8.6Z" />
    <path d="M9 12v9M15 12v9M7.5 21h9" />
    <path d="M12 4v4M9.5 5.5 12 4l2.5 1.5" />
  </Base>
);

export const PlaneIcon = (p: P) => (
  <Base {...p}>
    <path d="M12 2.5c.8 0 1.2 1 1.2 2.3v4.4l7.3 4v1.9l-7.3-2.1-.3 4.6 2.6 1.8v1.4L12 20l-3.5.8v-1.4l2.6-1.8-.3-4.6-7.3 2.1v-1.9l7.3-4V4.8c0-1.3.4-2.3 1.2-2.3Z" />
  </Base>
);

export const CompassIcon = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m12 5.5 2.3 6.5h-4.6Z" fill="currentColor" stroke="none" />
    <path d="m12 18.5-2.3-6.5h4.6Z" opacity=".45" />
  </Base>
);

export const AltitudeIcon = (p: P) => (
  <Base {...p}>
    <path d="M4 20h16" />
    <path d="M7 20V9M12 20V4M17 20v-7" />
    <path d="m10 6.5 2-2.5 2 2.5" />
  </Base>
);

export const SpeedIcon = (p: P) => (
  <Base {...p}>
    <path d="M4.5 17a8 8 0 1 1 15 0" />
    <path d="m12 14 4.2-5" strokeWidth={2} />
    <circle cx="12" cy="14" r="1.2" fill="currentColor" />
  </Base>
);

export const VerticalSpeedIcon = (p: P) => (
  <Base {...p}>
    <path d="M7 4v16M4.5 6.5 7 4l2.5 2.5M4.5 17.5 7 20l2.5-2.5" />
    <path d="M12 16c2-1 3-3 4-6.5S18.5 5 20 5" />
  </Base>
);

export const WindIcon = (p: P) => (
  <Base {...p}>
    <path d="M3 8h11a3 3 0 1 0-3-3" />
    <path d="M3 12h15a3 3 0 1 1-3 3" />
    <path d="M3 16h7" />
  </Base>
);

export const LayersIcon = (p: P) => (
  <Base {...p}>
    <path d="m12 3 9 5-9 5-9-5Z" />
    <path d="m3 12.5 9 5 9-5" opacity=".7" />
    <path d="m3 16.5 9 5 9-5" opacity=".45" />
  </Base>
);

export const FilterIcon = (p: P) => (
  <Base {...p}>
    <path d="M4 6h16M7 12h10M10 18h4" />
    <circle cx="9" cy="6" r="1.6" fill="currentColor" />
    <circle cx="14" cy="12" r="1.6" fill="currentColor" />
  </Base>
);

export const AnalyticsIcon = (p: P) => (
  <Base {...p}>
    <path d="M4 20V10M9.3 20V5M14.6 20v-8M20 20V8" strokeWidth={2.2} />
  </Base>
);

export const BookmarkIcon = (p: P) => (
  <Base {...p}>
    <path d="M7 3.5h10a1 1 0 0 1 1 1V21l-6-4-6 4V4.5a1 1 0 0 1 1-1Z" />
  </Base>
);

export const DiscoverIcon = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m15.8 8.2-2.4 5.2-5.2 2.4 2.4-5.2Z" />
  </Base>
);

export const TimelineIcon = (p: P) => (
  <Base {...p}>
    <path d="M3 12h18" />
    <circle cx="7" cy="12" r="2" />
    <circle cx="17" cy="12" r="2" />
    <path d="M12 7v10" opacity=".55" />
  </Base>
);

export const CompareIcon = (p: P) => (
  <Base {...p}>
    <rect x="3" y="4" width="7.5" height="16" rx="2" />
    <rect x="13.5" y="4" width="7.5" height="16" rx="2" />
    <path d="M6.75 9v6M17.25 11v4" />
  </Base>
);

export const InspectorIcon = (p: P) => (
  <Base {...p}>
    <path d="M8 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H16" />
    <path d="M9 9h6M9 12h4M9 15h5" />
  </Base>
);

export const MeasureIcon = (p: P) => (
  <Base {...p}>
    <path d="m4 18 14-14 2 2L6 20Z" />
    <path d="m8 14 1.5 1.5M11 11l1.5 1.5M14 8l1.5 1.5" />
  </Base>
);

export const FollowIcon = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    <circle cx="12" cy="12" r="7.5" opacity=".5" />
  </Base>
);

export const SpotterIcon = (p: P) => (
  <Base {...p}>
    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
    <circle cx="12" cy="12" r="3" />
  </Base>
);

export const PresentationIcon = (p: P) => (
  <Base {...p}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
    <path d="m10.5 8 4 2-4 2Z" fill="currentColor" />
  </Base>
);

export const WeatherIcon = (p: P) => (
  <Base {...p}>
    <path d="M7 17.5h9.5a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1.2A3 3 0 0 0 7 17.5Z" />
    <path d="M9 20.5l1-1.5M13 20.5l1-1.5" opacity=".7" />
  </Base>
);

export const SignalIcon = (p: P) => (
  <Base {...p}>
    <path d="M5 19a10 10 0 0 1 0-14M19 5a10 10 0 0 1 0 14" opacity=".55" />
    <path d="M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" />
  </Base>
);

export const SquawkIcon = (p: P) => (
  <Base {...p}>
    <rect x="3" y="6" width="18" height="12" rx="3" />
    <path d="M7 10v4M10.5 10v4M14 10v4M17.5 10v4" />
  </Base>
);

export const LearnIcon = (p: P) => (
  <Base {...p}>
    <path d="M3 8.5 12 4l9 4.5-9 4.5Z" />
    <path d="M7 10.5V15c1.5 1.3 3 2 5 2s3.5-.7 5-2v-4.5" />
    <path d="M21 8.5V14" />
  </Base>
);

export const DataIcon = (p: P) => (
  <Base {...p}>
    <ellipse cx="12" cy="6" rx="7.5" ry="2.8" />
    <path d="M4.5 6v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6" />
    <path d="M4.5 12v6c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-6" opacity=".6" />
  </Base>
);

export const TiltIcon = (p: P) => (
  <Base {...p}>
    <path d="M3 18 8 8h8l5 10Z" />
    <path d="M7.5 13h9" opacity=".6" />
  </Base>
);

/** Aircraft silhouette (same geometry as the map symbol). */
export function AircraftGlyph({ cls, size = 24, rotate = 0, ...rest }: { cls: AircraftClass; size?: number; rotate?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="-32 -32 64 64" aria-hidden="true" focusable="false" {...rest}>
      <g transform={`rotate(${rotate})`} fill="currentColor">
        {silhouettePaths(cls).map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
    </svg>
  );
}

/** Brand glyph — the Apex Vector (see /brand). */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" role="img" aria-label="Arnav Flight Radar">
      <defs>
        <linearGradient id="bm-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0C1D38" />
          <stop offset=".45" stopColor="#081122" />
          <stop offset="1" stopColor="#03060B" />
        </linearGradient>
        <radialGradient id="bm-beam" cx="256" cy="110" r="300" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5CE1FF" stopOpacity=".42" />
          <stop offset="1" stopColor="#5CE1FF" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="bm-trail" x1="182" x2="276" y1="0" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2E8BFF" stopOpacity=".35" />
          <stop offset="1" stopColor="#5CE1FF" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="118" fill="url(#bm-tile)" />
      <rect x="1.5" y="1.5" width="509" height="509" rx="117" fill="none" stroke="#fff" strokeOpacity=".14" strokeWidth="3" />
      <path d="M122,398L256,110L390,398Z" fill="url(#bm-beam)" />
      <path d="M178.4,276.8A184,184 0 0 0 262.4,293.9" fill="none" stroke="url(#bm-trail)" strokeWidth="26" strokeLinecap="round" />
      <path d="M122,398L256,110L390,398" fill="none" stroke="#EEF3FA" strokeWidth="48" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="275.2" cy="293" r="30" fill="#FFB547" opacity=".4" />
      <circle cx="275.2" cy="293" r="15" fill="#FFB547" stroke="#03060B" strokeWidth="4" />
    </svg>
  );
}
