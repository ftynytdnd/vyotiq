/**
 * Audit fix A2 — shared `InlineFileCache`.
 *
 * Pins:
 *   - A second call sharing the cache hits the existing entry (no
 *     re-read).
 *   - The cached body is wrapped under each caller's *own* relative
 *     path (so attribute-escape correctness survives the share).
 *   - An empty cache is functionally identical to no cache (legacy
 *     direct-caller path stays green).
 *   - Sandbox failures don't poison the cache — a path that failed
 *     once can succeed on retry from a fresh per-worker call.
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  inlineFiles,
  createInlineFileCache
} from '@main/orchestrator/contextManager';

let workspace: string;

beforeAll(async () => {
  workspace = await fs.mkdtemp(join(tmpdir(), 'vyotiq-inline-cache-'));
  await fs.mkdir(join(workspace, 'core'), { recursive: true });
  await fs.writeFile(join(workspace, 'core', 'agent.py'), 'AGENT_BODY');
  await fs.writeFile(join(workspace, 'core', 'state.py'), 'STATE_BODY');
});

afterAll(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

describe('inlineFiles — shared cache', () => {
  it('shares reads across calls when a cache is passed in', async () => {
    const cache = createInlineFileCache();
    const a = await inlineFiles(workspace, ['core/agent.py'], cache);
    const b = await inlineFiles(workspace, ['core/agent.py'], cache);
    // Body identical and present in both — the cache hit re-wraps the
    // memoized body under the caller's path attribute.
    expect(a).toContain('AGENT_BODY');
    expect(b).toContain('AGENT_BODY');
    expect(a).toBe(b);
    // Exactly one entry — one disk read, one cached body.
    expect(cache.size).toBe(1);
  });

  it('reuses the cached body for the same file in a multi-spec call', async () => {
    const cache = createInlineFileCache();
    // Three "specs" all citing the same file. Pre-fix this would be
    // three reads; post-fix it is one.
    await inlineFiles(workspace, ['core/agent.py'], cache);
    await inlineFiles(workspace, ['core/agent.py', 'core/state.py'], cache);
    await inlineFiles(workspace, ['core/state.py'], cache);
    // Two distinct realpath keys → two cache entries.
    expect(cache.size).toBe(2);
  });

  it('functions identically without a cache (legacy contract)', async () => {
    const a = await inlineFiles(workspace, ['core/agent.py']);
    const b = await inlineFiles(workspace, ['core/agent.py']);
    expect(a).toBe(b);
    expect(a).toContain('AGENT_BODY');
  });

  it('does NOT cache sandbox-rejected paths (re-attempted per call)', async () => {
    const cache = createInlineFileCache();
    const a = await inlineFiles(workspace, ['../escape.txt'], cache);
    const b = await inlineFiles(workspace, ['../escape.txt'], cache);
    // Both emit error markers — neither populates the cache.
    expect(a).toContain('error=');
    expect(b).toContain('error=');
    expect(cache.size).toBe(0);
  });

  it('cache key is the realpath, not the relative spelling', async () => {
    const cache = createInlineFileCache();
    // Two different relative spellings of the same file. Both should
    // collapse onto one cache entry.
    await inlineFiles(workspace, ['core/agent.py'], cache);
    await inlineFiles(workspace, ['./core/agent.py'], cache);
    expect(cache.size).toBe(1);
  });
});
