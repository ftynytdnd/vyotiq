/**
 * Per-model context-window helpers (2026).
 *
 * Discovery stores the upstream value on `ModelInfo.contextWindow`.
 * User overrides live on `ProviderConfig.contextOverrides` and win at
 * read time via `effectiveContextWindow` — overrides are never written
 * back onto model records so the editor can show both discovered and
 * pinned values.
 */

import type { ModelInfo } from '../types/provider.js';

/** Effective context in tokens: user override wins over discovered value. */
export function effectiveContextWindow(
  model: Pick<ModelInfo, 'id' | 'contextWindow'>,
  contextOverrides?: Record<string, number>
): number | undefined {
  const override = contextOverrides?.[model.id];
  if (typeof override === 'number' && override > 0) return override;
  if (typeof model.contextWindow === 'number' && model.contextWindow > 0) {
    return model.contextWindow;
  }
  return undefined;
}

/** Parse a positive integer context override from UI/IPC input. */
export function normalizeContextOverride(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  const n = Math.floor(raw);
  if (n <= 0) return undefined;
  return n;
}
