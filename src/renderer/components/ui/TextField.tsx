/**
 * TextField — filled, stealth-dark, 32 px text input. Captures the exact
 * styling shared by the model filter (`ModelList`) and the meta-rule
 * append row (`MemoryPanel`). Other input variants are intentionally
 * NOT served by this primitive:
 *   - `AddProviderForm.Field`  uses `bg-surface-raised` + `h-9`.
 *   - `PromptDialog`           uses `text-body` + `h-9`.
 *   - `SettingsModal`           uses an extra focus-bg transition.
 *   - `AttachmentPicker`        uses a compact `h-7 rounded`.
 *   - `SidebarSearch` / `ModelPickerPanel` / `ChatHistoryList` rename
 *     all use a transparent bg inside a colored row.
 *
 * Forwards `ref` so future ref-driven callers (autofocus, focus
 * trapping) work without a wrapper. Width / layout are caller-driven
 * via `className` (e.g. `w-full`, `flex-1`); no width is baked in to
 * avoid second-guessing the surrounding layout.
 */

import React from 'react';
import { cn } from '../../lib/cn.js';

type TextFieldSize = 'sm' | 'md' | 'lg';
type TextFieldTone = 'base' | 'raised' | 'overlay' | 'transparent';

const SIZE_CLASS: Record<TextFieldSize, string> = {
  sm: 'h-7 px-2 text-row',
  md: 'h-8 px-2.5 text-row',
  lg: 'h-9 px-3 text-body'
};

const TONE_CLASS: Record<TextFieldTone, string> = {
  base: 'bg-surface-base',
  raised: 'bg-surface-raised',
  overlay: 'bg-surface-overlay',
  transparent: 'bg-transparent'
};

type TextFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  size?: TextFieldSize;
  tone?: TextFieldTone;
};

export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField({ className, type = 'text', size = 'md', tone = 'base', ...rest }, ref) {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          'rounded-inner text-text-primary',
          SIZE_CLASS[size],
          TONE_CLASS[tone],
          'placeholder:text-text-muted outline-none focus:outline-none',
          className
        )}
        {...rest}
      />
    );
  }
);
