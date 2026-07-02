import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backfillPromptSearchIndex } from '../../../src/main/conversations/conversationSearchBackfill.js';
import { __test_resetConversationIndexCacheForTests } from '../../../src/main/conversations/conversationStore.js';
import {
  resetPromptSearchIndexCacheForTests,
  searchPromptIndex
} from '../../../src/main/conversations/conversationSearchIndex.js';

vi.mock('../../../src/main/paths/userDataLayout.js', () => ({
  conversationsDir: () => mockConversationsDir
}));

let mockConversationsDir = '';

describe('conversationSearchBackfill', () => {
  beforeEach(async () => {
    __test_resetConversationIndexCacheForTests();
    resetPromptSearchIndexCacheForTests();
    mockConversationsDir = await mkdtemp(join(tmpdir(), 'vyotiq-backfill-'));
    await mkdir(mockConversationsDir, { recursive: true });
  });

  afterEach(async () => {
    __test_resetConversationIndexCacheForTests();
    resetPromptSearchIndexCacheForTests();
    if (mockConversationsDir) {
      await rm(mockConversationsDir, { recursive: true, force: true });
      mockConversationsDir = '';
    }
  });

  it('indexes user prompts from existing transcripts on backfill', async () => {
    const convId = 'conv-1';
    const wsId = 'ws-1';
    await writeFile(
      join(mockConversationsDir, 'index.json'),
      JSON.stringify([
        {
          id: convId,
          title: 'Test',
          workspaceId: wsId,
          createdAt: 1,
          updatedAt: 1,
          eventCount: 2
        }
      ]),
      'utf8'
    );
    await writeFile(
      join(mockConversationsDir, `${convId}.jsonl`),
      [
        JSON.stringify({
          kind: 'user-prompt',
          id: 'p1',
          ts: 100,
          content: 'fix the login redirect bug'
        }),
        JSON.stringify({
          kind: 'agent-text',
          id: 'a1',
          ts: 101,
          content: 'On it.'
        })
      ].join('\n') + '\n',
      'utf8'
    );

    await backfillPromptSearchIndex();

    const hits = await searchPromptIndex(wsId, 'login');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.eventId).toBe('p1');
    expect(hits[0]?.conversationId).toBe(convId);
  });

  it('prunes orphan prompt search rows before backfill merge', async () => {
    const convId = 'conv-live';
    const wsId = 'ws-1';
    await writeFile(
      join(mockConversationsDir, 'prompt-search-index.json'),
      JSON.stringify([
        {
          conversationId: 'deleted-conv',
          eventId: 'old',
          workspaceId: wsId,
          excerpt: 'orphan prompt about login',
          ts: 1
        }
      ]),
      'utf8'
    );
    await writeFile(
      join(mockConversationsDir, 'index.json'),
      JSON.stringify([
        {
          id: convId,
          title: 'Test',
          workspaceId: wsId,
          createdAt: 1,
          updatedAt: 1,
          eventCount: 1
        }
      ]),
      'utf8'
    );
    await writeFile(
      join(mockConversationsDir, `${convId}.jsonl`),
      JSON.stringify({
        kind: 'user-prompt',
        id: 'p1',
        ts: 100,
        content: 'active login fix'
      }) + '\n',
      'utf8'
    );

    await backfillPromptSearchIndex();

    const orphanHits = await searchPromptIndex(wsId, 'orphan');
    expect(orphanHits).toHaveLength(0);
    const liveHits = await searchPromptIndex(wsId, 'login');
    expect(liveHits).toHaveLength(1);
    expect(liveHits[0]?.conversationId).toBe(convId);
  });
});
