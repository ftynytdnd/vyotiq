/**
 * ChatFooter — unified anchor for the chat column composer.
 * When `centered`, fills the viewport and vertically centers the composer
 * (empty-chat landing). Otherwise pins to the bottom below the timeline.
 */

import type { ReactNode } from 'react';
import { ChatComposerZone } from './ChatComposerZone.js';
import { ChatLandingShortcutHints } from './ChatLandingShortcutHints.js';
import { AskUserOverlayHost } from '../components/timeline/askUser/AskUserOverlayHost.js';
import { ComposerDialogAnchor } from '../components/ui/ComposerDialogAnchor.js';
import type { ModelSelection } from '@shared/types/provider.js';
import { cn } from '../lib/cn.js';

interface ChatFooterProps {
  contentWidth: string;
  model: ModelSelection | null;
  onModelChange: (sel: ModelSelection) => void;
  onOpenProviders: () => void;
  jumpOverlayHostRef?: (el: HTMLDivElement | null) => void;
  /** Vertically center the composer when the timeline has no messages. */
  centered?: boolean;
  /** Empty-chat landing — wider composer shell and landing placeholder. */
  landing?: boolean;
  /** Setup CTAs above composer (no workspace / no provider). */
  setupLead?: ReactNode;
  /** Show keyboard shortcut hints below composer (ready empty-chat landing). */
  showShortcutHints?: boolean;
  /** Focus the message field when the empty-chat landing is shown. */
  requestFocus?: boolean;
  /** Changes re-trigger focus (e.g. switching empty conversations). */
  focusSession?: string | null;
  /** Play a one-shot slide when switching from centered landing to bottom dock. */
  dockingFromCenter?: boolean;
}

export function ChatFooter({
  contentWidth,
  model,
  onModelChange,
  onOpenProviders,
  jumpOverlayHostRef,
  centered = false,
  landing = false,
  setupLead,
  showShortcutHints = false,
  requestFocus,
  dockingFromCenter = false,
  focusSession
}: ChatFooterProps) {
  return (
    <div
      data-chat-footer
      data-chat-footer-centered={centered ? '' : undefined}
      className={cn(
        'w-full px-4 pb-[max(6px,env(safe-area-inset-bottom,0px))]',
        centered
          ? 'flex min-h-0 w-full flex-1 flex-col justify-center'
          : cn('shrink-0 pt-3', dockingFromCenter && 'vyotiq-chat-dock-enter')
      )}
    >
      <div
        className={cn(
          'relative mx-auto w-full transition-[max-width] duration-200 ease-out',
          contentWidth,
          centered && 'vyotiq-chat-landing-enter'
        )}
      >
        {setupLead}
        <div
          ref={jumpOverlayHostRef}
          className="pointer-events-none absolute inset-x-0 bottom-full z-30 mb-3 flex justify-center"
          aria-hidden
        />
        <ComposerDialogAnchor className="vx-composer-dialog-slot empty:hidden" />
        <AskUserOverlayHost />
        <ChatComposerZone
          model={model}
          onModelChange={onModelChange}
          onOpenProviders={onOpenProviders}
          landing={landing}
          requestFocus={requestFocus}
          focusSession={focusSession}
        />
        {showShortcutHints ? <ChatLandingShortcutHints /> : null}
      </div>
    </div>
  );
}
