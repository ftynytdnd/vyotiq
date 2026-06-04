/**
 * Checkpoints store — revert/rewind IPC and transcript sync on rewind.
 * Subscribes to `onTranscriptRewound` so timeline state matches disk after
 * a prompt rewind.
 */

import { create } from 'zustand';
import type {
  RewindPreviewResult,
  RewindResult
} from '@shared/types/checkpoint.js';
import type { TimelineEvent } from '@shared/types/chat.js';
import { vyotiq } from '../lib/ipc.js';
import { logger } from '../lib/logger.js';
import { useChatStore } from './useChatStore.js';

const log = logger.child('checkpoints-store');

let transcriptRewoundTeardown: (() => void) | undefined;

/**
 * Wire the transcript-rewind broadcast once (first rewind/diff read).
 * Replaces the former App-level `initOnce()` call.
 */
export function ensureTranscriptRewoundSubscription(): void {
  if (transcriptRewoundTeardown) return;
  transcriptRewoundTeardown = vyotiq.checkpoints.onTranscriptRewound((conversationId) => {
    const suppressSet = useCheckpointsStore.getState().suppressNextTranscriptRewound;
    if (suppressSet.has(conversationId)) {
      suppressSet.delete(conversationId);
      return;
    }
    void (async () => {
      try {
        const conv = await vyotiq.conversations.read(conversationId);
        const events: TimelineEvent[] = conv?.events ?? [];
        useChatStore.getState().setTranscript(conversationId, events);
      } catch (err) {
        log.warn('onTranscriptRewound: re-read failed', { conversationId, err });
      }
    })();
  });
}

/** Test-only: reset the subscription so mocks can re-wire `onTranscriptRewound`. */
export function teardownTranscriptRewoundSubscriptionForTests(): void {
  transcriptRewoundTeardown?.();
  transcriptRewoundTeardown = undefined;
}

interface CheckpointsStore {
  /**
   * Conversations whose `onTranscriptRewound` broadcast handler must
   * be SUPPRESSED for one cycle. Populated by `rewindToPrompt` right
   * before it explicitly refreshes the transcript itself; cleared
   * after the explicit refresh completes.
   */
  suppressNextTranscriptRewound: Set<string>;
  /**
   * Compute the rewind impact preview WITHOUT touching disk. Drives
   * the inline revert / edit prompt session impact summary.
   */
  previewRewind: (input: {
    conversationId: string;
    workspaceId: string;
    promptEventId: string;
  }) => Promise<RewindPreviewResult>;
  /**
   * Trim the conversation transcript from a user-prompt event onward.
   * Workspace files on disk are not changed.
   */
  rewindToPrompt: (input: {
    conversationId: string;
    workspaceId: string;
    promptEventId: string;
  }) => Promise<RewindResult>;
  /** Clear per-conversation rewind coordination when a chat is removed. */
  dropConversation: (conversationId: string) => void;
}

export const useCheckpointsStore = create<CheckpointsStore>((_setState, getState) => ({
  suppressNextTranscriptRewound: new Set<string>(),

  previewRewind: async (input) => {
    ensureTranscriptRewoundSubscription();
    try {
      return await vyotiq.checkpoints.previewRewind(input);
    } catch (err) {
      log.warn('previewRewind failed', { ...input, err });
      return {
        ok: false,
        error: { kind: 'fs', message: err instanceof Error ? err.message : String(err) }
      };
    }
  },

  rewindToPrompt: async (input) => {
    ensureTranscriptRewoundSubscription();
    getState().suppressNextTranscriptRewound.add(input.conversationId);
    try {
      const result = await vyotiq.checkpoints.rewindToPrompt(input);
      if (result.ok) {
        try {
          const conv = await vyotiq.conversations.read(input.conversationId);
          const events: TimelineEvent[] = conv?.events ?? [];
          useChatStore
            .getState()
            .setTranscript(input.conversationId, events);
        } catch (err) {
          log.warn('rewindToPrompt: explicit transcript refresh failed', {
            conversationId: input.conversationId,
            err
          });
        }
      }
      return result;
    } catch (err) {
      log.warn('rewindToPrompt failed', { ...input, err });
      return {
        ok: false,
        error: { kind: 'fs', message: err instanceof Error ? err.message : String(err) }
      };
    } finally {
      getState().suppressNextTranscriptRewound.delete(input.conversationId);
    }
  },

  dropConversation: (conversationId) => {
    getState().suppressNextTranscriptRewound.delete(conversationId);
  }
}));
