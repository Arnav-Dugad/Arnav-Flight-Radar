# Deployment (Cloudflare Workers, free plan)

## One-time setup

```bash
npm install
npx wrangler login        # opens a browser; no tokens are pasted anywhere
```

## Deploy

```bash
npm run deploy            # = node scripts/build-airports.mjs && vite build && wrangler deploy
```

The Cloudflare Vite plugin writes `dist/arnav_flight_radar/wrangler.json`, which `wrangler deploy`
uses. It contains:

- the Worker (`/api/*`) and the `UpstreamGate` **SQLite-backed** Durable Object (migration `v1`,
  `new_sqlite_classes`, which the free plan requires);
- static assets from `dist/client` with SPA fallback and `_headers` (CSP, HSTS-friendly headers, cache
  policy).

The site is published at `https://arnav-flight-radar.<your-subdomain>.workers.dev`.

## Configuration (`wrangler.jsonc` → `vars`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `ADSBFI_MIN_INTERVAL_MS` | `1100` | Global spacing of adsb.fi calls (clamped ≥ 1000) |
| `AIRCRAFT_CACHE_TTL_MS` | `10000` | How long a regional snapshot is shared |
| `WEATHER_MIN_INTERVAL_MS` | `1500` | Global spacing of AviationWeather calls |
| `APP_VERSION` | `1.0.0` | Reported by `/api/health` |

There are **no secrets**. Every source is keyless.

## Free-tier budget

| Resource | Free limit | Usage |
| --- | --- | --- |
| Static asset requests | Free, unlimited | the app, airport data, fonts |
| Worker requests | 100,000 / day | API only: one visitor polling every 15 s ≈ 240/hour, so about 400 visitor-hours/day |
| Durable Object requests | 100,000 / day | at most one per API request |
| DO duration | 13,000 GB-s / day | a single small instance |
| DO SQLite storage | 5 GB | not used (in-memory cache) |
| Worker CPU | 10 ms / request | Normalization runs in the DO; the Worker forwards strings |
| Static assets | 20,000 files, 25 MiB each | about 600 files |

If daily limits are reached, Cloudflare returns errors until 00:00 UTC. The app then shows
"Offline" or "Degraded", and nothing is billed. Raise the polling interval to stretch the budget.

## CI deployment (optional)

`.github/workflows/ci.yml` runs typecheck, lint, unit tests and the build on every push. Deployment
runs on `main` **only if** both repository secrets exist:

- `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers")
- `CLOUDFLARE_ACCOUNT_ID`

Without them, the deploy job is skipped.

## Verifying a deployment

```bash
curl https://<host>/api/health
BASE_URL=https://<host> npx playwright test
```
