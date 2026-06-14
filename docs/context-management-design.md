# Context Window Management — Design (2026)

Status: **shipped, on by default.** Vyotiq proactively keeps the prompt under a
fraction of each model's discovered context window, using reversible reduction
first and lossy summarization only as a last resort. Configured under
Settings → Agent behavior → Context management
(`settings.ui.agentBehavior.contextManagement`).

This supersedes the original opt-in "reversible compaction" design
(`context-compaction-design.md`), which is now one tier inside this system.

## Why

2026 context-engineering research ("context rot") shows a model's *effective*
context — the length over which it reasons reliably — is well below the
advertised window, and degradation begins long before the hard limit. The
guidance: manage **proactively** (≈60–80% of the context window), prefer
**raw > reversible compaction > lossy summarization**, keep static prefixes
byte-stable for prompt caching, and restate the goal near the tail to fight
"lost-in-the-middle".

## Components

| Concern | Module |
|---------|--------|
| Context-window math + level classification (shared) | `src/shared/context/contextLevel.ts` |
| Budget service (estimate + window + level, single source of truth) | `src/main/orchestrator/context/contextBudget.ts` |
| Tiered reversible reduction engine | `src/main/orchestrator/context/contextCompaction.ts` |
| Reversible structured summarization | `src/main/orchestrator/context/contextSummarize.ts` |
| On-disk artifacts (compaction + summaries) | `src/main/orchestrator/context/compactionArtifacts.ts` |
| Background-refined provider token counts | `src/main/providers/tokenCountRemote.ts` |
| Goal anchor + run-progress note in the tail | `buildContextLayers.ts`, `contextManager.ts` |
| Manual controls (Compact now / Reset) | `src/main/ipc/context.ipc.ts` |
| Composer meter | `src/renderer/components/composer/ContextWindowMeter.tsx` |
| Settings | `src/shared/settings/agentBehaviorSettings.ts`, `RunLimitsPanel.tsx` |

## Model context window

The composer meter and popover show fill against the **full provider-discovered**
context window (`ModelInfo.contextWindow`, with optional per-model user
overrides). No artificial fraction or absolute ceiling shrinks the displayed
denominator. When the window is unknown after discovery, the composer meter is
hidden and automatic reduction is skipped until a real value is available.

**Display vs compaction.** Meter/popover `%` = `usedTokens ÷ fullWindow`. Warn /
trigger / critical bands (meter color, reduction engine) use
`min(floor(window × fraction), absoluteCap)` so large models (e.g. 1M) still
compact near ~200k tokens (`CONTEXT_ABSOLUTE_COMPACTION_WARN_TOKENS` /
`CONTEXT_ABSOLUTE_COMPACTION_TRIGGER_TOKENS`) while the UI shows honest fill
against the full window. Smaller windows (e.g. 128k) keep fraction-based
thresholds (~70% / ~75%). Defaults: `triggerFraction = 0.75`, `warnFraction = 0.70`.

## Token estimate (calibrated to real billed tokens)

`tokenizeMessages` gives exact BPE for the GPT family and a chars/3.8 heuristic
for others. For Anthropic / Gemini, `tokenCountRemote` refines the estimate via
the providers' free `count_tokens` / `:countTokens` endpoints — **background +
cached, never blocking a send**; the heuristic is used until a fresh value lands.

On top of that, the run loop anchors the estimate to the provider's REAL
reported `usage.promptTokens`: after each turn it computes
`calibrationRatio = realPromptTokens ÷ rawEstimateForThatPrompt` (clamped
`0.5..2`) and feeds it into the next budget evaluation. This closes the residual
heuristic drift turn-over-turn with zero extra cost — the provider already
returns the number. The composer meter shows the calibrated value (and a
`prefix / history / tools` breakdown via `byPart`).

## Reduction tiers (escalating, run per iteration when over trigger)

1. **Tool-result clearing** — offload tool results older than the
   `keepLastToolResults` window (default 3) to disk, replacing them with a
   `read`-restorable banner. Host-side equivalent of Anthropic context-editing
   `clear_tool_uses`. Reversible.
2. **Size offload** — offload any remaining large tool bodies
   (≥ `COMPACT_MIN_TOOL_OUTPUT_CHARS`), including recent ones. Reversible.
2b. **Tool-input clearing** — offload large tool-CALL argument bodies
   (≥ `COMPACT_MIN_TOOL_INPUT_CHARS`) on older assistant turns, replacing the
   `arguments` with a small valid-JSON banner (`{"_compacted": "<path>"}`).
   Host-side equivalent of Anthropic `clear_tool_inputs`; recovers space that a
   bulky historical `edit`/`report` payload would otherwise occupy forever.
   Reversible. Recent tool calls (before the keep window) stay verbatim.
3. **Summarization (rolling)** — when offload can't get under trigger and
   `summarizationEnabled` is on, collapse the history slice into a single
   structured `<context_summary>` block (task intent / key decisions / files
   changed / failed approaches / open questions / next steps). The full
   pre-summary transcript is saved under `.vyotiq/context-summaries/…` so the
   reduction is recoverable. Mirrors Anthropic server-side compaction / Claude
   Code `/compact`. **Rolling**: a long run that refills re-summarizes (paced by
   `SUMMARY_MIN_INTERVAL_MS = 30s`), collapsing the prior summary + new history
   into a fresh one. Optionally routed to a cheaper `summaryModel`.

Anti-thrash: a cooldown between passes (ignored when usage is `critical`) and a
minimum-savings gate prevent breaking the prompt cache for tiny wins.
`reduceContextIfNeeded` returns the POST-reduction usage so the loop reuses one
budget evaluation per iteration for both reduction and meter telemetry.

## Proactive context-pressure note

When usage crosses `warnFraction`, the runtime tail carries a
`<context_pressure>` note (built by `buildContextPressureXml`) telling the agent
to persist load-bearing state (its `run-progress` note / `memory`) BEFORE
reduction trims older detail — mirrors Anthropic's memory-tool "older detail is
about to be cleared" warning. Sits next to `<goal_anchor>` at the tail so it
gets strong recency attention and survives reduction.

### Replay durability

`tool-compacted` and `context-summary` are persisted timeline events.
`replayTranscript.ts` rebuilds the lean banner for each cleared/offloaded tool
row, and collapses everything before a `context-summary` marker into the summary
message — so later turns continue from the same lean context the live run
reached. Artifacts are reclaimed on conversation delete and by a startup orphan
sweep (`compactionSweep.ts`).

## Opportunistic provider-native context editing

When the provider speaks the Anthropic dialect and host management is enabled,
the request also carries a `context_management` `clear_tool_uses` edit
(`context-management-2025-06-27` beta) as a **backstop**, with its trigger set
ABOVE the host trigger (defense in depth). Detection is dialect-driven, not
hardcoded per model. All other providers use the host-side tiers uniformly.

## Goal anchor + run-progress note

- `<goal_anchor>` — the original task restated near the tail every turn.
- `<run_progress>` — an agent-maintained scratchpad (reserved `run-progress`
  workspace memory note) surfaced near the tail. Both survive reduction because
  they live in the volatile runtime tail, not the collapsible history.

## Manual controls

`vyotiq.context.compactNow` / `vyotiq.context.reset` operate on the persisted
transcript (refused while a run is active/paused): they replay → run the same
tiers → append markers so the next run replays lean. Mirrored to the renderer
through the `manual:<conversationId>` channel.

## Zero-leak

All caches are bounded (envelope LRU+TTL, remote-count LRU+TTL, per-run
reduction state created/discarded per loop). No module-level per-run maps; disk
artifacts are swept on delete + startup.

## Settings (defaults)

| Setting | Default |
|---------|---------|
| `enabled` | `true` |
| `triggerFraction` | `0.75` |
| `warnFraction` | `0.70` |
| `keepLastToolResults` | `3` |
| `summarizationEnabled` | `true` |
| `cooldownMs` | `15000` |
| `minSavingsTokens` | `2000` |

Legacy `contextCompaction.enabled` is still read as a fallback for the master
switch on older persisted settings.
