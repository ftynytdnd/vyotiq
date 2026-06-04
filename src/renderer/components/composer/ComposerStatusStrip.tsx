/**
 * Composer footer status strip — live orchestrator phase during runs.
 */

import { memo, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '../../store/useChatStore.js';
import { useTimelineUiStore } from '../../store/useTimelineUiStore.js';
import { formatTokensPerSecond } from '../../lib/formatTokens.js';
import {
  resolveLivePhaseHeadline,
  shouldHideLivePhaseHeadline,
  timelinePhaseHeadingClassName
} from '../timeline/shared/rowStyles.js';
import { shimmerText } from '../../lib/shimmer.js';
import { cn } from '../../lib/cn.js';
const TICK_MS = 1000;

export const ComposerStatusStrip = memo(function ComposerStatusStrip() {
  const timelineAtTail = useTimelineUiStore((s) => s.timelineAtTail);
  const { isProcessing, latest, runStartedAt, orchestratorUsage, hasEvents } = useChatStore(
    useShallow((s) => ({
      isProcessing: s.isProcessing,
      latest: s.latestOrchestratorRunStatus,
      runStartedAt: s.runStartedAt,
      orchestratorUsage: s.orchestratorUsage,
      hasEvents: s.events.length > 0
    }))
  );
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!isProcessing) return;
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, [isProcessing]);

  const label = useMemo(() => {
    if (!isProcessing) return null;
    if (latest) {
      if (shouldHideLivePhaseHeadline(latest.phase)) return null;
      return resolveLivePhaseHeadline(latest.phase, latest.label ?? 'Working…');
    }
    return 'Starting…';
  }, [isProcessing, latest]);

  const tokRate = useMemo(() => {
    if (!isProcessing || !orchestratorUsage) return null;
    const completion =
      orchestratorUsage.latest.completionTokens +
      (orchestratorUsage.inFlight?.completionTokens ?? 0);
    return formatTokensPerSecond(
      completion > 0 ? completion : undefined,
      orchestratorUsage.streamStartedAt,
      Date.now()
    );
  }, [isProcessing, orchestratorUsage, tick]);

  if (!timelineAtTail && hasEvents) {
    return (
      <span className="vx-composer-status-strip min-w-0 flex-1 truncate px-0.5 text-meta text-text-faint">
        Scroll down or use{' '}
        <span className="vx-jump-to-latest-label">Latest</span> for new messages
      </span>
    );
  }

  if (!isProcessing || !label) return null;

  const anchor = latest?.ts ?? runStartedAt ?? Date.now();
  const elapsed = Math.max(0, Math.floor((Date.now() - anchor) / 1000));
  const shimmer = latest?.phase !== 'connecting';

  return (
    <div
      className="vx-composer-status-strip flex min-w-0 flex-1 items-baseline px-0.5 text-meta"
      aria-live="polite"
    >
      <span
        className={cn(
          timelinePhaseHeadingClassName(true),
          shimmerText(shimmer),
          'min-w-0 shrink'
        )}
      >
        {label}
      </span>
      {elapsed > 0 && (
        <span className="ml-1.5 text-text-faint tabular-nums">{elapsed}s</span>
      )}
      {tokRate && (
        <span className="ml-1.5 font-mono text-text-faint tabular-nums">{tokRate}</span>
      )}
    </div>
  );
});
