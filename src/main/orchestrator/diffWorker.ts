/**
 * Off-main-thread LCS worker for `DiffStreamer`.
 *
 * The LCS computation for a file of ~1 MB can take 100–300ms of
 * CPU time — well past the 16ms frame budget the UI thread needs
 * to stay responsive. Rather than block the Electron main process
 * (which houses ALL UI scheduling), large files are dispatched to
 * this worker via the `?nodeWorker` electron-vite build plugin.
 *
 * Protocol is trivially request/response:
 *
 *   Inbound:  { jobId: string; before: string; after: string }
 *   Outbound: { jobId: string; hunks: DiffHunk[] }
 *
 * The worker is stateless — every job is independent, so a single
 * long-lived worker handles the full run. If the pool ever grows
 * to multiple workers, the protocol is still safe because jobs
 * carry their own id.
 *
 * Crashes propagate as a worker `error` event back to the pool,
 * which rejects the pending promise and respawns on the next job.
 */

import { parentPort } from 'node:worker_threads';
import { computeDiffHunksBounded } from '@shared/text/diff/windowedDiffHunks.js';

interface WorkerJob {
  jobId: string;
  before: string;
  after: string;
}

// Only register the message handler when this module is actually
// running inside a worker thread. Importing the module in the main
// process (e.g. under vitest, where the `?nodeWorker` Vite suffix
// is not honoured) must be a no-op so test runners can load it
// without side-effects.
if (parentPort) {
  parentPort.on('message', (job: WorkerJob) => {
    try {
      const hunks = computeDiffHunksBounded(job.before, job.after);
      parentPort!.postMessage({ jobId: job.jobId, hunks });
    } catch (err) {
      // Marshal errors back as a structured response so the pool
      // can reject the right promise without taking down the worker.
      const message = err instanceof Error ? err.message : String(err);
      parentPort!.postMessage({ jobId: job.jobId, error: message });
    }
  });
}
