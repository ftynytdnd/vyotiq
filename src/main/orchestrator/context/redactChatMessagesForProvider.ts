/**
 * Redact OS-user paths from chat messages immediately before they are
 * sent to a cloud provider. Timeline / JSONL persistence stays verbatim;
 * only the wire copy is sanitized.
 */

import type { ChatMessage } from '@shared/types/chat.js';
import { redactUserHomeInText } from '@shared/path/redactUserHomeInPath.js';

function redactNullableString(value: string | null | undefined): string | null | undefined {
  if (value == null) return value;
  return redactUserHomeInText(value);
}

/** Shallow-clone messages with user-home segments redacted in string fields. */
export function redactChatMessagesForProvider(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    const next: ChatMessage = {
      ...m,
      content: redactNullableString(m.content) ?? m.content
    };
    if (typeof m.reasoning_content === 'string') {
      next.reasoning_content = redactUserHomeInText(m.reasoning_content);
    }
    if (Array.isArray(m.tool_calls)) {
      next.tool_calls = m.tool_calls.map((tc) => ({
        ...tc,
        function: {
          ...tc.function,
          arguments: redactUserHomeInText(tc.function.arguments)
        }
      }));
    }
    return next;
  });
}
