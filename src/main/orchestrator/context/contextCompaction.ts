/**
 * Reversible context compaction — large tool outputs swapped for on-disk refs.
 * Design: `docs/context-compaction-design.md`.
 */

import { randomUUID } from 'node:crypto';
import type { ChatMessage, TimelineEvent } from '@shared/types/chat.js';
import type { ResolvedAgentBehaviorSettings } from '@shared/settings/agentBehaviorSettings.js';
import {
  COMPACT_DEFAULT_CONTEXT_WINDOW,
  COMPACT_MAX_ROWS_PER_TURN,
  COMPACT_MIN_TOOL_OUTPUT_CHARS,
  COMPACT_TARGET_FRACTION
} from '@shared/constants.js';
import { effectiveContextWindow } from '@shared/providers/contextWindow.js';
import { findProviderModel } from '@shared/providers/modelId.js';
import { tokenizeMessages } from '../../providers/tokenCounter.js';
import { getProviderWithKey } from '../../providers/providerStore.js';
import { logger } from '../../logging/logger.js';
import {
  CACHE_LAYER_HISTORY_START,
  isCacheLayeredTopology
} from './buildContextLayers.js';
import {
  buildCompactionBanner,
  isCompactedToolContent,
  writeCompactionArtifact
} from './compactionArtifacts.js';

const log = logger.child('orch/contextCompaction');

export interface ContextCompactionOpts {
  conversationId?: string;
  runId: string;
  workspacePath: string;
  modelId: string;
  providerId: string;
  agentBehavior: ResolvedAgentBehaviorSettings;
  /**
   * Timeline sink. Each offloaded tool row emits a persisted
   * `tool-compacted` marker (so cross-turn replay rebuilds the lean
   * banner), and the first compaction of a run emits a single
   * `agent-thought` notice so the user sees that it happened.
   */
  emit: (event: TimelineEvent) => void;
}

async function resolveContextWindowTokens(
  providerId: string,
  modelId: string
): Promise<number> {
  const provider = await getProviderWithKey(providerId);
  if (!provider) return COMPACT_DEFAULT_CONTEXT_WINDOW;
  const model = findProviderModel(provider, modelId);
  if (!model) return COMPACT_DEFAULT_CONTEXT_WINDOW;
  return effectiveContextWindow(model, provider.contextOverrides) ?? COMPACT_DEFAULT_CONTEXT_WINDOW;
}

/**
 * When compaction is enabled and estimated prompt tokens exceed the threshold,
 * replace the oldest large tool-result bodies with reversible on-disk banners.
 */
export async function applyContextCompactionIfEnabled(
  messages: readonly ChatMessage[],
  opts: ContextCompactionOpts,
  compactionLogged: { value: boolean }
): Promise<ChatMessage[]> {
  if (!opts.agentBehavior.contextCompaction.enabled) {
    return [...messages];
  }
  if (!opts.conversationId) {
    return [...messages];
  }
  if (!isCacheLayeredTopology(messages)) {
    return [...messages];
  }

  const contextWindow = await resolveContextWindowTokens(opts.providerId, opts.modelId);
  const threshold = Math.floor(contextWindow * COMPACT_TARGET_FRACTION);
  const estimate = tokenizeMessages(opts.modelId, messages).total;
  if (estimate < threshold) {
    return [...messages];
  }

  const historyEnd = messages.length - 2;
  const next = messages.map((m) => ({ ...m }));
  let compactedThisTurn = 0;
  let estimateAfter = estimate;
  let noticeEmittedThisCall = false;

  for (let i = CACHE_LAYER_HISTORY_START; i < historyEnd; i++) {
    if (compactedThisTurn >= COMPACT_MAX_ROWS_PER_TURN) break;
    if (estimateAfter < threshold) break;

    const msg = next[i];
    if (msg?.role !== 'tool') continue;
    const content = msg.content;
    if (typeof content !== 'string') continue;
    if (content.length < COMPACT_MIN_TOOL_OUTPUT_CHARS) continue;
    if (isCompactedToolContent(content)) continue;
    if (!msg.tool_call_id) continue;

    const relativePath = await writeCompactionArtifact(
      opts.workspacePath,
      opts.conversationId,
      opts.runId,
      msg.tool_call_id,
      content
    );
    const banner = buildCompactionBanner(relativePath);
    next[i] = { ...msg, content: banner };
    compactedThisTurn += 1;
    // Re-tokenize the row delta against the real tokenizer instead of a
    // char/token heuristic so the loop stops compacting as soon as the
    // prompt is genuinely back under threshold (avoids over-compaction).
    const savedTokens =
      tokenizeMessages(opts.modelId, [{ role: 'tool', content }]).total -
      tokenizeMessages(opts.modelId, [{ role: 'tool', content: banner }]).total;
    estimateAfter = Math.max(0, estimateAfter - Math.max(0, savedTokens));

    // Persist a replay marker so a future `chat:send` rebuilds the lean
    // banner for this tool row instead of re-inflating the full output.
    opts.emit({
      kind: 'tool-compacted',
      id: randomUUID(),
      ts: Date.now(),
      runId: opts.runId,
      toolCallId: msg.tool_call_id,
      relativePath,
      originalChars: content.length
    });

    if (!compactionLogged.value) {
      compactionLogged.value = true;
      log.info('context compaction active', {
        runId: opts.runId,
        conversationId: opts.conversationId,
        estimateBefore: estimate,
        threshold,
        contextWindow
      });
    }
    if (!noticeEmittedThisCall) {
      noticeEmittedThisCall = true;
      opts.emit({
        kind: 'agent-thought',
        id: randomUUID(),
        ts: Date.now(),
        content:
          'Context approaching the model window — offloaded older tool output to disk. The full output stays available via `read`.',
        severity: 'info'
      });
    }
    log.debug('compacted tool result', {
      runId: opts.runId,
      toolCallId: msg.tool_call_id,
      originalChars: content.length,
      relativePath
    });
  }

  return next;
}

export { isCompactedToolContent, buildCompactionBanner };
