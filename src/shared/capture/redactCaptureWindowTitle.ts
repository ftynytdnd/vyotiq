/** Patterns that suggest a window title may contain sensitive context. */
const SENSITIVE_WINDOW_TITLE_PATTERNS = [
  /password/i,
  /bank/i,
  /sign[\s-]?in/i,
  /\blogin\b/i,
  /authenticator/i,
  /1password/i,
  /bitwarden/i,
  /lastpass/i,
  /dashlane/i,
  /keeper/i
] as const;

export function redactCaptureWindowTitle(name: string, enabled: boolean): string {
  if (!enabled) return name;
  if (SENSITIVE_WINDOW_TITLE_PATTERNS.some((pattern) => pattern.test(name))) {
    return 'Private window';
  }
  return name;
}
