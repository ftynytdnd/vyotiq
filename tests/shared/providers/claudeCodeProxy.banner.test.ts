import { describe, expect, it } from 'vitest';
import {
  claudeCodeProxyAuthExpiredMessage,
  claudeCodeProxyOfflineMessage,
  composerProxyBannerLabel,
  formatClaudeCodeProxyAccountLine
} from '@shared/providers/claudeCodeProxy.js';

describe('composer proxy banner helpers', () => {
  it('detects offline messages', () => {
    expect(claudeCodeProxyOfflineMessage('Local proxy offline — run ccp start')).toBe(true);
    expect(claudeCodeProxyOfflineMessage('claude-code-proxy 0.0.21 · healthy')).toBe(false);
  });

  it('detects auth expired messages', () => {
    expect(claudeCodeProxyAuthExpiredMessage('healthy · auth expired — run ccp login')).toBe(true);
    expect(claudeCodeProxyAuthExpiredMessage('auth valid')).toBe(false);
  });

  it('maps verbose snapshots to short banner labels', () => {
    expect(
      composerProxyBannerLabel('Local proxy offline — run ccp start or check Task Scheduler.', 'error')
    ).toBe('Local proxy offline');
    expect(
      composerProxyBannerLabel('0.0.21 · healthy · auth expired — run ccp login', 'ok')
    ).toBe('Proxy sign-in expired');
    expect(composerProxyBannerLabel('0.0.21 · healthy · auth until 20 Aug 2026', 'ok')).toBeNull();
  });

  it('formats compact picker lines for proxy providers', () => {
    expect(
      formatClaudeCodeProxyAccountLine({
        status: 'ok',
        planLabel: 'Local subscription proxy',
        message: 'claude-code-proxy 0.0.21 · healthy · auth until 20 Aug 2026'
      })
    ).toBe('Local subscription proxy');
    expect(
      formatClaudeCodeProxyAccountLine({
        status: 'error',
        message: 'Local proxy offline — run ccp start'
      })
    ).toBe('Local proxy offline');
  });
});