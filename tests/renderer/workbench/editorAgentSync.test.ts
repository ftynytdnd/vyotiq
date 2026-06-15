import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEditorStore } from '../../../src/renderer/store/useEditorStore.js';
import { useEditorAgentSync } from '../../../src/renderer/hooks/useEditorAgentSync.js';

const { onEventMock, readMock } = vi.hoisted(() => ({
  onEventMock: vi.fn(),
  readMock: vi.fn()
}));

vi.mock('../../../src/renderer/lib/ipc.js', () => ({
  vyotiq: {
    chat: { onEvent: onEventMock },
    editor: { read: readMock, write: vi.fn() },
    settings: { set: vi.fn() }
  }
}));

function seedTab(overrides: Record<string, unknown> = {}) {
  const tab = {
    filePath: 'src/main.ts',
    workspaceId: 'ws-1',
    content: 'before',
    savedContent: 'before',
    mtimeMs: 100,
    truncated: false,
    loading: false,
    saving: false,
    staleOnDisk: false,
    agentStreaming: false,
    error: null,
    eol: 'lf' as const,
    encoding: 'utf-8' as const,
    utf8Bom: false,
    ...overrides
  };
  useEditorStore.setState({
    open: true,
    tabs: [tab],
    activeFilePath: tab.filePath,
    pendingUnsavedClose: null,
    filePath: tab.filePath,
    workspaceId: tab.workspaceId,
    content: tab.content,
    savedContent: tab.savedContent,
    mtimeMs: tab.mtimeMs,
    truncated: tab.truncated,
    loading: tab.loading,
    saving: tab.saving,
    staleOnDisk: tab.staleOnDisk,
    error: tab.error
  });
  return tab;
}

describe('useEditorAgentSync', () => {
  let emit: (event: unknown) => void;

  beforeEach(() => {
    onEventMock.mockReset();
    readMock.mockReset();
    onEventMock.mockImplementation((handler: (runId: string, event: unknown) => void) => {
      emit = (event) => handler('run-1', event);
      return () => {};
    });
    useEditorStore.setState({
      open: false,
      tabs: [],
      activeFilePath: null,
      pendingUnsavedClose: null
    });
  });

  it('applies live postBody and marks tab agent-streaming', () => {
    seedTab();
    renderHook(() => useEditorAgentSync());

    emit({
      kind: 'diff-stream',
      filePath: 'src/main.ts',
      settled: false,
      postBody: 'streaming body'
    });

    const tab = useEditorStore.getState().tabs[0]!;
    expect(tab.content).toBe('streaming body');
    expect(tab.savedContent).toBe('before');
    expect(tab.agentStreaming).toBe(true);
  });

  it('clears streaming and refreshes from disk when diff settles', async () => {
    readMock.mockResolvedValue({
      content: 'settled on disk',
      mtimeMs: 200,
      truncated: false,
      eol: 'lf',
      encoding: 'utf-8',
      utf8Bom: false
    });

    seedTab({ agentStreaming: true, content: 'streaming body' });
    renderHook(() => useEditorAgentSync());

    emit({
      kind: 'diff-stream',
      filePath: 'src/main.ts',
      settled: true
    });

    await vi.waitFor(() => {
      const tab = useEditorStore.getState().tabs[0]!;
      expect(tab.agentStreaming).toBe(false);
      expect(tab.content).toBe('settled on disk');
      expect(tab.savedContent).toBe('settled on disk');
    });
  });
});
