/** Shared slug helper for `.vyotiq/reports/` filenames. */
export function slugifyReportSegment(
  text: string,
  maxLen: number,
  fallback: string
): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]+/g, '')
      .replace(/\s+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maxLen) || fallback
  );
}
