/**
 * Shared diff viewer — unified / split layout toggle plus rendering.
 * Used by checkpoints, review, timeline edits, and edit approval.
 */

import { useState } from 'react';
import type { DiffHunk } from '@shared/types/tool.js';
import type { DiffViewVariant } from '../timeline/tools/edit/diff/DiffHunk.js';
import type { ReviewLinePickProps } from '../timeline/tools/edit/diff/diffLinePick.js';
import { DiffLayoutToggle } from './DiffLayoutToggle.js';
import { SplitDiffViewer } from './SplitDiffViewer.js';
import { UnifiedDiffBody } from './UnifiedDiffBody.js';
import {
  readDiffLayoutPref,
  writeDiffLayoutPref,
  type DiffLayoutMode
} from './diffLayoutPref.js';

export interface DiffViewerProps {
  hunks: DiffHunk[];
  variant: DiffViewVariant;
  maxHeightClass?: string;
  linePick?: ReviewLinePickProps;
  /** Hide layout toggle (e.g. streaming partial diffs). Defaults true. */
  showLayoutToggle?: boolean;
}

export function DiffViewer({
  hunks,
  variant,
  maxHeightClass,
  linePick,
  showLayoutToggle = true
}: DiffViewerProps) {
  const [layout, setLayout] = useState<DiffLayoutMode>(() => readDiffLayoutPref());

  const onLayoutChange = (mode: DiffLayoutMode) => {
    setLayout(mode);
    writeDiffLayoutPref(mode);
  };

  const diffProps = {
    hunks,
    variant,
    ...(maxHeightClass ? { maxHeightClass } : {}),
    ...(linePick ? { linePick } : {})
  };

  const body =
    layout === 'split' ? (
      <SplitDiffViewer {...diffProps} />
    ) : (
      <UnifiedDiffBody {...diffProps} />
    );

  const showToggle = showLayoutToggle && variant !== 'partial';
  if (!showToggle) return body;

  return (
    <div className="flex flex-col">
      <div className="mb-1.5 flex justify-end">
        <DiffLayoutToggle value={layout} onChange={onLayoutChange} />
      </div>
      {body}
    </div>
  );
}
