/**
 * Phase 11 (2026) — `formatCacheBreakdown`.
 *
 * The breakdown lives in inspectorFormat.ts so the WireBreakdown
 * footer pills, the SubAgentHeader hover tooltip, and any future
 * "where did the tokens go?" surface all read the same source. The
 * order matters (cached → cache write → reasoning so the user reads
 * "savings, then premium, then hidden cost"), and the omission of
 * undefined / zero fields is what keeps non-thinking, uncached
 * dialects from showing noisy `0 reasoning` pills.
 */

import { describe, expect, it } from 'vitest';
import {
  formatCacheBreakdown,
  formatTokensPerSecond
} from '@renderer/components/contextInspector/inspectorFormat';

describe('formatCacheBreakdown', () => {
  it('returns an empty array when usage is undefined', () => {
    expect(formatCacheBreakdown(undefined)).toEqual([]);
  });

  it('omits fields that are missing from the wire (vanilla OpenAI turn)', () => {
    expect(
      formatCacheBreakdown({ promptTokens: 100, completionTokens: 50, totalTokens: 150 })
    ).toEqual([]);
  });

  it('omits fields whose value is zero (renders nothing rather than `0 reasoning`)', () => {
    // Some providers return explicit zero counts on a turn that
    // didn't use the feature. Treating zero as "absent" keeps the
    // surface uncluttered.
    expect(
      formatCacheBreakdown({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cachedPromptTokens: 0,
        cacheCreationTokens: 0,
        reasoningTokens: 0
      })
    ).toEqual([]);
  });

  it('emits cached + cache-write for an Anthropic prompt-cached turn', () => {
    const out = formatCacheBreakdown({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cachedPromptTokens: 80,
      cacheCreationTokens: 20
    });
    expect(out).toEqual([
      { key: 'cached', label: 'cached', value: 80 },
      { key: 'cache-write', label: 'cache write', value: 20 }
    ]);
  });

  it('emits cached + reasoning for a Gemini thinking turn', () => {
    const out = formatCacheBreakdown({
      promptTokens: 100,
      completionTokens: 25,
      totalTokens: 125,
      cachedPromptTokens: 60,
      reasoningTokens: 80
    });
    expect(out).toEqual([
      { key: 'cached', label: 'cached', value: 60 },
      { key: 'reasoning', label: 'reasoning', value: 80 }
    ]);
  });

  it('emits reasoning only for an OpenAI o-series turn', () => {
    // OpenAI's prompt prefix-caching field surfaces as
    // `cachedPromptTokens` only when the request actually hit a
    // cached prefix. A vanilla o-series turn that streamed a fresh
    // prompt only reports `reasoningTokens`.
    const out = formatCacheBreakdown({
      promptTokens: 100,
      completionTokens: 1200,
      totalTokens: 1300,
      reasoningTokens: 1000
    });
    expect(out).toEqual([
      { key: 'reasoning', label: 'reasoning', value: 1000 }
    ]);
  });

  it('emits all three pills in canonical order when every field is reported', () => {
    // Hypothetical worst-case: a thinking model turn that ALSO
    // primed AND read the cache. We still want display order:
    // cached, cache write, reasoning.
    const out = formatCacheBreakdown({
      promptTokens: 100,
      completionTokens: 600,
      totalTokens: 700,
      cachedPromptTokens: 75,
      cacheCreationTokens: 25,
      reasoningTokens: 500
    });
    expect(out.map((b) => b.key)).toEqual(['cached', 'cache-write', 'reasoning']);
  });

  it('skips a single missing field but still emits the others (cache-only Anthropic turn)', () => {
    const out = formatCacheBreakdown({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cachedPromptTokens: 90
      // No cacheCreationTokens (a cache HIT, not a cache write)
      // No reasoningTokens (Sonnet without extended thinking)
    });
    expect(out).toEqual([
      { key: 'cached', label: 'cached', value: 90 }
    ]);
  });
});

// ────────────────────────────────────────────────────────────────────
// Phase 12 (2026) — `formatTokensPerSecond`
// ────────────────────────────────────────────────────────────────────

describe('formatTokensPerSecond', () => {
  it('returns null when any input is missing', () => {
    expect(formatTokensPerSecond(undefined, 1, 2)).toBeNull();
    expect(formatTokensPerSecond(100, undefined, 2)).toBeNull();
    expect(formatTokensPerSecond(100, 1, undefined)).toBeNull();
  });

  it('returns null when completionTokens is zero or negative', () => {
    expect(formatTokensPerSecond(0, 1000, 2000)).toBeNull();
    expect(formatTokensPerSecond(-5, 1000, 2000)).toBeNull();
  });

  it('returns null when the streaming window is implausibly short (< 250 ms)', () => {
    // A non-streaming provider that reports usage in the same frame
    // as the first delta would yield a meaningless infinite-rate
    // figure. Better to hide.
    expect(formatTokensPerSecond(500, 1000, 1100)).toBeNull();
    expect(formatTokensPerSecond(500, 1000, 1000)).toBeNull();
    expect(formatTokensPerSecond(500, 1000, 999)).toBeNull(); // negative
  });

  it('formats sub-100 tok/s with one decimal place', () => {
    // 50 tokens over 2.5 seconds = 20.0 tok/s — Sonnet 4.5 thinking
    // territory.
    expect(formatTokensPerSecond(50, 1000, 3500)).toBe('20.0 tok/s');
    expect(formatTokensPerSecond(83, 1000, 2000)).toBe('83.0 tok/s');
  });

  it('formats 100+ tok/s as a whole number', () => {
    // 200 tokens over 1 second = 200 tok/s — Groq territory.
    expect(formatTokensPerSecond(200, 1000, 2000)).toBe('200 tok/s');
    // 245.7 tok/s rounds to 246 (just under the 100 threshold's
    // decimal-place cutoff).
    expect(formatTokensPerSecond(1228, 1000, 6000)).toBe('246 tok/s');
  });

  it('handles fractional rates near the threshold without showing `100.0`', () => {
    // 99.5 tok/s should still show one decimal place.
    expect(formatTokensPerSecond(99, 1000, 1995)).toMatch(/\d\d?\.\d tok\/s/);
  });
});
