import { describe, expect, it, beforeEach } from 'vitest';
import {
  checkToolCallDedupe,
  __test_resetToolCallDedupe
} from '@main/orchestrator/toolCallDedupe';

describe('checkToolCallDedupe', () => {
  const signal = new AbortController().signal;

  beforeEach(() => {
    __test_resetToolCallDedupe(signal);
  });

  it('allows two identical dispatches then blocks the third', () => {
    const args = { path: 'src/foo.ts' };
    expect(checkToolCallDedupe(signal, 'read', args)).toBeNull();
    expect(checkToolCallDedupe(signal, 'read', args)).toBeNull();
    const blocked = checkToolCallDedupe(signal, 'read', args);
    expect(blocked).not.toBeNull();
    expect(blocked?.ok).toBe(false);
    expect(blocked?.error).toBe('duplicate_tool_call');
  });

  it('does not block finish or ask_user', () => {
    for (let i = 0; i < 5; i++) {
      expect(checkToolCallDedupe(signal, 'finish', { summary: 'done' })).toBeNull();
      expect(checkToolCallDedupe(signal, 'ask_user', { questions: [] })).toBeNull();
    }
  });
});
