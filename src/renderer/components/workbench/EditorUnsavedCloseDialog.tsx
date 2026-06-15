/**
 * Unsaved editor tab close — ComposerDialog in workbench column.
 */

import { ComposerDialog } from '../ui/ComposerDialog.js';
import { ComposerDialogPortal } from '../ui/ComposerDialogAnchor.js';
import { Button } from '../ui/Button.js';
import { ShellFieldActions } from '../ui/ShellSection.js';
import { basenameFromPath } from '@shared/text/languageFromPath.js';
import { useEditorStore } from '../../store/useEditorStore.js';

export function EditorUnsavedCloseDialog() {
  const pending = useEditorStore((s) => s.pendingUnsavedClose);
  const complete = useEditorStore((s) => s.completeUnsavedClose);
  const cancel = useEditorStore((s) => s.cancelUnsavedClose);

  const name = pending ? basenameFromPath(pending) : '';

  return (
    <ComposerDialogPortal elevated>
      <ComposerDialog
        open={pending !== null}
        onClose={cancel}
        title="Unsaved changes"
        size="compact"
      >
        <p className="text-row text-text-secondary">
          Save changes to <span className="font-mono text-text-primary">{name}</span> before closing?
        </p>
        <ShellFieldActions className="mt-3">
          <Button variant="secondary" onClick={cancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void complete('discard')}>
            Don&apos;t Save
          </Button>
          <Button variant="primary" onClick={() => void complete('save')}>
            Save
          </Button>
        </ShellFieldActions>
      </ComposerDialog>
    </ComposerDialogPortal>
  );
}
