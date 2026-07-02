import { describe, expect, it } from 'vitest';
import { wrapCommitMessageBody } from '../../../src/shared/git/wrapCommitMessageBody.js';

describe('wrapCommitMessageBody', () => {
  it('wraps body paragraphs at 72 characters', () => {
    const long =
      'feat(app): add dashboard\n\n' +
      'This introduces a signed-in dashboard where operators can review agent activity and workflow health from one place.';
    const wrapped = wrapCommitMessageBody(long, 72);
    expect(wrapped.startsWith('feat(app): add dashboard')).toBe(true);
    const body = wrapped.split('\n\n').slice(1).join('\n\n');
    for (const line of body.split('\n')) {
      if (line.trim()) expect(line.length).toBeLessThanOrEqual(72);
    }
  });

  it('preserves BREAKING CHANGE footers', () => {
    const msg =
      'feat(api)!: remove legacy endpoint\n\n' +
      'The legacy endpoint is removed in favor of the v2 route.\n\n' +
      'BREAKING CHANGE: clients must migrate to /v2/sessions.';
    const wrapped = wrapCommitMessageBody(msg, 72);
    expect(wrapped).toContain('BREAKING CHANGE: clients must migrate to /v2/sessions.');
  });
});
