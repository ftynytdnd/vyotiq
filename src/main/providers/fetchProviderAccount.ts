/**
 * Fetch live provider account / billing snapshots from upstream APIs.
 * Host-aware routing — each adapter uses documented endpoints where available.
 */

import {
  PROVIDER_ACCOUNT_TIMEOUT_MS
} from '@shared/constants.js';
import {
  classifyProviderHost,
  defaultDashboardUrl,
  type ProviderHostKind
} from '@shared/providers/providerHostKind.js';
import type { ProviderAccountSnapshot } from '@shared/types/providerAccount.js';
import type { ProviderWithKey } from '@shared/types/provider.js';
import { buildAttributionHeaders } from './attributionHeaders.js';
import {
  getProviderRateLimits,
  recordProviderRateLimits
} from './providerRateLimitCapture.js';

const XAI_MANAGEMENT_API_BASE = 'https://management-api.x.ai';
import { safeText } from './errorBody.js';
import { logger } from '../logging/logger.js';

const log = logger.child('providers/account-fetch');

/** Concurrent account fetches per provider share one in-flight promise. */
const inFlight = new Map<string, Promise<ProviderAccountSnapshot>>();

export async function fetchProviderAccount(
  provider: ProviderWithKey,
  signal?: AbortSignal
): Promise<ProviderAccountSnapshot> {
  const existing = inFlight.get(provider.id);
  if (existing) return existing;

  const flight = fetchProviderAccountInner(provider, signal).finally(() => {
    if (inFlight.get(provider.id) === flight) inFlight.delete(provider.id);
  });
  inFlight.set(provider.id, flight);
  return flight;
}

async function fetchProviderAccountInner(
  provider: ProviderWithKey,
  signal?: AbortSignal
): Promise<ProviderAccountSnapshot> {
  const kind = classifyProviderHost(provider);
  const base: ProviderAccountSnapshot = {
    providerId: provider.id,
    fetchedAt: Date.now(),
    status: 'ok',
    hostKind: kind,
    dashboardUrl: defaultDashboardUrl(kind)
  };

  if (kind === 'local') {
    return { ...base, status: 'local', message: 'Local provider — no cloud billing.' };
  }

  try {
    switch (kind) {
      case 'openrouter':
        return finalize(await fetchOpenRouterAccount(provider, base, signal));
      case 'deepseek':
        return finalize(await fetchDeepSeekAccount(provider, base, signal));
      case 'openai':
        return finalize(await fetchOpenAiAccount(provider, base, signal));
      case 'anthropic':
        return finalize(await fetchAnthropicAccount(provider, base, signal));
      case 'together':
        return finalize(await fetchTogetherAccount(provider, base, signal));
      case 'xai':
        return finalize(await fetchXaiAccount(provider, base, signal));
      case 'gemini':
      case 'groq':
      case 'mistral':
      case 'nvidia':
      case 'ollama-cloud':
      case 'generic':
        return finalize(await fetchRateLimitFallback(provider, base, kind, signal));
      default:
        return finalize(await fetchRateLimitFallback(provider, base, kind, signal));
    }
  } catch (err) {
    return {
      ...base,
      status: 'error',
      message: err instanceof Error ? err.message : String(err)
    };
  }
}

function finalize(snapshot: ProviderAccountSnapshot): ProviderAccountSnapshot {
  if (snapshot.status === 'error' && snapshot.message) {
    log.warn('provider account snapshot error', {
      providerId: snapshot.providerId,
      hostKind: snapshot.hostKind,
      message: snapshot.message
    });
  }
  const resetAt = snapshot.limits?.resetAt;
  if (resetAt !== undefined && !snapshot.resetsAt?.length) {
    return { ...snapshot, resetsAt: [resetAt] };
  }
  return snapshot;
}

function usdCentsStringToUsd(val: unknown): number | undefined {
  if (val === null || val === undefined) return undefined;
  const n = typeof val === 'string' ? Number(val) : typeof val === 'number' ? val : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.abs(n) / 100;
}

function billingKey(provider: ProviderWithKey): string {
  return provider.billingApiKey?.trim() || provider.apiKey;
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal
): Promise<{ ok: boolean; status: number; json: unknown; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_ACCOUNT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    const body = await safeText(res);
    let json: unknown = null;
    try {
      json = body ? JSON.parse(body) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, body };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function fetchOpenRouterAccount(
  provider: ProviderWithKey,
  base: ProviderAccountSnapshot,
  signal?: AbortSignal
): Promise<ProviderAccountSnapshot> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...buildAttributionHeaders(provider)
  };
  const inferenceKey = provider.apiKey?.trim();
  if (inferenceKey) headers.Authorization = `Bearer ${inferenceKey}`;

  const res = await fetchJson(`${provider.baseUrl}/v1/key`, headers, signal);
  if (!res.ok) {
    return {
      ...base,
      status: res.status === 401 || res.status === 403 ? 'error' : 'unavailable',
      message: res.ok ? undefined : `OpenRouter account API returned HTTP ${res.status}`
    };
  }

  const data = (res.json as { data?: Record<string, unknown> } | null)?.data;
  if (!data) return { ...base, status: 'unavailable', message: 'Unexpected OpenRouter response' };

  let referenceBalanceUsd: number | undefined;
  let managementKeyRequired = false;
  const creditsHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...buildAttributionHeaders(provider)
  };
  const creditsKey = provider.billingApiKey?.trim() || inferenceKey;
  if (creditsKey) creditsHeaders.Authorization = `Bearer ${creditsKey}`;
  const creditsRes = await fetchJson(`${provider.baseUrl}/v1/credits`, creditsHeaders, signal);
  if (creditsRes.ok) {
    const creditsData = (creditsRes.json as { data?: Record<string, unknown> } | null)?.data;
    const totalCredits =
      typeof creditsData?.total_credits === 'number' ? creditsData.total_credits : undefined;
    if (totalCredits !== undefined) referenceBalanceUsd = totalCredits;
  } else if (creditsRes.status === 403) {
    managementKeyRequired = true;
  }

  const limitRemaining =
    typeof data.limit_remaining === 'number' ? data.limit_remaining : undefined;
  const usage = typeof data.usage === 'number' ? data.usage : undefined;
  const usageDaily = typeof data.usage_daily === 'number' ? data.usage_daily : undefined;
  const usageWeekly = typeof data.usage_weekly === 'number' ? data.usage_weekly : undefined;
  const usageMonthly = typeof data.usage_monthly === 'number' ? data.usage_monthly : undefined;
  const isFreeTier = data.is_free_tier === true;

  const balanceUsd =
    limitRemaining !== null && limitRemaining !== undefined
      ? limitRemaining
      : undefined;

  return {
    ...base,
    planLabel: isFreeTier ? 'Free tier' : 'Credits',
    tierLabel: typeof data.label === 'string' ? data.label : undefined,
    balanceUsd,
    referenceBalanceUsd,
    balanceAvailable: balanceUsd === undefined ? true : balanceUsd > 0,
    currency: 'USD',
    managementKeyRequired: managementKeyRequired || undefined,
    message: managementKeyRequired
      ? 'Add an OpenRouter Management key in Settings for account-wide credits.'
      : undefined,
    usage: {
      daily: usageDaily !== undefined ? { spendUsd: usageDaily, label: 'Today' } : undefined,
      weekly: usageWeekly !== undefined ? { spendUsd: usageWeekly, label: 'This week' } : undefined,
      monthly: usageMonthly !== undefined ? { spendUsd: usageMonthly, label: 'This month' } : undefined,
      allTime: usage !== undefined ? { spendUsd: usage, label: 'All time' } : undefined
    }
  };
}

async function fetchDeepSeekAccount(
  provider: ProviderWithKey,
  base: ProviderAccountSnapshot,
  signal?: AbortSignal
): Promise<ProviderAccountSnapshot> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const key = billingKey(provider);
  if (key) headers.Authorization = `Bearer ${key}`;

  const res = await fetchJson(`${provider.baseUrl}/user/balance`, headers, signal);
  if (!res.ok) {
    return {
      ...base,
      status: res.status === 401 ? 'error' : 'unavailable',
      message: `DeepSeek balance API returned HTTP ${res.status}`
    };
  }

  const root = res.json as {
    is_available?: boolean;
    balance_infos?: Array<{
      currency?: string;
      total_balance?: string;
      granted_balance?: string;
      topped_up_balance?: string;
    }>;
  };

  const info = root.balance_infos?.[0];
  const total = info?.total_balance ? Number(info.total_balance) : undefined;
  const currency = info?.currency ?? 'USD';
  const isUsd = currency.toUpperCase() === 'USD';

  return {
    ...base,
    planLabel: 'Pay-as-you-go',
    balanceUsd: isUsd && Number.isFinite(total) ? total : undefined,
    balanceNative: Number.isFinite(total) ? total : undefined,
    balanceAvailable: root.is_available ?? (total !== undefined ? total > 0 : undefined),
    currency
  };
}

async function fetchOpenAiAccount(
  provider: ProviderWithKey,
  base: ProviderAccountSnapshot,
  signal?: AbortSignal
): Promise<ProviderAccountSnapshot> {
  const key = billingKey(provider);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;

  // Undocumented but widely used credit-grants endpoint (regular API key).
  const grants = await fetchJson(
    `${provider.baseUrl}/v1/dashboard/billing/credit_grants`,
    headers,
    signal
  );
  if (grants.ok) {
    const g = grants.json as {
      total_granted?: number;
      total_used?: number;
      total_available?: number;
      grants?: Array<{ grant_amount?: number; used_amount?: number; expires_at?: number }>;
    };
    const available =
      typeof g.total_available === 'number'
        ? g.total_available
        : typeof g.total_granted === 'number' && typeof g.total_used === 'number'
          ? g.total_granted - g.total_used
          : undefined;
    const used = typeof g.total_used === 'number' ? g.total_used : undefined;

    const usage = await fetchOpenAiAdminUsage(provider, headers, signal);
    return {
      ...base,
      planLabel: 'API credits',
      balanceUsd: available,
      balanceAvailable: available === undefined ? undefined : available > 0,
      currency: 'USD',
      usage: {
        allTime: used !== undefined ? { spendUsd: used, label: 'Used' } : undefined,
        weekly: usage?.weekly
      }
    };
  }

  // Admin API: spend only (no remaining balance).
  if (key.startsWith('sk-admin') || provider.billingApiKey) {
    const now = Math.floor(Date.now() / 1000);
    const weekAgo = now - 7 * 86400;
    const costs = await fetchJson(
      `${provider.baseUrl}/v1/organization/costs?start_time=${weekAgo}&end_time=${now}&bucket_width=1d&limit=7`,
      headers,
      signal
    );
    if (costs.ok) {
      const data = costs.json as { data?: Array<{ results?: Array<{ amount?: { value?: number } }> }> };
      let spend = 0;
      for (const bucket of data.data ?? []) {
        for (const row of bucket.results ?? []) {
          const v = row.amount?.value;
          if (typeof v === 'number') spend += v;
        }
      }
      const usage = await fetchOpenAiAdminUsage(provider, headers, signal);
      return {
        ...base,
        status: 'unavailable',
        planLabel: 'Organization',
        message: 'Spend tracked via Admin API; remaining balance is dashboard-only.',
        usage: {
          weekly: {
            spendUsd: spend / 100,
            tokens: usage?.weekly?.tokens,
            label: 'Last 7 days'
          }
        }
      };
    }
  }

  return {
    ...base,
    status: 'unavailable',
    message:
      grants.status === 401 || grants.status === 403
        ? 'Billing access requires an API key with billing scope or an Admin API key.'
        : 'OpenAI balance unavailable via API.'
  };
}

async function fetchOpenAiAdminUsage(
  provider: ProviderWithKey,
  headers: Record<string, string>,
  signal?: AbortSignal
): Promise<{ weekly?: { spendUsd?: number; tokens?: number } } | undefined> {
  const key = billingKey(provider);
  if (!key.startsWith('sk-admin') && !provider.billingApiKey?.trim()) return undefined;

  const now = Math.floor(Date.now() / 1000);
  const weekAgo = now - 7 * 86400;
  const usageRes = await fetchJson(
    `${provider.baseUrl}/v1/organization/usage/completions?start_time=${weekAgo}&end_time=${now}&bucket_width=1d&limit=7`,
    headers,
    signal
  );
  if (!usageRes.ok) return undefined;

  const data = usageRes.json as {
    data?: Array<{
      results?: Array<{
        input_tokens?: number;
        output_tokens?: number;
        num_model_requests?: number;
      }>;
    }>;
  };
  let tokens = 0;
  for (const bucket of data.data ?? []) {
    for (const row of bucket.results ?? []) {
      tokens += (row.input_tokens ?? 0) + (row.output_tokens ?? 0);
    }
  }
  return tokens > 0 ? { weekly: { tokens } } : undefined;
}

async function fetchXaiAccount(
  provider: ProviderWithKey,
  base: ProviderAccountSnapshot,
  signal?: AbortSignal
): Promise<ProviderAccountSnapshot> {
  const managementKey = provider.billingApiKey?.trim();
  const limits = getProviderRateLimits(provider.id);

  if (!managementKey) {
    return {
      ...(await fetchRateLimitFallback(provider, base, 'xai', signal)),
      message:
        'Add an xAI Management key (BillingRead) in Settings for live prepaid balance.'
    };
  }

  const authHeaders = {
    Accept: 'application/json',
    Authorization: `Bearer ${managementKey}`
  };

  const validation = await fetchJson(
    `${XAI_MANAGEMENT_API_BASE}/auth/management-keys/validation`,
    authHeaders,
    signal
  );
  if (!validation.ok) {
    return {
      ...base,
      status: validation.status === 401 || validation.status === 403 ? 'error' : 'unavailable',
      planLabel: 'xAI API',
      message: 'xAI Management key validation failed.',
      limits
    };
  }

  const teamId = (validation.json as { teamId?: string; scope_id?: string } | null)?.teamId
    ?? (validation.json as { scope_id?: string } | null)?.scope_id;
  if (!teamId) {
    return {
      ...base,
      status: 'unavailable',
      planLabel: 'xAI API',
      message: 'xAI Management API did not return a team id.',
      limits
    };
  }

  let balanceUsd: number | undefined;
  const prepaid = await fetchJson(
    `${XAI_MANAGEMENT_API_BASE}/v1/billing/teams/${encodeURIComponent(teamId)}/prepaid/balance`,
    authHeaders,
    signal
  );
  if (prepaid.ok) {
    const total = (prepaid.json as { total?: { val?: string } } | null)?.total?.val;
    balanceUsd = usdCentsStringToUsd(total);
  }

  let usageDaily: number | undefined;
  let usageMonthly: number | undefined;
  const preview = await fetchJson(
    `${XAI_MANAGEMENT_API_BASE}/v1/billing/teams/${encodeURIComponent(teamId)}/postpaid/invoice/preview`,
    authHeaders,
    signal
  );
  if (preview.ok) {
    const core = (preview.json as {
      coreInvoice?: { prepaidCredits?: { val?: string }; prepaidCreditsUsed?: { val?: string } };
    } | null)?.coreInvoice;
    if (balanceUsd === undefined) {
      balanceUsd = usdCentsStringToUsd(core?.prepaidCredits?.val);
    }
    usageMonthly = usdCentsStringToUsd(core?.prepaidCreditsUsed?.val);
  }

  if (balanceUsd !== undefined) {
    return {
      ...base,
      planLabel: 'Prepaid credits',
      balanceUsd,
      balanceAvailable: balanceUsd > 0,
      currency: 'USD',
      limits,
      usage: {
        daily: usageDaily !== undefined ? { spendUsd: usageDaily, label: 'Today' } : undefined,
        monthly:
          usageMonthly !== undefined ? { spendUsd: usageMonthly, label: 'This period' } : undefined
      }
    };
  }

  return {
    ...base,
    status: limits ? 'ok' : 'unavailable',
    planLabel: 'xAI API',
    message: 'Could not read xAI prepaid balance; showing rate limits when available.',
    limits
  };
}

async function fetchAnthropicAccount(
  provider: ProviderWithKey,
  base: ProviderAccountSnapshot,
  signal?: AbortSignal
): Promise<ProviderAccountSnapshot> {
  const adminKey = provider.billingApiKey?.trim();
  const limits = getProviderRateLimits(provider.id);

  if (adminKey?.startsWith('sk-ant-admin')) {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400_000);
    const params = new URLSearchParams({
      starting_at: weekAgo.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      ending_at: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      bucket_width: '1d'
    });
    const res = await fetchJson(
      `${provider.baseUrl}/v1/organizations/cost_report?${params}`,
      {
        Accept: 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': adminKey
      },
      signal
    );
    if (res.ok) {
      const data = res.json as { data?: Array<{ results?: Array<{ amount?: string }> }> };
      let cents = 0;
      for (const bucket of data.data ?? []) {
        for (const row of bucket.results ?? []) {
          const n = row.amount ? Number(row.amount) : 0;
          if (Number.isFinite(n)) cents += n;
        }
      }
      return {
        ...base,
        status: 'unavailable',
        planLabel: 'Organization',
        message: 'Anthropic has no public balance API; cost data from Admin API.',
        limits,
        usage: { weekly: { spendUsd: cents / 100, label: 'Last 7 days' } }
      };
    }
  }

  return {
    ...base,
    status: limits ? 'ok' : 'unavailable',
    planLabel: 'Pay-as-you-go',
    message: limits
      ? 'Balance is dashboard-only; showing rate limits from recent API calls.'
      : 'Anthropic balance is dashboard-only. Add an Admin API key for cost reports.',
    limits
  };
}

async function fetchTogetherAccount(
  provider: ProviderWithKey,
  base: ProviderAccountSnapshot,
  signal?: AbortSignal
): Promise<ProviderAccountSnapshot> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const key = billingKey(provider);
  if (key) headers.Authorization = `Bearer ${key}`;

  const usageRes = await fetchJson(`${provider.baseUrl}/v1/billing/usage`, headers, signal);
  if (usageRes.ok) {
    const parsed = parseTogetherUsage(usageRes.json);
    return {
      ...base,
      status: 'unavailable',
      planLabel: 'Prepaid credits',
      message: 'Remaining balance is dashboard-only; showing recent spend from billing API.',
      currency: 'USD',
      limits: getProviderRateLimits(provider.id),
      usage: parsed
    };
  }

  return fetchRateLimitFallback(provider, base, 'together', signal);
}

function parseTogetherUsage(json: unknown): ProviderAccountSnapshot['usage'] {
  const root = json as {
    total_cost?: number;
    total_spend?: number;
    data?: { total_cost?: number; usage?: Array<Record<string, unknown>> };
    usage?: Array<Record<string, unknown>>;
  };
  const rows = root.usage ?? root.data?.usage;
  let daily: number | undefined;
  let monthly: number | undefined;
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const cost =
        typeof row.total_cost === 'number'
          ? row.total_cost
          : typeof row.cost === 'number'
            ? row.cost
            : typeof row.total_spend === 'number'
              ? row.total_spend
              : undefined;
      if (cost === undefined) continue;
      const period = typeof row.period === 'string' ? row.period.toLowerCase() : '';
      if (period.includes('day') || period === 'daily') daily = (daily ?? 0) + cost;
      else if (period.includes('month') || period === 'monthly') monthly = (monthly ?? 0) + cost;
    }
  }
  const spend =
    typeof root.total_cost === 'number'
      ? root.total_cost
      : typeof root.total_spend === 'number'
        ? root.total_spend
        : typeof root.data?.total_cost === 'number'
          ? root.data.total_cost
          : undefined;

  return {
    daily: daily !== undefined ? { spendUsd: daily, label: 'Today' } : undefined,
    monthly: monthly !== undefined ? { spendUsd: monthly, label: 'This month' } : undefined,
    weekly: spend !== undefined ? { spendUsd: spend, label: 'Recent spend' } : undefined
  };
}

async function probeProviderRateLimits(
  provider: ProviderWithKey,
  kind: ProviderHostKind,
  signal?: AbortSignal
): Promise<void> {
  if (!provider.apiKey?.trim() || signal?.aborted) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_ACCOUNT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    let url: string;
    if (kind === 'gemini') {
      url = `${provider.baseUrl}/v1beta/models?pageSize=1`;
      headers['x-goog-api-key'] = provider.apiKey;
    } else {
      url = `${provider.baseUrl}/v1/models`;
      headers.Authorization = `Bearer ${provider.apiKey}`;
    }
    const res = await fetch(url, { headers, signal: controller.signal });
    recordProviderRateLimits(provider.id, res.headers);
  } catch {
    // Best-effort cold-start probe.
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function fetchRateLimitFallback(
  provider: ProviderWithKey,
  base: ProviderAccountSnapshot,
  kind: ProviderHostKind,
  signal?: AbortSignal
): Promise<ProviderAccountSnapshot> {
  let limits = getProviderRateLimits(provider.id);
  if (!limits) {
    await probeProviderRateLimits(provider, kind, signal);
    limits = getProviderRateLimits(provider.id);
  }
  const planLabels: Partial<Record<ProviderHostKind, string>> = {
    gemini: 'Gemini API',
    groq: 'Groq Cloud',
    mistral: 'Mistral API',
    xai: 'xAI API',
    nvidia: 'NVIDIA API',
    'ollama-cloud': 'Ollama Cloud subscription',
    generic: 'Cloud API'
  };

  if (kind === 'ollama-cloud') {
    return {
      ...base,
      status: 'unavailable',
      planLabel: planLabels[kind],
      message:
        'Ollama Cloud usage is subscription-based with no public balance API. Manage plan at ollama.com/settings.',
      limits
    };
  }

  if (limits) {
    return {
      ...base,
      status: 'ok',
      planLabel: planLabels[kind] ?? 'Cloud API',
      message: 'Balance unavailable via API; showing rate limits from recent calls.',
      limits
    };
  }

  return {
    ...base,
    status: 'unavailable',
    planLabel: planLabels[kind],
    message: 'Account balance not exposed by this provider API.'
  };
}

export function evictProviderAccountInFlight(providerId: string): void {
  inFlight.delete(providerId);
}

/** Test-only: clear in-flight dedupe map. */
export function __test_resetProviderAccountInFlight(): void {
  inFlight.clear();
}
