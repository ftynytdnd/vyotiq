/**
 * Regression: ingest-paths must not throw on long but valid workspace paths;
 * oversize entries are rejected per-file with toast feedback.
 */

import { describe, expect, it, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MAX_IO_PATH_BYTES } from '@shared/constants.js';
import { registerAttachmentsIpc } from '@main/ipc/attachments.ipc.js';
import { IPC } from '@shared/constants.js';
import { ipcMain } from 'electron';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  clipboard: { read: vi.fn(), readText: vi.fn(), readImage: vi.fn(() => ({ isEmpty: () => true })) },
  shell: { openPath: vi.fn() }
}));

vi.mock('@main/workspace/workspaceState.js', () => ({
  requireWorkspaceById: vi.fn()
}));

vi.mock('@main/ui/uiToast.js', () => ({
  notifyUiToast: vi.fn()
}));

import { requireWorkspaceById } from '@main/workspace/workspaceState.js';
import { notifyUiToast } from '@main/ui/uiToast.js';

type Handler = (_event: unknown, input: unknown) => Promise<unknown>;

function getHandler(channel: string): Handler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel);
  if (!call) throw new Error(`handler not registered: ${channel}`);
  return call[1] as Handler;
}

describe('attachments:ingest-paths', () => {
  let workspace: string;

  afterEach(async () => {
    vi.clearAllMocks();
    vi.mocked(ipcMain.handle).mockClear();
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  });

  it('does not throw when a path exceeds the legacy 4096-byte IPC cap', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'vyotiq-ingest-'));
    const longRel = `${'nested/'.repeat(700)}missing.txt`;

    vi.mocked(requireWorkspaceById).mockResolvedValue(workspace);
    registerAttachmentsIpc();
    const handler = getHandler(IPC.ATTACHMENTS_INGEST_PATHS);

    await expect(
      handler(null, {
        paths: [longRel],
        workspaceId: 'ws-1',
        conversationId: 'conv-1',
        messageId: 'msg-1'
      })
    ).resolves.toEqual([]);
  });

  it('rejects oversize paths without failing the whole batch', async () => {
    workspace = await mkdtemp(join(tmpdir(), 'vyotiq-ingest-'));
    const oversize = 'x'.repeat(MAX_IO_PATH_BYTES + 1);

    vi.mocked(requireWorkspaceById).mockResolvedValue(workspace);
    registerAttachmentsIpc();
    const handler = getHandler(IPC.ATTACHMENTS_INGEST_PATHS);

    const ingested = await handler(null, {
      paths: ['short-missing.txt', oversize],
      workspaceId: 'ws-1',
      conversationId: 'conv-1',
      messageId: 'msg-1'
    });

    expect(ingested).toEqual([]);
    expect(vi.mocked(notifyUiToast)).toHaveBeenCalled();
  });
});
