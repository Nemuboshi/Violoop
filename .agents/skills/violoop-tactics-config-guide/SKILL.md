---
name: violoop-tactics-config-guide
description: Guide another LLM working in the Violoop repo to understand and propose valid status/state and tactics configuration. Use when asked to create, review, extend, or advise on Violoop states/status bars, tactics, tactic trigger rules, tactic JSON, states.json, tactics.json, seed data, or the relationship between session state and tactics.
---

# Violoop Tactics Config Guide

Use this skill to guide configuration work for Violoop's session state and tactics system. Prefer recommendations and JSON snippets that can be appended to existing data over destructive rewrites.

## Locate Data

1. Browser seed defaults live under `public/default-data/` (`settings.json`, `tactics.json`, `states.json`) and are loaded into IndexedDB by `ensureLocalSeed`.
2. Runtime user data (config, tactics, states, conversations) lives in IndexedDB (`violoop` database), not disk JSONL.
3. Export/import JSON from the Configuration modal is the backup path for tactics/states libraries and conversations.
4. Editing recommendations should target shapes valid for IndexedDB / export JSON, matching `src/shared` types and Zod schemas.

## Current Model

States are global definitions. A new chat chooses which global states are enabled for that session. User state values are session-scoped runtime data, not global configuration.

Tactics are a global library. A new chat chooses which tactics are allowed for that session. Allowed tactics are locked after the session starts.

At new chat time, Violoop checks that the selected tactics only depend on selected states. A tactic depends on every state key used in its `emotionRules`.

At generation time, Violoop scores only tactics allowed in the session. A tactic can trigger from keywords and state rules. If more than five tactics match, Violoop randomly injects five.

## JSON Shapes

`states.json` is an array:

```json
{
	"id": "stress",
	"name": "Stress",
	"description": "How much pressure or irritation the user appears to feel.",
	"defaultValue": 20
}
```

`tactics.json` is an array:

```json
{
	"id": "recover-after-correction",
	"name": "Recover after correction",
	"keywords": ["不是", "不对", "wrong"],
	"emotionRules": [{ "key": "stress", "operator": ">=", "value": 55 }],
	"blockedKeywords": ["新问题", "unrelated"],
	"instruction": "Treat the latest user correction as authoritative.\nRebase immediately.\nDo not defend the previous interpretation."
}
```

Rules:

- IDs and emotion rule keys must match `^[a-z0-9][a-z0-9-]{1,80}$`.
- Use kebab-case IDs such as `detail-tolerance`, never snake_case.
- `defaultValue` and emotion rule `value` are numbers from 0 to 100.
- `operator` is only `>=` or `<=`.
- `instruction` is plain text. Use newlines for separate behavioral requirements.
- `blockedKeywords` suppress a tactic when they appear in the user message.
- Keep user-facing names concise. Do not expose IDs as the primary authoring concern.

## Generation Guidance

When asked to propose new status/state definitions:

- Create broad, reusable states rather than one-off labels.
- Prefer 3-6 states for a coherent set.
- Make values interpretable from low to high without needing separate low/high labels.
- Avoid overlapping states that measure the same thing.
- Make descriptions about observable conversation behavior, not diagnosis.

When asked to propose tactics:

- Add tactics that change answer behavior, not personality decoration.
- Keep each tactic focused on one intervention.
- Use keywords as hints, not the only trigger.
- Include emotion rules only when the tactic truly depends on a session state.
- Make `instruction` operational: tell the assistant what to do and what to avoid.
- Keep instructions subordinate to system/developer instructions and the user's explicit request.

When producing JSON:

- Prefer append-only snippets: show new objects to add to the arrays.
- Do not delete existing entries unless the user explicitly asks for cleanup.
- If editing existing data, identify the exact existing IDs affected.
- Warn if a tactic references a state that does not exist in `states.json`.
- Warn if adding a new state requires users to select it in new chat for dependent tactics to be valid.

## Recommended Output

For a config proposal, return:

1. Short rationale.
2. `states.json` additions, if any.
3. `tactics.json` additions, if any.
4. Dependency notes: which tactics require which states.
5. Validation notes: ID format, duplicate IDs, and whether browser seed / IndexedDB already has conflicting entries.
