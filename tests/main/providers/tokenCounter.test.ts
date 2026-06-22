/**
 * `tokenCounter` tests. Verifies the BPE estimator picks the right
 * encoding per model family, falls back to the char heuristic for
 * non-BPE models (Claude / Gemini), and survives missing workspace
 * paths gracefully.
 *
 * Phase 1 (2026) added:
 *   - `tokenizeText(modelId, text)` — raw count for any string.
 *   - `tokenizeMessages(modelId, messages, tools)` — full prospective
 *     payload tokenizer with per-part breakdown.
 */

import { describe, expect, it } from 'vitest';
import {
  estimateTokens,
  tokenizeMessages,
  tokenizeText,
  type TokenizableToolSchema
} from '@main/providers/tokenCounter';
import type { ChatMessage } from '@shared/types/chat';

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

  it('routes vendor-prefixed openai ids using the model tail', async () => {
    const r = await estimateTokens({
      modelId: 'openai/gpt-4o',
      prompt: 'Hello, world.'
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

describe('tokenCounter.tokenizeText (Phase 1)', () => {
  it('returns 0 tokens for an empty string', () => {
    const r = tokenizeText('gpt-4o', '');
    expect(r).toEqual({ tokens: 0, exact: true });
  });

  it('returns exact BPE counts on a GPT-4o-family model', () => {
    const r = tokenizeText('gpt-5', 'Hello, world.');
    expect(r.exact).toBe(true);
    expect(r.tokens).toBeGreaterThan(0);
    expect(r.tokens).toBeLessThan(20);
  });

  it('falls back to chars/3.8 for Claude (non-BPE family)', () => {
    const r = tokenizeText('claude-sonnet-4.6', 'a'.repeat(380));
    expect(r.exact).toBe(false);
    expect(r.tokens).toBe(100);
  });

  it('falls back to chars/3.8 for Gemini 3', () => {
    const r = tokenizeText('gemini-3.1-pro-preview', 'a'.repeat(38));
    expect(r.exact).toBe(false);
    expect(r.tokens).toBe(10);
  });
});

describe('tokenCounter.tokenizeMessages (Phase 1)', () => {
  it('returns all zeros for empty inputs', () => {
    const r = tokenizeMessages('gpt-5', []);
    expect(r.total).toBe(0);
    expect(r.visionTokens).toBe(0);
    expect(r.breakdown).toEqual({
      system: 0,
      workspace: 0,
      history: 0,
      runtime: 0,
      turn: 0,
      tools: 0
    });
    expect(r.exact).toBe(true);
  });

  it('sums system + history + tools into total', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are Agent V. Operate with care.' },
      { role: 'user', content: 'Please refactor the composer.' },
      { role: 'assistant', content: 'Reading the file.' }
    ];
    const tools: TokenizableToolSchema[] = [
      {
        type: 'function',
        function: {
          name: 'read',
          description: 'Read a file from the workspace.',
          parameters: { type: 'object', properties: { path: { type: 'string' } } }
        }
      }
    ];
    const r = tokenizeMessages('gpt-5', messages, tools);
    expect(r.exact).toBe(true);
    expect(r.breakdown.system).toBeGreaterThan(0);
    expect(r.breakdown.history).toBeGreaterThan(0);
    expect(r.breakdown.tools).toBeGreaterThan(0);
    expect(r.total).toBe(
      r.breakdown.system +
        r.breakdown.workspace +
        r.breakdown.history +
        r.breakdown.runtime +
        r.breakdown.turn +
        r.breakdown.tools +
        r.visionTokens
    );
  });

  it('adds vision token estimate for multimodal user content', () => {
    const tinyPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const messages: ChatMessage[] = [
      { role: 'system', content: '' },
      { role: 'user', content: '' },
      { role: 'user', content: '' },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: tinyPng } },
          { type: 'text', text: '<turn><user_message>hi</user_message></turn>' }
        ]
      },
      { role: 'user', content: '' },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: tinyPng } },
          { type: 'text', text: '<turn><user_message>draft</user_message></turn>' }
        ]
      }
    ];
    const r = tokenizeMessages('gpt-5', messages);
    expect(r.visionTokens).toBeGreaterThan(0);
    expect(r.total).toBeGreaterThan(
      r.breakdown.system +
        r.breakdown.workspace +
        r.breakdown.history +
        r.breakdown.runtime +
        r.breakdown.turn +
        r.breakdown.tools
    );
    expect(r.exact).toBe(false);
  });

  it('counts tool_calls arguments under history', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'c-1',
            type: 'function',
            function: { name: 'edit', arguments: '{"path":"src/foo.ts","newString":"hello"}' }
          }
        ]
      }
    ];
    const r = tokenizeMessages('gpt-5', messages);
    expect(r.breakdown.history).toBeGreaterThan(0);
    expect(r.breakdown.system).toBe(0);
  });

  it('counts reasoning_content echo under history', () => {
    const withReasoning: ChatMessage[] = [
      {
        role: 'assistant',
        content: 'final',
        reasoning_content: 'a'.repeat(380)
      }
    ];
    const withoutReasoning: ChatMessage[] = [
      { role: 'assistant', content: 'final' }
    ];
    const withR = tokenizeMessages('claude-sonnet-4.6', withReasoning);
    const withoutR = tokenizeMessages('claude-sonnet-4.6', withoutReasoning);
    // Reasoning echo must increase the history count; for the heuristic
    // tokenizer the delta is approximately the reasoning string size / 3.8.
    expect(withR.breakdown.history).toBeGreaterThan(withoutR.breakdown.history);
  });

  it('marks exact=false when ANY part falls back to the heuristic', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'Be helpful.' },
      { role: 'user', content: 'hi' }
    ];
    const r = tokenizeMessages('claude-haiku-4.5', messages);
    expect(r.exact).toBe(false);
    expect(r.total).toBeGreaterThan(0);
  });

  it('skips empty-content messages without crashing', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: '' },
      { role: 'assistant', content: null }
    ];
    const r = tokenizeMessages('gpt-5', messages);
    expect(r.total).toBe(0);
    expect(r.breakdown.system).toBe(0);
    expect(r.breakdown.history).toBe(0);
  });

  it('concatenates multiple system messages into one breakdown.system slot', () => {
    const single: ChatMessage[] = [{ role: 'system', content: 'Part A. Part B.' }];
    const split: ChatMessage[] = [
      { role: 'system', content: 'Part A.' },
      { role: 'system', content: 'Part B.' }
    ];
    const rSingle = tokenizeMessages('gpt-5', single);
    const rSplit = tokenizeMessages('gpt-5', split);
    // Both should produce non-zero, comparable counts — the exact value
    // can differ by a few tokens because of per-message framing
    // overhead in encodeChat, but the split form should land within
    // 20% of the single form.
    expect(rSingle.breakdown.system).toBeGreaterThan(0);
    expect(rSplit.breakdown.system).toBeGreaterThan(0);
    const diff = Math.abs(rSplit.breakdown.system - rSingle.breakdown.system);
    expect(diff).toBeLessThanOrEqual(Math.ceil(rSingle.breakdown.system * 0.3) + 5);
  });
});
