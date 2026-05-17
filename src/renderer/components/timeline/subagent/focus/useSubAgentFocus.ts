/**
 * Tiny per-trace hook for the sub-agent focus modal.
 *
 * Owns the open/close boolean for this trace's focus modal. State is
 * intentionally LOCAL — only one focus modal makes sense at a time,
 * and there's no cross-tree coordination concern, so promoting it to
 * a global store would be pure ceremony.
 *
 * Focus restoration on close is handled by `Modal` itself: it
 * captures `document.activeElement` at open time and re-focuses
 * that element when `open` flips back to `false`. The click that
 * opened the modal leaves the Focus button as the active element,
 * so no caller-supplied trigger ref is needed. A previous revision
 * threaded a `triggerRef` through `SubAgentActions` →
 * `IconAction.buttonRef`; no consumer ever read `triggerRef.current`
 * and the ref was removed so the contract here matches reality.
 *
 * Memory-leak hygiene: the hook itself owns no async work or
 * listeners. The modal underneath it (`Modal` in `ui/`) handles
 * scroll-lock + key handlers + focus restore with full cleanup.
 */

import { useCallback, useState } from 'react';

export interface SubAgentFocusController {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export function useSubAgentFocus(): SubAgentFocusController {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  return { isOpen, open, close };
}
