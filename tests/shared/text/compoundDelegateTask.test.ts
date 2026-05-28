import { describe, expect, it } from 'vitest';
import { looksLikeCompoundDelegateTask } from '@shared/text/parseDelegates';

describe('looksLikeCompoundDelegateTask', () => {
  it('returns false for a single short task', () => {
    expect(looksLikeCompoundDelegateTask('Read src/foo.ts')).toBe(false);
  });

  it('detects unordered multi-step tasks (≥3 bullets)', () => {
    const task = [
      '- Refactor the auth module',
      '- Update all call sites in the API layer',
      '- Run the integration test suite'
    ].join('\n');
    expect(looksLikeCompoundDelegateTask(task)).toBe(true);
  });

  it('does not flag two bullets as compound', () => {
    const task = ['- Refactor the auth module', '- Update all call sites in the API layer'].join(
      '\n'
    );
    expect(looksLikeCompoundDelegateTask(task)).toBe(false);
  });

  it('detects semicolon-separated goals (≥3 clauses)', () => {
    expect(
      looksLikeCompoundDelegateTask(
        'Rewrite the orchestrator loop; migrate every sub-agent harness test to the new layout; ' +
          'delete the legacy parser shim'
      )
    ).toBe(true);
  });

  it('does not flag numbered sub-steps inside one deliverable', () => {
    const task = ['1. Fix imports', '2. Fix registry', '3. Fix category property'].join('\n');
    expect(looksLikeCompoundDelegateTask(task)).toBe(false);
  });

  it('does not flag semicolons inside inline code spans (regression: F1c halt)', () => {
    // Real production task that was falsely rejected because the
    // Python one-liner inside backtick code had `;`-separated
    // statements. The model re-emitted the same task on every nudge
    // and the run halted after the nudge budget was exhausted.
    const task =
      'Fix core/agent.py \u2014 the file is corrupted by UTF-16LE encoding. ' +
      'Run this sequence:\n' +
      '1. Check current byte-size: `python -c "import os; sz = os.path.getsize(\'core/agent.py\'); print(f\'size={sz}\')"`\n' +
      '2. Inspect raw first 4 bytes: `python -c "with open(\'core/agent.py\',\'rb\') as f: raw=f.read(4); print(\' \'.join(f\'{b:02x}\' for b in raw))"`\n' +
      '3. Re-encode as utf-8: `python -c "with open(\'core/agent.py\',\'r\',encoding=\'utf-16-le\') as f: c=f.read(); with open(\'core/agent.py\',\'w\',encoding=\'utf-8\') as f: f.write(c)"`\n' +
      '4. Verify: `python -c "import ast; ast.parse(open(\'core/agent.py\').read()); print(\'Syntax OK\')"`\n' +
      'Report the results.';
    expect(looksLikeCompoundDelegateTask(task)).toBe(false);
  });

  it('still flags real semicolon-separated goals even when code spans are present', () => {
    expect(
      looksLikeCompoundDelegateTask(
        'Refactor the auth module using `bcrypt.hash()`; migrate every sub-agent harness test to the new layout; ' +
          'remove the deprecated CLI entrypoint'
      )
    ).toBe(true);
  });
});
