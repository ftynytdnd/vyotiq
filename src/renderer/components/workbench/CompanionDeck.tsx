/**
 * Workbench side pane — editor, terminal, and globe to the right of agent chat.
 */

import { useUiStore } from '../../store/useUiStore.js';
import { useEditorStore } from '../../store/useEditorStore.js';
import { EditorCanvas } from './EditorCanvas.js';
import { EditorEmptyState } from './EditorEmptyState.js';
import { TerminalCanvas } from './TerminalCanvas.js';
import { GlobeCanvas } from './GlobeCanvas.js';
import {
  WORKBENCH_BODY_CLASS,
  WORKBENCH_PANE_CLASS,
  resolveCompanionTab,
  type CompanionTab
} from './workbenchShared.js';
import { WorkbenchTabBar } from './WorkbenchTabBar.js';
import { WorkbenchToolbar } from './WorkbenchToolbar.js';

function CompanionCanvas({ tab }: { tab: CompanionTab }) {
  const editorTabs = useEditorStore((s) => s.tabs);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);

  if (tab === 'terminal') {
    return <TerminalCanvas />;
  }
  if (tab === 'globe') {
    return <GlobeCanvas />;
  }
  if (editorTabs.length === 0 || !activeFilePath) {
    return <EditorEmptyState />;
  }
  return <EditorCanvas />;
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
      <div className={WORKBENCH_BODY_CLASS}>
        <CompanionCanvas tab={tab} />
      </div>
    </section>
  );
}
