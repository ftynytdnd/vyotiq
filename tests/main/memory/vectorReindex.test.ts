/**
 * Vector re-index hook when embedder settings change.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '@shared/types/ipc.js';

const { forceReindexWorkspace, listWorkspaces } = vi.hoisted(() => ({
  forceReindexWorkspace: vi.fn(async () => ({ indexed: 0, skipped: 0, errors: 0 })),
  listWorkspaces: vi.fn(async () => ({
    activeId: 'ws-a',
    workspaces: [
      { id: 'ws-a', path: '/tmp/ws-a', label: 'A', addedAt: 0 },
      { id: 'ws-b', path: '/tmp/ws-b', label: 'B', addedAt: 0 }
    ]
  }))
}));

vi.mock('@main/memory/vector/indexScheduler', () => ({
  forceReindexWorkspace
}));

vi.mock('@main/workspace/workspaceState', () => ({
  listWorkspaces
}));

import { reindexAllWorkspacesIfVectorMemoryChanged } from '@main/settings/vectorReindexOnSettings';

function settings(embedder: 'hash' | 'ollama' = 'hash'): AppSettings {
  return {
    ui: {
      vectorMemory: {
        embedder,
        ollamaBaseUrl: 'http://127.0.0.1:11434',
        ollamaModel: 'nomic-embed-text'
      }
    }
  };
}

describe('reindexAllWorkspacesIfVectorMemoryChanged', () => {
  beforeEach(() => {
    forceReindexWorkspace.mockClear();
    listWorkspaces.mockClear();
  });

  it('does nothing when vector memory fingerprint is unchanged', async () => {
    const s = settings('hash');
    await reindexAllWorkspacesIfVectorMemoryChanged(s, settings('hash'));
    expect(listWorkspaces).not.toHaveBeenCalled();
    expect(forceReindexWorkspace).not.toHaveBeenCalled();
  });

  it('force-reindexes every workspace when embedder changes', async () => {
    await reindexAllWorkspacesIfVectorMemoryChanged(settings('hash'), settings('ollama'));
    expect(listWorkspaces).toHaveBeenCalledOnce();
    expect(forceReindexWorkspace).toHaveBeenCalledTimes(2);
    expect(forceReindexWorkspace).toHaveBeenCalledWith('/tmp/ws-a');
    expect(forceReindexWorkspace).toHaveBeenCalledWith('/tmp/ws-b');
  });
});

describe('forceReindexWorkspace', () => {
  it('is invoked by the settings hook when ollama model changes', async () => {
    const before = settings('ollama');
    const after: AppSettings = {
      ui: {
        vectorMemory: {
          ...before.ui!.vectorMemory!,
          ollamaModel: 'mxbai-embed-large'
        }
      }
    };
    await reindexAllWorkspacesIfVectorMemoryChanged(before, after);
    expect(forceReindexWorkspace).toHaveBeenCalled();
  });
});
