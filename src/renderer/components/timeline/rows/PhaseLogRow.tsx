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
}

export function PhaseLogRow({ label, tooltip }: PhaseLogRowProps) {
  const goldHeadline = isPhaseHeadlineLabel(label);
  return (
    <div
      className="vyotiq-stepfade-once py-0.5 text-meta"
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
    </div>
  );
}
