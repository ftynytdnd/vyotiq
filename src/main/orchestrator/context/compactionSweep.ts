/**
 * Startup orphan sweep for reversible-compaction artifacts.
 *
 * Compaction writes full tool-output bodies under each workspace's
 * `.vyotiq/compaction/<conversationId>/<runId>/<toolCallId>.txt` so the
 * model can `read` them back on demand. `removeConversation` cleans these
 * up on the delete path, but a crash mid-delete (or a pre-existing tree
 * from before cleanup wiring) can leave directories for conversations
 * that no longer exist. This sweep reclaims only those orphans — it never
 * touches a directory whose conversation is still live.
 *
 * Mirrors the attachment orphan sweeper (`attachments/gc.ts`): runs once
 * after an idle delay so it never impacts boot time.
 */

import { listConversations } from '../../conversations/conversationStore.js';
import { listWorkspaces } from '../../workspace/workspaceState.js';
import { logger } from '../../logging/logger.js';
import { sweepOrphanCompactionArtifacts } from './compactionArtifacts.js';

const log = logger.child('orch/compactionSweep');

export async function sweepOrphanCompactionAllWorkspaces(): Promise<number> {
  let convs: Awaited<ReturnType<typeof listConversations>>;
  let wsState: Awaited<ReturnType<typeof listWorkspaces>>;
  try {
    [convs, wsState] = await Promise.all([listConversations(), listWorkspaces()]);
  } catch (err: unknown) {
    log.warn('compaction orphan sweep: failed to load state', {
      err: err instanceof Error ? err.message : String(err)
    });
    return 0;
  }

  const liveByWorkspace = new Map<string, Set<string>>();
  for (const meta of convs) {
    if (!meta.workspaceId) continue;
    let set = liveByWorkspace.get(meta.workspaceId);
    if (!set) {
      set = new Set<string>();
      liveByWorkspace.set(meta.workspaceId, set);
    }
    set.add(meta.id);
  }

  let removed = 0;
  for (const ws of wsState.workspaces) {
    const live = liveByWorkspace.get(ws.id) ?? new Set<string>();
    removed += await sweepOrphanCompactionArtifacts(ws.path, live);
  }
  return removed;
}
