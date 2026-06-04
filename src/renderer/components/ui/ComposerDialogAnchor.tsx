/**
 * ComposerDialogAnchor — mount slot for {@link ComposerDialog} so its
 * width matches the composer column rather than the full viewport.
 *
 * The slot lives in `ChatPage` directly above `ChatFooter`. Any
 * component anywhere in the tree (ComposerDialogAnchor mounted at the App root,
 * inline timeline rows, etc.) renders a {@link ComposerDialogPortal}
 * whose children are forwarded into the anchor — without React
 * context — via a module-level singleton registry.
 *
 * If the anchor is not yet mounted (boot, lazy-loaded dialog host
 * arriving before ChatPage), the portal renders nothing until the
 * anchor registers. The dialog host continues to queue burst prompts in
 * its own state so they surface as soon as the anchor is ready.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Subscriber = (el: HTMLElement | null) => void;

let currentAnchor: HTMLElement | null = null;
const subscribers = new Set<Subscriber>();

function setAnchorEl(el: HTMLElement | null): void {
  currentAnchor = el;
  for (const fn of subscribers) fn(el);
}

function subscribeToAnchor(sub: Subscriber): () => void {
  subscribers.add(sub);
  sub(currentAnchor);
  return () => {
    subscribers.delete(sub);
  };
}

/** Returns the current anchor element, or `null` until it mounts. */
function useAnchorNode(): HTMLElement | null {
  const [node, setNode] = useState<HTMLElement | null>(currentAnchor);
  useEffect(() => subscribeToAnchor(setNode), []);
  return node;
}

/**
 * Renders `children` into the active composer dialog anchor. When no
 * anchor is registered (unit tests, isolated component renders) the
 * portal falls back to `document.body` so dialogs are still
 * reachable. Production app shells always mount an anchor, so the
 * fallback only fires in test or pre-mount edge cases.
 */
export function ComposerDialogPortal({
  children,
  /** Above floating panels / app backdrop when strict approvals must stay reachable. */
  elevated = false
}: {
  children: ReactNode;
  elevated?: boolean;
}) {
  const node = useAnchorNode();
  if (typeof document === 'undefined') return null;
  if (elevated) {
    return createPortal(
      <div className="vx-composer-dialog-elevated-root pointer-events-none fixed inset-0 z-(--z-overlay-confirm) flex items-end justify-center px-4 pb-4">
        <div className="pointer-events-auto w-full max-w-2xl">{children}</div>
      </div>,
      document.body
    );
  }
  return createPortal(children, node ?? document.body);
}

/**
 * Slot mount point. Place inside the chat column directly above
 * `ChatFooter` so dialogs that portal here align with the composer.
 *
 * Only one anchor should be mounted at a time; if a second mounts
 * (e.g. a stray re-render race) it silently takes over and the prior
 * one is reset on unmount. Tests can rely on a single slot existing.
 */
export function ComposerDialogAnchor({ className }: { className?: string }) {
  const setRef = (el: HTMLDivElement | null) => {
    if (el) {
      setAnchorEl(el);
    } else if (currentAnchor && !document.body.contains(currentAnchor)) {
      // Slot unmounted (page tear-down or HMR). Clear so portals fall
      // back to rendering nothing rather than into a detached node.
      setAnchorEl(null);
    }
  };
  return (
    <div
      ref={setRef}
      data-vx-composer-dialog-anchor
      className={className}
    />
  );
}
