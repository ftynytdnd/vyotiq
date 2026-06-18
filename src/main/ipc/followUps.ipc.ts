/**
 * Follow-ups IPC — enqueue, update, remove, send-now.
 */

import { IPC } from '@shared/constants.js';
import type { ConversationFollowUpState } from '@shared/types/followUp.js';
import type {
  FollowUpEnqueueInput,
  FollowUpKind,
  FollowUpRemoveInput,
  FollowUpSendNowInput,
  FollowUpSource,
  FollowUpUpdateInput
} from '@shared/types/followUp.js';
import {
  enqueueFollowUp,
  listFollowUps,
  removeFollowUp,
  updateFollowUp
} from '../followUps/followUpQueueService.js';
import { sendQueuedFollowUpNow } from '../followUps/drainFollowUps.js';
import { getConversationMeta } from '../conversations/conversationStore.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import {
  assertObject,
  assertOptionalString,
  assertString
} from './validate.js';

function assertModelSelection(channel: string, prefix: string, sel: unknown): void {
  assertObject(channel, prefix, sel);
  const s = sel as Record<string, unknown>;
  assertString(channel, `${prefix}.providerId`, s.providerId);
  assertString(channel, `${prefix}.modelId`, s.modelId);
}

async function assertKnownConversation(conversationId: string): Promise<void> {
  const meta = await getConversationMeta(conversationId);
  if (!meta) throw new Error(`Conversation not found: ${conversationId}`);
}

const FOLLOW_UP_KINDS: FollowUpKind[] = ['steering', 'queue'];
const FOLLOW_UP_SOURCES: FollowUpSource[] = ['composer', 'scheduled'];

function assertFollowUpKind(channel: string, prefix: string, kind: unknown): asserts kind is FollowUpKind {
  assertString(channel, prefix, kind);
  if (!FOLLOW_UP_KINDS.includes(kind as FollowUpKind)) {
    throw new Error(`${channel}: ${prefix} must be 'steering' or 'queue'`);
  }
}

function assertFollowUpSource(channel: string, prefix: string, source: unknown): asserts source is FollowUpSource {
  assertString(channel, prefix, source);
  if (!FOLLOW_UP_SOURCES.includes(source as FollowUpSource)) {
    throw new Error(`${channel}: ${prefix} must be 'composer' or 'scheduled'`);
  }
}

export function registerFollowUpsIpc(): void {
  wrapIpcHandler(
    IPC.FOLLOW_UPS_LIST,
    async (_event, conversationId: string): Promise<ConversationFollowUpState> => {
      assertString('follow-ups:list', 'conversationId', conversationId);
      return listFollowUps(conversationId);
    }
  );

  wrapIpcHandler(
    IPC.FOLLOW_UPS_ENQUEUE,
    async (_event, input: FollowUpEnqueueInput): Promise<ConversationFollowUpState> => {
      assertObject('follow-ups:enqueue', 'input', input);
      assertString('follow-ups:enqueue', 'input.conversationId', input.conversationId);
      assertFollowUpKind('follow-ups:enqueue', 'input.kind', input.kind);
      assertString('follow-ups:enqueue', 'input.prompt', input.prompt, { nonEmpty: false });
      assertModelSelection('follow-ups:enqueue', 'input.selection', input.selection);
      if (input.source !== undefined) {
        assertFollowUpSource('follow-ups:enqueue', 'input.source', input.source);
      }
      if (input.promptEventId !== undefined) {
        assertOptionalString('follow-ups:enqueue', 'input.promptEventId', input.promptEventId);
      }
      if (input.attachmentMeta !== undefined && !Array.isArray(input.attachmentMeta)) {
        throw new Error('follow-ups:enqueue: input.attachmentMeta must be an array');
      }
      if (input.mentions !== undefined && !Array.isArray(input.mentions)) {
        throw new Error('follow-ups:enqueue: input.mentions must be an array');
      }
      await assertKnownConversation(input.conversationId);
      return enqueueFollowUp(input);
    }
  );

  wrapIpcHandler(
    IPC.FOLLOW_UPS_UPDATE,
    async (_event, input: FollowUpUpdateInput): Promise<ConversationFollowUpState> => {
      assertObject('follow-ups:update', 'input', input);
      assertString('follow-ups:update', 'input.conversationId', input.conversationId);
      assertString('follow-ups:update', 'input.id', input.id);
      if (input.prompt !== undefined) {
        assertString('follow-ups:update', 'input.prompt', input.prompt, { nonEmpty: false });
      }
      if (input.selection !== undefined) {
        assertModelSelection('follow-ups:update', 'input.selection', input.selection);
      }
      if (input.attachmentMeta !== undefined && !Array.isArray(input.attachmentMeta)) {
        throw new Error('follow-ups:update: input.attachmentMeta must be an array');
      }
      if (input.mentions !== undefined && !Array.isArray(input.mentions)) {
        throw new Error('follow-ups:update: input.mentions must be an array');
      }
      await assertKnownConversation(input.conversationId);
      return updateFollowUp(input);
    }
  );

  wrapIpcHandler(
    IPC.FOLLOW_UPS_REMOVE,
    async (_event, input: FollowUpRemoveInput): Promise<ConversationFollowUpState> => {
      assertObject('follow-ups:remove', 'input', input);
      assertString('follow-ups:remove', 'input.conversationId', input.conversationId);
      assertString('follow-ups:remove', 'input.id', input.id);
      await assertKnownConversation(input.conversationId);
      return removeFollowUp(input.conversationId, input.id);
    }
  );

  wrapIpcHandler(
    IPC.FOLLOW_UPS_SEND_NOW,
    async (_event, input: FollowUpSendNowInput): Promise<ConversationFollowUpState> => {
      assertObject('follow-ups:send-now', 'input', input);
      assertString('follow-ups:send-now', 'input.conversationId', input.conversationId);
      assertString('follow-ups:send-now', 'input.id', input.id);
      await assertKnownConversation(input.conversationId);
      await sendQueuedFollowUpNow(input.conversationId, input.id);
      return listFollowUps(input.conversationId);
    }
  );
}
