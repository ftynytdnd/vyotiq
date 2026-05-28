/**
 * ChatComposerZone — composer input embedded in {@link ChatFooter}.
 */

import { Composer } from '../components/composer/Composer.js';
import type { ModelSelection } from '@shared/types/provider.js';
import { cn } from '../lib/cn.js';

interface ChatComposerZoneProps {
  contentWidth: string;
  model: ModelSelection | null;
  onModelChange: (sel: ModelSelection) => void;
  onOpenProviders: () => void;
  /** When true, omits the outer footer chrome (parent supplies it). */
  embedded?: boolean;
  /** Composer flush inside the shared footer card (no nested rounded shell). */
  footerMode?: boolean;
}

export function ChatComposerZone({
  contentWidth,
  model,
  onModelChange,
  onOpenProviders,
  embedded = false,
  footerMode = false
}: ChatComposerZoneProps) {
  return (
    <div
      className={cn(
        embedded && footerMode && 'px-0 pb-0 pt-0',
        embedded && !footerMode && 'px-6 pb-2 pt-3',
        !embedded && 'shrink-0 border-t border-border-subtle/10 bg-surface-base/40 px-6 pb-3 pt-3'
      )}
    >
      <div
        className={cn(
          'mx-auto w-full transition-[max-width] duration-200 ease-out',
          contentWidth
        )}
      >
        <Composer
          model={model}
          onModelChange={onModelChange}
          onOpenProviders={onOpenProviders}
          variant={footerMode ? 'footer' : 'card'}
        />
      </div>
    </div>
  );
}
