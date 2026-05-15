import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
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

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@main': resolve(__dirname, 'src/main')
      }
    },
    ssr: { noExternal: [], external: prodDeps },
    build: {
      lib: {
        entry: resolve(__dirname, 'src/main/index.ts'),
        formats: ['cjs']
      },
      rollupOptions: {
        external: nodeExternals,
        output: { entryFileNames: 'index.js' }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    },
    ssr: { noExternal: [], external: prodDeps },
    build: {
      lib: {
        entry: resolve(__dirname, 'src/main/preload/preload.ts'),
        formats: ['cjs']
      },
      rollupOptions: {
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
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
});
