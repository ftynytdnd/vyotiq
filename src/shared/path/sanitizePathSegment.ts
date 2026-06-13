/**
 * Sanitize a string for use as a single filesystem path segment.
 * Replaces characters illegal on Windows/macOS/Linux (notably `:` from
 * `manual:<uuid>` run ids).
 */
export function sanitizePathSegment(segment: string): string {
  const cleaned = segment
    .replace(/[:<>"|?*\u0000-\u001f]/g, '_')
    .replace(/[./\\]+$/g, '')
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 120) : 'segment';
}
