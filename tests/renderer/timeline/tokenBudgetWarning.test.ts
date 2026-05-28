import { describe, expect, it } from 'vitest';
import { deriveRows } from '@renderer/components/timeline/reducer/deriveRows';
import { TOKEN_BUDGET_WARNING_DEFAULT_TOKENS } from '@shared/constants';
import type { TimelineEvent } from '@shared/types/chat';

describe('deriveRows token budget warning', () => {
  const baseEvents: TimelineEvent[] = [
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

  it('emits a warning row before run-complete when usage crosses the absolute threshold', () => {
    const rows = deriveRows(baseEvents, { tokenBudgetWarnThreshold: 700, contextWindow: 1000 });
    const warning = rows.find((r) => r.kind === 'token-budget-warning');
    expect(warning?.kind).toBe('token-budget-warning');
    if (warning?.kind !== 'token-budget-warning') return;
    expect(warning.percent).toBeGreaterThanOrEqual(70);
    const doneIdx = rows.findIndex((r) => r.kind === 'run-complete');
    const warnIdx = rows.findIndex((r) => r.kind === 'token-budget-warning');
    expect(warnIdx).toBeGreaterThanOrEqual(0);
    expect(doneIdx).toBeGreaterThan(warnIdx);
  });

  it('falls back to 70% of context window when no absolute threshold is passed', () => {
    const rows = deriveRows(baseEvents, { contextWindow: 1000 });
    expect(rows.some((r) => r.kind === 'token-budget-warning')).toBe(true);
  });

  it('does not warn below the configured absolute threshold', () => {
    const rows = deriveRows(baseEvents, {
      tokenBudgetWarnThreshold: TOKEN_BUDGET_WARNING_DEFAULT_TOKENS,
      contextWindow: 200_000
    });
    expect(rows.some((r) => r.kind === 'token-budget-warning')).toBe(false);
  });
});
