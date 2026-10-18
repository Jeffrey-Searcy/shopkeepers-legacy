# Local Docker Desktop runtime

The Docker stack runs the Vite game and NPC chat bridge. It keeps Ollama on the Mac and uses the
existing `gemma4:12b` model through Docker Desktop's `host.docker.internal` address.

## Commands

```sh
npm run docker:up
npm run docker:status
npm run docker:logs
npm run docker:down
```

Open `http://localhost:5273/`. The game still stores saves in the browser. Docker does not move,
copy, or delete them.

The stack publishes ports 5273 and 5277 only on `127.0.0.1`. Source files are mounted read-only,
so Vite still reloads after code edits. Vite puts its temporary config in the
`shopkeepers-vite-config` Docker volume. Dependencies live in the `shopkeepers-node-modules` Docker
volume. Rebuild after `package.json` or `package-lock.json` changes.

## Play on iPad (Tailscale)

Tailscale Serve publishes the game to the tailnet over HTTPS on port 10000:

```sh
tailscale serve --bg --https=10000 http://localhost:5273
```

Open `https://<mac-name>.<tailnet>.ts.net:10000/` in Safari on the iPad. Vite accepts any `.ts.net`
host name (`server.allowedHosts` in `vite.config.ts`). The ports stay bound to `127.0.0.1`; only
Tailscale reaches them.

The browser sends NPC chat to the same address at `/chat`. Vite forwards it to the chat bridge named
by `SHOPKEEPERS_CHAT_PROXY` (`http://chat:5277` in `compose.yaml`). Vite drops the Origin header only
when the page and request share a host, so the bridge still rejects foreign sites. Without that
variable, `/chat` answers 503 with a clear message. Changes to `vite.config.ts` or `compose.yaml` need
`docker compose up -d --no-deps game`; Vite in Docker does not reload its own config.

The first tap turns on the on-screen touch controls (`src/input/TouchControls.ts`). Desktop play never
shows them. Saves live in each browser, so iPad and Mac saves are separate.

Ollama must remain running on the Mac at port 11434. Chat requests return a clear error when Ollama or
`gemma4:12b` is unavailable. This setup does not download a second model into Docker.
