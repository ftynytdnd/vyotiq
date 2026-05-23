/**
 * Checkpoints store. Per-conversation pending list + per-workspace
 * summary cache. Subscribes to the main-process `CHECKPOINTS_CHANGED`
 * broadcast so accept / reject / revert / prune updates propagate
 * without polling.
 */

import { create } from 'zustand';
import type {
  CheckpointRevertResult,
  CheckpointRunManifest,
  CheckpointsSummary,
  FileHistoryRow,
  PendingChange,
  RewindPreviewResult,
  RewindResult
} from '@shared/types/checkpoint.js';
import type { TimelineEvent } from '@shared/types/chat.js';
import { vyotiq } from '../lib/ipc.js';
import { logger } from '../lib/logger.js';
import { useChatStore } from './useChatStore.js';

const log = logger.child('checkpoints-store');

interface CheckpointsStore {
  /** Pending changes keyed by conversationId. */
  pendingByConversation: Record<string, PendingChange[]>;
  /** Summary keyed by workspaceId. */
  summaryByWorkspace: Record<string, CheckpointsSummary>;
  /** True while a summary fetch is in flight for a workspace. */
  summaryLoading: Record<string, boolean>;
  /**
   * Conversations whose `onTranscriptRewound` broadcast handler must
   * be SUPPRESSED for one cycle. Populated by `rewindToPrompt` right
   * before it explicitly refreshes the transcript itself; cleared
   * after the explicit refresh completes. Without the suppression,
   * the broadcast handler races the modal's "rewind then send"
   * sequence: an in-flight `vyotiq.conversations.read` could land
   * AFTER `send()` has already added a fresh `user-prompt` event,
   * overwriting it with the disk-only snapshot.
   *
   * Module-internal — kept off the store's public selector surface
   * because it's coordination state, not user-visible.
   */
  suppressNextTranscriptRewound: Set<string>;
  /** Subscribe to main's CHECKPOINTS_CHANGED — runs once at App boot. */
  initOnce: () => () => void;
  /** Refresh the pending list for a conversation. */
  refreshPending: (conversationId: string) => Promise<void>;
  /** Refresh the workspace summary. */
  refreshSummary: (workspaceId: string) => Promise<void>;
  /**
   * Accept one pending entry.
   *
   * Resolves to `true` on success, `false` when the underlying IPC
   * rejected and the optimistic drop was rolled back via refetch.
   * Callers that don't need the signal can still `void accept(...)`
   * — the boolean is additive. Bulk Accept-all surfaces failures
   * via toast by counting the `false` results, which would
   * otherwise be invisible after the refetch repopulated the
   * panel.
   */
  accept: (entryId: string, conversationId: string) => Promise<boolean>;
  /** Accept every pending entry for a conversation in one IPC round-trip. */
  acceptAll: (conversationId: string) => Promise<boolean>;
  /** Reject one pending entry (revert + drop). */
  reject: (entryId: string, conversationId: string) => Promise<CheckpointRevertResult>;
  /** Revert one entry (no pending interaction). */
  revertEntry: (entryId: string) => Promise<CheckpointRevertResult>;
  /** Revert an entire run. */
  revertRun: (runId: string) => Promise<CheckpointRevertResult>;
  /** Revert one file to a content hash. */
  revertFileToHash: (
    workspaceId: string,
    filePath: string,
    hash: string
  ) => Promise<CheckpointRevertResult>;
  /** Read a run's full manifest. */
  readRun: (workspaceId: string, runId: string) => Promise<CheckpointRunManifest | null>;
  /** Read a file's chronological history. */
  readFileHistory: (workspaceId: string, filePath: string) => Promise<FileHistoryRow[]>;
  /** Read a snapshot blob's UTF-8 body. */
  readBlob: (workspaceId: string, hash: string) => Promise<string | null>;
  /** Read the workspace file's CURRENT contents (for "compare with current"). */
  readCurrentFile: (workspaceId: string, filePath: string) => Promise<string | null>;
  /** Export the workspace's checkpoint store to a single JSON archive. */
  exportArchive: (workspaceId: string) => Promise<{ archivePath: string; bytes: number }>;
  /** Prune older than N days. `0` clears every checkpoint for the workspace. */
  prune: (workspaceId: string, days: number) => Promise<{ removedRuns: number; removedBlobs: number }>;
  /**
   * Delete a single run (manifest + uniquely-referenced blobs + matching
   * pending rows). Idempotent: deleting an already-deleted run resolves
   * to `{ removed: false, droppedPending: 0 }`. The Checkpoints view's
   * per-row Delete affordance routes through this action.
   */
  deleteRun: (
    workspaceId: string,
    runId: string
  ) => Promise<{ removed: boolean; droppedPending: number }>;
  /**
   * Compute the rewind impact preview WITHOUT touching disk. Drives
   * the inline `RevertPreviewModal`'s body so the user can inspect
   * which files + how many transcript events will be removed before
   * confirming.
   */
  previewRewind: (input: {
    conversationId: string;
    workspaceId: string;
    promptEventId: string;
  }) => Promise<RewindPreviewResult>;
  /**
   * Atomically revert files + trim the conversation transcript from a
   * specific user-prompt event onward. After the IPC resolves, the
   * affected conversation's chat slice is refreshed from disk so the
   * timeline rewinds visibly.
   */
  rewindToPrompt: (input: {
    conversationId: string;
    workspaceId: string;
    promptEventId: string;
  }) => Promise<RewindResult>;
}

export const useCheckpointsStore = create<CheckpointsStore>((setState, getState) => ({
  pendingByConversation: {},
  summaryByWorkspace: {},
  summaryLoading: {},
  suppressNextTranscriptRewound: new Set<string>(),

  initOnce: () => {
    // Subscribe to main's broadcast. Whenever the store changes, we
    // refresh whichever caches are currently mounted (cheap O(N) over
    // the in-memory map). Unsubscribe handle is wired into App.tsx's
    // boot effect.
    const offChanged = vyotiq.checkpoints.onChanged((workspaceId) => {
      const state = getState();
      // Refresh every per-conversation pending list. The main side
      // doesn't tell us which conversations were touched, so we
      // simply re-fetch every cached one — the work is bounded by
      // the number of conversations the renderer currently holds.
      for (const cid of Object.keys(state.pendingByConversation)) {
        void getState().refreshPending(cid);
      }
      // Refresh the summary for the affected workspace if cached.
      if (workspaceId && workspaceId !== '*' && state.summaryByWorkspace[workspaceId]) {
        void getState().refreshSummary(workspaceId);
      } else if (workspaceId === '*') {
        // Wildcard means "any workspace"; refresh whatever's cached.
        for (const wsId of Object.keys(state.summaryByWorkspace)) {
          void getState().refreshSummary(wsId);
        }
      }
    });
    // Per-conversation transcript rewind broadcast. Fires after the
    // JSONL trim hits disk inside `rewindToPrompt`. We re-read the
    // transcript and replay it through the chat reducer so the
    // timeline visibly rewinds in real time across every renderer
    // surface (including any siblings that happen to be viewing the
    // same conversation in another window in the future).
    //
    // SUPPRESSION: when the matching `rewindToPrompt` action drove
    // the rewind itself, it explicitly refreshes the transcript
    // BEFORE returning so an immediate follow-up (e.g. the
    // `Edit & resend` flow's `chat.send` dispatch) can read the
    // freshly-rewound state synchronously. The action stamps the
    // conversation id in `suppressNextTranscriptRewound` so this
    // handler can skip ONE matching broadcast — otherwise the
    // handler's async read would race the dispatched send and
    // overwrite the new `user-prompt` event with a stale disk
    // snapshot. The suppression is cleared by the action whether or
    // not the broadcast actually arrived.
    const offRewound = vyotiq.checkpoints.onTranscriptRewound((conversationId) => {
      const suppressSet = getState().suppressNextTranscriptRewound;
      if (suppressSet.has(conversationId)) {
        // Consume one suppression token; the action's finally block
        // double-checks and is a no-op if we got here first.
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
    return () => {
      offChanged();
      offRewound();
    };
  },

  refreshPending: async (conversationId: string) => {
    try {
      const list = await vyotiq.checkpoints.listPending(conversationId);
      setState((s) => ({
        pendingByConversation: { ...s.pendingByConversation, [conversationId]: list }
      }));
    } catch (err) {
      log.warn('refreshPending failed', { conversationId, err });
    }
  },

  refreshSummary: async (workspaceId: string) => {
    setState((s) => ({
      summaryLoading: { ...s.summaryLoading, [workspaceId]: true }
    }));
    try {
      const summary = await vyotiq.checkpoints.summary(workspaceId);
      setState((s) => ({
        summaryByWorkspace: { ...s.summaryByWorkspace, [workspaceId]: summary },
        summaryLoading: { ...s.summaryLoading, [workspaceId]: false }
      }));
    } catch (err) {
      log.warn('refreshSummary failed', { workspaceId, err });
      setState((s) => ({
        summaryLoading: { ...s.summaryLoading, [workspaceId]: false }
      }));
    }
  },

  accept: async (entryId, conversationId) => {
    // Optimistic drop to keep the panel responsive.
    setState((s) => {
      const list = s.pendingByConversation[conversationId];
      if (!list) return {} as Partial<CheckpointsStore>;
      return {
        pendingByConversation: {
          ...s.pendingByConversation,
          [conversationId]: list.filter((p) => p.entryId !== entryId)
        }
      };
    });
    try {
      await vyotiq.checkpoints.accept(entryId);
      return true;
    } catch (err) {
      log.warn('accept failed; refetching', { entryId, err });
      await getState().refreshPending(conversationId);
      return false;
    }
  },

  acceptAll: async (conversationId) => {
    setState((s) => ({
      pendingByConversation: {
        ...s.pendingByConversation,
        [conversationId]: []
      }
    }));
    try {
      await vyotiq.checkpoints.acceptAll(conversationId);
      await getState().refreshPending(conversationId);
      return true;
    } catch (err) {
      log.warn('acceptAll failed; refetching', { conversationId, err });
      await getState().refreshPending(conversationId);
      return false;
    }
  },

  reject: async (entryId, conversationId) => {
    // Don't optimistically drop — if the revert fails (e.g. blob
    // missing), the user should still see the pending row so they can
    // try again. Refresh on settle.
    let result: CheckpointRevertResult;
    try {
      result = await vyotiq.checkpoints.reject(entryId);
    } catch (err) {
      log.warn('reject failed', { entryId, err });
      result = {
        ok: false,
        error: { kind: 'fs', message: err instanceof Error ? err.message : String(err) }
      };
    }
    await getState().refreshPending(conversationId);
    return result;
  },

  revertEntry: async (entryId) => {
    try {
      return await vyotiq.checkpoints.revertEntry(entryId);
    } catch (err) {
      log.warn('revertEntry failed', { entryId, err });
      return {
        ok: false,
        error: { kind: 'fs', message: err instanceof Error ? err.message : String(err) }
      };
    }
  },

  revertRun: async (runId) => {
    try {
      return await vyotiq.checkpoints.revertRun(runId);
    } catch (err) {
      log.warn('revertRun failed', { runId, err });
      return {
        ok: false,
        error: { kind: 'fs', message: err instanceof Error ? err.message : String(err) }
      };
    }
  },

  revertFileToHash: async (workspaceId, filePath, hash) => {
    try {
      return await vyotiq.checkpoints.revertFileToHash(workspaceId, filePath, hash);
    } catch (err) {
      log.warn('revertFileToHash failed', { workspaceId, filePath, hash, err });
      return {
        ok: false,
        error: { kind: 'fs', message: err instanceof Error ? err.message : String(err) }
      };
    }
  },

  readRun: async (workspaceId, runId) => {
    try {
      return await vyotiq.checkpoints.readRun(workspaceId, runId);
    } catch (err) {
      log.warn('readRun failed', { workspaceId, runId, err });
      return null;
    }
  },

  readFileHistory: async (workspaceId, filePath) => {
    try {
      return await vyotiq.checkpoints.readFileHistory(workspaceId, filePath);
    } catch (err) {
      log.warn('readFileHistory failed', { workspaceId, filePath, err });
      return [];
    }
  },

  readBlob: async (workspaceId, hash) => {
    try {
      return await vyotiq.checkpoints.readBlob(workspaceId, hash);
    } catch (err) {
      log.warn('readBlob failed', { workspaceId, hash, err });
      return null;
    }
  },

  readCurrentFile: async (workspaceId, filePath) => {
    try {
      return await vyotiq.checkpoints.readCurrentFile(workspaceId, filePath);
    } catch (err) {
      log.warn('readCurrentFile failed', { workspaceId, filePath, err });
      return null;
    }
  },

  exportArchive: async (workspaceId) => {
    return vyotiq.checkpoints.exportArchive(workspaceId);
  },

  prune: async (workspaceId, days) => {
    return vyotiq.checkpoints.prune(workspaceId, days);
  },

  deleteRun: async (workspaceId, runId) => {
    // The CHECKPOINTS_CHANGED broadcast fired by main triggers the
    // summary re-fetch in `initOnce`, so no explicit cache merge is
    // needed here — the next render reflects the deletion.
    return vyotiq.checkpoints.deleteRun(workspaceId, runId);
  },

  previewRewind: async (input) => {
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
    // Stamp the suppression token BEFORE the IPC fires so the
    // broadcast handler skips its async transcript re-read. We
    // perform the refresh ourselves below (synchronously after the
    // IPC resolves) so any caller chaining a follow-up action
    // (`Edit & resend` does an immediate `send()`) sees the
    // rewound state without racing the broadcast's async pipeline.
    getState().suppressNextTranscriptRewound.add(input.conversationId);
    try {
      const result = await vyotiq.checkpoints.rewindToPrompt(input);
      if (result.ok) {
        // Explicit transcript refresh — replaces the broadcast
        // handler's role for this rewind. Reading the transcript
        // here is safe (and necessary): the JSONL trim has already
        // hit disk by the time `rewindToPrompt` resolves on main
        // (the truncation is awaited inside the helper).
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
      // Clear the suppression token whether or not the broadcast
      // handler consumed it (a failed rewind on main never fires
      // the broadcast, so the token would otherwise linger and
      // suppress the NEXT legitimate rewind).
      getState().suppressNextTranscriptRewound.delete(input.conversationId);
    }
  }
}));

/**
 * Hook helper — pending list for a single conversation. Returns an
 * empty array when nothing is cached yet (the caller usually triggers
 * `refreshPending` in a `useEffect`).
 *
 * The empty-array fallback is a frozen module-level constant rather
 * than an inline `?? []`. Zustand's `useSyncExternalStore` compares
 * the selector's return value by reference; a fresh `[]` per render
 * forces `forceStoreRerender` to fire on every store tick, which
 * schedules another render, which allocates another `[]` — until
 * React bails out with error #185 ("Maximum update depth exceeded")
 * and the ErrorBoundary swallows the surrounding subtree. The stable
 * reference here is the single fix; do NOT inline.
 */
const EMPTY_PENDING: readonly PendingChange[] = Object.freeze([]);

export function usePendingChanges(conversationId: string | null): readonly PendingChange[] {
  return useCheckpointsStore((s) => {
    if (!conversationId) return EMPTY_PENDING;
    return s.pendingByConversation[conversationId] ?? EMPTY_PENDING;
  });
}
