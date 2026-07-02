/**
 * Workbench side pane — editor, terminal, and globe to the right of agent chat.
 */

import { useUiStore } from '../../store/useUiStore.js';
import { useEditorStore } from '../../store/useEditorStore.js';
import { EditorCanvas } from './EditorCanvas.js';
import { EditorEmptyState } from './EditorEmptyState.js';
import { TerminalCanvas } from './TerminalCanvas.js';
import { BrowserCanvas } from './BrowserCanvas.js';
import { PreviewCanvas } from './PreviewCanvas.js';
import { SourceControlCanvas } from '../sourceControl/SourceControlCanvas.js';
import {
  WORKBENCH_PANE_CLASS,
  resolveCompanionTab,
  type CompanionTab
} from './workbenchShared.js';
import { WorkbenchTabBar } from './WorkbenchTabBar.js';
import { WorkbenchToolbar } from './WorkbenchToolbar.js';
import { EditorUnsavedCloseDialog } from './EditorUnsavedCloseDialog.js';

function CompanionCanvas({ tab }: { tab: CompanionTab }) {
  const editorTabs = useEditorStore((s) => s.tabs);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);

  switch (tab) {
    case 'terminal':
      return <TerminalCanvas />;
    case 'browser':
      return <BrowserCanvas />;
    case 'preview':
      return <PreviewCanvas />;
    case 'source-control':
      return <SourceControlCanvas />;
    case 'editor':
      if (editorTabs.length === 0 || !activeFilePath) {
        return <EditorEmptyState />;
      }
      return <EditorCanvas />;
    default: {
      const _exhaustive: never = tab;
      return _exhaustive;
    }
  }
}

export function CompanionDeck() {
  const tab = useUiStore((s) => resolveCompanionTab(s.workbenchTab));

  return (
    <section
      className={WORKBENCH_PANE_CLASS}
      data-workbench-companion
      data-workbench-pane
      aria-label="Workbench"
    >
      <WorkbenchTabBar />
      <WorkbenchToolbar tab={tab} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CompanionCanvas tab={tab} />
      </div>
      <EditorUnsavedCloseDialog />
    </section>
  );
}
