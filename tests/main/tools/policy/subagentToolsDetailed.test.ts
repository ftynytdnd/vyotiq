/**
 * Review finding H10 — sub-agent toolset validator MUST surface
 * dropped names so the orchestrator (and the user) can see typos
 * (`reed` → `read`) and out-of-set names instead of having them
 * silently filtered. The `validateSubagentToolset` simple wrapper
 * stays backward-compatible; the rich variant
 * `validateSubagentToolsetDetailed` returns `{ allowed, dropped,
 * defaulted }` so call sites can populate
 * `subagent-spawn.unknownTools` and emit a `phase` event.
 */

import { describe, expect, it } from 'vitest';
import {
  validateSubagentToolset,
  validateSubagentToolsetDetailed
} from '@main/tools/policy/subagentTools';

describe('validateSubagentToolsetDetailed', () => {
  it('returns the read-only default with defaulted=true on undefined input', () => {
    const out = validateSubagentToolsetDetailed(undefined);
    expect(out.allowed).toEqual(['read', 'ls', 'search']);
    expect(out.dropped).toEqual([]);
    expect(out.defaulted).toBe(true);
  });

  it('returns the read-only default with defaulted=true on empty input', () => {
    const out = validateSubagentToolsetDetailed([]);
    expect(out.allowed).toEqual(['read', 'ls', 'search']);
    expect(out.dropped).toEqual([]);
    expect(out.defaulted).toBe(true);
  });

  it('grants every requested allowlisted tool', () => {
    const out = validateSubagentToolsetDetailed(['read', 'bash']);
    expect(out.allowed).toEqual(['read', 'bash']);
    expect(out.dropped).toEqual([]);
    expect(out.defaulted).toBe(false);
  });

  it('separates allowed and dropped names (mixed input)', () => {
    const out = validateSubagentToolsetDetailed(['reed', 'bash', 'frob']);
    // Order preserved within each bucket relative to the input.
    expect(out.allowed).toEqual(['bash']);
    expect(out.dropped).toEqual(['reed', 'frob']);
    expect(out.defaulted).toBe(false);
  });

  it('falls back to default when every requested name is unknown (defaulted=true)', () => {
    const out = validateSubagentToolsetDetailed(['reed', 'frob']);
    expect(out.allowed).toEqual(['read', 'ls', 'search']);
    // Even though we defaulted, the dropped names ARE surfaced so
    // the orchestrator's phase-event has the typos to explain.
    expect(out.dropped).toEqual(['reed', 'frob']);
    expect(out.defaulted).toBe(true);
  });

  it('skips empty / whitespace strings without surfacing them as drops', () => {
    // The directive parser already filters these, but a future
    // grammar change shouldn't smuggle them into `dropped` either —
    // `dropped` is meant for actionable typos only.
    const out = validateSubagentToolsetDetailed(['read', '', '  ']);
    expect(out.allowed).toEqual(['read']);
    // Whitespace-only is still surfaced (the user might have meant
    // to type a tool name and added a trailing space). Empty
    // string is silently dropped.
    expect(out.dropped).toEqual(['  ']);
  });

  it('keeps validateSubagentToolset (simple form) backward-compatible', () => {
    expect(validateSubagentToolset(undefined)).toEqual(['read', 'ls', 'search']);
    expect(validateSubagentToolset(['read', 'bash'])).toEqual(['read', 'bash']);
    // Same fall-back-to-default behaviour as before for all-dropped input.
    expect(validateSubagentToolset(['frob'])).toEqual(['read', 'ls', 'search']);
  });
});
