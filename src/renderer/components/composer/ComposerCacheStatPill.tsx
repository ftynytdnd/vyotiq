/**
 * Prompt-cache stats for the composer metrics row.
 */

import { memo } from 'react';
import type { ModelSelection } from '@shared/types/provider.js';
import { formatTokenCountWithUnit } from '../../lib/formatTokens.js';
import { cn } from '../../lib/cn.js';
import { useComposerCacheStats } from './useComposerCacheStats.js';

interface ComposerCacheStatPillProps {
  model?: ModelSelection | null;
  /** Hide verbose cache copy during an active unfocused run. */
  compact?: boolean;
}

export const ComposerCacheStatPill = memo(function ComposerCacheStatPill({
  model = null,
  compact = false
}: ComposerCacheStatPillProps) {
  const stats = useComposerCacheStats(model);
  if (!stats || compact) return null;

  return (
    <span
      className={cn(
        'vx-composer-cache-stat shrink-0 font-mono text-meta tabular-nums',
        stats.cacheWarn ? 'text-warning' : 'text-text-faint'
      )}
      role="status"
      aria-live="polite"
      title={stats.title}
    >
      {stats.cacheWarn ? (
        <>
          <span className="font-medium text-warning">No cache read</span>
          {' · '}
          {formatTokenCountWithUnit(stats.promptTokens)} prompt
        </>
      ) : (
        <>
          <span className="text-text-secondary">
            {formatTokenCountWithUnit(stats.cachedTokens)} cached
          </span>
          {stats.cachePct !== null ? ` · ${stats.cachePct}% of prompt` : ''}
          {stats.grossSavingsLabel ? ` · ${stats.grossSavingsLabel}` : ''}
          {stats.uncachedLabel ? ` · ${stats.uncachedLabel}` : ''}
        </>
      )}
    </span>
  );
});
