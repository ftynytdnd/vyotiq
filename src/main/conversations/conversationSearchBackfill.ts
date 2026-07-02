/**
 * One-time boot backfill: index user prompts from existing JSONL transcripts.
 */

import { listConversations, collectUserPromptIndexEntries } from './conversationStore.js';
import {
  mergePromptSearchIndexEntries,
  prunePromptSearchIndexToKnownConversations
} from './conversationSearchIndex.js';
import { logger } from '../logging/logger.js';

const log = logger.child('conversations/search-backfill');

export async function backfillPromptSearchIndex(): Promise<void> {
  const metas = await listConversations();
  const knownIds = new Set(metas.map((m) => m.id));
  const removed = await prunePromptSearchIndexToKnownConversations(knownIds);
  if (removed > 0) {
    log.info('pruned orphan prompt search index entries', { removed });
  }
  const batch = [];
  for (const meta of metas) {
    if (!meta.workspaceId || meta.eventCount === 0) continue;
    const entries = await collectUserPromptIndexEntries(meta.id, meta.workspaceId);
    batch.push(...entries);
  }
  const added = await mergePromptSearchIndexEntries(batch);
  if (added > 0) {
    log.info('backfilled prompt search index', { added, conversations: metas.length });
  }
}
