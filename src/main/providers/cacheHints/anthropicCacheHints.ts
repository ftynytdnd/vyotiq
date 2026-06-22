/**
 * Anthropic prompt caching — explicit breakpoints + automatic rolling.
 * @see https://platform.claude.com/docs/en/build-with-claude/prompt-caching
 */

import type { ChatMessage } from '@shared/types/chat.js';
import {
  CACHE_LAYER_WORKSPACE_INDEX,
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
