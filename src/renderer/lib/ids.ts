/**
 * Tiny shared id helper for the renderer. Centralizes UUID generation so we
 * don't drift between stores / components that need stable ids.
 *
 * Uses `crypto.randomUUID` when available (modern Electron / Chromium ships
 * it), falls back to a base-36 random for older runtimes. This is NOT a
 * security-grade RNG; for that, do the work in main.
 */
export function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
