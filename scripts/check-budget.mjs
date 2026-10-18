// Performance budget: fails the build if what a first visit downloads grows past the limits.
//   node scripts/check-budget.mjs   (after `npm run build`)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST = 'dist/client';
const BUDGET = {
  initialJsGz: 600 * 1024, // everything the HTML loads up front (entry + modulepreloads)
  initialCssGz: 32 * 1024,
  lazyChunkGz: 40 * 1024, // any single on-demand chunk (workers excluded)
  simWorkerGz: 120 * 1024, // the simulation worker (fetched in the background, runs off the main thread)
  majorAirportIndexGz: 260 * 1024,
};

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
const gz = (p) => gzipSync(readFileSync(join(DIST, p))).length;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

const initialJs = refs.filter((r) => r.endsWith('.js'));
const initialCss = refs.filter((r) => r.endsWith('.css'));
const jsGz = initialJs.reduce((a, r) => a + gz(r), 0);
const cssGz = initialCss.reduce((a, r) => a + gz(r), 0);

const initialSet = new Set(initialJs.map((r) => r.replace('/assets/', '')));
const lazy = readdirSync(join(DIST, 'assets'))
  .filter((f) => f.endsWith('.js') && !initialSet.has(f) && !f.startsWith('maplibre-gl-worker') && !f.startsWith('sim.worker'))
  .map((f) => ({ f, size: gz(`/assets/${f}`) }))
  .sort((a, b) => b.size - a.size);
const airports = gz('/data/airports/index-major.json');
const simWorker = readdirSync(join(DIST, 'assets')).find((f) => f.startsWith('sim.worker') && f.endsWith('.js'));

const rows = [
  ['Initial JS (gzip)', jsGz, BUDGET.initialJsGz],
  ['Initial CSS (gzip)', cssGz, BUDGET.initialCssGz],
  [`Largest lazy chunk (${lazy[0]?.f ?? '—'})`, lazy[0]?.size ?? 0, BUDGET.lazyChunkGz],
  ['Major airport index (gzip)', airports, BUDGET.majorAirportIndexGz],
  [`Simulation worker (${simWorker ?? '—'})`, simWorker ? gz(`/assets/${simWorker}`) : 0, BUDGET.simWorkerGz],
];
let failed = false;
for (const [name, size, max] of rows) {
  const ok = size <= max;
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(48)} ${kb(size).padStart(10)}  / ${kb(max)}`);
}
console.log(`\nInitial files: ${initialJs.length} JS, ${initialCss.length} CSS · lazy chunks: ${lazy.length} · total dist assets: ${readdirSync(join(DIST, 'assets')).length}`);
if (failed) {
  console.error('\nPerformance budget exceeded.');
  process.exit(1);
}
