/**
 * Normalize a full git commit message (subject + optional body).
 */

export function normalizeCommitMessage(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';
  return normalized.replace(/\n{3,}/g, '\n\n');
}

/** First non-empty line of a commit message (the subject). */
export function commitMessageSubject(text: string): string {
  const line = normalizeCommitMessage(text)
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line ? line.slice(0, 200) : '';
}
