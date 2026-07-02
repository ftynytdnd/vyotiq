/**
 * Browser empty / error states — centered copy; navigation uses the toolbar address bar.
 */

import { Globe, RotateCcw } from 'lucide-react';
import { Button } from '../ui/Button.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../lib/shellIcons.js';
import { useBrowserStore } from '../../store/useBrowserStore.js';
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

export function BrowserErrorState({ message }: { message: string }) {
  const reload = useBrowserStore((s) => s.reload);

  return (
    <div
      className={cn(
        WORKBENCH_BODY_CLASS,
        'vx-browser-error absolute inset-0 flex flex-col items-center justify-center gap-6 px-6 py-10 text-center'
      )}
    >
      <Globe className="h-8 w-8 text-text-faint" strokeWidth={SHELL_ACTION_ICON_STROKE} />
      <div className={cn('max-w-md space-y-3', WORKBENCH_EMPTY_CARD_CLASS)}>
        <p className="text-section font-medium text-text-primary">Page failed to load</p>
        <p className="text-row text-text-muted">{message}</p>
        <Button variant="secondary" size="sm" className="app-no-drag" onClick={() => reload()}>
          <RotateCcw className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ACTION_ICON_STROKE} />
          Retry
        </Button>
      </div>
    </div>
  );
}
