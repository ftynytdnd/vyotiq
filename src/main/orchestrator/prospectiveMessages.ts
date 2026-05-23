/**
 * Prospective-messages builder (Phase 2). Reconstructs the `ChatMessage[]`
 * the orchestrator's NEXT request would carry for a given conversation,
 * WITHOUT firing a request.
 *
 * Powers the composer's pre-flight token estimate so the pill reads
 * close to what the provider's `usage` frame reports the moment the
 * first turn streams. The pre-fix estimate counted only the user's
 * draft + attachments and missed the ~20k of system prompt + harness +
 * envelopes + replayed history + tool schemas that the wire actually
 * carries.
 *
 * Two source paths, in priority order:
 *
 *   1. **Active run** — when a run is currently in flight for this
 *      conversation, the orchestrator owns the canonical `messages[]`
 *      live. We read it through `runContextRegistry` so the estimate
 *      reflects mid-run state (post-summary splices, sub-agent
 *      injections, etc.).
 *
 *   2. **Idle** — read the persisted JSONL via `readConversation`,
 *      replay through `replayTranscript` to reconstruct the OpenAI-
 *      canonical history, RE-APPLY any persisted summarization splices
 *      via `replayCompression` (so a previously-compressed conversation
 *      counts at its compressed size, matching what
 *      `buildInitialMessages` will replay on the next `chat:send`),
 *      then rebuild the system prompt from the cached harness +
 *      freshly-refreshed envelopes the way `runLoop` does on entry.
 *
 * Tools are resolved from the same `ORCHESTRATOR_TOOLS` allowlist the
 * orchestrator uses on the wire, so the tool-schema bytes the pre-flight
 * sees are a strict superset of what the request would actually send.
 *
 * Single-source-of-truth: this builder is consumed by BOTH the composer
 * pre-flight pill (`tokens.ipc.ts`) AND the Context Inspector's idle
 * snapshot (`contextSummary.ipc.ts`), so the two surfaces always
 * tokenize the same prospective payload and therefore always render the
 * same "% of context window used" reading.
 *
 * Pure data assembly — no IO beyond what `refreshEnvelopes` and
 * `readConversation` already do. `refreshEnvelopes` is LRU-cached for
 * 3s so a typical keystroke pre-flight pass hits warm cache.
 */

import type { ChatMessage, TimelineEvent } from '@shared/types/chat.js';
import { buildOrchestratorSystemPrompt } from '../harness/harnessLoader.js';
import { toolSchemasFor } from '../tools/registry.js';
import { ORCHESTRATOR_TOOLS } from '../tools/policy/index.js';
import { getConversationMeta, readConversation } from '../conversations/conversationStore.js';
import { getWorkspace, requireWorkspaceById } from '../workspace/workspaceState.js';
import { logger } from '../logging/logger.js';
import { refreshEnvelopes } from './contextManager.js';
import { findActiveRunByConversation } from './runContextRegistry.js';
import { replayTranscript } from './replay/index.js';
import { replayCompression } from './contextSummarizer/index.js';
import { buildSystemPrompt } from './loop/buildSystemPrompt.js';
import { buildHostEnvironmentXml } from './loop/buildHostEnvironment.js';
import type { TokenizableToolSchema } from '../providers/tokenCounter.js';

const log = logger.child('orch/prospectiveMessages');

/**
 * Shape returned to callers. `messages` is the prospective `ChatMessage[]`
 * the next request would carry (system prompt first, then replayed
 * history, NOT including the user's in-progress draft). `tools` is the
 * tool-schema catalogue serialized exactly the way `buildOrchestratorRequest`
 * would emit it on the wire.
 *
 * `source` is informational — useful for tests + the inspector to
 * distinguish "we read the live run's array" from "we replayed disk".
 */
export interface ProspectiveMessagesResult {
  messages: ChatMessage[];
  tools: TokenizableToolSchema[];
  source: 'live-run' | 'replay' | 'fresh-conversation' | 'unknown-conversation';
}

/**
 * Build the prospective `messages[]` for the next turn of `conversationId`.
 *
 * Never throws — every error path falls through to a "fresh conversation"
 * result so the pre-flight estimate stays best-effort and the composer
 * pill never goes dark on a transient lookup failure.
 */
export async function getProspectiveMessages(
  conversationId: string
): Promise<ProspectiveMessagesResult> {
  const tools = toolSchemasFor(ORCHESTRATOR_TOOLS) as unknown as TokenizableToolSchema[];

  // ── Path 1: active run owns the live messages ──
  const live = findActiveRunByConversation(conversationId);
  if (live) {
    // Deep-clone so pre-flight tokenization cannot race with concurrent
    // `runLoop` pushes / summary splices on the live array.
    return {
      messages: structuredClone(live.messages),
      tools,
      source: 'live-run'
    };
  }

  // ── Path 2: idle conversation — replay from disk ──
  const meta = await getConversationMeta(conversationId).catch((err: unknown) => {
    log.debug('getConversationMeta failed; treating as unknown', {
      conversationId,
      err: err instanceof Error ? err.message : String(err)
    });
    return null;
  });
  if (!meta) {
    return { messages: [], tools, source: 'unknown-conversation' };
  }

  // Resolve the workspace this conversation is pinned to so envelopes
  // (workspace context + memory retrieval) are scoped correctly.
  // Falls back to the globally-active workspace for legacy conversations
  // persisted before `workspaceId` was stamped on the meta.
  let workspaceId: string | undefined = meta.workspaceId;
  let workspacePath: string | undefined;
  if (workspaceId) {
    try {
      workspacePath = await requireWorkspaceById(workspaceId);
    } catch (err: unknown) {
      log.debug('requireWorkspaceById failed; falling back to active workspace', {
        workspaceId,
        err: err instanceof Error ? err.message : String(err)
      });
    }
  }
  if (!workspacePath) {
    try {
      const active = await getWorkspace();
      if (active.path) workspacePath = active.path;
    } catch {
      /* leave undefined */
    }
  }

  let replayed: ChatMessage[];
  let lastUserPrompt = '';
  try {
    const conv = await readConversation(conversationId);
    if (!conv) return { messages: [], tools, source: 'unknown-conversation' };
    replayed = replayTranscript(conv.events);
    // Best-effort rolling-query string for envelope memory retrieval —
    // matches what `runLoop` would compute on the first iteration.
    // Used only to drive the memory retrieval inside `refreshEnvelopes`;
    // a stale-but-recent prompt is fine pre-flight (envelopes are cached
    // for 3s anyway).
    for (let i = conv.events.length - 1; i >= 0; i--) {
      const e = conv.events[i]!;
      if (e.kind === 'user-prompt') {
        lastUserPrompt = e.content;
        break;
      }
    }
    // Apply persisted summarization splices on top of the rebuilt
    // history so the pre-flight count reflects the COMPRESSED shape
    // the next `chat:send` will replay (`buildInitialMessages` does
    // the same — see `AgentV.ts`). Without this, a conversation that
    // had a summary applied would over-count its tokens here because
    // `replayTranscript` returns the pre-summary shape (it walks the
    // user-facing events) and the summary-end event's splice was only
    // applied to the live `messages[]` at runtime.
    const summaryEvents = filterSummaryEvents(conv.events);
    if (summaryEvents.length > 0) replayCompression(replayed, summaryEvents);
  } catch (err: unknown) {
    log.debug('readConversation failed; falling back to fresh-conversation', {
      conversationId,
      err: err instanceof Error ? err.message : String(err)
    });
    return { messages: [], tools, source: 'fresh-conversation' };
  }

  // Build the system prompt the way `runLoop` does on entry. The
  // `run_state` XML is only meaningful mid-run; for a pre-flight
  // estimate we substitute the same "first iteration" placeholder
  // the orchestrator would emit on the FIRST turn of a fresh run.
  const harness = buildOrchestratorSystemPrompt();
  const env = await refreshEnvelopes(
    lastUserPrompt || meta.title || '',
    conversationId,
    workspacePath,
    workspaceId
  );
  const runStateXml = wrapInitialRunStateForEstimate(meta.eventCount);
  // Pre-flight estimate matches the wire shape `runLoop` emits, so the
  // system prompt also carries a fresh `<host_environment>`. Built per
  // call (microsecond-cheap) so the estimate reflects the current
  // timestamp / OS facts without needing a cache invalidation hook.
  const hostEnvironmentXml = buildHostEnvironmentXml();
  const systemContent = buildSystemPrompt(harness, env, runStateXml, hostEnvironmentXml);
  const systemMsg: ChatMessage = { role: 'system', content: systemContent };

  return {
    messages: [systemMsg, ...replayed],
    tools,
    source: replayed.length === 0 ? 'fresh-conversation' : 'replay'
  };
}

/**
 * Bin the summary-related events out of a conversation's full event
 * stream so `replayCompression` can re-apply persisted splices on top
 * of the rebuilt `messages[]`. Mirrors the filter `buildInitialMessages`
 * does in `AgentV.ts` — kept private here so the rest of this module
 * stays a thin assembly layer.
 *
 * Single O(n) walk; the three target kinds together are typically a
 * tiny fraction of a transcript (a handful of summaries vs thousands
 * of user/assistant/tool events).
 */
function filterSummaryEvents(
  events: ReadonlyArray<TimelineEvent>
): Array<
  Extract<
    TimelineEvent,
    | { kind: 'context-summary-pending' }
    | { kind: 'context-summary-end' }
    | { kind: 'context-summary-undone' }
  >
> {
  const out: Array<
    Extract<
      TimelineEvent,
      | { kind: 'context-summary-pending' }
      | { kind: 'context-summary-end' }
      | { kind: 'context-summary-undone' }
    >
  > = [];
  for (const e of events) {
    if (
      e.kind === 'context-summary-pending' ||
      e.kind === 'context-summary-end' ||
      e.kind === 'context-summary-undone'
    ) {
      out.push(e);
    }
  }
  return out;
}

/**
 * Pre-flight `<run_state>` envelope. The live orchestrator's run-state
 * builder lives in `loop/runState.ts` and depends on per-iteration
 * counters that don't exist yet at pre-flight time. We render a stable
 * "iteration 0" stand-in so the tokenization sees a representative size
 * for the slot (the slot is small — typically <300 tokens — so the
 * approximation doesn't materially change the pill's reading).
 *
 * Kept as a pure literal so the estimate is deterministic per
 * conversation — important for the IPC-level cache in `tokens.ipc.ts`
 * to actually hit. We do NOT call into `loop/runState.ts` here because
 * its inputs (last action, hot-tool signature, nudge counters) are
 * meaningless before the first iteration.
 */
function wrapInitialRunStateForEstimate(priorTurns: number): string {
  return (
    `<run_state>\n` +
    `  <iteration>0 / 24</iteration>\n` +
    `  <prior_turns_in_conversation>${priorTurns}</prior_turns_in_conversation>\n` +
    `  <nudges_remaining>2 / 2</nudges_remaining>\n` +
    `  <delegate_bad_round_streak>0 / 3</delegate_bad_round_streak>\n` +
    `  <self_correction_attempts>0 / 3</self_correction_attempts>\n` +
    `  <last_action>(none — pre-flight)</last_action>\n` +
    `</run_state>`
  );
}
