/**
 * `<delegate ... />` directive parser — shared between the main-process
 * orchestrator and the renderer briefing UI so both sides parse
 * identical attribute shapes.
 *
 * See the file header in the original main-process module for the full
 * design notes on fenced-code guards, quote-aware attribute values, and
 * per-turn id dedupe.
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
}

export interface ParseDelegatesResult {
  directives: ParsedDelegate[];
  duplicates: string[];
  malformedOpeners: string[];
}

const TAG_CLOSE_OR_NEXT_ATTR = '\\s*(?:\\/?>|[\\w-]+\\s*=)';
const ATTR_VALUE_DBL =
  `"(?:[^"]|"(?!${TAG_CLOSE_OR_NEXT_ATTR}))*"`;
const ATTR_VALUE_SGL =
  `'(?:[^']|'(?!${TAG_CLOSE_OR_NEXT_ATTR}))*'`;
const ATTR_LIST_SRC =
  `(?:\\s+[\\w-]+\\s*=\\s*(?:${ATTR_VALUE_DBL}|${ATTR_VALUE_SGL}))*\\s*`;
const DELEGATE_RE = new RegExp(
  `<delegate\\b(${ATTR_LIST_SRC})/?>`,
  'gi'
);
const ATTR_RE = new RegExp(
  '([\\w-]+)\\s*=\\s*' +
  `(?:"((?:[^"]|"(?!${TAG_CLOSE_OR_NEXT_ATTR}))*)"|` +
  `'((?:[^']|'(?!${TAG_CLOSE_OR_NEXT_ATTR}))*)')`,
  'g'
);

export function parseDelegates(text: string): ParsedDelegate[] {
  return parseDelegatesWithDuplicates(text).directives;
}

export function parseDelegatesWithDuplicates(text: string): ParseDelegatesResult {
  const found: ParsedDelegate[] = [];
  const duplicates: string[] = [];
  const seenIds = new Set<string>();
  const scanText = stripFencedCode(text);
  let m: RegExpExecArray | null;
  DELEGATE_RE.lastIndex = 0;
  while ((m = DELEGATE_RE.exec(scanText)) !== null) {
    const attrs: Record<string, string> = {};
    let am: RegExpExecArray | null;
    ATTR_RE.lastIndex = 0;
    while ((am = ATTR_RE.exec(m[1] ?? '')) !== null) {
      attrs[am[1]!.toLowerCase()] = am[2] ?? am[3] ?? '';
    }
    const idTrim = (attrs['id'] ?? '').trim();
    const taskTrim = (attrs['task'] ?? '').trim();
    if (!idTrim || !taskTrim) continue;
    if (seenIds.has(idTrim)) {
      duplicates.push(idTrim);
      continue;
    }
    seenIds.add(idTrim);
    found.push({
      id: idTrim,
      task: taskTrim,
      files: (attrs['files'] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      tools: (attrs['tools'] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    });
  }
  const malformedOpeners: string[] = [];
  return { directives: found, duplicates, malformedOpeners };
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

/** Strip trailing plan headings from intent prose (headings only). */
export function trimTrailingExecutionPlanHeading(text: string): string {
  return text
    .replace(
      /\n*(?:#{1,6}\s*)?(?:\*{1,2})?\s*(?:Execution|Analysis)\s+Plan\s*(?:\*{1,2})?\s*:?\s*$/im,
      ''
    )
    .trim();
}

export { stripDelegateOnlyMarkup as stripDelegates } from './strip.js';
