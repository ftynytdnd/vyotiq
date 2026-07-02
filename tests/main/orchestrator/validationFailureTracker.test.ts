import { describe, expect, it } from 'vitest';
import {
  checkValidationRepeat,
  __test_resetValidationFailureTracker
} from '@main/orchestrator/validationFailureTracker.js';

describe('validationFailureTracker', () => {
  it('blocks after two identical validation failures', () => {
    const ac = new AbortController();
    __test_resetValidationFailureTracker(ac.signal);
    const args = { path: 'foo.ts' };

    expect(checkValidationRepeat(ac.signal, 'edit', args, 'missing oldString')).toBeNull();
    expect(checkValidationRepeat(ac.signal, 'edit', args, 'missing oldString')).not.toBeNull();
  });
});
