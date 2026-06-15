import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  disposeWorkspaceTreeWatcher,
  emitWorkspaceTreeChanged,
  watchActiveWorkspace
} from '../../../src/main/workspace/workspaceTreeWatcher.js';
import {
  __test_resetWorkspaceWatchSuppress,
  suppressTreeWatchForWrite
} from '../../../src/main/workspace/workspaceWatchSuppress.js';

const sendMock = vi.fn();
let watchCallback: ((event: string, file: string) => void) | null = null;

vi.mock('../../../src/main/window/safeWebContentsSend.js', () => ({
  safeWebContentsSend: (...args: unknown[]) => sendMock(...args)
}));

vi.mock('node:fs', () => ({
  watch: vi.fn((_path: string, _opts: unknown, cb: (event: string, file: string) => void) => {
    watchCallback = cb;
    const watcher = {
      on: vi.fn(),
      close: vi.fn()
    };
    return watcher;
  })
}));

describe('workspaceTreeWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sendMock.mockClear();
    watchCallback = null;
    __test_resetWorkspaceWatchSuppress();
    disposeWorkspaceTreeWatcher();
  });

  afterEach(() => {
    disposeWorkspaceTreeWatcher();
    __test_resetWorkspaceWatchSuppress();
    vi.useRealTimers();
  });

  it('disposes without leaking timers', () => {
    watchActiveWorkspace('ws-1', 'C:\\workspace');
    disposeWorkspaceTreeWatcher();
    vi.advanceTimersByTime(500);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('emitWorkspaceTreeChanged sends immediately', () => {
    emitWorkspaceTreeChanged('ws-1');
    expect(sendMock).toHaveBeenCalledWith('workspace:tree-changed', { workspaceId: 'ws-1' });
  });

  it('skips suppressed editor write paths', () => {
    watchActiveWorkspace('ws-1', 'C:\\workspace');
    suppressTreeWatchForWrite('ws-1', 'main.py');
    watchCallback?.('change', 'main.py');
    vi.advanceTimersByTime(200);
    expect(sendMock).not.toHaveBeenCalled();
  });
});