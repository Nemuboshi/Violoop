# Violoop

Violoop is a local-first web chatbot. The React app is served as static assets, the Hono Worker provides a same-origin model proxy, and chat/configuration data is stored in the browser's IndexedDB.

> **Important:** IndexedDB is scoped to the current browser profile. Clearing site data loses local data. Use the Configuration modal's **Export local data** action for backups. Exported JSON intentionally omits Provider API keys; keys must be entered again after import.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173`.

The existing Node/Fastify server remains available for the current server test suite and migration work:

```bash
pnpm seed
pnpm dev:api
```

For the Cloudflare-compatible proxy locally, use Wrangler:

```bash
pnpm dev:worker
```

Vite proxies `/api` to the configured local API target during development. `VIOLOOP_HOST` and `VIOLOOP_PORT` can be used for the legacy Node API; production uses the Worker and does not use `VIOLOOP_DATA_DIR`.

## Architecture

```text
Browser React
  ├─ IndexedDB: conversations, messages, config, providers, tactics, states
  ├─ JSON export/import (API keys redacted by default)
  └─ same-origin /api requests
       │
       ▼
Cloudflare Worker / Hono
  ├─ /api/health
  ├─ /api/chat
  └─ /api/providers/test
       │
       ▼
OpenAI-compatible provider
```

The Worker is stateless. It receives the prompt context required for one request, calls the configured Provider, and returns the collected text and usage. It does not access IndexedDB and does not persist conversations.

## Cloudflare deployment

Install Wrangler through pnpm and authenticate once:

```bash
pnpm install
pnpm exec wrangler login
pnpm deploy
```

`wrangler.toml` uses `dist` as the static asset directory and enables SPA fallback. Optional `VIOLOOP_ALLOWED_ORIGINS` can contain a comma-separated list of allowed origins. Same-origin deployment is recommended.

The Worker validates Provider URLs. HTTPS is required in production; localhost HTTP is allowed for local development. Private IPs, credentials embedded in URLs, and unsupported Provider APIs are rejected to reduce SSRF risk.

## Provider and prompt behavior

Providers use the OpenAI-compatible `/chat/completions` shape. The adapter supports the existing thinking formats, developer/system role selection, usage streaming, prompt cache options, Anthropic cache markers, and SSE response parsing.

Provider API keys are stored in the current browser's IndexedDB. The Worker proxy prevents Provider CORS problems and hides the Provider URL from frontend request code, but it is not a server-side secret vault: the browser owner and a successful XSS can access local keys.

## Local data and export

IndexedDB stores:

- global chat configuration and providers;
- conversations and timeline items;
- compaction summaries;
- session clocks, tactics, and user states;
- tactic/state libraries and usage records.

Export/import is available from **Configure → Settings**. Export format is versioned as `violoop-export` with schema version `1`. Import validates the complete envelope before writing. Existing API keys are retained when an imported Provider has the same id; exported files never include keys.

There is no cross-device sync, account system, or cloud conversation backup in this version. D1/R2 can be introduced later if cloud synchronization becomes a requirement.

## Tactics and session behavior

Tactics remain a global library with per-session allowed choices. At most five matching tactics are loaded for a turn. Session state, day progression, opening scenes, runtime actions, compaction, prompt visibility, and edit-last behavior retain the business rules covered by the Vitest suite.

## Quality commands

Use pnpm for every command:

```bash
pnpm test
pnpm test:coverage
pnpm build
pnpm biome check .
```

Coverage is required to remain at 100% for the existing business modules. New Worker/storage modules are tested with Vitest and fake IndexedDB; complete migration will raise their coverage to the same 100% threshold before the legacy Node server is removed.
