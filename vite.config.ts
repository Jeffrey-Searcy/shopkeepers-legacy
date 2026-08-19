/**
 * Vite config for ShopkeepersLegacy.
 *
 * Serves the game in dev (`npm run dev`) and produces a static build. Phaser is a large
 * dependency, so it is split into its own manual chunk to keep the main bundle lean. The
 * dev server runs on a fixed port so Playwright's baseURL is stable.
 */
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // 5273, not the Vite default 5173 — a Docker container on this machine already publishes 5173
    // (a different app). strictPort makes a collision fail loudly instead of silently picking
    // another port that tests wouldn't know about.
    port: 5273,
    strictPort: true,
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
});
