/**
 * Shared find-bar chrome — input + step/close controls for workbench and timeline.
 */

import type { ReactNode, RefObject } from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, X } from 'lucide-react';
import { cn } from '../../lib/cn.js';
import { SHELL_ACTION_ICON_STROKE, SHELL_ROW_ICON_CLASS } from '../../lib/shellIcons.js';

const WORKBENCH_STEP_BTN_CLASS =
  'flex items-center justify-center rounded p-1 text-text-muted transition-colors hover:bg-chrome-hover-soft hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40';

export interface FindBarShellProps {
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
  onStep: (forward: boolean) => void;
  onClose: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  autoFocus?: boolean;
  mono?: boolean;
  matchLabel?: string;
  stepDisabled?: boolean;
  leadingIcon?: ReactNode;
  /** Arrow icons for terminal/browser; chevrons for timeline. */
  navVariant?: 'arrow' | 'chevron';
  className?: string;
  inputClassName?: string;
  role?: string;
  inputAriaLabel?: string;
  inputType?: 'text' | 'search';
}

export function FindBarShell({
  placeholder,
  value,
  onChange,
  onStep,
  onClose,
  inputRef,
  autoFocus = false,
  mono = false,
  matchLabel,
  stepDisabled = false,
  leadingIcon,
  navVariant = 'arrow',
  className,
  inputClassName,
  role,
  inputAriaLabel,
  inputType = 'text'
}: FindBarShellProps) {
  const stepBtnClass =
    navVariant === 'chevron'
      ? 'vx-btn vx-btn-quiet rounded-[4px] p-0.5 disabled:opacity-40'
      : WORKBENCH_STEP_BTN_CLASS;

  const PrevIcon = navVariant === 'chevron' ? ChevronUp : ArrowLeft;
  const NextIcon = navVariant === 'chevron' ? ChevronDown : ArrowRight;

  return (
    <div className={className} role={role}>
      {leadingIcon}
      <input
        ref={inputRef}
        type={inputType}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onStep(!e.shiftKey);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder={placeholder}
        aria-label={inputAriaLabel ?? placeholder}
        className={cn('vx-input min-w-0 flex-1 text-meta', mono && 'font-mono', inputClassName)}
      />
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          className={stepBtnClass}
          title="Previous"
          aria-label="Previous match"
          disabled={stepDisabled}
          onClick={() => onStep(false)}
        >
          <PrevIcon
            className={navVariant === 'chevron' ? SHELL_ROW_ICON_CLASS : 'h-3.5 w-3.5'}
            strokeWidth={navVariant === 'chevron' ? SHELL_ACTION_ICON_STROKE : 2}
          />
        </button>
        <button
          type="button"
          className={stepBtnClass}
          title="Next"
          aria-label="Next match"
          disabled={stepDisabled}
          onClick={() => onStep(true)}
        >
          <NextIcon
            className={navVariant === 'chevron' ? SHELL_ROW_ICON_CLASS : 'h-3.5 w-3.5'}
            strokeWidth={navVariant === 'chevron' ? SHELL_ACTION_ICON_STROKE : 2}
          />
        </button>
      </div>
      {matchLabel !== undefined ? (
        <span className="shrink-0 font-mono vx-caption">{matchLabel}</span>
      ) : null}
      <button
        type="button"
        className={stepBtnClass}
        title="Close"
        aria-label="Close find"
        onClick={onClose}
      >
        <X
          className={navVariant === 'chevron' ? SHELL_ROW_ICON_CLASS : 'h-3.5 w-3.5'}
          strokeWidth={navVariant === 'chevron' ? SHELL_ACTION_ICON_STROKE : 2}
        />
      </button>
    </div>
  );
}
