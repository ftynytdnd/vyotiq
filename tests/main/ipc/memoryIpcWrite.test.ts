/**
 * memory:write IPC — workspace append and global append paths.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC } from '@shared/constants';

interface MockIpcMain {
  __invoke: (channel: string, ...args: unknown[]) => unknown;
  __handlers: Map<string, unknown>;
}

const mockIpc = ipcMain as unknown as MockIpcMain;

const appendGlobalMetaRule = vi.fn(async () => undefined);
const writeGlobalMetaRules = vi.fn(async () => undefined);
const readGlobalMetaRules = vi.fn(async () => '# Meta\n');
const writeWorkspaceNote = vi.fn(async (key: string, content: string) => ({
  key,
  content,
  updatedAt: Date.now()
}));
const appendWorkspaceNote = vi.fn(async (key: string, content: string) => ({
  key,
  content: `existing\n${content}`,
  updatedAt: Date.now()
}));

vi.mock('@main/memory/globalMeta.js', () => ({
  appendGlobalMetaRule: (...args: unknown[]) => appendGlobalMetaRule(...args),
  writeGlobalMetaRules: (...args: unknown[]) => writeGlobalMetaRules(...args),
  readGlobalMetaRules: (...args: unknown[]) => readGlobalMetaRules(...args),
  globalMetaFilePath: () => '/tmp/meta-rules.md'
}));

vi.mock('@main/memory/workspaceNotes.js', () => ({
  listWorkspaceNotes: vi.fn(async () => []),
  readWorkspaceNote: vi.fn(async () => null),
  workspaceNotePath: () => '/tmp/note.md',
  writeWorkspaceNote: (...args: unknown[]) => writeWorkspaceNote(...args),
  appendWorkspaceNote: (...args: unknown[]) => appendWorkspaceNote(...args)
}));

const touchGlobalMemoryLastReference = vi.fn(async () => ({
  conversationId: 'conv-1',
  conversationTitle: 'Test chat',
  at: Date.now()
}));
const getGlobalMemoryLastReference = vi.fn(async () => null);

vi.mock('@main/memory/lastReferenced.js', () => ({
  touchGlobalMemoryLastReference: (...args: unknown[]) =>
    touchGlobalMemoryLastReference(...args),
  getGlobalMemoryLastReference: (...args: unknown[]) =>
    getGlobalMemoryLastReference(...args),
  getMemoryLastReference: vi.fn(async () => null),
  listMemoryLastReferences: vi.fn(async () => ({})),
  touchMemoryLastReference: vi.fn(async () => ({
    conversationId: 'conv-1',
    conversationTitle: 'Test',
    at: Date.now()
  })),
  GLOBAL_MEMORY_KEY: 'meta-rules.md'
}));

vi.mock('@main/workspace/workspaceState.js', () => ({
  getActiveWorkspace: vi.fn(async () => ({ id: 'ws-1', path: '/tmp', label: 'tmp', addedAt: 0 }))
}));

beforeEach(async () => {
  appendGlobalMetaRule.mockClear();
  writeGlobalMetaRules.mockClear();
  readGlobalMetaRules.mockClear();
  writeWorkspaceNote.mockClear();
  appendWorkspaceNote.mockClear();
  mockIpc.__handlers.clear();
  const { registerMemoryIpc } = await import('@main/ipc/memory.ipc.js');
  registerMemoryIpc();
});

describe('memory:write', () => {
  it('appends to workspace notes when mode is append', async () => {
    const entry = await mockIpc.__invoke(
      IPC.MEMORY_WRITE,
      'workspace',
      'notes.md',
      'new line',
      'append'
    );
    expect(appendWorkspaceNote).toHaveBeenCalledWith('notes.md', 'new line');
    expect(writeWorkspaceNote).not.toHaveBeenCalled();
    expect(entry).toMatchObject({ scope: 'workspace', key: 'notes.md' });
  });

  it('honors legacy append key sentinel for workspace scope', async () => {
    const entry = await mockIpc.__invoke(IPC.MEMORY_WRITE, 'workspace', 'append', 'new line');
    expect(appendWorkspaceNote).toHaveBeenCalledWith('append', 'new line');
    expect(entry).toMatchObject({ scope: 'workspace', key: 'append' });
  });

  it('appends to global meta-rules when mode is append', async () => {
    const entry = await mockIpc.__invoke(
      IPC.MEMORY_WRITE,
      'global',
      'meta-rules.md',
      'Prefer vanilla CSS',
      'append'
    );
    expect(appendGlobalMetaRule).toHaveBeenCalledWith('Prefer vanilla CSS');
    expect(writeGlobalMetaRules).not.toHaveBeenCalled();
    expect(entry).toMatchObject({ scope: 'global', key: 'meta-rules.md' });
  });

  it('records global last-referenced when conversationId is supplied', async () => {
    touchGlobalMemoryLastReference.mockClear();
    const entry = await mockIpc.__invoke(
      IPC.MEMORY_WRITE,
      'global',
      'meta-rules.md',
      '# Rules',
      'set',
      'conv-99'
    );
    expect(touchGlobalMemoryLastReference).toHaveBeenCalledWith('conv-99');
    expect(entry.lastReferencedConversationId).toBe('conv-1');
  });

  it('overwrites workspace notes with set mode', async () => {
    const entry = await mockIpc.__invoke(
      IPC.MEMORY_WRITE,
      'workspace',
      'project.md',
      '# Notes',
      'set'
    );
    expect(writeWorkspaceNote).toHaveBeenCalledWith('project.md', '# Notes');
    expect(entry).toMatchObject({ scope: 'workspace', key: 'project.md', content: '# Notes' });
  });
});
