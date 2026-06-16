/**
 * Resolve LSP stdio server binaries — Windows .cmd shims, PATH enrichment, auto-detect.
 */

import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ResolvedLspServerConfig } from './lspWorkspaceConfig.js';

const execFileAsync = promisify(execFile);

const LANGUAGE_CANDIDATES: Record<string, string[]> = {
  python: ['pylsp', 'pyright-langserver', 'basedpyright-langserver', 'python'],
  typescript: ['typescript-language-server'],
  javascript: ['typescript-language-server'],
  rust: ['rust-analyzer'],
  go: ['gopls']
};

const PYTHON_MODULE_CANDIDATES: Array<{ command: string; args: string[] }> = [
  { command: 'python', args: ['-m', 'pylsp'] },
  { command: 'py', args: ['-m', 'pylsp'] },
  { command: 'python', args: ['-m', 'pyright.langserver', '--stdio'] },
  { command: 'py', args: ['-m', 'pyright.langserver', '--stdio'] }
];

function pathDelimiter(): string {
  return process.platform === 'win32' ? ';' : ':';
}

/** Enrich PATH for Electron main — npm global + Python Scripts. */
export function enrichLspPathEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const extra: string[] = [];
  const appData = env.APPDATA;
  const localAppData = env.LOCALAPPDATA;
  const userProfile = env.USERPROFILE ?? homedir();

  if (appData) extra.push(join(appData, 'npm'));
  if (localAppData) {
    extra.push(join(localAppData, 'Programs', 'Python', 'Python313', 'Scripts'));
    extra.push(join(localAppData, 'Programs', 'Python', 'Python312', 'Scripts'));
    extra.push(join(localAppData, 'Programs', 'Python', 'Python311', 'Scripts'));
  }
  extra.push(join(userProfile, '.local', 'bin'));

  const current = env.PATH ?? env.Path ?? '';
  const merged = [...extra, ...current.split(pathDelimiter())]
    .map((p) => p.trim())
    .filter(Boolean);
  const unique = [...new Set(merged)];
  return { ...env, PATH: unique.join(pathDelimiter()) };
}

async function fileExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return process.platform === 'win32';
  }
}

async function whereOnPath(command: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  if (process.platform !== 'win32') {
    return null;
  }
  try {
    const { stdout } = await execFileAsync('where.exe', [command], {
      env,
      windowsHide: true,
      timeout: 5_000
    });
    const line = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    return line ?? null;
  } catch {
    return null;
  }
}

export interface LspSpawnSpec {
  file: string;
  argv: string[];
  env: NodeJS.ProcessEnv;
  shell: boolean;
}

/**
 * Build a spawn spec that works for npm `.cmd` shims and bare names on Windows.
 */
export async function buildLspSpawnSpec(
  server: ResolvedLspServerConfig,
  workspaceRoot: string
): Promise<LspSpawnSpec> {
  void workspaceRoot;

  if (server.electronNode) {
    const env = enrichLspPathEnv({
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_NO_ATTACH_CONSOLE: '1'
    });
    return {
      file: server.command,
      argv: server.args,
      env,
      shell: false
    };
  }

  const env = enrichLspPathEnv();

  if (process.platform === 'win32') {
    const located = await whereOnPath(server.command, env);
    if (located && (await fileExecutable(located))) {
      const comspec = env.ComSpec ?? 'cmd.exe';
      const cmdLine = [located, ...server.args]
        .map((part) => (/\s/.test(part) ? `"${part}"` : part))
        .join(' ');
      return {
        file: comspec,
        argv: ['/d', '/s', '/c', cmdLine],
        env,
        shell: false
      };
    }
    const comspec = env.ComSpec ?? 'cmd.exe';
    const cmdLine = [server.command, ...server.args]
      .map((part) => (/\s/.test(part) ? `"${part}"` : part))
      .join(' ');
    return {
      file: comspec,
      argv: ['/d', '/s', '/c', cmdLine],
      env,
      shell: false
    };
  }

  return {
    file: server.command,
    argv: server.args,
    env,
    shell: false
  };
}

async function probeCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<ResolvedLspServerConfig | null> {
  if (process.platform === 'win32') {
    const located = await whereOnPath(command, env);
    if (located) {
      return { command, args };
    }
    return null;
  }
  try {
    await access(command, constants.X_OK);
    return { command, args };
  } catch {
    const located = await whereOnPath(command, env);
    if (located) return { command, args };
    return null;
  }
}

export async function autoDetectLspServer(languageId: string): Promise<ResolvedLspServerConfig | null> {
  const lang = languageId.trim().toLowerCase();
  if (!lang || lang === 'plaintext') return null;

  const env = enrichLspPathEnv();
  const names = LANGUAGE_CANDIDATES[lang] ?? [];
  for (const name of names) {
    if (name === 'python') continue;
    const hit = await probeCommand(name, ['--stdio'], env);
    if (hit) return hit;
  }

  if (lang === 'python') {
    for (const mod of PYTHON_MODULE_CANDIDATES) {
      const hit = await probeCommand(mod.command, mod.args, env);
      if (hit) return hit;
    }
    for (const name of LANGUAGE_CANDIDATES.python ?? []) {
      if (name === 'python') continue;
      const hit = await probeCommand(name, ['--stdio'], env);
      if (hit) return hit;
    }
  }

  return null;
}
