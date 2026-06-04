/**
 * Scope chips for inline workers — model, files, missing paths, unknown tools.
 */

import type { SubAgentSnapshot } from '../reducer/types.js';
import { cn } from '../../../lib/cn.js';

function chipLabel(path: string): string {
  const norm = path.replace(/\\/g, '/');
  return norm.split('/').pop() ?? path;
}

interface DelegationWorkerChipsProps {
  snap: SubAgentSnapshot;
}

export function DelegationWorkerChips({ snap }: DelegationWorkerChipsProps) {
  const files = snap.files ?? [];
  const missingFiles = snap.missingFiles ?? [];
  const unknownTools = snap.unknownTools ?? [];
  const modelId = snap.model?.modelId?.trim();

  const hasFiles = files.length > 0;
  const hasMissing = missingFiles.length > 0;
  const hasUnknown = unknownTools.length > 0;

  if (!modelId && !hasFiles && !hasMissing && !hasUnknown) return null;

  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-1"
      data-testid="delegation-worker-chips"
    >
      {modelId ? (
        <span
          className="vx-timeline-chip vx-chip-static px-1.5 py-0.5 font-mono text-meta text-text-faint"
          title={snap.model?.providerId ? `Provider: ${snap.model.providerId}` : undefined}
        >
          {modelId}
        </span>
      ) : null}
      {files.map((filePath) => (
        <span
          key={`file:${filePath}`}
          className={cn(
            'vx-timeline-chip vx-chip-static px-1.5 py-0.5 font-mono text-meta text-text-muted'
          )}
          title={filePath}
        >
          {chipLabel(filePath)}
        </span>
      ))}
      {missingFiles.map((filePath) => (
        <span
          key={`missing:${filePath}`}
          className={cn(
            'vx-timeline-chip vx-chip-static px-1.5 py-0.5 font-mono text-meta text-text-faint line-through'
          )}
          title={`${filePath} (not found)`}
        >
          {chipLabel(filePath)}
        </span>
      ))}
      {unknownTools.map((tool) => (
        <span
          key={`unknown:${tool}`}
          className={cn(
            'vx-timeline-chip vx-chip-static px-1.5 py-0.5 font-mono text-meta text-text-faint'
          )}
          title={`Unknown tool: ${tool}`}
        >
          {tool}
        </span>
      ))}
    </div>
  );
}
