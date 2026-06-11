import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  _resetGeminiExplicitCacheForTests,
  resolveGeminiExplicitCacheName
} from '@main/providers/cacheHints/geminiExplicitCache.js';

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

  it('creates explicit cache with system, few-shot, and workspace parts (no duplication)', async () => {
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
    const fewShotBlock = '<static_examples>' + 'pattern'.repeat(500) + '</static_examples>';
    const workspaceBlock = '<workspace_context>stable ws</workspace_context>';
    await resolveGeminiExplicitCacheName({
      providerId: 'gem',
      model: 'gemini-2.5-pro',
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKey: 'key',
      staticSystem,
      fewShotBlock,
      workspaceBlock,
      tools: []
    });

    const instruction = capturedBody?.['systemInstruction'] as {
      parts?: Array<{ text?: string }>;
    };
    expect(instruction?.parts).toHaveLength(3);
    expect(instruction?.parts?.[0]?.text).toBe(staticSystem);
    expect(instruction?.parts?.[1]?.text).toBe(fewShotBlock);
    expect(instruction?.parts?.[2]?.text).toBe(workspaceBlock);
    expect(instruction?.parts?.[2]?.text).not.toContain(staticSystem.slice(0, 40));
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
