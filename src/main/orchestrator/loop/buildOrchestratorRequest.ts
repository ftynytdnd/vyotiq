/**
 * Builds the request body the orchestrator sends to `streamChat`. The
 * orchestrator's tool catalogue is intentionally restricted to the
 * `ORCHESTRATOR_TOOLS` policy — no `bash`, no `edit`, no `search`. Every
 * decision turn is a schema-enforced action: the loop is CLOSED with
 * `tool_choice: 'required'` so the model can never "narrate without
 * acting" on a capable provider. `delegate`/`finish`/`ask_user` are the
 * real callable tools that drive, end, or pause the run.
 *
 * Forcing model:
 *   - Capable dialects (openai / anthropic-native / gemini-native /
 *     undefined) honour `tool_choice` server-side, so `'required'` is a
 *     hard guarantee.
 *   - `ollama-native` ignores `tool_choice` entirely. We still send
 *     `'required'` (harmless / ignored) but ALSO pin `temperature: 0`
 *     and inject a strong "you MUST call at least one tool" instruction
 *     as a trailing message so the model is prompt-forced into the loop
 *     without capping parallel `delegate` calls (which need multiple
 *     tool calls in one turn).
 *   - On the iteration-cap synthesis turn (`wrapUp`), tool calling is
 *     disabled with `tool_choice: 'none'` so the provider is physically
 *     forced to emit the final prose answer — mirrors the proven
 *     sub-agent wrap-up at `SUBAGENT_WRAPUP_ITER`.
 *
 * Phase 7 (2026): `conversationId` is threaded through so xAI Grok
 * hosts get the `x-grok-conv-id` cache-attribution header. No-op for
 * every other host. See `attributionHeaders.ts` for the routing rule.
 */

import type { ChatStreamRequest } from '../../providers/chatClient.js';
import type { ChatMessage } from '@shared/types/chat.js';
import type { ModelSelection, ProviderDialect } from '@shared/types/provider.js';
import { toolSchemasFor } from '../../tools/registry.js';
import { ORCHESTRATOR_TOOLS } from '../../tools/policy/index.js';
import { supportsForcedToolChoice, supportsParallelToolCalls } from '../../providers/capabilities.js';

/**
 * Prompt-force instruction injected for non-forced dialects
 * (`ollama-native`). Sent as a trailing `user` message — the most
 * reliable instruction-following slot for small local models — so the
 * model treats it as the immediate constraint for THIS turn. Paired
 * with `temperature: 0` so the forced behaviour is deterministic.
 */
const PROMPT_FORCE_INSTRUCTION =
  'You MUST call at least one tool this turn — never reply with plain prose only. ' +
  'When sub-tasks are independent, fan them out in THIS SAME turn: emit MULTIPLE ' +
  '`delegate` tool calls, OR one `delegate` call whose arguments include a ' +
  '`delegates` array with one entry per micro-task (required when your host cannot ' +
  'emit parallel tool calls). Omit `concurrency` unless you must cap below the host ' +
  'default — every spec still spawns; extras queue until a slot frees. Use `ls`/`memory`/' +
  '`recall` to gather context, `finish` to deliver the final answer, or `ask_user` when ' +
  'genuinely blocked.';

/**
 * Synthesis instruction for the iteration-cap wrap-up turn. Tool calling
 * is disabled (`tool_choice: 'none'`); this trailing message tells the
 * model to deliver its final answer as plain text now. Capable dialects
 * are physically forced into prose by `'none'`; the message additionally
 * steers `ollama-native` (which ignores `tool_choice`) toward prose.
 */
const SYNTHESIS_INSTRUCTION =
  'This is the final turn and tool calling is disabled. Write the complete, ' +
  'user-facing answer for the task now as plain text — summarize what was ' +
  'done, what was found, and any remaining caveats.';

export function buildOrchestratorRequest(opts: {
  selection: ModelSelection;
  messages: ChatMessage[];
  signal: AbortSignal;
  /** Provider wire dialect — chooses the forcing strategy. */
  dialect?: ProviderDialect;
  /**
   * Final synthesis turn (iteration cap reached without `finish`). Sends
   * `tool_choice: 'none'` so the provider emits prose, and appends a
   * synthesis instruction. Mirrors the sub-agent wrap-up pattern.
   */
  wrapUp?: boolean;
  /** Active conversation id (Phase 7). When supplied, the request
   *  carries it onto the chat client so the transport can stamp
   *  provider-specific cache-attribution headers. */
  conversationId?: string;
}): ChatStreamRequest {
  const forced = supportsForcedToolChoice(opts.dialect);
  // Closed loop: 'required' normally, 'none' on the synthesis wrap-up.
  const toolChoice: 'none' | 'required' = opts.wrapUp ? 'none' : 'required';

  // Non-forced dialects (ollama-native) need the prompt-force degradation
  // path: temperature 0 + a strong "call a tool" instruction. Skipped on
  // the wrap-up turn, where prose is the goal.
  const needsPromptForce = !forced && !opts.wrapUp;

  // Append a transient trailing instruction WITHOUT mutating the caller's
  // history array (a fresh copy per request so the directive never
  // accumulates across iterations / leaks into persisted replay).
  let messages = opts.messages;
  if (opts.wrapUp) {
    messages = [...opts.messages, { role: 'user', content: SYNTHESIS_INSTRUCTION }];
  } else if (needsPromptForce) {
    messages = [...opts.messages, { role: 'user', content: PROMPT_FORCE_INSTRUCTION }];
  }

  return {
    providerId: opts.selection.providerId,
    model: opts.selection.modelId,
    messages,
    tools: toolSchemasFor(ORCHESTRATOR_TOOLS),
    toolChoice,
    ...(needsPromptForce ? { temperature: 0 } : {}),
    ...(supportsParallelToolCalls(opts.dialect) && !opts.wrapUp
      ? { parallelToolCalls: true }
      : {}),
    signal: opts.signal,
    ...(opts.conversationId !== undefined
      ? { conversationId: opts.conversationId }
      : {})
  };
}
