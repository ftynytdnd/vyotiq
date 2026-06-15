import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelEditorTabsPersist,
  readPersistedEditorTabs,
  schedulePersistEditorTabs
} from '../../../src/renderer/lib/editorTabsPersistence.js';
import { useSettingsStore } from '../../../src/renderer/store/useSettingsStore.js';

const setMock = vi.fn().mockResolvedValue({});

vi.mock('../../../src/renderer/lib/ipc.js', () => ({
  vyotiq: {
    settings: { set: (...args: unknown[]) => setMock(...args) }
  }
}));

describe('editorTabsPersistence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setMock.mockClear();
    useSettingsStore.setState({
      settings: {
        ui: {
          editorTabsByWorkspace: {
            'ws-1': [{ filePath: 'src/a.ts', active: true }]
          }
        }
      }
    } as never);
  });

  afterEach(() => {
    cancelEditorTabsPersist('ws-1');
    vi.useRealTimers();
  });

  it('reads persisted tabs for a workspace', () => {
    expect(readPersistedEditorTabs('ws-1')).toEqual([{ filePath: 'src/a.ts', active: true }]);
    expect(readPersistedEditorTabs('missing')).toEqual([]);
  });

  it('debounces settings writes', async () => {
    schedulePersistEditorTabs('ws-1', [
      { filePath: 'src/a.ts' },
      { filePath: 'src/b.ts', active: true }
    ]);
    expect(setMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(400);

    expect(setMock).toHaveBeenCalledWith({
      ui: {
        editorTabsByWorkspace: {
          'ws-1': [
            { filePath: 'src/a.ts' },
            { filePath: 'src/b.ts', active: true }
          ]
        }
      }
    });
  });

  it('cancelEditorTabsPersist prevents a pending flush', async () => {
    schedulePersistEditorTabs('ws-1', [{ filePath: 'src/c.ts' }]);
    cancelEditorTabsPersist('ws-1');
    await vi.advanceTimersByTimeAsync(400);
    expect(setMock).not.toHaveBeenCalled();
  });
});
