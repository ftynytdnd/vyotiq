/**
 * Shared regexes and helpers for parsing the structured `<result>` envelope
 * that sub-agents emit at the end of every run.
 *
 * Until now `verifier.ts` had its own `RESULT_RE` / `STATUS_RE` /
 * `SUMMARY_RE` and `SubAgent.ts:inferStatus` had its own near-duplicate
 * STATUS regex. A drift between the two would have caused the swarm to
 * disagree with the verifier about whether a sub-agent succeeded — silent
 * but ugly. This module centralizes the patterns and the parser; both
 * call sites import from here.
 */

import { stripFencedCode } from './strip.js';

export type ResultStatus = 'success' | 'partial' | 'failed';

/** Outer `<result>…</result>` block. */
export const RESULT_RE = /<result\b[^>]*>([\s\S]*?)<\/result>/i;
/** Inner `<status>success|partial|failed</status>`. Case-insensitive. */
export const STATUS_RE =
  /<status>\s*(success|partial|failed|complete|completed|ok|done|failure|fail|error)\s*<\/status>/i;
/** Inner `<summary>…</summary>`. */
export const SUMMARY_RE = /<summary>([\s\S]*?)<\/summary>/i;

const STATUS_SYNONYMS: Record<string, ResultStatus> = {
  success: 'success',
  complete: 'success',
  completed: 'success',
  ok: 'success',
  done: 'success',
  partial: 'partial',
  failed: 'failed',
  failure: 'failed',
  fail: 'failed',
  error: 'failed'
};

function normalizeStatusToken(raw: string): ResultStatus | null {
  const key = raw.trim().toLowerCase();
  return STATUS_SYNONYMS[key] ?? null;
}

/**
 * Last `<result>…</result>` in text (fenced code stripped). Prefer the
 * final envelope when the model narrates before/after the structured block.
 */
function findLastResultMatch(text: string): RegExpExecArray | null {
  const scanText = stripFencedCode(text);
  const re = new RegExp(RESULT_RE.source, RESULT_RE.flags + 'g');
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scanText)) !== null) {
    last = m;
  }
  return last;
}

/**
 * Pulls the status out of a sub-agent's free text. `'malformed'` is the
 * sentinel for "no `<status>` tag found at all" — the caller decides
 * whether to treat that as a failure or a wrap-up nudge target.
 */
export function inferResultStatus(text: string): ResultStatus | 'malformed' {
  const m = STATUS_RE.exec(text);
  if (!m) return 'malformed';
  const normalized = normalizeStatusToken(m[1] ?? '');
  return normalized ?? 'malformed';
}

export interface ParsedResultEnvelope {
  /** True if a `<result>…</result>` block was found at all. */
  found: boolean;
  /** Inner XML body (between the result tags), trimmed. */
  inner: string;
  /**
   * Resolved status. `null` when the `<result>` block exists but the
   * required `<status>` tag is missing — this is treated as `malformed`
   * by the verifier rather than silently passing as `'success'` (the
   * harness in `02-subagent-prompt.md` mandates an explicit status).
   */
  status: ResultStatus | null;
  /** Trimmed `<summary>` content, or empty string if absent. */
  summary: string;
}

/**
 * Parses an entire `<result>` envelope. Returns `found: false` if no
 * outer tag exists; in that case the caller should treat the whole text
 * as malformed.
 *
 * `status: null` is returned when `<result>` is present but `<status>` is
 * absent or contains a non-canonical value. The verifier treats this as
 * `malformed` so the orchestrator's 3-strike path runs identically to a
 * missing `<result>` block. This closes the gap previously documented
 * in the audit (the host accepted missing `<status>` as success while
 * the harness mandated it).
 */
export function parseResultEnvelope(text: string): ParsedResultEnvelope {
  const m = findLastResultMatch(text);
  if (!m) {
    return { found: false, inner: '', status: null, summary: '' };
  }
  const inner = (m[1] ?? '').trim();
  const statusRaw = STATUS_RE.exec(inner)?.[1];
  const status = statusRaw ? normalizeStatusToken(statusRaw) : null;
  const summary = (SUMMARY_RE.exec(inner)?.[1] ?? '').trim();
  return { found: true, inner, status, summary };
}
