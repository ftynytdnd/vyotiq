import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../../../src/renderer/store/useEditorStore.js';

const { readMock, writeMock } = vi.hoisted(() => ({
  readMock: vi.fn(),
  writeMock: vi.fn()
}));

vi.mock('../../../src/renderer/lib/ipc.js', () => ({
  vyotiq: {
    editor: { read: readMock, write: writeMock },
    settings: { set: vi.fn() }
  }
}));

function seedCleanTab(overrides: Partial<ReturnType<typeof baseTab>> = {}) {
  const tab = { ...baseTab(), ...overrides };
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
}

function baseTab() {
  return {
    filePath: 'main.py',
    workspaceId: 'ws-1',
    content: 'on disk',
    savedContent: 'on disk',
    mtimeMs: 100,
    truncated: false,
    loading: false,
    saving: false,
    staleOnDisk: false,
    error: null,
    eol: 'lf' as const,
    encoding: 'utf-8' as const,
    utf8Bom: false,
    agentStreaming: false
  };
}

describe('useEditorStore disk sync', () => {
  beforeEach(() => {
    readMock.mockReset();
    writeMock.mockReset();
    vi.useRealTimers();
  });

  it('refreshTabFromDisk updates a clean tab in place', async () => {
    seedCleanTab();
    readMock.mockResolvedValue({
      content: 'agent edit',
      mtimeMs: 200,
      truncated: false,
      eol: 'lf',
      encoding: 'utf-8',
      utf8Bom: false
    });

    await useEditorStore.getState().refreshTabFromDisk('main.py');

    const tab = useEditorStore.getState().tabs[0]!;
    expect(tab.content).toBe('agent edit');
    expect(tab.savedContent).toBe('agent edit');
    expect(tab.mtimeMs).toBe(200);
    expect(tab.staleOnDisk).toBe(false);
  });

  it('refreshTabFromDisk marks dirty tabs stale instead of reloading active file', async () => {
    seedCleanTab({
      content: 'local edit',
      savedContent: 'on disk'
    });

    await useEditorStore.getState().refreshTabFromDisk('main.py');

    expect(readMock).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs[0]?.staleOnDisk).toBe(true);
  });

  it('autosaves after debounce when edits are not stale', async () => {
    vi.useFakeTimers();
    seedCleanTab();
    writeMock.mockResolvedValue({ ok: true, mtimeMs: 300 });

    useEditorStore.getState().setContent('edited');
    expect(writeMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1500);

    expect(writeMock).toHaveBeenCalledOnce();
    expect(useEditorStore.getState().tabs[0]?.savedContent).toBe('edited');
    expect(useEditorStore.getState().tabs[0]?.staleOnDisk).toBe(false);
  });

  it('does not autosave while stale on disk', async () => {
    vi.useFakeTimers();
    seedCleanTab({ staleOnDisk: true });
    writeMock.mockResolvedValue({ ok: true, mtimeMs: 300 });

    useEditorStore.getState().setContent('edited');
    await vi.advanceTimersByTimeAsync(1500);

    expect(writeMock).not.toHaveBeenCalled();
  });
});
