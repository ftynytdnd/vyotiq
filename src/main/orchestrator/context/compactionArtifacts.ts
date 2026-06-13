import { mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { CONTEXT_SUMMARY_SUBDIR, WORKSPACE_DOTDIR } from '@shared/constants.js';
import { sanitizePathSegment } from '@shared/path/sanitizePathSegment.js';
import { logger } from '../../logging/logger.js';

const log = logger.child('orch/compactionArtifacts');

const COMPACTION_SUBDIR = 'compaction';

export const COMPACTION_BANNER_PREFIX = '[compacted — full output at ';

export function isCompactedToolContent(content: string): boolean {
  return content.startsWith(COMPACTION_BANNER_PREFIX);
}

export function buildCompactionBanner(relativePath: string): string {
  return `${COMPACTION_BANNER_PREFIX}${relativePath} — use read to restore]`;
}

/**
 * Stable marker key embedded in a compacted tool-CALL `arguments` string.
 * The value stays valid JSON so provider tool-pairing never breaks, and the
 * `_compacted` key lets the agent (and the reduction engine) recognize an
 * already-offloaded argument body. Host-side equivalent of Anthropic
 * `clear_tool_inputs`.
 */
const TOOL_INPUT_MARKER_KEY = '_compacted';

/** Build the replacement `arguments` JSON for an offloaded tool-call input. */
export function buildToolInputBanner(relativePath: string): string {
  return JSON.stringify({
    [TOOL_INPUT_MARKER_KEY]: relativePath,
    note: 'arguments offloaded to keep context lean — use read to restore'
  });
}

/** True when a tool-call `arguments` string is an offloaded-input banner. */
export function isCompactedToolInput(args: string | null | undefined): boolean {
  return typeof args === 'string' && args.includes(`"${TOOL_INPUT_MARKER_KEY}"`);
}

/** Absolute path of the `.vyotiq/compaction` root for a workspace. */
function compactionRoot(workspacePath: string): string {
  return path.join(workspacePath, WORKSPACE_DOTDIR, COMPACTION_SUBDIR);
}

export async function writeCompactionArtifact(
  workspacePath: string,
  conversationId: string,
  runId: string,
  toolCallId: string,
  output: string,
  /**
   * `'result'` (default) offloads a tool-result body to `<toolCallId>.txt`;
   * `'input'` offloads the tool-call arguments to `<toolCallId>.input.txt` so
   * a call whose BOTH input and result are offloaded never collides on disk.
   */
  variant: 'result' | 'input' = 'result'
): Promise<string> {
  const fileName = variant === 'input' ? `${toolCallId}.input.txt` : `${toolCallId}.txt`;
  const relativePath = path.posix.join(
    WORKSPACE_DOTDIR,
    COMPACTION_SUBDIR,
    sanitizePathSegment(conversationId),
    sanitizePathSegment(runId),
    fileName
  );
  const absolutePath = path.join(workspacePath, ...relativePath.split('/'));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, output, 'utf8');
  return relativePath;
}

/**
 * Remove every compaction artifact for a single conversation. Called when
 * the conversation is deleted — at that point the transcript (and its
 * `tool-compacted` markers) is gone, so the on-disk artifacts can never
 * be referenced again and would otherwise leak forever.
 *
 * NOTE: artifacts are intentionally NOT pruned by run age while the
 * conversation lives. Cross-turn replay rebuilds the lean banner that
 * points at the original artifact, and the model restores it on demand
 * via `read`; deleting a still-referenced artifact would break that
 * restore. Durability is bounded by actual tool-output volume, not by
 * unbounded re-compaction (replayed banners are skipped, never rewritten).
 */
export async function cleanupCompactionArtifactsForConversation(
  workspacePath: string,
  conversationId: string
): Promise<void> {
  if (!conversationId) return;
  const dir = path.join(compactionRoot(workspacePath), conversationId);
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (err: unknown) {
    log.warn('failed to remove compaction artifacts for conversation', {
      conversationId,
      err: err instanceof Error ? err.message : String(err)
    });
  }
}

/**
 * Reclaim compaction directories whose conversation no longer exists in
 * the live set (crashed / partial deletes). Bounded: only removes dirs
 * not present in `liveConversationIds`. Mirrors the attachment orphan
 * sweeper. Returns the number of directories removed.
 */
export async function sweepOrphanCompactionArtifacts(
  workspacePath: string,
  liveConversationIds: ReadonlySet<string>
): Promise<number> {
  const root = compactionRoot(workspacePath);
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return 0;
    log.warn('compaction orphan sweep: readdir failed', {
      err: err instanceof Error ? err.message : String(err)
    });
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (liveConversationIds.has(entry.name)) continue;
    try {
      await rm(path.join(root, entry.name), { recursive: true, force: true });
      removed += 1;
    } catch (err: unknown) {
      log.warn('compaction orphan sweep: rm failed', {
        conversationId: entry.name,
        err: err instanceof Error ? err.message : String(err)
      });
    }
  }
  if (removed > 0) {
    log.info('compaction orphan sweep removed dirs', { removed });
  }
  return removed;
}

// ────────────────────────────────────────────────────────────────────
// Reversible context-summary transcripts (`.vyotiq/context-summaries/...`).
// A summary collapses prior history into a structured block; the full
// pre-summary transcript is written here so the user/agent can recover it.
// ────────────────────────────────────────────────────────────────────

export const SUMMARY_RECOVERY_HINT = ' — full transcript saved at ';

/** Absolute path of the `.vyotiq/context-summaries` root for a workspace. */
function summaryRoot(workspacePath: string): string {
  return path.join(workspacePath, WORKSPACE_DOTDIR, CONTEXT_SUMMARY_SUBDIR);
}

/**
 * Persist the full pre-summary transcript for a run. Returns the
 * workspace-relative path embedded in the `context-summary` marker so the
 * agent can `read` it back on demand.
 */
export async function writeSummaryArtifact(
  workspacePath: string,
  conversationId: string,
  runId: string,
  transcript: string
): Promise<string> {
  const fileName = `${Date.now()}-${randomUUID().slice(0, 8)}.txt`;
  const relativePath = path.posix.join(
    WORKSPACE_DOTDIR,
    CONTEXT_SUMMARY_SUBDIR,
    sanitizePathSegment(conversationId),
    sanitizePathSegment(runId),
    fileName
  );
  const absolutePath = path.join(workspacePath, ...relativePath.split('/'));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, transcript, 'utf8');
  return relativePath;
}

/**
 * Remove a single summary artifact by its workspace-relative path. Called when
 * summarization is written to disk but the model call then fails / yields
 * nothing — without this the transcript file would orphan (no `context-summary`
 * marker ever references it) until the whole conversation is deleted/swept.
 */
export async function removeSummaryArtifact(
  workspacePath: string,
  relativePath: string
): Promise<void> {
  if (!relativePath) return;
  const absolutePath = path.join(workspacePath, ...relativePath.split('/'));
  try {
    await rm(absolutePath, { force: true });
  } catch (err: unknown) {
    log.warn('failed to remove orphaned summary artifact', {
      relativePath,
      err: err instanceof Error ? err.message : String(err)
    });
  }
}

/** Remove every summary artifact for a single (deleted) conversation. */
export async function cleanupSummaryArtifactsForConversation(
  workspacePath: string,
  conversationId: string
): Promise<void> {
  if (!conversationId) return;
  const dir = path.join(summaryRoot(workspacePath), conversationId);
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (err: unknown) {
    log.warn('failed to remove summary artifacts for conversation', {
      conversationId,
      err: err instanceof Error ? err.message : String(err)
    });
  }
}

/** Reclaim summary directories whose conversation no longer exists. */
export async function sweepOrphanSummaryArtifacts(
  workspacePath: string,
  liveConversationIds: ReadonlySet<string>
): Promise<number> {
  const root = summaryRoot(workspacePath);
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return 0;
    log.warn('summary orphan sweep: readdir failed', {
      err: err instanceof Error ? err.message : String(err)
    });
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (liveConversationIds.has(entry.name)) continue;
    try {
      await rm(path.join(root, entry.name), { recursive: true, force: true });
      removed += 1;
    } catch (err: unknown) {
      log.warn('summary orphan sweep: rm failed', {
        conversationId: entry.name,
        err: err instanceof Error ? err.message : String(err)
      });
    }
  }
  if (removed > 0) {
    log.info('summary orphan sweep removed dirs', { removed });
  }
  return removed;
}
