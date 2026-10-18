// Runtime validation of everything the browser receives from our API.
// The server already normalizes, but the client never trusts a payload blindly.

import { z } from 'zod';

const attribution = z.object({ name: z.string(), url: z.string(), license: z.string() });
const cache = z.object({ hit: z.boolean(), ageMs: z.number(), ttlMs: z.number() });

const cloud = z.object({ cover: z.string(), baseFt: z.number().optional(), type: z.string().optional() });

export const metarSchema = z.object({
  station: z.string(),
  name: z.string().optional(),
  observedAt: z.number(),
  raw: z.string(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  elevationM: z.number().optional(),
  tempC: z.number().optional(),
  dewpointC: z.number().optional(),
  windDirDeg: z.number().optional(),
  windVariable: z.boolean().optional(),
  windSpeedKt: z.number().optional(),
  windGustKt: z.number().optional(),
  visibility: z.string().optional(),
  altimeterHpa: z.number().optional(),
  clouds: z.array(cloud),
  flightCategory: z.enum(['VFR', 'MVFR', 'IFR', 'LIFR']).optional(),
  weather: z.string().optional(),
});

export const tafSchema = z.object({
  station: z.string(),
  name: z.string().optional(),
  issuedAt: z.number(),
  validFrom: z.number(),
  validTo: z.number(),
  raw: z.string(),
  periods: z.array(
    z.object({
      from: z.number(),
      to: z.number(),
      change: z.string().optional(),
      probability: z.number().optional(),
      windDirDeg: z.number().optional(),
      windSpeedKt: z.number().optional(),
      windGustKt: z.number().optional(),
      visibility: z.string().optional(),
      weather: z.string().optional(),
      clouds: z.array(cloud),
    }),
  ),
});

const weatherEnvelope = <T extends z.ZodType>(item: T) =>
  z.object({
    provider: z.literal('aviationweather'),
    attribution,
    fetchedAt: z.number(),
    servedAt: z.number(),
    degraded: z.string().optional(),
    cache,
    count: z.number(),
    data: z.array(item),
  });

export const metarResponseSchema = weatherEnvelope(metarSchema);
export const tafResponseSchema = weatherEnvelope(tafSchema);

const health = z.object({
  id: z.string(),
  status: z.enum(['ok', 'degraded', 'down', 'unknown']),
  lastSuccessAt: z.number().optional(),
  lastErrorAt: z.number().optional(),
  lastError: z.string().optional(),
  consecutiveFailures: z.number(),
  circuitOpenUntil: z.number().optional(),
  upstreamCalls: z.number(),
  cacheHits: z.number(),
});

export const healthSchema = z.object({
  status: z.string(),
  version: z.string(),
  time: z.number(),
  coordinator: z.object({ startedAt: z.number(), cacheEntries: z.number() }).nullable(),
  providers: z.array(health),
});

export const providersSchema = z.object({
  providers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: z.string(),
      enabled: z.boolean(),
      scope: z.string(),
      limits: z.string(),
      attribution,
      terms: z.string(),
    }),
  ),
});

export const airportDetailSchema = z.object({
  ident: z.string(),
  icao: z.string().optional(),
  iata: z.string().optional(),
  name: z.string(),
  city: z.string().optional(),
  country: z.string(),
  lat: z.number(),
  lon: z.number(),
  type: z.string(),
  elevationFt: z.number().optional(),
  scheduled: z.boolean(),
  region: z.string().optional(),
  continent: z.string().optional(),
  homeLink: z.string().optional(),
  wikipedia: z.string().optional(),
  runways: z.array(
    z.object({
      leIdent: z.string().optional(),
      heIdent: z.string().optional(),
      lengthFt: z.number().optional(),
      widthFt: z.number().optional(),
      surface: z.string().optional(),
      lighted: z.boolean(),
      closed: z.boolean(),
      leHeadingDegT: z.number().optional(),
      heHeadingDegT: z.number().optional(),
      leLat: z.number().optional(),
      leLon: z.number().optional(),
      heLat: z.number().optional(),
      heLon: z.number().optional(),
      leElevationFt: z.number().optional(),
      heElevationFt: z.number().optional(),
      leDisplacedThresholdFt: z.number().optional(),
      heDisplacedThresholdFt: z.number().optional(),
    }),
  ),
  frequencies: z.array(z.object({ type: z.string(), description: z.string().optional(), mhz: z.number() })),
});

export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), retryAfterSec: z.number().optional() }),
});
