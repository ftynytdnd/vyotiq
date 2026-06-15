/**
 * Throttled live `tool-output-delta` emitter for in-flight `bash` runs.
 *
 * Cumulative stdout/stderr snapshots are pushed to the renderer at a
 * bounded rate so fast streams do not pin memory or flood IPC. The
 * final authoritative payload still lands on `tool-result`.
 */

import { randomUUID } from 'node:crypto';
import type { TimelineEvent } from '@shared/types/chat.js';

/** Min gap between live IPC frames — matches args-delta coalescing cadence. */
const LIVE_EMIT_INTERVAL_MS = 80;
/** Same cap as bash final capture — live view cannot exceed settled output. */
const LIVE_MAX_CHARS = 64 * 1024;

export interface BashOutputCaptureOpts {
  callId: string;
  command: string;
  emit: (event: TimelineEvent) => void;
  startedAt: number;
}

export class BashOutputCapture {
  private stdout = '';
  private stderr = '';
  private stdoutTruncated = false;
  private stderrTruncated = false;
  private lastEmitAt = 0;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(private readonly opts: BashOutputCaptureOpts) {}

  appendStdout(chunk: string): void {
    this.appendStream('stdout', chunk);
  }

  appendStderr(chunk: string): void {
    this.appendStream('stderr', chunk);
  }

  private appendStream(stream: 'stdout' | 'stderr', chunk: string): void {
    if (this.closed || chunk.length === 0) return;
    if (stream === 'stdout') {
      if (this.stdoutTruncated) return;
      if (this.stdout.length + chunk.length > LIVE_MAX_CHARS) {
        const room = Math.max(0, LIVE_MAX_CHARS - this.stdout.length);
        this.stdout += chunk.slice(0, room);
        this.stdoutTruncated = true;
      } else {
        this.stdout += chunk;
      }
    } else {
      if (this.stderrTruncated) return;
      if (this.stderr.length + chunk.length > LIVE_MAX_CHARS) {
        const room = Math.max(0, LIVE_MAX_CHARS - this.stderr.length);
        this.stderr += chunk.slice(0, room);
        this.stderrTruncated = true;
      } else {
        this.stderr += chunk;
      }
    }
    this.scheduleEmit();
  }

  private scheduleEmit(): void {
    const now = Date.now();
    const elapsed = now - this.lastEmitAt;
    if (elapsed >= LIVE_EMIT_INTERVAL_MS) {
      this.flush();
      return;
    }
    if (this.emitTimer !== null) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.flush();
    }, LIVE_EMIT_INTERVAL_MS - elapsed);
    this.emitTimer.unref?.();
  }

  flush(): void {
    if (this.closed) return;
    this.lastEmitAt = Date.now();
    this.opts.emit({
      kind: 'tool-output-delta',
      id: randomUUID(),
      ts: Date.now(),
      callId: this.opts.callId,
      tool: 'bash',
      command: this.opts.command,
      stdout: this.stdout,
      stderr: this.stderr,
      stdoutTruncated: this.stdoutTruncated,
      stderrTruncated: this.stderrTruncated,
      startedAt: this.opts.startedAt
    });
  }

  close(): void {
    this.closed = true;
    if (this.emitTimer !== null) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
  }
}
