import { mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { WORKSPACE_DOTDIR } from '@shared/constants.js';
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

/** Absolute path of the `.vyotiq/compaction` root for a workspace. */
function compactionRoot(workspacePath: string): string {
  return path.join(workspacePath, WORKSPACE_DOTDIR, COMPACTION_SUBDIR);
}

export async function writeCompactionArtifact(
  workspacePath: string,
  conversationId: string,
  runId: string,
  toolCallId: string,
  output: string
): Promise<string> {
  const relativePath = path.posix.join(
    WORKSPACE_DOTDIR,
    COMPACTION_SUBDIR,
    conversationId,
    runId,
    `${toolCallId}.txt`
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
