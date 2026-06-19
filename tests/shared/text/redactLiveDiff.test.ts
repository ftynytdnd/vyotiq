import { describe, expect, it } from 'vitest';
import {
  redactDiffHunks,
  redactParsedToolArgs,
  redactTimelineEventForDisplay
} from '@shared/text/redactLiveDiff.js';

describe('redactLiveDiff', () => {
  it('redacts secret patterns in diff hunks', () => {
    const hunks = redactDiffHunks([
      {
        oldStart: 1,
        newStart: 1,
        lines: [{ kind: '+', text: 'key=sk-abcdefghijklmnopqrstuvwxyz' }]
      }
    ]);
    expect(hunks[0]!.lines[0]!.text).toContain('[REDACTED]');
    expect(hunks[0]!.lines[0]!.text).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
  });

  it('redacts diff-stream postBody', () => {
    const event = redactTimelineEventForDisplay({
      kind: 'diff-stream',
      id: '1',
      ts: 1,
      callId: 'c1',
      tool: 'edit',
      filePath: 'a.ts',
      hunks: [],
      additions: 0,
      deletions: 0,
      postBody: 'Bearer secret-token-12345678'
    });
    expect(event.kind === 'diff-stream' && event.postBody).toContain('[REDACTED]');
  });

  it('redacts parsed tool arg strings', () => {
    const parsed = redactParsedToolArgs({
      path: 'x.ts',
      newString: 'token=supersecretvalue'
    });
    expect(parsed?.['newString']).toContain('[REDACTED]');
  });
});
