/**
 * Shared chat-store types and slice helpers.
 *
 * Kept separate from `useChatStore.ts` so the Zustand owner stays focused
 * on actions while types + empty-slice factories stay importable from
 * tests and memo helpers without pulling the full store graph.
 */

import type { TimelineEvent, PromptAttachmentMeta, TranscriptPaging } from '@shared/types/chat.js';
import type { AskUserSubmitInput } from '@shared/types/askUser.js';
import type { ActiveRunInfo } from '@shared/types/ipc.js';
import type { ModelSelection } from '@shared/types/provider.js';
import type { MentionRef } from '@shared/types/mention.js';
import type {
  ConversationFollowUpState,
  FollowUpKind
} from '@shared/types/followUp.js';
import { EMPTY_FOLLOW_UP_STATE } from '@shared/types/followUp.js';
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
  /** Non-null when only a tail slice of the JSONL is loaded. */
  transcriptPaging: TranscriptPaging | null;
  /** Main-process follow-up queue mirror (steering + queued lanes). */
  followUps: ConversationFollowUpState;
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
    attachmentDraft: [],
    transcriptPaging: null,
    followUps: { ...EMPTY_FOLLOW_UP_STATE }
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
  transcriptPaging: TranscriptPaging | null;
  followUps: ConversationFollowUpState;
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
  attachmentDraft: [],
  transcriptPaging: null,
  followUps: { ...EMPTY_FOLLOW_UP_STATE }
};

export interface ChatStore extends ActiveMirror {
  slices: Record<string, ChatSlice>;
  runIdToConv: Record<string, string>;
  runIdToModel: Record<string, string>;

  applyEvent: (runId: string, event: TimelineEvent, opts?: ApplyEventOptions) => void;
  /** Apply multiple timeline events in one store commit (bursty tool rounds). */
  applyEvents: (
    runId: string,
    entries: ReadonlyArray<{ event: TimelineEvent; opts?: ApplyEventOptions }>
  ) => void;
  applyConversationEvent: (
    conversationId: string,
    event: TimelineEvent,
    opts?: ApplyEventOptions
  ) => void;
  applyConversationEvents: (
    conversationId: string,
    entries: ReadonlyArray<{ event: TimelineEvent; opts?: ApplyEventOptions }>
  ) => void;
  finishRun: (runId: string) => void;
  errorRun: (runId: string, message: string) => void;
  setTranscript: (conversationId: string | null, events: TimelineEvent[], paging?: TranscriptPaging | null) => void;
  prependTranscript: (
    conversationId: string,
    olderEvents: TimelineEvent[],
    paging: TranscriptPaging
  ) => void;
  setActiveConversation: (conversationId: string | null) => void;
  dropConversation: (conversationId: string) => void;
  send: (
    prompt: string,
    selection: ModelSelection,
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
  prewarmSlice: (conversationId: string, events: TimelineEvent[], paging?: TranscriptPaging | null) => void;
  setDraft: (conversationId: string, text: string) => void;
  setAttachmentDraft: (conversationId: string, attachments: PromptAttachmentMeta[]) => void;
  syncFollowUps: (conversationId: string, state: ConversationFollowUpState) => void;
  loadFollowUps: (conversationId: string) => Promise<void>;
  enqueueFollowUp: (
    kind: FollowUpKind,
    prompt: string,
    selection: ModelSelection,
    options?: {
      attachmentMeta?: PromptAttachmentMeta[];
      mentions?: MentionRef[];
      promptEventId?: string;
    }
  ) => Promise<void>;
  updateFollowUp: (
    id: string,
    patch: {
      prompt?: string;
      selection?: ModelSelection;
      attachmentMeta?: PromptAttachmentMeta[];
      mentions?: MentionRef[];
    }
  ) => Promise<void>;
  removeFollowUp: (id: string) => Promise<void>;
  sendFollowUpNow: (id: string) => Promise<void>;
}
