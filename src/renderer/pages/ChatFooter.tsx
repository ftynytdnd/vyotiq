/**
 * ChatFooter — unified bottom anchor for the chat column.
 */

import { ChatComposerZone } from './ChatComposerZone.js';
import type { ModelSelection } from '@shared/types/provider.js';
import { cn } from '../lib/cn.js';

interface ChatFooterProps {
  contentWidth: string;
  model: ModelSelection | null;
  onModelChange: (sel: ModelSelection) => void;
  onOpenProviders: () => void;
  jumpOverlayHostRef?: (el: HTMLDivElement | null) => void;
}

export function ChatFooter({
  contentWidth,
  model,
  onModelChange,
  onOpenProviders,
  jumpOverlayHostRef
}: ChatFooterProps) {
  return (
    <div
      data-chat-footer
      className={cn(
        'shrink-0 px-4 pb-[max(6px,env(safe-area-inset-bottom,0px))] pt-3'
      )}
    >
      <div
        className={cn(
          'relative mx-auto w-full transition-[max-width] duration-200 ease-out',
          contentWidth
        )}
      >
        <div
          ref={jumpOverlayHostRef}
          className="pointer-events-none absolute inset-x-0 bottom-full z-30 mb-2 flex justify-center"
          aria-hidden
        />
        <ChatComposerZone
          model={model}
          onModelChange={onModelChange}
          onOpenProviders={onOpenProviders}
        />
      </div>
    </div>
  );
}
