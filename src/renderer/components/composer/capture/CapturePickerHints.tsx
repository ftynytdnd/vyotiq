/**
 * Keyboard shortcut hints for the capture picker.
 */

import type { ReactNode } from 'react';

export function CapturePickerHints({ showSearchHint }: { showSearchHint: boolean }) {
  return (
    <div className="vx-model-picker-hints text-meta text-text-faint" aria-hidden>
      {showSearchHint ? (
        <span className="vx-model-picker-hints--compact">
          <HintKbd>/</HintKbd> search
        </span>
      ) : null}
      <span className="vx-model-picker-hints--nav">
        <HintKbd>↑</HintKbd>
        <HintKbd>↓</HintKbd> navigate
      </span>
      <span>
        <HintKbd>Enter</HintKbd> capture
      </span>
      <span className="vx-model-picker-hints--compact">
        <HintKbd>Esc</HintKbd> close
      </span>
    </div>
  );
}

function HintKbd({ children }: { children: ReactNode }) {
  return <kbd className="vx-model-picker-hint-kbd">{children}</kbd>;
}
