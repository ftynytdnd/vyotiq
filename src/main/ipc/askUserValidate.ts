/**
 * Validate `chat:submitAskUser` IPC payloads.
 */

import type { AskUserSubmitInput } from '@shared/types/askUser.js';
import { assertAttachmentMetaArray } from './chatValidate.js';
import { assertString } from './validate.js';

const CHANNEL = 'chat:submitAskUser';

export function assertAskUserSubmitInput(input: unknown): asserts input is AskUserSubmitInput {
  if (input === null || typeof input !== 'object') {
    throw new Error('chat:submitAskUser input must be an object');
  }
  const o = input as Record<string, unknown>;
  assertString('chat:submitAskUser', 'runId', o['runId']);
  assertString('chat:submitAskUser', 'conversationId', o['conversationId']);
  assertString('chat:submitAskUser', 'promptEventId', o['promptEventId']);
  assertString('chat:submitAskUser', 'toolCallId', o['toolCallId']);
  if (o['payload'] === null || typeof o['payload'] !== 'object') {
    throw new Error('chat:submitAskUser payload must be an object');
  }
  if (!Array.isArray((o['payload'] as { questions?: unknown }).questions)) {
    throw new Error('chat:submitAskUser payload.questions must be an array');
  }
  if (!Array.isArray(o['answers'])) {
    throw new Error('chat:submitAskUser answers must be an array');
  }
  if (o['supplementText'] !== undefined && typeof o['supplementText'] !== 'string') {
    throw new Error('chat:submitAskUser supplementText must be a string when present');
  }
  assertAttachmentMetaArray(CHANNEL, o['attachmentMeta']);
}
