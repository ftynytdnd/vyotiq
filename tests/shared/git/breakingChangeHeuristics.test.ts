import { describe, expect, it } from 'vitest';
import {
  analyzeBreakingChanges,
  messageSignalsBreakingChange
} from '../../../src/shared/git/breakingChangeHeuristics.js';

describe('breakingChangeHeuristics', () => {
  it('flags removed exports in diff', () => {
    const diff = [
      'diff --git a/src/api.ts b/src/api.ts',
      '-export function legacyClient() {}',
      '-export type LegacyOpts = { id: string }',
      '+export function createClient() {}'
    ].join('\n');
    const hints = analyzeBreakingChanges(diff, 'M src/api.ts');
    expect(hints.likelyBreaking).toBe(true);
    expect(hints.promptHint).toContain('BREAKING CHANGE');
  });

  it('detects breaking markers in message', () => {
    expect(messageSignalsBreakingChange('feat(api)!: remove legacy route')).toBe(true);
    expect(messageSignalsBreakingChange('feat(api): add route\n\nBREAKING CHANGE: old route removed')).toBe(
      true
    );
    expect(messageSignalsBreakingChange('feat(api): add route')).toBe(false);
  });
});
