import { describe, expect, it } from 'vitest';
import {
  formatProviderStrikeError,
  formatRetryThought,
  formatRunTokenBudgetError,
  formatToolRecoveryThought,
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

  it('formatRunTokenBudgetError cites cumulative and max totals', () => {
    const msg = formatRunTokenBudgetError(1_500_000, 1_000_000);
    expect(msg).toContain('1,500,000');
    expect(msg).toContain('1,000,000');
    expect(msg).toContain('Start a new message to continue');
  });

  it('formatToolStrikeError surfaces root cause when it differs from last error', () => {
    const msg = formatToolStrikeError(
      'read — duplicate_tool_call',
      'read — missing path'
    );
    expect(msg).toContain('Root cause: read — missing path');
    expect(msg).toContain('Last error: read — duplicate_tool_call');
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
