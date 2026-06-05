/**
 * Keyboard shortcut hints for the model picker search header.
 */

import type { ReactNode } from 'react';

export function ModelPickerHints() {
  return (
    <div className="vx-model-picker-hints" aria-hidden>
      <span className="vx-model-picker-hints--compact">
        <HintKbd>/</HintKbd> search
      </span>
      <span>
        <HintKbd>↑</HintKbd>
        <HintKbd>↓</HintKbd> navigate
      </span>
      <span>
        <HintKbd>Enter</HintKbd> select
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
