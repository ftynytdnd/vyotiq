/**
 * Composer footer status strip — live orchestrator phase during runs.
 */

import { memo, useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useChatStore } from '../../store/useChatStore.js';
import { formatTokensPerSecond } from '../contextInspector/inspectorFormat.js';
import {
  resolveLivePhaseHeadline,
  timelinePhaseHeadingClassName
} from '../timeline/shared/rowStyles.js';
import { shimmerText } from '../../lib/shimmer.js';
import { cn } from '../../lib/cn.js';

const TICK_MS = 1000;

export const ComposerStatusStrip = memo(function ComposerStatusStrip() {
  const { isProcessing, latest, runStartedAt, orchestratorUsage } = useChatStore(
    useShallow((s) => ({
      isProcessing: s.isProcessing,
      latest: s.latestOrchestratorRunStatus,
      runStartedAt: s.runStartedAt,
      orchestratorUsage: s.orchestratorUsage
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
      // Keep the footer strip concise — the timeline activity lane already
      // surfaces the verbose "Awaiting first token from …" headline.
      if (latest.phase === 'awaiting-response') {
        return 'Awaiting response…';
      }
      return resolveLivePhaseHeadline(latest.phase, latest.label ?? 'Working…');
    }
    return 'Awaiting response…';
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

  if (!isProcessing || !label) return null;

  const anchor = latest?.ts ?? runStartedAt ?? Date.now();
  const elapsed = Math.max(0, Math.floor((Date.now() - anchor) / 1000));

  return (
    <div
      className="vx-composer-status-strip min-w-0 flex-1 truncate px-0.5 text-meta"
      aria-live="polite"
    >
      <span className={cn(timelinePhaseHeadingClassName(true), shimmerText(true))}>{label}</span>
      {elapsed > 0 && (
        <span className="ml-1.5 text-text-faint tabular-nums">{elapsed}s</span>
      )}
      {tokRate && (
        <span className="ml-1.5 font-mono text-text-faint tabular-nums">{tokRate}</span>
      )}
    </div>
  );
});
