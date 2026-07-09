# Violoop

Violoop is a small web chatbot that talks to a configured model provider. The web app lives under `src/web`, the Fastify API lives under `src/server`, and shared TypeScript types live under `src/shared`.

The provider config follows Pi Agent's provider shape: providers declare `baseUrl`, `api`, `authHeader`, `models`, and optional `compat` flags. User-editable chat and provider configuration is stored as JSON at `data/settings.json` and can be edited from the in-app Configure modal. Deployment-level runtime settings live in `.env`.

The development baseline follows the local Pi Agent setup on this machine:

- `baseUrl=http://127.0.0.1:15721/v1`
- `model=gpt-5.5`

## Run

```bash
pnpm install
copy .env.example .env
pnpm seed
pnpm dev
```

Open `http://127.0.0.1:5173`.

## Configure

Open the app and choose Configure. Settings are saved through `/api/config` into `data/settings.json` and take effect on the next chat request. The server validates settings with Zod before saving.

For a fresh checkout, run `pnpm seed` once to create `data/settings.json` and `data/tactics.json`. Use `pnpm seed:force` only when you intentionally want to overwrite local seed files.

Deployment settings are read from `.env` at API startup:

- `VIOLOOP_HOST`
- `VIOLOOP_PORT`
- `VIOLOOP_CORS_ORIGINS`
- `VIOLOOP_DATA_DIR`

`pnpm seed` also reads `.env`, so a custom `VIOLOOP_DATA_DIR` is seeded in the same location the server will use.

The first adapter is `openai-completions`, matching OpenAI-compatible `/chat/completions` providers. Add new provider APIs under `src/server/providers/` and register them in `src/server/providers/index.ts`.

## Prompt Cache

`chat.systemPrompt` is always sent as the first provider message. If `compat.supportsDeveloperRole` is true, Violoop sends it as a `developer` message; otherwise it sends `system`.

For cache reporting, `openai-completions` sends `stream_options.include_usage` unless `compat.supportsUsageInStreaming` is false. The server stores the final usage chunk by request id and exposes it through `/api/usage/{requestId}`. The UI shows cached prompt tokens when the provider reports them.

For explicit cache markers, set `compat.cacheControlFormat` to `anthropic`. Then `chat.cache.systemPrompt: true` wraps the system prompt with an Anthropic-style `cache_control` marker. Leave this unset for strict OpenAI-compatible providers that reject non-standard content fields.

## Chat Storage

Global settings stay in `data/settings.json`. Chat and session events are stored as append-only JSONL at `data/conversations.jsonl`.

The chat log is the source of truth for conversations. The server replays it in memory to provide:

- `GET /api/conversations`
- `GET /api/conversations/{conversationId}/messages`

`POST /api/chat` requires a `conversationId`. New sessions are created through `POST /api/conversations`, which also initializes the session clock, allowed tactics, and opening timeline.

## Tactics

Tactics are a global strategy library stored in `data/tactics.json`. Each tactic has a lightweight trigger index and a structured body; the body is loaded only when the tactic is selected for a chat turn.

Per-session data is separate:

- `session.tactics_set` events control which global tactics are allowed in a conversation.
- `session.user_state_set` events store that conversation's user state bars.
- `tactic.run_logged` events record why each tactic was loaded or skipped.

The UI lets each session choose its allowed tactics when the session is created.
