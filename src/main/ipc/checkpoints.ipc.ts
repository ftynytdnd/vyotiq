/**
 * Checkpoints IPC.
 *
 * Renderer-facing surface for the file-change review + revert system:
 *   - Read summary / per-run / per-file history.
 *   - Accept / Reject / Revert (entry, run, file→hash).
 *   - Read raw blob bodies (used by the renderer to preview diffs).
 *   - Export archive into the workspace.
 *   - Prune older than N days.
 *
 * The Accept/Reject paths emit `checkpoint-revert` TimelineEvents into
 * the chat transcript so the audit trail is reconstructable on replay.
 * Live broadcasts of `CHECKPOINTS_CHANGED` are wired via the
 * checkpoint store's `setCheckpointsBroadcaster` hook.
 */

import { IPC, READ_MAX_BYTES } from '@shared/constants.js';
import type {
  CheckpointRevertResult,
  CheckpointsSummary,
  FileHistoryRow,
  GitBaseDiffResult,
  ListGitRefsResult,
  PendingChange,
  RewindPreviewResult,
  RewindResult
} from '@shared/types/checkpoint.js';
import type { TimelineEvent } from '@shared/types/chat.js';
import { previewRewind, rewindToPrompt } from '../checkpoints/rewindToPrompt.js';
import {
  acceptEntry,
  acceptAll,
  rejectEntry,
  revertEntryById,
  revertRun,
  revertFileToHash,
  exportArchiveForWorkspace,
  prune,
  deleteRun,
  getSummary,
  getRunManifest,
  getFileHistory,
  listPending,
  lookupEntryLocation,
  readBlobBody,
  setCheckpointsBroadcaster
} from '../checkpoints/index.js';
import {
  listWorkspaces,
  requireWorkspaceById
} from '../workspace/workspaceState.js';
import { gitBaseDiffForFile, validateGitRef } from '../checkpoints/gitBaseDiff.js';
import { listGitRefs } from '../checkpoints/listGitRefs.js';
import { realpathInsideWorkspace } from '../tools/sandbox.js';
import { promises as fs } from 'node:fs';
import { appendEvent as appendConversationEvent } from '../conversations/conversationStore.js';
import { safeWebContentsSend } from '../window/safeWebContentsSend.js';
import { logger } from '../logging/logger.js';
import { wrapIpcHandler } from './wrapIpcHandler.js';
// Audit fix 2026-06-P2-1 — every id-bearing channel below now
// asserts the id is a non-empty string before reaching the
// checkpoint store. The store layer already handles unknown ids
// gracefully but it does NOT defend against e.g. `null` or numeric
// payloads that a hand-crafted invoke could send.
import {
  assertBlobHash,
  assertString,
  assertObject,
  assertNumber
} from './validate.js';

const log = logger.child('ipc/checkpoints');

// Hard cap on file paths arriving over the checkpoints channels. Same
// 4 KB ceiling the workspace ipc uses — well above any realistic
// repo path while still rejecting pathological inputs.
const MAX_CHECKPOINT_PATH_BYTES = 4096;

/**
 * Wire the broadcaster ONCE so the checkpoint store can push
 * `CHECKPOINTS_CHANGED` events to the renderer without an import
 * cycle. Idempotent — subsequent calls overwrite the previous hook.
 */
function wireBroadcaster(): void {
  // Routes through `safeWebContentsSend` so the destroyed-window guard
  // + try/catch live in one place. Audit P3-3 (2026-05).
  setCheckpointsBroadcaster((workspaceId: string) => {
    safeWebContentsSend(IPC.CHECKPOINTS_CHANGED, workspaceId);
  });
}

/**
 * Resolve every workspace id known to the registry. Used by
 * `listPending` so the cross-workspace lookup doesn't need the caller
 * to enumerate ids in advance.
 */
async function knownWorkspaceIds(): Promise<string[]> {
  const state = await listWorkspaces();
  return state.workspaces.map((w) => w.id);
}

/**
 * Forward a TimelineEvent into the conversation's persistent transcript
 * so revert audit rows survive reload. Uses fire-and-forget — the IPC
 * call still returns the structured `CheckpointRevertResult` to the
 * renderer regardless of disk-write outcome.
 */
function persistEvent(conversationId: string | undefined, event: TimelineEvent): void {
  if (!conversationId) return;
  appendConversationEvent(conversationId, event).catch((err) =>
    log.warn('appendEvent for revert failed', { conversationId, kind: event.kind, err })
  );
  // Mirror to renderer so live timeline picks it up immediately.
  // We don't have a runId binding for revert events that fire
  // outside an active run. The chat:event channel takes (runId,
  // event) — so synthesize a stable id pinned to the conversation.
  // The renderer's `applyEvent` keys off conversation, not runId,
  // so a stable per-conversation id is sufficient for routing.
  // Routes through the shared `safeWebContentsSend` helper.
  // Audit P3-3 (2026-05).
  safeWebContentsSend(IPC.CHAT_EVENT, `manual:${conversationId}`, event);
}

export function registerCheckpointsIpc(): void {
  wireBroadcaster();

  wrapIpcHandler(
    IPC.CHECKPOINTS_SUMMARY,
    async (_event, workspaceId: string): Promise<CheckpointsSummary> => {
      assertString('checkpoints:summary', 'workspaceId', workspaceId);
      return getSummary(workspaceId);
    }
  );

  wrapIpcHandler(
    IPC.CHECKPOINTS_READ_RUN,
    async (_event, workspaceId: string, runId: string) => {
      assertString('checkpoints:readRun', 'workspaceId', workspaceId);
      assertString('checkpoints:readRun', 'runId', runId);
      return getRunManifest(workspaceId, runId);
    }
  );

  wrapIpcHandler(
    IPC.CHECKPOINTS_READ_FILE_HISTORY,
    async (_event, workspaceId: string, filePath: string): Promise<FileHistoryRow[]> => {
      assertString('checkpoints:readFileHistory', 'workspaceId', workspaceId);
      assertString('checkpoints:readFileHistory', 'filePath', filePath, {
        maxBytes: MAX_CHECKPOINT_PATH_BYTES
      });
      return getFileHistory(workspaceId, filePath);
    }
  );

  wrapIpcHandler(
    IPC.CHECKPOINTS_LIST_PENDING,
    async (_event, conversationId: string): Promise<PendingChange[]> => {
      assertString('checkpoints:listPending', 'conversationId', conversationId);
      const ids = await knownWorkspaceIds();
      return listPending(conversationId, ids);
    }
  );

  wrapIpcHandler(IPC.CHECKPOINTS_ACCEPT, async (_event, entryId: string) => {
    assertString('checkpoints:accept', 'entryId', entryId);
    // `approveAutoAcceptPendingByWorkspace` previously controlled whether
    // review-tab "Approve" also accepted pending rows for that file. Review
    // IPC was removed in Phase 1 — explicit timeline Accept always proceeds
    // here regardless of the flag. Auto-accept-on-send is gated in chat.ipc.
    await acceptEntry(entryId);
  });

  wrapIpcHandler(
    IPC.CHECKPOINTS_ACCEPT_ALL,
    async (_event, conversationId: string) => {
      assertString('checkpoints:acceptAll', 'conversationId', conversationId);
      // Forward the live workspace id list so `acceptAll` warms
      // every workspace's pending bucket before the scan. Mirrors
      // the `chat:send` auto-accept path; without it a cold-start
      // bulk-accept silently misses on-disk entries the cache has
      // not yet promoted. See review finding M3.
      const ids = await knownWorkspaceIds();
      await acceptAll(conversationId, ids);
    }
  );

  wrapIpcHandler(
    IPC.CHECKPOINTS_REJECT,
    async (_event, entryId: string): Promise<CheckpointRevertResult> => {
      assertString('checkpoints:reject', 'entryId', entryId);
      // Resolve the entry's conversation up-front so the synthesized
      // `checkpoint-revert` event lands on the right transcript.
      // Fast path: the in-memory `lookupEntryLocation` map is O(1)
      // and warmed on every `recordChange` + `getRunManifest` read.
      // Cold path (unknown id, typically a stale row after a restart
      // where the manifest hasn't been touched yet): fall back to
      // the historical workspace × run scan and warm the index via
      // `getRunManifest` as we go.
      let conversationId: string | undefined;
      const cached = lookupEntryLocation(entryId);
      if (cached) {
        conversationId = cached.conversationId;
      } else {
        const ids = await knownWorkspaceIds();
        outer: for (const wsId of ids) {
          const heads = (await getSummary(wsId)).runs;
          for (const head of heads) {
            const manifest = await getRunManifest(wsId, head.runId);
            if (manifest?.entries.some((e) => e.id === entryId)) {
              conversationId = manifest.conversationId;
              break outer;
            }
          }
        }
      }
      const emit = (event: TimelineEvent) => persistEvent(conversationId, event);
      return rejectEntry(entryId, emit);
    }
  );

  wrapIpcHandler(
    IPC.CHECKPOINTS_REVERT_ENTRY,
    async (_event, entryId: string): Promise<CheckpointRevertResult> => {
      assertString('checkpoints:revertEntry', 'entryId', entryId);
      // Fast path first — see notes above on the `REJECT` handler for
      // why the in-memory index is warm for every entry the running
      // process has ever recorded or read.
      const cached = lookupEntryLocation(entryId);
      if (cached) {
        const emit = (event: TimelineEvent) =>
          persistEvent(cached.conversationId, event);
        return revertEntryById(cached.workspaceId, cached.runId, entryId, emit);
      }
      // Cold fall-back scan. `getRunManifest` warms the index as a
      // side-effect, so a second call for the same id after this
      // scan hits the fast path.
      const ids = await knownWorkspaceIds();
      for (const wsId of ids) {
        const heads = (await getSummary(wsId)).runs;
        for (const head of heads) {
          const manifest = await getRunManifest(wsId, head.runId);
          if (manifest?.entries.some((e) => e.id === entryId)) {
            const emit = (event: TimelineEvent) =>
              persistEvent(manifest.conversationId, event);
            return revertEntryById(wsId, head.runId, entryId, emit);
          }
        }
      }
      return { ok: false, error: { kind: 'unknown-entry', entryId } };
    }
  );

  wrapIpcHandler(
    IPC.CHECKPOINTS_REVERT_RUN,
    async (_event, runId: string): Promise<CheckpointRevertResult> => {
      assertString('checkpoints:revertRun', 'runId', runId);
      // We need workspaceId; scan workspaces to find the manifest.
      const ids = await knownWorkspaceIds();
      for (const wsId of ids) {
        const manifest = await getRunManifest(wsId, runId);
        if (manifest) {
          const emit = (event: TimelineEvent) =>
            persistEvent(manifest.conversationId, event);
          return revertRun(wsId, runId, emit);
        }
      }
      return { ok: false, error: { kind: 'unknown-run', runId } };
    }
  );

  wrapIpcHandler(
    IPC.CHECKPOINTS_REVERT_FILE_TO_HASH,
    async (
      _event,
      workspaceId: string,
      filePath: string,
      hash: string
    ): Promise<CheckpointRevertResult> => {
      assertString('checkpoints:revertFileToHash', 'workspaceId', workspaceId);
      assertString('checkpoints:revertFileToHash', 'filePath', filePath, {
        maxBytes: MAX_CHECKPOINT_PATH_BYTES
      });
      assertBlobHash('checkpoints:revertFileToHash', 'hash', hash);
      // No conversation context for file-history reverts (the user is
      // standing in the Checkpoints view, not a chat). The revert
      // event still fires through the broadcaster so live UIs refresh.
      const noopEmit = (_e: TimelineEvent) => {
        /* file-history reverts surface via CHECKPOINTS_CHANGED */
        void _e;
      };
      return revertFileToHash(workspaceId, filePath, hash, noopEmit);
    }
  );

  wrapIpcHandler(
    IPC.CHECKPOINTS_READ_BLOB,
    async (_event, workspaceId: string, hash: string): Promise<string | null> => {
      assertString('checkpoints:readBlob', 'workspaceId', workspaceId);
      assertBlobHash('checkpoints:readBlob', 'hash', hash);
      return readBlobBody(workspaceId, hash);
    }
  );

  wrapIpcHandler(
    IPC.CHECKPOINTS_READ_CURRENT_FILE,
    async (
      _event,
      workspaceId: string,
      filePath: string
    ): Promise<string | null> => {
      assertString('checkpoints:readCurrentFile', 'workspaceId', workspaceId);
      assertString('checkpoints:readCurrentFile', 'filePath', filePath, {
        maxBytes: MAX_CHECKPOINT_PATH_BYTES
      });
      // Sandbox-resolve INSIDE the requested workspace, not the
      // currently-active one — historical comparisons should target
      // the file's owning workspace even if the user has since
      // switched away. ENOENT (file deleted since the snapshot) is
      // expected and returned as `null` so the renderer can paint a
      // "deleted on disk" message.
      let workspacePath: string;
      try {
        workspacePath = await requireWorkspaceById(workspaceId);
      } catch (err) {
        log.warn('readCurrentFile: workspace lookup failed', { workspaceId, err });
        return null;
      }
      let abs: string;
      try {
        abs = await realpathInsideWorkspace(workspacePath, filePath);
      } catch (err) {
        log.debug('readCurrentFile: sandbox resolve failed', { filePath, err });
        return null;
      }
      try {
        const buf = await fs.readFile(abs);
        const truncated = buf.length > READ_MAX_BYTES;
        const slice = truncated ? buf.subarray(0, READ_MAX_BYTES) : buf;
        const body = slice.toString('utf8');
        return truncated
          ? `${body}\n\n[truncated at ${READ_MAX_BYTES} bytes]`
          : body;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
        log.warn('readCurrentFile: read failed', { filePath, err });
        return null;
      }
    }
  );

  wrapIpcHandler(
    IPC.CHECKPOINTS_EXPORT_ARCHIVE,
    async (_event, workspaceId: string) => {
      assertString('checkpoints:exportArchive', 'workspaceId', workspaceId);
      return exportArchiveForWorkspace(workspaceId);
    }
  );

  wrapIpcHandler(
    IPC.CHECKPOINTS_PRUNE,
    async (_event, workspaceId: string, days: number) => {
      assertString('checkpoints:prune', 'workspaceId', workspaceId);
      // `days` MUST be a positive integer below a sane upper bound
      // (a billion-day prune call is malice or a bug — and the
      // store-side date math would silently saturate without this).
      assertNumber('checkpoints:prune', 'days', days, {
        integer: true,
        min: 0,
        max: 36_500
      });
      return prune(workspaceId, days);
    }
  );

  wrapIpcHandler(
    IPC.CHECKPOINTS_DELETE_RUN,
    async (_event, workspaceId: string, runId: string) => {
      assertString('checkpoints:deleteRun', 'workspaceId', workspaceId);
      assertString('checkpoints:deleteRun', 'runId', runId);
      return deleteRun(workspaceId, runId);
    }
  );

  wrapIpcHandler(
    IPC.CHECKPOINTS_PREVIEW_REWIND,
    async (
      _event,
      input: { conversationId: string; workspaceId: string; promptEventId: string }
    ): Promise<RewindPreviewResult> => {
      assertObject('checkpoints:previewRewind', 'input', input);
      assertString('checkpoints:previewRewind', 'input.conversationId', input.conversationId);
      assertString('checkpoints:previewRewind', 'input.workspaceId', input.workspaceId);
      assertString('checkpoints:previewRewind', 'input.promptEventId', input.promptEventId);
      return previewRewind(input);
    }
  );

  wrapIpcHandler(
    IPC.CHECKPOINTS_REWIND_TO_PROMPT,
    async (
      _event,
      input: { conversationId: string; workspaceId: string; promptEventId: string }
    ): Promise<RewindResult> => {
      assertObject('checkpoints:rewindToPrompt', 'input', input);
      assertString('checkpoints:rewindToPrompt', 'input.conversationId', input.conversationId);
      assertString('checkpoints:rewindToPrompt', 'input.workspaceId', input.workspaceId);
      assertString('checkpoints:rewindToPrompt', 'input.promptEventId', input.promptEventId);
      // Hand the rewind helper concrete broadcast functions so the
      // unit can stay free of an Electron import.
      return rewindToPrompt({
        ...input,
        broadcasters: {
          // Both broadcasts route through the shared `safeWebContentsSend`
          // helper. Audit P3-3 (2026-05).
          checkpointsChanged: (workspaceId: string) => {
            safeWebContentsSend(IPC.CHECKPOINTS_CHANGED, workspaceId);
          },
          transcriptRewound: (conversationId: string) => {
            safeWebContentsSend(IPC.CONVERSATION_TRANSCRIPT_REWOUND, conversationId);
          }
        }
      });
    }
  );

  wrapIpcHandler(
    IPC.CHECKPOINTS_LIST_GIT_REFS,
    async (_event, workspaceId: string): Promise<ListGitRefsResult> => {
      assertString('checkpoints:listGitRefs', 'workspaceId', workspaceId);
      const workspacePath = await requireWorkspaceById(workspaceId);
      return listGitRefs(workspacePath);
    }
  );

  wrapIpcHandler(
    IPC.CHECKPOINTS_GIT_BASE_DIFF,
    async (
      _event,
      workspaceId: string,
      filePath: string,
      ref?: string
    ): Promise<GitBaseDiffResult> => {
      assertString('checkpoints:gitBaseDiff', 'workspaceId', workspaceId);
      assertString('checkpoints:gitBaseDiff', 'filePath', filePath, {
        maxBytes: MAX_CHECKPOINT_PATH_BYTES
      });
      if (ref !== undefined) {
        assertString('checkpoints:gitBaseDiff', 'ref', ref);
        if (!validateGitRef(ref)) {
          return { ok: false, reason: 'git-error', message: 'Invalid git ref' };
        }
      }
      const workspacePath = await requireWorkspaceById(workspaceId);
      return gitBaseDiffForFile({
        workspacePath,
        filePath,
        ...(ref !== undefined ? { ref: validateGitRef(ref)! } : {})
      });
    }
  );
}
