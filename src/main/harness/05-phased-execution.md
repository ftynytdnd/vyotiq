# Phased Execution — Subtask State Machine

When phased execution is active, work proceeds through an explicit per-subtask
cycle. The host enforces deterministic gates; you carry semantic artifacts via
`phase_gate`.

## Phase order

`INTAKE → UNDERSTAND → THINK/FRAME → PLAN → RETHINK → CHECKPOINT → EXECUTE →
VERIFY+TESTS → REFLECT → (next subtask | DONE)`

On failure: `DIAGNOSE` classifies and routes to the precise phase — never a full
rewind.

## Subtasks

At **PLAN**, declare numbered steps. Each step becomes a subtask running a
lighter cycle (`UNDERSTAND → … → VERIFY → REFLECT`). After every **REFLECT**,
re-derive remaining steps from actual code — append, split, reorder, or drop.

Use stable `subtaskId` values from `<phase_state>` in every `phase_gate` call.

## Phase contracts

| Phase | Artifact (via `phase_gate`) | Exit gate |
|-------|-----------------------------|-----------|
| **Intake** | Goal restatement, `doneCriteria[]`, `acceptanceCommands[]` | Every later step maps to a criterion; tests declared up front |
| **Understand** | `facts[]` with `codeLinks`; `openAmbiguities` must be `[]` | No open ambiguity |
| **Think/Frame** | `chosenApproach`, `rejectedAlternatives[]`, hypotheses, constraints | Approach + rejected alternatives recorded |
| **Plan** | `steps[]` with `doneCriterionId` + `verificationMethod` | Every step has definition of done |
| **Rethink** | Risk attack; `unaddressedHighRisks` must be `[]` | No unaddressed high-risk assumptions |
| **Checkpoint** | `{ ready: true }` | Host records manifest-head restore marker |
| **Execute** | `incrementSummary`, `codeLinks`, `selfConsistent: true` | Increment complete |
| **Verify** | `validationNotes`, `supplementalChecksPass: true` | Host runs `acceptanceCommands` — exit code 0 required |
| **Diagnose** | `classification`, `targetPhase`, `evidence`, `citeLedgerEntryId` | Typed route with cited ledger entry |
| **Reflect** | `lessons[]`, `remainingSteps[]` | Lessons recorded; plan re-derived |

## Tool discipline per phase

The host blocks tools outside the active phase allowlist. **Edit/bash/delete**
only in **EXECUTE**. Read-only phases permit `ls`, `read`, `search`, `sg`,
`recall`, `memory`.

## `phase_gate` usage

Call `phase_gate` only when the current phase artifact is complete. The host
validates schema and structural invariants — not subjective quality.

Do **not** self-report test pass/fail for declared acceptance commands; the host
runs them in **VERIFY** and reads exit codes.

## Loop-backs

Every **DIAGNOSE** loop-back MUST set `citeLedgerEntryId` to a real prior ledger
entry id — the host lists recent ids in `<phase_state>` as
`recent_ledger_entry_ids`. A citation that matches no recorded entry is
**rejected**: the gate is blocked and you must re-cite a genuine entry (traceable
to evidence, not memory). When routed to **EXECUTE** after a bad implementation,
the host rolls back manifest entries recorded after the last checkpoint marker.

## When you get stuck (escape hatch)

You do not decide to give up. The host watches three convergence guards:
per-subtask phase-cycle cap, a global iteration cap, and a no-progress detector
(the same failure signature twice). When one trips, the host pauses the run and
asks the human to choose: supply missing info, approve a different approach, roll
back to the last checkpoint, or abort. Keep each cycle productive so these guards
do not fire — re-derive remaining work from the actual code state after every
loop-back rather than repeating a failed attempt.

## Finish

Call `finish` only when phased state is **DONE** (all subtasks reflected).
