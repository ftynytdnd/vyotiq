/**
 * Whether an in-flight `tool-call-args-delta` snapshot is ready to
 * render as a synthesized tool-group row. Partial entries without a
 * resolved tool name (and without a diff-stream tool hint) are held
 * back so the timeline does not flash misleading "Unknown tool:
 * (unspecified)" cards while the provider is still streaming metadata.
 */

export function partialToolNameHint(entry: {
  name?: string;
  diffStream?: { tool?: string };
}): string | undefined {
  return entry.name ?? entry.diffStream?.tool;
}

export function shouldSynthesizePartialToolEntry(
  entry: { name?: string; diffStream?: { tool?: string } },
  knownTools: readonly string[]
): boolean {
  const hint = partialToolNameHint(entry);
  if (!hint || hint.length === 0) return false;
  return knownTools.includes(hint);
}
