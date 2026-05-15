/**
 * Audit fix A1 — sub-agent system prompt cache.
 *
 * Pins:
 *   - Repeated calls with the same `(task, allowedTools)` return the
 *     byte-identical static body (verified indirectly via the prompt
 *     equality when no `runState` is supplied).
 *   - Different `runState` payloads still produce different prompts.
 *   - Different `task` strings produce different prompts.
 *   - Tool-order independence: `[bash, read]` and `[read, bash]`
 *     produce the same prompt.
 *   - `__resetSubagentPromptCacheForTests` clears state cleanly.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  buildSubagentSystemPrompt,
  __resetSubagentPromptCacheForTests
} from '@main/harness/harnessLoader';

beforeEach(() => {
  __resetSubagentPromptCacheForTests();
});

describe('buildSubagentSystemPrompt caching', () => {
  it('returns byte-identical prompts on repeated calls with the same inputs', () => {
    const a = buildSubagentSystemPrompt({ task: 'refactor', allowedTools: ['read', 'edit'] });
    const b = buildSubagentSystemPrompt({ task: 'refactor', allowedTools: ['read', 'edit'] });
    expect(a).toBe(b);
  });

  it('produces identical prompts regardless of `allowedTools` ordering', () => {
    const a = buildSubagentSystemPrompt({ task: 't', allowedTools: ['bash', 'read'] });
    const b = buildSubagentSystemPrompt({ task: 't', allowedTools: ['read', 'bash'] });
    expect(a).toBe(b);
  });

  it('differentiates prompts when the task changes', () => {
    const a = buildSubagentSystemPrompt({ task: 'A', allowedTools: ['read'] });
    const b = buildSubagentSystemPrompt({ task: 'B', allowedTools: ['read'] });
    expect(a).not.toBe(b);
    expect(a).toContain('<task>\nA\n</task>');
    expect(b).toContain('<task>\nB\n</task>');
  });

  it('differentiates prompts when the runState changes', () => {
    const base = { task: 't', allowedTools: ['read'] };
    const a = buildSubagentSystemPrompt({ ...base, runState: '<run_state>iter=1</run_state>' });
    const b = buildSubagentSystemPrompt({ ...base, runState: '<run_state>iter=2</run_state>' });
    expect(a).not.toBe(b);
    expect(a).toContain('iter=1');
    expect(b).toContain('iter=2');
  });

  it('cache reset forces a rebuild but produces the same output', () => {
    const before = buildSubagentSystemPrompt({ task: 't', allowedTools: ['read'] });
    __resetSubagentPromptCacheForTests();
    const after = buildSubagentSystemPrompt({ task: 't', allowedTools: ['read'] });
    expect(before).toBe(after);
  });
});
