# Agent V Loop & Harness — End-to-End Audit

Last verified: 2026-06-11. Remediations from this audit landed in the same pass.

Related docs: [`prompt-caching-audit.md`](prompt-caching-audit.md), [`context-compaction-design.md`](context-compaction-design.md), [`audit-inventory.md`](audit-inventory.md), [`project.md`](../project.md).

## Scope

Traces one user send from renderer → main IPC → `AgentV.startRun` → `runOrchestratorLoop` → provider stream → tool dispatch → terminal settlement → JSONL persistence → timeline replay.

## E2E flow

```mermaid
sequenceDiagram
  participant Composer as Composer_UI
  participant Store as useChatStore
  participant IPC as chat_ipc
  participant AV as AgentV
  participant Loop as runOrchestratorLoop
  participant Ctx as applyCacheLayers
  participant LLM as streamChat
  participant Tools as handleToolCalls

  Composer->>Store: send(runId, prompt, model)
  Store->>IPC: CHAT_SEND
  IPC->>IPC: supersede prior run, readTranscript
  IPC->>AV: startRun(emit, onDone, onError, onAwaitingUser)
  AV->>AV: buildInitialMessages + seedCacheLayeredMessages
  loop Each iteration up to 24
    Loop->>Ctx: refreshEnvelopes + applyCacheLayers
    Loop->>LLM: buildOrchestratorRequest + handleAssistantTurn
    LLM-->>Loop: text / reasoning / tool_calls
    alt finish or implicit prose
      Loop-->>AV: return terminal
    else ask_user
      Loop-->>AV: pausedForAskUser checkpoint
    else action tools
      Loop->>Tools: handleToolCalls(AGENT_TOOLS)
      Tools-->>Loop: tool results in history
    end
  end
  AV->>IPC: onDone / onError / onAwaitingUser
  IPC->>Store: CHAT_DONE / CHAT_ERROR / CHAT_AWAITING_USER
```

### Key files

| Layer | Files |
|-------|-------|
| IPC / durability | `src/main/ipc/chat.ipc.ts`, `runSettlement.ts`, `conversationStore.ts` |
| Lifecycle | `src/main/orchestrator/AgentV.ts`, `pausedRunRegistry.ts` |
| Loop | `src/main/orchestrator/loop/runLoop.ts`, `handleToolCalls.ts`, `handleAssistantTurn.ts` |
| Harness | `src/main/harness/*.md`, `harnessLoader.ts` |
| Context | `buildContextLayers.ts`, `contextManager.ts`, `contextCompaction.ts` |
| Renderer | `chatChannel.ts`, `useChatStore.ts`, timeline reducer |

## Harness composition

| File | Role | Cache slot |
|------|------|------------|
| `00-orchestrator-core.md` | Prime Directives §1–8 | `[0]` system |
| `01-context-learning.md` | Context authority, memory, research | `[0]` system |
| `02-deliverables.md` | Markdown vs HTML reports | `[0]` system |
| `03-static-examples.md` | Few-shot tool patterns | `[1]` user |

Assembly (`harnessLoader.ts`):

- Three agent sections inside `<system_instructions>`
- `<runtime_limits>` from `constants.ts` (boot-validated via `assertHarnessBoot()`)
- Tool catalogue from each tool's `briefMarkdown` (wire schemas remain on `tools[]`)

Cache topology — see [`prompt-caching-audit.md`](prompt-caching-audit.md).

## Hard limits (host-enforced)

| Constant | Value | Where |
|----------|-------|-------|
| `MAX_TOTAL_ITERATIONS` | 24 | `runLoop.ts` + synthesis turn |
| `MAX_SELF_CORRECTION_ATTEMPTS` | 3 | Provider errors; all-failed tool rounds |
| `STREAM_INACTIVITY_TIMEOUT_MS` | 60_000 | Provider stream guard |
| `MAX_TOOL_OUTPUT_CHARS` | 8000 | Tool history truncation |
| Per-run token budget | optional | `settings.ui.agentBehavior.runTokenBudget` |

## Harness vs host boundary

| Concern | Harness (NL) | Host (TS) |
|---------|--------------|-----------|
| Behavior rules | Prime Directives, deliverables | — |
| Numeric caps | `<runtime_limits>` prose | `constants.ts` |
| Tool exposure | Catalogue + wire JSON | `AGENT_TOOLS` |
| Implicit finish | Substantive prose guidance | `isImplicitFinish()` thresholds |
| Three-strike halts | Self-regulation instructions | `consecutiveBadToolRounds`, `consecutiveErrors` |
| Spin loops | §6 soft signals + `<run_state>` | `toolResultCache` banner; `nudging` run-status when hot |
| Report after edits | Host gate semantics in §E | `hostReportGate.ts` + `settings.ui.reports` |
| Long-run compaction | Compaction banners documented in §B "Compacted tool results" | `contextCompaction.ts` (opt-in); durable via `tool-compacted` replay + artifact cleanup |

## 2026 harness-engineering comparison

| Practice | Status |
|----------|--------|
| Deterministic harness wraps LLM | **Pass** |
| ReAct / TAO loop | **Pass** |
| Hard iteration stop | **Pass** |
| Schema validation before tool run | **Pass** |
| Cache-aware context ordering | **Pass** |
| Tool minimization (11 tools) | **Pass** |
| Externalized memory (files) | **Pass** |
| NL harness | **Pass** |
| Cumulative token budget | **Pass** (optional setting) |
| Context compaction | **Pass** (opt-in; reversible offload + durable replay) |
| Generator-evaluator separation | **N/A** (solo Agent V) |

## Findings and remediation status

| ID | Finding | Status |
|----|---------|--------|
| DRIFT-01 | Missing Prime Directives §8 cited by `01-context-learning.md` | **Fixed** — §8 "The Harness Boundary" added |
| DRIFT-02 | `briefMarkdown` unused in harness catalogue | **Fixed** — wired in `harnessLoader.ts` |
| DRIFT-03 | `nudging` run-status never emitted | **Fixed** — emitted when `spin_signature_hot` is set |
| DRIFT-04 | `toolSpinSignature.ts` cited wrong harness § | **Fixed** — cites §6 |
| GAP-01 | No host-side context compaction | **Fixed** — reversible compaction shipped (opt-in); durable across replay with artifact cleanup |
| GAP-02 | No cumulative token budget | **Fixed** — `settings.ui.agentBehavior.runTokenBudget` |
| GAP-03 | Deliverables §E "MUST report" vs opt-in host gate | **Fixed** — harness aligned to gate semantics |
| DEBT-01 | Deprecated `buildSystemPrompt.ts` | **Fixed** — removed (no production or test imports) |
| DEBT-02 | Legacy summarization timeline kinds | Open — replay tolerance only |

## Verification checklist

```bash
npm run typecheck
npm test
```

Manual smoke:

1. 5+ turn session — cache read metrics from turn 2
2. `ask_user` pause → submit → resume → `finish`
3. Large edit run with `promptForReportAfterEdits` — host gate; "No" ends cleanly
4. Stop mid-stream — `agent-text-aborted`, `CHAT_DONE`, no orphan `activeRuns`
5. F5 during run — `listActiveRuns` rehydrates; events not dropped
6. Cold start — `assertHarnessBoot()` passes
7. Settings → Agent behavior → Run limits — enable token budget; run halts with friendly error when exceeded
