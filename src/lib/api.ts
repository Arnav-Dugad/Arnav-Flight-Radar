import type { z } from 'zod';
import type { AirportDetail, Metar, Taf } from '@shared/types';
import {
  airportDetailSchema,
  apiErrorSchema,
  healthSchema,
  metarResponseSchema,
  providersSchema,
  tafResponseSchema,
} from './schemas';

export class ApiFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
  }
}

async function getJson<S extends z.ZodType>(url: string, schema: S, signal?: AbortSignal, timeoutMs = 15000) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(url, { signal: combined, headers: { Accept: 'application/json' } });
  } catch (e) {
    if ((e as Error).name === 'AbortError' && signal?.aborted) throw e;
    throw new ApiFailure('Network unavailable — check your connection.', 0, 'network');
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiFailure('The server returned an unreadable response.', res.status, 'bad_response');
  }
  if (!res.ok) {
    const e = apiErrorSchema.safeParse(body);
    if (e.success) throw new ApiFailure(e.data.error.message, res.status, e.data.error.code, e.data.error.retryAfterSec);
    throw new ApiFailure(`Request failed (HTTP ${res.status}).`, res.status, 'http');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    console.warn('schema mismatch', url, parsed.error.issues.slice(0, 3));
    throw new ApiFailure('The data did not match the expected format.', res.status, 'schema');
  }
  return parsed.data as z.output<S>;
}

export const api = {
  metar: (ids: string[], signal?: AbortSignal) =>
    getJson(`/api/weather/metar?ids=${ids.join(',')}`, metarResponseSchema, signal) as Promise<{
      data: Metar[];
      fetchedAt: number;
      degraded?: string;
    }>,

  metarBbox: (s: number, w: number, n: number, e: number, signal?: AbortSignal) =>
    getJson(
      `/api/weather/metar?bbox=${[s, w, n, e].map((x) => x.toFixed(2)).join(',')}`,
      metarResponseSchema,
      signal,
    ) as Promise<{ data: Metar[]; fetchedAt: number }>,

  taf: (ids: string[], signal?: AbortSignal) =>
    getJson(`/api/weather/taf?ids=${ids.join(',')}`, tafResponseSchema, signal) as Promise<{
      data: Taf[];
      fetchedAt: number;
    }>,

  airport: (ident: string, signal?: AbortSignal) =>
    getJson(`/api/airports/${encodeURIComponent(ident)}`, airportDetailSchema, signal) as Promise<AirportDetail>,

  health: (signal?: AbortSignal) => getJson('/api/health', healthSchema, signal),
  providers: (signal?: AbortSignal) => getJson('/api/providers', providersSchema, signal),
};
