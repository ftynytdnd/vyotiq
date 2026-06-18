/**
 * Shared constants for agent command capture in the workspace PTY.
 */

export const PTY_CMD_START = '__VYOTIQ_CMD_START__';
export const PTY_CMD_END_PREFIX = '__VYOTIQ_CMD_END__';

export const PTY_MAX_CAPTURE_CHARS = 64 * 1024;

/** Parsed completion from a PTY capture buffer (end marker must follow start). */
export interface PtyAgentCompletion {
  settled: boolean;
  exitCode: number;
  output: string;
}

/**
 * Detect agent command completion and extract stdout between markers.
 * The end marker must appear after the start marker and be followed
 * immediately by digits (actual `Write-Output` / `echo` result), not
 * PSReadLine echo noise like `'__VYOTIQ_CMD_END__' + $LASTEXITCODE`.
 */
export function parsePtyAgentCompletion(buffer: string): PtyAgentCompletion {
  const startIdx = buffer.indexOf(PTY_CMD_START);
  if (startIdx < 0) {
    return { settled: false, exitCode: 1, output: '' };
  }
  const contentStart = startIdx + PTY_CMD_START.length;
  const endIdx = buffer.indexOf(PTY_CMD_END_PREFIX, contentStart);
  if (endIdx < 0) {
    return { settled: false, exitCode: 1, output: buffer.slice(contentStart) };
  }
  const tail = buffer.slice(endIdx + PTY_CMD_END_PREFIX.length);
  const codeMatch = /^(-?\d+)/.exec(tail);
  const output = buffer.slice(contentStart, endIdx);
  if (!codeMatch) {
    return { settled: false, exitCode: 1, output };
  }
  return {
    settled: true,
    exitCode: Number.parseInt(codeMatch[1] ?? '1', 10),
    output
  };
}
