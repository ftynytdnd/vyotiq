/**
 * Typed provider error surface. Both `openaiChatStream` and
 * `ollamaChatStream` throw `ProviderError` instances when the HTTP
 * transport rejects a request, so the orchestrator can render a
 * human-readable summary in the timeline instead of a raw `POST
 * … 402 Payment Required` dump.
 *
 * Non-recoverable kinds (`billing`, `auth`, `model-not-found`,
 * `endpoint-missing`) terminate the run loop immediately — retrying
 * cannot fix user configuration. Transient kinds (`rate-limit`,
 * `server`, `unknown`) still use `MAX_SELF_CORRECTION_ATTEMPTS`.
 */

type ProviderErrorKind =
  | 'billing'
  | 'auth'
  | 'rate-limit'
  | 'model-not-found'
  | 'endpoint-missing'
  | 'server'
  | 'unknown';

/** Chat stream vs model-listing — affects how 404s are interpreted. */
type ProviderErrorSurface = 'chat' | 'discovery';

export interface ClassifyInput {
  status: number;
  statusText: string;
  url: string;
  body: string;
  surface: ProviderErrorSurface;
  providerId: string;
  providerName: string;
}

/** Typed error thrown by both stream transports. */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status: number;
  readonly providerId: string;
  readonly providerName: string;
  readonly friendlyMessage: string;
  readonly surface: ProviderErrorSurface;
  /** Raw response body (truncated to 1 KB upstream) for debug visibility. */
  readonly rawBody: string;

  constructor(input: {
    kind: ProviderErrorKind;
    status: number;
    providerId: string;
    providerName: string;
    friendlyMessage: string;
    surface: ProviderErrorSurface;
    rawBody: string;
  }) {
    // `Error.message` is what survives the Electron IPC structured-clone
    // boundary on its way to the renderer (custom fields like `kind` /
    // `status` / `friendlyMessage` are stripped during serialization),
    // so we put ONLY the clean friendly text here. Triage callers
    // (main-process logs, tests) reach into `err.kind`, `err.status`,
    // and `err.rawBody` directly when they need the structured form.
    super(input.friendlyMessage);
    this.name = 'ProviderError';
    this.kind = input.kind;
    this.status = input.status;
    this.providerId = input.providerId;
    this.providerName = input.providerName;
    this.friendlyMessage = input.friendlyMessage;
    this.surface = input.surface;
    this.rawBody = input.rawBody;
  }
}

/**
 * Classify an HTTP error from a provider into a {@link ProviderError}.
 * Safe to call with any status; unknown statuses become `kind:'unknown'`.
 */
export function classifyProviderError(input: ClassifyInput): ProviderError {
  const kind = pickKind(input.status, input.surface, input.body);
  const friendlyMessage = describe(kind, input);
  return new ProviderError({
    kind,
    status: input.status,
    providerId: input.providerId,
    providerName: input.providerName,
    friendlyMessage,
    surface: input.surface,
    rawBody: input.body
  });
}

/**
 * Some providers (notably Ollama Cloud) return HTTP 403 for
 * SUBSCRIPTION / ENTITLEMENT failures rather than authentication
 * failures — e.g. `{"error":"this model requires a subscription, upgrade
 * for access: https://ollama.com/upgrade"}`. Mapping those to `'auth'`
 * misdirects the user to "Check the API key in Settings" when the key
 * is fine and the only fix is upgrading the plan or switching models.
 *
 * We detect that case by scanning the response body for billing-shaped
 * vocabulary; everything else still classifies as `'auth'`.
 */
const SUBSCRIPTION_HINTS = ['subscription', 'upgrade', 'plan', 'billing', 'quota'];

function looksLikeSubscriptionError(body: string): boolean {
  if (!body) return false;
  const lower = body.toLowerCase();
  return SUBSCRIPTION_HINTS.some((h) => lower.includes(h));
}

function pickKind(status: number, surface: ProviderErrorSurface, body: string): ProviderErrorKind {
  if (status === 401) return 'auth';
  if (status === 403) return looksLikeSubscriptionError(body) ? 'billing' : 'auth';
  if (status === 402) return 'billing';
  if (status === 404) return surface === 'chat' ? 'model-not-found' : 'endpoint-missing';
  if (status === 429) return 'rate-limit';
  if (status >= 500 && status < 600) return 'server';
  return 'unknown';
}

function describe(kind: ProviderErrorKind, input: ClassifyInput): string {
  const name = input.providerName;
  switch (kind) {
    case 'auth':
      return `${name}: Authentication failed (HTTP ${input.status}). Check the API key in Settings → Providers.`;
    case 'billing': {
      // For HTTP 403 subscription-shaped errors the provider's own body
      // is the most actionable text the user can read (typically a link
      // to the upgrade page). Surface it instead of a generic balance
      // line. Falls back to the generic message for true 402s.
      if (input.status === 403) {
        const summary = summarizeBody(input.body);
        return summary
          ? `${name}: ${summary}`
          : `${name}: This model requires a higher subscription tier. Switch models or upgrade at your provider dashboard.`;
      }
      return `${name}: Insufficient balance. Top up at your provider dashboard or switch providers.`;
    }
    case 'rate-limit':
      // The runtime's self-correction loop owns the "we will retry"
      // semantics — the worker's `liveStatus` row already shimmers
      // `Retrying provider call (n/3)…` while a backoff window is
      // active, and after the third strike the row flips to `Failed`.
      // Hard-coding "Retrying with backoff." inside the friendly
      // message lied in the latter case (the message stuck around on
      // the failed row even though no retry was queued). Describe the
      // condition only; let the row's status do the rest.
      return `${name}: Rate limit exceeded.`;
    case 'model-not-found':
      return `${name}: The selected model is not available. Refresh models in Settings → Providers.`;
    case 'endpoint-missing':
      return `${name}: Endpoint not found. Verify the Base URL and dialect in Settings → Providers.`;
    case 'server':
      // Same rationale as `rate-limit` — the runtime's self-correction
      // loop owns the "we will retry" semantics. Describe the
      // condition only.
      return `${name}: Provider server error (HTTP ${input.status}).`;
    case 'unknown':
    default: {
      // For unknown statuses (400 Bad Request is the most common — it
      // means "your request body is malformed in some way the provider
      // knows about but we don't"), the provider's response BODY is
      // almost always the only useful piece of information. A bare
      // `HTTP 400 Bad Request` message is user-hostile; we extract a
      // short summary from the body so the user sees e.g.
      // `Ollama Cloud: model "gpt-oss-123" not found (HTTP 400).`
      // instead of `Ollama Cloud: Request failed (HTTP 400 Bad Request).`
      const summary = summarizeBody(input.body);
      const base = `${name}: Request failed (HTTP ${input.status} ${input.statusText || ''}).`.trim();
      return summary ? `${base} ${summary}` : base;
    }
  }
}

/**
 * Extract a short human-readable summary from a non-2xx response body.
 * Handles the two common shapes:
 *   - JSON `{ error: "…" }`  (Ollama, OpenAI-compat error envelope)
 *   - JSON `{ error: { message: "…" } }` (OpenAI's own nested form)
 * Plaintext bodies are returned verbatim (trimmed, first line only,
 * capped at 200 chars). Empty / unparseable / excessive payloads
 * return '' so the caller's base message wins.
 */
function summarizeBody(body: string): string {
  if (!body) return '';
  const trimmed = body.trim();
  if (trimmed.length === 0) return '';
  // Try JSON first — provider error envelopes are overwhelmingly JSON.
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const msg = extractErrorMessage(parsed);
      if (msg) return clip(msg);
    } catch {
      // fall through to the plaintext path
    }
  }
  const firstLine = trimmed.split('\n', 1)[0] ?? '';
  return clip(firstLine);
}

function extractErrorMessage(parsed: unknown): string {
  if (parsed === null || typeof parsed !== 'object') return '';
  const err = (parsed as Record<string, unknown>)['error'];
  if (typeof err === 'string') return err;
  if (err !== null && typeof err === 'object') {
    const nested = (err as Record<string, unknown>)['message'];
    if (typeof nested === 'string') return nested;
  }
  // Some providers use top-level `message` instead of `error`.
  const top = (parsed as Record<string, unknown>)['message'];
  if (typeof top === 'string') return top;
  return '';
}

function clip(s: string): string {
  const t = s.trim();
  return t.length > 200 ? `${t.slice(0, 200)}…` : t;
}

/** Narrowing helper for the timeline / toast surfaces in the renderer. */
export function isProviderError(err: unknown): err is ProviderError {
  return err instanceof ProviderError;
}

const NON_RECOVERABLE_PROVIDER_ERROR_KINDS: ReadonlySet<ProviderErrorKind> = new Set([
  'billing',
  'auth',
  'model-not-found',
  'endpoint-missing'
]);

/**
 * Permanent request-shape rejections (HTTP 400) where retrying the same
 * body cannot succeed — e.g. DeepSeek thinking mode vs `tool_choice`.
 * The orchestrator intercepts this BEFORE the non-recoverable halt to
 * retry once with `tool_choice` omitted (see `runLoop` safety net), so
 * a model we failed to classify ahead of time still recovers instead of
 * killing the run.
 */
export function isPermanentToolChoiceRejection(err: unknown): err is ProviderError {
  if (!isProviderError(err) || err.status !== 400) return false;
  const hay = `${err.friendlyMessage}\n${err.rawBody}`.toLowerCase();
  return hay.includes('tool_choice') && (hay.includes('does not support') || hay.includes('not support'));
}

/** Provider failures that should not consume the self-correction retry budget. */
export function isNonRecoverableProviderError(err: unknown): err is ProviderError {
  return (
    isProviderError(err) &&
    NON_RECOVERABLE_PROVIDER_ERROR_KINDS.has(err.kind)
  );
}

/**
 * Heuristic — does a mid-stream provider error message look like a
 * rate-limit / saturation signal that should feed the per-provider
 * cooldown gate?
 *
 * Both stream transports surface mid-body errors on an already-200
 * connection (Ollama Cloud's `{"error":"too many concurrent requests"}`,
 * OpenAI-compat gateways' `data: {"error":{...}}`). The initial-rejection
 * path only feeds `markRateLimited` on 429 / 5xx HTTP statuses, so
 * without sniffing the text a saturated provider would let sibling
 * concurrent streams dog-pile on retry instead of staggering behind the gate.
 *
 * Patterns observed in the field:
 *   - "too many concurrent requests" / "concurrent requests exceeded"
 *   - "rate limit exceeded" / "you have hit the rate limit"
 *   - "request was throttled" · "quota exceeded" · a bare "429"
 *
 * Conservative on purpose: a false positive only delays the next retry
 * against this provider by the standard backoff; a false negative
 * regresses to the dog-pile behavior. We err toward recognizing it.
 */
const RATE_LIMIT_HINT_RE =
  /\b(rate[\s-]?limit(?:ed|ing|s)?|too\s+many\s+(?:concurrent\s+)?(?:requests|connections)|concurrent\s+requests?\s+exceeded|throttl(?:ed|ing)|quota\s+exceeded|429)\b/i;

export function looksRateLimited(msg: string): boolean {
  return RATE_LIMIT_HINT_RE.test(msg);
}
