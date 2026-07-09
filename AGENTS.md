# AGENTS.md

This file defines project rules for AI coding agents working on Violoop. Follow these rules unless the user explicitly overrides them in the current conversation.

## Project Intent

Violoop is a chatbot application with a Fastify backend and a React frontend. The product direction is an agentic chat experience with configurable providers, persistent conversations, session-scoped profiles, and a tactics system that can influence responses without bloating every prompt.

## Working Style

- Use `pnpm` for all package scripts and dependency changes.
- Prefer implementing the requested change end to end instead of stopping at a proposal.
- Do not introduce compatibility code for removed designs unless the user explicitly asks for compatibility.
- Do not keep legacy aliases, renamed duplicate types, or compatibility wrappers just to preserve old names.
- Do not revert unrelated user changes in a dirty worktree.
- Keep changes scoped to the current request and the existing project shape.
- When adding behavior, update tests from the business requirement perspective, not by mirroring implementation details.

## Tooling

- Package manager: `pnpm`.
- Frontend build: Vite.
- Backend: Fastify.
- Formatting and linting: Biome.
- Tests: Vitest with V8 coverage.
- Runtime validation and persisted data schemas should use Zod where appropriate.
- Prefer native TypeScript scripts on modern Node when practical; avoid unnecessary build steps for simple scripts.

Useful commands:

```powershell
pnpm build
pnpm test:coverage
pnpm biome check .
pnpm dev
pnpm dev:api
pnpm dev:web
```

`pnpm test:coverage` generates `coverage/`. Remove it before running full Biome checks if Biome scans generated files:

```powershell
if (Test-Path coverage) { Remove-Item -LiteralPath coverage -Recurse -Force }
pnpm biome check .
```

## Architecture

### Source Layout

The project uses these main source areas:

```text
src/
  server/
  shared/
  web/
```

- `src/server`: Fastify server, routes, services, storage, provider adapters, runtime logic.
- `src/shared`: cross-runtime contracts and schemas used by server and web.
- `src/web`: React frontend organized with Feature-Sliced Design.

### Web FSD Rules

`src/web` must follow this layer structure:

```text
src/web/
  app/
  pages/
  widgets/
  features/
  entities/
  shared/
```

Layer dependency direction:

- `app` may depend on `pages`.
- `pages` may compose `widgets`, `features`, `entities`, and `shared`.
- `widgets` may depend on `features` only when absolutely needed, but should usually receive view models from `pages`; widgets may depend on `entities` and `shared`.
- `features` may depend on `entities` and `shared`.
- `entities` may depend only on other `entities` and `shared`.
- `shared` may not depend on business layers.

Boundary rules:

- Cross-slice imports must go through that slice's public `index.ts`.
- No cross-feature direct imports.
- No upward imports from lower layers to higher layers.
- UI widgets should not directly consume backend response contracts. Map business state into widget view models in the page layer.
- `src/web/shared` is for UI primitives, frontend API client helpers, and generic frontend utilities. It must not become a dumping ground for business types.
- Cross-runtime business contracts belong in `src/shared`, not `src/web/shared`.

### Server Rules

- Use Fastify routes and services rather than growing a monolithic server entry file.
- Deployment-level settings such as ports, CORS origins, host, and data paths belong in environment configuration, not user-facing app config.
- Resolve process-level paths once during server startup or in a central server config module. Avoid scattering path resolution across unrelated files.
- Provider-specific behavior belongs in provider adapters or provider service code, not in route handlers.

## Data and Configuration

- User-facing chat configuration and provider settings are application data, not deployment environment.
- Deployment/runtime variables belong in `.env`.
- Persisted application data currently favors JSON/JSONL plus Zod validation over SQLite unless there is a clear query/indexing need.
- Seed data should be handled by explicit seed scripts, not hidden default insertion in runtime code.
- When changing persisted JSON shapes, consider manual migration of existing data. Do not silently preserve old formats unless compatibility is explicitly requested.

## Provider System

- Providers are global configuration, not session-bound state.
- The Config modal has a Providers tab where users can create, edit, delete, test, and activate providers.
- Do not allow deleting the active provider.
- Switching provider updates both `chat.defaultProvider` and `chat.defaultModel`.
- Provider edit should support testing the provider before saving.
- Provider test result UI should use the common popover component and should open only when there is a result.
- Thinking/reasoning intensity is user-configurable. Keep `xhigh` available.
- Provider-specific thinking formats belong in provider configuration and provider adapter logic.

## Conversation Model

- Conversations must be persistent.
- The frontend must support selecting, restoring, and deleting sessions.
- Deleting a session requires confirmation.
- The delete action in the session list should be compact and not dominate the row.
- When no conversation is selected, the sidebar should not show session-only state such as provider details, tactics, usage, or session state.
- New chat should be opened through a modal.
- At new chat time, users can set:
  - Violoop-side display name.
  - User role.
  - Assistant role.
  - Allowed tactics for this session.
- Tactics allowed for a session are locked after the session starts.

## Tactics System

Tactics are a modified skills-like system for chat behavior.

- Tactics are a global library.
- Each session chooses which tactics are allowed at creation time.
- Tactic selection should not crowd the system prompt. Load tactic details only when relevant.
- Triggering may use keywords and session-level user state.
- Multiple tactics may trigger, but no more than five should be injected. If more than five match, choose five randomly.
- Tactics are configured in the Config modal's Tactics tab.
- Tactic create/edit should use a dedicated modal.
- Avoid exposing internal IDs as a primary user-facing editing concern. Derive IDs from names using lowercase slug behavior.
- Avoid overcomplicated tactic fields unless they have a clear runtime effect.
- Do not expose raw JSON editors for normal tactic rules when a structured UI is practical.

## Session State and Day Progression

- User emotional/session state is session-scoped, not global.
- Session state updates should be tied to day changes rather than every chat turn.
- The assistant/model may decide to advance the day through explicit structured output.
- Runtime should parse and persist day transition intent rather than independently deciding every turn.
- Day transition messages are special timeline items and should be displayed with special styling.
- Opening scene messages should be generated by the model.

## Prompt and Compaction

- System prompt handling, cache behavior, and auto-compaction are global chat settings.
- Do not send an unbounded full conversation forever. Use compacted context when conversations grow long.
- Cache-related settings belong in global chat settings, not provider list UI unless provider capability requires display.
- Keep prompt assembly explicit and testable.

## Frontend UI Rules

- Use `@base-ui/react`, not `base-web`.
- Use Tailwind CSS for styling.
- Prefer Base UI primitives for form controls, dialog/modal, popover, tabs, select, switch, input, textarea, checkbox, meter, and similar components.
- Create reusable components under `src/web/shared/ui` before duplicating widget-specific control code.
- Component names should be simple, for example `Button`, not `BaseButton`.
- Match the Base UI documentation style used in the project: square corners, simple borders, concise layout, and restrained colors.
- Avoid decorative gradients, card-heavy marketing layouts, or nested cards.
- Dialog close controls should stay fixed in the modal header area, not scroll with content.
- Select/popover positioning and arrows should follow Base UI examples.
- Use custom scroll area styling instead of native scrollbars where visible.
- Mobile layout should prioritize the chat area. Secondary controls belong in a top-right hamburger/popover menu that remains scrollable.
- Use Playwright or browser verification for visual regressions when layout or responsive behavior changes.

## Testing and Quality

- Keep coverage at 100% unless the user explicitly relaxes it.
- Cover normal and abnormal business paths.
- Run at least:

```powershell
pnpm build
pnpm test:coverage
pnpm biome check .
```

- For frontend architecture refactors, also check FSD boundaries:
  - no upward layer imports,
  - no cross-feature imports,
  - no bypassing slice public APIs,
  - `shared` imports no business layers.

## Naming and Types

- Remove types that only rename another type without adding clarity.
- Prefer direct business names such as `SessionProfile` when that is the actual domain concept.
- Use view model types when crossing from business/page logic into widgets.
- Use `index.ts` as public API for FSD slices.
- Do not let historical migration names leak into new code.

