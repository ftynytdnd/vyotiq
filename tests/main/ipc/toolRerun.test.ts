import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSettings, getConversationMeta, requireWorkspaceById, runToolByName } = vi.hoisted(
  () => ({
    getSettings: vi.fn(),
    getConversationMeta: vi.fn(),
    requireWorkspaceById: vi.fn(),
    runToolByName: vi.fn()
  })
);

vi.mock('@main/settings/settingsStore.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/settings/settingsStore.js')>();
  return { ...actual, getSettings };
});

vi.mock('@main/conversations/conversationStore.js', () => ({
  getConversationMeta,
  appendEvent: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@main/workspace/workspaceState.js', () => ({
  requireWorkspaceById
}));

vi.mock('@main/orchestrator/toolRunner.js', () => ({
  runToolByName
}));

vi.mock('@main/window/safeWebContentsSend.js', () => ({
  safeWebContentsSend: vi.fn()
}));

import { executeToolRerun } from '@main/ipc/toolRerun';

describe('executeToolRerun permissions', () => {
  beforeEach(() => {
    getSettings.mockReset();
    getConversationMeta.mockReset();
    requireWorkspaceById.mockReset();
    runToolByName.mockReset();

    getConversationMeta.mockResolvedValue({
      id: 'conv-1',
      workspaceId: 'ws-1'
    });
    requireWorkspaceById.mockResolvedValue('/tmp/workspace');
    getSettings.mockResolvedValue({
      permissions: { allowAuto: false },
      ui: { permissionsByWorkspace: {} }
    });
    runToolByName.mockResolvedValue({
      id: 'x',
      name: 'read',
      ok: true,
      output: 'ok',
      durationMs: 1
    });
  });

  it('ignores renderer allowAuto:true when settings disallow auto', async () => {
    const reply = await executeToolRerun({
      conversationId: 'conv-1',
      toolName: 'read',
      args: { path: 'README.md' },
      permissions: { allowAuto: true }
    });
    expect(reply.ok).toBe(true);
    expect(runToolByName).toHaveBeenCalledTimes(1);
    const ctx = runToolByName.mock.calls[0]![2] as { permissions: { allowAuto: boolean } };
    expect(ctx.permissions.allowAuto).toBe(false);
  });

  it('honors per-workspace allowAuto override from settings', async () => {
    getSettings.mockResolvedValue({
      permissions: { allowAuto: false },
      ui: { permissionsByWorkspace: { 'ws-1': { allowAuto: true } } }
    });
    await executeToolRerun({
      conversationId: 'conv-1',
      toolName: 'read',
      args: { path: 'README.md' },
      permissions: { allowAuto: false }
    });
    const ctx = runToolByName.mock.calls[0]![2] as { permissions: { allowAuto: boolean } };
    expect(ctx.permissions.allowAuto).toBe(true);
  });
});
