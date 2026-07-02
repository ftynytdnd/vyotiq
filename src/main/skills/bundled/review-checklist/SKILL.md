---
name: review-checklist
description: Structured self-audit rubric before finish — unsourced claims, test evidence, goal fit, constraint checklist. Load before finishing multi-step or publishable work.
---

# Review Checklist — Self-Audit Before Finish

Load this skill with the `context` tool when you are about to call `finish` on
multi-step work, user-facing copy, audits, or any deliverable where quality
matters more than speed. You remain the sole agent — this is a rubric, not a
second reviewer runtime.

## When to use

- After substantive `edit` / `delete` rounds without a test or build run yet
- Before publishing marketing copy, docs, reports, or factual summaries
- When the user asked for verification, a review, or "no AI slop"
- After 3+ implementation steps in `<run_progress>`

## Audit procedure

Work through each section. If any item fails, fix in-loop (`continue`) — do not
`finish` until resolved or you escalate with `ask_user`.

### 1. Goal fit

- [ ] Re-read `<goal_anchor>` and the original `<user_message>`
- [ ] List what was asked vs what you delivered — gaps named explicitly
- [ ] Scope creep removed or called out to the user

### 2. Evidence & sources

- [ ] Every factual claim is backed by tool output you read this run (file
  ```
  contents, test results, `search` hits) — not memory or assumption
  ```
- [ ] Unsourced claims flagged and either sourced or removed
- [ ] Numbers, paths, and API names verified against workspace files

### 3. Implementation quality (code tasks)

- [ ] Re-read every file you changed (`read` after last `edit`)
- [ ] Run relevant tests or build (`bash`) — capture pass/fail in prose
- [ ] No debug leftovers, commented-out blocks, or placeholder TODOs unless
  ```
  the user asked for them
  ```

### 4. Constraint checklist

- [ ] Prime Directives respected (no bash file writes, workspace scope, no
  ```
  secret exfiltration)
  ```
- [ ] User preferences in `<meta_rules>` honored
- [ ] Deliverable format correct (timeline Markdown vs `report` HTML per
  ```
  `deliverables` skill if applicable)
  ```

### 5. User-visible answer

- [ ] Final summary states what changed, how it was verified, and what remains
- [ ] No internal reasoning leaked as the answer
- [ ] `finish` summary or implicit prose is complete — not a teaser

## After the audit

- **Pass** — call `finish` with a summary that cites verification steps
- **Fail** — `continue` with the specific fix; re-run this checklist before
the next `finish`
- **Blocked** — `ask_user` with one focused question (max 3 per call)

