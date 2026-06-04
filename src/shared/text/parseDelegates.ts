/**
 * Assistant-turn display helpers for delegation turns.
 *
 * NOTE: The host no longer parses `<delegate />` directives out of free
 * text — delegation is tool-based (`delegate` tool args). The only
 * surviving consumers here are the renderer's timeline display helper
 * and the `ParsedDelegate` shape re-exported by the orchestrator
 * envelope module.
 */

import {
  stripDelegatesForDisplay,
  stripFencedCode
} from './strip.js';

export interface ParsedDelegate {
  id: string;
  task: string;
  files: string[];
  tools: string[];
  /** Max in-flight workers when this spec is part of a delegation round. */
  concurrency?: number;
}

/**
 * Assistant-turn display text for the timeline. Delegation turns carry
 * planning prose BEFORE the `<delegate />` block and (optionally) a
 * user-facing tail AFTER it. The planning prose is shown once here in
 * the parent `AssistantTextRow`; sub-agent briefings carry only the
 * per-worker task and the shared execution-plan roster.
 */
export function displayAssistantTurnText(text: string): string {
  const scanText = stripFencedCode(text);
  let firstIdx = -1;
  let lastEnd = 0;
  const re = /<delegate\b[^>]*\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scanText)) !== null) {
    if (firstIdx < 0) firstIdx = m.index;
    lastEnd = m.index + m[0].length;
  }
  if (firstIdx < 0) return stripDelegatesForDisplay(text);

  const plan = stripDelegatesForDisplay(scanText.slice(0, firstIdx)).trim();
  const tail = stripDelegatesForDisplay(scanText.slice(lastEnd)).trim();
  if (plan.length === 0) return tail;
  if (tail.length === 0) return plan;
  return `${plan}\n\n${tail}`;
}
