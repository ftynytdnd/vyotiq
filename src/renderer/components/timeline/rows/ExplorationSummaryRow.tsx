/**
 * Collapsed rollup for read/search exploration in a turn.
 */

import { useMemo } from 'react';
import { cn } from '../../../lib/cn.js';
import { DetailShell } from '../shared/DetailShell.js';
import { TimelineRowHeader } from '../shared/TimelineRowHeader.js';
import { useTimelineRowExpand } from '../shared/useTimelineRowExpand.js';
import { formatToolGroupDisplayPrimary } from '../shared/formatToolGroupDisplayPrimary.js';

const MAX_EXPANDED_SAMPLES = 5;

interface ExplorationSample {
  toolName: 'read' | 'search';
  path: string;
}

interface ExplorationSummaryRowProps {
  rowKey: string;
  fileCount: number;
  searchCount: number;
  samples?: ExplorationSample[];
}

function formatExplorationSummary(fileCount: number, searchCount: number): string {
  const parts: string[] = [];
  if (fileCount > 0) {
    parts.push(`${fileCount} file${fileCount === 1 ? '' : 's'}`);
  }
  if (searchCount > 0) {
    parts.push(`${searchCount} search${searchCount === 1 ? '' : 'es'}`);
  }
  if (parts.length === 0) return 'Explored';
  return `Explored ${parts.join(', ')}`;
}

function formatSamplePrimary(sample: ExplorationSample): string {
  const { display } = formatToolGroupDisplayPrimary(sample.toolName, sample.path);
  return display;
}

export function ExplorationSummaryRow({
  rowKey,
  fileCount,
  searchCount,
  samples = []
}: ExplorationSummaryRowProps) {
  const total = fileCount + searchCount;
  const expandable = samples.length > 0;
  const { expanded, onToggle } = useTimelineRowExpand({
    rowKey,
    defaultExpanded: false
  });
  const panelId = `exploration-summary-${rowKey}`;

  const summaryPrimary = useMemo(() => {
    if (samples.length === 0) return formatExplorationSummary(fileCount, searchCount);
    const first = formatSamplePrimary(samples[0]!);
    const rest = total - 1;
    if (rest <= 0) return `Explored ${first}`;
    return `Explored ${first} and ${rest} other${rest === 1 ? '' : 's'}`;
  }, [fileCount, searchCount, samples, total]);

  const visibleSamples = expanded ? samples.slice(0, MAX_EXPANDED_SAMPLES) : [];
  const hiddenCount = Math.max(0, samples.length - MAX_EXPANDED_SAMPLES);

  if (!expandable) {
    return (
      <p
        className="vx-exploration-summary font-mono text-meta text-text-faint"
        data-row-kind="exploration-summary"
      >
        {formatExplorationSummary(fileCount, searchCount)}
      </p>
    );
  }

  return (
    <div className="vx-exploration-summary vyotiq-stepfade-once" data-row-kind="exploration-summary">
      <TimelineRowHeader
        expanded={expanded}
        onToggle={onToggle}
        panelId={panelId}
        className="vx-timeline-activity-row"
      >
        <span className="font-mono text-meta text-text-faint">{summaryPrimary}</span>
      </TimelineRowHeader>
      {expanded && (
        <DetailShell variant="flat" gap="gap-0.5">
          <div id={panelId} className="contents">
            <ul className={cn('flex flex-col gap-0.5 pb-1 pl-4')}>
              {visibleSamples.map((sample, idx) => (
                <li
                  key={`${sample.toolName}:${sample.path}:${idx}`}
                  className="truncate font-mono text-meta text-text-faint"
                  title={sample.path}
                >
                  {formatSamplePrimary(sample)}
                </li>
              ))}
              {hiddenCount > 0 ? (
                <li className="font-mono text-meta text-text-faint">and {hiddenCount} more…</li>
              ) : null}
            </ul>
          </div>
        </DetailShell>
      )}
    </div>
  );
}
