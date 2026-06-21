/**
 * Regression: index.json eventCount heals from on-disk JSONL on load.
 */

import { describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TimelineEvent } from '@shared/types/chat.js';

async function freshStore() {
  const userData = await fs.mkdtemp(join(tmpdir(), 'vyotiq-eventcount-'));
  vi.resetModules();
  vi.doMock('electron', async () => {
    const actual = await vi.importActual<typeof import('electron')>('electron');
    return {
      ...actual,
      app: { ...actual.app, getPath: () => userData }
    };
  });
  const mod = await import('@main/conversations/conversationStore');
  const baseDir = join(userData, 'vyotiq', 'conversations');
  return { mod, baseDir };
}

function userEvent(content: string): TimelineEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    kind: 'user-prompt',
    ts: Date.now(),
    content
  };
}

describe('conversationStore eventCount reconcile', () => {
  it('bumps stale index eventCount from JSONL line count on load', async () => {
    const { mod, baseDir } = await freshStore();
    const meta = await mod.createConversation('ws-1');
    await mod.appendEvent(meta.id, userEvent('one'));
    await mod.appendEvent(meta.id, userEvent('two'));
    await mod.appendEvent(meta.id, userEvent('three'));
    await mod.flushAll();

    const indexPath = join(baseDir, 'index.json');
    const index = JSON.parse(await fs.readFile(indexPath, 'utf8')) as Array<{
      id: string;
      eventCount: number;
    }>;
    index[0]!.eventCount = 1;
    await fs.writeFile(indexPath, JSON.stringify(index), 'utf8');

    vi.resetModules();
    vi.doMock('electron', async () => {
      const actual = await vi.importActual<typeof import('electron')>('electron');
      return {
        ...actual,
        app: { ...actual.app, getPath: () => join(baseDir, '..', '..') }
      };
    });
    const reloaded = await import('@main/conversations/conversationStore');
    const list = await reloaded.listConversations();
    const live = list.find((c) => c.id === meta.id);
    expect(live?.eventCount).toBe(3);
  });
});
