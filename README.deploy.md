# WikiBridge Deployment

This directory contains a Docker Compose stack that runs:

- **llm-wiki** (S端) — headless LLM Wiki server on port 19828
- **opencode** (C端) — OpenCode server in Knowledge Base mode on port 4096
- **nginx** — single-origin gateway on port 80
- **bearfrp** — BearFRP control panel plus frps, used to publish the local gateway
- **bearfrp-wikibridge-frpc** — optional frpc sidecar that auto-publishes nginx

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
#
# 5. BearFRP is available at http://localhost:8000
#    The auto-created WikiBridge tunnel URL is printed in:
#    docker compose logs bearfrp-wikibridge-frpc
```

## Optional Basic auth

To require a username and password, set `OPENCODE_SERVER_PASSWORD` in `.env`:

```bash
OPENCODE_SERVER_PASSWORD=your-strong-password
```

Then log in with user `opencode` and that password.

## Publish with BearFRP

BearFRP is integrated as the publishing layer. The BearFRP backend runs on
`BEARFRP_BACKEND_PORT` and starts `frps` inside the same container. A frpc
sidecar registers a `wikibridge` demo user, creates a proxy, and points it at
the Compose-network nginx service.

For a local demo:

```bash
# 1. Start the stack
docker compose up --build -d

# 2. Read the generated public URL
docker compose logs bearfrp-wikibridge-frpc
```

The default auto-published proxy uses TCP mode, so the URL is directly usable as
`http://localhost:<allocated-port>/` on the Docker host. The current BearFRP
source exposes the backend API and Tauri desktop client; it does not include the
browser `user.html` panel in this branch, so Compose uses the API sidecar for
the one-click demo path.

Manual TCP proxy settings:

| Field | Value |
|---|---|
| Type | `tcp` |
| Local IP | `nginx` when frpc runs in Compose, or `127.0.0.1` when frpc runs on the host |
| Local port | `80` in Compose, or your `WIKIBRIDGE_HTTP_PORT` on the host |
| Port mode | `auto` |

Run the generated `frpc` script on a machine that can reach that local IP and
port. The published URL will be `http://<BEARFRP_PUBLIC_HOST>:<allocated-port>/`.

For HTTP subdomain publishing, set `BEARFRP_PUBLIC_HOST` to the frps server host
and optionally set `BEARFRP_SUBDOMAIN_HOST` to a wildcard DNS domain. Create an
HTTP proxy with local IP `127.0.0.1`, local port `80`, and a subdomain such as
`wiki`. The published URL will look like
`http://wiki.<BEARFRP_SUBDOMAIN_HOST>:8080/` unless `BEARFRP_HTTP_VHOST_PORT=80`.

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
| `BEARFRP_PUBLIC_HOST` | `localhost` | Public host/IP written into generated frpc configs and public URLs |
| `BEARFRP_BACKEND_PORT` | `8000` | Host port for BearFRP panel and API |
| `BEARFRP_BIND_PORT` | `7000` | frps bind port used by generated frpc configs |
| `BEARFRP_HTTP_VHOST_PORT` | `8080` | Host port for BearFRP HTTP/subdomain proxies |
| `BEARFRP_TCP_PORT_START` / `BEARFRP_TCP_PORT_END` | `50000` / `50100` | Published TCP proxy port range |
| `BEARFRP_SUBDOMAIN_HOST` | empty | Optional wildcard domain used for HTTP proxy URLs |
| `BEARFRP_ADMIN_USERNAME` / `BEARFRP_ADMIN_PASSWORD` | `admin` / `change-me` | BearFRP admin panel credentials |
| `BEARFRP_FRPS_AUTH_TOKEN` | `change-me` | Shared frps/frpc token; change before public use |
| `WIKIBRIDGE_BEARFRP_USER` / `WIKIBRIDGE_BEARFRP_PASSWORD` | `wikibridge` / `wikibridge-change-me` | Demo user used by the automatic frpc sidecar |
| `WIKIBRIDGE_BEARFRP_PROXY_TYPE` | `tcp` | Auto-published proxy type; `tcp` works without wildcard DNS |
| `WIKIBRIDGE_BEARFRP_SUBDOMAIN` | `wikibridge` | Subdomain used when the auto proxy type is `http` |

## Data volumes

| Volume | Container path | Purpose |
|---|---|---|
| `llm-wiki-data` | `/data` in llm-wiki | Wiki projects and app-state.json |
| `opencode-data` | `/data` in opencode | Per-user private KB and state |
| `bearfrp-config` | `/app/config` in bearfrp | BearFRP SQLite state and port-range config |
| `bearfrp-frps` | `/app/frps` in bearfrp | Downloaded frps binary and generated frps.toml |
| `bearfrp-wikibridge-frpc` | `/state` in bearfrp-wikibridge-frpc | Downloaded frpc binary and generated frpc.toml |

## Production notes

- Set `LLM_WIKI_TOKEN` and `OPENCODE_SERVER_PASSWORD` before exposing to the internet.
- Change `BEARFRP_ADMIN_PASSWORD`, `BEARFRP_FRPS_ADMIN_PASSWORD`, and
  `BEARFRP_FRPS_AUTH_TOKEN` before exposing BearFRP ports.
- Open or forward the BearFRP ports you use: backend, frps bind, HTTP vhost, and
  the TCP range.
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

# 5. BearFRP API is live
curl http://localhost:8000/api/show/online
```

If you set `OPENCODE_SERVER_PASSWORD`, add `-u opencode:$PASS` to the curl commands above.

If you set `LLM_WIKI_TOKEN`, the bridge sends it as both `Authorization: Bearer <token>`
and `X-LLM-Wiki-Token: <token>` so the llm_wiki server can authenticate requests.
