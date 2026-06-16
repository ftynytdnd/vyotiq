/**
 * Normalize on-disk text for in-memory editing (CodeMirror uses `\n` line endings).
 */

export function normalizeEditorBufferText(body: string): string {
  return body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
