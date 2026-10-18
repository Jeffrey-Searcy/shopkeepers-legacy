/** Reuse the healthy Docker game for one-worker civic regressions without starting another server. */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /(?:town-buildings-travel|town-building-art|interior-foundation|town-social-life)\.spec\.ts$/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5273', viewport: { width: 1280, height: 720 } },
});
