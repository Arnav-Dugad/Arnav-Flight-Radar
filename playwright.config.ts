import { defineConfig, devices } from '@playwright/test';

// E2E against the local dev server by default, or a deployed site via BASE_URL:
//   BASE_URL=https://arnav-flight-radar.<subdomain>.workers.dev npx playwright test
const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const local = !process.env.BASE_URL;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false, // be gentle with the shared upstream budget
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    // WebGL in headless Chromium.
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: local
    ? { command: 'npm run dev -- --port 5173 --strictPort --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: true, timeout: 120_000 }
    : undefined,
});
