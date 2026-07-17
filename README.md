# Violoop

Violoop is a local-first web chatbot. The React app is served as static assets, the Hono Worker provides a same-origin model proxy, and chat/configuration data is stored in the browser's IndexedDB.

> **Important:** IndexedDB is scoped to the current browser profile. Clearing site data loses local data. Use the Configuration modal's **Export local data** action for backups. Exported JSON intentionally omits Provider API keys; keys must be entered again after import.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173`. `pnpm dev` starts Vite and the local Hono Worker (Wrangler); `/api` is proxied to port `8787` by default.

First-run config/tactics/states are seeded from `public/default-data/` into IndexedDB automatically.

To run only the Cloudflare-compatible proxy:

```bash
pnpm dev:worker
```

Vite proxies `/api` to the Worker. `VIOLOOP_HOST` and `VIOLOOP_PORT` can override the proxy target (default host `127.0.0.1`, port `8787`).

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

The Worker validates Provider URLs. HTTPS is required in production; localhost HTTP is allowed for local development. Private IPv4 ranges, private/link-local IPv6 (ULA `fc00::/7`, link-local `fe80::/10`, IPv4-mapped IPv6 pointing at a private IPv4), credentials embedded in URLs, and unsupported Provider APIs are rejected to reduce SSRF risk. See "Deployment security" below for the host/origin allowlists.

## Provider and prompt behavior

Providers use the OpenAI-compatible `/chat/completions` shape. The adapter supports the existing thinking formats, developer/system role selection, usage streaming, prompt cache options, Anthropic cache markers, and SSE response parsing.

Each provider has a **Request route** setting:

- **Worker proxy** sends from the Cloudflare Worker IP and avoids browser CORS restrictions.
- **Browser direct** sends from the user's residential/browser network IP, but requires the upstream to allow that origin through CORS.
- The two fallback choices retry through the other route if the preferred route fails.

This lets a provider use the browser's cleaner IP when its CORS policy permits it, while retaining the Worker route for CORS-blocked requests. A fallback can cause a failed request to be sent twice, so select an explicit route for providers where duplicate requests are not acceptable.

Provider API keys are stored in the current browser's IndexedDB. Browser-direct calls necessarily expose the Provider URL and API key to the browser network request; the Worker proxy does not make keys a server-side secret vault either, because the browser owner and a successful XSS can access local keys.

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

Coverage is enforced at 100% (lines, functions, branches, statements) for the modules included in `vitest.config.ts` (`src/shared`, `src/providers`, `src/worker`, `src/web`). Vitest with fake IndexedDB covers the Worker, provider adapters, and browser storage/business logic.

## Deployment security

`VIOLOOP_ALLOWED_ORIGINS` and `VIOLOOP_ALLOWED_PROVIDER_HOSTS` default to empty, which means **no origin or provider-host restriction**: any origin can call the Worker's `/api/*` routes, and any non-private HTTPS host can be used as a Provider `baseUrl`. This is intentional for local/dev use, where the Worker only ever talks to a same-origin browser and a Provider the user configured.

**Before a public deployment**, set both variables (as Wrangler vars/secrets, not app config) to a comma-separated allowlist of trusted origins and provider hosts. Leaving them empty on a public deployment turns the Worker into an open CORS + SSRF-adjacent proxy for whatever Provider URL a caller supplies.
