---
name: vyotiq-deep-audit
description: Performs evidence-based deep audits of the Vyotiq codebase across IPC, agent runtime, UI, providers, lifecycle, and quality; synthesizes prioritized findings; fixes P0/P1 in minimal diffs. Use when the user asks for a codebase audit, health check, unwired-feature hunt, leak audit, systematic remediation, or /vyotiq-deep-audit.
---

# Vyotiq Deep Audit

## Mission

Perform a **deep, evidence-based audit** of the entire Vyotiq codebase, then **fix what you find** in focused, reviewable increments. Work thoroughly — do not rush. Every finding must be backed by file paths, code references, or test/build output. No speculation.

**Authoritative context:** Read `AGENTS.md` and `project.md` before any work. Extend existing modules; do not create parallel systems.

## Execution Model: Parallel Audit Streams

Launch **6 parallel explore/audit agents** (read-only first), then **1 synthesis agent**, then **sequential fix passes** by priority. Each stream owns a domain and returns a structured report before any code changes.

| Stream | Scope | Key paths |
|--------|--------|-----------|
| **A — IPC & wiring** | Main ↔ renderer contracts, handlers, stores, persistence | `src/shared/types/ipc.ts`, `src/main/**/ipc*`, Zustand stores |
| **B — Agent runtime** | Harness, orchestrator loop, tools, policy, follow-ups, scheduler | `src/main/harness/`, `src/main/orchestrator/`, `src/main/tools/` |
| **C — UI surfaces** | Dock, timeline, composer, workbench, settings, Shell Mono consistency | `src/renderer/components/`, `src/renderer/index.css` |
| **D — Providers & context** | HTTP providers, model discovery, caching, context budget, vision | `src/main/providers/`, `buildContextLayers.ts`, `contextBudget.ts` |
| **E — Lifecycle & leaks** | Electron lifecycle, listeners, timers, PTY/LSP/watchers, window refs | Main process boot/quit, renderer `useEffect` cleanups |
| **F — Quality & dead code** | Duplications, unused exports, legacy remnants, test gaps | Grep for TODO/stub/unused; `normalizeLegacyTranscript` boundaries |

**Synthesis agent** merges reports, deduplicates findings, assigns P0–P3 priority, and produces a single remediation plan.

For the full audit checklist (6 categories), finding template, and per-stream probes, see [reference.md](reference.md).

## Phased Workflow

### Phase 1 — Report only (parallel streams A–F)

Each stream delivers:

```markdown
## [Stream X] Summary
- P0 (broken / leak / data loss): N items
- P1 (unwired / incomplete user-facing): N items
- P2 (inconsistency / duplication): N items
- P3 (improvement): N items

### Findings
#### [ID] Title
- **Category:** unwired | incomplete | inconsistency | duplication | dead-code | gap | bug | improvement
- **Evidence:** `path:line` or test output
- **Impact:** user-visible | leak | correctness | maintainability
- **Fix:** concrete steps
- **Effort:** S | M | L
```

### Phase 2 — Synthesize

- Deduplicate cross-stream findings
- Order: **P0 → P1 → P2**; batch P3 separately
- Group fixes by file/area to minimize churn

### Phase 3 — Fix (sequential, small batches)

- One logical concern per batch (e.g. "attachment error formatting shared module")
- After each batch: targeted Vitest + build
- Do **not** create git commits unless asked

### Phase 4 — Re-audit touched areas

- Re-run checklist for changed modules
- Confirm no regressions in adjacent surfaces (dock ↔ composer ↔ timeline)

## Non-Negotiable Constraints (apply to every fix)

1. **Real features only** — No placeholder UI, stub IPC handlers, or TODO-only user-facing paths. Wire end-to-end: UI → store → IPC → main → persistence → tests.
2. **Minimal correct diffs** — No AI slop: no over-abstraction, no duplicate modules, no speculative fallbacks.
3. **Zero memory leaks** — Remove IPC/renderer listeners on unmount; clear timers/intervals; null `BrowserWindow` refs on `closed`; stop pollers/watchers/PTY on quit and workspace switch; prefer `invoke`/`handle` over ad-hoc listener pairs.
4. **Preserve Shell Mono** — Do not redesign unrelated surfaces. Reuse `@theme` tokens, `vx-*`, `SurfaceShell`, feature CSS. Match neighboring components.
5. **Never remove existing features** unless explicitly dead legacy (phased execution, etc.) and verified unused.
6. **Modular structure** — One tool per file under `src/main/tools/`; feature folders under `components/`; extend before creating.
7. **Search before creating** — Grep/glob for overlap before new files.
8. **No hardcoded provider capabilities** — Models, context windows, thinking support via discovery APIs (`GET /v1/models`), not assumptions.
9. **Verify every change** — `pnpm vitest <relevant tests>` + `pnpm build` after renderer/CSS changes.

## Explicit Out of Scope (unless user asks)

- Redesigning Shell Mono visual language
- Adding sub-agent / delegation architecture (Agent V is solo)
- Reviving phased execution or reflective autonomy
- Provider SDKs (raw HTTP only)
- `tailwind.config.js` (v4 CSS-first tokens only)
- Cursor-branded UI copy

## Success Criteria

- [ ] Every P0/P1 finding has a fix or a documented blocker with evidence
- [ ] `pnpm build` passes
- [ ] Targeted Vitest suites for changed areas pass
- [ ] No new stub handlers or placeholder UI in user paths
- [ ] Consolidated audit report with before/after file list
- [ ] No feature removals without explicit justification

## Single-Agent Fallback

If parallel agents are unavailable, run one agent with this condensed scope:

> Deep-audit Vyotiq per `AGENTS.md` and `project.md`. Find unwired IPC/UI, incompletions, UI inconsistencies (Shell Mono tokens), duplications, dead code, gaps, bugs, and improvements. Evidence required for every finding. Fix P0/P1 in minimal diffs: real wiring, leak-safe patterns, no slop, no feature removal, no redesign. Run `pnpm vitest` + `pnpm build` per batch. Take as long as needed; do not rush.

Work through streams A–F sequentially, then synthesize and fix as above.
