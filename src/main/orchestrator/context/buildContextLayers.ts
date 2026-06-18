/**
 * Cache-aware context layer builders. Static prefix at the top;
 * volatile runtime data at the message tail (see project.md § caching).
 */

import type { ChatContentPart, ChatMessage } from '@shared/types/chat.js';
import type { ContextLevel } from '@shared/context/contextLevel.js';
import type { ContextEnvelopes } from '../contextManager.js';
import { buildStaticFewShotXml } from '../../harness/harnessLoader.js';
import { wrapXml } from '../envelope/index.js';

/** Minimum messages for cache-layered topology (no transcript history). */
export const CACHE_LAYERED_MIN_MESSAGES = 5;

/** Fixed indices in the cache-layered layout. */
export const CACHE_LAYER_FEW_SHOT_INDEX = 1;
export const CACHE_LAYER_WORKSPACE_INDEX = 2;
export const CACHE_LAYER_HISTORY_START = 3;

/**
 * True when `messages` uses the cache-layered layout:
 *   [0] system (harness + meta_rules)
 *   [1] user (static few-shot examples)
 *   [2] user (workspace)
 *   [3..n-4] history
 *   [n-2] user (runtime)
 *   [n-1] user (turn)
 */
export function isCacheLayeredTopology(messages: readonly ChatMessage[]): boolean {
  if (messages.length < CACHE_LAYERED_MIN_MESSAGES) return false;
  const runtimeIdx = messages.length - 2;
  const turnIdx = messages.length - 1;
  return (
    messages[0]?.role === 'system' &&
    messages[CACHE_LAYER_FEW_SHOT_INDEX]?.role === 'user' &&
    messages[CACHE_LAYER_WORKSPACE_INDEX]?.role === 'user' &&
    messages[runtimeIdx]?.role === 'user' &&
    messages[turnIdx]?.role === 'user'
  );
}

/** Pre–few-shot-slot topology: workspace at index 1, no slot at index 2. */
export function isLegacyCacheLayeredTopology(messages: readonly ChatMessage[]): boolean {
  if (messages.length < 4) return false;
  const runtimeIdx = messages.length - 2;
  const turnIdx = messages.length - 1;
  if (messages[0]?.role !== 'system' || messages[1]?.role !== 'user') return false;
  if (messages[runtimeIdx]?.role !== 'user' || messages[turnIdx]?.role !== 'user') return false;
  if (messages.length >= 5 && messages[CACHE_LAYER_WORKSPACE_INDEX]?.role === 'user') return false;
  return true;
}

/** Boot-cached harness + user meta-rules (stable system prefix). */
export function buildStaticSystemPrefix(harness: string, metaRulesXml: string): string {
  const parts = [harness, metaRulesXml].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0
  );
  return parts.join('\n\n');
}

/**
 * Volatile per-iteration runtime envelope at the message tail. Order places
 * the agent-maintained `<run_progress>` and the `<goal_anchor>` LAST — closest
 * to the `<turn>` slot — so the original task and current progress get the
 * model's strongest (recency) attention even after reversible reduction or
 * summarization has reshaped the middle of the history (counters
 * lost-in-the-middle).
 */
export function buildRuntimeTailXml(
  hostEnvironmentXml: string,
  runStateXml: string,
  env: Pick<
    ContextEnvelopes,
    'sessionXml' | 'priorConversationsXml' | 'memoryXml' | 'runProgressXml'
  >,
  goalAnchorXml?: string,
  contextPressureXml?: string
): string {
  const inner = [
    hostEnvironmentXml,
    env.sessionXml,
    runStateXml,
    env.priorConversationsXml,
    env.memoryXml,
    env.runProgressXml,
    // Pressure note + goal anchor sit LAST (highest recency attention) so the
    // model acts on them before the volatile `<turn>` slot.
    contextPressureXml ?? '',
    goalAnchorXml ?? ''
  ]
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .join('\n\n');
  return wrapXml('runtime_context', inner);
}

/**
 * Build the `<context_pressure>` note surfaced near the tail when the prompt
 * approaches the compaction threshold. Mirrors Anthropic's memory-tool "heads up,
 * older detail is about to be cleared" warning: it nudges the agent to persist
 * load-bearing state (via `memory` / the `run-progress` note) BEFORE host-side
 * reduction offloads older detail — so nothing important is lost when the
 * working context is trimmed. Returns '' below the warn threshold.
 */
export function buildContextPressureXml(level: ContextLevel): string {
  if (level === 'ok') return '';
  const body =
    level === 'critical'
      ? 'Context is at the compaction threshold. Older detail is being offloaded to keep reasoning sharp. Persist anything load-bearing NOW to your `run-progress` note (via the `memory` tool) — file paths, key decisions, and the exact next step — and prefer finishing or narrowing scope over starting new exploration.'
      : level === 'trigger'
        ? 'Context has crossed the reduction threshold; older tool output is being offloaded reversibly (recoverable via `read`). Make sure your `run-progress` note captures the current plan, decisions, and next step so progress survives compaction.'
        : 'Context is filling up. Keep your `run-progress` note current (plan, key decisions, next step) so nothing important is lost if older detail is offloaded.';
  return wrapXml('context_pressure', body);
}

export interface ApplyCacheLayersOpts {
  harness: string;
  env: ContextEnvelopes;
  runStateXml: string;
  hostEnvironmentXml: string;
  /**
   * `<goal_anchor>` — the original task restated near the tail every turn so
   * it survives reduction. Optional for back-compat with callers/tests.
   */
  goalAnchorXml?: string;
  /**
   * `<context_pressure>` — proactive note telling the agent to persist
   * load-bearing state before reduction trims older detail. Empty/omitted
   * below the warn threshold.
   */
  contextPressureXml?: string;
}

/** Migrate legacy `[system, …history, turn]` arrays in place. */
export function migrateToCacheLayeredInPlace(messages: ChatMessage[]): void {
  if (isCacheLayeredTopology(messages)) return;
  if (isLegacyCacheLayeredTopology(messages)) {
    messages.splice(CACHE_LAYER_FEW_SHOT_INDEX, 0, { role: 'user', content: '' });
    return;
  }
  if (messages.length < 2) return;
  const turn = messages[messages.length - 1];
  if (turn?.role !== 'user') return;
  const turnContent = typeof turn.content === 'string' ? turn.content : '';
  const history = messages.slice(1, -1);
  const next = seedCacheLayeredMessages(history, turnContent);
  messages.length = 0;
  messages.push(...next);
}

/**
 * Updates cache-layered slots in an existing `messages` array in place.
 * Expects topology from `seedCacheLayeredMessages`.
 */
export function applyCacheLayers(messages: ChatMessage[], opts: ApplyCacheLayersOpts): void {
  migrateToCacheLayeredInPlace(messages);
  if (!isCacheLayeredTopology(messages)) return;
  const runtimeIdx = messages.length - 2;
  messages[0] = {
    role: 'system',
    content: buildStaticSystemPrefix(opts.harness, opts.env.metaRulesXml)
  };
  messages[CACHE_LAYER_FEW_SHOT_INDEX] = { role: 'user', content: buildStaticFewShotXml() };
  messages[CACHE_LAYER_WORKSPACE_INDEX] = { role: 'user', content: opts.env.workspaceXml };
  messages[runtimeIdx] = {
    role: 'user',
    content: buildRuntimeTailXml(
      opts.hostEnvironmentXml,
      opts.runStateXml,
      opts.env,
      opts.goalAnchorXml,
      opts.contextPressureXml
    )
  };
}

/**
 * Seeds the cache-layered message array for a new run.
 * Static slots are filled on the first loop iteration via `applyCacheLayers`.
 */
export function seedCacheLayeredMessages(
  replayed: ChatMessage[],
  turnEnvelope: string | ChatContentPart[]
): ChatMessage[] {
  return [
    { role: 'system', content: '' },
    { role: 'user', content: '' },
    { role: 'user', content: '' },
    ...replayed,
    { role: 'user', content: '' },
    { role: 'user', content: turnEnvelope }
  ];
}

/**
 * Index where growing transcript rows (assistant / tool) must be inserted
 * so runtime `[n-2]` and turn `[n-1]` stay at the tail.
 */
export function historyInsertIndex(messages: ChatMessage[]): number {
  if (isCacheLayeredTopology(messages)) {
    return messages.length - 2;
  }
  return messages.length;
}

/** Insert history rows before the volatile runtime + turn tail slots. */
export function insertHistoryBeforeTail(messages: ChatMessage[], ...rows: ChatMessage[]): void {
  if (rows.length === 0) return;
  const idx = historyInsertIndex(messages);
  messages.splice(idx, 0, ...rows);
}

/**
 * Extract static system text for providers that hoist system separately
 * (Anthropic, Gemini). Falls back to legacy single-system content.
 */
export function extractStaticSystemForWire(messages: readonly ChatMessage[]): string {
  if (!isCacheLayeredTopology(messages)) {
    const sys = messages.find((m) => m.role === 'system');
    return typeof sys?.content === 'string' ? sys.content : '';
  }
  return typeof messages[0]?.content === 'string' ? messages[0].content : '';
}

/** Static few-shot user block (cache-layer index 1). */
export function extractFewShotBlock(messages: readonly ChatMessage[]): string | undefined {
  if (!isCacheLayeredTopology(messages)) return undefined;
  const content = messages[CACHE_LAYER_FEW_SHOT_INDEX]?.content;
  return typeof content === 'string' && content.length > 0 ? content : undefined;
}

/** Workspace user block for explicit Anthropic cache breakpoint. */
export function extractWorkspaceBlock(messages: readonly ChatMessage[]): string | undefined {
  if (!isCacheLayeredTopology(messages)) return undefined;
  const content = messages[CACHE_LAYER_WORKSPACE_INDEX]?.content;
  return typeof content === 'string' && content.length > 0 ? content : undefined;
}

/**
 * Static prefix parts for Gemini `systemInstruction` when cache-layered:
 * harness + meta_rules, few-shot examples, then workspace context.
 */
export function buildGeminiStaticInstructionTexts(messages: readonly ChatMessage[]): string[] {
  const parts: string[] = [];
  const staticSys = extractStaticSystemForWire(messages);
  if (staticSys.trim().length > 0) parts.push(staticSys);
  const fewShot = extractFewShotBlock(messages);
  if (fewShot) parts.push(fewShot);
  const workspace = extractWorkspaceBlock(messages);
  if (workspace) parts.push(workspace);
  return parts;
}
