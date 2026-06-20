/**
 * Tiered, reversible-first context reduction. Driven by {@link evaluateContextBudget}.
 * Design: `docs/context-management-design.md`.
 *
 * When the estimated prompt crosses the trigger fraction of the model's
 * discovered context window, the host frees space in escalating order —
 * most reversible first (2026 guidance: raw > reversible compaction > lossy
 * summarization):
 *
 *   Tier A — tool-result clearing: offload tool results older than the
 *            keep-last-N window to on-disk artifacts (host-side equivalent of
 *            Anthropic context-editing `clear_tool_uses`). Reversible.
 *   Tier B — size offload: offload any remaining large tool bodies (including
 *            recent ones) to on-disk artifacts. Reversible.
 *   Tier B′ — tool-input clearing: offload large tool-CALL argument bodies on
 *            older turns (host-side equivalent of Anthropic `clear_tool_inputs`).
 *            Reversible.
 *   Tier C — summarization: collapse the whole history into a structured
 *            `<context_summary>` block, saving the full transcript to disk.
 *            Lossy but recoverable; runs once per run as a last resort.
 *
 * Anti-thrash: a cooldown between passes (ignored when usage is `critical`) and
 * a minimum-savings gate keep us from repeatedly breaking the prompt cache for
 * tiny wins.
 */

import { randomUUID } from 'node:crypto';
import type { ChatMessage, TimelineEvent } from '@shared/types/chat.js';
import type { ContextManagementSettings } from '@shared/settings/agentBehaviorSettings.js';
import { COMPACT_MIN_TOOL_INPUT_CHARS, COMPACT_MIN_TOOL_OUTPUT_CHARS } from '@shared/constants.js';
import { chatContentToText } from '@shared/text/chatContent.js';
import {
  resolveCompactionThresholds,
  scaleContextBreakdown,
  type ContextUsageSummary
} from '@shared/context/contextLevel.js';
import { logger } from '../../logging/logger.js';
import {
  type TokenizableToolSchema
} from '../../providers/tokenCounter.js';
import { CACHE_LAYER_HISTORY_START, isCacheLayeredTopology, migrateToCacheLayeredInPlace } from './buildContextLayers.js';
import {
  buildCompactionBanner,
  buildToolInputBanner,
  isCompactedToolContent,
  isCompactedToolInput,
  writeCompactionArtifact
} from './compactionArtifacts.js';
import {
  buildUsageFromTokens,
  evaluateContextBudget,
  estimatePromptTokensSync
} from './contextBudget.js';
import {
  buildContextSummaryMessage,
  isContextSummaryContent,
  summarizeHistory
} from './contextSummarize.js';
import { stripOldVisionParts } from './visionCompaction.js';

const log = logger.child('orch/contextReduction');

/** Below this many chars, clearing a tool result churns the cache for ~no gain. */
const CLEAR_MIN_CHARS = 512;
/** Hard cap on offloads per pass so a huge transcript can't stall a turn. */
const MAX_OFFLOADS_PER_PASS = 16;
/**
 * Minimum wall-clock between two lossy summarizations in one run. Rolling
 * summarization is allowed (a long run can refill and re-summarize), but a
 * model call per iteration would be wasteful and churn the cache — this paces
 * it. Bypassed by `force` (manual Compact / Reset).
 */
const SUMMARY_MIN_INTERVAL_MS = 30_000;

/** Per-run mutable reduction state (cooldown, one-time notices, rolling-summary pacing). */
export interface ContextReductionState {
  lastReductionAt: number;
  /** Wall-clock of the last lossy summarization (rolling-summary pacing). */
  lastSummaryAt: number;
  /** How many times this run has summarized (audit/metrics; rolling). */
  summaryCount: number;
  logged: boolean;
  noticeEmitted: boolean;
}

export function createContextReductionState(): ContextReductionState {
  return {
    lastReductionAt: 0,
    lastSummaryAt: 0,
    summaryCount: 0,
    logged: false,
    noticeEmitted: false
  };
}

export interface ReduceContextOpts {
  conversationId?: string;
  runId: string;
  workspacePath: string;
  modelId: string;
  providerId: string;
  settings: ContextManagementSettings;
  tools?: ReadonlyArray<TokenizableToolSchema>;
  signal?: AbortSignal;
  /**
   * Multiplicative calibration anchoring the local estimate to the provider's
   * real reported `usage.promptTokens` (see {@link evaluateContextBudget}).
   */
  calibrationRatio?: number;
  /**
   * Manual "Compact now": bypass the trigger / cooldown / min-savings gates
   * and aggressively free space via the reversible tiers, escalating to
   * summarization only if still above the real trigger after offload.
   */
  force?: boolean;
  /**
   * Timeline sink. Offloaded rows emit persisted `tool-compacted` markers and
   * a summary emits a persisted `context-summary` marker (so replay rebuilds
   * the lean form); the first reduction of a run emits one `agent-thought`.
   */
  emit: (event: TimelineEvent) => void;
}

function emitReductionNotice(opts: ReduceContextOpts, state: ContextReductionState): void {
  if (state.noticeEmitted) return;
  state.noticeEmitted = true;
  opts.emit({
    kind: 'agent-thought',
    id: randomUUID(),
    ts: Date.now(),
    content:
      'Context approaching the model window — older detail was offloaded to keep reasoning sharp. Full output stays available via `read`.',
    severity: 'info'
  });
}

/**
 * Reduce `messages` if the prompt has crossed the trigger threshold. Returns a
 * new array (never mutates the input). Pure no-op when disabled, when there is
 * no conversation context, when the topology is not cache-layered, or when
 * usage is below the trigger.
 */
export async function reduceContextIfNeeded(
  messages: readonly ChatMessage[],
  opts: ReduceContextOpts,
  state: ContextReductionState
): Promise<ReduceContextResult> {
  const { settings } = opts;
  const tools = opts.tools ?? [];
  const force = opts.force === true;

  const layeredMessages = messages.map((m) => ({ ...m }));
  migrateToCacheLayeredInPlace(layeredMessages);

  // Always evaluate first so the caller gets live usage telemetry even on the
  // no-op paths (disabled / no conversation / unmigratable topology) —
  // this is the single budget evaluation per iteration (no duplicate tokenize).
  let usage = await evaluateContextBudget({
    messages: layeredMessages,
    modelId: opts.modelId,
    providerId: opts.providerId,
    settings,
    tools,
    ...(opts.calibrationRatio !== undefined ? { calibrationRatio: opts.calibrationRatio } : {})
  });

  if (!settings.enabled) return { messages: layeredMessages, usage };
  if (!opts.conversationId) return { messages: layeredMessages, usage };
  if (!isCacheLayeredTopology(layeredMessages)) {
    return { messages: layeredMessages, usage };
  }

  if (!force && (usage.level === 'ok' || usage.level === 'warn')) {
    return { messages: layeredMessages, usage };
  }

  const critical = usage.level === 'critical';
  const now = Date.now();
  if (!force && !critical && now - state.lastReductionAt < settings.cooldownMs) {
    return { messages: layeredMessages, usage };
  }

  let workingMessages: readonly ChatMessage[] = layeredMessages;
  const visionStrip = stripOldVisionParts(workingMessages);
  if (visionStrip.didStrip) {
    workingMessages = visionStrip.messages;
    state.lastReductionAt = now;
    emitReductionNotice(opts, state);
    usage = await evaluateContextBudget({
      messages: workingMessages,
      modelId: opts.modelId,
      providerId: opts.providerId,
      settings,
      tools,
      ...(opts.calibrationRatio !== undefined ? { calibrationRatio: opts.calibrationRatio } : {})
    });
    if (!force && (usage.level === 'ok' || usage.level === 'warn')) {
      return { messages: [...workingMessages], usage };
    }
  }

  const effectiveWindow = usage.effectiveWindow;
  if (effectiveWindow <= 0) return { messages: [...workingMessages], usage };
  const { warnTokens: warnThreshold, triggerTokens: triggerThreshold } =
    resolveCompactionThresholds(effectiveWindow, {
      warnFraction: settings.warnFraction,
      triggerFraction: settings.triggerFraction
    });
  // Reversible offload stops once `est` drops below `offloadThreshold`. When
  // already in trigger/critical, aim for the warn band — not the trigger line —
  // so one new tool round doesn't immediately re-trip reduction. (Stopping at
  // the trigger line left est ~148k while trigger was 150k, which blocked
  // summarization AND let the prompt refill on the next iteration.)
  const offloadThreshold = force
    ? Math.min(triggerThreshold, Math.floor(usage.usedTokens * 0.5))
    : critical || usage.level === 'trigger'
      ? warnThreshold
      : triggerThreshold;

  const next = workingMessages.map((m) => ({ ...m }));
  const historyEnd = next.length - 2;

  // Index the tool rows in the history slice; the last `keepLastToolResults`
  // are protected from clearing (kept verbatim for the model's "rhythm").
  const toolIdx: number[] = [];
  for (let i = CACHE_LAYER_HISTORY_START; i < historyEnd; i++) {
    if (next[i]?.role === 'tool') toolIdx.push(i);
  }
  const keepN = Math.max(0, settings.keepLastToolResults);
  const protectedFrom = Math.max(0, toolIdx.length - keepN);
  const protectedSet = new Set(toolIdx.slice(protectedFrom));
  // Tool-CALL inputs before the first protected tool row are fair game for
  // offload; recent tool-call arguments stay verbatim for the model's rhythm.
  const protectedToolIdx = toolIdx.slice(protectedFrom);
  const protectedStartIdx = protectedToolIdx.length > 0 ? protectedToolIdx[0]! : historyEnd;

  // Rolling summarization: allowed more than once per run, but paced so a long
  // run that refills doesn't fire a model call every iteration.
  const summaryAllowed =
    settings.summarizationEnabled &&
    Boolean(opts.conversationId) &&
    (force || now - state.lastSummaryAt >= SUMMARY_MIN_INTERVAL_MS);

  // Min-savings gate (anti-thrash): when not forced, not critical and
  // summarization won't run, require a worthwhile amount of reclaimable text
  // before breaking the prompt cache.
  if (!force && !critical && !summaryAllowed) {
    let reclaimableChars = 0;
    for (const i of toolIdx) {
      const c = next[i]?.content;
      if (typeof c !== 'string' || isCompactedToolContent(c)) continue;
      const minChars = protectedSet.has(i) ? COMPACT_MIN_TOOL_OUTPUT_CHARS : CLEAR_MIN_CHARS;
      if (c.length >= minChars) reclaimableChars += c.length;
    }
    // Count reclaimable tool-CALL argument bodies too (host-side clear_tool_inputs).
    for (let i = CACHE_LAYER_HISTORY_START; i < protectedStartIdx; i++) {
      const m = next[i];
      if (m?.role !== 'assistant' || !Array.isArray(m.tool_calls)) continue;
      for (const tc of m.tool_calls) {
        const a = tc.function?.arguments;
        if (typeof a === 'string' && !isCompactedToolInput(a) && a.length >= COMPACT_MIN_TOOL_INPUT_CHARS) {
          reclaimableChars += a.length;
        }
      }
    }
    if (Math.ceil(reclaimableChars / 4) < settings.minSavingsTokens) {
      return { messages: [...messages], usage };
    }
  }

  // Anchor the in-loop raw estimate to the SAME scale as the budget's
  // `usedTokens` — which may already incorporate calibration to the provider's
  // real billed tokens and/or a remote count. The offload/summarization
  // thresholds derive from the calibrated budget, so comparing them against a
  // raw (uncalibrated) estimate would be wrong: once the calibration ratio
  // diverges from 1, the loop could see `trigger` yet immediately break
  // (raw est < threshold) and reduce nothing. `anchorRatio` keeps the running
  // estimate and the per-row savings on the budget's scale.
  const rawTotal = estimatePromptTokensSync(opts.modelId, next, tools).tokens;
  const anchorRatio = rawTotal > 0 ? usage.usedTokens / rawTotal : 1;
  const scaleToBudget = (raw: number): number => Math.round(raw * anchorRatio);

  let est = scaleToBudget(rawTotal);
  let offloads = 0;
  let saved = 0;
  let changed = false;

  for (const i of toolIdx) {
    if (est < offloadThreshold) break;
    if (offloads >= MAX_OFFLOADS_PER_PASS) break;
    const msg = next[i];
    const content = msg?.content;
    if (typeof content !== 'string') continue;
    if (isCompactedToolContent(content)) continue;
    if (!msg.tool_call_id) continue;
    const isProtected = protectedSet.has(i);
    const minChars = isProtected ? COMPACT_MIN_TOOL_OUTPUT_CHARS : CLEAR_MIN_CHARS;
    if (content.length < minChars) continue;

    const relativePath = await writeCompactionArtifact(
      opts.workspacePath,
      opts.conversationId,
      opts.runId,
      msg.tool_call_id,
      content
    );
    const banner = buildCompactionBanner(relativePath);
    next[i] = { ...msg, content: banner };
    const rawRowSaved =
      estimatePromptTokensSync(opts.modelId, [{ role: 'tool', content }]).tokens -
      estimatePromptTokensSync(opts.modelId, [{ role: 'tool', content: banner }]).tokens;
    const rowSaved = scaleToBudget(Math.max(0, rawRowSaved));
    saved += rowSaved;
    est = Math.max(0, est - rowSaved);
    offloads += 1;
    changed = true;

    opts.emit({
      kind: 'tool-compacted',
      id: randomUUID(),
      ts: Date.now(),
      runId: opts.runId,
      toolCallId: msg.tool_call_id,
      relativePath,
      originalChars: content.length,
      reason: isProtected ? 'size' : 'clear',
      tokensRemoved: rowSaved
    });
  }

  // Tier B′ — tool-CALL input clearing (host-side `clear_tool_inputs`). Large
  // tool-call argument bodies (e.g. a big `edit` newText) persist in history
  // long after the call ran; offload the oldest ones reversibly to disk.
  for (let i = CACHE_LAYER_HISTORY_START; i < protectedStartIdx; i++) {
    if (est < offloadThreshold) break;
    if (offloads >= MAX_OFFLOADS_PER_PASS) break;
    const msg = next[i];
    if (msg?.role !== 'assistant' || !Array.isArray(msg.tool_calls)) continue;

    let mutatedAny = false;
    const newToolCalls = msg.tool_calls.map((tc) => tc);
    for (let c = 0; c < newToolCalls.length; c++) {
      if (est < offloadThreshold) break;
      if (offloads >= MAX_OFFLOADS_PER_PASS) break;
      const tc = newToolCalls[c]!;
      const args = tc.function?.arguments;
      if (!tc.id || typeof args !== 'string') continue;
      if (isCompactedToolInput(args)) continue;
      if (args.length < COMPACT_MIN_TOOL_INPUT_CHARS) continue;

      const relativePath = await writeCompactionArtifact(
        opts.workspacePath,
        opts.conversationId,
        opts.runId,
        tc.id,
        args,
        'input'
      );
      const banner = buildToolInputBanner(relativePath);
      newToolCalls[c] = { ...tc, function: { ...tc.function, arguments: banner } };
      mutatedAny = true;
      const rawRowSaved =
        estimatePromptTokensSync(opts.modelId, [
          { role: 'assistant', content: null, tool_calls: [tc] }
        ]).tokens -
        estimatePromptTokensSync(opts.modelId, [
          { role: 'assistant', content: null, tool_calls: [newToolCalls[c]!] }
        ]).tokens;
      const rowSaved = scaleToBudget(Math.max(0, rawRowSaved));
      saved += rowSaved;
      est = Math.max(0, est - rowSaved);
      offloads += 1;
      changed = true;

      opts.emit({
        kind: 'tool-compacted',
        id: randomUUID(),
        ts: Date.now(),
        runId: opts.runId,
        toolCallId: tc.id,
        relativePath,
        originalChars: args.length,
        reason: 'input'
      });
    }
    if (mutatedAny) next[i] = { ...msg, tool_calls: newToolCalls };
  }

  // Tier C — last-resort lossy summarization of the whole history slice.
  // Fire when we entered hot and reversible tiers did not get us back to a safe
  // band (warn). The old gate (`est >= triggerThreshold` after offloads) was
  // unreachable whenever offloads worked — they stop once `est < trigger`.
  const enteredHot =
    force || usage.level === 'trigger' || usage.level === 'critical';
  const shouldSummarize =
    summaryAllowed &&
    Boolean(opts.conversationId) &&
    enteredHot &&
    est >= warnThreshold;
  if (shouldSummarize) {
    const histSlice = next.slice(CACHE_LAYER_HISTORY_START, next.length - 2);
    const summarizable = histSlice.some(
      (m) => !isContextSummaryContent(chatContentToText(m.content))
    );
    if (summarizable) {
      const summaryModel = settings.summaryModel;
      const result = await summarizeHistory({
        history: histSlice,
        providerId: summaryModel?.providerId ?? opts.providerId,
        modelId: summaryModel?.modelId ?? opts.modelId,
        conversationId: opts.conversationId,
        runId: opts.runId,
        workspacePath: opts.workspacePath,
        ...(opts.signal ? { signal: opts.signal } : {})
      });
      if (result) {
        const summaryMsg: ChatMessage = {
          role: 'user',
          content: buildContextSummaryMessage(result.summary, result.relativePath)
        };
        next.splice(
          CACHE_LAYER_HISTORY_START,
          histSlice.length,
          summaryMsg
        );
        state.lastSummaryAt = now;
        state.summaryCount += 1;
        changed = true;
        const summaryTokensRemoved = Math.max(
          0,
          estimatePromptTokensSync(opts.modelId, histSlice).tokens -
            estimatePromptTokensSync(opts.modelId, [summaryMsg]).tokens
        );
        saved += summaryTokensRemoved;
        opts.emit({
          kind: 'context-summary',
          id: randomUUID(),
          ts: Date.now(),
          runId: opts.runId,
          summary: result.summary,
          relativePath: result.relativePath,
          originalChars: result.originalChars,
          originalMessages: result.originalMessages,
          ...(summaryTokensRemoved > 0 ? { tokensRemoved: summaryTokensRemoved } : {})
        });
        log.info('context summarized', {
          runId: opts.runId,
          conversationId: opts.conversationId,
          originalMessages: result.originalMessages,
          originalChars: result.originalChars
        });
      }
    }
  }

  if (!changed) return { messages: [...messages], usage };

  state.lastReductionAt = now;
  emitReductionNotice(opts, state);
  if (!state.logged) {
    state.logged = true;
    log.info('context reduction active', {
      runId: opts.runId,
      conversationId: opts.conversationId,
      usedBefore: usage.usedTokens,
      triggerThreshold,
      effectiveWindow,
      offloads,
      saved,
      force
    });
  }
  return {
    messages: next,
    usage: buildPostReductionUsage(next, opts, usage.advertisedWindow, anchorRatio),
    tokensRemoved: saved > 0 ? saved : undefined
  };
}

/**
 * Recompute usage AFTER reduction so the caller's telemetry reflects the lean
 * prompt the model will actually receive. Synchronous (no provider lookup):
 * reuses the advertised window from the pre-reduction evaluation and the same
 * `anchorRatio` used for the in-loop estimate — so it carries forward whatever
 * calibration / remote-count correction the pre-reduction budget applied
 * (avoids the meter jumping when the lean prompt is re-measured raw).
 */
function buildPostReductionUsage(
  messages: readonly ChatMessage[],
  opts: ReduceContextOpts,
  advertisedWindow: number,
  anchorRatio: number
): ContextUsageSummary {
  const ratio = Number.isFinite(anchorRatio) && anchorRatio > 0 ? anchorRatio : 1;
  const est = estimatePromptTokensSync(opts.modelId, messages, opts.tools ?? []);
  const used = Math.round(est.tokens * ratio);
  return buildUsageFromTokens({
    usedTokens: used,
    exact: est.exact || ratio !== 1,
    advertisedWindow,
    settings: opts.settings,
    breakdown: scaleContextBreakdown(est.breakdown, est.tokens, used)
  });
}

/** Result of a reduction pass: the (possibly reduced) messages + post-reduction usage. */
export interface ReduceContextResult {
  messages: ChatMessage[];
  usage: ContextUsageSummary;
  /** Tokens removed from the prompt when reduction ran. */
  tokensRemoved?: number;
}

export { isCompactedToolContent, buildCompactionBanner };

/**
 * In-place context reset for the manual "Reset context" control: summarize the
 * ENTIRE history slice into a single structured block and continue from it
 * (mirrors Claude Code `/compact`). Always runs summarization regardless of
 * thresholds. Returns the reduced messages, or the original when there is
 * nothing to summarize or the model call fails.
 */
export async function resetContextToSummary(
  messages: readonly ChatMessage[],
  opts: ReduceContextOpts,
  state: ContextReductionState
): Promise<ChatMessage[]> {
  if (!opts.conversationId) return [...messages];

  const next = messages.map((m) => ({ ...m }));
  migrateToCacheLayeredInPlace(next);
  if (!isCacheLayeredTopology(next)) return [...messages];
  const histSlice = next.slice(CACHE_LAYER_HISTORY_START, next.length - 2);
  const summarizable = histSlice.some(
    (m) => !isContextSummaryContent(chatContentToText(m.content))
  );
  if (!summarizable) return [...messages];

  const summaryModel = opts.settings.summaryModel;
  const result = await summarizeHistory({
    history: histSlice,
    providerId: summaryModel?.providerId ?? opts.providerId,
    modelId: summaryModel?.modelId ?? opts.modelId,
    conversationId: opts.conversationId,
    runId: opts.runId,
    workspacePath: opts.workspacePath,
    ...(opts.signal ? { signal: opts.signal } : {})
  });
  if (!result) return [...messages];

  const summaryMsg: ChatMessage = {
    role: 'user',
    content: buildContextSummaryMessage(result.summary, result.relativePath)
  };
  next.splice(CACHE_LAYER_HISTORY_START, histSlice.length, summaryMsg);
  const nowTs = Date.now();
  state.lastSummaryAt = nowTs;
  state.summaryCount += 1;
  state.lastReductionAt = nowTs;
  const summaryTokensRemoved = Math.max(
    0,
    estimatePromptTokensSync(opts.modelId, histSlice).tokens -
      estimatePromptTokensSync(opts.modelId, [summaryMsg]).tokens
  );
  opts.emit({
    kind: 'context-summary',
    id: randomUUID(),
    ts: Date.now(),
    runId: opts.runId,
    summary: result.summary,
    relativePath: result.relativePath,
    originalChars: result.originalChars,
    originalMessages: result.originalMessages,
    ...(summaryTokensRemoved > 0 ? { tokensRemoved: summaryTokensRemoved } : {})
  });
  log.info('context reset via summary', {
    runId: opts.runId,
    conversationId: opts.conversationId,
    originalMessages: result.originalMessages
  });
  return next;
}
