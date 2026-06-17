# Phased execution engine

Vyotiq can run Agent V through an explicit **per-subtask state machine** instead of a flat iteration loop. The engine lives under `src/main/orchestrator/phased/` and is wired into `runLoop.ts`. It implements a gated state machine with a typed failure-router, an append-only decision/state ledger, termination guards, a human escape hatch, and checkpoint integration.

## Phases

Ordered cycle per subtask:

`INTAKE → UNDERSTAND → THINK/FRAME → PLAN → RETHINK → CHECKPOINT → EXECUTE → VERIFY → REFLECT → (next subtask | DONE)`

On failure: `DIAGNOSE` emits a typed classification and **jumps** directly to the target phase (no full rewind).

Each phase declares inputs, produces an artifact (submitted via `phase_gate`), and has an exit gate the host enforces. The engine refuses to advance until the gate passes, and records the decision.

### Phase contracts

| Phase | Artifact (`phase_gate`) | Exit gate |
|-------|-------------------------|-----------|
| Intake | `goalRestatement`, `doneCriteria[]`, `acceptanceCommands[]` | Tests + criteria declared up front |
| Understand | `facts[]` with `codeLinks`, `openAmbiguities` | No open ambiguity (else loops back here) |
| Think/Frame | `chosenApproach`, `rejectedAlternatives[]`, `hypotheses`, `constraints` | Approach + rejected alternatives recorded |
| Plan | `steps[]` (`doneCriterionId` + `verificationMethod`) | Every step maps to a criterion (else → Intake) |
| Rethink | `riskiestAssumption`, `attackNotes`, `unaddressedHighRisks` | No unaddressed high-risk assumptions |
| Checkpoint | `{ ready: true }` | Host records a manifest-head restore marker |
| Execute | `incrementSummary`, `codeLinks`, `selfConsistent: true` | Increment complete and self-consistent |
| Verify | `validationNotes`, `supplementalChecksPass: true` | **Host** runs `acceptanceCommands`; exit code 0 required |
| Diagnose | `classification`, `targetPhase`, `evidence`, `citeLedgerEntryId` | Typed route + a **real** cited ledger entry |
| Reflect | `lessons[]`, `remainingSteps[]` | Lessons recorded; remaining work re-derived |

## Failure router

`DIAGNOSE` maps a classification to a precise target phase (`diagnoseRouter.ts`):

| Classification | Target |
|----------------|--------|
| `wrong_facts` | Understand |
| `wrong_approach` | Think/Frame |
| `bad_implementation` | Execute (rolls back to last checkpoint) |
| `test_failure` | Verify |
| `blocked_environment` | Understand |

Every loop-back must set `citeLedgerEntryId` to a **real** prior ledger entry id (surfaced in `<phase_state>` as `recent_ledger_entry_ids`). A citation matching no recorded entry is rejected and returned to the agent — traceable to evidence, not memory.

## Settings

**Settings → Agent behavior → Phased execution** (`settings.ui.phasedExecution`)

| Knob | Default | Meaning |
|------|---------|---------|
| `mode` | `auto` | `auto` classifies prompts; `always` forces phased mode; `never` uses the legacy loop |
| `phaseCycleCap` | `8` | Soft per-subtask convergence guard (2–64) |
| `maxIterations` | `24` | Soft global-iteration cap that surfaces the escape hatch (2 – hard ceiling) |
| `verifyTimeoutSeconds` | `120` | Per-command timeout for host acceptance tests during VERIFY (10–600) |

Global `MAX_TOTAL_ITERATIONS` (24) remains the absolute hard ceiling; `maxIterations` is clamped to it.

## Enforcement (hybrid)

- **Host hard gates:** per-phase tool allowlists (`toolAllowlist.ts`), checkpoint manifest-head marker, host-run acceptance-command exit codes, termination guards.
- **Agent semantic artifacts:** `phase_gate` tool — host validates JSON schema + structural invariants only, never subjective quality.
- **Blocked gates** return to the agent for in-phase self-correction; run-level escalation to the human is owned by the termination guards.

## Termination guards & escape hatch

`terminationGuards.ts` trips on: per-subtask phase-cycle cap, soft global-iteration cap, a **no-progress detector** (same stable failure signature twice), and token/wall-clock budgets. A trip pauses the run with a structured `ask_user` (`source: 'phased-escape'`) offering:

| Choice | Effect on resume |
|--------|------------------|
| Supply info | Resume at the current phase with the new context; counters cleared |
| Approve approach | Clear no-progress / cycle counters and continue |
| Rollback | Restore the last checkpoint marker, resume at EXECUTE |
| Abort | Finalize the run cleanly; no further iterations |

Resolution is applied in `phasedEscapeResolve.ts` before the loop resumes; a global-iteration-cap trip also grants a bounded iteration bonus.

## Ledger (event-sourced, durable)

The ledger **is** the append-only sequence of **TimelineEvent**s persisted in conversation JSONL:

- `phase-gate` — `exitCriteria`, `gateDecision` (`passed` | `looped_back` | `blocked`), optional `acceptanceEvidence`, and a durable `engineState` snapshot.
- `phase-ledger-entry` — `discoveredConstraints`, `assumptions`, `decisions` + rationale (incl. rejected alternatives), `attemptedApproaches` + why they failed, `codeLinks`, `checkpointRef`, mode promote/demote.

Each carries `runId`, `subtaskId`, a monotonic `seq`, and a stable `id` for loop-back citations.

### Cold-resume / crash recovery

Each `phase-gate` embeds a bounded `engineState` (acceptance output truncated to `VERIFY_EVIDENCE_PERSIST_CHARS`). On resume the engine is rebuilt in priority order: in-memory pause snapshot → exact reconstruction from the latest persisted `engineState` (`reconstructFromTranscript.ts`, survives a process restart) → fresh engine. No-progress counters and current phase are restored exactly.

## Checkpoint integration

At **CHECKPOINT**, the host records the run manifest head (`lastEntryId` + `entryCount`) — including `entryCount: 0` when no edits exist yet. On **Diagnose → Execute** (or a rollback escape), `revertEntriesAfterMarker` rolls back manifest entries appended after that marker. Reuses the existing checkpoint system in `src/main/checkpoints/` — no parallel store.

## UI / observability

- `<phase_state>` runtime envelope exposes the active subtask, phase, guard counters, done-criteria, remaining plan steps, subtask roster, and recent ledger ids.
- `phase` rows → `PhaseLogRow` with gate badges; click a badge to expand the full reason, loop-back target, cited entry, and host acceptance evidence.
- `phase-ledger-entry` → collapsible `PhaseLedgerRow` inspector (decisions + rationale, constraints, assumptions, attempted approaches, code links, checkpoint ref).

## Harness

`05-phased-execution.md` is the phased contract. It is injected into the system prompt only when phased mode is active (cache-friendly dual prompt keys in `harnessLoader.ts`) and is **user-overridable** via Settings → Harness like sections 00–04.

## Tests

- `tests/main/orchestrator/phased/` — gate validators, diagnose router, termination guards, mode classifier, tool allowlist, `phase_gate` intercept, escape resolution, `<phase_state>` builder, transcript reconstruction, and an end-to-end INTAKE→DONE run plus a forced loop-back with rollback and cite enforcement.
- `tests/shared/settings/phasedExecutionSettings.test.ts` — config knob resolution / clamping.
- `tests/renderer/timeline/deriveRows.phaseLedger.test.ts` — timeline row derivation incl. structured ledger fields and acceptance-evidence folding.
- `tests/main/harness/harnessLoader.test.ts` — conditional phased contract injection.
