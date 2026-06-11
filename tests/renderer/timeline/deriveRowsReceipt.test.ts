import { describe, expect, it } from 'vitest';
import { deriveRows } from '@renderer/components/timeline/reducer/deriveRows.js';
import type { TimelineEvent } from '@shared/types/chat.js';

describe('deriveRows run-complete stats', () => {
  it('counts bash commands on run-complete', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'p1', ts: 1, content: 'run tests' },
      {
        kind: 'tool-call',
        id: 'c1',
        ts: 2,
        runId: 'r1',
        call: {
          id: 'tc1',
          name: 'bash',
          args: { command: 'npm test' }
        }
      },
      {
        kind: 'tool-result',
        id: 'r1',
        ts: 3,
        runId: 'r1',
        result: {
          id: 'tc1',
          name: 'bash',
          ok: true,
          data: {
            tool: 'bash',
            command: 'npm test',
            stdout: 'ok',
            stderr: '',
            exitCode: 0,
            runtime: 'bash'
          }
        }
      },
      { kind: 'user-prompt', id: 'p2', ts: 10, content: 'next' }
    ];

    const rows = deriveRows(events);
    const done = rows.find((r) => r.kind === 'run-complete');
    expect(done?.kind).toBe('run-complete');
    if (done?.kind !== 'run-complete') return;
    expect(done.commandCount).toBe(1);
    expect(done.editCount).toBeUndefined();
    expect(rows.some((r) => r.kind === 'run-receipt')).toBe(false);
  });
});
