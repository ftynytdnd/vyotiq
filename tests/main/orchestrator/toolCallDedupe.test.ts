import { describe, expect, it, beforeEach } from 'vitest';
import {
  checkToolCallDedupe,
  clearToolCallDedupeSignature,
  __test_resetToolCallDedupe
} from '@main/orchestrator/toolCallDedupe';

describe('checkToolCallDedupe', () => {
  const signal = new AbortController().signal;

  beforeEach(() => {
    __test_resetToolCallDedupe(signal);
  });

  it('allows one dispatch then blocks the second for spin-prone tools', () => {
    const args = { path: 'src/foo.ts' };
    expect(checkToolCallDedupe(signal, 'read', args)).toBeNull();
    const blocked = checkToolCallDedupe(signal, 'read', args);
    expect(blocked).not.toBeNull();
    expect(blocked?.ok).toBe(false);
    expect(blocked?.error).toBe('duplicate_tool_call');
    expect(blocked?.output).toContain('identical arguments');
  });

  it('allows two identical dispatches then blocks the third for other tools', () => {
    const args = { action: 'list' as const };
    expect(checkToolCallDedupe(signal, 'memory', args)).toBeNull();
    expect(checkToolCallDedupe(signal, 'memory', args)).toBeNull();
    const blocked = checkToolCallDedupe(signal, 'memory', args);
    expect(blocked).not.toBeNull();
    expect(blocked?.error).toBe('duplicate_tool_call');
  });

  it('does not block finish or ask_user', () => {
    for (let i = 0; i < 5; i++) {
      expect(checkToolCallDedupe(signal, 'finish', { summary: 'done' })).toBeNull();
      expect(checkToolCallDedupe(signal, 'ask_user', { questions: [] })).toBeNull();
    }
  });

  it('never blocks the self-governing context tool', () => {
    // `context` self-dedupes (graceful [already loaded] / [already listed]
    // banners) so the host must not emit the hostile generic block for it.
    for (let i = 0; i < 5; i++) {
      expect(checkToolCallDedupe(signal, 'context', { action: 'list' })).toBeNull();
      expect(
        checkToolCallDedupe(signal, 'context', { action: 'load', pack: 'ast-grep-reference' })
      ).toBeNull();
    }
  });

  it('never blocks idempotent todos merges', () => {
    const args = { merge: true, todos: [{ id: '1', content: 'x', status: 'pending' }] };
    for (let i = 0; i < 5; i++) {
      expect(checkToolCallDedupe(signal, 'todos', args)).toBeNull();
    }
  });

  it('allows one more read after clearToolCallDedupeSignature', () => {
    const args = { path: 'src/Hero.tsx' };
    expect(checkToolCallDedupe(signal, 'read', args)).toBeNull();
    expect(checkToolCallDedupe(signal, 'read', args)?.error).toBe('duplicate_tool_call');

    clearToolCallDedupeSignature(signal, 'read', args);
    expect(checkToolCallDedupe(signal, 'read', args)).toBeNull();
    expect(checkToolCallDedupe(signal, 'read', args)?.error).toBe('duplicate_tool_call');
  });
});
