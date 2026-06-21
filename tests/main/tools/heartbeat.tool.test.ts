/**
 * `heartbeat` tool — attach/detach/status for per-conversation wake polling.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolContext } from '@main/tools/types.js';
import {
  HEARTBEAT_MAX_INTERVAL_MINUTES,
  HEARTBEAT_MIN_INTERVAL_MINUTES
} from '@shared/constants.js';
import { __resetConversationHeartbeatStoreForTests } from '@main/heartbeat/conversationHeartbeatStore.js';

const getActiveRunSelectionMock = vi.hoisted(() => vi.fn());
const getConversationMetaMock = vi.hoisted(() => vi.fn());

vi.mock('@main/orchestrator/AgentV.js', () => ({
  getActiveRunSelectionForConversation: (...args: unknown[]) =>
    getActiveRunSelectionMock(...args)
}));

vi.mock('@main/conversations/conversationStore.js', () => ({
  getConversationMeta: (...args: unknown[]) => getConversationMetaMock(...args)
}));

vi.mock('@main/paths/userDataLayout.js', () => ({
  conversationHeartbeatsFilePath: () => join(dataDir, 'conversation-heartbeats.json'),
  vyotiqDataDir: () => dataDir
}));

let dataDir = '';

import { heartbeatTool } from '@main/tools/heartbeat.tool.js';
import { getConversationHeartbeat } from '@main/heartbeat/conversationHeartbeatStore.js';

function ctx(): ToolContext {
  return {
    workspacePath: '/tmp/ws',
    workspaceId: 'ws-1',
    runId: 'run-1',
    conversationId: 'conv-hb',
    signal: new AbortController().signal,
    emit: () => undefined
  };
}

describe('heartbeat.tool', () => {
  beforeEach(async () => {
    __resetConversationHeartbeatStoreForTests();
    dataDir = await mkdtemp(join(tmpdir(), 'vyotiq-heartbeat-tool-'));
    getActiveRunSelectionMock.mockReset();
    getConversationMetaMock.mockReset();
    getConversationMetaMock.mockResolvedValue(null);
    getActiveRunSelectionMock.mockReturnValue({
      providerId: 'p1',
      modelId: 'm1',
      workspaceId: 'ws-1'
    });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('attach persists heartbeat with clamped interval', async () => {
    const before = Date.now();
    const result = await heartbeatTool.run(
      { action: 'attach', intervalMinutes: 99 },
      ctx()
    );
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/attached/i);

    const row = await getConversationHeartbeat('conv-hb');
    expect(row).not.toBeNull();
    expect(row!.intervalMinutes).toBe(HEARTBEAT_MAX_INTERVAL_MINUTES);
    expect(row!.nextWakeAt).toBeGreaterThanOrEqual(
      before + HEARTBEAT_MAX_INTERVAL_MINUTES * 60_000 - 50
    );
    expect(row!.wakePrompt).toContain('<heartbeat_wake>');
  });

  it('attach rejects missing intervalMinutes', async () => {
    const result = await heartbeatTool.run({ action: 'attach' }, ctx());
    expect(result.ok).toBe(false);
    expect(result.error).toBe('missing intervalMinutes');
  });

  it('attach fails without active run selection or conversation model', async () => {
    getActiveRunSelectionMock.mockReturnValue(null);
    getConversationMetaMock.mockResolvedValue(null);
    const result = await heartbeatTool.run(
      { action: 'attach', intervalMinutes: 7 },
      ctx()
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('no active run selection');
  });

  it('attach uses conversation last model when no active run', async () => {
    getActiveRunSelectionMock.mockReturnValue(null);
    getConversationMetaMock.mockResolvedValue({
      id: 'conv-hb',
      lastProviderId: 'p-meta',
      lastModelId: 'm-meta'
    });
    const result = await heartbeatTool.run(
      { action: 'attach', intervalMinutes: 7 },
      ctx()
    );
    expect(result.ok).toBe(true);
    const row = await getConversationHeartbeat('conv-hb');
    expect(row?.selection).toEqual({ providerId: 'p-meta', modelId: 'm-meta' });
  });

  it('status reports attachment details', async () => {
    await heartbeatTool.run({ action: 'attach', intervalMinutes: 7 }, ctx());
    const result = await heartbeatTool.run({ action: 'status' }, ctx());
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/Heartbeat attached/);
    expect(result.output).toMatch(/intervalMinutes=7/);
  });

  it('status reports when none attached', async () => {
    const result = await heartbeatTool.run({ action: 'status' }, ctx());
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/No heartbeat attached/);
  });

  it('detach removes persisted heartbeat', async () => {
    await heartbeatTool.run({ action: 'attach', intervalMinutes: HEARTBEAT_MIN_INTERVAL_MINUTES }, ctx());
    const detached = await heartbeatTool.run({ action: 'detach' }, ctx());
    expect(detached.ok).toBe(true);
    expect(detached.output).toMatch(/detached/i);
    expect(await getConversationHeartbeat('conv-hb')).toBeNull();
  });

  it('detach is idempotent when none attached', async () => {
    const result = await heartbeatTool.run({ action: 'detach' }, ctx());
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/No heartbeat was attached/);
  });

  it('rejects invalid action', async () => {
    const result = await heartbeatTool.run({ action: 'pause' }, ctx());
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid action');
  });
});
