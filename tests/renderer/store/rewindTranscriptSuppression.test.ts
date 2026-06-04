/**
 * Renderer guard for `CONVERSATION_TRANSCRIPT_REWOUND` vs. `rewindToPrompt`.
 *
 * When the user confirms Revert, the store explicitly refreshes the
 * transcript and stamps `suppressNextTranscriptRewound` so the async
 * broadcast handler cannot overwrite a follow-up `send()` with a stale
 * disk snapshot (Edit & resend flow).
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import type { TimelineEvent } from '@shared/types/chat.js';
import { useChatStore } from '@renderer/store/useChatStore';
import {
  ensureTranscriptRewoundSubscription,
  teardownTranscriptRewoundSubscriptionForTests,
  useCheckpointsStore
} from '@renderer/store/useCheckpointsStore';

const convId = 'conv-rewind';

const keptPrompt: TimelineEvent = {
  kind: 'user-prompt',
  id: 'prompt-keep',
  ts: 1,
  content: 'keep'
};
const removedPrompt: TimelineEvent = {
  kind: 'user-prompt',
  id: 'prompt-remove',
  ts: 2,
  content: 'remove'
};

let rewoundHandler: ((conversationId: string) => void) | null = null;

function seedStores(): void {
  useChatStore.setState({
    slices: {
      [convId]: {
        events: [keptPrompt, removedPrompt],
        isProcessing: false,
        runId: null,
        assistantTexts: {},
        reasoningTexts: {},
        subagents: {},
        orchestratorUsage: undefined
      }
    },
    runIdToConv: {},
    events: [keptPrompt, removedPrompt],
    assistantTexts: {},
    reasoningTexts: {},
    subagents: {},
    orchestratorUsage: undefined,
    conversationId: convId,
    runId: null,
    isProcessing: false,
    runStartedAt: null
  });
  useCheckpointsStore.setState({
    suppressNextTranscriptRewound: new Set<string>()
  });
}

beforeEach(() => {
  rewoundHandler = null;
  teardownTranscriptRewoundSubscriptionForTests();
  seedStores();

  Object.assign(window.vyotiq.checkpoints, {
    onTranscriptRewound: (cb: (conversationId: string) => void) => {
      rewoundHandler = cb;
      return () => {
        rewoundHandler = null;
      };
    },
    rewindToPrompt: vi.fn(async () => ({
      ok: true as const,
      conversationId: convId,
      workspaceId: 'ws-1',
      promptEventId: removedPrompt.id,
      revertedRunIds: [],
      revertedFiles: [],
      failedFiles: [],
      removedTranscriptEvents: 1,
      droppedPending: 0,
      deletedRunManifests: 0
    }))
  });

  ensureTranscriptRewoundSubscription();
});

afterEach(() => {
  teardownTranscriptRewoundSubscriptionForTests();
});

describe('useCheckpointsStore.rewindToPrompt — transcript rewound suppression', () => {
  it('suppresses one broadcast handler refresh after an explicit rewind refresh', async () => {
    window.vyotiq.conversations.read = vi.fn(async () => ({
      id: convId,
      title: 't',
      createdAt: 0,
      updatedAt: 0,
      eventCount: 1,
      workspaceId: 'ws-1',
      events: [keptPrompt]
    }));

    window.vyotiq.checkpoints.rewindToPrompt = vi.fn(async () => {
      // Broadcast can arrive while the IPC is still in flight — before
      // the action's explicit refresh runs but after the suppress token
      // is stamped.
      rewoundHandler?.(convId);
      await Promise.resolve();
      return {
        ok: true as const,
        conversationId: convId,
        workspaceId: 'ws-1',
        promptEventId: removedPrompt.id,
        revertedRunIds: [],
        revertedFiles: [],
        failedFiles: [],
        removedTranscriptEvents: 1,
        droppedPending: 0,
        deletedRunManifests: 0
      };
    });

    await useCheckpointsStore.getState().rewindToPrompt({
      conversationId: convId,
      workspaceId: 'ws-1',
      promptEventId: removedPrompt.id
    });

    expect(useChatStore.getState().slices[convId]?.events).toEqual([keptPrompt]);
    expect(window.vyotiq.conversations.read).toHaveBeenCalledTimes(1);
  });

  it('still applies broadcast refresh when rewind was not initiated locally', async () => {
    window.vyotiq.conversations.read = vi.fn(async () => ({
      id: convId,
      title: 't',
      createdAt: 0,
      updatedAt: 0,
      eventCount: 2,
      workspaceId: 'ws-1',
      events: [keptPrompt, removedPrompt]
    }));

    rewoundHandler?.(convId);
    await Promise.resolve();

    expect(useChatStore.getState().slices[convId]?.events).toEqual([
      keptPrompt,
      removedPrompt
    ]);
    expect(window.vyotiq.conversations.read).toHaveBeenCalledTimes(1);
  });
});
