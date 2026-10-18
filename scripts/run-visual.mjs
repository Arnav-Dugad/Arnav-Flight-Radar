// Cross-platform runner for the visual regression suite.
//   npm run test:visual                      compare against baselines
//   npm run test:visual -- --update-snapshots   (re)create baselines for this OS
import { spawnSync } from 'node:child_process';

const r = spawnSync('npx', ['playwright', 'test', '--project', 'visual', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, VISUAL: '1' },
});
process.exit(r.status ?? 1);
