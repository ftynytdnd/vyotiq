import { describe, expect, it } from 'vitest';
import {
  formatProviderStrikeError,
  formatRetryThought,
  formatRunTokenBudgetError,
  formatToolRecoveryThought,
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

  it('formatProviderStrikeError includes connectivity hint for fetch failed', () => {
    const msg = formatProviderStrikeError(3, 'fetch failed');
    expect(msg).toContain('fetch failed');
    expect(msg.toLowerCase()).toContain('connectivity');
  });

  it('formatRunTokenBudgetError cites cumulative and max totals', () => {
    const msg = formatRunTokenBudgetError(1_500_000, 1_000_000);
    expect(msg).toContain('1,500,000');
    expect(msg).toContain('1,000,000');
    expect(msg).toContain('Start a new message to continue');
  });

  it('formatToolRecoveryThought gives timeout and escape hints from failure chain', () => {
    const msg = formatToolRecoveryThought(
      3,
      'bash — workspace escape',
      'bash — timed out after 30000ms'
    );
    expect(msg).toContain('timed out after 30000ms');
    expect(msg).toContain('workspace escape');
    expect(msg).toContain('timeoutMs');
    expect(msg).toContain('$env:USERPROFILE');
    expect(msg).not.toContain('Re-read affected files with `read` before `edit`');
  });
});
