import { describe, expect, it } from 'vitest';
import { toolGroupSummary } from '@renderer/components/timeline/reducer/deriveRows/groupTools';

describe('toolGroupSummary missing path', () => {
  it('surfaces validation error instead of empty primary for failed read group', () => {
    const { primary, suffix } = toolGroupSummary('read', [
      {
        callId: 'c1',
        call: { id: 'c1', name: 'read', args: {} },
        result: {
          id: 'c1',
          name: 'read',
          ok: false,
          output: 'Error: `path` is required.',
          error: 'missing path',
          durationMs: 0
        }
      },
      {
        callId: 'c2',
        call: { id: 'c2', name: 'read', args: {} },
        result: {
          id: 'c2',
          name: 'read',
          ok: false,
          output: 'Error: `path` is required.',
          error: 'missing path',
          durationMs: 0
        }
      },
      {
        callId: 'c3',
        call: { id: 'c3', name: 'read', args: {} },
        result: {
          id: 'c3',
          name: 'read',
          ok: false,
          output: 'BLOCKED: duplicate',
          error: 'duplicate_tool_call',
          durationMs: 0
        }
      }
    ]);
    expect(primary).toBe('missing path');
    expect(suffix).toContain('2 other files');
  });
});
