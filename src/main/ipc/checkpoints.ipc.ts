/**
 * Checkpoints IPC — pending review, accept/reject, rewind.
 */

import { IPC } from '@shared/constants.js';
import type {
  CheckpointRevertResult,
  PendingChange,
  RewindPreviewResult,
  RewindResult
} from '@shared/types/checkpoint.js';
import { previewRewind, rewindToPrompt } from '../checkpoints/rewindToPrompt.js';
import {
  acceptEntry,
  acceptAll,
  rejectEntry,
  listPending,
  readBlobBody,
  setCheckpointsBroadcaster
} from '../checkpoints/index.js';
import { listWorkspaces } from '../workspace/workspaceState.js';
import { safeWebContentsSend } from '../window/safeWebContentsSend.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import { assertString, assertObject } from './validate.js';

function wireBroadcaster(): void {
  setCheckpointsBroadcaster((workspaceId: string) => {
    safeWebContentsSend(IPC.CHECKPOINTS_CHANGED, workspaceId);
  });
}

async function knownWorkspaceIds(): Promise<string[]> {
  const state = await listWorkspaces();
  return state.workspaces.map((w) => w.id);
}

export function registerCheckpointsIpc(): void {
  wireBroadcaster();

  wrapIpcHandler(
    IPC.CHECKPOINTS_LIST_PENDING,
    async (_event, conversationId: string): Promise<PendingChange[]> => {
      assertString('checkpoints:listPending', 'conversationId', conversationId);
      const ids = await knownWorkspaceIds();
      return listPending(conversationId, ids);
    }
  );

  wrapIpcHandler(IPC.CHECKPOINTS_ACCEPT, async (_event, entryId: string) => {
    assertString('checkpoints:accept', 'entryId', entryId);
    await acceptEntry(entryId);
  });

  wrapIpcHandler(
    IPC.CHECKPOINTS_ACCEPT_ALL,
    async (_event, conversationId: string) => {
      assertString('checkpoints:acceptAll', 'conversationId', conversationId);
      const ids = await knownWorkspaceIds();
      await acceptAll(conversationId, ids);
    }
  );

  wrapIpcHandler(
    IPC.CHECKPOINTS_REJECT,
    async (_event, entryId: string): Promise<CheckpointRevertResult> => {
      assertString('checkpoints:reject', 'entryId', entryId);
      return rejectEntry(entryId);
    }
  );

  wrapIpcHandler(
    IPC.CHECKPOINTS_READ_BLOB,
    async (_event, workspaceId: string, hash: string): Promise<string | null> => {
      assertString('checkpoints:readBlob', 'workspaceId', workspaceId);
      assertString('checkpoints:readBlob', 'hash', hash);
      return readBlobBody(workspaceId, hash);
    }
  );

  wrapIpcHandler(
    IPC.CHECKPOINTS_PREVIEW_REWIND,
    async (
      _event,
      input: { conversationId: string; workspaceId: string; promptEventId: string }
    ): Promise<RewindPreviewResult> => {
      assertObject('checkpoints:previewRewind', 'input', input);
      assertString('checkpoints:previewRewind', 'input.conversationId', input.conversationId);
      assertString('checkpoints:previewRewind', 'input.workspaceId', input.workspaceId);
      assertString('checkpoints:previewRewind', 'input.promptEventId', input.promptEventId);
      return previewRewind(input);
    }
  );

  wrapIpcHandler(
    IPC.CHECKPOINTS_REWIND_TO_PROMPT,
    async (
      _event,
      input: { conversationId: string; workspaceId: string; promptEventId: string }
    ): Promise<RewindResult> => {
      assertObject('checkpoints:rewindToPrompt', 'input', input);
      assertString('checkpoints:rewindToPrompt', 'input.conversationId', input.conversationId);
      assertString('checkpoints:rewindToPrompt', 'input.workspaceId', input.workspaceId);
      assertString('checkpoints:rewindToPrompt', 'input.promptEventId', input.promptEventId);
      return rewindToPrompt({
        ...input,
        broadcasters: {
          checkpointsChanged: (workspaceId: string) => {
            safeWebContentsSend(IPC.CHECKPOINTS_CHANGED, workspaceId);
          },
          transcriptRewound: (conversationId: string) => {
            safeWebContentsSend(IPC.CONVERSATION_TRANSCRIPT_REWOUND, conversationId);
          }
        }
      });
    }
  );
}
