// Curated links to public airport webcam / live-view pages.
//
// These are EXTERNAL pages run by third parties (airport operators, met services,
// public webcam networks). We only link to them — nothing is embedded or proxied —
// and they may move, change or go offline at any time. Every URL below was checked
// to load (HTTP 200 in a browser-like request) on 2026-10-18.
//
// Notes from verification:
//  - bts.aero answers HEAD requests / bare user agents with 403 but serves the page
//    normally to browsers (verified with a full browser user agent).
//  - Munich and Frankfurt publish no official webcams (their regulators do not allow
//    them), so they are intentionally absent and fall back to the Windy map link.

export interface Webcam {
  label: string;
  url: string;
  /** Who runs the page, e.g. 'Official airport site', 'Windy webcams', 'Panomax'. */
  source: string;
}

const OFFICIAL = 'Official airport site';

/** Keyed by airport ICAO code. */
export const WEBCAMS: Record<string, Webcam[]> = {
  // Switzerland
  LSZH: [{ label: 'Zurich Airport webcams', url: 'https://www.flughafen-zuerich.ch/en/passengers/experience/experiences/webcams', source: OFFICIAL }],
  LSZB: [{ label: 'Bern Airport webcam', url: 'https://www.bernairport.ch/en/aviation/flugbetrieb/webcam-1', source: OFFICIAL }],

  // Germany
  EDDL: [{ label: 'Düsseldorf Airport webcams', url: 'https://www.dus.com/en/enjoy/webcams', source: OFFICIAL }],
  EDDH: [{ label: 'Hamburg Airport webcams', url: 'https://www.hamburg-airport.de/en/hamburg-airport-webcams-12440', source: OFFICIAL }],
  EDDK: [
    { label: 'Cologne Bonn Airport webcams', url: 'https://www.cologne-bonn-airport.com/en/passengers/experience-airport/webcams.html', source: OFFICIAL },
  ],
  EDDN: [{ label: 'Nuremberg apron webcam (German)', url: 'https://www.airport-nuernberg.de/de/webcam', source: OFFICIAL }],
  EDLP: [{ label: 'Paderborn-Lippstadt webcams', url: 'https://www.airport-pad.com/en/news-media/impressions/webcams/', source: OFFICIAL }],

  // Austria
  LOWW: [{ label: 'Vienna Airport 360° panorama', url: 'https://viennaairport.panomax.com/', source: 'Panomax' }],
  LOWI: [{ label: 'Innsbruck Airport 360° panorama', url: 'https://innsbruck-airport.panomax.com/', source: 'Panomax' }],
  LOWS: [
    { label: 'Salzburg Airport webcams', url: 'https://www.salzburg-airport.com/en/webcams', source: OFFICIAL },
    { label: 'Salzburg Airport 360° live panorama', url: 'https://livecam.salzburg-airport.com/', source: 'Panomax' },
  ],
  LOWL: [{ label: 'Linz Airport webcams (German)', url: 'https://www.linz-airport.com/de/Passagiere-Besucher/Am-Flughafen/Webcams', source: OFFICIAL }],
  LOWG: [{ label: 'Graz Airport spotter webcam (German)', url: 'https://graz-airport.at/reisende/am-flughafen/planespotting-mehr/#webcam', source: OFFICIAL }],

  // Rest of Europe
  LZIB: [{ label: 'Bratislava Airport webcam', url: 'https://www.bts.aero/en/webcam/', source: OFFICIAL }],
  LMML: [{ label: 'Malta Airport apron webcam', url: 'https://www.maltairport.com/webcam/', source: OFFICIAL }],
  EGJJ: [{ label: 'Jersey Airport runway webcam', url: 'https://www.gov.je/weather/runwaywebcam/', source: 'Jersey Met' }],

  // Asia-Pacific / Americas
  NZQN: [{ label: 'Queenstown Airport webcams & weather', url: 'https://www.queenstownairport.co.nz/webcams-weather/', source: OFFICIAL }],
  PANC: [
    {
      label: 'FAA WeatherCams around Anchorage (Lake Hood, Merrill Field)',
      url: 'https://weathercams.faa.gov/map/-150.2,61.1,-149.8,61.25',
      source: 'FAA WeatherCams',
    },
  ],
};

const fixed = (n: number, d: number) => (Number.isFinite(n) ? n.toFixed(d) : '0');

/**
 * Windy's webcam layer centred on a point. Verified pattern:
 * https://www.windy.com/-Webcams/webcams?{lat},{lon},{zoom}
 */
export function windyWebcamsUrl(lat: number, lon: number, zoom = 11): string {
  return `https://www.windy.com/-Webcams/webcams?${fixed(lat, 3)},${fixed(lon, 3)},${zoom}`;
}

/** Curated webcams for an airport plus a generic "webcams near this airport" map link. */
export function webcamsFor(ident: string, lat: number, lon: number): Webcam[] {
  const curated = WEBCAMS[ident.trim().toUpperCase()] ?? [];
  const out = [...curated];
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    out.push({ label: 'Webcams near this airport', url: windyWebcamsUrl(lat, lon), source: 'Windy webcams' });
  }
  return out;
}
