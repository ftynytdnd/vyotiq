/**
 * `resultPatterns.ts` tests. The whole point of this module is that
 * the verifier and the sub-agent infer status the same way. We lock
 * down both call surfaces here.
 */

import { describe, expect, it } from 'vitest';
import {
  inferResultStatus,
  parseResultEnvelope,
  RESULT_RE,
  STATUS_RE,
  SUMMARY_RE
} from '@shared/text/resultPatterns';

describe('inferResultStatus', () => {
  it.each([
    ['<status>success</status>', 'success'],
    ['<status>partial</status>', 'partial'],
    ['<status>failed</status>', 'failed'],
    ['<STATUS>SUCCESS</STATUS>', 'success'],
    ['<status>  failed  </status>', 'failed'],
    ['<status>complete</status>', 'success'],
    ['<status>ok</status>', 'success'],
    ['<status>done</status>', 'success'],
    ['<status>error</status>', 'failed']
  ] as const)('parses %s as %s', (text, expected) => {
    expect(inferResultStatus(text)).toBe(expected);
  });

  it('returns malformed when no status tag is present', () => {
    expect(inferResultStatus('no result here')).toBe('malformed');
  });

  it('returns malformed when the value is unrecognized', () => {
    expect(inferResultStatus('<status>maybe</status>')).toBe('malformed');
  });
});

describe('parseResultEnvelope', () => {
  it('returns found=false / status=null when no <result> tag exists', () => {
    const out = parseResultEnvelope('plain text');
    expect(out.found).toBe(false);
    // `null` instead of the prior `'failed'` so the verifier's malformed
    // path is the single point of policy. See AUDIT §3.2.
    expect(out.status).toBeNull();
  });

  it('extracts status + summary from a well-formed envelope', () => {
    const text = `noise
<result>
  <status>success</status>
  <summary>Did the thing.</summary>
</result>
trailing`;
    const out = parseResultEnvelope(text);
    expect(out.found).toBe(true);
    expect(out.status).toBe('success');
    expect(out.summary).toBe('Did the thing.');
  });

  it('returns status=null when the <result> block has no <status>', () => {
    // Was previously coerced to `'success'` — that silently mismatched
    // the harness contract in `04-subagent-prompt.md`. Now the
    // verifier routes the missing tag through the malformed path so
    // the orchestrator's 3-strike rule handles it identically to a
    // missing `<result>` block.
    const text = '<result><summary>only summary</summary></result>';
    const out = parseResultEnvelope(text);
    expect(out.found).toBe(true);
    expect(out.status).toBeNull();
    expect(out.summary).toBe('only summary');
  });

  it('returns status=null when the <status> value is unrecognized', () => {
    const text = '<result><status>maybe</status></result>';
    const out = parseResultEnvelope(text);
    expect(out.found).toBe(true);
    expect(out.status).toBeNull();
  });

  it('returns empty summary when none is present', () => {
    const text = '<result><status>partial</status></result>';
    const out = parseResultEnvelope(text);
    expect(out.found).toBe(true);
    expect(out.status).toBe('partial');
    expect(out.summary).toBe('');
  });

  it('handles attributes on the <result> tag', () => {
    const text = '<result version="1"><status>failed</status></result>';
    const out = parseResultEnvelope(text);
    expect(out.found).toBe(true);
    expect(out.status).toBe('failed');
  });

  it('prefers the last <result> block when multiple are present', () => {
    const text =
      'draft\n<result><status>failed</status><summary>old</summary></result>\n' +
      'final\n<result><status>success</status><summary>new</summary></result>';
    const out = parseResultEnvelope(text);
    expect(out.status).toBe('success');
    expect(out.summary).toBe('new');
  });

  it('ignores <result> blocks inside fenced code when choosing the last envelope', () => {
    const text =
      '```xml\n<result><status>failed</status></result>\n```\n' +
      '<result><status>success</status><summary>real</summary></result>';
    const out = parseResultEnvelope(text);
    expect(out.status).toBe('success');
    expect(out.summary).toBe('real');
  });
});

describe('exported regexes (sanity)', () => {
  it('RESULT_RE captures the inner block', () => {
    const m = RESULT_RE.exec('<result><x/></result>');
    expect(m?.[1]).toBe('<x/>');
  });
  it('STATUS_RE is case-insensitive', () => {
    expect(STATUS_RE.test('<Status>Success</Status>')).toBe(true);
  });
  it('SUMMARY_RE captures multi-line content', () => {
    const m = SUMMARY_RE.exec('<summary>line1\nline2</summary>');
    expect(m?.[1]).toBe('line1\nline2');
  });
});
