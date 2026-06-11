/**
 * Live provider account / billing snapshots fetched from upstream APIs.
 * Cached in main only — never persisted (balances go stale quickly).
 */

/** Snapshot fetch outcome for a single provider. */
export type ProviderAccountStatus = 'ok' | 'unavailable' | 'error' | 'local';

/** Spend or token usage over a provider-defined window. */
export interface ProviderUsageWindow {
  /** USD spent in the window when the upstream reports dollars. */
  spendUsd?: number;
  /** Token count when the upstream reports tokens instead of dollars. */
  tokens?: number;
  /** Human label, e.g. "Today", "This week", "This month". */
  label?: string;
}

/** Rate-limit telemetry captured from upstream response headers. */
export interface ProviderRateLimits {
  requestsRemaining?: number;
  requestsLimit?: number;
  tokensRemaining?: number;
  tokensLimit?: number;
  /** ms epoch when the tightest limit resets, when known. */
  resetAt?: number;
}

/**
 * Normalized account snapshot for one configured provider.
 * Fields are populated only when the upstream exposes them.
 */
export interface ProviderAccountSnapshot {
  providerId: string;
  fetchedAt: number;
  status: ProviderAccountStatus;
  /** Provider class used for fetch routing (diagnostics). */
  hostKind?: string;
  /** Friendly error when `status === 'error'`. */
  message?: string;
  /** Link to the provider dashboard when balance is not API-accessible. */
  dashboardUrl?: string;

  /** Subscription / plan label when known (e.g. "Pro", "Pay-as-you-go"). */
  planLabel?: string;
  /** Tier / entitlement label (e.g. "Tier 1", "Free"). */
  tierLabel?: string;

  /** Remaining prepaid balance in USD when reported (normalized for cost math). */
  balanceUsd?: number;
  /** Native balance amount when the upstream reports a non-USD currency. */
  balanceNative?: number;
  /** Whether the account can accept new API calls (DeepSeek `is_available`). */
  balanceAvailable?: boolean;
  currency?: string;
  /** Last known top-up / peak balance — used for percent-based low-balance warnings. */
  referenceBalanceUsd?: number;

  /** Period usage breakdown. */
  usage?: {
    daily?: ProviderUsageWindow;
    weekly?: ProviderUsageWindow;
    monthly?: ProviderUsageWindow;
    allTime?: ProviderUsageWindow;
  };

  limits?: ProviderRateLimits;

  /** Upcoming quota reset timestamps (ms epoch). */
  resetsAt?: number[];

  /** True when balance is critically low and the user should be warned. */
  lowBalance?: boolean;

  /**
   * When true, the provider exposes account-wide credits via a separate
   * management/admin key (e.g. OpenRouter `/v1/credits`).
   */
  managementKeyRequired?: boolean;
}

/** Map of provider id → latest snapshot. */
export type ProviderAccountSnapshotMap = Readonly<Record<string, ProviderAccountSnapshot>>;
