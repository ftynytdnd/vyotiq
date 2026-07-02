import { describe, expect, it } from 'vitest';
import {
  CLAUDE_CODE_PROXY_PLACEHOLDER_KEY,
  CLAUDE_CODE_PROXY_STREAM_INACTIVITY_MS,
  defaultClaudeCodeProxyBaseUrl,
  isClaudeCodeProxyBaseUrl,
  parseClaudeCodeProxyModelsOutput,
  resolveClaudeCodeProxyModelId
} from '@shared/providers/claudeCodeProxy.js';
import { STREAM_INACTIVITY_TIMEOUT_MS } from '@shared/constants.js';

describe('claudeCodeProxy shared helpers', () => {
  it('detects default loopback base URL', () => {
    expect(isClaudeCodeProxyBaseUrl(defaultClaudeCodeProxyBaseUrl())).toBe(true);
    expect(isClaudeCodeProxyBaseUrl('http://localhost:18765')).toBe(true);
    expect(isClaudeCodeProxyBaseUrl('http://127.0.0.1:11434')).toBe(false);
    expect(isClaudeCodeProxyBaseUrl('https://api.anthropic.com')).toBe(false);
  });

  it('parses models --full catalog lines', () => {
    const stdout = [
      '  codex: gpt-5.2, haiku',
      '  cursor: composer-2.5, cursor:composer-2.5-fast, cursor-plan:gpt-5.5-high'
    ].join('\n');

    const models = parseClaudeCodeProxyModelsOutput(stdout);
    const ids = models.map((m) => m.id);

    expect(ids).toContain('codex:gpt-5.2');
    expect(ids).toContain('codex:haiku');
    expect(ids).toContain('cursor:composer-2.5');
    expect(ids).toContain('cursor:composer-2.5-fast');
    expect(ids).toContain('cursor-plan:gpt-5.5-high');
  });

  it('applies recommended labels', () => {
    const stdout = '  cursor: composer-2.5, composer-2.5-fast';
    const models = parseClaudeCodeProxyModelsOutput(stdout);
    const fast = models.find((m) => m.id === 'cursor:composer-2.5-fast');
    expect(fast?.label).toBe('Composer 2.5 Fast');
  });

  it('exports placeholder key constant', () => {
    expect(CLAUDE_CODE_PROXY_PLACEHOLDER_KEY).toBe('cursor-proxy');
  });

  it('uses a longer stream inactivity budget than the default transport', () => {
    expect(CLAUDE_CODE_PROXY_STREAM_INACTIVITY_MS).toBeGreaterThan(
      STREAM_INACTIVITY_TIMEOUT_MS
    );
  });

  it('resolves proxy :auto aliases to concrete models', () => {
    expect(resolveClaudeCodeProxyModelId('cursor-ask:auto')).toBe('cursor-ask:composer-2.5');
    expect(resolveClaudeCodeProxyModelId('cursor-plan:auto')).toBe('cursor-plan:composer-2.5');
    expect(resolveClaudeCodeProxyModelId('cursor:auto')).toBe('cursor:composer-2.5');
    expect(resolveClaudeCodeProxyModelId('cursor-ask:auto', 'cursor:composer-2.5')).toBe(
      'cursor-ask:composer-2.5'
    );
    expect(resolveClaudeCodeProxyModelId('cursor-ask:auto', 'cursor-ask:gpt-5.5-high')).toBe(
      'cursor-ask:gpt-5.5-high'
    );
    expect(resolveClaudeCodeProxyModelId('cursor:composer-2.5')).toBe('cursor:composer-2.5');
  });
});
