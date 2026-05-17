/**
 * Context-summarizer module — public surface.
 *
 * Composition layer over the granular helpers in this folder. The
 * orchestrator's `runLoop` and the `contextSummary.ipc` handlers
 * consume ONLY this module; the helpers (messageWindow, tokenBudget,
 * streamSummary, applySummary, undoRegistry, replayCompression,
 * overrideStore) stay private at the file level.
 *
 * Two top-level entry points:
 *
 *   - `maybeRunSummarization(opts)` — auto / manual trigger.
 *     Decides whether to compress, runs `streamSummary`, and on
 *     success applies the splice with `applySummary`. Threads
 *     timeline events through the run's `emit` sink.
 *
 *   - `getInspectorSnapshot(opts)` — flatten the live `messages[]`
 *     into the renderer's Inspector view. Used by the
 *     `CONTEXT_SUMMARY_INSPECT` IPC.
 *
 * Plus passthroughs for the override + undo stores and the replay-
 * time compression hook.
 */

import type { ChatMessage } from '@shared/types/chat.js';
import type { ModelSelection } from '@shared/types/provider.js';
import type {
  ContextInspectorMessage,
  ContextInspectorSnapshot,
  ContextSummaryRules
} from '@shared/types/contextSummary.js';
import { logger } from '../../logging/logger.js';
import { partition } from './messageWindow.js';
import { applySummary } from './applySummary.js';
import { streamSummary, type StreamSummaryResult } from './streamSummary.js';
import { estimateAllMessageTokens } from './tokenBudget.js';
import { getOverrides } from './overrideStore.js';

const log = logger.child('orchestrator/contextSummarizer');

// ─── Re-exports for the IPC + runLoop consumers ──────────────────────
//
// Only the symbols ACTUALLY imported from outside this folder are
// surfaced here. Internal-only helpers (`partition`, `identifyAll`,
// `classifyMessage`, `applySummary`, `revertSummary`,
// `estimateMessageTokens`, `estimateRangeTokens`,
// `estimateAllMessageTokens`, `listSnapshotsForRun`) stay file-local
// and are reached through the composed entry points below
// (`maybeRunSummarization`, `getInspectorSnapshot`, the typed
// callbacks in `runContextRegistry`'s handle). Trimming the surface
// keeps the public contract honest and stops a future refactor from
// silently re-introducing the duplicate "low-level + composed" entry
// points the original draft had.

export { revertSummary } from './applySummary.js';
export { shouldTrigger } from './tokenBudget.js';
export {
  applyOverrideEvent,
  clearConversation,
  getOverrides,
  replayOverrideEvents
} from './overrideStore.js';
export {
  clearForRun,
  dropSnapshot,
  getSnapshot
} from './undoRegistry.js';
export { replayCompression } from './replayCompression.js';

// ─── Composed entry points ───────────────────────────────────────────

/**
 * Run summarization end-to-end and (on success) splice the
 * orchestrator's `messages` in place. Idempotent under abort —
 * partial streams emit a `context-summary-aborted` event and leave
 * `messages` untouched.
 *
 * Returns the same `StreamSummaryResult` the caller can route into
 * the runLoop's status surface (e.g. logging "saved 38 % tokens"
 * once compression lands).
 */
export async function maybeRunSummarization(opts: {
  runId: string;
  conversationId: string;
  workspacePath?: string;
  messages: ChatMessage[];
  rules: ContextSummaryRules;
  /** When `null` ⇒ caller decided no summarizer model was pinned;
   *  this function falls back to the run's current selection. */
  summarizerSelection: ModelSelection;
  trigger: 'auto' | 'manual';
  originalPrompt: string;
  runStateXml?: string;
  signal: AbortSignal;
  emit: Parameters<typeof streamSummary>[0]['emit'];
}): Promise<StreamSummaryResult> {
  const overrides = getOverrides(opts.conversationId);
  const part = partition(opts.messages, opts.rules, overrides);
  if (part.summarizable.length < opts.rules.minMessagesToSummarize) {
    log.debug('maybeRunSummarization: range below minMessagesToSummarize', {
      runId: opts.runId,
      summarizable: part.summarizable.length,
      threshold: opts.rules.minMessagesToSummarize
    });
    return {
      ok: false,
      summaryId: '',
      beforeTokens: 0,
      afterTokens: 0,
      finalText: '',
      savedPercent: 0,
      reason: 'Range too small to summarize'
    };
  }
  // Review finding M4: the inspector-row precompute that used to
  // live here was passing a `Record<string, ContextInspectorMessage>`
  // into `streamSummary` that the streamer never read (the renderer
  // fetches its own copy via `getInspectorSnapshot` for the live
  // UI). Building it on every summarization meant a wasted
  // `estimateAllMessageTokens` walk per trigger. Dropped — the
  // renderer's snapshot path is the single source of truth.
  const result = await streamSummary({
    runId: opts.runId,
    ...(opts.workspacePath !== undefined ? { workspacePath: opts.workspacePath } : {}),
    partition: part,
    messages: opts.messages,
    originalPrompt: opts.originalPrompt,
    ...(opts.runStateXml !== undefined ? { runStateXml: opts.runStateXml } : {}),
    rules: opts.rules,
    summarizerSelection: opts.summarizerSelection,
    trigger: opts.trigger,
    signal: opts.signal,
    emit: opts.emit
  });
  if (!result.ok) return result;
  applySummary({
    runId: opts.runId,
    summaryId: result.summaryId,
    messages: opts.messages,
    summarizableIndices: part.summarizable,
    droppedIndices: part.dropped,
    ids: part.ids,
    finalText: result.finalText
  });
  return result;
}

/**
 * Build the renderer-side `ContextInspectorSnapshot` for a live
 * messages array. Pure (modulo the BPE estimator inside
 * `estimateAllMessageTokens`). Cheap enough to call per IPC ping;
 * memoization on the renderer side gates how often the user can
 * ask for a refresh.
 */
export async function getInspectorSnapshot(opts: {
  runId?: string;
  conversationId: string;
  workspaceId: string;
  messages: ReadonlyArray<ChatMessage>;
  rules: ContextSummaryRules;
  workspaceOverridePresent: boolean;
  modelId: string;
  ceiling?: number;
  activeSummaryId?: string;
}): Promise<ContextInspectorSnapshot> {
  const overrides = getOverrides(opts.conversationId);
  const part = partition(opts.messages, opts.rules, overrides);
  const tokensByIndex = await estimateAllMessageTokens(
    opts.messages,
    opts.modelId
  );
  const messages: ContextInspectorMessage[] = [];
  for (let i = 0; i < opts.messages.length; i++) {
    const m = opts.messages[i]!;
    const id = part.ids[i]!;
    const kind = part.kinds[i]!;
    const override = overrides[id];
    // Effective decision mirrors `partition`'s logic but condensed
    // for the row's surface — preserve / summarize / drop only.
    let effectiveDecision: 'keep' | 'summarize' | 'drop' = 'keep';
    if (part.summarizable.includes(i)) effectiveDecision = 'summarize';
    else if (part.dropped.includes(i)) effectiveDecision = 'drop';
    const charCount = (m.content ?? '').length;
    const row: ContextInspectorMessage = {
      messageId: id,
      role: m.role,
      kind,
      originLabel: buildOriginLabel(m, kind),
      tokenEstimate: tokensByIndex[i] ?? 0,
      charCount,
      effectiveDecision,
      ...(override !== undefined ? { override } : {}),
      ...(kind === 'system-summary' && i > 0 ? { fromSummary: true as const } : {})
    };
    messages.push(row);
  }
  const totalTokens = tokensByIndex.reduce((a, b) => a + b, 0);
  const snapshot: ContextInspectorSnapshot = {
    ...(opts.runId !== undefined ? { runId: opts.runId } : {}),
    conversationId: opts.conversationId,
    workspaceId: opts.workspaceId,
    rules: opts.rules,
    workspaceOverridePresent: opts.workspaceOverridePresent,
    messages,
    totalTokens,
    ...(opts.ceiling !== undefined ? { ceiling: opts.ceiling } : {}),
    ...(opts.ceiling !== undefined && opts.ceiling > 0
      ? { currentRatio: clampRatio(totalTokens / opts.ceiling) }
      : {}),
    ...(opts.activeSummaryId !== undefined
      ? { activeSummaryId: opts.activeSummaryId }
      : {})
  };
  return snapshot;
}

/**
 * Render the short human label the Inspector uses for each row.
 * Examples:
 *   - "system header"
 *   - "user prompt"
 *   - "assistant turn (text)"
 *   - "tool: read"
 *   - "delegate result"
 *   - "compressed summary"
 */
function buildOriginLabel(
  msg: ChatMessage,
  kind: import('@shared/types/contextSummary.js').MessageKind
): string {
  switch (kind) {
    case 'user':
      return 'user prompt';
    case 'assistant':
      return 'assistant turn (text)';
    case 'assistant-tool-call': {
      const names = (msg.tool_calls ?? [])
        .map((tc) => tc.function.name)
        .join(', ');
      return names ? `assistant turn (tools: ${names})` : 'assistant turn (tools)';
    }
    case 'tool-result':
      return msg.name ? `tool: ${msg.name}` : 'tool result';
    case 'delegate-result':
      return 'delegate result';
    case 'system-summary':
      // First system slot is the harness header; later ones are
      // synthesized summary envelopes.
      return msg.content?.startsWith('<context_summary')
        ? 'compressed summary'
        : 'system header';
  }
}

function clampRatio(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 2) return 2;
  return n;
}
