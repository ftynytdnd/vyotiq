/**
 * Post-dispatch edit no-match repeat guard.
 */

import { describe, expect, it } from 'vitest';
import {
  __test_resetEditFailureTracker,
  recordEditNoMatchFailure,
  shouldBlockEditNoMatchRepeat
} from '@main/orchestrator/editFailureTracker';

describe('editFailureTracker', () => {
  it('does not block before two recorded no-match failures', () => {
    const signal = new AbortController().signal;
    __test_resetEditFailureTracker(signal);

    expect(shouldBlockEditNoMatchRepeat(signal, 'src/foo.ts', 'old')).toBeNull();
    recordEditNoMatchFailure(signal, 'src/foo.ts', 'old');
    expect(shouldBlockEditNoMatchRepeat(signal, 'src/foo.ts', 'old')).toBeNull();
  });

  it('blocks on third attempt after two recorded no-match failures', () => {
    const signal = new AbortController().signal;
    __test_resetEditFailureTracker(signal);

    recordEditNoMatchFailure(signal, 'src/foo.ts', 'old');
    recordEditNoMatchFailure(signal, 'src/foo.ts', 'old');
    const blocked = shouldBlockEditNoMatchRepeat(signal, 'src/foo.ts', 'old');
    expect(blocked).not.toBeNull();
    expect(blocked?.error).toBe('edit_no_match_repeat');
    expect(blocked?.output).toContain('BLOCKED');
  });

  it('does not record failures via shouldBlock (read-only check)', () => {
    const signal = new AbortController().signal;
    __test_resetEditFailureTracker(signal);

    expect(shouldBlockEditNoMatchRepeat(signal, 'src/foo.ts', 'old')).toBeNull();
    expect(shouldBlockEditNoMatchRepeat(signal, 'src/foo.ts', 'old')).toBeNull();
    recordEditNoMatchFailure(signal, 'src/foo.ts', 'old');
    expect(shouldBlockEditNoMatchRepeat(signal, 'src/foo.ts', 'old')).toBeNull();
  });
});
