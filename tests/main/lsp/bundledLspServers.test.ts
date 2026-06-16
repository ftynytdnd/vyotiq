/**
 * Bundled LSP servers resolve from shipped npm dependencies.
 */

import { describe, expect, it } from 'vitest';
import {
  isBundledLspAvailable,
  resolveBundledLspEntry,
  resolveBundledLspServer
} from '../../../src/main/lsp/bundledLspServers.js';
import { relayFingerprint } from '../../../src/main/lsp/lspWorkspaceConfig.js';

describe('bundledLspServers', () => {
  it('resolves pyright and typescript-language-server entry points', () => {
    expect(resolveBundledLspEntry('pyright')).toMatch(/langserver\.index\.js$/);
    expect(resolveBundledLspEntry('typescript-language-server')).toMatch(/cli\.mjs$/);
    expect(isBundledLspAvailable()).toBe(true);
  });

  it('maps python and typescript to bundled spawn specs', () => {
    const python = resolveBundledLspServer('python');
    expect(python?.bundledId).toBe('pyright');
    expect(python?.electronNode).toBe(true);
    expect(python?.args.at(-1)).toBe('--stdio');

    const ts = resolveBundledLspServer('typescript');
    expect(ts?.bundledId).toBe('typescript-language-server');

    const js = resolveBundledLspServer('javascript');
    expect(js?.bundledId).toBe('typescript-language-server');
  });

  it('uses stable relay fingerprints for bundled servers', () => {
    const py = resolveBundledLspServer('python');
    expect(py).not.toBeNull();
    expect(relayFingerprint(py!)).toBe('bundled:pyright');
  });
});
