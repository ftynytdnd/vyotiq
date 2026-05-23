/**
 * Human-readable explanations for structural sub-agent verdicts.
 */

export function malformedReasonFromAttrs(
  attrs: Record<string, string>
): string | undefined {
  const reason = attrs['reason'];
  if (reason === 'missing-status') return 'Missing <status> in <result> envelope';
  if (reason === 'iteration-cap') return 'Sub-agent iteration cap reached without valid envelope';
  if (attrs['malformed'] === 'true') return 'No <result> envelope';
  return undefined;
}

export function isReadOnlyShardTask(task: string): boolean {
  const t = task.trim();
  return /^read\b/i.test(t) && /\blines?\s+\d/i.test(t);
}
