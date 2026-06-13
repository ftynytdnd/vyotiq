/**
 * Non-streaming inline completion via the existing chat transport.
 * Reuses `streamChat` so all provider dialects stay on one HTTP path.
 */

import type { ChatMessage } from '@shared/types/chat.js';
import type { CompletionInput } from '@shared/types/completion.js';
import { sanitizeCompletionText } from '@shared/completion/sanitizeCompletionText.js';
import { streamChat } from './chatClient.js';
import { logger } from '../logging/logger.js';

const log = logger.child('providers/completion');

const MAX_PREFIX_CHARS = 6_000;
const MAX_SUFFIX_CHARS = 2_000;
const MIN_TRIGGER_CHARS = 3;
const COMPLETION_MAX_TOKENS = 96;

function tailChars(text: string, max: number): string {
  return text.length <= max ? text : text.slice(-max);
}

function headChars(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

function buildMessages(input: CompletionInput): ChatMessage[] {
  if (input.kind === 'editor') {
    const prefix = tailChars(input.prefix, MAX_PREFIX_CHARS);
    const suffix = headChars(input.suffix ?? '', MAX_SUFFIX_CHARS);
    const fileHint = input.filePath ? `File: ${input.filePath}\n\n` : '';
    const userBody =
      suffix.length > 0
        ? `${fileHint}<before_cursor>\n${prefix}\n</before_cursor>\n<after_cursor>\n${suffix}\n</after_cursor>`
        : `${fileHint}<before_cursor>\n${prefix}\n</before_cursor>`;
    return [
      {
        role: 'system',
        content:
          'You are a code completion engine. Output ONLY the text to insert at the cursor. ' +
          'No markdown fences, no explanations, no duplicated context. Match indentation and style.'
      },
      { role: 'user', content: userBody }
    ];
  }

  const prefix = tailChars(input.prefix, MAX_PREFIX_CHARS);
  return [
    {
      role: 'system',
      content:
        'You continue the user message for an AI coding agent. Output ONLY the continuation text — ' +
        'no quotes, labels, or explanation. Keep it concise (one short sentence).'
    },
    { role: 'user', content: prefix }
  ];
}

export async function requestInlineCompletion(
  input: CompletionInput,
  signal?: AbortSignal
): Promise<string> {
  const prefix = input.prefix.trim();
  if (prefix.length < MIN_TRIGGER_CHARS) return '';

  const messages = buildMessages(input);
  let raw = '';

  try {
    for await (const delta of streamChat({
      providerId: input.providerId,
      model: input.model,
      messages,
      toolChoice: 'none',
      temperature: 0.2,
      maxTokens: COMPLETION_MAX_TOKENS,
      signal
    })) {
      if (signal?.aborted) break;
      if (delta.contentDelta) raw += delta.contentDelta;
      if (delta.finishReason === 'error') break;
    }
  } catch (err: unknown) {
    if (signal?.aborted) return '';
    const msg = err instanceof Error ? err.message : String(err);
    log.debug('inline completion failed', { kind: input.kind, message: msg });
    return '';
  }

  return sanitizeCompletionText(raw, input.kind);
}
