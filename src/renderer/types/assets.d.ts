/**
 * Ambient declarations for non-TS asset imports consumed by the renderer.
 *
 * TypeScript 6 tightened module resolution for side-effect imports: a bare
 * `import './index.css'` now needs a declared module shape, not just a Vite
 * loader at runtime. This file provides that shape for CSS (used by the
 * renderer entry point and the highlight.js theme import) without changing
 * any runtime behavior.
 *
 * NOTE for `knip`: picked up via the `tsconfig.web.json` `include` glob
 * rather than an explicit import edge, so the tool flags it as
 * "unused" (false positive). Do not delete.
 */

declare module '*.css';
