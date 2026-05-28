/**
 * Human-readable explanations for structural sub-agent verdicts.
 *
 * Strings here surface to the user via the renderer's `SubAgentHeader`
 * (red AlertTriangle row). Per the UI audit, they are deliberately
 * free of literal harness XML (`<result>`, `<status>`, …) — the
 * harness contract itself is shown to the user as a hover tooltip
 * on the same row (see `SubAgentHeader.HARNESS_CONTRACT_TOOLTIP`)
 * rather than baked into the headline copy.
 */

export function malformedReasonFromAttrs(
  attrs: Record<string, string>
): string | undefined {
  const reason = attrs['reason'];
  if (reason === 'missing-status') {
    return 'Sub-agent result is missing its status marker.';
  }
  if (reason === 'iteration-cap') {
    return 'Sub-agent reached its iteration cap before producing a verifiable result.';
  }
  if (reason === 'no-tool-use-with-files') {
    return (
      'Sub-agent was assigned files but used no tools and received no ' +
      'host-inlined file bodies — the result cannot be verified.'
    );
  }
  if (attrs['malformed'] === 'true') {
    return 'Sub-agent finished without a structured result envelope.';
  }
  return undefined;
}
