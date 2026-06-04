/**
 * Checkpoints IPC — renderer surface for transcript rewind.
 *
 * File-change recording, pending rows, and entry/run revert stay on the
 * main process (tools + `rewindToPrompt`). The deleted Checkpoints panel
 * no longer calls accept/reject/summary/history channels from the renderer.
 */

import { IPC } from '@shared/constants.js';
import type { RewindPreviewResult, RewindResult } from '@shared/types/checkpoint.js';
import { previewRewind, rewindToPrompt } from '../checkpoints/rewindToPrompt.js';
import { safeWebContentsSend } from '../window/safeWebContentsSend.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import { assertString, assertObject } from './validate.js';

export function registerCheckpointsIpc(): void {
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
          checkpointsChanged: () => {
            /* No renderer checkpoints panel — rewind refreshes via transcriptRewound. */
          },
          transcriptRewound: (conversationId: string) => {
            safeWebContentsSend(IPC.CONVERSATION_TRANSCRIPT_REWOUND, conversationId);
          }
        }
      });
    }
  );
}
