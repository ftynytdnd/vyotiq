import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TimelineEvent } from '@shared/types/chat.js';
import { TRANSCRIPT_PAGE_SIZE } from '@shared/constants.js';

let tempRoot = '';
let conversationId = '';

vi.mock('electron', () => ({
  app: {
    getPath: () => tempRoot
  }
}));

async function importStore() {
  return import('../../../src/main/conversations/conversationStore.js');
}

function userPrompt(id: string, content: string): TimelineEvent {
  return { kind: 'user-prompt', id, ts: Date.now(), content, runId: 'run-1' };
}

describe('readTranscriptTail', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'vyotiq-tail-'));
    vi.resetModules();
    const store = await importStore();
    const meta = await store.createConversation('ws-test');
    conversationId = meta.id;
  });

  afterEach(async () => {
    try {
      const store = await importStore();
      await store.flushAll();
    } catch {
      /* noop */
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('returns only the newest events when transcript exceeds limit', async () => {
    const store = await importStore();
    const total = TRANSCRIPT_PAGE_SIZE + 25;
    for (let i = 0; i < total; i += 1) {
      await store.appendEvent(conversationId, userPrompt(`evt-${i}`, `msg-${i}`));
    }
    const tail = await store.readTranscriptTail(conversationId, TRANSCRIPT_PAGE_SIZE);
    expect(tail.events).toHaveLength(TRANSCRIPT_PAGE_SIZE);
    expect(tail.totalCount).toBe(total);
    expect(tail.hasOlder).toBe(true);
    expect(tail.events[0]?.id).toBe('evt-25');
    expect(tail.events.at(-1)?.id).toBe(`evt-${total - 1}`);
  });
});

describe('readTranscriptBefore', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'vyotiq-before-'));
    vi.resetModules();
    const store = await importStore();
    const meta = await store.createConversation('ws-test');
    conversationId = meta.id;
  });

  afterEach(async () => {
    try {
      const store = await importStore();
      await store.flushAll();
    } catch {
      /* noop */
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('loads events strictly before the anchor id', async () => {
    const store = await importStore();
    for (let i = 0; i < 10; i += 1) {
      await store.appendEvent(conversationId, userPrompt(`evt-${i}`, `msg-${i}`));
    }
    const page = await store.readTranscriptBefore(conversationId, 'evt-7', 3);
    expect(page.events.map((e) => e.id)).toEqual(['evt-4', 'evt-5', 'evt-6']);
    expect(page.hasOlder).toBe(true);
  });
});
