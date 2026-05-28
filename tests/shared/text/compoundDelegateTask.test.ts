import { describe, expect, it } from 'vitest';
import { looksLikeCompoundDelegateTask } from '@shared/text/parseDelegates';

describe('looksLikeCompoundDelegateTask', () => {
  it('returns false for a single short task', () => {
    expect(looksLikeCompoundDelegateTask('Read src/foo.ts')).toBe(false);
  });

  it('detects unordered multi-step tasks', () => {
    const task = ['- Refactor the auth module', '- Update all call sites in the API layer'].join(
      '\n'
    );
    expect(looksLikeCompoundDelegateTask(task)).toBe(true);
  });

  it('detects semicolon-separated goals', () => {
    expect(
      looksLikeCompoundDelegateTask(
        'Rewrite the orchestrator loop; migrate every sub-agent harness test to the new layout'
      )
    ).toBe(true);
  });

  it('does not flag numbered sub-steps inside one deliverable', () => {
    const task = ['1. Fix imports', '2. Fix registry', '3. Fix category property'].join('\n');
    expect(looksLikeCompoundDelegateTask(task)).toBe(false);
  });
});
