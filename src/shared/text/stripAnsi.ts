/**
 * Strip ANSI escape sequences from terminal / tool output for plain-text display.
 */

// CSI sequences, OSC hyperlinks/titles, and single-char escapes (e.g. cursor show/hide).
const ANSI_PATTERN =
  /(?:\u001B\][^\u0007]*(?:\u0007|\u001B\\))|(?:\u001B\][^\u0007]*)|(?:\u001B\[[0-?]*[ -/]*[@-~])|(?:\u001B[@-Z\\-_])|(?:\u009B[0-?]*[ -/]*[@-~])/g;

/** Remove ANSI styling/control codes while preserving readable text. */
export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, '');
}

/** Collapse spinner/carriage-return noise common in npm/npx installers. */
export function sanitizeToolOutputForDisplay(input: string): string {
  const stripped = stripAnsi(input);
  return stripped
    .replace(/\r(?!\n)/g, '')
    .replace(/\u280B|\u2819|\u2839|\u2838|\u283C|\u2834|\u2826|\u2827|\u2807|\u280F/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}
