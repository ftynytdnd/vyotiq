/**
 * Reactive workbench-active flag — subscribes to companion stores.
 */

import { useAttachmentPreviewStore } from '../../store/useAttachmentPreviewStore.js';
import { useBrowserStore } from '../../store/useBrowserStore.js';
import { useEditorStore } from '../../store/useEditorStore.js';
import { useTerminalStore } from '../../store/useTerminalStore.js';

export function useWorkbenchActive(): boolean {
  const editorOpen = useEditorStore((s) => s.open);
  const terminalOpen = useTerminalStore((s) => s.open);
  const browserOpen = useBrowserStore((s) => s.open);
  const previewOpen = useAttachmentPreviewStore((s) => s.attachment !== null);
  return editorOpen || terminalOpen || browserOpen || previewOpen;
}
