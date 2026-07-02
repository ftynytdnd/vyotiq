/**
 * Extract a single-line git commit subject from model output.
 */

export function normalizeCommitSubject(text: string): string {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line ? line.slice(0, 200) : '';
}
