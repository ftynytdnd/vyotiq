import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __test_resetWorkspaceWatchSuppress,
  isTreeWatchSuppressed,
  suppressTreeWatchForWrite
} from '../../../src/main/workspace/workspaceWatchSuppress.js';

describe('workspaceWatchSuppress', () => {
  afterEach(() => {
    __test_resetWorkspaceWatchSuppress();
    vi.useRealTimers();
  });

  it('suppresses watch events for a relative path within the TTL', () => {
    vi.useFakeTimers();
    suppressTreeWatchForWrite('ws-1', 'src/main.ts', 2000);
    expect(isTreeWatchSuppressed('ws-1', 'src/main.ts')).toBe(true);
    vi.advanceTimersByTime(1999);
    expect(isTreeWatchSuppressed('ws-1', 'src/main.ts')).toBe(true);
    vi.advanceTimersByTime(2);
    expect(isTreeWatchSuppressed('ws-1', 'src/main.ts')).toBe(false);
  });

  it('normalizes Windows separators', () => {
    suppressTreeWatchForWrite('ws-1', 'src\\main.ts');
    expect(isTreeWatchSuppressed('ws-1', 'src/main.ts')).toBe(true);
  });
});
