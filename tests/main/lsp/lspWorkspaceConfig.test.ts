/**
 * LSP workspace config merge + per-language resolution.
 */

import { describe, expect, it } from 'vitest';
import {
  mergeLspConfig,
  normalizeLspArgs,
  relayFingerprint,
  resolveLspServerForLanguage
} from '../../../src/main/lsp/lspWorkspaceConfig.js';

describe('normalizeLspArgs', () => {
  it('falls back to --stdio for empty arrays', () => {
    expect(normalizeLspArgs([])).toEqual(['--stdio']);
    expect(normalizeLspArgs(undefined)).toEqual(['--stdio']);
  });
});

describe('mergeLspConfig', () => {
  it('merges per-language maps with workspace winning', () => {
    const merged = mergeLspConfig(
      {
        enabled: true,
        command: 'typescript-language-server',
        args: ['--stdio'],
        languages: { python: { command: 'pylsp' } }
      },
      { languages: { python: { command: 'pyright-langserver', args: ['--stdio'] } } }
    );
    expect(merged.languages.python).toEqual({
      command: 'pyright-langserver',
      args: ['--stdio']
    });
  });
});

describe('resolveLspServerForLanguage', () => {
  const merged = mergeLspConfig(
    {
      enabled: true,
      command: 'typescript-language-server',
      args: ['--stdio'],
      languages: { python: { command: 'pyright-langserver' } }
    },
    null
  );

  it('prefers per-language command', () => {
    expect(resolveLspServerForLanguage(merged, 'python')?.command).toBe('pyright-langserver');
  });

  it('falls back to global command', () => {
    expect(resolveLspServerForLanguage(merged, 'rust')?.command).toBe('typescript-language-server');
  });

  it('aliases javascript to typescript override', () => {
    const tsOnly = mergeLspConfig(
      { enabled: true, command: 'global', languages: { typescript: { command: 'ts-server' } } },
      null
    );
    expect(resolveLspServerForLanguage(tsOnly, 'javascript')?.command).toBe('ts-server');
  });
});

describe('relayFingerprint', () => {
  it('is stable for the same command + args', () => {
    expect(relayFingerprint({ command: 'a', args: ['--stdio'] })).toBe(
      relayFingerprint({ command: 'a', args: ['--stdio'] })
    );
    expect(relayFingerprint({ command: 'a', args: ['--stdio'] })).not.toBe(
      relayFingerprint({ command: 'b', args: ['--stdio'] })
    );
  });

  it('uses bundled id when present', () => {
    expect(relayFingerprint({ command: 'x', args: [], bundledId: 'pyright' })).toBe(
      'bundled:pyright'
    );
  });
});
