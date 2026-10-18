/** Isolated verification server; never stops or reuses Jeff's running playtest server on 5273. */
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://localhost:5274' },
  webServer: {
    command: 'npm run dev -- --port 5274 --strictPort',
    url: 'http://localhost:5274',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
