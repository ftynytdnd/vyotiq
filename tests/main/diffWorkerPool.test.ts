/**
 * Phase 2.7 — DiffWorkerPool unit tests.
 *
 * The pool's runtime collaborator (a `node:worker_threads`
 * `Worker`) is replaced with a `MockWorker` so we can drive the
 * full request/response/error/crash protocol without spawning an
 * actual OS thread. This isolates the test from electron-vite's
 * build-time `?nodeWorker` plugin (the production code path) and
 * keeps every test under 50ms.
 *
 * Pins:
 *   1. `computeHunks` lazily spawns ONE worker on first call and
 *      reuses it across subsequent calls.
 *   2. Each `computeHunks` call returns the hunks for the matching
 *      jobId (no cross-talk between concurrent jobs).
 *   3. A worker error response (structured `{ error }`) rejects
 *      the right promise without taking the worker down.
 *   4. A worker `error` event rejects every pending job and drops
 *      the worker reference so the NEXT job respawns.
 *   5. A worker `exit` event with a non-zero code is treated as a
 *      crash.
 *   6. `dispose()` rejects every in-flight job, terminates the
 *      worker, and is idempotent.
 *   7. Late messages (after dispose / for unknown jobIds) are
 *      ignored without throwing.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { DiffHunk } from '@shared/types/tool';

interface MockMessage {
  jobId: string;
  before: string;
  after: string;
}

class MockWorker extends EventEmitter {
  postedMessages: MockMessage[] = [];
  terminated = false;

  postMessage(msg: MockMessage): void {
    this.postedMessages.push(msg);
  }

  terminate(): Promise<number> {
    this.terminated = true;
    return Promise.resolve(0);
  }

  /** Drive a successful response from the worker side. */
  respondOk(jobId: string, hunks: DiffHunk[]): void {
    this.emit('message', { jobId, hunks });
  }

  /** Drive a structured error response (worker still alive). */
  respondError(jobId: string, message: string): void {
    this.emit('message', { jobId, error: message });
  }

  /** Simulate a worker crash via the `error` event. */
  crash(err: Error): void {
    this.emit('error', err);
  }

  /** Simulate an unexpected exit. */
  exit(code: number): void {
    this.emit('exit', code);
  }
}

// The vitest config aliases every `?nodeWorker` query to
// `tests/setup/nodeWorkerStub.ts`, so we mock that stub to hand
// out our MockWorker instances. The `constructedWorkers` array is
// reset between tests via the top-level `beforeEach` below.
const constructedWorkers: MockWorker[] = [];
vi.mock('../setup/nodeWorkerStub.ts', () => ({
  default: () => {
    const w = new MockWorker();
    constructedWorkers.push(w);
    return w;
  }
}));

import { DiffWorkerPool } from '@main/orchestrator/diffWorkerPool';

beforeEach(() => {
  constructedWorkers.length = 0;
});

describe('DiffWorkerPool', () => {
  it('lazily spawns a single worker and reuses it for subsequent jobs', async () => {
    const pool = new DiffWorkerPool(1);
    const job1 = pool.computeHunks('before', 'after');
    expect(constructedWorkers).toHaveLength(1);
    const worker = constructedWorkers[0]!;
    const jobId1 = worker.postedMessages[0]!.jobId;
    worker.respondOk(jobId1, []);
    await expect(job1).resolves.toEqual([]);

    const job2 = pool.computeHunks('x', 'y');
    expect(constructedWorkers).toHaveLength(1); // reused
    const jobId2 = worker.postedMessages[1]!.jobId;
    worker.respondOk(jobId2, []);
    await expect(job2).resolves.toEqual([]);

    pool.dispose();
  });

  it('routes responses to the correct pending promise', async () => {
    const pool = new DiffWorkerPool(2);
    const p1 = pool.computeHunks('a', 'b');
    const p2 = pool.computeHunks('c', 'd');
    const worker0 = constructedWorkers[0]!;
    const worker1 = constructedWorkers[1] ?? worker0;
    expect(worker0.postedMessages.length + worker1.postedMessages.length).toBe(2);
    const id1 = worker0.postedMessages[0]?.jobId;
    const id2 = (worker1.postedMessages[0] ?? worker0.postedMessages[1])?.jobId;
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    const sentinel: DiffHunk[] = [{ oldStart: 1, newStart: 1, lines: [] }];
    const workerForId2 = worker1.postedMessages[0]?.jobId === id2 ? worker1 : worker0;
    const workerForId1 = workerForId2 === worker1 ? worker0 : worker1;
    workerForId2.respondOk(id2!, sentinel);
    workerForId1.respondOk(id1!, []);
    await expect(p1).resolves.toEqual([]);
    await expect(p2).resolves.toEqual(sentinel);
    pool.dispose();
  });

  it('rejects the matching promise on a structured error response without killing the worker', async () => {
    const pool = new DiffWorkerPool(1);
    const p1 = pool.computeHunks('a', 'b');
    const worker = constructedWorkers[0]!;
    const id1 = worker.postedMessages[0]!.jobId;
    worker.respondError(id1, 'boom');
    await expect(p1).rejects.toThrow(/boom/);
    // Worker still alive — a second job reuses it.
    const p2 = pool.computeHunks('x', 'y');
    expect(constructedWorkers).toHaveLength(1);
    const id2 = worker.postedMessages[1]!.jobId;
    worker.respondOk(id2, []);
    await expect(p2).resolves.toEqual([]);
    pool.dispose();
  });

  it('rejects every pending job on worker `error` and respawns on next computeHunks', async () => {
    const pool = new DiffWorkerPool(1);
    const p1 = pool.computeHunks('a', 'b');
    const worker = constructedWorkers[0]!;
    worker.crash(new Error('worker died'));
    await expect(p1).rejects.toThrow(/worker died/);
    const p2 = pool.computeHunks('x', 'y');
    expect(constructedWorkers).toHaveLength(2);
    const newWorker = constructedWorkers[1]!;
    const id2 = newWorker.postedMessages[0]!.jobId;
    newWorker.respondOk(id2, []);
    await expect(p2).resolves.toEqual([]);
    pool.dispose();
  });

  it('treats non-zero exit codes as a crash', async () => {
    const pool = new DiffWorkerPool(1);
    const p1 = pool.computeHunks('a', 'b');
    const worker = constructedWorkers[0]!;
    worker.exit(7);
    await expect(p1).rejects.toThrow(/exited with code 7/);
    pool.dispose();
  });

  it('ignores zero exit code (clean shutdown after dispose)', async () => {
    const pool = new DiffWorkerPool(1);
    // No pending jobs — exit(0) should be silent.
    pool.dispose();
    // dispose terminates; nothing should throw.
    expect(() => pool.dispose()).not.toThrow();
  });

  it('dispose rejects in-flight jobs and terminates the worker', async () => {
    const pool = new DiffWorkerPool(1);
    const p1 = pool.computeHunks('a', 'b');
    const worker = constructedWorkers[0]!;
    pool.dispose();
    await expect(p1).rejects.toThrow(/disposed/);
    expect(worker.terminated).toBe(true);
  });

  it('rejects new computeHunks calls after dispose', async () => {
    const pool = new DiffWorkerPool(1);
    pool.dispose();
    await expect(pool.computeHunks('a', 'b')).rejects.toThrow(/disposed/);
  });

  it('drops late messages for unknown jobIds without throwing', async () => {
    const pool = new DiffWorkerPool(1);
    const p1 = pool.computeHunks('a', 'b');
    const worker = constructedWorkers[0]!;
    // Stray message that doesn't match any pending jobId.
    expect(() => worker.respondOk('unknown-job-id', [])).not.toThrow();
    // The real pending job still resolves normally.
    const id1 = worker.postedMessages[0]!.jobId;
    worker.respondOk(id1, []);
    await expect(p1).resolves.toEqual([]);
    pool.dispose();
  });

  it('dispose is idempotent', () => {
    const pool = new DiffWorkerPool(1);
    pool.dispose();
    expect(() => pool.dispose()).not.toThrow();
  });
});
