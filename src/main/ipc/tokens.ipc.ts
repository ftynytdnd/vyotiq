/**
 * Token estimation IPC — exposes main-process `tokenCounter` to the renderer.
 */

import { IPC } from '@shared/constants.js';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import type { ModelSelection } from '@shared/types/provider.js';
import { estimateTokens } from '../providers/tokenCounter.js';
import { getWorkspace } from '../workspace/workspaceState.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
import {
  assertObject,
  assertString,
  assertOptionalString
} from './validate.js';

interface TokensEstimatePayload {
  modelId: string;
  prompt: string;
  attachments?: string[];
  attachmentMeta?: PromptAttachmentMeta[];
  workspacePath?: string;
  selection?: ModelSelection;
}

export function registerTokensIpc(): void {
  wrapIpcHandler(IPC.TOKENS_ESTIMATE, async (_event, input: TokensEstimatePayload) => {
    assertObject('tokens:estimate', 'input', input);
    assertString('tokens:estimate', 'input.modelId', input.modelId, { maxBytes: 512 });
    assertString('tokens:estimate', 'input.prompt', input.prompt, {
      nonEmpty: false,
      maxBytes: 512_000
    });
    if (input.workspacePath !== undefined) {
      assertOptionalString('tokens:estimate', 'input.workspacePath', input.workspacePath, {
        maxBytes: 4096
      });
    }

    let workspacePath = input.workspacePath;
    if (!workspacePath) {
      const ws = await getWorkspace();
      workspacePath = ws.path ?? undefined;
    }

    return estimateTokens({
      modelId: input.modelId,
      prompt: input.prompt,
      attachments: input.attachments,
      attachmentMeta: input.attachmentMeta,
      workspacePath,
      selection: input.selection
    });
  });
}
