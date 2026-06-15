import { describe, expect, it } from 'vitest';
import { resolveActiveBashLiveOutput, tailLine } from '@renderer/components/timeline/shared/resolveActiveBashLiveOutput.js';

describe('resolveActiveBashLiveOutput', () => {
  it('returns live output for an unsettled bash tool-call', () => {
    const live = resolveActiveBashLiveOutput({
      events: [
        {
          kind: 'tool-call',
          id: 'e1',
          ts: 1,
          call: { id: 'call-1', name: 'bash', args: { command: 'npm test' } }
        }
      ],
      liveToolOutputByCallId: {
        'call-1': {
          tool: 'bash',
          command: 'npm test',
          stdout: 'running tests\n',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          startedAt: 1,
          ts: 2
        }
      },
      toolResultSettledIds: {}
    });
    expect(live?.stdout).toBe('running tests\n');
  });

  it('tailLine keeps the last non-empty line', () => {
    expect(tailLine('one\ntwo\nthree')).toBe('three');
  });
});
