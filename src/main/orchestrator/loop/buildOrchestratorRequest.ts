/**
 * Builds the request body the orchestrator sends to `streamChat`. The
 * orchestrator's tool catalogue is intentionally restricted to the
 * `ORCHESTRATOR_TOOLS` policy — no `bash`, no `edit`, no `search`. Any
 * heavy work must go through `<delegate>`.
 *
 * Phase 7 (2026): `conversationId` is threaded through so xAI Grok
 * hosts get the `x-grok-conv-id` cache-attribution header. No-op for
 * every other host. See `attributionHeaders.ts` for the routing rule.
 */

import type { ChatStreamRequest } from '../../providers/chatClient.js';
import type { ChatMessage } from '@shared/types/chat.js';
import type { ModelSelection } from '@shared/types/provider.js';
import { toolSchemasFor } from '../../tools/registry.js';
import { ORCHESTRATOR_TOOLS } from '../../tools/policy/index.js';

export function buildOrchestratorRequest(opts: {
  selection: ModelSelection;
  messages: ChatMessage[];
  signal: AbortSignal;
  /** Active conversation id (Phase 7). When supplied, the request
   *  carries it onto the chat client so the transport can stamp
   *  provider-specific cache-attribution headers. */
  conversationId?: string;
}): ChatStreamRequest {
  return {
    providerId: opts.selection.providerId,
    model: opts.selection.modelId,
    messages: opts.messages,
    tools: toolSchemasFor(ORCHESTRATOR_TOOLS),
    toolChoice: 'auto',
    signal: opts.signal,
    ...(opts.conversationId !== undefined
      ? { conversationId: opts.conversationId }
      : {})
  };
}
