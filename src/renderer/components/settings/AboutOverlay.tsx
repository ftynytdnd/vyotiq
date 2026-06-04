import { X } from 'lucide-react';
import { AboutPanel } from './AboutPanel.js';
import { Button } from '../ui/Button.js';
import { SHELL_ROW_ICON_CLASS, SHELL_ROW_ICON_STROKE } from '../../lib/shellIcons.js';

interface AboutOverlayProps {
  open: boolean;
  onClose: () => void;
}

/** About content as a sheet over the Settings panel body. */
export function AboutOverlay({ open, onClose }: AboutOverlayProps) {
  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-10 flex flex-col bg-surface-raised"
      role="dialog"
      aria-modal="true"
      aria-label="About Vyotiq"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border-subtle/40 px-3 py-2">
        <span className="text-row font-medium text-text-primary">About</span>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close About">
          <X className={SHELL_ROW_ICON_CLASS} strokeWidth={SHELL_ROW_ICON_STROKE} />
        </Button>
      </div>
      <div className="scrollbar-stealth min-h-0 flex-1 overflow-y-auto">
        <AboutPanel />
      </div>
    </div>
  );
}
