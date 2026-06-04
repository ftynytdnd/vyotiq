/**
 * Mints a stable id on every tool call that doesn't already have one.
 *
 * The same id MUST flow through:
 *   - `assistant.tool_calls[i].id` (history)
 *   - the `tool-call` timeline event (renderer)
 *   - the `tool-result` timeline event (renderer correlation)
 *   - the `tool.tool_call_id` we send back to the model (next turn)
 *
 * Without this lock-in step, OpenAI-compatible providers (DeepSeek,
 * Together, OpenRouter, …) reject the next request with
 * "tool_call_ids did not have response messages".
 *
 * Centralized so the orchestrator loop and tests share one implementation.
 */

import { randomUUID } from 'node:crypto';

export function lockToolCallIds(calls: ReadonlyArray<{ id?: string }>): void {
  for (const tc of calls) {
    if (!tc.id) tc.id = randomUUID();
  }
}
