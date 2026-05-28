/**
 * Verifier tests. Locks down the structural-vs-self-failed-vs-malformed
 * triage so the 3-strike rule in `handleDelegates` always behaves the
 * same regardless of which leaf path the sub-agent's output took.
 */

import { describe, expect, it } from 'vitest';
import {
  applyNoToolUseWithFilesCheck,
  verifySubagentOutput,
  verifySubagentRun
} from '@main/orchestrator/verifier';

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

describe('applyNoToolUseWithFilesCheck (P2b)', () => {
  const okEnvelope =
    '<result><status>success</status><summary>Done.</summary></result>';

  it('downgrades ok verdict when files assigned, zero tools, zero inlines', () => {
    const base = verifySubagentOutput(okEnvelope);
    expect(base.structural).toBe('ok');
    const v = applyNoToolUseWithFilesCheck(base, {
      delegateFiles: ['src/foo.ts'],
      toolResultCount: 0,
      inlinedFileCount: 0
    });
    expect(v.structural).toBe('malformed');
    expect(v.attrs['reason']).toBe('no-tool-use-with-files');
  });

  it('keeps ok when host inlined at least one file (seedCachedRead excuse)', () => {
    const base = verifySubagentOutput(okEnvelope);
    const v = applyNoToolUseWithFilesCheck(base, {
      delegateFiles: ['src/foo.ts'],
      toolResultCount: 0,
      inlinedFileCount: 1
    });
    expect(v.structural).toBe('ok');
  });

  it('keeps ok when the worker issued tools even with zero inlines', () => {
    const base = verifySubagentOutput(okEnvelope);
    const v = applyNoToolUseWithFilesCheck(base, {
      delegateFiles: ['src/foo.ts'],
      toolResultCount: 2,
      inlinedFileCount: 0
    });
    expect(v.structural).toBe('ok');
  });

  it('does not override an existing malformed envelope verdict', () => {
    const base = verifySubagentOutput('no envelope');
    expect(base.structural).toBe('malformed');
    const v = applyNoToolUseWithFilesCheck(base, {
      delegateFiles: ['src/foo.ts'],
      toolResultCount: 0,
      inlinedFileCount: 0
    });
    expect(v.attrs['reason']).toBe('missing-envelope');
  });

  it('verifySubagentRun applies P2b in one call', () => {
    const v = verifySubagentRun(okEnvelope, {
      delegateFiles: ['a.ts', 'b.ts'],
      toolResultCount: 0,
      inlinedFileCount: 0
    });
    expect(v.structural).toBe('malformed');
    expect(v.attrs['reason']).toBe('no-tool-use-with-files');
  });
});
