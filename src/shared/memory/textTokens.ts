/**
 * Shared tokenization for keyword retrieval and local feature-hash embeddings.
 */

const STOP = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'and', 'or', 'of',
  'to', 'in', 'on', 'for', 'with', 'as', 'by', 'at', 'this', 'that',
  'it', 'its', 'i', 'you', 'we', 'they', 'do', 'does', 'did', 'have',
  'has', 'had', 'not', 'no', 'so', 'if', 'then', 'than', 'but', 'from'
]);

export function tokenizeForMemory(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_./-]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}
