/**
 * Built-in language servers shipped with Vyotiq (npm production dependencies).
 * Spawned via Electron-as-Node — no separate user install required.
 */

import { createRequire } from 'node:module';
import type { ResolvedLspServerConfig } from './lspWorkspaceConfig.js';

const require = createRequire(import.meta.url);

export type BundledLspId = 'pyright' | 'typescript-language-server';

const ENTRY: Record<BundledLspId, string> = {
  pyright: 'pyright/langserver.index.js',
  'typescript-language-server': 'typescript-language-server/lib/cli.mjs'
};

const BY_LANGUAGE: Record<string, BundledLspId> = {
  python: 'pyright',
  typescript: 'typescript-language-server',
  javascript: 'typescript-language-server'
};

export function resolveBundledLspEntry(id: BundledLspId): string | null {
  try {
    return require.resolve(ENTRY[id]);
  } catch {
    return null;
  }
}

export function resolveBundledLspServer(languageId: string): ResolvedLspServerConfig | null {
  const lang = languageId.trim().toLowerCase();
  const bundledId = BY_LANGUAGE[lang];
  if (!bundledId) return null;

  const entry = resolveBundledLspEntry(bundledId);
  if (!entry) return null;

  return {
    command: process.execPath,
    args: [entry, '--stdio'],
    bundledId,
    electronNode: true
  };
}

export function isBundledLspAvailable(): boolean {
  return (
    resolveBundledLspEntry('pyright') != null &&
    resolveBundledLspEntry('typescript-language-server') != null
  );
}
