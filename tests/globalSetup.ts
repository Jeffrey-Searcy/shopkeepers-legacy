/**
 * Playwright global setup — pre-warms the Vite dev server.
 *
 * Vite compiles modules on demand. The first request for the app triggers a one-time transform of
 * the large Phaser dependency, which can take several seconds. Playwright's webServer considers the
 * server "ready" as soon as the port responds — before that first compile finishes — so the very
 * first test navigations were racing an un-warmed server and timing out on window.__TEST__.ready.
 *
 * This setup makes ONE request to the app (and waits for the module graph to build) before any test
 * runs, so every test hits an already-compiled, fast server. Root-cause fix, not a timeout bump.
 */
import { chromium, type FullConfig } from '@playwright/test';

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:5173';
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' || /rror|Cannot|undefined|fail/.test(t)) {
      if (!/GL Driver/.test(t)) console.log(`[warmup c.${m.type()}] ${t}`);
    }
  });
  page.on('pageerror', (e) => console.log(`[warmup pageerror] ${e.message}`));
  try {
    await page.goto(`${baseURL}/?test=1&seed=42`, { timeout: 90_000 });
    // Wait until the game is actually controllable — this guarantees the whole module graph
    // (Phaser + all scenes) has compiled and executed at least once.
    await page.waitForFunction(() => window.__TEST__?.ready === true, undefined, { timeout: 30_000 });
  } catch (err) {
    const diag = await page.evaluate(() =>
      JSON.stringify({ hasGame: !!window.__GAME__, hasTest: !!window.__TEST__, ready: window.__TEST__?.ready ?? null })
    );
    const html = await page.content();
    const url = page.url();
    console.log(`[warmup FAILED] ${(err as Error).message} :: state=${diag}`);
    console.log(`[warmup URL] ${url}`);
    console.log(`[warmup HTML] ${html.slice(0, 600).replace(/\n/g, ' ')}`);
    throw err;
  } finally {
    await browser.close();
  }
}
