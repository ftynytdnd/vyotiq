/**
 * Workbench shell — agent chat primary on the left; companions in a side pane.
 */

import { useState, type CSSProperties, type ReactNode } from 'react';
import { CompanionDeck } from './CompanionDeck.js';
import { WorkbenchResizeHandle } from './WorkbenchResizeHandle.js';
import {
  WORKBENCH_SHELL_CLASS,
  WORKBENCH_AGENT_MAIN_CLASS,
  WORKBENCH_SHELL_SPLIT_ROW_CLASS
} from './workbenchShared.js';
import { useWorkbenchActive } from './useWorkbenchActive.js';
import { useUiStore } from '../../store/useUiStore.js';
import { cn } from '../../lib/cn.js';

interface WorkbenchShellProps {
  children: ReactNode;
}

export function WorkbenchShell({ children }: WorkbenchShellProps) {
  const companionOpen = useWorkbenchActive();
  const workbenchPaneWidth = useUiStore((s) => s.workbenchPaneWidth);
  const [livePaneWidth, setLivePaneWidth] = useState<number | null>(null);
  const paneWidth = livePaneWidth ?? workbenchPaneWidth;

  return (
    <div
      className={cn(WORKBENCH_SHELL_CLASS, companionOpen && WORKBENCH_SHELL_SPLIT_ROW_CLASS)}
      style={
        companionOpen
          ? ({ '--workbench-pane-w': `${paneWidth}px` } as CSSProperties)
          : undefined
      }
    >
      <div
        className={cn(
          WORKBENCH_AGENT_MAIN_CLASS,
          companionOpen && 'vx-workbench-agent-main--split'
        )}
        data-workbench-agent-main
      >
        {children}
      </div>
      {companionOpen ? (
        <>
          <WorkbenchResizeHandle onLiveWidth={setLivePaneWidth} />
          <CompanionDeck />
        </>
      ) : null}
    </div>
  );
}
