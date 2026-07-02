import { describe, expect, it } from 'vitest';
import { buildSmartCacheReplay } from '@main/orchestrator/toolCacheReplayPolicy.js';
import type { CacheEntry } from '@main/orchestrator/toolResultCacheInternals.js';

function entry(output: string): CacheEntry {
  return {
    result: {
      id: 'x',
      name: 'read',
      ok: true,
      output,
      durationMs: 1
    },
    hits: 0,
    firstTs: Date.now()
  };
}

describe('buildSmartCacheReplay', () => {
  it('returns full output for early hits', () => {
    const e = entry('file body');
    const replay = buildSmartCacheReplay(e, 'read', 'run', false);
    expect(replay.ok).toBe(true);
    expect(replay.output).toContain('file body');
    expect(replay.output).toContain('[cache]');
  });

  it('collapses to stub after many repeats', () => {
    const e = entry('x'.repeat(2000));
    for (let i = 0; i < 5; i++) {
      buildSmartCacheReplay(e, 'read', 'run', false);
    }
    const stub = buildSmartCacheReplay(e, 'read', 'run', false);
    expect(stub.output).toContain('[cache-ref]');
    expect(stub.output).not.toContain('x'.repeat(200));
  });

  it('uses hot banner when spin is hot', () => {
    const e = entry('body');
    buildSmartCacheReplay(e, 'read', 'run', false);
    const hot = buildSmartCacheReplay(e, 'read', 'run', true);
    expect(hot.output).toContain('[cache-hot]');
  });
});
