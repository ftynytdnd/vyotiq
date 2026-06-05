/**
 * Build the IPC payload for `chat:submitAskUser` from panel drafts + composer supplement.
 */

import type { AskUserAnswer, AskUserSubmitInput } from '@shared/types/askUser.js';
import type { PromptAttachmentMeta } from '@shared/types/chat.js';
import type { PendingAskUserEvent } from './pendingAskUser.js';

function hasStructuredAnswer(answers: AskUserAnswer[]): boolean {
  return answers.some(
    (a) =>
      !a.skipped &&
      ((a.selectedOptionIds?.length ?? 0) > 0 || (a.freeText?.trim().length ?? 0) > 0)
  );
}

export function buildAskUserSubmitInput(opts: {
  pending: PendingAskUserEvent;
  runId: string;
  conversationId: string;
  answers: AskUserAnswer[];
  supplementText?: string;
  attachmentMeta?: PromptAttachmentMeta[];
}): AskUserSubmitInput {
  const { pending, runId, conversationId, answers, supplementText, attachmentMeta } = opts;
  const trimmed = supplementText?.trim() ?? '';
  const single = pending.payload.questions.length === 1;

  let mergedAnswers = answers;
  let extra: string | undefined;

  if (single && trimmed.length > 0 && !hasStructuredAnswer(answers)) {
    mergedAnswers = [{ questionId: pending.payload.questions[0]!.id, freeText: trimmed }];
  } else if (!single && trimmed.length > 0) {
    extra = trimmed;
  }

  return {
    runId,
    conversationId,
    promptEventId: pending.id,
    toolCallId: pending.toolCallId,
    payload: pending.payload,
    answers: mergedAnswers,
    ...(extra ? { supplementText: extra } : {}),
    ...(attachmentMeta && attachmentMeta.length > 0 ? { attachmentMeta } : {})
  };
}
