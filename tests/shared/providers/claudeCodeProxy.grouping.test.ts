import { describe, expect, it } from 'vitest';
import {
  CLAUDE_CODE_PROXY_NOTES_MARKER,
  claudeCodeProxyModelSection,
  filterClaudeCodeProxyModelsForUpstream,
  groupClaudeCodeProxyModels,
  isClaudeCodeProxyBaseUrl,
  resolveClaudeCodeProxyPort
} from '@shared/providers/claudeCodeProxy.js';

describe('claudeCodeProxy grouping and port', () => {
  it('groups models into Agent / Plan / Ask sections', () => {
    const models = [
      { id: 'cursor:composer-2.5' },
      { id: 'cursor-plan:gpt-5.5-high' },
      { id: 'cursor-ask:composer-2.5-fast' }
    ];
    const groups = groupClaudeCodeProxyModels(models);
    expect(groups.map((g) => g.section)).toEqual(['agent', 'plan', 'ask']);
  });

  it('classifies model sections', () => {
    expect(claudeCodeProxyModelSection('cursor:composer-2.5')).toBe('agent');
    expect(claudeCodeProxyModelSection('cursor-plan:auto')).toBe('plan');
    expect(claudeCodeProxyModelSection('codex:gpt-5.4')).toBe('codex');
  });

  it('filters upstream presets', () => {
    const all = [
      { id: 'cursor:composer-2.5' },
      { id: 'cursor-plan:auto' },
      { id: 'codex:gpt-5.4' },
      { id: 'kimi:k2.6' }
    ];
    expect(filterClaudeCodeProxyModelsForUpstream(all, 'cursor').map((m) => m.id)).toEqual([
      'cursor:composer-2.5',
      'cursor-plan:auto'
    ]);
    expect(filterClaudeCodeProxyModelsForUpstream(all, 'codex').map((m) => m.id)).toEqual([
      'codex:gpt-5.4'
    ]);
  });

  it('accepts custom loopback port when notes include marker', () => {
    const notes = CLAUDE_CODE_PROXY_NOTES_MARKER;
    expect(isClaudeCodeProxyBaseUrl('http://127.0.0.1:11435', notes)).toBe(true);
    expect(isClaudeCodeProxyBaseUrl('http://127.0.0.1:11435')).toBe(false);
  });

  it('resolveClaudeCodeProxyPort reads PORT env', () => {
    const prev = process.env.PORT;
    process.env.PORT = '11435';
    try {
      expect(resolveClaudeCodeProxyPort()).toBe(11435);
    } finally {
      if (prev === undefined) delete process.env.PORT;
      else process.env.PORT = prev;
    }
  });
});
