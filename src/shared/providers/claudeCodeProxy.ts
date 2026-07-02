/**
 * claude-code-proxy (local Anthropic bridge) — shared constants and URL helpers.
 */

import type { ModelInfo } from '../types/provider.js';

/** Default loopback port for claude-code-proxy. */
export const CLAUDE_CODE_PROXY_DEFAULT_PORT = 18765;

/**
 * Mid-stream inactivity budget for claude-code-proxy providers.
 *
 * Composer / Codex upstream can go silent for well over 60s while
 * thinking without emitting SSE bytes. The default transport timeout
 * aborts those runs; proxy providers use this longer budget instead.
 */
export const CLAUDE_CODE_PROXY_STREAM_INACTIVITY_MS = 180_000;

/** Placeholder API key accepted by the local proxy. */
export const CLAUDE_CODE_PROXY_PLACEHOLDER_KEY = 'cursor-proxy';

/** Marker in provider notes for loopback proxy providers (any port). */
export const CLAUDE_CODE_PROXY_NOTES_MARKER = 'claude-code-proxy';

/** Upstream presets bootstrapped as separate providers (same base URL, filtered models). */
export const CLAUDE_CODE_PROXY_UPSTREAM_PRESETS = [
  {
    id: 'cursor',
    name: 'Local subscription proxy',
    notesSuffix: 'Cursor Agent models (cursor:, cursor-plan:, cursor-ask:).'
  },
  {
    id: 'codex',
    name: 'Local subscription proxy (Codex)',
    notesSuffix: 'ChatGPT / Codex models via the same local bridge.'
  },
  {
    id: 'kimi',
    name: 'Local subscription proxy (Kimi)',
    notesSuffix: 'Kimi models via the same local bridge.'
  }
] as const;

export type ClaudeCodeProxyUpstreamId = (typeof CLAUDE_CODE_PROXY_UPSTREAM_PRESETS)[number]['id'];

/** Picker subsection labels for proxy catalog model ids. */
export const CLAUDE_CODE_PROXY_MODEL_SECTIONS = [
  { id: 'agent', label: 'Agent' },
  { id: 'plan', label: 'Plan' },
  { id: 'ask', label: 'Ask' },
  { id: 'codex', label: 'Codex' },
  { id: 'kimi', label: 'Kimi' }
] as const;

export type ClaudeCodeProxyModelSectionId =
  (typeof CLAUDE_CODE_PROXY_MODEL_SECTIONS)[number]['id'];

/** Recommended models surfaced first in the picker (Pro+ friendly). */
export const CLAUDE_CODE_PROXY_RECOMMENDED_MODELS: readonly {
  id: string;
  label: string;
  contextWindow?: number;
}[] = [
  { id: 'cursor:composer-2.5', label: 'Composer 2.5', contextWindow: 200_000 },
  { id: 'cursor:composer-2.5-fast', label: 'Composer 2.5 Fast', contextWindow: 200_000 },
  { id: 'cursor:gpt-5.3-codex-high-fast', label: 'GPT 5.3 Codex High Fast', contextWindow: 200_000 },
  { id: 'cursor:claude-opus-4-8-thinking-high', label: 'Claude Opus 4.8 Thinking High', contextWindow: 200_000 },
  { id: 'cursor:gpt-5.5-high', label: 'GPT 5.5 High', contextWindow: 200_000 }
] as const;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Resolve listen port: process PORT, then default 18765. */
export function resolveClaudeCodeProxyPort(): number {
  const raw = process.env.PORT?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && n <= 65535) return n;
  }
  return CLAUDE_CODE_PROXY_DEFAULT_PORT;
}

/** Default base URL without trailing slash. */
export function defaultClaudeCodeProxyBaseUrl(port?: number): string {
  const p = port ?? resolveClaudeCodeProxyPort();
  return `http://127.0.0.1:${p}`;
}

/** Health probe path (GET, no auth). */
export function claudeCodeProxyHealthUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/healthz`;
}

export function isClaudeCodeProxyNotes(notes: string | undefined): boolean {
  return Boolean(notes?.includes(CLAUDE_CODE_PROXY_NOTES_MARKER));
}

/**
 * True when the base URL targets the local claude-code-proxy listener.
 * Matches loopback on the resolved/default port, or any loopback URL whose
 * notes carry the proxy marker (custom port in provider settings).
 */
export function isClaudeCodeProxyBaseUrl(baseUrl: string, notes?: string): boolean {
  if (isClaudeCodeProxyNotes(notes)) {
    try {
      return LOCAL_HOSTS.has(new URL(baseUrl.trim()).hostname.toLowerCase());
    } catch {
      return false;
    }
  }
  try {
    const parsed = new URL(baseUrl.trim());
    const host = parsed.hostname.toLowerCase();
    if (!LOCAL_HOSTS.has(host)) return false;
    const port =
      parsed.port.length > 0 ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
    return port === resolveClaudeCodeProxyPort() || port === CLAUDE_CODE_PROXY_DEFAULT_PORT;
  } catch {
    return false;
  }
}

export function isClaudeCodeProxyProvider(provider: {
  baseUrl: string;
  notes?: string;
}): boolean {
  return isClaudeCodeProxyBaseUrl(provider.baseUrl, provider.notes);
}

/** Section id for grouped model picker (Agent / Plan / Ask / Codex / Kimi). */
export function claudeCodeProxyModelSection(modelId: string): ClaudeCodeProxyModelSectionId {
  if (modelId.startsWith('cursor-plan:')) return 'plan';
  if (modelId.startsWith('cursor-ask:')) return 'ask';
  if (modelId.startsWith('cursor:')) return 'agent';
  if (modelId.startsWith('codex:')) return 'codex';
  if (modelId.startsWith('kimi:')) return 'kimi';
  return 'agent';
}

/** Filter full catalog to one upstream preset. */
export function filterClaudeCodeProxyModelsForUpstream(
  models: ModelInfo[],
  upstream: ClaudeCodeProxyUpstreamId
): ModelInfo[] {
  switch (upstream) {
    case 'cursor':
      return models.filter(
        (m) =>
          m.id.startsWith('cursor:') ||
          m.id.startsWith('cursor-plan:') ||
          m.id.startsWith('cursor-ask:')
      );
    case 'codex':
      return models.filter((m) => m.id.startsWith('codex:'));
    case 'kimi':
      return models.filter((m) => m.id.startsWith('kimi:'));
    default:
      return models;
  }
}

/** Group models into ordered sections for the picker. */
export function groupClaudeCodeProxyModels(
  models: ModelInfo[]
): Array<{ section: ClaudeCodeProxyModelSectionId; label: string; models: ModelInfo[] }> {
  const buckets = new Map<ClaudeCodeProxyModelSectionId, ModelInfo[]>();
  for (const m of models) {
    const section = claudeCodeProxyModelSection(m.id);
    const list = buckets.get(section) ?? [];
    list.push(m);
    buckets.set(section, list);
  }
  const out: Array<{ section: ClaudeCodeProxyModelSectionId; label: string; models: ModelInfo[] }> =
    [];
  for (const { id, label } of CLAUDE_CODE_PROXY_MODEL_SECTIONS) {
    const list = buckets.get(id);
    if (list && list.length > 0) {
      out.push({
        section: id,
        label,
        models: [...list].sort((a, b) => a.id.localeCompare(b.id))
      });
    }
  }
  return out;
}

/** Parse `claude-code-proxy models --full` stdout into ModelInfo rows. */
export function parseClaudeCodeProxyModelsOutput(stdout: string): ModelInfo[] {
  const ids = new Set<string>();
  const models: ModelInfo[] = [];

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx <= 0) continue;

    const groupPrefix = trimmed.slice(0, colonIdx).trim();
    const rest = trimmed.slice(colonIdx + 1).trim();
    if (rest.length === 0) continue;

    for (const raw of rest.split(',')) {
      const token = raw.trim();
      if (token.length === 0) continue;
      const id = normalizeClaudeCodeProxyCatalogId(groupPrefix, token);
      if (!id || ids.has(id)) continue;
      ids.add(id);
      models.push({ id });
    }
  }

  applyRecommendedLabels(models);
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeClaudeCodeProxyCatalogId(groupPrefix: string, token: string): string {
  if (token.includes(':')) return token;
  return `${groupPrefix}:${token}`;
}

function applyRecommendedLabels(models: ModelInfo[]): void {
  const labelById = new Map(
    CLAUDE_CODE_PROXY_RECOMMENDED_MODELS.map((m) => [m.id, m.label] as const)
  );
  const ctxById = new Map(
    CLAUDE_CODE_PROXY_RECOMMENDED_MODELS.map((m) => [m.id, m.contextWindow] as const)
  );
  for (const m of models) {
    const label = labelById.get(m.id);
    if (label) m.label = label;
    const ctx = ctxById.get(m.id);
    if (ctx !== undefined) {
      m.contextWindow = ctx;
      m.contextEstimated = true;
    }
  }
}

/** True when Anthropic beta headers are safe for this proxy-routed model id. */
export function claudeCodeProxyModelSupportsAnthropicBetas(modelId: string): boolean {
  return /claude/i.test(modelId);
}

const PROXY_AUTO_MODEL_FALLBACKS: Readonly<Record<string, string>> = {
  'cursor:auto': 'cursor:composer-2.5',
  'cursor-ask:auto': 'cursor-ask:composer-2.5',
  'cursor-plan:auto': 'cursor-plan:composer-2.5'
};

/**
 * Resolve proxy catalog aliases that Cursor rejects at runtime (e.g.
 * `cursor-ask:auto` → concrete model). Uses the proxy's configured default
 * when it matches the channel prefix; otherwise falls back to Composer 2.5.
 */
export function resolveClaudeCodeProxyModelId(
  modelId: string,
  defaultModel?: string
): string {
  const trimmed = modelId.trim();
  if (!trimmed.endsWith(':auto')) return trimmed;

  const channelPrefix = trimmed.slice(0, trimmed.lastIndexOf(':'));
  const configured = defaultModel?.trim();
  if (configured && !configured.endsWith(':auto')) {
    if (configured.startsWith(`${channelPrefix}:`)) return configured;
    if (channelPrefix === 'cursor' && configured.startsWith('cursor:')) return configured;
  }

  return PROXY_AUTO_MODEL_FALLBACKS[trimmed] ?? trimmed;
}

/** Proxy models encode effort in the id (-high, -thinking, etc.) — omit wire effort. */
export function claudeCodeProxySkipsThinkingEffort(): boolean {
  return true;
}

export type ClaudeCodeProxyAction = 'start' | 'login' | 'refresh';

export interface ClaudeCodeProxyActionResult {
  ok: boolean;
  message: string;
  healthy?: boolean;
  authValid?: boolean;
}

export function claudeCodeProxyAuthExpiredMessage(message: string | undefined): boolean {
  return Boolean(message?.toLowerCase().includes('auth expired'));
}

export function claudeCodeProxyOfflineMessage(message: string | undefined): boolean {
  return Boolean(message?.toLowerCase().includes('offline'));
}

/** Short composer banner label for proxy problems (full snapshot message stays in title). */
export function composerProxyBannerLabel(
  message: string | undefined,
  status?: string
): string | null {
  if (!message) return null;
  if (status === 'error' || claudeCodeProxyOfflineMessage(message)) {
    return 'Local proxy offline';
  }
  if (claudeCodeProxyAuthExpiredMessage(message)) {
    return 'Proxy sign-in expired';
  }
  return null;
}

/** Compact one-line proxy summary for pickers and settings lists. */
export function formatClaudeCodeProxyAccountLine(snapshot: {
  status?: string;
  message?: string;
  planLabel?: string;
}): string | null {
  const banner = composerProxyBannerLabel(snapshot.message, snapshot.status);
  if (banner) return banner;
  return snapshot.planLabel ?? null;
}
