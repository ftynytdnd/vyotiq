import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  __resetConversationHeartbeatStoreForTests,
  attachConversationHeartbeat,
  detachConversationHeartbeat,
  getConversationHeartbeat,
  shouldWakeHeartbeat
} from '@main/heartbeat/conversationHeartbeatStore.js';
import { HEARTBEAT_MAX_INTERVAL_MINUTES, HEARTBEAT_MIN_INTERVAL_MINUTES } from '@shared/constants.js';

let dataDir = '';

vi.mock('@main/paths/userDataLayout.js', () => ({
  conversationHeartbeatsFilePath: () => join(dataDir, 'conversation-heartbeats.json'),
  vyotiqDataDir: () => dataDir
}));

describe('conversationHeartbeatStore', () => {
  beforeEach(async () => {
    __resetConversationHeartbeatStoreForTests();
    dataDir = await mkdtemp(join(tmpdir(), 'vyotiq-heartbeat-'));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('clamps interval minutes on attach', async () => {
    const now = Date.now();
    const row = await attachConversationHeartbeat({
      conversationId: 'conv-clamp',
      workspaceId: 'ws-1',
      intervalMinutes: 99,
      selection: { providerId: 'p1', modelId: 'm1' }
    });
    expect(row.intervalMinutes).toBe(HEARTBEAT_MAX_INTERVAL_MINUTES);
    expect(row.nextWakeAt).toBeGreaterThanOrEqual(now + HEARTBEAT_MAX_INTERVAL_MINUTES * 60_000 - 50);

    const low = await attachConversationHeartbeat({
      conversationId: 'conv-clamp-low',
      workspaceId: 'ws-1',
      intervalMinutes: 1,
      selection: { providerId: 'p1', modelId: 'm1' }
    });
    expect(low.intervalMinutes).toBe(HEARTBEAT_MIN_INTERVAL_MINUTES);
  });

  it('shouldWakeHeartbeat respects nextWakeAt', () => {
    const now = 1_000_000;
    const row = {
      conversationId: 'c1',
      workspaceId: 'w1',
      enabled: true,
      intervalMinutes: 7,
      wakePrompt: 'wake',
      selection: { providerId: 'p', modelId: 'm' },
      createdAt: now - 60_000,
      updatedAt: now,
      nextWakeAt: now + 60_000
    };
    expect(shouldWakeHeartbeat(row, now)).toBe(false);
    expect(shouldWakeHeartbeat(row, now + 60_001)).toBe(true);
  });

  it('detach removes attachment', async () => {
    await attachConversationHeartbeat({
      conversationId: 'conv-detach',
      workspaceId: 'ws-1',
      intervalMinutes: 7,
      selection: { providerId: 'p1', modelId: 'm1' }
    });
    expect(await getConversationHeartbeat('conv-detach')).not.toBeNull();
    expect(await detachConversationHeartbeat('conv-detach')).toBe(true);
    expect(await getConversationHeartbeat('conv-detach')).toBeNull();
  });

  it('uses default wake prompt when attach omits wakePrompt', async () => {
    const row = await attachConversationHeartbeat({
      conversationId: 'conv-default-wake',
      workspaceId: 'ws-1',
      intervalMinutes: 7,
      selection: { providerId: 'p1', modelId: 'm1' }
    });
    expect(row.wakePrompt).toContain('<heartbeat_wake>');
    expect(row.wakePrompt).toContain('Human oversight remains');
  });

  it('re-attach preserves createdAt and updates interval', async () => {
    const first = await attachConversationHeartbeat({
      conversationId: 'conv-reattach',
      workspaceId: 'ws-1',
      intervalMinutes: 7,
      selection: { providerId: 'p1', modelId: 'm1' }
    });
    const second = await attachConversationHeartbeat({
      conversationId: 'conv-reattach',
      workspaceId: 'ws-1',
      intervalMinutes: 10,
      selection: { providerId: 'p1', modelId: 'm1' }
    });
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.intervalMinutes).toBe(10);
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
  });

  it('touch advances nextWakeAt by interval', async () => {
    const row = await attachConversationHeartbeat({
      conversationId: 'conv-touch',
      workspaceId: 'ws-1',
      intervalMinutes: 7,
      selection: { providerId: 'p1', modelId: 'm1' }
    });
    const wakeAt = Date.now();
    const { touchConversationHeartbeat } = await import(
      '@main/heartbeat/conversationHeartbeatStore.js'
    );
    await touchConversationHeartbeat('conv-touch', wakeAt);
    const touched = await getConversationHeartbeat('conv-touch');
    expect(touched?.lastWakeAt).toBe(wakeAt);
    expect(touched?.nextWakeAt).toBe(wakeAt + row.intervalMinutes * 60_000);
  });
});
