/**
 * Anthropic prompt caching — explicit breakpoints + automatic rolling.
 * @see https://platform.claude.com/docs/en/build-with-claude/prompt-caching
 */

import { chatContentToText } from '@shared/text/chatContent.js';
import type { ChatMessage } from '@shared/types/chat.js';
import {
  CACHE_LAYER_FEW_SHOT_INDEX,
  CACHE_LAYER_WORKSPACE_INDEX,
  CACHE_LAYERED_MIN_MESSAGES,
  extractStaticSystemForWire,
  isCacheLayeredTopology
} from '../../orchestrator/context/buildContextLayers.js';
import { getPromptCachingSettings } from '../../settings/promptCachingRuntime.js';

/** Default 1h TTL for long agent sessions (2026 Anthropic extended cache). */
export const ANTHROPIC_EPHEMERAL_CACHE = { type: 'ephemeral' as const, ttl: '1h' as const };

export const ANTHROPIC_EPHEMERAL_CACHE_5M = { type: 'ephemeral' as const };

export function resolveAnthropicCacheControl(): AnthropicCacheControl {
  return getPromptCachingSettings().anthropicCacheTtl === '5m'
    ? ANTHROPIC_EPHEMERAL_CACHE_5M
    : ANTHROPIC_EPHEMERAL_CACHE;
}

export type AnthropicCacheControl =
  | typeof ANTHROPIC_EPHEMERAL_CACHE
  | typeof ANTHROPIC_EPHEMERAL_CACHE_5M;

export interface AnthropicSystemBlock {
  type: 'text';
  text: string;
  cache_control?: AnthropicCacheControl;
}

/** Build cache-marked system blocks from internal messages. */
export function buildAnthropicSystemBlocks(
  messages: readonly ChatMessage[],
  legacySystem: string
): AnthropicSystemBlock[] {
  const staticText = extractStaticSystemForWire(messages) || legacySystem;
  if (!staticText.trim()) return [];
  return [
    {
      type: 'text',
      text: staticText,
      cache_control: resolveAnthropicCacheControl()
    }
  ];
}

type WireMessage = { role: string; content: Array<Record<string, unknown>> };

function markUserTextCache(wireMessages: WireMessage[], text: string): void {
  const userMsg = wireMessages.find(
    (m) =>
      m.role === 'user' &&
      m.content.some(
        (block) => block['type'] === 'text' && block['text'] === text
      )
  );
  const block = userMsg?.content.find((b) => b['type'] === 'text' && b['text'] === text);
  if (block) block['cache_control'] = resolveAnthropicCacheControl();
}

/** Mark few-shot user block (index 1) when cache-layered. */
export function markFewShotUserCache(
  wireMessages: WireMessage[],
  sourceMessages: readonly ChatMessage[]
): void {
  if (!isCacheLayeredTopology(sourceMessages)) return;
  const fewShot = sourceMessages[CACHE_LAYER_FEW_SHOT_INDEX]?.content;
  if (typeof fewShot !== 'string' || fewShot.length === 0) return;
  markUserTextCache(wireMessages, fewShot);
}

/** Mark workspace user block when cache-layered. */
export function markWorkspaceUserCache(
  wireMessages: WireMessage[],
  sourceMessages: readonly ChatMessage[]
): void {
  if (!isCacheLayeredTopology(sourceMessages)) return;
  const workspace = sourceMessages[CACHE_LAYER_WORKSPACE_INDEX]?.content;
  if (typeof workspace !== 'string' || workspace.length === 0) return;
  markUserTextCache(wireMessages, workspace);
}

/** Apply cache_control to the last tool definition. */
export function markAnthropicToolCache(tools: Record<string, unknown>[]): void {
  if (tools.length === 0) return;
  const last = tools[tools.length - 1];
  if (last) last['cache_control'] = resolveAnthropicCacheControl();
}

/** Top-level automatic rolling breakpoint for growing history. */
export function applyAnthropicAutomaticCache(body: Record<string, unknown>): void {
  body['cache_control'] = resolveAnthropicCacheControl();
}

function markHistoryBlockCache(msg: WireMessage): void {
  for (let i = msg.content.length - 1; i >= 0; i--) {
    const block = msg.content[i];
    const type = block?.['type'];
    if (type === 'text' || type === 'tool_use' || type === 'tool_result') {
      block['cache_control'] = resolveAnthropicCacheControl();
      return;
    }
  }
}

function wireMessageMatchesHistory(
  wire: WireMessage,
  hist: ChatMessage,
  runtimeText: string,
  turnText: string
): boolean {
  if (hist.role === 'user') {
    const text = chatContentToText(hist.content);
    if (text === runtimeText || text === turnText) return false;
    const block = wire.content.find((b) => b['type'] === 'text');
    return block?.['text'] === text;
  }
  if (hist.role === 'assistant') {
    const text = typeof hist.content === 'string' ? hist.content : '';
    const textBlock = wire.content.find((b) => b['type'] === 'text');
    if (text.length > 0 && textBlock?.['text'] === text) return true;
    if (hist.tool_calls && hist.tool_calls.length > 0) {
      const toolBlock = wire.content.find((b) => b['type'] === 'tool_use');
      return toolBlock?.['name'] === hist.tool_calls[0]?.function.name;
    }
  }
  if (hist.role === 'tool') {
    const block = wire.content.find((b) => b['type'] === 'tool_result');
    const content = typeof hist.content === 'string' ? hist.content : '';
    return block?.['content'] === content;
  }
  return false;
}

/**
 * Explicit breakpoint on the last stable history message before runtime/turn.
 * Not used on the wire path — Anthropic allows ≤4 explicit breakpoints; we
 * reserve them for system, few-shot, workspace, and tools (rolling via top-level auto).
 */
export function markHistoryCacheBreakpoint(
  wireMessages: WireMessage[],
  sourceMessages: readonly ChatMessage[]
): void {
  if (!isCacheLayeredTopology(sourceMessages)) return;
  if (sourceMessages.length <= CACHE_LAYERED_MIN_MESSAGES) return;

  const runtimeText = chatContentToText(sourceMessages[sourceMessages.length - 2]?.content);
  const turnText = chatContentToText(sourceMessages[sourceMessages.length - 1]?.content);
  const lastHist = sourceMessages[sourceMessages.length - 3];
  if (!lastHist) return;

  for (let i = wireMessages.length - 1; i >= 0; i--) {
    const wm = wireMessages[i];
    if (wireMessageMatchesHistory(wm, lastHist, runtimeText, turnText)) {
      markHistoryBlockCache(wm);
      return;
    }
  }
}
