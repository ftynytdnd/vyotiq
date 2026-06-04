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
  assertNumber,
  assertObject,
  assertOptionalString,
  assertString,
  assertStringArray
} from './validate.js';

/** Relative attachment paths are capped like workspace roots. */
const MAX_ATTACHMENT_PATH_BYTES = 4096;
const MAX_ATTACHMENT_NAME_BYTES = 512;

function assertPromptAttachmentMeta(channel: string, index: number, value: unknown): void {
  assertObject(channel, `attachmentMeta[${index}]`, value);
  const item = value as Record<string, unknown>;
  assertString(channel, `attachmentMeta[${index}].id`, item.id);
  assertString(channel, `attachmentMeta[${index}].name`, item.name, {
    maxBytes: MAX_ATTACHMENT_NAME_BYTES
  });
  if (item.mimeType !== undefined) {
    assertString(channel, `attachmentMeta[${index}].mimeType`, item.mimeType, {
      nonEmpty: false,
      maxBytes: 128
    });
  }
  if (item.sizeBytes !== undefined) {
    assertNumber(channel, `attachmentMeta[${index}].sizeBytes`, item.sizeBytes, {
      integer: true,
      min: 0
    });
  }
  if (item.storedPath !== undefined) {
    assertString(channel, `attachmentMeta[${index}].storedPath`, item.storedPath, {
      maxBytes: MAX_ATTACHMENT_PATH_BYTES
    });
  }
  if (item.workspacePath !== undefined) {
    assertString(channel, `attachmentMeta[${index}].workspacePath`, item.workspacePath, {
      maxBytes: MAX_ATTACHMENT_PATH_BYTES
    });
  }
  if (item.external !== undefined) {
    assertBoolean(channel, `attachmentMeta[${index}].external`, item.external);
  }
  if (!item.workspacePath && !item.storedPath) {
    throw new Error(
      `${channel}: attachmentMeta[${index}] must include workspacePath or storedPath`
    );
  }
}

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

  assertOptionalString(CHANNEL, 'conversationId', value.conversationId);
  assertOptionalString(CHANNEL, 'workspaceId', value.workspaceId);
  assertOptionalString(CHANNEL, 'promptEventId', value.promptEventId);

  if (value.attachments !== undefined) {
    assertStringArray(CHANNEL, 'attachments', value.attachments, {
      nonEmpty: false,
      maxBytes: MAX_ATTACHMENT_PATH_BYTES,
      maxItems: MAX_CHAT_ATTACHMENTS
    });
  }
  if (value.attachmentMeta !== undefined) {
    if (!Array.isArray(value.attachmentMeta)) {
      throw new Error(`${CHANNEL}: attachmentMeta must be an array`);
    }
    if (value.attachmentMeta.length > MAX_CHAT_ATTACHMENTS) {
      throw new Error(`${CHANNEL}: attachmentMeta exceeds max ${MAX_CHAT_ATTACHMENTS}`);
    }
    value.attachmentMeta.forEach((item, index) => {
      assertPromptAttachmentMeta(CHANNEL, index, item);
    });
  }
}
