import { describe, expect, it } from 'vitest';
import { assertContextSummaryRulesPatch } from '@main/ipc/contextSummaryValidate';

describe('assertContextSummaryRulesPatch', () => {
  it('accepts a partial valid patch', () => {
    expect(() =>
      assertContextSummaryRulesPatch('contextSummary:updateRules', {
        enabled: true,
        autoTriggerRatio: 0.75,
        perKindPolicy: { 'delegate-result': 'summarize' }
      })
    ).not.toThrow();
  });

  it('rejects unknown patch keys', () => {
    expect(() =>
      assertContextSummaryRulesPatch('contextSummary:updateRules', {
        enabled: true,
        // @ts-expect-error intentional bad key for validator
        bogus: true
      })
    ).toThrow(/not a recognized contextSummary field/);
  });

  it('rejects autoTriggerRatio outside 0..1', () => {
    expect(() =>
      assertContextSummaryRulesPatch('contextSummary:updateRules', {
        autoTriggerRatio: 1.5
      })
    ).toThrow(/autoTriggerRatio must be between 0 and 1/);
  });

  it('rejects invalid perKindPolicy kind', () => {
    expect(() =>
      assertContextSummaryRulesPatch('contextSummary:updateRules', {
        perKindPolicy: { 'not-a-kind': 'keep' } as never
      })
    ).toThrow(/perKindPolicy key/);
  });
});
