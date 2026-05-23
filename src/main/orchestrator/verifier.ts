/**
 * Verifier — runs after a sub-agent returns. The actual semantic verification
 * is performed by the orchestrator LLM (per the harness). This module just
 * does cheap structural checks: did the sub-agent claim success? Was the
 * <result> envelope well-formed?
 *
 * The XML parsing primitives live in `resultPatterns.ts` — both the
 * verifier and `SubAgent.inferStatus` consume the same regexes, so a fix
 * in one place propagates everywhere.
 */

import { parseResultEnvelope, type ResultStatus } from '@shared/text/resultPatterns.js';

export interface SubagentVerdict {
  /** Cheap-check status. The LLM still does the semantic verification. */
  structural: 'ok' | 'malformed' | 'self-failed';
  status?: ResultStatus;
  summary?: string;
  /**
   * Inner payload (no outer `<subagent_result>` wrap). The orchestrator wraps
   * this in a single envelope keyed by the run id when re-injecting into the
   * model context.
   */
  inner: string;
  /** Attributes the orchestrator should put on the outer wrap. */
  attrs: Record<string, string>;
}

export function verifySubagentOutput(text: string): SubagentVerdict {
  const parsed = parseResultEnvelope(text);
  if (!parsed.found) {
    return {
      structural: 'malformed',
      inner: text.slice(0, 4000),
      attrs: { malformed: 'true', reason: 'missing-envelope' }
    };
  }
  // Missing `<status>` is malformed — the harness mandates an explicit
  // status. Don't silently coerce it to success.
  if (parsed.status === null) {
    return {
      structural: 'malformed',
      inner: parsed.inner,
      attrs: { malformed: 'true', reason: 'missing-status' }
    };
  }
  return {
    structural: parsed.status === 'failed' ? 'self-failed' : 'ok',
    status: parsed.status,
    summary: parsed.summary,
    inner: parsed.inner,
    attrs: { status: parsed.status }
  };
}
