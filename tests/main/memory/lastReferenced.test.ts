/**
 * Memory last-referenced store — workspace notes, global meta-rules, recall read.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const userDataRoot = { path: '' };

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return userDataRoot.path;
      return join(userDataRoot.path, name);
    }
  }
}));

vi.mock('@main/conversations/conversationStore.js', () => ({
  getConversationMeta: vi.fn(async (id: string) => ({
    id,
    title: `Chat ${id}`,
    updatedAt: Date.now(),
    eventCount: 0
  }))
}));

describe('lastReferenced', () => {
  beforeEach(async () => {
    userDataRoot.path = await mkdtemp(join(tmpdir(), 'vyotiq-lastref-'));
    vi.resetModules();
  });

  afterEach(async () => {
    await rm(userDataRoot.path, { recursive: true, force: true });
  });

  it('tracks workspace note keys per workspace id', async () => {
    const {
      touchMemoryLastReference,
      getMemoryLastReference
    } = await import('@main/memory/lastReferenced.js');

    await touchMemoryLastReference('ws-a', 'project.md', 'conv-1');
    const ref = await getMemoryLastReference('ws-a', 'project.md');
    expect(ref?.conversationId).toBe('conv-1');
    expect(ref?.conversationTitle).toBe('Chat conv-1');
    expect(ref?.at).toBeGreaterThan(0);
  });

  it('tracks global meta-rules under the global bucket', async () => {
    const {
      touchGlobalMemoryLastReference,
      getGlobalMemoryLastReference,
      GLOBAL_MEMORY_KEY,
      GLOBAL_MEMORY_WORKSPACE_ID
    } = await import('@main/memory/lastReferenced.js');

    await touchGlobalMemoryLastReference('conv-global');
    const ref = await getGlobalMemoryLastReference();
    expect(ref?.conversationId).toBe('conv-global');
    const wsRef = await (
      await import('@main/memory/lastReferenced.js')
    ).getMemoryLastReference(GLOBAL_MEMORY_WORKSPACE_ID, GLOBAL_MEMORY_KEY);
    expect(wsRef?.conversationId).toBe('conv-global');
  });

  it('tracks recall read under conversation-prefixed keys', async () => {
    const {
      touchRecallConversationLastReference,
      getMemoryLastReference,
      recallConversationKey
    } = await import('@main/memory/lastReferenced.js');

    await touchRecallConversationLastReference('ws-1', 'other-conv', 'active-conv');
    const ref = await getMemoryLastReference('ws-1', recallConversationKey('other-conv'));
    expect(ref?.conversationId).toBe('active-conv');
  });
});
