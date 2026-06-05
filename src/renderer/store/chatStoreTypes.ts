/**
 * Shared chat-store types and slice helpers.
 *
 * Kept separate from `useChatStore.ts` so the Zustand owner stays focused
 * on actions while types + empty-slice factories stay importable from
 * tests and memo helpers without pulling the full store graph.
 */

import type { TimelineEvent, ChatPermissions, PromptAttachmentMeta } from '@shared/types/chat.js';
import type { AskUserSubmitInput } from '@shared/types/askUser.js';
import type { ActiveRunInfo } from '@shared/types/ipc.js';
import type { ModelSelection } from '@shared/types/provider.js';
import type { MentionRef } from '@shared/types/mention.js';
import type { ApplyEventOptions } from '../components/timeline/reducer/applyTimelineEvent.js';
import {
  INITIAL_TIMELINE_STATE,
  type TimelineState,
  type TokenUsageAggregate
} from '../components/timeline/reducer/types.js';

/** Per-conversation slice — module-internal registry entry. */
export interface ChatSlice extends TimelineState {
  conversationId: string;
  runId: string | null;
  isProcessing: boolean;
  awaitingAskUser: boolean;
  runStartedAt: number | null;
  draft: string;
  attachmentDraft: PromptAttachmentMeta[];
}

export function emptySlice(conversationId: string): ChatSlice {
  return {
    ...INITIAL_TIMELINE_STATE,
    conversationId,
    runId: null,
    isProcessing: false,
    awaitingAskUser: false,
    runStartedAt: null,
    draft: '',
    attachmentDraft: []
  };
}

/** Active-slice mirror surfaced at the top of the store. */
export interface ActiveMirror extends TimelineState {
  conversationId: string | null;
  runId: string | null;
  isProcessing: boolean;
  awaitingAskUser: boolean;
  runStartedAt: number | null;
  draft: string;
  attachmentDraft: PromptAttachmentMeta[];
  totalRunUsage?: TokenUsageAggregate;
}

export const EMPTY_MIRROR: ActiveMirror = {
  ...INITIAL_TIMELINE_STATE,
  orchestratorUsage: undefined,
  totalRunUsage: undefined,
  conversationId: null,
  runId: null,
  isProcessing: false,
  awaitingAskUser: false,
  runStartedAt: null,
  draft: '',
  attachmentDraft: []
};

export interface ChatStore extends ActiveMirror {
  slices: Record<string, ChatSlice>;
  runIdToConv: Record<string, string>;
  runIdToModel: Record<string, string>;

  applyEvent: (runId: string, event: TimelineEvent, opts?: ApplyEventOptions) => void;
  applyConversationEvent: (conversationId: string, event: TimelineEvent) => void;
  finishRun: (runId: string) => void;
  errorRun: (runId: string, message: string) => void;
  setTranscript: (conversationId: string | null, events: TimelineEvent[]) => void;
  setActiveConversation: (conversationId: string | null) => void;
  dropConversation: (conversationId: string) => void;
  send: (
    prompt: string,
    selection: ModelSelection,
    permissions: ChatPermissions,
    options?: {
      attachments?: string[];
      attachmentMeta?: PromptAttachmentMeta[];
      promptEventId?: string;
      mentions?: MentionRef[];
    }
  ) => Promise<void>;
  abort: () => Promise<void>;
  abortRun: (runId: string) => Promise<void>;
  submitAskUser: (input: AskUserSubmitInput) => Promise<void>;
  /** Unified submit for panel overlay + composer Send while `awaitingAskUser`. */
  submitPendingAskUser: (opts?: {
    supplementText?: string;
    attachmentMeta?: PromptAttachmentMeta[];
  }) => Promise<void>;
  pauseForAskUser: (runId: string) => void;
  rehydrateActiveRuns: (infos: ActiveRunInfo[]) => void;
  beginSideRun: (runId: string, conversationId: string) => void;
  prewarmSlice: (conversationId: string, events: TimelineEvent[]) => void;
  setDraft: (conversationId: string, text: string) => void;
  setAttachmentDraft: (conversationId: string, attachments: PromptAttachmentMeta[]) => void;
}
