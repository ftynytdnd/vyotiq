import { describe, expect, it } from 'vitest';
import {
  formatProviderStrikeError,
  formatRetryThought,
  formatToolStrikeError,
  sentenceEnd
} from '@main/orchestrator/loop/runLoopMessages';

describe('runLoopMessages', () => {
  it('sentenceEnd avoids double periods', () => {
    expect(sentenceEnd('OpenRouter: Rate limit exceeded.')).toBe(
      'OpenRouter: Rate limit exceeded.'
    );
    expect(sentenceEnd('timeout')).toBe('timeout.');
  });

  it('formatRetryThought uses single terminator before Retrying', () => {
    expect(formatRetryThought('OpenRouter: Rate limit exceeded.', 1)).toBe(
      'LLM call failed (attempt 1/3): OpenRouter: Rate limit exceeded. Retrying.'
    );
  });

  it('formatProviderStrikeError includes provider detail', () => {
    expect(formatProviderStrikeError(3, 'OpenRouter: Rate limit exceeded.')).toContain(
      'OpenRouter: Rate limit exceeded.'
    );
  });

  it('formatToolStrikeError includes last failure when provided', () => {
    expect(formatToolStrikeError('read — missing path')).toContain('read — missing path');
  });
});
