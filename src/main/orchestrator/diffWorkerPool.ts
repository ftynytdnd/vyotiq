/**
 * Multi-worker pool for off-main-thread diff computation.
 *
 * N workers (default `min(4, os.cpus)`) round-robin incoming jobs.
 * Crash resilience and dispose semantics match the original single-
 * worker pool — a fatal worker error rejects its pending jobs and
 * respawns on the next assignment.
 */

import { randomUUID } from 'node:crypto';
import { cpus } from 'node:os';
import type { Worker } from 'node:worker_threads';
import type { DiffHunk } from '@shared/types/tool.js';
import { logger } from '../logging/logger.js';
import createDiffWorker from './diffWorker?nodeWorker';

const log = logger.child('diffWorkerPool');

const DIFF_WORKER_POOL_SIZE = Math.max(1, Math.min(4, cpus().length));

interface PendingJob {
  resolve: (hunks: DiffHunk[]) => void;
  reject: (err: Error) => void;
}

interface WorkerMessage {
  jobId: string;
  hunks?: DiffHunk[];
  error?: string;
}

interface PoolWorker {
  worker: Worker;
  busy: boolean;
  pending: Map<string, PendingJob>;
}

export class DiffWorkerPool {
  private workers: PoolWorker[] = [];
  private jobQueue: Array<{
    jobId: string;
    before: string;
    after: string;
    resolve: (hunks: DiffHunk[]) => void;
    reject: (err: Error) => void;
  }> = [];
  private disposed = false;
  private readonly poolSize: number;

  constructor(poolSize = DIFF_WORKER_POOL_SIZE) {
    this.poolSize = Math.max(1, poolSize);
  }

  async computeHunks(before: string, after: string): Promise<DiffHunk[]> {
    if (this.disposed) {
      throw new Error('DiffWorkerPool: computeHunks on disposed pool');
    }
    const jobId = randomUUID();
    return new Promise<DiffHunk[]>((resolve, reject) => {
      this.jobQueue.push({ jobId, before, after, resolve, reject });
      this.drainQueue();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const rejectErr = new Error('DiffWorkerPool disposed');
    for (const job of this.jobQueue) job.reject(rejectErr);
    this.jobQueue = [];
    for (const pw of this.workers) {
      for (const job of pw.pending.values()) job.reject(rejectErr);
      pw.pending.clear();
      void pw.worker.terminate().catch((err) => {
        log.debug('worker terminate error (ignored)', { err });
      });
    }
    this.workers = [];
  }

  private drainQueue(): void {
    while (this.jobQueue.length > 0) {
      const slot = this.pickIdleWorker();
      if (!slot) return;
      const job = this.jobQueue.shift()!;
      slot.busy = true;
      slot.pending.set(job.jobId, { resolve: job.resolve, reject: job.reject });
      slot.worker.postMessage({ jobId: job.jobId, before: job.before, after: job.after });
    }
  }

  private pickIdleWorker(): PoolWorker | null {
    const idle = this.workers.find((w) => !w.busy);
    if (idle) return idle;
    if (this.workers.length < this.poolSize) {
      const pw = this.spawnWorker();
      this.workers.push(pw);
      return pw;
    }
    return null;
  }

  private spawnWorker(): PoolWorker {
    const pw: PoolWorker = {
      worker: createDiffWorker(),
      busy: false,
      pending: new Map()
    };
    pw.worker.on('message', (msg: WorkerMessage) => this.handleMessage(pw, msg));
    pw.worker.on('error', (err) => this.handleFatal(pw, err));
    pw.worker.on('exit', (code) => {
      if (code !== 0 && !this.disposed) {
        this.handleFatal(pw, new Error(`diffWorker exited with code ${code}`));
      }
    });
    return pw;
  }

  private handleMessage(pw: PoolWorker, msg: WorkerMessage): void {
    const job = pw.pending.get(msg.jobId);
    if (!job) return;
    pw.pending.delete(msg.jobId);
    pw.busy = pw.pending.size > 0;
    if (msg.error) {
      job.reject(new Error(msg.error));
    } else if (msg.hunks) {
      job.resolve(msg.hunks);
    } else {
      job.reject(new Error('diffWorker returned neither hunks nor error'));
    }
    this.drainQueue();
  }

  private handleFatal(pw: PoolWorker, err: Error): void {
    log.warn('diffWorker fatal — rejecting pending jobs', { err: err.message });
    const pending = Array.from(pw.pending.values());
    pw.pending.clear();
    pw.busy = false;
    for (const job of pending) job.reject(err);
    const idx = this.workers.indexOf(pw);
    if (idx >= 0) this.workers.splice(idx, 1);
    this.drainQueue();
  }
}
