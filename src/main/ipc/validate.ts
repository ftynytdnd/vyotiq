/**
 * Lightweight IPC input-shape validators.
 *
 * Audit fix 2026-06-P2-1: IPC handlers use these helpers for runtime
 * shape gates. `chat:send` composes them via `chatValidate.ts`.
 *
 * The contract for every helper here:
 *
 *   - Throws a structured `Error('<channel>: <field> ...')` on bad input
 *     so `wrapIpcHandler` surfaces it to the renderer as a rejected
 *     `invoke`.
 *   - Type-narrows the input on success so the rest of the handler can
 *     use `value` as the asserted type without a `!` or extra cast.
 *   - Has a sensible default cap on string length where appropriate
 *     (renderer-controlled ids should never exceed a few hundred
 *     bytes — anything larger is either malice or a bug).
 *
 * Kept deliberately tiny (no zod / valibot) — the goal is "structurally
 * impossible to forget" defense-in-depth, not a schema framework. The
 * audit explicitly calls out the bigger lift (per-channel schemas) as
 * out of scope.
 *
 * Blob-like IPC channels (e.g. `attachments:read`) may keep `unknown`
 * inputs with dedicated parsers in their handler modules — see
 * `attachments.ipc.ts` (`parseAttachmentPathInput`) for the reference
 * pattern instead of extending this file ad hoc.
 */

/** Hard cap on the length of any renderer-supplied identifier / key.
 *  Comfortably above every legitimate id we mint (UUID = 36 chars,
 *  workspace paths cap at OS PATH_MAX = 4 096 on Linux / 32 767 on
 *  Windows, but we don't accept paths here — only ids).
 *
 *  A 1 KB cap is what `chat.ipc.ts:202-262` uses for similar fields
 *  (audit-fix M-03 baseline). Mirrored here for consistency. */
export const DEFAULT_MAX_STRING_BYTES = 1024;

export interface StringOpts {
  /** When `true`, an empty string ('') rejects. Default: `true`. */
  nonEmpty?: boolean;
  /** Override `DEFAULT_MAX_STRING_BYTES` for this field. */
  maxBytes?: number;
}

/**
 * Assert that `value` is a string of acceptable shape.
 *
 *   - Rejects non-string values.
 *   - Rejects empty strings unless `opts.nonEmpty === false`.
 *   - Rejects strings whose UTF-8 byte length exceeds the cap.
 *
 * Byte-cap rather than char-cap matches the `chat.ipc.ts` convention
 * (M-03) so a multi-byte unicode payload is measured by what actually
 * lands on the wire.
 */
export function assertString(
  channel: string,
  field: string,
  value: unknown,
  opts: StringOpts = {}
): asserts value is string {
  if (typeof value !== 'string') {
    throw new Error(`${channel}: ${field} must be a string`);
  }
  const nonEmpty = opts.nonEmpty ?? true;
  if (nonEmpty && value.length === 0) {
    throw new Error(`${channel}: ${field} must be a non-empty string`);
  }
  const cap = opts.maxBytes ?? DEFAULT_MAX_STRING_BYTES;
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes > cap) {
    throw new Error(
      `${channel}: ${field} exceeds the ${cap.toLocaleString()}-byte cap ` +
      `(received ${bytes.toLocaleString()} bytes)`
    );
  }
}

/** Same shape as `assertString`, but allows `undefined`. Useful for
 *  optional-id fields like `workspaceId?` on the conversations list. */
export function assertOptionalString(
  channel: string,
  field: string,
  value: unknown,
  opts: StringOpts = {}
): asserts value is string | undefined {
  if (value === undefined) return;
  assertString(channel, field, value, opts);
}

/**
 * Assert that `value` is a non-null object (NOT an array). Use for
 * payload parameters that should be `{ ... }` rather than primitives.
 * After this assertion the caller can index into `value` safely.
 */
export function assertObject(
  channel: string,
  field: string,
  value: unknown
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${channel}: ${field} must be a non-null object`);
  }
}

/** Optional-object variant — `undefined` passes, everything else routes
 *  through `assertObject`. */
export function assertOptionalObject(
  channel: string,
  field: string,
  value: unknown
): asserts value is Record<string, unknown> | undefined {
  if (value === undefined) return;
  assertObject(channel, field, value);
}

export function assertBoolean(
  channel: string,
  field: string,
  value: unknown
): asserts value is boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${channel}: ${field} must be a boolean`);
  }
}

export interface NumberOpts {
  /** When set, value must be `>= min`. */
  min?: number;
  /** When set, value must be `<= max`. */
  max?: number;
  /** When `true` (default), `NaN` / `Infinity` reject. */
  finite?: boolean;
  /** When `true`, value must be an integer. */
  integer?: boolean;
}

export function assertNumber(
  channel: string,
  field: string,
  value: unknown,
  opts: NumberOpts = {}
): asserts value is number {
  if (typeof value !== 'number') {
    throw new Error(`${channel}: ${field} must be a number`);
  }
  const finite = opts.finite ?? true;
  if (finite && !Number.isFinite(value)) {
    throw new Error(`${channel}: ${field} must be a finite number`);
  }
  if (opts.integer && !Number.isInteger(value)) {
    throw new Error(`${channel}: ${field} must be an integer`);
  }
  if (opts.min !== undefined && value < opts.min) {
    throw new Error(`${channel}: ${field} must be >= ${opts.min}`);
  }
  if (opts.max !== undefined && value > opts.max) {
    throw new Error(`${channel}: ${field} must be <= ${opts.max}`);
  }
}

export interface StringArrayOpts extends StringOpts {
  /** When set, rejects arrays longer than this count. */
  maxItems?: number;
}

/** Assert that `value` is an array of strings. */
export function assertStringArray(
  channel: string,
  field: string,
  value: unknown,
  opts: StringArrayOpts = {}
): asserts value is string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${channel}: ${field} must be an array`);
  }
  if (opts.maxItems !== undefined && value.length > opts.maxItems) {
    throw new Error(
      `${channel}: ${field} exceeds the ${opts.maxItems} item cap (received ${value.length})`
    );
  }
  for (let i = 0; i < value.length; i++) {
    assertString(channel, `${field}[${i}]`, value[i], opts);
  }
}

/**
 * Assert a `ConfirmResponse` — legacy bare boolean or the structured
 * `{ approved, acceptAllRemaining? }` object from `EditApprovalDialog`.
 */
export function assertConfirmResponse(
  channel: string,
  field: string,
  value: unknown
): asserts value is boolean | { approved: boolean; acceptAllRemaining?: boolean } {
  if (typeof value === 'boolean') return;
  assertObject(channel, field, value);
  assertBoolean(channel, `${field}.approved`, value.approved);
  if ('acceptAllRemaining' in value && value.acceptAllRemaining !== undefined) {
    assertBoolean(channel, `${field}.acceptAllRemaining`, value.acceptAllRemaining);
  }
}

/** SHA-256 content hash used by the checkpoint blob store (64 lowercase hex). */
const BLOB_HASH_RE = /^[0-9a-f]{64}$/;

/**
 * Assert a checkpoint blob hash — exactly 64 lowercase hex digits.
 * Rejects path segments (`../`, slashes) and non-hex before `blobPath`.
 */
export function assertBlobHash(
  channel: string,
  field: string,
  value: unknown
): asserts value is string {
  assertString(channel, field, value, { maxBytes: 64 });
  if (!BLOB_HASH_RE.test(value)) {
    throw new Error(
      `${channel}: ${field} must be a 64-character lowercase hex SHA-256 hash`
    );
  }
}

/** Assert that `value` is one of the supplied literal strings. */
export function assertEnum<T extends string>(
  channel: string,
  field: string,
  value: unknown,
  allowed: readonly T[]
): asserts value is T {
  if (typeof value !== 'string') {
    throw new Error(`${channel}: ${field} must be a string`);
  }
  if (!allowed.includes(value as T)) {
    throw new Error(
      `${channel}: ${field} must be one of: ${allowed.join(', ')} (received "${value.slice(0, 40)}")`
    );
  }
}
