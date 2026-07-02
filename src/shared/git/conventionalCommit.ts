/**
 * Conventional Commits 1.0.0 helpers — validation and model-output cleanup.
 * @see https://www.conventionalcommits.org/en/v1.0.0/
 */

import { commitMessageSubject, normalizeCommitMessage } from './normalizeCommitMessage.js';

/** Types from Conventional Commits + common @commitlint/config-conventional extensions. */
export const CONVENTIONAL_COMMIT_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert'
] as const;

export type ConventionalCommitType = (typeof CONVENTIONAL_COMMIT_TYPES)[number];

const TYPE_PATTERN = CONVENTIONAL_COMMIT_TYPES.join('|');

/** Subject line: type(scope)?: description — imperative, no trailing period. */
const SUBJECT_RE = new RegExp(
  `^(${TYPE_PATTERN})(\\([\\w./@-]+\\))?!?: [^\\n]+$`,
  'i'
);

const QUOTE_WRAP_RE = /^["'`]|["'`]$/;

/** Strip markdown fences, leading labels, and wrapping quotes from model output. */
export function stripCommitMessageBoilerplate(text: string): string {
  let out = text.replace(/\r\n/g, '\n').trim();
  if (!out) return '';

  out = out.replace(/^(commit message|subject|message):\s*/i, '');
  out = out.replace(/^```[\w.-]*\n?/, '').replace(/\n?```\s*$/, '');

  const firstLine = out.split('\n')[0]?.trim() ?? '';
  if (firstLine && QUOTE_WRAP_RE.test(firstLine)) {
    const unquoted = firstLine.replace(/^["'`]+|["'`]+$/g, '').trim();
    out = [unquoted, ...out.split('\n').slice(1)].join('\n').trim();
  }

  return normalizeCommitMessage(out);
}

export function isValidConventionalSubject(subject: string): boolean {
  const line = subject.trim();
  if (!line || line.length > 72) return false;
  if (line.endsWith('.')) return false;
  return SUBJECT_RE.test(line);
}

export function isValidConventionalCommitMessage(text: string): boolean {
  const subject = commitMessageSubject(text);
  return Boolean(subject && isValidConventionalSubject(subject));
}

/** Body text after the subject line (skips the blank line separator). */
export function commitMessageBody(text: string): string {
  const lines = normalizeCommitMessage(text).split('\n');
  let subjectSeen = false;
  const bodyLines: string[] = [];
  for (const line of lines) {
    if (!subjectSeen) {
      if (line.trim()) subjectSeen = true;
      continue;
    }
    bodyLines.push(line);
  }
  return bodyLines.join('\n').trim();
}

/** True when the body is mostly repetitive "- add …" checklist lines. */
export function isRoboticBulletBody(body: string): boolean {
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return false;
  const checklist = lines.filter((l) => /^[-*]\s+(add|update|include|wire)\s/i.test(l));
  return checklist.length >= Math.max(2, Math.ceil(lines.length * 0.55));
}

/**
 * True when the body reads like human prose (paragraphs), not a robotic checklist.
 * Small bodies are allowed for tiny commits via minChars.
 */
export function hasNaturalLanguageBody(text: string, minChars = 120): boolean {
  const body = commitMessageBody(text);
  if (!body) return false;
  if (body.length < minChars) return false;
  if (isRoboticBulletBody(body)) return false;

  const paragraphs = body
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return paragraphs.some((p) => {
    const firstLine = p.split('\n')[0]?.trim() ?? '';
    if (/^[-*]\s/.test(firstLine)) return false;
    return p.length >= 60 && /[.!?]/.test(p);
  });
}

export function isQualityCommitMessage(
  text: string,
  opts?: { minFilesForBody?: number; fileCount?: number }
): boolean {
  if (!isValidConventionalCommitMessage(text)) return false;
  const minFiles = opts?.minFilesForBody ?? 4;
  const fileCount = opts?.fileCount ?? 0;
  if (fileCount < minFiles) return true;
  return hasNaturalLanguageBody(text);
}

/** Normalize model text and ensure a conventional subject when possible. */
export function sanitizeModelCommitMessage(raw: string): string {
  const stripped = stripCommitMessageBoilerplate(raw);
  if (!stripped) return '';

  const lines = stripped.split('\n');
  const subjectIdx = lines.findIndex((l) => l.trim().length > 0);
  if (subjectIdx < 0) return '';

  let subject = lines[subjectIdx]!.trim();
  subject = subject.replace(/^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)\s*[-:]\s*/i, (m, type) => {
    return `${type.toLowerCase()}: `;
  });

  if (!SUBJECT_RE.test(subject)) {
    const typeScope = subject.match(
      new RegExp(`^(${TYPE_PATTERN})(\\([\\w./@-]+\\))?!?`, 'i')
    );
    if (typeScope) {
      const rest = subject.slice(typeScope[0].length).replace(/^[\s:-]+/, '');
      if (rest) {
        subject = `${typeScope[0]}: ${rest}`;
      }
    }
  }

  const bodyLines = lines.slice(subjectIdx + 1);
  const rebuilt = [subject, ...bodyLines].join('\n');
  return normalizeCommitMessage(rebuilt);
}
