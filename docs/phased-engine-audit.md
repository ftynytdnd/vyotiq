# Phased Execution Engine — Audit & Hardening

Audit of the existing phased execution engine against the task spec. The engine
already exists and is wired end-to-end; this records spec traceability, concrete
evidence-backed findings (including bugs reproduced from runtime logs), and the
fixes applied during the hardening pass.

Evidence sources:
- Code: `src/main/orchestrator/phased/**`, `src/main/orchestrator/loop/**`, `src/shared/types/phased.ts`, harness `src/main/harness/05-phased-execution.md`.
- Runtime log: `%APPDATA%/vyotiq/vyotiq/logs/vyotiq.log` (run on 2026-06-17).
- Conversation transcript: `conversations/da20f22d-…jsonl`.

## Spec traceability matrix

| Spec requirement | Status | Where |
| --- | --- | --- |
| 1. Phase state machine (per-subtask, ordered) | Present | `EXECUTION_PHASES` (`src/shared/types/phased.ts`), `PhaseEngine` |
| 2. Phase contracts + exit gates | Present | `gateValidators.ts` (`parsePhaseGateArgs`, `exitCriteriaForPhase`), `toolAllowlist.ts` |
| 3. Failure router (typed classification → target phase) | Present | `diagnoseRouter.ts` (`routeDiagnoseTarget`) |
| 4. Persistent decision/state ledger (survives restart) | Present, completeness gaps | event-sourced `phase-ledger-entry`/`phase-gate` + `reconstructFromTranscript.ts` |
| 5. Termination guards (cap, no-progress, budget, escape hatch) | Present, one guard inert | `terminationGuards.ts`, `phasedEscape.ts`, `phasedEscapePause.ts` |
| 6. Checkpoint integration (reuse existing system) | Present | `checkpointMarker.ts` over `src/main/checkpoints/**` |
| 7. UI/observability (phases, gates, ledger) | Present | `PhaseLogRow.tsx`, `PhaseLedgerRow.tsx`, `deriveRows.ts` |
| Tests | Present, gaps | `tests/main/orchestrator/phased/**` (11 files) |
| Harness/docs | Present, drift | `05-phased-execution.md`, `phase_gate.tool.ts` |

## Findings

### H1 — `phase_gate` tool-call/result orphaning (HIGH, reproduced)
The assistant history message in the loop lists only `actionTools` in `tool_calls`
(`src/main/orchestrator/loop/runLoop.ts` ~1065–1090). `interceptPhaseGate` then
inserts a `role:'tool'` result for the phase_gate call id. Because the assistant
message never lists that id, the tool result is an orphan and `sanitizeToolPairing`
drops it on the next iteration — **every phased turn**.

Reproduced in `vyotiq.log` (dozens of entries):
`dropping orphan role:tool message — no matching assistant.tool_calls[].id` with
`tool_call_id: functions.phase_gate:0` (and `:1`).

Secondary defect: when the model emits multiple `phase_gate` calls in one turn,
the 2nd+ fall through to `actionTools` and execute the intercept-only stub
(`interceptOnlyTool.run` returns `ok:false` "this handler must not run"), producing
a confusing internal-error tool result.

Effect: the model loses gate pass/loop-back feedback from the tool channel,
wasted tokens, log-noise flood.

Fix: include the processed `phase_gate` call in the assistant `tool_calls`;
collect all `phase_gate` calls when phased is active, process the first through the
engine, and settle extras with a paired "one gate per turn" result; when phased is
inactive route a stray `phase_gate` through normal handling so it is still paired.

### M1 — Soft global-iteration escape hatch is effectively dead (MEDIUM)
`phasedExecutionSettings.maxIterations` defaults to `MAX_TOTAL_ITERATIONS` (24) and is
clamped to ≤24; the guard trips at `globalIteration >= min(cap, 24)`, i.e. the same
iteration as the loop's hard synthesis fallback. So the `global_iteration_cap`
escape-hatch path almost never surfaces to the human before the run is force-synthesized.

Fix: trip the soft cap a fixed margin below the hard ceiling so the human escape
hatch surfaces first. Apply the margin consistently in `createTerminationGuardState`
and the reconstruct path.

### M2 — Ledger queryability/completeness gaps (MEDIUM)
`intake` and `plan` artifacts emit empty structured ledger fields
(`ledgerFieldsForArtifact` in `phaseEngine.ts`); their `doneCriteria`,
`acceptanceCommands`, and plan `steps` are only embedded inside the `artifactSummary`
JSON string, so they are not queryable/inspectable as structured fields.

Fix: add structured `doneCriteria`, `acceptanceCommandCount`, and `planSteps` to the
`phase-ledger-entry` event and populate them for intake/plan; render them in
`PhaseLedgerRow`.

Note on gate decisions: the spec lists `gateDecision` per ledger entry. Gate
decisions are already recorded first-class as paired `phase-gate` events keyed by the
same `(runId, subtaskId, seq, phase)` as ledger entries (and surfaced in the UI +
reconstruction). They are kept as their own event kind rather than duplicated onto
each artifact entry, to avoid data duplication while remaining fully traceable.

### M3 — `diagnose` ledger semantics (MEDIUM)
`ledgerFieldsForArtifact` maps `attemptedApproaches[].approach = artifact.targetPhase`
— the "approach" is recorded as a phase name, which is misleading in the inspector.

Fix: record the failed approach as the classification + the phase being left, with
`whyFailed` = evidence.

### L1 — Dead/inert code (LOW)
- `PhaseEngine.getToolAllowlist()` has a redundant `if (currentPhase === 'done')`
  branch identical to the general path.
- `passGate`'s `_ledgerId` parameter is unused.

Fix: remove both.

### L2 — NL/code consistency drift (LOW)
The harness does not state that the engine derives `diagnose.targetPhase` from the
classification (it overrides the model's value), nor the hard validator requirements
(intake needs ≥1 acceptance command; every understand fact needs a code link;
understand/rethink require empty open-risk arrays; reflect requires lessons). This
caused observed wasted turns (e.g. a `bash` allowlist refusal during a read-only phase
in `vyotiq.log`).

Fix: align `05-phased-execution.md` and the `phase_gate` tool brief.

### Adjacent sweep (no action)
- No duplicate/case-conflict tracked files — `git status` lists each file once; the
  initial snapshot's double entries were a forward/backslash display artifact.
- UI/observability for phases/gates/ledger is complete (target phase + cited ledger id
  shown on gate badges; ledger rows render decisions, attempted approaches, constraints,
  assumptions, code links, checkpoint ref). No change required beyond M2 additions.
- `verifyRunner` runs each acceptance command with the full per-command timeout; the
  separate wall-clock guard bounds total run time. Behaviour is intentional; no change.

## Fix summary (applied)

| ID | Change |
| --- | --- |
| H1 | Pair `phase_gate` tool results; handle multi-gate turns |
| M1 | Soft iteration-cap margin below hard ceiling |
| M2 | Structured intake/plan ledger fields + UI |
| M3 | Correct diagnose attempted-approach semantics |
| L1 | Remove dead branch + unused param |
| L2 | Harness + tool-brief alignment |

## Reference: phases, gates, ledger schema, config knobs

### Phases (per subtask)
`intake → understand → think_frame → plan → rethink → checkpoint → execute →
verify → reflect → done`, with `diagnose` as the failure-router target.
Source of truth: `EXECUTION_PHASES` in `src/shared/types/phased.ts`;
ordering in `nextPhaseAfter` (`gateValidators.ts`).

### Gates
Each phase has a structural exit gate enforced by `parsePhaseGateArgs` +
`exitCriteriaForPhase` (`gateValidators.ts`). The engine refuses to advance until
the artifact validates; gate outcomes are emitted as `phase-gate` events
(`passed | looped_back | blocked`) carrying the durable `engineState`.

### Failure router
`diagnose.classification` → target phase via `routeDiagnoseTarget`
(`diagnoseRouter.ts`): `wrong_facts→understand`, `wrong_approach→think_frame`,
`bad_implementation→execute` (rolls back to last checkpoint marker),
`test_failure→verify`, `blocked_environment→understand`.

### Ledger schema (event-sourced, `phase-ledger-entry` in `src/shared/types/chat.ts`)
`runId`, `subtaskId`, `seq`, `phase`, `exitCriteria`, plus optional structured
fields populated per artifact: `decisions[]` (decision + rationale incl. rejected
alternatives), `assumptions[]`, `discoveredConstraints[]`,
`attemptedApproaches[]` (approach + whyFailed), `codeLinks[]`, `checkpointRef`,
`doneCriteria[]`, `acceptanceCommandCount`, `planSteps[]`, `modeDecision`,
`artifactSummary` (bounded JSON). Gate decisions are recorded as paired
`phase-gate` events keyed to the same `(runId, subtaskId, seq, phase)`. The whole
ledger is reconstructable after a process restart via
`reconstructFromTranscript.ts` (the latest `phase-gate.engineState` is the exact
snapshot; a legacy fallback approximates from individual events).

### Config knobs (`settings.ui.phasedExecution`, resolved in `phasedExecutionSettings.ts`)
- `mode`: `auto | always | never` (auto-classifies multi-step prompts).
- `phaseCycleCap`: per-subtask loop-back convergence guard (2–64, default 8).
- `maxIterations`: soft global-iteration cap (2–`MAX_TOTAL_ITERATIONS`); the
  effective trip point is clamped `PHASED_SOFT_ITERATION_MARGIN` below the hard
  ceiling so the escape hatch surfaces before forced synthesis.
- `verifyTimeoutSeconds`: per-acceptance-command timeout in VERIFY (10–600s).

## Tests added/confirmed
- Gate predicates per phase (`gateValidators.test.ts`).
- Diagnose router classification (`diagnoseRouter.test.ts`).
- Termination guards: cap hit + no-progress escalation + soft-margin (`terminationGuards.test.ts`).
- Ledger reconstruction across restart (`reconstructFromTranscript.test.ts`).
- Full INTAKE→DONE run and a forced loop-back (`phaseEngine.e2e.test.ts`).
- phase_gate pairing regression (new): a processed gate leaves no orphan tool result.
