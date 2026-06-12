# Reversible Context Compaction — Design (2026)

> **Superseded.** Reversible compaction is now one tier inside the unified
> context-window management system. See **`docs/context-management-design.md`**
> for the current design (on by default; tool-result clearing → on-disk
> compaction → reversible summarization; goal anchor + run-progress note;
> manual Compact/Reset; composer meter). The notes below are retained for
> historical context on the original opt-in compaction tier.

Status (historical): originally shipped opt-in via
`settings.ui.agentBehavior.contextCompaction.enabled` (now folded into
`contextManagement`, on by default). `src/main/orchestrator/context/contextCompaction.ts` offloads large tool outputs to `.vyotiq/compaction/...` and replaces their in-context bodies with `read`-restorable banners once the prompt nears the model window. Durability is end-to-end: a persisted `tool-compacted` timeline event lets `replayTranscript.ts` rebuild the lean banner across turns, and artifacts are reclaimed on conversation delete (`cleanupCompactionArtifactsForConversation`) plus a startup orphan sweep (`sweepOrphanCompactionAllWorkspaces`).

## Problem

Vyotiq intentionally sends the full rolling `ChatMessage[]` to providers (`contextManager.ts`). Long agent runs eventually hit provider context limits; today overflow surfaces as a recoverable provider error and the self-correction retry path.

2026 harness literature recommends **reversible compaction** before lossy summarization: write bulky tool outputs to disk, replace in-context bodies with stable references, and allow the model to `read` them back when needed.

## Goals

1. Keep cache-layered topology stable (`buildContextLayers.ts` indices must not shift).
2. Preserve rewind / checkpoint semantics — compacted payloads must remain addressable on disk.
3. Default off; opt-in via Settings → Agent behavior → Context compaction.
4. Never drop the volatile tail (`<runtime_context>` + `<turn>` slots).

## Non-goals (v1)

- Lossy LLM summarization of history.
- Compaction across conversation boundaries.
- Automatic compaction on every turn (only when estimated prompt tokens exceed a threshold).

## Proposed algorithm

```
on each iteration, before sanitizeToolCallPairing:
  if !settings.contextCompaction.enabled: return messages
  estimate = tokenCounter.estimate(messages)
  if estimate < threshold * contextWindow: return messages

  for each tool-result row in history (oldest first):
    if output bytes > COMPACT_MIN_BYTES:
      ref = writeCompactionArtifact(conversationId, runId, toolCallId, output)
      replace tool message content with COMPACT_BANNER + ref path
      if estimate < target: break

  return messages
```

### Artifact layout

```
<workspace>/.vyotiq/compaction/<conversationId>/<runId>/<toolCallId>.txt
```

Shipped: artifacts live under the active workspace dotdir (portable, sandbox-resolvable by `read`). The optional sha256 manifest row was not needed for v1 — durability is carried by the persisted `tool-compacted` timeline event instead.

### Reversibility

- Banner format: `[compacted — full output at .vyotiq/compaction/... — use read to restore]`
- `read` resolves the workspace-relative artifact path directly. Across turns, `replayTranscript.ts` rebuilds the banner from the persisted `tool-compacted` event (keyed by `toolCallId`), so the working set stays lean without re-inflating the full output.

## Integration points

| Hook | File | When |
|------|------|------|
| Settings | `agentBehaviorSettings.ts` | `contextCompaction.enabled` |
| Loop pre-sanitize | `runLoop.ts` | After `applyCacheLayers`, before `sanitizeToolCallPairing` |
| Token estimate | `tokenCounter` IPC | Threshold compare vs model `contextWindow` |
| Replay | `replayTranscript.ts` | Must rehydrate compact banners identically |

## Thresholds (proposed defaults)

| Constant | Value | Rationale |
|----------|-------|-----------|
| `COMPACT_MIN_TOOL_OUTPUT_CHARS` | 4000 | Below `MAX_TOOL_OUTPUT_CHARS` (8000) — compact only large bodies |
| `COMPACT_TARGET_FRACTION` | 0.85 | Start compacting when estimate ≥ 85% of model context |
| `COMPACT_MAX_ROWS_PER_TURN` | 3 | Avoid compaction storms mid-iteration |

## Risks

- Breaking prompt-cache prefixes if compaction mutates early history frequently — prefer compacting **middle** history rows, never slots `[0..2]`.
- Provider tool-result pairing must stay valid after content replacement.
- Replay of pre-compaction transcripts must remain backward compatible.

## Rollout

1. Ship settings + stub. **Done.**
2. Implement artifact writer + banner replacement behind flag. **Done** (`contextCompaction.ts`, `compactionArtifacts.ts`).
3. Add unit tests: topology preserved, `read` restores, replay round-trip. **Done** (`tests/main/orchestrator/context/contextCompaction.test.ts`, `tests/main/orchestrator/replay/replayTranscript.compaction.test.ts`).
4. Durability + cleanup: persisted `tool-compacted` event for replay; artifact reclamation on conversation delete + startup orphan sweep. **Done.**
5. Manual validation on 30+ turn coding session with local Ollama + cloud provider. (Recommended before enabling by default.)
