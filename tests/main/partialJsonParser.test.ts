/**
 * Stateful streaming partial-JSON parser — the workhorse behind the
 * live `tool-call-args-delta` preview pipeline. These tests pin the
 * three contract invariants documented on `PartialJsonParser`:
 *
 *   1. Truncated prefixes return a best-effort snapshot, never throw.
 *   2. Cumulative `feed()` calls are O(delta) — re-scanning the full
 *      buffer per chunk would be O(n²) and stutters the renderer.
 *   3. Keys without a settled value are omitted from the snapshot
 *      (real data only — the project rule on placeholder `null`).
 */

import { describe, expect, it } from 'vitest';
import {
  PartialJsonParser,
  safeParsePartial
} from '@shared/text/partialJsonParser';

describe('safeParsePartial — one-shot path', () => {
  it('returns null for the empty buffer', () => {
    expect(safeParsePartial('')).toBeNull();
  });

  it('returns null for a non-object top-level value', () => {
    expect(safeParsePartial('42')).toBeNull();
  });

  it('returns a settled snapshot for a complete object', () => {
    expect(safeParsePartial('{"a":1,"b":"hello"}')).toEqual({ a: 1, b: 'hello' });
  });

  it('omits keys without a settled colon', () => {
    // `{"path"` — key parsed but no `:value` yet. Per the contract the
    // key is omitted entirely, not surfaced with a `null` placeholder.
    expect(safeParsePartial('{"path"')).toEqual({});
  });

  it('omits keys whose value is mid-string', () => {
    // `{"path":"src/sn` — value is truncated. The contract for the
    // user-facing snapshot is "real data only"; partial strings are
    // not yet attached to the key.
    const snap = safeParsePartial('{"path":"src/sn');
    expect(snap).toEqual({});
  });

  it('surfaces a settled key + value alongside an in-flight tail', () => {
    // `{"a":1,"b":"par` — `a` is settled, `b` is mid-string. The
    // snapshot exposes `a` only.
    expect(safeParsePartial('{"a":1,"b":"par')).toEqual({ a: 1 });
  });

  it('handles escaped quotes inside strings', () => {
    expect(safeParsePartial('{"q":"he said \\"hi\\""}')).toEqual({
      q: 'he said "hi"'
    });
  });

  it('handles unicode escapes once the 4 hex digits arrive', () => {
    expect(safeParsePartial('{"smile":"\\u2605"}')).toEqual({ smile: '★' });
  });

  it('waits on a truncated unicode escape mid-collection', () => {
    // `\\u26` — only 2 of the 4 hex digits collected. The string is
    // not yet closable so the key is omitted.
    expect(safeParsePartial('{"smile":"\\u26')).toEqual({});
  });

  it('parses nested objects', () => {
    expect(safeParsePartial('{"a":{"b":2}}')).toEqual({ a: { b: 2 } });
  });

  it('parses arrays of primitives', () => {
    expect(safeParsePartial('{"xs":[1,2,3]}')).toEqual({ xs: [1, 2, 3] });
  });

  it('parses true / false / null literals', () => {
    expect(safeParsePartial('{"t":true,"f":false,"n":null}')).toEqual({
      t: true,
      f: false,
      n: null
    });
  });

  it('omits a key whose value is a truncated literal', () => {
    // `tru` is a valid prefix of `true` but not yet settled.
    expect(safeParsePartial('{"t":tru')).toEqual({});
  });

  it('omits a key whose value is a truncated number tail', () => {
    // `2e-` is a valid prefix of (e.g.) `2e-5`. Number must be
    // followed by a non-numeric char to settle; if we hit EOF first,
    // wait for more bytes.
    expect(safeParsePartial('{"n":2e-')).toEqual({});
  });

  it('treats a fresh feed prefix mismatch as a reset', () => {
    const p = new PartialJsonParser();
    expect(p.feed('{"a":1}')).toEqual({ a: 1 });
    // Different prefix (someone reused the parser for a new call) →
    // internal state resets cleanly and re-parses from scratch.
    expect(p.feed('{"b":2}')).toEqual({ b: 2 });
  });
});

describe('PartialJsonParser — stateful feeds', () => {
  it('progressively reveals keys as their values settle', () => {
    const p = new PartialJsonParser();
    expect(p.feed('{')).toEqual({});
    expect(p.feed('{"path"')).toEqual({});
    expect(p.feed('{"path":')).toEqual({});
    expect(p.feed('{"path":"sr')).toEqual({});
    expect(p.feed('{"path":"src/foo.ts"')).toEqual({ path: 'src/foo.ts' });
    expect(p.feed('{"path":"src/foo.ts","oldString":"x"')).toEqual({
      path: 'src/foo.ts',
      oldString: 'x'
    });
  });

  it('is O(delta) — feeding 10KB in 5-char chunks does not re-scan all bytes per call', () => {
    const big = JSON.stringify({ payload: 'x'.repeat(10_000) });
    const p = new PartialJsonParser();
    // Feed 5 chars at a time; each feed should advance `__scanCount`
    // by roughly its own delta size, not by `buf.length`. A
    // re-parse-from-scratch implementation would push `__scanCount`
    // toward `n²/2 ≈ 50M` for n=10K; an O(delta) implementation
    // stays near `n = 10K`. We assert a conservative 5× ceiling so
    // any future tweak (e.g. one re-walk on close) doesn't false-
    // negative while still catching the O(n²) regression.
    for (let i = 5; i <= big.length; i += 5) {
      p.feed(big.slice(0, i));
    }
    p.feed(big);
    expect(p.__scanCount).toBeLessThan(big.length * 5);
  });
});
