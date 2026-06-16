/**
 * Per-workspace LSP overrides from `.vyotiq/lsp.json`.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../logging/logger.js';

const log = logger.child('lsp/workspaceConfig');

export interface LspLanguageServerConfig {
  command: string;
  args?: string[];
}

export interface LspWorkspaceConfig {
  enabled?: boolean;
  command?: string;
  args?: string[];
  /** Per-language stdio server overrides (languageId → command). */
  languages?: Record<string, LspLanguageServerConfig>;
}

import type { BundledLspId } from './bundledLspServers.js';

export interface ResolvedLspServerConfig {
  command: string;
  args: string[];
  /** Vyotiq-shipped server — spawned with ELECTRON_RUN_AS_NODE. */
  bundledId?: BundledLspId;
  electronNode?: boolean;
}

export interface ResolvedLspConfig {
  enabled: boolean;
  command: string;
  args: string[];
  languages: Record<string, ResolvedLspServerConfig>;
  source: 'global' | 'workspace' | 'disabled';
}

const DEFAULT_ARGS = ['--stdio'] as const;

/** Normalize args — empty arrays fall back to `--stdio`. */
export function normalizeLspArgs(args: string[] | undefined): string[] {
  if (!Array.isArray(args) || args.length === 0) return [...DEFAULT_ARGS];
  return args;
}

function normalizeLanguageMap(
  raw: Record<string, LspLanguageServerConfig> | undefined
): Record<string, ResolvedLspServerConfig> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, ResolvedLspServerConfig> = {};
  for (const [lang, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object') continue;
    const command = typeof entry.command === 'string' ? entry.command.trim() : '';
    if (!command) continue;
    out[lang.toLowerCase()] = {
      command,
      args: normalizeLspArgs(entry.args)
    };
  }
  return out;
}

export async function readWorkspaceLspOverride(
  workspaceRoot: string
): Promise<LspWorkspaceConfig | null> {
  const path = join(workspaceRoot, '.vyotiq', 'lsp.json');
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as LspWorkspaceConfig;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    log.warn('failed to read workspace lsp.json', { path, err });
    return null;
  }
}

export function mergeLspConfig(
  global: LspWorkspaceConfig | undefined,
  workspace: LspWorkspaceConfig | null
): ResolvedLspConfig {
  const ws = workspace ?? {};
  const enabled = ws.enabled ?? global?.enabled === true;
  const command = (ws.command ?? global?.command ?? '').trim();
  const args = normalizeLspArgs(
    Array.isArray(ws.args) ? ws.args : Array.isArray(global?.args) ? global.args : undefined
  );
  const languages = {
    ...normalizeLanguageMap(global?.languages),
    ...normalizeLanguageMap(ws.languages)
  };
  const source: ResolvedLspConfig['source'] = !enabled
    ? 'disabled'
    : workspace &&
        (workspace.enabled !== undefined ||
          workspace.command ||
          workspace.args ||
          workspace.languages)
      ? 'workspace'
      : 'global';
  return { enabled, command, args, languages, source };
}

/** Map javascript ↔ typescript when only one is configured. */
const LANGUAGE_ALIASES: Record<string, string[]> = {
  typescript: ['javascript'],
  javascript: ['typescript']
};

function lookupLanguageServer(
  languages: Record<string, ResolvedLspServerConfig>,
  languageId: string
): ResolvedLspServerConfig | null {
  const direct = languages[languageId];
  if (direct) return direct;
  for (const alias of LANGUAGE_ALIASES[languageId] ?? []) {
    const hit = languages[alias];
    if (hit) return hit;
  }
  return null;
}

/**
 * Resolve the stdio server for a buffer language. Falls back to the global
 * command when no per-language override exists.
 */
export function resolveLspServerForLanguage(
  merged: ResolvedLspConfig,
  languageId?: string | null
): ResolvedLspServerConfig | null {
  if (!merged.enabled) return null;
  const lang = (languageId ?? '').trim().toLowerCase();
  if (lang) {
    const perLang = lookupLanguageServer(merged.languages, lang);
    if (perLang) return perLang;
  }
  if (!merged.command) return null;
  return { command: merged.command, args: merged.args };
}

export function relayFingerprint(server: ResolvedLspServerConfig): string {
  if (server.bundledId) return `bundled:${server.bundledId}`;
  return `${server.command}\0${server.args.join('\0')}`;
}
