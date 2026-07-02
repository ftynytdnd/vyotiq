/**
 * Tail status while an edit path is known but diff bytes have not landed yet.
 */

import { basenameFromPath } from '@shared/text/languageFromPath.js';

interface FileEditPendingRowProps {
  filePath: string;
}

export function FileEditPendingRow({ filePath }: FileEditPendingRowProps) {
  const name = basenameFromPath(filePath) || filePath;
  return (
    <p
      className="vx-file-edit-pending font-mono text-meta text-text-faint"
      data-row-kind="file-edit-pending"
      aria-live="polite"
    >
      Creating {name}
      <span className="vx-file-edit-pending__dots" aria-hidden>
        …
      </span>
    </p>
  );
}
