import { describe, expect, it } from 'vitest';
import { assertHarnessBoot } from '@main/harness/harnessLoader';

describe('assertHarnessBoot', () => {
  it('succeeds when orchestrator and sub-agent prompts match constants', () => {
    expect(() => assertHarnessBoot()).not.toThrow();
  });

  it('validates every bundled harness markdown body is non-empty', async () => {
    const mod = await import('@main/harness/harnessLoader');
    mod.__resetOrchestratorPromptCacheForTests();
    expect(() => mod.assertHarnessBoot()).not.toThrow();
  });
});
