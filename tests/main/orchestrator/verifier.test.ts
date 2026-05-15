/**
 * Verifier tests. Locks down the structural-vs-self-failed-vs-malformed
 * triage so the 3-strike rule in `handleDelegates` always behaves the
 * same regardless of which leaf path the sub-agent's output took.
 */

import { describe, expect, it } from 'vitest';
import { verifySubagentOutput } from '@main/orchestrator/verifier';

describe('verifySubagentOutput', () => {
  it('flags missing <result> as malformed', () => {
    const v = verifySubagentOutput('plain text with no envelope');
    expect(v.structural).toBe('malformed');
    expect(v.attrs['malformed']).toBe('true');
  });

  it('flags missing <status> as malformed (not silently as success)', () => {
    // AUDIT §3.2 — historically this was treated as success.
    const v = verifySubagentOutput(
      '<result><summary>only summary</summary></result>'
    );
    expect(v.structural).toBe('malformed');
    expect(v.attrs['reason']).toBe('missing-status');
  });

  it('flags unrecognized <status> values as malformed', () => {
    const v = verifySubagentOutput('<result><status>maybe</status></result>');
    expect(v.structural).toBe('malformed');
  });

  it('passes a well-formed success envelope through as ok', () => {
    const v = verifySubagentOutput(
      '<result><status>success</status><summary>Did the thing.</summary></result>'
    );
    expect(v.structural).toBe('ok');
    expect(v.status).toBe('success');
    expect(v.summary).toBe('Did the thing.');
    expect(v.attrs['status']).toBe('success');
  });

  it('routes status=failed through self-failed', () => {
    const v = verifySubagentOutput(
      '<result><status>failed</status><summary>Nope.</summary></result>'
    );
    expect(v.structural).toBe('self-failed');
    expect(v.status).toBe('failed');
  });

  it('passes status=partial as ok (the orchestrator decides)', () => {
    const v = verifySubagentOutput(
      '<result><status>partial</status><summary>Half done.</summary></result>'
    );
    expect(v.structural).toBe('ok');
    expect(v.status).toBe('partial');
  });
});
