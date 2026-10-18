/**
 * Vite config for ShopkeepersLegacy.
 *
 * Serves the game in dev (`npm run dev`) and produces a static build. Phaser is a large
 * dependency, so it is split into its own manual chunk to keep the main bundle lean. The
 * dev server runs on a fixed port so Playwright's baseURL is stable.
 *
 * Remote play: Tailscale Serve publishes this dev server to Jeff's tailnet (iPad) over HTTPS.
 * The browser then reaches optional NPC chat through this same origin at `/chat*`; the dev
 * server forwards those requests to the chat bridge named by SHOPKEEPERS_CHAT_PROXY.
 */
import { defineConfig, type Plugin, type ProxyOptions } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Explicit chat bridge target, e.g. `http://chat:5277` in Docker or `http://127.0.0.1:5277` on the Mac. */
const chatProxyTarget = process.env.SHOPKEEPERS_CHAT_PROXY;

/**
 * True when the browser's Origin header names the same site the request was sent to.
 * Tailscale Serve keeps the original Host header, so a same-origin page has Origin host === Host.
 */
function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) return false;
  return new URL(origin).host === host;
}

/**
 * Forward `/chat*` to the chat bridge. Same-origin requests drop their Origin header so the bridge
 * treats them like its trusted local callers; any foreign Origin passes through and the bridge's own
 * origin allow-list rejects it with 403.
 */
function chatProxy(target: string): Record<string, ProxyOptions> {
  return {
    '/chat': {
      target,
      changeOrigin: true,
      configure: (proxy) => {
        proxy.on('proxyReq', (proxyReq, req) => {
          if (isSameOrigin(req)) proxyReq.removeHeader('origin');
        });
      },
    },
  };
}

/**
 * When no chat target is configured, answer `/chat*` with a clear 503 instead of letting the request
 * fall through to Vite's HTML fallback. The game's chat client surfaces this as a visible failure.
 */
function missingChatProxy(): Plugin {
  return {
    name: 'shopkeepers-missing-chat-proxy',
    configureServer(server) {
      server.middlewares.use('/chat', (_req: IncomingMessage, res: ServerResponse) => {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'NPC chat proxy is not configured. Set SHOPKEEPERS_CHAT_PROXY for this dev server.' }));
      });
    },
  };
}

export default defineConfig({
  plugins: chatProxyTarget ? [] : [missingChatProxy()],
  server: {
    // 5273, not the Vite default 5173 — a Docker container on this machine already publishes 5173
    // (a different app). strictPort makes a collision fail loudly instead of silently picking
    // another port that tests wouldn't know about.
    port: 5273,
    strictPort: true,
    // Tailnet names (e.g. <mac>.<tailnet>.ts.net) reach this server through Tailscale Serve.
    // The leading dot allows every ts.net subdomain without committing the private tailnet name.
    allowedHosts: ['.ts.net'],
    proxy: chatProxyTarget ? chatProxy(chatProxyTarget) : undefined,
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
