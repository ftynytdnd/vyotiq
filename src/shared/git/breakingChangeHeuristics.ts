/**
 * Heuristics to detect likely breaking API changes from a diff excerpt.
 */

export type BreakingChangeConfidence = 'low' | 'medium' | 'high';

export interface BreakingChangeHints {
  likelyBreaking: boolean;
  confidence: BreakingChangeConfidence;
  reasons: string[];
  /** Instruction block for the commit-message model. */
  promptHint: string;
}

const EXPORT_REMOVE_RE = /^-\s*(?:export\s+|export\s+default\s+)/;
const EXPORT_ADD_RE = /^\+\s*(?:export\s+|export\s+default\s+)/;
const PUBLIC_API_PATH_RE = /(?:^|\/)(?:index|public|api|types)\.(?:ts|tsx|js|jsx|d\.ts)$/i;
const BREAKING_COMMENT_RE = /\bBREAKING(?:\s+CHANGE)?\b/i;

function diffLines(diff: string): string[] {
  return diff.split(/\r?\n/);
}

function countExportRemovals(diff: string): number {
  let count = 0;
  for (const line of diffLines(diff)) {
    if (EXPORT_REMOVE_RE.test(line) && !EXPORT_ADD_RE.test(line.replace(/^-/, '+'))) {
      count++;
    }
  }
  return count;
}

function hasDeletedPublicApiFile(changeSummary: string): boolean {
  return [...changeSummary.matchAll(/(?:^|\n)D\s+(\S+)/gm)].some((m) =>
    PUBLIC_API_PATH_RE.test(m[1] ?? '')
  );
}

function hasBreakingComment(diff: string): boolean {
  return diffLines(diff).some((line) => {
    const trimmed = line.replace(/^[-+]\s*/, '');
    return BREAKING_COMMENT_RE.test(trimmed);
  });
}

function hasRenamedPublicSymbol(diff: string): boolean {
  const removed: string[] = [];
  const added: string[] = [];
  for (const line of diffLines(diff)) {
    const rm = line.match(/^-\s*export\s+(?:async\s+)?(?:function|class|const|type|interface|enum)\s+(\w+)/);
    if (rm?.[1]) removed.push(rm[1]);
    const add = line.match(/^\+\s*export\s+(?:async\s+)?(?:function|class|const|type|interface|enum)\s+(\w+)/);
    if (add?.[1]) added.push(add[1]);
  }
  if (removed.length === 0) return false;
  const addedSet = new Set(added);
  return removed.some((name) => !addedSet.has(name));
}

/**
 * Analyze staged diff text and change summary for backward-incompatible edits.
 */
export function analyzeBreakingChanges(
  diffExcerpt: string,
  changeSummary: string
): BreakingChangeHints {
  const reasons: string[] = [];
  let score = 0;

  const exportRemovals = countExportRemovals(diffExcerpt);
  if (exportRemovals >= 2) {
    reasons.push(`${exportRemovals} exported symbols appear removed`);
    score += 2;
  } else if (exportRemovals === 1) {
    reasons.push('An exported symbol appears removed');
    score += 1;
  }

  if (hasRenamedPublicSymbol(diffExcerpt)) {
    reasons.push('Public export names changed without a direct rename');
    score += 2;
  }

  if (hasDeletedPublicApiFile(changeSummary)) {
    reasons.push('A public API entry file was deleted');
    score += 2;
  }

  if (hasBreakingComment(diffExcerpt)) {
    reasons.push('Diff or comments mention BREAKING CHANGE');
    score += 3;
  }

  const likelyBreaking = score >= 2;
  let confidence: BreakingChangeConfidence = 'low';
  if (score >= 4) confidence = 'high';
  else if (score >= 2) confidence = 'medium';

  const promptHint = likelyBreaking
    ? [
        'BREAKING CHANGE SIGNAL: ' + reasons.join('; ') + '.',
        'If this commit is backward-incompatible, add a `!` after the type/scope in the subject',
        'OR include a `BREAKING CHANGE:` footer explaining what consumers must update.',
        'Only flag breaking changes when the diff supports it — do not invent breakage.'
      ].join('\n')
    : '';

  return { likelyBreaking, confidence, reasons, promptHint };
}

export function messageSignalsBreakingChange(message: string): boolean {
  const firstLine = message.split('\n')[0]?.trim() ?? '';
  if (/^(?:feat|fix|refactor|perf|chore|build|ci|docs|style|test|revert)(?:\([^)]+\))?!:/i.test(firstLine)) {
    return true;
  }
  return /^BREAKING CHANGE:/im.test(message);
}
