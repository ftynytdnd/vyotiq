/**
 * Shared chat-store types and slice helpers.
 *
 * Kept separate from `useChatStore.ts` so the Zustand owner stays focused
 * on actions while types + empty-slice factories stay importable from
 * tests and memo helpers without pulling the full store graph.
 */

import type { TimelineEvent, ChatPermissions } from '@shared/types/chat.js';
import type { ActiveRunInfo } from '@shared/types/ipc.js';
import type { ModelSelection } from '@shared/types/provider.js';
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
  runStartedAt: number | null;
  draft: string;
}

export function emptySlice(conversationId: string): ChatSlice {
  return {
    ...INITIAL_TIMELINE_STATE,
    conversationId,
    runId: null,
    isProcessing: false,
    runStartedAt: null,
    draft: ''
  };
}

/** Active-slice mirror surfaced at the top of the store. */
export interface ActiveMirror extends TimelineState {
  conversationId: string | null;
  runId: string | null;
  isProcessing: boolean;
  runStartedAt: number | null;
  draft: string;
  totalRunUsage?: TokenUsageAggregate;
}

export const EMPTY_MIRROR: ActiveMirror = {
  ...INITIAL_TIMELINE_STATE,
  orchestratorUsage: undefined,
  totalRunUsage: undefined,
  conversationId: null,
  runId: null,
  isProcessing: false,
  runStartedAt: null,
  draft: ''
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
    options?: { attachments?: string[] }
  ) => Promise<void>;
  abort: () => Promise<void>;
  abortRun: (runId: string) => Promise<void>;
  rehydrateActiveRuns: (infos: ActiveRunInfo[]) => void;
  registerIdleRoute: (runId: string, conversationId: string) => void;
  beginSideRun: (runId: string, conversationId: string) => void;
  prewarmSlice: (conversationId: string, events: TimelineEvent[]) => void;
  setDraft: (conversationId: string, text: string) => void;
}
