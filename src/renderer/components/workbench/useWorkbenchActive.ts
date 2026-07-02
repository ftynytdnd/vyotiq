import { useEditorStore } from '../../store/useEditorStore.js';
import { useTerminalStore } from '../../store/useTerminalStore.js';
import { useBrowserStore } from '../../store/useBrowserStore.js';
import { useAttachmentPreviewStore } from '../../store/useAttachmentPreviewStore.js';
import { useSourceControlStore } from '../../store/useSourceControlStore.js';

/** True when any companion pane (editor, terminal, browser, preview, source control) is open. */
export function useWorkbenchActive(): boolean {
  const editorOpen = useEditorStore((s) => s.open);
  const terminalOpen = useTerminalStore((s) => s.open);
  const browserOpen = useBrowserStore((s) => s.open);
  const previewOpen = useAttachmentPreviewStore((s) => s.attachment !== null);
  const sourceControlOpen = useSourceControlStore((s) => s.open);
  return editorOpen || terminalOpen || browserOpen || previewOpen || sourceControlOpen;
}
