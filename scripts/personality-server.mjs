/** Isolated test server: private dependency cache prevents reloads in the user's running game. */
import { createServer } from 'vite';
// The shared vite.config.ts reads this when it loads; tests reach the host chat bridge directly.
process.env.SHOPKEEPERS_CHAT_PROXY = 'http://127.0.0.1:5277';
const server = await createServer({ cacheDir: 'output/personality-vite-cache', server: { port: 5276, strictPort: true } });
await server.listen();
server.printUrls();
