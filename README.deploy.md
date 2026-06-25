# WikiBridge Deployment

This directory contains a Docker Compose stack that runs:

- **llm-wiki** (S端) — headless LLM Wiki server on port 19828
- **opencode** (C端) — OpenCode server in Knowledge Base mode on port 4096
- **nginx** — single-origin gateway on port 80

## Quick start

```bash
# 1. Copy environment variables (auth is disabled by default)
cp .env.example .env

# 2. Initialize LLM Wiki sample data (optional)
cd llm_wiki && bash scripts/init-data-dir.sh && cd ..

# 3. Start the stack. This builds the embedded web UI automatically.
docker compose up --build -d

# 4. Open http://localhost in your browser
#    No login is required by default.
```

## Optional Basic auth

To require a username and password, set `OPENCODE_SERVER_PASSWORD` in `.env`:

```bash
OPENCODE_SERVER_PASSWORD=your-strong-password
```

Then log in with user `opencode` and that password.

## Development (without Docker)

```bash
# 1. Build llm_wiki server binary (requires Tauri/GTK system dependencies)
cd llm_wiki
bash scripts/init-data-dir.sh
LLM_WIKI_DATA_DIR=./data LLM_WIKI_PORT=19828 cargo run --release --bin llm-wiki-server

# 2. In another terminal, start OpenCode in KB mode
cd ../opencode/packages/opencode
bash scripts/init-kb-data.sh
OPENCODE_KB_MODE=1 \
  LLM_WIKI_BASE_URL=http://127.0.0.1:19828/api/v1 \
  bun run --conditions=browser ./src/index.ts web --hostname 127.0.0.1 --port 4096

# 3. For local UI development, also run the app dev server
cd ../app
bun dev -- --port 4444
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `LLM_WIKI_TOKEN` | empty | Auth token shared between opencode and llm-wiki |
| `OPENCODE_SERVER_PASSWORD` | empty | Basic auth password for the web UI; leave empty to disable login |
| `WIKIBRIDGE_HTTP_PORT` | `80` | Host port for nginx |

## Data volumes

| Volume | Container path | Purpose |
|---|---|---|
| `llm-wiki-data` | `/data` in llm-wiki | Wiki projects and app-state.json |
| `opencode-data` | `/data` in opencode | Per-user private KB and state |

## Production notes

- Set `LLM_WIKI_TOKEN` and `OPENCODE_SERVER_PASSWORD` before exposing to the internet.
- Put nginx behind HTTPS (e.g. with a reverse proxy or certbot).
- The compose file builds the embedded web UI at startup. To pre-build it:
  `cd opencode/packages/opencode && bun run --cwd packages/app build && bun run scripts/prepare-embedded-ui.ts`.
- The current compose file mounts the opencode source directory for ease of iteration.
  For a fully self-contained image, copy the source into the image instead.

## Verification

After the stack starts, these checks should pass (run from the host against nginx):

```bash
# 1. OpenCode KB bridge health (proxies to llm_wiki)
curl http://localhost/instance/llm-wiki/health

# 2. List projects through the bridge
curl http://localhost/instance/llm-wiki/projects

# 3. Search a project
curl -X POST -H "content-type: application/json" \
  -d '{"query":"example"}' \
  http://localhost/instance/llm-wiki/projects/default/search

# 4. KB mode is advertised to the web UI via meta tags
curl http://localhost/ | grep 'opencode-kb-mode'
```

If you set `OPENCODE_SERVER_PASSWORD`, add `-u opencode:$PASS` to the curl commands above.

If you set `LLM_WIKI_TOKEN`, the bridge sends it as both `Authorization: Bearer <token>`
and `X-LLM-Wiki-Token: <token>` so the llm_wiki server can authenticate requests.
