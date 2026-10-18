# Docker local runtime

## Objective

Run the Shopkeepers Legacy game server and NPC chat bridge as local Docker Desktop containers.
Keep the existing Ollama app and its downloaded `gemma4:12b` model on the Mac.

## Solution ladder

- L1 patch: Keep terminal servers and add shell background commands.
- L2 abstraction: Add one Docker Compose stack for the game and chat bridge.
- L3 operating surface: Add a full local platform with proxy, model container, and deployment tooling.

Choose L2. L1 does not put the servers in Docker Desktop. L3 would duplicate the large model and add
services that this local game does not need.

Existing parts reused: Vite, the strict NPC chat bridge, the current package scripts, and host Ollama.
Expected change: six small runtime or documentation files, under 300 lines.

## Acceptance contract

1. `docker compose config` exits zero.
2. The image builds from the locked npm dependencies.
3. Docker Desktop shows one game container and one chat container.
4. Only `127.0.0.1:5273` and `127.0.0.1:5277` are published.
5. The game returns HTTP 200 and the chat bridge returns a valid `reply` plus `outcome`.
6. The chat container reaches the existing host Ollama model without downloading a second model.
7. Typecheck, build, focused chat tests, and `git diff --check` exit zero.
8. The old host Node processes are stopped only after the image builds successfully.

## Guardrails

- Do not stop or move Ollama.
- Do not touch browser saves or game data.
- Do not expose either container on the local network.
- Do not add silent model or port fallbacks.
- Do not change gameplay behavior.
