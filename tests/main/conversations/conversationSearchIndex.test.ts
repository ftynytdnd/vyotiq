import { describe, expect, it } from 'vitest';
import {
  appendPromptSearchIndexEntry,
  mergePromptSearchIndexEntries,
  prunePromptSearchIndexToKnownConversations,
  removePromptSearchEntriesForConversation,
  resetPromptSearchIndexCacheForTests,
  searchPromptIndex
} from '../../../src/main/conversations/conversationSearchIndex.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/main/paths/userDataLayout.js', () => ({
  conversationsDir: () => mockConversationsDir
}));

let mockConversationsDir = '';

describe('conversationSearchIndex', () => {
  beforeEach(async () => {
    resetPromptSearchIndexCacheForTests();
    mockConversationsDir = await mkdtemp(join(tmpdir(), 'vyotiq-search-'));
  });

  afterEach(async () => {
    resetPromptSearchIndexCacheForTests();
    if (mockConversationsDir) {
      await rm(mockConversationsDir, { recursive: true, force: true });
      mockConversationsDir = '';
    }
  });

  it('indexes and searches prompt excerpts within a workspace', async () => {
    await appendPromptSearchIndexEntry({
      conversationId: 'c1',
      eventId: 'e1',
      workspaceId: 'ws1',
      excerpt: 'fix the auth middleware bug',
      ts: 1
    });
    await appendPromptSearchIndexEntry({
      conversationId: 'c2',
      eventId: 'e2',
      workspaceId: 'ws2',
      excerpt: 'fix something else',
      ts: 2
    });

    const hits = await searchPromptIndex('ws1', 'auth');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.conversationId).toBe('c1');
  });

  it('mergePromptSearchIndexEntries dedupes by eventId', async () => {
    await appendPromptSearchIndexEntry({
      conversationId: 'c1',
      eventId: 'e1',
      workspaceId: 'ws1',
      excerpt: 'existing',
      ts: 1
    });

    const added = await mergePromptSearchIndexEntries([
      {
        conversationId: 'c1',
        eventId: 'e1',
        workspaceId: 'ws1',
        excerpt: 'duplicate',
        ts: 1
      },
      {
        conversationId: 'c1',
        eventId: 'e2',
        workspaceId: 'ws1',
        excerpt: 'new prompt about auth',
        ts: 2
      }
    ]);
    expect(added).toBe(1);

    const hits = await searchPromptIndex('ws1', 'auth');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.eventId).toBe('e2');
  });

  it('removePromptSearchEntriesForConversation drops all rows for that chat', async () => {
    await appendPromptSearchIndexEntry({
      conversationId: 'c1',
      eventId: 'e1',
      workspaceId: 'ws1',
      excerpt: 'keep me',
      ts: 1
    });
    await appendPromptSearchIndexEntry({
      conversationId: 'c2',
      eventId: 'e2',
      workspaceId: 'ws1',
      excerpt: 'remove me',
      ts: 2
    });

    const removed = await removePromptSearchEntriesForConversation('c2');
    expect(removed).toBe(1);

    const hits = await searchPromptIndex('ws1', 'me');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.conversationId).toBe('c1');
  });

  it('prunePromptSearchIndexToKnownConversations drops orphan conversation rows', async () => {
    await appendPromptSearchIndexEntry({
      conversationId: 'live',
      eventId: 'e1',
      workspaceId: 'ws1',
      excerpt: 'active chat prompt',
      ts: 1
    });
    await appendPromptSearchIndexEntry({
      conversationId: 'deleted',
      eventId: 'e2',
      workspaceId: 'ws1',
      excerpt: 'deleted chat prompt',
      ts: 2
    });

    const removed = await prunePromptSearchIndexToKnownConversations(new Set(['live']));
    expect(removed).toBe(1);

    const hits = await searchPromptIndex('ws1', 'prompt');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.conversationId).toBe('live');
  });
});
