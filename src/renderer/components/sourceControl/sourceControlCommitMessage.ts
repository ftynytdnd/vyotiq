/**
 * Stream an AI commit message into the composer field.
 */

import { normalizeCommitMessage } from '@shared/git/normalizeCommitMessage.js';
import { vyotiq } from '../../lib/ipc.js';

export interface LiveCommitMessageResult {
  message: string;
  warnings: string[];
}

export async function generateLiveCommitMessage(
  workspaceId: string,
  onText: (text: string) => void
): Promise<LiveCommitMessageResult> {
  let streamed = '';
  const result = await vyotiq.workspace.gitGenerateCommitMessage({ workspaceId }, (delta) => {
    streamed += delta;
    onText(streamed.trimStart());
  });
  if (result.error) {
    throw new Error(result.error);
  }
  const message = normalizeCommitMessage(result.message || streamed);
  onText(message);
  return {
    message,
    warnings: result.warnings ?? []
  };
}
