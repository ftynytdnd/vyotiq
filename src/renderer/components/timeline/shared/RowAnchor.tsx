/**
 * Scroll-margin wrapper that exposes a stable DOM id for row deep links.
 */

import { type ReactNode } from 'react';
import { rowAnchorDomId } from './timelineRowAnchor.js';

interface RowAnchorProps {
  rowKey: string;
  children: ReactNode;
}

export function RowAnchor({ rowKey, children }: RowAnchorProps) {
  return (
    <div id={rowAnchorDomId(rowKey)} data-row-id={rowKey} className="scroll-mt-3">
      {children}
    </div>
  );
}
