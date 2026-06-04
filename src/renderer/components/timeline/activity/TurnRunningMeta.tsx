/**
 * TurnRunningMeta — subtle live-run placeholder in the timeline footer
 * zone while the trailing run is still open (run-complete is gated until
 * `isProcessing` flips false).
 */

import { useChatStore } from '../../../store/useChatStore.js';
import { cn } from '../../../lib/cn.js';
import {
  resolveLivePhaseHeadline,
  shouldHideLivePhaseHeadline,
  timelinePhaseHeadingClassName,
  timelineRunCompleteRowClassName
} from '../shared/rowStyles.js';
import { shimmerText } from '../../../lib/shimmer.js';

interface TurnRunningMetaProps {
  live?: boolean;
}

export function TurnRunningMeta({ live = false }: TurnRunningMetaProps) {
  const isProcessing = useChatStore((s) => s.isProcessing);
  const latest = useChatStore((s) => (live ? s.latestOrchestratorRunStatus : undefined));

  if (!live || !isProcessing) return null;

  if (latest?.phase === 'connecting') return null;

  let label = 'Running…';
  if (latest) {
    if (latest.phase === 'awaiting-response') {
      label = 'Starting…';
    } else if (!shouldHideLivePhaseHeadline(latest.phase)) {
      label = resolveLivePhaseHeadline(latest.phase, latest.label ?? 'Working…');
    }
  }

  return (
    <div
      className={cn(
        'vyotiq-stepfade-once vx-timeline-meta text-text-faint',
        timelineRunCompleteRowClassName
      )}
      data-turn-running-meta
    >
      <span className={cn(timelinePhaseHeadingClassName(true), shimmerText(true))}>{label}</span>
    </div>
  );
}
