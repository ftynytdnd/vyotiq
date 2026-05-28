/**
 * ChatFooter — unified bottom anchor for the chat column.
 *
 * Composer sits in a subtle bordered shell. Workspace and session
 * navigation live in the left-hand {@link LeftDock}.
 */

import { chromeEdgeClassName, SurfaceShell } from '../components/ui/SurfaceShell.js';
import { ChatComposerZone } from './ChatComposerZone.js';
import type { ModelSelection } from '@shared/types/provider.js';
import { cn } from '../lib/cn.js';

interface ChatFooterProps {
  contentWidth: string;
  model: ModelSelection | null;
  onModelChange: (sel: ModelSelection) => void;
  onOpenProviders: () => void;
}

export function ChatFooter({
  contentWidth,
  model,
  onModelChange,
  onOpenProviders
}: ChatFooterProps) {
  return (
    <div
      className={cn(
        'shrink-0 border-t',
        chromeEdgeClassName,
        'px-6 pb-[max(6px,env(safe-area-inset-bottom,0px))] pt-2'
      )}
    >
      <div
        className={cn(
          'mx-auto w-full transition-[max-width] duration-200 ease-out',
          contentWidth
        )}
      >
        <SurfaceShell focusGlow>
          <ChatComposerZone
            contentWidth="w-full"
            model={model}
            onModelChange={onModelChange}
            onOpenProviders={onOpenProviders}
            embedded
            footerMode
          />
        </SurfaceShell>
      </div>
    </div>
  );
}
