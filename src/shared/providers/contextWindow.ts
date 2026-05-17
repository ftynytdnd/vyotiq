/**
 * Effective context-window resolver.
 *
 * Centralized so the renderer (composer ratio + model picker) and the
 * main process cannot disagree on what a model's window actually is.
 * Pure function, no I/O.
 *
 * Precedence:
 *   1. User-pinned override on the provider (`contextOverrides[modelId]`).
 *   2. Discovered value from `/v1/models` on the provider's `models[]`
 *      (`contextWindow` field).
 *   3. `undefined` — caller falls back to "no ceiling known" behavior
 *      (renderer hides the ratio).
 */

import type { ProviderConfig } from '../types/provider.js';

export function selectEffectiveContextWindow(
  providers: ReadonlyArray<ProviderConfig>,
  providerId: string,
  modelId: string
): number | undefined {
  const p = providers.find((x) => x.id === providerId);
  if (!p) return undefined;
  const override = p.contextOverrides?.[modelId];
  if (typeof override === 'number' && override > 0) return override;
  const discovered = p.models?.find((m) => m.id === modelId)?.contextWindow;
  return typeof discovered === 'number' && discovered > 0 ? discovered : undefined;
}
