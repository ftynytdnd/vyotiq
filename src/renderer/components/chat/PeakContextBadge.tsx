/**
 * Peak context-use badge for a conversation row. Surfaces the highest
 * observed prompt size as a percentage of the model ceiling when the
 * ratio exceeds 5%.
 */

import type { ConversationMeta } from '@shared/types/chat.js';
import { useChatStore } from '../../store/useChatStore.js';
import {
  useProviderStore,
  selectEffectiveContextWindow
} from '../../store/useProviderStore.js';
import { cn } from '../../lib/cn.js';

interface PeakContextBadgeProps {
  meta: ConversationMeta;
  className?: string;
}

export function PeakContextBadge({ meta, className }: PeakContextBadgeProps) {
  const slicePeak = useChatStore(
    (s) => s.slices[meta.id]?.orchestratorUsage?.peak.promptTokens
  );
  const peakPromptTokens = Math.max(
    meta.peakPromptTokens ?? 0,
    typeof slicePeak === 'number' ? slicePeak : 0
  );
  const providers = useProviderStore((s) => s.providers);
  if (typeof peakPromptTokens !== 'number' || peakPromptTokens <= 0) return null;
  const providerId = meta.lastProviderId;
  const modelId = meta.lastModelId;
  if (!providerId || !modelId) return null;
  const ceiling = selectEffectiveContextWindow(providers, providerId, modelId);
  if (typeof ceiling !== 'number' || ceiling <= 0) return null;
  const ratio = Math.min(2, peakPromptTokens / ceiling);
  if (ratio < 0.05) return null;
  const pct = Math.round(ratio * 100);
  const pctLabel = `${pct}%`;
  const toneClass =
    ratio >= 0.9
      ? 'text-danger'
      : ratio >= 0.7
        ? 'text-warning'
        : 'text-text-faint';
  const tooltip =
    `Peak context use: ${peakPromptTokens.toLocaleString()} / ${ceiling.toLocaleString()} ` +
    `tokens (${pctLabel}). Highest observed prompt size across this conversation.`;
  return (
    <span
      title={tooltip}
      className={cn(
        'inline-flex shrink-0 items-center font-mono text-meta',
        toneClass,
        className
      )}
    >
      {pctLabel}
    </span>
  );
}
