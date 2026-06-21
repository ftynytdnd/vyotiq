/**
 * Conversation heartbeat IPC — attach/detach per-thread wake polling.
 */

import { IPC } from '@shared/constants.js';
import type {
  ConversationHeartbeat,
  HeartbeatAttachInput,
  HeartbeatDetachInput
} from '@shared/types/conversationHeartbeat.js';
import {
  attachConversationHeartbeat,
  detachConversationHeartbeat,
  getConversationHeartbeat,
  listConversationHeartbeats
} from '../heartbeat/conversationHeartbeatStore.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import {
  assertNumber,
  assertObject,
  assertOptionalString,
  assertString
} from './validate.js';
import {
  HEARTBEAT_MAX_INTERVAL_MINUTES,
  HEARTBEAT_MIN_INTERVAL_MINUTES
} from '@shared/constants.js';

export function registerHeartbeatIpc(): void {
  wrapIpcHandler(IPC.HEARTBEAT_LIST, async (): Promise<ConversationHeartbeat[]> => {
    return listConversationHeartbeats();
  });

  wrapIpcHandler(
    IPC.HEARTBEAT_GET,
    async (_event, conversationId: string): Promise<ConversationHeartbeat | null> => {
      assertString('heartbeat:get', 'conversationId', conversationId);
      return getConversationHeartbeat(conversationId);
    }
  );

  wrapIpcHandler(
    IPC.HEARTBEAT_ATTACH,
    async (_event, input: HeartbeatAttachInput): Promise<ConversationHeartbeat> => {
      assertObject('heartbeat:attach', 'input', input);
      assertString('heartbeat:attach', 'input.conversationId', input.conversationId);
      assertString('heartbeat:attach', 'input.workspaceId', input.workspaceId);
      assertNumber('heartbeat:attach', 'input.intervalMinutes', input.intervalMinutes, {
        integer: true,
        min: HEARTBEAT_MIN_INTERVAL_MINUTES,
        max: HEARTBEAT_MAX_INTERVAL_MINUTES
      });
      assertObject('heartbeat:attach', 'input.selection', input.selection);
      assertString('heartbeat:attach', 'input.selection.providerId', input.selection.providerId);
      assertString('heartbeat:attach', 'input.selection.modelId', input.selection.modelId);
      assertOptionalString('heartbeat:attach', 'input.wakePrompt', input.wakePrompt);
      return attachConversationHeartbeat(input);
    }
  );

  wrapIpcHandler(
    IPC.HEARTBEAT_DETACH,
    async (_event, input: HeartbeatDetachInput): Promise<{ ok: boolean }> => {
      assertObject('heartbeat:detach', 'input', input);
      assertString('heartbeat:detach', 'input.conversationId', input.conversationId);
      const ok = await detachConversationHeartbeat(input.conversationId);
      return { ok };
    }
  );
}
