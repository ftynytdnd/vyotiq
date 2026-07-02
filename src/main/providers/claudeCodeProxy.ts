/**
 * Main-process helpers for the local claude-code-proxy bridge.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ModelInfo } from '@shared/types/provider.js';
import type { ProviderAccountSnapshot } from '@shared/types/providerAccount.js';
import type { ProviderWithKey } from '@shared/types/provider.js';
import { inputModalitiesFromModelId } from '@shared/providers/visionCapabilities.js';
import {
  CLAUDE_CODE_PROXY_NOTES_MARKER,
  CLAUDE_CODE_PROXY_PLACEHOLDER_KEY,
  CLAUDE_CODE_PROXY_RECOMMENDED_MODELS,
  CLAUDE_CODE_PROXY_UPSTREAM_PRESETS,
  claudeCodeProxyHealthUrl,
  defaultClaudeCodeProxyBaseUrl,
  filterClaudeCodeProxyModelsForUpstream,
  isClaudeCodeProxyBaseUrl,
  isClaudeCodeProxyProvider,
  parseClaudeCodeProxyModelsOutput,
  type ClaudeCodeProxyAction,
  type ClaudeCodeProxyActionResult,
  type ClaudeCodeProxyUpstreamId
} from '@shared/providers/claudeCodeProxy.js';
import { logger } from '../logging/logger.js';
import { getSettings, setSettings } from '../settings/settingsStore.js';

const log = logger.child('providers/claude-code-proxy');
const execFileAsync = promisify(execFile);

const PROXY_PROBE_TIMEOUT_MS = 4_000;
const PROXY_MODELS_TIMEOUT_MS = 30_000;
const PROXY_START_TIMEOUT_MS = 45_000;

export interface ClaudeCodeProxyStatusJson {
  proxy?: { healthy?: boolean; port?: number; version?: string };
  auth?: { valid?: boolean; expiresAt?: string; secondsLeft?: number };
  config?: { userEnvModel?: string; settingsModel?: string };
}

export interface ClaudeCodeProxyInstallPaths {
  installDir: string;
  proxyExe: string;
  startScript: string | null;
  statusScript: string | null;
}

/** Platform install paths (Windows integration + generic Unix layout). */
export function resolveClaudeCodeProxyInstallPaths(): ClaudeCodeProxyInstallPaths {
  const envDir = process.env.CCP_INSTALL_DIR?.trim();
  if (envDir) {
    return buildInstallPaths(envDir);
  }

  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA;
    if (base) return buildInstallPaths(join(base, 'cursor-claude-proxy'));
  }

  if (process.platform === 'darwin') {
    return buildInstallPaths(
      join(homedir(), 'Library', 'Application Support', 'cursor-claude-proxy')
    );
  }

  return buildInstallPaths(join(homedir(), '.local', 'share', 'cursor-claude-proxy'));
}

function buildInstallPaths(installDir: string): ClaudeCodeProxyInstallPaths {
  const exeName = process.platform === 'win32' ? 'claude-code-proxy.exe' : 'claude-code-proxy';
  const startName = process.platform === 'win32' ? 'start-proxy.ps1' : 'start-proxy.sh';
  const statusName = process.platform === 'win32' ? 'status.ps1' : 'status.sh';
  const startScript = join(installDir, startName);
  const statusScript = join(installDir, statusName);
  return {
    installDir,
    proxyExe: join(installDir, exeName),
    startScript: existsSync(startScript) ? startScript : null,
    statusScript: existsSync(statusScript) ? statusScript : null
  };
}

export function resolveClaudeCodeProxyExe(): string | null {
  const { proxyExe } = resolveClaudeCodeProxyInstallPaths();
  return existsSync(proxyExe) ? proxyExe : null;
}

export function isClaudeCodeProxyInstalled(): boolean {
  return resolveClaudeCodeProxyExe() !== null;
}

export async function probeClaudeCodeProxyHealthy(baseUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(claudeCodeProxyHealthUrl(baseUrl), {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { ok?: boolean };
    return json.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchClaudeCodeProxyStatusJson(): Promise<ClaudeCodeProxyStatusJson | null> {
  const { statusScript, proxyExe } = resolveClaudeCodeProxyInstallPaths();

  if (statusScript && process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-File', statusScript, '-Json'],
        { timeout: 15_000, windowsHide: true, maxBuffer: 512_000 }
      );
      return JSON.parse(stdout) as ClaudeCodeProxyStatusJson;
    } catch (err) {
      log.debug('status.ps1 failed', { err });
    }
  }

  if (statusScript && process.platform !== 'win32') {
    try {
      const { stdout } = await execFileAsync('sh', [statusScript, '-Json'], {
        timeout: 15_000,
        maxBuffer: 512_000
      });
      return JSON.parse(stdout) as ClaudeCodeProxyStatusJson;
    } catch (err) {
      log.debug('status.sh failed', { err });
    }
  }

  if (proxyExe && existsSync(proxyExe)) {
    try {
      await execFileAsync(proxyExe, ['cursor', 'auth', 'status'], {
        timeout: 10_000,
        maxBuffer: 64_000
      });
      return { auth: { valid: true } };
    } catch {
      return { auth: { valid: false } };
    }
  }

  return null;
}

let cachedFullCatalog: ModelInfo[] | null = null;
let cachedFullCatalogAt = 0;
const CATALOG_CACHE_MS = 60_000;

async function loadFullProxyCatalog(): Promise<ModelInfo[]> {
  if (cachedFullCatalog && Date.now() - cachedFullCatalogAt < CATALOG_CACHE_MS) {
    return cachedFullCatalog;
  }

  const baseUrl = defaultClaudeCodeProxyBaseUrl();
  const healthy = await probeClaudeCodeProxyHealthy(baseUrl);
  if (!healthy) {
    await ensureClaudeCodeProxyRunning();
  }

  const exe = resolveClaudeCodeProxyExe();
  if (exe) {
    try {
      const { stdout } = await execFileAsync(exe, ['models', '--full'], {
        timeout: PROXY_MODELS_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 4_000_000
      });
      const parsed = parseClaudeCodeProxyModelsOutput(stdout);
      if (parsed.length > 0) {
        cachedFullCatalog = parsed;
        cachedFullCatalogAt = Date.now();
        return parsed;
      }
    } catch (err) {
      log.warn('proxy models CLI failed', { err });
    }
  }

  const fallback: ModelInfo[] = CLAUDE_CODE_PROXY_RECOMMENDED_MODELS.map((m) => {
    const bareId = m.id.replace(/^cursor:/, '');
    const modalities = inputModalitiesFromModelId(bareId);
    return {
      id: m.id,
      label: m.label,
      contextWindow: m.contextWindow,
      contextEstimated: true,
      ...(modalities
        ? { inputModalities: modalities, inputModalitiesEstimated: true }
        : {}),
      ...(bareId.includes('thinking')
        ? {
            thinking: {
              supported: true,
              efforts: ['low', 'medium', 'high'] as const,
              wireStyle: 'anthropic'
            }
          }
        : {})
    };
  });
  cachedFullCatalog = fallback;
  cachedFullCatalogAt = Date.now();
  return fallback;
}

export async function fetchClaudeCodeProxyModels(
  provider: ProviderWithKey
): Promise<ModelInfo[]> {
  if (!isClaudeCodeProxyProvider(provider)) {
    throw new Error('Not a claude-code-proxy provider');
  }

  const healthy = await probeClaudeCodeProxyHealthy(provider.baseUrl);
  if (!healthy) {
    await ensureClaudeCodeProxyRunning();
    const retry = await probeClaudeCodeProxyHealthy(provider.baseUrl);
    if (!retry) {
      throw new Error(
        'Local proxy is not running. Start it with ccp start or reinstall the integration.'
      );
    }
  }

  const full = await loadFullProxyCatalog();
  const upstream = upstreamIdFromProvider(provider);
  if (upstream) {
    return filterClaudeCodeProxyModelsForUpstream(full, upstream);
  }
  return full;
}

function upstreamIdFromProvider(provider: ProviderWithKey): ClaudeCodeProxyUpstreamId | null {
  const preset = CLAUDE_CODE_PROXY_UPSTREAM_PRESETS.find((p) => p.name === provider.name);
  return preset?.id ?? null;
}

export async function ensureClaudeCodeProxyRunning(): Promise<boolean> {
  if (!isClaudeCodeProxyInstalled()) return false;

  const baseUrl = defaultClaudeCodeProxyBaseUrl();
  if (await probeClaudeCodeProxyHealthy(baseUrl)) return true;

  if (proxyStartInFlight) return proxyStartInFlight;

  proxyStartInFlight = startClaudeCodeProxyProcess(baseUrl).finally(() => {
    proxyStartInFlight = null;
  });
  return proxyStartInFlight;
}

let proxyStartInFlight: Promise<boolean> | null = null;

async function startClaudeCodeProxyProcess(baseUrl: string): Promise<boolean> {
  const { startScript, proxyExe } = resolveClaudeCodeProxyInstallPaths();

  log.info('starting claude-code-proxy');
  try {
    if (startScript && process.platform === 'win32') {
      await execFileAsync('powershell.exe', ['-NoProfile', '-File', startScript], {
        timeout: PROXY_START_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 256_000
      });
    } else if (startScript) {
      await execFileAsync('sh', [startScript], {
        timeout: PROXY_START_TIMEOUT_MS,
        maxBuffer: 256_000
      });
    } else if (proxyExe && existsSync(proxyExe)) {
      await execFileAsync(proxyExe, ['serve'], {
        timeout: 5_000,
        windowsHide: true,
        maxBuffer: 64_000
      });
    } else {
      log.warn('no start script or proxy binary');
      return false;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message.split('\n')[0]?.trim() : String(err);
    log.warn('proxy start failed (may still be running)', { message });
  }

  return probeClaudeCodeProxyHealthy(baseUrl);
}

export async function fetchClaudeCodeProxyAccount(
  provider: ProviderWithKey
): Promise<ProviderAccountSnapshot> {
  const base: ProviderAccountSnapshot = {
    providerId: provider.id,
    fetchedAt: Date.now(),
    status: 'ok',
    hostKind: 'claude-code-proxy'
  };

  const healthy = await probeClaudeCodeProxyHealthy(provider.baseUrl);
  if (!healthy) {
    return {
      ...base,
      status: 'error',
      message: 'Local proxy offline — run ccp start or check Task Scheduler.'
    };
  }

  const status = await fetchClaudeCodeProxyStatusJson();
  const version = status?.proxy?.version ?? 'claude-code-proxy';
  const authValid = status?.auth?.valid === true;
  const expiresAt = status?.auth?.expiresAt;
  const defaultModel =
    status?.config?.userEnvModel ?? status?.config?.settingsModel ?? undefined;

  const parts: string[] = [version, 'healthy'];
  if (authValid && expiresAt) {
    parts.push(`auth until ${formatShortDate(expiresAt)}`);
  } else if (authValid) {
    parts.push('auth valid');
  } else {
    parts.push('auth expired — run ccp login');
  }
  if (defaultModel) parts.push(`default ${defaultModel}`);

  return {
    ...base,
    planLabel: 'Local subscription proxy',
    message: parts.join(' · ')
  };
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export async function runClaudeCodeProxyAction(
  action: ClaudeCodeProxyAction
): Promise<ClaudeCodeProxyActionResult> {
  if (!isClaudeCodeProxyInstalled()) {
    return {
      ok: false,
      message: 'Local proxy is not installed. Run the Cursor-Claude-Proxy integration first.'
    };
  }

  const baseUrl = defaultClaudeCodeProxyBaseUrl();

  if (action === 'start') {
    const healthy = await ensureClaudeCodeProxyRunning();
    const status = await fetchClaudeCodeProxyStatusJson();
    return {
      ok: healthy,
      healthy,
      authValid: status?.auth?.valid === true,
      message: healthy
        ? 'Local proxy is running.'
        : 'Could not start the local proxy. Check Task Scheduler or run ccp start manually.'
    };
  }

  if (action === 'login') {
    const { installDir } = resolveClaudeCodeProxyInstallPaths();
    const loginScript =
      process.platform === 'win32'
        ? join(installDir, 'cursor-oauth-login.ps1')
        : join(installDir, 'cursor-oauth-login.sh');
    if (!existsSync(loginScript)) {
      return {
        ok: false,
        message: 'OAuth login script not found in the proxy install directory.'
      };
    }
    try {
      if (process.platform === 'win32') {
        await execFileAsync('powershell.exe', ['-NoProfile', '-File', loginScript], {
          timeout: 120_000,
          windowsHide: false,
          maxBuffer: 512_000
        });
      } else {
        await execFileAsync('sh', [loginScript], {
          timeout: 120_000,
          maxBuffer: 512_000
        });
      }
    } catch (err) {
      log.warn('oauth login script failed', { err });
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err)
      };
    }
    const status = await fetchClaudeCodeProxyStatusJson();
    const authValid = status?.auth?.valid === true;
    return {
      ok: authValid,
      healthy: await probeClaudeCodeProxyHealthy(baseUrl),
      authValid,
      message: authValid
        ? 'Proxy authentication succeeded.'
        : 'Login finished but auth is still invalid — retry or check proxy logs.'
    };
  }

  const healthy = await probeClaudeCodeProxyHealthy(baseUrl);
  const status = await fetchClaudeCodeProxyStatusJson();
  const authValid = status?.auth?.valid === true;
  return {
    ok: healthy && authValid,
    healthy,
    authValid,
    message: healthy
      ? authValid
        ? 'Local proxy is healthy and authenticated.'
        : 'Local proxy is running but auth expired.'
      : 'Local proxy is offline.'
  };
}

export { isClaudeCodeProxyBaseUrl, isClaudeCodeProxyProvider };

function buildProviderNotes(suffix: string): string {
  return `${CLAUDE_CODE_PROXY_NOTES_MARKER} on localhost. ${suffix}`;
}

/** Sync settings.defaultModel from proxy config when unset. */
export async function syncClaudeCodeProxyDefaultModel(
  listProviders: () => Promise<Array<{ id: string; name: string; enabled: boolean; models?: ModelInfo[] }>>
): Promise<void> {
  const settings = await getSettings();
  if (settings.defaultModel) return;

  const status = await fetchClaudeCodeProxyStatusJson();
  const modelId =
    status?.config?.userEnvModel ?? status?.config?.settingsModel ?? 'cursor:composer-2.5';

  const providers = await listProviders();
  const cursorProvider =
    providers.find((p) => p.name === 'Local subscription proxy' && p.enabled) ??
    providers.find((p) => p.enabled && p.models?.some((m) => m.id === modelId));

  if (!cursorProvider?.models?.some((m) => m.id === modelId)) return;

  await setSettings({
    defaultModel: { providerId: cursorProvider.id, modelId }
  });
  log.info('synced default model from proxy', { providerId: cursorProvider.id, modelId });
}

/** Bootstrap provider records when the proxy is installed but not yet configured. */
export async function bootstrapClaudeCodeProxyProvider(
  listProviders: () => Promise<Array<{ id: string; baseUrl: string; name: string }>>,
  addProvider: (input: {
    name: string;
    baseUrl: string;
    apiKey: string;
    dialect: 'anthropic-native';
    notes?: string;
  }) => Promise<{ id: string }>,
  discoverModels: (providerId: string, force: boolean) => Promise<ModelInfo[]>
): Promise<string[]> {
  if (!isClaudeCodeProxyInstalled()) return [];

  const existing = await listProviders();
  const baseUrl = defaultClaudeCodeProxyBaseUrl();
  const createdIds: string[] = [];

  await ensureClaudeCodeProxyRunning();

  for (const preset of CLAUDE_CODE_PROXY_UPSTREAM_PRESETS) {
    if (existing.some((p) => p.name === preset.name && isClaudeCodeProxyBaseUrl(p.baseUrl))) {
      continue;
    }

    const created = await addProvider({
      name: preset.name,
      baseUrl,
      apiKey: CLAUDE_CODE_PROXY_PLACEHOLDER_KEY,
      dialect: 'anthropic-native',
      notes: buildProviderNotes(preset.notesSuffix)
    });

    try {
      await discoverModels(created.id, true);
    } catch (err) {
      log.warn('bootstrap model discovery failed', { preset: preset.id, err });
    }

    createdIds.push(created.id);
    log.info('bootstrapped claude-code-proxy provider', {
      providerId: created.id,
      upstream: preset.id
    });
  }

  if (createdIds.length > 0) {
    await syncClaudeCodeProxyDefaultModel(async () => {
      const rows = await listProviders();
      return rows.map((p) => ({ id: p.id, name: p.name, enabled: true }));
    });
  }

  return createdIds;
}
