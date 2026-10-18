# Deployment (Cloudflare Workers, free plan)

## One-time setup

```bash
npm install
npx wrangler login        # opens a browser; no tokens are pasted anywhere
```

## Deploy

```bash
npm run deploy            # = npm run build (build-airports.mjs + vite build) && wrangler deploy
```

The Cloudflare Vite plugin writes `dist/arnav_flight_radar/wrangler.json`, which `wrangler deploy`
uses. It contains:

- the Worker (`/api/*`) and the `UpstreamGate` **SQLite-backed** Durable Object (migration `v1`,
  `new_sqlite_classes`, which the free plan requires), used only to pace and cache weather requests;
- static assets from `dist/client` with SPA fallback and `_headers` (CSP, security headers, cache
  policy).

The simulator runs entirely in the visitor's browser, so there is nothing else to deploy. The other
datasets (`public/data/airspace`, `public/data/ground`, `public/data/media.json`,
`public/media/logos`) are committed; rebuild them only occasionally with `npm run data:airspace`,
`data:ground` and `data:media`.

The site is published at `https://arnav-flight-radar.<your-subdomain>.workers.dev`.

## Configuration (`wrangler.jsonc` → `vars`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `WEATHER_MIN_INTERVAL_MS` | `1500` | Global spacing of AviationWeather.gov calls (clamped ≥ 700) |
| `APP_VERSION` | `1.0.0` | Reported by `/api/health` and `/api/config` |
| `CONTACT_URL` | the GitHub repository | Source link reported by `/api/config` |

There are **no secrets**. Every source is keyless.

## Free-tier budget

| Resource | Free limit | Usage |
| --- | --- | --- |
| Static asset requests | Free, unlimited | the app, airport data, ground layouts, airspace, logos, fonts |
| Worker requests | 100,000 / day | API only. There is no aircraft polling: a visitor makes a few METAR requests at start-up, then at most one view-triggered METAR request every 15 s while panning, plus airport details on demand |
| Durable Object requests | 100,000 / day | one per weather request (airport and manifest routes don't use it) |
| DO duration | 13,000 GB-s / day | a single small instance |
| DO SQLite storage | 5 GB | not used (in-memory cache) |
| Worker CPU | 10 ms / request | Weather normalization runs in the DO; the Worker forwards strings |
| Static assets | 20,000 files, 25 MiB each | about 1,300 files |

If daily limits are reached, Cloudflare returns errors until 00:00 UTC. The simulation keeps running
(the runway in use falls back to the simulated wind), weather panels show the error, and nothing is
billed.

## CI deployment (optional)

`.github/workflows/ci.yml` runs typecheck, lint, the dataset build, unit and integration tests, the
production build and the performance budget on every push. Deployment runs on `main` **only if**
both repository secrets exist:

- `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers")
- `CLOUDFLARE_ACCOUNT_ID`

Without them, the deploy job is skipped.

## Verifying a deployment

```bash
curl https://<host>/api/health
BASE_URL=https://<host> npx playwright test
```
