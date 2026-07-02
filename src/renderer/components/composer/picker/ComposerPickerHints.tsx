/**
 * Keyboard shortcut hints shared by composer typeahead pickers (@, /, model, capture).
 */

import type { ReactNode } from 'react';

export function ComposerPickerHintKbd({ children }: { children: ReactNode }) {
  return <kbd className="vx-model-picker-hint-kbd">{children}</kbd>;
}

export interface ComposerPickerHintsProps {
  /** Middle segment label after Enter (e.g. "select", "select · folder expand"). */
  selectLabel?: string;
  /** Hide ↑↓ navigate on narrow layouts via CSS class. */
  showNav?: boolean;
  className?: string;
}

export function ComposerPickerHints({
  selectLabel = 'select',
  showNav = true,
  className
}: ComposerPickerHintsProps) {
  return (
    <div className={className ?? 'vx-model-picker-hints text-meta text-text-faint'} aria-hidden>
      {showNav ? (
        <span className="vx-model-picker-hints--nav">
          <ComposerPickerHintKbd>↑</ComposerPickerHintKbd>
          <ComposerPickerHintKbd>↓</ComposerPickerHintKbd> navigate
        </span>
      ) : null}
      <span>
        <ComposerPickerHintKbd>Enter</ComposerPickerHintKbd> {selectLabel}
      </span>
      <span className="vx-model-picker-hints--compact">
        <ComposerPickerHintKbd>Esc</ComposerPickerHintKbd> dismiss
      </span>
    </div>
  );
}
