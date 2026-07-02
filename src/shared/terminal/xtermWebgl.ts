/**
 * Whether xterm.js should load WebglAddon.
 *
 * WebGL terminal rendering can crash Electron's GPU process on Windows.
 * Canvas fallback is stable.
 */

export function shouldUseXtermWebglRenderer(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent ?? '';
  if (ua.includes('Electron')) return false;
  return true;
}
