/**
 * Ambient module declarations for Vite's `?raw` / `?nodeWorker` query
 * suffixes used by the main-process bundle.
 *
 * Used by:
 *   - `src/main/harness/harnessLoader.ts` — `import x from './foo.md?raw'`
 *   - electron-vite's `?nodeWorker` plugin for spawning Node worker threads
 *
 * NOTE for `knip`: this file is intentionally `import`-less; TypeScript
 * picks it up via the `include` glob in `tsconfig.node.json`, not via
 * an explicit import graph edge. `knip` (verified v6.12.x) flags it as
 * "unused" for that reason — false positive. Do not delete.
 */

declare module '*.md?raw' {
  const content: string;
  export default content;
}

declare module '*.txt?raw' {
  const content: string;
  export default content;
}

/**
 * electron-vite `?nodeWorker` suffix — produces a factory that
 * instantiates a `node:worker_threads` `Worker` targeting the
 * imported module. The plugin handles the worker-entry build
 * transparently so the main bundle stays single-entry.
 */
declare module '*?nodeWorker' {
  import type { Worker, WorkerOptions } from 'node:worker_threads';
  const createWorker: (options?: WorkerOptions) => Worker;
  export default createWorker;
}
