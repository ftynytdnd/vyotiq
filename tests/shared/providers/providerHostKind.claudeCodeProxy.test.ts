import { describe, expect, it } from 'vitest';
import { classifyProviderHost } from '@shared/providers/providerHostKind.js';
import { defaultClaudeCodeProxyBaseUrl } from '@shared/providers/claudeCodeProxy.js';

describe('classifyProviderHost — claude-code-proxy', () => {
  it('classifies localhost:18765 before generic local', () => {
    const kind = classifyProviderHost({
      baseUrl: defaultClaudeCodeProxyBaseUrl(),
      dialect: 'anthropic-native'
    });
    expect(kind).toBe('claude-code-proxy');
  });

  it('keeps generic local for other loopback ports', () => {
    const kind = classifyProviderHost({
      baseUrl: 'http://127.0.0.1:11434',
      dialect: 'openai'
    });
    expect(kind).toBe('local');
  });
});
