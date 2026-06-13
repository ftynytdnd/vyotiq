/** Normalize Windows backslashes for path comparison in the editor. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}
