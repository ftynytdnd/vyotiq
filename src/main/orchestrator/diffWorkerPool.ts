/**
 * Lazy single-worker pool for off-main-thread diff computation.
 *
 * Design trade-offs:
 *
 *   - ONE worker, not N. The streamer serialises compute via its
 *     `computing` single-flight flag (per callId) and the content-
 *     hash dedup means only distinct args trigger a job — so
 *     worker contention is bounded. Adding more workers would
 *     complicate the shutdown path for no measurable benefit.
 *
 *   - Lazy spawn. Tests that never compute a large diff don't pay
 *     the worker startup cost (~20ms on Windows). Production
 *     sessions only spin one up the first time a file exceeds the
 *     inline cutoff.
 *
 *   - Crash resilience. If the worker errors or exits unexpectedly
 *     every pending job rejects and the next job respawns. The
 *     streamer's outer `try/catch` turns the rejection into a
 *     silent skip, falling back to the renderer's synthesised
 *     preview.
 *
 *   - Clean dispose. `dispose()` terminates the worker and rejects
 *     every pending job. Idempotent so it's safe to call from
 *     both the abort-signal listener and the run-loop finally.
 *
 * The pool exposes a single promise-returning `computeHunks`
 * method that the streamer can call interchangeably with the
 * synchronous `computeDiffHunks` import — same inputs, same shape
 * back.
 */

import { randomUUID } from 'node:crypto';
import type { Worker } from 'node:worker_threads';
import type { DiffHunk } from '@shared/types/tool.js';
import { logger } from '../logging/logger.js';
// electron-vite `?nodeWorker` loader — this import is resolved at
// build time to a factory that instantiates the worker module.
// The unit-test layer substitutes an in-process fallback so the
// test process doesn't need the real worker entry on disk.
import createDiffWorker from './diffWorker?nodeWorker';

const log = logger.child('diffWorkerPool');

interface PendingJob {
  resolve: (hunks: DiffHunk[]) => void;
  reject: (err: Error) => void;
}

interface WorkerMessage {
  jobId: string;
  hunks?: DiffHunk[];
  error?: string;
}

export class DiffWorkerPool {
  private worker: Worker | null = null;
  private pending = new Map<string, PendingJob>();
  private disposed = false;

  /**
   * Compute LCS hunks off the main thread. Resolves with the same
   * shape `computeDiffHunks` would return synchronously on the
   * main thread. Rejects on worker crash / termination.
   *
   * The pool lazily spawns the worker on first use. Subsequent
   * calls reuse the same worker.
   */
  async computeHunks(before: string, after: string): Promise<DiffHunk[]> {
    if (this.disposed) {
      throw new Error('DiffWorkerPool: computeHunks on disposed pool');
    }
    const worker = this.ensureWorker();
    const jobId = randomUUID();
    return new Promise<DiffHunk[]>((resolve, reject) => {
      this.pending.set(jobId, { resolve, reject });
      worker.postMessage({ jobId, before, after });
    });
  }

  /**
   * Terminate the worker (if spawned) and reject every in-flight
   * job. Safe to call multiple times. Once disposed the pool
   * cannot be used again — the streamer owns the lifecycle and
   * builds a fresh pool per run.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const rejectErr = new Error('DiffWorkerPool disposed');
    for (const job of this.pending.values()) {
      job.reject(rejectErr);
    }
    this.pending.clear();
    if (this.worker) {
      void this.worker.terminate().catch((err) => {
        log.debug('worker terminate error (ignored)', { err });
      });
      this.worker = null;
    }
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = createDiffWorker();
    w.on('message', (msg: WorkerMessage) => this.handleMessage(msg));
    w.on('error', (err) => this.handleFatal(err));
    w.on('exit', (code) => {
      if (code !== 0 && !this.disposed) {
        this.handleFatal(new Error(`diffWorker exited with code ${code}`));
      }
    });
    this.worker = w;
    return w;
  }

  private handleMessage(msg: WorkerMessage): void {
    const job = this.pending.get(msg.jobId);
    if (!job) {
      // Response for a jobId we don't track — most likely a late
      // message after dispose(). Drop silently.
      return;
    }
    this.pending.delete(msg.jobId);
    if (msg.error) {
      job.reject(new Error(msg.error));
    } else if (msg.hunks) {
      job.resolve(msg.hunks);
    } else {
      job.reject(new Error('diffWorker returned neither hunks nor error'));
    }
  }

  private handleFatal(err: Error): void {
    log.warn('diffWorker fatal — rejecting pending jobs', { err: err.message });
    const pending = Array.from(this.pending.values());
    this.pending.clear();
    for (const job of pending) job.reject(err);
    // Drop the reference so the next computeHunks call respawns.
    this.worker = null;
  }
}
