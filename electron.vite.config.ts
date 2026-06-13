import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';
import { builtinModules, createRequire } from 'node:module';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const require = createRequire(import.meta.url);
const pkg = require('./package.json') as { dependencies?: Record<string, string> };
const prodDeps = Object.keys(pkg.dependencies ?? {});
const nodeExternals: (string | RegExp)[] = [
  'electron',
  /^electron\/.+/,
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
  ...prodDeps,
  new RegExp(`^(${prodDeps.join('|')})\\/`)
];

// Audit fix 2026-01-P3-1 / 16-P3-1: emit `hidden` source maps for every
// build target. `'hidden'` produces the `.map` files (so a crash report
// or production-only bug can be deobfuscated) without writing the
// `//# sourceMappingURL=` reference into the bundle — keeping users'
// devtools / view-source clean of the sourcemap pointer that would
// otherwise leak the original file paths. The maps live next to the
// emitted JS in `out/{main,preload,renderer}/` and are pulled into the
// crash-reporter pipeline by the (out-of-scope) packaging step.
const SOURCEMAP: 'hidden' = 'hidden';

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@main': resolve(__dirname, 'src/main')
      }
    },
    ssr: { noExternal: [], external: prodDeps },
    build: {
      sourcemap: SOURCEMAP,
      lib: {
        entry: resolve(__dirname, 'src/main/index.ts'),
        formats: ['cjs']
      },
      rolldownOptions: {
        external: nodeExternals,
        output: { entryFileNames: 'index.js' }
      }
    }
  },
  preload: {
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    },
    ssr: { noExternal: [], external: prodDeps },
    build: {
      sourcemap: SOURCEMAP,
      lib: {
        entry: resolve(__dirname, 'src/main/preload/preload.ts'),
        formats: ['cjs']
      },
      rolldownOptions: {
        external: nodeExternals,
        output: { entryFileNames: 'index.js' }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer')
      }
    },
    build: {
      sourcemap: SOURCEMAP,
      // Drop stale hashed chunks so preview/production never load an old bundle
      // (e.g. pre–dock-rename `sidebarVisible` persist paths).
      emptyOutDir: true,
      rolldownOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
});
