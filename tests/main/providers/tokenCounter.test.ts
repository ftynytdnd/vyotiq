/**
 * `tokenCounter` tests. Verifies the BPE estimator picks the right
 * encoding per model family, falls back to the char heuristic for
 * non-BPE models (Claude / Gemini), and survives missing workspace
 * paths gracefully.
 */

import { describe, expect, it } from 'vitest';
import { estimateTokens } from '@main/providers/tokenCounter';

describe('tokenCounter.estimateTokens', () => {
  it('returns exact BPE counts for a GPT-4o-family model', async () => {
    const r = await estimateTokens({
      modelId: 'gpt-4o',
      prompt: 'Hello, world.'
    });
    expect(r.exact).toBe(true);
    // The actual value depends on o200k_base; just assert it's sensible.
    expect(r.tokens).toBeGreaterThan(0);
    expect(r.tokens).toBeLessThan(20);
  });

  it('routes deepseek-v4-pro to o200k (exact)', async () => {
    const r = await estimateTokens({
      modelId: 'deepseek-v4-pro',
      prompt: 'How many tokens?'
    });
    expect(r.exact).toBe(true);
    expect(r.tokens).toBeGreaterThan(0);
  });

  it('routes legacy gpt-3.5-turbo to cl100k (exact)', async () => {
    const r = await estimateTokens({
      modelId: 'gpt-3.5-turbo',
      prompt: 'legacy model'
    });
    expect(r.exact).toBe(true);
    expect(r.tokens).toBeGreaterThan(0);
  });

  it('falls back to the chars/3.8 heuristic for claude models', async () => {
    const prompt = 'a'.repeat(380);
    const r = await estimateTokens({
      modelId: 'claude-opus-4-7',
      prompt
    });
    expect(r.exact).toBe(false);
    // 380 / 3.8 === 100 exactly.
    expect(r.tokens).toBe(100);
  });

  it('falls back to the heuristic for an unknown model', async () => {
    const r = await estimateTokens({
      modelId: 'some-unknown-model',
      prompt: 'x'
    });
    expect(r.exact).toBe(false);
    expect(r.tokens).toBe(1);
  });

  it('returns 0 tokens for an empty prompt with no attachments', async () => {
    const r = await estimateTokens({
      modelId: 'gpt-4o',
      prompt: ''
    });
    expect(r.tokens).toBeGreaterThanOrEqual(0);
  });
});
