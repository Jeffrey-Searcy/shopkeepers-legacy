/**
 * Playwright config for ShopkeepersLegacy gameplay verification.
 *
 * The game renders to a single <canvas>, so DOM assertions are useless — tests drive the game
 * through the `window.__TEST__` seam (see src/debug/DebugHooks.ts) and read serialized GameState.
 * Playwright boots its own Vite dev server (webServer below) and every test navigates with
 * `?test=1&seed=42` for determinism.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0, // We rely on determinism (seeded RNG + stepTime), not retries — see CLAUDE.md.
  reporter: [['list']],
  // Pre-warm the Vite dev server (compile Phaser once) before any test navigates — see globalSetup.
  globalSetup: './tests/globalSetup.ts',
  use: {
    baseURL: 'http://localhost:5273',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5273',
    // Always start OUR server. reuseExistingServer:true previously latched onto an unrelated app
    // already bound to the old port, so tests loaded the wrong page. Our port (5273) is dedicated.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
