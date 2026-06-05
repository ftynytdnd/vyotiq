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
import type { MentionKind } from '@shared/types/mention.js';
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

export function assertPromptAttachmentMeta(channel: string, index: number, value: unknown): void {
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

/** Validate an optional `attachmentMeta` array on IPC payloads. */
export function assertAttachmentMetaArray(channel: string, value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new Error(`${channel}: attachmentMeta must be an array`);
  }
  if (value.length > MAX_CHAT_ATTACHMENTS) {
    throw new Error(`${channel}: attachmentMeta exceeds max ${MAX_CHAT_ATTACHMENTS}`);
  }
  value.forEach((item, index) => {
    assertPromptAttachmentMeta(channel, index, item);
  });
}

const MENTION_KINDS = new Set<MentionKind>(['file', 'symbol', 'doc', 'web']);

function assertMentionRef(channel: string, index: number, value: unknown): void {
  assertObject(channel, `mentions[${index}]`, value);
  const item = value as Record<string, unknown>;
  if (!MENTION_KINDS.has(item.kind as MentionKind)) {
    throw new Error(`${channel}: mentions[${index}].kind is invalid`);
  }
  assertString(channel, `mentions[${index}].id`, item.id);
  assertString(channel, `mentions[${index}].label`, item.label, {
    maxBytes: MAX_ATTACHMENT_NAME_BYTES
  });
  if (item.workspacePath !== undefined) {
    assertString(channel, `mentions[${index}].workspacePath`, item.workspacePath, {
      maxBytes: MAX_ATTACHMENT_PATH_BYTES
    });
  }
  if (item.storedPath !== undefined) {
    assertString(channel, `mentions[${index}].storedPath`, item.storedPath, {
      maxBytes: MAX_ATTACHMENT_PATH_BYTES
    });
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
  assertAttachmentMetaArray(CHANNEL, value.attachmentMeta);
  if (value.mentions !== undefined) {
    if (!Array.isArray(value.mentions)) {
      throw new Error(`${CHANNEL}: mentions must be an array`);
    }
    if (value.mentions.length > MAX_CHAT_ATTACHMENTS) {
      throw new Error(`${CHANNEL}: mentions exceeds max ${MAX_CHAT_ATTACHMENTS}`);
    }
    value.mentions.forEach((item, index) => {
      assertMentionRef(CHANNEL, index, item);
    });
  }
}
