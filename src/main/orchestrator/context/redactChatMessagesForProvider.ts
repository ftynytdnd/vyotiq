/**
 * Redact OS-user paths and likely secrets from chat messages immediately
 * before they are sent to a cloud provider.
 */

import type { ChatMessage } from '@shared/types/chat.js';
import { isChatContentPartArray } from '@shared/text/chatContent.js';
import { redactSensitiveText } from '@shared/text/redactSecretsInText.js';

function redactNullableString(value: string | null | undefined): string | null | undefined {
  if (value == null) return value;
  return redactSensitiveText(value);
}

/** Shallow-clone messages with sensitive segments redacted in string fields. */
export function redactChatMessagesForProvider(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    let content = m.content;
    if (isChatContentPartArray(content)) {
      content = content.map((part) =>
        part.type === 'text' ? { ...part, text: redactSensitiveText(part.text) } : part
      );
    } else {
      content = redactNullableString(content) ?? content;
    }
    const next: ChatMessage = { ...m, content };
    if (typeof m.reasoning_content === 'string') {
      next.reasoning_content = redactSensitiveText(m.reasoning_content);
    }
    if (Array.isArray(m.tool_calls)) {
      next.tool_calls = m.tool_calls.map((tc) => ({
        ...tc,
        function: {
          ...tc.function,
          arguments: redactSensitiveText(tc.function.arguments)
        }
      }));
    }
    return next;
  });
}
