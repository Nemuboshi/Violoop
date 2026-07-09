---
name: violoop-prompt-profile-guide
description: Interview a user and suggest Violoop global system prompt text plus new-chat session role settings. Use when asked to design, tune, review, or recommend Violoop system prompts, assistant display names, user roles, assistant roles, or session profile settings without directly changing configuration files.
---

# Violoop Prompt Profile Guide

Use this skill to help a user design Violoop prompt and role settings. Do not modify files, save config, or run mutation commands. Provide recommendations only.

## Scope

Violoop has two prompt-related layers:

- Global chat settings: `chat.systemPrompt` in `settings.json`.
- Per-session profile chosen in the new chat modal:
  - `assistantName`
  - `userRole`
  - `assistantRole`

The global system prompt should describe durable behavior for all sessions. Session roles should describe the specific scene, relationship, task framing, and display name for one chat.

## Interview First

Ask concise questions before writing recommendations unless the user already gave enough detail.

Start with these questions:

1. What should Violoop optimize for: practical help, roleplay, coaching, emotional support, planning, coding, writing, or something else?
2. What tone should it avoid?
3. Should Violoop be proactive, mostly reactive, or only act when asked?
4. What should the user role be in this session?
5. What should the assistant role be in this session?
6. What name should Violoop use in this session?

If the user wants a faster path, ask only the first three questions and infer the rest.

## Recommendation Rules

For `systemPrompt`:

- Keep it durable and reusable across sessions.
- State behavior rules, not session-specific lore.
- Include response style, clarification behavior, boundaries, and priority order.
- Avoid bloated prompts. Prefer 4-8 short sentences or compact bullets.
- Do not duplicate tactics. Tactics handle situational behavior; system prompt handles baseline behavior.

For `assistantName`:

- Use the display name the user wants Violoop to have in this session.
- Keep it short and readable.

For `userRole`:

- Describe the user's role, constraints, and expected relationship to the assistant.
- Avoid pretending to know private facts not provided by the user.

For `assistantRole`:

- Describe the assistant's session-specific role, not global policy.
- Make the role actionable: what the assistant should notice, prioritize, and avoid.

## Output Format

Return recommendations in this structure:

```text
Recommended system prompt:
...

Recommended session profile:
assistantName: ...
userRole: ...
assistantRole: ...

Why:
...

Optional variants:
...
```

Do not write the recommendations into `settings.json`, `states.json`, `tactics.json`, or any other project file unless the user separately asks for implementation.

## Quality Checks

Before finalizing:

- Ensure the system prompt does not contain session-only roleplay details.
- Ensure roles do not conflict with the system prompt.
- Ensure the recommendation is easy for a user to paste into the UI.
- If the user wants multiple modes, suggest separate session profiles instead of one overloaded prompt.
