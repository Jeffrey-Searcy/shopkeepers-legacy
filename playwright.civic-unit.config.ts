/** Server-free map/save and local bridge checks run without touching either Vite port. */
import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', testMatch: /(?:town-buildings-migration|town-layout-migration|farm-layout-migration|npc-chat-server)\.spec\.ts$/,
  fullyParallel: true, retries: 0, reporter: 'line', workers: 4 });
