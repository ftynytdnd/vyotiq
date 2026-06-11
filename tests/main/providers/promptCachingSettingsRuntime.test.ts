import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { isAnthropicCacheDiagnosticsEnabled } from '@main/providers/cacheHints/anthropicCacheDiagnostics';
import { isGeminiExplicitCacheEnabled } from '@main/providers/cacheHints/geminiExplicitCache';
import {
  getGeminiExplicitCacheStatus,
  setGeminiExplicitCacheStatus,
  syncPromptCachingFromSettings
} from '@main/settings/promptCachingRuntime';

describe('prompt caching runtime settings', () => {
  const prevDiag = process.env['VYOTIQ_CACHE_DIAGNOSTICS'];
  const prevGemini = process.env['VYOTIQ_GEMINI_EXPLICIT_CACHE'];

  beforeEach(() => {
    delete process.env['VYOTIQ_CACHE_DIAGNOSTICS'];
    delete process.env['VYOTIQ_GEMINI_EXPLICIT_CACHE'];
    syncPromptCachingFromSettings({});
  });

  afterEach(() => {
    if (prevDiag === undefined) delete process.env['VYOTIQ_CACHE_DIAGNOSTICS'];
    else process.env['VYOTIQ_CACHE_DIAGNOSTICS'] = prevDiag;
    if (prevGemini === undefined) delete process.env['VYOTIQ_GEMINI_EXPLICIT_CACHE'];
    else process.env['VYOTIQ_GEMINI_EXPLICIT_CACHE'] = prevGemini;
    syncPromptCachingFromSettings({});
  });

  it('enables flags from persisted ui.promptCaching', () => {
    syncPromptCachingFromSettings({
      ui: {
        promptCaching: {
          anthropicCacheDiagnostics: true,
          geminiExplicitCache: true
        }
      }
    });
    expect(isAnthropicCacheDiagnosticsEnabled()).toBe(true);
    expect(isGeminiExplicitCacheEnabled()).toBe(true);
  });

  it('env vars override settings when set', () => {
    syncPromptCachingFromSettings({ ui: { promptCaching: { geminiExplicitCache: false } } });
    process.env['VYOTIQ_GEMINI_EXPLICIT_CACHE'] = '1';
    expect(isGeminiExplicitCacheEnabled()).toBe(true);
  });

  it('resets gemini runtime status when explicit cache is disabled', () => {
    setGeminiExplicitCacheStatus({ state: 'active', detail: 'cachedContents/test' });
    syncPromptCachingFromSettings({ ui: { promptCaching: { geminiExplicitCache: false } } });
    expect(getGeminiExplicitCacheStatus().state).toBe('disabled');
  });
});
