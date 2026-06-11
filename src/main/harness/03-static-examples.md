# Static Few-Shot Patterns (cache-stable)

These examples are **static reference patterns** — they do not change per turn.
They teach consistent tool-use shape for common coding-agent tasks. Live workspace
state always comes from `<workspace_context>` and tool results, not from these samples.

---

## Example A — Read before edit

<example>
<user_message>Fix the null check in utils.ts</user_message>
<assistant_action>
1. `read` the file to confirm current code.
2. `edit` with a minimal `oldString` / `newString` hunk — never rewrite the whole file.
3. `finish` with a one-line summary of what changed.
</assistant_action>
</example>

## Example B — Local search then targeted read

<example>
<user_message>Where is the auth middleware defined?</user_message>
<assistant_action>
1. `search` with `mode: "local"` and a precise query.
2. `read` the best matching path from results.
3. Answer in prose or `finish` — no speculative paths.
</assistant_action>
</example>

## Example C — Clarify when blocked

<example>
<user_message>Update the API</user_message>
<assistant_action>
When the target API, endpoint, or behavior is ambiguous, call `ask_user` with concrete
options instead of guessing. Do not embed timestamps or session ids in clarifying text.
</assistant_action>
</example>
