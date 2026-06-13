/**
 * Checkpoint types for run manifests, transcript rewind, and legacy blob
 * reads. Persisted on disk under `<userData>/vyotiq/checkpoints/`
 * — see `src/main/checkpoints/` for the storage layout.
 *
 * Design pillars:
 *   - Content-addressed snapshots (SHA-256). Same content stored once.
 *   - Per-run manifest groups every change a run made.
 *   - Per-file index lets the UI paint a file's whole history in one read.
 *   - Pending changes are a separate small registry keyed by conversation.
 */

import type { DiffHunk } from './tool.js';

/**
 * What kind of mutation a checkpoint entry describes.
 *   - `create`: file did not exist before; `preHash` undefined.
 *   - `modify`: file existed and was rewritten; both hashes present.
 *   - `delete`: file existed and was unlinked; `postHash` undefined.
 */
export type CheckpointChangeKind = 'create' | 'modify' | 'delete';

/**
 * One persisted change entry. Lives inside a run manifest and is
 * mirrored into the per-file index. The hashes point at content blobs
 * in the checkpoint blob store; the blobs are the authoritative
 * snapshot bodies — never duplicate file contents into this struct.
 */
export interface CheckpointEntry {
  /** Stable id for this entry. Used by the renderer and revert IPC. */
  id: string;
  /** Run that produced this entry. */
  runId: string;
  /** Conversation that owned the run. */
  conversationId: string;
  /** Workspace id (also the on-disk folder name). */
  workspaceId: string;
  /** Wall-clock ms when the change applied. */
  ts: number;
  /** Workspace-relative path (forward slashes). */
  filePath: string;
  /** Mutation kind — see `CheckpointChangeKind`. */
  kind: CheckpointChangeKind;
  /** SHA-256 of the file content BEFORE the change. Omitted for `create`. */
  preHash?: string;
  /** SHA-256 of the file content AFTER the change. Omitted for `delete`. */
  postHash?: string;
  /** Cosmetic diff stats — same numbers the timeline already shows. */
  additions: number;
  deletions: number;
  /** Cosmetic precomputed hunks for `modify`. Cap-bounded by the producer. */
  hunks?: DiffHunk[];
  /**
   * Which tool produced the entry.
   *
   *   - `'edit'`   — the `edit` tool (create / modify).
   *   - `'delete'` — the `delete` tool.
   *   - `'bash'`   — recovered from a bash-driven mutation via the
   *                  `bash` tool's pre/post snapshot path. Treated
   *                  identically on revert; UI paints a terminal
   *                  badge so the user knows the change came through
   *                  a shell command.
   *
   * Older persisted manifests may carry only `'edit'` / `'delete'` —
   * that is intentional and safe; the union just widens going
   * forward.
   */
  source: 'edit' | 'delete' | 'bash';
  /**
   * `true` once the entry has been reverted to its `preHash`. The
   * entry stays in history so the timeline still shows the operation;
   * the flag just hides the Revert affordance and lets the renderer
   * paint a strike-through.
   */
  reverted?: boolean;
}

/**
 * One run's full manifest. Persisted as `runs/<runId>.json`. The
 * `entries` array grows append-only during the run and the
 * `endedAt` field is stamped on finalize.
 */
export interface CheckpointRunManifest {
  runId: string;
  conversationId: string;
  workspaceId: string;
  /** Human-friendly label — defaults to the first user prompt's first line. */
  label: string;
  startedAt: number;
  /** Null while the run is open; ms epoch on finalize. */
  endedAt: number | null;
  entries: CheckpointEntry[];
}

/**
 * One pending change as the renderer sees it. Stored in
 * `pending.json` per conversation; the file content for accept /
 * reject still lives in the blob store via the entry's hashes.
 */
export interface PendingChange {
  entryId: string;
  runId: string;
  conversationId: string;
  workspaceId: string;
  filePath: string;
  kind: CheckpointChangeKind;
  preHash?: string;
  postHash?: string;
  additions: number;
  deletions: number;
  createdAt: number;
  /** Tool that produced the pending row — mirrors `CheckpointEntry.source`. */
  source?: 'edit' | 'delete' | 'bash';
}

/**
 * One file change a rewind operation would (or did) revert. Renders
 * directly inside the inline rewind impact summary — uses
 * the same shape as `PendingChange` minus the `createdAt` slot
 * (rewinds revert the full set of entries the run produced, including
 * already-accepted ones, so per-entry "createdAt" loses meaning).
 */
export interface RewindFileChange {
  filePath: string;
  kind: CheckpointChangeKind;
  workspaceId: string;
  runId: string;
  entryId: string;
  preHash?: string;
  postHash?: string;
  additions: number;
  deletions: number;
  /** Already reverted before the rewind started; the row stays visible but the action is a no-op. */
  alreadyReverted: boolean;
}

/**
 * Snapshot returned by `checkpoints:preview-rewind`. The renderer
 * paints this as the body of the confirmation modal.
 *
 *   - `runIds`: every run that the rewind would revert (this prompt's
 *     run + every later run in the same conversation).
 *   - `files`: per-file change rows (deduped by `entryId`) listed in
 *     reverse chronological order — same order the actual revert will
 *     walk.
 *   - `transcriptEventsAffected`: how many transcript rows will be
 *     removed from the JSONL.
 *   - `promptContent`: best-effort copy of the prompt's original text
 *     so the modal header can show "Revert before: '<truncated>'…".
 */
export interface RewindPreview {
  ok: true;
  conversationId: string;
  workspaceId: string;
  promptEventId: string;
  promptContent: string;
  promptTs: number;
  runIds: string[];
  files: RewindFileChange[];
  transcriptEventsAffected: number;
}

/**
 * Failure shapes for `previewRewind` / `rewindToPrompt`. Surfaced in
 * the renderer toast when the modal can't open or the rewind itself
 * stops mid-way.
 */
// Internal — composed into `RewindPreviewResult` / `RewindResult`.
type RewindError =
  | { kind: 'unknown-conversation'; conversationId: string }
  | { kind: 'unknown-prompt'; promptEventId: string }
  | { kind: 'no-run-binding'; promptEventId: string }
  | { kind: 'fs'; message: string }
  | { kind: 'sandbox'; message: string }
  | { kind: 'blob-missing'; hash: string };

export type RewindPreviewResult = RewindPreview | { ok: false; error: RewindError };

/** Result of accept/reject/revert operations on a single entry or run. */
export type CheckpointRevertResult =
  | { ok: true; reverted: number }
  | {
      ok: false;
      error:
        | { kind: 'unknown-entry'; entryId: string }
        | { kind: 'unknown-run'; runId: string }
        | { kind: 'fs'; message: string }
        | { kind: 'sandbox'; message: string }
        | { kind: 'blob-missing'; hash: string };
    };

/**
 * Result of a successful or failed `rewindToPrompt` operation. The
 * success shape mirrors `RewindPreview` plus the actually-applied
 * counts so the renderer can paint a "reverted N files, removed M
 * transcript events" toast.
 */
export type RewindResult =
  | {
    ok: true;
    conversationId: string;
    workspaceId: string;
    promptEventId: string;
    /** Subset of the preview's `runIds` that were actually rolled back. */
    revertedRunIds: string[];
    /** Subset of the preview's files that were actually reverted (success path only). */
    revertedFiles: RewindFileChange[];
    /** Files the revert touched but failed on (FS error, missing blob). */
    failedFiles: Array<RewindFileChange & { reason: string }>;
    /** Number of transcript events removed from the JSONL. */
    removedTranscriptEvents: number;
    /** Run manifests that were deleted alongside the revert. */
    deletedRunManifests: number;
    /** Pending entries dropped because their owning run was rolled back. */
    droppedPending: number;
  }
  | { ok: false; error: RewindError };
