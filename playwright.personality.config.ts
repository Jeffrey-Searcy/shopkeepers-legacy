/** Own test server and cache; never reuse or restart the user's port 5273. */
import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://localhost:5276' },
  webServer: { command: 'node scripts/personality-server.mjs', url: 'http://localhost:5276', reuseExistingServer: false, timeout: 120_000 },
});
