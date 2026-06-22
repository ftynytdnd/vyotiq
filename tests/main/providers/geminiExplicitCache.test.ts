import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  _resetGeminiExplicitCacheForTests,
  resolveGeminiExplicitCacheName,
  shouldUseGeminiExplicitCache
} from '@main/providers/cacheHints/geminiExplicitCache.js';
import { syncPromptCachingFromSettings } from '@main/settings/promptCachingRuntime.js';

describe('resolveGeminiExplicitCacheName', () => {
  const prev = process.env['VYOTIQ_GEMINI_EXPLICIT_CACHE'];

  beforeEach(() => {
    _resetGeminiExplicitCacheForTests();
    process.env['VYOTIQ_GEMINI_EXPLICIT_CACHE'] = '1';
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (prev === undefined) delete process.env['VYOTIQ_GEMINI_EXPLICIT_CACHE'];
    else process.env['VYOTIQ_GEMINI_EXPLICIT_CACHE'] = prev;
  });

  it('creates and reuses cachedContents for a large static prefix', async () => {
    let createCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        createCount += 1;
        return new Response(JSON.stringify({ name: 'cachedContents/test-cache' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );

    const staticSystem = 'x'.repeat(7_000);
    const tools = [
      {
        type: 'function' as const,
        function: {
          name: 'read',
          description: 'read',
          parameters: { type: 'object', properties: { path: { type: 'string' } } }
        }
      }
    ];
    const opts = {
      providerId: 'gem',
      model: 'gemini-2.5-pro',
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKey: 'key',
      staticSystem,
      tools
    };

    const first = await resolveGeminiExplicitCacheName(opts);
    const second = await resolveGeminiExplicitCacheName(opts);
    expect(first).toBe('cachedContents/test-cache');
    expect(second).toBe('cachedContents/test-cache');
    expect(createCount).toBe(1);
  });

  it('creates explicit cache with system and workspace parts (no duplication)', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ name: 'cachedContents/ws-test' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );

    const staticSystem = 'harness'.repeat(3_500);
    const workspaceBlock = '<workspace_context>stable ws</workspace_context>';
    await resolveGeminiExplicitCacheName({
      providerId: 'gem',
      model: 'gemini-2.5-pro',
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKey: 'key',
      staticSystem,
      workspaceBlock,
      tools: []
    });

    const instruction = capturedBody?.['systemInstruction'] as {
      parts?: Array<{ text?: string }>;
    };
    expect(instruction?.parts).toHaveLength(2);
    expect(instruction?.parts?.[0]?.text).toBe(staticSystem);
    expect(instruction?.parts?.[1]?.text).toBe(workspaceBlock);
    expect(instruction?.parts?.[1]?.text).not.toContain(staticSystem.slice(0, 40));
  });

  it('returns undefined when static prefix is below the size threshold', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const name = await resolveGeminiExplicitCacheName({
      providerId: 'gem',
      model: 'gemini-2.5-pro',
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKey: 'key',
      staticSystem: 'short',
      tools: []
    });
    expect(name).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('shouldUseGeminiExplicitCache', () => {
  const prev = process.env['VYOTIQ_GEMINI_EXPLICIT_CACHE'];

  afterEach(() => {
    if (prev === undefined) delete process.env['VYOTIQ_GEMINI_EXPLICIT_CACHE'];
    else process.env['VYOTIQ_GEMINI_EXPLICIT_CACHE'] = prev;
    syncPromptCachingFromSettings({ ui: {} });
  });

  it('returns false for large prefixes when the setting is off and env is unset', () => {
    delete process.env['VYOTIQ_GEMINI_EXPLICIT_CACHE'];
    syncPromptCachingFromSettings({ ui: { promptCaching: { geminiExplicitCache: false } } });
    expect(shouldUseGeminiExplicitCache(10_000)).toBe(false);
  });

  it('returns true for large prefixes when the setting is on', () => {
    delete process.env['VYOTIQ_GEMINI_EXPLICIT_CACHE'];
    syncPromptCachingFromSettings({ ui: { promptCaching: { geminiExplicitCache: true } } });
    expect(shouldUseGeminiExplicitCache(10_000)).toBe(true);
  });
});
