/**
 * Vitest stub for the electron-vite `?nodeWorker` import suffix.
 *
 * The real plugin produces a factory that instantiates a Node
 * `Worker` targeting the imported module. Inside vitest the
 * suffix is meaningless — we just need ANY callable default
 * export so module evaluation succeeds. The exported factory
 * throws on invocation so tests that accidentally hit the worker
 * path get an actionable error rather than a silent hang.
 *
 * Tests that legitimately exercise the worker code path (e.g.
 * `diffWorkerPool.test.ts`) inject their own fake worker via
 * `vi.mock` of the importing module instead of relying on this
 * stub.
 */

export default function createWorkerStub(): never {
  throw new Error(
    'tests/setup/nodeWorkerStub: ?nodeWorker import invoked without an explicit vi.mock — ' +
      'mock the importing module to control worker behaviour in tests'
  );
}
