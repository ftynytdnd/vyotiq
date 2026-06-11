/**
 * Deterministic tool-schema normalization before provider wire encoding.
 * Prevents cache-breaking key-order drift in JSON tool definitions.
 */

import type { ChatStreamRequest } from './chatClient.js';
import { stableStringify } from '@shared/json/stableStringify.js';

function sortRecordDeep(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(stableStringify(value)) as Record<string, unknown>;
}

/** Recursively sort object keys in a JSON-schema parameters block. */
export function normalizeToolParameters(
  parameters: Record<string, unknown>
): Record<string, unknown> {
  return sortRecordDeep(parameters);
}

/** Normalize OpenAI-shaped tool schemas for stable byte-identical prefixes. */
export function normalizeWireTools(
  tools: ChatStreamRequest['tools']
): ChatStreamRequest['tools'] {
  if (!tools?.length) return tools;
  return tools.map((tool) => ({
    ...tool,
    function: {
      ...tool.function,
      parameters: normalizeToolParameters(tool.function.parameters)
    }
  }));
}
