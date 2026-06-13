/**
 * Per-workspace LSP overrides from `.vyotiq/lsp.json`.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../logging/logger.js';

const log = logger.child('lsp/workspaceConfig');

export interface LspWorkspaceConfig {
  enabled?: boolean;
  command?: string;
  args?: string[];
}

export interface ResolvedLspConfig {
  enabled: boolean;
  command: string;
  args: string[];
  source: 'global' | 'workspace' | 'disabled';
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
  global: { enabled?: boolean; command?: string; args?: string[] } | undefined,
  workspace: LspWorkspaceConfig | null
): ResolvedLspConfig {
  const ws = workspace ?? {};
  const enabled = ws.enabled ?? global?.enabled === true;
  const command = (ws.command ?? global?.command ?? '').trim();
  const args = Array.isArray(ws.args)
    ? ws.args
    : Array.isArray(global?.args)
      ? global.args
      : ['--stdio'];
  const source: ResolvedLspConfig['source'] = !enabled
    ? 'disabled'
    : workspace && (workspace.enabled !== undefined || workspace.command || workspace.args)
      ? 'workspace'
      : 'global';
  return { enabled, command, args, source };
}
