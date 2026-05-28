/**
 * Vitest configuration. Picks an environment per test path so a single
 * `npm test` run covers both halves of the codebase:
 *
 *   - `tests/main/**`     → node environment, Electron mocked.
 *   - `tests/renderer/**` → happy-dom environment, IPC bridge stubbed.
 *
 * Setup files run before every matching test:
 *   - `electronMock.ts`   loads everywhere (no-op in renderer tests
 *                         that don't import electron, but harmless and
 *                         keeps a single source of mock truth).
 *   - `rendererSetup.ts`  loads only for renderer tests; provides
 *                         `window.vyotiq` and DOM cleanup hooks.
 *
 * Path aliases mirror the production tsconfig + electron-vite setup so
 * test imports look identical to source imports (`@shared/*`,
 * `@main/*`, `@renderer/*`).
 */

import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // The React plugin handles automatic JSX runtime so renderer tests
  // can write `<Foo />` without a `import React from 'react'` line.
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@shared', replacement: resolve(__dirname, 'src/shared') },
      { find: '@main', replacement: resolve(__dirname, 'src/main') },
      { find: '@renderer', replacement: resolve(__dirname, 'src/renderer') },
      // The electron-vite `?nodeWorker` suffix has no meaning under
      // vitest; redirect every such import to a callable stub so
      // module loading succeeds. Tests that exercise the worker
      // path mock `diffWorkerPool` directly.
      {
        find: /^(.*)\?nodeWorker$/,
        replacement: resolve(__dirname, 'tests/setup/nodeWorkerStub.ts')
      }
    ]
  },
  test: {
    globals: true,
    // Clear mock.calls / mock.results on every spy and vi.fn() between tests.
    // Vitest 4 no longer clears call history across re-spied properties on
    // shared singletons (e.g. zustand store methods) via `restoreAllMocks()`
    // alone, so stale calls from a prior test would leak into the next
    // test's `vi.spyOn(...)` spy. Auto-clearing restores test isolation.
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/main/**/*.{ts,tsx}', 'src/renderer/**/*.{ts,tsx}'],
      exclude: [
        'src/main/index.ts',
        'src/main/preload/**',
        'src/renderer/index.tsx',
        'src/renderer/index.html',
        '**/*.d.ts'
      ]
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'main',
          include: ['tests/main/**/*.test.{ts,tsx}', 'tests/shared/**/*.test.{ts,tsx}'],
          environment: 'node',
          setupFiles: ['tests/setup/electronMock.ts']
        }
      },
      {
        extends: true,
        test: {
          name: 'renderer',
          include: ['tests/renderer/**/*.test.{ts,tsx}'],
          environment: 'happy-dom',
          setupFiles: ['tests/setup/electronMock.ts', 'tests/setup/rendererSetup.ts']
        }
      }
    ]
  }
});
