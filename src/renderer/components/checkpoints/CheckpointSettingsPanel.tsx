/**
 * Checkpoint settings — transcript rewind behavior (Settings → Checkpoints).
 */

import { Notice } from '../ui/Notice.js';
import { ShellCaption, ShellSection } from '../ui/ShellSection.js';

export function CheckpointSettingsPanel({ embedded: _embedded = false }: { embedded?: boolean }) {
  return (
    <ShellSection title="Rewind">
      <ShellCaption>
        Rewind-to-prompt trims the conversation transcript from the chosen user message onward.
        Workspace files on disk are not reverted — only the chat history changes.
      </ShellCaption>
      <Notice tone="info">
        Use the rewind control on a user message in the timeline to preview impact and confirm.
      </Notice>
    </ShellSection>
  );
}
