import { describe, expect, it } from 'vitest';
import { analyzeCommitHistoryStyle } from '../../../src/shared/git/commitHistoryStyle.js';

describe('commitHistoryStyle', () => {
  it('detects conventional commit history', () => {
    const log = [
      'feat(ui): add panel',
      '',
      'Adds the settings panel with workspace-aware navigation and persisted layout state for returning users.',
      '---',
      'fix(api): handle null user',
      '',
      'Prevents crashes when the session is missing by short-circuiting the auth middleware before handlers run.',
      '---'
    ].join('\n');
    const style = analyzeCommitHistoryStyle(log);
    expect(style).not.toBeNull();
    expect(style!.conventionalRatio).toBeGreaterThanOrEqual(0.5);
    expect(style!.prefersProse).toBe(true);
    expect(style!.instruction).toContain('Conventional Commits');
  });

  it('detects bullet-heavy history', () => {
    const log = [
      'chore(deps): bump packages',
      '',
      '- bump react',
      '- bump vite',
      '---',
      'chore(deps): bump eslint',
      '',
      '- bump typescript-eslint',
      '- bump eslint',
      '---'
    ].join('\n');
    const style = analyzeCommitHistoryStyle(log);
    expect(style?.prefersBullets).toBe(true);
  });
});
