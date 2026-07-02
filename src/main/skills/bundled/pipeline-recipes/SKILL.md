---
name: pipeline-recipes
description: Repeatable long-horizon workflow recipes — scheduled runs, heartbeat, skills, and todos for hands-off pipelines without sub-agents.
---

# Pipeline Recipes — Long-Horizon Solo-Agent Workflows

Vyotiq is a **single agent** — no sub-agents or delegation. Long-running or
recurring work uses one conversation with structured tools: **`todos`** for the
plan, **`heartbeat`** for external idle gaps, **Settings → Scheduled runs** for
cron-style enqueue, and **`context`** to load skills on demand.

## Recipe A — Multi-hour task with external waits (PR / CI)

Use when work spans implement → push → wait for CI/review → fix.

1. **Plan** — `todos` with nested phases (`parentId` sub-tasks). Mark the active
   sub-task `in_progress`; one at a time.
2. **Implement segment** — edit, test, audit in-loop (`continue`); do not `finish`
   between implement and verify cycles.
3. **External idle** — attach heartbeat before waiting on CI or review:

```json
{ "name": "heartbeat", "arguments": { "action": "attach", "intervalMinutes": 7 } }
```

4. **On each wake** — read `<run_progress>`, check git/CI, update `todos`, continue
   or fix; do not repeat completed steps.
5. **Segment close** — `finish` with summary when a segment is done but more work
   remains later; keep heartbeat attached if another idle gap is expected.
6. **Final close** — detach heartbeat, then `finish`:

```json
{ "name": "heartbeat", "arguments": { "action": "detach" } }
```

## Recipe B — Scheduled recurring check (nightly lint, weekly audit)

Use when the user wants the same prompt on a schedule.

1. Confirm schedule in **Settings → Scheduled runs** (user-facing UI) — the host
   enqueues into the conversation's queued follow-up lane when busy.
2. Keep the prompt **self-contained**: restate goal, scope, and success criteria.
3. Start each run with `todos` (replace plan) so `<run_progress>` survives compaction.
4. Load `review-checklist` before `finish` on audit-style schedules.
5. Prefer timeline summary + optional `report` for tabular findings.

## Recipe C — Hands-off fix loop until green

Use when the user wants "keep going until tests pass" within one run.

1. Nested `todos`: phase = outcome, children = concrete steps (read → fix → test).
2. Stay in the same run — `continue` after each test failure; no `finish` until green.
3. Do **not** attach heartbeat for in-run test/fix cycles (heartbeat is for **external**
   idle only).
4. Before final `finish`, load `review-checklist` and run the verification pass.

## Anti-patterns

- Do not spawn sub-agents or parallel "reviewer" personas — audit your own output.
- Do not attach heartbeat for every edit; use it only when waiting on external time.
- Do not flatten multi-phase work to a single-level todo list — nest sub-tasks.
- Do not guess through architectural forks — `ask_user` (max 3 questions per call).

## Skills to load per step

| Step | Skill |
|------|-------|
| ast-grep refactors | `ast-grep-reference` |
| Large HTML output | `deliverables` |
| Tool-call shape | `static-examples` |
| Before finish | `review-checklist` |
