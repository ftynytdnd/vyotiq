import { describe, expect, it } from 'vitest';
import { deriveRows } from '@renderer/components/timeline/reducer/deriveRows';
import type { TimelineEvent } from '@shared/types/chat';

describe('deriveRows token budget warning', () => {
  it('emits a warning row before run-complete when usage crosses 70%', () => {
    const events: TimelineEvent[] = [
      { kind: 'user-prompt', id: 'p1', ts: 1, content: 'go' },
      {
        kind: 'token-usage',
        id: 'u1',
        ts: 2,
        assistantMsgId: 'a1',
        usage: {
          promptTokens: 700,
          completionTokens: 50,
          totalTokens: 750
        }
      },
      { kind: 'user-prompt', id: 'p2', ts: 10, content: 'next' }
    ];

    const rows = deriveRows(events, { contextWindow: 1000 });
    const warning = rows.find((r) => r.kind === 'token-budget-warning');
    expect(warning?.kind).toBe('token-budget-warning');
    if (warning?.kind !== 'token-budget-warning') return;
    expect(warning.percent).toBeGreaterThanOrEqual(70);
    const doneIdx = rows.findIndex((r) => r.kind === 'run-complete');
    const warnIdx = rows.findIndex((r) => r.kind === 'token-budget-warning');
    expect(warnIdx).toBeGreaterThanOrEqual(0);
    expect(doneIdx).toBeGreaterThan(warnIdx);
  });
});
