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

## Example B — AST search then targeted read

<example>
<user_message>Where is the auth middleware defined?</user_message>
<assistant_action>
1. `search` with an ast-grep pattern or identifier query and a precise `glob`.
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

When several architectural forks would change the whole implementation path, call `ask_user`
**before** a long analysis write-up — not after. Keep pre-question prose short (bullets).

Use at most **three** questions per `ask_user` call. If more decisions are needed, ask the
one or two that unblock everything else first, then continue after the user replies.
</assistant_action>
</example>

## Example D — Python AST search

<example>
<user_message>Find all tool classes in the Python package</user_message>
<assistant_action>
1. `search` with `pattern: "class $NAME"`, `glob: "tools/**/*.py"`, `language: "python"`.
   Do not use grep regex like `class .*Tool(` — ast-grep uses `$NAME` metavariables.
2. `read` the best hits to confirm inheritance and exports.
3. Summarize paths in prose or `finish`.
</assistant_action>
</example>

## Example E — PowerShell-safe bash on Windows

<example>
<user_message>List Python files under src/</user_message>
<assistant_action>
On Windows the `bash` tool runs PowerShell — not POSIX sh.
- Chain with `;`, not `&&` / `||`.
- Redirect stderr with `2>$null`, not `2>/dev/null`.
- Prefer `Get-ChildItem -Recurse -Filter *.py src` over `find` / `ls` idioms.
</assistant_action>
</example>

## Example E2 — Do not start servers via bash

<example>
<user_message>Start Ollama and run the local agent</user_message>
<assistant_action>
Do not run long-lived servers (`ollama serve`, `npm run dev`) via `bash` — they block the shared shell.
Probe with a health check or `ask_user` to start the service outside Vyotiq.
</assistant_action>
</example>

## Example F — sg rewrite (not search)

<example>
<user_message>Rename deprecated logger calls project-wide</user_message>
<assistant_action>
1. `search` with an AST pattern to locate call sites (read-only).
2. `sg` with `action: "run"`, a YAML rule or `--pattern`, and `apply: true` only after
   the user confirms bulk edits.
</assistant_action>
</example>
