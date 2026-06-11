import { modelIdTail } from '@shared/providers/modelId.js';
import type { ThinkingEffort } from '@shared/types/provider.js';
import { formatTokenCount } from '../../../lib/formatTokens.js';

/** Tail slug for row/trigger display; full id stays in tooltips. */
export function rowDisplayModelId(modelId: string): string {
  return modelIdTail(modelId);
}

/** Compact context badge label for model rows. */
export function rowContextBadgeLabel(tokens: number): string {
  return formatTokenCount(tokens);
}

/** Whether effort should appear as a row badge (hide default/off). */
export function shouldShowEffortBadge(
  effort: ThinkingEffort | undefined,
  thinkingCapable: boolean
): effort is ThinkingEffort {
  return thinkingCapable && effort !== undefined && effort !== 'off';
}
