/**
 * Normalize PTY / shell stdout for timeline display.
 * Strips ANSI/OSC sequences and collapses carriage-return overwrites.
 */

const ANSI_CSI_RE = /\x1b\[[0-9?;]*[ -/]*[@-~]/g;
const ANSI_OSC_RE = /\x1b\][^\x07]*(?:\x07|\x1b\\)/g;
const OTHER_ESC_RE = /\x1b[@-Z\\-_]/g;

export function stripTerminalControlSequences(text: string): string {
  return text
    .replace(ANSI_OSC_RE, '')
    .replace(ANSI_CSI_RE, '')
    .replace(OTHER_ESC_RE, '');
}

/** Collapse `\r` line overwrites and trim trailing control noise. */
export function formatTerminalDisplay(text: string): string {
  const stripped = stripTerminalControlSequences(text);
  return stripped
    .split('\n')
    .map((line) => {
      const parts = line.split('\r');
      return parts[parts.length - 1] ?? '';
    })
    .join('\n')
    .replace(/\u0000/g, '');
}

export function hasVisibleTerminalOutput(text: string): boolean {
  return formatTerminalDisplay(text).trim().length > 0;
}
