/**
 * Builds the request body the orchestrator sends to `streamChat`. The
 * orchestrator's tool catalogue is intentionally restricted to the
 * `ORCHESTRATOR_TOOLS` policy — no `bash`, no `edit`, no `search`.
 * Tools are offered with `tool_choice: 'auto'` so the model may answer
 * in prose or call `delegate` / `finish` / `ask_user` / `ls` / etc.
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
import type { ModelSelection, ProviderDialect, ThinkingEffort } from '@shared/types/provider.js';
import { toolSchemasFor } from '../../tools/registry.js';
import { ORCHESTRATOR_TOOLS } from '../../tools/policy/index.js';
import { supportsParallelToolCalls, supportsToolChoice } from '../../providers/capabilities.js';

/**
 * Synthesis instruction for the iteration-cap wrap-up turn. Tool calling
 * is disabled (`tool_choice: 'none'`); this trailing message tells the
 * model to deliver its final answer as plain text now.
 */
const SYNTHESIS_INSTRUCTION =
  'This is the final turn and tool calling is disabled. Write the complete, ' +
  'user-facing answer for the task now as plain text — summarize what was ' +
  'done, what was found, and any remaining caveats.';

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
  /**
   * Run-scoped override set by `runLoop` after a provider 400 that
   * rejected `tool_choice`. Forces the field to be omitted even when the
   * static capability check thought it was safe (handles models we
   * didn't classify ahead of time).
   */
  omitToolChoice?: boolean;
  conversationId?: string;
}): ChatStreamRequest {
  // Thinking models that reject a `tool_choice` field (DeepSeek V4):
  // omit the field on every turn, and on wrap-up drop the tools array
  // instead of sending `tool_choice: 'none'` (which they also reject).
  const toolChoiceSafe =
    !opts.omitToolChoice &&
    supportsToolChoice(opts.dialect, opts.selection.modelId, opts.reasoningEffort);

  let toolChoice: 'none' | 'auto' | undefined;
  if (opts.wrapUp) {
    toolChoice = toolChoiceSafe ? 'none' : undefined;
  } else {
    toolChoice = toolChoiceSafe ? 'auto' : undefined;
  }

  // Wrap-up forces prose. Capable models keep the tool schema present
  // and rely on `tool_choice: 'none'`; tool_choice-rejecting models get
  // an empty tool list so there is nothing to call.
  const tools =
    opts.wrapUp && !toolChoiceSafe ? [] : toolSchemasFor(ORCHESTRATOR_TOOLS);

  const messages = opts.wrapUp
    ? [...opts.messages, { role: 'user' as const, content: SYNTHESIS_INSTRUCTION }]
    : opts.messages;

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
      : {})
  };
}
