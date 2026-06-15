/**
 * Helpers for extracting agent command stdout from a shared PTY stream.
 *
 * Agent commands are wrapped with `PTY_CMD_START` / `PTY_CMD_END_PREFIX`
 * markers. Live telemetry must ignore wrapper noise and emit only the
 * bytes between those markers.
 */

import { PTY_CMD_END_PREFIX, PTY_CMD_START, PTY_MAX_CAPTURE_CHARS } from './ptyMarkers.js';

/** Body between start/end markers; empty when the start marker has not arrived. */
export function extractPtyAgentLiveStdout(buffer: string): string {
  const startIdx = buffer.indexOf(PTY_CMD_START);
  if (startIdx < 0) return '';
  const contentStart = startIdx + PTY_CMD_START.length;
  const endIdx = buffer.indexOf(PTY_CMD_END_PREFIX, contentStart);
  return endIdx >= 0 ? buffer.slice(contentStart, endIdx) : buffer.slice(contentStart);
}

/**
 * Incremental PTY stdout tracker — returns only newly surfaced bytes
 * so `BashOutputCapture.appendStdout` is not fed duplicate chunks.
 */
export class PtyAgentLiveStdoutTracker {
  private buffer = '';
  private emittedLen = 0;

  feed(chunk: string): string {
    if (!chunk) return '';
    if (this.buffer.length < PTY_MAX_CAPTURE_CHARS) {
      const room = PTY_MAX_CAPTURE_CHARS - this.buffer.length;
      this.buffer += chunk.length > room ? chunk.slice(0, room) : chunk;
    }
    const live = extractPtyAgentLiveStdout(this.buffer);
    if (live.length <= this.emittedLen) return '';
    const delta = live.slice(this.emittedLen);
    this.emittedLen = live.length;
    return delta;
  }
}
