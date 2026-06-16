/**
 * Browser empty state — centered copy; navigation uses the toolbar address bar.
 */

import { Globe } from 'lucide-react';
import { SHELL_ACTION_ICON_STROKE } from '../../lib/shellIcons.js';
import { WORKBENCH_BODY_CLASS } from './workbenchShared.js';
import { WORKBENCH_EMPTY_CARD_CLASS } from './workbenchChrome.js';
import { cn } from '../../lib/cn.js';

export function BrowserEmptyState() {
  return (
    <div
      className={cn(
        WORKBENCH_BODY_CLASS,
        'vx-browser-empty pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-6 px-6 py-10 text-center'
      )}
    >
      <Globe className="h-8 w-8 text-text-faint" strokeWidth={SHELL_ACTION_ICON_STROKE} />
      <div className={cn('max-w-md space-y-1', WORKBENCH_EMPTY_CARD_CLASS)}>
        <p className="text-section font-medium text-text-primary">Browser</p>
        <p className="text-row text-text-muted">
          Search the web or enter a URL in the address bar above. Pages open in an isolated,
          persistent session.
        </p>
      </div>
    </div>
  );
}
