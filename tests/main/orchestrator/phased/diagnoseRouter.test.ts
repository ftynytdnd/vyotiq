import { describe, expect, it } from 'vitest';
import { failureSignature, routeDiagnoseTarget } from '../../../../src/main/orchestrator/phased/diagnoseRouter.js';

describe('routeDiagnoseTarget', () => {
  it('routes wrong facts to understand', () => {
    expect(routeDiagnoseTarget('wrong_facts')).toBe('understand');
  });

  it('routes bad implementation to execute', () => {
    expect(routeDiagnoseTarget('bad_implementation')).toBe('execute');
  });

  it('routes test failure to verify', () => {
    expect(routeDiagnoseTarget('test_failure')).toBe('verify');
  });
});

describe('failureSignature', () => {
  it('is stable for identical inputs', () => {
    const a = failureSignature({
      phase: 'verify',
      classification: 'test_failure',
      message: 'exit 1'
    });
    const b = failureSignature({
      phase: 'verify',
      classification: 'test_failure',
      message: 'exit 1'
    });
    expect(a).toBe(b);
  });

  it('changes when message changes', () => {
    const a = failureSignature({ phase: 'execute', message: 'fail a' });
    const b = failureSignature({ phase: 'execute', message: 'fail b' });
    expect(a).not.toBe(b);
  });
});
