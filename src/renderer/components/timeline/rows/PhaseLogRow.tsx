/**
 * Persisted phase log line — subtle meta row in wire order (no divider chrome).
 */

import { cn } from '../../../lib/cn.js';
import {
  isPhaseHeadlineLabel,
  timelinePhaseHeadingClassName
} from '../shared/rowStyles.js';

interface PhaseLogRowProps {
  label: string;
  tooltip?: string;
  gateDecision?: {
    kind: 'passed' | 'looped_back' | 'blocked';
    reason: string;
    targetPhase?: string;
    citeLedgerEntryId?: string;
  };
}

export function PhaseLogRow({ label, tooltip, gateDecision }: PhaseLogRowProps) {
  const goldHeadline = isPhaseHeadlineLabel(label);
  const gateLabel =
    gateDecision?.kind === 'looped_back' && gateDecision.targetPhase
      ? `↩ ${gateDecision.targetPhase}`
      : gateDecision?.kind === 'passed'
        ? '✓'
        : gateDecision?.kind === 'blocked'
          ? '⊘'
          : null;
  return (
    <div
      className="vyotiq-stepfade-once flex flex-wrap items-center gap-2 py-0.5 text-meta"
      data-row-kind="phase"
    >
      <span
        className={cn(
          goldHeadline ? timelinePhaseHeadingClassName(false) : 'vx-caption text-text-faint',
          tooltip && 'cursor-help'
        )}
        {...(tooltip ? { title: tooltip } : {})}
      >
        {label}
      </span>
      {gateLabel ? (
        <span
          className={cn(
            'vx-caption',
            gateDecision?.kind === 'passed' && 'text-status-ok',
            gateDecision?.kind === 'looped_back' && 'text-status-warn',
            gateDecision?.kind === 'blocked' && 'text-status-error'
          )}
          title={gateDecision?.reason}
        >
          {gateLabel}
        </span>
      ) : null}
    </div>
  );
}
