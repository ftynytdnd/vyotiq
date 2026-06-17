/**
 * Builds the request body the orchestrator sends to `streamChat`. The
 * orchestrator's tool catalogue is intentionally restricted to the
 * `AGENT_TOOLS` policy.
 * Tools are offered with `tool_choice: 'auto'` so the model may answer
 * in prose or call `finish` / `ask_user` / `ls` / etc.
 * when appropriate. The host accepts a substantive prose-only turn as
 * an implicit finish (see `runLoop` empty-turn handling).
 *
 * On the iteration-cap synthesis turn (`wrapUp`), tool calling is
 * disabled with `tool_choice: 'none'` so the provider emits final prose
 * — except for thinking models that reject a `tool_choice` field, where
 * we instead DROP the tools array entirely (no tools ⇒ prose) and omit
 * `tool_choice`.
 *
 * Thinking-mode `tool_choice` safety (2026): DeepSeek V4 returns HTTP
 * 400 for any forced/required `tool_choice` while thinking. When the
 * resolved per-model effort marks the model as such
 * (`supportsToolChoice === false`), we omit `toolChoice` so the
 * transport sends no field and the server falls back to its `auto`
 * default.
 *
 * Phase 7 (2026): `conversationId` is threaded through so xAI Grok
 * hosts get the `x-grok-conv-id` cache-attribution header.
 */

import type { ChatStreamRequest } from '../../providers/chatClient.js';
import type { ChatMessage } from '@shared/types/chat.js';
import type {
  ModelSelection,
  ModelThinkingCapabilities,
  ProviderDialect,
  ThinkingEffort
} from '@shared/types/provider.js';
import { toolSchemasFor } from '../../tools/registry.js';
import { AGENT_TOOLS } from '../../tools/policy/index.js';
import { supportsParallelToolCalls, supportsToolChoice } from '../../providers/capabilities.js';
import { redactChatMessagesForProvider } from '../context/redactChatMessagesForProvider.js';

/**
 * Synthesis instruction for the iteration-cap wrap-up turn. Tool calling
 * is disabled (`tool_choice: 'none'`); this trailing message tells the
 * model to deliver its final answer as plain text now.
 */
const SYNTHESIS_INSTRUCTION =
  'This is the final turn and tool calling is disabled. Write the complete, ' +
  'user-facing answer for the task now as plain text — summarize what was ' +
  'done, what was found, and any remaining caveats.';

/** Merge wrap-up prose into the turn slot so cache-layered indices stay stable. */
function appendWrapUpInstruction(messages: readonly ChatMessage[]): ChatMessage[] {
  const copy = [...messages];
  const last = copy[copy.length - 1];
  if (last?.role === 'user') {
    const prev = typeof last.content === 'string' ? last.content : '';
    copy[copy.length - 1] = { role: 'user', content: `${prev}\n\n${SYNTHESIS_INSTRUCTION}` };
    return copy;
  }
  return [...copy, { role: 'user', content: SYNTHESIS_INSTRUCTION }];
}

export function buildOrchestratorRequest(opts: {
  selection: ModelSelection;
  messages: ChatMessage[];
  signal: AbortSignal;
  /** Provider wire dialect — parallel tool_calls hint + tool_choice gate. */
  dialect?: ProviderDialect;
  /** Final synthesis turn (iteration cap without `finish`). */
  wrapUp?: boolean;
  /** Resolved per-model thinking effort (drives the tool_choice gate). */
  reasoningEffort?: ThinkingEffort;
  /** Discovered thinking capabilities for the selected model. */
  modelThinkingCaps?: ModelThinkingCapabilities;
  /**
   * Run-scoped override set by `runLoop` after a provider 400 that
   * rejected `tool_choice`. Forces the field to be omitted even when the
   * static capability check thought it was safe (handles models we
   * didn't classify ahead of time).
   */
  omitToolChoice?: boolean;
  conversationId?: string;
  workspaceId?: string;
  /** Override default AGENT_TOOLS catalogue (phased per-phase allowlist). */
  agentTools?: readonly string[];
  previousAnthropicMessageId?: string | null;
  /**
   * Opportunistic Anthropic native context-editing backstop. Set by `runLoop`
   * only when host context management is enabled and the provider speaks the
   * Anthropic dialect. Ignored by every other dialect.
   */
  anthropicContextEditing?: {
    keepToolUses: number;
    triggerInputTokens: number;
    clearAtLeastTokens?: number;
    clearToolInputs?: boolean;
    excludeTools?: readonly string[];
    serverCompaction?: { triggerTokens: number };
  };
}): ChatStreamRequest {
  // Thinking models that reject a `tool_choice` field (DeepSeek V4):
  // omit the field on every turn, and on wrap-up drop the tools array
  // instead of sending `tool_choice: 'none'` (which they also reject).
  const toolChoiceSafe =
    !opts.omitToolChoice &&
    supportsToolChoice(
      opts.dialect,
      opts.selection.modelId,
      opts.reasoningEffort,
      opts.modelThinkingCaps
    );

  let toolChoice: 'none' | 'auto' | undefined;
  if (opts.wrapUp) {
    toolChoice = toolChoiceSafe ? 'none' : undefined;
  } else {
    toolChoice = toolChoiceSafe ? 'auto' : undefined;
  }

  // Wrap-up forces prose. Capable models keep the tool schema present
  // and rely on `tool_choice: 'none'`; tool_choice-rejecting models get
  // an empty tool list so there is nothing to call.
  const toolNames = opts.agentTools ?? AGENT_TOOLS;
  const tools =
    opts.wrapUp && !toolChoiceSafe ? [] : toolSchemasFor(toolNames);

  const rawMessages = opts.wrapUp ? appendWrapUpInstruction(opts.messages) : opts.messages;
  const messages = redactChatMessagesForProvider(rawMessages);

  return {
    providerId: opts.selection.providerId,
    model: opts.selection.modelId,
    messages,
    tools,
    ...(toolChoice !== undefined ? { toolChoice } : {}),
    ...(opts.reasoningEffort !== undefined ? { reasoningEffort: opts.reasoningEffort } : {}),
    ...(supportsParallelToolCalls(opts.dialect) && !opts.wrapUp
      ? { parallelToolCalls: true }
      : {}),
    signal: opts.signal,
    ...(opts.conversationId !== undefined
      ? { conversationId: opts.conversationId }
      : {}),
    ...(opts.workspaceId !== undefined ? { workspaceId: opts.workspaceId } : {}),
    ...(opts.previousAnthropicMessageId !== undefined
      ? { previousAnthropicMessageId: opts.previousAnthropicMessageId }
      : {}),
    ...(opts.anthropicContextEditing !== undefined && !opts.wrapUp
      ? { anthropicContextEditing: opts.anthropicContextEditing }
      : {})
  };
}
