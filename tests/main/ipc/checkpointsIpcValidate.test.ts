/**
 * Regression tests for checkpoint rewind IPC payload validation.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { IPC } from '@shared/constants';

interface MockIpcMain {
  __invoke: (channel: string, ...args: unknown[]) => unknown;
  __handlers: Map<string, unknown>;
}

const mockIpc = ipcMain as unknown as MockIpcMain;

const previewRewindMock = vi.fn(async (input: unknown) => ({
  ok: true,
  ...(input as object)
}));
const rewindToPromptMock = vi.fn(async (input: unknown) => ({
  ok: true,
  ...(input as object),
  revertedRunIds: [],
  revertedFiles: [],
  failedFiles: [],
  removedTranscriptEvents: 0,
  droppedPending: 0,
  deletedRunManifests: 0
}));

vi.mock('@main/checkpoints/rewindToPrompt.js', () => ({
  previewRewind: (input: unknown) => previewRewindMock(input),
  rewindToPrompt: (input: unknown) => rewindToPromptMock(input)
}));

vi.mock('@main/checkpoints/index.js', () => ({
  acceptEntry: vi.fn(),
  acceptAll: vi.fn(),
  rejectEntry: vi.fn(),
  revertEntryById: vi.fn(),
  revertRun: vi.fn(),
  revertFileToHash: vi.fn(),
  exportArchiveForWorkspace: vi.fn(),
  prune: vi.fn(),
  deleteRun: vi.fn(),
  getSummary: vi.fn(async () => ({ workspaceId: 'ws', runs: [], files: [], usage: {} })),
  getRunManifest: vi.fn(),
  getFileHistory: vi.fn(),
  listPending: vi.fn(async () => []),
  lookupEntryLocation: vi.fn(),
  readBlobBody: vi.fn(),
  setCheckpointsBroadcaster: vi.fn()
}));

vi.mock('@main/workspace/workspaceState.js', () => ({
  listWorkspaces: vi.fn(async () => ({ activeId: null, workspaces: [] })),
  requireWorkspaceById: vi.fn(async () => '/tmp/ws')
}));

vi.mock('@main/tools/sandbox.js', () => ({
  realpathInsideWorkspace: vi.fn(async (_root: string, rel: string) => rel)
}));

const { registerCheckpointsIpc } = await import('@main/ipc/checkpoints.ipc');

const validInput = {
  conversationId: 'conv-1',
  workspaceId: 'ws-1',
  promptEventId: 'prompt-1'
};

describe('registerCheckpointsIpc — rewind payload validation', () => {
  beforeEach(() => {
    previewRewindMock.mockClear();
    rewindToPromptMock.mockClear();
    mockIpc.__handlers.clear();
    registerCheckpointsIpc();
  });

  it('accepts a well-formed previewRewind payload', async () => {
    await mockIpc.__invoke(IPC.CHECKPOINTS_PREVIEW_REWIND, validInput);
    expect(previewRewindMock).toHaveBeenCalledWith(validInput);
  });

  it('rejects previewRewind when input is not an object', async () => {
    await expect(mockIpc.__invoke(IPC.CHECKPOINTS_PREVIEW_REWIND, null)).rejects.toThrow(
      /checkpoints:previewRewind: input must be a non-null object/
    );
    expect(previewRewindMock).not.toHaveBeenCalled();
  });

  it('rejects previewRewind when conversationId is missing', async () => {
    await expect(
      mockIpc.__invoke(IPC.CHECKPOINTS_PREVIEW_REWIND, {
        workspaceId: 'ws-1',
        promptEventId: 'prompt-1'
      })
    ).rejects.toThrow(/checkpoints:previewRewind: input\.conversationId must be a string/);
  });

  it('accepts a well-formed rewindToPrompt payload', async () => {
    await mockIpc.__invoke(IPC.CHECKPOINTS_REWIND_TO_PROMPT, validInput);
    expect(rewindToPromptMock).toHaveBeenCalledOnce();
    expect(rewindToPromptMock.mock.calls[0]?.[0]).toMatchObject(validInput);
  });

  it('rejects rewindToPrompt when promptEventId is not a string', async () => {
    await expect(
      mockIpc.__invoke(IPC.CHECKPOINTS_REWIND_TO_PROMPT, {
        ...validInput,
        promptEventId: 42
      })
    ).rejects.toThrow(/checkpoints:rewindToPrompt: input\.promptEventId must be a string/);
    expect(rewindToPromptMock).not.toHaveBeenCalled();
  });
});
