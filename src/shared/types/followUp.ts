/**
 * Composer follow-up / queued message types.
 * Main-process authoritative; renderer mirrors via IPC.
 */

import type { PromptAttachmentMeta } from './chat.js';
import type { MentionRef } from './mention.js';
import type { ModelSelection } from './provider.js';

export type FollowUpKind = 'steering' | 'queue';

export type FollowUpSource =
  | 'composer'
  | 'scheduled'
  | 'heartbeat'
  | 'continue'
  | 'dynamic-loop';

export interface FollowUpMessage {
  id: string;
  kind: FollowUpKind;
  prompt: string;
  selection: ModelSelection;
  attachmentMeta?: PromptAttachmentMeta[];
  mentions?: MentionRef[];
  promptEventId?: string;
  queuedAt: number;
  source: FollowUpSource;
}

export interface ConversationFollowUpState {
  /** FIFO — consumed after each assistant stream segment. */
  steering: FollowUpMessage[];
  /** FIFO — consumed before terminal finish. */
  queued: FollowUpMessage[];
}

export const EMPTY_FOLLOW_UP_STATE: ConversationFollowUpState = {
  steering: [],
  queued: []
};

export interface FollowUpEnqueueInput {
  conversationId: string;
  kind: FollowUpKind;
  prompt: string;
  selection: ModelSelection;
  attachmentMeta?: PromptAttachmentMeta[];
  mentions?: MentionRef[];
  promptEventId?: string;
  source?: FollowUpSource;
}

export interface FollowUpUpdateInput {
  conversationId: string;
  id: string;
  prompt?: string;
  selection?: ModelSelection;
  attachmentMeta?: PromptAttachmentMeta[];
  mentions?: MentionRef[];
}

export interface FollowUpRemoveInput {
  conversationId: string;
  id: string;
}

export interface FollowUpSendNowInput {
  conversationId: string;
  id: string;
}

export class FollowUpQueueFullError extends Error {
  constructor(public readonly kind: FollowUpKind, public readonly maxDepth: number) {
    super(`Follow-up ${kind} lane is full (max ${maxDepth})`);
    this.name = 'FollowUpQueueFullError';
  }
}
