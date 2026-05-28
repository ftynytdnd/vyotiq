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

interface ParseDelegatesResult {
  directives: ParsedDelegate[];
  duplicates: string[];
  malformedOpeners: string[];
  /** Directive ids rejected because `task=` bundles multiple outcomes. */
  compoundTaskIds: string[];
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
  const compoundTaskIds: string[] = [];
  const directives: ParsedDelegate[] = [];
  for (const d of found) {
    if (looksLikeCompoundDelegateTask(d.task)) {
      compoundTaskIds.push(d.id);
    } else {
      directives.push(d);
    }
  }
  return { directives, duplicates, malformedOpeners, compoundTaskIds };
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

/**
 * Heuristic: `task=` likely bundles multiple outcomes. The harness
 * mandates one micro-task per `<delegate>`; this does not block spawn —
 * it surfaces a timeline `phase` breadcrumb for the user and model.
 */
export function looksLikeCompoundDelegateTask(task: string): boolean {
  const t = task.trim();
  if (t.length < 24) return false;

  const lines = t.split(/\n/).map((l) => l.trim()).filter(Boolean);
  let bulletCount = 0;
  for (const line of lines) {
    // Unordered bullets signal multiple outcomes; ordered "1." lists often
    // enumerate sub-steps of a single deliverable.
    if (/^[-*•]\s+\S/.test(line)) bulletCount++;
  }
  if (bulletCount >= 3) return true;

  // Strip inline code spans before the semicolon check — code
  // snippets (`python -c "import os; sz = …"`) contain legitimate
  // semicolons that are NOT outcome separators.
  const noCode = t.replace(/`[^`]+`/g, '');
  const semiParts = noCode.split(';').filter((p) => p.trim().length >= 12);
  if (semiParts.length >= 3) return true;

  return false;
}

export { stripDelegateOnlyMarkup as stripDelegates } from './strip.js';
