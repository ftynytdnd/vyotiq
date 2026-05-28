/**
 * Attachment lifecycle GC — delete copied files when a conversation is
 * removed.
 *
 * Orphan sweeps (`sweepOrphanAttachments`) are **disabled at boot** per
 * remediation Phase 3 — attachment dirs are removed only when the user
 * deletes the owning conversation. The sweeper remains exported for manual
 * maintenance or future opt-in tooling, not periodic background deletion.
 */

import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { attachmentsRoot } from './ingest.js';
import { listConversations } from '../conversations/conversationStore.js';
import { logger } from '../logging/logger.js';

const log = logger.child('attachments/gc');

/** Remove all external attachment copies for one conversation. */
export async function deleteAttachmentsForConversation(
  workspaceId: string,
  conversationId: string
): Promise<void> {
  const dir = join(attachmentsRoot(), workspaceId, conversationId);
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      log.warn('failed to delete conversation attachments', { workspaceId, conversationId, err });
    }
  }
}

/**
 * Delete attachment folders whose conversation id is absent from the
 * conversations index (crash mid-ingest, partial deletes, etc.).
 *
 * **Not scheduled at app boot** — conversation delete is the supported
 * lifecycle hook. Call manually if you need to reclaim stale dirs.
 */
export async function sweepOrphanAttachments(): Promise<number> {
  const root = attachmentsRoot();
  try {
    await stat(root);
  } catch {
    return 0;
  }

  const liveIds = new Set((await listConversations()).map((m) => m.id));
  let removed = 0;

  let workspaceDirs: string[];
  try {
    workspaceDirs = await readdir(root);
  } catch {
    return 0;
  }

  for (const workspaceId of workspaceDirs) {
    const wsPath = join(root, workspaceId);
    let wsStat;
    try {
      wsStat = await stat(wsPath);
    } catch {
      continue;
    }
    if (!wsStat.isDirectory()) continue;

    let convDirs: string[];
    try {
      convDirs = await readdir(wsPath);
    } catch {
      continue;
    }

    for (const conversationId of convDirs) {
      if (liveIds.has(conversationId)) continue;
      const convPath = join(wsPath, conversationId);
      try {
        const convStat = await stat(convPath);
        if (!convStat.isDirectory()) continue;
        await rm(convPath, { recursive: true, force: true });
        removed++;
      } catch (err: unknown) {
        log.warn('failed to remove orphan attachment dir', { convPath, err });
      }
    }
  }

  if (removed > 0) {
    log.info('swept orphan attachment dirs', { removed });
  }
  return removed;
}
