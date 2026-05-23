/**
 * TextField — filled, stealth-dark text input. Captures the styling
 * shared by the model filter (`ModelList`), the meta-rule append row
 * (`MemoryPanel`), the AddProvider form fields, and every other plain
 * input across the renderer.
 *
 * Forwards `ref` so future ref-driven callers (autofocus, focus
 * trapping) work without a wrapper. Width / layout are caller-driven
 * via `className` (e.g. `w-full`, `flex-1`); no width is baked in to
 * avoid second-guessing the surrounding layout.
 *
 * Sizes:
 *   - `sm` — 28px / `text-row`. Compact filter rows, picker bodies.
 *   - `md` — 32px / `text-row`. Default for inline form inputs.
 *   - `lg` — 36px / `text-body`. Settings + dialog inputs.
 *
 * Tones map to the existing surface family — pick the one that
 * contrasts best with the parent surface:
 *   - `base`        — sits on a `surface-raised` parent.
 *   - `raised`      — sits on `surface-base`.
 *   - `overlay`     — sits on `surface-raised` panels.
 *   - `transparent` — for inputs nested inside a coloured row
 *     (dock search, model picker).
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
          'disabled:cursor-not-allowed disabled:opacity-50',
          // Hide the native number-input spinners — they break the
          // stealth-dark aesthetic and every numeric caller (rules
          // form, prune-by-runs box) drives value commits manually
          // through Enter/blur.
          type === 'number' &&
            '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
          className
        )}
        {...rest}
      />
    );
  }
);
