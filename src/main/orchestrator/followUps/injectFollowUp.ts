/**
 * Mid-loop follow-up injection — append user turns without a new runId.
 */

import { randomUUID } from 'node:crypto';
import type { ChatMessage, ChatSendInput, TimelineEvent } from '@shared/types/chat.js';
import type { FollowUpMessage } from '@shared/types/followUp.js';
import { insertHistoryBeforeTail } from '../context/buildContextLayers.js';
import {
  buildUserTurnMessage,
  resolveInputModalitiesForSelection
} from '../buildUserTurnMessage.js';
import { getPreparedMediaCache } from '../../attachments/preparedMediaCache.js';

export interface InjectFollowUpOpts {
  followUp: FollowUpMessage;
  runId: string;
  conversationId: string;
  workspacePath: string;
  workspaceId?: string;
  emit: (event: TimelineEvent) => void;
  messages: ChatMessage[];
  signal?: AbortSignal;
}

export interface InjectFollowUpResult {
  userEnvelope: string;
  promptEventId: string;
  query: string;
}

/**
 * Persist + emit a follow-up user turn and insert it into the loop messages array.
 */
export async function injectFollowUp(opts: InjectFollowUpOpts): Promise<InjectFollowUpResult> {
  const { followUp, runId, conversationId, workspacePath, emit, messages, signal } = opts;
  const promptEventId = followUp.promptEventId ?? randomUUID();

  const {
    message: userMessage,
    turnXml: userEnvelope,
    persistedAttachments
  } = await buildUserTurnMessage({
    prompt: followUp.prompt,
    selection: followUp.selection,
    workspacePath,
    attachmentMeta: followUp.attachmentMeta,
    mentions: followUp.mentions,
    inputModalities: await resolveInputModalitiesForSelection(followUp.selection),
    conversationId,
    runId,
    mediaCache: getPreparedMediaCache(runId),
    signal
  });

  const attachmentsForEvent =
    persistedAttachments && persistedAttachments.length > 0
      ? persistedAttachments
      : followUp.attachmentMeta && followUp.attachmentMeta.length > 0
        ? followUp.attachmentMeta
        : undefined;

  const userPromptEvent: TimelineEvent = {
    kind: 'user-prompt',
    id: promptEventId,
    ts: Date.now(),
    content: followUp.prompt,
    runId,
    providerId: followUp.selection.providerId,
    modelId: followUp.selection.modelId,
    ...(attachmentsForEvent ? { attachments: attachmentsForEvent } : {}),
    ...(followUp.mentions && followUp.mentions.length > 0 ? { mentions: followUp.mentions } : {}),
    ...(followUp.source !== 'composer' ? { source: followUp.source } : {})
  };

  // Persist via the run `emit` path only (`chat.ipc` → `persistEvent`). A
  // direct `appendEvent` here duplicated every injected follow-up (steering,
  // dynamic-loop audit, heartbeat, continue) in the JSONL transcript.
  emit(userPromptEvent);
  insertHistoryBeforeTail(messages, userMessage);

  return { userEnvelope, promptEventId, query: followUp.prompt };
}

export function followUpToChatSendInput(
  followUp: FollowUpMessage,
  conversationId: string,
  workspaceId: string
): ChatSendInput {
  return {
    runId: randomUUID(),
    conversationId,
    workspaceId,
    prompt: followUp.prompt,
    selection: { ...followUp.selection },
    ...(followUp.attachmentMeta && followUp.attachmentMeta.length > 0
      ? { attachmentMeta: followUp.attachmentMeta }
      : {}),
    ...(followUp.mentions && followUp.mentions.length > 0 ? { mentions: followUp.mentions } : {}),
    ...(followUp.promptEventId ? { promptEventId: followUp.promptEventId } : {})
  };
}
