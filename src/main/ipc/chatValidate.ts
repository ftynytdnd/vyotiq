/**
 * Runtime shape gate for `chat:send` payloads.
 *
 * Audit fix M-03 established inline validation in `chat.ipc.ts`; this
 * module centralizes that contract on the shared `validate.ts` helpers
 * so tests can pin the gate without reaching through the full IPC
 * handler stack.
 */

import { MAX_CHAT_ATTACHMENTS, MAX_USER_PROMPT_BYTES } from '@shared/constants.js';
import type { ChatSendInput } from '@shared/types/chat.js';
import {
  assertBoolean,
  assertObject,
  assertOptionalString,
  assertString,
  assertStringArray
} from './validate.js';

/** Relative attachment paths are capped like workspace roots. */
const MAX_ATTACHMENT_PATH_BYTES = 4096;

const CHANNEL = 'chat:send';

/**
 * Assert that `value` matches the `ChatSendInput` wire contract.
 * Throws a structured `<channel>: <field> …` error on bad input.
 */
export function assertChatSendInput(value: unknown): asserts value is ChatSendInput {
  assertObject(CHANNEL, 'input', value);

  assertString(CHANNEL, 'runId', value.runId);
  assertString(CHANNEL, 'prompt', value.prompt, {
    nonEmpty: false,
    maxBytes: MAX_USER_PROMPT_BYTES
  });

  assertObject(CHANNEL, 'selection', value.selection);
  assertString(CHANNEL, 'selection.providerId', value.selection.providerId);
  assertString(CHANNEL, 'selection.modelId', value.selection.modelId);

  assertObject(CHANNEL, 'permissions', value.permissions);
  assertBoolean(CHANNEL, 'permissions.allowAuto', value.permissions.allowAuto);

  assertOptionalString(CHANNEL, 'conversationId', value.conversationId);
  assertOptionalString(CHANNEL, 'workspaceId', value.workspaceId);

  if (value.attachments !== undefined) {
    assertStringArray(CHANNEL, 'attachments', value.attachments, {
      nonEmpty: false,
      maxBytes: MAX_ATTACHMENT_PATH_BYTES,
      maxItems: MAX_CHAT_ATTACHMENTS
    });
  }
}
